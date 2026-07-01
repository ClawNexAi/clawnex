/**
 * System Version API — GET /api/system/version
 *
 * Returns the installed versions of ClawNex (always available — read from
 * package.json via src/lib/version.ts) and the colocated OpenClaw install
 * (best-effort — prefer installed CLI/package version, `null` when no install
 * is detected).
 *
 * Used by the Mission Control Action Queue's update-cve producer to
 * populate `UpdateCveFinding.currentVersion` with the real installed
 * version when the CVE's packageName matches a known component, instead
 * of the bare "installed" placeholder. Without this surface the resolver
 * has no way to know which side of "→ fixedVersion" the operator is on.
 *
 * Auth: gated behind `alerts:read` when RBAC is enabled — the same perm
 * tier that gates the producer's row visibility, so operators who can
 * see the CVE row can also see the version it's against. RBAC-off
 * fallback gates on localhost (RBAC-Off Defense Pattern).
 *
 * Body shape:
 *   { clawnex: string, openclaw: string | null }
 *
 * Failure modes (degraded-source banner triggers in the producer):
 *   - 401   → reason = "auth"
 *   - fetch network failure → reason = "unreachable"
 *   - 404 (route absent on older instances) → reason = "missing-endpoint"
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { CLAWNEX_VERSION } from '@/lib/version';
import { getOpenClawInstalledVersion } from '@/lib/openclaw-version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'alerts:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const openclaw = getOpenClawInstalledVersion();

  return NextResponse.json({
    clawnex: CLAWNEX_VERSION,
    openclaw,
  });
}
