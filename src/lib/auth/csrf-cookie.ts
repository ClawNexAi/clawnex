/**
 * Set the clawnex_csrf cookie on an auth-flow response.
 *
 * Call immediately after setting the session cookie in any auth flow
 * (setup / login / magic-link complete / passkey authenticate complete /
 * github callback) so the operator lands in a fully-CSRF-ready state.
 *
 * operator-flagged 2026-05-09: previously CSRF cookie was minted only when
 * the dashboard's mount-time fetch hit /api/auth/csrf, leaving a race
 * window between session-cookie set and dashboard mount where the
 * dashboard's window.fetch monkey-patch couldn't read clawnex_csrf via
 * document.cookie and silently sent mutation requests without the
 * X-CSRF-Token header → 403 → click-does-nothing UX.
 *
 * DAST 2026-05-15 C1 fix: the token value is now HMAC-SHA256 over the
 * session.id (keyed with SESSION_SECRET), not a fresh random. The
 * server validates by recomputing the same HMAC from the request's
 * authenticated session and timing-safe comparing — so an attacker
 * who can plant a cookie value can no longer match a chosen X-CSRF-
 * Token. See src/lib/auth/csrf-hmac.ts.
 *
 * Cookie spec mirrors the dedicated /api/auth/csrf route exactly:
 * httpOnly:false (the monkey-patch reads it), sameSite:strict, secure
 * follows isPublicSecure().
 */

import type { NextRequest } from 'next/server';
import { isPublicSecure } from '@/lib/services/auth';
import { csrfTokenFor } from '@/lib/auth/csrf-hmac';

interface CookieJar {
  set(name: string, value: string, opts: {
    httpOnly: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    path: string;
    secure: boolean;
  }): void;
}

/**
 * Mint the canonical CSRF cookie for a freshly-authenticated session.
 *
 * @param jar - response.cookies (or redirect-response.cookies) — both
 *   shapes expose the same .set() signature.
 * @param request - the incoming request, used to decide the `secure`
 *   flag based on the resolved public origin.
 * @param sessionId - the session.id returned by createSession() (or by
 *   validateSession() for refresh flows). REQUIRED — the cookie is
 *   only meaningful when bound to a specific session.
 */
export function setCsrfCookie(jar: CookieJar, request: NextRequest, sessionId: string): void {
  const token = csrfTokenFor(sessionId);
  if (!token) {
    // No secret configured — fail closed by skipping the cookie set.
    // validateCsrf() will reject any incoming request the same way,
    // so an unset SESSION_SECRET is loudly broken instead of silently
    // accepting attacker-chosen tokens.
    return;
  }
  jar.set('clawnex_csrf', token, {
    httpOnly: false,
    sameSite: 'strict',
    path: '/',
    secure: isPublicSecure(request),
  });
}
