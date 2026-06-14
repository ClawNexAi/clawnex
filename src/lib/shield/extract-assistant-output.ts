/**
 * Extract every assistant-output channel from an OpenAI-format response
 * into a single concatenated string suitable for outbound shield scanning.
 *
 * Codex 2026-05-17 round 2 #1 + round 3 #2: the v1 chat path previously
 * extracted only `choices[].message.content` when it was a string.
 * OpenAI-compatible responses can carry model-controlled output in many
 * other channels and shapes:
 *
 *   Channels (round 2 #1):
 *   - `choices[].text`                                (legacy /completions)
 *   - `choices[].message.content` (string)            (standard chat)
 *   - `choices[].message.content` (array of parts)    (multimodal / structured)
 *   - `choices[].message.tool_calls[].function.name`
 *   - `choices[].message.tool_calls[].function.arguments`
 *   - `choices[].message.function_call.name`
 *   - `choices[].message.function_call.arguments`
 *
 *   Shape variations (round 3 #2):
 *   - tool/function `arguments` can be a NON-STRING (object/array) when the
 *     provider returns structured outputs — round 2 only kept strings.
 *   - `message.content` can be a bare object (not string, not array) for
 *     some non-canonical providers.
 *   - Streaming responses use `choices[].delta` instead of `choices[].message`.
 *   - Unknown nested message fields (model `refusal`, `audio`, provider
 *     extensions) can carry bytes the model emitted.
 *   - Mixed: a benign known channel firing must NOT short-circuit the
 *     defensive stringification of unknown channels. Round 2 only stringified
 *     unknown shapes when parts was empty — mixed cases silently dropped them.
 *
 * Per Codex's r3 recommendation: "Include non-string function/tool arguments
 * via safe JSON stringification and add fallback coverage for partially
 * recognized choices." Implementation: extract known channels, ALSO scan the
 * entire choice/message for any field outside the known set, regardless of
 * whether known channels produced output.
 *
 * @module shield/extract-assistant-output
 */

interface ContentPart {
  type?: string;
  text?: string;
  // OpenAI multimodal also defines image_url, input_audio, etc. Their
  // payloads are base64 or URLs; we stringify the whole part defensively
  // so the scanner sees whatever the model produced.
  [key: string]: unknown;
}

interface FunctionCall {
  name?: string;
  arguments?: unknown;
}

interface ToolCall {
  id?: string;
  type?: string;
  function?: FunctionCall;
}

interface AssistantMessage {
  role?: string;
  content?: unknown;
  tool_calls?: ToolCall[];
  function_call?: FunctionCall;
  // Streaming deltas carry the same channel shapes under .delta in some
  // chunks; the final non-streaming caller usually won't see this, but if
  // someone aggregates chunks into one object we want to scan it.
  delta?: AssistantMessage;
  [key: string]: unknown;
}

interface Choice {
  index?: number;
  text?: string;                  // legacy /completions
  message?: AssistantMessage;     // chat completions
  delta?: AssistantMessage;       // streaming chat chunks
  finish_reason?: string;
  [key: string]: unknown;
}

interface OpenAIResponseShape {
  choices?: Choice[];
  [key: string]: unknown;
}

// Fields that are pure metadata or already-covered channels — anything ELSE
// at the choice/message level gets the defensive JSON-stringification pass.
const KNOWN_CHOICE_FIELDS: ReadonlySet<string> = new Set([
  "index", "finish_reason", "logprobs",
  "text", "message", "delta",
]);
const KNOWN_MESSAGE_FIELDS: ReadonlySet<string> = new Set([
  "role", "content", "tool_calls", "function_call", "delta",
]);

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value); } catch { return ""; }
}

/**
 * Pull text out of a single content part. String parts return verbatim;
 * structured parts (with type=text) return their .text; everything else
 * (image_url, audio, unknown) gets JSON-stringified so the scanner can
 * see what the model embedded.
 */
function extractContentPart(part: unknown): string {
  if (typeof part === "string") return part;
  if (part && typeof part === "object") {
    const p = part as ContentPart;
    if (typeof p.text === "string") return p.text;
    // Unknown structured part — defensive stringify.
    return safeStringify(part);
  }
  return "";
}

/**
 * Pull text out of message.content regardless of shape. Strings pass
 * through, arrays of parts get walked, bare objects (some non-canonical
 * providers) get stringified defensively.
 */
function extractMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(extractContentPart).filter(Boolean).join("\n");
  }
  if (content && typeof content === "object") {
    // Bare object content — provider extension; stringify so bytes reach
    // the scanner instead of being silently dropped.
    return safeStringify(content);
  }
  return "";
}

/**
 * Pull text out of a single tool_call / function_call. We include BOTH
 * the function name and its arguments — names are model-chosen and
 * arguments are model-emitted, both can carry exfil. Round 3 #2:
 * arguments can be non-string (object/array) when the provider returns
 * structured outputs; stringify those defensively instead of skipping.
 */
function extractFunctionInvocation(invocation: FunctionCall | undefined): string {
  if (!invocation) return "";
  const parts: string[] = [];
  if (typeof invocation.name === "string" && invocation.name.length > 0) {
    parts.push(invocation.name);
  }
  if (typeof invocation.arguments === "string" && invocation.arguments.length > 0) {
    parts.push(invocation.arguments);
  } else if (invocation.arguments !== undefined && invocation.arguments !== null) {
    // Object / array arguments — provider returned structured output.
    // Round 2 only kept strings; this dropped the actual payload.
    parts.push(safeStringify(invocation.arguments));
  }
  return parts.join("\n");
}

/**
 * Collect every assistant-output channel from a message-shaped object
 * (works for both `message` and `delta` since they share the same shape).
 * Includes any UNKNOWN nested field as defensive JSON stringification
 * regardless of whether known channels produced output (round 3 #2
 * fix — no longer gated on parts.length === 0).
 */
function extractFromMessageLike(message: AssistantMessage | undefined): string {
  if (!message || typeof message !== "object") return "";
  const parts: string[] = [];

  // Known channels
  const contentText = extractMessageContent(message.content);
  if (contentText) parts.push(contentText);

  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      const t = extractFunctionInvocation(tc?.function);
      if (t) parts.push(t);
    }
  }

  const fcText = extractFunctionInvocation(message.function_call);
  if (fcText) parts.push(fcText);

  // Some providers wrap fields under `delta` even on non-streaming responses
  // (e.g. chunk-aggregator output). Recurse to pick those up too.
  if (message.delta && typeof message.delta === "object") {
    const deltaText = extractFromMessageLike(message.delta);
    if (deltaText) parts.push(deltaText);
  }

  // Defensive: stringify ANY message field outside the known set, regardless
  // of whether known channels fired. This closes the round 3 #2 gap where a
  // benign message.content masked object-valued tool_calls or unknown nested
  // fields. Empty/null-valued unknown fields contribute nothing.
  for (const k of Object.keys(message)) {
    if (KNOWN_MESSAGE_FIELDS.has(k)) continue;
    const v = message[k];
    if (v === undefined || v === null || v === "") continue;
    const s = typeof v === "string" ? v : safeStringify(v);
    if (s) parts.push(s);
  }

  return parts.join("\n");
}

/**
 * Walk one `choices[]` element and collect every assistant-output channel.
 * Round 3 #2: defensive stringification now runs unconditionally for
 * unknown choice-level fields too, so mixed shapes can't hide bytes.
 */
function extractChoiceOutput(choice: Choice): string {
  const parts: string[] = [];

  // Legacy completions: choices[].text
  if (typeof choice.text === "string" && choice.text.length > 0) {
    parts.push(choice.text);
  }

  // Standard chat: choices[].message
  const messageText = extractFromMessageLike(choice.message);
  if (messageText) parts.push(messageText);

  // Streaming: choices[].delta — same shape as message
  const deltaText = extractFromMessageLike(choice.delta);
  if (deltaText) parts.push(deltaText);

  // Defensive: stringify ANY choice field outside the known set, regardless
  // of whether known channels fired. Closes the round 3 #2 gap.
  for (const k of Object.keys(choice)) {
    if (KNOWN_CHOICE_FIELDS.has(k)) continue;
    const v = choice[k];
    if (v === undefined || v === null || v === "") continue;
    const s = typeof v === "string" ? v : safeStringify(v);
    if (s) parts.push(s);
  }

  return parts.join("\n");
}

/**
 * Public extractor. Reads every OpenAI-compatible assistant-output
 * channel from a response and returns the concatenated text for outbound
 * scanning. Returns "" only when responseData has no choices array OR
 * every choice is genuinely empty (no text, no content, no tools, no
 * function_call, no delta, no unknown nested fields).
 */
export function extractAssistantOutput(responseData: unknown): string {
  if (!responseData || typeof responseData !== "object") return "";
  const r = responseData as OpenAIResponseShape;
  const choices = r.choices;
  if (!Array.isArray(choices)) return "";
  return choices.map(extractChoiceOutput).filter(Boolean).join("\n\n");
}
