/**
 * Authenticated detailed health endpoint — GET /api/health/detailed
 *
 * Introduced 2026-04-24 to move operational detail (OpenClaw connection
 * state, break-glass reason, session-watcher internals, SSE client
 * count, etc.) off the anonymous /api/health response per adversarial
 * review finding #A4. External uptime probes keep using /api/health
 * (minimal); dashboard UI, MCP resources, and monitoring that needs
 * the full state hit this endpoint.
 *
 * Tri-gate authorization (v0.9.1-alpha — added API-key path):
 *
 *   1. API key (X-ClawNex-Key or Authorization: Bearer cnx_...) with
 *      scope `health:read`  — for external automated monitoring
 *      (DataDog, Prometheus, etc.). Checked FIRST so a probe carrying
 *      a key doesn't need a session cookie. Only engages when an API-
 *      key header is actually present, so session-based callers don't
 *      trip the API-key 401 path before reaching their own gate. Rate
 *      limit is per-key via the api_keys.rate_limit column.
 *
 *   2. RBAC session cookie (RBAC_ENABLED=true) — for the dashboard UI.
 *
 *   3. requireLocalhost (RBAC_ENABLED=false) — for the break-glass
 *      local-tool posture. MCP resources co-locate with the Next.js
 *      process and hit via http://127.0.0.1:5001 so they pass this
 *      without needing a key or session.
 *
 * The tick side-effects (watcher start, retention, break-glass expiry)
 * run here as well as on /api/health — so whichever endpoint sees
 * traffic in a given deployment, the lazy-init work stays alive.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { authenticateRequest } from '@/lib/middleware/api-auth';
import { runHealthTick, readDetailedHealth } from '@/lib/services/health-tick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 1. API-key path — only when a key header is actually present, so the
  //    session-based dashboard UI doesn't get 401'd by the API-key layer
  //    before reaching its own gate below.
  const hasApiKeyHeader =
    request.headers.get('x-clawnex-key') ||
    request.headers.get('authorization')?.startsWith('Bearer ');
  if (hasApiKeyHeader) {
    const apiAuth = authenticateRequest(request, 'health:read');
    if (!apiAuth.authenticated) {
      return NextResponse.json(
        { error: apiAuth.error },
        { status: apiAuth.status ?? 401 },
      );
    }
    // Authenticated via API key — fall through to the response below.
  } else if (isRbacEnabled()) {
    const session = requireSession(request);
    if (session instanceof NextResponse) return session;
    // Every authenticated operator can see health — no extra permission
    // check (operational visibility is not a role-gated capability).
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  runHealthTick();
  return NextResponse.json(readDetailedHealth());
}
