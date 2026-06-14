/**
 * Audit Fetch-by-ID API (Wave 1 of alert→evidence backlink hardening)
 *
 * GET /api/audit/:id
 *
 * Returns a single audit_log row by id, BYPASSING the time-window filter that
 * the parent /api/audit list endpoint applies. This is the foundation for the
 * deterministic alert → evidence deep-link: when an operator clicks "View
 * Evidence" on an alert and the linked audit row is older than the dashboard's
 * current time window, we still want to surface the exact row instead of
 * silently failing or showing a "widen the time filter" prompt that puts the
 * operator at fault.
 *
 * Response shape (success):
 *   { event: AuditRecord }
 *
 * 404 when id doesn't resolve to a row.
 *
 * RBAC:
 *   - Requires session + 'audit:read' permission when RBAC is enabled.
 *   - Falls back to localhost-only when RBAC is disabled (matches the rest of
 *     the audit-trail-adjacent routes, including /api/alerts/:id/evidence).
 *
 * Why a separate dynamic route instead of extending /api/audit?
 *   - The list endpoint applies a time-window filter via filters.since which
 *     is the exact behavior we need to bypass for this case.
 *   - The single-row contract is structurally different (no pagination, no
 *     filter dimensions) so giving it its own route keeps the list route
 *     focused.
 *   - Aligns with the existing /api/alerts/:id/evidence pattern.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { queryOne } from '@/lib/db/index';
import type { AuditRecord } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'audit:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { id } = await params;

    if (!id || typeof id !== 'string' || id.length === 0) {
      return NextResponse.json(
        { error: 'Invalid audit event id' },
        { status: 400 },
      );
    }

    // Direct id lookup — no time-window predicate. That's the whole point of
    // this endpoint: deterministic resolution for the deep-link path.
    const event = queryOne<AuditRecord>(
      'SELECT * FROM audit_log WHERE id = ?',
      [id],
    );

    if (!event) {
      return NextResponse.json(
        { error: 'Audit event not found', id },
        { status: 404 },
      );
    }

    return NextResponse.json({
      event,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/audit/:id] GET Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
