/**
 * Auth Logout — POST /api/auth/logout
 *
 * Destroys the current session and clears the cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession, destroySession } from '@/lib/services/session-service';
import { logEvent } from '@/lib/services/audit-logger';
import { validateCsrf } from '@/lib/rbac/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const cookie = request.cookies.get('clawnex_session');

    if (cookie?.value) {
      // Require CSRF token when a session cookie is present — prevents
      // cross-origin force-logout attacks. Idempotent logout (no cookie)
      // still returns 200 without CSRF enforcement.
      const csrfError = validateCsrf(request);
      if (csrfError) return csrfError;

      // Validate to get operator identity for audit, then destroy
      const sessionResult = validateSession(cookie.value);

      // We need the session ID — hash the token to find the row
      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update(cookie.value).digest('hex');
      const { queryOne } = await import('@/lib/db/index');
      const session = queryOne<{ id: string }>(
        'SELECT id FROM operator_sessions WHERE token_hash = ?',
        [tokenHash],
      );
      if (session) {
        destroySession(session.id);
      }

      // Audit trail
      if (sessionResult?.operator) {
        logEvent(sessionResult.operator.username, 'operator_logout', 'operator', sessionResult.operator.id, 'Logout', 'auth');
      }
    }

    const response = NextResponse.json({ ok: true });

    response.cookies.set('clawnex_session', '', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (err) {
    console.error('[API/auth/logout] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
