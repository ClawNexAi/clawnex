#!/usr/bin/env bash
# =============================================================================
# verify-vacuum-into-sanitize.sh — DAST 2026-05-15 #6 fix guard.
#
# Asserts that src/lib/db/vacuum-into.ts rejects path-injection shapes
# (slash, backslash, .., quotes, null byte, empty / wrong-type)
# BEFORE concatenating into the VACUUM INTO SQL statement.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

exec npx --no-install tsx scripts/verify-vacuum-into-sanitize.ts
