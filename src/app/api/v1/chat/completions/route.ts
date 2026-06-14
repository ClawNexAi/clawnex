/**
 * ClawNex OpenAI-Compatible Chat Completions Endpoint
 * POST /api/v1/chat/completions
 *
 * Shield-aware proxy that accepts standard OpenAI chat completion requests,
 * scans prompts and responses through the ClawNex shield engine, forwards
 * to LiteLLM, logs traffic, and returns OpenAI-format responses.
 *
 * Streaming support deferred to v2.
 *
 * @module api/v1/chat/completions
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { v4 as uuid } from "uuid";
import { shieldScan, outboundScan } from "@/lib/shield/scanner";
import { extractAssistantOutput } from "@/lib/shield/extract-assistant-output";
import { sanitizeMessageArray } from "@/lib/shield/sanitize-chat-payload";
import { run } from "@/lib/db/index";
import { getSetting } from "@/lib/services/config-service";
import { broadcast } from "@/lib/events";
import { authenticateRequest } from "@/lib/middleware/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** LiteLLM proxy base URL */
const LITELLM_URL = `http://127.0.0.1:${process.env.LITELLM_PORT || "4001"}/chat/completions`;

/** Request timeout for LiteLLM calls (ms) */
const LITELLM_TIMEOUT_MS = 120_000;

// CX-R14-09 caps. Without these, a valid API key holder can submit a 50MB
// messages array with max_tokens: 999_999 and pin an upstream slot until
// the LITELLM_TIMEOUT_MS fires. Public API — every cap matters.
const MAX_BODY_BYTES        = 2 * 1024 * 1024;   //  2 MB total request body
const MAX_MESSAGES          = 200;               //  message count per call
const MAX_MESSAGE_CHARS     = 100_000;           //  per-message content cap
const MAX_MAX_TOKENS        = 32_000;            //  upper bound on body.max_tokens

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | null;
  name?: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an OpenAI-format error response.
 */
function errorResponse(
  message: string,
  type: string,
  code: string,
  status: number,
  headers?: Record<string, string>
): NextResponse<OpenAIErrorResponse> {
  return NextResponse.json(
    { error: { message, type, code } },
    { status, headers }
  );
}

/**
 * Extract combined text from an array of chat messages for shield scanning.
 */
function extractText(messages: ChatMessage[]): string {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Detect provider name from model string.
 * e.g. "gpt-4" → "openai", "claude-3" → "anthropic", "gemini-pro" → "google"
 */
function detectProvider(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return "openai";
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gemini") || m.startsWith("palm")) return "google";
  if (m.startsWith("mistral") || m.startsWith("mixtral")) return "mistral";
  if (m.startsWith("llama") || m.startsWith("meta-llama")) return "meta";
  if (m.startsWith("command") || m.startsWith("cohere")) return "cohere";
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("groq")) return "groq";
  return "unknown";
}

/**
 * Return the worse of two shield verdicts.
 */
function worstVerdict(
  a: "BLOCK" | "REVIEW" | "ALLOW",
  b: "BLOCK" | "REVIEW" | "ALLOW"
): "BLOCK" | "REVIEW" | "ALLOW" {
  const rank: Record<string, number> = { BLOCK: 2, REVIEW: 1, ALLOW: 0 };
  return (rank[a] ?? 0) >= (rank[b] ?? 0) ? a : b;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

// Authentication is handled by the shared authenticateRequest() middleware
// from @/lib/middleware/api-auth — validates key hash, checks scope (chat:completions),
// enforces expiry, applies per-key rate limit, and updates last_used_at.
// The old custom authenticateApiKey() was removed because it queried a
// non-existent "revoked" column (should be "revoked_at") and skipped scope,
// expiry, and rate-limit checks entirely.

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/chat/completions
 *
 * OpenAI-compatible chat completions with ClawNex shield scanning.
 * Authenticates via API key, scans inbound prompt, forwards to LiteLLM,
 * scans outbound response, logs traffic, and returns the result.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestStart = performance.now();
  const trafficId = uuid();

  // --- 1. Authentication (shared middleware — scope, expiry, rate limit) ---
  const auth = authenticateRequest(request, "chat:completions");
  if (!auth.authenticated) {
    return errorResponse(
      auth.error || "Authentication failed.",
      "authentication_error",
      "auth_failed",
      auth.status || 401,
    );
  }

  // --- 2. Parse request ---
  // Body-size precheck via Content-Length BEFORE we read the stream into
  // memory. Header is operator-supplied so it's not authoritative — but if
  // it's present and over the cap we can fail fast without buffering. The
  // raw-text read below enforces the same cap a second time for clients
  // that lie about Content-Length.
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return errorResponse(
        `Request body too large (declared ${declared} bytes, max ${MAX_BODY_BYTES}).`,
        "invalid_request_error",
        "body_too_large",
        413
      );
    }
  }

  let body: ChatCompletionRequest;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return errorResponse(
        `Request body too large (${raw.length} bytes, max ${MAX_BODY_BYTES}).`,
        "invalid_request_error",
        "body_too_large",
        413
      );
    }
    body = JSON.parse(raw) as ChatCompletionRequest;
  } catch {
    return errorResponse(
      "Invalid JSON in request body.",
      "invalid_request_error",
      "invalid_json",
      400
    );
  }

  if (!body.model || typeof body.model !== "string") {
    return errorResponse(
      "Missing required field: model",
      "invalid_request_error",
      "missing_model",
      400
    );
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return errorResponse(
      "Missing or empty required field: messages",
      "invalid_request_error",
      "missing_messages",
      400
    );
  }

  // Message-count cap. Without this, a 50K-element messages array could
  // be valid JSON under the body-size cap and still pin downstream parsing.
  if (body.messages.length > MAX_MESSAGES) {
    return errorResponse(
      `Too many messages (${body.messages.length}, max ${MAX_MESSAGES}).`,
      "invalid_request_error",
      "too_many_messages",
      400
    );
  }

  // internal reviewer 2026-05-17 round-4 BLOCKER + operator directive: enforce the
  // scan-equals-forward invariant by rebuilding body.messages from a
  // sanitized representation. Allowlist is {role, content} ONLY —
  // any sibling field (tool_calls, function_call, tool_call_id, name,
  // arbitrary nested) causes 400 because we can't forward what we
  // can't scan. Generic error message (no field naming) to deny
  // reconnaissance signal to an attacker probing the validator.
  // Per-message size cap then applies to the validated string.
  //
  // The prior round-4 fix only checked `typeof content !== "string"`
  // and still forwarded the raw body.messages — sibling fields like
  // tool_calls.arguments slipped past the shield. This commit closes
  // that bypass class.
  const sanitized = sanitizeMessageArray(body.messages);
  if (!sanitized.ok) {
    return errorResponse(
      "Unsupported message shape. Each message must contain exactly { role, content } with role in (system, user, assistant, function, tool) and content as a string.",
      "invalid_request_error",
      "unsupported_message_shape",
      400
    );
  }
  const safeMessages = sanitized.messages;
  for (let i = 0; i < safeMessages.length; i++) {
    if (safeMessages[i].content.length > MAX_MESSAGE_CHARS) {
      return errorResponse(
        `Message ${i} content exceeds ${MAX_MESSAGE_CHARS} characters.`,
        "invalid_request_error",
        "message_too_long",
        400
      );
    }
  }

  // max_tokens ceiling. Operators submitting `max_tokens: 999999` (typo
  // or intentional) tie up an upstream slot at full generation budget for
  // the LITELLM_TIMEOUT_MS window.
  if (typeof body.max_tokens === "number" && body.max_tokens > MAX_MAX_TOKENS) {
    return errorResponse(
      `max_tokens too large (${body.max_tokens}, ceiling ${MAX_MAX_TOKENS}).`,
      "invalid_request_error",
      "max_tokens_too_large",
      400
    );
  }

  // Streaming deferred to v2
  if (body.stream) {
    return errorResponse(
      "Streaming is not yet supported. Set stream: false or omit the field.",
      "invalid_request_error",
      "streaming_not_supported",
      400
    );
  }

  // Feed the SANITIZED messages to the scanner — same representation we
  // forward upstream. Closes the scan-vs-forward asymmetry that earlier
  // versions had even when content was string (sibling fields could
  // still differ between scan input and forward output).
  const promptText = extractText(safeMessages);

  // --- 3. Inbound shield scan ---
  let inboundVerdict: "BLOCK" | "REVIEW" | "ALLOW" = "ALLOW";
  let inboundScore = 0;
  let inboundDetections: unknown[] = [];

  try {
    const inboundResult = shieldScan(promptText);
    inboundVerdict = inboundResult.verdict;
    inboundScore = inboundResult.score;
    inboundDetections = inboundResult.detections;

    if (inboundVerdict === "BLOCK") {
      // Safe-default: if the row is missing for any reason, treat as 'on'
      // so the shield refuses BLOCK verdicts rather than silently passing.
      // Seed writes 'on' on fresh installs; this is the belt-and-braces.
      const blockMode = getSetting("proxy_block_mode") || "on";

      if (blockMode === "on") {
        // Log the blocked request
        try {
          logTraffic({
            id: trafficId,
            model: body.model,
            provider: detectProvider(body.model),
            messagesCount: body.messages.length,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            costUsd: null,
            latencyMs: Math.round(performance.now() - requestStart),
            shieldVerdict: "BLOCK",
            shieldScore: inboundScore,
            shieldDetections: inboundDetections,
            blocked: true,
            blockReason: `Inbound shield: ${inboundResult.stats.critical} critical, ${inboundResult.stats.high} high detections`,
            statusCode: 400,
            source: "api-v1",
          });
        } catch { /* best-effort logging */ }

        return errorResponse(
          `Request blocked by ClawNex Shield. Score: ${inboundScore}/100. ` +
            `Detections: ${inboundResult.stats.total} (${inboundResult.stats.critical} critical, ` +
            `${inboundResult.stats.high} high). Contact your administrator if you believe this is an error.`,
          "shield_block",
          "prompt_blocked",
          400
        );
      }
      // Block mode OFF — log but proceed (monitor-only)
    }
  } catch (err) {
    // CRITICAL fail-CLOSED. A scanner exception is the exact attack class
    // the assessment flagged: deeply nested JSON, binary in text fields,
    // overlong Unicode sequences — any payload crafted to crash shieldScan()
    // would previously slip through as inboundVerdict=ALLOW. We now flip to
    // BLOCK and refuse the request with 503 (Service Unavailable — scanner
    // unhealthy, retry / report).
    console.error("[Chat Completions] Inbound shield error — failing CLOSED:", err);
    try {
      logTraffic({
        id: trafficId,
        model: body.model,
        provider: detectProvider(body.model),
        messagesCount: body.messages.length,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        latencyMs: Math.round(performance.now() - requestStart),
        shieldVerdict: "BLOCK",
        shieldScore: 100,
        shieldDetections: [{ category: "scanner_error", reason: "shield exception → fail-closed" }],
        blocked: true,
        blockReason: "scanner exception",
        statusCode: 503,
        source: "api-v1",
      });
    } catch { /* best-effort logging */ }
    return errorResponse(
      "Shield scanner unavailable — request blocked. Retry shortly or contact your administrator.",
      "shield_unavailable",
      "scanner_failure",
      503
    );
  }

  // --- 4. Forward to LiteLLM ---
  // internal reviewer round-4 BLOCKER: forward `safeMessages` (rebuilt from validated
  // {role, content} only) — NOT body.messages. Body.messages may contain
  // sibling fields the scanner never saw; forwarding raw breaks the
  // scan-equals-forward invariant.
  let litellmResponse: Response;
  const forwardBody = {
    model: body.model,
    messages: safeMessages,
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.max_tokens !== undefined && { max_tokens: body.max_tokens }),
    stream: false,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LITELLM_TIMEOUT_MS);

    const litellmHeaders: Record<string, string> = { "Content-Type": "application/json" };
    const masterKey = process.env.LITELLM_MASTER_KEY;
    if (masterKey) {
      litellmHeaders["Authorization"] = `Bearer ${masterKey}`;
    }

    litellmResponse = await fetch(LITELLM_URL, {
      method: "POST",
      headers: litellmHeaders,
      body: JSON.stringify(forwardBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (err) {
    const isTimeout =
      err instanceof DOMException && err.name === "AbortError";

    // Log the failed request
    try {
      logTraffic({
        id: trafficId,
        model: body.model,
        provider: detectProvider(body.model),
        messagesCount: body.messages.length,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        latencyMs: Math.round(performance.now() - requestStart),
        shieldVerdict: inboundVerdict,
        shieldScore: inboundScore,
        shieldDetections: inboundDetections,
        blocked: false,
        blockReason: null,
        statusCode: 502,
        errorMsg: isTimeout ? "LiteLLM timeout" : "LiteLLM connection failed",
        source: "api-v1",
      });
    } catch { /* best-effort logging */ }

    return errorResponse(
      isTimeout
        ? "Upstream LLM request timed out (120s limit)."
        : "Upstream LLM proxy is unavailable. Ensure LiteLLM is running on port 4001.",
      "server_error",
      isTimeout ? "timeout" : "upstream_unavailable",
      502
    );
  }

  // Parse the LiteLLM response
  let responseData: Record<string, unknown>;
  try {
    responseData = await litellmResponse.json();
  } catch {
    try {
      logTraffic({
        id: trafficId,
        model: body.model,
        provider: detectProvider(body.model),
        messagesCount: body.messages.length,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        latencyMs: Math.round(performance.now() - requestStart),
        shieldVerdict: inboundVerdict,
        shieldScore: inboundScore,
        shieldDetections: inboundDetections,
        blocked: false,
        blockReason: null,
        statusCode: litellmResponse.status,
        errorMsg: "Invalid JSON from LiteLLM",
        source: "api-v1",
      });
    } catch { /* best-effort logging */ }

    return errorResponse(
      "Upstream proxy returned an invalid response.",
      "server_error",
      "invalid_upstream_response",
      502
    );
  }

  // If LiteLLM returned an error, pass it through
  if (!litellmResponse.ok) {
    try {
      logTraffic({
        id: trafficId,
        model: body.model,
        provider: detectProvider(body.model),
        messagesCount: body.messages.length,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        latencyMs: Math.round(performance.now() - requestStart),
        shieldVerdict: inboundVerdict,
        shieldScore: inboundScore,
        shieldDetections: inboundDetections,
        blocked: false,
        blockReason: null,
        statusCode: litellmResponse.status,
        errorMsg: JSON.stringify(responseData).slice(0, 500),
        source: "api-v1",
      });
    } catch { /* best-effort logging */ }

    return NextResponse.json(responseData, { status: litellmResponse.status });
  }

  // --- 5. Outbound shield scan ---
  let outboundVerdict: "BLOCK" | "REVIEW" | "ALLOW" = "ALLOW";
  let outboundScore = 0;

  try {
    // Codex 2026-05-17 round 2 #1 — Extract from EVERY assistant-output
    // channel, not just message.content. Previously this only read string
    // message.content, missing legacy text, multimodal content parts,
    // tool_calls.function.arguments, and function_call.arguments — a
    // model could put PII/secrets in any of those and bypass the scan.
    // The shared extractor in @/lib/shield/extract-assistant-output
    // walks all channels and stringifies unknown shapes defensively.
    const responseText = extractAssistantOutput(responseData);

    if (responseText) {
      const outboundResult = outboundScan(responseText);
      outboundVerdict = outboundResult.verdict;
      outboundScore = outboundResult.score;
    }
  } catch (err) {
    // internal reviewer P1-B 2026-05-14 — outbound shield now fails CLOSED on scanner
    // exception, mirroring the inbound fix from CRIT #1. A crafted LLM
    // response that crashes outboundScan() (deeply nested JSON, binary
    // in text fields, overlong Unicode) would have slipped through with
    // ALLOW. Now: set verdict to BLOCK, log the traffic row, return 503.
    console.error("[Chat Completions] Outbound shield error — failing CLOSED:", err);
    try {
      logTraffic({
        id: trafficId,
        model: body.model,
        provider: detectProvider(body.model),
        messagesCount: body.messages.length,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        latencyMs: Math.round(performance.now() - requestStart),
        shieldVerdict: "BLOCK",
        shieldScore: 100,
        shieldDetections: [{ category: "scanner_error", reason: "outbound shield exception → fail-closed" }],
        blocked: true,
        blockReason: "outbound scanner exception",
        statusCode: 503,
        source: "api-v1",
      });
    } catch { /* best-effort logging */ }
    return errorResponse(
      "Shield scanner unavailable on response path — request blocked. Retry shortly.",
      "shield_unavailable",
      "outbound_scanner_failure",
      503
    );
  }

  // Codex 2026-05-17 #1 — Outbound BLOCK gate. Previously the v1 path
  // computed outboundVerdict and folded it into finalVerdict but ALWAYS
  // returned responseData with status 200 — a valid API-key caller would
  // receive LLM output that the outbound shield classified as BLOCK,
  // reducing DLP/secrets egress protection to a response header. Mirrors
  // outboundShieldGate's pattern in src/lib/shield/outbound-gate.ts and
  // the /api/chat path at src/app/api/chat/route.ts:448 + 482.
  if (outboundVerdict === "BLOCK") {
    const blockMode = getSetting("proxy_block_mode") || "on";
    if (blockMode === "on" || blockMode === "block") {
      console.warn(
        `[Chat Completions] Outbound BLOCK (score=${outboundScore}) — returning 503, not response body`,
      );
      try {
        logTraffic({
          id: trafficId,
          model: body.model,
          provider: detectProvider(body.model),
          messagesCount: body.messages.length,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costUsd: null,
          latencyMs: Math.round(performance.now() - requestStart),
          shieldVerdict: "BLOCK",
          shieldScore: outboundScore,
          shieldDetections: [{ category: "outbound", reason: "outbound shield BLOCK" }],
          blocked: true,
          blockReason: "outbound shield BLOCK",
          statusCode: 503,
          source: "api-v1",
        });
      } catch { /* best-effort logging */ }
      return errorResponse(
        "Response blocked by ClawNex Shield (outbound).",
        "outbound_blocked",
        "shield_outbound_block",
        503,
      );
    }
    // blockMode === "off" — monitor-only; warn and continue, response goes through
    console.warn(`[Chat Completions] Outbound BLOCK (monitor-only, mode=${blockMode}) — letting response through`);
  }

  // Combined verdict (worst of inbound + outbound)
  const finalVerdict = worstVerdict(inboundVerdict, outboundVerdict);
  const finalScore = Math.max(inboundScore, outboundScore);

  // --- 6. Log to proxy_traffic ---
  const latencyMs = Math.round(performance.now() - requestStart);
  const usage = responseData.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;

  try {
    logTraffic({
      id: trafficId,
      model: body.model,
      provider: detectProvider(body.model),
      messagesCount: body.messages.length,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      costUsd: null, // Cost calculated by LiteLLM callback separately
      latencyMs,
      shieldVerdict: finalVerdict,
      shieldScore: finalScore,
      shieldDetections: inboundDetections,
      blocked: false,
      blockReason: null,
      statusCode: 200,
      source: "api-v1",
    });
  } catch (err) {
    console.error("[Chat Completions] Traffic logging error:", err);
  }

  // --- 7. Return OpenAI-format response ---
  return NextResponse.json(responseData, {
    status: 200,
    headers: {
      "X-ClawNex-Shield-Verdict": finalVerdict,
      "X-ClawNex-Shield-Score": String(finalScore),
      "X-ClawNex-Request-Id": trafficId,
    },
  });
}

// ---------------------------------------------------------------------------
// Traffic logging helper
// ---------------------------------------------------------------------------

interface TrafficLogEntry {
  id: string;
  model: string;
  provider: string;
  messagesCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  shieldVerdict: string;
  shieldScore: number;
  shieldDetections: unknown[];
  blocked: boolean;
  blockReason: string | null;
  statusCode: number;
  errorMsg?: string;
  source: string;
}

/**
 * Insert a traffic record into proxy_traffic and broadcast via SSE.
 */
function logTraffic(entry: TrafficLogEntry): void {
  run(
    `INSERT INTO proxy_traffic (id, timestamp, direction, model, provider, upstream_url, prompt_hash, messages_count, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, shield_verdict, shield_score, shield_detections, blocked, block_reason, session_id, status_code, error, source)
     VALUES (?, datetime('now'), 'inbound', ?, ?, 'litellm-proxy', null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?)`,
    [
      entry.id,
      entry.model,
      entry.provider,
      entry.messagesCount,
      entry.inputTokens,
      entry.outputTokens,
      entry.totalTokens,
      entry.costUsd,
      entry.latencyMs,
      entry.shieldVerdict,
      entry.shieldScore,
      JSON.stringify(entry.shieldDetections),
      entry.blocked ? 1 : 0,
      entry.blockReason,
      entry.statusCode,
      entry.errorMsg || null,
      entry.source,
    ]
  );

  // Broadcast to dashboard via SSE
  try {
    broadcast("proxy_traffic", {
      id: entry.id,
      model: entry.model,
      provider: entry.provider,
      shield_verdict: entry.shieldVerdict,
      shield_score: entry.shieldScore,
      source: entry.source,
      direction: "inbound",
    });
  } catch { /* SSE broadcast is best-effort */ }
}
