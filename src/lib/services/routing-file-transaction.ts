import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function regularFile(file: string, allowMissing = false) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Routing requires a regular, non-linked configuration file.');
    return stat;
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function publishRoutingFile(file: string, content: string, mode: number, owner?: { uid: number; gid: number }) {
  regularFile(file, true);
  const temp = `${file}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, 'wx', mode);
    if (owner) {
      const created = fs.fstatSync(fd);
      if (created.uid !== owner.uid || created.gid !== owner.gid) fs.fchownSync(fd, owner.uid, owner.gid);
      fs.fchmodSync(fd, mode);
    }
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

/** The journal must include ownership for both pending writes and pending restores.
 * It is deliberately retained on failure so restoration never loses its evidence.
 */
export function commitRoutingFile(input: {
  configPath: string; expectedRaw: string; updatedRaw: string;
  journalPath: string; recoveryJournal: unknown; expectedJournal?: unknown;
}): void {
  const lockPath = `${input.journalPath}.lock`;
  let lock: number;
  try { lock = fs.openSync(lockPath, 'wx', 0o600); }
  catch { throw new Error('Another routing operation or an interrupted operation needs review. No configuration was changed.'); }
  try {
    const configStat = regularFile(input.configPath)!;
    regularFile(input.journalPath, true);
    if (fs.readFileSync(input.configPath, 'utf8') !== input.expectedRaw) throw new Error('Configuration changed since review. Refresh and approve a new plan.');
    if (input.expectedJournal !== undefined) {
      const current = fs.existsSync(input.journalPath) ? JSON.parse(fs.readFileSync(input.journalPath, 'utf8')) : null;
      if (JSON.stringify(current) !== JSON.stringify(input.expectedJournal)) throw new Error('Routing ownership changed since review. Refresh and approve again.');
    }
    publishRoutingFile(input.journalPath, JSON.stringify(input.recoveryJournal, null, 2), 0o600);
    if (fs.readFileSync(input.configPath, 'utf8') !== input.expectedRaw) throw new Error('Configuration changed during preparation; recovery record retained.');
    publishRoutingFile(input.configPath, input.updatedRaw, configStat.mode & 0o777, configStat);
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

export function removeRoutingJournal(file: string): void {
  if (!regularFile(file, true)) return;
  fs.unlinkSync(file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

/** Serialize the entire module operation, including asynchronous validation and final ownership publication. */
export function withRoutingOperationLock<T>(journalPath: string, task: () => Promise<T>): Promise<T>;
export function withRoutingOperationLock<T>(journalPath: string, task: () => T): T;
export function withRoutingOperationLock<T>(journalPath: string, task: () => T | Promise<T>): T | Promise<T> {
  const file = `${journalPath}.operation.lock`;
  let fd: number;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch { throw new Error('Another routing operation or retained recovery lock needs review. No changes were made.'); }
  const release = () => { fs.closeSync(fd); fs.unlinkSync(file); };
  try {
    const result = task();
    if (result && typeof (result as Promise<T>).then === 'function') {
      return Promise.resolve(result).finally(release);
    }
    release();
    return result;
  } catch (error) {
    release();
    throw error;
  }
}
