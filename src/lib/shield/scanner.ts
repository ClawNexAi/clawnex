/**
 * ClawNex Prompt Shield Scanner
 *
 * Core security engine — scans text through 163+ built-in regex-based detection rules (plus operator-authored custom rules from the policy framework)
 * across 10 categories: secrets, commands, sensitive paths, C2 patterns,
 * cognitive file tampering, trust exploitation, jailbreaks, steganography,
 * encoding attacks, and financial threats.
 *
 * Supports:
 * - Inbound scanning: detect prompt injection, jailbreak attempts, credential leaks
 * - Outbound scanning: detect data exfiltration, PII leaks, internal IP exposure
 * - PII redaction: email, phone, SSN, credit card, IP, date of birth, passport
 * - Custom deny rules: dynamically generated from access_lists DB table
 * - Whitelisting: skip specific rules for known false positives
 *
 * Verdict system:
 * - BLOCK: Any CRITICAL detection OR score ≥ 60
 * - REVIEW: Score ≥ 25 (needs human review)
 * - ALLOW: Score < 25 (safe)
 *
 * Score formula: Σ(severityWeight × confidence × min(matchCount, 5)), capped at 100
 * Severity weights: CRITICAL=30, HIGH=20, MEDIUM=10, LOW=5
 *
 * Performance: typical scan 1-30ms. Safety limit of 1000 regex iterations per rule
 * prevents catastrophic backtracking.
 *
 * Rule origins:
 * - "defenseclaw": ported from DefenseClaw (Cisco) internal gateway rules (Go → TypeScript)
 * - "clawnex": original ClawNex rules for AI-specific threats
 * - "access-list": dynamically generated from access_lists DB deny entries
 *
 * @module shield/scanner
 */

import {
  ALL_RULES,
  secretRules,
  sensitivePathRules,
  type PatternRule,
} from "./rules";
import type { ShieldScanResult, ShieldDetection } from "../types";
import { evaluatePolicies } from "./policy-evaluator";
import { applySpans } from "./redaction";
import { getActiveScanOptions } from "../services/shield-profiles";
import { enrichScanResult } from "../services/shield-standards-mapping";

// ---------------------------------------------------------------------------
// PII patterns — redaction source of truth.
//
// Detection emission for these patterns moved to the policy framework in
// Task 9 of the policy-framework cutover (commit 9093170). The matching
// pattern + severity now live in `Generic Egress Starter` system policy
// (seeded from `PII_PATTERNS_FOR_SEED` in src/lib/db/seed-policies.ts);
// the policy evaluator emits the OUT-PII-* detections at scan time, and
// scanner.ts:OUTBOUND_LEAK_RULE_KEYS restores `category="outbound-leak"`
// at the wire boundary so computeVerdict's HIGH/MEDIUM early-out keeps
// firing.
//
// What this table is for: redact() (line ~547) walks it to substitute PII
// regions with [..._REDACTED] markers in the cleaned output. Pattern + the
// replacement string are the only fields the redactor needs.
//
// To change WHAT gets emitted as a detection, edit seed-policies.ts (and
// run a fresh seed). To change WHAT gets redacted in the cleaned output,
// edit this table.
// ---------------------------------------------------------------------------

const PII_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  replacement: string;
}> = [
  { name: "email",         pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL_REDACTED]"    },
  { name: "phone_us",      pattern: /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: "[PHONE_REDACTED]" },
  { name: "ssn",           pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                          replacement: "[SSN_REDACTED]"      },
  { name: "credit_card",   pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,                    replacement: "[CC_REDACTED]"       },
  { name: "ipv4",          pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, replacement: "[IP_REDACTED]" },
  { name: "date_of_birth", pattern: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g, replacement: "[DOB_REDACTED]" },
  { name: "passport",      pattern: /\b[A-Z]{1,2}\d{6,9}\b/g,                          replacement: "[PASSPORT_REDACTED]" },
];

// (OUTBOUND_PATTERNS deleted in internal reviewer Round 6 cleanup — was retained after
// Task 9's cutover but never actually consumed by redact() or any other
// caller. The corresponding wire detections live in `Generic Egress Starter`
// via OUTBOUND_PATTERNS_FOR_SEED in seed-policies.ts; the OUTBOUND_LEAK_RULE_KEYS
// allow-list below preserves the historical category="outbound-leak" tag.)

/**
 * Rule keys whose policy-framework detections must carry
 * category="outbound-leak" so they participate in computeVerdict's
 * HIGH/MEDIUM early-out (lines 332-333). This explicit list mirrors
 * the rule_keys that previously emitted from the in-source PII_PATTERNS
 * and OUTBOUND_PATTERNS loops with that category set inline. The
 * policy evaluator hardcodes category="policy" — so we restore the
 * "outbound-leak" tag at the wire boundary in outboundScan().
 *
 * To add a new outbound-leak rule: extend this set AND add the rule
 * to seed-policies.ts (or via the operator API). the reviewer's gate-4
 * condition: changes to this set are reviewed as carefully as
 * computeVerdict changes themselves.
 */
const OUTBOUND_LEAK_RULE_KEYS: ReadonlySet<string> = new Set([
  // PII (was emitted from PII_PATTERNS loop):
  'OUT-PII-EMAIL',
  'OUT-PII-PHONE_US',
  'OUT-PII-SSN',
  'OUT-PII-CREDIT_CARD',
  'OUT-PII-IPV4',
  'OUT-PII-DATE_OF_BIRTH',
  'OUT-PII-PASSPORT',
  // OUTBOUND (was emitted from OUTBOUND_PATTERNS loop):
  'OUT-PRIVATE_KEY_MATERIAL',
  'OUT-PASSWORD_ASSIGNMENT',
  'OUT-ENV_VARIABLE_LEAK',
  'OUT-INTERNAL_IP',
  'OUT-DATABASE_URI',
]);

// ---------------------------------------------------------------------------
// Scan options
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Which rule categories to include; defaults to all */
  categories?: string[];
  /** Rule IDs to skip (e.g. cognitive-file rules for internal agent traffic) */
  whitelistRules?: string[];
  /** Tool name for confidence adjustment (optional) */
  toolName?: string;
  /** Max detections to return */
  maxDetections?: number;
  /** Include cleaned (redacted) text in result */
  includeRedacted?: boolean;
}

// ---------------------------------------------------------------------------
// Internal traffic whitelist — OpenClaw architectural exemptions.
//
// Every agent reads its own SOUL.md / IDENTITY.md / MEMORY.md / RULES.md and the
// shared openclaw.json + gateway.json on boot as part of normal operation.
// Without whitelisting these COG-* rules on internal agent traffic (LiteLLM proxy
// + session watcher), each agent boot would trigger CRITICAL "cognitive-tampering"
// detections — thousands per day on a busy OpenClaw install — drowning real threats.
//
// Scope: ONLY applied to traffic flagged as internal (LiteLLM callbacks, session
// watcher). Dashboard scans, the Prompt Shield panel's live scanner, and external
// API traffic all run every rule including these.
//
// FIN-SWIFT-CODE is deliberately NOT in this list. It is financial-leak
// detection, not an OpenClaw-internal concern, and silently exempting it would
// hide real exfiltration on agents that handle banking data. If the underlying
// regex is noisy, tighten it in rules.ts — do not hide it here.
// ---------------------------------------------------------------------------

export const INTERNAL_TRAFFIC_WHITELIST: string[] = [
  "COG-SOUL",
  "COG-IDENTITY",
  "COG-MEMORY",
  "COG-RULES",
  "COG-TOOLS-MD",
  "COG-AGENTS-MD",
  "COG-OPENCLAW-JSON",
  "COG-GATEWAY-JSON",
];

/**
 * Read the persisted whitelist from config_defaults (DB).
 * Falls back to INTERNAL_TRAFFIC_WHITELIST if not set.
 */
export function getPersistedWhitelist(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require("../db/index");
    const row = db.queryOne("SELECT value FROM config_defaults WHERE key = 'shield_whitelist'") as { value: string } | undefined;
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* DB not ready or no setting yet */ }
  return [...INTERNAL_TRAFFIC_WHITELIST];
}

// ---------------------------------------------------------------------------
// Custom deny rules from Access Lists (domain + IP deny entries)
// ---------------------------------------------------------------------------

let _denyRulesCache: PatternRule[] | null = null;
let _denyRulesCacheTime = 0;
const DENY_CACHE_TTL_MS = 30_000; // Refresh every 30 seconds

/** Escape all regex metacharacters so user-supplied strings match literally. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCustomDenyRules(): PatternRule[] {
  // Cache for 30s to avoid DB reads on every scan
  if (_denyRulesCache && Date.now() - _denyRulesCacheTime < DENY_CACHE_TTL_MS) {
    return _denyRulesCache;
  }

  const rules: PatternRule[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require("../db/index");
    const entries = db.queryAll(
      "SELECT entry_type, value, reason FROM access_lists WHERE list_type = 'deny'"
    ) as Array<{ entry_type: string; value: string; reason: string | null }>;

    for (const entry of entries) {
      const entryType = entry.entry_type.toLowerCase();
      if (entryType === "domain" && entry.value.trim()) {
        // Escape all regex metacharacters, match the domain anywhere in text
        const escaped = escapeRegex(entry.value.trim());
        rules.push({
          id: `ACL-DOMAIN-${entry.value.toUpperCase().replace(/[^A-Z0-9]/g, "-")}`,
          pattern: new RegExp(escaped, "gi"),
          title: `Blocked domain: ${entry.value}`,
          severity: "HIGH",
          confidence: 0.9,
          tags: ["access-list", "domain-block"],
          category: "c2",
          source: "access-list",
        });
      } else if (entryType === "ip" && entry.value.trim()) {
        // Escape all regex metacharacters, match IP addresses in text
        const escaped = escapeRegex(entry.value.trim());
        rules.push({
          id: `ACL-IP-${entry.value.replace(/[^0-9]/g, "-")}`,
          pattern: new RegExp(escaped, "g"),
          title: `Blocked IP: ${entry.value}`,
          severity: "HIGH",
          confidence: 0.85,
          tags: ["access-list", "ip-block"],
          category: "c2",
          source: "access-list",
        });
      }
    }
  } catch { /* DB not ready */ }

  _denyRulesCache = rules;
  _denyRulesCacheTime = Date.now();
  return rules;
}

// ---------------------------------------------------------------------------
// Core scanning
// ---------------------------------------------------------------------------

// CRITICAL #7: Unicode bypass defense. Three layers:
//
//   1. NFKC normalization — folds compatibility characters (fullwidth `ｐ`,
//      ligatures, combining-mark decompositions). Catches the most common
//      "looks the same" attacks against ASCII rules.
//
//   2. Zero-width character stripping — U+200B/200C/200D/FEFF + bidi marks
//      can be inserted mid-token to split a regex match across them. Strip
//      them before scanning so `iglnore` (with a zero-width joiner in the
//      middle) collapses to `ignore`.
//
//   3. Cross-script confusables fold — NFKC does NOT translate Cyrillic /
//      Greek lookalikes to Latin (different codepoints, different scripts).
//      A small targeted lookup table covers the high-frequency attack set:
//      Cyrillic а/е/о/р/с/у/х/А/В/Е/О/Р/С/Т/Х → Latin equivalents,
//      Greek ο/α/ε/ρ/ν → o/a/e/p/v.
//
// Together these neutralize Garak's encoding.UnicodeConfusables probe and
// the broader homoglyph-substitution class. The 163 shield rules see a
// normalized form regardless of input encoding tricks.

// Targeted homoglyph map. Limited to characters operators actually weaponize
// in attack prompts — the full Unicode confusables.txt is ~10K entries and
// would slow every scan with diminishing returns.
const CONFUSABLES: Record<string, string> = {
  // Cyrillic lowercase
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p',
  'с': 'c', 'у': 'y', 'х': 'x', 'и': 'u',
  'к': 'k', 'н': 'h', 'в': 'b', 'п': 'n',
  'ѕ': 's', 'і': 'i', 'ј': 'j',
  // Cyrillic uppercase
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K',
  'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P',
  'С': 'C', 'Т': 'T', 'Х': 'X', 'Ѕ': 'S',
  'І': 'I', 'Ј': 'J',
  // Greek
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ρ': 'p',
  'ν': 'v', 'ι': 'i', 'κ': 'k', 'τ': 't',
  'Ο': 'O', 'Α': 'A', 'Ε': 'E', 'Ρ': 'P',
  'Μ': 'M', 'Ι': 'I', 'Κ': 'K', 'Τ': 'T',
};

// Zero-width + bidi controls + variation selectors — invisible insertions
// that split tokens for regex purposes without changing visual appearance.
const ZERO_WIDTH_RE = /[​-‏‪-‮⁠-⁤﻿︀-️]/g;

function normalizeForScan(text: string): string {
  try {
    let out = text.normalize('NFKC');
    out = out.replace(ZERO_WIDTH_RE, '');
    // Cross-script fold — single-codepoint replace via array map+join.
    let folded = '';
    for (const ch of out) {
      folded += CONFUSABLES[ch] ?? ch;
    }
    return folded;
  } catch {
    // Malformed UTF-16 surrogates can throw on .normalize — fall back to
    // raw text so the scanner still runs on the un-normalized input
    // rather than treating it as scanner failure (which now fails CLOSED
    // at the caller).
    return text;
  }
}

function scanRules(text: string, rules: PatternRule[], opts?: { useRawText?: boolean }): ShieldDetection[] {
  const detections: ShieldDetection[] = [];
  // Steganography rules target the exact characters that normalizeForScan
  // strips (zero-widths, bidi overrides, BOMs). Scanning them against the
  // normalized text would always return zero matches — the artifacts have
  // already been removed. Callers pass useRawText:true for that category
  // so the rules see the unmodified payload. Every other category benefits
  // from normalization (e.g. `iglnore` with a zero-width joiner collapses
  // to `ignore` so JAIL-IGNORE-DIRECTIVES can match).
  const scanText = opts?.useRawText ? text : normalizeForScan(text);

  for (const rule of rules) {
    // Create a fresh regex to reset lastIndex for global matching
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
    const matches: string[] = [];
    let match: RegExpExecArray | null;

    // Safety limit to prevent catastrophic backtracking
    let iterations = 0;
    const MAX_ITERATIONS = 1000;

    while ((match = regex.exec(scanText)) !== null && iterations < MAX_ITERATIONS) {
      matches.push(match[0].slice(0, 80)); // Truncate long matches for samples
      iterations++;
      // Prevent infinite loops on zero-length matches
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }

    if (matches.length > 0) {
      detections.push({
        id: rule.id,
        name: rule.title,
        category: rule.category,
        severity: rule.severity,
        confidence: rule.confidence,
        matchCount: matches.length,
        samples: matches.slice(0, 5), // Limit to 5 samples
        tags: rule.tags,
        source: rule.source,
      });
    }
  }

  return detections;
}

/**
 * Score detections 0–100 based on severity and confidence.
 */
function computeScore(detections: ShieldDetection[]): number {
  if (detections.length === 0) return 0;

  const severityWeight: Record<string, number> = {
    CRITICAL: 30,
    HIGH: 20,
    MEDIUM: 10,
    LOW: 5,
  };

  let total = 0;
  for (const d of detections) {
    total += (severityWeight[d.severity] || 5) * d.confidence * Math.min(d.matchCount, 5);
  }

  return Math.min(100, Math.round(total));
}

// Outbound leaks short-circuit the aggregate-score path because aggregate
// scoring under-weights single hits. With severity weights CRITICAL/HIGH/
// MEDIUM = 30/20/10 and confidence ~0.9, a single HIGH detection scores ~18
// — below both REVIEW (25) and BLOCK (60). That meant a lone
// `OUT-PASSWORD_ASSIGNMENT` (HIGH) or `OUT-ENV_VARIABLE_LEAK` (MEDIUM)
// recorded the leak but verdict came back ALLOW and the data still left.
//
// Outbound egress is asymmetric: once data is out it can't be recalled, so
// we bias toward BLOCK/REVIEW on any outbound-leak signal in isolation.
// Inbound rules (jailbreak, prompt injection, cognitive tampering) keep
// the aggregate-score behaviour because they are noisier and rely on
// pattern co-occurrence to suppress false positives.
//
// Verdict order (first match wins):
//   1. Any CRITICAL detection             → BLOCK
//   2. Any HIGH outbound-leak             → BLOCK
//   3. Any MEDIUM outbound-leak           → REVIEW
//   4. Aggregate score ≥ 60               → BLOCK
//   5. Any HIGH detection (any category)  → REVIEW   (veracity audit V-B1)
//   6. Aggregate score ≥ 25               → REVIEW
//
// Rule 5 floor (V-B1): a HIGH-severity detection must never pass as ALLOW
// just because its isolated aggregate score sits below 25. The same gap that
// rule 2 closed for outbound-leak existed for every other HIGH category —
// a lone C2 exfil destination (webhook.site/ngrok, HIGH, score ~18), a
// reverse-shell command, or a jailbreak signature recorded the detection but
// returned ALLOW, so a sharp test ("I sent a webhook.site exfil and it said
// ALLOW") exposed it. We floor to REVIEW, NOT BLOCK: this honours the
// inbound-noise concern below (a single noisy match surfaces for human review
// rather than hard-blocking legitimate traffic, e.g. "our dev stack uses
// ngrok"). CRITICAL still hard-BLOCKs.
//
// Outbound-leak severities (see OUTBOUND_PATTERNS_FOR_SEED in seed-policies.ts):
//   HIGH     → password_assignment, database_uri
//   MEDIUM   → env_variable_leak, internal_ip
//   CRITICAL → private_key_material (already caught by rule 1)
//
// A noisy outbound-leak rule should be downgraded via the rule whitelist
// (or eventually a context-scoped policy exception); do not move it out of
// the early-out path by lowering severity.
function computeVerdict(score: number, detections: ShieldDetection[]): "BLOCK" | "REVIEW" | "ALLOW" {
  if (detections.some((d) => d.severity === "CRITICAL")) return "BLOCK";
  if (detections.some((d) => d.severity === "HIGH" && d.category === "outbound-leak")) return "BLOCK";
  if (detections.some((d) => d.severity === "MEDIUM" && d.category === "outbound-leak")) return "REVIEW";
  if (score >= 60) return "BLOCK";
  // V-B1 floor: any HIGH detection is at least REVIEW, even if the isolated
  // aggregate score is below 25. Never silently ALLOW a HIGH-severity signal.
  if (detections.some((d) => d.severity === "HIGH")) return "REVIEW";
  if (score >= 25) return "REVIEW";
  return "ALLOW";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full shield scan — runs text through all 163 built-in detections (or a subset by category). Custom policy rules are merged in by the evaluator at a separate step.
 */
export function shieldScan(text: string, options?: ScanOptions): ShieldScanResult {
  const start = performance.now();
  const activeOptions = getActiveScanOptions("inbound");
  const effectiveOptions: ScanOptions = {
    ...activeOptions,
    ...options,
    categories: options?.categories ?? activeOptions.categories,
  };

  // Select rules based on options
  let rulesToScan = ALL_RULES;
  if (effectiveOptions.categories && effectiveOptions.categories.length > 0) {
    const cats = new Set(effectiveOptions.categories.map((c) => c.toLowerCase()));
    rulesToScan = rulesToScan.filter((r) => cats.has(r.category.toLowerCase()));
  }

  // Remove whitelisted rules (e.g. cognitive-file rules for internal agent traffic)
  if (effectiveOptions.whitelistRules && effectiveOptions.whitelistRules.length > 0) {
    const skip = new Set(effectiveOptions.whitelistRules);
    rulesToScan = rulesToScan.filter((r) => !skip.has(r.id));
  }

  // Inject custom domain deny rules from access_lists
  const customRules = getCustomDenyRules();
  const allRulesToScan = customRules.length > 0 ? [...rulesToScan, ...customRules] : rulesToScan;

  // Split steganography rules out so they scan against RAW text — their
  // patterns target the exact characters normalizeForScan strips. Without
  // this split, STEG-ZERO-WIDTH and STEG-BIDI-OVERRIDE can never fire
  // (T06 'Zero-Width Injection' was the regression-grade signal).
  const stegRules = allRulesToScan.filter((r) => r.category === 'steganography');
  const nonStegRules = allRulesToScan.filter((r) => r.category !== 'steganography');
  const detections = [
    ...scanRules(text, nonStegRules),
    ...scanRules(text, stegRules, { useRawText: true }),
  ];

  // Layer in policy-framework detections (system + custom; curated is mirror).
  // This runs alongside the hardcoded ALL_RULES detection set; both feed
  // into the same computeScore + computeVerdict pipeline below.
  const policyResult = evaluatePolicies(text, 'inbound');
  detections.push(...policyResult.detections);

  // Optionally limit detections
  const maxDet = effectiveOptions.maxDetections ?? 100;
  // Sort by severity weight descending, then by confidence
  const sevOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  detections.sort((a, b) => {
    const sevDiff = (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4);
    if (sevDiff !== 0) return sevDiff;
    return b.confidence - a.confidence;
  });
  // Verdict + score evaluate the FULL detection list before we trim for the
  // response payload. Trimming is presentation (UI doesn't render 500 rows);
  // the verdict's early-out logic needs every signal so a HIGH outbound-leak
  // detection past the cap can't silently fall through to the aggregate-score
  // path. computeScore is internally capped at 100 so the full-list run can't
  // inflate the score either.
  const score = computeScore(detections);
  const verdict = computeVerdict(score, detections);

  // Apply verdict floor from per-rule action='block'/'review' early-outs
  // in the policy evaluator. Floor only raises the verdict, never lowers it.
  let finalVerdict = verdict;
  if (policyResult.verdictFloor === 'BLOCK') finalVerdict = 'BLOCK';
  else if (policyResult.verdictFloor === 'REVIEW' && finalVerdict === 'ALLOW') finalVerdict = 'REVIEW';

  const trimmedDetections = detections.slice(0, maxDet);

  // Stats
  const stats = {
    total: trimmedDetections.length,
    critical: trimmedDetections.filter((d) => d.severity === "CRITICAL").length,
    high: trimmedDetections.filter((d) => d.severity === "HIGH").length,
    medium: trimmedDetections.filter((d) => d.severity === "MEDIUM").length,
    low: trimmedDetections.filter((d) => d.severity === "LOW").length,
    categories: Array.from(new Set(trimmedDetections.map((d) => d.category))),
  };

  // Redacted text
  let cleaned = "";
  if (effectiveOptions.includeRedacted) {
    // Apply policy redact spans against the original `text` where their
    // offsets are valid, THEN run PII redaction over the result. The
    // policy spans must run first because their (start, length) tuples
    // are computed against `text`; running PII redaction first would
    // shift character positions and either silently corrupt the output
    // or trip the fail-loud guards in applySpans.
    const prepared = policyResult.redactSpans.length > 0
      ? applySpans(text, policyResult.redactSpans)
      : text;
    cleaned = redact(prepared);
  }

  const elapsed = `${(performance.now() - start).toFixed(1)}ms`;

  return enrichScanResult({
    verdict: finalVerdict,
    score,
    elapsed,
    detections: trimmedDetections,
    cleaned,
    stats,
  });
}

/**
 * Outbound scan — checks for data leaks in agent output.
 * Uses secret detection rules + outbound-specific patterns.
 */
export function outboundScan(text: string): ShieldScanResult {
  const start = performance.now();

  // Run secret rules + sensitive path rules on outbound content
  const secretDetections = scanRules(text, secretRules);
  const pathDetections = scanRules(text, sensitivePathRules);

  // OUT-* and OUT-PII-* detections previously emitted from in-source loops
  // over OUTBOUND_PATTERNS / PII_PATTERNS here. As of Task 9 (policy-
  // framework cutover) those emissions move entirely to the policy
  // evaluator path below. The pattern arrays themselves remain in this
  // file as the redaction source-of-truth for redact().
  const allDetections = [...secretDetections, ...pathDetections];

  // Layer in policy-framework detections (system + custom; curated is mirror).
  // This runs alongside the hardcoded ALL_RULES detection set; both feed
  // into the same computeScore + computeVerdict pipeline below.
  const policyResult = evaluatePolicies(text, 'outbound');
  allDetections.push(...policyResult.detections);

  // Restore category="outbound-leak" on the 12 policy detections that
  // previously emitted from the in-source PII_PATTERNS / OUTBOUND_PATTERNS
  // loops. Required for the reviewer's gate-4 standing condition: preserve the
  // HIGH/MEDIUM early-out semantics in computeVerdict (lines 332-333)
  // across the OUT-* cutover.
  for (const d of policyResult.detections) {
    if (d.rule_key && OUTBOUND_LEAK_RULE_KEYS.has(d.rule_key)) {
      d.category = 'outbound-leak';
    }
  }

  const sevOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  allDetections.sort((a, b) => (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4));

  const score = computeScore(allDetections);
  const verdict = computeVerdict(score, allDetections);

  // Apply verdict floor from per-rule action='block'/'review' early-outs
  // in the policy evaluator. Floor only raises the verdict, never lowers it.
  let finalVerdict = verdict;
  if (policyResult.verdictFloor === 'BLOCK') finalVerdict = 'BLOCK';
  else if (policyResult.verdictFloor === 'REVIEW' && finalVerdict === 'ALLOW') finalVerdict = 'REVIEW';

  const stats = {
    total: allDetections.length,
    critical: allDetections.filter((d) => d.severity === "CRITICAL").length,
    high: allDetections.filter((d) => d.severity === "HIGH").length,
    medium: allDetections.filter((d) => d.severity === "MEDIUM").length,
    low: allDetections.filter((d) => d.severity === "LOW").length,
    categories: Array.from(new Set(allDetections.map((d) => d.category))),
  };

  // Apply policy redact spans against the original `text` first (their
  // offsets are computed against `text`), then PII redaction. See the
  // shieldScan comment for the offset-shift rationale.
  const prepared = policyResult.redactSpans.length > 0
    ? applySpans(text, policyResult.redactSpans)
    : text;
  const cleaned = redact(prepared);

  const elapsed = `${(performance.now() - start).toFixed(1)}ms`;

  return enrichScanResult({
    verdict: finalVerdict,
    score,
    elapsed,
    detections: allDetections,
    cleaned,
    stats,
  });
}

/**
 * PII redaction pipeline — strips emails, phone numbers, SSNs, credit cards, IPs, etc.
 */
export function redact(text: string): string {
  let cleaned = text;
  for (const pii of PII_PATTERNS) {
    cleaned = cleaned.replace(pii.pattern, pii.replacement);
  }
  return cleaned;
}
