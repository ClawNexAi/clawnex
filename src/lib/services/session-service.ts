/**
 * ClawNex Session Service — manages operator authentication sessions.
 *
 * Session tokens are 32-byte random values. Only the SHA-256 hash is stored
 * in the database — the plaintext token is returned once on creation and
 * set as an HttpOnly cookie.
 *
 * Tables: operator_sessions, operators, config_defaults
 *
 * @module services/session-service
 */

import { randomBytes, createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { queryOne, queryAll, run } from '../db/index';
import type { AuthenticatedOperator } from '../rbac/types';
import type { Role } from '../rbac/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex hash of a token string. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Read session TTL from config_defaults, falling back to 24 hours. */
function getSessionTtlHours(): number {
  try {
    const row = queryOne<{ value: string }>(
      "SELECT value FROM config_defaults WHERE key = 'session_ttl_hours'",
    );
    if (row) {
      const parsed = parseInt(row.value, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // Table may not exist yet during bootstrap
  }
  return parseInt(process.env.SESSION_TTL_HOURS || '24', 10);
}

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------

/**
 * Create a new session for an operator.
 * @param operatorId - The operator's UUID.
 * @param ipAddress - Optional client IP.
 * @param userAgent - Optional User-Agent header.
 * @param ttlSecondsOverride - Optional TTL override in seconds (e.g. for "remember me").
 * @returns The session ID and plaintext token (returned once).
 */
export function createSession(
  operatorId: string,
  ipAddress?: string,
  userAgent?: string,
  ttlSecondsOverride?: number,
): { sessionId: string; token: string } {
  const sessionId = uuid();
  const tokenBytes = randomBytes(32);
  const token = tokenBytes.toString('hex');
  const tokenHash = hashToken(token);

  const ttlMs = ttlSecondsOverride
    ? ttlSecondsOverride * 1000
    : getSessionTtlHours() * 3600000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  run(
    `INSERT INTO operator_sessions (id, operator_id, token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, operatorId, tokenHash, ipAddress ?? null, userAgent ?? null, expiresAt],
  );

  return { sessionId, token };
}

/**
 * Validate a session token.
 * @param token - The plaintext session token.
 * @param requestIp - Optional request IP for IP-binding validation (SESSION_BIND_IP=true).
 * @returns The authenticated operator + session.id (used by the CSRF
 *   HMAC binding to derive the canonical token for this session), or
 *   null if invalid/expired.
 */
export function validateSession(
  token: string,
  requestIp?: string,
): { operator: AuthenticatedOperator; sessionId: string } | null {
  const tokenHash = hashToken(token);

  const session = queryOne<{
    id: string;
    operator_id: string;
    ip_address: string | null;
    expires_at: string;
  }>(
    'SELECT id, operator_id, ip_address, expires_at FROM operator_sessions WHERE token_hash = ?',
    [tokenHash],
  );

  if (!session) return null;

  // Check expiry
  if (new Date(session.expires_at) < new Date()) {
    // Expired — clean up
    run('DELETE FROM operator_sessions WHERE id = ?', [session.id]);
    return null;
  }

  // Optional IP binding — enabled via SESSION_BIND_IP=true
  if (process.env.SESSION_BIND_IP === 'true' && session.ip_address) {
    if (!requestIp) {
      // IP binding enabled but request IP unavailable — fail closed
      console.warn('[SessionService] IP binding enabled but request IP unavailable — rejecting session');
      run('DELETE FROM operator_sessions WHERE id = ?', [session.id]);
      return null;
    }
    if (requestIp !== session.ip_address) {
      // IP mismatch — destroy session and reject
      run('DELETE FROM operator_sessions WHERE id = ?', [session.id]);
      return null;
    }
  }

  // Look up operator
  const op = queryOne<{
    id: string;
    username: string;
    display_name: string | null;
    role: Role;
    is_active: number;
  }>(
    'SELECT id, username, display_name, role, is_active FROM operators WHERE id = ?',
    [session.operator_id],
  );

  if (!op || !op.is_active) return null;

  // Update last_used_at
  run(
    "UPDATE operator_sessions SET last_used_at = datetime('now') WHERE id = ?",
    [session.id],
  );

  return {
    operator: {
      id: op.id,
      username: op.username,
      displayName: op.display_name,
      role: op.role,
    },
    sessionId: session.id,
  };
}

/** Destroy a single session by ID. */
export function destroySession(sessionId: string): void {
  run('DELETE FROM operator_sessions WHERE id = ?', [sessionId]);
}

/** Destroy all sessions for an operator. */
export function destroyAllSessions(operatorId: string): void {
  run('DELETE FROM operator_sessions WHERE operator_id = ?', [operatorId]);
}

/** Delete all expired sessions. */
export function cleanupExpired(): void {
  // datetime(expires_at) wrapper — same TEXT-format mismatch fix as
  // CX-G1 in magic-link.ts. Sessions store expires_at as ISO 8601
  // (`...T...Z`), and the GC predicate `expires_at < datetime('now')`
  // would do a TEXT comparison that's wrong for the entire UTC date.
  // Without the fix, expired sessions never got cleaned up by this GC
  // call (they were still rejected by validateSession at use time, so
  // it was a hygiene issue, not auth bypass — but related to CX-G1).
  run("DELETE FROM operator_sessions WHERE datetime(expires_at) < datetime('now')");
}

/**
 * Enforce a maximum number of concurrent sessions per operator.
 * If the count exceeds maxSessions, the oldest sessions are deleted.
 */
export function enforceSessionLimit(operatorId: string, maxSessions: number = 5): void {
  const rows = queryAll<{ id: string }>(
    'SELECT id FROM operator_sessions WHERE operator_id = ? ORDER BY created_at DESC',
    [operatorId],
  );

  if (rows.length <= maxSessions) return;

  const toDelete = rows.slice(maxSessions);
  for (const row of toDelete) {
    run('DELETE FROM operator_sessions WHERE id = ?', [row.id]);
  }
}
