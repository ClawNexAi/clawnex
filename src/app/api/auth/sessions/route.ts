/**
 * Auth Sessions — GET/DELETE /api/auth/sessions
 *
 * GET  — list the current operator's active sessions.
 * DELETE — revoke a specific session by ID (own sessions, or any if admin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession } from '@/lib/rbac/guard';
import { queryAll, queryOne, run } from '@/lib/db/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireSession(request);
  if (auth instanceof NextResponse) return auth;

  const { operator } = auth;

  const sessions = queryAll<{
    id: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
    last_used_at: string | null;
    expires_at: string;
    token_hash: string;
  }>(
    // datetime(expires_at) wrapper — see CX-G1 fix in magic-link.ts.
    // Without it the TEXT comparison between ISO `...T...Z` and SQLite
    // `YYYY-MM-DD HH:MM:SS` makes expired sessions look live in the
    // operator's session list for the entire UTC date.
    `SELECT id, ip_address, user_agent, created_at, last_used_at, expires_at, token_hash
     FROM operator_sessions
     WHERE operator_id = ? AND datetime(expires_at) > datetime('now')
     ORDER BY last_used_at DESC`,
    [operator.id],
  );

  // Determine which session is the current one by hashing the cookie token
  let currentSessionId: string | null = null;
  const cookie = request.cookies.get('clawnex_session');
  if (cookie?.value) {
    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(cookie.value).digest('hex');
    const match = sessions.find(s => s.token_hash === tokenHash);
    if (match) currentSessionId = match.id;
  }

  return NextResponse.json({
    sessions: sessions.map(s => ({
      id: s.id,
      ipAddress: s.ip_address,
      userAgent: s.user_agent,
      createdAt: s.created_at,
      lastUsedAt: s.last_used_at,
      expiresAt: s.expires_at,
      isCurrent: s.id === currentSessionId,
    })),
  });
}

export async function DELETE(request: NextRequest) {
  if (!isRbacEnabled()) {
    return NextResponse.json({ error: 'RBAC is not enabled' }, { status: 403 });
  }

  const auth = requireSession(request);
  if (auth instanceof NextResponse) return auth;

  const { operator } = auth;

  let body: { sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { sessionId } = body;
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  // Find the session
  const session = queryOne<{ id: string; operator_id: string }>(
    'SELECT id, operator_id FROM operator_sessions WHERE id = ?',
    [sessionId],
  );

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Only allow revoking own sessions, unless admin
  if (session.operator_id !== operator.id && operator.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  run('DELETE FROM operator_sessions WHERE id = ?', [sessionId]);

  return NextResponse.json({ ok: true });
}
