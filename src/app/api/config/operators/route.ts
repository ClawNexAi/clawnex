/**
 * Operator Management — GET/POST /api/config/operators
 *
 * GET  — list all operators (requires operators:manage permission)
 * POST — create a new operator (requires operators:manage permission)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { queryAll, queryOne, run } from '@/lib/db/index';
import { createOperator, getOperatorByUsername } from '@/lib/services/operator-service';
import { logEvent } from '@/lib/services/audit-logger';
import type { Role } from '@/lib/rbac/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ROLES: Role[] = ['admin', 'security_manager', 'operator', 'viewer', 'auditor'];

export async function GET(request: NextRequest) {
  try {
    if (!isRbacEnabled()) {
      return NextResponse.json({ error: 'RBAC is not enabled' }, { status: 403 });
    }

    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;

    const perm = requirePermission(auth.operator, 'operators:manage');
    if (perm) return perm;

    const operators = queryAll<{
      id: string;
      username: string;
      display_name: string | null;
      email: string | null;
      role: string;
      is_active: number;
      last_login_at: string | null;
      login_count: number;
      failed_login_count: number;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, username, display_name, email, role, is_active, last_login_at,
              login_count, failed_login_count, created_at, updated_at
       FROM operators ORDER BY created_at ASC`,
    );

    return NextResponse.json({ operators });
  } catch (err) {
    console.error('[API/config/operators] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isRbacEnabled()) {
      return NextResponse.json({ error: 'RBAC is not enabled' }, { status: 403 });
    }

    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;

    const perm = requirePermission(auth.operator, 'operators:manage');
    if (perm) return perm;

    const body = await request.json();
    const { username, password, role, display_name, email } = body as {
      username?: string;
      password?: string;
      role?: string;
      display_name?: string;
      email?: string;
    };

    if (!username || !password) {
      return NextResponse.json({ error: 'username and password are required' }, { status: 400 });
    }

    if (username.length < 2 || username.length > 64) {
      return NextResponse.json({ error: 'Username must be 2-64 characters' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    if (role && !VALID_ROLES.includes(role as Role)) {
      return NextResponse.json({ error: `Invalid role. Valid: ${VALID_ROLES.join(', ')}` }, { status: 400 });
    }

    // Check for duplicate username
    const existing = getOperatorByUsername(username.trim());
    if (existing) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    }

    // Use the operator service — bcrypt hashing, same as setup page
    const operator = createOperator(
      username.trim(),
      password,
      (role as Role) || 'viewer',
      auth.operator.id,
    );

    // Set optional fields not handled by createOperator. PATCH route already
    // accepts display_name + email; previously POST silently dropped display_name,
    // making create/edit behavior diverge (operators looked nameless until an
    // admin re-edited them via PATCH).
    if (email?.trim()) {
      run('UPDATE operators SET email = ? WHERE id = ?', [email.trim(), operator.id]);
    }
    if (display_name?.trim()) {
      run('UPDATE operators SET display_name = ? WHERE id = ?', [display_name.trim(), operator.id]);
    }

    // Audit trail
    const currentOp = getOperatorFromRequest(request);
    logEvent(
      currentOp?.username || 'admin', 'operator_created', 'operator', operator.id,
      `Created operator "${operator.username}" with role ${(role as string) || 'viewer'}`, 'dashboard',
    );

    return NextResponse.json({ ok: true, id: operator.id, username: operator.username }, { status: 201 });
  } catch (err) {
    console.error('[API/config/operators] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
