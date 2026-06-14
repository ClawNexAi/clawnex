import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getPolicy, listRulesForPolicy } from '@/lib/db/policy-store';
import { audit } from '@/lib/services/policy-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ITERATION_CAP = 1000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor = 'localhost';
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'policies:test');
    if (perm) return perm;
    actor = auth.operator.id;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const policy = getPolicy((await params).id);
  if (!policy) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
  }
  if (typeof body.text !== 'string') {
    return NextResponse.json({ error: 'text is required (string)' }, { status: 400 });
  }

  const rules = listRulesForPolicy(policy.id);
  const matched: Array<{ rule_key: string; name: string; matchCount: number; samples: string[]; suppressed_by_exception?: boolean }> = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    let matchCount = 0;
    let samples: string[] = [];

    if (rule.is_regex) {
      try {
        // CORRECTION 1 (vs plan): use stored flags per Option C, not hardcoded 'gi'.
        // The test path must mirror the evaluator's runtime semantics —
        // hardcoding 'gi' here would produce different match counts than what
        // the wire would actually fire on, defeating the test's purpose.
        const re = new RegExp(rule.pattern, rule.flags);
        let m: RegExpExecArray | null;
        let iterations = 0;
        // CORRECTION 2 (vs plan): iteration cap. Pathological patterns in
        // test mode otherwise hang the request indefinitely.
        while ((m = re.exec(body.text)) !== null && iterations < ITERATION_CAP) {
          matchCount++;
          if (samples.length < 3) samples.push(m[0].slice(0, 80));
          iterations++;
          // Zero-width match guard — same as evaluator
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      } catch {
        // Invalid regex (shouldn't happen — save-time gate rejects these — but defensively skip)
        continue;
      }
    } else {
      const lower = body.text.toLowerCase();
      const needle = rule.pattern.toLowerCase();
      if (!needle) continue;
      let idx = 0;
      while (idx < lower.length && matchCount < ITERATION_CAP) {
        const found = lower.indexOf(needle, idx);
        if (found === -1) break;
        matchCount++;
        if (samples.length < 1) samples.push(body.text.slice(found, found + needle.length).slice(0, 80));
        idx = found + needle.length;
      }
    }

    if (matchCount === 0) continue;

    // CORRECTION 3 (vs plan): apply rule.exceptions per the evaluator's
    // suppression semantics. Operator testing must see what would actually
    // fire — hidden matches are confusing. Surface as suppressed_by_exception
    // flag rather than dropping the row entirely so operators understand
    // "matched but suppressed".
    let suppressed = false;
    if (rule.exceptions) {
      const lowerText = body.text.toLowerCase();
      for (const line of rule.exceptions.split('\n')) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed && lowerText.includes(trimmed)) {
          suppressed = true;
          break;
        }
      }
    }

    matched.push({
      rule_key: rule.rule_key,
      name: rule.name,
      matchCount,
      samples,
      ...(suppressed ? { suppressed_by_exception: true } : {}),
    });
  }

  audit('policy_test', {
    policy_id: policy.id,
    name: policy.name,
    matched_rule_count: matched.length,
    suppressed_count: matched.filter(m => m.suppressed_by_exception).length,
    verdict: matched.some(m => !m.suppressed_by_exception) ? 'matched' : 'no_match',
  }, actor);

  return NextResponse.json({ policy_id: policy.id, matched });
}
