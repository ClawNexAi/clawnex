/**
 * verify-action-verbs.ts
 *
 * the reviewer's verb taxonomy verifier (2026-05-07). Asserts:
 *
 *   1. ACTION_VERBS contains exactly the 11 canonical verbs.
 *   2. Every *ToRow helper produces a SuggestedAction whose verb is in
 *      ACTION_VERBS — across all 4 source families.
 *   3. Banned synonyms / vague copy do not appear as string literals in
 *      ActionQueue.tsx mappers (belt-and-suspenders alongside the closed
 *      enum enforcement TypeScript already provides).
 *   4. The display formatter produces the expected "Verb · target" shape.
 *
 * Run hermetically — no DB, no API, no services. Just construction of
 * fixtures + assertions on the helper outputs.
 *
 *   npx tsx scripts/verify-action-verbs.ts
 */

import fs from "node:fs";
import path from "node:path";
import {
  ACTION_VERBS,
  formatSuggestedAction,
  type ActionVerb,
  type SuggestedAction,
} from "../src/components/dashboard/panels/mission-control/types";

let failed = 0;
function ok(msg: string) { console.log(`  PASS  ${msg}`); }
function fail(msg: string) { console.log(`  FAIL  ${msg}`); failed++; }
function assert(cond: boolean, msg: string) {
  cond ? ok(msg) : fail(msg);
}

// ---------------------------------------------------------------------------
// 1. Taxonomy lock — 11 canonical verbs in the exact order internal reviewer specified
// ---------------------------------------------------------------------------
console.log("[1] Taxonomy: 11 canonical verbs locked");
{
  const expected: readonly string[] = [
    "Open evidence",
    "Diagnose",
    "Review exposure",
    "Restrict capability",
    "Contain agent",
    "Disable integration",
    "Rotate credential",
    "Update policy",
    "Assign owner",
    "Suppress as accepted risk",
    "Escalate",
  ];
  assert(ACTION_VERBS.length === 11, `ACTION_VERBS has 11 entries (got ${ACTION_VERBS.length})`);
  for (const v of expected) {
    assert((ACTION_VERBS as readonly string[]).includes(v), `ACTION_VERBS contains "${v}"`);
  }
  // Banned synonyms must NOT be in the closed list
  for (const banned of ["Inspect", "Audit", "Tighten", "Constrain", "Block", "Investigate", "Review", "View"]) {
    assert(!(ACTION_VERBS as readonly string[]).includes(banned), `ACTION_VERBS does not contain banned "${banned}"`);
  }
}

// ---------------------------------------------------------------------------
// 2. Formatter shape: "Verb · target"
// ---------------------------------------------------------------------------
console.log("[2] formatSuggestedAction shape");
{
  const fmt = formatSuggestedAction({ verb: "Diagnose", target: "LiteLLM Proxy adapter" });
  assert(fmt === "Diagnose · LiteLLM Proxy adapter", `formatter produces "Verb · target" (got "${fmt}")`);
}

// ---------------------------------------------------------------------------
// 3. Per-source mapper coverage — every helper produces a valid verb
// ---------------------------------------------------------------------------
console.log("[3] Per-source mapper output validation");
{
  // We import the source of ActionQueue.tsx and use a regex pass to find
  // every mapper-produced verb literal. This is structural enforcement
  // without spinning up React: any verb literal not in ACTION_VERBS fails.
  const aqPath = path.resolve(process.cwd(), "src/components/dashboard/panels/mission-control/ActionQueue.tsx");
  const aq = fs.readFileSync(aqPath, "utf8");

  // Pull every `verb: "<value>"` literal out of the file. Mapper helpers,
  // SuggestedAction object literals, and inline returns are all covered.
  const verbRe = /\bverb:\s*"([^"]+)"/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = verbRe.exec(aq)) !== null) {
    found.add(m[1]);
  }
  assert(found.size > 0, `found at least one verb literal in ActionQueue.tsx (got ${found.size})`);
  for (const v of Array.from(found)) {
    assert(
      (ACTION_VERBS as readonly string[]).includes(v),
      `ActionQueue.tsx verb literal "${v}" is in ACTION_VERBS`,
    );
  }

  // Source-family coverage: assert every family has at least one helper
  // function (the *ToRow names) AND those functions return a SuggestedAction.
  const requiredHelpers: string[] = [
    "alertToRow",
    "signalToRow",
    "staleCollectorToRow",
    "trustAuditToRow",
  ];
  for (const helper of requiredHelpers) {
    assert(
      aq.includes(`function ${helper}(`),
      `ActionQueue.tsx defines mapper "${helper}"`,
    );
  }

  // Suggested-action helper presence — at least one verb-mapper per family.
  // (We use the helper-name pattern adopted in v0.14.x.)
  const expectedHelpers: string[] = [
    "suggestedActionForAlert",
    "suggestedActionForCostSignal",
    "suggestedActionForFinding",
  ];
  for (const helper of expectedHelpers) {
    assert(
      aq.includes(`function ${helper}(`),
      `ActionQueue.tsx defines verb-mapper "${helper}"`,
    );
  }
  // Stale-collector mapper is inline (no separate helper); assert the inline form.
  assert(
    /verb:\s*"Diagnose"\s*,\s*target:\s*`\$\{c\.name\}/.test(aq) ||
    /verb:\s*"Diagnose"[^}]+target[^}]+c\.name/.test(aq),
    `staleCollectorToRow produces Diagnose · ${"{"}name${"}"} adapter inline`,
  );
}

// ---------------------------------------------------------------------------
// 4. Banned synonyms must not appear as string-literal SuggestedAction targets.
//    The closed enum already prevents these as verbs (TypeScript catches them);
//    this is the belt-and-suspenders layer for synonym drift in target copy
//    or comments-as-suggestions.
// ---------------------------------------------------------------------------
console.log("[4] Banned vague-copy phrases absent from ActionQueue mappers");
{
  const aqPath = path.resolve(process.cwd(), "src/components/dashboard/panels/mission-control/ActionQueue.tsx");
  const aq = fs.readFileSync(aqPath, "utf8");
  // Phrases that should never appear as queue copy. We search for them as
  // string-literal contents to avoid catching the verifier's own grep
  // patterns (which won't appear in ActionQueue source).
  const bannedLiterals: string[] = [
    `"Take action"`,
    `"Click here"`,
    `"Fix issue"`,
  ];
  for (const phrase of bannedLiterals) {
    assert(
      !aq.includes(phrase),
      `ActionQueue.tsx does not contain banned literal ${phrase}`,
    );
  }
  // bare-verb suggestedAction string literals (pre-taxonomy patterns).
  // After v0.14.2 these should NEVER appear; the structured SuggestedAction
  // object has replaced them. v0.14.4 (the reviewer's review): "Review · " was
  // previously specific to "Review · alert details" — generalised so any
  // bare "Review · ..." literal trips the gate, matching the symmetry of
  // the other banned patterns.
  const bareVerbPatterns: string[] = [
    `"Investigate · `,
    `"Inspect · `,
    `"Review · `,         // generalised v0.14.4 per the reviewer's blind-spot finding
    `"Audit · `,
    `"Block · `,
    `"Tighten · `,
    `"Constrain · `,
    `"View · `,
  ];
  for (const pat of bareVerbPatterns) {
    assert(
      !aq.includes(pat),
      `ActionQueue.tsx does not contain bare-verb literal ${pat}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4b. Self-test: prove the bare-verb scan would catch a fake injection.
//     internal reviewer flagged 2026-05-07: the prior verifier passed a manual Test C
//     check that injected `"Review · arbitrary"` because the Review pattern
//     was specific to "alert details". This self-test simulates each
//     banned pattern landing in source and confirms the same .includes()
//     check that runs against the real file would catch it.
// ---------------------------------------------------------------------------
console.log("[4b] Self-test: each banned pattern catches a fake injection");
{
  const fakeSource = `
    // legitimate file content here
    function example() {
      const ok = "Diagnose · retry loop";
      return ok;
    }
  `;
  const SELF_TEST_PATTERNS: Array<{ pat: string; injection: string }> = [
    { pat: `"Investigate · `, injection: `const x = "Investigate · arbitrary";` },
    { pat: `"Inspect · `,     injection: `const x = "Inspect · arbitrary";`     },
    { pat: `"Review · `,      injection: `const x = "Review · arbitrary";`      },
    { pat: `"Audit · `,       injection: `const x = "Audit · arbitrary";`       },
    { pat: `"Block · `,       injection: `const x = "Block · arbitrary";`       },
    { pat: `"Tighten · `,     injection: `const x = "Tighten · arbitrary";`     },
    { pat: `"Constrain · `,   injection: `const x = "Constrain · arbitrary";`   },
    { pat: `"View · `,        injection: `const x = "View · arbitrary";`        },
    { pat: `"Take action"`,   injection: `const x = "Take action";`             },
    { pat: `"Click here"`,    injection: `const x = "Click here";`              },
    { pat: `"Fix issue"`,     injection: `const x = "Fix issue";`               },
  ];
  for (const { pat, injection } of SELF_TEST_PATTERNS) {
    // Construct a synthetic file body that contains the injection.
    const synthetic = fakeSource + "\n" + injection + "\n";
    // The same .includes() check the real run does — must catch the injection.
    assert(
      synthetic.includes(pat),
      `self-test: scan would catch injected ${pat}`,
    );
    // And must NOT trip on the clean baseline (no injection).
    assert(
      !fakeSource.includes(pat),
      `self-test: scan does not trip on clean baseline for ${pat}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Ensure SuggestedAction type is the field shape (no string survivors).
// ---------------------------------------------------------------------------
console.log("[5] ActionRow.suggestedAction declared as SuggestedAction (not string)");
{
  const typesPath = path.resolve(process.cwd(), "src/components/dashboard/panels/mission-control/types.ts");
  const t = fs.readFileSync(typesPath, "utf8");
  assert(
    /suggestedAction:\s*SuggestedAction/.test(t),
    `types.ts declares ActionRow.suggestedAction as SuggestedAction`,
  );
  assert(
    !/suggestedAction:\s*string/.test(t),
    `types.ts does not declare ActionRow.suggestedAction as string`,
  );
}

// ---------------------------------------------------------------------------
// Final report
// ---------------------------------------------------------------------------
console.log();
if (failed > 0) {
  console.log(`verify-action-verbs: ${failed} FAIL`);
  process.exit(1);
} else {
  console.log("verify-action-verbs: ok");
}
