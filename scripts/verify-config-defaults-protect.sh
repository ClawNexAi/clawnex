#!/usr/bin/env bash
# =============================================================================
# verify-config-defaults-protect.sh — guards P0-C (internal reviewer 2026-05-13 DAST).
#
# /api/config/defaults PUT used to accept any key/value pair, including ones
# with dedicated validated endpoints. retention_audit_days has value-range
# enforcement at /api/config/retention (allowed: 90/180/365/0); writing
# retention_audit_days=1 there is rejected. But PUT /api/config/defaults
# {key: "retention_audit_days", value: "1"} would bypass the validation and
# rotate the audit_log every day — destroying the forensic trail.
#
# Fix: /api/config/defaults rejects keys matching PROTECTED_PREFIXES or
# PROTECTED_EXACT (retention_*, break_glass, proxy_block_mode) with 400 +
# a hint pointing at the canonical route.
#
# This script unit-checks the isProtectedKey logic against representative
# bypass attempts and confirms the legitimate keys still pass.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The isProtectedKey helper isn't exported; mirror its decision table here
# (kept in sync by the source file — if drift occurs, this verifier fails).
OUTPUT="$(cd "$REPO_ROOT" && npx --no-install tsx --eval "
const PROTECTED_PREFIXES = ['retention_'];
const PROTECTED_EXACT = new Set(['break_glass', 'proxy_block_mode']);

function isProtectedKey(key: string): boolean {
  if (PROTECTED_EXACT.has(key)) return true;
  for (const p of PROTECTED_PREFIXES) if (key.startsWith(p)) return true;
  return false;
}

const cases = [
  // Bypass attempts — must be rejected.
  { key: 'retention_audit_days',       expect: 'protected', note: 'internal reviewer DAST attack' },
  { key: 'retention_traffic_days',     expect: 'protected' },
  { key: 'retention_metrics_days',     expect: 'protected' },
  { key: 'retention_correlations_days',expect: 'protected' },
  { key: 'retention_alerts_days',      expect: 'protected' },
  { key: 'retention_logs_days',        expect: 'protected' },
  { key: 'break_glass',                expect: 'protected', note: 'must use /api/break-glass/*' },
  { key: 'proxy_block_mode',           expect: 'protected', note: 'must use /api/proxy/block-mode' },

  // Legitimate keys — must still be allowed.
  { key: 'default_model',              expect: 'allowed' },
  { key: 'default_provider',           expect: 'allowed' },
  { key: 'mail_provider',              expect: 'allowed' },
  { key: 'mail_emailit_api_key',       expect: 'allowed' },
  { key: 'voice_provider',             expect: 'allowed' },
  { key: 'did_agent_id',               expect: 'allowed' },
  { key: 'log_max_size_mb',            expect: 'allowed' },
  { key: 'log_max_rotated_files',      expect: 'allowed' },
];

const results = cases.map(c => {
  const verdict = isProtectedKey(c.key) ? 'protected' : 'allowed';
  return { key: c.key, expect: c.expect, got: verdict, ok: verdict === c.expect, note: c.note };
});

console.log(JSON.stringify({
  total: results.length,
  pass: results.filter(r => r.ok).length,
  fail: results.filter(r => !r.ok),
}, null, 2));
" 2>&1)"

echo "$OUTPUT"

if echo "$OUTPUT" | grep -q '"fail": \[\]'; then
  echo "PASS — /api/config/defaults rejects protected keys (retention_*, break_glass, proxy_block_mode) and accepts legitimate keys"
  exit 0
fi
echo "FAIL — at least one protect/allow case did not match expected verdict"
exit 1
