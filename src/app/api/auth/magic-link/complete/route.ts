/**
 * Magic Link — Complete
 * GET /api/auth/magic-link/complete?token=<raw>
 *
 * Consumes a magic-link token atomically and, on success, issues a session
 * cookie and redirects to the dashboard. On any failure, redirects to
 * /login?error=magic_link_invalid — the single generic error code is
 * intentional so a caller can't distinguish expired vs consumed vs unknown
 * tokens (token enumeration defense).
 *
 * GET-based delivery is required because email clients render clickable
 * links as GET requests. The CSRF-style safety comes from the token
 * itself: one-shot, 15-min TTL, 32 bytes of randomness, hashed at rest.
 */

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { createSession, enforceSessionLimit } from "@/lib/services/session-service";
import { consumeToken } from "@/lib/services/auth/providers/magic-link";
import { publicOrigin } from "@/lib/services/auth";
import { recordLogin } from "@/lib/services/operator-service";
import { logEvent } from "@/lib/services/audit-logger";
import { setCsrfCookie } from "@/lib/auth/csrf-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToLoginError(origin: string): NextResponse {
  return NextResponse.redirect(`${origin}/login?error=magic_link_invalid`, 303);
}

export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);

  try {
    if (!config.rbac.enabled) {
      return redirectToLoginError(origin);
    }

    const token = request.nextUrl.searchParams.get("token");
    if (!token) return redirectToLoginError(origin);

    const result = consumeToken(token);
    if (!result.ok) {
      // Failure codes already collapsed upstream; no detail leak here.
      return redirectToLoginError(origin);
    }

    const ip = (request as unknown as { ip?: string }).ip || undefined;
    const userAgent = request.headers.get("user-agent") || undefined;
    const ttlSeconds = config.rbac.sessionTtlHours * 3600;

    const { sessionId, token: sessionToken } = createSession(
      result.data.operatorId,
      ip,
      userAgent,
      ttlSeconds,
    );

    enforceSessionLimit(result.data.operatorId, config.rbac.maxSessionsPerOperator);
    recordLogin(result.data.operatorId);

    logEvent(
      result.data.username,
      "operator_login",
      "operator",
      result.data.operatorId,
      `Login via magic link from ${ip ?? "unknown"}`,
      "auth",
    );

    const response = NextResponse.redirect(`${origin}/`, 303);
    response.cookies.set("clawnex_session", sessionToken, {
      httpOnly: true,
      // 'strict' — the 303 redirect target is same-origin (${origin}/), so
      // the browser sends the just-set cookie on the follow-up GET. Email
      // client → magic-link click is cross-site for the INITIAL GET (no
      // session cookie sent there, by design), but the session lands
      // post-redirect. See login route for full rationale.
      sameSite: "strict",
      path: "/",
      maxAge: ttlSeconds,
      secure: origin.startsWith("https:"),
    });
    // Atomic CSRF cookie — see src/lib/auth/csrf-cookie.ts for why.
    setCsrfCookie(response.cookies, request, sessionId);
    return response;
  } catch (err) {
    console.error("[API/auth/magic-link/complete] Error:", err);
    return redirectToLoginError(origin);
  }
}
