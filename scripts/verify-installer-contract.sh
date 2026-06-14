#!/bin/bash
# =============================================================================
# verify-installer-contract.sh — static invariants for the single installer.
#
# Asserts the load-bearing contract between install.sh (orchestrator),
# setup.sh (engine), deploy/lib-macos.sh + deploy/install-prod.sh (service
# layers), uninstall.sh (removal), and package.sh (shipping manifest).
# Runs with no network and no root; safe in CI.
# =============================================================================
set -u
cd "$(dirname "$0")/.."
FAIL=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAIL=1; }
assert_grep()  { grep -qE -e "$2" "$1" 2>/dev/null && pass "$1: $3" || fail "$1: $3"; }
assert_nogrep(){ grep -qE -e "$2" "$1" 2>/dev/null && fail "$1: $3" || pass "$1: $3"; }

echo "[1] setup.sh engine switches"
assert_grep setup.sh '\-\-preseeded\)' "parses --preseeded"
assert_grep setup.sh '\-\-no-start\)'  "parses --no-start"
assert_grep setup.sh 'CLAWNEX_ANSWER_'  "_tty_read honors CLAWNEX_ANSWER_* preseeds"
assert_grep setup.sh 'CLAWNEX_NO_START" = "1' "phase-10 starts gated on CLAWNEX_NO_START"
assert_grep setup.sh 'python3\.13 python3\.12 python3\.11 python3\.10' "LiteLLM Python resolver prefers explicit modern interpreters"
assert_grep setup.sh 'Install/upgrade Python 3\.12 via Homebrew for LiteLLM' "prompts macOS operator to install/upgrade Python when LiteLLM needs it"
assert_grep setup.sh 'Upgrade/reinstall Homebrew Python 3\.12 for LiteLLM' "prompts to upgrade/reinstall Homebrew Python when default python3 is stale"
assert_grep setup.sh 'INSTALL_TOPOLOGY_LABEL="Local \(RBAC on, localhost only\)"' "local mode uses RBAC + first-admin setup"
assert_grep setup.sh 'RBAC_ENABLED_VAL="true"' "local default enables RBAC"
assert_nogrep setup.sh 'npx next build 2>&1[[:space:]]*\|[[:space:]]*tail' "build failures are not hidden behind tail"
assert_nogrep setup.sh 'npm install --prefer-offline 2>&1[[:space:]]*\|[[:space:]]*tail' "npm install failures are not hidden behind tail"

echo "[2] install.sh orchestrator"
assert_grep install.sh 'setup\.sh --preseeded --no-start' "routes ALL modes through the engine"
assert_nogrep install.sh 'npm install' "no duplicated engine work (npm install) in orchestrator"
assert_grep install.sh '\-\-clean'   "has --clean flag for non-interactive wipe consent"
assert_grep install.sh 'mac-server'   "mac-server mode exists"
assert_grep install.sh 'mac-local'    "mac-local mode exists"
assert_grep install.sh 'lib-macos\.sh' "mac modes call the macOS service layer"
assert_grep install.sh 'clawnex-pre-install-backup' "Phase 0 archives DB outside install dir"
assert_grep install.sh 'force-clean'  "Phase 0 reuses uninstall.sh as the one removal path"
assert_grep install.sh 'runtime artifacts in THIS directory' "Phase 0 detects failed/in-place install leftovers"
assert_grep install.sh 'In-place retry: runtime artifacts removed; source tree preserved' "Phase 0 removes failed runtime artifacts before retry"
assert_grep install.sh 'clawnex CLI symlink' "Phase 0 detects stale/global clawnex CLI symlink"
assert_grep install.sh 'clawnex-v\*-deploy' "Phase 0 scans versioned deploy directories"
assert_grep install.sh 'lsof -a -p "\$P0_PID" -d cwd' "Phase 0 derives macOS port owner install dir"
assert_grep install.sh '_p0_macos_stop_clawnex_launchd' "Phase 0 in-place retry unloads macOS launchd services"
assert_grep install.sh 'launchctl bootout "gui/\$\{_uid\}/\$\{_label\}"' "Phase 0 tries macOS label bootout before port check"
assert_grep install.sh 'rm -f "\$_plist"' "Phase 0 removes old macOS launchd plists so KeepAlive cannot restart"
assert_grep install.sh '_p0_macos_kill_install_port_owners' "Phase 0 has scoped macOS port-owner fallback"
assert_grep install.sh 'kill -9 "\$_pid"' "Phase 0 escalates only install-owned Mac port processes if TERM fails"
assert_grep install.sh '"needsSetup":true' "post-start verify requires first-run setup gate"

echo "[2b] package dependency pins"
assert_grep package.json '"postcss": "8\.4\.31"' "postcss pin uses conservative version already present in Next lock graph"
assert_nogrep package.json '"postcss": "8\.5\.' "unresolved postcss 8.5.x pins retired"

echo "[3] macOS service layer"
assert_grep deploy/lib-macos.sh 'io\.clawnex\.dashboard' "dashboard launchd label"
assert_grep deploy/lib-macos.sh 'io\.clawnex\.litellm'   "litellm launchd label"
assert_grep deploy/lib-macos.sh 'KeepAlive'              "KeepAlive set"
assert_grep deploy/lib-macos.sh 'DASHBOARD_BIND="127\.0\.0\.1"' "macOS dashboard always binds loopback"

echo "[4] uninstall parity"
assert_grep scripts/uninstall.sh 'io\.clawnex\.litellm\.plist' "uninstall removes litellm plist"
assert_grep scripts/uninstall.sh '\.local/bin/clawnex' "uninstall removes clawnex CLI symlink"

echo "[5] shipping manifest"
assert_grep deploy/package.sh 'lib-macos\.sh' "tarball ships lib-macos.sh"
assert_grep deploy/package.sh 'third_party/' "tarball ships bundled third-party scanner files"

echo "[5b] bundled host security scanner"
assert_grep setup.sh 'Host security scanner bundled with ClawNex' "setup uses bundled host security scanner"
assert_nogrep setup.sh 'clawkeeper\.dev/install\.sh|raw\.githubusercontent\.com/rad-security/clawkeeper' "setup does not download Clawkeeper at runtime"
assert_grep src/lib/services/host-security/scanner-path.ts 'third_party.*clawkeeper.*clawkeeper\.sh' "scanner helper points at bundled scanner"
assert_grep src/lib/services/clawkeeper-runner.ts 'findHostSecurityScanner' "runner uses shared scanner discovery"
assert_grep src/app/api/system/install-clawkeeper/route.ts 'no network install is required' "compat install endpoint is local-only"
assert_nogrep src/app/api/system/install-clawkeeper/route.ts 'raw\.githubusercontent\.com/rad-security/clawkeeper|execSync|execFile|curl -fsSL' "compat install endpoint does not download or execute installer"
assert_nogrep src/app/api/config/updates/route.ts 'rad-security/clawkeeper|CLAWKEEPER_PINNED_SHA|CLAWKEEPER_SHA256|execFile' "updates endpoint does not fetch Clawkeeper releases or scripts"
if [ -x third_party/clawkeeper/clawkeeper.sh ]; then
    pass "vendored scanner is executable"
    _scanner_sha="$(shasum -a 256 third_party/clawkeeper/clawkeeper.sh 2>/dev/null | awk '{print $1}')"
    [ "$_scanner_sha" = "e288603da69f71c6c0c922e6efdae14b652a13e7b850bacfd99aa3af55c32418" ] \
        && pass "vendored scanner checksum matches pinned upstream copy" \
        || fail "vendored scanner checksum matches pinned upstream copy"
else
    fail "vendored scanner is executable"
fi

echo "[6] stale installers retired"
[ ! -f scripts/install.sh ] && pass "scripts/install.sh deleted" || fail "scripts/install.sh still present (offers Docker)"
[ ! -f deploy/deploy.sh ]   && pass "deploy/deploy.sh deleted"   || fail "deploy/deploy.sh still present (legacy)"

echo "[7] bash syntax"
for f in install.sh setup.sh deploy/lib-macos.sh deploy/install-prod.sh scripts/uninstall.sh deploy/package.sh; do
    [ -f "$f" ] || { fail "$f missing"; continue; }
    bash -n "$f" && pass "bash -n $f" || fail "bash -n $f"
done

if [ "$FAIL" = "0" ]; then echo "ALL CONTRACT CHECKS PASS"; exit 0; else echo "CONTRACT FAILURES ABOVE"; exit 1; fi
