import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requirePermission, requireSession, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import {
  getInvestigationCapturePolicy,
  updateInvestigationCapturePolicy,
  type InvestigationCaptureMode,
} from '@/lib/services/investigation-capture';
import { logEvent } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function guard(request: NextRequest, permission: 'config:read' | 'config:write'): NextResponse | null {
  if (!isRbacEnabled()) return requireLocalhost(request);
  const auth = requireSession(request);
  if (auth instanceof NextResponse) return auth;
  return requirePermission(auth.operator, permission) || null;
}

export async function GET(request: NextRequest) {
  const blocked = guard(request, 'config:read');
  if (blocked) return blocked;
  return NextResponse.json({ policy: getInvestigationCapturePolicy() });
}

export async function PUT(request: NextRequest) {
  const blocked = guard(request, 'config:write');
  if (blocked) return blocked;
  try {
    const body = await request.json();
    const mode = body.mode as InvestigationCaptureMode;
    const redactedLimit = Number(body.redactedLimit);
    const forensicRetentionHours = Number(body.forensicRetentionHours);
    const relatedWindowMinutes = Number(body.relatedWindowMinutes);
    if (!['metadata', 'redacted', 'forensic'].includes(mode)) {
      return NextResponse.json({ error: 'mode must be metadata, redacted, or forensic' }, { status: 400 });
    }
    if (![redactedLimit, forensicRetentionHours, relatedWindowMinutes].every(Number.isFinite)) {
      return NextResponse.json({ error: 'capture limits must be numbers' }, { status: 400 });
    }
    const policy = updateInvestigationCapturePolicy({
      mode,
      redactedLimit,
      forensicRetentionHours,
      relatedWindowMinutes,
    });
    const actor = getOperatorFromRequest(request)?.username || 'operator';
    logEvent(actor, 'investigation_capture_policy_updated', 'config', 'investigation-capture', JSON.stringify(policy), 'dashboard');
    return NextResponse.json({ ok: true, policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update capture policy';
    return NextResponse.json({ error: message }, { status: message.includes('requires') ? 409 : 400 });
  }
}
