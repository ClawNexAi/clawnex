/**
 * GET /api/config/models/default — get default model
 * POST /api/config/models/default — set default model { providerId, modelId }
 */

import { NextRequest, NextResponse } from 'next/server';
import * as configService from '@/lib/services/config-service';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    if (isRbacEnabled()) {
      const auth = requireSession(request);
      if (auth instanceof NextResponse) return auth;
      const perm = requirePermission(auth.operator, 'config:read');
      if (perm) return perm;
    } else {
      const guard = requireLocalhost(request);
      if (guard) return guard;
    }

    const result = configService.getDefaultModel();
    if (!result) {
      return NextResponse.json({ error: 'No default model configured' }, { status: 404 });
    }
    return NextResponse.json({
      providerId: result.provider.id,
      providerName: result.provider.name,
      modelId: result.model.model_id,
      modelName: result.model.name,
    });
  } catch (err) {
    console.error('[Config API] Error getting default model:', err);
    return NextResponse.json({ error: 'Failed to get default model' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { providerId, modelId } = body as { providerId?: string; modelId?: string };

    if (!providerId || !modelId) {
      return NextResponse.json({ error: 'Missing required fields: providerId, modelId' }, { status: 400 });
    }

    const result = configService.setDefaultModel(providerId, modelId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, providerId, modelId });
  } catch (err) {
    console.error('[Config API] Error setting default model:', err);
    return NextResponse.json({ error: 'Failed to set default model' }, { status: 500 });
  }
}
