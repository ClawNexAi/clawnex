/**
 * POST /api/config/providers/[id]/test — test connection, discover models
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
    const result = await configService.testProvider(id);

    if (result.status === 'connected' && result.models) {
      // Show discovered models but don't auto-persist — operator manages model list manually
      return NextResponse.json({ status: 'connected', models: result.models, totalCount: result.totalCount });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[Config API] Error testing provider:', err);
    return NextResponse.json({ error: 'Failed to test provider' }, { status: 500 });
  }
}
