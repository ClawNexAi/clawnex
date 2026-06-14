/**
 * Security Scan History API
 * GET /api/security/history — list past scan results
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { listScans } from '@/lib/services/clawkeeper-runner';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

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
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100);

    const scans = listScans(limit);

    return NextResponse.json({
      scans,
      count: scans.length,
    });
  } catch (err) {
    console.error('[API /security/history] Error:', err);
    return NextResponse.json({ error: 'Failed to retrieve scan history' }, { status: 500 });
  }
}
