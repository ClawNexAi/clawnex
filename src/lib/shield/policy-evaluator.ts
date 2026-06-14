/**
 * Policy Evaluator — the v1 wire-active path for system + custom policy
 * rules. Loads enabled rules from SQLite once per scan, runs literal
 * substring or regex matching, applies exception suppression, computes
 * per-rule action effects, and returns detection records with full
 * provenance for the scanner to merge with ALL_RULES detections.
 *
 * Wire-active sources are 'system' and 'custom' only. 'curated' policies
 * are mirror rows for operator visibility and intentionally excluded
 * from the wire path here (internal reviewer review #1) — the underlying enforcement
 * for the curated set still runs from src/lib/shield/rules.ts via
 * ALL_RULES until Task 9 cuts that over to a fully DB-driven path.
 *
 * Regex-flag handling (Option C, operator adjudication 2026-05-02):
 * stored `rule.flags` is honored verbatim at evaluation time. The
 * normalization happens at the save boundary (createRule, updateRule,
 * seed) via src/lib/shield/regex-flags.ts which guarantees:
 *   (a) 'g' is always force-added so this evaluator's regex.exec()
 *       iteration loop collects all matches, not just the first
 *   (b) only g, i, m, s, u are accepted; d/y/anything else is rejected
 *       at save time with InvalidRegexFlagsError
 *   (c) duplicates are rejected at save time
 * The wire path therefore trusts whatever sits in policy_rules.flags
 * — there's no runtime override here. An operator who authored a
 * case-sensitive pattern gets case-sensitive matching; one who wrote
 * '/foo/i' gets case-insensitive matching. Restores the semantic
 * fidelity that Gate 2.1 added when it persisted flags but Task 7
 * had still been throwing them away.
 *
 * Action semantics (per Spec §3.2):
 *   - score:  emits a detection that flows into computeScore in scanner.ts
 *   - block:  emits a detection AND unconditionally sets verdictFloor to 'BLOCK' (overrides any prior 'REVIEW')
 *   - review: emits a detection AND raises verdictFloor to 'REVIEW'
 *             (block beats review; floor only ratchets up)
 *   - redact: emits a detection AND records full match spans into
 *             redactSpans for the scanner to consume (truncated samples
 *             on the public detection are NOT used for redaction — the
 *             internal redactSpans carry the authoritative full-match
 *             info, satisfying internal reviewer round 3 #4)
 *   - allow:  suppresses the match entirely + emits an audit row tagged
 *             suppression_kind='allow_action'
 *
 * Exception suppression is checked BEFORE action evaluation: if any
 * trimmed line in rule.exceptions is a case-insensitive substring of
 * the input, the entire rule is short-circuited and an audit row is
 * emitted with suppression_kind='exception'. This makes opt-out rules
 * (e.g. test-card-marker for sandbox PANs) cheap to express without
 * forcing operators to author negative-lookahead regexes.
 *
 * Exception matching is case-insensitive substring against the WHOLE input
 * text (not just the matched span). Authors should prefer specific phrases
 * ("[test-card-sandbox-marker]") over short tokens ("test-card") to avoid
 * suppressing unrelated content that happens to contain the exception text.
 *
 * Iteration cap: ITERATION_CAP=1000 per rule, applied to both literal
 * and regex matchers. Combined with the safe-regex2 save-time gate
 * (src/lib/shield/safe-regex.ts) this caps worst-case scan cost on
 * pathological inputs.
 *
 * Spec §3.2 + §3.2.1.
 *
 * @module shield/policy-evaluator
 */

import { v4 as uuid } from 'uuid';
import { listEnabledRulesForActivePolicies, disableRuleAutoMagic, type EnabledRuleWithPolicy } from '../db/policy-store';
import type { ShieldDetection } from '../types';
import type { RuleAction } from './types';
import { logEvent } from '../services/audit-logger';
import { RULE_KEY_FORMAT, type RedactSpan } from './redaction';

const ITERATION_CAP = 1000;
const SAMPLE_TRUNCATE = 80;

/**
 * Auto-disable threshold: a rule that hits ITERATION_CAP this many
 * consecutive scans is flipped to enabled=0 and an operator alert is
 * raised (internal reviewer review #4 layer 3, Task 23). Picked at 5 to absorb
 * transient pathological inputs (one-off long payloads) without
 * needing operator intervention, while still self-healing within a
 * short window when a rule is genuinely runaway.
 */
const DISABLE_AUTOMAGIC_THRESHOLD = 5;

/**
 * Module-scoped counter of consecutive cap-hits per rule.id. Reset on
 * any non-capped evaluation of the same rule so a single bad payload
 * doesn't accumulate toward the threshold over time — only sustained
 * runaway behavior trips auto-disable. Lives in module scope (not
 * per-call state) because the consecutive-ness signal is across-scan.
 */
const consecutiveCapHits = new Map<string, number>();

/**
 * Default confidence emitted on every policy detection. Operators can't
 * tune this in v1 — see policy-framework-design.md §3.2 for the planned
 * per-rule confidence column in v1.1+.
 */
const POLICY_RULE_DEFAULT_CONFIDENCE = 0.9;

export interface PolicyEvaluationResult {
  detections: ShieldDetection[];
  redactSpans: RedactSpan[];
  verdictFloor: 'BLOCK' | 'REVIEW' | 'ALLOW';
}

interface MatchHit {
  start: number;
  length: number;
  matched: string;
}

interface MatchResult {
  hits: MatchHit[];
  capped: boolean;
}

function matchLiteral(text: string, pattern: string): MatchResult {
  const hits: MatchHit[] = [];
  if (!pattern) return { hits, capped: false };
  const haystack = text.toLowerCase();
  const needle = pattern.toLowerCase();
  let idx = 0;
  let capped = false;
  while (idx < haystack.length) {
    if (hits.length >= ITERATION_CAP) {
      // We hit the safety cap before exhausting the input — there may
      // still be more matches downstream that we're intentionally not
      // collecting. Caller emits an audit row so this isn't silent.
      capped = true;
      break;
    }
    const found = haystack.indexOf(needle, idx);
    if (found === -1) break;
    hits.push({ start: found, length: needle.length, matched: text.slice(found, found + needle.length) });
    idx = found + needle.length;
  }
  return { hits, capped };
}

function matchRegex(text: string, patternSource: string, flags: string): MatchResult {
  const hits: MatchHit[] = [];
  let regex: RegExp;
  try {
    // Honor the stored, save-time-normalized flags (Option C contract).
    // The normalizer at src/lib/shield/regex-flags.ts guarantees 'g' is
    // present so the regex.exec() loop below collects all matches; it
    // also guarantees no unsupported chars reach this site. A runtime
    // compile error here is a "shouldn't happen" given the safe-regex2
    // save-time gate, but we still degrade gracefully rather than
    // crashing the whole scan path on one bad rule.
    regex = new RegExp(patternSource, flags);
  } catch {
    return { hits, capped: false };
  }
  let m: RegExpExecArray | null;
  let capped = false;
  while ((m = regex.exec(text)) !== null) {
    if (hits.length >= ITERATION_CAP) {
      // Same safety cap as matchLiteral — see note there.
      capped = true;
      break;
    }
    hits.push({ start: m.index, length: m[0].length, matched: m[0] });
    // Zero-width match guard: regex engines stall in an infinite loop
    // if exec() returns a zero-width match (e.g. /(?=foo)/g). Bumping
    // lastIndex by one forces forward progress.
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
  return { hits, capped };
}

function exceptionsHit(text: string, exceptionsField: string): boolean {
  if (!exceptionsField) return false;
  const lower = text.toLowerCase();
  for (const line of exceptionsField.split('\n')) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed && lower.includes(trimmed)) return true;
  }
  return false;
}

/**
 * Evaluate enabled policy rules against `text` for the given direction.
 *
 * Returns three pieces:
 *   - detections: ShieldDetection records ready to merge into the
 *     scanner's pipeline. Provenance fields (policy_id, policy_name,
 *     policy_source, policy_rule_id, rule_key, action) are always
 *     populated for downstream attribution.
 *   - redactSpans: full (start, length, rule_key) tuples for redact-
 *     action matches. Internal-only — the scanner consumes and discards
 *     these; they never cross any API boundary. This is the redaction
 *     contract: full match info stays in-process, public samples are
 *     truncated to SAMPLE_TRUNCATE chars (internal reviewer round 3 #4).
 *   - verdictFloor: 'BLOCK' if any block-action rule fired, else
 *     'REVIEW' if any review-action rule fired, else 'ALLOW'. The
 *     scanner uses this to ratchet up (never down) the final verdict.
 */
export function evaluatePolicies(text: string, direction: 'inbound' | 'outbound'): PolicyEvaluationResult {
  const detections: ShieldDetection[] = [];
  const redactSpans: RedactSpan[] = [];
  let verdictFloor: 'BLOCK' | 'REVIEW' | 'ALLOW' = 'ALLOW';

  const rules = listEnabledRulesForActivePolicies(direction);

  for (const ruleWithPolicy of rules) {
    const { policy, ...rule }: EnabledRuleWithPolicy = ruleWithPolicy;

    // Defense in depth: the SQL JOIN in policy-store.ts already excludes
    // curated policies, but a regression there would silently misclassify
    // curated rules as 'policy-custom' below. Audit + skip if it ever happens.
    if (policy.source === 'curated') {
      logEvent(
        'shield-policy-evaluator',
        'curated_policy_leaked_to_wire',
        'policy',
        policy.id,
        JSON.stringify({ rule_key: rule.rule_key }),
        'shield-policy',
      );
      continue;
    }

    const result = rule.is_regex ? matchRegex(text, rule.pattern, rule.flags) : matchLiteral(text, rule.pattern);
    const hits = result.hits;

    // Cap audit fires regardless of whether the rule then proceeds to
    // suppression/detection — the cap is a safety signal, not a gate.
    if (result.capped) {
      logEvent(
        'shield-policy-evaluator',
        'rule_iteration_capped',
        'policy_rule',
        rule.id,
        JSON.stringify({
          policy_id: rule.policy_id,
          rule_key: rule.rule_key,
          cap: ITERATION_CAP,
          hits_collected: result.hits.length,
        }),
        'shield-policy',
      );

      // Track consecutive cap hits per rule. Once we cross the threshold,
      // hand off to the auto-disable helper which flips enabled=0, audits
      // a rule_auto_disabled event, and raises a HIGH-severity alert.
      // Counter is cleared after the disable so re-enabling the rule
      // later won't immediately re-fire from stale state.
      const prev = consecutiveCapHits.get(rule.id) ?? 0;
      const next = prev + 1;
      consecutiveCapHits.set(rule.id, next);
      if (next >= DISABLE_AUTOMAGIC_THRESHOLD) {
        disableRuleAutoMagic({
          rule_id: rule.id,
          rule_key: rule.rule_key,
          policy_id: rule.policy_id,
          consecutive_hits: next,
        });
        consecutiveCapHits.delete(rule.id);
      }
    } else if (consecutiveCapHits.has(rule.id)) {
      // Successful (non-capped) eval — reset the counter so a transient
      // pathological input doesn't accumulate toward the threshold over
      // time. Only consecutive cap hits trigger auto-disable.
      consecutiveCapHits.delete(rule.id);
    }

    if (hits.length === 0) continue;

    if (exceptionsHit(text, rule.exceptions)) {
      logEvent(
        'shield-policy-evaluator',
        'rule_match_suppressed',
        'policy_rule',
        rule.id,
        JSON.stringify({
          policy_id: rule.policy_id,
          rule_key: rule.rule_key,
          suppression_kind: 'exception',
        }),
        'shield-policy',
      );
      continue;
    }

    if (rule.action === 'allow') {
      logEvent(
        'shield-policy-evaluator',
        'rule_match_suppressed',
        'policy_rule',
        rule.id,
        JSON.stringify({
          policy_id: rule.policy_id,
          rule_key: rule.rule_key,
          suppression_kind: 'allow_action',
        }),
        'shield-policy',
      );
      continue;
    }

    // Each match becomes its own redact span; the single detection emitted below
    // summarizes match count + truncated samples. Spans never cross an API boundary.
    if (rule.action === 'redact') {
      for (const hit of hits) {
        redactSpans.push({ start: hit.start, length: hit.length, rule_key: rule.rule_key, rule_id: rule.id });
      }
    }

    // Verdict floor monotonicity: block beats review; review beats
    // allow; once we've raised the floor to BLOCK we never demote it.
    if (rule.action === 'block') verdictFloor = 'BLOCK';
    else if (rule.action === 'review' && verdictFloor !== 'BLOCK') verdictFloor = 'REVIEW';

    detections.push({
      id: uuid(),
      // `name` is required on ShieldDetection — surface the operator-
      // facing rule name so dashboards/alerts have something to display.
      name: rule.name,
      severity: rule.severity,
      category: 'policy',
      confidence: POLICY_RULE_DEFAULT_CONFIDENCE,
      matchCount: hits.length,
      // Public-facing samples are truncated to SAMPLE_TRUNCATE chars.
      // The full match info lives in redactSpans (internal-only) so
      // the redaction pipeline still has authoritative data.
      samples: hits.slice(0, 5).map(h => h.matched.slice(0, SAMPLE_TRUNCATE)),
      tags: ['policy-framework', `policy:${policy.source}`],
      source: policy.source === 'system' ? 'policy-system' : 'policy-custom',
      policy_id: policy.id,
      policy_name: policy.name,
      policy_source: policy.source,
      policy_rule_id: rule.id,
      rule_key: rule.rule_key,
      action: rule.action as RuleAction,
    } as ShieldDetection);
  }

  // === Defensive redact-span resolution (internal reviewer Round-5 BLOCKERs 1, 2, 3) ===
  // All three failure modes here are valid-looking policy state that would
  // otherwise crash applySpans at runtime. The evaluator filters them
  // deterministically and emits audit rows so the operator sees what
  // happened. applySpans's fail-loud guards remain intact as the final
  // safety net for any path that bypasses this resolution.

  // (1) Skip spans whose rule_key violates the canonical format. Defense
  //     in depth — the API gates on this at save time post-Round-5, but
  //     a stray manual SQLite edit or future migration bug could still
  //     leak a bad rule_key to the wire.
  const formatFiltered: RedactSpan[] = [];
  for (const span of redactSpans) {
    if (!RULE_KEY_FORMAT.test(span.rule_key)) {
      logEvent(
        'shield-policy-evaluator',
        'redact_span_skipped',
        'policy_rule',
        span.rule_id,
        JSON.stringify({ reason: 'invalid_rule_key_format', rule_key: span.rule_key }),
        'shield-policy',
      );
      continue;
    }
    formatFiltered.push(span);
  }

  // (2) Skip zero-length spans (lookahead/lookbehind regexes that consume
  //     no characters). These would trip applySpans' length-positive guard.
  const nonZero: RedactSpan[] = [];
  for (const span of formatFiltered) {
    if (span.length <= 0) {
      logEvent(
        'shield-policy-evaluator',
        'redact_span_skipped',
        'policy_rule',
        span.rule_id,
        JSON.stringify({ reason: 'zero_length_match', rule_key: span.rule_key, start: span.start }),
        'shield-policy',
      );
      continue;
    }
    nonZero.push(span);
  }

  // (3) Greedy non-overlap selection. Sort longest-first (preserves the
  //     most specific redaction), break ties by start asc then rule_key
  //     alpha for determinism. Walk in order; accept any span that doesn't
  //     overlap an already-accepted span. Audit each drop.
  const sorted = [...nonZero].sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;        // longer first
    if (a.start !== b.start) return a.start - b.start;            // earlier wins ties
    return a.rule_key.localeCompare(b.rule_key);                  // deterministic tiebreak
  });
  const accepted: RedactSpan[] = [];
  for (const span of sorted) {
    const collides = accepted.some(a =>
      span.start < a.start + a.length && a.start < span.start + span.length,
    );
    if (collides) {
      logEvent(
        'shield-policy-evaluator',
        'redact_span_skipped',
        'policy_rule',
        span.rule_id,
        JSON.stringify({ reason: 'overlapping_redact', rule_key: span.rule_key, start: span.start, length: span.length }),
        'shield-policy',
      );
      continue;
    }
    accepted.push(span);
  }

  return { detections, redactSpans: accepted, verdictFloor };
}
