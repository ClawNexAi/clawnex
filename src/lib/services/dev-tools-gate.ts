/**
 * Developer Tools gate -- shared three-layer check for the
 * /api/dev/* family of endpoints (seed, reset, runs, status).
 *
 * Three independent guards must ALL pass before any /api/dev/* mutation
 * fires. Any one of them being off makes the surface unreachable, by
 * design. This is the banking-customer install posture: even an admin
 * with full RBAC can't seed simulation traffic if the install template
 * baked the env kill-switch in.
 *
 * Layer 1 -- env kill switch (`CLAWNEX_DEV_TOOLS_DISABLED=1`)
 *   Default: unset = allowed. Customer-prod install templates set this
 *   to "1" via `setup.sh --lock-dev-tools` so the surface is locked
 *   regardless of any UI toggle. This is the strongest guard; an
 *   operator can't override it from the dashboard.
 *
 * Layer 2 -- DB toggle (`config_defaults.dev_tools_enabled === 'true'`)
 *   Default: false. Admin must consciously flip it from the
 *   Configuration -> System Management -> Developer Tools card with a
 *   typed-phrase confirm modal. Persisted across dashboard restarts.
 *   Layer 1 always wins: if env-disabled, the toggle is hidden and
 *   non-flippable.
 *
 * Layer 3 -- RBAC (system:manage permission)
 *   Default behavior: when RBAC is on, only operators with
 *   system:manage can seed/reset. When RBAC is off, falls back to
 *   localhost guard (RBAC-Off Defense Pattern). Audit-logged on every
 *   mutation.
 *
 * Returns null when everything passes; an error response (with HTTP
 * status code) when blocked. Routes use the result directly:
 *
 *   const blocked = checkDevToolsGate(request);
 *   if (blocked) return blocked;
 *   ... safe to mutate ...
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getSetting } from './config-service';

/**
 * Layer 1 only. Used by the dashboard's status probe so the UI can
 * decide whether to render the Developer Tools card at all (vs render
 * it hidden vs render with the toggle vs render with the seed UI).
 */
export function isDevToolsEnvAllowed(): boolean {
  return process.env.CLAWNEX_DEV_TOOLS_DISABLED !== '1';
}

/**
 * Layer 2 only. Reads the persisted admin choice. Returns false when
 * the setting is missing (default off) or when env is disabled (Layer 1
 * always wins).
 */
export function isDevToolsDbEnabled(): boolean {
  if (!isDevToolsEnvAllowed()) return false;
  const v = getSetting('dev_tools_enabled');
  return v === 'true' || v === '1';
}

/**
 * Full gate for mutating endpoints. Returns null when the request is
 * authorized to proceed; an error NextResponse otherwise.
 *
 * Order: env -> db -> RBAC. Earlier failures get more specific status
 * codes (404 for env-disabled to make the surface look like it doesn't
 * exist; 403 for db-disabled because it's a state the operator can fix
 * by flipping the toggle; 403 from the RBAC layer for permission).
 */
export function checkDevToolsGate(request: NextRequest): NextResponse | null {
  // Layer 1: env kill switch. 404 so the route looks non-existent on
  // customer-prod installs that locked it out -- no information leak
  // about the feature even existing.
  if (!isDevToolsEnvAllowed()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Layer 2: DB toggle.
  if (!isDevToolsDbEnabled()) {
    return NextResponse.json(
      {
        error: 'Developer Tools are disabled.',
        hint: 'An admin can enable them from Configuration -> System Management -> Developer Tools.',
      },
      { status: 403 },
    );
  }

  // Layer 3: RBAC + localhost fallback. Same dual-flag pattern as the
  // rest of the mutating surface (RBAC-Off Defense Pattern).
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'system:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  return null;
}

/**
 * Read-only gate for /api/dev/status. Looser than the full gate -- a
 * read-only operator should be able to see whether the surface is
 * available without being a system admin. But still respects the env
 * kill switch (404) so customer-prod doesn't leak feature existence.
 */
export function checkDevToolsReadGate(request: NextRequest): NextResponse | null {
  if (!isDevToolsEnvAllowed()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    // Any authenticated operator can read status; only system:manage
    // can mutate. Allows non-admin operators to see "Developer Tools
    // are disabled by your admin" rather than 403'ing.
    const perm = requirePermission(auth.operator, 'config:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }
  return null;
}
