/**
 * Save-time ReDoS gate. Wraps safe-regex2's static heuristic so the
 * policy framework rejects obviously-pathological regex patterns at
 * the rule create/edit boundary.
 *
 * Why not Promise.race with a timeout? Catastrophic regex blocks the
 * Node event loop synchronously — a Promise-based timeout never fires.
 * safe-regex2 inspects the AST instead, catching nested-quantifier shapes
 * (e.g. (a+)+). Some alternation-overlap shapes (e.g. (a|a)*) slip through
 * the static check and are caught by the runtime iteration cap in
 * policy-evaluator.ts (Layer 3 in the three-layer ReDoS defense).
 *
 * Save-path wiring (internal reviewer BLOCKER fix 2026-05-02 + internal reviewer correction
 * 2026-05-02): the gate is enforced by PolicyStore.createRule (always,
 * when is_regex=true) and PolicyStore.updateRule (whenever the resulting
 * state has is_regex=true — regardless of which field was patched, since
 * a flags-only patch can surface a previously-hidden compile failure
 * such as `\u{110000}` becoming "Invalid Unicode escape" under the `u`
 * flag). Use assertRegexSafety from those callers — it throws
 * InvalidRegexPatternError on failure so the API layer can map it to
 * a 400 with a structured reason. The createCuratedMirrorRule and
 * createReviewedSeedRule paths use assertRegexCompiles instead — they
 * skip the safe-regex2 AST inspection but still enforce length cap +
 * RegExp syntax compile (see policy-store.ts headers for rationale).
 *
 * @module shield/safe-regex
 */

import isSafeRegex from 'safe-regex2'; // safe-regex2 5.x is CommonJS — default import works via esModuleInterop.

const PATTERN_LENGTH_CAP = 1024;

export interface RegexCheckResult {
  ok: boolean;
  /** Stable failure-class discriminator — UI can render per-cause affordances without substring-matching `reason`. */
  code?: 'TOO_LONG' | 'BAD_SYNTAX' | 'UNSAFE';
  /** Operator-facing explanation. Free-form; may evolve. Use `code` for programmatic branching. */
  reason?: string;
}

/**
 * Thrown by assertRegexSafety when the candidate pattern fails any
 * of the save-time checks. Save-boundary callers (createRule,
 * updateRule) let this propagate so the API layer can map it to a
 * 400 with a human-readable reason. Mirrors InvalidRegexFlagsError
 * shape from regex-flags.ts.
 */
export class InvalidRegexPatternError extends Error {
  readonly code: 'TOO_LONG' | 'BAD_SYNTAX' | 'UNSAFE';
  constructor(pattern: string, code: 'TOO_LONG' | 'BAD_SYNTAX' | 'UNSAFE', reason: string) {
    super(`Invalid regex pattern (${code}): ${reason}`);
    this.name = 'InvalidRegexPatternError';
    this.code = code;
  }
}

/**
 * Compile-only check: enforces the 1024-char length cap + a `new RegExp`
 * syntax compile under the supplied (already-normalized) flags. Does NOT
 * run safe-regex2's AST inspection.
 *
 * Used by the reviewed-seed and curated-mirror paths
 * (createReviewedSeedRule + createCuratedMirrorRule in policy-store.ts)
 * where the safe-regex2 heuristic produces false positives on bounded
 * patterns that have been hand-reviewed and shipped on the wire for
 * months without ReDoS incident. The compile check still fires so the
 * length cap and syntax errors are caught — only the heuristic AST
 * inspection is skipped.
 *
 * Throws InvalidRegexPatternError on failure with the same shape as
 * assertRegexSafety so the API/audit layers see a uniform error type.
 */
export function assertRegexCompiles(pattern: string, flags = ''): void {
  if (pattern.length > PATTERN_LENGTH_CAP) {
    throw new InvalidRegexPatternError(pattern, 'TOO_LONG', `Pattern exceeds ${PATTERN_LENGTH_CAP}-character limit. Simplify or split into multiple rules.`);
  }
  try {
    new RegExp(pattern, flags);
  } catch (err) {
    throw new InvalidRegexPatternError(pattern, 'BAD_SYNTAX', `Invalid regex syntax: ${(err as Error).message}`);
  }
}

/**
 * Run the three save-time checks against a candidate pattern:
 *   1. Length cap (1024 chars) — Layer 2.
 *   2. Syntax compiles via new RegExp(pattern, flags). Flags matter
 *      because some valid patterns (e.g. \p{Letter}) only compile with
 *      'u' set; the safe-regex2 AST inspection itself is flag-agnostic
 *      (it inspects the pattern source) but the syntax check needs the
 *      same flags the runtime will use.
 *   3. safe-regex2 AST heuristic — Layer 1.
 *
 * Implementation: the compile check (1) + (2) is delegated to
 * assertRegexCompiles so the bypass paths can reuse it without duplication.
 * assertRegexSafety chains on the safe-regex2 layer.
 */
export function checkRegexSafety(pattern: string, flags = ''): RegexCheckResult {
  try {
    assertRegexCompiles(pattern, flags);
  } catch (err) {
    if (err instanceof InvalidRegexPatternError) {
      // Strip the "Invalid regex pattern (CODE): " prefix that
      // InvalidRegexPatternError prepends to err.message — we want only
      // the human reason in the result struct so callers can format as
      // they like.
      const prefix = `Invalid regex pattern (${err.code}): `;
      const reason = err.message.startsWith(prefix) ? err.message.slice(prefix.length) : err.message;
      return { ok: false, code: err.code, reason };
    }
    throw err;
  }
  if (!isSafeRegex(pattern)) {
    return { ok: false, code: 'UNSAFE', reason: 'Pattern flagged by safe-regex2 — likely contains nested quantifiers or alternation explosions that can cause catastrophic backtracking. Simplify or use literal substring instead.' };
  }
  return { ok: true };
}

/**
 * Throw-or-pass wrapper around checkRegexSafety. Used by save-boundary
 * callers (PolicyStore.createRule, PolicyStore.updateRule) where the
 * "ok or surface to operator" contract is more ergonomic than result
 * inspection. The thrown InvalidRegexPatternError carries the same
 * `code` and `reason` you'd get from checkRegexSafety, so API handlers
 * can map it to a structured 400.
 */
export function assertRegexSafety(pattern: string, flags = ''): void {
  const result = checkRegexSafety(pattern, flags);
  if (!result.ok) {
    throw new InvalidRegexPatternError(pattern, result.code!, result.reason!);
  }
}
