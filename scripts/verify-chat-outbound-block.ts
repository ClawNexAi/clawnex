/**
 * verify-chat-outbound-block.ts — Codex 2026-05-17 round 3 #1.
 *
 * Sibling regression to verify-v1-outbound-block.ts. The dashboard chat
 * endpoint /api/chat has THREE upstream branches (LiteLLM, LM Studio
 * direct, OpenClaw gateway direct). the reviewer's P1-B work gated the two
 * fallback branches via outboundShieldGate, but the primary LiteLLM
 * branch was never gated — sibling of the v1 vulnerability class Codex
 * caught in round 1. Round 3 closes it AND threads all three branches
 * through extractAssistantOutput so the gate sees every assistant-output
 * channel (tool_calls, delta, multimodal, unknown nested fields), not
 * just message.content.
 *
 * This verifier proves three invariants:
 *   1. All three /api/chat branches contain an outboundShieldGate call.
 *   2. All three branches feed extractAssistantOutput(data) to the gate
 *      (comprehensive scan), not the shallow inline content extract.
 *   3. The gate call is placed BEFORE the NextResponse.json that returns
 *      the model content (so a BLOCK verdict short-circuits the return).
 *
 * Run: npx tsx scripts/verify-chat-outbound-block.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

type Status = { pass: number; fail: number };
const status: Status = { pass: 0, fail: 0 };

function assert(cond: unknown, desc: string) {
  if (cond) {
    status.pass++;
    console.log(`  ✓ ${desc}`);
  } else {
    status.fail++;
    console.log(`  ✗ ${desc}`);
  }
}

function section(name: string) {
  console.log(`\n[${name}]`);
}

const routePath = path.join(__dirname, "..", "src", "app", "api", "chat", "route.ts");
const src = fs.readFileSync(routePath, "utf8");

// ---------------------------------------------------------------------------

section("/api/chat imports the hardened extractor");
assert(/from\s+["']@\/lib\/shield\/extract-assistant-output["']/.test(src), "imports extractAssistantOutput");
assert(/from\s+["']@\/lib\/shield\/outbound-gate["']/.test(src), "imports outboundShieldGate");

section("all 3 LLM-relay branches gate via outboundShieldGate (round-3 parity)");
const litellmGate = /outboundShieldGate\(\s*scanInput\s*,\s*blockMode\s*,\s*["']litellm:proxy["']\s*\)/.test(src);
const lmstudioGate = /outboundShieldGate\(\s*scanInput\s*,\s*blockMode\s*,\s*`lmstudio:\$\{provider\}`/.test(src);
const openclawGate = /outboundShieldGate\(\s*scanInput\s*,\s*blockMode\s*,\s*["']openclaw-gateway["']\s*\)/.test(src);
assert(litellmGate, "LiteLLM branch invokes outboundShieldGate (round-3 #1 fix)");
assert(lmstudioGate, "LM Studio branch invokes outboundShieldGate (internal reviewer P1-B + round-3 extractor upgrade)");
assert(openclawGate, "OpenClaw branch invokes outboundShieldGate (internal reviewer P1-B + round-3 extractor upgrade)");

section("all 3 branches feed extractAssistantOutput(data) — not shallow message.content");
// Count how many places call extractAssistantOutput(data); should be ≥ 3
const extractorCalls = (src.match(/extractAssistantOutput\(\s*data\s*\)/g) || []).length;
assert(extractorCalls >= 3, `extractAssistantOutput(data) called in at least 3 branches (found ${extractorCalls})`);

section("gate placed BEFORE NextResponse.json that returns model content");
// For each branch, the outboundShieldGate call must appear earlier in
// the file than its branch's `return NextResponse.json({ role: "assistant" ...`.
const branchTags: Array<{ label: string; gatePattern: RegExp }> = [
  { label: "LiteLLM",   gatePattern: /outboundShieldGate\([^)]*"litellm:proxy"\)/ },
  { label: "LM Studio", gatePattern: /outboundShieldGate\([^)]*`lmstudio:\$\{provider\}`/ },
  { label: "OpenClaw",  gatePattern: /outboundShieldGate\([^)]*"openclaw-gateway"\)/ },
];
const assistantReturns = [...src.matchAll(/return NextResponse\.json\(\{\s*role:\s*"assistant"/g)].map((m) => m.index ?? -1);

for (const { label, gatePattern } of branchTags) {
  const gateMatch = src.match(gatePattern);
  const gateIdx = gateMatch ? src.indexOf(gateMatch[0]) : -1;
  assert(gateIdx >= 0, `${label} gate location found at index ${gateIdx}`);
  // The corresponding return is the NEXT assistant return after this gate.
  const nextReturn = assistantReturns.find((i) => i > gateIdx);
  assert(
    nextReturn !== undefined && nextReturn > gateIdx,
    `${label} branch: gate@${gateIdx} appears before its return@${nextReturn}`,
  );
}

section("gate uses if (!gate.ok) return gate.response pattern (short-circuit on BLOCK)");
// Should appear at least 3 times (once per branch).
const guardCount = (src.match(/if\s*\(\s*!gate\.ok\s*\)\s*return\s+gate\.response/g) || []).length;
assert(guardCount >= 3, `'if (!gate.ok) return gate.response' appears ≥ 3 times (found ${guardCount})`);

console.log(`\nResult: ${status.pass} passed, ${status.fail} failed`);
if (status.fail > 0) process.exit(1);
