#!/usr/bin/env bash
# DAST 2026-05-15 H2 (Run 2) wrapper for verify-db-perms.ts.
# Creates a throwaway DB under /tmp and asserts the DB triple
# (main + WAL + SHM) is 600, not 644.
set -euo pipefail

cd "$(dirname "$0")/.."

TMPDIR_PATH="$(mktemp -d -t clawnex-h2-XXXXXX)"
DB_PATH="$TMPDIR_PATH/clawnex.db"

cleanup() {
  rm -rf "$TMPDIR_PATH"
}
trap cleanup EXIT

# Force umask=022 in the wrapper so the test is honest: if the runtime
# fix is removed, the DB triple would be 644 here.
umask 022

DATABASE_PATH="$DB_PATH" npx tsx scripts/verify-db-perms.ts
