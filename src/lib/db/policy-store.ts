/**
 * PolicyStore — typed CRUD over the policies + policy_rules tables.
 *
 * Wraps better-sqlite3 prepared statements with the Policy/PolicyRule
 * domain types from src/lib/shield/types.ts. Boolean fields are
 * stored as 0/1 integers in SQLite; the wrapper handles the conversion
 * so callers always work with `true`/`false`.
 *
 * @module db/policy-store
 */

import { getDb } from './index';
import type { Policy, PolicyRule, PolicySource, PolicyLifecycle, RuleAction, RuleDirection } from '../shield/types';
import { normalizeRegexFlags } from '../shield/regex-flags';
import { assertRegexSafety, assertRegexCompiles } from '../shield/safe-regex';
import { logEvent } from '../services/audit-logger';
import { createAlert } from '../services/alert-manager';
import { v4 as uuid } from 'uuid';

// =====================================================================
// Reviewed exemption allow-list (single source of truth — internal reviewer round 4).
//
// Five rule_keys whose patterns false-positive on safe-regex2's static
// heuristic but have shipped on the wire for months (or ship visible-
// but-disabled as held drafts) without ReDoS incident. Adding new keys
// here requires a git review — the constant is intentionally a literal
// Set so PRs that mutate it surface as a textual diff.
//
// Each key is paired with a per-rule justification at the call site in
// seed-policies.ts (mandatory `safety_exemption_reason` parameter to
// createReviewedSeedRule). Do NOT duplicate this list anywhere else;
// consumers should read it through createReviewedSeedRule's gate.
//
// Procedural Gate 4 condition: rules inserted via createReviewedSeedRule
// may NOT be promoted to wire-active behavior (enabled=true, system
// source) by API/UI/migration without either passing current
// checkRegexSafety OR receiving a fresh code-reviewed exemption. Until
// column-level exemption tracking ships (deferred), enforcement is
// procedural — review every enabled:false → enabled:true patch on these
// rule_keys as if it were a brand-new operator-authored rule.
// =====================================================================
const REVIEWED_EXEMPTION_ALLOW_LIST: ReadonlySet<string> = new Set([
  'OUT-PII-PHONE_US',
  'OUT-PII-CREDIT_CARD',
  'OUT-PII-IPV4',
  'JAIL-CREDENTIAL-EXTRACTION-REQUEST',
  'OUT-GENERIC-API-KEY-SHAPE',
]);

// Lazy db handle (Gate 2.1 fix-up). Was previously `const db = getDb()`
// at module-scope, but that triggered TDZ ReferenceErrors on first-import
// paths where seed-policies.ts is imported before db/index.ts initializers
// resolve (test agents, verify-policy-framework.ts in Task 9). The eager
// call re-entered the seed module mid-init and tripped a "Cannot access
// SEED_VERSION before initialization" that index.ts's seed try/catch
// then swallowed silently. Lazy getter via `db()` defers the call to
// the first prepared-statement build, by which time all const initializers
// in the import graph have settled. better-sqlite3's process-wide
// singleton means this is still a one-time cost in practice.
function db() { return getDb(); }

interface PolicyRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  source: PolicySource;
  lifecycle: PolicyLifecycle;
  version: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PolicyRuleRow {
  id: string;
  policy_id: string;
  rule_key: string;
  name: string;
  pattern: string;
  flags: string;
  is_regex: number;
  direction: RuleDirection;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  action: RuleAction;
  exceptions: string;
  lifecycle: PolicyLifecycle | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToPolicy(r: PolicyRow): Policy {
  return { ...r, enabled: r.enabled === 1 };
}

function rowToRule(r: PolicyRuleRow): PolicyRule {
  return { ...r, is_regex: r.is_regex === 1, enabled: r.enabled === 1 };
}

export function listPolicies(): Policy[] {
  const rows = db().prepare(`SELECT * FROM policies ORDER BY source, name`).all() as PolicyRow[];
  return rows.map(rowToPolicy);
}

export function getPolicy(id: string): Policy | null {
  const row = db().prepare(`SELECT * FROM policies WHERE id = ?`).get(id) as PolicyRow | undefined;
  return row ? rowToPolicy(row) : null;
}

export function getPolicyByName(name: string): Policy | null {
  const row = db().prepare(`SELECT * FROM policies WHERE name = ?`).get(name) as PolicyRow | undefined;
  return row ? rowToPolicy(row) : null;
}

export function createPolicy(p: Omit<Policy, 'id' | 'created_at' | 'updated_at'>): Policy {
  const id = uuid();
  const now = new Date().toISOString();
  db().prepare(`
    INSERT INTO policies (id, name, description, enabled, source, lifecycle, version, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, p.name, p.description, p.enabled ? 1 : 0, p.source, p.lifecycle, p.version, p.created_by, now, now);
  return getPolicy(id)!;
}

export function updatePolicy(id: string, patch: Partial<Pick<Policy, 'name' | 'description' | 'enabled' | 'lifecycle' | 'version'>>): Policy | null {
  const existing = getPolicy(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const next = { ...existing, ...patch };
  db().prepare(`
    UPDATE policies SET name = ?, description = ?, enabled = ?, lifecycle = ?, version = ?, updated_at = ?
    WHERE id = ?
  `).run(next.name, next.description, next.enabled ? 1 : 0, next.lifecycle, next.version, now, id);
  return getPolicy(id);
}

export function deletePolicy(id: string): boolean {
  const result = db().prepare(`DELETE FROM policies WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function listRulesForPolicy(policyId: string): PolicyRule[] {
  const rows = db().prepare(`
    SELECT * FROM policy_rules WHERE policy_id = ? ORDER BY rule_key
  `).all(policyId) as PolicyRuleRow[];
  return rows.map(rowToRule);
}

export type EnabledRuleWithPolicy = PolicyRule & {
  policy: Pick<Policy, 'id' | 'name' | 'source' | 'enabled' | 'lifecycle'>;
};

export function listEnabledRulesForActivePolicies(direction: 'inbound' | 'outbound'): EnabledRuleWithPolicy[] {
  const rows = db().prepare(`
    SELECT pr.*, p.name AS p_name, p.source AS p_source, p.enabled AS p_enabled, p.lifecycle AS p_lifecycle
    FROM policy_rules pr
    JOIN policies p ON pr.policy_id = p.id
    WHERE p.enabled = 1
      AND p.source IN ('system', 'custom')
      AND pr.enabled = 1
      AND (pr.direction = ? OR pr.direction = 'both')
  `).all(direction) as Array<PolicyRuleRow & { p_name: string; p_source: PolicySource; p_enabled: number; p_lifecycle: PolicyLifecycle }>;
  return rows.map(r => ({
    ...rowToRule(r),
    policy: { id: r.policy_id, name: r.p_name, source: r.p_source, enabled: r.p_enabled === 1, lifecycle: r.p_lifecycle },
  }));
}

export function getRule(id: string): PolicyRule | null {
  const row = db().prepare(`SELECT * FROM policy_rules WHERE id = ?`).get(id) as PolicyRuleRow | undefined;
  return row ? rowToRule(row) : null;
}

export function createRule(r: Omit<PolicyRule, 'id' | 'created_at' | 'updated_at'>): PolicyRule {
  const id = uuid();
  const now = new Date().toISOString();
  // Normalize flags at the save boundary (Option C contract). Forces 'g',
  // sorts canonically, rejects unsupported/duplicate chars by throwing
  // InvalidRegexFlagsError. The throw propagates to the API layer where
  // it becomes a 400. See src/lib/shield/regex-flags.ts.
  const normalizedFlags = normalizeRegexFlags(r.flags);
  // Save-time ReDoS gate (internal reviewer BLOCKER fix 2026-05-02). Only regex rules
  // are checked; literal patterns are matched via indexOf and can never
  // backtrack. Order matters — flags get normalized first because the
  // syntax compile inside assertRegexSafety uses the normalized flags
  // (e.g. \p{...} requires 'u'). Throws InvalidRegexPatternError on
  // length-cap, syntax, or safe-regex2 AST failure; the API layer maps
  // it to a 400 with structured reason.
  if (r.is_regex) {
    assertRegexSafety(r.pattern, normalizedFlags);
  }
  db().prepare(`
    INSERT INTO policy_rules (id, policy_id, rule_key, name, pattern, flags, is_regex, direction, severity, action, exceptions, lifecycle, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, r.policy_id, r.rule_key, r.name, r.pattern, normalizedFlags, r.is_regex ? 1 : 0, r.direction, r.severity, r.action, r.exceptions, r.lifecycle, r.enabled ? 1 : 0, now, now);
  return getRule(id)!;
}

/**
 * Curated-mirror seed helper — for ClawNex Default ONLY.
 *
 * Threat model:
 * - Used exclusively to insert ALL_RULES rows into the curated mirror
 *   policy (`source: 'curated'`). The curated mirror is operator-visible
 *   audit data, NEVER loaded into the wire scan path — `scanner.ts` reads
 *   `ALL_RULES` directly from source in v1, and `evaluatePolicies` in
 *   policy-evaluator.ts excludes `source = 'curated'` from the
 *   wire-active rule set (Invariant #1 enforces this).
 * - Because the rows are wire-inert, the safe-regex2 AST inspection is
 *   skipped — a number of `ALL_RULES` patterns false-positive on the
 *   heuristic and would prevent the seed from completing without adding
 *   real safety value. The compile check (length cap + RegExp syntax)
 *   still fires so genuinely broken patterns surface immediately.
 * - Not exposed via any API path. Importing this from a non-seed module
 *   should be treated as a code-review red flag.
 *
 * Source guard: looks up the parent policy and rejects if its `source`
 * is anything other than `'curated'`. Callers cannot lie about source by
 * passing it in directly — the source-of-truth is the parent policy row.
 */
export function createCuratedMirrorRule(r: Omit<PolicyRule, 'id' | 'created_at' | 'updated_at'>): PolicyRule {
  const policy = getPolicy(r.policy_id);
  if (!policy || policy.source !== 'curated') {
    throw new Error(`createCuratedMirrorRule: parent policy ${r.policy_id} has source '${policy?.source ?? 'NOT FOUND'}', expected 'curated'. Use createRule() for system/custom policies or createReviewedSeedRule() for the 5 named false-positive exemptions.`);
  }
  const id = uuid();
  const now = new Date().toISOString();
  // Normalize flags first — assertRegexCompiles uses the normalized form
  // so the syntax check sees the flags the runtime will see.
  const normalizedFlags = normalizeRegexFlags(r.flags);
  if (r.is_regex) {
    assertRegexCompiles(r.pattern, normalizedFlags);
  }
  db().prepare(`
    INSERT INTO policy_rules (id, policy_id, rule_key, name, pattern, flags, is_regex, direction, severity, action, exceptions, lifecycle, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, r.policy_id, r.rule_key, r.name, r.pattern, normalizedFlags, r.is_regex ? 1 : 0, r.direction, r.severity, r.action, r.exceptions, r.lifecycle, r.enabled ? 1 : 0, now, now);
  // Per-rule audit so forensic queries can answer "who/when/which rule"
  // by rule_key without scanning the whole policy.
  logEvent('shield-policy-seed', 'curated_mirror_seeded', 'policy_rule', id, JSON.stringify({ rule_key: r.rule_key }), 'shield-policy');
  return getRule(id)!;
}

/**
 * Reviewed-seed safety-exemption helper — for the 5 explicitly named
 * false-positive rule_keys ONLY.
 *
 * Allow-list (REVIEWED_EXEMPTION_ALLOW_LIST above):
 *   - OUT-PII-PHONE_US               — bounded fixed-width phone pattern
 *   - OUT-PII-CREDIT_CARD            — outer {3} bounds the alternation
 *   - OUT-PII-IPV4                   — bounded char classes (25[0-5] etc.)
 *   - JAIL-CREDENTIAL-EXTRACTION-REQUEST — bounded {0,3}? / {0,4}? quants
 *   - OUT-GENERIC-API-KEY-SHAPE      — complex zero-width lookaheads with
 *                                       bounded {32,100} cap
 *
 * Each shipped on the wire for months (or ships visible-but-disabled as
 * a held draft) without ReDoS incident. safe-regex2's heuristic flags
 * them as nested-quantifier shapes; manual review confirms each is
 * bounded by construction. The exemption is NOT a blanket bypass — it's
 * scoped to these 5 rule_keys and gated by a required justification.
 *
 * Rename history (internal reviewer round 4 — 2026-05-02):
 *   The prior `createSeedRule` was too generic — its name didn't
 *   communicate the bypass and its body had no constraint on which
 *   rules could use it. internal reviewer split it into this helper +
 *   createCuratedMirrorRule, each with its own threat model.
 *
 * Procedural Gate 4 condition (re-stated from the allow-list comment):
 *   Rules inserted via this helper may NOT be promoted to wire-active
 *   behavior (enabled=true, system source) by API/UI/migration unless
 *   they either pass current checkRegexSafety OR receive a fresh
 *   code-reviewed exemption. Until column-level exemption tracking
 *   ships, enforcement is procedural.
 *
 * Guards (all throw on violation, descriptive error):
 *   1. r.rule_key ∈ REVIEWED_EXEMPTION_ALLOW_LIST
 *   2. safety_exemption_reason.trim() !== ''
 *   3. parent policy.source !== 'custom' (operator path can't reach this)
 *   4. assertRegexCompiles(pattern, normalizedFlags) — length + syntax
 *
 * Audit: `seed_rule_safety_exempted` with `{ rule_key, safety_exemption_reason }`
 * in detail so the exempted rule + justification are queryable from the
 * audit log alone.
 *
 * Not exposed via any API path.
 */
export function createReviewedSeedRule(
  r: Omit<PolicyRule, 'id' | 'created_at' | 'updated_at'>,
  safety_exemption_reason: string,
): PolicyRule {
  if (!REVIEWED_EXEMPTION_ALLOW_LIST.has(r.rule_key)) {
    throw new Error(`createReviewedSeedRule: rule_key '${r.rule_key}' is not in REVIEWED_EXEMPTION_ALLOW_LIST (see policy-store.ts). Adding new exemptions requires editing the allow-list constant in source. Use createRule() for safe-regex2-clean operator/system rules or createCuratedMirrorRule() for ClawNex Default mirror inserts.`);
  }
  if (typeof safety_exemption_reason !== 'string' || safety_exemption_reason.trim() === '') {
    throw new Error(`createReviewedSeedRule: safety_exemption_reason is required and must be a non-whitespace string explaining the false-positive class (e.g. "safe-regex2 false positive: bounded {3} quantifier on alternation").`);
  }
  const policy = getPolicy(r.policy_id);
  if (!policy) {
    throw new Error(`createReviewedSeedRule: parent policy ${r.policy_id} NOT FOUND.`);
  }
  if (policy.source === 'custom') {
    throw new Error(`createReviewedSeedRule: parent policy ${r.policy_id} has source 'custom', which is not allowed. Reviewed-seed exemptions are reserved for system/curated seed paths, not operator-authored policies.`);
  }
  const id = uuid();
  const now = new Date().toISOString();
  // Normalize flags first — assertRegexCompiles uses the normalized form
  // so the syntax check sees the flags the runtime will see.
  const normalizedFlags = normalizeRegexFlags(r.flags);
  if (r.is_regex) {
    assertRegexCompiles(r.pattern, normalizedFlags);
  }
  db().prepare(`
    INSERT INTO policy_rules (id, policy_id, rule_key, name, pattern, flags, is_regex, direction, severity, action, exceptions, lifecycle, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, r.policy_id, r.rule_key, r.name, r.pattern, normalizedFlags, r.is_regex ? 1 : 0, r.direction, r.severity, r.action, r.exceptions, r.lifecycle, r.enabled ? 1 : 0, now, now);
  // Audit with the justification embedded so the exempted rule + reason
  // are queryable from the audit log alone (no source-code spelunking).
  logEvent(
    'shield-policy-seed',
    'seed_rule_safety_exempted',
    'policy_rule',
    id,
    JSON.stringify({ rule_key: r.rule_key, safety_exemption_reason }),
    'shield-policy',
  );
  return getRule(id)!;
}

export function updateRule(id: string, patch: Partial<Omit<PolicyRule, 'id' | 'policy_id' | 'created_at' | 'updated_at'>>): PolicyRule | null {
  const existing = getRule(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  // Same normalization contract as createRule, but only when the patch
  // actually carries a flags value — otherwise we'd re-normalize the
  // already-canonical stored value (which would still be a no-op, but
  // it'd be unnecessary work and would muddy intent at the call site).
  const next = { ...existing, ...patch };
  if (patch.flags !== undefined) {
    next.flags = normalizeRegexFlags(patch.flags);
  }
  // Save-time ReDoS gate (internal reviewer BLOCKER fix + internal reviewer correction 2026-05-02).
  // Whenever the post-patch state has is_regex=true, run the gate —
  // regardless of which field(s) were patched. the reviewer's correction:
  // a flags-only patch can surface a previously-hidden compile failure
  // (e.g. \u{110000} compiles under '' but fails under 'u' as
  // "Invalid Unicode escape"). The simple form — "if the resulting
  // rule is a regex, re-validate" — is defensively correct and avoids
  // the trap of trying to enumerate which patch shapes can break
  // compilation. Uses normalized flags so the syntax compile sees
  // what the runtime will see.
  if (next.is_regex === true) {
    assertRegexSafety(next.pattern, next.flags);
  }
  db().prepare(`
    UPDATE policy_rules SET rule_key = ?, name = ?, pattern = ?, flags = ?, is_regex = ?, direction = ?, severity = ?, action = ?, exceptions = ?, lifecycle = ?, enabled = ?, updated_at = ?
    WHERE id = ?
  `).run(next.rule_key, next.name, next.pattern, next.flags, next.is_regex ? 1 : 0, next.direction, next.severity, next.action, next.exceptions, next.lifecycle, next.enabled ? 1 : 0, now, id);
  return getRule(id);
}

export function deleteRule(id: string): boolean {
  const result = db().prepare(`DELETE FROM policy_rules WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function countRulesForPolicy(policyId: string): number {
  const row = db().prepare(`SELECT COUNT(*) AS cnt FROM policy_rules WHERE policy_id = ?`).get(policyId) as { cnt: number };
  return row.cnt;
}

/**
 * Auto-disable a rule that has hit the iteration cap N consecutive
 * times. Called from the evaluator (policy-evaluator.ts) when a rule's
 * consecutive-cap-hit counter reaches DISABLE_AUTOMAGIC_THRESHOLD.
 *
 * Effects:
 *   1. Sets policy_rules.enabled = 0 for the rule
 *   2. Writes a rule_auto_disabled audit event
 *   3. Inserts a HIGH-severity alert via the existing alerts service so
 *      operators see this in the dashboard alert feed
 *
 * Idempotent: calling on an already-disabled rule (or a missing one) is
 * a no-op (no second audit, no second alert) — the evaluator counter
 * resets after disable so this should never re-fire, but the no-op
 * guard is cheap defense in depth.
 *
 * internal reviewer review #4 layer 3, Task 23.
 *
 * @module db/policy-store
 */
export function disableRuleAutoMagic(opts: {
  rule_id: string;
  rule_key: string;
  policy_id: string;
  consecutive_hits: number;
}): void {
  const rule = getRule(opts.rule_id);
  if (!rule || !rule.enabled) return; // idempotent — no double-fire

  // 1. Disable the rule. Single UPDATE on the canonical column; no need
  //    to round-trip through updateRule() (which would re-validate the
  //    pattern and could throw if a previously-valid pattern now trips
  //    the safe-regex2 gate — the auto-disable path must always succeed).
  db().prepare(`UPDATE policy_rules SET enabled = 0, updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), opts.rule_id);

  // 2. Audit event so operators can answer "which rule, why, when" from
  //    the audit log alone. Detail mirrors the rule_iteration_capped
  //    shape (policy_id + rule_key + reason) plus consecutive_hits so
  //    the threshold crossing is observable.
  logEvent(
    'shield-policy-evaluator',
    'rule_auto_disabled',
    'policy_rule',
    opts.rule_id,
    JSON.stringify({
      policy_id: opts.policy_id,
      rule_key: opts.rule_key,
      reason: 'iteration_cap_hit',
      consecutive_hits: opts.consecutive_hits,
    }),
    'shield-policy',
  );

  // 3. HIGH-severity alert so the operator sees this in the dashboard
  //    alert feed without having to grep the audit log. createAlert
  //    handles dedup (5-min window on title+source) so a flapping rule
  //    won't spam the feed if somehow re-triggered before disable lands.
  //    Metadata carries policy_id + rule_key + threshold context so the
  //    alert detail panel has everything for triage.
  createAlert(
    `Rule ${opts.rule_key} auto-disabled (iteration cap)`,
    `Rule ${opts.rule_key} hit the runtime iteration cap ${opts.consecutive_hits} consecutive scans and was auto-disabled. Re-enable from Configuration → Policies & Rules after reviewing the pattern.`,
    'HIGH',
    'shield-policy',
    {
      policy_id: opts.policy_id,
      rule_id: opts.rule_id,
      rule_key: opts.rule_key,
      reason: 'iteration_cap_hit',
      consecutive_hits: opts.consecutive_hits,
    },
  );
}
