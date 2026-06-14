/**
 * Model Pricing Status API
 * GET /api/config/model-pricing
 *
 * Returns the current state of the model_prices store: total rows, breakdown
 * by source, last sync timestamp + tag, operator-configured stale threshold,
 * and auto-sync settings. Used by the Configuration → Updates → Model Pricing
 * card and the Welcome Wizard sync step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { getStatus } from '@/lib/services/model-pricing-store';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

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

  try {
    const status = getStatus();
    return NextResponse.json({ ok: true, ...status, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[API/model-pricing] status error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to read pricing status' },
      { status: 500 },
    );
  }
}
