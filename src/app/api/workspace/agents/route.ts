/**
 * Workspace Agents API
 * GET /api/workspace/agents — list agent files with registry data
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getAgentFilesWithRegistry, getAgentRegistry, getHermesAgents } from '@/lib/services/workspace-reader';

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
      const agents = getHermesAgents();
      return NextResponse.json({ agents, registry: [], count: agents.length });
    }

    const agents = getAgentFilesWithRegistry();
    const registry = getAgentRegistry();

    return NextResponse.json({
      agents,
      registry: registry?.agents || [],
      count: agents.length,
    });
  } catch (err) {
    console.error('[API /workspace/agents] Error:', err);
    return NextResponse.json({ error: 'Failed to read agent files' }, { status: 500 });
  }
}
