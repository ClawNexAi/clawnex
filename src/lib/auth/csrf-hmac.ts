/**
 * CSRF token HMAC binding — DAST 2026-05-15 C1 fix.
 *
 * Replaces the previous double-submit cookie+header equality scheme
 * (which accepted any matching pair, including attacker-chosen ones
 * like `x/x` against any session) with a stateless HMAC token bound
 * to the session.id.
 *
 * Token shape: HMAC-SHA256(SESSION_SECRET, session.id).hex
 *
 * The token is still returned to the client via the clawnex_csrf
 * cookie (httpOnly:false so the dashboard's fetch monkey-patch can
 * read it via document.cookie and echo it back as X-CSRF-Token).
 * What changed: the server no longer validates by comparing the
 * cookie to the header — it recomputes the expected HMAC from the
 * authenticated session's id and timing-safe-compares against the
 * submitted header. An attacker who can set a clawnex_csrf cookie
 * (XSS, cookie injection) can no longer choose its value freely
 * because they don't know SESSION_SECRET.
 *
 * SESSION_SECRET resolution
 * -------------------------
 * 1. SESSION_SECRET env var (the canonical source — written by
 *    setup.sh on install, preserved across re-runs)
 * 2. Stable derivation from SETUP_SECRET when SESSION_SECRET is
 *    absent. This covers installs predating this fix; we log a
 *    one-time warning so the operator is nudged to add an explicit
 *    SESSION_SECRET to .env.local.
 * 3. Refuse to mint/verify when neither is configured. Fails closed
 *    so a misconfigured RBAC-on host can't be tricked into accepting
 *    any token via an empty-secret bypass.
 *
 * @module auth/csrf-hmac
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DERIVATION_LABEL = 'clawnex-csrf-v1';
let warnedDerived = false;
let warnedMissing = false;

/**
 * Resolve the secret used to derive CSRF tokens. Returns '' when no
 * stable secret is available — callers MUST treat that as a fail-
 * closed signal (no token mint, all validation rejects).
 */
function getCsrfSecret(): string {
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) return explicit;

  const setup = process.env.SETUP_SECRET;
  if (setup && setup.length >= 32) {
    if (!warnedDerived) {
      warnedDerived = true;
      console.warn(
        '[CSRF] SESSION_SECRET is not set. Deriving stable secret from SETUP_SECRET. ' +
        "Add an explicit `SESSION_SECRET=$(openssl rand -hex 32)` to .env.local " +
        'so CSRF tokens survive a SETUP_SECRET rotation.',
      );
    }
    // Stable derivation — same input → same output across restarts as
    // long as SETUP_SECRET is unchanged. Domain-separated with a
    // version label so future rotations can be staged.
    return createHmac('sha256', setup).update(DERIVATION_LABEL).digest('hex');
  }

  if (!warnedMissing) {
    warnedMissing = true;
    console.error(
      '[CSRF] Neither SESSION_SECRET nor SETUP_SECRET is configured. ' +
      'All CSRF mints/verifications will fail closed until one is set.',
    );
  }
  return '';
}

/**
 * Compute the canonical CSRF token for a session. Returns '' when no
 * secret is configured — the caller must NOT set a cookie with that
 * empty value (treat it as a no-op).
 */
export function csrfTokenFor(sessionId: string): string {
  const secret = getCsrfSecret();
  if (!secret) return '';
  return createHmac('sha256', secret).update(sessionId).digest('hex');
}

/**
 * Verify a presented X-CSRF-Token against the canonical HMAC for the
 * given session. Timing-safe. Returns false when the secret is
 * unavailable or any input is malformed (fail closed).
 */
export function verifyCsrfToken(sessionId: string, presented: string | undefined | null): boolean {
  if (!sessionId || !presented) return false;
  const expected = csrfTokenFor(sessionId);
  if (!expected) return false;
  if (presented.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  } catch {
    return false;
  }
}
