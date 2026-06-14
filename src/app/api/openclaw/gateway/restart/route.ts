/**
 * OpenClaw Gateway Restart API
 * POST /api/openclaw/gateway/restart -- triggers the platform-appropriate
 *                                      restart command (systemctl --user
 *                                      on Linux, launchctl on macOS).
 *                                      Returns supervisor kind + elapsed
 *                                      time + raw output for transparency.
 *
 * GET  /api/openclaw/gateway/restart -- detection-only probe. Returns
 *                                      what supervisor we'd use without
 *                                      actually restarting. Used by the
 *                                      dashboard to decide whether to
 *                                      enable the Restart button vs.
 *                                      show the manual fallback hint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { restartOpenClawGateway, detectSupervisor } from '@/lib/services/openclaw-gateway-control';
import { logEvent } from '@/lib/services/audit-logger';

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
    const supervisor = await detectSupervisor();
    return NextResponse.json({ ok: true, supervisor });
  } catch (err) {
    console.error('[OpenClaw Gateway Restart] Detection error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  // Same gate as the routing wire endpoint -- restart is a config-level
  // mutation. RBAC config:write OR localhost fallback when RBAC is off.
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
    const result = await restartOpenClawGateway();
    logEvent(
      'config',
      'openclaw_gateway_restart',
      'openclaw',
      'gateway',
      `restart: ${result.status} via ${result.supervisor} (${result.detail})`,
      'api',
    );
    const httpStatus = result.ok ? 200 : (result.status === 'unsupported' ? 501 : 500);
    return NextResponse.json(result, { status: httpStatus });
  } catch (err) {
    console.error('[OpenClaw Gateway Restart] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
