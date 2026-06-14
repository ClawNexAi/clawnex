/**
 * Policy Evaluator — 15-invariant harness (internal reviewer Gate 3 authorization).
 *
 * Standalone Node script (run via `npx tsx`) that exercises the full
 * contract surface of evaluatePolicies(). MUST pass before Task 8
 * scan-path integration.
 *
 * Invariant 11 (added per the operator's Option C adjudication on regex flags
 * 2026-05-02): proves stored flags are honored end-to-end and 'g' is
 * force-added at save time. Three sub-checks: 11a covers honor +
 * matchCount; 11b covers createRule rejecting unsupported flag chars;
 * 11c covers createRule rejecting duplicate flag chars. Counted as a
 * single invariant in the summary line.
 *
 * Invariant 12 (added per internal reviewer BLOCKER fix 2026-05-02): proves the
 * save-time ReDoS gate (Layer 1 safe-regex2 AST + Layer 2 1024-char
 * cap) is wired into both createRule and updateRule. Four sub-checks:
 * 12a createRule rejects nested-quantifier (a+)+; 12b createRule
 * rejects pattern length >1024; 12c updateRule rejects nested-quantifier
 * via pattern patch; 12d updateRule rejects pattern length >1024 via
 * pattern patch. Counted as a single invariant in the summary line.
 *
 * Invariant 13 (added per internal reviewer correction 2026-05-02): proves the
 * updateRule safety check fires on flags-only patches. A pattern can
 * compile under one flag set and fail under another (e.g. \u{110000}
 * compiles under '' but throws "Invalid Unicode escape" under 'u').
 * The updateRule trigger must run regardless of which field was
 * patched — the original "patch.pattern || patch.is_regex" guard
 * missed flags-only mutations.
 *
 * Invariant 14 (expanded per internal reviewer round 4 — 2026-05-02): proves the
 * reviewed-seed safety-exemption mechanism is correctly scoped via
 * createReviewedSeedRule. Five sub-checks: 14a accepts the 5 named
 * allow-list rule_keys; 14b rejects an unlisted rule_key; 14c rejects
 * empty/whitespace safety_exemption_reason; 14d rejects bad flag chars
 * (normalizer still fires); 14e rejects custom-source policies (the
 * operator path can't reach this helper).
 *
 * Invariant 15 (added per internal reviewer round 4 — 2026-05-02): proves the
 * createCuratedMirrorRule helper is correctly scoped — accepts curated
 * source, rejects non-curated source.
 *
 * Hermeticity: this script wipes /tmp/policy-eval-invariants.db on
 * each run and re-seeds from scratch. It NEVER touches the live
 * ~/sentinel/data/clawnex.db (or any path under data/).
 *
 * Audit-log assertions read directly from the same SQLite handle that
 * audit-logger.ts writes to — writes are synchronous (better-sqlite3),
 * so reads in the same process see them immediately. The audit_log
 * table is created by SCHEMA on first getDb() call.
 *
 * Usage:
 *   npx tsx scripts/policy-evaluator-invariants.ts
 *
 * Exit code:
 *   0 if all 15 invariants pass; 1 otherwise.
 *
 * Spec §3.2 + §3.2.1 + §3.5 — internal reviewer Gate 3 authorization.
 */

import fs from 'node:fs';

// Hermetic DB setup MUST happen before any module that calls getDb().
// The path resolver in src/lib/db/index.ts reads DATABASE_PATH at the
// moment of the first getDb() call, so we set it up here at the very
// top before any imports that touch the DB transitively.
const DB_PATH = '/tmp/policy-eval-invariants.db';
for (const suffix of ['', '-shm', '-wal']) {
  const p = `${DB_PATH}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
process.env.DATABASE_PATH = DB_PATH;
// Suppress the audit stdout mirror — keeps the harness output readable.
process.env.CLAWNEX_AUDIT_STDOUT = 'false';

// Now safe to import the modules that touch the DB.
import { getDb } from '../src/lib/db/index';
import { createPolicy, createRule, createCuratedMirrorRule, createReviewedSeedRule, getRule, updateRule } from '../src/lib/db/policy-store';
import { evaluatePolicies, type PolicyEvaluationResult } from '../src/lib/shield/policy-evaluator';
import type { ShieldDetection } from '../src/lib/types';
import type { Policy, PolicyRule, RuleAction, RuleDirection } from '../src/lib/shield/types';

// --- Test infrastructure ---------------------------------------------------

interface InvariantResult {
  name: string;
  passed: boolean;
  diagnostic?: string;
}

const results: InvariantResult[] = [];

// Collect every detection emitted across all invariants for invariant 9
// (provenance contract). We append after each evaluatePolicies() call
// so the final invariant has the full union to walk.
const allEmittedDetections: ShieldDetection[] = [];

function record(name: string, passed: boolean, diagnostic?: string): void {
  results.push({ name, passed, diagnostic });
}

function ingest(result: PolicyEvaluationResult): PolicyEvaluationResult {
  allEmittedDetections.push(...result.detections);
  return result;
}

// Helper: query the most recent audit_log row for a given (action, resource_id)
// pair. Used by invariants 5, 6, and 10. Filtering by resource_id (the rule.id)
// in addition to action eliminates the brittleness of relying on a UUID
// tiebreaker when multiple invariants emit the same action in the same ms.
interface AuditRow {
  id: string;
  actor: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: string | null;
  source: string;
  created_at: string;
}
function latestAuditByActionAndResource(action: string, resourceId: string): AuditRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM audit_log WHERE action = ? AND resource_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(action, resourceId) as AuditRow | undefined;
}

// Helper: build a fresh enabled system policy with a deterministic name.
// Each invariant gets its own policy so cross-test rule pollution is
// impossible.
function mkPolicy(name: string, opts?: { source?: 'system' | 'curated' | 'custom'; enabled?: boolean }): Policy {
  return createPolicy({
    name,
    description: `Harness fixture — ${name}`,
    enabled: opts?.enabled ?? true,
    source: opts?.source ?? 'system',
    lifecycle: 'starter',
    version: '1.0.0',
    created_by: null,
  });
}

function mkRule(
  policy: Policy,
  ruleKey: string,
  pattern: string,
  opts?: {
    isRegex?: boolean;
    direction?: RuleDirection;
    action?: RuleAction;
    enabled?: boolean;
    exceptions?: string;
    severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    name?: string;
  },
): PolicyRule {
  return createRule({
    policy_id: policy.id,
    rule_key: ruleKey,
    name: opts?.name ?? ruleKey,
    pattern,
    flags: '',
    is_regex: opts?.isRegex ?? false,
    direction: opts?.direction ?? 'both',
    severity: opts?.severity ?? 'MEDIUM',
    action: opts?.action ?? 'score',
    exceptions: opts?.exceptions ?? '',
    lifecycle: null,
    enabled: opts?.enabled ?? true,
  });
}

// --- Trigger the seeded baseline -------------------------------------------
// Initial getDb() runs SCHEMA + seed (including the policy framework
// seed). Subsequent invariant fixtures stack on top. We do this once
// here so the seed log lines don't interleave with invariant output.
console.log('--- harness setup ---');
getDb();
console.log('');

// --- Invariant 1: Curated policies are mirror-only -------------------------
{
  const p = mkPolicy('Inv1 Curated', { source: 'curated' });
  mkRule(p, 'INV1-CURATED-LITERAL', 'curated-test-string');
  const r = ingest(evaluatePolicies('curated-test-string here', 'outbound'));
  // Filter by the policy we just created. The contract is that any
  // curated-source policy is wire-inert — the seeded ClawNex Default
  // (also curated) is similarly inert; any other detections in the
  // result must come from non-curated sources (e.g. Generic Egress
  // Starter on incidental matches), which is fine.
  // Note: `policy_source` on ShieldDetection is typed
  // Exclude<PolicySource,'curated'>, so we can't filter by it directly
  // — we use policy_id (always populated for emitted detections) and
  // additionally guard via rule_key for clarity.
  const fromOurCuratedPolicy = r.detections.filter(
    d => d.policy_id === p.id || d.rule_key === 'INV1-CURATED-LITERAL',
  );
  if (fromOurCuratedPolicy.length === 0) {
    record('Curated policies are mirror-only', true);
  } else {
    record(
      'Curated policies are mirror-only',
      false,
      `expected 0 detections from curated policy ${p.id}, got ${fromOurCuratedPolicy.length} (rule_keys: ${fromOurCuratedPolicy.map(d => d.rule_key).join(', ')})`,
    );
  }
}

// --- Invariant 2: Disabled rule does not fire ------------------------------
{
  const p = mkPolicy('Inv2 Disabled Rule');
  mkRule(p, 'INV2-DISABLED-RULE', 'held-draft-token', { enabled: false });
  const r = ingest(evaluatePolicies('held-draft-token here', 'outbound'));
  const hit = r.detections.find(d => d.rule_key === 'INV2-DISABLED-RULE');
  if (!hit) {
    record('Disabled rule does not fire', true);
  } else {
    record(
      'Disabled rule does not fire',
      false,
      `expected 0 detections naming INV2-DISABLED-RULE, got 1`,
    );
  }
}

// --- Invariant 3: Disabled policy does not fire ----------------------------
{
  const p = mkPolicy('Inv3 Disabled Policy', { enabled: false });
  mkRule(p, 'INV3-SILENT-POL', 'silent-policy-marker');
  const r = ingest(evaluatePolicies('silent-policy-marker', 'outbound'));
  const hit = r.detections.find(d => d.rule_key === 'INV3-SILENT-POL');
  if (!hit) {
    record('Disabled policy does not fire', true);
  } else {
    record(
      'Disabled policy does not fire',
      false,
      `expected 0 detections naming INV3-SILENT-POL, got 1`,
    );
  }
}

// --- Invariant 4: Direction filter respects inbound/outbound/both ----------
{
  const p = mkPolicy('Inv4 Direction Filter');
  mkRule(p, 'INV4-OUTBOUND-ONLY', 'outbound-only-pat', { direction: 'outbound' });
  mkRule(p, 'INV4-INBOUND-ONLY', 'inbound-only-pat', { direction: 'inbound' });
  mkRule(p, 'INV4-BOTH', 'both-direction-pat', { direction: 'both' });

  const text = 'outbound-only-pat inbound-only-pat both-direction-pat';

  // Outbound pass
  const ob = ingest(evaluatePolicies(text, 'outbound'));
  const obKeys = ob.detections.map(d => d.rule_key);
  const obHasOutbound = obKeys.includes('INV4-OUTBOUND-ONLY');
  const obHasBoth = obKeys.includes('INV4-BOTH');
  const obHasInboundLeak = obKeys.includes('INV4-INBOUND-ONLY');

  // Inbound pass
  const ib = ingest(evaluatePolicies(text, 'inbound'));
  const ibKeys = ib.detections.map(d => d.rule_key);
  const ibHasInbound = ibKeys.includes('INV4-INBOUND-ONLY');
  const ibHasBoth = ibKeys.includes('INV4-BOTH');
  const ibHasOutboundLeak = ibKeys.includes('INV4-OUTBOUND-ONLY');

  const okOutbound = obHasOutbound && obHasBoth && !obHasInboundLeak;
  const okInbound = ibHasInbound && ibHasBoth && !ibHasOutboundLeak;

  if (okOutbound && okInbound) {
    record('Direction filter respects inbound/outbound/both', true);
  } else {
    record(
      'Direction filter respects inbound/outbound/both',
      false,
      `outbound run keys=${JSON.stringify(obKeys)} (need outbound+both, no inbound); inbound run keys=${JSON.stringify(ibKeys)} (need inbound+both, no outbound)`,
    );
  }
}

// --- Invariant 5: Exception suppression emits audit ------------------------
{
  const p = mkPolicy('Inv5 Exception Suppression');
  const rule = mkRule(p, 'INV5-CC-EXCEPTION', 'creditcard-no', {
    exceptions: 'test-card-marker',
  });
  const r = ingest(evaluatePolicies('creditcard-no with test-card-marker', 'outbound'));
  const hit = r.detections.find(d => d.rule_key === 'INV5-CC-EXCEPTION');
  if (hit) {
    record(
      'Exception suppression emits audit',
      false,
      `expected 0 detections from INV5-CC-EXCEPTION (suppressed by exception), got 1`,
    );
  } else {
    const audit = latestAuditByActionAndResource('rule_match_suppressed', rule.id);
    if (!audit) {
      record(
        'Exception suppression emits audit',
        false,
        `no audit_log row with action='rule_match_suppressed' for rule.id=${rule.id} found`,
      );
    } else {
      let detail: { suppression_kind?: string; rule_key?: string } = {};
      try { detail = JSON.parse(audit.detail || '{}'); } catch { /* leaves detail empty */ }
      const kindOk = detail.suppression_kind === 'exception';
      const keyOk = detail.rule_key === 'INV5-CC-EXCEPTION';
      // resource_id should also be the rule.id per the evaluator's logEvent call.
      const resourceOk = audit.resource_id === rule.id;
      if (kindOk && keyOk && resourceOk) {
        record('Exception suppression emits audit', true);
      } else {
        record(
          'Exception suppression emits audit',
          false,
          `audit row mismatch: suppression_kind=${detail.suppression_kind} (need 'exception'), rule_key=${detail.rule_key} (need 'INV5-CC-EXCEPTION'), resource_id=${audit.resource_id} (need ${rule.id})`,
        );
      }
    }
  }
}

// --- Invariant 6: action='allow' suppresses + emits audit ------------------
{
  const p = mkPolicy('Inv6 Allow Action');
  const rule = mkRule(p, 'INV6-ALLOW-ACTION', 'allow-action-pat', { action: 'allow' });
  const r = ingest(evaluatePolicies('allow-action-pat', 'outbound'));
  const hit = r.detections.find(d => d.rule_key === 'INV6-ALLOW-ACTION');
  if (hit) {
    record(
      "action='allow' suppresses + emits audit with allow_action kind",
      false,
      `expected 0 detections from INV6-ALLOW-ACTION (suppressed by allow action), got 1`,
    );
  } else {
    const audit = latestAuditByActionAndResource('rule_match_suppressed', rule.id);
    if (!audit) {
      record(
        "action='allow' suppresses + emits audit with allow_action kind",
        false,
        `no audit_log row with action='rule_match_suppressed' for rule.id=${rule.id} found`,
      );
    } else {
      let detail: { suppression_kind?: string; rule_key?: string } = {};
      try { detail = JSON.parse(audit.detail || '{}'); } catch { /* leaves detail empty */ }
      const kindOk = detail.suppression_kind === 'allow_action';
      const keyOk = detail.rule_key === 'INV6-ALLOW-ACTION';
      const resourceOk = audit.resource_id === rule.id;
      if (kindOk && keyOk && resourceOk) {
        record("action='allow' suppresses + emits audit with allow_action kind", true);
      } else {
        record(
          "action='allow' suppresses + emits audit with allow_action kind",
          false,
          `audit row mismatch: suppression_kind=${detail.suppression_kind} (need 'allow_action'), rule_key=${detail.rule_key} (need 'INV6-ALLOW-ACTION'), resource_id=${audit.resource_id} (need ${rule.id})`,
        );
      }
    }
  }
}

// --- Invariant 7: Verdict floor monotonicity -------------------------------
{
  const p = mkPolicy('Inv7 Verdict Floor');
  mkRule(p, 'INV7-BLOCK', 'block-trigger', { action: 'block' });
  mkRule(p, 'INV7-REVIEW', 'review-trigger', { action: 'review' });
  mkRule(p, 'INV7-SCORE', 'score-trigger', { action: 'score' });

  const all = ingest(evaluatePolicies('score-trigger review-trigger block-trigger', 'outbound'));
  const reviewOnly = ingest(evaluatePolicies('score-trigger review-trigger', 'outbound'));
  const scoreOnly = ingest(evaluatePolicies('score-trigger', 'outbound'));

  const okBlock = all.verdictFloor === 'BLOCK';
  const okReview = reviewOnly.verdictFloor === 'REVIEW';
  const okAllow = scoreOnly.verdictFloor === 'ALLOW';

  if (okBlock && okReview && okAllow) {
    record('Verdict floor monotonicity', true);
  } else {
    record(
      'Verdict floor monotonicity',
      false,
      `floors: all=${all.verdictFloor} (need BLOCK), reviewOnly=${reviewOnly.verdictFloor} (need REVIEW), scoreOnly=${scoreOnly.verdictFloor} (need ALLOW)`,
    );
  }
}

// --- Invariant 8: redactSpans isolation + samples truncation ---------------
{
  const p = mkPolicy('Inv8 Redact Span Isolation');
  // Pattern: longsecret- followed by one-or-more lowercase. We feed
  // ~200 lowercase chars after the prefix so the full match is ~211
  // chars, well above the 80-char SAMPLE_TRUNCATE.
  mkRule(p, 'INV8-LONGSECRET', 'longsecret-[a-z]+', {
    isRegex: true,
    action: 'redact',
  });
  const longTail = 'a'.repeat(200);
  const longMatch = `longsecret-${longTail}`; // 11 + 200 = 211 chars
  const text = `noise ${longMatch} more noise`;
  const r = ingest(evaluatePolicies(text, 'outbound'));

  const det = r.detections.find(d => d.rule_key === 'INV8-LONGSECRET');
  const span = r.redactSpans.find(s => s.rule_key === 'INV8-LONGSECRET');

  if (!det || !span) {
    record(
      'redactSpans isolation + samples truncation',
      false,
      `expected 1 detection + 1 redactSpan for INV8-LONGSECRET; got det=${!!det}, span=${!!span}`,
    );
  } else {
    const spanLenOk = span.length === longMatch.length; // full match length
    const sampleLenOk = det.samples.length > 0 && det.samples[0].length <= 80;
    if (spanLenOk && sampleLenOk) {
      record('redactSpans isolation + samples truncation', true);
    } else {
      record(
        'redactSpans isolation + samples truncation',
        false,
        `span.length=${span.length} (need ${longMatch.length}); samples[0].length=${det.samples[0]?.length} (need <=80)`,
      );
    }
  }
}

// --- Invariant 9: Provenance contract on every emitted detection -----------
{
  const policyDetections = allEmittedDetections.filter(
    d => d.source === 'policy-system' || d.source === 'policy-custom',
  );
  if (policyDetections.length === 0) {
    record(
      'Provenance contract on every emitted detection',
      false,
      `no policy detections were emitted across all prior invariant runs — nothing to validate`,
    );
  } else {
    const requiredFields: Array<keyof ShieldDetection> = [
      'policy_id',
      'policy_name',
      'policy_source',
      'policy_rule_id',
      'rule_key',
      'action',
    ];
    const violations: Array<{ idx: number; rule_key: string | undefined; missing: string[] }> = [];
    policyDetections.forEach((d, idx) => {
      const missing = requiredFields.filter(f => {
        const v = d[f];
        return v === undefined || v === null || v === '';
      }) as string[];
      if (missing.length > 0) {
        violations.push({ idx, rule_key: d.rule_key, missing });
      }
    });
    if (violations.length === 0) {
      record('Provenance contract on every emitted detection', true);
    } else {
      record(
        'Provenance contract on every emitted detection',
        false,
        `${violations.length}/${policyDetections.length} detections missing required provenance fields. First violation: rule_key=${violations[0].rule_key} missing=${violations[0].missing.join(',')}`,
      );
    }
  }
}

// --- Invariant 10: Iteration cap emits an audit row ------------------------
// A pathological literal pattern that matches every character produces
// >ITERATION_CAP hits, the cap kicks in, and we expect an audit row
// with action='rule_iteration_capped' for that rule.
{
  const p = mkPolicy('Inv10 Iteration Cap');
  const rule = mkRule(p, 'INV10-CAP-LITERAL', 'a', { action: 'score' });

  // Build text with >ITERATION_CAP single-char matches.
  const text = 'a'.repeat(1500);
  // Note: we intentionally don't ingest this result — invariant 9
  // already ran and the cap-test detection isn't part of the provenance
  // surface we're validating here.
  evaluatePolicies(text, 'outbound');

  const audit = latestAuditByActionAndResource('rule_iteration_capped', rule.id);
  if (!audit) {
    record(
      'Iteration cap emits an audit row',
      false,
      `expected audit row with action='rule_iteration_capped' for rule.id=${rule.id} (INV10-CAP-LITERAL); got none`,
    );
  } else {
    let detail: { cap?: number; rule_key?: string; hits_collected?: number } = {};
    try { detail = JSON.parse(audit.detail || '{}'); } catch { /* leaves detail empty */ }
    const capOk = detail.cap === 1000;
    const keyOk = detail.rule_key === 'INV10-CAP-LITERAL';
    if (capOk && keyOk) {
      record('Iteration cap emits an audit row', true);
    } else {
      record(
        'Iteration cap emits an audit row',
        false,
        `audit row detail mismatch: cap=${detail.cap} (need 1000), rule_key=${detail.rule_key} (need 'INV10-CAP-LITERAL')`,
      );
    }
  }
}

// --- Invariant 11: Stored flags honored end-to-end + 'g' is force-added ----
// the operator's Option C contract (regex-flags adjudication 2026-05-02): the wire
// path honors whatever flags sit in policy_rules.flags after save-time
// normalization, with 'g' guaranteed present. Three sub-checks:
//   11a — Three rules with the same pattern but different stored flags
//         produce the expected match counts, and the persisted flags
//         column carries the canonical normalized form.
//   11b — createRule throws InvalidRegexFlagsError on unsupported flag
//         chars (here 'q').
//   11c — createRule throws InvalidRegexFlagsError on duplicate flag
//         chars (here 'gg').
{
  const p = mkPolicy('Inv11 Flag Honoring');

  // Case-sensitive (no 'i'): only matches lowercase 'foo'.
  // Stored flags '' → normalized to 'g'.
  const ruleCS = createRule({
    policy_id: p.id,
    rule_key: 'INV11-CASE-SENSITIVE',
    name: 'inv11 case sensitive',
    pattern: 'foo',
    flags: '',
    is_regex: true,
    direction: 'outbound',
    severity: 'LOW',
    action: 'score',
    exceptions: '',
    lifecycle: null,
    enabled: true,
  });

  // Case-insensitive: matches all foo/Foo/FOO variants.
  // Stored flags 'i' → normalized to 'gi'.
  const ruleCI = createRule({
    policy_id: p.id,
    rule_key: 'INV11-CASE-INSENSITIVE',
    name: 'inv11 case insensitive',
    pattern: 'foo',
    flags: 'i',
    is_regex: true,
    direction: 'outbound',
    severity: 'LOW',
    action: 'score',
    exceptions: '',
    lifecycle: null,
    enabled: true,
  });

  // Multiline: ^foo only matches 'foo' at start of lines.
  // Stored flags 'm' → normalized to 'gm'.
  const ruleML = createRule({
    policy_id: p.id,
    rule_key: 'INV11-MULTILINE',
    name: 'inv11 multiline',
    pattern: '^foo',
    flags: 'm',
    is_regex: true,
    direction: 'outbound',
    severity: 'LOW',
    action: 'score',
    exceptions: '',
    lifecycle: null,
    enabled: true,
  });

  // Persistence canary: read back and assert flags are normalized.
  const cs = getRule(ruleCS.id)!;
  const ci = getRule(ruleCI.id)!;
  const ml = getRule(ruleML.id)!;
  const normalizationOk =
    cs.flags === 'g' && ci.flags === 'gi' && ml.flags === 'gm';

  // Test text mixing case and lines:
  //   line 1: "foo Foo FOO foofoo"   → 'foo' literal at positions 0, 12, 15
  //                                  → 'Foo' at 4, 'FOO' at 8
  //   line 2: "foo on line 2"        → 'foo' literal at start
  //
  // CS rule (g): 'foo' literal — line 1 has 3 (pos 0, 12, 15 within 'foofoo')
  //              + line 2 has 1 = 4 hits total.
  // CI rule (gi): all foo/Foo/FOO — line 1 has 5 (pos 0, 4, 8, 12, 15)
  //               + line 2 has 1 = 6 hits total.
  // ML rule (gm): ^foo at start of each line — line 1 + line 2 = 2 hits.
  const text = 'foo Foo FOO foofoo\nfoo on line 2';
  const r = ingest(evaluatePolicies(text, 'outbound'));
  const byKey = new Map(r.detections.map(d => [d.rule_key, d.matchCount]));
  const csCount = byKey.get('INV11-CASE-SENSITIVE') ?? 0;
  const ciCount = byKey.get('INV11-CASE-INSENSITIVE') ?? 0;
  const mlCount = byKey.get('INV11-MULTILINE') ?? 0;

  // 11b: createRule must reject unsupported flag char.
  let threwOnUnsupported = false;
  try {
    createRule({
      policy_id: p.id,
      rule_key: 'INV11-INVALID-FLAG',
      name: 'inv11 invalid flag',
      pattern: 'x',
      flags: 'q',
      is_regex: true,
      direction: 'outbound',
      severity: 'LOW',
      action: 'score',
      exceptions: '',
      lifecycle: null,
      enabled: true,
    });
  } catch {
    threwOnUnsupported = true;
  }

  // 11c: createRule must reject duplicate flag char.
  let threwOnDuplicate = false;
  try {
    createRule({
      policy_id: p.id,
      rule_key: 'INV11-DUP-FLAG',
      name: 'inv11 dup flag',
      pattern: 'x',
      flags: 'gg',
      is_regex: true,
      direction: 'outbound',
      severity: 'LOW',
      action: 'score',
      exceptions: '',
      lifecycle: null,
      enabled: true,
    });
  } catch {
    threwOnDuplicate = true;
  }

  const matchCountsOk = csCount === 4 && ciCount === 6 && mlCount === 2;
  const allOk =
    normalizationOk && matchCountsOk && threwOnUnsupported && threwOnDuplicate;

  if (allOk) {
    record('Stored flags honored + g force-added; invalid flags rejected at save', true);
  } else {
    record(
      'Stored flags honored + g force-added; invalid flags rejected at save',
      false,
      `cs.flags="${cs.flags}" (need "g"); ci.flags="${ci.flags}" (need "gi"); ml.flags="${ml.flags}" (need "gm"); ` +
        `csCount=${csCount} (need 4); ciCount=${ciCount} (need 6); mlCount=${mlCount} (need 2); ` +
        `threwOnUnsupported=${threwOnUnsupported} (need true); threwOnDuplicate=${threwOnDuplicate} (need true)`,
    );
  }
}

// --- Invariant 12: Save-time ReDoS gate enforced --------------------------
// internal reviewer BLOCKER fix 2026-05-02. Proves checkRegexSafety is wired through
// assertRegexSafety into both createRule and updateRule. Literal patterns
// (is_regex=false) are NOT subject to the regex check — they only ever
// go through indexOf, no compile, no backtracking risk. Four sub-checks
// bundled into one record() call so the gate is treated as a single
// contract.
{
  const p = mkPolicy('Inv12 ReDoS Gate');

  // Sub-12a: createRule rejects nested-quantifier regex.
  let create_unsafe_threw = false;
  try {
    createRule({
      policy_id: p.id,
      rule_key: 'INV12-CREATE-UNSAFE',
      name: 'inv12 create unsafe',
      pattern: '(a+)+',
      flags: '',
      is_regex: true,
      direction: 'outbound',
      severity: 'LOW',
      action: 'score',
      exceptions: '',
      lifecycle: null,
      enabled: true,
    });
  } catch {
    create_unsafe_threw = true;
  }

  // Sub-12b: createRule rejects pattern length > 1024.
  let create_long_threw = false;
  try {
    createRule({
      policy_id: p.id,
      rule_key: 'INV12-CREATE-LONG',
      name: 'inv12 create long',
      pattern: 'a'.repeat(1025),
      flags: '',
      is_regex: true,
      direction: 'outbound',
      severity: 'LOW',
      action: 'score',
      exceptions: '',
      lifecycle: null,
      enabled: true,
    });
  } catch {
    create_long_threw = true;
  }

  // Setup for update tests: a benign rule we'll try to mutate into
  // pathological shapes via updateRule.
  const baseline = createRule({
    policy_id: p.id,
    rule_key: 'INV12-BASELINE',
    name: 'inv12 baseline',
    pattern: 'foo',
    flags: '',
    is_regex: true,
    direction: 'outbound',
    severity: 'LOW',
    action: 'score',
    exceptions: '',
    lifecycle: null,
    enabled: true,
  });

  // Sub-12c: updateRule rejects nested-quantifier regex via pattern patch.
  let update_unsafe_threw = false;
  try {
    updateRule(baseline.id, { pattern: '(a+)+' });
  } catch {
    update_unsafe_threw = true;
  }

  // Sub-12d: updateRule rejects pattern length > 1024 via pattern patch.
  let update_long_threw = false;
  try {
    updateRule(baseline.id, { pattern: 'a'.repeat(1025) });
  } catch {
    update_long_threw = true;
  }

  const allOk =
    create_unsafe_threw &&
    create_long_threw &&
    update_unsafe_threw &&
    update_long_threw;

  if (allOk) {
    record('Save-time ReDoS gate enforced (create + update, unsafe + length)', true);
  } else {
    record(
      'Save-time ReDoS gate enforced (create + update, unsafe + length)',
      false,
      `createRule unsafe regex threw: ${create_unsafe_threw} (need true); createRule >1024 chars threw: ${create_long_threw} (need true); updateRule unsafe regex threw: ${update_unsafe_threw} (need true); updateRule >1024 chars threw: ${update_long_threw} (need true)`,
    );
  }
}

// --- Invariant 13: updateRule safety check fires on flags-only patches ----
// internal reviewer correction 2026-05-02. A pattern can compile under one flag set and
// fail under another — e.g. \u{110000} compiles under '' (no Unicode mode)
// but throws "Invalid Unicode escape" under 'u'. The save-time gate must
// catch this when an operator patches only the flags field. The original
// updateRule trigger ("patch.pattern || patch.is_regex") missed flags-only
// patches; this invariant guards against regression.
{
  // A pattern that compiles under '' (no Unicode mode) but fails under 'u'.
  // \u{110000} is out of the Unicode codepoint range only when the engine
  // is in Unicode mode, where \u{...} is parsed as a codepoint escape.
  const p = mkPolicy('Inv13 Flags-Only Patch');

  const baseline = createRule({
    policy_id: p.id,
    rule_key: 'INV13-BASELINE',
    name: 'inv13 baseline',
    pattern: '\\u{110000}',
    flags: '',     // normalized → 'g' — compiles, no Unicode mode
    is_regex: true,
    direction: 'outbound',
    severity: 'LOW',
    action: 'score',
    exceptions: '',
    lifecycle: null,
    enabled: true,
  });

  // Patch flags-only → 'u'. Must reject because the existing pattern
  // becomes a syntax error under Unicode mode.
  let flags_patch_threw = false;
  try {
    updateRule(baseline.id, { flags: 'u' });
  } catch {
    flags_patch_threw = true;
  }

  if (flags_patch_threw) {
    record('updateRule safety check fires on flags-only patch', true);
  } else {
    record(
      'updateRule safety check fires on flags-only patch',
      false,
      `expected updateRule({ flags: 'u' }) to throw on \\u{110000} pattern; got silent accept`,
    );
  }
}

// --- Invariant 14: Reviewed-seed safety exemption is correctly scoped ----
// internal reviewer round 4 — 2026-05-02. Replaces the prior "createSeedRule bypass"
// invariant with a tighter contract on the new createReviewedSeedRule
// helper. Five sub-checks:
//   14a accepts each of the 5 named allow-list rule_keys
//   14b rejects an unlisted rule_key (random key with bypass-shaped pattern)
//   14c rejects empty/whitespace safety_exemption_reason
//   14d rejects bad flag chars (normalizer still fires through the helper)
//   14e rejects parent policy.source === 'custom' (operator path blocked)
{
  // System policy for the allow-list + reason + flags + custom-source tests.
  const sysPolicy = mkPolicy('Inv14 Sys Policy');

  // 14a — accept each of the 5 named allow-list rule_keys.
  const allowedKeys = [
    'OUT-PII-PHONE_US',
    'OUT-PII-CREDIT_CARD',
    'OUT-PII-IPV4',
    'JAIL-CREDENTIAL-EXTRACTION-REQUEST',
    'OUT-GENERIC-API-KEY-SHAPE',
  ];
  let accepted_count = 0;
  for (const key of allowedKeys) {
    try {
      createReviewedSeedRule({
        policy_id: sysPolicy.id,
        rule_key: key,
        name: `inv14 ${key}`,
        pattern: '(a+)+', // would fail safe-regex2; allowed because compile-only path skips the AST inspection
        flags: '',
        is_regex: true,
        direction: 'outbound',
        severity: 'LOW',
        action: 'score',
        exceptions: '',
        lifecycle: 'custom',
        enabled: false, // mirror the held-draft enable=false convention
      }, 'inv14 test reason: bounded false positive');
      accepted_count++;
    } catch {
      /* unexpected */
    }
  }

  // 14b — reject unlisted rule_key.
  let unlisted_rejected = false;
  try {
    createReviewedSeedRule({
      policy_id: sysPolicy.id,
      rule_key: 'INV14-NOT-IN-ALLOW-LIST',
      name: 'inv14 unlisted',
      pattern: '(a+)+',
      flags: '',
      is_regex: true,
      direction: 'outbound',
      severity: 'LOW',
      action: 'score',
      exceptions: '',
      lifecycle: 'custom',
      enabled: false,
    }, 'attempting to abuse the bypass');
  } catch {
    unlisted_rejected = true;
  }

  // 14c — reject empty/whitespace safety_exemption_reason on an allowed key.
  let empty_reason_rejected = false;
  try {
    createReviewedSeedRule({
      policy_id: sysPolicy.id,
      rule_key: 'OUT-PII-PHONE_US', // allowed key
      name: 'inv14 empty reason',
      pattern: 'foo',
      flags: '',
      is_regex: true,
      direction: 'outbound',
      severity: 'LOW',
      action: 'score',
      exceptions: '',
      lifecycle: 'custom',
      enabled: false,
    }, '   '); // whitespace-only reason
  } catch {
    empty_reason_rejected = true;
  }

  // 14d — reject bad flag chars (normalizer still fires through the helper).
  let bad_flags_rejected = false;
  try {
    createReviewedSeedRule({
      policy_id: sysPolicy.id,
      rule_key: 'OUT-PII-PHONE_US',
      name: 'inv14 bad flags',
      pattern: 'foo',
      flags: 'q', // unsupported
      is_regex: true,
      direction: 'outbound',
      severity: 'LOW',
      action: 'score',
      exceptions: '',
      lifecycle: 'custom',
      enabled: false,
    }, 'inv14 bad flags test');
  } catch {
    bad_flags_rejected = true;
  }

  // 14e — reject parent policy.source === 'custom'.
  const customPolicy = mkPolicy('Inv14 Custom Policy', { source: 'custom' });
  let custom_source_rejected = false;
  try {
    createReviewedSeedRule({
      policy_id: customPolicy.id,
      rule_key: 'OUT-PII-PHONE_US',
      name: 'inv14 custom source',
      pattern: 'foo',
      flags: '',
      is_regex: true,
      direction: 'outbound',
      severity: 'LOW',
      action: 'score',
      exceptions: '',
      lifecycle: 'custom',
      enabled: false,
    }, 'inv14 custom source test');
  } catch {
    custom_source_rejected = true;
  }

  const allOk =
    accepted_count === 5 &&
    unlisted_rejected &&
    empty_reason_rejected &&
    bad_flags_rejected &&
    custom_source_rejected;

  if (allOk) {
    record(
      'Reviewed seed exemption — allow-listed accept; unlisted/empty-reason/bad-flags/custom-source reject',
      true,
    );
  } else {
    record(
      'Reviewed seed exemption — allow-listed accept; unlisted/empty-reason/bad-flags/custom-source reject',
      false,
      `accepted of 5 allow-listed: ${accepted_count} (need 5); unlisted rejected: ${unlisted_rejected} (need true); empty reason rejected: ${empty_reason_rejected} (need true); bad flags rejected: ${bad_flags_rejected} (need true); custom source rejected: ${custom_source_rejected} (need true)`,
    );
  }
}

// --- Invariant 15: Curated mirror helper is correctly scoped --------------
// internal reviewer round 4 — 2026-05-02. createCuratedMirrorRule must accept inserts
// where the parent policy.source === 'curated' (the wire-inert ClawNex
// Default mirror) and reject everything else (system, custom).
{
  const curatedPolicy = mkPolicy('Inv15 Curated', { source: 'curated' });

  // 15a — accept curated-source insert with a pattern that would fail
  // safe-regex2 (the helper skips the AST inspection by design).
  let curated_accepted = false;
  try {
    const r = createCuratedMirrorRule({
      policy_id: curatedPolicy.id,
      rule_key: 'INV15-CURATED-OK',
      name: 'inv15 curated ok',
      pattern: '(a+)+',
      flags: '',
      is_regex: true,
      direction: 'inbound',
      severity: 'HIGH',
      action: 'score',
      exceptions: '',
      lifecycle: null,
      enabled: true,
    });
    curated_accepted = !!r.id;
  } catch {
    /* unexpected */
  }

  // 15b — reject system-source insert.
  const sysPolicy15 = mkPolicy('Inv15 Sys');
  let non_curated_rejected = false;
  try {
    createCuratedMirrorRule({
      policy_id: sysPolicy15.id,
      rule_key: 'INV15-SYS-REJECTED',
      name: 'inv15 sys rejected',
      pattern: 'foo',
      flags: '',
      is_regex: true,
      direction: 'outbound',
      severity: 'LOW',
      action: 'score',
      exceptions: '',
      lifecycle: null,
      enabled: true,
    });
  } catch {
    non_curated_rejected = true;
  }

  if (curated_accepted && non_curated_rejected) {
    record(
      'createCuratedMirrorRule accepts curated, rejects non-curated source',
      true,
    );
  } else {
    record(
      'createCuratedMirrorRule accepts curated, rejects non-curated source',
      false,
      `curated accepted: ${curated_accepted} (need true); non-curated rejected: ${non_curated_rejected} (need true)`,
    );
  }
}

// --- Print results ---------------------------------------------------------
console.log('');
results.forEach((r, i) => {
  const tag = r.passed ? '[PASS]' : '[FAIL]';
  console.log(`${tag} Invariant ${i + 1}: ${r.name}`);
  if (!r.passed && r.diagnostic) {
    console.log(`        ${r.diagnostic}`);
  }
});

const passed = results.filter(r => r.passed).length;
console.log('');
console.log(`Passed: ${passed}/${results.length}`);

process.exit(passed === results.length ? 0 : 1);
