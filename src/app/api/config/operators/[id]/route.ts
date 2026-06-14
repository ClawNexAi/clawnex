/**
 * Operator Management — PATCH/DELETE /api/config/operators/[id]
 *
 * PATCH  — update operator (role, display_name, email, is_active, password, unlock)
 * DELETE — remove operator (hard delete)
 *
 * Both require operators:manage permission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { queryOne, run, transaction } from '@/lib/db/index';
import { changePassword } from '@/lib/services/operator-service';
import { logEvent } from '@/lib/services/audit-logger';
import type { Role } from '@/lib/rbac/types';

/** Check if the given operator is the last active admin. */
function isLastAdmin(excludeId: string): boolean {
  const row = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM operators WHERE role = 'admin' AND is_active = 1 AND id != ?",
    [excludeId],
  );
  return (row?.count ?? 0) === 0;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ROLES: Role[] = ['admin', 'security_manager', 'operator', 'viewer', 'auditor'];

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (!isRbacEnabled()) {
      return NextResponse.json({ error: 'RBAC is not enabled' }, { status: 403 });
    }

    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;

    const perm = requirePermission(auth.operator, 'operators:manage');
    if (perm) return perm;

    const id = (await context.params).id;
    const body = await request.json();
    const { role, display_name, email, is_active, password, unlock } = body as {
      role?: string;
      display_name?: string;
      email?: string;
      is_active?: boolean;
      password?: string;
      unlock?: boolean;
    };

    // Wrap all checks + mutations in a transaction to prevent TOCTOU races
    // (e.g. two concurrent admin demotions both passing isLastAdmin)
    const txResult = transaction(() => {
      const existing = queryOne<{ id: string; role: string; username: string }>(
        'SELECT id, role, username FROM operators WHERE id = ?', [id],
      );
      if (!existing) return { error: 'Operator not found', status: 404 };

      // Last-admin invariant: prevent demoting the last active admin
      if (existing.role === 'admin' && role !== undefined && role !== 'admin') {
        if (isLastAdmin(id)) return { error: 'Cannot demote the last active admin', status: 400 };
      }
      // Last-admin invariant: prevent deactivating the last active admin
      if (existing.role === 'admin' && is_active === false) {
        if (isLastAdmin(id)) return { error: 'Cannot deactivate the last active admin', status: 400 };
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      let roleChangedFrom: string | null = null;

      if (role !== undefined && VALID_ROLES.includes(role as Role)) {
        updates.push('role = ?');
        values.push(role);
        if (role !== existing.role) {
          roleChangedFrom = existing.role;
        }
      }
      if (display_name !== undefined) {
        updates.push('display_name = ?');
        values.push(display_name.trim() || null);
      }
      if (email !== undefined) {
        updates.push('email = ?');
        values.push(email.trim() || null);
      }
      if (is_active !== undefined) {
        updates.push('is_active = ?');
        values.push(is_active ? 1 : 0);
      }
      if (unlock) {
        updates.push('failed_login_count = 0');
        updates.push('is_active = 1');
      }
      if (password && typeof password === 'string' && password.length >= 8) {
        changePassword(id, password);
        run('DELETE FROM operator_sessions WHERE operator_id = ?', [id]);
      }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')");
        values.push(id);
        run(`UPDATE operators SET ${updates.join(', ')} WHERE id = ?`, values);
      }

      return { ok: true, username: existing.username, roleChangedFrom };
    });

    if ('error' in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status });
    }
    const existing = txResult;

    // Audit trail
    const currentOp = getOperatorFromRequest(request);
    const changes: string[] = [];
    if (role !== undefined) changes.push(`role → ${role}`);
    if (display_name !== undefined) changes.push(`display_name → ${display_name || '(cleared)'}`);
    if (email !== undefined) changes.push(`email → ${email || '(cleared)'}`);
    if (is_active !== undefined) changes.push(`is_active → ${is_active}`);
    if (unlock) changes.push('unlocked');
    if (password) changes.push('password reset');
    logEvent(
      currentOp?.username || 'admin', 'operator_updated', 'operator', id,
      `Updated operator ${existing.username}: ${changes.join(', ')}`, 'dashboard',
    );

    // Dedicated role-change audit event (SOC 2 CC6.3 — privilege change tracking).
    // Emitted in addition to `operator_updated` so role transitions are queryable
    // directly from the audit log without parsing the free-text detail field.
    if (existing.roleChangedFrom && role !== undefined && role !== existing.roleChangedFrom) {
      logEvent(
        currentOp?.username || 'admin', 'operator_role_changed', 'operator', id,
        `${existing.roleChangedFrom} → ${role}`, 'dashboard',
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[API/config/operators/[id]] PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (!isRbacEnabled()) {
      return NextResponse.json({ error: 'RBAC is not enabled' }, { status: 403 });
    }

    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;

    const perm = requirePermission(auth.operator, 'operators:manage');
    if (perm) return perm;

    const id = (await context.params).id;

    if (id === auth.operator.id) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
    }

    // Wrap check + delete in a transaction to prevent TOCTOU race
    const txResult = transaction(() => {
      const existing = queryOne<{ id: string; role: string; username: string }>(
        'SELECT id, role, username FROM operators WHERE id = ?', [id],
      );
      if (!existing) return { error: 'Operator not found', status: 404 };

      if (existing.role === 'admin' && isLastAdmin(id)) {
        return { error: 'Cannot remove the last active admin', status: 400 };
      }

      run('DELETE FROM operator_sessions WHERE operator_id = ?', [id]);
      run('DELETE FROM operators WHERE id = ?', [id]);
      return { ok: true, username: existing.username };
    });

    if ('error' in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status });
    }

    // Audit trail
    const currentOp = getOperatorFromRequest(request);
    logEvent(
      currentOp?.username || 'admin', 'operator_deleted', 'operator', id,
      `Deleted operator "${txResult.username}"`, 'dashboard',
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[API/config/operators/[id]] DELETE error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
