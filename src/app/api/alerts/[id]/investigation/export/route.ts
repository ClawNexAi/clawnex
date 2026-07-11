import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requirePermission, requireSession } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { buildInvestigationManagementSummary } from '@/lib/services/investigation-workbench';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const denied = requirePermission(auth.operator, 'reports:export');
    if (denied) return denied;
  } else {
    const blocked = requireLocalhost(request);
    if (blocked) return blocked;
  }
  const id = (await params).id;
  const report = buildInvestigationManagementSummary(id);
  if (!report) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return new NextResponse(report, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="clawnex-investigation-${safeId}.md"`,
      'Cache-Control': 'no-store',
    },
  });
}
