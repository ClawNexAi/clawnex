/**
 * Auth Login — POST /api/auth/login
 *
 * Authenticates an operator with username/password, creates a session,
 * and sets the clawnex_session cookie.
 *
 * Rate-limited by IP: sliding window per minute (configurable via loginRateLimitPerMinute).
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limiter';
import {
  getOperatorByUsername,
  verifyPassword,
  incrementFailedLogin,
  recordLogin,
} from '@/lib/services/operator-service';
import { getSetting } from '@/lib/services/config-service';
import { createSession, enforceSessionLimit } from '@/lib/services/session-service';
import { run } from '@/lib/db/index';
import { config } from '@/lib/config';
import { isPublicSecure } from '@/lib/services/auth';
import { logEvent } from '@/lib/services/audit-logger';
import { setCsrfCookie } from '@/lib/auth/csrf-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pre-computed bcrypt hash (12 rounds) for timing-safe dummy comparison
const DUMMY_HASH = '$2a$12$LJ3m4ys3PweVGHBkgDJp4e4F3ELcUqoJZPfCxWO7FM/W/RCa3MNKS';

/** Rate limit: login attempts per minute per IP (sliding window). */
const LOGIN_RATE_LIMIT = config.rbac.loginRateLimitPerMinute;

// H1 (DAST 2026-05-14): response-time floor for every failure path. The
// existing bcrypt-on-dummy-hash pattern equalizes the verify time, but a
// real user's failure path also writes incrementFailedLogin() to the DB
// and runs the lockout-decay computation — neither of which fires when
// the user doesn't exist. DAST measured admin@2638ms vs nonexistent@651ms
// (4x). The floor masks the difference: every failure waits until at
// least MIN_LOGIN_FAILURE_MS elapsed since request start before
// responding. Success path is exempt — a fixed user-visible login
// latency on success is acceptable; the oracle only exposes existence
// via comparing two failures.
const MIN_LOGIN_FAILURE_MS = 2000;

async function rejectWithFloor(
  start: number,
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<NextResponse> {
  const elapsed = Date.now() - start;
  if (elapsed < MIN_LOGIN_FAILURE_MS) {
    await new Promise(r => setTimeout(r, MIN_LOGIN_FAILURE_MS - elapsed));
  }
  return NextResponse.json(body, { status, headers: extraHeaders });
}

export async function POST(request: NextRequest) {
  const start = Date.now();
  try {
    // Rate limit by IP — use Next.js request IP only (no x-forwarded-for to prevent spoofing)
    const ip = (request as unknown as { ip?: string }).ip || 'unknown';
    const rateKey = `login:${ip}`;
    const rl = checkRateLimit(rateKey, LOGIN_RATE_LIMIT);
    if (!rl.allowed) {
      // 429 doesn't need the timing floor — by definition the caller is
      // hammering us, and the Retry-After header tells them when to come
      // back. Floor on 401s only.
      return NextResponse.json(
        { error: 'Too many login attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      );
    }

    // M2 (DAST 2026-05-14): a non-JSON body (e.g. attacker sending
    // garbage) crashed into the outer catch and returned 500. Catch the
    // parse error explicitly and return 400 — same as missing-field
    // validation below.
    let body: { username?: string; password?: string; remember?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }
    const { username, password, remember } = body;

    // NEW-1 / M2 (DAST 2026-05-15): explicit type guards. Truthiness-only
    // checks let `{username: 1, password: 2}` pass through to bcrypt
    // (which crashes on non-string operand → outer catch → 500). Reject
    // anything that isn't a non-empty string at the boundary with 400.
    if (typeof username !== 'string' || typeof password !== 'string' ||
        username.length === 0 || password.length === 0) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 },
      );
    }

    // Find operator
    const operator = getOperatorByUsername(username);

    // Always run bcrypt comparison (constant time regardless of user existence)
    const passwordValid = operator
      ? verifyPassword(password, operator.password_hash)
      : verifyPassword(password, DUMMY_HASH); // timing-safe: bcrypt runs either way

    // Single generic error for ALL failure modes (no user enumeration)
    if (!operator || !operator.is_active || !passwordValid) {
      if (operator) incrementFailedLogin(operator.id);
      logEvent(username, 'operator_login_failed', 'operator', 'unknown', `Failed login from ${ip}`, 'auth');
      return rejectWithFloor(start, 401, { error: 'Invalid credentials' });
    }

    // Progressive lockout AFTER bcrypt (so timing doesn't reveal user existence)
    // Time-based decay: reduce failed count by 1 for every decay interval since last attempt
    const decayMinutes = parseInt(getSetting('lockout_decay_minutes') || '15', 10);
    const LOCKOUT_DECAY_INTERVAL_MS = decayMinutes * 60 * 1000;
    const lastAttempt = new Date(operator.updated_at).getTime();
    const elapsed = Date.now() - lastAttempt;
    const decayAmount = Math.floor(elapsed / LOCKOUT_DECAY_INTERVAL_MS);
    const effectiveFailCount = Math.max(0, operator.failed_login_count - decayAmount);

    // Tiers: 5→1m, 10→5m, 15→30m, 20+→account disabled
    if (effectiveFailCount >= 5) {
      // At 20+ failures, auto-disable the account (requires admin re-enable)
      if (effectiveFailCount >= 20) {
        run(
          "UPDATE operators SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND is_active = 1",
          [operator.id],
        );
        logEvent(operator.username, 'operator_auto_disabled', 'operator', operator.id,
          `Account auto-disabled after ${effectiveFailCount} effective failed login attempts`, 'auth');
        return rejectWithFloor(start, 401, { error: 'Invalid credentials' });
      }

      // Progressive lockout duration based on effective failure count
      const lockoutMs = effectiveFailCount >= 15 ? 30 * 60 * 1000  // 15-19: 30 minutes
                      : effectiveFailCount >= 10 ? 5 * 60 * 1000   // 10-14: 5 minutes
                      : 1 * 60 * 1000;                              // 5-9: 1 minute

      if (Date.now() - lastAttempt < lockoutMs) {
        // Same generic message + same timing floor — no lockout disclosure.
        return rejectWithFloor(start, 401, { error: 'Invalid credentials' });
      }
    }

    // Success — create session
    const userAgent = request.headers.get('user-agent') || undefined;
    const ttlSeconds = remember ? 30 * 24 * 3600 : config.rbac.sessionTtlHours * 3600;
    const { sessionId, token } = createSession(operator.id, ip, userAgent, ttlSeconds);

    // Enforce session limit
    enforceSessionLimit(operator.id, config.rbac.maxSessionsPerOperator);

    // Record login
    recordLogin(operator.id);

    // Audit trail
    logEvent(operator.username, 'operator_login', 'operator', operator.id, `Login from ${ip} (${userAgent?.substring(0, 50) || 'unknown'})`, 'auth');

    // Set cookie
    const response = NextResponse.json({
      ok: true,
      operator: {
        id: operator.id,
        username: operator.username,
        role: operator.role,
      },
    });

    response.cookies.set('clawnex_session', token, {
      httpOnly: true,
      // 'strict' is safe here — the dashboard hosts UI and API at the same
      // origin, every session-bearing request is by definition same-site.
      // 'lax' was the prior default; flipped per new-assessment #13 to
      // close the cross-site top-level GET avenue.
      sameSite: 'strict',
      path: '/',
      maxAge: ttlSeconds,
      secure: isPublicSecure(request),
    });
    // Atomic CSRF cookie — see src/lib/auth/csrf-cookie.ts for why.
    setCsrfCookie(response.cookies, request, sessionId);

    return response;
  } catch (err) {
    console.error('[API/auth/login] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
