/**
 * Public health check endpoint — GET /api/health
 *
 * INTENTIONALLY MINIMAL (adversarial review finding #A4, 2026-04-24).
 * Returns only the fields external uptime probes need:
 *   - status      — always "ok" when the process is alive
 *   - name        — stable service identity
 *   - timestamp   — when the probe ran
 *
 * DAST 2026-05-15 Run 2: keep version and process uptime off the
 * unauthenticated health surface. Detailed deployment/build telemetry belongs
 * behind /api/health/detailed, not on the public liveness probe.
 *
 * The detailed operational payload (OpenClaw connection state,
 * break-glass reason, watcher internals) moved to /api/health/detailed
 * which requires either an authenticated session or a localhost caller.
 * That split stops anonymous callers from learning when the shield is
 * OFF, which OpenClaw gateway is disconnected, etc. — all of which were
 * previously leaked here.
 *
 * Side effects preserved: external uptime probes are the most frequent
 * callers, so this endpoint is still the place to drive the lazy-init
 * tick (watcher start, retention enforcement, pricing seed, break-glass
 * expiry). The shared helper is reused by /api/health/detailed so the
 * authenticated callers also keep the tick alive.
 */

import { NextResponse } from 'next/server';
import { runHealthTick } from '@/lib/services/health-tick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  runHealthTick();

  return NextResponse.json({
    status: 'ok',
    name: 'ClawNex',
    timestamp: new Date().toISOString(),
  });
}
