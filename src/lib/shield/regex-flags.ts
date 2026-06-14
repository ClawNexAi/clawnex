/**
 * Regex-flag normalization for the v1 policy framework.
 *
 * Contract:
 *   - Reject duplicates in operator input. 'gg' throws — we never
 *     silently coalesce operator-typed dups; that would mask a typo
 *     or a misunderstanding. (The only path that "dedupes" is the
 *     force-g step below, which is idempotent: if the operator
 *     already wrote 'g', the post-loop seen.add('g') is a no-op
 *     via Set semantics. That's NOT operator-input dedup — it's
 *     idempotency of the force-add.)
 *   - Force 'g' (always present after normalize) — the evaluator's
 *     regex.exec() iteration loop requires it; without 'g' you get
 *     one match instead of all. This is the foot-gun that motivated
 *     the original hardcoded 'gi' override; we now solve it at the
 *     save boundary instead, so stored author intent for case-
 *     sensitivity / multiline / dotAll / unicode is preserved.
 *   - Reject unsupported flag characters: only g, i, m, s, u are
 *     allowed. 'd' and 'y' are deliberately excluded for v1 — 'y'
 *     (sticky) breaks the iteration loop's lastIndex semantics, 'd'
 *     (hasIndices) doesn't change matching behavior so it has no v1
 *     use case.
 *   - Sort canonically (alphabetical g→i→m→s→u) so the stored value
 *     is stable regardless of input ordering ('ig' and 'gi' both
 *     normalize to 'gi').
 *   - Empty input is valid: '' → 'g'. That's the canonical "author
 *     wrote no flags" case, which after normalization becomes
 *     case-sensitive global.
 *
 * Save sites that MUST call this: PolicyStore.createRule,
 * PolicyStore.updateRule, and seed-policies.ts. Any future insert
 * path into policy_rules must do the same.
 *
 * @module shield/regex-flags
 */

const SUPPORTED_FLAGS = new Set(['g', 'i', 'm', 's', 'u']);

// Canonical ordering used to produce a stable string from the seen-set.
// Keep in sync with SUPPORTED_FLAGS — if a flag is added to one it must
// be added to the other in the same order, or normalization drops it.
const CANONICAL_ORDER = ['g', 'i', 'm', 's', 'u'];

/**
 * Thrown by normalizeRegexFlags when input contains an unsupported
 * character or a duplicate. Save-boundary callers (createRule,
 * updateRule, seed) let this propagate so the API layer can map it
 * to a 400 with a human-readable reason.
 */
export class InvalidRegexFlagsError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid regex flags "${input}" — ${reason}`);
    this.name = 'InvalidRegexFlagsError';
  }
}

/**
 * Normalize an operator-supplied regex flag string into the canonical
 * form stored in policy_rules.flags. Always force-adds 'g'. Throws
 * InvalidRegexFlagsError on unsupported chars or duplicates.
 *
 * Idempotent: normalizeRegexFlags(normalizeRegexFlags(x)) === normalizeRegexFlags(x).
 */
export function normalizeRegexFlags(input: string): string {
  const seen = new Set<string>();
  for (const ch of input) {
    if (!SUPPORTED_FLAGS.has(ch)) {
      throw new InvalidRegexFlagsError(
        input,
        `unsupported flag character "${ch}" (allowed: g, i, m, s, u)`,
      );
    }
    if (seen.has(ch)) {
      throw new InvalidRegexFlagsError(input, `duplicate flag character "${ch}"`);
    }
    seen.add(ch);
  }
  // Force-add 'g'. Idempotent if already present (Set semantics).
  // Required so the evaluator's regex.exec() iteration loop collects
  // all matches instead of just the first.
  seen.add('g');
  return CANONICAL_ORDER.filter(ch => seen.has(ch)).join('');
}
