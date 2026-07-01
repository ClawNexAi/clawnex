#!/bin/bash
# Keep Next standalone output limited to runtime assets plus the docs that
# /api/docs explicitly serves. Output tracing otherwise pulls the whole docs/
# tree because the route reads from process.cwd()/docs.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE="$ROOT/.next/standalone"

[ -d "$STANDALONE" ] || exit 0

cp -r "$ROOT/public" "$STANDALONE/" 2>/dev/null || true
mkdir -p "$STANDALONE/.next"
cp -r "$ROOT/.next/static" "$STANDALONE/.next/" 2>/dev/null || true

rm -f \
  "$STANDALONE/AGENTS.md" \
  "$STANDALONE/CLAUDE.md" \
  "$STANDALONE/.env" \
  "$STANDALONE/.env."* \
  "$STANDALONE/clawnex.db" \
  "$STANDALONE/clawnex.db-wal" \
  "$STANDALONE/clawnex.db-shm" \
  "$STANDALONE/clawnex.db-journal" \
  "$STANDALONE/sentinel.db" \
  "$STANDALONE/sentinel.db-wal" \
  "$STANDALONE/sentinel.db-shm" \
  "$STANDALONE/sentinel.db-journal" \
  "$STANDALONE/litellm/config.yaml" \
  "$STANDALONE"/litellm/config*.yaml \
  "$STANDALONE/.deploy-build.log" 2>/dev/null || true

rm -rf \
  "$STANDALONE/.agents" \
  "$STANDALONE/.claude" \
  "$STANDALONE/.codex" \
  "$STANDALONE/.cursor" \
  "$STANDALONE/.git" \
  "$STANDALONE/.gstack" \
  "$STANDALONE/.vscode" \
  "$STANDALONE/skills" \
  "$STANDALONE/scripts" \
  "$STANDALONE/logs" \
  "$STANDALONE/docs" 2>/dev/null || true

mkdir -p "$STANDALONE/docs/policies" "$STANDALONE/docs/registers"

root_docs=(
  "CHANGELOG.md"
  "CONTRIBUTING.md"
  "SECURITY.md"
  "SUPPORT.md"
)

for rel in "${root_docs[@]}"; do
  [ -f "$ROOT/$rel" ] && cp "$ROOT/$rel" "$STANDALONE/$rel"
done

docs=(
  "06-basic-user-manual.md"
  "07-advanced-user-manual.md"
  "10-api-reference.md"
  "13-release-notes.md"
  "14-data-dictionary.md"
  "17-troubleshooting-guide.md"
  "19-api-mcp-integration-guide.md"
  "governance-index.md"
  "governance-one-pager.md"
  "policy-evidence-checklist.md"
)

for rel in "${docs[@]}"; do
  [ -f "$ROOT/docs/$rel" ] && cp "$ROOT/docs/$rel" "$STANDALONE/docs/$rel"
done

for rel in \
  README.md \
  01-information-security-policy.md \
  02-access-control-policy.md \
  03-incident-response-policy.md \
  04-change-management-policy.md \
  05-vendor-third-party-risk-policy.md \
  06-risk-management-policy.md \
  07-secure-sdlc-policy.md \
  08-data-classification-policy.md \
  09-data-retention-and-disposal-policy.md \
  10-bcp-dr-policy.md \
  11-cryptographic-controls-policy.md \
  12-asset-management-policy.md \
  13-vulnerability-management-policy.md \
  14-acceptable-use-policy.md; do
  [ -f "$ROOT/docs/policies/$rel" ] && cp "$ROOT/docs/policies/$rel" "$STANDALONE/docs/policies/$rel"
done

for rel in risk-register.md vendor-inventory-register.md; do
  [ -f "$ROOT/docs/registers/$rel" ] && cp "$ROOT/docs/registers/$rel" "$STANDALONE/docs/registers/$rel"
done
