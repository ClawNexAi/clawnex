import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { listPolicies, countRulesForPolicy, createPolicy, getPolicyByName } from '@/lib/db/policy-store';
import { audit } from '@/lib/services/policy-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'policies:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const policies = listPolicies().map(p => ({ ...p, rule_count: countRulesForPolicy(p.id) }));
  return NextResponse.json({ policies });
}

export async function POST(request: NextRequest) {
  let actor = 'localhost';
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'policies:write');
    if (perm) return perm;
    actor = auth.operator.id;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (getPolicyByName(body.name)) {
    return NextResponse.json({ error: 'a policy with that name already exists' }, { status: 409 });
  }

  const policy = createPolicy({
    name: body.name,
    description: body.description || null,
    enabled: body.enabled !== false,
    source: 'custom',
    lifecycle: 'custom',
    version: null,
    created_by: actor,
  });

  audit('policy_create', {
    policy_id: policy.id,
    name: policy.name,
    source: 'custom',
    lifecycle: 'custom',
  }, actor);

  return NextResponse.json({ policy }, { status: 201 });
}
