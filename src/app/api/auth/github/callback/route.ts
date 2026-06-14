// GET /api/auth/github/callback
//
// GitHub redirects here after the user clicks Authorize. Two possible flows:
//
//   purpose=signin  → completeGithubCallback → mint clawnex_session
//   purpose=link    → verifyGithubForLinking → insertGithubLink for the
//                     authenticated operator (route guarded separately)
//
// CSRF: state cookie must equal ?state= query param. State cookie was
// set by /start (or /link) with a 10-min TTL.

import { NextRequest, NextResponse } from "next/server";
import {
  completeGithubCallback,
  verifyGithubForLinking,
  isEnabled,
} from "@/lib/services/auth/providers/github";
import {
  insertGithubLink,
  findGithubLinkByUserId,
} from "@/lib/services/auth/credentials-service";
import { run } from "@/lib/db/index";
import { getOperatorById, recordLogin } from "@/lib/services/operator-service";
import { createSession, enforceSessionLimit, validateSession } from "@/lib/services/session-service";
import {
  parseEnrolledProviders,
  serializeEnrolledProviders,
  publicOrigin,
} from "@/lib/services/auth";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limiter";
import { logEvent } from "@/lib/services/audit-logger";
import { setCsrfCookie } from "@/lib/auth/csrf-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "clawnex_gh_state";
const PURPOSE_COOKIE = "clawnex_gh_purpose";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
  const purpose = request.cookies.get(PURPOSE_COOKIE)?.value || "signin";

  // Rate-limit per IP — discourages spammed bogus callbacks (each one
  // costs us a round-trip to GitHub's token + user APIs).
  //
  // Two IP views are in play here:
  //   - `rateLimitIp`: a non-empty string key for the limiter bucket; falling
  //     back to "unknown" means all IP-less requests share one bucket which
  //     is the correct conservative behavior.
  //   - `ip`: passed down to createSession() and validateSession() for the
  //     session's ip_address column. MUST remain undefined when unknown so
  //     the SESSION_BIND_IP feature's fail-closed path in session-service.ts
  //     triggers correctly instead of comparing a real IP against the
  //     literal string "unknown" (which would lock out legitimate users).
  const rateLimitIp = (request as unknown as { ip?: string }).ip || "unknown";
  const ip = (request as unknown as { ip?: string }).ip || undefined;
  const rl = checkRateLimit(`gh-cb:${rateLimitIp}`, config.rbac.loginRateLimitPerMinute);
  const origin = publicOrigin(request);
  if (!rl.allowed) {
    return NextResponse.redirect(new URL("/login?error=github_rate_limited", origin));
  }

  // Refuse to honor callbacks for a provider that's been disabled
  // mid-flight — keeps a stale state cookie from completing a flow
  // after admin flips the kill switch.
  if (!isEnabled()) {
    return NextResponse.redirect(new URL("/login?error=github_not_enabled", origin));
  }

  // Always clear the state cookies on any return, success or failure.
  function clearCookies(res: NextResponse): NextResponse {
    res.cookies.delete(STATE_COOKIE);
    res.cookies.delete(PURPOSE_COOKIE);
    return res;
  }

  if (!code || !state || !stateCookie || state !== stateCookie) {
    return clearCookies(NextResponse.redirect(new URL("/login?error=github_state_mismatch", origin)));
  }

  // ── LINK FLOW ────────────────────────────────────────────────────────────
  if (purpose === "link") {
    // Linking requires a logged-in operator. Validate the session cookie
    // here directly (we can't import requireSession from a GET-only route
    // without dragging in the CSRF check, which doesn't apply to OAuth
    // callbacks). Reuses the outer-scope `ip` (already undefined when
    // request.ip is unset).
    const sessionToken = request.cookies.get("clawnex_session")?.value;
    const session = sessionToken ? validateSession(sessionToken, ip) : null;
    if (!session) {
      return clearCookies(NextResponse.redirect(new URL("/login?error=link_no_session", origin)));
    }

    const verify = await verifyGithubForLinking(code);
    if (!verify.ok) {
      return clearCookies(NextResponse.redirect(new URL("/?error=github_link_failed", origin)));
    }

    // Reject if this GitHub account is already linked to another operator.
    const existing = findGithubLinkByUserId(verify.githubUserId);
    if (existing && existing.operator_id !== session.operator.id) {
      return clearCookies(NextResponse.redirect(new URL("/?error=github_already_linked", origin)));
    }

    if (!existing) {
      insertGithubLink({
        operatorId: session.operator.id,
        githubUserId: verify.githubUserId,
        githubUsername: verify.githubUsername,
      });
      const op = getOperatorById(session.operator.id);
      if (op) {
        const current = parseEnrolledProviders(op.auth_providers);
        if (!current.includes("github")) {
          run(
            "UPDATE operators SET auth_providers = ?, updated_at = datetime('now') WHERE id = ?",
            [serializeEnrolledProviders([...current, "github"]), op.id],
          );
        }
      }
      logEvent(
        session.operator.username,
        "github_linked",
        "operator",
        session.operator.id,
        `Linked GitHub user @${verify.githubUsername}`,
        "auth",
      );
    }

    return clearCookies(NextResponse.redirect(new URL("/?github_linked=1", origin)));
  }

  // ── SIGN-IN FLOW ─────────────────────────────────────────────────────────
  const result = await completeGithubCallback(code);
  if (!result.ok) {
    const errCode =
      result.failure.code === "provider_not_enrolled"
        ? "github_not_linked"
        : "github_signin_failed";
    logEvent(
      "anonymous",
      "github_login_failed",
      "operator",
      "unknown",
      `GitHub auth failed: ${result.failure.code}`,
      "auth",
    );
    return clearCookies(NextResponse.redirect(new URL(`/login?error=${errCode}`, origin)));
  }

  const userAgent = request.headers.get("user-agent") || undefined;
  const ttlSeconds = config.rbac.sessionTtlHours * 3600;
  const { sessionId, token } = createSession(result.data.operatorId, ip, userAgent, ttlSeconds);
  enforceSessionLimit(result.data.operatorId, config.rbac.maxSessionsPerOperator);
  recordLogin(result.data.operatorId);

  logEvent(
    result.data.username,
    "operator_login",
    "operator",
    result.data.operatorId,
    `GitHub login from ${ip ?? "unknown"} (${userAgent?.substring(0, 50) || "unknown"})`,
    "auth",
  );

  const redirect = NextResponse.redirect(new URL("/", origin));
  redirect.cookies.set("clawnex_session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ttlSeconds,
    secure: origin.startsWith("https:"),
  });
  // Atomic CSRF cookie — see src/lib/auth/csrf-cookie.ts for why.
  setCsrfCookie(redirect.cookies, request, sessionId);
  return clearCookies(redirect);
}
