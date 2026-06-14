// POST /api/auth/passkey/authenticate/complete
//
// Anonymous endpoint — verifies the browser's signed assertion, looks
// up the operator the credential belongs to, and (on success) creates
// a session cookie just like /api/auth/login does.
//
// Mirrors the policy block in /api/auth/login: rate-limit, audit, session
// creation, max-sessions enforcement. The provider module only verifies
// the cryptography — every other piece of security policy stays here so
// it's enforced uniformly across providers.

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";
import { config } from "@/lib/config";
import { completeAuthentication } from "@/lib/services/auth/providers/passkey";
import { createSession, enforceSessionLimit } from "@/lib/services/session-service";
import { recordLogin } from "@/lib/services/operator-service";
import { isPublicSecure, publicOrigin } from "@/lib/services/auth";
import { logEvent } from "@/lib/services/audit-logger";
import { setCsrfCookie } from "@/lib/auth/csrf-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHALLENGE_COOKIE = "clawnex_passkey_chal";

export async function POST(request: NextRequest) {
  const ip = (request as unknown as { ip?: string }).ip || "unknown";
  const rl = checkRateLimit(`pk-complete:${ip}`, config.rbac.loginRateLimitPerMinute);
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

  const challengeId = request.cookies.get(CHALLENGE_COOKIE)?.value;
  if (!challengeId) {
    return NextResponse.json(
      { error: "Missing or expired challenge cookie" },
      { status: 400 },
    );
  }

  try {
    const body = await request.json();
    const { response: assertion, remember } = body;
    if (!assertion) {
      return NextResponse.json(
        { error: "Missing 'response' field" },
        { status: 400 },
      );
    }

    const result = await completeAuthentication({
      challengeId,
      response: assertion,
      // Resolve at request time — see src/lib/services/auth/index.ts publicOrigin
      // for the env-then-fallback policy. Captured-at-module-load was the bug.
      expectedOrigin: publicOrigin(request),
    });

    if (!result.ok) {
      logEvent(
        "anonymous",
        "passkey_login_failed",
        "operator",
        "unknown",
        `Passkey auth failed from ${ip}: ${result.failure.code}`,
        "auth",
      );
      const fail = NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
      fail.cookies.delete(CHALLENGE_COOKIE);
      return fail;
    }

    const userAgent = request.headers.get("user-agent") || undefined;
    const ttlSeconds = remember
      ? 30 * 24 * 3600
      : config.rbac.sessionTtlHours * 3600;
    const { sessionId, token } = createSession(
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
      `Passkey login from ${ip} (${userAgent?.substring(0, 50) || "unknown"})`,
      "auth",
    );

    const response = NextResponse.json({
      ok: true,
      operator: {
        id: result.data.operatorId,
        username: result.data.username,
        role: result.data.role,
      },
    });
    response.cookies.set("clawnex_session", token, {
      httpOnly: true,
      // 'strict' — same-origin API; see login route for full rationale.
      sameSite: "strict",
      path: "/",
      maxAge: ttlSeconds,
      secure: isPublicSecure(request),
    });
    // Atomic CSRF cookie — see src/lib/auth/csrf-cookie.ts for why.
    setCsrfCookie(response.cookies, request, sessionId);
    response.cookies.delete(CHALLENGE_COOKIE);
    return response;
  } catch (err) {
    console.error("[passkey/authenticate/complete]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
