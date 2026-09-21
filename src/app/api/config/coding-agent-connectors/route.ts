import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requirePermission, requireSession } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { queryAll, queryOne, run } from '@/lib/db';
import { logEvent } from '@/lib/services/audit-logger';
import { resolveOpenCodeGlobalConfig, type CodingAgentConnectorType } from '@/lib/services/coding-agent-connectors';
import { hasOpenCodeRoutingOwnership } from '@/lib/services/opencode-routing';
import { nativeConfigCheck, isNativeAgent } from '@/lib/services/native-agent-config';
import { hasNativeOwnership } from '@/lib/services/native-agent-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ConnectorRow {
  id: string;
  type: CodingAgentConnectorType;
  name: string;
  config_path: string;
  is_active: number;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function guard(request: NextRequest, permission: 'config:read' | 'config:write'): NextResponse | null {
  if (!isRbacEnabled()) return requireLocalhost(request);
  const auth = requireSession(request);
  if (auth instanceof NextResponse) return auth;
  return requirePermission(auth.operator, permission);
}

function serialize(row: ConnectorRow) {
  const check = row.type === 'opencode' ? resolveOpenCodeGlobalConfig() : isNativeAgent(row.type) ? nativeConfigCheck(row.type) : { available: false, configPath: row.config_path, error: 'Unsupported connector type.' };
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    configPath: check.configPath,
    active: row.is_active === 1,
    status: check.available ? 'connected' : 'error',
    available: check.available,
    error: check.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const denied = guard(request, 'config:read');
  if (denied) return denied;
  const connectors = queryAll<ConnectorRow>('SELECT * FROM coding_agent_connectors ORDER BY created_at ASC').map(serialize);
  return NextResponse.json({ connectors, total: connectors.length });
}

export async function POST(request: NextRequest) {
  const denied = guard(request, 'config:write');
  if (denied) return denied;
  try {
    const body = await request.json() as { type?: unknown; name?: unknown };
    if (body.type !== 'opencode' && !isNativeAgent(body.type)) return NextResponse.json({ error: 'Unsupported coding-agent connector type.' }, { status: 400 });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Connector name is required.' }, { status: 400 });
    const check = body.type === 'opencode' ? resolveOpenCodeGlobalConfig() : nativeConfigCheck(body.type);
    const existing = queryOne<ConnectorRow>('SELECT * FROM coding_agent_connectors WHERE type = ?', [body.type]);
    if (existing) return NextResponse.json({ error: 'This global connector already exists.', connector: serialize(existing) }, { status: 409 });
    const id = `coding-agent-${randomUUID()}`;
    run(`INSERT INTO coding_agent_connectors (id, type, name, config_path, status, last_error)
      VALUES (?, ?, ?, ?, ?, ?)`, [id, body.type, name, check.configPath, check.available ? 'connected' : 'error', check.error]);
    const row = queryOne<ConnectorRow>('SELECT * FROM coding_agent_connectors WHERE id = ?', [id])!;
    logEvent('operator', 'coding_agent_connector_added', body.type, 'dashboard', `Added global ${body.type} connector "${name}".`);
    return NextResponse.json({ ok: true, connector: serialize(row) }, { status: 201 });
  } catch (error) {
    console.error('[API/coding-agent-connectors] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const denied = guard(request, 'config:write');
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id parameter.' }, { status: 400 });
  const existing = queryOne<ConnectorRow>('SELECT * FROM coding_agent_connectors WHERE id = ?', [id]);
  if (!existing) return NextResponse.json({ error: 'Connector not found.' }, { status: 404 });
  try {
    if (existing.type === 'opencode' ? hasOpenCodeRoutingOwnership() : isNativeAgent(existing.type) && hasNativeOwnership(existing.type)) {
      return NextResponse.json({ error: 'Restore the direct connection before removing this connector.' }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: 'Routing ownership cannot be read. Recover it before removing this connector.' }, { status: 409 });
  }
  run('DELETE FROM coding_agent_connectors WHERE id = ?', [id]);
  logEvent('operator', 'coding_agent_connector_removed', existing.type, 'dashboard', `Removed coding-agent connector "${existing.name}".`);
  return NextResponse.json({ ok: true, id });
}
