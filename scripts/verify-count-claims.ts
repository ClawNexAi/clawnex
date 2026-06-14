/**
 * verify-count-claims.ts — veracity audit anti-drift guard.
 *
 * ClawNex advertises specific quantities in UI copy, tooltips, and marketing
 * docs (e.g. "163 shield rules", "15-rule trust scan", "26 dashboard tabs",
 * "16 Pliny rules"). A wrong number on a SECURITY product reads as "if they
 * can't count their own rules, why trust the shield." This verifier ties the
 * advertised numbers to the actual source-of-truth arrays so drift fails CI
 * instead of shipping to operators.
 *
 * The Trust Audit panel previously hardcoded "14-rule" while AUDIT_RULES had
 * 15 — that class of bug is exactly what this pins.
 *
 * Run: npx tsx scripts/verify-count-claims.ts
 */

import * as fs from "fs";
import * as path from "path";

import { AUDIT_RULES } from "../src/lib/services/trust-audit/rules";
import { TRUST_AUDIT_RULE_COUNT } from "../src/lib/services/trust-audit/types";
import { ALL_RULES } from "../src/lib/shield/rules";

const status = { pass: 0, fail: 0 };

function check(desc: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (ok) status.pass++;
  else status.fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${desc}${ok ? "" : ` (got ${String(got)}, want ${String(want)})`}`);
}

function section(name: string) {
  console.log(`\n[${name}]`);
}

const ROOT = path.resolve(__dirname, "..");

section("1. Trust Audit rule count (F1 anti-drift)");
// The canonical array is server-only; the client-safe mirror must equal it,
// and both must equal the number the UI tooltip renders (15).
check("AUDIT_RULES.length === 15", AUDIT_RULES.length, 15);
check("TRUST_AUDIT_RULE_COUNT mirror === AUDIT_RULES.length", TRUST_AUDIT_RULE_COUNT, AUDIT_RULES.length);
{
  // The tooltip must derive from the constant, not a literal — assert no
  // hardcoded "14-rule"/"15-rule" literal survives in the panel source.
  const panel = fs.readFileSync(
    path.join(ROOT, "src/components/dashboard/panels/TrustAuditPanel.tsx"),
    "utf8",
  );
  check("TrustAuditPanel has no hardcoded N-rule literal", /\b1[0-9]-rule trust-boundary scan\b/.test(panel), false);
  check("TrustAuditPanel renders {TRUST_AUDIT_RULE_COUNT}", panel.includes("{TRUST_AUDIT_RULE_COUNT}-rule"), true);
}

section("2. Shield rule count (headline '163' claim)");
check("ALL_RULES.length === 163", ALL_RULES.length, 163);
{
  const cats = new Set(ALL_RULES.map(r => r.category));
  check("Shield categories === 10", cats.size, 10);
  const pliny = ALL_RULES.filter(
    r => /pliny/i.test(r.id) || /pliny/i.test((r as { title?: string }).title ?? ""),
  );
  check("Pliny-tagged rules === 16", pliny.length, 16);
}

section("3. Dashboard tab count (canonical 26)");
{
  // TabId is a type union (no runtime value); parse it from source so the
  // verifier stays hermetic. Marketing/user docs must match this number.
  const typesSrc = fs.readFileSync(path.join(ROOT, "src/components/dashboard/types.ts"), "utf8");
  const m = typesSrc.match(/export type TabId =([\s\S]*?);/);
  const members = m ? (m[1].match(/"[a-zA-Z]+"/g) || []).length : -1;
  check("TabId union has 26 members", members, 26);
}

console.log(`\n${status.fail === 0 ? "PASS" : "FAIL"}: ${status.pass} passed, ${status.fail} failed`);
process.exit(status.fail === 0 ? 0 : 1);
