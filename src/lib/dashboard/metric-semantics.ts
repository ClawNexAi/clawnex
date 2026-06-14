/**
 * ClawNex dashboard metric semantics — the canonical contract for what
 * dashboard counts and scores actually mean.
 *
 * Why this module exists:
 *   Dogfood QA found header, Fleet, Alert Summary, Alerts panel, and sidebar
 *   badges all using the word "alerts" for different sets of records:
 *   `/api/alerts` listed everything except suppressed; `/api/fleet` excluded
 *   `resolved` + `false_positive` only; the header showed open + critical;
 *   Fleet tooltip claimed "OPEN or ACK" but the code also included
 *   `investigating`. Operators looking at three numbers on the same screen
 *   couldn't tell why they disagreed. For a security product, that's a trust
 *   bug, not a copy bug.
 *
 *   This module defines status sets, severity, scope, and origin once. Every
 *   API route, service, and UI surface that counts alerts/scans/scores must
 *   import from here so the meaning of each count is provable and consistent.
 *
 * What changes when you import from here:
 *   - You don't write `'open'` or `'resolved'` as bare strings.
 *   - You don't hand-roll a `status NOT IN (...)` clause.
 *   - You pick a scope (`active` / `all` / `terminal`) at call time and the
 *     SQL/filter helper returns the right predicate.
 *   - UI labels/tooltips come from `METRIC_LABELS` so a copy change happens
 *     in one place.
 *
 * Reference: the reviewer's QA fix plan §P0 metric contract
 * (`.hermes/plans/2026-04-28_215336-clawnex-metric-semantics-qa-fix-plan.md`).
 */

// ---------------------------------------------------------------------------
// Alert status taxonomy
// ---------------------------------------------------------------------------

/** Alerts the operator must still act on (or has not yet closed). */
export const ALERT_STATUS_OPEN = 'open' as const;
export const ALERT_STATUS_ACKNOWLEDGED = 'acknowledged' as const;
export const ALERT_STATUS_INVESTIGATING = 'investigating' as const;

/** Alerts that no longer require operator attention. */
export const ALERT_STATUS_RESOLVED = 'resolved' as const;
export const ALERT_STATUS_SUPPRESSED = 'suppressed' as const;
export const ALERT_STATUS_FALSE_POSITIVE = 'false_positive' as const;

export type AlertStatus =
  | typeof ALERT_STATUS_OPEN
  | typeof ALERT_STATUS_ACKNOWLEDGED
  | typeof ALERT_STATUS_INVESTIGATING
  | typeof ALERT_STATUS_RESOLVED
  | typeof ALERT_STATUS_SUPPRESSED
  | typeof ALERT_STATUS_FALSE_POSITIVE;

/**
 * "Active" = needs attention. Open + acknowledged + investigating.
 * This is the canonical default for any user-facing count that says "alerts"
 * without further qualification.
 */
export const ACTIVE_ALERT_STATUSES: ReadonlyArray<AlertStatus> = Object.freeze([
  ALERT_STATUS_OPEN,
  ALERT_STATUS_ACKNOWLEDGED,
  ALERT_STATUS_INVESTIGATING,
]);

/**
 * "Terminal" = no longer requires attention. Resolved + suppressed + false-positive.
 * Visible only in audit/admin contexts or on explicit operator opt-in.
 */
export const TERMINAL_ALERT_STATUSES: ReadonlyArray<AlertStatus> = Object.freeze([
  ALERT_STATUS_RESOLVED,
  ALERT_STATUS_SUPPRESSED,
  ALERT_STATUS_FALSE_POSITIVE,
]);

export const ALL_ALERT_STATUSES: ReadonlyArray<AlertStatus> = Object.freeze([
  ...ACTIVE_ALERT_STATUSES,
  ...TERMINAL_ALERT_STATUSES,
]);

export function isActiveAlertStatus(status: string): status is AlertStatus {
  return (ACTIVE_ALERT_STATUSES as readonly string[]).includes(status);
}

export function isTerminalAlertStatus(status: string): status is AlertStatus {
  return (TERMINAL_ALERT_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export const ALERT_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type AlertSeverity = typeof ALERT_SEVERITIES[number];

export function isAlertSeverity(s: string): s is AlertSeverity {
  return (ALERT_SEVERITIES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Scope — the parameter every alert-listing API accepts
// ---------------------------------------------------------------------------

/**
 * `active`   — open + acknowledged + investigating. Default for user-facing surfaces.
 * `terminal` — resolved + suppressed + false-positive. Audit/cleanup views.
 * `all`      — every record regardless of status.
 *
 * The legacy `include_suppressed=true` parameter is retained on
 * `/api/alerts` for backward compatibility and overlays the chosen scope to
 * also include `suppressed`. New callers should use `scope=` only.
 */
export const ALERT_SCOPES = ['active', 'terminal', 'all'] as const;
export type AlertScope = typeof ALERT_SCOPES[number];

export function isAlertScope(s: string): s is AlertScope {
  return (ALERT_SCOPES as readonly string[]).includes(s);
}

/** Statuses that belong in a given scope. */
export function statusesForScope(scope: AlertScope): ReadonlyArray<AlertStatus> {
  switch (scope) {
    case 'active': return ACTIVE_ALERT_STATUSES;
    case 'terminal': return TERMINAL_ALERT_STATUSES;
    case 'all': return ALL_ALERT_STATUSES;
  }
}

// ---------------------------------------------------------------------------
// SQL predicate builders
// ---------------------------------------------------------------------------

/**
 * SQL fragment selecting active alerts. Use as part of a WHERE clause:
 *   `SELECT COUNT(*) FROM alerts WHERE ${activeAlertSqlClause()} AND created_at >= ?`
 * Returns a static string with quoted literals — no parameters required.
 * Statuses are constants, not user input, so embedding is safe.
 */
export function activeAlertSqlClause(): string {
  return `status IN ('${ACTIVE_ALERT_STATUSES.join("', '")}')`;
}

export function terminalAlertSqlClause(): string {
  return `status IN ('${TERMINAL_ALERT_STATUSES.join("', '")}')`;
}

export function statusesForScopeSqlClause(scope: AlertScope): string {
  if (scope === 'all') return '1=1';
  return `status IN ('${statusesForScope(scope).join("', '")}')`;
}

// ---------------------------------------------------------------------------
// Provenance / origin (used by Phase 2a shield + alert provenance)
// ---------------------------------------------------------------------------

export const ORIGIN_PRODUCTION = 'production' as const;
export const ORIGIN_MANUAL = 'manual' as const;
export const ORIGIN_SHIELD_TEST = 'shield-test' as const;
export const ORIGIN_DEMO = 'demo' as const;
export const ORIGIN_QA = 'qa' as const;
/** v0.9.3+ origin tag for rows written by the in-dashboard simulation/seed
 *  feature (Configuration -> System Management -> Developer Tools, or
 *  scripts/dashboard-traffic-fixture.ts via CLI). Filtered out of all
 *  production-facing counters by default. Inclusion is opt-in per route
 *  via `?includeSimulation=true`. Banking-customer prod installs lock the
 *  feature out entirely via `CLAWNEX_DEV_TOOLS_DISABLED=1` env var; the
 *  origin tag is the second-line defense even when the surface is
 *  available. */
export const ORIGIN_SIMULATION = 'simulation' as const;

export type Origin =
  | typeof ORIGIN_PRODUCTION
  | typeof ORIGIN_MANUAL
  | typeof ORIGIN_SHIELD_TEST
  | typeof ORIGIN_DEMO
  | typeof ORIGIN_QA
  | typeof ORIGIN_SIMULATION;

/** Origins counted as production evidence by default. */
export const PRODUCTION_ORIGINS: ReadonlyArray<Origin> = Object.freeze([
  ORIGIN_PRODUCTION,
  ORIGIN_MANUAL,
]);

/** Origins excluded from production-grade counters by default. */
export const NON_PRODUCTION_ORIGINS: ReadonlyArray<Origin> = Object.freeze([
  ORIGIN_SHIELD_TEST,
  ORIGIN_DEMO,
  ORIGIN_QA,
  ORIGIN_SIMULATION,
]);

/** Subset of NON_PRODUCTION_ORIGINS that comes from the in-dashboard
 *  simulation feature specifically (not Shield Tests / demo / qa). Used
 *  by `?includeSimulation=true` opt-in surfaces and by the active-runs
 *  ribbon to detect "is there simulation data on this fleet right now?". */
export const SIMULATION_ORIGINS: ReadonlyArray<Origin> = Object.freeze([
  ORIGIN_SIMULATION,
]);

export function isProductionOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true; // null/undefined treated as production for legacy records
  return (PRODUCTION_ORIGINS as readonly string[]).includes(origin);
}

// ---------------------------------------------------------------------------
// SQL helpers for detail-JSON-bridge provenance
//
// shield_scans.detail and alerts.metadata are TEXT columns containing JSON.
// We store `origin` as a top-level key inside each. Pre-Phase-2a records have
// no `origin` key; per the contract those are treated as production. The
// SQL clauses below read the JSON via SQLite's json_extract() (JSON1 ext,
// bundled with better-sqlite3 by default) and apply the legacy-as-production
// rule with `IS NULL OR IN (...)`.
// ---------------------------------------------------------------------------

/**
 * Returns a SQL fragment that includes only production-grade records from a
 * given JSON column. Pass the column name (e.g. "detail" for shield_scans,
 * "metadata" for alerts). Use as part of a WHERE clause:
 *   `... AND ${productionOriginSqlClause('detail')}`
 */
export function productionOriginSqlClause(jsonColumn: string): string {
  const list = PRODUCTION_ORIGINS.map(o => `'${o}'`).join(', ');
  return `(json_extract(${jsonColumn}, '$.origin') IS NULL OR json_extract(${jsonColumn}, '$.origin') IN (${list}))`;
}

/** Inverse: only test/demo/qa/simulation records. Used by Shield Tests panel
 *  to show its own scan history without mixing production traffic in, and
 *  by the Developer Tools list view. */
export function nonProductionOriginSqlClause(jsonColumn: string): string {
  const list = NON_PRODUCTION_ORIGINS.map(o => `'${o}'`).join(', ');
  return `json_extract(${jsonColumn}, '$.origin') IN (${list})`;
}

/** SQL fragment matching ONLY the in-dashboard simulation origin (v0.9.3+).
 *  Used by `/api/dev/runs` to enumerate active simulation runs and by the
 *  reset endpoint to scope deletes precisely. Distinct from the broader
 *  `nonProductionOriginSqlClause` because Shield Tests / demo / qa rows
 *  are NOT operator-deletable via Reset Simulation. */
export function simulationOriginSqlClause(jsonColumn: string): string {
  return `json_extract(${jsonColumn}, '$.origin') = '${ORIGIN_SIMULATION}'`;
}

/**
 * Returns a SQL fragment matching exactly one origin. Pass the column name
 * and the literal origin (use the typed constants above, not raw strings).
 */
export function originSqlClause(jsonColumn: string, origin: Origin): string {
  return `json_extract(${jsonColumn}, '$.origin') = '${origin}'`;
}

// ---------------------------------------------------------------------------
// Shield verdict taxonomy
// ---------------------------------------------------------------------------

export const SHIELD_VERDICT_BLOCK = 'BLOCK' as const;
export const SHIELD_VERDICT_REVIEW = 'REVIEW' as const;
export const SHIELD_VERDICT_ALLOW = 'ALLOW' as const;

export type ShieldVerdict =
  | typeof SHIELD_VERDICT_BLOCK
  | typeof SHIELD_VERDICT_REVIEW
  | typeof SHIELD_VERDICT_ALLOW;

// ---------------------------------------------------------------------------
// UI labels + tooltips
// ---------------------------------------------------------------------------

/**
 * Single source of truth for user-facing metric labels. Every visible count
 * should resolve its label and tooltip from here. Time-window phrasing uses
 * `{window}` as a placeholder; callers replace it with the active filter
 * label (e.g. "24h", "7d").
 */
export const METRIC_LABELS = {
  /** Header pill, sidebar critical badge — open + CRITICAL only. */
  CRITICAL_OPEN: {
    label: 'Critical Alerts',
    tooltip:
      'Open alerts at CRITICAL severity in the selected time window ({window}). ' +
      'Excludes alerts already acknowledged, investigating, resolved, suppressed, ' +
      'or marked false positive. Lower severities are not included here — see ' +
      'Alerts & Incidents for the full list.',
  },
  /** Sidebar Alerts & Incidents badge, Fleet "Alerts" tile, Alert Summary header. */
  ACTIVE_ALERTS: {
    label: 'Active Alerts',
    tooltip:
      'Alerts requiring attention across the fleet ({window}): open, acknowledged, ' +
      'or investigating. All severities. Resolved, suppressed, and false-positive ' +
      'alerts are excluded by default; see Alerts & Incidents to view those.',
  },
  /** Specific subset for surfaces that need both severity and status filters. */
  ACTIVE_CRITICAL: {
    label: 'Active Critical',
    tooltip:
      'CRITICAL severity alerts in active states (open, acknowledged, investigating). ' +
      'Selected time window ({window}).',
  },
  /** Used on the Alerts & Incidents result count when filters are applied. */
  PANEL_FILTERED: {
    label: 'Filtered Results',
    tooltip:
      'Result count after applying the panel filters above. Not the global active-alert count.',
  },
  /** Used in tooltips that need to say "Threats" but reference shield blocks. */
  SHIELD_BLOCKS: {
    label: 'Shield Blocks',
    tooltip:
      'Prompt Shield BLOCK verdicts in the selected time window ({window}). ' +
      'Session-watcher retroactive detections are excluded. Shield-test-generated ' +
      'scans are excluded from production counters by default (see Shield Tests panel).',
  },
} as const;

export type MetricLabelId = keyof typeof METRIC_LABELS;

/** Substitute `{window}` placeholder in a tooltip with the active filter window. */
export function tooltipWithWindow(id: MetricLabelId, window: string): string {
  return METRIC_LABELS[id].tooltip.replace('{window}', window);
}

// ---------------------------------------------------------------------------
// Posture reconciliation
// ---------------------------------------------------------------------------
//
// "Security Posture" can be sourced three ways with a strict precedence, and it
// MUST be computed identically wherever it appears so the Security Posture panel,
// the Fleet posture column, and the Readiness Banner can never silently disagree.
// This is the single definition. Precedence:
//   1. clawkeeper      — a real host-hardening scan (overallScore) or its
//                        category-derived score. The authoritative grade.
//   2. fleet-estimate  — no host scan, but fleet instances carry posture scores;
//                        surface their AVERAGE, explicitly labeled as an estimate
//                        (never presented as a real hardening grade).
//   3. unscanned       — nothing to report; show "Unscanned", not 0.
// Returning `score: null` for unscanned keeps honest-zero-vs-unknown intact.

export type PostureSource = 'clawkeeper' | 'fleet-estimate' | 'unscanned';

export interface ReconciledPosture {
  /** 0-100, or null when truly unscanned (distinct from a real 0). */
  score: number | null;
  source: PostureSource;
  /** Number of fleet instances averaged when source === 'fleet-estimate'. */
  instanceCount: number;
}

export function reconcilePosture(input: {
  scanScore?: number | null;
  hardeningScore?: number | null;
  fleetPostures?: ReadonlyArray<number | null | undefined>;
}): ReconciledPosture {
  if (typeof input.scanScore === 'number') {
    return { score: input.scanScore, source: 'clawkeeper', instanceCount: 0 };
  }
  if (typeof input.hardeningScore === 'number') {
    return { score: input.hardeningScore, source: 'clawkeeper', instanceCount: 0 };
  }
  const scored = (input.fleetPostures ?? []).filter((p): p is number => typeof p === 'number');
  if (scored.length > 0) {
    const avg = Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
    return { score: avg, source: 'fleet-estimate', instanceCount: scored.length };
  }
  return { score: null, source: 'unscanned', instanceCount: 0 };
}
