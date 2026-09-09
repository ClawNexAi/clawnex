/**
 * LiteLLM Service Control API
 * POST /api/system/litellm — start, stop, restart LiteLLM proxy
 * Body: { action: "start" | "stop" | "restart" }
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { execFileSync, execSync, spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { resolveLiteLLMConfigPath } from '@/lib/litellm/paths';
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

function getSystemctlPath(): string {
  try {
    const discovered = execSync("command -v systemctl", {
      encoding: "utf8",
      shell: "/bin/bash",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (discovered) return discovered;
  } catch {}
  for (const candidate of ["/usr/bin/systemctl", "/bin/systemctl"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "systemctl";
}

function isLiteLLMSystemdEnabled(systemctlPath: string): boolean {
  try {
    execFileSync(systemctlPath, ["is-enabled", "clawnex-litellm.service"], {
      timeout: 3000,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function runLiteLLMSystemdAction(systemctlPath: string, action: "start" | "stop" | "restart"): void {
  execFileSync("sudo", ["-n", systemctlPath, action, "clawnex-litellm.service"], {
    timeout: 15000,
    stdio: "ignore",
  });
}

interface LaunchdService {
  label: string;
  domain: string;
  plistPath: string;
  registered: boolean;
}

function getLiteLLMLaunchdService(): LaunchdService | null {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const forcedLabel = process.env.CLAWNEX_LITELLM_LAUNCHD_LABEL?.trim();
  if (!forcedLabel && (process.platform !== 'darwin' || uid === null)) return null;
  const label = forcedLabel || `gui/${uid}/io.clawnex.litellm`;
  const separator = label.lastIndexOf('/');
  if (separator < 1) return null;
  const domain = label.slice(0, separator);
  const plistPath = process.env.CLAWNEX_LITELLM_LAUNCHD_PLIST?.trim() ||
    path.join(process.env.HOME || '', 'Library', 'LaunchAgents', 'io.clawnex.litellm.plist');
  let registered = false;
  try {
    execFileSync('/bin/launchctl', ['print', label], { timeout: 3000, stdio: 'ignore' });
    registered = true;
  } catch {}
  if (!registered && !fs.existsSync(plistPath)) return null;
  return { label, domain, plistPath, registered };
}

function runLiteLLMLaunchdAction(service: LaunchdService, action: "start" | "stop" | "restart"): void {
  if (action === 'stop') {
    if (service.registered) execFileSync('/bin/launchctl', ['bootout', service.domain, service.plistPath], { timeout: 15000, stdio: 'ignore' });
    return;
  }
  if (!service.registered) {
    execFileSync('/bin/launchctl', ['bootstrap', service.domain, service.plistPath], { timeout: 15000, stdio: 'ignore' });
    return;
  }
  execFileSync('/bin/launchctl', action === 'restart' ? ['kickstart', '-k', service.label] : ['kickstart', service.label], {
    timeout: 15000, stdio: 'ignore',
  });
}

function sudoSystemdUnavailable(action: "start" | "stop" | "restart") {
  return NextResponse.json({
    ok: false,
    error: `LiteLLM is managed by systemd, but the dashboard could not ${action} clawnex-litellm.service non-interactively.`,
    manualCommand: `sudo systemctl ${action} clawnex-litellm.service`,
    needsSudo: true,
    usedSystemd: true,
  }, { status: 503 });
}

function stopPortListener(port: number): void {
  try {
    const output = execFileSync("lsof", ["-ti", `:${port}`], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const pidText of output.split(/\s+/).filter(Boolean)) {
      const pid = Number(pidText);
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, "SIGTERM"); } catch {}
      }
    }
  } catch {}
}

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
    const installDir = process.env.CLAWNEX_INSTALL_DIR?.trim() || process.cwd();
    const port = parseInt(String(process.env.LITELLM_PORT || "4001"), 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: "Invalid LiteLLM port configuration" }, { status: 500 });
    }

    const operator = getOperatorFromRequest(request);
    const actor = operator?.username || 'operator';
    const systemctlPath = getSystemctlPath();
    const systemdEnabled = isLiteLLMSystemdEnabled(systemctlPath);
    const launchdService = systemdEnabled ? null : getLiteLLMLaunchdService();

    if (action === "stop") {
      if (systemdEnabled) {
        try {
          runLiteLLMSystemdAction(systemctlPath, "stop");
        } catch {
          return sudoSystemdUnavailable("stop");
        }
      } else if (launchdService) {
        try { runLiteLLMLaunchdAction(launchdService, 'stop'); }
        catch {
          return NextResponse.json({ ok: false, error: 'LiteLLM is managed by launchd, but the dashboard could not stop its registered service.' }, { status: 503 });
        }
      } else {
        try {
          stopPortListener(port);
        } catch {}
      }
      try { run(`INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at) VALUES (?, ?, 'litellm_stop', 'system', NULL, 'LiteLLM proxy stopped', 'dashboard', datetime('now'))`, [require("crypto").randomUUID(), actor]); } catch {}
      return NextResponse.json({ ok: true, action: "stopped" });
    }

    if (action === "start" || action === "restart") {
      let configPath: string;
      // Sync providers from DB to YAML before starting (whichever path runs).
      try {
        configPath = resolveLiteLLMConfigPath();
        const syncResult = syncProvidersToYamlImpl({ db: getDb(), configPath });
        if (syncResult.provider_count > 0) {
          console.log(`[LiteLLM Control] Synced ${syncResult.provider_count} provider(s) to config.yaml: ${syncResult.model_names.join(", ")}`);
        }
      } catch {
        console.error("[LiteLLM Control] Configuration preparation failed; service left unchanged.");
        return NextResponse.json({ ok: false, configSynced: false,
          error: 'LiteLLM configuration could not be prepared. No service restart was attempted. Resolve the configuration path or provider sync failure and retry.',
        }, { status: 503 });
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
      //
      // If systemd is present but sudo -n cannot restart the unit, fail
      // clearly. Falling back to nohup from a systemd install creates a
      // shadow LiteLLM process that races Restart=always and leaves :4001 in
      // an address-in-use loop.
      let usedSystemd = false;
      let usedLaunchd = false;
      if (systemdEnabled) {
        const systemdAction = action === "start" ? "start" : "restart";
        try {
          runLiteLLMSystemdAction(systemctlPath, systemdAction);
          usedSystemd = true;
        } catch {
          return sudoSystemdUnavailable(systemdAction);
        }
      }

      if (!usedSystemd && launchdService) {
        try {
          runLiteLLMLaunchdAction(launchdService, action);
          usedLaunchd = true;
        } catch {
          return NextResponse.json({ ok: false, configSynced: true,
            error: `LiteLLM configuration was saved, but launchd could not ${action} its registered service.`,
          }, { status: 503 });
        }
      }

      if (!usedSystemd && !usedLaunchd) {
        // Stop first if restarting
        if (action === "restart") {
          stopPortListener(port);
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
            return NextResponse.json({ ok: false, error: "LiteLLM not found — install with: pip install litellm[proxy]==1.84.10" }, { status: 400 });
          }
        }

        const logDir = path.join(installDir, "logs");
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

        try {
          const logFd = fs.openSync(path.join(logDir, "litellm.log"), "a");
          try {
            const [command, ...args] = litellmCmd === "python3 -m litellm"
              ? ["python3", "-m", "litellm"]
              : [litellmCmd];
            const child = spawn(command, [
              ...args,
              "--config", configPath,
              "--host", "127.0.0.1",
              "--port", String(port),
            ], {
              cwd: installDir,
              detached: true,
              stdio: ["ignore", logFd, logFd],
            });
            await new Promise<void>((resolve, reject) => {
              child.once('error', reject);
              child.once('spawn', resolve);
            });
            child.unref();
          } finally {
            try { fs.closeSync(logFd); } catch {}
          }
        } catch {
          return NextResponse.json({ ok: false, configSynced: true,
            error: 'LiteLLM configuration was saved, but the local proxy could not be launched. Review the service logs and retry.',
          }, { status: 503 });
        }
      }

      const supervisor = usedSystemd ? 'systemctl' : usedLaunchd ? 'launchd' : 'nohup';
      try { run(`INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at) VALUES (?, ?, ?, 'system', NULL, ?, 'dashboard', datetime('now'))`, [require("crypto").randomUUID(), actor, `litellm_${action}`, `LiteLLM proxy ${action}ed on port ${port} via ${supervisor}`]); } catch {}

      return NextResponse.json({ ok: true, action: action === "restart" ? "restart-requested" : "start-requested", readiness: 'pending',
        detail: 'Service command accepted. Test the selected model through the proxy before applying agent routing.', port, configSynced: true, usedSystemd, usedLaunchd });
    }

    return NextResponse.json({ error: "Invalid action. Use: start, stop, restart" }, { status: 400 });
  } catch (err) {
    console.error("[LiteLLM Control] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
