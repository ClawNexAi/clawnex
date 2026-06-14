import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getPolicy, listRulesForPolicy, createRule } from '@/lib/db/policy-store';
import { checkRegexSafety } from '@/lib/shield/safe-regex';
import { RULE_KEY_FORMAT } from '@/lib/shield/redaction';
import { audit } from '@/lib/services/policy-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// internal reviewer Round 3 BLOCKER (2026-05-03) — strict-type validation at the API
// boundary. See sibling /[id]/route.ts header comment for the full
// rationale. Inline copy (vs shared helper) keeps each route file
// self-contained for v1.
function badType(field: string, expected: string, got: unknown): NextResponse {
  return NextResponse.json({
    error: `field "${field}" must be ${expected}; got ${typeof got === 'object' ? JSON.stringify(got) : typeof got}`,
  }, { status: 400 });
}

const ALLOWED_SEVERITY = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const ALLOWED_ACTION = new Set(['score', 'block', 'review', 'redact', 'allow']);

function slugify(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

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
  return NextResponse.json({ rules: listRulesForPolicy(policy.id) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: 'cannot add rules to a vendor-shipped policy; clone to a custom policy first' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
  }

  // ========================================================================
  // internal reviewer Round 3 BLOCKER (2026-05-03) — type-confusion class fix.
  //
  // Strict-type validation at the API boundary. Replaces the prior
  // truthy-only required-field check, which let `{ name: 0, pattern: 0,
  // direction: 1, severity: 1 }` slip through (truthy-coercion varies)
  // and silently created rules with non-string identifiers. After this
  // block, downstream code (slugify, createRule, audit) can trust
  // shapes.
  // ========================================================================
  if (typeof body.name !== 'string' || !body.name.trim()) return badType('name', 'a non-empty string', body.name);
  if (typeof body.pattern !== 'string' || !body.pattern.trim()) return badType('pattern', 'a non-empty string', body.pattern);
  if (body.direction !== 'inbound' && body.direction !== 'outbound' && body.direction !== 'both') {
    return NextResponse.json({
      error: `field "direction" must be one of "inbound" | "outbound" | "both"; got ${JSON.stringify(body.direction)}`,
    }, { status: 400 });
  }
  if (typeof body.severity !== 'string' || !ALLOWED_SEVERITY.has(body.severity)) {
    return NextResponse.json({
      error: `field "severity" must be one of "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; got ${JSON.stringify(body.severity)}`,
    }, { status: 400 });
  }
  if ('is_regex' in body && typeof body.is_regex !== 'boolean') return badType('is_regex', 'a boolean', body.is_regex);
  if ('flags' in body && typeof body.flags !== 'string') return badType('flags', 'a string', body.flags);
  if ('rule_key' in body && typeof body.rule_key !== 'string') return badType('rule_key', 'a string', body.rule_key);
  if ('exceptions' in body && typeof body.exceptions !== 'string') return badType('exceptions', 'a string', body.exceptions);
  if ('enabled' in body && typeof body.enabled !== 'boolean') return badType('enabled', 'a boolean', body.enabled);
  if ('action' in body && (typeof body.action !== 'string' || !ALLOWED_ACTION.has(body.action))) {
    return NextResponse.json({
      error: `field "action" must be one of "score" | "block" | "review" | "redact" | "allow"; got ${JSON.stringify(body.action)}`,
    }, { status: 400 });
  }

  const flags = typeof body.flags === 'string' ? body.flags : '';

  if (body.is_regex) {
    // Layer 1 of the save-time safety check — defensive 400 wrap
    // around the same gate createRule will run internally with
    // normalized flags. Pass flags so the syntax compile sees what
    // runtime will see (internal reviewer correction Round 4: \u{110000} compiles
    // under no flags but fails under 'u').
    const check = checkRegexSafety(body.pattern, flags);
    if (!check.ok) return NextResponse.json({ error: check.reason, code: check.code }, { status: 400 });
  }

  const rule_key = body.rule_key || slugify(body.name);

  // Validate rule_key format (internal reviewer Round-5 BLOCKER 1): both explicit and
  // slug-derived rule_keys must match the canonical format the redaction
  // pipeline requires. An invalid rule_key + action='redact' would crash
  // outboundScan when the rule fires.
  if (!RULE_KEY_FORMAT.test(rule_key)) {
    return NextResponse.json({
      error: `rule_key "${rule_key}" must match ${RULE_KEY_FORMAT.source}. ` +
             (body.rule_key ? 'Provide a valid rule_key explicitly, or omit it to auto-generate from a name with letters/digits.' : `The auto-generated slug from name "${body.name}" was empty or malformed; provide a name with at least one letter, or supply rule_key explicitly.`),
    }, { status: 400 });
  }

  try {
    const rule = createRule({
      policy_id: policy.id,
      rule_key,
      name: body.name,
      pattern: body.pattern,
      flags,
      is_regex: !!body.is_regex,
      direction: body.direction,
      severity: body.severity,
      action: body.action || 'score',
      exceptions: body.exceptions || '',
      lifecycle: null,
      enabled: body.enabled !== false,
    });
    audit('rule_create', {
      policy_id: policy.id,
      rule_id: rule.id,
      rule_key: rule.rule_key,
      name: rule.name,
      direction: rule.direction,
      severity: rule.severity,
      action: rule.action,
      lifecycle: rule.lifecycle,
    }, actor);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('UNIQUE')) {
      return NextResponse.json({ error: `rule_key "${rule_key}" already exists in this policy` }, { status: 409 });
    }
    if (msg.includes('Invalid regex flags') || msg.includes('Invalid regex pattern')) {
      // normalizeRegexFlags or assertRegexSafety threw inside createRule —
      // surface as 400, not 500. Should already be caught above for the
      // regex case but flag normalization can also surface here.
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    throw err;
  }
}
