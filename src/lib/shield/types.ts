/**
 * ClawNex Shield Types — canonical type surface for both the built-in
 * scanner (`rules.ts` + `scanner.ts`) and the operator-authored policy
 * framework (`src/lib/db/policy-store.ts` + `src/lib/shield/policy-evaluator.ts`).
 *
 * Two layers live here:
 *
 *   1. **Built-in scanner shapes** — `PatternRule`, `ShieldDetection`,
 *      `ShieldScanResult`, `Verdict`. These flow through the scanner
 *      engine on every LiteLLM request and every Session Watcher pass.
 *
 *   2. **Policy framework shapes** (v0.10.0+) — `PolicySource`,
 *      `PolicyLifecycle`, `RuleAction`, `RuleDirection`, `Policy`,
 *      `PolicyRule`. These mirror the SQLite `policies` + `policy_rules`
 *      tables (see `docs/14-data-dictionary.md` §3.100a/b). The
 *      evaluator merges policy-rule matches with built-in scanner
 *      detections into a single `ShieldScanResult`.
 *
 * Every detection on the wire carries `rule_key` for audit provenance.
 * Policy-framework detections additionally carry `policy_id`,
 * `policy_name`, `policy_source`, `policy_rule_id`, and `action` so a
 * shield_review audit row can be traced back to the exact rule that
 * fired, whether it's a built-in or operator-authored rule.
 *
 * Spec cross-references:
 *   - `docs/superpowers/specs/2026-05-03-policy-framework-design.md`
 *   - `docs/02-high-level-architecture.md` §5.8 (policy evaluation flow)
 *
 * @module shield/types
 */

// ---------------------------------------------------------------------------
// Policy Framework v1 — see docs/superpowers/specs/2026-05-03-policy-framework-design.md
// ---------------------------------------------------------------------------

export type PolicySource = 'curated' | 'system' | 'custom';
export type PolicyLifecycle = 'draft' | 'lab' | 'starter' | 'strict' | 'custom';
export type RuleAction = 'score' | 'allow' | 'redact' | 'review' | 'block';
export type RuleDirection = 'inbound' | 'outbound' | 'both';

export interface Policy {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  source: PolicySource;
  lifecycle: PolicyLifecycle;
  version: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyRule {
  id: string;
  policy_id: string;
  rule_key: string;
  name: string;
  pattern: string;
  flags: string;
  is_regex: boolean;
  direction: RuleDirection;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  action: RuleAction;
  exceptions: string;
  lifecycle: PolicyLifecycle | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
