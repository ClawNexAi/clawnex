/**
 * Mission Control panel-local contract types.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md
 *
 * Every type here corresponds to a metric/posture-row contract in §5 / §6 / §7
 * of the spec. Keep this file pure: types only, no runtime code.
 */

import type { TabId } from "../../types";

// ---------------------------------------------------------------------------
// Time-range + refresh strategy taxonomy (spec §9, §10)
// ---------------------------------------------------------------------------

// v0.13.0+: "6h" added so MC can consume the dashboard's global timeRange
// (which has 1h/6h/24h/7d/30d) without losing fidelity.
export type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d";

export type TimeBehavior =
  | "time_windowed"  // honors global range — counts/aggregates within window
  | "point_in_time"  // current state — global picker has no effect
  | "last_seen";     // current state with freshness lag

export type RefreshStrategy =
  | "sse"
  | "poll_30s"
  | "poll_5m"
  | "on_demand"
  | "static";

// ---------------------------------------------------------------------------
// Shared navigation target (spec §7.4 drill-down contract)
// ---------------------------------------------------------------------------

export interface NavTarget {
  tab: TabId;
  /** Open-shape opts bag — the missionControlFocus state slot reads these. */
  opts?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// KPI contract (spec §5)
// ---------------------------------------------------------------------------

export type KpiId =
  | "activeIncidents"
  | "evidenceConfidence"
  | "shieldActivity"
  | "costRisk"
  | "collectorHealth"
  | "policyCoverage";

export type KpiAccent = "danger" | "warn" | "cyan" | "green" | "purp" | "brand";

export type KpiState = "live" | "loading" | "stale" | "error" | "restricted" | "empty";

export interface KpiBreakdownRow {
  label: string;
  value: string;
  accent?: KpiAccent;
}

export interface KpiData {
  id: KpiId;
  state: KpiState;
  /** Headline value displayed in large text. May be a number or a formatted string like "163+12". */
  value: string | number;
  /** Optional small unit suffix, e.g. "%". */
  unit?: string;
  /** Status pill text in the label corner, e.g. "10 OPEN", "EXACT", "LIVE". */
  pill?: string;
  pillAccent?: KpiAccent;
  /** Up to 3 breakdown rows in the card body. */
  breakdown: KpiBreakdownRow[];
  /** Footer line (text-tertiary). */
  footer?: string;
  /** Stacked-bar segments — proportional split visualizing the breakdown. */
  stack?: Array<{ ratio: number; accent: KpiAccent }>;
  /** Last refresh wall-clock for stale-marker contract (§10.1). */
  lastRefreshedAt: number;
  /** Click target tab + opts. */
  clickTarget: NavTarget;
  /** Spec-derived behavior tags. */
  timeBehavior: TimeBehavior;
  refreshStrategy: RefreshStrategy;
}

// ---------------------------------------------------------------------------
// Operational Posture row (spec §6)
// ---------------------------------------------------------------------------

export type PostureRowId =
  | "shieldPolicyCoverage"
  | "evidenceQuality"
  | "incidentHygiene"
  | "sourceFreshness"
  | "costDiscipline";

export interface PostureRow {
  id: PostureRowId;
  label: string;
  /** Normalized 0-100 current score. */
  current: number;
  /** Normalized 0-100 7-day rolling average. */
  weekAvg: number;
  /** Target threshold (e.g. 75 means "we want this above 75"). */
  target: number;
  /** State accent for the score (green ≥ target, warn < target, danger far below). */
  accent: "green" | "warn" | "danger";
  /** Click target. */
  clickTarget: NavTarget;
  /** Tooltip / drill-down explanation — load-bearing per "no magic score" rule. */
  formula: string;
  /** Last refresh wall-clock. */
  lastRefreshedAt: number;
}

// ---------------------------------------------------------------------------
// Action Queue row (spec §7)
// ---------------------------------------------------------------------------

export type Severity = "CRIT" | "HIGH" | "MED" | "WARN" | "LOW";

export type EvidenceConfidence =
  | { kind: "exact"; label: "Exact (audit_event_id)" }
  | { kind: "fallback"; label: "Best match — fallback by session + ±60s" }
  | { kind: "signal"; label: "Cost signal" }
  | { kind: "health"; label: "Connector health" }
  | { kind: "audit"; label: "Trust Audit finding" };

/**
 * Closed source-family taxonomy — drives queue filters, grouping, suppression,
 * and per-source stale markers. Currently 4 entries matching the source-family
 * lanes in the vNext spec §6.1; more land as new resolvers ship.
 */
export type IncidentFamily =
  | "alert"
  | "cost-signal"
  | "infrastructure"
  | "trust-audit";

/**
 * Closed verb taxonomy for the Suggested-Action column. the reviewer's call 2026-05-07
 * (10 from spec §5.3 + Diagnose as 11th):
 *
 *   - Open evidence — drill into a specific audit/event row.
 *   - Diagnose — source degraded; first job is determining the operational cause.
 *   - Review exposure — assess what's at risk from a posture/correlation finding.
 *   - Restrict capability — narrow a tool grant, scope, or permission.
 *   - Contain agent — isolate or quarantine a specific agent.
 *   - Disable integration — turn off a path / connector / external integration.
 *   - Rotate credential — replace a leaked or expiring secret.
 *   - Update policy — change a routing/shield/cost policy.
 *   - Assign owner — route the issue to a human.
 *   - Suppress as accepted risk — record an explicit accepted-risk decision.
 *   - Escalate — raise priority / send to security team / page on-call.
 *
 * Banned synonyms: Inspect / Audit / Tighten / Constrain / Block / bare
 * Investigate / bare Review / bare View / "Take action" / "Click here" /
 * "Fix issue". Map them via reference_action_verb_taxonomy.md.
 *
 * Verifier: scripts/verify-action-verbs.ts asserts every row mapper produces
 * an approved verb and the banned phrases stay out of the codebase.
 *
 * verbCategory is stored on ActionRow but is NOT part of the v0.14 group-key
 * tuple — internal reviewer deferred verb-as-grouping-key to avoid over-aggressive
 * collapse across families that share remediation shape but represent
 * unlike risks.
 */
export const ACTION_VERBS = [
  "Open evidence",
  "Diagnose",
  "Review exposure",
  "Restrict capability",
  "Contain agent",
  "Disable integration",
  "Rotate credential",
  "Update policy",
  "Assign owner",
  "Suppress as accepted risk",
  "Escalate",
] as const;
export type ActionVerb = typeof ACTION_VERBS[number];

export interface SuggestedAction {
  /** Canonical verb category — must be one of ACTION_VERBS. */
  verb: ActionVerb;
  /** Short free-form target (e.g. "session prompt history", "tool grants",
   *  "<collector-name> adapter"). No full sentences, no semicolons,
   *  no paragraph copy — that belongs in the Triage Graph Fix/Control stage. */
  target: string;
  /** Optional longer context. NOT rendered in the queue row; available to
   *  consumers that want to surface nuance elsewhere (e.g. row tooltip). */
  detail?: string;
}

/** Format a SuggestedAction for display in the Action Queue row. */
export function formatSuggestedAction(action: SuggestedAction): string {
  return `${action.verb} · ${action.target}`;
}

export interface ActionRow {
  id: string;
  severity: Severity;
  title: string;
  source: string;          // e.g. "session-watcher", "litellm-proxy"
  evidence: EvidenceConfidence;
  ageMs: number;
  /**
   * Structured verb + target. Format via formatSuggestedAction(). No prose
   * copy in this field — long remediation guidance belongs in the Triage
   * Graph Fix/Control stage's previewSummary.
   * the reviewer's verb taxonomy 2026-05-07; closed enum enforced by
   * scripts/verify-action-verbs.ts.
   */
  suggestedAction: SuggestedAction;
  buttonLabel: string;      // e.g. "View Evidence ▸"
  /** Click target. */
  clickTarget: NavTarget;
  /** Restricted rows have buttonLabel disabled with tooltip. */
  restricted?: boolean;
  /** Computed priority score (see scoring.ts) — drives table ordering. */
  priorityScore: number;
  /**
   * Closed source-family bucket. Set by each *ToRow mapper. Drives the
   * queue Family filter dropdown + per-source stale markers + suppression
   * keys. Optional only because legacy rows from before the taxonomy
   * landed don't have it; new mappers must always set it.
   */
  family?: IncidentFamily;
  /**
   * Free-form incident-type sub-key for grouping. Examples:
   *   alert      → "shield" / "session-watcher" / "correlation-engine"
   *                / "insider-threat" / "data-exfil" (parsed from title)
   *   cost-signal → "loop_risk" / "velocity_spike" / "context_bloat" / etc.
   *   infrastructure → stripped collector name ("OpenClaw Gateway")
   *   trust-audit → combo name ("Exec + Write") or ruleId
   *
   * Two rows with the same (family, incidentType, affectedObject, action,
   * restricted, destination) tuple may collapse into a single grouped row.
   * See action-queue-grouping.ts for the canonical group key.
   */
  incidentType?: string;
  /**
   * Optional source-payload escape hatch for per-source triage resolvers.
   *
   * When the row originates from a domain object that has richer fields than
   * the ActionRow shape exposes (e.g. a TrustAuditFinding has agentId +
   * recommendedFix + confidence + capabilityPath which the row drops to a
   * single `title` string), the mapper attaches the original here. The triage
   * graph render in ActionQueue.tsx dispatches on `kind` to the matching
   * per-source resolver (trust-audit, cost-signal, stale-collector, alert,
   * correlation, blast-radius, auth-rbac, update-cve, policy-warning) and
   * falls back to the generic action-row resolver when `rawSource` is absent
   * or the kind isn't recognized. Typed loose-`unknown` so this types stays
   * agnostic about which sources have implemented per-source resolvers.
   */
  rawSource?:
    | { kind: "trust-audit"; finding: unknown }
    | { kind: "alert"; alert: unknown }
    | { kind: "cost-signal"; signal: unknown }
    | { kind: "stale-collector"; collector: unknown }
    | { kind: "correlation"; finding: unknown }
    | { kind: "blast-radius"; finding: unknown }
    | { kind: "auth-rbac"; finding: unknown }
    | { kind: "update-cve"; finding: unknown }
    | { kind: "policy-warning"; finding: unknown };
}

// ---------------------------------------------------------------------------
// Mission Control top-level data envelope
// ---------------------------------------------------------------------------

/**
 * Mission Control top-level data envelope.
 *
 * Sub-sections (Incident Aging, Signals & Source Health, Detection Trend)
 * own their own data shape, defined alongside their components.
 */
export interface MissionControlData {
  range: TimeRange;
  demoMode: boolean;
  /** Aggregate freshness — newest of the last-refreshed timestamps across KPIs. */
  lastRefreshedAt: number;
  /** Per-section data. */
  kpis: KpiData[];
  posture: PostureRow[];
  actions: ActionRow[];
}
