/**
 * ClawNex Database — SQLite via better-sqlite3.
 *
 * Singleton database connection with WAL mode for concurrent reads.
 * On first connection, initializes the schema (15 tables), runs migrations,
 * seeds default config, and enforces data retention.
 *
 * Uses synchronous better-sqlite3 (not async) — all queries are blocking.
 * This is intentional: SQLite is local, sub-millisecond, and synchronous
 * APIs are simpler than async for a single-node deployment.
 *
 * @module db/index
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA, MIGRATIONS } from './schema';

/** Singleton database instance — null until first getDb() call */
let db: Database.Database | null = null;

/** Prevents re-running seed/retention on hot reload in dev mode */
let seeded = false;

/**
 * Resolve the database file path.
 * Priority:
 *   1. DATABASE_PATH env var (explicit operator choice — wins always)
 *   2. ./sentinel.db when it exists in cwd (legacy filename, kept for
 *      backwards-compat with installs that pre-date the v0.9 ClawNex
 *      rebrand and never set DATABASE_PATH explicitly)
 *   3. ./clawnex.db (the post-rebrand default — what new installs get)
 */
export function getDbPath(): string {
  const envPath = process.env.DATABASE_PATH;
  if (envPath) {
    // ':memory:' is a SQLite sentinel for an in-memory database — pass through
    // verbatim so better-sqlite3 sees the magic string instead of resolving it
    // to a file path. Used by hermetic test harnesses (verify-*-units.ts).
    if (envPath === ':memory:') return ':memory:';
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  // Backwards-compat: prefer pre-rebrand sentinel.db if it's already there,
  // so a legacy install upgrading without setting DATABASE_PATH explicitly
  // doesn't silently start a fresh empty clawnex.db and lose history.
  const legacy = path.resolve(process.cwd(), 'sentinel.db');
  if (fs.existsSync(legacy)) return legacy;
  return path.resolve(process.cwd(), 'clawnex.db');
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();

  // DAST 2026-05-15 H2 (Run 2 follow-up): the original fix chmod'd
  // 600 AFTER open + WAL pragma, which left a race window where a
  // freshly-created DB existed at 644 from the umask before chmod
  // fired. Set umask to 0o077 before constructing the connection so
  // the DB file (and WAL/SHM lazily created by journal_mode=WAL
  // below) are born at 600. Restore prior umask immediately after
  // — process umask leaks into every subsequent file create.
  const prevUmask = (dbPath !== ':memory:' && os.platform() !== 'win32') ? process.umask(0o077) : null;
  try {
    db = new Database(dbPath);

    // Performance: WAL mode for concurrent reads
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    // Belt-and-suspenders: even with umask set, an existing DB file
    // from a prior umask=022 process could still be at 644. chmod
    // explicitly to be sure. WAL/SHM may not exist yet at this
    // point — sqlite creates them lazily under load — so chmod is
    // best-effort.
    if (dbPath !== ':memory:' && os.platform() !== 'win32') {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.chmodSync(dbPath + suffix, 0o600);
        } catch {
          // File may not exist yet (WAL/SHM lazy creation) or the FS is
          // read-only. Best-effort — sqlite will create the siblings
          // under the tightened umask above.
        }
      }
    }
  } finally {
    if (prevUmask !== null) process.umask(prevUmask);
  }

  // Run schema
  db.exec(SCHEMA);

  // Run migrations (idempotent — duplicate column errors are ignored)
  for (const migration of MIGRATIONS) {
    try {
      db.exec(migration);
    } catch {
      // Expected: "duplicate column name" on re-runs — ignore
    }
  }

  console.log(`[ClawNex DB] Initialized at ${dbPath}`);

  // Seed config tables on first run (deferred import to avoid circular deps)
  if (!seeded && process.env.CLAWNEX_TEST_SKIP_DB_SEED !== '1') {
    seeded = true;
    try {
      const { seedConfigTables } = require('./seed');
      seedConfigTables();
    } catch (err) {
      console.error('[ClawNex DB] Seed error:', err);
    }

    // Enforce 3-day retention on startup
    try {
      const { enforceRetention } = require('./retention');
      enforceRetention();
    } catch (err) {
      console.error('[ClawNex DB] Retention error:', err);
    }
  }

  return db;
}

/**
 * Execute a SELECT query and return all matching rows.
 * @param sql - SQL query with ? placeholders
 * @param params - Parameter values for placeholders
 * @returns Array of typed rows (empty array if no matches)
 */
export function queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

/**
 * Execute a SELECT query and return the first matching row.
 * @param sql - SQL query with ? placeholders
 * @param params - Parameter values for placeholders
 * @returns Single typed row, or undefined if no match
 */
export function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/**
 * Execute an INSERT, UPDATE, or DELETE statement.
 * @param sql - SQL statement with ? placeholders
 * @param params - Parameter values for placeholders
 * @returns RunResult with changes count and lastInsertRowid
 */
export function run(sql: string, params: unknown[] = []): Database.RunResult {
  return getDb().prepare(sql).run(...params);
}

/**
 * Execute multiple operations in a single SQLite transaction.
 * If the function throws, all changes are rolled back.
 * @param fn - Function containing database operations
 * @returns The return value of fn
 */
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}
