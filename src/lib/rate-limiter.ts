/**
 * ClawNex Sliding Window Rate Limiter — DB-backed.
 *
 * Tracks request timestamps per API key. Each check prunes timestamps older
 * than 60 seconds, then counts remaining entries against the key's limit.
 *
 * SQLite persistence (CX-R14-12 / new-assessment #12) keeps the window
 * across process restarts so an attacker can't burn a key's quota, force a
 * restart, and start over. In-memory `windows` map is the hot-path cache;
 * `rate_limit_buckets` is the source of truth and is written-through on
 * every check.
 *
 * If SQLite is unavailable (early boot, migration in progress), the limiter
 * silently falls back to in-memory-only — same behavior as before this
 * patch. The defense degrades gracefully rather than failing loudly because
 * losing rate limiting briefly is preferable to throwing on every API call.
 *
 * @module rate-limiter
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Map of keyId -> array of request timestamps (ms since epoch). Hot cache. */
const windows: Map<string, number[]> = new Map();

/** Whether we've attempted hydration for a given key yet (skip DB read after the first). */
const hydrated: Set<string> = new Set();

/** Window size in milliseconds (60 seconds). */
const WINDOW_MS = 60_000;

/** Cleanup interval in milliseconds (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// DB helpers — lazy-load to avoid module-cycle and survive early-boot failures
// ---------------------------------------------------------------------------

type DbAccessors = {
  queryOne: <T>(sql: string, params?: unknown[]) => T | undefined;
  run: (sql: string, params?: unknown[]) => void;
};

let cachedDb: DbAccessors | null | undefined = undefined;

function getDbAccessors(): DbAccessors | null {
  if (cachedDb !== undefined) return cachedDb;
  try {
    // require() to keep the dependency lazy + cycle-safe; this module is
    // imported very early by every API route and we can't take a top-level
    // dependency on the DB module without risk of init-order issues.
    const mod = require("./db/index") as DbAccessors;
    cachedDb = mod;
    return cachedDb;
  } catch {
    cachedDb = null;
    return null;
  }
}

function loadFromDb(keyId: string): number[] | null {
  const db = getDbAccessors();
  if (!db) return null;
  try {
    const row = db.queryOne<{ timestamps: string }>(
      "SELECT timestamps FROM rate_limit_buckets WHERE key_id = ?",
      [keyId],
    );
    if (!row) return null;
    const parsed = JSON.parse(row.timestamps);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : null;
  } catch {
    return null;
  }
}

function saveToDb(keyId: string, timestamps: number[]): void {
  const db = getDbAccessors();
  if (!db) return;
  try {
    db.run(
      `INSERT INTO rate_limit_buckets (key_id, timestamps, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key_id) DO UPDATE SET timestamps = excluded.timestamps, updated_at = excluded.updated_at`,
      [keyId, JSON.stringify(timestamps), Date.now()],
    );
  } catch {
    /* swallow — falls back to in-memory only */
  }
}

function deleteFromDb(keyId: string): void {
  const db = getDbAccessors();
  if (!db) return;
  try {
    db.run("DELETE FROM rate_limit_buckets WHERE key_id = ?", [keyId]);
  } catch {
    /* swallow */
  }
}

// ---------------------------------------------------------------------------
// Cleanup — evicts buckets with no timestamps in the last 60s, both from
// memory and from the DB. Uses unref() so it doesn't keep the process alive.
// ---------------------------------------------------------------------------

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  const keys = Array.from(windows.keys());
  for (const keyId of keys) {
    const timestamps = windows.get(keyId);
    if (!timestamps) continue;
    const active = timestamps.filter((t: number) => t > cutoff);
    if (active.length === 0) {
      windows.delete(keyId);
      hydrated.delete(keyId);
      deleteFromDb(keyId);
    } else {
      windows.set(keyId, active);
      saveToDb(keyId, active);
    }
  }
}, CLEANUP_INTERVAL_MS);

if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a rate limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Number of remaining requests in the current window. */
  remaining: number;
  /** Unix timestamp (ms) when the oldest entry in the window expires. */
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Check whether a request is within rate limits for the given key.
 *
 * Uses a per-minute sliding window: timestamps older than 60 seconds are
 * pruned, then the count of remaining timestamps is compared against the
 * limit. If allowed, the current timestamp is recorded.
 *
 * Persistence: the first call for a given keyId hydrates timestamps from
 * the rate_limit_buckets table (covers post-restart cases). Every subsequent
 * call writes the updated array back. If the DB is unreachable, falls back
 * to in-memory only with a graceful degrade.
 *
 * @param keyId - The API key ID
 * @param limit - Maximum requests per minute
 * @returns Rate limit check result
 */
export function checkRateLimit(keyId: string, limit: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  // Get or create the in-memory window, hydrating from DB the first time
  // we see this keyId after process start.
  let timestamps = windows.get(keyId);
  if (!timestamps) {
    if (!hydrated.has(keyId)) {
      hydrated.add(keyId);
      const fromDb = loadFromDb(keyId);
      if (fromDb && fromDb.length > 0) {
        timestamps = fromDb.filter((t) => t > cutoff);
      }
    }
    if (!timestamps) timestamps = [];
    windows.set(keyId, timestamps);
  }

  // Prune expired entries
  const active = timestamps.filter(t => t > cutoff);
  windows.set(keyId, active);

  // Determine the earliest reset time
  const resetAt = active.length > 0 ? active[0] + WINDOW_MS : now + WINDOW_MS;

  if (active.length >= limit) {
    // Persist the pruned state even on reject — keeps DB and memory in sync.
    saveToDb(keyId, active);
    return {
      allowed: false,
      remaining: 0,
      resetAt,
    };
  }

  // Record this request and persist
  active.push(now);
  saveToDb(keyId, active);

  return {
    allowed: true,
    remaining: limit - active.length,
    resetAt,
  };
}
