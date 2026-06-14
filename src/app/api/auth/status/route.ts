/**
 * Auth Status — GET /api/auth/status
 *
 * Public endpoint (no auth required) that returns:
 * - Whether RBAC is enabled
 * - Whether setup is needed (0 operators)
 * - Whether the caller has a valid session
 */

import { NextRequest, NextResponse } from "next/server";
import { operatorCount } from "@/lib/services/operator-service";
import { validateSession } from "@/lib/services/session-service";
import { getEffectiveConfig as getMagicLinkEffectiveConfig } from "@/lib/services/auth/providers/magic-link";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rbacEnabled = config.rbac.enabled;
  const operators = operatorCount();
  const needsSetup = rbacEnabled && operators === 0;

  let authenticated = false;
  let operator = null;

  const cookie = request.cookies.get("clawnex_session");
  if (cookie?.value) {
    const result = validateSession(cookie.value);
    if (result) {
      authenticated = true;
      operator = result.operator;
    }
  }

  // Magic Link availability is the combination of admin toggle + mail
  // configured. Anonymous-safe: leaks the same globally-public config
  // state the /api/auth/github/status anonymous branch leaks, no more.
  // Used by the login page to show/hide the "Email me a magic link" button.
  const magicLinkAvailable = getMagicLinkEffectiveConfig().available;

  // H4 (DAST 2026-05-14): operatorCount leaked the number of accounts to
  // any unauthenticated caller — a social-engineering / enumeration aid
  // ("there's only one admin, I should target them"). Only authenticated
  // callers see the exact count. Anonymous callers still get the boolean
  // `needsSetup` which is all the login page needs to decide setup-vs-login.
  const response: Record<string, unknown> = {
    rbacEnabled,
    needsSetup,
    authenticated,
    operator,
    magicLinkAvailable,
  };
  if (authenticated) {
    response.operatorCount = operators;
  }
  return NextResponse.json(response);
}
