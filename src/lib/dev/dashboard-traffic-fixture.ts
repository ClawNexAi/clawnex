/**
 * Dashboard traffic fixture for local/QA ClawNex dashboard inspection.
 *
 * Purpose:
 * - Populate the real dashboard code paths with synthetic traffic so operators
 *   can inspect whether metrics, labels, and aggregates make sense.
 * - Keep every generated row tagged with a simulation_run_id so the run can be
 *   summarized and removed cleanly.
 *
 * Provenance (v0.9.3+ change):
 * - Rows are tagged with `origin: 'simulation'` per the metric-semantics
 *   contract in src/lib/dashboard/metric-semantics.ts. This means default
 *   dashboard counters DO NOT count fixture rows as production evidence
 *   (counters use `productionOriginSqlClause` which excludes simulation),
 *   matching the operator's mental model: "this isn't real data."
 * - To see fixture rows in any panel: pass `?includeTestGenerated=true`
 *   on the relevant route, or use the dedicated Configuration ->
 *   System Management -> Developer Tools surface in the dashboard.
 * - The active-runs ribbon and `/api/dev/runs` endpoint enumerate fixture
 *   rows precisely via `simulationOriginSqlClause`.
 *
 * Banking-customer install posture:
 * - Customer prod installs lock the dashboard surface entirely via
 *   `CLAWNEX_DEV_TOOLS_DISABLED=1`. The CLI is also gated by the env
 *   var (see src/app/api/dev/* routes for the same guard).
 *
 * Earlier behavior (pre-v0.9.3):
 * - Used `origin: 'production'` to make default counters light up. This
 *   was a known gap with the metric-semantics provenance work — fixed by
 *   adding the `'simulation'` origin and an explicit dashboard surface
 *   that opts in.
 */

import { createHash, randomUUID } from "node:crypto";
import { queryOne, run, transaction } from "../db/index";
import { ORIGIN_SIMULATION, ORIGIN_PRODUCTION, type Origin } from "../dashboard/metric-semantics";

export const DASHBOARD_TRAFFIC_SOURCE = "dashboard-traffic-fixture";

type Profile = "standard" | "intense" | "quiet";

type SeedOptions = {
  runId?: string;
  profile?: Profile;
  now?: Date;
  /**
   * v0.9.3 Mode B (internal reviewer follow-up 2026-04-29): when true, seeded rows are
   * tagged origin='production' instead of origin='simulation' so default
   * production-grade counters (Fleet table, /api/shield/stats default,
   * `productionOriginSqlClause` everywhere) include them.
   *
   * Use this for QA/demo/recording flows where the operator needs to see
   * non-zero default counters under known synthetic load. The
   * `simulation: true` + `simulation_run_id` + `simulation_source` tags
   * are still written regardless of mode, so reset always scopes by
   * simulation metadata (NOT by origin) and never touches real
   * production rows.
   *
   * Default: false (Mode A — safe simulation, excluded from default counters).
   */
  visibleToDefaultCounters?: boolean;
};

type InsertedCounts = {
  alerts: number;
  proxyTraffic: number;
  shieldScans: number;
  securityScans: number;
  securityCheckResults: number;
  metricSnapshots: number;
  correlationEvents: number;
  incidents: number;
};

type AlertSpec = {
  status: "open" | "acknowledged" | "investigating" | "resolved" | "suppressed" | "false_positive";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  source: string;
  title: string;
};

type TrafficSummary = {
  runId: string;
  alerts: {
    total: number;
    active: number;
    criticalOpen: number;
    terminal: number;
  };
  shield: {
    total: number;
    blocked: number;
    reviewed: number;
    allowed: number;
  };
  traffic: {
    total: number;
    blocked: number;
    p95LatencyMs: number;
    totalCostUsd: number;
  };
  posture: {
    scans: number;
    latestScore: number | null;
    latestGrade: string | null;
  };
  threatTrend: {
    points: number;
    latestScore: number | null;
  };
};

const ACTIVE_STATUSES = ["open", "acknowledged", "investigating"];
const TERMINAL_STATUSES = ["resolved", "suppressed", "false_positive"];

function isoAt(base: Date, minutesAgo: number): string {
  return new Date(base.getTime() - minutesAgo * 60_000).toISOString();
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function json(value: Record<string, unknown> | unknown[]): string {
  return JSON.stringify(value);
}

function rowId(prefix: string, runId: string, index?: number): string {
  return `${prefix}-${runId}${index === undefined ? "" : `-${String(index).padStart(2, "0")}`}`;
}

function profileScale(profile: Profile): number {
  if (profile === "quiet") return 0.5;
  if (profile === "intense") return 2;
  return 1;
}

function buildAlerts(profile: Profile): AlertSpec[] {
  // internal reviewer follow-up (2026-05-17, Blocker 6): alert titles + provenance
  // shape now reflect current policy-framework reality. Two alerts
  // explicitly cite OUT-PII Generic Egress Starter matches so demo
  // operators see the canonical wire-active outbound DLP narrative.
  const standard: AlertSpec[] = [
    { status: "open", severity: "CRITICAL", source: "shield", title: "Simulated prompt injection blocked (built-in JAIL-DAN-CLASSIC)" },
    { status: "open", severity: "CRITICAL", source: "clawkeeper", title: "Simulated exposed admin surface" },
    { status: "open", severity: "CRITICAL", source: "correlation-engine", title: "Simulated coordinated attack chain" },
    { status: "open", severity: "HIGH", source: "shield", title: "Simulated outbound PII leak — OUT-PII-EMAIL (Generic Egress Starter)" },
    { status: "acknowledged", severity: "HIGH", source: "proxy", title: "Simulated abnormal latency spike" },
    { status: "acknowledged", severity: "MEDIUM", source: "gateway", title: "Simulated model fallback drift" },
    { status: "investigating", severity: "HIGH", source: "correlation-engine", title: "Simulated repeated deny-list hit" },
    { status: "investigating", severity: "MEDIUM", source: "shield", title: "Simulated outbound PII review — OUT-PII-PHONE_US (Generic Egress Starter)" },
    { status: "open", severity: "LOW", source: "audit", title: "Simulated policy reminder" },
    { status: "resolved", severity: "HIGH", source: "clawkeeper", title: "Simulated stale key remediated" },
    { status: "suppressed", severity: "MEDIUM", source: "alerts", title: "Simulated accepted-risk finding" },
    { status: "false_positive", severity: "LOW", source: "shield", title: "Simulated benign prompt misfire" },
  ];

  if (profile === "quiet") return standard.slice(0, 6);
  if (profile === "intense") {
    return [
      ...standard,
      ...standard.map((a, idx) => ({ ...a, title: `${a.title} burst ${idx + 1}` })),
    ];
  }
  return standard;
}

function insertAlert(runId: string, spec: AlertSpec, index: number, now: Date, origin: Origin): void {
  const id = rowId("sim-alert", runId, index);
  const createdAt = isoAt(now, index * 3 + 1);
  const resolvedAt = TERMINAL_STATUSES.includes(spec.status) ? isoAt(now, index) : null;
  // Mode A vs Mode B (v0.9.3+ internal reviewer follow-up): origin is parameterized,
  // but `simulation: true` + simulation_run_id + simulation_source are
  // ALWAYS written so reset can scope by simulation metadata regardless
  // of mode, and so the active-runs ribbon can detect Mode B rows even
  // though their origin reads 'production'.
  // internal reviewer follow-up (2026-05-17, Blocker 6): alerts whose title references
  // an OUT-PII rule_key carry the full Generic Egress Starter provenance
  // in metadata so the alerts panel + audit log show the same shape live
  // wire alerts carry. Detected by substring scan on the title (kept simple
  // — the alert specs are the authoritative source).
  const outPiiMatch = spec.title.match(/OUT-PII-([A-Z0-9_]+)/);
  // Rule-level action is defined ONCE on the policy rule (Generic Egress
  // Starter OUT-PII-* rules ship with action='score' in v1) — the alert's
  // severity does NOT remap the action. Earlier fixture wired action to
  // severity, which produced action='review' for non-HIGH alerts and
  // misrepresented the real-system contract; the verifier-hardening pass
  // (internal reviewer 2026-05-16) caught this asymmetry against proxy_traffic.
  const policyProvenance = outPiiMatch ? {
    rule_key: `OUT-PII-${outPiiMatch[1]}`,
    policy_id: "00000000-0000-0000-0000-000000000ges",
    policy_name: "Generic Egress Starter",
    policy_source: "system",
    policy_rule_id: `sim-rule-out-pii-${outPiiMatch[1].toLowerCase()}`,
    direction: "outbound",
    category: "outbound-leak",
    action: "score",
  } : undefined;
  const metadata = {
    origin,
    simulation: true,
    simulation_run_id: runId,
    simulation_source: DASHBOARD_TRAFFIC_SOURCE,
    simulation_visibility: origin === ORIGIN_PRODUCTION ? "default-counters" : "simulation-only",
    scenario: "dashboard-population",
    agent_id: `sim-agent-${(index % 4) + 1}`,
    ...(policyProvenance ? { policy_provenance: policyProvenance } : {}),
  };
  run(
    `INSERT INTO alerts (id, title, description, severity, source, source_event_id, status, acknowledged_by, resolved_at, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      spec.title,
      `Synthetic dashboard fixture alert for run ${runId}. Safe to remove with this fixture's reset command.`,
      spec.severity,
      spec.source,
      rowId("sim-event", runId, index),
      spec.status,
      spec.status === "acknowledged" || spec.status === "investigating" ? "dashboard-fixture" : null,
      resolvedAt,
      json(metadata),
      createdAt,
      createdAt,
    ],
  );
}

function insertProxyTraffic(runId: string, profile: Profile, now: Date): number {
  const count = Math.round(48 * profileScale(profile));
  const models = ["openai/gpt-4.1-mini", "anthropic/claude-sonnet-4", "local/llama-3.1-8b", "google/gemini-2.5-flash"];
  const providers = ["openrouter", "anthropic", "lm-studio", "google"];
  for (let i = 0; i < count; i++) {
    const verdict = i % 7 === 0 ? "BLOCK" : i % 5 === 0 ? "REVIEW" : "ALLOW";
    const blocked = verdict === "BLOCK" ? 1 : 0;
    const inputTokens = 600 + i * 21;
    const outputTokens = 180 + i * 11;
    const totalTokens = inputTokens + outputTokens;
    const latency = 220 + ((i * 137) % 2600) + (blocked ? 850 : 0);
    run(
      `INSERT INTO proxy_traffic (id, timestamp, direction, model, provider, upstream_url, prompt_hash, messages_count, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, shield_verdict, shield_score, shield_detections, blocked, block_reason, session_id, status_code, error, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rowId("sim-proxy", runId, i + 1),
        isoAt(now, i * 2),
        i % 3 === 0 ? "inbound" : "outbound",
        models[i % models.length],
        providers[i % providers.length],
        `https://fixture.invalid/${providers[i % providers.length]}`,
        hash(`${runId}:proxy:${i}`),
        2 + (i % 6),
        inputTokens,
        outputTokens,
        totalTokens,
        Number((totalTokens * 0.0000025).toFixed(6)),
        latency,
        verdict,
        verdict === "BLOCK" ? 92 : verdict === "REVIEW" ? 68 : 12,
        // internal reviewer follow-up (2026-05-17, Blocker 6): seeded shield_detections
        // carry full policy-framework provenance — rule_key + policy_name +
        // policy_source + direction + category + action — so demo data
        // shows the same audit shape live wire detections carry. Outbound
        // rows attribute the OUT-PII match to Generic Egress Starter
        // (source=system, wire-active); inbound rows attribute the
        // jailbreak/prompt-injection match to the built-in scanner (no
        // policy id; built-in detections have no policy parent in v1).
        // NEGATIVE invariant: no OUT-PII rule_key is ever attributed to
        // ClawNex Default (verified by verify-dashboard-traffic-fixture).
        verdict === "ALLOW" ? json([]) : (i % 3 === 0
          ? json([{
              rule_key: "JAIL-DAN-CLASSIC",
              name: "Inbound jailbreak: DAN classic",
              policy_id: null,
              policy_name: null,
              policy_source: "built-in",
              direction: "inbound",
              category: "jailbreak",
              action: "block",
              severity: "CRITICAL",
              matchCount: 1,
              samples: ["[SIMULATED-JAILBREAK]"],
            }])
          : json([{
              rule_key: "OUT-PII-EMAIL",
              name: "Outbound PII: email",
              policy_id: "00000000-0000-0000-0000-000000000ges",
              policy_name: "Generic Egress Starter",
              policy_source: "system",
              direction: "outbound",
              category: "outbound-leak",
              action: "score",
              severity: "MEDIUM",
              matchCount: 1,
              samples: ["alice@example.com"],
            }])
        ),
        blocked,
        blocked ? "Synthetic prompt shield block" : null,
        `sim-${runId}-${String(i % 8).padStart(2, "0")}`,
        blocked ? 403 : 200,
        null,
        DASHBOARD_TRAFFIC_SOURCE,
      ],
    );
  }
  return count;
}

function insertShieldScans(runId: string, profile: Profile, now: Date, origin: Origin): number {
  const count = Math.round(18 * profileScale(profile));
  for (let i = 0; i < count; i++) {
    const verdict = i % 8 === 0 || i % 8 === 3 || i % 8 === 6 ? "BLOCK" : i % 4 === 1 ? "REVIEW" : "ALLOW";
    const score = verdict === "BLOCK" ? 90 + (i % 8) : verdict === "REVIEW" ? 62 + (i % 12) : 5 + (i % 20);
    const layers = verdict === "ALLOW" ? "none" : i % 2 === 0 ? "prompt_injection,secrets" : "tool_abuse,data_exfiltration";
    run(
      `INSERT INTO shield_scans (id, direction, source_session_id, source_agent_id, content_hash, layers_triggered, threat_level, detail, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rowId("sim-shield", runId, i + 1),
        i % 2 === 0 ? "inbound" : "outbound",
        `sim-${runId}-${String(i % 8).padStart(2, "0")}`,
        `sim-agent-${(i % 4) + 1}`,
        hash(`${runId}:shield:${i}`),
        layers,
        verdict,
        json({
          origin,
          simulation: true,
          simulation_run_id: runId,
          simulation_source: DASHBOARD_TRAFFIC_SOURCE,
          simulation_visibility: origin === ORIGIN_PRODUCTION ? "default-counters" : "simulation-only",
          score,
          detections: verdict === "ALLOW" ? 0 : 2 + (i % 3),
          elapsed: 11 + (i % 9),
          stats: { categories: layers === "none" ? [] : layers.split(",") },
        }),
        isoAt(now, i * 2 + 1),
      ],
    );
  }
  return count;
}

function insertSecurityScan(runId: string, now: Date): { scans: number; checks: number } {
  const scanId = rowId("sim-scan", runId);
  const checks = [
    ["env-001", "RBAC enabled", "Access Control", "pass", "HIGH"],
    ["env-002", "Session timeout configured", "Access Control", "pass", "MEDIUM"],
    ["sec-001", "HTTPS/TLS configured", "Transport", "fail", "HIGH"],
    ["sec-002", "Default API key rotated", "Secrets", "fail", "CRITICAL"],
    ["obs-001", "Audit logging active", "Observability", "pass", "MEDIUM"],
    ["obs-002", "Alert webhook configured", "Observability", "fail", "LOW"],
  ];
  run(
    `INSERT INTO security_scans (id, scanner, overall_grade, overall_score, total_checks, passed_checks, failed_checks, raw_output, parsed_results, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scanId,
      "dashboard-traffic-fixture",
      "D",
      52,
      checks.length,
      3,
      3,
      `Synthetic Host Security fixture run ${runId}`,
      json({ simulation: true, simulation_run_id: runId, score: 52, grade: "D" }),
      isoAt(now, 4),
    ],
  );
  checks.forEach((check, i) => {
    run(
      `INSERT INTO security_check_results (id, scan_id, check_id, check_name, category, status, severity, detail, remediation, sentinel_check_id, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rowId("sim-check", runId, i + 1),
        scanId,
        check[0],
        check[1],
        check[2],
        check[3],
        check[4],
        `Synthetic check result for dashboard fixture run ${runId}`,
        check[3] === "fail" ? "Review before release; this is synthetic fixture data." : null,
        `fixture-${check[0]}`,
        isoAt(now, 4),
      ],
    );
  });
  return { scans: 1, checks: checks.length };
}

function insertMetricSnapshots(runId: string, now: Date): number {
  const points = [18, 22, 26, 31, 45, 58, 64, 71, 67, 74, 69, 76];
  points.forEach((value, i) => {
    run(
      `INSERT INTO metric_snapshots (source, metric_name, metric_value, metadata, recorded_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        "correlation-engine",
        "threat_score",
        value,
        json({ simulation: true, simulation_run_id: runId, simulation_source: DASHBOARD_TRAFFIC_SOURCE }),
        isoAt(now, (points.length - i) * 5),
      ],
    );
  });
  return points.length;
}

function insertCorrelationEvents(runId: string, now: Date): number {
  const events = [
    ["Coordinated Attack Chain", "CRITICAL", "Shield block followed by high-latency proxy denial"],
    ["Repeated Prompt Injection", "HIGH", "Multiple agents received similar injection payloads"],
    ["Cost + Threat Spike", "MEDIUM", "Token burn rose while shield review volume increased"],
  ];
  events.forEach((event, i) => {
    run(
      `INSERT INTO correlation_events (id, correlation_rule, source_events, description, severity, alert_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        rowId("sim-corr", runId, i + 1),
        event[0],
        json([rowId("sim-alert", runId, i + 1), rowId("sim-shield", runId, i + 1)]),
        `${event[2]} — synthetic fixture run ${runId}`,
        event[1],
        rowId("sim-alert", runId, i + 1),
        isoAt(now, i * 6 + 2),
      ],
    );
  });
  return events.length;
}

function insertIncidents(runId: string, now: Date): number {
  const incidents = [
    ["Simulated active prompt attack", "CRITICAL", "open", [rowId("sim-alert", runId, 1), rowId("sim-alert", runId, 4)]],
    ["Simulated posture hardening gap", "HIGH", "investigating", [rowId("sim-alert", runId, 2), rowId("sim-alert", runId, 10)]],
  ] as const;
  incidents.forEach((incident, i) => {
    run(
      `INSERT INTO incidents (id, title, description, severity, status, alert_ids, timeline, root_cause, resolution, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rowId("sim-incident", runId, i + 1),
        incident[0],
        `Synthetic incident for dashboard fixture run ${runId}.`,
        incident[1],
        incident[2],
        json(incident[3] as unknown as string[]),
        json([{ at: isoAt(now, i * 8 + 1), event: "Fixture incident opened", simulation_run_id: runId }]),
        null,
        null,
        isoAt(now, i * 8 + 1),
        isoAt(now, i * 8 + 1),
      ],
    );
  });
  return incidents.length;
}

export function resetDashboardTraffic(runId: string): InsertedCounts {
  const counts: InsertedCounts = {
    alerts: 0,
    proxyTraffic: 0,
    shieldScans: 0,
    securityScans: 0,
    securityCheckResults: 0,
    metricSnapshots: 0,
    correlationEvents: 0,
    incidents: 0,
  };

  transaction(() => {
    counts.securityCheckResults = run(
      `DELETE FROM security_check_results WHERE scan_id IN (SELECT id FROM security_scans WHERE json_extract(parsed_results, '$.simulation_run_id') = ?)`,
      [runId],
    ).changes;
    counts.incidents = run(`DELETE FROM incidents WHERE id LIKE ?`, [`sim-incident-${runId}-%`]).changes;
    counts.correlationEvents = run(`DELETE FROM correlation_events WHERE id LIKE ?`, [`sim-corr-${runId}-%`]).changes;
    counts.metricSnapshots = run(
      `DELETE FROM metric_snapshots WHERE json_extract(metadata, '$.simulation_run_id') = ?`,
      [runId],
    ).changes;
    counts.proxyTraffic = run(
      `DELETE FROM proxy_traffic WHERE source = ? AND session_id LIKE ?`,
      [DASHBOARD_TRAFFIC_SOURCE, `sim-${runId}-%`],
    ).changes;
    counts.shieldScans = run(
      `DELETE FROM shield_scans WHERE json_extract(detail, '$.simulation_run_id') = ?`,
      [runId],
    ).changes;
    counts.alerts = run(
      `DELETE FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ?`,
      [runId],
    ).changes;
    counts.securityScans = run(
      `DELETE FROM security_scans WHERE json_extract(parsed_results, '$.simulation_run_id') = ?`,
      [runId],
    ).changes;
  });

  return counts;
}

/**
 * Reset every simulation row regardless of run-id. Used by the
 * "Reset All Simulation" button in Configuration -> System Management ->
 * Developer Tools, and by `npm run fixture:reset:all` (when those
 * aliases land).
 *
 * v0.9.3+ internal reviewer follow-up (2026-04-29): scope deletes by the
 * `simulation: true` flag in the row metadata, NOT by origin='simulation'.
 * Mode B rows write origin='production' but still carry simulation: true,
 * so the previous origin-based scope would have missed them. Scoping by
 * the simulation flag catches both modes; origin is checked as a
 * defense-in-depth fallback for legacy/orphaned rows that may have
 * been written before the simulation flag was canonical.
 *
 * Safer than chaining individual resetDashboardTraffic() calls because
 * (a) one transaction across all runs, (b) catches orphaned rows where
 * the simulation_run_id was lost or never written, (c) deletes by
 * simulation metadata not origin so Mode B rows are removable.
 *
 * SAFETY: real production rows (no simulation: true tag, no
 * simulation_run_id) are never matched by these predicates. The
 * fixture wrote the tags; only the fixture's reset removes them.
 */
export function resetAllDashboardTraffic(): { runsRemoved: number; removed: InsertedCounts } {
  const removed: InsertedCounts = {
    alerts: 0,
    proxyTraffic: 0,
    shieldScans: 0,
    securityScans: 0,
    securityCheckResults: 0,
    metricSnapshots: 0,
    correlationEvents: 0,
    incidents: 0,
  };

  // Count distinct simulation_run_ids before the wipe so we can report
  // how many runs were collapsed in. Match by simulation: true flag so
  // both Mode A and Mode B runs are counted.
  const runsRow = queryOne<{ cnt: number }>(
    `SELECT COUNT(DISTINCT json_extract(metadata, '$.simulation_run_id')) as cnt
       FROM alerts
       WHERE (json_extract(metadata, '$.simulation') = 1
              OR json_extract(metadata, '$.simulation') = true
              OR json_extract(metadata, '$.origin') = 'simulation')`,
  );
  const runsRemoved = runsRow?.cnt ?? 0;

  transaction(() => {
    removed.securityCheckResults = run(
      `DELETE FROM security_check_results WHERE scan_id IN (SELECT id FROM security_scans WHERE json_extract(parsed_results, '$.simulation') = 1 OR json_extract(parsed_results, '$.simulation') = true OR json_extract(parsed_results, '$.origin') = 'simulation')`,
    ).changes;
    removed.incidents = run(`DELETE FROM incidents WHERE id LIKE 'sim-incident-%'`).changes;
    removed.correlationEvents = run(`DELETE FROM correlation_events WHERE id LIKE 'sim-corr-%'`).changes;
    removed.metricSnapshots = run(
      `DELETE FROM metric_snapshots WHERE json_extract(metadata, '$.simulation') = 1 OR json_extract(metadata, '$.simulation') = true OR json_extract(metadata, '$.origin') = 'simulation'`,
    ).changes;
    removed.proxyTraffic = run(
      `DELETE FROM proxy_traffic WHERE source = ?`,
      [DASHBOARD_TRAFFIC_SOURCE],
    ).changes;
    removed.shieldScans = run(
      `DELETE FROM shield_scans WHERE json_extract(detail, '$.simulation') = 1 OR json_extract(detail, '$.simulation') = true OR json_extract(detail, '$.origin') = 'simulation'`,
    ).changes;
    removed.alerts = run(
      `DELETE FROM alerts WHERE json_extract(metadata, '$.simulation') = 1 OR json_extract(metadata, '$.simulation') = true OR json_extract(metadata, '$.origin') = 'simulation'`,
    ).changes;
    removed.securityScans = run(
      `DELETE FROM security_scans WHERE json_extract(parsed_results, '$.simulation') = 1 OR json_extract(parsed_results, '$.simulation') = true OR json_extract(parsed_results, '$.origin') = 'simulation'`,
    ).changes;
  });

  return { runsRemoved, removed };
}

export function seedDashboardTraffic(options: SeedOptions = {}): { runId: string; profile: Profile; inserted: InsertedCounts; visibleToDefaultCounters: boolean } {
  const runId = options.runId ?? `dash-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const profile = options.profile ?? "standard";
  const now = options.now ?? new Date();
  const visibleToDefaultCounters = Boolean(options.visibleToDefaultCounters);
  if (!["standard", "intense", "quiet"].includes(profile)) {
    throw new Error(`Invalid profile '${profile}'. Use standard, intense, or quiet.`);
  }

  // Mode A (default): origin='simulation' -> default counters exclude.
  // Mode B (visibleToDefaultCounters): origin='production' -> default
  // counters include. Reset still scopes by simulation metadata, so
  // Mode B rows are precisely removable and never confused with real
  // production data.
  const origin: Origin = visibleToDefaultCounters ? ORIGIN_PRODUCTION : ORIGIN_SIMULATION;

  const inserted: InsertedCounts = {
    alerts: 0,
    proxyTraffic: 0,
    shieldScans: 0,
    securityScans: 0,
    securityCheckResults: 0,
    metricSnapshots: 0,
    correlationEvents: 0,
    incidents: 0,
  };

  transaction(() => {
    resetDashboardTraffic(runId);
    const alerts = buildAlerts(profile);
    alerts.forEach((alert, index) => insertAlert(runId, alert, index + 1, now, origin));
    inserted.alerts = alerts.length;
    inserted.proxyTraffic = insertProxyTraffic(runId, profile, now);
    inserted.shieldScans = insertShieldScans(runId, profile, now, origin);
    const scan = insertSecurityScan(runId, now);
    inserted.securityScans = scan.scans;
    inserted.securityCheckResults = scan.checks;
    inserted.metricSnapshots = insertMetricSnapshots(runId, now);
    inserted.correlationEvents = insertCorrelationEvents(runId, now);
    inserted.incidents = insertIncidents(runId, now);
  });

  return { runId, profile, inserted, visibleToDefaultCounters };
}

export function summarizeDashboardTraffic(runId: string): TrafficSummary {
  const alertCounts = queryOne<{ total: number; active: number; criticalOpen: number; terminal: number }>(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('open','acknowledged','investigating') THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'open' AND severity = 'CRITICAL' THEN 1 ELSE 0 END) as criticalOpen,
      SUM(CASE WHEN status IN ('resolved','suppressed','false_positive') THEN 1 ELSE 0 END) as terminal
     FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ?`,
    [runId],
  );
  const shieldCounts = queryOne<{ total: number; blocked: number; reviewed: number; allowed: number }>(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN threat_level = 'BLOCK' THEN 1 ELSE 0 END) as blocked,
      SUM(CASE WHEN threat_level = 'REVIEW' THEN 1 ELSE 0 END) as reviewed,
      SUM(CASE WHEN threat_level = 'ALLOW' THEN 1 ELSE 0 END) as allowed
     FROM shield_scans WHERE json_extract(detail, '$.simulation_run_id') = ?`,
    [runId],
  );
  const traffic = queryOne<{ total: number; blocked: number; p95LatencyMs: number | null; totalCostUsd: number | null }>(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked,
      MAX(latency_ms) as p95LatencyMs,
      SUM(cost_usd) as totalCostUsd
     FROM proxy_traffic WHERE source = ? AND session_id LIKE ?`,
    [DASHBOARD_TRAFFIC_SOURCE, `sim-${runId}-%`],
  );
  const posture = queryOne<{ scans: number; latestScore: number | null; latestGrade: string | null }>(
    `SELECT COUNT(*) as scans, overall_score as latestScore, overall_grade as latestGrade
     FROM security_scans WHERE json_extract(parsed_results, '$.simulation_run_id') = ? ORDER BY scanned_at DESC LIMIT 1`,
    [runId],
  );
  const trend = queryOne<{ points: number; latestScore: number | null }>(
    `SELECT COUNT(*) as points, (SELECT metric_value FROM metric_snapshots WHERE json_extract(metadata, '$.simulation_run_id') = ? AND metric_name = 'threat_score' ORDER BY recorded_at DESC LIMIT 1) as latestScore
     FROM metric_snapshots WHERE json_extract(metadata, '$.simulation_run_id') = ? AND metric_name = 'threat_score'`,
    [runId, runId],
  );

  return {
    runId,
    alerts: {
      total: alertCounts?.total ?? 0,
      active: alertCounts?.active ?? 0,
      criticalOpen: alertCounts?.criticalOpen ?? 0,
      terminal: alertCounts?.terminal ?? 0,
    },
    shield: {
      total: shieldCounts?.total ?? 0,
      blocked: shieldCounts?.blocked ?? 0,
      reviewed: shieldCounts?.reviewed ?? 0,
      allowed: shieldCounts?.allowed ?? 0,
    },
    traffic: {
      total: traffic?.total ?? 0,
      blocked: traffic?.blocked ?? 0,
      p95LatencyMs: traffic?.p95LatencyMs ?? 0,
      totalCostUsd: Number((traffic?.totalCostUsd ?? 0).toFixed(6)),
    },
    posture: {
      scans: posture?.scans ?? 0,
      latestScore: posture?.latestScore ?? null,
      latestGrade: posture?.latestGrade ?? null,
    },
    threatTrend: {
      points: trend?.points ?? 0,
      latestScore: trend?.latestScore ?? null,
    },
  };
}

function printUsage(): void {
  console.log(`ClawNex dashboard traffic fixture

Usage:
  npx tsx scripts/dashboard-traffic-fixture.ts seed [--run-id ID] [--profile standard|quiet|intense] [--visible-to-default-counters]
  npx tsx scripts/dashboard-traffic-fixture.ts summary --run-id ID
  npx tsx scripts/dashboard-traffic-fixture.ts reset --run-id ID
  npx tsx scripts/dashboard-traffic-fixture.ts reset-all

Provenance (v0.9.3+):
  Two modes, both safe to reset:

  Mode A (default — origin='simulation'):
    Default dashboard counters do NOT count these as production evidence.
    To see them in panels, pass ?includeTestGenerated=true on the relevant
    API route, or use Configuration -> System Management -> Developer Tools
    in the dashboard.

  Mode B (--visible-to-default-counters — origin='production'):
    internal reviewer follow-up 2026-04-29 + operator requirement: tagged origin='production'
    so default Fleet/Shield/header counters DO light up. Still tagged with
    simulation: true + simulation_run_id + simulation_source so reset only
    touches fixture rows. Use for QA/demo/M-01-recording flows where the
    dashboard must look populated under known synthetic load.

  In both modes, reset matches by simulation: true OR simulation_run_id —
  never by origin alone — so real production rows are never touched.

Safety:
  Use only on local/QA/demo databases. Customer-prod installs lock this
  feature out via CLAWNEX_DEV_TOOLS_DISABLED=1 in .env.local.
  Every row is tagged with simulation_run_id and removed with reset.
`);
}

function parseArgs(argv: string[]): { command: string; runId?: string; profile?: Profile; visibleToDefaultCounters?: boolean } {
  const [command = "help", ...rest] = argv;
  const parsed: { command: string; runId?: string; profile?: Profile; visibleToDefaultCounters?: boolean } = { command };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--run-id") parsed.runId = rest[++i];
    else if (arg.startsWith("--run-id=")) parsed.runId = arg.slice("--run-id=".length);
    else if (arg === "--profile") parsed.profile = rest[++i] as Profile;
    else if (arg.startsWith("--profile=")) parsed.profile = arg.slice("--profile=".length) as Profile;
    else if (arg === "--visible-to-default-counters") parsed.visibleToDefaultCounters = true;
  }
  return parsed;
}

export function runDashboardTrafficFixtureCli(argv: string[] = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    printUsage();
    return;
  }
  if ((args.command === "summary" || args.command === "reset") && !args.runId) {
    throw new Error(`${args.command} requires --run-id`);
  }

  if (args.command === "seed") {
    const result = seedDashboardTraffic({
      runId: args.runId,
      profile: args.profile,
      visibleToDefaultCounters: args.visibleToDefaultCounters,
    });
    const summary = summarizeDashboardTraffic(result.runId);
    console.log(JSON.stringify({ action: "seed", ...result, summary }, null, 2));
    return;
  }

  if (args.command === "summary") {
    console.log(JSON.stringify({ action: "summary", summary: summarizeDashboardTraffic(args.runId!) }, null, 2));
    return;
  }

  if (args.command === "reset") {
    const removed = resetDashboardTraffic(args.runId!);
    console.log(JSON.stringify({ action: "reset", runId: args.runId, removed }, null, 2));
    return;
  }

  if (args.command === "reset-all") {
    const result = resetAllDashboardTraffic();
    console.log(JSON.stringify({ action: "reset-all", ...result }, null, 2));
    return;
  }

  printUsage();
  throw new Error(`Unknown command '${args.command}'`);
}
