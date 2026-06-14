/**
 * Forgot Password — POST /api/auth/forgot-password
 *
 * Accepts { email } or { username }, generates a time-limited reset token,
 * and sends a reset link via the configured mail provider (Resend or SMTP).
 * Always returns 200 regardless of whether the email/username exists
 * (prevents user enumeration).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { queryOne, run } from '@/lib/db/index';
import { config } from '@/lib/config';
import { checkRateLimit } from '@/lib/rate-limiter';
import { sendMail, isMailConfigured } from '@/lib/services/mail-service';
import { publicOrigin } from '@/lib/services/auth';
import type { OperatorRecord } from '@/lib/rbac/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESET_EXPIRY_MINUTES = parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES || '30', 10);

const SUCCESS_MESSAGE = 'If an account with that email exists, a password reset link has been sent.';

export async function POST(request: NextRequest) {
  try {
    // M5 (DAST 2026-05-14): the RBAC-off branch previously returned
    // 403 "RBAC is not enabled" — a different info-leak with the same
    // shape as the mail-not-configured leak below. Both told an
    // unauthenticated probe something about the deployment's posture.
    // Quietly return the generic envelope so the endpoint is opaque
    // regardless of state.
    if (!config.rbac.enabled) {
      return NextResponse.json({ message: SUCCESS_MESSAGE });
    }

    // Rate limit: 3 requests per minute per IP to prevent abuse
    const ip = (request as unknown as { ip?: string }).ip || 'unknown';
    const rateLimited = checkRateLimit(`forgot-password:${ip}`, 3);
    if (!rateLimited.allowed) {
      // Return same success message to prevent enumeration via rate limit timing
      return NextResponse.json({ message: SUCCESS_MESSAGE });
    }

    // M5 (DAST 2026-05-14): the previous 503 "email is not configured"
    // told any unauthenticated probe that the deployment lacks a mail
    // provider — useful intelligence for an attacker mapping the surface.
    // The honest no-enumeration answer is the same SUCCESS_MESSAGE every
    // other branch returns. Log internally so an operator can still see
    // the misconfiguration in the journal.
    if (!isMailConfigured()) {
      console.warn('[forgot-password] mail provider not configured — silently returning success envelope');
      return NextResponse.json({ message: SUCCESS_MESSAGE });
    }

    const body = await request.json();
    const { email, username } = body as { email?: string; username?: string };

    if (!email && !username) {
      return NextResponse.json({ error: 'Email or username is required' }, { status: 400 });
    }

    // Find operator
    let operator: OperatorRecord | null = null;
    if (email) {
      operator = queryOne<OperatorRecord>(
        'SELECT * FROM operators WHERE email = ? AND is_active = 1',
        [email.trim().toLowerCase()],
      ) ?? null;
    } else if (username) {
      operator = queryOne<OperatorRecord>(
        'SELECT * FROM operators WHERE username = ? AND is_active = 1',
        [username.trim()],
      ) ?? null;
    }

    // Always return success (prevent user enumeration)
    if (!operator || !operator.email) {
      return NextResponse.json({ message: SUCCESS_MESSAGE });
    }

    // Invalidate existing reset tokens
    run('UPDATE password_reset_tokens SET used = 1 WHERE operator_id = ? AND used = 0', [operator.id]);

    // Generate reset token
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_EXPIRY_MINUTES * 60 * 1000).toISOString();

    run(
      `INSERT INTO password_reset_tokens (id, operator_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [uuid(), operator.id, tokenHash, expiresAt],
    );

    // Build reset URL
    const origin = publicOrigin(request);
    const resetUrl = `${origin}/reset-password?token=${rawToken}`;

    // Send email via configured provider
    await sendMail({
      to: operator.email,
      subject: 'Reset your ClawNex password',
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #00e5a0; font-size: 28px; margin: 0;">ClawNex</h1>
            <p style="color: #666; font-size: 14px; margin: 4px 0 0;">Password Reset</p>
          </div>
          <p style="color: #333; font-size: 15px; line-height: 1.6;">
            Hi <strong>${operator.display_name || operator.username}</strong>,
          </p>
          <p style="color: #333; font-size: 15px; line-height: 1.6;">
            A password reset was requested for your ClawNex account. Click the button below to set a new password:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background: #00e5a0; color: #000; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px;">
              Reset Password
            </a>
          </div>
          <p style="color: #999; font-size: 13px; line-height: 1.5;">
            This link expires in ${RESET_EXPIRY_MINUTES} minutes. If you didn't request this, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="color: #bbb; font-size: 11px; text-align: center;">
            ClawNex &mdash; One nexus. Total control.<br/>
            A ClawNex Project
          </p>
        </div>
      `,
    });

    return NextResponse.json({ message: SUCCESS_MESSAGE });
  } catch (err) {
    console.error('[API/auth/forgot-password] Error:', err);
    return NextResponse.json({ message: SUCCESS_MESSAGE });
  }
}
