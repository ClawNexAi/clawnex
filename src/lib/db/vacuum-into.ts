/**
 * Hardened wrapper for SQLite `VACUUM INTO`.
 *
 * Why this exists
 * ---------------
 * `VACUUM INTO` is not parameterizable — the destination path is
 * concatenated into raw SQL. The three call sites today (archive,
 * uninstall, migrate) build the path from server-generated timestamps
 * with no user input, so there is no live exploit. But the *pattern*
 * is a latent SQL-injection sink: a future change that lets any
 * operator-supplied byte reach this path silently turns into command
 * injection against the SQLite parser. Validating here closes the
 * class for every current and future caller.
 *
 * Validation rules (resolveVacuumBackupPath)
 * ------------------------------------------
 *   - `backupFile` MUST be a basename — no `/`, no `\`, no `..` path
 *     traversal, no null bytes, no quote characters.
 *   - The resolved absolute path MUST stay inside `backupDir`.
 *
 * Why the helper is exported
 * --------------------------
 * Each route's try/catch fallback (fs.copyFileSync on VACUUM error)
 * historically re-used the unvalidated `path.join(backupDir, backupFile)`,
 * which would re-introduce a bad path if a future change ever let user
 * input reach `backupFile`. Routes now MUST call
 * `resolveVacuumBackupPath` once at the top, propagating any throw
 * BEFORE the try/fallback, and then re-use the returned safe absolute
 * path for both the VACUUM and the copy branch. The validation can no
 * longer be bypassed via the fallback edge.
 *
 * @module db/vacuum-into
 */

import path from 'node:path';
import { run } from './index';

/**
 * Validate + resolve a basename against a backup directory. Throws on
 * any path-injection shape. Returns the absolute filesystem path the
 * caller should use for BOTH the VACUUM INTO statement and any
 * fallback file copy — no second `path.join(backupDir, backupFile)`
 * call should happen downstream.
 */
export function resolveVacuumBackupPath(backupDir: string, backupFile: string): string {
  if (!backupFile || typeof backupFile !== 'string') {
    throw new Error('resolveVacuumBackupPath: backupFile must be a non-empty string');
  }
  if (backupFile.includes('/') || backupFile.includes('\\')) {
    throw new Error('resolveVacuumBackupPath: backupFile must be a basename (no slashes)');
  }
  if (backupFile.includes('..')) {
    throw new Error('resolveVacuumBackupPath: backupFile must not contain ".."');
  }
  if (/['"\0]/.test(backupFile)) {
    throw new Error('resolveVacuumBackupPath: backupFile must not contain quotes or null bytes');
  }

  const fullDir = path.resolve(backupDir);
  const fullPath = path.resolve(fullDir, backupFile);
  if (fullPath !== fullDir && !fullPath.startsWith(fullDir + path.sep)) {
    throw new Error('resolveVacuumBackupPath: resolved path escapes the backup directory');
  }
  return fullPath;
}

/**
 * Run `VACUUM INTO` against a pre-resolved backup path. Pass the result
 * of `resolveVacuumBackupPath()` — the caller is responsible for
 * computing it once, upfront, so the validation can't be bypassed by a
 * fallback that re-joins the basename.
 */
export function vacuumIntoResolved(absoluteBackupPath: string): void {
  // Even though resolveVacuumBackupPath already strips quote chars,
  // double-escape on the way into SQL so the literal stays well-formed
  // if a future relaxation lets one through.
  const sqlPath = absoluteBackupPath.replace(/'/g, "''");
  run(`VACUUM INTO '${sqlPath}'`);
}

/**
 * Convenience wrapper for callers that don't need to share the
 * resolved path with a fallback. Validates and runs in one shot.
 *
 * Most routes should use the two-step pattern — `resolveVacuumBackupPath`
 * at the top of the handler, then `vacuumIntoResolved` inside the
 * try/catch — so the fallback `fs.copyFileSync` re-uses the same
 * validated absolute path instead of rejoining basename + dir.
 */
export function vacuumInto(backupDir: string, backupFile: string): void {
  vacuumIntoResolved(resolveVacuumBackupPath(backupDir, backupFile));
}
