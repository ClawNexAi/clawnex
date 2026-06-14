// POST /api/auth/github/link
//
// Authenticated endpoint — kicks off the GitHub OAuth flow in *link* mode.
// Returns JSON { url } so the client can `window.location.href = url`.
//
// We use POST (not GET) deliberately: requireSession enforces CSRF on
// mutation methods, so a malicious site can't trick a logged-in admin
// into starting an unsolicited link flow via a cross-site GET. The
// dashboard's fetch shim auto-attaches the X-CSRF-Token header.
//
// Sets purpose=link in the cookie so the shared callback persists the
// resulting GitHub identity onto the current operator instead of trying
// to sign in.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/rbac/guard";
import { buildAuthorizeUrl, isConfigured, isEnabled } from "@/lib/services/auth/providers/github";
import { publicOrigin } from "@/lib/services/auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "clawnex_gh_state";
const PURPOSE_COOKIE = "clawnex_gh_purpose";
const STATE_TTL_S = 10 * 60;

export async function POST(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  const ip = (request as unknown as { ip?: string }).ip || "unknown";
  const rl = checkRateLimit(`gh-link:${ip}`, config.rbac.loginRateLimitPerMinute);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 },
    );
  }

  if (!isEnabled() || !isConfigured()) {
    return NextResponse.json(
      { error: "GitHub sign-in is not enabled or not configured." },
      { status: 400 },
    );
  }

  try {
    const { url, state } = buildAuthorizeUrl();
    const isSecure = publicOrigin(request).startsWith("https:");
    const response = NextResponse.json({ url });
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/github",
      maxAge: STATE_TTL_S,
      secure: isSecure,
    });
    response.cookies.set(PURPOSE_COOKIE, "link", {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/auth/github",
      maxAge: STATE_TTL_S,
      secure: isSecure,
    });
    return response;
  } catch (err) {
    console.error("[github/link]", err);
    return NextResponse.json(
      { error: "Could not start GitHub link." },
      { status: 500 },
    );
  }
}
