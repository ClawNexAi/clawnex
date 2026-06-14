/**
 * DELETE /api/config/gateways/[id] — remove a gateway
 */

import { NextRequest, NextResponse } from 'next/server';
import * as configService from '@/lib/services/config-service';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
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
    const result = configService.removeGateway(id);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Config API] Error removing gateway:', err);
    return NextResponse.json({ error: 'Failed to remove gateway' }, { status: 500 });
  }
}
