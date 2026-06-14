import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getPolicy, getRule, updateRule, deleteRule } from '@/lib/db/policy-store';
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
const ALLOWED_LIFECYCLE = new Set(['draft', 'lab', 'starter', 'strict', 'custom']);

async function authorizeWrite(request: NextRequest): Promise<{ actor: string } | NextResponse> {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'policies:write');
    if (perm) return perm;
    return { actor: auth.operator.id };
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
    return { actor: 'localhost' };
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; ruleId: string }> }) {
  const auth = await authorizeWrite(request);
  if (auth instanceof NextResponse) return auth;

  const policy = getPolicy((await params).id);
  if (!policy) return NextResponse.json({ error: 'policy not found' }, { status: 404 });
  // internal reviewer Gate 5 carry-forward (2026-05-03): rules inserted via
  // createReviewedSeedRule (the 5 named exemptions) may not be enabled
  // or promoted to wire-active behavior unless they pass current
  // checkRegexSafety OR receive fresh explicit code-reviewed exemption.
  // The 403 below implicitly enforces this — all 5 exemption rule_keys
  // live in source='system' (Generic Egress Starter) or 'curated'
  // (ClawNex Default), neither of which accepts PATCH here. v2 may
  // add an explicit vendor-rule edit flow with re-validation.
  if (policy.source !== 'custom') {
    return NextResponse.json({ error: 'cannot edit a rule in a vendor-shipped policy; clone to a custom policy first' }, { status: 403 });
  }

  const rule = getRule((await params).ruleId);
  if (!rule || rule.policy_id !== policy.id) {
    return NextResponse.json({ error: 'rule not found in this policy' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  // ========================================================================
  // internal reviewer Round 3 BLOCKER (2026-05-03) — type-confusion class fix.
  //
  // Strict-type validation at the API boundary. Every field is optional
  // (PATCH semantics), but each present field must match its declared
  // type. Without this guard, `{ "is_regex": "true" }` would slip past
  // updateRule's casts and persist a string in a boolean column;
  // `{ "severity": null }` could nullify a non-null column. After this
  // block, updateRule can trust shapes.
  // ========================================================================
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
  }
  if ('name' in body && (typeof body.name !== 'string' || !body.name.trim())) return badType('name', 'a non-empty string', body.name);
  if ('pattern' in body && (typeof body.pattern !== 'string' || !body.pattern.trim())) return badType('pattern', 'a non-empty string', body.pattern);
  if ('direction' in body && body.direction !== 'inbound' && body.direction !== 'outbound' && body.direction !== 'both') {
    return NextResponse.json({
      error: `field "direction" must be one of "inbound" | "outbound" | "both"; got ${JSON.stringify(body.direction)}`,
    }, { status: 400 });
  }
  if ('severity' in body && (typeof body.severity !== 'string' || !ALLOWED_SEVERITY.has(body.severity))) {
    return NextResponse.json({
      error: `field "severity" must be one of "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; got ${JSON.stringify(body.severity)}`,
    }, { status: 400 });
  }
  if ('action' in body && (typeof body.action !== 'string' || !ALLOWED_ACTION.has(body.action))) {
    return NextResponse.json({
      error: `field "action" must be one of "score" | "block" | "review" | "redact" | "allow"; got ${JSON.stringify(body.action)}`,
    }, { status: 400 });
  }
  if ('is_regex' in body && typeof body.is_regex !== 'boolean') return badType('is_regex', 'a boolean', body.is_regex);
  if ('flags' in body && typeof body.flags !== 'string') return badType('flags', 'a string', body.flags);
  if ('rule_key' in body) {
    if (typeof body.rule_key !== 'string') return badType('rule_key', 'a string', body.rule_key);
    // internal reviewer Round-5 BLOCKER 1: rule_key on PATCH must satisfy the canonical
    // format. An invalid rule_key + action='redact' would crash outboundScan
    // when the rule fires.
    if (!RULE_KEY_FORMAT.test(body.rule_key)) {
      return NextResponse.json({
        error: `rule_key "${body.rule_key}" must match ${RULE_KEY_FORMAT.source}`,
      }, { status: 400 });
    }
  }
  if ('exceptions' in body && typeof body.exceptions !== 'string') return badType('exceptions', 'a string', body.exceptions);
  if ('enabled' in body && typeof body.enabled !== 'boolean') return badType('enabled', 'a boolean', body.enabled);
  if ('lifecycle' in body && body.lifecycle !== null && (typeof body.lifecycle !== 'string' || !ALLOWED_LIFECYCLE.has(body.lifecycle))) {
    return NextResponse.json({
      error: `field "lifecycle" must be one of "draft" | "lab" | "starter" | "strict" | "custom" or null; got ${JSON.stringify(body.lifecycle)}`,
    }, { status: 400 });
  }

  // Defensive Layer-1 check at the API edge — same gate updateRule
  // runs internally with normalized flags. Pass body.flags (or fall
  // back to the existing stored flags) so the syntax compile sees
  // what runtime will see (internal reviewer correction: \u{110000} compiles
  // under no flags but fails under 'u').
  if (body.is_regex && body.pattern) {
    const flags = typeof body.flags === 'string' ? body.flags : rule.flags;
    const check = checkRegexSafety(body.pattern, flags);
    if (!check.ok) return NextResponse.json({ error: check.reason, code: check.code }, { status: 400 });
  }

  let updated;
  try {
    updated = updateRule(rule.id, body);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('Invalid regex flags') || msg.includes('Invalid regex pattern')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    throw err;
  }

  audit('rule_edit', {
    policy_id: policy.id,
    rule_id: rule.id,
    rule_key: updated?.rule_key,
    fields_changed: Object.keys(body),
  }, auth.actor);

  return NextResponse.json({ rule: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; ruleId: string }> }) {
  const auth = await authorizeWrite(request);
  if (auth instanceof NextResponse) return auth;

  const policy = getPolicy((await params).id);
  if (!policy) return NextResponse.json({ error: 'policy not found' }, { status: 404 });
  if (policy.source !== 'custom') {
    return NextResponse.json({ error: 'cannot delete a rule in a vendor-shipped policy' }, { status: 403 });
  }

  const rule = getRule((await params).ruleId);
  if (!rule || rule.policy_id !== policy.id) {
    return NextResponse.json({ error: 'rule not found in this policy' }, { status: 404 });
  }

  deleteRule(rule.id);
  audit('rule_delete', { policy_id: policy.id, rule_id: rule.id, rule_key: rule.rule_key, name: rule.name }, auth.actor);
  return NextResponse.json({ ok: true });
}
