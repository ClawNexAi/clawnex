#!/usr/bin/env bash
# DAST 2026-05-15 Run 2 targeted-fix harness wrapper.
#
# requireLocalhost reads HOSTNAME to decide whether the bind is
# loopback-only — and synthetic NextRequest in the verifier has no
# .ip, so without HOSTNAME=127.0.0.1 the prod-mode fall-through
# returns 403 before /api/chat's content-type check fires.
# Setting HOSTNAME here simulates the real systemd-unit bind that
# production runs under.
set -euo pipefail

cd "$(dirname "$0")/.."

# Pin DATABASE_PATH to /tmp so the verifier doesn't write to the
# real clawnex.db. Pin HOSTNAME so requireLocalhost reads
# isLoopbackBind() === true and lets the chat content-type check
# decide the response.
TMPDIR_PATH="$(mktemp -d -t clawnex-dast-r2-XXXXXX)"
cleanup() { rm -rf "$TMPDIR_PATH"; }
trap cleanup EXIT

DATABASE_PATH="$TMPDIR_PATH/clawnex.db" \
HOSTNAME="127.0.0.1" \
  npx tsx scripts/verify-dast-run2-fixes.ts
