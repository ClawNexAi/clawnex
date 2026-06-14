/**
 * verify-posture-reconciliation.ts — veracity audit F3 regression guard.
 *
 * "Security Posture" was computed three independent ways inline in
 * SecurityPosturePanel (scan.overallScore OR hardening.score OR
 * average(fleet.posture) OR 0), which could silently disagree with the Fleet
 * posture column and the Readiness Banner. The fix moved the formula to ONE
 * shared definition: `reconcilePosture()` in metric-semantics.ts. This verifier
 * pins that definition's precedence and honesty invariants so the contradiction
 * can't return.
 *
 * Invariants:
 *   1. clawkeeper scan score wins over everything (the authoritative grade).
 *   2. hardening category score is used when there's no scan (still clawkeeper).
 *   3. fleet-estimate ONLY when no host score exists, and it is the AVERAGE of
 *      the scored instances, carrying instanceCount and the explicit
 *      'fleet-estimate' source so the UI can label it (not pass it as a grade).
 *   4. unscanned returns score: null (honest-zero-vs-unknown — never a real 0).
 *   5. nulls/undefined in the fleet array are ignored, not counted as 0.
 *
 * Run: npx tsx scripts/verify-posture-reconciliation.ts
 */

import { reconcilePosture } from "../src/lib/dashboard/metric-semantics";

const status = { pass: 0, fail: 0 };

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

section("1. clawkeeper scan score wins");
{
  const r = reconcilePosture({ scanScore: 72, hardeningScore: 40, fleetPostures: [10, 20] });
  assert(r.score === 72, "scan score 72 takes precedence over hardening + fleet");
  assert(r.source === "clawkeeper", "source is clawkeeper");
  assert(r.instanceCount === 0, "instanceCount 0 when not a fleet estimate");
}

section("2. hardening score used when no scan");
{
  const r = reconcilePosture({ scanScore: null, hardeningScore: 55, fleetPostures: [90, 90] });
  assert(r.score === 55, "hardening score 55 used over fleet average");
  assert(r.source === "clawkeeper", "hardening-derived score is still clawkeeper source");
}

section("3. fleet-estimate only when no host score, and it's the average");
{
  const r = reconcilePosture({ scanScore: null, hardeningScore: null, fleetPostures: [80, 90, 100] });
  assert(r.score === 90, "average of 80/90/100 = 90");
  assert(r.source === "fleet-estimate", "source labeled fleet-estimate (never a real grade)");
  assert(r.instanceCount === 3, "instanceCount reflects the 3 scored instances");
}
{
  const r = reconcilePosture({ scanScore: null, hardeningScore: null, fleetPostures: [70, 75] });
  assert(r.score === 73, "average of 70/75 rounds to 73");
  assert(r.instanceCount === 2, "instanceCount 2");
}

section("4. unscanned returns null, not 0 (honest-zero-vs-unknown)");
{
  const r = reconcilePosture({ scanScore: null, hardeningScore: null, fleetPostures: [] });
  assert(r.score === null, "no data => score is null, NOT 0");
  assert(r.source === "unscanned", "source is unscanned");
  assert(r.instanceCount === 0, "instanceCount 0");
}
{
  const r = reconcilePosture({});
  assert(r.score === null && r.source === "unscanned", "empty input => unscanned/null");
}

section("5. null/undefined fleet entries are ignored, not counted as 0");
{
  const r = reconcilePosture({ scanScore: null, hardeningScore: null, fleetPostures: [null, 90, undefined, 70] });
  assert(r.score === 80, "average of only the real values 90/70 = 80 (nulls dropped)");
  assert(r.instanceCount === 2, "instanceCount counts only scored instances");
}
{
  const r = reconcilePosture({ scanScore: null, hardeningScore: null, fleetPostures: [null, undefined] });
  assert(r.source === "unscanned", "all-null fleet => unscanned, not a fake 0 average");
}

section("6. a real 0 score is preserved (distinct from unscanned)");
{
  const r = reconcilePosture({ scanScore: 0 });
  assert(r.score === 0 && r.source === "clawkeeper", "scan score of 0 is a real grade, not unscanned");
}

console.log(`\n${status.fail === 0 ? "PASS" : "FAIL"}: ${status.pass} passed, ${status.fail} failed`);
process.exit(status.fail === 0 ? 0 : 1);
