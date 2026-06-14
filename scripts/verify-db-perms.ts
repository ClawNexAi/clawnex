/**
 * verify-db-perms.ts
 *
 * DAST 2026-05-15 H2 (Run 2): asserts the SQLite DB triple is created
 * at mode 600, not 644. Run after `getDb()` initializes a fresh DB so
 * the umask-077 + chmod-600 path in src/lib/db/index.ts both fire.
 *
 * Wrapper: scripts/verify-db-perms.sh — pins DATABASE_PATH to a tmp
 * file under /tmp so we don't touch the real clawnex.db.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../src/lib/db';

const dbPath = process.env.DATABASE_PATH;
if (!dbPath || dbPath === ':memory:') {
  console.error('FAIL — DATABASE_PATH must be set to a real file path for this test');
  process.exit(1);
}

// Force the DB to exist + WAL/SHM to lazy-create by running a writing
// statement. WAL/SHM only appear once sqlite writes the first journal
// record.
const db = getDb();
db.exec(`CREATE TABLE IF NOT EXISTS _h2_smoke (id INTEGER PRIMARY KEY, ts TEXT)`);
const stmt = db.prepare(`INSERT INTO _h2_smoke (ts) VALUES (?)`);
for (let i = 0; i < 5; i += 1) stmt.run(new Date().toISOString());

interface Case { name: string; ok: boolean; detail?: string }
const results: Case[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function modeOf(p: string): string | null {
  try {
    const m = fs.statSync(p).mode & 0o777;
    return m.toString(8).padStart(3, '0');
  } catch {
    return null;
  }
}

const suffixes = ['', '-wal', '-shm'];
const platformAllowsChmod = os.platform() !== 'win32';

for (const sfx of suffixes) {
  const p = dbPath + sfx;
  const exists = fs.existsSync(p);
  if (!exists) {
    // WAL/SHM may not exist on a read-only DB; skip those.
    check(`${path.basename(p)} exists`, sfx === '', `dbPath=${p} missing`);
    continue;
  }
  const mode = modeOf(p);
  if (!platformAllowsChmod) {
    check(`${path.basename(p)} mode (windows/skip)`, true);
    continue;
  }
  check(
    `${path.basename(p)} mode == 600`,
    mode === '600',
    `got=${mode}`,
  );
}

const failures = results.filter((r) => !r.ok);
for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log('');
if (failures.length === 0) {
  console.log(`PASS — ${results.length}/${results.length} DB-perm assertions hold`);
  process.exit(0);
}
console.log(`FAIL — ${failures.length}/${results.length} assertion(s) failed`);
process.exit(1);
