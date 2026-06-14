#!/usr/bin/env bash
# =============================================================================
# verify-outbound-gate.sh — guards M4-related (DAST 2026-05-14).
#
# The chat route's LM-Studio-direct and OpenClaw-gateway-direct paths
# now run upstream LLM responses through outboundShieldGate before
# returning to the operator. The gate mirrors internal reviewer P1-B's fail-closed
# pattern from /api/v1/chat/completions onto these two non-LiteLLM
# paths.
#
# This drives the exported helper through tsx with representative
# scenarios:
#   - benign content with block_mode=on   → ok=true
#   - outbound BLOCK with block_mode=on   → 503
#   - outbound BLOCK with block_mode=off  → ok=true (monitor-only)
#   - empty / minimal content             → ok=true (no detections)
#
# Note: this is a unit-level verifier on the gate function — the actual
# integration of the gate into /api/chat callsites is covered by code
# review (the LM-Studio and OpenClaw fallback paths in chat/route.ts
# both call outboundShieldGate before returning).
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

OUTPUT="$(cd "$REPO_ROOT" && npx --no-install tsx --eval "
import { outboundShieldGate } from './src/lib/shield/outbound-gate';

// A payload that the outbound shield catches. The OUT-PRIVATE_KEY_MATERIAL
// rule (CRITICAL) fires on the BEGIN/END PRIVATE KEY marker — easy to
// construct, doesn't require live deployment state.
const exfilPayload = '-----BEGIN RSA PRIVATE KEY-----\n' +
  'MIIEowIBAAKCAQEAfakekey0123456789ABCDEFghijklmnopqrstuvwxyz\n' +
  '-----END RSA PRIVATE KEY-----';

const benign = 'Hello! Here is the answer to your question: 42.';

const cases = [
  { label: 'benign content + block_mode=on',     content: benign,       mode: 'on',  expect: 'allow' },
  { label: 'benign content + block_mode=off',    content: benign,       mode: 'off', expect: 'allow' },
  { label: 'exfil payload + block_mode=on',      content: exfilPayload, mode: 'on',  expect: 'block' },
  { label: 'exfil payload + block_mode=block',   content: exfilPayload, mode: 'block', expect: 'block' },
  { label: 'exfil payload + block_mode=off',     content: exfilPayload, mode: 'off', expect: 'allow' },
  { label: 'empty content',                       content: '',           mode: 'on',  expect: 'allow' },
];

const results = cases.map(c => {
  const result = outboundShieldGate(c.content, c.mode, 'verifier');
  let verdict;
  if (result.ok) {
    verdict = 'allow';
  } else if (result.response.status === 503) {
    verdict = 'block';
  } else {
    verdict = 'unknown_' + result.response.status;
  }
  return { label: c.label, expect: c.expect, got: verdict, ok: verdict === c.expect };
});

console.log(JSON.stringify({
  total: results.length,
  pass: results.filter(r => r.ok).length,
  fail: results.filter(r => !r.ok),
}, null, 2));
" 2>&1)"

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q '"fail": \[\]'; then
  echo "PASS — outbound shield gate blocks exfil when block_mode=on, allows benign + monitor-only modes"
  exit 0
fi
echo "FAIL — at least one outbound-gate case did not match expected verdict"
exit 1
