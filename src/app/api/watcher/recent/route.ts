/**
 * GET /api/watcher/recent — Returns recent messages scanned by the session watcher.
 * Supports ?limit=N (default 50, max 200).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getRecentScans } from '@/lib/services/session-watcher';
import { ensureWatcherStarted } from '@/lib/services/session-watcher-runner';

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

  ensureWatcherStarted();

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  try {
    const scans = getRecentScans(limit);

    // Parse shield_detections JSON for each row
    const parsed = scans.map((row) => ({
      ...row,
      shield_detections: typeof row.shield_detections === 'string'
        ? JSON.parse(row.shield_detections as string)
        : row.shield_detections || [],
    }));

    return NextResponse.json({ scans: parsed, limit });
  } catch (err) {
    console.error('[Watcher Recent API] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch recent scans' }, { status: 500 });
  }
}
