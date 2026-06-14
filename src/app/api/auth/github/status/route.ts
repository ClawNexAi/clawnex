// GET /api/auth/github/status
//
// Split-response endpoint (adversarial review finding #A2, 2026-04-24):
//
//   - Anonymous callers get ONLY `{available: boolean}` where
//     `available = enabled && configured`. That's all the login page
//     needs to decide whether to show the "Sign in with GitHub" button,
//     and it's the minimum information that proves nothing an attacker
//     couldn't already deduce from probing /api/auth/github/start.
//
//   - Authenticated callers additionally get `{enabled, configured,
//     linked}` so the Auth & Devices admin card can surface the nuance
//     (e.g. "enabled but credentials missing — ask an admin"). `linked`
//     is per-caller so it naturally stays session-scoped.
//
// Intentionally NOT gated on RBAC mode — when RBAC is off, the "auth'd"
// branch returns the default-admin view, which is the same posture the
// rest of the authenticated surface takes in that mode.

import { NextRequest, NextResponse } from "next/server";
import { isConfigured, isEnabled } from "@/lib/services/auth/providers/github";
import { getOperatorFromRequest, isRbacEnabled } from "@/lib/rbac/guard";
import { queryOne } from "@/lib/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const enabled = isEnabled();
  const configured = isConfigured();
  const available = enabled && configured;

  // When RBAC is off, getOperatorFromRequest returns DEFAULT_OPERATOR —
  // that's the same "authenticated as admin" behavior the rest of the
  // dashboard uses in break-glass mode. When RBAC is on, an anonymous
  // caller gets null and we fall through to the minimal shape.
  const operator = getOperatorFromRequest(request);

  // Anonymous callers (RBAC on + no valid session) get the minimum.
  if (isRbacEnabled() && !operator) {
    return NextResponse.json({ available });
  }

  // Authenticated callers — surface the full detail the admin UI needs.
  let linked: { username: string; linkedAt: string } | null = null;
  if (operator) {
    const row = queryOne<{ github_username: string; created_at: string }>(
      `SELECT github_username, created_at FROM operator_credentials
       WHERE operator_id = ? AND credential_type = 'github_link'
       LIMIT 1`,
      [operator.id],
    );
    if (row) linked = { username: row.github_username, linkedAt: row.created_at };
  }

  return NextResponse.json({
    available,
    enabled,
    configured,
    linked,
  });
}
