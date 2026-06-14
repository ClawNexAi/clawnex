/**
 * Magic Link — Begin
 * POST /api/auth/magic-link/begin
 *
 * Accepts { email }, and if the email matches an active operator AND the
 * admin has enabled Magic Link AND a mail provider is configured, mails
 * a one-shot sign-in link. Always returns 200 with the same message so
 * that anonymous callers can't use this endpoint to enumerate which
 * emails are registered (matches forgot-password's shape).
 *
 * Rate limit: 3 requests/min/IP, same as forgot-password.
 *
 * Timing-oracle defense (CX-G3 fix from 2026-04-26 review): the body is
 * enumeration-safe but the wallclock isn't — real operators trigger
 * `sendMail()` (rendering + outbound HTTPS), nonexistent emails return
 * after a single SQL lookup. An attacker can probe candidate operator
 * emails and distinguish registered accounts by latency. We anchor a
 * minimum response budget at request entry and sleep to it before
 * responding, so every branch (rate-limited, RBAC off, provider not
 * available, unknown email, send-failed, send-ok) takes the same
 * floor-time regardless of work performed.
 */

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/index";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limiter";
import {
  getEffectiveConfig,
  sendMagicLinkEmail,
} from "@/lib/services/auth/providers/magic-link";
import { publicOrigin } from "@/lib/services/auth";
import type { OperatorRecord } from "@/lib/rbac/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUCCESS_MESSAGE =
  "If an account with that email exists, a sign-in link has been sent.";

// Minimum response time (ms) — chosen to comfortably exceed a healthy
// Resend / SMTP / Emailit send (typically 100-500ms) so the heavy branch
// (real operator, send fired) never breaches the floor. Trade-off: this
// makes legitimate sign-in starts feel slightly slower, but timing oracle
// closure is worth ~1.2s per request.
const MIN_RESPONSE_MS = 1200;

/** Sleep until the wall-clock floor has elapsed. No-op if work already
 *  exceeded the budget (we never artificially shorten — only lengthen). */
async function sleepUntil(deadlineMs: number): Promise<void> {
  const remaining = deadlineMs - Date.now();
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export async function POST(request: NextRequest) {
  // Anchor the deadline at request entry so every branch converges to the
  // same response time regardless of the work it actually performs.
  const deadlineMs = Date.now() + MIN_RESPONSE_MS;

  // Build the response in `respond()` so every return path passes through
  // the same constant-time envelope. Public callers see exactly one shape.
  const respond = async (
    body: Record<string, unknown>,
    status = 200,
  ): Promise<NextResponse> => {
    await sleepUntil(deadlineMs);
    return NextResponse.json(body, { status });
  };

  try {
    if (!config.rbac.enabled) {
      // Note: this branch was previously a fast-fail 403 with a config-state
      // leak. Now collapsed to the same generic 200 + envelope so an
      // anonymous caller can't distinguish RBAC-off installs.
      return respond({ message: SUCCESS_MESSAGE });
    }

    // Rate limit BEFORE any branching so the limit applies uniformly. Even
    // rate-limited callers get the generic success message — preserves the
    // no-enumeration guarantee (timing is the same regardless of email).
    const ip = (request as unknown as { ip?: string }).ip || "unknown";
    const rateLimited = checkRateLimit(`magic-link-begin:${ip}`, 3);
    if (!rateLimited.allowed) {
      return respond({ message: SUCCESS_MESSAGE });
    }

    const body = await request.json().catch(() => ({}));
    const { email } = body as { email?: string };
    if (!email || typeof email !== "string") {
      // Malformed request — public 400 with the same envelope so a missing
      // body doesn't shortcut the floor and become a probe vector.
      return respond({ error: "Email is required" }, 400);
    }

    // Global enablement check. If the admin hasn't turned Magic Link on, or
    // mail isn't configured, still return success to avoid leaking config
    // state to an unauthenticated caller. An admin who enabled the toggle
    // without mail configured sees that in the AuthMethodsCard preview.
    const effective = getEffectiveConfig();
    if (!effective.available) {
      return respond({ message: SUCCESS_MESSAGE });
    }

    // Operator lookup — case-insensitive match on the stored email. Never
    // branch the response based on whether the operator exists.
    const operator = queryOne<OperatorRecord>(
      "SELECT * FROM operators WHERE email = ? AND is_active = 1",
      [email.trim().toLowerCase()],
    );

    if (!operator || !operator.email) {
      return respond({ message: SUCCESS_MESSAGE });
    }

    // Delegate the invalidate→generate→render→send pipeline. The anonymous
    // path swallows the result code: a real send failure looks identical to
    // a non-existent operator from the caller's perspective. Admins who need
    // to debug a misconfigured provider should use the "Send test" button on
    // the AuthMethodsCard, which surfaces the same codes verbosely.
    const userAgent = request.headers.get("user-agent") || undefined;
    const origin = publicOrigin(request);
    const result = await sendMagicLinkEmail({
      operator,
      origin,
      ip,
      userAgent,
    });
    if (!result.ok) {
      // Operational warn — without this a misconfigured Resend key / expired
      // Emailit token / SMTP auth failure is invisible to admins because the
      // public response stays generic for no-enumeration. Stays as warn-level.
      console.warn(`[magic-link/begin] Suppressed failure: ${result.code} — ${result.message}`);
    }

    return respond({ message: SUCCESS_MESSAGE });
  } catch (err) {
    console.error("[API/auth/magic-link/begin] Error:", err);
    // Collapse all errors to the same success response — anonymous callers
    // must not learn whether the server hit an internal problem vs an
    // enumeration miss. Still passes through the deadline envelope.
    return respond({ message: SUCCESS_MESSAGE });
  }
}
