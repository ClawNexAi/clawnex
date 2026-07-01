"use client";

import { KpiCard } from "./KpiCard";
import {
  useActiveIncidents,
  useEvidenceConfidence,
  useShieldActivity,
  useCostRisk,
  useCollectorHealth,
  usePolicyCoverage,
  type ActiveIncidentsData,
  type EvidenceConfidenceData,
  type ShieldActivityData,
  type CostRiskData,
  type CollectorHealthData,
  type PolicyCoverageData,
} from "./data-hooks";
import type { KpiAccent, KpiData, TimeRange } from "./types";
import type { TabId } from "../../types";
import type { NavigateOpts } from "../../url-state";

const ACTIVE_STATUS_FILTER = ["open", "acknowledged", "investigating"];

interface Props {
  range: TimeRange;
  demoMode: boolean;
  onNavigate: (tab: TabId, focusOrOpts?: NavigateOpts) => void;
}

/**
 * The 6-KPI top row of Mission Control. Each KPI hook fires independently
 * with its own refresh strategy from spec §10. Cards render as a 6-col
 * grid that collapses 6→3 at 1239px and 6→1 at 759px (CSS in globals.css).
 *
 * Demo mode is currently a passthrough — Task 11 or a follow-up will wire
 * buildDemoKpis() in when the demo-mode toggle becomes user-facing on
 * the cockpit. For now demoMode is reserved for the header pill flip.
 *
 * Each mapXToKpi function follows the Task 8 pattern:
 *   - loading / error → fixed shape via loadingKpi() / errorKpi() helpers
 *   - stale → spread the live shape, override state="stale"
 *   - empty / live → state-aware shape with breakdown + stack
 *
 * Click targets use only navigate-compatible opts. Task 14 will introduce
 * the missionControlFocus slot and re-add the breadcrumb opt across all
 * 6 click handlers.
 */
export function KpiRow({ range, demoMode, onNavigate }: Props) {
  // demoMode is reserved for the parent's header pill; not yet consumed here.
  void demoMode;

  const incidents = useActiveIncidents();
  const evidence = useEvidenceConfidence();
  const shield = useShieldActivity(range);
  const cost = useCostRisk(range);
  const collector = useCollectorHealth();
  const policy = usePolicyCoverage();

  return (
    <div
      className="mc-kpi-row"
      style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12, marginBottom: 16 }}
    >
      <KpiCard
        data={mapIncidentsToKpi(incidents)}
        onClick={() => onNavigate("alertsIncidents", { filter: { status: ACTIVE_STATUS_FILTER, productionOnly: "true" }, fromMissionControl: true })}
      />
      <KpiCard
        data={mapEvidenceToKpi(evidence)}
        onClick={() => onNavigate("auditEvidence", { fromMissionControl: true })}
      />
      <KpiCard
        data={mapShieldToKpi(shield, range)}
        onClick={() => onNavigate("trafficMonitor", { fromMissionControl: true })}
      />
      <KpiCard
        data={mapCostToKpi(cost)}
        onClick={() => onNavigate("tokenCost", { fromMissionControl: true })}
      />
      <KpiCard
        data={mapCollectorToKpi(collector)}
        onClick={() => onNavigate("infrastructure", { fromMissionControl: true })}
      />
      <KpiCard
        data={mapPolicyToKpi(policy)}
        onClick={() => onNavigate("configuration", { focus: "policiesAndRules", fromMissionControl: true })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active Incidents (spec §5.1)
// ---------------------------------------------------------------------------

function mapIncidentsToKpi(r: ReturnType<typeof useActiveIncidents>): KpiData {
  if (r.state === "loading" || !r.data) return loadingKpi("activeIncidents", r.lastRefreshedAt, "alertsIncidents");
  if (r.state === "error") return errorKpi("activeIncidents", r.lastRefreshedAt, "alertsIncidents");
  const live = activeIncidentsLive(r.data, r.lastRefreshedAt);
  return r.state === "stale" ? { ...live, state: "stale" } : live;
}

function activeIncidentsLive(d: ActiveIncidentsData, lastRefreshedAt: number): KpiData {
  const total = d.total;
  return {
    id: "activeIncidents",
    state: total === 0 ? "empty" : "live",
    value: total,
    pill: total === 0 ? "ALL CLEAR" : `${d.open} OPEN`,
    pillAccent: total === 0 ? "green" : "danger",
    breakdown: [
      { label: "Open", value: String(d.open) },
      { label: "Acknowledged", value: String(d.acknowledged) },
      { label: "Investigating", value: String(d.investigating) },
    ],
    footer: `${d.critical}C  ${d.high}H  ${d.medium}M  ${d.low}L`,
    stack: total === 0 ? [] : [
      { ratio: d.critical / total, accent: "danger" },
      { ratio: d.high / total, accent: "warn" },
      { ratio: d.medium / total, accent: "cyan" },
      { ratio: d.low / total, accent: "purp" },
    ],
    lastRefreshedAt,
    clickTarget: { tab: "alertsIncidents", opts: { status: "open" } },
    timeBehavior: "point_in_time",
    refreshStrategy: "poll_30s",
  };
}

// ---------------------------------------------------------------------------
// Evidence Confidence (spec §5.2)
// ---------------------------------------------------------------------------

function mapEvidenceToKpi(r: ReturnType<typeof useEvidenceConfidence>): KpiData {
  if (r.state === "loading" || !r.data) return loadingKpi("evidenceConfidence", r.lastRefreshedAt, "auditEvidence");
  if (r.state === "error") return errorKpi("evidenceConfidence", r.lastRefreshedAt, "auditEvidence");
  const live = evidenceLive(r.data, r.lastRefreshedAt);
  return r.state === "stale" ? { ...live, state: "stale" } : live;
}

function evidenceLive(d: EvidenceConfidenceData, lastRefreshedAt: number): KpiData {
  const isEmpty = d.total === 0;
  return {
    id: "evidenceConfidence",
    state: isEmpty ? "empty" : "live",
    value: isEmpty ? "—" : d.percentage,
    unit: isEmpty ? undefined : "%",
    pill: isEmpty ? undefined : (d.percentage >= 80 ? "EXACT" : d.percentage >= 50 ? "MIXED" : "WEAK"),
    pillAccent: isEmpty ? undefined : (d.percentage >= 80 ? "green" : d.percentage >= 50 ? "warn" : "danger"),
    breakdown: [
      { label: "Exact match", value: String(d.exact), accent: "green" },
      { label: "Fallback (best)", value: String(d.fallback), accent: "warn" },
      { label: "Missing snippet", value: String(d.missingSnippet) },
    ],
    footer: "audit_event_id match · click to triage",
    lastRefreshedAt,
    clickTarget: { tab: "auditEvidence" },
    timeBehavior: "point_in_time",
    refreshStrategy: "poll_30s",
  };
}

// ---------------------------------------------------------------------------
// Shield Activity (spec §5.3)
// ---------------------------------------------------------------------------

function mapShieldToKpi(r: ReturnType<typeof useShieldActivity>, range: TimeRange): KpiData {
  if (r.state === "loading" || !r.data) return loadingKpi("shieldActivity", r.lastRefreshedAt, "trafficMonitor");
  if (r.state === "error") return errorKpi("shieldActivity", r.lastRefreshedAt, "trafficMonitor");
  const live = shieldLive(r.data, range, r.lastRefreshedAt);
  return r.state === "stale" ? { ...live, state: "stale" } : live;
}

function shieldLive(d: ShieldActivityData, range: TimeRange, lastRefreshedAt: number): KpiData {
  return {
    id: "shieldActivity",
    state: d.total === 0 ? "empty" : "live",
    value: d.total.toLocaleString(),
    pill: range.toUpperCase(),
    pillAccent: "cyan",
    breakdown: [
      { label: "Allow", value: String(d.allow), accent: "green" },
      { label: "Review", value: String(d.review), accent: "warn" },
      { label: "Block", value: String(d.block), accent: "danger" },
    ],
    footer: d.topFamily ? `top family: ${d.topFamily} (${d.topFamilyPct}%)` : undefined,
    stack: d.total === 0 ? [] : [
      { ratio: d.block / d.total, accent: "danger" },
      { ratio: d.review / d.total, accent: "warn" },
      { ratio: d.allow / d.total, accent: "green" },
    ],
    lastRefreshedAt,
    clickTarget: { tab: "trafficMonitor" },
    timeBehavior: "time_windowed",
    refreshStrategy: "poll_30s",
  };
}

// ---------------------------------------------------------------------------
// Cost Risk (spec §5.4) — REQUIRED-COPY: "Highest reported monitored spend"
// ---------------------------------------------------------------------------

function mapCostToKpi(r: ReturnType<typeof useCostRisk>): KpiData {
  if (r.state === "loading" || !r.data) return loadingKpi("costRisk", r.lastRefreshedAt, "tokenCost");
  if (r.state === "error") return errorKpi("costRisk", r.lastRefreshedAt, "tokenCost");
  const live = costLive(r.data, r.lastRefreshedAt);
  return r.state === "stale" ? { ...live, state: "stale" } : live;
}

function costLive(d: CostRiskData, lastRefreshedAt: number): KpiData {
  const sigCount = d.signals.length;
  // Sort sources descending by USD so the secondary row is the next-highest source
  // after the headline. Falls back gracefully if perSource is empty.
  const sortedSources = [...d.perSource].sort((a, b) => b.usd - a.usd);
  const secondary = sortedSources.find((s) => s.source !== d.headlineSource);
  const breakdown: KpiData["breakdown"] = [
    // Spec §16.1 required-copy: "Highest reported monitored spend" verbatim;
    // value is the headline dollar amount per spec §5.4 body layout.
    { label: "Highest reported monitored spend", value: `$${d.headlineUsd.toFixed(2)}`, accent: "cyan" },
  ];
  if (secondary) {
    breakdown.push({ label: secondary.source, value: `$${secondary.usd.toFixed(2)}`, accent: "cyan" });
  }
  // Spec §16.1 disclosure: source totals are reported side-by-side; never summed.
  breakdown.push({ label: "side-by-side, not summed", value: "" });
  return {
    id: "costRisk",
    state: "live",
    value: `$${d.headlineUsd.toFixed(2)}`,
    pill: sigCount > 0 ? `${sigCount} SIGNALS` : "OK",
    pillAccent: sigCount > 0 ? "warn" : "green",
    breakdown,
    footer: sigCount > 0 ? d.signals.map((s) => s.kind).slice(0, 3).join(" · ") : "all clear",
    lastRefreshedAt,
    clickTarget: { tab: "tokenCost" },
    timeBehavior: "time_windowed",
    refreshStrategy: "poll_5m",
  };
}

// ---------------------------------------------------------------------------
// Collector Health (spec §5.5)
// ---------------------------------------------------------------------------

function mapCollectorToKpi(r: ReturnType<typeof useCollectorHealth>): KpiData {
  if (r.state === "loading" || !r.data) return loadingKpi("collectorHealth", r.lastRefreshedAt, "infrastructure");
  if (r.state === "error") return errorKpi("collectorHealth", r.lastRefreshedAt, "infrastructure");
  const live = collectorLive(r.data, r.lastRefreshedAt);
  return r.state === "stale" ? { ...live, state: "stale" } : live;
}

/**
 * Strip a "(suffix)" from a collector name so the breakdown row label fits
 * inside the narrow KPI tile. "OpenClaw Gateway (WebSocket)" → "OpenClaw Gateway".
 *
 * operator-flagged 2026-05-07: the trailing "(WebSocket)" was being truncated to
 * "(W..." in the tile, which read as a UI bug rather than a real signal.
 * Stripping the paren suffix entirely leaves the meaningful service name.
 */
function stripParenSuffix(name: string): string {
  const i = name.indexOf("(");
  return i > 0 ? name.slice(0, i).trim() : name;
}

function isCollectorHealthy(c: CollectorHealthData["collectors"][number]): boolean {
  // When lastSeenMsAgo is 0 the route doesn't expose a fresh probe time;
  // fall back to the status string. Mirrors useCollectorHealth's own
  // healthy-count logic in data-hooks.ts.
  if (c.lastSeenMsAgo > 0) return c.lastSeenMsAgo <= c.staleThresholdMs;
  return c.status === "online";
}

/**
 * Dedupe collectors by their stripped name so two entries reporting on the
 * same logical service (e.g. multiple "OpenClaw Gateway" instances behind
 * different transports) only consume one breakdown row. For each group:
 *   - Prefer the first UNHEALTHY entry (so problems surface).
 *   - Fall back to the first entry if all are healthy.
 *
 * operator-flagged 2026-05-07.
 */
function dedupeCollectorsByService(
  collectors: CollectorHealthData["collectors"],
): CollectorHealthData["collectors"] {
  // Preserve insertion order — Map iterates in insertion order, which we want
  // so the breakdown's row order tracks the source-of-truth ordering.
  const groups: Record<string, CollectorHealthData["collectors"]> = {};
  const order: string[] = [];
  for (const c of collectors) {
    const key = stripParenSuffix(c.name);
    if (!(key in groups)) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(c);
  }
  const out: CollectorHealthData["collectors"] = [];
  for (const key of order) {
    const group = groups[key];
    const lead = group.find((c) => !isCollectorHealthy(c)) ?? group[0];
    out.push(lead);
  }
  return out;
}

function collectorLive(d: CollectorHealthData, lastRefreshedAt: number): KpiData {
  const stale = d.total - d.healthy;
  // Dedupe by service, then take first 3 to fit the KPI tile breakdown row.
  const breakdownSource = dedupeCollectorsByService(d.collectors).slice(0, 3);
  return {
    id: "collectorHealth",
    state: "live",
    value: `${d.healthy}`,
    unit: `/${d.total}`,
    pill: stale === 0 ? "LIVE" : stale <= 2 ? "DEGRADED" : "CRITICAL",
    pillAccent: stale === 0 ? "green" : stale <= 2 ? "warn" : "danger",
    breakdown: breakdownSource.map((c) => ({
      label: stripParenSuffix(c.name).replace(/-watcher|-adapter|-logger/, ""),
      value: isCollectorHealthy(c) ? "● ok" : `● stale ${formatLag(c.lastSeenMsAgo)}`,
      accent: (isCollectorHealthy(c) ? "green" : "warn") as KpiAccent,
    })),
    lastRefreshedAt,
    clickTarget: { tab: "infrastructure" },
    timeBehavior: "last_seen",
    refreshStrategy: "poll_30s",
  };
}

// ---------------------------------------------------------------------------
// Policy Coverage (spec §5.6)
// ---------------------------------------------------------------------------

function mapPolicyToKpi(r: ReturnType<typeof usePolicyCoverage>): KpiData {
  if (r.state === "loading" || !r.data) return loadingKpi("policyCoverage", r.lastRefreshedAt, "configuration");
  if (r.state === "error") return errorKpi("policyCoverage", r.lastRefreshedAt, "configuration");
  const live = policyLive(r.data, r.lastRefreshedAt);
  return r.state === "stale" ? { ...live, state: "stale" } : live;
}

function policyLive(d: PolicyCoverageData, lastRefreshedAt: number): KpiData {
  return {
    id: "policyCoverage",
    state: "live",
    value: `${d.coreRules}+${d.activeEgressStarter}`,
    // Spec §5.6 three-state pill: LAB (purple) when only lab drafts pending,
    // SAFE (cyan) when no unsafe regex, WARN (amber) otherwise.
    pill: d.unsafeRegexCount > 0
      ? "WARN"
      : d.labHeldDrafts > 0
        ? "LAB"
        : "SAFE",
    pillAccent: d.unsafeRegexCount > 0
      ? "warn"
      : d.labHeldDrafts > 0
        ? "purp"
        : "cyan",
    breakdown: [
      { label: "Core Shield rules", value: String(d.coreRules) },
      { label: "Active egress starter", value: String(d.activeEgressStarter) },
      { label: "Lab held drafts", value: String(d.labHeldDrafts), accent: "warn" },
    ],
    footer: `${d.labHeldDrafts} lab drafts held · ${d.unsafeRegexCount} unsafe regex`,
    lastRefreshedAt,
    clickTarget: { tab: "configuration", opts: { focus: "policiesAndRules" } },
    timeBehavior: "point_in_time",
    refreshStrategy: "static",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function loadingKpi(id: KpiData["id"], at: number, tab: TabId): KpiData {
  return { id, state: "loading", value: "—", breakdown: [], lastRefreshedAt: at, clickTarget: { tab }, timeBehavior: "point_in_time", refreshStrategy: "poll_30s" };
}

export function errorKpi(id: KpiData["id"], at: number, tab: TabId): KpiData {
  return { id, state: "error", value: "—", breakdown: [], lastRefreshedAt: at, clickTarget: { tab }, timeBehavior: "point_in_time", refreshStrategy: "poll_30s" };
}

function formatLag(ms: number): string {
  const SECOND = 1000, MINUTE = 60_000, HOUR = 3600_000;
  if (ms < MINUTE) return `${Math.round(ms / SECOND)}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  return `${Math.round(ms / HOUR)}h`;
}
