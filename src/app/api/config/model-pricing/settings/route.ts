/**
 * Model Pricing Settings API
 * PUT /api/config/model-pricing/settings
 *
 * Updates the operator-configurable knobs for the model_prices store:
 * stale threshold (days), auto-sync enable flag, and auto-sync interval (hours).
 *
 * Body: { staleDays?: number; autoSyncEnabled?: boolean; autoSyncIntervalHours?: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateSettings } from '@/lib/services/model-pricing-store';
import { logEvent } from '@/lib/services/audit-logger';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest) {
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

    const body = (await request.json()) as {
      staleDays?: number;
      autoSyncEnabled?: boolean;
      autoSyncIntervalHours?: number;
    };
    const status = updateSettings(body);
    try {
      logEvent(
        'operator',
        'model_pricing_settings',
        'config',
        'model_prices',
        `staleDays=${status.staleDays} autoSyncEnabled=${status.autoSyncEnabled} autoSyncIntervalHours=${status.autoSyncIntervalHours}`,
        'dashboard',
      );
    } catch { /* non-fatal */ }
    return NextResponse.json({ ok: true, status, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update settings';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
