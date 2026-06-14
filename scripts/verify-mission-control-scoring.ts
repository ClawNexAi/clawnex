/**
 * Hermetic verifier for Mission Control pure scoring functions.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md §6.1-6.5, §7.2
 *
 * Pattern mirrors scripts/verify-cost-orchestrator.ts: in-memory inputs,
 * function calls, function-based asserts, exit-non-zero on first fail.
 */

import {
  scoreShieldPolicyCoverage,
  scoreEvidenceQuality,
  scoreIncidentHygiene,
  scoreSourceFreshness,
  scoreCostDiscipline,
  computeActionPriority,
} from "../src/components/dashboard/panels/mission-control/scoring";

let pass = 0;
let fail = 0;

function t(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? "  — " + detail : ""}`);
  }
}

// ---- Shield + Policy Coverage (spec §6.1) ----
console.log("\n[Shield + Policy Coverage scoring]");
t(
  "all rules active, no unsafe regex → score = 100",
  scoreShieldPolicyCoverage({
    activeCoreRules: 163,
    totalCoreRules: 163,
    activeEgressStarter: 12,
    totalEgressStarter: 12,
    unsafeRegexCount: 0,
    totalPolicyRules: 175,
  }) === 100,
);
t(
  "half core, half egress, no unsafe → score ≈ 34.8 + 10 + 10 ≈ 54-55",
  scoreShieldPolicyCoverage({
    activeCoreRules: 81,
    totalCoreRules: 163,
    activeEgressStarter: 6,
    totalEgressStarter: 12,
    unsafeRegexCount: 0,
    totalPolicyRules: 175,
  }) >= 54 && scoreShieldPolicyCoverage({
    activeCoreRules: 81,
    totalCoreRules: 163,
    activeEgressStarter: 6,
    totalEgressStarter: 12,
    unsafeRegexCount: 0,
    totalPolicyRules: 175,
  }) <= 56,
);
t(
  "5 unsafe regex out of 175 → unsafe penalty applied",
  scoreShieldPolicyCoverage({
    activeCoreRules: 163,
    totalCoreRules: 163,
    activeEgressStarter: 12,
    totalEgressStarter: 12,
    unsafeRegexCount: 5,
    totalPolicyRules: 175,
  }) < 100,
);

// ---- Evidence Quality (spec §6.2) ----
console.log("\n[Evidence Quality scoring]");
t(
  "all forward, all snippets present → 100",
  scoreEvidenceQuality({
    forwardCount: 10,
    snippetPresentCount: 10,
    outsideWindowFetchableCount: 10,
    totalResolvable: 10,
  }) === 100,
);
t(
  "no resolvable items → 0 (empty case)",
  scoreEvidenceQuality({
    forwardCount: 0,
    snippetPresentCount: 0,
    outsideWindowFetchableCount: 0,
    totalResolvable: 0,
  }) === 0,
);
t(
  "all fallback (zero forward) → ≤ 30",
  scoreEvidenceQuality({
    forwardCount: 0,
    snippetPresentCount: 10,
    outsideWindowFetchableCount: 10,
    totalResolvable: 10,
  }) <= 30,
);

// ---- Incident Hygiene (spec §6.3) ----
console.log("\n[Incident Hygiene scoring]");
t(
  "zero open incidents → 100",
  scoreIncidentHygiene({ openCount: 0, criticalCount: 0, highCount: 0, oldestAgeMs: 0, ackButNotResolvedCount: 0 }) === 100,
);
t(
  "1 critical + 1d old → significantly < 100",
  scoreIncidentHygiene({ openCount: 1, criticalCount: 1, highCount: 0, oldestAgeMs: 24 * 3600 * 1000, ackButNotResolvedCount: 0 }) < 80,
);
t(
  "score never below 0",
  scoreIncidentHygiene({ openCount: 999, criticalCount: 100, highCount: 100, oldestAgeMs: 30 * 24 * 3600 * 1000, ackButNotResolvedCount: 50 }) >= 0,
);

// ---- Source Freshness (spec §6.4) ----
console.log("\n[Source Freshness scoring]");
t(
  "all collectors fresh → 100",
  scoreSourceFreshness([
    { name: "openclaw", lastSeenMsAgo: 5_000, staleThresholdMs: 30_000 },
    { name: "hermes", lastSeenMsAgo: 10_000, staleThresholdMs: 5 * 60_000 },
  ]) === 100,
);
t(
  "weakest-link semantics — one stale collector dominates",
  scoreSourceFreshness([
    { name: "openclaw", lastSeenMsAgo: 5_000, staleThresholdMs: 30_000 },
    { name: "paperclip", lastSeenMsAgo: 18 * 3600_000, staleThresholdMs: 30 * 60_000 },
  ]) < 30,
);
t(
  "empty input → 100 (no collectors = nothing to be stale, target state)",
  scoreSourceFreshness([]) === 100,
);

// ---- Cost Discipline (spec §6.5) ----
console.log("\n[Cost Discipline scoring]");
t(
  "no signals, all rows have cost rates → 100",
  scoreCostDiscipline({
    activeSignalCount: 0,
    unknownOrTokenOnlyCount: 0,
    totalCostRows: 100,
    anyStaleSource: false,
  }) === 100,
);
t(
  "1 drain signal → -15 → 85",
  scoreCostDiscipline({
    activeSignalCount: 1,
    unknownOrTokenOnlyCount: 0,
    totalCostRows: 100,
    anyStaleSource: false,
  }) === 85,
);
t(
  "stale source + 2 signals → -20 -30 = 50",
  scoreCostDiscipline({
    activeSignalCount: 2,
    unknownOrTokenOnlyCount: 0,
    totalCostRows: 100,
    anyStaleSource: true,
  }) === 50,
);
t(
  "score floor at 0",
  scoreCostDiscipline({
    activeSignalCount: 100,
    unknownOrTokenOnlyCount: 100,
    totalCostRows: 100,
    anyStaleSource: true,
  }) === 0,
);

// ---- Action priority (spec §7.2) ----
console.log("\n[Action priority scoring]");
t(
  "CRIT > HIGH > MED ranking",
  computeActionPriority({ severity: "CRIT", ageMs: 60_000, evidenceKind: "exact" }) >
  computeActionPriority({ severity: "HIGH", ageMs: 60_000, evidenceKind: "exact" }),
);
t(
  "exact evidence outranks signal at same severity + age",
  computeActionPriority({ severity: "WARN", ageMs: 3600_000, evidenceKind: "exact" }) >
  computeActionPriority({ severity: "WARN", ageMs: 3600_000, evidenceKind: "signal" }),
);
t(
  "very recent CRIT outranks 3d-old CRIT",
  computeActionPriority({ severity: "CRIT", ageMs: 30 * 60_000, evidenceKind: "exact" }) >
  computeActionPriority({ severity: "CRIT", ageMs: 4 * 24 * 3600_000, evidenceKind: "exact" }),
);
t(
  "audit evidence ranks between exact and fallback",
  computeActionPriority({ severity: "MED", ageMs: 60_000, evidenceKind: "audit" }) >
  computeActionPriority({ severity: "MED", ageMs: 60_000, evidenceKind: "fallback" }),
);

console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
process.exit(fail === 0 ? 0 : 1);
