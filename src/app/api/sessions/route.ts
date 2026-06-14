/**
 * Sessions API — returns real session data from OpenClaw Gateway.
 * GET /api/sessions
 *
 * Gracefully degrades to empty array if gateway is offline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { ensureConnected } from '@/lib/connectors/openclaw-connector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'dashboard:view');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const connector = await ensureConnected();

    if (!connector.isConnected()) {
      return NextResponse.json({
        sessions: [],
        total: 0,
        source: 'offline',
        message: 'OpenClaw Gateway is not connected',
        timestamp: new Date().toISOString(),
      });
    }

    const sessions = await connector.listSessions();

    return NextResponse.json({
      sessions,
      total: sessions.length,
      source: 'openclaw',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/sessions] Error:', err);
    return NextResponse.json(
      {
        sessions: [],
        total: 0,
        source: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 502 },
    );
  }
}
