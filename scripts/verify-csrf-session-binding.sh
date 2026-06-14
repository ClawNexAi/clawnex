#!/usr/bin/env bash
# =============================================================================
# verify-csrf-session-binding.sh — DAST 2026-05-15 C1 fix guard.
#
# Asserts that CSRF tokens are bound to a specific session.id via
# HMAC-SHA256(SESSION_SECRET, session.id) and cannot be forged with an
# attacker-chosen cookie/header pair.
#
# The four properties from the operator's brief:
#   1. attacker-chosen "x/x" rejected
#   2. valid pair from session A rejected for session B
#   3. valid pair from session A passes for session A
#   4. missing inputs (incl. post-logout shape) rejected
# Plus fail-closed when no SESSION_SECRET / SETUP_SECRET is configured.
#
# Runs the TypeScript verifier via tsx (no live server required).
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

exec npx --no-install tsx scripts/verify-csrf-session-binding.ts
