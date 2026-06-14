/**
 * verify-extract-assistant-output.ts — Codex 2026-05-17 round 2 #1 + r3 #2.
 *
 * Round 2 fix: extract from every known channel (legacy text, content
 * arrays, tool_calls, function_call) instead of only message.content.
 *
 * Round 3 fix: hardened the extractor against shape variations and mixed
 * input. The matrix below covers every cell from the round-3 sweep:
 *   - non-string tool/function arguments (object, array)
 *   - mixed known + unknown (benign content + object args → both reach scanner)
 *   - object as message.content (provider extension)
 *   - streaming delta channel (choices[].delta + message.delta)
 *   - unknown nested message fields with canonical present
 *   - unknown choice-level fields with canonical present
 *
 * Run: npx tsx scripts/verify-extract-assistant-output.ts
 */

import { extractAssistantOutput } from "../src/lib/shield/extract-assistant-output";
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

// Canonical exfil marker — OUT-PRIVATE_KEY_MATERIAL rule (CRITICAL, BLOCK).
const EXFIL = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAfake1234567890ABCDEFghijklmn\n-----END RSA PRIVATE KEY-----";

function expectsBlock(extracted: string, label: string) {
  assert(extracted.includes(EXFIL.slice(0, 30)), `${label} — extractor surfaces the exfil bytes`);
  const r = outboundScan(extracted);
  assert(r.verdict === "BLOCK", `${label} — outboundScan(extracted) === BLOCK (got '${r.verdict}', score=${r.score})`);
}

// ---------------------------------------------------------------------------

section("benign / empty inputs");
assert(extractAssistantOutput(null) === "", "null responseData → empty string");
assert(extractAssistantOutput(undefined) === "", "undefined responseData → empty string");
assert(extractAssistantOutput({}) === "", "{} responseData → empty string");
assert(extractAssistantOutput({ choices: [] }) === "", "empty choices[] → empty string");
const benign = extractAssistantOutput({ choices: [{ message: { content: "Hello! 42." } }] });
assert(outboundScan(benign).verdict !== "BLOCK", `benign message.content → outbound not BLOCK (got '${outboundScan(benign).verdict}')`);

section("channel: choices[].message.content (string)");
expectsBlock(extractAssistantOutput({ choices: [{ message: { content: EXFIL } }] }), "string content");

section("channel: choices[].text (legacy /completions)");
expectsBlock(extractAssistantOutput({ choices: [{ text: EXFIL }] }), "legacy completions text");

section("channel: choices[].message.content as array (multimodal parts)");
expectsBlock(
  extractAssistantOutput({
    choices: [
      {
        message: {
          content: [
            { type: "text", text: "Here you go:" },
            { type: "text", text: EXFIL },
          ],
        },
      },
    ],
  }),
  "multimodal content parts",
);

section("channel: tool_calls[].function.arguments (string)");
expectsBlock(
  extractAssistantOutput({
    choices: [
      {
        message: {
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "exfiltrate", arguments: EXFIL } },
          ],
        },
      },
    ],
  }),
  "tool_calls.function.arguments string",
);

section("channel: function_call.arguments (string, legacy tools)");
expectsBlock(
  extractAssistantOutput({
    choices: [{ message: { function_call: { name: "send", arguments: EXFIL } } }],
  }),
  "function_call.arguments string",
);

// ---------------------------------------------------------------------------
// Round 3 #2 — shape-variation matrix
// ---------------------------------------------------------------------------

section("r3 #2 shape: tool_calls.function.arguments as OBJECT (structured output)");
expectsBlock(
  extractAssistantOutput({
    choices: [
      {
        message: {
          tool_calls: [
            { function: { name: "send", arguments: { payload: EXFIL } } },
          ],
        },
      },
    ],
  }),
  "tool_calls.function.arguments object",
);

section("r3 #2 shape: tool_calls.function.arguments as ARRAY");
expectsBlock(
  extractAssistantOutput({
    choices: [
      {
        message: {
          tool_calls: [
            { function: { name: "batch", arguments: [{ secret: EXFIL }, "etc"] } },
          ],
        },
      },
    ],
  }),
  "tool_calls.function.arguments array",
);

section("r3 #2 shape: function_call.arguments as OBJECT");
expectsBlock(
  extractAssistantOutput({
    choices: [{ message: { function_call: { name: "wrap", arguments: { embedded: EXFIL } } } }],
  }),
  "function_call.arguments object",
);

section("r3 #2 shape: message.content as bare OBJECT (provider extension)");
expectsBlock(
  extractAssistantOutput({ choices: [{ message: { content: { wrapper: EXFIL } } }] }),
  "message.content object",
);

section("r3 #2 shape: streaming choices[].delta with content + tool_calls");
expectsBlock(
  extractAssistantOutput({
    choices: [
      {
        delta: {
          content: "OK, sending:",
          tool_calls: [{ function: { name: "exfil", arguments: { hidden: EXFIL } } }],
        },
      },
    ],
  }),
  "choices[].delta streaming shape",
);

section("r3 #2 mixed: benign content + tool_calls(object args) — round 2 silently dropped this");
expectsBlock(
  extractAssistantOutput({
    choices: [
      {
        message: {
          content: "Hello, here is your data:",
          tool_calls: [{ function: { name: "send", arguments: { payload: EXFIL } } }],
        },
      },
    ],
  }),
  "mixed canonical+object-args",
);

section("r3 #2 mixed: benign content + UNKNOWN nested message field carrying exfil");
expectsBlock(
  extractAssistantOutput({
    choices: [
      {
        message: {
          content: "OK.",
          // refusal / audio / provider extensions — anything not in the
          // known-message-field set must still be scanned.
          provider_extra: { secret: EXFIL },
        } as Record<string, unknown>,
      },
    ],
  }),
  "mixed canonical+unknown-message-field",
);

section("r3 #2 mixed: benign content + UNKNOWN choice-level field carrying exfil");
expectsBlock(
  extractAssistantOutput({
    choices: [
      {
        message: { content: "OK." },
        novel_choice_field: { hidden: EXFIL },
      } as Record<string, unknown>,
    ],
  }),
  "mixed canonical+unknown-choice-field",
);

section("r3 #2 mixed: unknown nested object inside content part");
expectsBlock(
  extractAssistantOutput({
    choices: [
      {
        message: {
          content: [
            { type: "text", text: "OK" },
            { type: "tool_result", output: { embedded: EXFIL } },
          ],
        },
      },
    ],
  }),
  "unknown content-part with nested exfil",
);

section("regression: unknown choice shape with NO canonical (round 2 fallback path)");
const unknownShape = extractAssistantOutput({
  choices: [{ index: 0, novel_field: { embedded_secret: EXFIL } } as unknown],
});
assert(unknownShape.includes(EXFIL.slice(0, 30)), `unknown choice shape (no canonical) → JSON stringification surfaces exfil bytes`);
assert(outboundScan(unknownShape).verdict === "BLOCK", `outboundScan(unknown shape) === BLOCK`);

section("regression: multi-channel canonical combo (chat + tools)");
const combo = extractAssistantOutput({
  choices: [
    {
      message: {
        content: [{ type: "text", text: "OK, sending now." }],
        tool_calls: [{ function: { name: "exfil", arguments: EXFIL } }],
      },
    },
  ],
});
assert(combo.includes(EXFIL.slice(0, 30)), `multi-channel — tool_calls.arguments still surfaced`);
assert(outboundScan(combo).verdict === "BLOCK", `multi-channel outboundScan === BLOCK`);

console.log(`\nResult: ${status.pass} passed, ${status.fail} failed`);
if (status.fail > 0) process.exit(1);
