/**
 * Policy Framework v1 seed — populates ClawNex Default (curated mirror)
 * and Generic Egress Starter (system, runs on wire) on first start
 * after upgrade.
 *
 * Idempotent via two config_defaults keys:
 *   - policy_framework_schema_version  bumps when the table shape changes
 *   - policy_framework_seed_version    bumps when the seeded content changes
 *
 * Held drafts (JAIL-CREDENTIAL-EXTRACTION-REQUEST + OUT-GENERIC-API-KEY-SHAPE)
 * ship at lifecycle='lab', enabled=0 — visible to operators but not firing.
 *
 * @module db/seed-policies
 */

import { getDb } from './index';
import { ALL_RULES } from '../shield/rules';
// internal reviewer round 4 (2026-05-02): the prior createSeedRule was split into two
// narrowly-scoped helpers. createCuratedMirrorRule is used for the
// ClawNex Default mirror (wire-inert curated rows). createReviewedSeedRule
// is used for the 5 explicitly named false-positive rule_keys with a
// required justification parameter. All other (safe-regex2-clean) seed
// rules go through createRule with the full safety gate.
import { createPolicy, createRule, createCuratedMirrorRule, createReviewedSeedRule, getPolicyByName } from './policy-store';
import type { RuleDirection } from '../shield/types';
import { v4 as uuid } from 'uuid';

const SCHEMA_VERSION = '1';
const SEED_VERSION = '2026-05-03-v1';

// PII patterns embedded here (NOT imported from scanner.ts to avoid a
// circular dep). Kept in sync with src/lib/shield/scanner.ts PII_PATTERNS
// at write-time. If scanner.ts changes, bump SEED_VERSION and update this.
//
// Gate 2.1 fix-up: `flags` field added per scanner.ts source-of-truth so
// the regex round-trip (source + flags) survives the SQLite serialization.
// All scanner.ts PII patterns use /g, so every entry here gets `flags: 'g'`.
const PII_PATTERNS_FOR_SEED: Array<{ name: string; pattern: string; flags: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }> = [
  { name: 'EMAIL',         pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',                                                                    flags: 'g', severity: 'MEDIUM' },
  { name: 'PHONE_US',      pattern: '(?:\\+1[-.\\s]?)?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}',                                                          flags: 'g', severity: 'MEDIUM' },
  { name: 'SSN',           pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',                                                                                          flags: 'g', severity: 'HIGH' },
  { name: 'CREDIT_CARD',   pattern: '\\b(?:\\d{4}[-\\s]?){3}\\d{4}\\b',                                                                                    flags: 'g', severity: 'HIGH' },
  { name: 'IPV4',          pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b',                                  flags: 'g', severity: 'LOW' },
  { name: 'DATE_OF_BIRTH', pattern: '\\b(?:0[1-9]|1[0-2])\\/(?:0[1-9]|[12]\\d|3[01])\\/(?:19|20)\\d{2}\\b',                                                  flags: 'g', severity: 'MEDIUM' },
  { name: 'PASSPORT',      pattern: '\\b[A-Z]{1,2}\\d{6,9}\\b',                                                                                            flags: 'g', severity: 'MEDIUM' },
];

// Outbound DLP patterns. Flags per scanner.ts:
//   private_key_material, env_variable_leak, internal_ip → /g
//   password_assignment, database_uri                    → /gi (case-insensitive needed)
const OUTBOUND_PATTERNS_FOR_SEED: Array<{ name: string; pattern: string; flags: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' }> = [
  { name: 'PRIVATE_KEY_MATERIAL', pattern: '-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----',                                  flags: 'g',  severity: 'CRITICAL' },
  { name: 'PASSWORD_ASSIGNMENT',  pattern: "(?:password|passwd|pwd)\\s*[:=]\\s*['\"][^'\"]+['\"]",                                          flags: 'gi', severity: 'HIGH' },
  { name: 'ENV_VARIABLE_LEAK',    pattern: "(?:process\\.env|os\\.environ|ENV\\[)\\s*[\\[.]\\s*['\"]?\\w+['\"]?\\s*\\]?",                    flags: 'g',  severity: 'MEDIUM' },
  { name: 'INTERNAL_IP',          pattern: '(?:192\\.168|10\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01]))\\.\\d{1,3}\\.\\d{1,3}',                  flags: 'g',  severity: 'MEDIUM' },
  { name: 'DATABASE_URI',         pattern: '(?:mongodb|postgres|mysql|redis|amqp):\\/\\/[^\\s]+',                                            flags: 'gi', severity: 'HIGH' },
];

// Held drafts. Flags from the original roadmap drafts:
//   JAIL-CREDENTIAL-EXTRACTION-REQUEST → /i (case-insensitive in original draft)
//   OUT-GENERIC-API-KEY-SHAPE          → '' (no flags in original draft)
const HELD_DRAFT_RULES: Array<{
  rule_key: string;
  name: string;
  pattern: string;
  flags: string;
  direction: RuleDirection;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}> = [
  {
    rule_key: 'JAIL-CREDENTIAL-EXTRACTION-REQUEST',
    name: 'Inbound credential extraction request',
    // From docs/20-product-roadmap.md held draft — 20/20 corpus pass
    pattern: '(?:print|show|dump|reveal|list|output|give\\s+(?:me|us)|share|send|expose|leak|exfiltrate|retrieve|spit\\s+out|tell\\s+me|disclose)(?:\\s+(?:me|us))?(?:\\s+\\w+){0,3}?\\s+(?:every|all|each|any\\s+available|the\\s+(?:full|entire|complete|whole))(?:\\s+(?:of\\s+)?(?:the\\s+|your\\s+|my\\s+|our\\s+)?\\w+){0,4}?\\s+(?:api\\s*keys?|gateway\\s+tokens?|access\\s+tokens?|refresh\\s+tokens?|bearer\\s+tokens?|secrets?|passwords?|credentials?|cookies?|session\\s+tokens?|env(?:ironment)?\\s+vars?|environment\\s+variables?)\\b',
    flags: 'i',
    direction: 'inbound',
    severity: 'CRITICAL',
  },
  {
    rule_key: 'OUT-GENERIC-API-KEY-SHAPE',
    name: 'Outbound generic high-entropy API-key shape',
    // From docs/20-product-roadmap.md held draft — 33/33 corpus pass
    pattern: '\\b(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\\b|\\bwhsec_[A-Za-z0-9]{32,}\\b|\\bAKIA[0-9A-Z]{16}\\b|\\bASIA[0-9A-Z]{16}\\b|\\bgh[pousr]_[A-Za-z0-9]{36,}\\b|\\bgithub_pat_[A-Za-z0-9_]{60,}\\b|\\bxox[abprs]-[A-Za-z0-9-]{20,}\\b|(?<![A-Za-z0-9_./-])(?=[A-Za-z0-9_-]{32,100}(?![A-Za-z0-9_-]))(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[0-9])(?![0-9A-Fa-f]+(?![A-Za-z0-9_-]))[A-Za-z0-9_-]{32,100}(?![A-Za-z0-9_-])',
    flags: '',
    direction: 'outbound',
    severity: 'HIGH',
  },
];

function getConfig(key: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM config_defaults WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setConfig(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO config_defaults (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function directionForRuleCategory(category: string): RuleDirection {
  // Cognitive-file/jailbreak/trust-exploit are inbound-only; secrets and paths
  // can leak outbound too. Steganography/encoding/financial fire on either.
  if (['cognitive-file', 'jailbreak', 'trust-exploit'].includes(category)) return 'inbound';
  return 'both';
}

export function runPolicySeed(): { inserted_policies: number; inserted_rules: number; skipped: boolean } {
  const seedVersion = getConfig('policy_framework_seed_version');
  if (seedVersion === SEED_VERSION) {
    return { inserted_policies: 0, inserted_rules: 0, skipped: true };
  }

  // Gate 2.1 fix-up: wrap the entire seed body in a SQLite transaction
  // so partial failures (rule loop crash, FK violation, disk full) roll
  // back atomically. Without this, an interrupted seed could leave the
  // policy row inserted but missing rules, and the next run's
  // getPolicyByName guard would short-circuit the rule loop, locking
  // the empty state in. better-sqlite3's `db.transaction(fn)()` returns
  // a wrapped function that opens BEGIN, runs fn, COMMITs on success,
  // and ROLLBACKs on any throw.
  return getDb().transaction(() => {
    let policies = 0;
    let rules = 0;

    // ClawNex Default — curated mirror
    if (!getPolicyByName('ClawNex Default')) {
      const p = createPolicy({
        name: 'ClawNex Default',
        description: 'Curated inbound jailbreak / cognitive-tampering / secret-leak detection. Mirror of ALL_RULES — wire reads from source in v1; this row is operator-visible audit data.',
        enabled: true,
        source: 'curated',
        lifecycle: 'starter',
        version: '1.0.0',
        created_by: null,
      });
      policies++;
      // Curated mirror — wire-inert, source: 'curated'. createCuratedMirrorRule
      // verifies parent policy.source === 'curated' and runs compile-only check
      // (skips safe-regex2 AST inspection because curated rows never load into
      // the wire scan path; see policy-store.ts header for threat model).
      for (const rule of ALL_RULES) {
        createCuratedMirrorRule({
          policy_id: p.id,
          rule_key: rule.id,
          name: rule.title,
          pattern: rule.pattern.source,
          flags: rule.pattern.flags, // Gate 2.1 fix-up: preserves /i, /g, /gi etc.
          is_regex: true,
          direction: directionForRuleCategory(rule.category),
          severity: rule.severity,
          action: 'score',
          exceptions: '',
          lifecycle: null,
          enabled: true,
        });
        rules++;
      }
    }

    // Generic Egress Starter — system, runs on wire
    if (!getPolicyByName('Generic Egress Starter')) {
      const p = createPolicy({
        name: 'Generic Egress Starter',
        description: 'Outbound DLP starter pack — PII detection, secret leakage, password assignments, env-var leaks. Runs on the wire from SQLite.',
        enabled: true,
        source: 'system',
        lifecycle: 'starter',
        version: '1.0.0',
        created_by: null,
      });
      policies++;

      // PII rules split by safe-regex2 verdict (internal reviewer round 4 — 2026-05-02):
      //   - EMAIL, SSN, DATE_OF_BIRTH, PASSPORT → safe-regex2-clean → createRule (full gate)
      //   - PHONE_US, CREDIT_CARD, IPV4         → safe-regex2 false positive → createReviewedSeedRule
      // Per-rule justifications below name the bounded-by-construction property
      // that makes each pattern safe in practice despite the heuristic flag.
      const PII_REVIEWED_REASONS: Record<string, string> = {
        PHONE_US:    'safe-regex2 false positive: bounded fixed-width phone pattern, no nested unbounded quantifiers, runs in scanner.ts wire path without ReDoS history',
        CREDIT_CARD: 'safe-regex2 false positive: outer {3} quantifier bounds the alternation; pattern is fixed-width 16 digits',
        IPV4:        'safe-regex2 false positive: bounded character classes (25[0-5] etc.) with {3} outer cap; fixed-width address',
      };

      for (const pii of PII_PATTERNS_FOR_SEED) {
        const ruleRow = {
          policy_id: p.id,
          rule_key: `OUT-PII-${pii.name}`,
          name: `Outbound PII: ${pii.name.toLowerCase().replace(/_/g, ' ')}`,
          pattern: pii.pattern,
          flags: pii.flags,
          is_regex: true,
          direction: 'outbound' as RuleDirection,
          severity: pii.severity,
          action: 'score' as const,
          exceptions: '',
          lifecycle: null,
          enabled: true,
        };
        const reason = PII_REVIEWED_REASONS[pii.name];
        if (reason) {
          createReviewedSeedRule(ruleRow, reason);
        } else {
          createRule(ruleRow);
        }
        rules++;
      }

      // Outbound DLP — all 5 are safe-regex2-clean, full gate via createRule.
      for (const ob of OUTBOUND_PATTERNS_FOR_SEED) {
        createRule({
          policy_id: p.id,
          rule_key: `OUT-${ob.name}`,
          name: `Outbound: ${ob.name.toLowerCase().replace(/_/g, ' ')}`,
          pattern: ob.pattern,
          flags: ob.flags,
          is_regex: true,
          direction: 'outbound',
          severity: ob.severity,
          action: 'score',
          exceptions: '',
          lifecycle: null,
          enabled: true,
        });
        rules++;
      }

      // Held drafts — both safe-regex2 false-positives, ship visible-but-disabled.
      // enabled=false on insert; future enable via API/UI requires fresh explicit
      // code-reviewed safety exemption — see Task 9 acceptance condition in plan
      // and the procedural Gate 4 condition in createReviewedSeedRule's header.
      const HELD_DRAFT_REASONS: Record<string, string> = {
        'JAIL-CREDENTIAL-EXTRACTION-REQUEST': 'safe-regex2 false positive: alternation with bounded {0,3}? and {0,4}? non-greedy quantifiers; held draft, ships disabled',
        'OUT-GENERIC-API-KEY-SHAPE':          'safe-regex2 false positive: complex zero-width lookaheads with bounded [A-Za-z0-9_-]{32,100} cap; held draft, ships disabled',
      };

      for (const draft of HELD_DRAFT_RULES) {
        const reason = HELD_DRAFT_REASONS[draft.rule_key];
        if (!reason) {
          throw new Error(`seed-policies: missing HELD_DRAFT_REASONS entry for ${draft.rule_key} — every held draft must carry an explicit safety_exemption_reason`);
        }
        createReviewedSeedRule({
          policy_id: p.id,
          rule_key: draft.rule_key,
          name: draft.name,
          pattern: draft.pattern,
          flags: draft.flags,
          is_regex: true,
          direction: draft.direction,
          severity: draft.severity,
          action: 'score',
          exceptions: '',
          lifecycle: 'lab',
          enabled: false, // visible-but-disabled per spec §A
        }, reason);
        rules++;
      }
    }

    setConfig('policy_framework_schema_version', SCHEMA_VERSION);
    setConfig('policy_framework_seed_version', SEED_VERSION);

    // Audit the migration completion. Gate 2.1 fix-up: enriched detail
    // includes by_source + by_lifecycle aggregates so verify-policy-framework.ts
    // (Task 9) and the reviewer's compliance review can answer "how many of each"
    // from the audit row alone (no need to re-query the policy_rules table).
    // The (rules - 2) accounts for the 2 LAB held drafts being separate
    // from the starter-grade rule body.
    const db = getDb();
    const auditId = uuid();
    db.prepare(`
      INSERT INTO audit_log (id, actor, action, detail, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(auditId, 'system', 'policy_framework_migration', JSON.stringify({
      schema_version: SCHEMA_VERSION,
      seed_version: SEED_VERSION,
      policies_inserted: policies,
      rules_inserted: rules,
      by_source: { curated: 1, system: 1 },
      by_lifecycle: { starter: rules - 2, lab: 2 },
    }), 'policy_seed', new Date().toISOString());

    return { inserted_policies: policies, inserted_rules: rules, skipped: false };
  })();
}
