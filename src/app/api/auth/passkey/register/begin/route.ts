// POST /api/auth/passkey/register/begin
//
// Authenticated endpoint — starts the WebAuthn registration ceremony for
// the current operator. Stores the challenge server-side keyed by a
// short-lived cookie and returns the PublicKeyCredentialCreationOptions
// the browser feeds into navigator.credentials.create().
//
// The cookie path is scoped to /api/auth/passkey so it only travels with
// the matching /complete request, not other API calls.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/rbac/guard";
import { buildRegistrationOptions } from "@/lib/services/auth/providers/passkey";
import { isPublicSecure } from "@/lib/services/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHALLENGE_COOKIE = "clawnex_passkey_chal";
const CHALLENGE_TTL_S = 5 * 60;

export async function POST(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  try {
    const { options, challengeId } = await buildRegistrationOptions(
      session.operator.id,
      session.operator.username,
    );

    const response = NextResponse.json({ options });
    response.cookies.set(CHALLENGE_COOKIE, challengeId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/passkey",
      maxAge: CHALLENGE_TTL_S,
      secure: isPublicSecure(request),
    });
    return response;
  } catch (err) {
    console.error("[passkey/register/begin]", err);
    return NextResponse.json(
      { error: "Failed to start registration" },
      { status: 500 },
    );
  }
}
