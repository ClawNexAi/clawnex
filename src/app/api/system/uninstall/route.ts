/**
 * Uninstall API
 * POST /api/system/uninstall — removes ClawNex installation
 * Body: { step: 1|2|3, confirm: "YES"|"UNINSTALL"|"DO IT NOW" }
 *
 * 3-step confirmation:
 *   Step 1: confirm: "YES" → archives DB first
 *   Step 2: confirm: "UNINSTALL" → stops services
 *   Step 3: confirm: "DO IT NOW" → removes files
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { getDbPath } from "@/lib/db/index";
import { resolveVacuumBackupPath, vacuumIntoResolved } from "@/lib/db/vacuum-into";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'system:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { step, confirm } = body as { step: number; confirm: string };
    const installDir = process.cwd();

    if (step === 1) {
      if (confirm !== "YES") return NextResponse.json({ error: "Step 1: Send { step: 1, confirm: \"YES\" }" }, { status: 400 });

      // Archive DB before uninstall
      // Codex 2026-05-17 #4: previously hardcoded installDir/sentinel.db,
      // which silently skipped the actual live DB on post-rebrand installs
      // (clawnex.db) — the most destructive step before file removal
      // ran with zero backup. Reuse the canonical resolver so the
      // pre-uninstall snapshot ACTUALLY captures operator data.
      const backupDir = path.join(installDir, "backups");
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupFile = `clawnex-pre-uninstall-${timestamp}.db`;
      const dbPath = getDbPath();
      if (dbPath !== ":memory:" && fs.existsSync(dbPath)) {
        // Validate upfront — any throw propagates BEFORE the try/fallback
        // so a bad basename can't smuggle past via fs.copyFileSync.
        const safeBackupPath = resolveVacuumBackupPath(backupDir, backupFile);
        try { vacuumIntoResolved(safeBackupPath); } catch { fs.copyFileSync(dbPath, safeBackupPath); }
      }

      return NextResponse.json({ ok: true, step: 1, message: "Database archived. Proceed to step 2.", backup: backupFile });
    }

    if (step === 2) {
      if (confirm !== "UNINSTALL") return NextResponse.json({ error: "Step 2: Send { step: 2, confirm: \"UNINSTALL\" }" }, { status: 400 });

      // Stop services
      const stopped: string[] = [];
      try { execSync("kill $(lsof -ti :4001) 2>/dev/null", { timeout: 5000 }); stopped.push("LiteLLM (port 4001)"); } catch {}
      try {
        // CX-G5 fix (2026-04-26 adversarial review): match the exact
        // "# clawnex-watchdog" marker setup.sh stamps on its cron line,
        // not the substring "watchdog" — otherwise an operator's
        // unrelated *watchdog cron line gets removed too.
        const crontab = execSync("crontab -l 2>/dev/null", { timeout: 5000 }).toString();
        if (crontab.includes("# clawnex-watchdog")) {
          const newCrontab = crontab.split("\n").filter(l => !l.includes("# clawnex-watchdog")).join("\n");
          execSync('crontab -', { input: newCrontab, timeout: 5000 });
          stopped.push("Watchdog cron");
        }
      } catch {}

      return NextResponse.json({ ok: true, step: 2, message: "Services stopped. Proceed to step 3 for file removal.", stopped });
    }

    if (step === 3) {
      if (confirm !== "DO IT NOW") return NextResponse.json({ error: "Step 3: Send { step: 3, confirm: \"DO IT NOW\" }" }, { status: 400 });

      // Generate the uninstall script. The dashboard process kills itself
      // partway through this script, so the script can't run inline as part
      // of this API request — it has to be a standalone bash file the user
      // runs from a terminal.
      //
      // Scope per docs/superpowers + feedback_clawnex_cleanup_scope.md:
      //   "If ClawNex installed it then remove it. If ClawNex did NOT
      //    install it then leave it alone."
      // Things ClawNex installs (all removable here):
      //   - The install dir (~/sentinel) and its build artifacts
      //   - LiteLLM (Python package, optional, installed by setup.sh)
      //   - legacy host-security scanner artifacts at ~/.local/bin/clawkeeper.sh
      //   - legacy third-party scanner artifacts wherever they landed
      //   - systemd unit /etc/systemd/system/clawnex-dashboard.service
      //   - /etc/caddy/Caddyfile (only the file ClawNex wrote — the Caddy
      //     package itself stays for any other site that might use it)
      //   - Watchdog cron entries (already cleared in step 2)
      // Things ClawNex does NOT install (off-limits, do not touch):
      //   - OpenClaw (~/.openclaw) — separate product
      //   - Hermes Agent (~/.hermes) — separate product
      //   - Caddy package itself, Node.js, Python — system-level
      //
      // Sudo handling: the script runs in the user's terminal, so sudo can
      // prompt interactively. Each sudo step is wrapped in `if sudo ...`
      // so a denied sudo doesn't kill the whole script.
      const uninstallScript = path.join(installDir, "scripts", "uninstall-now.sh");
      const scriptContent = `#!/bin/bash
# ClawNex Auto-Uninstall Script — generated at ${new Date().toISOString()}
# Removes everything ClawNex installs. Preserves backups + docs by default.
# Adjacent products (OpenClaw, Hermes, paperclip) are NOT touched.
set +e   # Don't abort on any single removal failure — keep going through everything

INSTALL_DIR=${JSON.stringify(installDir)}
HOME_DIR="\${HOME:-/home/$(whoami)}"

echo "ClawNex Uninstall — removing installation..."
echo "Install dir: \${INSTALL_DIR}"
echo "Home dir:    \${HOME_DIR}"
sleep 2

# ---- 1. Stop services ----
echo ""
echo "[1/8] Stopping services..."

# Dashboard (systemd unit if present, else port-5001 process)
if systemctl is-active --quiet clawnex-dashboard 2>/dev/null; then
    sudo systemctl stop clawnex-dashboard 2>/dev/null && echo "  ✓ clawnex-dashboard stopped (systemd)" || echo "  ⚠ failed to stop clawnex-dashboard (sudo denied?)"
    sudo systemctl disable clawnex-dashboard 2>/dev/null
fi
DASH_PID=$(lsof -ti :5001 2>/dev/null | head -1)
if [ -n "$DASH_PID" ]; then
    kill "$DASH_PID" 2>/dev/null && echo "  ✓ dashboard process killed (PID $DASH_PID)"
    sleep 1
fi

# LiteLLM
LITELLM_PID=$(lsof -ti :4001 2>/dev/null | head -1)
if [ -n "$LITELLM_PID" ]; then
    kill "$LITELLM_PID" 2>/dev/null && echo "  ✓ LiteLLM process killed (PID $LITELLM_PID)"
fi

# Caddy — only stop+disable if WE installed it (Caddyfile present + reverse_proxy points at 127.0.0.1:5001)
if [ -f /etc/caddy/Caddyfile ] && grep -q "CLAWNEX-MANAGED" /etc/caddy/Caddyfile 2>/dev/null; then
    sudo systemctl stop caddy 2>/dev/null && echo "  ✓ caddy stopped"
    sudo systemctl disable caddy 2>/dev/null
fi

# ---- 2. Remove ClawNex systemd unit ----
echo ""
echo "[2/8] Removing systemd unit..."
if [ -f /etc/systemd/system/clawnex-dashboard.service ]; then
    sudo rm -f /etc/systemd/system/clawnex-dashboard.service && echo "  ✓ /etc/systemd/system/clawnex-dashboard.service removed"
    sudo systemctl daemon-reload 2>/dev/null
    sudo systemctl reset-failed clawnex-dashboard 2>/dev/null
fi

# ---- 3. Remove ClawNex Caddyfile (leave caddy package alone) ----
echo ""
echo "[3/8] Removing Caddyfile (keeping caddy package)..."
if [ -f /etc/caddy/Caddyfile ] && grep -q "CLAWNEX-MANAGED" /etc/caddy/Caddyfile 2>/dev/null; then
    sudo rm -f /etc/caddy/Caddyfile && echo "  ✓ /etc/caddy/Caddyfile removed (ClawNex-specific)"
fi

# ---- 4. Uninstall LiteLLM Python package ----
echo ""
echo "[4/8] Uninstalling LiteLLM..."
if command -v pip3 &>/dev/null; then
    pip3 uninstall -y litellm 2>&1 | tail -1 || echo "  ⚠ pip uninstall failed — try: pip3 uninstall -y litellm"
elif command -v pip &>/dev/null; then
    pip uninstall -y litellm 2>&1 | tail -1 || echo "  ⚠ pip uninstall failed — try: pip uninstall -y litellm"
fi
rm -f "\${HOME_DIR}/.local/bin/litellm" 2>/dev/null

# ---- 5. Remove legacy scanner artifacts ----
echo ""
echo "[5/8] Removing legacy scanner artifacts..."
for f in "\${HOME_DIR}/.local/bin/clawkeeper.sh" "\${HOME_DIR}/.local/bin/clawkeeper" "\${HOME_DIR}/.local/bin/defenseclaw" "\${HOME_DIR}/.local/bin/defenseclaw.sh"; do
    if [ -e "$f" ]; then rm -f "$f" && echo "  ✓ removed $f"; fi
done
for d in "\${HOME_DIR}/.clawkeeper" "\${HOME_DIR}/.defenseclaw" "\${HOME_DIR}/.config/clawkeeper" "\${HOME_DIR}/.config/defenseclaw"; do
    if [ -d "$d" ]; then rm -rf "$d" && echo "  ✓ removed $d"; fi
done

# ---- 6. Remove ClawNex tarballs from common locations ----
echo ""
echo "[6/8] Removing ClawNex tarballs..."
for dir in "\${HOME_DIR}" /tmp; do
    for f in "$dir"/clawnex-*.tar.gz "$dir"/clawnex-*.tgz; do
        if [ -e "$f" ]; then rm -f "$f" && echo "  ✓ removed $f"; fi
    done
done

# ---- 7. Remove ClawNex install dir contents (preserve backups + docs) ----
echo ""
echo "[7/8] Removing install-dir contents (preserving backups/ + docs/)..."

# Build artifacts
rm -rf "\${INSTALL_DIR}/.next" 2>/dev/null && echo "  ✓ removed .next/"
rm -rf "\${INSTALL_DIR}/node_modules" 2>/dev/null && echo "  ✓ removed node_modules/"

# Source dirs
for dir in src public deploy litellm scripts data .agents .claude .continue .github .hermes .kilocode .kiro .superpowers .windsurf; do
    if [ -d "\${INSTALL_DIR}/\${dir}" ]; then
        rm -rf "\${INSTALL_DIR}/\${dir}" 2>/dev/null && echo "  ✓ removed \${dir}/"
    fi
done

# Top-level files (preserve backups/ and docs/ subdirs by listing them as -not -name)
find "\${INSTALL_DIR}" -maxdepth 1 -type f -delete 2>/dev/null && echo "  ✓ removed top-level files"

# DB + logs (defensive — should already be gone via top-level file delete, but sentinel.db-shm/-wal are sometimes locked)
rm -f "\${INSTALL_DIR}/sentinel.db" "\${INSTALL_DIR}/sentinel.db-shm" "\${INSTALL_DIR}/sentinel.db-wal" 2>/dev/null
rm -f "\${INSTALL_DIR}/clawnex.db" "\${INSTALL_DIR}/clawnex.db-shm" "\${INSTALL_DIR}/clawnex.db-wal" 2>/dev/null
rm -rf "\${INSTALL_DIR}/logs" 2>/dev/null

# ---- 8. Final summary ----
echo ""
echo "[8/8] Done."
echo ""
echo "ClawNex has been uninstalled."
echo "Preserved:"
echo "  - \${INSTALL_DIR}/backups/  (database archives)"
echo "  - \${INSTALL_DIR}/docs/     (operator-facing manuals)"
echo "Left alone (not part of ClawNex):"
echo "  - ~/.openclaw, ~/.hermes (other products)"
echo "  - caddy package, node, python, system tools"
echo ""
echo "To fully remove the install dir + its preserved content:"
echo "  rm -rf \${INSTALL_DIR}"
`;
      if (!fs.existsSync(path.join(installDir, "scripts"))) fs.mkdirSync(path.join(installDir, "scripts"), { recursive: true });
      fs.writeFileSync(uninstallScript, scriptContent, { mode: 0o755 });

      return NextResponse.json({
        ok: true,
        step: 3,
        message: "Uninstall script generated. Run it from a terminal — it removes ClawNex (incl. systemd unit, Caddyfile, Host Security scanner artifacts, LiteLLM, ClawNex tarballs) and preserves backups + docs.",
        script: uninstallScript,
        command: `bash ${uninstallScript}`,
        note: "Backups and docs are preserved. Sudo is required to remove the systemd unit + Caddyfile — the script will prompt. Adjacent products (OpenClaw, Hermes) are NOT touched.",
      });
    }

    return NextResponse.json({ error: "Invalid step. Use 1, 2, or 3." }, { status: 400 });
  } catch (err) {
    console.error("[Uninstall] Error:", err);
    return NextResponse.json({ error: "Uninstall step failed" }, { status: 500 });
  }
}
