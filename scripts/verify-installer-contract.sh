#!/bin/bash
# =============================================================================
# verify-installer-contract.sh — static invariants for the single installer.
#
# Asserts the load-bearing contract between install.sh (orchestrator),
# setup.sh (engine), deploy/lib-linux-local.sh + deploy/lib-macos.sh +
# deploy/install-prod.sh (service layers), uninstall.sh (removal), and
# package.sh (shipping manifest).
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
assert_grep setup.sh 'Using \$PYTHON_CMD' "uses discovered modern Python even when default python3 is stale"
assert_nogrep setup.sh 'Upgrade/reinstall Homebrew Python 3\.12 for LiteLLM' "does not upgrade Homebrew Python when a usable modern Python was already found"
assert_grep setup.sh 'LiteLLM install attempted but version check failed' "LiteLLM install verifies exact required version"
assert_grep setup.sh 'exit 1' "setup exits on required dependency failure"
assert_nogrep setup.sh 'Dashboard will still come up; the proxy will be skipped' "LiteLLM dependency failure is not allowed to half-install"
assert_grep setup.sh 'Could not install CLI shortcut' "optional clawnex CLI shortcut failure is non-fatal"
assert_grep setup.sh 'INSTALL_TOPOLOGY_LABEL="Local \(RBAC on, localhost only\)"' "local mode offers RBAC + first-admin setup"
assert_grep setup.sh 'INSTALL_TOPOLOGY_LABEL="Local \(RBAC off, localhost only\)"' "local mode offers RBAC-off localhost-only setup"
assert_grep setup.sh 'Select local auth mode \[1/2\] \[1\]' "local auth prompt defaults to RBAC on"
assert_grep setup.sh 'NEXT_PUBLIC_RBAC_ENABLED_VAL="false"' "local RBAC-off mode disables build-time RBAC flag"
assert_grep setup.sh 'NVIDIA NIM[[:space:]]+— NVIDIA-hosted models via NIM API' "engine provider menu exposes NVIDIA NIM"
assert_grep setup.sh 'Get an NVIDIA API key: https://build\.nvidia\.com/models' "engine points operators to NVIDIA Build for API keys"
assert_grep setup.sh 'NVIDIA_DEFAULT_BASE_URL="https://integrate\.api\.nvidia\.com/v1"' "engine defaults NVIDIA to the official NIM API base"
assert_grep setup.sh 'model: "nvidia_nim/\$\{NVIDIA_MODEL\}"' "engine writes LiteLLM NVIDIA NIM model prefix"
assert_grep setup.sh 'PROVIDER_REG_TYPE="nvidia-nim"' "engine registers NVIDIA provider type"
assert_grep setup.sh 'PROVIDER_REG_MODEL_ID="\$NVIDIA_MODEL"' "engine registers selected NVIDIA model"
assert_nogrep setup.sh 'Local model[[:space:]]+— LM Studio or Ollama' "engine first-run menu does not expose LM Studio/Ollama"
assert_nogrep setup.sh 'Ollama[[:space:]]+— http://localhost:11434/v1' "engine first-run menu does not expose Ollama"
assert_nogrep setup.sh 'npx next build 2>&1[[:space:]]*\|[[:space:]]*tail' "build failures are not hidden behind tail"
assert_nogrep setup.sh 'npm install --prefer-offline 2>&1[[:space:]]*\|[[:space:]]*tail' "npm install failures are not hidden behind tail"

echo "[2] install.sh orchestrator"
assert_grep install.sh 'setup\.sh --preseeded --no-start' "routes ALL modes through the engine"
assert_nogrep install.sh 'npm install' "no duplicated engine work (npm install) in orchestrator"
assert_grep install.sh 'Host dependency preflight' "checks host dependencies before build/install"
assert_grep install.sh '_host_dependency_preflight' "has a dedicated dependency gate"
assert_grep install.sh 'Python 3\.10\+' "preflight requires modern Python before build/install"
assert_grep install.sh '_ensure_litellm_for_python' "preflight ensures required LiteLLM before build/install"
assert_grep install.sh 'Unable to install LiteLLM' "LiteLLM dependency failure aborts before build/install"
assert_grep install.sh 'Homebrew Cellar is not writable' "macOS Python remediation aborts cleanly on Homebrew permission issues"
assert_grep install.sh 'Unable to install Homebrew Python 3\.12' "macOS Python remediation aborts cleanly on Homebrew install failure"
assert_grep install.sh '_p0_prime_sudo' "Linux cleanup primes sudo before nested uninstall"
assert_grep install.sh '_p0_linux_stop_clawnex_systemd' "Linux cleanup removes stale ClawNex systemd units"
assert_grep install.sh '_p0_linux_kill_install_port_owners' "Linux cleanup kills install-owned port listeners"
assert_grep install.sh 'owned port listeners cleared' "Linux cleanup reports privileged port listener sweep"
assert_grep install.sh '\-\-clean'   "has --clean flag for non-interactive wipe consent"
assert_grep install.sh 'linux-local' "linux-local mode exists"
assert_grep install.sh 'mac-server'   "mac-server mode exists"
assert_grep install.sh 'mac-local'    "mac-local mode exists"
assert_grep install.sh '\-\-local-auth\)' "has --local-auth automation flag for local mode"
assert_grep install.sh '\-\-archive-db\)' "has --archive-db automation flag for DB archive choice"
assert_grep install.sh '\-\-no-archive-db\)' "has --no-archive-db shortcut for DB archive skip"
assert_grep install.sh '\-\-provider openrouter\|anthropic\|openai\|nvidia\|skip' "help advertises NVIDIA instead of local first-run providers"
assert_grep install.sh '\-\-provider-url\)' "has --provider-url automation flag for NVIDIA API base override"
assert_grep install.sh '\-\-provider-model\)' "has --provider-model automation flag for NVIDIA model override"
assert_grep install.sh 'NVIDIA NIM' "top-level provider menu exposes NVIDIA NIM"
assert_grep install.sh 'Get an NVIDIA API key: https://build\.nvidia\.com/models' "top-level provider prompt points to NVIDIA Build"
assert_grep install.sh 'CLAWNEX_ANSWER_NVIDIA_MODEL' "orchestrator preseeds NVIDIA model into setup.sh"
assert_grep install.sh 'CLAWNEX_ANSWER_NVIDIA_BASE_URL' "orchestrator preseeds NVIDIA API base into setup.sh"
assert_grep install.sh 'REG_TYPE="nvidia-nim"' "orchestrator registers NVIDIA provider type"
assert_nogrep install.sh 'Local model \(LM Studio/Ollama\)' "top-level first-run menu does not expose LM Studio/Ollama"
assert_nogrep install.sh 'CLAWNEX_ANSWER_LOCAL_PROVIDER_SELECT' "orchestrator no longer preseeds first-run local provider type"
assert_grep install.sh 'Local / VNC' "Linux install offers localhost-only VPS/VNC mode"
assert_grep install.sh 'Public VPS' "Linux install still offers public Caddy/TLS mode"
assert_grep install.sh 'Linux has two valid install modes' "headless --yes Linux install requires explicit mode"
assert_grep install.sh 'No TTY available to choose Linux install mode' "headless install requires explicit --mode"
assert_grep install.sh '\-\-domain is ignored for \$MODE' "local modes ignore accidental public domain flags"
assert_grep install.sh 'Local authentication:' "local installs ask for RBAC posture"
assert_grep install.sh 'CLAWNEX_ANSWER_LOCAL_AUTH_MODE' "orchestrator preseeds local RBAC posture into setup.sh"
assert_grep install.sh 'lib-linux-local\.sh' "linux-local mode calls the Linux local service layer"
assert_grep install.sh 'lib-macos\.sh' "mac modes call the macOS service layer"
assert_grep install.sh 'Archive existing database before removal\?' "Phase 0 asks before archiving an existing DB"
assert_grep install.sh 'P0_DB_ARCHIVE_CANDIDATES' "Phase 0 de-duplicates DB archive candidates"
assert_grep install.sh 'clawnex-pre-install-backup' "Phase 0 archives DB outside install dir when selected"
assert_grep install.sh '\-\-force-clean \-\-no-archive' "Phase 0 suppresses uninstall.sh temporary in-tree DB archives"
assert_grep install.sh 'force-clean'  "Phase 0 reuses uninstall.sh as the one removal path"
assert_grep install.sh 'runtime artifacts in THIS directory' "Phase 0 detects failed/in-place install leftovers"
assert_grep install.sh 'In-place retry: runtime artifacts removed; source tree preserved' "Phase 0 removes failed runtime artifacts before retry"
assert_grep install.sh 'clawnex CLI symlink' "Phase 0 detects stale/global clawnex CLI symlink"
assert_grep install.sh 'clawnex-v\*-deploy' "Phase 0 scans versioned deploy directories"
assert_grep install.sh 'stale ClawNex source/install dir' "Phase 0 offers removal of stale ClawNex source/install directories"
assert_grep install.sh 'Deleted stale ClawNex directory' "Phase 0 deletes stale ClawNex directories after consent"
assert_grep install.sh 'lsof -a -p "\$P0_PID" -d cwd' "Phase 0 derives macOS port owner install dir"
assert_grep install.sh '_p0_macos_stop_clawnex_launchd' "Phase 0 in-place retry unloads macOS launchd services"
assert_grep install.sh 'launchctl bootout "gui/\$\{_uid\}/\$\{_label\}"' "Phase 0 tries macOS label bootout before port check"
assert_grep install.sh 'rm -f "\$_plist"' "Phase 0 removes old macOS launchd plists so KeepAlive cannot restart"
assert_grep install.sh '_p0_macos_kill_install_port_owners' "Phase 0 has scoped macOS port-owner fallback"
assert_grep install.sh 'P0_EXTRA_DIRS' "Phase 0 includes stale ClawNex dirs in scoped macOS port-owner fallback"
assert_grep install.sh 'kill -9 "\$_pid"' "Phase 0 escalates only install-owned Mac port processes if TERM fails"
assert_grep install.sh '"needsSetup":true' "RBAC-on post-start verify requires first-run setup gate"
assert_grep install.sh '"rbacEnabled":false' "RBAC-off local post-start verify checks auth disabled"
assert_grep install.sh 'Local RBAC-off mode active' "RBAC-off local mode has explicit success message"
assert_grep scripts/register-provider.cjs 'PROVIDER_MODEL_ID' "provider registration can seed provider-specific model id"
assert_grep scripts/register-provider.cjs '"nvidia-nim"' "provider registration seeds NVIDIA NIM models"
assert_grep litellm/config.template.yaml 'NVIDIA NIM' "LiteLLM template documents NVIDIA NIM"
assert_grep src/lib/litellm/sync.ts 'nvidia_nim' "LiteLLM sync maps NVIDIA providers to nvidia_nim"
assert_grep src/lib/services/config-service.ts 'integrate\.api\.nvidia\.com' "provider SSRF allowlist permits NVIDIA NIM API host"

echo "[2b] package dependency pins"
assert_grep package.json '"postcss": "8\.5\.16"' "postcss pin uses patched advisory-free version"
assert_grep package.json '"overrides":' "package.json carries dependency overrides"
assert_grep package.json '"js-cookie": "3\.0\.8"' "transitive js-cookie advisory is patched by override"

echo "[3] local service layers"
assert_grep deploy/lib-linux-local.sh 'ClawNex Local Linux Deploy' "Linux local service layer exists"
assert_grep deploy/lib-linux-local.sh 'Environment=HOSTNAME=127\.0\.0\.1' "Linux local dashboard binds loopback"
assert_grep deploy/lib-linux-local.sh 'Environment=CLAWNEX_LOG_DIR=\$\{INSTALL_DIR\}/logs' "Linux local dashboard writes structured logs outside standalone artifact"
assert_grep deploy/lib-linux-local.sh '\-\-host 127\.0\.0\.1 \-\-port \$\{LITELLM_PORT\}' "Linux local LiteLLM binds loopback"
assert_grep deploy/lib-linux-local.sh 'Dashboard did not answer /api/health after 120s' "Linux local health check retries before failing"
assert_grep deploy/lib-linux-local.sh 'journalctl -u clawnex-dashboard -n 40' "Linux local health failure prints dashboard journal"
assert_nogrep deploy/lib-linux-local.sh 'apt-get install.*caddy|ufw allow|systemctl .*caddy' "Linux local service layer does not install public edge services"
assert_grep deploy/lib-macos.sh 'io\.clawnex\.dashboard' "dashboard launchd label"
assert_grep deploy/lib-macos.sh 'io\.clawnex\.litellm'   "litellm launchd label"
assert_grep deploy/lib-macos.sh 'KeepAlive'              "KeepAlive set"
assert_grep deploy/lib-macos.sh 'DASHBOARD_BIND="127\.0\.0\.1"' "macOS dashboard always binds loopback"
assert_grep deploy/lib-macos.sh 'CLAWNEX_LOG_DIR="\$INSTALL_DIR/logs"' "macOS dashboard writes structured logs outside standalone artifact"
assert_grep deploy/install-prod.sh 'Environment=CLAWNEX_LOG_DIR=\$\{INSTALL_DIR\}/logs' "Public VPS dashboard writes structured logs outside standalone artifact"
assert_grep clawnex 'CLAWNEX_LOG_DIR="\$INSTALL_DIR/logs"' "CLI dashboard launcher writes structured logs outside standalone artifact"

echo "[4] uninstall parity"
assert_grep scripts/uninstall.sh 'io\.clawnex\.litellm\.plist' "uninstall removes litellm plist"
assert_grep scripts/uninstall.sh '\.local/bin/clawnex' "uninstall removes clawnex CLI symlink"
assert_grep scripts/uninstall.sh '\-\-no-archive' "uninstall supports skipping DB archive"
assert_grep scripts/uninstall.sh 'Archive database before uninstall\?' "interactive uninstall asks before DB archive"
assert_grep scripts/uninstall.sh 'STARTED_INSIDE_INSTALL' "uninstall detects when launched inside install dir"
assert_grep scripts/uninstall.sh 'cd "\$HOME"' "uninstall leaves deleted cwd before removing install dir"
assert_grep scripts/uninstall.sh 'Run this now to return to a valid directory' "uninstall explains parent-shell cwd recovery"

echo "[5] shipping manifest"
if [ -f deploy/package.sh ]; then
    assert_grep deploy/package.sh 'lib-linux-local\.sh' "tarball ships lib-linux-local.sh"
    assert_grep deploy/package.sh 'lib-macos\.sh' "tarball ships lib-macos.sh"
    assert_grep deploy/package.sh 'third_party/' "tarball ships bundled third-party scanner files"
    assert_grep deploy/package.sh 'NOTICE' "tarball ships third-party NOTICE"
else
    [ -f deploy/lib-linux-local.sh ] && pass "packaged runtime includes lib-linux-local.sh" || fail "packaged runtime includes lib-linux-local.sh"
    [ -f deploy/lib-macos.sh ] && pass "packaged runtime includes lib-macos.sh" || fail "packaged runtime includes lib-macos.sh"
    [ -d third_party/clawkeeper ] && pass "packaged runtime includes bundled third-party scanner files" || fail "packaged runtime includes bundled third-party scanner files"
    [ -f NOTICE ] && pass "packaged runtime includes third-party NOTICE" || fail "packaged runtime includes third-party NOTICE"
fi

echo "[5b] bundled host security scanner"
assert_grep setup.sh 'Host security scanner bundled with ClawNex' "setup uses bundled host security scanner"
assert_nogrep setup.sh 'clawkeeper\.dev/install\.sh|raw\.githubusercontent\.com/rad-security/clawkeeper' "setup does not download Clawkeeper at runtime"
assert_nogrep setup.sh 'cisco-ai-defense/defenseclaw|DefenseClaw Rules|DefenseClaw rules' "setup does not download or advertise third-party Shield rule updates"
assert_nogrep install.sh 'cisco-ai-defense/defenseclaw|DefenseClaw Rules|DefenseClaw rules' "installer does not fetch DefenseClaw rule logic"
assert_nogrep deploy/install-prod.sh 'cisco-ai-defense/defenseclaw|DefenseClaw Rules|DefenseClaw rules' "prod service layer does not fetch DefenseClaw rule logic"
assert_grep src/app/api/config/updates/route.ts 'name: "ClawNex Shield Rules"' "updates API exposes ClawNex Shield Rules label"
assert_grep src/app/api/config/updates/route.ts 'Upstream DefenseClaw changed; review for possible future ClawNex Shield Rules updates' "upstream DefenseClaw check is informational"
assert_grep NOTICE 'DefenseClaw is listed here for attribution and provenance' "NOTICE carries DefenseClaw attribution as provenance"
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
for f in install.sh setup.sh deploy/lib-linux-local.sh deploy/lib-macos.sh deploy/install-prod.sh scripts/uninstall.sh scripts/postbuild-standalone-hygiene.sh; do
    [ -f "$f" ] || { fail "$f missing"; continue; }
    bash -n "$f" && pass "bash -n $f" || fail "bash -n $f"
done
if [ -f deploy/package.sh ]; then
    bash -n deploy/package.sh && pass "bash -n deploy/package.sh" || fail "bash -n deploy/package.sh"
else
    pass "deploy/package.sh intentionally absent in packaged runtime"
fi

if [ "$FAIL" = "0" ]; then echo "ALL CONTRACT CHECKS PASS"; exit 0; else echo "CONTRACT FAILURES ABOVE"; exit 1; fi
