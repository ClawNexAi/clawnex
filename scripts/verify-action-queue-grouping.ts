/**
 * verify-action-queue-grouping.ts
 *
 * Hermetic test fixture for the vNext grouping helper. No DB, no API, no
 * services — pure construction of ActionRow fixtures + assertions on the
 * grouped output. Run with:
 *
 *   npx tsx scripts/verify-action-queue-grouping.ts
 *
 * Coverage targets:
 *   1. Same family + incidentType + restricted + destination → grouped.
 *   2. Same family + DIFFERENT incidentType → NOT grouped.
 *   3. Same family + SAME incidentType + DIFFERENT restricted state → NOT grouped.
 *   4. Mixed input → singletons preserved alongside clusters.
 *   5. Lead picks highest priorityScore (severity tiebreak; row.id stable tiebreak).
 *   6. CRIT severity is preserved as maxSeverity even if lead is HIGH.
 *   7. Strongest evidence kind preserved (exact > audit > fallback > signal > health).
 *   8. Age range — newestAgeMs is the smallest ageMs; oldestAgeMs the largest.
 *   9. compareActionGroups orders by priorityScore DESC.
 *  10. CRIT row in a 2-member cluster surfaces as maxSeverity (won't be hidden).
 */

import { groupActionRows, compareActionGroups } from "../src/components/dashboard/panels/mission-control/action-queue-grouping";
import type { ActionRow } from "../src/components/dashboard/panels/mission-control/types";

let failed = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  const okay = JSON.stringify(actual) === JSON.stringify(expected);
  const status = okay ? "PASS" : "FAIL";
  console.log(`  ${status}  ${label}` + (okay ? "" : `\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`));
  if (!okay) failed++;
}

// Helper: synthesize a minimal ActionRow with sane defaults. Override fields
// per test as needed.
function makeRow(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: overrides.id ?? "row-default",
    severity: overrides.severity ?? "MED",
    title: overrides.title ?? "Test row",
    source: overrides.source ?? "test-source",
    evidence: overrides.evidence ?? { kind: "fallback", label: "Best match — fallback by session + ±60s" },
    ageMs: overrides.ageMs ?? 60_000,
    suggestedAction: overrides.suggestedAction ?? { verb: "Diagnose", target: "test row" },
    buttonLabel: overrides.buttonLabel ?? "Open ▸",
    clickTarget: overrides.clickTarget ?? { tab: "alertsIncidents" },
    restricted: overrides.restricted ?? false,
    priorityScore: overrides.priorityScore ?? 50,
    family: overrides.family ?? "alert",
    incidentType: overrides.incidentType ?? "test-incident",
    rawSource: overrides.rawSource,
  };
}

// ---------------------------------------------------------------------------
// 1. Same family + incidentType + restricted + destination → grouped
// ---------------------------------------------------------------------------
console.log("[1] Same key → grouped");
{
  const rows = [
    makeRow({ id: "a", family: "trust-audit", incidentType: "dangerous-combo:exec-write", clickTarget: { tab: "trustAudit" } }),
    makeRow({ id: "b", family: "trust-audit", incidentType: "dangerous-combo:exec-write", clickTarget: { tab: "trustAudit" } }),
    makeRow({ id: "c", family: "trust-audit", incidentType: "dangerous-combo:exec-write", clickTarget: { tab: "trustAudit" } }),
  ];
  const groups = groupActionRows(rows);
  assertEq(groups.length, 1, "single group for 3 same-key rows");
  assertEq(groups[0].count, 3, "count = 3");
  assertEq(groups[0].isCluster, true, "isCluster = true for >= 2 members");
}

// ---------------------------------------------------------------------------
// 2. Different incidentType → NOT grouped
// ---------------------------------------------------------------------------
console.log("[2] Different incidentType → not grouped");
{
  const rows = [
    makeRow({ id: "a", incidentType: "exec-write" }),
    makeRow({ id: "b", incidentType: "browser-read" }),
  ];
  const groups = groupActionRows(rows);
  assertEq(groups.length, 2, "two separate groups");
  assertEq(groups[0].count, 1, "first singleton");
  assertEq(groups[1].count, 1, "second singleton");
  assertEq(groups[0].isCluster, false, "singletons not isCluster");
}

// ---------------------------------------------------------------------------
// 3. Different restricted state → NOT grouped
// ---------------------------------------------------------------------------
console.log("[3] Different restricted state → not grouped");
{
  const rows = [
    makeRow({ id: "a", restricted: false }),
    makeRow({ id: "b", restricted: true }),
  ];
  const groups = groupActionRows(rows);
  assertEq(groups.length, 2, "restricted/unrestricted stay separate");
}

// ---------------------------------------------------------------------------
// 4. Mixed input → singletons + clusters coexist
// ---------------------------------------------------------------------------
console.log("[4] Mixed → singletons + clusters coexist");
{
  const rows = [
    makeRow({ id: "a", family: "alert",        incidentType: "shield" }),
    makeRow({ id: "b", family: "trust-audit",  incidentType: "exec-write" }),
    makeRow({ id: "c", family: "trust-audit",  incidentType: "exec-write" }),
    makeRow({ id: "d", family: "cost-signal",  incidentType: "loop_risk" }),
  ];
  const groups = groupActionRows(rows);
  assertEq(groups.length, 3, "3 groups (alert, exec-write cluster, cost)");
  // exec-write cluster should be 2
  const cluster = groups.find((g) => g.incidentType === "exec-write");
  assertEq(cluster?.count, 2, "exec-write group has 2 members");
}

// ---------------------------------------------------------------------------
// 5. Lead = highest priorityScore (severity / id tiebreaks)
// ---------------------------------------------------------------------------
console.log("[5] Lead = highest priorityScore (with tiebreaks)");
{
  const rows = [
    makeRow({ id: "low",     priorityScore: 50 }),
    makeRow({ id: "high",    priorityScore: 100 }),
    makeRow({ id: "mid",     priorityScore: 75 }),
  ];
  const groups = groupActionRows(rows);
  assertEq(groups[0].lead.id, "high", "lead = highest priorityScore");

  // Tiebreak by severity
  const tied = [
    makeRow({ id: "warn",    priorityScore: 80, severity: "WARN" }),
    makeRow({ id: "crit",    priorityScore: 80, severity: "CRIT" }),
    makeRow({ id: "high",    priorityScore: 80, severity: "HIGH" }),
  ];
  const tiedGroups = groupActionRows(tied);
  assertEq(tiedGroups[0].lead.id, "crit", "lead tiebreak = highest severity");

  // Tiebreak by id (lowest wins for stability)
  const fullTie = [
    makeRow({ id: "zzz", priorityScore: 80, severity: "MED" }),
    makeRow({ id: "aaa", priorityScore: 80, severity: "MED" }),
  ];
  const fullTieGroups = groupActionRows(fullTie);
  assertEq(fullTieGroups[0].lead.id, "aaa", "full-tie lead = lowest id");
}

// ---------------------------------------------------------------------------
// 6. CRIT severity surfaces as maxSeverity even if lead is HIGH
// ---------------------------------------------------------------------------
console.log("[6] CRIT visible as maxSeverity even when not the lead");
{
  const rows = [
    // HIGH lead because higher priorityScore
    makeRow({ id: "lead", priorityScore: 100, severity: "HIGH" }),
    // CRIT member with lower priorityScore (fictional but representative)
    makeRow({ id: "crit", priorityScore: 90,  severity: "CRIT" }),
  ];
  const groups = groupActionRows(rows);
  assertEq(groups[0].lead.id, "lead", "lead is HIGH (higher priorityScore)");
  assertEq(groups[0].maxSeverity, "CRIT", "maxSeverity = CRIT (preserved across members)");
}

// ---------------------------------------------------------------------------
// 7. Strongest evidence kind: exact > audit > fallback > signal > health
// ---------------------------------------------------------------------------
console.log("[7] Strongest evidence kind preserved");
{
  const exactEv = { kind: "exact"    as const, label: "Exact (audit_event_id)" as const };
  const auditEv = { kind: "audit"    as const, label: "Trust Audit finding"     as const };
  const fallEv  = { kind: "fallback" as const, label: "Best match — fallback by session + ±60s" as const };
  const sigEv   = { kind: "signal"   as const, label: "Cost signal"             as const };
  const heaEv   = { kind: "health"   as const, label: "Connector health"        as const };
  const rows = [
    makeRow({ id: "h", evidence: heaEv }),
    makeRow({ id: "s", evidence: sigEv }),
    makeRow({ id: "f", evidence: fallEv }),
    makeRow({ id: "e", evidence: exactEv }),
    makeRow({ id: "a", evidence: auditEv }),
  ];
  const groups = groupActionRows(rows);
  assertEq(groups[0].strongestEvidenceKind, "exact", "exact wins over all others");
}

// ---------------------------------------------------------------------------
// 8. Age range
// ---------------------------------------------------------------------------
console.log("[8] Age range — newest is smallest ageMs");
{
  const rows = [
    makeRow({ id: "old",    ageMs: 3_600_000 }), // 1h
    makeRow({ id: "mid",    ageMs: 600_000 }),   // 10m
    makeRow({ id: "newest", ageMs: 60_000 }),    // 1m
  ];
  const groups = groupActionRows(rows);
  assertEq(groups[0].newestAgeMs, 60_000,    "newest = smallest ageMs");
  assertEq(groups[0].oldestAgeMs, 3_600_000, "oldest = largest ageMs");
}

// ---------------------------------------------------------------------------
// 9. compareActionGroups orders by priorityScore DESC
// ---------------------------------------------------------------------------
console.log("[9] compareActionGroups orders by priorityScore DESC");
{
  const rows = [
    makeRow({ id: "low",  priorityScore: 30, family: "alert",        incidentType: "low-pri" }),
    makeRow({ id: "high", priorityScore: 99, family: "trust-audit",  incidentType: "high-pri" }),
    makeRow({ id: "mid",  priorityScore: 60, family: "cost-signal",  incidentType: "mid-pri" }),
  ];
  const groups = groupActionRows(rows).sort(compareActionGroups);
  assertEq(groups.map((g) => g.lead.id), ["high", "mid", "low"], "sorted high → mid → low");
}

// ---------------------------------------------------------------------------
// 10. CRIT in 2-member cluster — visible via maxSeverity
// ---------------------------------------------------------------------------
console.log("[10] CRIT in cluster surfaces as maxSeverity");
{
  const rows = [
    makeRow({ id: "a", priorityScore: 80, severity: "MED",  incidentType: "shared" }),
    makeRow({ id: "b", priorityScore: 70, severity: "CRIT", incidentType: "shared" }),
  ];
  const groups = groupActionRows(rows);
  assertEq(groups[0].count, 2, "cluster has 2 members");
  assertEq(groups[0].maxSeverity, "CRIT", "CRIT preserved as maxSeverity");
  assertEq(groups[0].lead.id, "a", "lead is highest priorityScore (a, MED 80)");
}

// ---------------------------------------------------------------------------
// Final report
// ---------------------------------------------------------------------------
console.log();
if (failed > 0) {
  console.log(`verify-action-queue-grouping: ${failed} FAIL`);
  process.exit(1);
} else {
  console.log("verify-action-queue-grouping: ok");
}
