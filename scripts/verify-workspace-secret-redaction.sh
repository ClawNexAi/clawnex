#!/usr/bin/env bash
# =============================================================================
# verify-workspace-secret-redaction.sh — guards CX-R14-02.
#
# `workspace:read` is granted to the operator role and to every higher tier.
# Without redaction, an operator-tier account could call
# /api/workspace/file?path=openclaw.json and read provider API keys verbatim.
#
# This test plants a fake openclaw.json containing OpenRouter / Anthropic /
# OpenAI keys, drives readWorkspaceFile, and asserts the returned content has
# the values replaced with <redacted> while the shape (key names + JSON
# structure) is preserved so operators can still see which providers are
# configured.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="$(mktemp -d -t clawnex-redact-test-XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

FAKE_OC="$TMPDIR/.openclaw"
mkdir -p "$FAKE_OC/workspace"

# Fake openclaw.json with several secret-bearing shapes
cat > "$FAKE_OC/workspace/openclaw.json" <<'JSON'
{
  "models": {
    "providers": {
      "openrouter": {
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "redaction-fixture-openrouter-value",
        "api": "openai-completions"
      },
      "anthropic": {
        "baseUrl": "https://api.anthropic.com",
        "api_key": "redaction-fixture-anthropic-value"
      },
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "token": "redaction-fixture-openai-value"
      }
    }
  },
  "gateways": [
    { "name": "primary", "url": "ws://localhost:9000", "bearer": "gw-bearer-token-xyz" }
  ]
}
JSON

export OPENCLAW_HOME="$FAKE_OC"

OUTPUT="$(cd "$REPO_ROOT" && npx --no-install tsx --eval "
import { readWorkspaceFile } from './src/lib/services/workspace-reader';

const result = readWorkspaceFile('openclaw.json');
const content = result ? result.content : '';

const leaks = [
  'redaction-fixture-openrouter-value',
  'redaction-fixture-anthropic-value',
  'redaction-fixture-openai-value',
  'gw-bearer-token-xyz',
];
const leaked = leaks.filter((s) => content.includes(s));

// Shape preservation: key names + provider names should still be visible
const shapeOK =
  content.includes('apiKey') &&
  content.includes('api_key') &&
  content.includes('token') &&
  content.includes('bearer') &&
  content.includes('openrouter') &&
  content.includes('<redacted>');

console.log(JSON.stringify({
  read_ok: !!result,
  leaked_secret_count: leaked.length,
  leaked_secrets: leaked,
  shape_preserved: shapeOK,
}));
" 2>&1)"

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q '"read_ok":true' \
   && echo "$OUTPUT" | grep -q '"leaked_secret_count":0' \
   && echo "$OUTPUT" | grep -q '"shape_preserved":true'; then
  echo "PASS — workspace reader redacts secrets, preserves file shape"
  exit 0
fi

echo "FAIL — readWorkspaceFile is leaking plaintext credentials or destroying file shape"
exit 1
