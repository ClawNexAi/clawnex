/**
 * LiteLLM Service Control API
 * POST /api/system/litellm — start, stop, restart LiteLLM proxy
 * Body: { action: "start" | "stop" | "restart" }
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { run, getDb } from "@/lib/db/index";
import { syncProvidersToYaml as syncProvidersToYamlImpl } from "@/lib/litellm/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PLACEHOLDER_MODEL_NAME used to be re-exported here for backward compat
// with importers that pulled it from this route. Next.js Route Handler
// files only permit GET/POST/etc. + runtime/dynamic exports — any other
// re-export crashes `next build` with "is not a valid Route export field"
// (caught on a staging host 2026-05-10). All importers now pull the constant
// directly from @/lib/litellm/sync, so the re-export is dead code.

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
    const { action } = body as { action: string };
    const installDir = process.cwd();
    const configPath = path.join(installDir, "litellm", "config.yaml");
    const port = parseInt(String(process.env.LITELLM_PORT || "4001"), 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: "Invalid LiteLLM port configuration" }, { status: 500 });
    }

    const operator = getOperatorFromRequest(request);
    const actor = operator?.username || 'operator';

    if (action === "stop") {
      try {
        execSync(`kill $(lsof -ti :${port}) 2>/dev/null`, { timeout: 5000 });
      } catch {}
      try { run(`INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at) VALUES (?, ?, 'litellm_stop', 'system', NULL, 'LiteLLM proxy stopped', 'dashboard', datetime('now'))`, [require("crypto").randomUUID(), actor]); } catch {}
      return NextResponse.json({ ok: true, action: "stopped" });
    }

    if (action === "start" || action === "restart") {
      // Sync providers from DB to YAML before starting (whichever path runs).
      try {
        const syncResult = syncProvidersToYamlImpl({ db: getDb(), configPath });
        if (syncResult.provider_count > 0) {
          console.log(`[LiteLLM Control] Synced ${syncResult.provider_count} provider(s) to config.yaml: ${syncResult.model_names.join(", ")}`);
        }
      } catch (syncErr) {
        console.error("[LiteLLM Control] Sync error:", syncErr);
      }

      if (!fs.existsSync(configPath)) {
        return NextResponse.json({ ok: false, error: "litellm/config.yaml not found" }, { status: 400 });
      }

      // Prefer systemd when the unit is installed — operator-flagged 2026-05-09:
      // the prior path SIGTERM'd the litellm process and nohup-launched a
      // new one OUTSIDE systemd, which (a) silently failed when no binary
      // was in the hardcoded candidates list (e.g. the portable-venv path
      // on Ubuntu 26.04 boxes), and (b) left the systemd service in a clean
      // "stopped" state that Restart=on-failure wouldn't recover from. Going
      // through systemctl restart ensures the unit's own ExecStart runs —
      // whatever path that's pointing at, including ~/.litellm-venv/bin/litellm.
      let usedSystemd = false;
      try {
        execSync("systemctl is-enabled clawnex-litellm.service", { timeout: 3000, stdio: "ignore" });
        // Unit is enabled — use it. systemctl restart handles both stop+start
        // atomically; no race window.
        execSync("sudo -n systemctl restart clawnex-litellm.service", { timeout: 15000, stdio: "ignore" });
        usedSystemd = true;
      } catch {
        // Systemd unit not installed (likely macOS/launchd or a manual
        // install). Fall through to the binary-search nohup path.
      }

      if (!usedSystemd) {
        // Stop first if restarting
        if (action === "restart") {
          try { execSync(`kill $(lsof -ti :${port}) 2>/dev/null`, { timeout: 5000 }); } catch {}
          await new Promise(r => setTimeout(r, 2000));
        }

        // Find the litellm binary. 2026-05-09: added ~/.litellm-venv/bin
        // to the head of the list — that's the durable portable-python
        // venv path install-prod.sh writes on fresh Linux boxes (Ubuntu
        // 26.04 etc. where the system python is too new for uvloop).
        let litellmCmd = "";
        const candidates = [
          `${process.env.HOME}/.litellm-venv/bin/litellm`,
          "/opt/homebrew/bin/litellm",
          `${process.env.HOME}/.local/bin/litellm`,
          "/usr/local/bin/litellm",
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) { litellmCmd = c; break; }
        }
        if (!litellmCmd) {
          // Try python -m litellm
          try {
            execSync("python3 -c 'import litellm'", { timeout: 5000 });
            litellmCmd = "python3 -m litellm";
          } catch {
            return NextResponse.json({ ok: false, error: "LiteLLM not found — install with: pip install litellm[proxy]==1.83.0" }, { status: 400 });
          }
        }

        const logDir = path.join(installDir, "logs");
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

        try {
          execSync(`cd "${installDir}" && nohup ${litellmCmd} --config litellm/config.yaml --host 127.0.0.1 --port ${port} > logs/litellm.log 2>&1 &`, {
            timeout: 5000,
            shell: "/bin/bash",
          });
        } catch {}
      }

      try { run(`INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at) VALUES (?, ?, ?, 'system', NULL, ?, 'dashboard', datetime('now'))`, [require("crypto").randomUUID(), actor, `litellm_${action}`, `LiteLLM proxy ${action}ed on port ${port}${usedSystemd ? " via systemctl" : " via nohup"}`]); } catch {}

      return NextResponse.json({ ok: true, action: action === "restart" ? "restarted" : "started", port, configSynced: true, usedSystemd });
    }

    return NextResponse.json({ error: "Invalid action. Use: start, stop, restart" }, { status: 400 });
  } catch (err) {
    console.error("[LiteLLM Control] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
