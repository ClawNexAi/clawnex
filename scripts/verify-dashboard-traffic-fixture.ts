/**
 * Verification for scripts/dashboard-traffic-fixture.ts.
 *
 * Run: npx tsx scripts/verify-dashboard-traffic-fixture.ts
 *
 * Uses an in-memory SQLite DB so the fixture can be tested without touching
 * the operator's real ClawNex database.
 */
process.env.DATABASE_PATH = ":memory:";
process.env.CLAWNEX_AUDIT_STDOUT = "false";

import { queryOne, run as dbRun } from "../src/lib/db/index";
import {
  DASHBOARD_TRAFFIC_SOURCE,
  resetAllDashboardTraffic,
  resetDashboardTraffic,
  seedDashboardTraffic,
  summarizeDashboardTraffic,
} from "./dashboard-traffic-fixture";
// B4 (2026-05-16) — Mission Control demo fixtures must stay internally
// consistent with mock-data so demoMode walkthroughs don't show
// contradictory counts between the cockpit and the deep-work tabs.
import {
  ACTIVE_INCIDENTS_DEMO,
  EVIDENCE_CONFIDENCE_DEMO,
  SHIELD_ACTIVITY_DEMO,
  POLICY_COVERAGE_DEMO,
  COST_RISK_DEMO,
  COLLECTOR_HEALTH_FIXTURE_DEMO,
  POSTURE_SCORES_DEMO,
  INCIDENT_AGING_DEMO,
  ACTION_QUEUE_DEMO,
} from "../src/components/dashboard/panels/mission-control/demo-fixtures";
import { ALERTS_D } from "../src/components/dashboard/mock-data";

type Status = { pass: number; fail: number };
const status: Status = { pass: 0, fail: 0 };

function assert(cond: unknown, desc: string) {
  if (cond) {
    status.pass++;
    console.log(`  ✓ ${desc}`);
  } else {
    status.fail++;
    console.log(`  ✗ ${desc}`);
  }
}

function section(name: string) {
  console.log(`\n[${name}]`);
}

function scalar(sql: string, params: unknown[] = []): number {
  return queryOne<{ cnt: number }>(sql, params)?.cnt ?? 0;
}

section("seed: creates a deterministic, dashboard-visible run");
const run = seedDashboardTraffic({ runId: "verify-run", profile: "standard", now: new Date("2026-04-29T12:00:00.000Z") });
assert(run.runId === "verify-run", "seed returns the requested run id");
assert(run.inserted.alerts === 12, "standard profile inserts 12 alerts");
assert(run.inserted.proxyTraffic === 48, "standard profile inserts 48 proxy traffic rows");
assert(run.inserted.shieldScans === 18, "standard profile inserts 18 shield scans");
assert(run.inserted.securityScans === 1, "standard profile inserts one posture scan");
assert(run.inserted.metricSnapshots === 12, "standard profile inserts 12 threat trend points");
assert(run.inserted.correlationEvents === 3, "standard profile inserts 3 correlation events");
assert(run.inserted.incidents === 2, "standard profile inserts 2 incidents");

section("seed: records are tagged with origin='simulation' and excluded from production-grade dashboard counters by default (v0.9.3+)");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ?", ["verify-run"]) === 12, "all alerts carry simulation_run_id");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.origin') = 'simulation'") === 12, "alerts use origin='simulation' so they DO NOT pollute production counters by default (v0.9.3+ change from origin='production')");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.origin') IN ('production','manual')") === 0, "no fixture rows leak into production-grade alert counters");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE status IN ('open','acknowledged','investigating')") === 9, "active alert set is 9 records (status-based count, origin-agnostic)");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE status = 'open' AND severity = 'CRITICAL'") === 3, "header critical-open count would be 3 if origin filter weren't applied (sanity)");
assert(scalar("SELECT COUNT(*) as cnt FROM proxy_traffic WHERE source = ?", [DASHBOARD_TRAFFIC_SOURCE]) === 48, "proxy traffic source is tagged");
assert(scalar("SELECT COUNT(*) as cnt FROM shield_scans WHERE json_extract(detail, '$.simulation_run_id') = ?", ["verify-run"]) === 18, "shield scans carry simulation_run_id");
assert(scalar("SELECT COUNT(*) as cnt FROM shield_scans WHERE json_extract(detail, '$.origin') = 'simulation'") === 18, "shield scans use origin='simulation' (default Shield History/stats filter them out; ?includeTestGenerated=true unlocks)");
assert(scalar("SELECT COUNT(*) as cnt FROM shield_scans WHERE json_extract(detail, '$.origin') IN ('production','manual')") === 0, "no fixture rows leak into default Shield History/stats counters");

section("summary: reports the same semantic counts used by the dashboard");
const summary = summarizeDashboardTraffic("verify-run");
assert(summary.alerts.total === 12, "summary total alerts = 12");
assert(summary.alerts.active === 9, "summary active alerts = 9");
assert(summary.alerts.criticalOpen === 3, "summary critical-open alerts = 3");
assert(summary.shield.blocked === 7, "summary shield blocked = 7");
assert(summary.traffic.blocked === 7, "summary proxy blocked = 7");
assert(summary.posture.latestScore === 52, "summary posture score = 52");
assert(summary.threatTrend.points === 12, "summary threat trend points = 12");

section("idempotency: reseeding same run replaces old rows, not doubles them");
seedDashboardTraffic({ runId: "verify-run", profile: "standard", now: new Date("2026-04-29T12:00:00.000Z") });
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ?", ["verify-run"]) === 12, "same run id remains 12 alerts after reseed");
assert(scalar("SELECT COUNT(*) as cnt FROM proxy_traffic WHERE session_id LIKE ?", ["sim-verify-run-%"]) === 48, "same run id remains 48 traffic rows after reseed");

section("profiles: intense profile increases pressure while preserving semantics");
const intense = seedDashboardTraffic({ runId: "verify-intense", profile: "intense", now: new Date("2026-04-29T12:05:00.000Z") });
assert(intense.inserted.alerts > run.inserted.alerts, "intense profile creates more alerts than standard");
assert(intense.inserted.proxyTraffic > run.inserted.proxyTraffic, "intense profile creates more traffic than standard");

section("reset: removes only tagged simulation data");
const removed = resetDashboardTraffic("verify-run");
assert(removed.alerts === 12, "reset removes verify-run alerts");
assert(removed.proxyTraffic === 48, "reset removes verify-run proxy traffic");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ?", ["verify-run"]) === 0, "verify-run alerts gone");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ?", ["verify-intense"]) > 0, "other simulation run remains");

// Clean slate for Mode B tests below.
resetAllDashboardTraffic();

section("Mode B: --visible-to-default-counters writes origin='production' so default counters light up (internal reviewer follow-up 2026-04-29)");
const modeB = seedDashboardTraffic({
  runId: "verify-mode-b",
  profile: "standard",
  visibleToDefaultCounters: true,
  now: new Date("2026-04-29T13:00:00.000Z"),
});
assert(modeB.visibleToDefaultCounters === true, "seed result reports visibleToDefaultCounters=true");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ?", ["verify-mode-b"]) === 12, "Mode B inserts 12 alerts under the run id");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ? AND json_extract(metadata, '$.origin') = 'production'", ["verify-mode-b"]) === 12, "Mode B alerts use origin='production' (NOT 'simulation')");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ? AND json_extract(metadata, '$.simulation') = 1", ["verify-mode-b"]) === 12, "Mode B alerts STILL carry simulation: true so reset can match by simulation metadata");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ? AND json_extract(metadata, '$.simulation_visibility') = 'default-counters'", ["verify-mode-b"]) === 12, "Mode B alerts carry simulation_visibility='default-counters' for explicit provenance");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ? AND json_extract(metadata, '$.origin') IN ('production','manual')", ["verify-mode-b"]) === 12, "Mode B alerts ARE included in productionOriginSqlClause filter (the load-test contract)");
assert(scalar("SELECT COUNT(*) as cnt FROM shield_scans WHERE json_extract(detail, '$.simulation_run_id') = ? AND json_extract(detail, '$.origin') = 'production'", ["verify-mode-b"]) === 18, "Mode B shield scans use origin='production' so default getShieldStats includes them");
assert(scalar("SELECT COUNT(*) as cnt FROM shield_scans WHERE json_extract(detail, '$.simulation_run_id') = ? AND json_extract(detail, '$.simulation') = 1", ["verify-mode-b"]) === 18, "Mode B shield scans STILL carry simulation: true for safe reset scoping");

section("Mode B: per-run reset removes Mode B rows even though origin='production'");
const removedB = resetDashboardTraffic("verify-mode-b");
assert(removedB.alerts === 12, "reset removes all 12 Mode B alerts");
assert(removedB.shieldScans === 18, "reset removes all 18 Mode B shield scans");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ?", ["verify-mode-b"]) === 0, "Mode B run gone after per-run reset");

section("reset-all: catches both Mode A and Mode B rows by simulation flag (not by origin)");
seedDashboardTraffic({ runId: "ra-mode-a", profile: "quiet", now: new Date("2026-04-29T14:00:00.000Z") });
seedDashboardTraffic({ runId: "ra-mode-b", profile: "quiet", visibleToDefaultCounters: true, now: new Date("2026-04-29T14:01:00.000Z") });
const beforeAlerts = scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation') = 1");
assert(beforeAlerts >= 2, "both Mode A and Mode B alerts present before reset-all");
const allReset = resetAllDashboardTraffic();
assert(allReset.runsRemoved >= 2, "reset-all reports >=2 distinct runs removed (Mode A + Mode B)");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation') = 1") === 0, "no alerts with simulation flag remain after reset-all");
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.origin') = 'simulation'") === 0, "no Mode A alerts remain");
assert(scalar("SELECT COUNT(*) as cnt FROM shield_scans WHERE json_extract(detail, '$.simulation') = 1") === 0, "no shield scans with simulation flag remain after reset-all");

section("policy-framework provenance: seeded shield_detections carry Generic Egress Starter attribution for OUT-PII (internal reviewer 2026-05-17 Blocker 6)");
// Seed a clean run for these probes (the earlier reset-all already cleared).
seedDashboardTraffic({ runId: "verify-prov", profile: "standard", now: new Date("2026-04-29T16:00:00.000Z") });

// Positive: at least one proxy_traffic row carries OUT-PII-EMAIL attributed
// to Generic Egress Starter (source=system). The fixture alternates OUT-PII
// (i % 3 !== 0) with built-in JAIL-DAN-CLASSIC (i % 3 === 0) for non-ALLOW
// verdicts, so the OUT-PII shape should appear on multiple rows.
assert(
  scalar(
    "SELECT COUNT(*) as cnt FROM proxy_traffic WHERE source = ? AND shield_verdict != 'ALLOW' AND shield_detections LIKE '%OUT-PII-EMAIL%' AND shield_detections LIKE '%Generic Egress Starter%' AND shield_detections LIKE '%\"policy_source\":\"system\"%'",
    [DASHBOARD_TRAFFIC_SOURCE],
  ) > 0,
  "fixture seeds at least one OUT-PII-EMAIL detection attributed to Generic Egress Starter with policy_source=system",
);

// Positive: at least one alert metadata blob carries the OUT-PII
// policy_provenance object (the buildAlerts spec hard-codes two of these:
// ALT-004 OUT-PII-EMAIL + ALT-008 OUT-PII-PHONE_US).
assert(
  scalar(
    "SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.simulation_run_id') = ? AND json_extract(metadata, '$.policy_provenance.policy_name') = 'Generic Egress Starter' AND json_extract(metadata, '$.policy_provenance.policy_source') = 'system'",
    ["verify-prov"],
  ) >= 2,
  "fixture seeds >= 2 alerts with policy_provenance attributing OUT-PII match to Generic Egress Starter (source=system)",
);

// NEGATIVE invariant (the most important one): NO OUT-PII rule_key is ever
// attributed to ClawNex Default in seeded data. ClawNex Default mirrors
// ALL_RULES (inbound jailbreak / cog-tamper / secrets); OUT-PII rules live
// in Generic Egress Starter only. Any seeded row that attributes OUT-PII
// to ClawNex Default is a doc/fixture bug.
assert(
  scalar(
    "SELECT COUNT(*) as cnt FROM proxy_traffic WHERE source = ? AND shield_detections LIKE '%OUT-PII%' AND shield_detections LIKE '%ClawNex Default%'",
    [DASHBOARD_TRAFFIC_SOURCE],
  ) === 0,
  "NEGATIVE: no proxy_traffic row attributes an OUT-PII rule_key to ClawNex Default (OUT-PII lives in Generic Egress Starter, not the curated mirror)",
);
assert(
  scalar(
    "SELECT COUNT(*) as cnt FROM alerts WHERE json_extract(metadata, '$.policy_provenance.rule_key') LIKE 'OUT-PII-%' AND json_extract(metadata, '$.policy_provenance.policy_name') = 'ClawNex Default'",
  ) === 0,
  "NEGATIVE: no alert metadata attributes an OUT-PII rule_key to ClawNex Default",
);

// ---------------------------------------------------------------------------
// Verifier hardening (internal reviewer 2026-05-16 non-blocking tightening): assert
// direction / category / action on EVERY OUT-PII provenance row. Previously
// we only asserted policy_name + policy_source — direction / category /
// action were trusted to be correct in the fixture but never proven by the
// verifier. Use SQLite json_each() to iterate the proxy_traffic
// shield_detections JSON array and the alert metadata, then count violators.
// Each invariant: rows where the rule_key starts with OUT-PII- but the
// field doesn't match the contract → expected 0.
// ---------------------------------------------------------------------------
section("policy-framework provenance: direction/category/action contract on every OUT-PII row (internal reviewer 2026-05-16 verifier hardening)");

// First: confirm we have non-zero OUT-PII rows to verify against — otherwise
// the violator counts below could pass vacuously on an empty fixture.
const proxyOutPiiTotal = scalar(
  `SELECT COUNT(*) as cnt FROM proxy_traffic, json_each(proxy_traffic.shield_detections) det
   WHERE proxy_traffic.source = ?
     AND json_extract(det.value, '$.rule_key') LIKE 'OUT-PII-%'`,
  [DASHBOARD_TRAFFIC_SOURCE],
);
assert(proxyOutPiiTotal > 0, `precondition: fixture has at least one OUT-PII proxy_traffic detection (${proxyOutPiiTotal} found)`);

const proxyDirViolators = scalar(
  `SELECT COUNT(*) as cnt FROM proxy_traffic, json_each(proxy_traffic.shield_detections) det
   WHERE proxy_traffic.source = ?
     AND json_extract(det.value, '$.rule_key') LIKE 'OUT-PII-%'
     AND COALESCE(json_extract(det.value, '$.direction'), '') != 'outbound'`,
  [DASHBOARD_TRAFFIC_SOURCE],
);
assert(proxyDirViolators === 0, `every OUT-PII proxy_traffic detection has direction='outbound' (${proxyDirViolators} violators)`);

const proxyCatViolators = scalar(
  `SELECT COUNT(*) as cnt FROM proxy_traffic, json_each(proxy_traffic.shield_detections) det
   WHERE proxy_traffic.source = ?
     AND json_extract(det.value, '$.rule_key') LIKE 'OUT-PII-%'
     AND COALESCE(json_extract(det.value, '$.category'), '') != 'outbound-leak'`,
  [DASHBOARD_TRAFFIC_SOURCE],
);
assert(proxyCatViolators === 0, `every OUT-PII proxy_traffic detection has category='outbound-leak' (${proxyCatViolators} violators)`);

const proxyActionViolators = scalar(
  `SELECT COUNT(*) as cnt FROM proxy_traffic, json_each(proxy_traffic.shield_detections) det
   WHERE proxy_traffic.source = ?
     AND json_extract(det.value, '$.rule_key') LIKE 'OUT-PII-%'
     AND COALESCE(json_extract(det.value, '$.action'), '') != 'score'`,
  [DASHBOARD_TRAFFIC_SOURCE],
);
assert(proxyActionViolators === 0, `every OUT-PII proxy_traffic detection has action='score' (${proxyActionViolators} violators)`);

// Same triad on alert metadata's policy_provenance object.
const alertOutPiiTotal = scalar(
  `SELECT COUNT(*) as cnt FROM alerts
   WHERE json_extract(metadata, '$.simulation_run_id') = ?
     AND json_extract(metadata, '$.policy_provenance.rule_key') LIKE 'OUT-PII-%'`,
  ["verify-prov"],
);
assert(alertOutPiiTotal > 0, `precondition: fixture has at least one OUT-PII alert with policy_provenance (${alertOutPiiTotal} found)`);

const alertDirViolators = scalar(
  `SELECT COUNT(*) as cnt FROM alerts
   WHERE json_extract(metadata, '$.simulation_run_id') = ?
     AND json_extract(metadata, '$.policy_provenance.rule_key') LIKE 'OUT-PII-%'
     AND COALESCE(json_extract(metadata, '$.policy_provenance.direction'), '') != 'outbound'`,
  ["verify-prov"],
);
assert(alertDirViolators === 0, `every OUT-PII alert provenance has direction='outbound' (${alertDirViolators} violators)`);

const alertCatViolators = scalar(
  `SELECT COUNT(*) as cnt FROM alerts
   WHERE json_extract(metadata, '$.simulation_run_id') = ?
     AND json_extract(metadata, '$.policy_provenance.rule_key') LIKE 'OUT-PII-%'
     AND COALESCE(json_extract(metadata, '$.policy_provenance.category'), '') != 'outbound-leak'`,
  ["verify-prov"],
);
assert(alertCatViolators === 0, `every OUT-PII alert provenance has category='outbound-leak' (${alertCatViolators} violators)`);

const alertActionViolators = scalar(
  `SELECT COUNT(*) as cnt FROM alerts
   WHERE json_extract(metadata, '$.simulation_run_id') = ?
     AND json_extract(metadata, '$.policy_provenance.rule_key') LIKE 'OUT-PII-%'
     AND COALESCE(json_extract(metadata, '$.policy_provenance.action'), '') != 'score'`,
  ["verify-prov"],
);
assert(alertActionViolators === 0, `every OUT-PII alert provenance has action='score' (${alertActionViolators} violators)`);

// ---------------------------------------------------------------------------
// B4 (2026-05-16) — Mission Control demo fixtures must (a) be non-empty so
// every card has something to render in demoMode, (b) match the active-scope
// subset of ALERTS_D so cockpit counts agree with the AlertsIncidents demo
// rendering, and (c) keep at least one non-green posture row so demo state
// is informative rather than uniformly-rubber-stamp.
// ---------------------------------------------------------------------------
section("mission-control: demo fixtures non-empty (every card renders meaningful demo)");
assert(ACTIVE_INCIDENTS_DEMO.total > 0, "ACTIVE_INCIDENTS_DEMO.total > 0");
assert(EVIDENCE_CONFIDENCE_DEMO.total > 0, "EVIDENCE_CONFIDENCE_DEMO.total > 0");
assert(SHIELD_ACTIVITY_DEMO.total > 0, "SHIELD_ACTIVITY_DEMO.total > 0");
assert((SHIELD_ACTIVITY_DEMO.hourlyBuckets?.length ?? 0) === 24, "SHIELD_ACTIVITY_DEMO has 24 hourly buckets");
assert(POLICY_COVERAGE_DEMO.coreRules === 163, "POLICY_COVERAGE_DEMO tracks the 163 core-rules baseline");
assert(COST_RISK_DEMO.perSource.length >= 2, "COST_RISK_DEMO has at least 2 per-source rows");
assert(COLLECTOR_HEALTH_FIXTURE_DEMO.collectors.length >= 3, "COLLECTOR_HEALTH_FIXTURE_DEMO has at least 3 collectors");
assert(POSTURE_SCORES_DEMO.length === 5, "POSTURE_SCORES_DEMO has all 5 score rows");
assert(INCIDENT_AGING_DEMO.length === 5, "INCIDENT_AGING_DEMO has all 5 aging buckets");
assert(ACTION_QUEUE_DEMO.length >= 5, "ACTION_QUEUE_DEMO has at least 5 items");

section("mission-control: ACTIVE_INCIDENTS_DEMO matches ALERTS_D active-scope subset (cross-fixture consistency)");
// ALERTS_D uses uppercase status strings; the spec §5.1 active scope is
// status IN ('OPEN','INVESTIGATING','SUPPRESSED') after upper-casing.
const alertsDActive = ALERTS_D.filter((a) => ["OPEN", "INVESTIGATING", "SUPPRESSED"].includes(a.status));
assert(
  ACTIVE_INCIDENTS_DEMO.total === alertsDActive.length,
  `ACTIVE_INCIDENTS_DEMO.total (${ACTIVE_INCIDENTS_DEMO.total}) equals ALERTS_D active-scope count (${alertsDActive.length})`,
);
const alertsDOpen = alertsDActive.filter((a) => a.status === "OPEN").length;
const alertsDInvestigating = alertsDActive.filter((a) => a.status === "INVESTIGATING").length;
assert(ACTIVE_INCIDENTS_DEMO.open === alertsDOpen, `ACTIVE_INCIDENTS_DEMO.open (${ACTIVE_INCIDENTS_DEMO.open}) equals ALERTS_D OPEN count (${alertsDOpen})`);
assert(ACTIVE_INCIDENTS_DEMO.investigating === alertsDInvestigating, `ACTIVE_INCIDENTS_DEMO.investigating (${ACTIVE_INCIDENTS_DEMO.investigating}) equals ALERTS_D INVESTIGATING count (${alertsDInvestigating})`);
const incidentAgingTotal = INCIDENT_AGING_DEMO.reduce((s, b) => s + b.total, 0);
assert(
  incidentAgingTotal === ACTIVE_INCIDENTS_DEMO.total,
  `INCIDENT_AGING_DEMO row totals (${incidentAgingTotal}) sum to ACTIVE_INCIDENTS_DEMO.total (${ACTIVE_INCIDENTS_DEMO.total})`,
);

section("mission-control: POSTURE_SCORES_DEMO is informative (at least one non-green row keeps demo honest)");
const nonGreenPostureRows = POSTURE_SCORES_DEMO.filter((p) => p.accent !== "green").length;
assert(nonGreenPostureRows >= 1, `POSTURE_SCORES_DEMO has at least one non-green row (${nonGreenPostureRows} found)`);
const graveyardWarningCount = INCIDENT_AGING_DEMO[INCIDENT_AGING_DEMO.length - 1].total;
assert(
  graveyardWarningCount >= 1,
  `INCIDENT_AGING_DEMO 3d+ bucket has ${graveyardWarningCount} row(s) — exercises graveyard WARNING footer (not PASS) in demo`,
);

// Clean slate before the safety-invariant probe below.
resetAllDashboardTraffic();

section("safety invariant: real production rows (no simulation tag) are never touched");
// Insert a row that LOOKS like an alert but has no simulation metadata —
// this represents a real production alert. Reset-all must not touch it.
dbRun(
  `INSERT INTO alerts (id, title, description, severity, source, status, metadata, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ["real-prod-1", "Real production alert", "not synthetic", "HIGH", "shield", "open", '{"origin":"production"}', "2026-04-29T15:00:00.000Z", "2026-04-29T15:00:00.000Z"],
);
resetAllDashboardTraffic();
assert(scalar("SELECT COUNT(*) as cnt FROM alerts WHERE id = ?", ["real-prod-1"]) === 1, "real production row (no simulation tag) survives reset-all");

console.log(`\nResult: ${status.pass} passed, ${status.fail} failed`);
if (status.fail > 0) process.exit(1);
