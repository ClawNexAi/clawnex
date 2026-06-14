/**
 * verify-db-path-resolver.ts — Codex 2026-05-17 #4 regression.
 *
 * archive, migrate, and uninstall routes used to hardcode
 * process.cwd()/sentinel.db. Post-rebrand the live DB is clawnex.db (or
 * wherever DATABASE_PATH points), so the routes silently returned "no
 * DB" / skipped the backup step on fresh installs — operators believed
 * they had a backup when they didn't, and the uninstall path's
 * pre-removal snapshot ran with zero data.
 *
 * This verifier proves:
 *   1. getDbPath() honors DATABASE_PATH (absolute and relative).
 *   2. getDbPath() prefers legacy sentinel.db when DATABASE_PATH is unset
 *      AND sentinel.db exists in cwd (back-compat).
 *   3. getDbPath() falls back to clawnex.db when neither legacy file nor
 *      DATABASE_PATH is present (post-rebrand default).
 *   4. The three system routes (archive, migrate, uninstall) all import
 *      getDbPath rather than hardcoding sentinel.db.
 *
 * Run: npx tsx scripts/verify-db-path-resolver.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

type Status = { pass: number; fail: number };
const status: Status = { pass: 0, fail: 0 };

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

// Set DATABASE_PATH to ':memory:' BEFORE importing the db module so its
// module-init seed runs against an in-memory DB and doesn't try to write
// to disk. The resolver test below temporarily overrides DATABASE_PATH for
// each scenario; the module-level db instance is already constructed by
// then and doesn't re-read DATABASE_PATH.
process.env.DATABASE_PATH = ":memory:";
process.env.CLAWNEX_AUDIT_STDOUT = "false";

import { getDbPath } from "../src/lib/db/index";

// ---------------------------------------------------------------------------

section("getDbPath honors DATABASE_PATH env var");
process.env.DATABASE_PATH = "/tmp/verify-db-path-explicit.db";
assert(getDbPath() === "/tmp/verify-db-path-explicit.db", "absolute DATABASE_PATH passed through unchanged");

process.env.DATABASE_PATH = "relative-db-name.db";
const expectedRel = path.resolve(process.cwd(), "relative-db-name.db");
assert(getDbPath() === expectedRel, `relative DATABASE_PATH resolved against cwd (got '${getDbPath()}', expected '${expectedRel}')`);

process.env.DATABASE_PATH = ":memory:";
assert(getDbPath() === ":memory:", "':memory:' sentinel passes through verbatim for hermetic tests");

section("getDbPath falls back to filesystem-detected legacy / default basename");
// We need an isolated cwd for the no-env scenarios so we don't accidentally
// hit a real sentinel.db / clawnex.db in the repo root. Use a tmpdir,
// then realpathSync to canonicalize (macOS symlinks /var → /private/var
// and process.cwd() returns the canonical form after chdir, which would
// otherwise mismatch path.resolve(tmpRoot, …)).
const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "db-path-test-")));
const originalCwd = process.cwd();
process.chdir(tmpRoot);
delete process.env.DATABASE_PATH;
try {
  // Scenario A: neither file present → clawnex.db (post-rebrand default)
  assert(
    getDbPath() === path.resolve(tmpRoot, "clawnex.db"),
    "no DATABASE_PATH + no legacy file → clawnex.db (post-rebrand default)",
  );

  // Scenario B: only legacy sentinel.db present → use it (back-compat)
  fs.writeFileSync(path.join(tmpRoot, "sentinel.db"), "");
  assert(
    getDbPath() === path.resolve(tmpRoot, "sentinel.db"),
    "no DATABASE_PATH + legacy sentinel.db present → prefer legacy (back-compat)",
  );

  // Scenario C: both files present → still prefer legacy (operator + internal reviewer rule:
  // never silently abandon an upgrading install's history).
  fs.writeFileSync(path.join(tmpRoot, "clawnex.db"), "");
  assert(
    getDbPath() === path.resolve(tmpRoot, "sentinel.db"),
    "no DATABASE_PATH + both files present → still prefer legacy sentinel.db",
  );
} finally {
  process.chdir(originalCwd);
  // Restore :memory: so any subsequent test in this process doesn't accidentally
  // touch the real DB.
  process.env.DATABASE_PATH = ":memory:";
  // Clean up tmpdir.
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
}

section("archive/migrate/uninstall routes import getDbPath (no hardcoded sentinel.db)");
const archiveSrc = fs.readFileSync(path.join(__dirname, "..", "src", "app", "api", "system", "archive", "route.ts"), "utf8");
const migrateSrc = fs.readFileSync(path.join(__dirname, "..", "src", "app", "api", "system", "migrate", "route.ts"), "utf8");
const uninstallSrc = fs.readFileSync(path.join(__dirname, "..", "src", "app", "api", "system", "uninstall", "route.ts"), "utf8");

assert(/getDbPath/.test(archiveSrc) && !/process\.cwd\(\),\s*["']sentinel\.db["']/.test(archiveSrc), "archive route uses getDbPath and no hardcoded cwd/sentinel.db");
assert(/getDbPath/.test(migrateSrc) && !/installDir,\s*["']sentinel\.db["']/.test(migrateSrc), "migrate route uses getDbPath and no hardcoded installDir/sentinel.db");
assert(/getDbPath/.test(uninstallSrc) && !/installDir,\s*["']sentinel\.db["']/.test(uninstallSrc), "uninstall route uses getDbPath and no hardcoded installDir/sentinel.db");

console.log(`\nResult: ${status.pass} passed, ${status.fail} failed`);
if (status.fail > 0) process.exit(1);
