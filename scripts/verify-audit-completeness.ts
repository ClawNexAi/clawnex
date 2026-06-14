/**
 * verify-audit-completeness.ts — behavioral veracity: the audit trail is truthful.
 *
 * ClawNex advertises an "immutable audit trail" with a stdout mirror for
 * tamper-evidence. This proves the logging mechanism is faithful: every field
 * passed to logEvent round-trips to the audit_log row unchanged, the
 * `[CLAWNEX_AUDIT]` stdout mirror emits a well-formed single-line JSON copy of
 * the same record, and the documented CLAWNEX_AUDIT_STDOUT=false switch
 * actually suppresses the mirror. An audit trail that silently drops or mangles
 * fields is worse than none — this guards against that regression.
 *
 * Hermetic: runs against a throwaway temp DB (DATABASE_PATH), never the live DB.
 *
 * Run: npx tsx scripts/verify-audit-completeness.ts
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Point the DB layer at a throwaway file BEFORE importing anything that opens it.
const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clawnex-audit-")));
process.env.DATABASE_PATH = path.join(tmpRoot, "audit-test.db");

const status = { pass: 0, fail: 0 };
function assert(cond: unknown, desc: string) {
  if (cond) status.pass++;
  else status.fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${desc}`);
}
function section(n: string) { console.log(`\n[${n}]`); }

// Capture console.log to inspect the [CLAWNEX_AUDIT] stdout mirror.
const realLog = console.log;
let captured: string[] = [];
function startCapture() { captured = []; console.log = (...a: unknown[]) => { captured.push(a.map(String).join(" ")); }; }
function stopCapture() { console.log = realLog; }
function mirrorLines() { return captured.filter(l => l.startsWith("[CLAWNEX_AUDIT]")); }

async function main() {
  const { logEvent, listEvents } = await import("../src/lib/services/audit-logger");

  // Force DB init (schema + seed) NOW, before we capture stdout — fresh-DB
  // seeding writes its own audit events whose mirror lines would otherwise
  // pollute the capture and the recency window.
  listEvents({ limit: 1 });

  section("1. logEvent round-trips every field faithfully");
  startCapture();
  const rec = logEvent("vx-alice", "veracity_audit_probe", "config", "proxy_block_mode", "off -> on", "clawnex");
  stopCapture();
  const rows = listEvents({ limit: 50 });
  const found = rows.find(r => r.id === rec.id);
  assert(found, "the written event is readable back from audit_log");
  if (found) {
    assert(found.actor === "vx-alice", `actor preserved (got ${found.actor})`);
    assert(found.action === "veracity_audit_probe", `action preserved (got ${found.action})`);
    assert(found.resource_type === "config", `resource_type preserved (got ${found.resource_type})`);
    assert(found.resource_id === "proxy_block_mode", `resource_id preserved (got ${found.resource_id})`);
    assert(found.detail === "off -> on", `detail preserved (got ${found.detail})`);
    assert(found.source === "clawnex", `source preserved (got ${found.source})`);
  }

  section("2. stdout mirror emits a well-formed single-line JSON copy");
  {
    const lines = mirrorLines();
    assert(lines.length === 1, `exactly one [CLAWNEX_AUDIT] line emitted (got ${lines.length})`);
    const jsonPart = lines[0]?.replace(/^\[CLAWNEX_AUDIT\]\s*/, "") ?? "";
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(jsonPart); } catch { /* leave null */ }
    assert(parsed !== null, "mirror payload is valid JSON");
    if (parsed) {
      assert(parsed.id === rec.id, "mirror id matches the DB row id (same record)");
      assert(parsed.actor === "vx-alice" && parsed.action === "veracity_audit_probe", "mirror actor + action match");
      assert(parsed.resource_id === "proxy_block_mode" && parsed.detail === "off -> on", "mirror resource + detail match");
      assert(!jsonPart.includes("\n"), "mirror is a single line (SIEM-ingestable)");
    }
  }

  section("3. CLAWNEX_AUDIT_STDOUT=false suppresses the mirror (documented switch)");
  {
    process.env.CLAWNEX_AUDIT_STDOUT = "false";
    startCapture();
    logEvent("bob", "operator_login", "operator", "bob", "ok", "clawnex");
    stopCapture();
    assert(mirrorLines().length === 0, "no [CLAWNEX_AUDIT] line when stdout mirror disabled");
    delete process.env.CLAWNEX_AUDIT_STDOUT;
    // but the DB row is still written (suppression is stdout-only)
    const rows2 = listEvents({ limit: 10 });
    assert(rows2.some(r => r.action === "operator_login" && r.actor === "bob"), "DB row still written even with mirror off");
  }

  // cleanup
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }

  realLog(`\n${status.fail === 0 ? "PASS" : "FAIL"}: ${status.pass} passed, ${status.fail} failed`);
  process.exit(status.fail === 0 ? 0 : 1);
}

main();
