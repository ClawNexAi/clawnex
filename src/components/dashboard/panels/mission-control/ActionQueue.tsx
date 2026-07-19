"use client";

/**
 * Action Queue — full-width prioritized table of actionable items.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md §7
 *
 * Three row sources composed in priority order:
 *   1. Active alert rows   — from useActiveAlerts() (poll_30s)
 *   2. Cost signal rows    — from useCostRisk().data?.signals
 *   3. Stale collector rows — collectors where lastSeenMsAgo > staleThresholdMs
 *
 * Ranking: priority_score = severityWeight + ageBonus + evidenceBonus (§7.2).
 * Table is sorted DESC by priorityScore; default page size 5 (operator preference
 * 2026-05-07: 5 fits on a 720px viewport without scroll, 8 was crowding the
 * header).
 *
 * Severity color choice (§7.1):
 *   CRIT  → C.danger (red)      ← spec "red"
 *   HIGH  → C.orange            ← spec "orange"; C.orange (#fb923c)
 *   MED   → C.warn (amber)      ← spec §7.1 explicit "amber"; prior impl used
 *                                  C.cyan which is reserved for safe/info semantics
 *                                  (24H shield, SAFE policy pills) — incorrect for
 *                                  a threat-severity tier. Corrected to C.warn.
 *   WARN  → C.txS               ← spec "amber dim"; using C.txS (text-secondary,
 *                                  muted grey-blue) rather than a dimmed C.warn
 *                                  because both MED and WARN share the amber hex
 *                                  base — dimming produces bg: warn18 for both,
 *                                  making them visually identical. Different hue
 *                                  families give clear visual separation while
 *                                  honoring the spec's "dim" intent.
 *   LOW   → C.txT               ← spec "text-tertiary"
 *
 * Evidence pill colors (spec §7.1):
 *   exact    → green (C.green)
 *   fallback → amber (C.warn)
 *   signal   → blue  (C.info)
 *   health   → purple (C.purp)
 */

import { useState, Fragment } from "react";
import { C, F } from "../../constants";
import { PaginationFooter } from "../../shared";
import {
  useActiveAlerts,
  useCostRisk,
  useCollectorHealth,
  useTrustAuditFindings,
  useCveData,
  useAuthScan,
  useShieldRuleSummary,
  useInstalledVersions,
  type TrustAuditFinding,
} from "./data-hooks";
import {
  cveToRows,
  authRbacScan,
  blastRadiusFromAlerts,
  policyWarningScan,
  correlationDetect,
} from "./phase6-producers";
import { computeActionPriority, explainActionPriority } from "./scoring";
import { Tooltip } from "../../tooltip";
import type { ActionRow, EvidenceConfidence, Severity, TimeRange, IncidentFamily, SuggestedAction } from "./types";
import { formatSuggestedAction } from "./types";
import type { TabId } from "../../types";
import type { NavigateOpts } from "../../url-state";
import { TriageGraphCard } from "../../triage/TriageGraphCard";
import { resolveActionRowTriageGraph } from "../../triage/action-row-resolver";
import { resolveTrustAuditTriageGraph } from "../../triage/trust-audit-resolver";
import { resolveCostSignalTriageGraph } from "../../triage/cost-signal-resolver";
import { resolveCollectorHealthTriageGraph, type CollectorRecord } from "../../triage/collector-health-resolver";
import { resolveCorrelationTriageGraph, type CorrelationFinding } from "../../triage/correlation-resolver";
import { resolveBlastRadiusTriageGraph, type BlastRadiusFinding } from "../../triage/blast-radius-resolver";
import { resolveAuthRbacTriageGraph, type AuthRbacFinding } from "../../triage/auth-rbac-resolver";
import { resolveUpdateCveTriageGraph, type UpdateCveFinding } from "../../triage/update-cve-resolver";
import { resolvePolicyWarningTriageGraph, type PolicyWarningFinding } from "../../triage/policy-warning-resolver";
import type { Signal as CostSignal } from "../../../../lib/types/cost-reporting";
import { groupActionRows, compareActionGroups, type ActionGroup } from "./action-queue-grouping";
import { ACTION_QUEUE_DEMO, type ActionQueueDemoItem } from "./demo-fixtures";

// ---------------------------------------------------------------------------
// Operator type + permission helper
// ---------------------------------------------------------------------------

/**
 * Operator identity shape — mirrors the RBAC client object in index.tsx.
 * Only `role` is used here; username / displayName are not needed for
 * permission checks.
 */
export interface Operator {
  username: string;
  role: string;
  displayName?: string;
}

/**
 * hasPerm — maps the operator's role to its granted permissions using the
 * same matrix as src/lib/rbac/permissions.ts (client-side read-only copy;
 * authoritative enforcement is always server-side).
 *
 * Returns true when:
 *  - operator is undefined (RBAC off / not yet loaded → default-allow)
 *  - operator.role matches a role that includes `perm`
 *
 * Returns false only when an operator is present AND their role lacks `perm`.
 * This matches the RBAC-Off Defense Pattern used across mutation endpoints.
 */
const ROLE_PERMS: Record<string, ReadonlySet<string>> = {
  admin: new Set([
    "dashboard:view", "audit:read", "tokens:read", "infrastructure:read",
    "alerts:read", "policies:read",
  ]),
  security_manager: new Set([
    "dashboard:view", "audit:read", "tokens:read",
    "alerts:read", "policies:read",
  ]),
  operator: new Set([
    "dashboard:view", "audit:read", "tokens:read",
    "alerts:read", "policies:read",
  ]),
  viewer: new Set([
    "dashboard:view", "alerts:read", "tokens:read", "policies:read",
  ]),
  auditor: new Set([
    "dashboard:view", "audit:read", "tokens:read",
  ]),
};

function hasPerm(op: Operator | undefined, perm: string): boolean {
  // No operator threaded → RBAC off or not yet loaded → allow (existing pattern).
  if (!op) return true;
  return (ROLE_PERMS[op.role] ?? new Set()).has(perm);
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface Props {
  demoMode: boolean;
  range: TimeRange;
  onNavigate: (tab: TabId, focusOrOpts?: NavigateOpts) => void;
  /** Operator identity from the dashboard RBAC context. Optional: when absent
   *  (RBAC off / not yet loaded) all rows are unrestricted (default-allow). */
  operator?: Operator;
}

// ---------------------------------------------------------------------------
// ActionQueue component
// ---------------------------------------------------------------------------

export function ActionQueue({ demoMode, range, onNavigate, operator }: Props) {
  const alerts = useActiveAlerts();
  const cost = useCostRisk(range);
  const collector = useCollectorHealth();
  // 4th source: trust-audit findings (spec §7 variant A). Polled every 5m
  // because the trust-audit engine caches results and re-runs are expensive.
  const trustAudit = useTrustAuditFindings();
  // Phase 6 producers — supplemental sources for the 5 dispatch-ready
  // families. Each fetcher tolerates 404/403 and degrades to empty so the
  // queue keeps rendering existing rows when one source is unavailable.
  const cveData = useCveData();
  const authScan = useAuthScan();
  const shieldRules = useShieldRuleSummary();
  // v1.1 polish 2026-05-08: installed-version surface for the update-cve
  // producer. Static (one-shot) — install version doesn't change at runtime.
  // Best-effort: degrades to { clawnex: null, openclaw: null } when the
  // route is unreachable (older instance, auth failure) — producer falls
  // back to package-only copy without the "→ fixedVersion" arrow on the
  // current side.
  const installedVersions = useInstalledVersions();

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(5);
  // Tracks which row (by id) currently has its triage graph expanded inline.
  // Only one row can be expanded at a time; toggling the same row collapses it.
  const [investigatingRowId, setInvestigatingRowId] = useState<string | null>(null);
  // Tracks which rows have their suggested-action text expanded past the
  // 3-line clamp. Set of row IDs; toggling adds/removes. Long trust-audit
  // suggestions get truncated by default to keep table density consistent;
  // operator clicks "more ▾" to see the full text.
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());
  // vNext §8: Group/Raw view toggle. Grouped collapses repeat-action pressure
  // (3 rows for the same Exec+Write combo across different agents → 1 row
  // with a "×3" count chip). Raw shows every row individually.
  // Default: grouped — the operator-decision-router framing per the reviewer's spec.
  // Persisted per browser session so toggling sticks while triaging.
  const [viewMode, setViewMode] = useState<"grouped" | "raw">(() => {
    if (typeof window === "undefined") return "grouped";
    try {
      const v = window.sessionStorage.getItem("clawnex.actionQueue.viewMode");
      return v === "raw" ? "raw" : "grouped";
    } catch {
      return "grouped";
    }
  });
  function toggleViewMode() {
    setViewMode((prev) => {
      const next = prev === "grouped" ? "raw" : "grouped";
      try {
        window.sessionStorage.setItem("clawnex.actionQueue.viewMode", next);
      } catch { /* ignore */ }
      // Reset pagination when the mode changes — page indices don't carry
      // meaning across modes (grouped page 0 ≠ raw page 0).
      setPage(0);
      return next;
    });
  }

  // vNext §10 (filter MVP): two filter dimensions at launch — severity and
  // source family. Empty Set = no filter on that dimension. State persists
  // per browser session so triaging can resume after a reload.
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.sessionStorage.getItem("clawnex.actionQueue.sevFilter");
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return new Set();
      const out = new Set<Severity>();
      const allowed: Severity[] = ["CRIT", "HIGH", "MED", "WARN", "LOW"];
      for (const v of arr) {
        if (typeof v === "string" && (allowed as readonly string[]).includes(v)) {
          out.add(v as Severity);
        }
      }
      return out;
    } catch {
      return new Set();
    }
  });
  const [familyFilter, setFamilyFilter] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.sessionStorage.getItem("clawnex.actionQueue.familyFilter");
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return new Set();
      const out = new Set<string>();
      for (const v of arr) if (typeof v === "string") out.add(v);
      return out;
    } catch {
      return new Set();
    }
  });
  function persistSet(key: string, s: Set<string>) {
    try {
      const arr: string[] = [];
      s.forEach((v) => arr.push(v));
      window.sessionStorage.setItem(key, JSON.stringify(arr));
    } catch { /* ignore */ }
  }
  function toggleSev(sev: Severity) {
    setSevFilter((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev); else next.add(sev);
      persistSet("clawnex.actionQueue.sevFilter", next as unknown as Set<string>);
      setPage(0);
      return next;
    });
  }
  function toggleFamily(fam: string) {
    setFamilyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(fam)) next.delete(fam); else next.add(fam);
      persistSet("clawnex.actionQueue.familyFilter", next);
      setPage(0);
      return next;
    });
  }
  function clearFilters() {
    setSevFilter(new Set());
    setFamilyFilter(new Set());
    persistSet("clawnex.actionQueue.sevFilter", new Set());
    persistSet("clawnex.actionQueue.familyFilter", new Set());
    setPage(0);
  }

  // vNext §10 suppression (v1, scoped + reversible). Operator can hide all
  // rows of a specific incidentType — e.g. an operator who's accepted-risk
  // on the "loop_risk" detector for a known dev-loop agent suppresses just
  // that incident type without losing visibility of other cost signals.
  //
  // Scope: per-incidentType. Family-level or rule-level suppression is a
  // future enhancement; per-incidentType is the smallest useful unit.
  // Storage: sessionStorage (per browser session). DB-backed audit + TTL
  // is queued for v1.1.
  // Audit: header pill always shows "N suppressed" when any are active —
  // the operator never loses sight of what they've hidden. Click → popup
  // lists each suppressed type with an × to unsuppress.
  const [suppressedTypes, setSuppressedTypes] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.sessionStorage.getItem("clawnex.actionQueue.suppressedTypes");
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return new Set();
      const out = new Set<string>();
      for (const v of arr) if (typeof v === "string") out.add(v);
      return out;
    } catch {
      return new Set();
    }
  });
  const [suppressPopupOpen, setSuppressPopupOpen] = useState(false);

  // -------------------------------------------------------------------------
  // B4 (2026-05-16) — Demo render skeleton.
  //
  // operator-approved 2026-05-16: when demoMode is on, ActionQueue renders a
  // simplified card-list from ACTION_QUEUE_DEMO instead of running the live
  // priority-pipeline + grouping + filtering machinery against (probably-
  // empty) hook data. Lower risk than wiring 6-8 synthetic rows through the
  // full triage pipeline; still satisfies the reviewer's "MC must not show all-clear
  // when downstream tabs are demo-active" requirement.
  //
  // All hooks above this point have fired unconditionally — Rules of Hooks
  // intact. The branch is placed after the LAST useState (suppressPopupOpen)
  // so adding new hooks later won't accidentally break this.
  // -------------------------------------------------------------------------
  if (demoMode) {
    return (
      <DemoActionQueueSkeleton items={ACTION_QUEUE_DEMO} onNavigate={onNavigate} />
    );
  }

  function suppressType(incidentType: string) {
    setSuppressedTypes((prev) => {
      const next = new Set(prev);
      next.add(incidentType);
      persistSet("clawnex.actionQueue.suppressedTypes", next);
      setPage(0);
      return next;
    });
  }
  function unsuppressType(incidentType: string) {
    setSuppressedTypes((prev) => {
      const next = new Set(prev);
      next.delete(incidentType);
      persistSet("clawnex.actionQueue.suppressedTypes", next);
      setPage(0);
      return next;
    });
  }

  function toggleActionExpand(rowId: string) {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  // Compose rows from the four currently-emitting sources (alerts, cost
  // signals, stale collectors, trust-audit findings), sort by priority_score
  // DESC. Per-source triage resolvers exist for nine kinds total — the extra
  // five (correlation, blast-radius, auth-rbac, update-cve, policy-warning)
  // are dispatch-ready but await upstream row producers.
  // Pass operator into each mapper so the restricted flag can be set based
  // on whether the operator has the destination tab's required permission.
  const rawRows: ActionRow[] = [
    ...(alerts.data ?? []).map((a) => alertToRow(a, operator)),
    ...(cost.data?.signals ?? []).map((s, i) => signalToRow(s, i, operator)),
    ...(collector.data?.collectors ?? [])
      .filter((c) => c.lastSeenMsAgo != null && c.lastSeenMsAgo > c.staleThresholdMs)
      .map((c) => staleCollectorToRow({ ...c, lastSeenMsAgo: c.lastSeenMsAgo! }, operator)),
    ...(trustAudit.data ?? []).map((f) => trustAuditToRow(f, operator)),
    // Phase 6 producers — five upstream sources for dispatch-ready families.
    // Each emits ActionRows whose rawSource.kind matches a Phase 5 resolver,
    // so clicking "Investigate" walks the correct family-specific resolver.
    // v1.1 polish 2026-05-08: pass installedVersions + degraded state
    // through. cveToRows uses installedVersions to populate the real
    // current_version when packageName matches a known component;
    // degraded triggers a single-banner emit when the source is down.
    ...cveToRows(
      cveData.data?.cves ?? [],
      installedVersions.data,
      cveData.data?.degraded,
      operator,
    ),
    ...authRbacScan(authScan.data, operator),
    ...blastRadiusFromAlerts(alerts.data ?? [], operator),
    ...policyWarningScan(
      shieldRules.data?.rules ?? null,
      shieldRules.data?.degraded,
      operator,
    ),
    ...correlationDetect(
      alerts.data ?? [],
      cost.data?.signals ?? [],
      trustAudit.data ?? [],
      operator,
    ),
  ].sort((a, b) => {
    // vNext §7.1 deterministic tie-breakers — never rely on polling/insertion
    // order to determine queue rank, otherwise rows jitter across renders.
    //   1. priorityScore DESC
    if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
    //   2. severity weight DESC
    const sevRank = { CRIT: 5, HIGH: 4, MED: 3, WARN: 2, LOW: 1 } as const;
    if (sevRank[a.severity] !== sevRank[b.severity]) {
      return sevRank[b.severity] - sevRank[a.severity];
    }
    //   3. evidence confidence rank DESC
    const evRank: Record<string, number> = { exact: 5, audit: 4, fallback: 3, signal: 2, health: 1 };
    const evDelta = (evRank[b.evidence.kind] ?? 0) - (evRank[a.evidence.kind] ?? 0);
    if (evDelta !== 0) return evDelta;
    //   4. age (newer first)
    if (a.ageMs !== b.ageMs) return a.ageMs - b.ageMs;
    //   5. stable row id ASC (final deterministic resort)
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // vNext §10: apply suppression FIRST (highest precedence — operator
  // explicitly hid this), then filters, then grouping. Suppressed rows
  // never appear in any view regardless of severity/family selection.
  const nonSuppressed: ActionRow[] = rawRows.filter((r) => {
    return !suppressedTypes.has(r.incidentType ?? "");
  });
  const suppressedCount = rawRows.length - nonSuppressed.length;

  // Filters apply BEFORE grouping so a filter that hides a CRIT member
  // doesn't accidentally bring it back as the lead of a group whose
  // surviving members are all WARN. Empty filter set = no filter on that
  // dimension. Filters are AND-combined across dimensions, OR-combined
  // within a dimension (i.e. multi-select within Severity is "any of these").
  const rows: ActionRow[] = nonSuppressed.filter((r) => {
    if (sevFilter.size > 0 && !sevFilter.has(r.severity)) return false;
    if (familyFilter.size > 0 && !familyFilter.has(r.family ?? "")) return false;
    return true;
  });
  const filterActive = sevFilter.size > 0 || familyFilter.size > 0;

  // Pre-compute groups once. Used in both render paths:
  //   - Grouped mode: pagination + display walks groups directly.
  //   - Raw mode: footer still shows "M raw → N grouped" so the operator
  //     can see the dedup effect even without toggling.
  const groups: ActionGroup[] = groupActionRows(rows).sort(compareActionGroups);

  // DisplayItem: a row carrying optional group-aggregate context. Lets the
  // existing row-render block stay row-shaped while picking up the count
  // chip + age range when the source is a clustered group.
  interface DisplayItem {
    row: ActionRow;
    count: number;
    maxSeverity?: ActionRow["severity"];
    newestAgeMs?: number;
    oldestAgeMs?: number;
  }

  const displayItems: DisplayItem[] = viewMode === "grouped"
    ? groups.map((g) => ({
        row: g.lead,
        count: g.count,
        maxSeverity: g.maxSeverity,
        newestAgeMs: g.newestAgeMs,
        oldestAgeMs: g.oldestAgeMs,
      }))
    : rows.map((r) => ({ row: r, count: 1 }));

  const totalItems = displayItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  // Clamp page to valid range when rows shrink between polls.
  const safePage = Math.min(page, totalPages - 1);
  const visibleItems = displayItems.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // Show a stale banner when the primary alert source is degraded but we
  // still have prior data to display. Error state (no prior data) shows
  // an inline notice instead.
  const alertState = alerts.state;

  // vNext §12.3 — per-source stale + error markers, named by family. One
  // source failing should not blank healthy rows from other families. The
  // existing alerts-only banner is preserved at the top of the queue; this
  // adds one banner per non-healthy non-alert family below it so the
  // operator sees ALL the sources that are degraded, not just alerts.
  const sourceStates: Array<{ family: IncidentFamily; label: string; state: string }> = [
    { family: "cost-signal",    label: "Cost signals",     state: cost.state },
    { family: "infrastructure", label: "Collector health", state: collector.state },
    { family: "trust-audit",    label: "Trust Audit",      state: trustAudit.state },
  ];

  return (
    <div className="mc-panel-surface mc-action-queue" style={{
      background: C.glassChrome,
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      border: `1px solid ${C.glassBorderSubtle}`,
      borderRadius: 18,
      boxShadow: C.glassShadow,
      padding: 16,
      marginBottom: 16,
    }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          fontSize: 11,
          color: C.txT,
          textTransform: "uppercase",
          fontWeight: 700,
          letterSpacing: "0.08em",
          flex: 1,
        }}>
          Top Action Queue
        </div>
        {/* Stale-marker contract (spec §10.1 / vNext §12.3) — surface degraded
            state inline per source family. Each family shows independently so
            one degraded source doesn't mask another. */}
        {alertState === "stale" && (
          <div style={{ fontSize: 10, color: C.warn, fontFamily: F.mono }} title="Alert poll returned stale data — showing last known rows">
            ⚠ Alerts stale
          </div>
        )}
        {alertState === "error" && rows.length === 0 && (
          <div style={{ fontSize: 10, color: C.danger, fontFamily: F.mono }}>
            Alerts unavailable
          </div>
        )}
        {sourceStates.filter((s) => s.state === "stale" || s.state === "error").map((s) => (
          <div
            key={s.family}
            style={{
              fontSize: 10,
              color: s.state === "error" ? C.danger : C.warn,
              fontFamily: F.mono,
            }}
            title={s.state === "error"
              ? `${s.label} source failed — rows from this family may be missing`
              : `${s.label} source returned stale data — rows from this family may be old`
            }
          >
            ⚠ {s.label} {s.state}
          </div>
        ))}
        {/* vNext §8 Group/Raw toggle. Single button, two states. Sits next to
            the item-count chip so the operator can immediately see whether
            grouping is hiding rows or showing them all. */}
        {rows.length > 0 && (
          <button
            type="button"
            onClick={toggleViewMode}
            aria-pressed={viewMode === "grouped"}
            title={
              viewMode === "grouped"
                ? `Currently grouping repeated incidents (${rows.length} raw → ${groups.length} grouped). Click to switch to raw view.`
                : `Currently showing every row. Click to group repeats (${rows.length} raw → ${groups.length} grouped).`
            }
            style={{
              padding: "3px 9px",
              borderRadius: 999,
              fontSize: 10,
              fontFamily: F.mono,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: viewMode === "grouped" ? C.cyan : C.txS,
              background: viewMode === "grouped"
                ? `${C.cyan}18`
                : C.glassSurfTrans,
              border: `1px solid ${viewMode === "grouped" ? C.cyan : C.glassSurfBorder}55`,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {viewMode === "grouped" ? "Grouped" : "Raw"}
          </button>
        )}
        {rows.length > 0 && (
          <div style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>
            {viewMode === "grouped"
              ? `${groups.length} grouped · ${rows.length} raw${filterActive ? ` of ${rawRows.length}` : ""}`
              : `${rows.length}${filterActive ? ` of ${rawRows.length}` : ""} item${rows.length !== 1 ? "s" : ""}`}
          </div>
        )}
        {/* vNext §10 suppression audit pill — always visible when any types
            are suppressed. Click to expand a small popup listing each
            suppressed type with × to unsuppress. Operator never loses sight
            of what they've hidden. */}
        {suppressedTypes.size > 0 && (
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setSuppressPopupOpen((v) => !v)}
              aria-expanded={suppressPopupOpen}
              title={`${suppressedTypes.size} incident type${suppressedTypes.size === 1 ? "" : "s"} suppressed${suppressedCount > 0 ? ` (${suppressedCount} row${suppressedCount === 1 ? "" : "s"} hidden)` : ""}. Click to manage.`}
              style={{
                padding: "3px 9px",
                borderRadius: 999,
                fontSize: 10,
                fontFamily: F.mono,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: C.purp,
                background: `${C.purp}18`,
                border: `1px solid ${C.purp}55`,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              ⊘ {suppressedTypes.size} suppressed
            </button>
            {suppressPopupOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  zIndex: 10,
                  minWidth: 240,
                  maxWidth: 360,
                  padding: 10,
                  background: `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`,
                  backdropFilter: "blur(18px)",
                  WebkitBackdropFilter: "blur(18px)",
                  border: `1px solid ${C.glassBorderCyan}`,
                  borderRadius: 10,
                  boxShadow: C.glassCardShadow,
                  fontFamily: F.mono,
                  fontSize: 11,
                }}
              >
                <div style={{ color: C.txS, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 6 }}>
                  Suppressed incident types
                </div>
                {Array.from(suppressedTypes).sort().map((t) => (
                  <div key={t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
                    <span style={{ color: C.txS, wordBreak: "break-word", flex: 1, minWidth: 0 }}>{t}</span>
                    <button
                      type="button"
                      onClick={() => unsuppressType(t)}
                      aria-label={`Unsuppress ${t}`}
                      title="Click to unsuppress this incident type"
                      style={{
                        padding: "2px 7px",
                        borderRadius: 6,
                        fontSize: 9,
                        fontFamily: F.mono,
                        fontWeight: 700,
                        color: C.cyan,
                        background: "transparent",
                        border: `1px solid ${C.cyan}55`,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Unsuppress
                    </button>
                  </div>
                ))}
                <div style={{ marginTop: 6, fontSize: 9, color: C.txT, fontStyle: "italic" }}>
                  Suppressions are per browser session. Tab close clears them.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* vNext §10 filter row — severity + family chips. Click a chip to
          toggle. Default state empty = no filter. Active filters render with
          accent color + tinted background; inactive are dim outlines. */}
      {rawRows.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap", fontSize: 10, fontFamily: F.mono }}>
          <span style={{ color: C.txT, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
            Filter:
          </span>
          {(["CRIT", "HIGH", "MED", "WARN", "LOW"] as const).map((sev) => {
            const active = sevFilter.has(sev);
            const accent = severityAccent(sev);
            return (
              <button
                key={sev}
                type="button"
                onClick={() => toggleSev(sev)}
                aria-pressed={active}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 9,
                  fontFamily: F.mono,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: active ? accent : C.txT,
                  background: active ? `${accent}22` : "transparent",
                  border: `1px solid ${active ? `${accent}88` : C.glassSurfBorder}`,
                  cursor: "pointer",
                }}
              >
                {sev}
              </button>
            );
          })}
          <span style={{ color: C.glassSurfBorder, padding: "0 4px" }}>·</span>
          {([
            { id: "alert",          label: "Alert" },
            { id: "cost-signal",    label: "Cost" },
            { id: "infrastructure", label: "Infra" },
            { id: "trust-audit",    label: "Trust" },
          ] as const).map(({ id, label }) => {
            const active = familyFilter.has(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleFamily(id)}
                aria-pressed={active}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 9,
                  fontFamily: F.mono,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: active ? C.cyan : C.txT,
                  background: active ? `${C.cyan}22` : "transparent",
                  border: `1px solid ${active ? `${C.cyan}88` : C.glassSurfBorder}`,
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                {label}
              </button>
            );
          })}
          {filterActive && (
            <button
              type="button"
              onClick={clearFilters}
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 9,
                fontFamily: F.mono,
                fontWeight: 600,
                color: C.txS,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                textDecorationStyle: "dotted",
              }}
            >
              clear
            </button>
          )}
        </div>
      )}

      {rows.length === 0 && alertState !== "loading" ? (
        // Empty queue — positive signal.
        <div style={{ padding: "20px 8px", textAlign: "center", color: C.txT, fontSize: 11, fontFamily: F.mono }}>
          {alertState === "error"
            ? "Unable to load alert queue. Check API connectivity."
            : "No active action items — queue is clear."}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "20px 8px", textAlign: "center", color: C.txT, fontSize: 11, fontFamily: F.mono }}>
          Loading action queue…
        </div>
      ) : (
        <>
          {/* Column header row */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "60px 1fr 130px 170px 55px 200px 140px",
            gap: 8,
            padding: "0 8px 8px",
            fontSize: 9,
            color: C.txT,
            textTransform: "uppercase",
            fontWeight: 700,
            letterSpacing: "0.05em",
            borderBottom: `1px solid ${C.glassBorderSubtle}`,
          }}>
            <span>Sev</span>
            <span>Incident</span>
            <span>Source</span>
            <span>Evidence</span>
            <span>Age</span>
            <span>Suggested Action</span>
            <span>{/* button column spacer */}</span>
          </div>

          {/* Data rows — each row is wrapped in a Fragment so the inline triage
              card can be rendered as a sibling without breaking the grid. The
              key lives on the Fragment so React keying still works correctly.
              vNext §8: visibleItems carries optional group-aggregate context
              (count chip + age range) when the source row is a clustered
              group's lead member. */}
          {visibleItems.map((displayItem) => {
            const row = displayItem.row;
            const isCluster = displayItem.count > 1;
            // vNext §7.2: hover the severity pill → see the score's component
            // breakdown. Same weights computeActionPriority uses; no UI-only
            // formula. operator flagged 2026-05-07 that the prior native title=""
            // tooltip was invisible (~700ms browser delay + default styling).
            // Switched to the custom <Tooltip> component (cyan glass card,
            // 250ms delay, respects tooltips_enabled flag).
            const rationale = explainActionPriority({
              severity: row.severity,
              ageMs: row.ageMs,
              evidenceKind: row.evidence.kind,
            });
            return (
            <Fragment key={row.id}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 1fr 130px 170px 55px 200px 140px",
                  gap: 8,
                  padding: "10px 8px",
                  borderBottom: investigatingRowId === row.id
                    ? "none"
                    : `1px solid ${C.glassBorderSubtle}`,
                  fontSize: 11,
                  alignItems: "center",
                }}
              >
                {/* Sev — when clustered, render the GROUP's max severity so a
                    CRIT member doesn't get hidden behind a HIGH lead. Wrapped
                    in custom Tooltip so hovering shows the score rationale
                    (vNext §7.2). The pill itself shows a dotted-underline
                    affordance to indicate it's hoverable. */}
                <Tooltip placement="top" variant="detail" content={rationale} delay={250}>
                  <span style={{ display: "inline-block", cursor: "help" }}>
                    <SeverityPill sev={displayItem.maxSeverity ?? row.severity} />
                  </span>
                </Tooltip>

                {/* Incident — title + optional count chip when this is a
                    clustered group. Chip uses cyan accent and an explicit
                    "×N" so the operator sees the dedup count without hover. */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <div style={{ color: C.tx, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                    {row.title}
                  </div>
                  {isCluster && (
                    <span
                      title={`${displayItem.count} similar incidents grouped together`}
                      style={{
                        flexShrink: 0,
                        padding: "1px 7px",
                        borderRadius: 999,
                        background: `${C.cyan}22`,
                        border: `1px solid ${C.cyan}55`,
                        color: C.cyan,
                        fontFamily: F.mono,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                      }}
                    >
                      ×{displayItem.count}
                    </span>
                  )}
                </div>

                {/* Source */}
                <div style={{ color: C.txS, fontFamily: F.mono, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.source}
                </div>

                {/* Evidence */}
                <EvidencePill evidence={row.evidence} />

                {/* Age — when clustered, show the freshness range
                    (newest-oldest) so the operator can see if the cluster is
                    a recent burst or a long-running drift. Uses the group's
                    newestAgeMs as the headline (tightest signal of "right
                    now"). Singletons render the row's own ageMs as before. */}
                <div style={{ color: C.txS, fontFamily: F.mono, fontSize: 10, whiteSpace: "nowrap" }}>
                  {isCluster && displayItem.newestAgeMs != null && displayItem.oldestAgeMs != null && displayItem.newestAgeMs !== displayItem.oldestAgeMs
                    ? `${formatAge(displayItem.newestAgeMs)}–${formatAge(displayItem.oldestAgeMs)}`
                    : formatAge(displayItem.newestAgeMs ?? row.ageMs)}
                </div>

                {/* Suggested Action — 3-line clamp by default with an explicit
                    "more ▾ / less ▴" toggle when the text is long enough that
                    truncation is plausible. Trust-audit suggestions can run
                    long; the clamp keeps row height predictable. The threshold
                    (~110 chars) avoids showing a useless toggle on short
                    alert-derived suggestions like Contain-agent · short-source. */}
                <div style={{ color: C.txS, fontSize: 10, minWidth: 0 }}>
                  <div
                    style={
                      expandedActions.has(row.id)
                        ? { lineHeight: 1.4 }
                        : {
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            lineHeight: 1.4,
                          }
                    }
                  >
                    {formatSuggestedAction(row.suggestedAction)}
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 2 }}>
                    {formatSuggestedAction(row.suggestedAction).length > 110 && (
                      <button
                        type="button"
                        onClick={() => toggleActionExpand(row.id)}
                        aria-expanded={expandedActions.has(row.id)}
                        aria-label={expandedActions.has(row.id) ? "Collapse suggested action" : "Expand suggested action"}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "2px 0 0 0",
                          color: C.cyan,
                          fontSize: 10,
                          fontFamily: F.mono,
                          fontWeight: 600,
                          letterSpacing: "0.04em",
                          cursor: "pointer",
                          textTransform: "uppercase",
                        }}
                      >
                        {expandedActions.has(row.id) ? "less ▴" : "more ▾"}
                      </button>
                    )}
                    {/* Per-row suppress affordance — only when the row has an
                        incidentType (which all new rows do). Adds the row's
                        type to the session-scoped suppression set; operator
                        manages via the header pill. */}
                    {row.incidentType && (
                      <button
                        type="button"
                        onClick={() => suppressType(row.incidentType!)}
                        aria-label={`Suppress incident type ${row.incidentType}`}
                        title={`Suppress all "${row.incidentType}" rows for this session. Manage via the suppression pill in the queue header.`}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "2px 0 0 0",
                          color: C.txT,
                          fontSize: 10,
                          fontFamily: F.mono,
                          fontWeight: 600,
                          letterSpacing: "0.04em",
                          cursor: "pointer",
                          textTransform: "uppercase",
                          textDecoration: "underline",
                          textDecorationStyle: "dotted",
                        }}
                      >
                        ⊘ suppress
                      </button>
                    )}
                  </div>
                </div>

                {/* Action button. Spec §12.4: when the operator lacks the
                    permission required to drill into the destination, render a
                    disabled "Restricted" pill instead of the live button. The
                    ActionRow.restricted boolean is the gate. RBAC propagation
                    into the mapper is wired in a follow-up — for now the
                    mappers set restricted=false unconditionally, so this
                    branch is exercised only when a future caller flags an
                    individual row. Rendering path lives here so the wire-up
                    is a one-line change in the mapper.

                    Non-restricted rows: clicking toggles the inline triage
                    graph card (T11). Clicking an already-open row collapses it;
                    opening any row implicitly collapses any other (single-expand
                    invariant maintained by replacing investigatingRowId). */}
                {row.restricted ? (
                  <span
                    title={`Requires elevated permission to drill into ${row.clickTarget.tab}`}
                    aria-label={`Restricted: ${row.title}`}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 4,
                      border: `1px solid ${C.glassSurfBorder}`,
                      background: C.glassSurfTrans,
                      color: C.txT,
                      fontFamily: F.mono,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      cursor: "not-allowed",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Restricted
                  </span>
                ) : (
                  <button
                    aria-label={`Investigate ${row.title}`}
                    aria-pressed={investigatingRowId === row.id}
                    aria-expanded={investigatingRowId === row.id}
                    onClick={() => setInvestigatingRowId(
                      (current) => current === row.id ? null : row.id,
                    )}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setInvestigatingRowId(
                          (current) => current === row.id ? null : row.id,
                        );
                      }
                    }}
                    style={{
                      padding: "7px 9px",
                      borderRadius: 10,
                      border: 0,
                      background: `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`,
                      color: "#06121f",
                      fontFamily: F.mono,
                      fontSize: 10,
                      fontWeight: 850,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "100%",
                    }}
                  >
                    Investigate ▸
                  </button>
                )}
              </div>

              {/* Inline triage graph card — rendered immediately below the active
                  row. Collapsed for all other rows (single-expand invariant).
                  Resolver dispatch: row.rawSource.kind selects the per-source
                  resolver — trust-audit, cost-signal, stale-collector, plus the
                  Phase 5 dispatch-ready kinds (correlation, blast-radius,
                  auth-rbac, update-cve, policy-warning) once upstream producers
                  emit them. Without a recognized rawSource, the generic
                  action-row resolver runs and leaves Source Event / Affected
                  Object / Related Activity as visible "pending" states.
                  Redaction happens inside each resolver — never here. */}
              {investigatingRowId === row.id && (
                <div style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                  <TriageGraphCard
                    graph={
                      row.rawSource?.kind === "trust-audit"
                        ? resolveTrustAuditTriageGraph({
                            finding: row.rawSource.finding as TrustAuditFinding,
                            now: new Date(),
                          })
                        : row.rawSource?.kind === "cost-signal"
                          ? resolveCostSignalTriageGraph({
                              signal: row.rawSource.signal as CostSignal,
                              rowId: row.id,
                              now: new Date(),
                            })
                          : row.rawSource?.kind === "stale-collector"
                            ? resolveCollectorHealthTriageGraph({
                                collector: row.rawSource.collector as CollectorRecord,
                                rowId: row.id,
                                now: new Date(),
                              })
                            : row.rawSource?.kind === "correlation"
                              ? resolveCorrelationTriageGraph({
                                  finding: row.rawSource.finding as CorrelationFinding,
                                  now: new Date(),
                                })
                              : row.rawSource?.kind === "blast-radius"
                                ? resolveBlastRadiusTriageGraph({
                                    finding: row.rawSource.finding as BlastRadiusFinding,
                                    now: new Date(),
                                  })
                                : row.rawSource?.kind === "auth-rbac"
                                  ? resolveAuthRbacTriageGraph({
                                      finding: row.rawSource.finding as AuthRbacFinding,
                                      now: new Date(),
                                    })
                                  : row.rawSource?.kind === "update-cve"
                                    ? resolveUpdateCveTriageGraph({
                                        finding: row.rawSource.finding as UpdateCveFinding,
                                        now: new Date(),
                                      })
                                    : row.rawSource?.kind === "policy-warning"
                                      ? resolvePolicyWarningTriageGraph({
                                          finding: row.rawSource.finding as PolicyWarningFinding,
                                          now: new Date(),
                                        })
                                      : resolveActionRowTriageGraph({ row, now: new Date() })
                    }
                    onNavigate={onNavigate}
                    sourceContext="missionControl"
                    onClose={() => setInvestigatingRowId(null)}
                  />
                </div>
              )}
            </Fragment>
            );
          })}

          {/* Pagination — hidden when only one page */}
          {totalPages > 1 && (
            <PaginationFooter
              currentPage={safePage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalRows={totalItems}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
              pageSizeOptions={[5, 8, 10, 15, 25, 50]}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Severity → accent color. Mirrors SeverityPill's foreground color so the
 * filter chip uses the same visual semantic as the row severity pill.
 */
function severityAccent(sev: Severity): string {
  return {
    CRIT: C.danger,
    HIGH: C.orange,
    MED:  C.warn,
    WARN: C.txS,
    LOW:  C.txT,
  }[sev] ?? C.txT;
}

function SeverityPill({ sev }: { sev: Severity }) {
  // Color mapping documented in file header.
  const bg = {
    CRIT: `${C.danger}22`,
    HIGH: `${C.orange}22`,
    MED:  `${C.warn}22`,   // amber per spec §7.1
    WARN: `${C.txS}22`,    // muted grey-blue — see header comment for why not dimmed amber
    LOW:  `${C.txT}18`,
  }[sev] ?? `${C.txT}18`;

  const fg = severityAccent(sev);

  return (
    <div style={{
      display: "inline-block",
      padding: "2px 7px",
      borderRadius: 999,
      background: bg,
      color: fg,
      fontFamily: F.mono,
      fontSize: 9,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      border: `1px solid ${fg}44`,
    }}>
      {sev}
    </div>
  );
}

function EvidencePill({ evidence }: { evidence: EvidenceConfidence }) {
  // Colors per spec §7.1: exact=green, fallback=amber, signal=blue, health=purple
  // audit=cyan (trust audit finding — structured evidence, distinct from signal/health)
  const fg = {
    exact:    C.green,
    fallback: C.warn,
    signal:   C.info,
    health:   C.purp,
    audit:    C.cyan,
  }[evidence.kind] ?? C.txT;

  return (
    <div style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      background: `${fg}18`,
      color: fg,
      fontFamily: F.mono,
      // vNext spec §9.3 + §13.3: pill text raised from 9px to 10px (the reviewer's
      // "Evidence confidence labels are not 9px" acceptance criterion).
      // Body remains compact-operator density without sacrificing legibility.
      fontSize: 10,
      fontWeight: 600,
      border: `1px solid ${fg}55`,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      maxWidth: "100%",
    }}>
      {evidence.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function alertToRow(a: {
  id: string;
  title?: string;
  severity?: string;
  source?: string;
  created_at: string;
  correlation_method?: string;
}, operator: Operator | undefined): ActionRow {
  const sev = mapSeverity(a.severity);
  const ageMs = Date.now() - new Date(a.created_at).getTime();
  // correlation_method is absent on bulk-list responses (only on per-alert
  // evidence endpoint). Default to "fallback" when not provided.
  const evidenceKind = a.correlation_method === "forward" ? "exact" : "fallback";
  const evidence: EvidenceConfidence = evidenceKind === "exact"
    ? { kind: "exact", label: "Exact (audit_event_id)" }
    : { kind: "fallback", label: "Best match — fallback by session + ±60s" };
  // Spec §12.4: drill-in to auditEvidence requires audit:read.
  const restricted = !hasPerm(operator, "audit:read");

  return {
    id: a.id,
    severity: sev,
    title: a.title ?? "Active alert",
    source: a.source ?? "alert-source",
    evidence,
    ageMs,
    suggestedAction: suggestedActionForAlert(sev, a.source ?? ""),
    buttonLabel: "View Evidence ▸",
    clickTarget: { tab: "auditEvidence", opts: { id: a.id } },
    restricted,
    priorityScore: computeActionPriority({ severity: sev, ageMs, evidenceKind }),
    family: "alert" as const,
    incidentType: deriveAlertIncidentType(a),
  };
}

/**
 * Derive a fine-grained incidentType for an alert row.
 *
 * Tries title patterns first (operator-visible names like "Insider Threat
 * Signal" / "Data Exfiltration Attempt" / "PII detected" produce stable
 * grouping keys regardless of which detection rule emitted them). Falls
 * back to alert.source so session-watcher alerts cluster together even
 * when titles vary.
 */
function deriveAlertIncidentType(a: { title?: string; source?: string }): string {
  const title = (a.title ?? "").toLowerCase();
  // Common operator-visible alert-type patterns. Order matters — more-specific
  // matches first so "Insider Threat Data Exfil" doesn't get bucketed as
  // generic data-exfil.
  if (title.includes("insider threat"))         return "insider-threat";
  if (title.includes("data exfil"))             return "data-exfil";
  if (title.includes("prompt injection"))       return "prompt-injection";
  if (title.includes("pii"))                    return "pii-exposure";
  if (title.includes("credential"))             return "credential-leak";
  if (title.includes("jailbreak"))              return "jailbreak";
  // Fall back to source — gives "session-watcher", "shield", "correlation-engine".
  return (a.source ?? "alert").toLowerCase();
}

function signalToRow(s: {
  kind: string;
  severity?: string;
  detail?: string;
}, i: number, operator: Operator | undefined): ActionRow {
  // Signal.severity real values are 'high' | 'warn' (from cost-reporting.ts).
  // Old mapping had 'crit' (dead code) and inverted 'high'→WARN / 'warn'→MED.
  // Corrected: preserve 'high'→HIGH; everything else (including 'warn') →WARN.
  const sev: Severity = s.severity === "high" ? "HIGH" : "WARN";
  // Signals are point-in-time; treat age as 0 (formatted as "—").
  const ageMs = 0;
  // Spec §12.4: drill-in to tokenCost requires tokens:read.
  const restricted = !hasPerm(operator, "tokens:read");

  return {
    // Index tiebreaker prevents key collision when two signals share kind +
    // detail-prefix (e.g. two "overrun" signals from the same model family).
    id: `signal-${s.kind}-${i}-${s.detail?.slice(0, 8) ?? "x"}`,
    severity: sev,
    title: s.detail ?? `Cost signal: ${s.kind}`,
    source: "litellm-proxy",
    evidence: { kind: "signal", label: "Cost signal" },
    ageMs,
    suggestedAction: suggestedActionForCostSignal(s.kind),
    buttonLabel: "Diagnose ▸",
    clickTarget: { tab: "tokenCost" },
    restricted,
    priorityScore: computeActionPriority({ severity: sev, ageMs, evidenceKind: "signal" }),
    // Attach the original Signal so the per-source cost-signal resolver
    // can build a fully-populated 5-stage TriageGraph at click time.
    rawSource: { kind: "cost-signal", signal: s },
    family: "cost-signal" as const,
    // Signal kinds are already a closed enum on the upstream side; safe to
    // use directly as the incident type. Two velocity-spike signals on the
    // same provider/agent will collapse into one grouped row.
    incidentType: s.kind,
  };
}

function staleCollectorToRow(c: {
  name: string;
  status?: string;
  lastSeenMsAgo: number;
  staleThresholdMs: number;
  version?: string;
  ingestion_summary?: string;
}, operator: Operator | undefined): ActionRow {
  // Escalate to HIGH when the collector is more than 4× over its threshold;
  // otherwise WARN (spec §7 stale-collector archetype).
  const sev: Severity = c.lastSeenMsAgo > 4 * c.staleThresholdMs ? "HIGH" : "WARN";
  const ageMs = c.lastSeenMsAgo;
  // Spec §12.4: drill-in to infrastructure requires dashboard:view
  // (infrastructure tab is visible to all roles that can view the dashboard).
  const restricted = !hasPerm(operator, "dashboard:view");

  return {
    id: `health-${c.name}`,
    severity: sev,
    title: `${c.name} is stale`,
    source: c.name,
    evidence: { kind: "health", label: "Connector health" },
    ageMs,
    suggestedAction: { verb: "Diagnose", target: `${c.name} adapter` } as SuggestedAction,
    buttonLabel: "Diagnose ▸",
    clickTarget: { tab: "infrastructure" },
    restricted,
    priorityScore: computeActionPriority({ severity: sev, ageMs, evidenceKind: "health" }),
    // Attach the original Collector record so the per-source collector-
    // health resolver can build a fully-populated 5-stage TriageGraph
    // at click time. status / version / ingestion_summary may be absent
    // from older callers; the resolver handles undefined gracefully.
    rawSource: {
      kind: "stale-collector",
      collector: {
        name: c.name,
        status: c.status ?? "unknown",
        lastSeenMsAgo: c.lastSeenMsAgo,
        staleThresholdMs: c.staleThresholdMs,
        version: c.version,
        ingestion_summary: c.ingestion_summary,
      },
    } as ActionRow["rawSource"],
    family: "infrastructure" as const,
    // Strip "(transport)" so two collectors reporting on the same logical
    // service (e.g. "OpenClaw Gateway (WebSocket)" + "OpenClaw Gateway
    // (HTTP)") collapse into a single grouped row when both are stale.
    incidentType: stripCollectorParenSuffix(c.name),
  };
}

/** Strip "(...)" suffix from a collector name. Same heuristic as the KPI
 *  tile breakdown row (KpiRow.tsx). Inlined here to avoid a cross-file
 *  dependency for one-line logic. */
function stripCollectorParenSuffix(name: string): string {
  const i = name.indexOf("(");
  return (i > 0 ? name.slice(0, i).trim() : name).toLowerCase();
}

/**
 * Prescriptive action copy for trust-audit findings.
 *
 * internal reviewer + operator feedback 2026-05-07: the prior implementation surfaced the
 * descriptive blastRadius narrative as the action — operators saw
 * explanation, not instruction.
 *
 * The blastRadius field on the Finding is intentionally narrative for the
 * Trust Audit panel which needs the "what would happen if this trust boundary
 * failed" answer. Mission Control's Action Queue needs the verb-led "what
 * should I do next" answer instead. Two different concerns; we map to the
 * prescriptive form here without disturbing the upstream finding shape.
 *
 * Mapping strategy: key on the rule's title fragment for dangerous-tool combos
 * (the comm-surface-permissiveness rule generates titles of the form
 *   `Agent "X" has dangerous tool combination: <combo-name>`)
 * because that's where the bulk of MC trust-audit volume comes from. Other
 * rules fall back to a clean prescriptive-but-generic verb-noun pair.
 */
/**
 * Per-finding Suggested-Action mapping for trust-audit rows. the reviewer's verb
 * taxonomy 2026-05-07: short verb-led targets in the queue row; long
 * remediation prose stays in the Triage Graph Fix/Control stage.
 *
 * Synonym → canonical mappings applied here:
 *   Block          → Disable integration (path off) OR Restrict capability
 *   Audit          → Review exposure
 *   Tighten        → Restrict capability
 *   Constrain      → Restrict capability
 *   bare Investigate → reframed as Review exposure or Diagnose by context
 *
 * Dangerous-tool combo rows take the combo name as the target so the
 * operator immediately sees which capability to narrow:
 *   Exec + Write   → Restrict capability · Exec/Write
 *   Browser + Read → Restrict capability · Browser/Read
 *   etc.
 *
 * Detail field carries the longer per-rule narrative for tooling that wants
 * to surface nuance (e.g. row tooltip). Queue row only renders verb · target.
 */
function suggestedActionForFinding(f: TrustAuditFinding): SuggestedAction {
  const title = f.title || "";

  // Dangerous-tool combinations — pull combo name from title.
  if (title.includes("dangerous tool combination:")) {
    const combo = title.split("dangerous tool combination:")[1]?.trim() ?? "";
    const slug = combo.replace(/\s+\+\s+/g, "/"); // "Exec + Write" → "Exec/Write"
    return {
      verb: "Restrict capability",
      target: slug || "tool combo",
      detail: `Combo "${combo}". Recheck blast radius after restricting one capability.`,
    };
  }

  // Per-rule canonical mapping. Synonym → canonical conversion:
  // Block(path) → Disable integration; Tighten/Constrain → Restrict capability;
  // Audit → Review exposure; Investigate(drift) → Review exposure.
  switch (f.ruleId) {
    case "direct-path-bypass":
    case "direct-path-enhanced":
      return { verb: "Disable integration", target: "direct path",
               detail: "Block the direct path or require auth; remove bypass." };
    case "tool-freedom":
      return { verb: "Restrict capability", target: "tool grants",
               detail: "Constrain tool grants to least-privilege set." };
    case "model-privilege-mismatch":
      return { verb: "Update policy", target: "model routing",
               detail: "Match model tier to actual privilege scope." };
    case "dormant-risk":
      return { verb: "Disable integration", target: "dormant capability",
               detail: "Disable dormant capability or document why it's retained." };
    case "recovery-path-permissiveness":
      return { verb: "Restrict capability", target: "recovery path",
               detail: "Tighten recovery path; require human approval to invoke." };
    case "prompt-capability-mismatch":
      return { verb: "Update policy", target: "prompt policy",
               detail: "Align allowed prompts with the agent's actual capabilities." };
    case "trust-drift":
      return { verb: "Review exposure", target: "trust drift",
               detail: "Investigate drift; restore last known-good trust posture." };
    case "cross-agent-delegation":
      return { verb: "Review exposure", target: "delegation chain",
               detail: "Audit delegation graph; tighten peer permissions." };
    case "browser-auth-reachability":
      return { verb: "Restrict capability", target: "browser auth path",
               detail: "Restrict browser-driven auth path or require session pinning." };
    case "comm-surface-permissiveness":
      return { verb: "Restrict capability", target: "comm surface",
               detail: "Tighten communication surface; revoke broad grant." };
    default:
      return { verb: "Review exposure", target: f.ruleId || "finding",
               detail: "Review finding; apply scoped remediation." };
  }
}

function trustAuditToRow(f: TrustAuditFinding, operator: Operator | undefined): ActionRow {
  // Map trust-audit severity string to the Action Queue Severity union.
  const sev: Severity =
    f.severity === "critical" ? "CRIT" :
    f.severity === "high"     ? "HIGH" :
    f.severity === "medium"   ? "MED"  : "WARN";
  // Findings are point-in-time snapshots — treat age as 0 (renders as "—").
  const ageMs = 0;
  // Spec §12.4: drill-in to trust-audit requires audit:read.
  const restricted = !hasPerm(operator, "audit:read");

  return {
    id: `audit-${f.id}`,
    severity: sev,
    title: f.title,
    source: "trust-audit",
    evidence: { kind: "audit", label: "Trust Audit finding" },
    ageMs,
    suggestedAction: suggestedActionForFinding(f),
    buttonLabel: "Open Audit ▸",
    // trustAudit tab — matches the trust-audit panel TabId.
    clickTarget: { tab: "trustAudit", opts: { id: f.id } },
    restricted,
    priorityScore: computeActionPriority({ severity: sev, ageMs, evidenceKind: "audit" }),
    // Attach the original Finding so the per-source trust-audit resolver
    // can build a fully-populated 5-stage TriageGraph at click time.
    rawSource: { kind: "trust-audit", finding: f },
    family: "trust-audit" as const,
    incidentType: deriveTrustAuditIncidentType(f),
  };
}

/**
 * Derive a fine-grained incidentType for a trust-audit finding.
 *
 * For the comm-surface-permissiveness rule (which generates titles like
 * `Agent "X" has dangerous tool combination: Exec + Write`), pull the
 * combo name out of the title. Same Exec+Write combo across 3 different
 * agents will share `incidentType="dangerous-combo:exec-write"` and
 * collapse into a single grouped row in vNext grouping.
 *
 * For other rules, fall back to ruleId.
 */
function deriveTrustAuditIncidentType(f: TrustAuditFinding): string {
  if (f.title && f.title.includes("dangerous tool combination:")) {
    const combo = f.title.split("dangerous tool combination:")[1]?.trim() ?? "";
    if (combo) {
      // Normalise: lowercase + spaces → hyphens. "Exec + Write" → "exec-write".
      const slug = combo.toLowerCase().replace(/[\s+]+/g, "-").replace(/-+/g, "-");
      return `dangerous-combo:${slug}`;
    }
  }
  return f.ruleId || "trust-audit-rule";
}


// ---------------------------------------------------------------------------
// Severity / action helpers
// ---------------------------------------------------------------------------

function mapSeverity(raw: string | undefined): Severity {
  // API returns CRITICAL / HIGH / MEDIUM / LOW (confirmed in AlertData type).
  switch (raw) {
    case "CRITICAL": return "CRIT";
    case "HIGH":     return "HIGH";
    case "MEDIUM":   return "MED";
    case "LOW":      return "LOW";
    default:         return "WARN";
  }
}

/**
 * Per-severity Suggested-Action mapping for alert rows. the reviewer's verb taxonomy
 * 2026-05-07: avoid bare "Investigate" (the button already says it). Verb
 * tells the operator WHAT KIND of action they're headed toward.
 *
 * Mapping:
 *   CRIT  → Contain agent · alert source
 *   HIGH  → Open evidence · session prompt history
 *   MED   → Review exposure · alert correlations
 *   WARN  → Review exposure · alert details
 *   LOW   → Review exposure · alert details
 */
/**
 * Per-kind Suggested-Action mapping for cost-signal rows. the reviewer's verb
 * taxonomy 2026-05-07: bare "Investigate" forbidden; cost signals are
 * statistical → Diagnose. Misroute (simple_on_expensive) is genuinely
 * a policy fix → Update policy.
 *
 * Mapping:
 *   loop_risk            → Diagnose · retry loop pattern
 *   velocity_spike       → Diagnose · token velocity spike
 *   context_bloat        → Diagnose · context growth
 *   cache_drop           → Diagnose · prompt-cache config
 *   cache_drop_risk      → Diagnose · prompt-cache config
 *   simple_on_expensive  → Update policy · model routing
 *   <unknown kind>       → Diagnose · token consumption pattern (fallback)
 */
function suggestedActionForCostSignal(kind: string): SuggestedAction {
  switch (kind) {
    case "loop_risk":
      return { verb: "Diagnose", target: "retry loop pattern" };
    case "velocity_spike":
      return { verb: "Diagnose", target: "token velocity spike" };
    case "context_bloat":
      return { verb: "Diagnose", target: "context growth" };
    case "cache_drop":
    case "cache_drop_risk":
      return { verb: "Diagnose", target: "prompt-cache config" };
    case "simple_on_expensive":
      return { verb: "Update policy", target: "model routing" };
    default:
      return { verb: "Diagnose", target: "token consumption pattern" };
  }
}

function suggestedActionForAlert(sev: Severity, source: string): SuggestedAction {
  switch (sev) {
    case "CRIT":
      return { verb: "Contain agent",   target: source || "alert source" };
    case "HIGH":
      return { verb: "Open evidence",   target: "session prompt history" };
    case "MED":
      return { verb: "Review exposure", target: "alert correlations" };
    case "WARN":
    case "LOW":
      return { verb: "Review exposure", target: "alert details" };
  }
}

function formatAge(ms: number): string {
  // "—" for point-in-time signals (ageMs === 0).
  if (ms === 0) return "—";
  const SECOND = 1_000;
  const MINUTE = 60_000;
  const HOUR   = 3_600_000;
  const DAY    = 86_400_000;
  if (ms < MINUTE) return `${Math.round(ms / SECOND)}s`;
  if (ms < HOUR)   return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY)    return `${Math.round(ms / HOUR)}h`;
  return `${Math.round(ms / DAY)}d`;
}

// ---------------------------------------------------------------------------
// B4 — Demo skeleton (operator-approved 2026-05-16, Option B)
//
// Renders ACTION_QUEUE_DEMO as a simplified card-list with a banner. Does
// not route through the live priority pipeline / grouping / filtering — the
// demo intent is "operator sees populated queue", not "demo-grade triage".
// Click-targets are wired so drill-downs from demo rows still land on the
// right deep-work tab (matches the live card's navigation surface).
// ---------------------------------------------------------------------------

function DemoActionQueueSkeleton({
  items,
  onNavigate,
}: {
  items: readonly ActionQueueDemoItem[];
  onNavigate: (tab: TabId, focusOrOpts?: NavigateOpts) => void;
}) {
  function targetForSource(source: ActionQueueDemoItem["source"]): { tab: TabId; opts?: NavigateOpts } {
    switch (source) {
      case "alert":       return { tab: "alertsIncidents", opts: { fromMissionControl: true } };
      case "cost":        return { tab: "tokenCost",        opts: { fromMissionControl: true } };
      case "cve":         return { tab: "infrastructure",   opts: { fromMissionControl: true } };
      case "trust-audit": return { tab: "trustAudit",       opts: { fromMissionControl: true } };
      case "auth":        return { tab: "configuration",    opts: { focus: "operators", fromMissionControl: true } };
      case "collector":   return { tab: "infrastructure",   opts: { fromMissionControl: true } };
    }
  }

  function accentForSeverity(sev: ActionQueueDemoItem["severity"]): string {
    if (sev === "CRITICAL") return C.danger;
    if (sev === "HIGH")     return C.warn;
    if (sev === "MEDIUM")   return C.cyan;
    return C.txT;
  }

  return (
    <div
      className="mc-panel-surface mc-action-queue"
      style={{
        background: C.glassChrome,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${C.glassBorderSubtle}`,
        borderRadius: 18,
        boxShadow: C.glassShadow,
        padding: 16,
        marginBottom: 16,
      }}
    >
      {/* Header + DEMO indicator + banner */}
      <div style={{ fontSize: 11, color: C.txT, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>
        Action Queue <span style={{ color: C.purp, fontWeight: 800, marginLeft: 6 }}>· DEMO</span>
      </div>
      <div
        role="note"
        style={{
          padding: "8px 10px",
          borderRadius: 10,
          background: `${C.purp}14`,
          border: `1px solid ${C.purp}55`,
          marginBottom: 10,
          fontSize: 10,
          color: C.txT,
          fontFamily: F.mono,
          lineHeight: 1.4,
        }}
      >
        Demo skeleton — {items.length} synthetic items from {new Set(items.map((i) => i.source)).size} sources.
        Live mode renders the full priority pipeline (severity × age × evidence) with grouping, filters, and pagination.
      </div>

      {/* Item card list */}
      {items.map((item) => {
        const target = targetForSource(item.source);
        return (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => onNavigate(target.tab, target.opts)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigate(target.tab, target.opts);
              }
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "80px 1fr 160px",
              gap: 10,
              alignItems: "center",
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${C.glassSurfBorder}`,
              background: C.glassSurfTrans,
              marginBottom: 6,
              cursor: "pointer",
              fontFamily: F.mono,
              fontSize: 11,
            }}
          >
            {/* Severity pill */}
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                color: accentForSeverity(item.severity),
                background: `${accentForSeverity(item.severity)}18`,
                border: `1px solid ${accentForSeverity(item.severity)}55`,
                borderRadius: 999,
                padding: "2px 8px",
                textAlign: "center",
                letterSpacing: "0.05em",
              }}
            >
              {item.severity}
            </span>

            {/* Title + detail + source chip */}
            <span style={{ overflow: "hidden" }}>
              <div style={{ color: C.txS, fontWeight: 700, marginBottom: 2 }}>{item.title}</div>
              <div style={{ color: C.txT, fontSize: 10, opacity: 0.85, lineHeight: 1.4 }}>{item.detail}</div>
              <span
                style={{
                  display: "inline-block",
                  marginTop: 4,
                  fontSize: 9,
                  color: C.txT,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: `${C.cyan}11`,
                  border: `1px solid ${C.cyan}33`,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {item.source}
              </span>
            </span>

            {/* Suggested action (internal reviewer verb taxonomy) */}
            <span style={{ color: C.cyan, fontWeight: 700, textAlign: "right" }}>
              {item.suggestedAction}
            </span>
          </div>
        );
      })}
    </div>
  );
}
