import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getPolicy, listRulesForPolicy, updatePolicy, deletePolicy } from '@/lib/db/policy-store';
import { audit } from '@/lib/services/policy-audit';
import type { PolicyLifecycle } from '@/lib/shield/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DISABLE_PHRASES: Record<string, string> = {
  'ClawNex Default': 'disable clawnex default protection',
  'Generic Egress Starter': 'disable generic egress starter',
};

// internal reviewer Round 3 BLOCKER (2026-05-03) — strict-type validation at the API
// boundary. Operator-supplied JSON is untrusted; without strict-type
// rejection, JS coercion (e.g. `0 ? 1 : 0`, `0 === false → false`) opened
// holes in the Gate-5 vendor lockdown and audit completeness fixes. This
// helper returns a 400 naming the bad field + expected type rather than
// silently coercing — the rest of this route trusts shapes after the
// validation block.
function badType(field: string, expected: string, got: unknown): NextResponse {
  return NextResponse.json({
    error: `field "${field}" must be ${expected}; got ${typeof got === 'object' ? JSON.stringify(got) : typeof got}`,
  }, { status: 400 });
}

// Constrain lifecycle to the PolicyLifecycle union so operators cannot
// invent values the UI/evaluator does not recognize. The schema layer
// alone allows arbitrary strings — this is the API-edge enforcement.
const ALLOWED_LIFECYCLE = new Set(['draft', 'lab', 'starter', 'strict', 'custom']);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'policies:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }
  const policy = getPolicy((await params).id);
  if (!policy) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const rules = listRulesForPolicy(policy.id);
  return NextResponse.json({ policy, rules });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const policy = getPolicy((await params).id);
  if (!policy) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  // ========================================================================
  // internal reviewer Round 3 BLOCKER (2026-05-03) — type-confusion class fix.
  //
  // Validate every operator-supplied field BEFORE any business logic. The
  // Gate-5 vendor lockdown (`body.enabled === false`) and audit completeness
  // (`changes.enabled === false`) blocks both rely on strict booleans;
  // without this guard, `{ "enabled": 0 }` bypassed both because
  // `0 !== false` and `0 ? 1 : 0` persists as disabled — a clean
  // disable-without-typed-phrase + silent-mutation chain internal reviewer demonstrated.
  //
  // Type checks fire FIRST (before the vendor-field allow-list) so the
  // vendor guard sees a body it can trust to have correct shapes.
  // ========================================================================
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
  }
  if ('enabled' in body && typeof body.enabled !== 'boolean') return badType('enabled', 'a boolean', body.enabled);
  if ('name' in body && (typeof body.name !== 'string' || !body.name.trim())) return badType('name', 'a non-empty string', body.name);
  if ('description' in body && body.description !== null && typeof body.description !== 'string') return badType('description', 'a string or null', body.description);
  if ('lifecycle' in body && body.lifecycle !== null && (typeof body.lifecycle !== 'string' || !ALLOWED_LIFECYCLE.has(body.lifecycle))) {
    return NextResponse.json({
      error: `field "lifecycle" must be one of "draft" | "lab" | "starter" | "strict" | "custom" or null; got ${JSON.stringify(body.lifecycle)}`,
    }, { status: 400 });
  }
  if ('confirm_phrase' in body && typeof body.confirm_phrase !== 'string') return badType('confirm_phrase', 'a string', body.confirm_phrase);
  if ('reason' in body && typeof body.reason !== 'string') return badType('reason', 'a string', body.reason);

  const wantsDisable = body.enabled === false && policy.enabled;
  const isVendorPolicy = policy.source === 'curated' || policy.source === 'system';

  // ========================================================================
  // internal reviewer Gate-5 BLOCKER 1 (2026-05-03) — vendor-policy PATCH lockdown.
  //
  // Vendor (curated/system) policies are read-only via this API except for
  // the carefully-guarded enable/disable transition. Auxiliary fields
  // confirm_phrase + reason are accepted because they accompany the disable
  // variant. Anything else returns 403 — operators must clone to a custom
  // policy to extend.
  //
  // Without this guard, an attacker could rename Generic Egress Starter,
  // then disable the renamed policy with empty confirm_phrase because
  // DISABLE_PHRASES[name] returned undefined and the
  // (expectedPhrase || '') comparison treated empty confirm_phrase as a
  // match. The guard fires BEFORE typed-phrase logic so the
  // rename-then-bypass attack has no structural foothold.
  // ========================================================================
  if (isVendorPolicy) {
    const allowedVendorFields = new Set(['enabled', 'confirm_phrase', 'reason']);
    const disallowed = Object.keys(body).filter(k => !allowedVendorFields.has(k));
    if (disallowed.length > 0) {
      return NextResponse.json({
        error: `cannot edit ${disallowed.join(', ')} on a vendor-shipped policy; only 'enabled' (with confirm_phrase + reason) is permitted. Clone to a custom policy to extend.`,
      }, { status: 403 });
    }
  }

  if (wantsDisable && isVendorPolicy) {
    const expectedPhrase = DISABLE_PHRASES[policy.name];
    if (!expectedPhrase) {
      // Fail closed — vendor policies without a registered disable phrase
      // cannot be disabled via API. Add the policy name to DISABLE_PHRASES
      // in source code first (git-reviewed). Prior behavior fell through
      // to an empty-string match, which combined with BLOCKER-1's missing
      // rename guard produced a full disable bypass.
      return NextResponse.json({
        error: 'this vendor policy has no registered disable phrase; disable is not permitted via API',
      }, { status: 403 });
    }
    const phraseMatched = typeof body.confirm_phrase === 'string' &&
                          body.confirm_phrase.trim().toLowerCase() === expectedPhrase.toLowerCase();
    if (!phraseMatched) {
      return NextResponse.json({
        error: 'disabling a vendor-shipped policy requires confirm_phrase',
        expected_phrase: expectedPhrase,
      }, { status: 400 });
    }
    if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
      return NextResponse.json({ error: 'reason is required (min 10 chars)' }, { status: 400 });
    }
    // (audit emission moved to the unified post-update block below per
    // BLOCKER-2 fix — keeps "what actually changed in DB" as the single
    // source of truth for audit rows.)
  }

  // ========================================================================
  // internal reviewer Gate-5 BLOCKER 2 (2026-05-03) — audit-completeness fix.
  //
  // Compute the set of fields ACTUALLY changing by diffing body against
  // current policy state, BEFORE calling updatePolicy. Audit rows then
  // emit based on what actually changed, not on which keys were in the
  // body. Prior behavior fired audit only when name/description was in
  // the body, missing custom enabled=false, lifecycle-only changes, and
  // any patch that mutated state without including name/description.
  // ========================================================================
  const changes: {
    enabled?: boolean;
    name?: string;
    description?: string | null;
    lifecycle?: PolicyLifecycle | null;
  } = {};
  if (body.enabled !== undefined && body.enabled !== policy.enabled) {
    changes.enabled = body.enabled;
  }
  if (body.name !== undefined && body.name !== policy.name) {
    changes.name = body.name;
  }
  if (body.description !== undefined && body.description !== policy.description) {
    changes.description = body.description;
  }
  if (body.lifecycle !== undefined && body.lifecycle !== policy.lifecycle && policy.source === 'custom') {
    changes.lifecycle = body.lifecycle;
  }

  const updated = updatePolicy((await params).id, {
    name: body.name ?? policy.name,
    description: body.description ?? policy.description,
    enabled: body.enabled ?? policy.enabled,
    lifecycle: policy.source === 'custom' ? (body.lifecycle ?? policy.lifecycle) : policy.lifecycle,
    version: policy.version,
  });

  // Audit every persisted mutation. confirm_phrase is NEVER logged — only
  // confirm_phrase_matched: true + reason for vendor disable.
  if (changes.enabled === false) {
    audit('policy_disable', {
      policy_id: policy.id,
      name: policy.name,
      source: policy.source,
      lifecycle: policy.lifecycle,
      ...(isVendorPolicy ? { confirm_phrase_matched: true, reason: (body.reason as string).trim() } : {}),
    }, actor);
  } else if (changes.enabled === true) {
    audit('policy_enable', {
      policy_id: policy.id,
      name: policy.name,
      source: policy.source,
    }, actor);
  }

  const nonEnabledChanges = (['name', 'description', 'lifecycle'] as const).filter(k => changes[k] !== undefined);
  if (nonEnabledChanges.length > 0) {
    audit('policy_edit', {
      policy_id: policy.id,
      name: updated?.name,
      source: policy.source,
      fields_changed: nonEnabledChanges,
    }, actor);
  }

  return NextResponse.json({ policy: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const policy = getPolicy((await params).id);
  if (!policy) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (policy.source !== 'custom') {
    return NextResponse.json({ error: 'cannot delete a vendor-shipped policy' }, { status: 403 });
  }

  deletePolicy((await params).id);
  audit('policy_delete', { policy_id: policy.id, name: policy.name, source: policy.source }, actor);
  return NextResponse.json({ ok: true });
}
