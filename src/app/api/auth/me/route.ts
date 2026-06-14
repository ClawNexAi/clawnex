/**
 * Auth Me — GET /api/auth/me
 *
 * Returns the current operator's identity and permissions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/rbac/guard';
import { getPermissions } from '@/lib/rbac/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const result = requireSession(request);

    // If result is a NextResponse, it's a 401
    if (result instanceof NextResponse) {
      return result;
    }

    const { operator } = result;
    const permissions = getPermissions(operator.role);

    return NextResponse.json({
      id: operator.id,
      username: operator.username,
      displayName: operator.displayName,
      role: operator.role,
      permissions,
    });
  } catch (err) {
    console.error('[API/auth/me] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
