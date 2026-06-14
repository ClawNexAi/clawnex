/**
 * GET /api/config/gateways — list all gateways with status
 * POST /api/config/gateways — add new gateway
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import * as configService from '@/lib/services/config-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const __t0 = Date.now();
  try {
    const gateways = configService.listGateways().map(g => configService.redactGateway(g));
    console.log(`[api/config/gateways:GET] ${Date.now() - __t0}ms count=${gateways.length}`);
    return NextResponse.json({ gateways });
  } catch (err) {
    console.error(`[api/config/gateways:GET] failed after ${Date.now() - __t0}ms:`, err);
    return NextResponse.json({ error: 'Failed to list gateways' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { name, url, token, clientName, id } = body as {
      name?: string;
      url?: string;
      token?: string;
      clientName?: string;
      id?: string;
    };

    if (!name || !url) {
      return NextResponse.json({ error: 'Missing required fields: name, url' }, { status: 400 });
    }

    const gateway = configService.addGateway({ id, name, url, token, clientName });
    // Redact token in the response — GET already redacts; without this POST
    // would return the plaintext token to the browser, network logs, and any
    // intermediary. DB row keeps the real value.
    return NextResponse.json({ gateway: configService.redactGateway(gateway) }, { status: 201 });
  } catch (err) {
    console.error('[Config API] Error adding gateway:', err);
    return NextResponse.json({ error: 'Failed to add gateway' }, { status: 500 });
  }
}
