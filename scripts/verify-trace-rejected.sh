#!/usr/bin/env bash
# =============================================================================
# verify-trace-rejected.sh — DAST 2026-05-15 #8 fix guard.
#
# Asserts src/middleware.ts rejects HTTP TRACE at the top of the
# middleware function with status 405 + RFC-7231 Allow header, before
# any nonce/RBAC work. TRACE is historically abused for cross-site
# credential reflection ("Cross-Site Tracing").
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

exec npx --no-install tsx scripts/verify-trace-rejected.ts
