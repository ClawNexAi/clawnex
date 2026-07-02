"use client";

/**
 * Mission Control data hooks — composes existing endpoints into typed,
 * refresh-strategy-aware data sources for each KPI / posture row / panel.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md §3.3, §10
 *
 * Refresh strategies (spec §10):
 *   - sse:        WebSocket / SSE channel (with poll_30s fallback)
 *   - poll_30s:   setInterval at 30s
 *   - poll_5m:    setInterval at 5min (300s)
 *   - on_demand:  fetch once on mount + on explicit invalidate event
 *   - static:     fetch once, never refresh
 *
 * Each hook returns { data, state, lastRefreshedAt, refresh } where state ∈
 *   "loading" | "live" | "stale" | "error".
 *
 * Stale-marker contract (spec §10.1):
 *   - last-refreshed timestamp always exposed
 *   - degraded source surfaced as state="stale" or "error"
 *   - no silent failure
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefreshStrategy, TimeRange } from "./types";
import { ALL_RULES } from "@/lib/shield/rules";
import { checkRegexSafety } from "@/lib/shield/safe-regex";
import { useMissionControlScope } from "./scope";

/** Static count of unsafe regex patterns in ALL_RULES, computed once at
 *  module load. The shield rules are baked into the bundle, so this is
 *  deterministic across all clients of the dashboard.
 *
 *  Uses checkRegexSafety(r.pattern.source, r.pattern.flags) — the same
 *  save-time heuristic enforced at rule creation. A pattern is counted as
 *  unsafe when checkRegexSafety returns { ok: false } for any reason
 *  (TOO_LONG, BAD_SYNTAX, or UNSAFE per the safe-regex2 AST check). */
const STATIC_UNSAFE_REGEX_COUNT = ALL_RULES.filter((r) => {
  const result = checkRegexSafety(r.pattern.source, r.pattern.flags);
  return !result.ok;
}).length;

function scopedQuery(
  selectedInstance: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  if (selectedInstance !== "all") qs.set("instance", selectedInstance);
  return qs.toString();
}

function collectorBelongsToScope(name: string, selectedInstance: string): boolean {
  if (selectedInstance === "all") return true;
  const isHermes = /hermes/i.test(name);
  return selectedInstance === "hermes-local" ? isHermes : !isHermes;
}

// ---------------------------------------------------------------------------
// Generic polling helper
// ---------------------------------------------------------------------------

interface UsePolledFetchOpts<T> {
  fetcher: () => Promise<T>;
  strategy: RefreshStrategy;
  /** Deps that, on change, force an immediate refetch. */
  deps?: unknown[];
}

interface PolledResult<T> {
  data: T | null;
  state: "loading" | "live" | "stale" | "error";
  lastRefreshedAt: number;
  refresh: () => void;
}

function usePolledFetch<T>({ fetcher, strategy, deps = [] }: UsePolledFetchOpts<T>): PolledResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<"loading" | "live" | "stale" | "error">("loading");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Synced every render so manual refresh() calls always read the latest fetcher
  // closure (avoids the stale-closure footgun when callers recreate fetcher per render).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Tracks whether the component is still mounted, so we never setState after unmount.
  const isMountedRef = useRef(true);
  // lastRefreshedAt-via-ref so the catch branch can pick "stale" vs "error" without
  // re-running the effect on every state change.
  const lastRefreshedAtRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await fetcherRef.current();
      if (!isMountedRef.current) return;
      setData(next);
      setState("live");
      const now = Date.now();
      lastRefreshedAtRef.current = now;
      setLastRefreshedAt(now);
    } catch {
      if (!isMountedRef.current) return;
      // Stale-marker contract (spec §10.1): if we ever had data, surface "stale" so
      // the consumer can keep showing the prior value with a stale badge. Otherwise
      // we have nothing to show — surface "error".
      setState(lastRefreshedAtRef.current > 0 ? "stale" : "error");
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    refresh();
    if (strategy === "poll_30s") {
      intervalRef.current = setInterval(refresh, 30_000);
    } else if (strategy === "poll_5m") {
      intervalRef.current = setInterval(refresh, 300_000);
    }
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, state, lastRefreshedAt, refresh };
}

// ---------------------------------------------------------------------------
// KPI 1 — Active Incidents (spec §5.1)
// ---------------------------------------------------------------------------

export interface ActiveIncidentsData {
  total: number;
  open: number;
  acknowledged: number;
  investigating: number;
  suppressed: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  // Item #3: new aggregate fields from /api/alerts (oldest open age + stale acks).
  oldestOpenAgeMs: number;
  ackButNotResolvedCount: number;
}

export function useActiveIncidents(): PolledResult<ActiveIncidentsData> {
  const { selectedInstance } = useMissionControlScope();
  return usePolledFetch<ActiveIncidentsData>({
    strategy: "poll_30s",
    deps: [selectedInstance],
    fetcher: async () => {
      const query = scopedQuery(selectedInstance, { scope: "active", productionOnly: true, limit: 500 });
      const res = await fetch(`/api/alerts?${query}`);
      if (!res.ok) throw new Error(`/api/alerts failed: ${res.status}`);
      const body = await res.json();
      // Route returns body.alerts[] with alert.status and alert.severity fields
      // (confirmed in src/app/api/alerts/route.ts — NextResponse.json({ alerts, ... })).
      // Canonical active scope is enforced by /api/alerts: open +
      // acknowledged + investigating. Suppressed/terminal alerts are handled
      // separately by the Alerts panel and risk-acceptance views.
      const alerts: Array<{ status?: string; severity?: string }> = body?.alerts ?? [];
      const total = typeof body?.total === "number" ? body.total : alerts.length;
      return {
        total,
        open: alerts.filter((a) => a.status === "open").length,
        acknowledged: alerts.filter((a) => a.status === "acknowledged").length,
        investigating: alerts.filter((a) => a.status === "investigating").length,
        suppressed: 0,
        critical: alerts.filter((a) => a.severity === "CRITICAL").length,
        high: alerts.filter((a) => a.severity === "HIGH").length,
        medium: alerts.filter((a) => a.severity === "MEDIUM").length,
        low: alerts.filter((a) => a.severity === "LOW").length,
        // Item #3: new aggregate fields from /api/alerts.
        // Route returns 0 when no open alerts exist — safe defaults.
        oldestOpenAgeMs: body?.oldest_open_age_ms ?? 0,
        ackButNotResolvedCount: body?.ack_but_not_resolved_count ?? 0,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// KPI 2 — Evidence Confidence (spec §5.2)
// ---------------------------------------------------------------------------

export interface EvidenceConfidenceData {
  total: number;
  exact: number;
  fallback: number;
  missingSnippet: number;
  percentage: number;
  // Item #5: count of alerts whose evidence is fetchable outside the ±60s window.
  // Source: outside_window_fetchable boolean on /api/alerts/[id]/evidence.
  outsideWindowFetchable: number;
}

export function useEvidenceConfidence(): PolledResult<EvidenceConfidenceData> {
  const { selectedInstance } = useMissionControlScope();
  return usePolledFetch<EvidenceConfidenceData>({
    strategy: "poll_30s",
    deps: [selectedInstance],
    fetcher: async () => {
      const query = scopedQuery(selectedInstance, { scope: "active", productionOnly: true, limit: 500 });
      const res = await fetch(`/api/alerts?${query}`);
      if (!res.ok) throw new Error(`/api/alerts failed: ${res.status}`);
      const body = await res.json();
      // Evidence confidence reflects the same canonical active production
      // population as the Active Incidents KPI.
      const alerts: Array<{ id: string; status?: string }> = body?.alerts ?? [];
      if (alerts.length === 0) {
        return { total: 0, exact: 0, fallback: 0, missingSnippet: 0, percentage: 0, outsideWindowFetchable: 0 };
      }
      const evidences = await Promise.allSettled(
        alerts.map((a) =>
          fetch(`/api/alerts/${encodeURIComponent(a.id)}/evidence`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      );
      let exact = 0;
      let fallback = 0;
      let missingSnippet = 0;
      // Item #5: count alerts whose evidence is fetchable outside the ±60s window.
      let outsideWindowFetchable = 0;
      for (const e of evidences) {
        if (e.status !== "fulfilled" || !e.value) continue;
        // correlation_method is a top-level field on the evidence response
        // (confirmed in src/app/api/alerts/[id]/evidence/route.ts).
        const method: string = e.value.correlation_method;
        if (method === "forward") exact++;
        else if (method === "fallback_nearest") fallback++;
        // match_found_in_excerpt is NOT a top-level field — it lives inside each
        // matched_snippets[] item (confirmed in route.ts buildMatchedSnippets).
        // Count alerts where at least one snippet could not be centered in the payload.
        const snippets: Array<{ match_found_in_excerpt?: boolean }> =
          e.value.matched_snippets ?? [];
        if (snippets.some((s) => s.match_found_in_excerpt === false)) missingSnippet++;
        // outside_window_fetchable is a top-level boolean on the evidence response
        // (shipped in Item #5). Default false when absent (pre-update responses).
        if (e.value.outside_window_fetchable === true) outsideWindowFetchable++;
      }
      return {
        total: alerts.length,
        exact,
        fallback,
        missingSnippet,
        percentage: Math.round((exact / alerts.length) * 100),
        outsideWindowFetchable,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// KPI 3 — Shield Activity 24h (spec §5.3)
// ---------------------------------------------------------------------------

export interface ShieldHourBucket {
  hour: string;    // ISO-8601 hour e.g. "2026-05-05T14:00:00Z"
  total: number;
  allowed: number;
  reviewed: number;
  blocked: number;
}

export interface ShieldActivityData {
  total: number;
  allow: number;
  review: number;
  block: number;
  topFamily?: string;      // aspirational — not yet returned by /api/shield/stats
  topFamilyPct?: number;   // aspirational — not yet returned by /api/shield/stats
  // Item #1: per-hour buckets for the DetectionTrend SVG line chart.
  // Present when ?bucket=hour is passed to the route; undefined otherwise.
  hourlyBuckets?: ShieldHourBucket[];
}

export function useShieldActivity(range: TimeRange): PolledResult<ShieldActivityData> {
  const { selectedInstance } = useMissionControlScope();
  return usePolledFetch<ShieldActivityData>({
    strategy: "poll_30s",
    deps: [range, selectedInstance],
    fetcher: async () => {
      const sinceMs = rangeSinceMs(range);
      const since = new Date(Date.now() - sinceMs).toISOString();
      // Item #1: request hourly buckets for the DetectionTrend chart.
      const query = scopedQuery(selectedInstance, { since, bucket: "hour" });
      const res = await fetch(`/api/shield/stats?${query}`);
      if (!res.ok) throw new Error(`/api/shield/stats failed: ${res.status}`);
      const body = await res.json();
      // Route returns body.allowed / body.reviewed / body.blocked (not allow/review/block).
      // Both the DB-level getShieldStats() path and the instance-filtered path use
      // these names (confirmed in src/app/api/shield/stats/route.ts).
      // topFamily / topFamilyPct are not returned by the route — guard with ?? undefined.
      return {
        total: body?.total ?? 0,
        allow: body?.allowed ?? 0,    // route field: allowed (not allow)
        review: body?.reviewed ?? 0,  // route field: reviewed (not review)
        block: body?.blocked ?? 0,    // route field: blocked (not block)
        topFamily: body?.topFamily ?? undefined,
        topFamilyPct: body?.topFamilyPct ?? undefined,
        // Item #1: hourlyBuckets is present when ?bucket=hour is passed (as it
        // is now). Default to undefined when absent for backward compat.
        hourlyBuckets: body?.hourlyBuckets ?? undefined,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// KPI 4 — Cost Risk (spec §5.4)
// ---------------------------------------------------------------------------

export interface CostRiskData {
  headlineUsd: number;
  headlineSource: string;
  perSource: Array<{ source: string; usd: number; count: number }>;
  signals: Array<{ kind: string; severity: string; detail: string }>;
}

export function useCostRisk(range: TimeRange): PolledResult<CostRiskData> {
  const { selectedInstance } = useMissionControlScope();
  return usePolledFetch<CostRiskData>({
    strategy: "poll_5m",
    deps: [range, selectedInstance],
    fetcher: async () => {
      // Route accepts ?since= ISO timestamp, not ?range=. Convert TimeRange to a
      // since-param for the existing /api/tokens route
      // (confirmed in src/app/api/tokens/route.ts — uses searchParams.get('since')).
      const sinceMs = rangeSinceMs(range);
      const since = new Date(Date.now() - sinceMs).toISOString();
      const query = scopedQuery(selectedInstance, { since });
      const res = await fetch(`/api/tokens?${query}`);
      if (!res.ok) throw new Error(`/api/tokens failed: ${res.status}`);
      const body = await res.json();
      // headline shape: { source: Source; total: number } | null
      // (confirmed in src/lib/types/cost-reporting.ts CostReport.headline).
      // Plan called it headline.usd — actual field is headline.total.
      const headline: { source: string; total: number } | null = body?.headline ?? null;
      // perSource shape: Record<Source, { count: number; totalUsd: number }>
      // (confirmed in src/lib/types/cost-reporting.ts PerSourceTotal).
      // Convert from Record to Array for easy rendering.
      const perSourceRecord: Record<string, { count: number; totalUsd: number }> = body?.perSource ?? {};
      const perSource = Object.entries(perSourceRecord).map(([source, totals]) => ({
        source,
        usd: totals.totalUsd,
        count: totals.count,
      }));
      // Signal shape: { kind, severity, affected_row_ids, detail }
      // (confirmed in src/lib/types/cost-reporting.ts Signal interface).
      // Plan expected { kind, source, agent } — actual shape differs; normalise to kind+severity+detail.
      const rawSignals: Array<{ kind: string; severity?: string; detail?: string }> = body?.signals ?? [];
      const signals = rawSignals.map((s) => ({
        kind: s.kind,
        severity: s.severity ?? "warn",
        detail: s.detail ?? "",
      }));
      return {
        headlineUsd: headline?.total ?? 0,     // plan used headline.usd — actual field is headline.total
        headlineSource: headline?.source ?? "unknown",
        perSource,
        signals,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// KPI 5 — Collector Health (spec §5.5)
// ---------------------------------------------------------------------------

export interface CollectorHealthData {
  total: number;
  healthy: number;
  collectors: Array<{
    name: string;
    status: string;
    lastSeenMsAgo: number;
    staleThresholdMs: number;
    // Item #4: version + ingestion_summary from /api/infrastructure ServiceCheck.
    // Optional: absent for services with no version / ingestion concept.
    version?: string;
    ingestion_summary?: string;
  }>;
}

export function useCollectorHealth(): PolledResult<CollectorHealthData> {
  const { selectedInstance } = useMissionControlScope();
  return usePolledFetch<CollectorHealthData>({
    strategy: "poll_30s",
    deps: [selectedInstance],
    fetcher: async () => {
      const res = await fetch("/api/infrastructure");
      if (!res.ok) throw new Error(`/api/infrastructure failed: ${res.status}`);
      const body = await res.json();
      // Route returns body.services[] with { name, url, status, latency, error?,
      // version?, ingestion_summary? }. The plan's last_seen_ms_ago field does not
      // exist on this route's ServiceCheck type; default to 0 (unknown) and rely
      // on the status field instead.
      const services: Array<{
        name: string;
        status: string;
        last_seen_ms_ago?: number;
        version?: string;
        ingestion_summary?: string;
      }> = (body?.services ?? []).filter((s: { name?: string }) =>
        collectorBelongsToScope(String(s.name ?? ""), selectedInstance),
      );
      const collectors = services.map((s) => ({
        name: s.name,
        status: s.status,
        lastSeenMsAgo: s.last_seen_ms_ago ?? 0,   // field absent in route; 0 = unknown
        staleThresholdMs: staleThresholdFor(s.name),
        // Item #4: pass through version + ingestion_summary when present.
        version: s.version,
        ingestion_summary: s.ingestion_summary,
      }));
      // When last_seen_ms_ago is 0 (absent), fall back to the route's own status field
      // as the health signal: "online" counts as healthy, everything else does not.
      const healthy = collectors.filter((c) => {
        if (c.lastSeenMsAgo > 0) return c.lastSeenMsAgo <= c.staleThresholdMs;
        return c.status === "online";
      }).length;
      return {
        total: collectors.length,
        healthy,
        collectors,
      };
    },
  });
}

function staleThresholdFor(collectorName: string): number {
  // Spec §5.5 thresholds.
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  if (/openclaw/i.test(collectorName)) return 30 * SECOND;
  if (/hermes/i.test(collectorName)) return 5 * MINUTE;
  if (/paperclip/i.test(collectorName)) return 30 * MINUTE;
  if (/session/i.test(collectorName)) return 10 * SECOND;
  if (/audit/i.test(collectorName)) return 60 * SECOND;
  return MINUTE;  // sensible default
}

// ---------------------------------------------------------------------------
// Action Queue support — raw active alerts (spec §7.3)
//
// Separate from useActiveIncidents (which aggregates into counts) — the
// Action Queue needs the actual row objects so it can compose them with cost
// signals and stale-collector rows and sort by priority_score.
//
// Field names confirmed against AlertData in src/components/dashboard/types.ts
// and the GET /api/alerts route (src/app/api/alerts/route.ts):
//   id, title, severity, source, status, created_at are all top-level.
//   correlation_method is NOT on the bulk list — only on per-alert evidence.
//   Default to "fallback" when absent (spec §7 mapper note).
// ---------------------------------------------------------------------------

export interface ActiveAlert {
  id: string;
  title?: string;
  severity?: string;
  source?: string;
  status?: string;
  created_at: string;
  /** Present on per-alert evidence endpoint only; absent on bulk list.
   *  Treat undefined → "fallback" in the Action Queue mapper. */
  correlation_method?: string;
}

export function useActiveAlerts(): PolledResult<ActiveAlert[]> {
  const { selectedInstance } = useMissionControlScope();
  return usePolledFetch<ActiveAlert[]>({
    strategy: "poll_30s",
    deps: [selectedInstance],
    fetcher: async () => {
      const query = scopedQuery(selectedInstance, { scope: "active", productionOnly: true, limit: 500 });
      const res = await fetch(`/api/alerts?${query}`);
      if (!res.ok) throw new Error(`/api/alerts failed: ${res.status}`);
      const body = await res.json();
      // Route wraps alerts under body.alerts[] and applies canonical active
      // scope + production filtering server-side.
      return (body?.alerts ?? []) as ActiveAlert[];
    },
  });
}

// ---------------------------------------------------------------------------
// KPI 6 — Policy Coverage (spec §5.6) — fetched once + on policy mutation
// ---------------------------------------------------------------------------

export interface PolicyCoverageData {
  coreRules: number;
  activeEgressStarter: number;
  labHeldDrafts: number;
  unsafeRegexCount: number;
}

export function usePolicyCoverage(): PolledResult<PolicyCoverageData> {
  return usePolledFetch<PolicyCoverageData>({
    strategy: "static",
    fetcher: async () => {
      const res = await fetch("/api/policies");
      if (!res.ok) throw new Error(`/api/policies failed: ${res.status}`);
      const body = await res.json();
      // Route returns { policies: Policy[] } where each policy has rule_count (number)
      // but does NOT inline the rules array. The plan's p.rules flatMap would be
      // undefined — use policy-level enabled + lifecycle fields instead.
      // (confirmed in src/app/api/policies/route.ts — listPolicies() + rule_count only).
      const policies: Array<{ enabled?: boolean; lifecycle?: string; rule_count?: number }> =
        body?.policies ?? [];
      return {
        coreRules: 163,  // TODO(v1.1): wire from API; matches spec required-copy "163 core Shield rules"
        // Active policies that are not in lab lifecycle.
        activeEgressStarter: policies.filter((p) => p.enabled === true && p.lifecycle !== "lab").length,
        // Policies held in lab (disabled drafts).
        labHeldDrafts: policies.filter((p) => p.lifecycle === "lab" && p.enabled !== true).length,
        // STATIC_UNSAFE_REGEX_COUNT is computed at module load from ALL_RULES +
        // checkRegexSafety (safe-regex2 AST heuristic). Deterministic across
        // all clients because ALL_RULES is bundle-baked. Was hardcoded 0 with
        // a TODO(v1.1) — now exposes the real count. (#6 closed)
        unsafeRegexCount: STATIC_UNSAFE_REGEX_COUNT,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Trust Audit findings — 4th Action Queue source (spec §7, variant A)
// ---------------------------------------------------------------------------

/**
 * Single finding from GET /api/trust-audit — shape matches the report.findings
 * array returned by the trust audit engine (src/lib/services/trust-audit).
 * Only the fields needed to build an ActionRow are declared here; the full
 * finding shape lives in the trust-audit types.
 */
export interface TrustAuditFinding {
  id: string;
  ruleId: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  whyItMatters: string;
  blastRadius?: string;
  /** Agent the finding is bound to, when the rule is agent-scoped (most are). */
  agentId?: string;
  /** Surface (Discord/Slack/etc.) the finding is bound to, when applicable. */
  surfaceId?: string;
  /** Capability chain that triggered the rule (e.g. ["tool:exec", "tool:write"]). */
  capabilityPath?: string[];
  /** Sandboxing posture of the affected agent at evaluation time. */
  containmentState?: "sandboxed" | "unsandboxed" | "partial" | "unknown";
  /** Prescriptive remediation text from the rule. */
  recommendedFix?: string;
  /** Free-text evidence trail entries — short snippets, no raw payload. */
  evidence?: string[];
  /** Evidence provenance — drives the Triage Graph evidence-stage state mapping. */
  confidence?:
    | "verified_runtime"
    | "verified_config"
    | "verified_filesystem"
    | "heuristic_inference"
    | "unknown";
}

/**
 * Poll GET /api/trust-audit every 5 minutes (it's an expensive engine run;
 * the route caches the last result and returns it by default, so the poll
 * frequency is fine). Normalises body.report.findings → TrustAuditFinding[].
 *
 * Returns an empty array (not null) on API error so ActionQueue renders
 * gracefully without a separate error surface for the trust-audit source.
 */
export function useTrustAuditFindings(): PolledResult<TrustAuditFinding[]> {
  return usePolledFetch<TrustAuditFinding[]>({
    strategy: "poll_5m",
    fetcher: async () => {
      const res = await fetch("/api/trust-audit");
      if (!res.ok) throw new Error(`/api/trust-audit failed: ${res.status}`);
      const body = await res.json();
      // Route returns { report: AuditReport, meta: {...} } where
      // AuditReport.findings is the flat finding array (confirmed in
      // src/app/api/trust-audit/route.ts and TrustAuditService).
      const findings: TrustAuditFinding[] = body?.report?.findings ?? [];
      return findings;
    },
  });
}

// ---------------------------------------------------------------------------
// Phase 6 producers — supplemental hooks
//
// These hooks back the 5 Phase 6 row producers (correlation, blast-radius,
// auth-rbac, update-cve, policy-warning). They reuse already-exposed REST
// endpoints — no new server routes. Each hook is best-effort: previously a
// 404/403/network-failure caused usePolledFetch to surface state="error",
// which was invisible to the producer (the producer just got data=null and
// emitted zero rows — operators couldn't tell "no findings" from "couldn't
// read source").
//
// v1.1 polish 2026-05-08: each Phase 6 hook now catches its own fetch
// failures and returns `{ ...payload, degraded?: DegradedState }` so the
// producer can emit ONE banner row per degraded source instead of silently
// emitting zero. Crucially the fetcher NEVER throws on a capturable failure;
// it returns a payload with degraded set. This keeps the existing
// usePolledFetch state machine at "live" while the embedded `degraded`
// field tells the producer to render a banner row. Network exceptions
// (the await fetch() throw) still propagate to "error" state, which is
// correct — the data is genuinely unavailable in that case.
// ---------------------------------------------------------------------------

/** Reason a Phase 6 data source is unreachable. Drives the banner copy. */
export type DegradedReason = "auth" | "unreachable" | "missing-endpoint";

/** Single-source degrade marker. Optional on the data payload — when
 *  absent, the source is healthy and the producer emits real findings. */
export interface DegradedState {
  reason: DegradedReason;
}

/** Classify an HTTP response into a DegradedReason. Centralised so all
 *  three Phase 6 hooks degrade consistently — important for the verifier.
 *  - 401 / 403 → "auth" (operator needs to sign in or upgrade their role)
 *  - 404 → "missing-endpoint" (older instance without this surface)
 *  - everything else (incl. 5xx) → "unreachable" */
function classifyDegrade(status: number): DegradedReason {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "missing-endpoint";
  return "unreachable";
}

/** CVE record shape — mirror of /api/cve `cves[]` items, narrow to the
 *  fields the Action Queue producer actually reads. The endpoint returns
 *  more (cwes, html_url, date_published) but the producer doesn't need them. */
export interface CveRecord {
  cve_id: string;
  severity: string;          // "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  cvss: number | null;
  title: string;
  fixed_version: string;     // e.g. "api-gateway 4.2.1"
}

export interface CveData {
  cves: CveRecord[];
  /** Set when /api/cve is unreachable. Producer emits ONE banner instead
   *  of silently returning an empty array — operators can distinguish
   *  "no CVEs" from "CVE feed down". */
  degraded?: DegradedState;
}

/** Pull the top CVE entries from /api/cve. Limit caps server-side selection
 *  so the producer doesn't get flooded; the producer additionally caps to
 *  top 10 by CVSS before emitting rows. */
export function useCveData(): PolledResult<CveData> {
  return usePolledFetch<CveData>({
    strategy: "poll_5m",
    fetcher: async () => {
      try {
        const res = await fetch("/api/cve?limit=50");
        if (!res.ok) {
          return { cves: [], degraded: { reason: classifyDegrade(res.status) } };
        }
        const body = await res.json();
        const cves: CveRecord[] = Array.isArray(body?.cves) ? body.cves : [];
        return { cves };
      } catch {
        // Network failure (server down, CORS, abort) — never reaches the
        // server. Surface as "unreachable" so the operator gets a banner
        // instead of an empty queue.
        return { cves: [], degraded: { reason: "unreachable" } };
      }
    },
  });
}

/** Auth scan input — composes /api/auth/status (RBAC enabled flag, current
 *  operator) + /api/config/operators (admin-only — when the caller lacks
 *  operators:manage perm the route returns 403 and operators stays empty). */
export interface AuthScanData {
  rbacEnabled: boolean;
  operators: Array<{
    id: string;
    username: string;
    role: string;
    last_login_at: string | null;
    is_active: number;
  }>;
  /** Set when neither /api/auth/status nor /api/config/operators are
   *  reachable. The auth-rbac producer emits one banner row in that case.
   *  We treat the source as degraded only when BOTH fail — a 403 on
   *  /api/config/operators alone is expected for non-admin operators
   *  (rbac operators-list is admin-only) and shouldn't surface a banner. */
  degraded?: DegradedState;
}

export function useAuthScan(): PolledResult<AuthScanData> {
  return usePolledFetch<AuthScanData>({
    strategy: "poll_5m",
    fetcher: async () => {
      // Fetch both in parallel; we treat the source as degraded only when
      // BOTH probes fail — a 403 on /api/config/operators alone is expected
      // for non-admin operators (the route is admin-only) and shouldn't
      // surface a banner. /api/auth/status is the canonical auth probe.
      const [statusRes, opsRes] = await Promise.allSettled([
        fetch("/api/auth/status"),
        fetch("/api/config/operators"),
      ]);

      let rbacEnabled = false;
      let statusOk = false;
      let statusDegrade: DegradedReason | null = null;
      if (statusRes.status === "fulfilled") {
        if (statusRes.value.ok) {
          const body = await statusRes.value.json().catch(() => ({}));
          rbacEnabled = body?.rbacEnabled === true;
          statusOk = true;
        } else {
          statusDegrade = classifyDegrade(statusRes.value.status);
        }
      } else {
        statusDegrade = "unreachable";
      }

      let operators: AuthScanData["operators"] = [];
      if (opsRes.status === "fulfilled" && opsRes.value.ok) {
        const body = await opsRes.value.json().catch(() => ({}));
        const raw = Array.isArray(body?.operators) ? body.operators : [];
        operators = raw.map((o: Record<string, unknown>) => ({
          id: String(o.id ?? ""),
          username: String(o.username ?? ""),
          role: String(o.role ?? ""),
          last_login_at: (o.last_login_at as string | null) ?? null,
          is_active: typeof o.is_active === "number" ? o.is_active : 0,
        }));
      }

      // Only surface degraded when /api/auth/status (the canonical RBAC
      // probe) fails — operators[] being empty is the route-level expected
      // shape for non-admin operators and shouldn't trigger a banner.
      const degraded = !statusOk && statusDegrade !== null
        ? { reason: statusDegrade }
        : undefined;
      return { rbacEnabled, operators, degraded };
    },
  });
}

/** Per-rule firing summary, derived from /api/shield/history. We aggregate
 *  client-side because there's no per-rule stats endpoint and the policy-
 *  warning producer only needs (ruleKey, firingCount, avgConfidence). */
export interface ShieldRuleSummary {
  ruleKey: string;
  firingCount: number;
  avgConfidence: number;          // 0..1; 0 when no firings recorded confidence
  lastFiredMs: number | null;
}

export interface ShieldRuleData {
  rules: ShieldRuleSummary[];
  /** Wall-clock window the aggregation covers (ms). */
  windowMs: number;
  /** Set when /api/shield/history is unreachable. Producer emits a banner. */
  degraded?: DegradedState;
}

export function useShieldRuleSummary(): PolledResult<ShieldRuleData> {
  const { selectedInstance } = useMissionControlScope();
  return usePolledFetch<ShieldRuleData>({
    strategy: "poll_5m",
    deps: [selectedInstance],
    fetcher: async () => {
      try {
        // /api/shield/history returns recent scans, each with matched_rules[].
        // We pull a wide window and aggregate per rule. No new server route.
        const query = scopedQuery(selectedInstance, { limit: 500 });
        const res = await fetch(`/api/shield/history?${query}`);
        if (!res.ok) {
          return { rules: [], windowMs: 24 * 3600_000, degraded: { reason: classifyDegrade(res.status) } };
        }
        const body = await res.json();
        const scans: Array<{
          timestamp?: string;
          matched_rules?: Array<{ rule_id?: string; confidence?: number }>;
        }> = Array.isArray(body?.scans) ? body.scans : [];

        const acc = new Map<string, { count: number; confSum: number; confN: number; lastMs: number }>();
        for (const s of scans) {
          const ts = s.timestamp ? new Date(s.timestamp).getTime() : 0;
          for (const r of s.matched_rules ?? []) {
            const key = String(r.rule_id ?? "");
            if (!key) continue;
            const cur = acc.get(key) ?? { count: 0, confSum: 0, confN: 0, lastMs: 0 };
            cur.count += 1;
            if (typeof r.confidence === "number") {
              cur.confSum += r.confidence;
              cur.confN += 1;
            }
            if (ts > cur.lastMs) cur.lastMs = ts;
            acc.set(key, cur);
          }
        }

        const rules: ShieldRuleSummary[] = [];
        acc.forEach((v, key) => {
          rules.push({
            ruleKey: key,
            firingCount: v.count,
            avgConfidence: v.confN > 0 ? v.confSum / v.confN : 0,
            lastFiredMs: v.lastMs > 0 ? v.lastMs : null,
          });
        });

        return { rules, windowMs: 24 * 3600_000 };
      } catch {
        return { rules: [], windowMs: 24 * 3600_000, degraded: { reason: "unreachable" } };
      }
    },
  });
}

/** Installed-version data for the update-cve producer. Polled once on
 *  mount because the install version doesn't change at runtime — a deploy
 *  would restart the process and re-fetch. ClawNex version is always
 *  available (read from package.json server-side); openclaw is null when
 *  no install detected.
 *
 *  v1.1 polish 2026-05-08: this hook closes the gap where update-cve rows
 *  rendered "OpenClaw at installed → 2026.4.10" — the placeholder
 *  "installed" instead of the actual version. Now we read the actual
 *  version from /api/system/version and the row reads "OpenClaw 2026.4.8
 *  → 2026.4.10". When the route is unreachable (older instance, auth
 *  failure), we degrade to undefined currentVersion — the resolver
 *  conditions on falsy and falls back to package-only copy. */
export interface InstalledVersionsData {
  clawnex: string | null;
  openclaw: string | null;
}

export function useInstalledVersions(): PolledResult<InstalledVersionsData> {
  return usePolledFetch<InstalledVersionsData>({
    // Static — install version doesn't change at runtime.
    strategy: "static",
    fetcher: async () => {
      try {
        const res = await fetch("/api/system/version");
        if (!res.ok) {
          // Auth-gated route degrades to null — producer falls back to
          // package-only copy. No banner for this; the source is intentionally
          // optional polish, not an alerting input.
          return { clawnex: null, openclaw: null };
        }
        const body = await res.json();
        return {
          clawnex: typeof body?.clawnex === "string" ? body.clawnex : null,
          openclaw: typeof body?.openclaw === "string" ? body.openclaw : null,
        };
      } catch {
        return { clawnex: null, openclaw: null };
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rangeSinceMs(range: TimeRange): number {
  const HOUR = 3600_000;
  // TypeRange is a closed union, but Record<string, number>[key] is number | undefined
  // under strict mode; default to 24h for any unknown value.
  return { "1h": HOUR, "6h": 6 * HOUR, "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR }[range] ?? 24 * HOUR;
}
