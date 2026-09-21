import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOperatorFromRequest, isRbacEnabled, requirePermission, requireSession, validateCsrf } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { addAnythingConnector, anythingModels, executeAnythingPlan, listAnythingConnections, removeAnythingConnector, prepareAnythingPlan, refreshAnythingConnector, selectAnythingRoute, verifyAnythingConnector } from '@/lib/services/anythingllm-routing';
import { logEvent } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function guard(request: NextRequest, write = false) {
  if (!isRbacEnabled()) return requireLocalhost(request);
  const auth = requireSession(request);
  if (auth instanceof NextResponse) return auth;
  return requirePermission(auth.operator, write ? 'config:write' : 'config:read') || (write ? validateCsrf(request) : null);
}
export async function GET(request: NextRequest) {
  const denied = guard(request); if (denied) return denied;
  return NextResponse.json({ connectors: await listAnythingConnections(), models: anythingModels() });
}
const id = z.string().uuid();
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name: z.string().min(1).max(120), managementUrl: z.string().max(2048), apiKey: z.string().min(1).max(4096) }),
  z.object({ action: z.literal('refresh'), id }),
  z.object({ action: z.literal('remove'), id }),
  z.object({ action: z.literal('select'), id, key: z.string().max(100), selected: z.boolean(), model: z.string().max(500) }),
  z.object({ action: z.literal('prepare'), id, operation: z.enum(['apply', 'restore']) }),
  z.object({ action: z.literal('execute'), planId: id, approved: z.boolean() }),
  z.object({ action: z.literal('verify'), id }),
]);
export async function POST(request: NextRequest) {
  const denied = guard(request, true); if (denied) return denied;
  let body: z.infer<typeof schema>;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) throw new Error();
    body = schema.parse(JSON.parse(raw));
  } catch { return NextResponse.json({ error: 'Invalid AnythingLLM request.' }, { status: 400 }); }
  try {
    const actor = getOperatorFromRequest(request)?.username || 'localhost';
    let result: unknown;
    switch (body.action) {
      case 'add': result = await addAnythingConnector(body); break;
      case 'refresh': result = await refreshAnythingConnector(body.id); break;
      case 'remove': result = await removeAnythingConnector(body.id); break;
      case 'select': result = await selectAnythingRoute(body.id, body.key, body.selected, body.model); break;
      case 'prepare': result = await prepareAnythingPlan(body.id, body.operation); break;
      case 'execute': result = await executeAnythingPlan(body.planId, body.approved, actor); break;
      case 'verify': result = await verifyAnythingConnector(body.id); break;
    }
    logEvent('config', `anythingllm_${body.action}`, 'anythingllm', 'id' in body ? body.id : 'connector', `AnythingLLM ${body.action}`, actor);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AnythingLLM operation failed.' }, { status: 409 });
  }
}
