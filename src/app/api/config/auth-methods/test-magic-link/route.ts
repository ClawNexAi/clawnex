// POST /api/config/auth-methods/test-magic-link
//
// Admin-only diagnostic — sends a real magic-link email to the calling
// admin's own address using the same code path /api/auth/magic-link/begin
// uses. Difference: failures here surface verbose, machine-readable codes
// instead of the no-enumeration silent-success the public endpoint returns.
//
// Why this exists: an admin can configure Mail Configuration + flip the
// Magic Link toggle and still never receive emails — usually because the
// admin operator account has no email address on file (the setup wizard
// makes email optional). The public /begin endpoint can't tell the admin
// what's wrong without leaking who's registered, so this gated endpoint
// fills that gap.

import { NextRequest, NextResponse } from "next/server";
import {
  requireSession,
  requirePermission,
  isRbacEnabled,
} from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { sendMagicLinkEmail } from "@/lib/services/auth/providers/magic-link";
import { getOperatorById } from "@/lib/services/operator-service";
import { publicOrigin } from "@/lib/services/auth";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Mirror the dual-gate used by the rest of /api/config/auth-methods.
  // RBAC on → session + config:write; RBAC off → localhost-only fallback.
  let actorOperatorId: string | null = null;
  let actorUsername: string;
  if (isRbacEnabled()) {
    const session = requireSession(request);
    if (session instanceof NextResponse) return session;
    const denied = requirePermission(session.operator, "config:write");
    if (denied) return denied;
    actorOperatorId = session.operator.id;
    actorUsername = session.operator.username;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
    return NextResponse.json(
      {
        ok: false,
        code: "rbac_disabled",
        message:
          "Test send requires RBAC. Magic Link is irrelevant in localhost-only mode.",
      },
      { status: 400 },
    );
  }

  if (!actorOperatorId) {
    return NextResponse.json(
      {
        ok: false,
        code: "no_session",
        message: "Could not resolve the calling admin operator.",
      },
      { status: 401 },
    );
  }

  const operator = getOperatorById(actorOperatorId);
  if (!operator) {
    return NextResponse.json(
      {
        ok: false,
        code: "operator_not_found",
        message: "Your admin record could not be loaded. Try logging out and back in.",
      },
      { status: 404 },
    );
  }

  const ip = (request as unknown as { ip?: string }).ip || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;
  const origin = publicOrigin(request);

  const result = await sendMagicLinkEmail({
    operator,
    origin,
    ip,
    userAgent,
    testTag: true,
  });

  if (!result.ok) {
    logEvent(
      actorUsername,
      "magic_link_test_failed",
      "config",
      "auth-methods",
      `Test failed: ${result.code} — ${result.message}`,
      "auth",
    );
    // 200 with ok:false so the UI can render the diagnostic message
    // verbatim without unwrapping a HTTP error envelope. The code field
    // lets the client distinguish actionable failures (no_email →
    // "set an address on your account") from infra failures (send_failed
    // → "check Mail Configuration").
    return NextResponse.json(result, { status: 200 });
  }

  logEvent(
    actorUsername,
    "magic_link_test_sent",
    "config",
    "auth-methods",
    `Test magic link sent to ${result.sentTo}`,
    "auth",
  );

  return NextResponse.json({
    ok: true,
    sentTo: result.sentTo,
    message: `Test magic link sent to ${result.sentTo}. Check your inbox — the link is valid for one use.`,
  });
}
