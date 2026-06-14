/**
 * Reset Password — POST /api/auth/reset-password
 *
 * Accepts { token, password }, validates the reset token,
 * changes the password, and revokes all existing sessions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { queryOne, run } from '@/lib/db/index';
import { changePassword } from '@/lib/services/operator-service';
import { logEvent } from '@/lib/services/audit-logger';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    if (!config.rbac.enabled) {
      return NextResponse.json({ error: 'RBAC is not enabled' }, { status: 403 });
    }

    const body = await request.json();
    const { token, password } = body as { token?: string; password?: string };

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and new password are required' },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 },
      );
    }

    // Hash the token to look up in DB
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Find the reset token
    const resetRecord = queryOne<{
      id: string;
      operator_id: string;
      expires_at: string;
      used: number;
    }>(
      'SELECT id, operator_id, expires_at, used FROM password_reset_tokens WHERE token_hash = ?',
      [tokenHash],
    );

    if (!resetRecord) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link' },
        { status: 400 },
      );
    }

    if (resetRecord.used) {
      return NextResponse.json(
        { error: 'This reset link has already been used' },
        { status: 400 },
      );
    }

    if (new Date(resetRecord.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This reset link has expired. Please request a new one.' },
        { status: 400 },
      );
    }

    // Get operator info for audit (include is_active and failed_login_count for admin-disable check)
    const operator = queryOne<{ id: string; username: string; is_active: number; failed_login_count: number }>(
      'SELECT id, username, is_active, failed_login_count FROM operators WHERE id = ?',
      [resetRecord.operator_id],
    );

    if (!operator) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link' },
        { status: 400 },
      );
    }

    // Change password
    changePassword(operator.id, password);

    // Mark token as used
    run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetRecord.id]);

    // Revoke all sessions — force re-login with new password
    run('DELETE FROM operator_sessions WHERE operator_id = ?', [operator.id]);

    // Reset failed login counter — but don't re-enable admin-disabled accounts
    if (operator.is_active === 0 && operator.failed_login_count < 20) {
      // Admin-disabled account — reset password but keep disabled
      run(
        "UPDATE operators SET failed_login_count = 0, updated_at = datetime('now') WHERE id = ?",
        [operator.id],
      );
    } else {
      // Auto-disabled or active account — reset everything
      run(
        "UPDATE operators SET failed_login_count = 0, is_active = 1, updated_at = datetime('now') WHERE id = ?",
        [operator.id],
      );
    }

    // Audit trail
    logEvent(
      operator.username, 'password_reset_completed', 'operator', operator.id,
      'Password reset via email link', 'auth',
    );

    return NextResponse.json({ ok: true, message: 'Password has been reset. You can now log in.' });
  } catch (err) {
    console.error('[API/auth/reset-password] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
