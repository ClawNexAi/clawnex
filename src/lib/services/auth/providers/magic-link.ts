// Magic Link auth provider.
//
// Flow: email-delivered one-shot token. The admin toggles the provider in
// Authentication Methods; any operator with an email address on file can
// click "Email me a magic link" on the login page, enter that email, and
// the server mails a URL. Clicking the URL (GET → /api/auth/magic-link/
// complete?token=...) validates + consumes the token and creates a session.
//
// Token security model:
//   - raw token is 32 bytes of crypto.randomBytes base64url-encoded (43 chars)
//   - only the sha256 hash is stored in magic_link_tokens.token_hash
//   - one-shot: consumed_at is set atomically with the UPDATE so two parallel
//     clicks can't both succeed (sqlite RETURNING-equivalent via changes())
//   - short TTL: default 15 minutes (MAGIC_LINK_EXPIRY_MINUTES env override)
//   - GET-based delivery is necessary so email clients render clickable links;
//     referer leak is mitigated by one-shot + short TTL
//
// Enablement gate:
//   - admin toggle in config_defaults (auth_magic_link_enabled = "true")
//   - plus a configured mail provider (isMailConfigured() checks Resend/SMTP/
//     Emailit) — otherwise the "send mail" step would silently fail and the
//     user would wait for an email that never arrives
//
// Spec: go-live-checklist Phase 1 v0.9.2 (Magic Link auth backend)

import { randomBytes, createHash } from "node:crypto";
import { v4 as uuid } from "uuid";
import { queryOne, run } from "../../../db/index";
import { getSetting } from "../../config-service";
import { isMailConfigured, sendMail } from "../../mail-service";
import { getOperatorById } from "../../operator-service";
import type { AuthResult, AuthProviderName } from "..";
import type { OperatorRecord, Role } from "../../../rbac/types";

/** Setting key for the admin toggle — also referenced from auth-methods route. */
export const MAGIC_LINK_SETTINGS = {
  enabled: "auth_magic_link_enabled",
} as const;

/** Token TTL in minutes. Short by design — a stale link is a liability. */
const DEFAULT_EXPIRY_MINUTES = 15;

function getExpiryMinutes(): number {
  const raw = process.env.MAGIC_LINK_EXPIRY_MINUTES;
  if (!raw) return DEFAULT_EXPIRY_MINUTES;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60) return DEFAULT_EXPIRY_MINUTES;
  return parsed;
}

/** Admin toggle — DB-first, no env fallback. Default off so operators opt in. */
export function isEnabled(): boolean {
  return getSetting(MAGIC_LINK_SETTINGS.enabled) === "true";
}

/** True iff a mail provider is configured — without this, links never send. */
export function isConfigured(): boolean {
  return isMailConfigured();
}

/** Effective state combines admin toggle AND mail-configured. `available`
 *  gates the UI (show the button or not); `note` explains why when not. */
export interface EffectiveMagicLinkConfig {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  note: string;
}

export function getEffectiveConfig(): EffectiveMagicLinkConfig {
  const enabled = isEnabled();
  const configured = isConfigured();
  const available = enabled && configured;
  const note = !enabled
    ? "Magic Link is disabled. An admin can turn it on in Authentication Methods."
    : !configured
      ? "Magic Link is enabled but no mail provider is configured. Set up Resend / SMTP / Emailit in Mail Configuration."
      : `Magic Link is live. Links expire after ${getExpiryMinutes()} minutes and can be used once.`;
  return { enabled, configured, available, note };
}

// ─── Token lifecycle ────────────────────────────────────────────────────────

/** Generate a fresh token + store its hash. Returns the RAW token so the
 *  caller can build the URL — raw value is never persisted. */
export function generateAndStoreToken(
  operatorId: string,
  ip?: string,
  userAgent?: string,
): { rawToken: string; expiresAt: string } {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + getExpiryMinutes() * 60 * 1000).toISOString();

  run(
    `INSERT INTO magic_link_tokens (id, operator_id, token_hash, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), operatorId, tokenHash, expiresAt, ip ?? null, userAgent ?? null],
  );

  return { rawToken, expiresAt };
}

/** Render the magic-link email body. Centralized so begin and admin-test
 *  both render the same template — divergent templates were a source of
 *  past bugs where one path validated the URL and the other didn't. */
export function renderMagicLinkEmail(opts: {
  operator: OperatorRecord;
  magicUrl: string;
  expiresInMinutes: number;
  testTag?: boolean;
}): { subject: string; html: string } {
  const { operator, magicUrl, expiresInMinutes, testTag } = opts;
  const heading = testTag ? "Magic Link Test" : "Magic Link Sign-In";
  const subject = testTag
    ? "ClawNex Magic Link — Test Send"
    : "Your ClawNex sign-in link";
  const introLine = testTag
    ? "This is a <strong>test</strong> sent from your ClawNex Authentication Methods card. Receiving it means Magic Link is wired up correctly. The button below works exactly like a real sign-in link — clicking it will sign you in."
    : "Click the button below to sign in to ClawNex. This link is good for one use.";
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #00e5a0; font-size: 28px; margin: 0;">ClawNex</h1>
        <p style="color: #666; font-size: 14px; margin: 4px 0 0;">${heading}</p>
      </div>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi <strong>${operator.display_name || operator.username}</strong>,
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        ${introLine}
      </p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${magicUrl}" style="display: inline-block; padding: 14px 32px; background: #00e5a0; color: #000; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px;">
          Sign in to ClawNex
        </a>
      </div>
      <p style="color: #999; font-size: 13px; line-height: 1.5;">
        This link expires in ${expiresInMinutes} minutes and can only be used once. If you didn't request this, you can safely ignore this email — no one else can use the link without access to your inbox.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
      <p style="color: #bbb; font-size: 11px; text-align: center;">
        ClawNex &mdash; One nexus. Total control.<br/>
        ProBizSystems
      </p>
    </div>
  `;
  return { subject, html };
}

/** Result codes for sendMagicLinkEmail — caller decides how loudly to surface
 *  them (begin: silent for enumeration safety; admin test: verbose). */
export type SendMagicLinkResult =
  | { ok: true; sentTo: string }
  | { ok: false; code: "magic_link_disabled"; message: string }
  | { ok: false; code: "mail_not_configured"; message: string }
  | { ok: false; code: "no_email"; message: string }
  | { ok: false; code: "send_failed"; message: string };

/** Issue a magic-link email for the given operator. Centralizes the
 *  invalidate→generate→render→send pipeline so begin and the admin test
 *  endpoint never drift. Caller is responsible for upstream policy
 *  (rate-limit, no-enumeration response shaping). */
export async function sendMagicLinkEmail(opts: {
  operator: OperatorRecord;
  origin: string;
  ip?: string;
  userAgent?: string;
  testTag?: boolean;
}): Promise<SendMagicLinkResult> {
  const { operator, origin, ip, userAgent, testTag } = opts;

  // Pre-flight: each of these is a fail-fast precondition the begin endpoint
  // checks via getEffectiveConfig + the email lookup; mirroring them here so
  // the admin test endpoint can surface the precise reason a real send would
  // have silently dropped.
  if (!isEnabled()) {
    return {
      ok: false,
      code: "magic_link_disabled",
      message: "Magic Link is not enabled. Turn it on in Authentication Methods.",
    };
  }
  if (!isMailConfigured()) {
    return {
      ok: false,
      code: "mail_not_configured",
      message: "No mail provider is configured. Set up Resend / SMTP / Emailit in Mail Configuration.",
    };
  }
  if (!operator.email) {
    return {
      ok: false,
      code: "no_email",
      message: "This operator account has no email address on file. Set one in Account → Profile so magic links can be delivered.",
    };
  }

  invalidateOutstandingTokens(operator.id);
  const { rawToken, expiresAt } = generateAndStoreToken(operator.id, ip, userAgent);
  const magicUrl = `${origin}/api/auth/magic-link/complete?token=${rawToken}`;
  const expiresInMinutes = Math.max(
    1,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000),
  );
  const { subject, html } = renderMagicLinkEmail({
    operator,
    magicUrl,
    expiresInMinutes,
    testTag,
  });

  const result = await sendMail({ to: operator.email, subject, html });
  if (!result.ok) {
    return {
      ok: false,
      code: "send_failed",
      message: result.error || "Mail provider rejected the send. Check Mail Configuration.",
    };
  }
  return { ok: true, sentTo: operator.email };
}

/** Invalidate any outstanding tokens for this operator — called before
 *  issuing a new one so a spam-click doesn't leave multiple live tokens. */
export function invalidateOutstandingTokens(operatorId: string): void {
  run(
    "UPDATE magic_link_tokens SET consumed_at = datetime('now') WHERE operator_id = ? AND consumed_at IS NULL",
    [operatorId],
  );
}

/** Validate + consume a token in a single atomic step. Returns the
 *  AuthResult the login route shape expects. Failure paths collapse
 *  to a single generic code so the caller can't distinguish
 *  expired-vs-consumed-vs-unknown (prevents token enumeration). */
export function consumeToken(rawToken: string): AuthResult {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length < 10) {
    return { ok: false, failure: { error: "Invalid or expired link", code: "invalid_credentials" } };
  }

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  // Atomic mark-consumed: only succeeds if the token exists, is unconsumed,
  // and unexpired. changes() returns 1 iff the UPDATE matched a live row;
  // any other value means the token was invalid/expired/spent. This is the
  // SQLite equivalent of RETURNING without needing to upgrade the driver.
  //
  // CX-G1 fix (2026-04-26 adversarial review): expires_at is wrapped in
  // datetime() so it gets parsed as a timestamp before comparison.
  // Otherwise SQLite did a TEXT comparison between the stored ISO format
  // (`2026-04-26T15:30:00.000Z`, written by `new Date().toISOString()`)
  // and the canonical SQLite format (`2026-04-26 15:30:00`, returned by
  // `datetime('now')`). The 'T' (ASCII 0x54) sorts AFTER space (0x20) so
  // every ISO-stored expiry sorts greater than today's `datetime('now')`
  // for the entire UTC date — meaning expired tokens stayed redeemable
  // for hours past their advertised 15-minute TTL. Wrapping with
  // datetime() normalizes both sides to `YYYY-MM-DD HH:MM:SS` and makes
  // the comparison correct.
  const result = run(
    `UPDATE magic_link_tokens
     SET consumed_at = datetime('now')
     WHERE token_hash = ?
       AND consumed_at IS NULL
       AND datetime(expires_at) > datetime('now')`,
    [tokenHash],
  );

  if (!result || result.changes !== 1) {
    return { ok: false, failure: { error: "Invalid or expired link", code: "invalid_credentials" } };
  }

  // Fetch the operator — row guaranteed to exist since the UPDATE matched.
  const row = queryOne<{ operator_id: string }>(
    "SELECT operator_id FROM magic_link_tokens WHERE token_hash = ?",
    [tokenHash],
  );
  if (!row) {
    return { ok: false, failure: { error: "Invalid or expired link", code: "invalid_credentials" } };
  }

  const operator = getOperatorById(row.operator_id);
  if (!operator || operator.is_active !== 1) {
    return { ok: false, failure: { error: "Invalid or expired link", code: "user_disabled" } };
  }

  const provider: AuthProviderName = "magic_link";
  return {
    ok: true,
    data: {
      operatorId: operator.id,
      username: operator.username,
      role: operator.role as Role,
      provider,
    },
  };
}
