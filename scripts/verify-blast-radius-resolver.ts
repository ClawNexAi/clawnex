/**
 * verify-blast-radius-resolver.ts
 *
 * Hermetic test fixture for the blast-radius Triage Graph resolver. No DB,
 * no API, no services — pure construction of a synthetic BlastRadiusFinding
 * + assertions on the returned TriageGraph shape.
 *
 *   npx tsx scripts/verify-blast-radius-resolver.ts
 */

import {
  resolveBlastRadiusTriageGraph,
  type BlastRadiusFinding,
} from "../src/components/dashboard/triage/blast-radius-resolver";
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

const NOW = new Date("2026-05-07T12:00:00Z");
const fixture: BlastRadiusFinding = {
  id: "blast-001",
  title: "Shared credential blast radius",
  severity: "CRIT",
  rootSignalId: "alert-x",
  rootSignalKind: "alert",
  affectedSessionIds: ["sess-a", "sess-b", "sess-c", "sess-d"],
  vector: "shared_credential",
  windowStartMs: NOW.getTime() - 1_800_000,
  windowEndMs:   NOW.getTime(),
  evidence: ["4 sessions share credential cred-1"],
};

const graph = resolveBlastRadiusTriageGraph({ finding: fixture, now: NOW });

// 1
assert(typeof resolveBlastRadiusTriageGraph === "function", "resolveBlastRadiusTriageGraph is a function");
// 2
assert(graph.stages.length === 5, "graph has 5 stages");
// 3
const stageIds = graph.stages.map((s) => s.id);
assert(JSON.stringify(stageIds) === JSON.stringify(TRIAGE_STAGE_ORDER), "stage IDs match canonical order");
// 4
const expectedTitles = ["Evidence", "Source Event", "Affected Object", "Related Activity", "Fix / Control"];
const actualTitles = graph.stages.map((s) => s.title);
assert(JSON.stringify(actualTitles) === JSON.stringify(expectedTitles), "stage titles match contract");
// 5
assert(graph.resolverVersion === "blast-radius-resolver-v1", "resolverVersion is blast-radius-resolver-v1");
// 6
for (const a of graph.artifacts) {
  assert((TRIAGE_STAGE_ORDER as string[]).includes(a.stageId), `artifact ${a.id} stageId is canonical`);
}
// 7
const idSet = new Set(graph.artifacts.map((a) => a.id));
assert(graph.defaultArtifactId !== undefined && idSet.has(graph.defaultArtifactId), "defaultArtifactId points at a real artifact");

// 8: Fix/Control verb — vector=shared_credential should produce "Rotate credential"
const fixArtifact = graph.artifacts.find((a) => a.stageId === "fixControl");
assert(fixArtifact !== undefined, "fixControl artifact exists");
const verbHit = (ACTION_VERBS as readonly string[]).some((v) =>
  fixArtifact!.previewSummary.includes(v) || (fixArtifact!.primaryAction?.label ?? "").includes(v),
);
assert(verbHit, "fixControl artifact uses a canonical ActionVerb");
assert(
  fixArtifact!.previewSummary.includes("Rotate credential") || (fixArtifact!.primaryAction?.label ?? "").includes("Rotate credential"),
  "shared_credential vector → Rotate credential verb",
);

// 9
assert(graph.issue.kind === "blastRadius", "issue.kind is blastRadius");
// 10
assert(graph.issue.severity === "CRIT", "severity passed through (CRIT)");
// 11: pure
const graph2 = resolveBlastRadiusTriageGraph({ finding: fixture, now: NOW });
assert(JSON.stringify(graph) === JSON.stringify(graph2), "resolver is pure (deterministic with fixed now)");

// 12: edge — empty evidence + single affected
const single = resolveBlastRadiusTriageGraph({
  finding: { ...fixture, evidence: [], affectedSessionIds: ["only"] },
  now: NOW,
});
assert(single.stages.length === 5, "single affected: still produces 5 stages");
const obj = single.artifacts.find((a) => a.stageId === "affectedObject");
assert(obj !== undefined && obj.state === "derived", "single affected: object state derived");
assert(obj!.primaryAction?.opts && (obj!.primaryAction!.opts as Record<string, unknown>).id === "only", "single affected: primaryAction includes id opt");

// 13: vector=shared_tool → Restrict capability
const sharedTool = resolveBlastRadiusTriageGraph({
  finding: { ...fixture, vector: "shared_tool" },
  now: NOW,
});
const fix2 = sharedTool.artifacts.find((a) => a.stageId === "fixControl");
assert(
  fix2!.previewSummary.includes("Restrict capability") || (fix2!.primaryAction?.label ?? "").includes("Restrict capability"),
  "shared_tool vector → Restrict capability verb",
);

// 14: vector=shared_session_template → Contain agent
const sharedTpl = resolveBlastRadiusTriageGraph({
  finding: { ...fixture, vector: "shared_session_template" },
  now: NOW,
});
const fix3 = sharedTpl.artifacts.find((a) => a.stageId === "fixControl");
assert(
  fix3!.previewSummary.includes("Contain agent") || (fix3!.primaryAction?.label ?? "").includes("Contain agent"),
  "shared_session_template vector → Contain agent verb",
);

// 15: vector=unknown → Diagnose
const unknownVec = resolveBlastRadiusTriageGraph({
  finding: { ...fixture, vector: "unknown" },
  now: NOW,
});
const fix4 = unknownVec.artifacts.find((a) => a.stageId === "fixControl");
assert(
  fix4!.previewSummary.includes("Diagnose") || (fix4!.primaryAction?.label ?? "").includes("Diagnose"),
  "unknown vector → Diagnose verb",
);

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
  // Category B — verbs with legit non-imperative uses ("Audit & Evidence" tab,
  // "view" inside compound phrases). Banned only at imperative-bare boundary
  // positions (sentence-start / after "." / ":" / "—"). Lookahead excludes
  // proper-noun "Audit & ...".
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
  const baseline = "Rotate credential: rotate the shared credential bound to all affected sessions.";

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

  const BOUNDARY_RE = /(?:^|[.:—]\s+)([Aa]udit|[Rr]eview|[Vv]iew)\s+(?!&)/;
  const PREFIXES: string[] = ["", ". ", ": ", "— "];
  const VERBS: string[] = ["Audit", "Review", "View"];
  for (const prefix of PREFIXES) {
    for (const verb of VERBS) {
      const synthetic = `${prefix}${verb} the rule`;
      assert(BOUNDARY_RE.test(synthetic), `self-test: BOUNDARY_RE catches "${synthetic}"`);
    }
  }
  assert(
    !BOUNDARY_RE.test("Drill into Audit & Evidence to open each signal."),
    `self-test: BOUNDARY_RE does not match proper-noun "Audit & Evidence"`,
  );
}

console.log();
console.log(`✅ All ${assertionCount} assertions passed`);
