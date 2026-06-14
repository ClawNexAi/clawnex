/**
 * Outbound shield gate — fail-closed wrapper around outboundScan.
 *
 * Mirrors internal reviewer P1-B's pattern from /api/v1/chat/completions onto the
 * non-LiteLLM paths in /api/chat. The LiteLLM proxy at port 4001 is
 * already shield-scanned at the v1 layer; the LM-Studio-direct and
 * OpenClaw-gateway-direct paths used to return upstream LLM content
 * without an outbound scan. A subtle inbound prompt that scored under
 * the inbound BLOCK threshold could elicit secrets / private keys /
 * sensitive paths from the LLM and the response went back unchecked.
 *
 * The gate has three exit paths:
 *   - scan passes (or BLOCK with block_mode=off) → allow caller to send
 *     the response to the user
 *   - scan returns BLOCK and block_mode=on → 503 with a generic message;
 *     the operator gets the same shape as any other shield-blocked
 *     response so the upstream choice isn't leaked
 *   - scan throws → 503 fail-CLOSED with a generic shield-unavailable
 *     message. Without this, a malformed upstream response that crashes
 *     the scanner would short-circuit ALLOW and leak data.
 *
 * @module shield/outbound-gate
 */

import { NextResponse } from "next/server";
import { outboundScan } from "./scanner";

export type OutboundShieldDecision =
  | { ok: true }
  | { ok: false; response: NextResponse };

export function outboundShieldGate(
  responseContent: string,
  blockMode: string,
  source: string,
): OutboundShieldDecision {
  try {
    const r = outboundScan(responseContent);
    if (r.verdict === "BLOCK") {
      if (blockMode === "on" || blockMode === "block") {
        console.warn(
          `[outbound-gate] BLOCK from ${source}: score=${r.score} top=${r.detections[0]?.id || "none"}`,
        );
        return {
          ok: false,
          response: NextResponse.json(
            {
              error: "Response blocked by ClawNex Shield (outbound).",
              source,
              score: r.score,
              detections: r.stats,
            },
            { status: 503 },
          ),
        };
      }
      console.warn(`[outbound-gate] BLOCK (monitor-only) from ${source}: score=${r.score}`);
    }
    return { ok: true };
  } catch (err) {
    console.error(`[outbound-gate] exception on ${source} — failing CLOSED:`, err);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Shield scanner unavailable on response path — request blocked. Retry shortly.",
          source,
        },
        { status: 503 },
      ),
    };
  }
}
