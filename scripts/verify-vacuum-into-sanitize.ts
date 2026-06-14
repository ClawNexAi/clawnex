/**
 * verify-vacuum-into-sanitize.ts
 *
 * DAST 2026-05-15 #6 follow-up: asserts the vacuum-into helpers reject
 * path-injection shapes BEFORE either the SQL parser or the
 * fs.copyFileSync fallback gets a chance to see them.
 *
 * The 2-step API (resolveVacuumBackupPath → vacuumIntoResolved) was
 * introduced to close a fallback bypass: when the 1-step `vacuumInto`
 * threw on a bad basename, the caller's catch branch was free to
 * re-join the same basename via path.join and pass it to
 * fs.copyFileSync. Routes now resolve the safe absolute path UPFRONT
 * and re-use it on both branches. This verifier proves:
 *
 *   1. resolveVacuumBackupPath throws on every path-injection shape.
 *   2. vacuumInto throws on the same shapes (regression check for the
 *      thin convenience wrapper).
 *   3. resolveVacuumBackupPath returns the same safe absolute path
 *      that vacuumIntoResolved would consume — i.e. routes can hand
 *      the same value to fs.copyFileSync without re-introducing
 *      basename injection.
 *
 *   npx tsx scripts/verify-vacuum-into-sanitize.ts
 */

import path from 'node:path';
import {
  resolveVacuumBackupPath,
  vacuumInto,
} from '../src/lib/db/vacuum-into';

interface Case { name: string; ok: boolean; detail?: string }
const results: Case[] = [];

function assertThrows(
  name: string,
  fn: () => unknown,
  expectFragment?: string,
) {
  try {
    fn();
    results.push({ name, ok: false, detail: 'expected throw, got pass' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (expectFragment && !msg.includes(expectFragment)) {
      results.push({ name, ok: false, detail: `wrong message: ${msg}` });
      return;
    }
    results.push({ name, ok: true });
  }
}

const DIR = '/tmp';

// ---- Group A: resolveVacuumBackupPath rejects bad basenames -----------
const badCases: Array<[string, string, string]> = [
  ['slash in basename', 'etc/passwd', 'slash'],
  ['backslash in basename', 'evil\\path', 'slash'],
  ['parent dir', '../etc/passwd', 'slash'],
  ['dot-dot only', '..', '..'],
  ['dot-dot embedded', 'foo..bar', '..'],
  ['single quote', "evil'.db", 'quotes'],
  ['double quote', 'evil".db', 'quotes'],
  ['null byte', 'evil\x00.db', 'quotes'],
  ['empty string', '', 'non-empty'],
];

for (const [name, file, frag] of badCases) {
  assertThrows(
    `resolve: ${name}`,
    () => resolveVacuumBackupPath(DIR, file),
    frag,
  );
}
// @ts-expect-error — testing runtime guard against TS-strict callers
assertThrows('resolve: undefined', () => resolveVacuumBackupPath(DIR, undefined), 'non-empty');
// @ts-expect-error
assertThrows('resolve: null', () => resolveVacuumBackupPath(DIR, null), 'non-empty');
// @ts-expect-error
assertThrows('resolve: number', () => resolveVacuumBackupPath(DIR, 42), 'non-empty');

// ---- Group B: vacuumInto wrapper rejects the same shapes --------------
// Quick regression check — wrapper must not paper over the validation.
for (const [name, file, frag] of badCases) {
  assertThrows(
    `wrapper: ${name}`,
    () => vacuumInto(DIR, file),
    frag,
  );
}

// ---- Group C: happy path returns a usable absolute path ---------------
// resolveVacuumBackupPath on a valid basename returns the same path
// that fs.copyFileSync could re-use. This is the property that lets
// routes call resolveVacuumBackupPath once and feed both VACUUM and
// the fallback copy from a single validated value.
try {
  const safe = resolveVacuumBackupPath(DIR, 'clawnex-backup-2026-05-15T12-00-00.db');
  const expected = path.resolve(DIR, 'clawnex-backup-2026-05-15T12-00-00.db');
  if (safe === expected) {
    results.push({ name: 'happy: returns absolute path inside backupDir', ok: true });
  } else {
    results.push({
      name: 'happy: returns absolute path inside backupDir',
      ok: false,
      detail: `got ${safe} want ${expected}`,
    });
  }
} catch (err) {
  results.push({
    name: 'happy: returns absolute path inside backupDir',
    ok: false,
    detail: `unexpected throw: ${err instanceof Error ? err.message : String(err)}`,
  });
}

// ---- Group D: routes must not call vacuumInto-then-path.join-fallback -
// Static check on the three known routes: each must import the safe
// helper AND must NOT contain a `path.join(...backupFile)` that ends
// up at fs.copyFileSync. Regression guard for the bypass operator caught
// during commit 6430c2b review.
import fs from 'node:fs';
const ROUTE_FILES = [
  'src/app/api/system/archive/route.ts',
  'src/app/api/system/uninstall/route.ts',
  'src/app/api/system/migrate/route.ts',
];
for (const rel of ROUTE_FILES) {
  const abs = path.resolve(__dirname, '..', rel);
  const src = fs.readFileSync(abs, 'utf8');
  const importsResolver = src.includes('resolveVacuumBackupPath');
  // The vulnerable shape was `fs.copyFileSync(..., path.join(backupDir, backupFile))`
  // — i.e. the fallback re-joined the basename instead of reusing the
  // validated absolute path. Reject any remaining occurrence of a
  // `path.join(...backupFile...)` argument inside a copyFileSync call.
  const reJoinedBypass =
    /copyFileSync\([^)]*path\.join\([^)]*backupFile/m.test(src);

  results.push({
    name: `static: ${rel} imports resolveVacuumBackupPath`,
    ok: importsResolver,
  });
  results.push({
    name: `static: ${rel} no path.join(...backupFile) in copyFileSync arg`,
    ok: !reJoinedBypass,
  });
}

const failures = results.filter((r) => !r.ok);
for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log('');
if (failures.length === 0) {
  console.log(`PASS — ${results.length}/${results.length} sanitize + bypass-defense assertions hold`);
  process.exit(0);
}
console.log(`FAIL — ${failures.length}/${results.length} assertion(s) failed`);
process.exit(1);
