/**
 * Auth CSRF — GET /api/auth/csrf
 *
 * Refreshes the clawnex_csrf cookie for the current session. Bound
 * via HMAC-SHA256(SESSION_SECRET, session.id) — see
 * src/lib/auth/csrf-hmac.ts.
 *
 * DAST 2026-05-15 C1 fix: previously this endpoint minted a fresh
 * random token regardless of who was calling, and validation just
 * compared cookie to header for equality — so any attacker-chosen
 * pair worked. Now the token is bound to a specific session and
 * the endpoint refuses to mint when there is no active session
 * (RBAC on), since an unbound token would be meaningless.
 *
 * The httpOnly:false flag is intentional: the dashboard's fetch
 * monkey-patch reads the cookie via document.cookie and echoes it
 * back as X-CSRF-Token on every mutation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isPublicSecure } from '@/lib/services/auth';
import { isRbacEnabled } from '@/lib/rbac/guard';
import { validateSession } from '@/lib/services/session-service';
import { csrfTokenFor } from '@/lib/auth/csrf-hmac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // RBAC-off mode: no session to bind to. The Origin/Referer layer
    // alone protects state-changing requests, and validateCsrf() short-
    // circuits the HMAC check when !isRbacEnabled(). Return a no-op
    // success so the dashboard's mount-time fetch doesn't error.
    if (!isRbacEnabled()) {
      return NextResponse.json({ ok: true, rbac: false });
    }

    const sessionCookie = request.cookies.get('clawnex_session')?.value;
    if (!sessionCookie) {
      // No session → no binding target. The dashboard mount sometimes
      // calls /api/auth/csrf before login completes; return 401 so the
      // client can route to /login instead of treating an unbound
      // token as valid.
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const ip = (request as unknown as { ip?: string }).ip || undefined;
    const session = validateSession(sessionCookie, ip);
    if (!session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const token = csrfTokenFor(session.sessionId);
    if (!token) {
      // No SESSION_SECRET/SETUP_SECRET available — fail closed instead
      // of minting a meaningless empty token.
      return NextResponse.json({ error: 'CSRF secret not configured' }, { status: 503 });
    }

    const response = NextResponse.json({ token });
    response.cookies.set('clawnex_csrf', token, {
      httpOnly: false,
      sameSite: 'strict',
      path: '/',
      secure: isPublicSecure(request),
    });
    return response;
  } catch (err) {
    console.error('[API/auth/csrf] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
