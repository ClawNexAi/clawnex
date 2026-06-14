/**
 * Alert Detail API
 * PATCH /api/alerts/:id — transition an alert through its workflow
 *
 * Body: { action: "acknowledge" | "investigate" | "resolve", by?: "username" }
 *
 * Workflow semantics:
 *   - acknowledge  → status=acknowledged    "I'm aware, I'll handle it"
 *   - investigate  → status=investigating   "I'm actively diagnosing root cause"
 *   - resolve      → status=resolved        "I'm done, closed out"
 *
 * acknowledged_by carries the operator identity for both ack + investigate
 * so the audit trail captures who picked up the work.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { acknowledgeAlert, markInvestigating, resolveAlert } from '@/lib/services/alert-manager';
import { logEvent } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'alerts:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { action, by } = body as { action?: string; by?: string };

    if (!action || !['acknowledge', 'investigate', 'resolve'].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'acknowledge', 'investigate', or 'resolve'" },
        { status: 400 },
      );
    }

    let result;
    if (action === 'acknowledge') {
      result = acknowledgeAlert(id, by || 'unknown');
      if (result) {
        logEvent(by || 'unknown', 'alert_acknowledged', 'alert', id, undefined, 'api');
      }
    } else if (action === 'investigate') {
      // v0.8.4+: distinct status from acknowledged. Operator has actively
      // started root-cause diagnosis (versus ack which is just "I'm aware").
      result = markInvestigating(id, by || 'unknown');
      if (result) {
        logEvent(by || 'unknown', 'alert_investigating', 'alert', id, undefined, 'api');
      }
    } else {
      result = resolveAlert(id);
      if (result) {
        logEvent('api', 'alert_resolved', 'alert', id, undefined, 'api');
      }
    }

    if (!result) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    return NextResponse.json({ alert: result, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[API/alerts/:id] PATCH Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
