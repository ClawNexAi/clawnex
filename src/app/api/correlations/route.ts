/**
 * Correlations API
 * GET /api/correlations — list correlations with optional ?severity=CRITICAL&limit=50 filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { listCorrelations, getWindowSize } from '@/lib/services/correlation-engine';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'alerts:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const __t0 = Date.now();
  try {
    const { searchParams } = new URL(request.url);

    const severity = searchParams.get('severity') || undefined;
    const since = searchParams.get('since') || undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam
      ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500)
      : undefined;

    const correlations = listCorrelations({ severity, since, limit });

    // Parse source_events JSON for each correlation
    const enriched = correlations.map((c) => {
      let events: unknown[] = [];
      try {
        events = JSON.parse(c.source_events);
      } catch {
        events = [];
      }
      return {
        ...c,
        source_events_parsed: events,
        event_count: Array.isArray(events) ? events.length : 0,
      };
    });

    const response = NextResponse.json({
      correlations: enriched,
      total: enriched.length,
      windowSize: getWindowSize(),
      filters: { severity, since },
      timestamp: new Date().toISOString(),
    });
    console.log(`[api/correlations:GET] ${Date.now() - __t0}ms count=${enriched.length}`);
    return response;
  } catch (err) {
    console.error(`[api/correlations:GET] failed after ${Date.now() - __t0}ms:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
