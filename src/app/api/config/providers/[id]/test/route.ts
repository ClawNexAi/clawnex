/**
 * POST /api/config/providers/[id]/test — test connection, discover models
 */

import { NextRequest, NextResponse } from 'next/server';
import * as configService from '@/lib/services/config-service';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { testConfiguredProxyModel } from '@/lib/services/provider-routing-readiness';
import { logEvent } from '@/lib/services/audit-logger';

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
    let body: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
        body = parsed;
      }
    } catch { return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 }); }
    if (body.action === 'inference') {
      if (typeof body.modelAlias !== 'string' || !body.modelAlias.trim()) {
        return NextResponse.json({ error: 'Select a configured model first.' }, { status: 400 });
      }
      const result = await testConfiguredProxyModel(id, body.modelAlias, body.approved === true);
      if (body.approved === true) logEvent('config', 'provider_inference_test', 'provider', id, result.status, 'api');
      return NextResponse.json(result, { status: result.ready ? 200 : 409 });
    }
    if (body.action !== undefined) return NextResponse.json({ error: 'Unknown test action' }, { status: 400 });
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
