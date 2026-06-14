/**
 * CI gate — Mission Control forbidden-phrase + required-phrase audit.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md §14.2, §16.1
 *
 * Forbidden phrases must NEVER appear in mission-control source.
 * Required phrases MUST appear at least once. Required patterns are
 * source-content-tolerant: rendered template strings count, but they
 * must be structurally present (e.g. "Core Shield rules" label + a
 * numeric formatter is acceptable for the §5.6 coverage statement).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SCAN = [
  "src/components/dashboard/panels/MissionControlPanel.tsx",
  "src/components/dashboard/panels/mission-control",
];

const FORBIDDEN: Array<{ pattern: RegExp; label: string; allowedNegation?: RegExp }> = [
  { pattern: /\bwallet total\b/i, label: "wallet total" },
  { pattern: /\bdeduped total\b/i, label: "deduped total" },
  { pattern: /\bactual total spend\b/i, label: "actual total spend" },
  { pattern: /\binvoice-reconciled\b/i, label: "invoice-reconciled (must be preceded by 'Not')", allowedNegation: /\bnot[ -]invoice-reconciled\b/i },
  { pattern: /\b177 total\b/i, label: "177 total" },
  { pattern: /\b177-rule\b/i, label: "177-rule" },
  { pattern: /\b177 rules\b/i, label: "177 rules" },
];

const REQUIRED: Array<{ pattern: RegExp; label: string }> = [
  // §16.1: Cost Risk required-copy. Rendered as breakdown[0].label literal.
  { pattern: /Highest reported monitored spend/, label: "Highest reported monitored spend (Cost Risk breakdown label, spec §16.1)" },

  // §16.1: FinOps disclaimer. Spec allows two variations of "shown" suffix.
  // The header pill uses "Source totals shown separately"; the
  // SignalsAndSourceHealth footer uses "Source totals shown side-by-side".
  { pattern: /Source totals shown (side-by-side|separately)/, label: "Source totals shown side-by-side / separately (spec §16.1)" },

  // §16.1: Always paired with the FinOps disclaimer. Header pill literal.
  { pattern: /Not invoice-reconciled/, label: "Not invoice-reconciled (spec §16.1)" },

  // §5.6: Policy coverage descriptor. Source has the labels + numeric
  // template, not the literal sentence. Pattern accepts the structural
  // presence: a "Core Shield rules" label plus an "Active egress starter"
  // label, both within ~200 chars (i.e. living together in a breakdown
  // or footer block). This is what spec §5.6 actually demands functionally.
  { pattern: /Core Shield rules[\s\S]{0,200}Active egress starter/, label: "Core Shield rules + Active egress starter (spec §5.6)" },

  // §5.6: Lab held drafts surface. The source has the template
  // `${labHeldDrafts} lab drafts held`. Match against either the literal
  // suffix or the rendered "lab drafts held" / "Lab held drafts" labels.
  { pattern: /lab[\s-]?drafts?\s+held|Lab held drafts/i, label: "lab drafts held / Lab held drafts (spec §5.6)" },
];

function readAllFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out: string[] = [];
  for (const entry of fs.readdirSync(target)) {
    const full = path.join(target, entry);
    out.push(...readAllFiles(full));
  }
  return out.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

const files = SCAN.flatMap((p) => readAllFiles(path.join(ROOT, p)));
let pass = 0;
let fail = 0;
const allText = files.map((f) => fs.readFileSync(f, "utf-8")).join("\n\n");

console.log(`Scanning ${files.length} files…\n`);

console.log("[Forbidden phrases]");
for (const f of FORBIDDEN) {
  const matches = allText.match(new RegExp(f.pattern, "gi"));
  if (!matches || matches.length === 0) {
    console.log(`  PASS  forbidden phrase absent: "${f.label}"`);
    pass++;
    continue;
  }
  if (f.allowedNegation) {
    const negMatches = allText.match(new RegExp(f.allowedNegation, "gi"));
    if (negMatches && matches.length === negMatches.length) {
      console.log(`  PASS  forbidden phrase only in allowed-negation context: "${f.label}"`);
      pass++;
      continue;
    }
  }
  console.error(`  FAIL  forbidden phrase present: "${f.label}" (${matches.length} occurrence(s))`);
  fail++;
}

console.log("\n[Required phrases]");
for (const r of REQUIRED) {
  if (r.pattern.test(allText)) {
    console.log(`  PASS  required phrase present: "${r.label}"`);
    pass++;
  } else {
    console.error(`  FAIL  required phrase missing: "${r.label}"`);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
process.exit(fail === 0 ? 0 : 1);
