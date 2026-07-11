import { NextRequest, NextResponse } from 'next/server';
import { getOperatorFromRequest, isRbacEnabled, requirePermission, requireSession } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import {
  activateInvestigationExceptionDraft,
  createInvestigationExceptionDraft,
  deactivateInvestigationExceptionDraft,
  discardInvestigationExceptionDraft,
  replayInvestigationExceptionDraft,
} from '@/lib/services/investigation-workbench';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function guard(request: NextRequest, permission: 'alerts:manage' | 'shield:scan' | 'policies:write'): NextResponse | null {
  if (!isRbacEnabled()) return requireLocalhost(request);
  const auth = requireSession(request);
  if (auth instanceof NextResponse) return auth;
  return requirePermission(auth.operator, permission) || null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    const action = typeof body.action === 'string' ? body.action : 'create';
    const permission = action === 'activate' || action === 'deactivate' ? 'policies:write' : action === 'replay' ? 'shield:scan' : 'alerts:manage';
    const blocked = guard(request, permission);
    if (blocked) return blocked;
    const actor = getOperatorFromRequest(request)?.username || 'operator';
    let draft: Record<string, unknown>;
    if (action === 'create') {
      draft = createInvestigationExceptionDraft({
        alertId: (await params).id,
        targetRuleKey: typeof body.targetRuleKey === 'string' ? body.targetRuleKey : '',
        targetRuleName: typeof body.targetRuleName === 'string' ? body.targetRuleName : undefined,
        exceptionText: typeof body.exceptionText === 'string' ? body.exceptionText : '',
        direction: body.direction === 'outbound' || body.direction === 'both' ? body.direction : 'inbound',
        rationale: typeof body.rationale === 'string' ? body.rationale : '',
        actor,
      });
    } else if (action === 'replay') {
      draft = replayInvestigationExceptionDraft(String(body.draftId || ''), actor);
    } else if (action === 'activate') {
      draft = activateInvestigationExceptionDraft(String(body.draftId || ''), actor);
    } else if (action === 'deactivate') {
      draft = deactivateInvestigationExceptionDraft(String(body.draftId || ''), actor);
    } else if (action === 'discard') {
      draft = discardInvestigationExceptionDraft(String(body.draftId || ''), actor);
    } else {
      return NextResponse.json({ error: 'Unknown draft action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Draft operation failed' }, { status: 400 });
  }
}
