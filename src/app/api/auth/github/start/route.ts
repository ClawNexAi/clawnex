// GET /api/auth/github/start
//
// Anonymous endpoint — kicks off GitHub OAuth sign-in by 302-redirecting
// to GitHub's authorize page. Stores the random state token in a
// short-lived cookie so the callback can verify it (CSRF defense).
//
// Refuses to operate unless an admin has explicitly enabled the GitHub
// provider AND credentials are present (DB-backed config with env
// fallback — see providers/github.ts).

import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, isConfigured, isEnabled } from "@/lib/services/auth/providers/github";
import { publicOrigin } from "@/lib/services/auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "clawnex_gh_state";
const PURPOSE_COOKIE = "clawnex_gh_purpose";
const STATE_TTL_S = 10 * 60;

export async function GET(request: NextRequest) {
  const ip = (request as unknown as { ip?: string }).ip || "unknown";
  const origin = publicOrigin(request);
  const isSecure = origin.startsWith("https:");
  const rl = checkRateLimit(`gh-start:${ip}`, config.rbac.loginRateLimitPerMinute);
  if (!rl.allowed) {
    return NextResponse.redirect(new URL("/login?error=github_rate_limited", origin));
  }

  if (!isEnabled()) {
    return NextResponse.redirect(new URL("/login?error=github_not_enabled", origin));
  }
  if (!isConfigured()) {
    return NextResponse.redirect(new URL("/login?error=github_not_configured", origin));
  }

  try {
    const { url, state } = buildAuthorizeUrl();
    const response = NextResponse.redirect(url);
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/github",
      maxAge: STATE_TTL_S,
      secure: isSecure,
    });
    // Always sign-in mode here. /api/auth/github/link sets purpose=link
    // separately so the callback knows which flow to run.
    response.cookies.set(PURPOSE_COOKIE, "signin", {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/github",
      maxAge: STATE_TTL_S,
      secure: isSecure,
    });
    return response;
  } catch (err) {
    console.error("[github/start]", err);
    return NextResponse.redirect(new URL("/login?error=github_start_failed", origin));
  }
}
