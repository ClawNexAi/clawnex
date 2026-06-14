#!/usr/bin/env bash
# =============================================================================
# verify-audit-pagination-clamp.sh — DAST 2026-05-15 #7 fix guard.
#
# Asserts the audit list endpoints (/api/audit, /api/v1/audit) and the
# underlying listEvents() service cap pagination at MAX_AUDIT_LIMIT
# (100). Both the route-boundary parser (clampAuditLimit) and the
# service layer (listEvents) enforce the cap.
#
# Uses DATABASE_PATH=:memory: so the in-process SQLite holds no live
# data — seeds 200 rows, asks for 999999, asserts ≤ 100 comes back.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

exec env DATABASE_PATH=:memory: npx --no-install tsx scripts/verify-audit-pagination-clamp.ts
