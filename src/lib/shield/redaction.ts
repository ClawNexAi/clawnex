/**
 * Span-based redaction. The policy evaluator records (start, length)
 * pairs internally so the redact() pipeline can replace exact match
 * regions with [REDACTED:rule_key] markers. Detection samples in
 * API responses stay truncated to 80 chars per the existing scanner.ts
 * convention; full match strings never leave the evaluator.
 *
 * Throws on contract violations (overlap, out-of-range, invalid rule_key
 * format) — silent corruption in a security path is unacceptable.
 *
 * Spec §3.2 action='redact' requirements + internal reviewer review #3.
 *
 * @module shield/redaction
 */

export interface RedactSpan {
  start: number;
  length: number;
  rule_key: string;
  /** Optional source rule UUID. Carried through the evaluator so audit
   * rows for skipped spans (redact_span_skipped) can populate resource_id
   * for forensics. applySpans ignores this field — it only renders
   * rule_key into the [REDACTED:rule_key] marker. */
  rule_id?: string;
}

/**
 * Canonical rule_key format. Operator-authored rule_keys must match
 * this shape; the API gates on it at create/edit time, the evaluator
 * skips spans with non-conforming rule_keys defensively, and applySpans
 * throws fail-loud on any that slip through. Single source of truth.
 */
export const RULE_KEY_FORMAT = /^[A-Z][A-Z0-9_-]*$/;

/**
 * Apply a list of spans to text, replacing each span with
 * [REDACTED:rule_key]. Validates every span up front and detects
 * overlaps, throwing on contract violation with a descriptive message.
 * Spans are applied right-to-left so earlier indices stay valid
 * through the rewrite.
 *
 * Throws on:
 * - Negative start index
 * - Zero or negative length (explicit rather than silent no-op)
 * - Out-of-range span (start + length > text.length)
 * - Invalid rule_key format (must match /^[A-Z][A-Z0-9_-]*$/)
 * - Overlapping spans
 *
 * The caller (the evaluator) is responsible for pre-validating that
 * spans are non-overlapping before calling this function.
 *
 * @throws {Error} If any span violates contract
 */
export function applySpans(text: string, spans: RedactSpan[]): string {
  if (spans.length === 0) return text;

  // Validate each span up front before any rewriting.
  for (const span of spans) {
    const { start, length, rule_key } = span;

    // Guard 1: start must be non-negative.
    if (start < 0) {
      throw new Error(
        `applySpans: negative start (rule_key=${rule_key})`
      );
    }

    // Guard 2: length must be positive (zero-length is M2).
    if (length <= 0) {
      throw new Error(
        `applySpans: zero or negative length (rule_key=${rule_key})`
      );
    }

    // Guard 3: span must fit within text bounds.
    if (start + length > text.length) {
      throw new Error(
        `applySpans: span out of range (start=${start} length=${length} textLen=${text.length} rule_key=${rule_key})`
      );
    }

    // Guard 4: rule_key must match expected format to prevent marker breakage.
    if (!RULE_KEY_FORMAT.test(rule_key)) {
      throw new Error(
        `applySpans: invalid rule_key format "${rule_key}" — expected /^[A-Z][A-Z0-9_-]*$/`
      );
    }
  }

  // Sort ascending by start, with length as tiebreaker for deterministic ordering (M3).
  const sortedAsc = [...spans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.length - b.length;
  });

  // Detect overlaps (C1 + M3). Walk the sorted list and check each pair.
  for (let i = 0; i < sortedAsc.length - 1; i++) {
    const curr = sortedAsc[i];
    const next = sortedAsc[i + 1];
    if (next.start < curr.start + curr.length) {
      throw new Error(
        `applySpans: overlapping spans not allowed (${curr.rule_key} [${curr.start},${curr.start + curr.length}) and ${next.rule_key} [${next.start},${next.start + next.length}))`
      );
    }
  }

  // All validations passed. Apply spans right-to-left to keep indices valid.
  const sortedDesc = [...sortedAsc].reverse();
  let out = text;
  for (const span of sortedDesc) {
    out = out.slice(0, span.start) + `[REDACTED:${span.rule_key}]` + out.slice(span.start + span.length);
  }
  return out;
}
