import { NextRequest, NextResponse } from 'next/server';
import { getOperatorFromRequest, isRbacEnabled, requirePermission, requireSession } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { revealForensicPayload } from '@/lib/services/investigation-capture';
import { getInvestigationWorkbench } from '@/lib/services/investigation-workbench';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const denied = requirePermission(auth.operator, 'evidence:raw');
    if (denied) return denied;
  } else {
    const blocked = requireLocalhost(request);
    if (blocked) return blocked;
  }
  const body = await request.json().catch(() => ({}));
  const auditEventId = typeof body.auditEventId === 'string' ? body.auditEventId : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!auditEventId) return NextResponse.json({ error: 'auditEventId is required' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'A reason is required to reveal forensic evidence' }, { status: 400 });
  if (reason.length > 500) return NextResponse.json({ error: 'Reason must be 500 characters or fewer' }, { status: 400 });
  const workbench = getInvestigationWorkbench((await params).id) as { payloads?: Array<{ audit_event_id?: string }> } | null;
  if (!workbench) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  if (!(workbench.payloads || []).some((payload) => payload.audit_event_id === auditEventId)) {
    return NextResponse.json({ error: 'Forensic evidence is not linked to this alert' }, { status: 404 });
  }
  try {
    const actor = getOperatorFromRequest(request)?.username || 'operator';
    const payload = revealForensicPayload(auditEventId, actor, reason);
    if (!payload) return NextResponse.json({ error: 'Forensic payload is unavailable or expired' }, { status: 404 });
    return NextResponse.json({ payload }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reveal evidence';
    return NextResponse.json({ error: message }, { status: message.includes('audit is unavailable') ? 503 : 409 });
  }
}
