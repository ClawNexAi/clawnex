/**
 * Shield History API
 * GET /api/shield/history — returns recent shield scan events
 * Supports ?limit=N query param (default 50)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getShieldHistory } from '@/lib/services/prompt-interceptor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'shield:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 500) : 50;
    const since = searchParams.get('since') || undefined;
    const instance = searchParams.get('instance') || null;
    // Phase 2a-fix: opt-in to including test-generated scans (origin =
    // shield-test/demo/qa). Default excludes them so the Shield History
    // feed doesn't leak Shield Tests / demo / qa records into operator
    // views. Mirrors /api/shield/stats.
    const includeTestGenerated = searchParams.get('includeTestGenerated') === 'true';

    let history = getShieldHistory(limit, since, { includeTestGenerated });

    // Instance-level filtering based on source_agent_id field.
    // Hermes agents have IDs starting with "hermes:".
    if (instance === 'hermes-local') {
      history = history.filter(s => s.source_agent_id && s.source_agent_id.startsWith('hermes:'));
    } else if (instance && instance !== 'all') {
      history = history.filter(s => !s.source_agent_id || !s.source_agent_id.startsWith('hermes:'));
    }

    return NextResponse.json({
      scans: history,
      total: history.length,
      limit,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/shield/history] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
