/**
 * Public API — Health Check
 * GET /api/v1/health
 *
 * Public liveness probe (no scope required). Returns minimal status so
 * external monitors (uptime probes, load balancers) can verify the
 * service is up.
 *
 * M3 (DAST 2026-05-14): version + uptime were exposed to any
 * unauthenticated caller. Version reveals which CVE patches apply;
 * uptime reveals whether the process recently restarted (useful for
 * coordinating an attack with a window where rate-limiter state is
 * cold). Authenticated v1 callers with a valid API key (any scope)
 * still get the full detail; anonymous probes only see liveness.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { CLAWNEX_VERSION } from '@/lib/version';
import { authenticateRequest } from '@/lib/middleware/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();

  // If a key header is present, authenticate it. We don't require any
  // specific scope — "I have a key" is sufficient for the detailed view.
  const hasKeyHeader =
    request.headers.get('x-clawnex-key') ||
    request.headers.get('authorization')?.startsWith('Bearer ');

  if (hasKeyHeader) {
    // Empty-string scope = "any valid key, no specific permission needed".
    const apiAuth = authenticateRequest(request, '');
    if (apiAuth.authenticated) {
      return NextResponse.json({
        ok: true,
        data: {
          status: 'ok',
          name: 'ClawNex',
          version: CLAWNEX_VERSION,
          uptime: Math.floor(process.uptime()),
        },
        meta: { requestId, timestamp },
      });
    }
    // Key present but invalid: fall through to anonymous response rather
    // than 401. A liveness endpoint that 401s on bad keys leaks key-
    // validity timing to attackers fuzzing for valid keys.
  }

  return NextResponse.json({
    ok: true,
    data: { status: 'ok', name: 'ClawNex' },
    meta: { requestId, timestamp },
  });
}
