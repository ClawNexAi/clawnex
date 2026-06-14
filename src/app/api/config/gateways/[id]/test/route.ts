/**
 * POST /api/config/gateways/[id]/test — test WebSocket/HTTP connection
 */

import { NextRequest, NextResponse } from 'next/server';
import * as configService from '@/lib/services/config-service';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (isRbacEnabled()) {
      const auth = requireSession(request);
      if (auth instanceof NextResponse) return auth;
      const perm = requirePermission(auth.operator, 'config:write');
      if (perm) return perm;
    } else {
      const guard = requireLocalhost(request);
      if (guard) return guard;
    }

    const { id } = await params;
    const result = await configService.testGateway(id);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[Config API] Error testing gateway:', err);
    return NextResponse.json({ error: 'Failed to test gateway' }, { status: 500 });
  }
}
