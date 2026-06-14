/**
 * verify-policy-warning-resolver.ts
 *
 * Hermetic test fixture for the policy-warning Triage Graph resolver.
 *
 *   npx tsx scripts/verify-policy-warning-resolver.ts
 */

import {
  resolvePolicyWarningTriageGraph,
  type PolicyWarningFinding,
} from "../src/components/dashboard/triage/policy-warning-resolver";
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
const fixture: PolicyWarningFinding = {
  id: "policy-001",
  title: "Shield rule low-confidence misfires",
  severity: "MED",
  ruleKey: "shield.detect.exfil",
  scope: "shield_rule",
  suggestedChange: "narrow the regex from .* to a more specific exfil pattern",
  recentFiringCount: 47,
  evidence: ["12% precision over last 24h", "high false positive rate"],
};

const graph = resolvePolicyWarningTriageGraph({ finding: fixture, now: NOW });

// 1
assert(typeof resolvePolicyWarningTriageGraph === "function", "resolvePolicyWarningTriageGraph is a function");
// 2
assert(graph.stages.length === 5, "graph has 5 stages");
// 3
const stageIds = graph.stages.map((s) => s.id);
assert(JSON.stringify(stageIds) === JSON.stringify(TRIAGE_STAGE_ORDER), "stage IDs match canonical order");
// 4
const expectedTitles = ["Evidence", "Source Event", "Affected Object", "Related Activity", "Fix / Control"];
assert(JSON.stringify(graph.stages.map((s) => s.title)) === JSON.stringify(expectedTitles), "stage titles match contract");
// 5
assert(graph.resolverVersion === "policy-warning-resolver-v1", "resolverVersion is policy-warning-resolver-v1");
// 6
for (const a of graph.artifacts) {
  assert((TRIAGE_STAGE_ORDER as string[]).includes(a.stageId), `artifact ${a.id} stageId is canonical`);
}
// 7
const idSet = new Set(graph.artifacts.map((a) => a.id));
assert(graph.defaultArtifactId !== undefined && idSet.has(graph.defaultArtifactId), "defaultArtifactId points at a real artifact");

// 8: Fix/Control verb — Update policy
const fix = graph.artifacts.find((a) => a.stageId === "fixControl")!;
const verbHit = (ACTION_VERBS as readonly string[]).some((v) =>
  fix.previewSummary.includes(v) || (fix.primaryAction?.label ?? "").includes(v),
);
assert(verbHit, "fixControl artifact uses a canonical ActionVerb");
assert(
  fix.previewSummary.includes("Update policy") || (fix.primaryAction?.label ?? "").includes("Update policy"),
  "policy warning → Update policy verb",
);

// 9
assert(graph.issue.kind === "policyWarning", "issue.kind is policyWarning");
// 10
assert(graph.issue.severity === "MED", "severity passed through (MED)");
// 11: pure
const graph2 = resolvePolicyWarningTriageGraph({ finding: fixture, now: NOW });
assert(JSON.stringify(graph) === JSON.stringify(graph2), "resolver is pure");

// 12: source event navigates to shield with rule focus opt
const src = graph.artifacts.find((a) => a.stageId === "sourceEvent")!;
assert(src.primaryAction?.tab === "shield", "sourceEvent primaryAction.tab is shield");
const focusOpt = src.primaryAction?.opts && (src.primaryAction!.opts as Record<string, unknown>).focus;
assert(focusOpt === fixture.ruleKey, "sourceEvent primaryAction.opts.focus is the ruleKey");

// 13: edge — empty evidence + no suggestedChange
const noSuggested = resolvePolicyWarningTriageGraph({
  finding: { ...fixture, evidence: [], suggestedChange: undefined },
  now: NOW,
});
assert(noSuggested.stages.length === 5, "no suggested change: 5 stages");
const fixNoSugg = noSuggested.artifacts.find((a) => a.stageId === "fixControl")!;
assert(
  fixNoSugg.previewSummary.includes("Update policy"),
  "no suggested change: still uses Update policy verb in fallback copy",
);

// 14: scope=config_drift produces a different affected-object explanation
const drift = resolvePolicyWarningTriageGraph({
  finding: { ...fixture, scope: "config_drift" },
  now: NOW,
});
const driftObj = drift.artifacts.find((a) => a.stageId === "affectedObject")!;
assert(driftObj.previewSummary.toLowerCase().includes("drift"), "config_drift scope: affected-object summary mentions drift");

// 15: Affected Object always resolved (the rule itself)
const obj = graph.artifacts.find((a) => a.stageId === "affectedObject")!;
assert(obj.state === "resolved", "affectedObject state = resolved (the rule)");

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
  // Category A — bare imperative verbs with no legit non-verb usage in our
  // domain. Any case, anywhere in operator copy fails.
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
  const baseline = "Update policy: tune the rule in Shield based on recent firings.";

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
