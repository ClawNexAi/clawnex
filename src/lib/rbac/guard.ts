/**
 * ClawNex RBAC Guard — request-level authentication and authorization.
 *
 * Provides helper functions that API route handlers call to enforce
 * session validity and permission checks. When RBAC is disabled,
 * returns a default admin identity so downstream code requires no
 * special-casing.
 *
 * @module rbac/guard
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '../services/session-service';
import { hasPermission } from './permissions';
import { requireLocalhost } from '../middleware/localhost-guard';
import { validateOriginMatch } from '../auth/origin-match';
import { verifyCsrfToken } from '../auth/csrf-hmac';
import type { AuthenticatedOperator, Permission } from './types';

// ---------------------------------------------------------------------------
// RBAC feature flag
// ---------------------------------------------------------------------------

/**
 * Check whether RBAC is enabled.
 * Uses env vars as the single source of truth — matches middleware behavior.
 *
 * RBAC has TWO build/runtime flags that MUST agree:
 *  - `RBAC_ENABLED`            → consumed by isRbacEnabled() (this function),
 *                                gates per-route requireSession() / requirePermission().
 *  - `NEXT_PUBLIC_RBAC_ENABLED` → bundled into RBAC_BUILD_ENABLED in
 *                                src/lib/rbac/build-config.ts, gates the
 *                                Edge middleware redirect-to-login.
 *
 * If they disagree (e.g. operator hand-edits one without the other and
 * rebuilds), the dashboard ends up in a half-state: per-route guards block,
 * but middleware lets static + un-guarded routes through, OR vice versa.
 * That's CX-G2 from the 2026-04-26 adversarial review.
 *
 * Detection here is best-effort: we check the SAME process.env values both
 * sides bake from. The check fires on every isRbacEnabled() call but the
 * warning is gated by a module-level flag so we only spam logs once per
 * process. Catches the desync cheaply without the overhead of a separate
 * module-load probe in middleware.
 */
let dualFlagWarned = false;
function warnIfDualFlagMismatch(): void {
  if (dualFlagWarned) return;
  const serverFlag = process.env.RBAC_ENABLED === 'true';
  const publicFlag = process.env.NEXT_PUBLIC_RBAC_ENABLED === 'true';
  if (serverFlag !== publicFlag) {
    dualFlagWarned = true;
    console.error(
      '\n┌─────────────────────────────────────────────────────────────────┐\n' +
      '│  ⚠️  RBAC FLAG MISMATCH — middleware and per-route guards will  │\n' +
      '│     disagree, leaving the dashboard in a half-state.            │\n' +
      '│                                                                 │\n' +
      `│     RBAC_ENABLED            = ${process.env.RBAC_ENABLED ?? '(unset)'}`.padEnd(67, ' ') + '│\n' +
      `│     NEXT_PUBLIC_RBAC_ENABLED = ${process.env.NEXT_PUBLIC_RBAC_ENABLED ?? '(unset)'}`.padEnd(67, ' ') + '│\n' +
      '│                                                                 │\n' +
      '│     Set both to "true" or both to "false" in .env.local and     │\n' +
      '│     rebuild. setup.sh writes them in lockstep — only a manual   │\n' +
      '│     edit can desync them.                                       │\n' +
      '└─────────────────────────────────────────────────────────────────┘\n',
    );
  }
}

export function isRbacEnabled(): boolean {
  warnIfDualFlagMismatch();
  return process.env.RBAC_ENABLED === 'true';
}

// ---------------------------------------------------------------------------
// Boot-time safety warning
//
// When RBAC is off, print a single stderr WARN once per process so operators
// can't accidentally run an unauthenticated dashboard on a network-reachable
// host without knowing. The WARN fires on first import of this module (which
// happens very early in request processing) and fires exactly once.
// ---------------------------------------------------------------------------

let __rbacWarningEmitted = false;
function emitRbacOffWarningOnce(): void {
  if (__rbacWarningEmitted) return;
  __rbacWarningEmitted = true;
  if (process.env.RBAC_ENABLED !== 'true') {
    // eslint-disable-next-line no-console
    console.warn(
      '\n' +
      '  ┌─────────────────────────────────────────────────────────────────┐\n' +
      '  │  WARN  RBAC is OFF. Dashboard is unauthenticated.              │\n' +
      '  │         Set RBAC_ENABLED=true (and NEXT_PUBLIC_RBAC_ENABLED=   │\n' +
      '  │         true) for any network-reachable deployment. See        │\n' +
      '  │         .env.example for the safe defaults.                    │\n' +
      '  └─────────────────────────────────────────────────────────────────┘\n'
    );
  }
}
emitRbacOffWarningOnce();

// ---------------------------------------------------------------------------
// Default operator when RBAC is disabled
// ---------------------------------------------------------------------------

// L3 (DAST 2026-05-14): username was 'admin' which was indistinguishable
// in audit_log from a real authenticated operator named 'admin'. Anyone
// reviewing the audit trail post-incident saw "admin purged the DB" and
// could not tell whether that was a deliberate admin action or an
// unauthenticated direct-curl that landed via the RBAC-off localhost-trust
// path. Renaming to 'localhost' (a name no real human operator would
// choose for their own account) makes the distinction unambiguous and
// surfaces in audit_log entries via the `actor` column.
const DEFAULT_OPERATOR: AuthenticatedOperator = {
  id: 'system',
  username: 'localhost',
  displayName: 'Local Admin (unauthenticated)',
  role: 'admin',
};

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Require a valid session on the request.
 *
 * When RBAC is disabled, the request is gated through requireLocalhost
 * before being granted the default admin identity. Was previously
 * fail-open-to-admin: a typo, missing env load, or accidental flip of
 * RBAC_ENABLED would silently make every API call an unauthenticated
 * admin from ANY source IP. Closes CX-R13-01 at the central guard so
 * the 100+ routes that call requireSession() inherit the fix without
 * each route having to remember to add a separate localhost fallback.
 *
 * @returns The authenticated operator, or a 401/403 NextResponse.
 */
export function requireSession(
  request: NextRequest,
): { operator: AuthenticatedOperator } | NextResponse {
  if (!isRbacEnabled()) {
    // RBAC off = local-dev-only. Network-reachable callers must enable RBAC.
    const localhostGuard = requireLocalhost(request);
    if (localhostGuard) return localhostGuard;
    // CRIT #10: even with RBAC off and the caller on localhost, we still
    // need Origin/Referer enforcement on mutating requests. Without this,
    // an attacker page in another tab can drive cross-origin POSTs against
    // the unauthenticated local dashboard. validateCsrf() now runs its
    // Origin-match layer unconditionally; only the cookie+header layer is
    // RBAC-gated.
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
      const csrfResult = validateCsrf(request);
      if (csrfResult) return csrfResult;
    }
    return { operator: DEFAULT_OPERATOR };
  }

  const cookie = request.cookies.get('clawnex_session');
  if (!cookie?.value) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    );
  }

  const ip = (request as unknown as { ip?: string }).ip || undefined;
  const result = validateSession(cookie.value, ip);
  if (!result) {
    return NextResponse.json(
      { error: 'Invalid or expired session' },
      { status: 401 },
    );
  }

  // CSRF enforcement on mutation methods
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    const csrfResult = validateCsrf(request);
    if (csrfResult) return csrfResult;
  }

  return result;
}

/**
 * Check whether an operator has a specific permission.
 * @returns null if allowed, or a 403 NextResponse.
 */
export function requirePermission(
  operator: AuthenticatedOperator,
  permission: Permission,
): NextResponse | null {
  if (hasPermission(operator.role, permission)) {
    return null;
  }

  return NextResponse.json(
    { error: 'Forbidden', required: permission },
    { status: 403 },
  );
}

/**
 * Validate CSRF on state-changing requests.
 *
 * Two-layer policy (CRIT #10 — CSRF independent of RBAC):
 *
 *   1. Origin / Referer match — runs REGARDLESS of RBAC state. A browser
 *      always sends Origin on cross-origin mutations; we compare it to the
 *      request's own host and refuse the mismatch case. This protects
 *      RBAC-off single-operator installs from "user opens attacker.com in
 *      another tab → JS POSTs to localhost:5001/api/system/purge → DB
 *      gone" without needing a session cookie at all. If neither Origin
 *      nor Referer is present (non-browser callers like curl / server-
 *      side fetch), we allow — those code paths have their own auth.
 *
 *   2. Session-bound HMAC token — runs only when RBAC is on. The
 *      X-CSRF-Token header MUST be HMAC-SHA256(SESSION_SECRET,
 *      session.id) for the request's authenticated session. Previously
 *      this layer compared the cookie value to the header for
 *      equality, which accepted any matching attacker-chosen pair
 *      (DAST 2026-05-15 C1). The HMAC binding makes the expected
 *      token uncomputable without the server secret AND a specific
 *      session — so cookie-injection / XSS cookie-write can no longer
 *      forge a passing pair.
 *
 * @returns null if valid (or not enforced), or a 403 NextResponse.
 */
export function validateCsrf(request: NextRequest): NextResponse | null {
  // Layer 1: Origin / Referer match (RBAC-independent, safe-method-skip
  // inside the helper). Shared with requireLocalhost() so RBAC-off admin
  // routes inherit the same Origin gate without per-route edits.
  const originResult = validateOriginMatch(request);
  if (originResult) return originResult;

  // Layer 2: session-bound HMAC token (RBAC-only).
  if (!isRbacEnabled()) return null;

  // Same safe-method exemption applies to the token layer.
  const method = request.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;

  // Resolve the session that owns this request. validateSession also
  // cleans up expired sessions as a side effect; requireSession-style
  // callers may run it a second time, but the redundant lookup is
  // sub-millisecond against SQLite and keeps validateCsrf self-
  // contained instead of taking a session-already-validated input.
  const sessionCookie = request.cookies.get('clawnex_session')?.value;
  if (!sessionCookie) {
    return NextResponse.json({ error: 'CSRF: no session' }, { status: 403 });
  }
  const ip = (request as unknown as { ip?: string }).ip || undefined;
  const session = validateSession(sessionCookie, ip);
  if (!session) {
    return NextResponse.json({ error: 'CSRF: invalid session' }, { status: 403 });
  }

  const headerToken = request.headers.get('x-csrf-token');
  if (!verifyCsrfToken(session.sessionId, headerToken)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  return null;
}

/**
 * Optionally extract the operator from the request.
 * Returns the operator or null — never returns an error response.
 */
export function getOperatorFromRequest(
  request: NextRequest,
): AuthenticatedOperator | null {
  if (!isRbacEnabled()) {
    return DEFAULT_OPERATOR;
  }

  const cookie = request.cookies.get('clawnex_session');
  if (!cookie?.value) return null;

  const ip = (request as unknown as { ip?: string }).ip || undefined;
  const result = validateSession(cookie.value, ip);
  return result?.operator ?? null;
}
