/**
 * Workspace API
 * GET /api/workspace — list workspace files with summary
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { listWorkspaceFiles, getWorkspaceSummary, listHermesFiles, getHermesSummary } from '@/lib/services/workspace-reader';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'workspace:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const instance = searchParams.get('instance') || '';

    if (instance === 'hermes-local') {
      const summary = getHermesSummary();
      const files = listHermesFiles();
      return NextResponse.json({ ...summary, files });
    }

    const agent = searchParams.get('agent') || undefined;
    const summary = getWorkspaceSummary(agent);
    const files = listWorkspaceFiles(agent);

    return NextResponse.json({
      ...summary,
      files,
    });
  } catch (err) {
    console.error('[API /workspace] Error:', err);
    return NextResponse.json({ error: 'Failed to read workspace' }, { status: 500 });
  }
}
