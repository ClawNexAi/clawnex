/**
 * verify-correlation-resolver.ts
 *
 * Hermetic test fixture for the correlation Triage Graph resolver. No DB,
 * no API, no services — pure construction of a synthetic CorrelationFinding
 * + assertions on the returned TriageGraph shape.
 *
 *   npx tsx scripts/verify-correlation-resolver.ts
 */

import {
  resolveCorrelationTriageGraph,
  type CorrelationFinding,
} from "../src/components/dashboard/triage/correlation-resolver";
import { TRIAGE_STAGE_ORDER } from "../src/components/dashboard/triage/types";
import { ACTION_VERBS } from "../src/components/dashboard/panels/mission-control/types";

let assertionCount = 0;
function pass(msg: string) {
  assertionCount++;
  console.log(`PASS: ${msg}`);
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  pass(msg);
}

// Synthetic fixture — multi-source correlation with shared session + evidence.
const NOW = new Date("2026-05-07T12:00:00Z");
const fixture: CorrelationFinding = {
  id: "corr-001",
  title: "Loop risk + alert correlated on session abc-123",
  severity: "HIGH",
  correlatedSignalIds: ["sig-alert-1", "sig-cost-2", "sig-cost-3"],
  correlatedSources: ["alert", "cost-signal"],
  windowStartMs: NOW.getTime() - 600_000,
  windowEndMs:   NOW.getTime(),
  sharedSessionId: "abc-123",
  evidence: ["3 signals within 10m", "all on session abc-123"],
  confidence: "high",
};

const graph = resolveCorrelationTriageGraph({ finding: fixture, now: NOW });

// 1. Resolver export shape
assert(typeof resolveCorrelationTriageGraph === "function", "resolveCorrelationTriageGraph is a function");

// 2. Graph has 5 stages
assert(graph.stages.length === 5, "graph has 5 stages");

// 3. Stage IDs in canonical order
const stageIds = graph.stages.map((s) => s.id);
assert(JSON.stringify(stageIds) === JSON.stringify(TRIAGE_STAGE_ORDER), "stage IDs match canonical order");

// 4. Stage titles match contract
const expectedTitles = ["Evidence", "Source Event", "Affected Object", "Related Activity", "Fix / Control"];
const actualTitles = graph.stages.map((s) => s.title);
assert(JSON.stringify(actualTitles) === JSON.stringify(expectedTitles), "stage titles match contract");

// 5. Resolver version
assert(graph.resolverVersion === "correlation-resolver-v1", "resolverVersion is correlation-resolver-v1");

// 6. Each artifact's stageId is in TRIAGE_STAGE_ORDER
for (const a of graph.artifacts) {
  assert((TRIAGE_STAGE_ORDER as string[]).includes(a.stageId), `artifact ${a.id} stageId ${a.stageId} is in canonical order`);
}

// 7. defaultArtifactId points at an actual artifact
const idSet = new Set(graph.artifacts.map((a) => a.id));
assert(graph.defaultArtifactId !== undefined && idSet.has(graph.defaultArtifactId), "defaultArtifactId points at a real artifact");

// 8. Fix/Control artifact contains a canonical verb in label OR previewSummary
const fixArtifact = graph.artifacts.find((a) => a.stageId === "fixControl");
assert(fixArtifact !== undefined, "fixControl artifact exists");
const verbHit = (ACTION_VERBS as readonly string[]).some((v) =>
  fixArtifact!.previewSummary.includes(v) || (fixArtifact!.primaryAction?.label ?? "").includes(v),
);
assert(verbHit, "fixControl artifact uses a canonical ActionVerb (Diagnose expected)");
// Specifically expect "Diagnose"
assert(
  fixArtifact!.previewSummary.includes("Diagnose") || (fixArtifact!.primaryAction?.label ?? "").includes("Diagnose"),
  "fixControl artifact references the Diagnose verb",
);

// 9. Issue kind matches family
assert(graph.issue.kind === "correlation", "issue.kind is correlation");

// 10. Severity passed through
assert(graph.issue.severity === "HIGH", "severity passed through (HIGH)");

// 11. Resolver is pure: same input → same output (modulo generatedAt — we pin via now)
const graph2 = resolveCorrelationTriageGraph({ finding: fixture, now: NOW });
assert(JSON.stringify(graph) === JSON.stringify(graph2), "resolver is pure (deterministic with fixed now)");

// 12. Edge case: empty evidence array doesn't crash
const noEvidence = resolveCorrelationTriageGraph({
  finding: { ...fixture, evidence: [] },
  now: NOW,
});
assert(noEvidence.stages.length === 5, "empty evidence: still produces 5 stages");
const ev = noEvidence.artifacts.find((a) => a.stageId === "evidence");
assert(ev !== undefined && ev.evidenceTrail === undefined, "empty evidence array → no evidenceTrail attached");

// 13. Edge case: single signal, no shared session (multi-session path)
const multiSession = resolveCorrelationTriageGraph({
  finding: { ...fixture, sharedSessionId: undefined, correlatedSignalIds: ["sig-1"] },
  now: NOW,
});
const obj = multiSession.artifacts.find((a) => a.stageId === "affectedObject");
assert(obj !== undefined && obj.state === "missing", "no sharedSessionId → affectedObject state = missing");

// 14. Single shared session → derived state
const singleObj = graph.artifacts.find((a) => a.stageId === "affectedObject");
assert(singleObj !== undefined && singleObj.state === "derived", "sharedSessionId set → affectedObject state = derived");

// ---------------------------------------------------------------------------
// 6. Banned synonyms must not appear in operator-visible artifact strings.
//    WHY: per-resolver verifiers already confirm a canonical ActionVerb appears
//    in Fix/Control, but they did NOT reject banned synonyms (Inspect / Audit /
//    Tighten / Constrain / bare Investigate / bare Review / bare View) drifting
//    into previewSummary or primaryAction.label across other artifacts. the reviewer's
//    Phase 5 sign-off (2026-05-08) flagged that gap; this is the synonym
//    discipline test, mirroring §4b shape from verify-action-verbs.ts.
// ---------------------------------------------------------------------------
console.log("[6] Banned synonyms absent from operator-visible artifact strings");
{
  // Category A — bare imperative verbs that have NO legitimate non-verb usage
  // in our domain. Any case, anywhere in operator copy fails.
  const BANNED_BARE: RegExp[] = [
    /\b[Ii]nvestigate\b/,
    /\b[Ii]nspect\b/,
    /\b[Tt]ighten\b/,
    /\b[Cc]onstrain\b/,
  ];
  // Category B — verbs that have legit non-imperative uses ("Audit & Evidence"
  // as a tab name, "view" inside compound phrases). Banned only at imperative-
  // bare boundary positions: sentence-start, after "." / ":" / "—". Lookahead
  // excludes the legit "Audit & ..." proper-noun use.
  const BANNED_BOUNDARY: RegExp[] = [
    /(?:^|[.:—]\s+)([Aa]udit|[Rr]eview|[Vv]iew)\s+(?!&)/,
  ];
  const ALL_PATTERNS: RegExp[] = [...BANNED_BARE, ...BANNED_BOUNDARY];

  for (const a of graph.artifacts) {
    const fields: Array<{ name: string; text: string }> = [
      { name: "previewSummary", text: a.previewSummary },
    ];
    if (a.primaryAction?.label !== undefined) {
      fields.push({ name: "primaryAction.label", text: a.primaryAction.label });
    }
    // Internally check every (field × regex) pair; surface a single PASS line
    // per artifact summarising the matrix to keep PASS line count manageable.
    for (const { name, text } of fields) {
      for (const re of ALL_PATTERNS) {
        const m = text.match(re);
        if (m) {
          throw new Error(
            `ASSERTION FAILED: artifact ${a.id} field ${name} matched banned pattern ${re} — offending snippet: "${m[0]}"`,
          );
        }
      }
    }
    pass(`artifact ${a.id}: all banned synonym patterns absent from operator-visible strings`);
  }
}

// ---------------------------------------------------------------------------
// 6b. Self-test: prove each banned pattern catches a fake injection AND does
//     not trip on a clean baseline. Mirrors verify-action-verbs.ts §4b shape.
// ---------------------------------------------------------------------------
console.log("[6b] Self-test: each banned pattern catches a fake injection");
{
  const baseline = "Diagnose the constituent signals together — correlation suggests a single root cause across sources.";

  // Category A injections — one per regex.
  const BARE_CASES: Array<{ re: RegExp; injection: string }> = [
    { re: /\b[Ii]nvestigate\b/, injection: "Investigate this" },
    { re: /\b[Ii]nspect\b/,     injection: "Inspect the rule" },
    { re: /\b[Tt]ighten\b/,     injection: "tighten the policy" },
    { re: /\b[Cc]onstrain\b/,   injection: "Constrain the agent" },
  ];
  for (const { re, injection } of BARE_CASES) {
    const synthetic = `${baseline} ${injection}`;
    assert(re.test(synthetic), `self-test: ${re} catches injection "${injection}"`);
    assert(!re.test(baseline), `self-test: ${re} does not trip on clean baseline`);
  }

  // Category B injections — boundary regex must catch every prefix variant.
  const BOUNDARY_RE = /(?:^|[.:—]\s+)([Aa]udit|[Rr]eview|[Vv]iew)\s+(?!&)/;
  const PREFIXES: string[] = ["", ". ", ": ", "— "];
  const VERBS: string[] = ["Audit", "Review", "View"];
  for (const prefix of PREFIXES) {
    for (const verb of VERBS) {
      const synthetic = `${prefix}${verb} the rule`;
      assert(BOUNDARY_RE.test(synthetic), `self-test: BOUNDARY_RE catches "${synthetic}"`);
    }
  }
  // Negative — proper-noun "Audit & Evidence" must NOT match (lookahead works).
  assert(
    !BOUNDARY_RE.test("Drill into Audit & Evidence to open each signal."),
    `self-test: BOUNDARY_RE does not match proper-noun "Audit & Evidence"`,
  );
}

console.log();
console.log(`✅ All ${assertionCount} assertions passed`);
