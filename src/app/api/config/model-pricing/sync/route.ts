/**
 * Model Pricing Sync API
 * POST /api/config/model-pricing/sync
 *
 * Fetches the LiteLLM `model_prices_and_context_window.json` file from GitHub
 * at the tag matching the currently pinned LITELLM_VERSION and upserts every
 * row into the `model_prices` table with source='synced'. Returns counts so
 * the UI can show an accurate success message.
 *
 * Safety: pulls from a pinned tag (not `main`) so upstream drift can't land
 * on operators' boxes without an explicit ClawNex team version bump.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { syncFromGitHub, getStatus } from '@/lib/services/model-pricing-store';
import { logEvent } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const result = await syncFromGitHub();
    try {
      logEvent(
        'operator',
        'model_pricing_sync',
        'config',
        'model_prices',
        `Synced ${result.totalModels} models from ${result.tag} in ${result.durationMs}ms (${result.inserted} inserted, ${result.updated} updated)`,
        'dashboard',
      );
    } catch { /* non-fatal */ }
    const status = getStatus();
    return NextResponse.json({
      ok: true,
      result,
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    console.error('[API/model-pricing/sync] error:', message);
    return NextResponse.json(
      { ok: false, error: message, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
