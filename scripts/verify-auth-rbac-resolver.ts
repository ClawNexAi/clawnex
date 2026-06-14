/**
 * verify-auth-rbac-resolver.ts
 *
 * Hermetic test fixture for the auth/RBAC Triage Graph resolver.
 *
 *   npx tsx scripts/verify-auth-rbac-resolver.ts
 */

import {
  resolveAuthRbacTriageGraph,
  type AuthRbacFinding,
} from "../src/components/dashboard/triage/auth-rbac-resolver";
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
const fixture: AuthRbacFinding = {
  id: "auth-001",
  title: "RBAC disabled on /api/admin",
  severity: "HIGH",
  kind: "rbac_off",
  principal: "role:admin",
  resource: "/api/admin",
  evidence: ["enforcement disabled in config", "20 requests in last hour"],
};

const graph = resolveAuthRbacTriageGraph({ finding: fixture, now: NOW });

// 1
assert(typeof resolveAuthRbacTriageGraph === "function", "resolveAuthRbacTriageGraph is a function");
// 2
assert(graph.stages.length === 5, "graph has 5 stages");
// 3
const stageIds = graph.stages.map((s) => s.id);
assert(JSON.stringify(stageIds) === JSON.stringify(TRIAGE_STAGE_ORDER), "stage IDs match canonical order");
// 4
const expectedTitles = ["Evidence", "Source Event", "Affected Object", "Related Activity", "Fix / Control"];
assert(JSON.stringify(graph.stages.map((s) => s.title)) === JSON.stringify(expectedTitles), "stage titles match contract");
// 5
assert(graph.resolverVersion === "auth-rbac-resolver-v1", "resolverVersion is auth-rbac-resolver-v1");
// 6
for (const a of graph.artifacts) {
  assert((TRIAGE_STAGE_ORDER as string[]).includes(a.stageId), `artifact ${a.id} stageId is canonical`);
}
// 7
const idSet = new Set(graph.artifacts.map((a) => a.id));
assert(graph.defaultArtifactId !== undefined && idSet.has(graph.defaultArtifactId), "defaultArtifactId points at a real artifact");

// 8: Fix/Control verb — kind=rbac_off → Restrict capability
const fix = graph.artifacts.find((a) => a.stageId === "fixControl")!;
const verbHit = (ACTION_VERBS as readonly string[]).some((v) =>
  fix.previewSummary.includes(v) || (fix.primaryAction?.label ?? "").includes(v),
);
assert(verbHit, "fixControl artifact uses a canonical ActionVerb");
assert(
  fix.previewSummary.includes("Restrict capability") || (fix.primaryAction?.label ?? "").includes("Restrict capability"),
  "rbac_off → Restrict capability verb",
);

// 9
assert(graph.issue.kind === "authRbac", "issue.kind is authRbac");
// 10
assert(graph.issue.severity === "HIGH", "severity passed through (HIGH)");
// 11: pure
const graph2 = resolveAuthRbacTriageGraph({ finding: fixture, now: NOW });
assert(JSON.stringify(graph) === JSON.stringify(graph2), "resolver is pure");

// 12: edge — empty evidence
const noEv = resolveAuthRbacTriageGraph({
  finding: { ...fixture, evidence: [] },
  now: NOW,
});
assert(noEv.stages.length === 5, "empty evidence: 5 stages");

// 13: edge — no principal (posture-level finding)
const noPrincipal = resolveAuthRbacTriageGraph({
  finding: { ...fixture, principal: undefined },
  now: NOW,
});
const obj = noPrincipal.artifacts.find((a) => a.stageId === "affectedObject");
assert(obj !== undefined && obj.state === "missing", "no principal → affectedObject state = missing");

// 14: kind=missing_permission_check → Update policy
const miss = resolveAuthRbacTriageGraph({
  finding: { ...fixture, kind: "missing_permission_check" },
  now: NOW,
});
const fix2 = miss.artifacts.find((a) => a.stageId === "fixControl")!;
assert(
  fix2.previewSummary.includes("Update policy") || (fix2.primaryAction?.label ?? "").includes("Update policy"),
  "missing_permission_check → Update policy verb",
);

// 15: kind=stale_session → Rotate credential
const stale = resolveAuthRbacTriageGraph({
  finding: { ...fixture, kind: "stale_session" },
  now: NOW,
});
const fix3 = stale.artifacts.find((a) => a.stageId === "fixControl")!;
assert(
  fix3.previewSummary.includes("Rotate credential") || (fix3.primaryAction?.label ?? "").includes("Rotate credential"),
  "stale_session → Rotate credential verb",
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
  const baseline = "Restrict capability: re-enable RBAC enforcement on the affected resource.";

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
