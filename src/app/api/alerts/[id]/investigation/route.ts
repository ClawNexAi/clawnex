import { NextRequest, NextResponse } from 'next/server';
import { getOperatorFromRequest, isRbacEnabled, requirePermission, requireSession } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { hasPermission } from '@/lib/rbac/permissions';
import {
  getInvestigationWorkbench,
  recordInvestigationDecision,
  type InvestigationDisposition,
} from '@/lib/services/investigation-workbench';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function guard(request: NextRequest, permission: 'audit:read' | 'alerts:manage'): NextResponse | null {
  if (!isRbacEnabled()) return requireLocalhost(request);
  const auth = requireSession(request);
  if (auth instanceof NextResponse) return auth;
  return requirePermission(auth.operator, permission) || null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guard(request, 'audit:read');
  if (blocked) return blocked;
  const workbench = getInvestigationWorkbench((await params).id);
  if (!workbench) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  const operator = getOperatorFromRequest(request);
  const rbacEnabled = isRbacEnabled();
  const can = (permission: Parameters<typeof hasPermission>[1]) => !rbacEnabled || Boolean(operator && hasPermission(operator.role, permission));
  return NextResponse.json({
    workbench: {
      ...workbench,
      capabilities: {
        manage_alerts: can('alerts:manage'),
        manage_exceptions: can('policies:write'),
        replay_exceptions: can('shield:scan'),
        reveal_forensic: can('evidence:raw'),
      },
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guard(request, 'alerts:manage');
  if (blocked) return blocked;
  try {
    const body = await request.json();
    const disposition = body.disposition as InvestigationDisposition;
    if (!['true_positive', 'false_positive', 'expected_activity', 'needs_more_evidence', 'escalated'].includes(disposition)) {
      return NextResponse.json({ error: 'Invalid disposition' }, { status: 400 });
    }
    const actor = getOperatorFromRequest(request)?.username || 'operator';
    const investigation = recordInvestigationDecision({
      alertId: (await params).id,
      disposition,
      rationale: typeof body.rationale === 'string' ? body.rationale : '',
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      actor,
    });
    return NextResponse.json({ ok: true, investigation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Decision failed' }, { status: 400 });
  }
}
