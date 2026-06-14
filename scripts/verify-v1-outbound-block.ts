/**
 * verify-v1-outbound-block.ts — Codex 2026-05-17 #1 regression.
 *
 * The v1 OpenAI-compatible chat endpoint used to return the LLM response
 * body even when the outbound shield classified it as BLOCK — DLP/secrets
 * egress was reduced to a response header.
 *
 * This verifier proves two invariants:
 *   1. The v1 route source contains the outbound-BLOCK gate (code shape).
 *   2. outboundScan flags the canonical exfil payload as BLOCK so the
 *      gate has something to fire on (behavioural coupling).
 *
 * Run: npx tsx scripts/verify-v1-outbound-block.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { outboundScan } from "../src/lib/shield/scanner";

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

// ---------------------------------------------------------------------------

section("v1/chat/completions/route.ts contains the outbound-BLOCK gate");
const routePath = path.join(__dirname, "..", "src", "app", "api", "v1", "chat", "completions", "route.ts");
const routeSrc = fs.readFileSync(routePath, "utf8");

assert(
  /outboundVerdict\s*===\s*"BLOCK"/.test(routeSrc),
  "route source has an outboundVerdict === 'BLOCK' guard",
);
assert(
  /getSetting\(\s*"proxy_block_mode"\s*\)/.test(routeSrc),
  "route source reads proxy_block_mode at request time",
);
assert(
  /blockMode\s*===\s*"on"\s*\|\|\s*blockMode\s*===\s*"block"/.test(routeSrc),
  "route source honors blockMode on/block",
);
assert(
  /Response blocked by ClawNex Shield \(outbound\)/.test(routeSrc),
  "route source returns the generic outbound-block 503 message (no upstream leak)",
);
// The gate must run BEFORE the FINAL 200-success path that returns the
// LLM response body. There are TWO `return NextResponse.json(responseData,
// ...)` sites: an earlier one that passes an upstream LiteLLM non-2xx
// through (correctly NOT gated — outbound scan doesn't apply to upstream
// error envelopes), and a later one that returns the successful LLM
// response (MUST be gated). lastIndexOf gives us the success-path site;
// the guard must appear before it.
const guardIdx = routeSrc.search(/outboundVerdict\s*===\s*"BLOCK"/);
const successReturn = "return NextResponse.json(responseData,";
const successIdx = routeSrc.lastIndexOf(successReturn);
assert(
  guardIdx > 0 && successIdx > 0 && guardIdx < successIdx,
  `outbound-BLOCK guard appears before the final 200-response return (guard@${guardIdx} < success@${successIdx})`,
);

section("outboundScan flags canonical exfil payload as BLOCK (gate has fire signal)");
const exfilPayload =
  "-----BEGIN RSA PRIVATE KEY-----\n" +
  "MIIEowIBAAKCAQEAfakekey0123456789ABCDEFghijklmnopqrstuvwxyz\n" +
  "-----END RSA PRIVATE KEY-----";
const r = outboundScan(exfilPayload);
assert(r.verdict === "BLOCK", `outboundScan(PRIVATE KEY payload) verdict='BLOCK' (got '${r.verdict}', score=${r.score})`);

const benign = "Hello! Here is the answer to your question: 42.";
const rBenign = outboundScan(benign);
assert(rBenign.verdict !== "BLOCK", `outboundScan(benign) verdict !== 'BLOCK' (got '${rBenign.verdict}')`);

console.log(`\nResult: ${status.pass} passed, ${status.fail} failed`);
if (status.fail > 0) process.exit(1);
