/**
 * Workspace File API
 * GET /api/workspace/file?path=SOUL.md — read a specific workspace file
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { readWorkspaceFile, readHermesFile } from '@/lib/services/workspace-reader';
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
    const filePath = searchParams.get('path');
    const instance = searchParams.get('instance') || '';

    if (!filePath) {
      return NextResponse.json({ error: 'Missing "path" query parameter' }, { status: 400 });
    }

    const agent = searchParams.get('agent') || undefined;
    const result = instance === 'hermes-local'
      ? readHermesFile(filePath)
      : readWorkspaceFile(filePath, agent);

    if (!result) {
      return NextResponse.json({ error: 'File not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({
      file: result.info,
      content: result.content,
    });
  } catch (err) {
    console.error('[API /workspace/file] Error:', err);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
