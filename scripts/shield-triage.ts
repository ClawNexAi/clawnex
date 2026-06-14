/**
 * Shield Tests Triage — runs all SHIELD_TESTS payloads through the live
 * scanner and reports actual vs expected verdicts.
 *
 * Usage: cd ~/sentinel && npx tsx scripts/shield-triage.ts
 *
 * Output is split honestly into two buckets per the reviewer's metric-semantics
 * discipline (2026-04-28 review):
 *   - **Release-grade tests** must all pass before each tagged release.
 *     A failure here means the rule library has regressed.
 *   - **Coverage Lab tests** (marked `coverageLab: true` in mock-data.ts)
 *     are aspirational coverage probes for detection categories that
 *     require engineering work (e.g. base64-content decoding). Failures
 *     here are disclosed as known coverage gaps, not broken protection.
 *
 * The headline summary intentionally never reports "Failing: N" without
 * also labeling whether those failures are release-grade regressions or
 * accepted Coverage Lab gaps. Reporting "26/27 failing 1" without that
 * carve-out was the exact metric-honesty problem this whole patch was
 * supposed to fix.
 */

import { shieldScan } from "../src/lib/shield/scanner";
import { SHIELD_TESTS } from "../src/components/dashboard/mock-data";

type ShieldTest = typeof SHIELD_TESTS[number] & { coverageLab?: boolean };

interface TriageRow {
  id: string;
  name: string;
  expected: string;
  actual: string;
  score: number;
  matched: boolean;
  isCoverageLab: boolean;
  topDetection: string;
  detectionCount: number;
  categories: string[];
  recommendation: string;
}

function classify(test: ShieldTest, result: ReturnType<typeof shieldScan>): TriageRow {
  const matched = result.verdict === test.expected;
  const top = result.detections[0];
  const isCoverageLab = Boolean(test.coverageLab);
  // Heuristic recommendation:
  //   - matched: passing
  //   - matched=false but coverageLab: known-coverage-gap (expected, not a regression)
  //   - !matched, no detections AT ALL → real gap (rule missing entirely)
  //   - !matched, some detections but score below threshold → real gap
  //   - !matched, expected ALLOW but got BLOCK/REVIEW → false positive
  //   - !matched, expected REVIEW but got ALLOW → real gap (sub-threshold)
  let recommendation: string;
  if (matched) {
    recommendation = "passing";
  } else if (isCoverageLab) {
    recommendation = "known-coverage-gap (Coverage Lab probe — engineering work needed, not a release blocker)";
  } else if (test.expected === "ALLOW") {
    recommendation = "false-positive (rule fires on benign content)";
  } else if (result.detections.length === 0) {
    recommendation = "real-gap (no rule matched payload)";
  } else if (test.expected === "BLOCK" && result.verdict === "REVIEW") {
    recommendation = "real-gap (sub-threshold; severity or confidence needs boost)";
  } else if (test.expected === "REVIEW" && result.verdict === "ALLOW") {
    recommendation = "real-gap (sub-25-score; needs additional rule coverage)";
  } else {
    recommendation = "investigate";
  }

  return {
    id: test.id,
    name: test.name,
    expected: test.expected,
    actual: result.verdict,
    score: result.score,
    matched,
    isCoverageLab,
    topDetection: top ? `${top.id}:${top.name} (${top.severity})` : "—",
    detectionCount: result.detections.length,
    categories: result.stats.categories,
    recommendation,
  };
}

function main() {
  console.log("# Shield Tests Triage Report");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log("");

  const rows: TriageRow[] = [];
  for (const test of SHIELD_TESTS as ShieldTest[]) {
    const result = shieldScan(test.payload, { includeRedacted: false });
    rows.push(classify(test, result));
  }

  // Bucketize: release-grade vs Coverage Lab. The headline must keep these
  // separate so an operator can never mistake a Coverage Lab gap for a
  // release-grade regression.
  const releaseRows = rows.filter(r => !r.isCoverageLab);
  const labRows = rows.filter(r => r.isCoverageLab);

  const releasePassing = releaseRows.filter(r => r.matched).length;
  const releaseFailing = releaseRows.length - releasePassing;
  const labPassing = labRows.filter(r => r.matched).length;
  const labFailing = labRows.length - labPassing;

  console.log(`## Summary`);
  console.log("");
  console.log(`### Release-grade tests`);
  console.log(`Passing: ${releasePassing} / ${releaseRows.length}`);
  if (releaseFailing > 0) {
    console.log(`Failing: ${releaseFailing}  ← release-grade regression — must fix before next tagged release`);
  } else {
    console.log(`Failing: 0`);
  }
  console.log("");
  if (labRows.length > 0) {
    console.log(`### Coverage Lab tests`);
    console.log(`Passing: ${labPassing} / ${labRows.length}`);
    console.log(`Failing: ${labFailing}  ← known coverage gap — aspirational probe, NOT a release-grade regression`);
    console.log("");
    console.log("Coverage Lab tests are aspirational probes for detection categories");
    console.log("that need engineering work (e.g. base64-content decoding). Failures here");
    console.log("are disclosed as known gaps and do not count toward release pass rate.");
    console.log("");
  }
  console.log(`### Combined (informational only — do NOT use as the headline)`);
  console.log(`All tests: ${releasePassing + labPassing} / ${rows.length} passing`);
  console.log("");

  console.log(`## Per-test results`);
  console.log("");
  console.log("| ID  | Name                          | Tier         | Expected | Actual  | Score | Detections | Top Detection                              | Recommendation");
  console.log("|-----|-------------------------------|--------------|----------|---------|-------|------------|--------------------------------------------|-------------------");
  for (const r of rows) {
    const name = r.name.padEnd(29).slice(0, 29);
    const tier = (r.isCoverageLab ? "Coverage Lab" : "Release").padEnd(12);
    const top = r.topDetection.padEnd(42).slice(0, 42);
    const flag = r.matched ? "✓" : (r.isCoverageLab ? "○" : "✗");
    console.log(`| ${r.id} | ${name} | ${tier} | ${r.expected.padEnd(8)} | ${r.actual.padEnd(7)} | ${String(r.score).padStart(5)} | ${String(r.detectionCount).padStart(10)} | ${top} | ${flag} ${r.recommendation}`);
  }

  console.log("");
  // Only call out release-grade regressions in the dedicated failures
  // section. Coverage Lab gaps get their own subsection if any exist —
  // never mixed with release-grade regressions.
  const releaseFailures = releaseRows.filter(rr => !rr.matched);
  const labFailures = labRows.filter(rr => !rr.matched);
  if (releaseFailures.length > 0) {
    console.log("## Release-grade regressions (fix before release)");
    console.log("");
    for (const r of releaseFailures) {
      console.log(`### ${r.id} — ${r.name}`);
      console.log(`Expected: ${r.expected} | Actual: ${r.actual} | Score: ${r.score}`);
      console.log(`Detections: ${r.detectionCount} (${r.categories.join(", ") || "none"})`);
      console.log(`Top: ${r.topDetection}`);
      console.log(`Recommendation: ${r.recommendation}`);
      console.log("");
    }
  }
  if (labFailures.length > 0) {
    console.log("## Coverage Lab probes still showing gaps (informational, NOT regressions)");
    console.log("");
    for (const r of labFailures) {
      console.log(`### ${r.id} — ${r.name}  [Coverage Lab]`);
      console.log(`Expected: ${r.expected} | Actual: ${r.actual} | Score: ${r.score}`);
      console.log(`Detections: ${r.detectionCount} (${r.categories.join(", ") || "none"})`);
      console.log(`Top: ${r.topDetection}`);
      console.log(`Status: known coverage gap — see mock-data.ts for the engineering-work-needed note.`);
      console.log("");
    }
  }
}

main();
