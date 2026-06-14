/**
 * Auth Setup — POST /api/auth/setup
 *
 * One-time admin account creation. Only works when:
 *   1. RBAC_ENABLED=true
 *   2. Zero operators exist in the database
 *
 * Creates an admin operator, starts a session, sets the cookie.
 *
 * @module api/auth/setup
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { setCsrfCookie } from '@/lib/auth/csrf-cookie';
import { createOperator, operatorCount } from '@/lib/services/operator-service';
import { createSession } from '@/lib/services/session-service';
import { config } from '@/lib/config';
import { isPublicSecure } from '@/lib/services/auth';
import { queryOne, transaction, run } from '@/lib/db/index';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Guard: RBAC must be enabled
    if (!config.rbac.enabled) {
      return NextResponse.json(
        { error: 'RBAC is not enabled' },
        { status: 403 },
      );
    }

    // Guard: only works when no operators exist yet
    if (operatorCount() > 0) {
      return NextResponse.json(
        { error: 'Setup already completed' },
        { status: 403 },
      );
    }

    // Parse the body once — avoids double-read on request stream
    const body = await request.json();

    // Guard: SETUP_SECRET is the canonical "you own this install" proof for
    // first-admin creation. When SETUP_SECRET is configured, the request body
    // must echo it (constant-time compared to prevent timing leaks). When
    // SETUP_SECRET is NOT configured, the request MUST come from localhost —
    // otherwise any network client that hits /api/auth/setup before the
    // legitimate operator could claim the first admin slot (CX-R14-03).
    // install.sh now always writes a SETUP_SECRET so the secret path is the
    // common case; the localhost fallback closes the seam for hand-rolled
    // installs that forgot to set the env var.
    const setupSecret = process.env.SETUP_SECRET;
    if (setupSecret) {
      const provided = typeof body.setup_secret === 'string' ? body.setup_secret : '';
      const providedBuf = Buffer.from(provided, 'utf8');
      const expectedBuf = Buffer.from(setupSecret, 'utf8');
      if (
        providedBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(providedBuf, expectedBuf)
      ) {
        return NextResponse.json(
          { error: 'Invalid setup secret' },
          { status: 403 },
        );
      }
    } else {
      const localhostGuard = requireLocalhost(request);
      if (localhostGuard) return localhostGuard;
    }

    const { username, email, password } = body;

    // Validation
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return NextResponse.json(
        { error: 'Username must be at least 3 characters' },
        { status: 400 },
      );
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 },
      );
    }

    // Atomic check-then-create inside a serialized SQLite transaction
    let operator;
    try {
      operator = transaction(() => {
        const row = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM operators');
        if ((row?.count ?? 0) > 0) return null;
        return createOperator(username.trim(), password, 'admin');
      });
    } catch (createErr) {
      // Race condition: another request created the admin between our check and insert
      if (operatorCount() > 0) {
        return NextResponse.json(
          { error: 'Setup already completed' },
          { status: 403 },
        );
      }
      throw createErr;
    }

    if (!operator) {
      return NextResponse.json(
        { error: 'Setup already completed' },
        { status: 403 },
      );
    }

    // Set email if provided
    if (email && typeof email === 'string' && email.trim()) {
      try {
        run('UPDATE operators SET email = ? WHERE id = ?', [email.trim(), operator.id]);
      } catch {}
    }

    // Create a session
    const ip = (request as unknown as { ip?: string }).ip || 'unknown';
    const userAgent = request.headers.get('user-agent') || undefined;
    const { sessionId, token } = createSession(operator.id, ip, userAgent);

    // Set cookie
    const ttlSeconds = config.rbac.sessionTtlHours * 3600;
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
      // 'strict' — same-origin API; see login route for full rationale.
      sameSite: 'strict',
      path: '/',
      maxAge: ttlSeconds,
      secure: isPublicSecure(request),
    });

    // Atomic CSRF cookie set — see src/lib/auth/csrf-cookie.ts for why.
    setCsrfCookie(response.cookies, request, sessionId);

    return response;
  } catch (err) {
    console.error('[API/auth/setup] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
