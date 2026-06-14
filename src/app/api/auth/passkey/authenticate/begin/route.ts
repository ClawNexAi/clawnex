// POST /api/auth/passkey/authenticate/begin
//
// Anonymous endpoint — starts the passkey sign-in ceremony. Returns
// resident-key options (no allowCredentials list) so the browser shows
// the user every passkey enrolled for this RP and lets them pick one.
//
// IP rate-limited to deter passkey-spam attacks against the challenge
// store. Uses the same per-IP sliding window as /login.

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";
import { config } from "@/lib/config";
import { buildAuthenticationOptions } from "@/lib/services/auth/providers/passkey";
import { isPublicSecure } from "@/lib/services/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHALLENGE_COOKIE = "clawnex_passkey_chal";
const CHALLENGE_TTL_S = 5 * 60;

export async function POST(request: NextRequest) {
  const ip = (request as unknown as { ip?: string }).ip || "unknown";
  const rl = checkRateLimit(`pk-begin:${ip}`, config.rbac.loginRateLimitPerMinute);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  try {
    const { options, challengeId } = await buildAuthenticationOptions();
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
    console.error("[passkey/authenticate/begin]", err);
    return NextResponse.json(
      { error: "Failed to start authentication" },
      { status: 500 },
    );
  }
}
