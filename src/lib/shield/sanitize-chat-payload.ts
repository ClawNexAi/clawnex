/**
 * Sanitize + rebuild chat payload messages before relay.
 *
 * internal reviewer 2026-05-17 round 4 (BLOCKER 1+2): the prior fix rejected non-string
 * content but the forwarder still shipped the raw message object upstream
 * with any sibling fields the caller chose to include. A message like
 * `{ role: "user", content: "benign", tool_calls: [...] }` passed the
 * type check (content is a string), got scanned (only `content` was
 * extracted), and then was forwarded WITH `tool_calls` intact to LiteLLM.
 * Same shape on /api/chat history.
 *
 * The actual invariant: **what gets forwarded must be exactly what got
 * scanned.** Implementing it: rebuild the relay payload from a sanitized
 * representation that includes ONLY the fields we scan, and reject any
 * input that doesn't fit.
 *
 * operator directive 2026-05-17 (after internal reviewer round-4 blocker):
 *   - Allowlist roles: system / user / assistant / function / tool
 *   - Allowlist message keys: role, content (NOTHING else — not `name`,
 *     not `tool_calls`, not `function_call`, not `tool_call_id`)
 *   - Reject with 400 (generic message — no field-naming for recon
 *     minimization) on ANY violation
 *   - Reject history entries that lack content (the "role-only marker"
 *     allowance from round 4 was an attack vector)
 *
 * @module shield/sanitize-chat-payload
 */

export const ALLOWED_ROLES: ReadonlySet<string> = new Set([
  "system", "user", "assistant", "function", "tool",
]);

export const ALLOWED_MESSAGE_KEYS: ReadonlySet<string> = new Set(["role", "content"]);

export type SafeRole = "system" | "user" | "assistant" | "function" | "tool";

export interface SafeMessage {
  role: SafeRole;
  content: string;
}

export type SanitizeMessageResult =
  | { ok: true; message: SafeMessage }
  | { ok: false };

/**
 * Sanitize a single message-shaped object. Returns the sanitized message
 * (containing ONLY role + content) on success, or { ok: false } on any
 * invariant violation. Callers add their own per-violation logging — this
 * function deliberately returns no reason text so error responses can be
 * generic and recon-resistant.
 *
 * Invariants enforced:
 *   1. Input is a plain object (not array, not primitive, not null).
 *   2. Input has EXACTLY the allowed keys {role, content} — no extras.
 *      Extra keys (tool_calls, function_call, tool_call_id, name, any
 *      novel field) cause rejection, since they would be forwarded
 *      upstream unscanned.
 *   3. role is a string in ALLOWED_ROLES.
 *   4. content is a string (multimodal arrays / object content rejected
 *      until the relay supports normalize-then-scan).
 */
export function sanitizeMessage(raw: unknown): SanitizeMessageResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false };
  }
  const obj = raw as Record<string, unknown>;
  // Unknown-key rejection BEFORE any other check — defends the invariant
  // that "forwarded ⊆ scanned" even if the rest of the validation later
  // grew loose for some reason.
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_MESSAGE_KEYS.has(k)) return { ok: false };
  }
  const role = obj.role;
  if (typeof role !== "string" || !ALLOWED_ROLES.has(role)) return { ok: false };
  const content = obj.content;
  if (typeof content !== "string") return { ok: false };
  // ALLOWED_ROLES membership narrows role to the SafeRole union.
  return { ok: true, message: { role: role as SafeRole, content } };
}

export type SanitizeArrayResult =
  | { ok: true; messages: SafeMessage[] }
  | { ok: false };

/**
 * Sanitize an array of message-shaped objects (used by /api/chat for
 * history and by /api/v1/chat/completions for messages). Returns the
 * full sanitized array on success, or { ok: false } if ANY entry fails.
 *
 * Pass-through: null/undefined input → empty array (for optional fields
 * like /api/chat history). Non-array non-null input → reject.
 */
export function sanitizeMessageArray(raw: unknown, opts?: { optional?: boolean }): SanitizeArrayResult {
  if (raw === null || raw === undefined) {
    if (opts?.optional) return { ok: true, messages: [] };
    return { ok: false };
  }
  if (!Array.isArray(raw)) return { ok: false };
  const out: SafeMessage[] = [];
  for (const entry of raw) {
    const r = sanitizeMessage(entry);
    if (!r.ok) return { ok: false };
    out.push(r.message);
  }
  return { ok: true, messages: out };
}
