/**
 * Hermes gateway control.
 *
 * Hermes routing changes are written to Hermes-owned config.yaml files, but a
 * running Hermes gateway may cache provider configuration. This module exposes
 * a scoped restart helper for known Hermes supervisors only.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import os from "node:os";
import { config } from "@/lib/config";

const execFileP = promisify(execFile);

export type HermesSupervisor = "systemd-user" | "launchd" | "unsupported";

export interface HermesSupervisorInfo {
  kind: HermesSupervisor;
  label: string;
  manualCommand: string;
  targets: string[];
}

export interface HermesRestartResult {
  ok: boolean;
  supervisor: HermesSupervisor;
  status: "restarted" | "unsupported" | "detection-failed" | "exec-failed";
  detail: string;
  output?: string;
  elapsedMs?: number;
  manualCommand: string;
  targets: string[];
}

interface LaunchdHermesTarget {
  label: string;
  plistPath?: string;
  loaded: boolean;
}

function redactSensitive(s: string): string {
  if (!s) return s;
  return s
    .replace(/\b([A-Z][A-Z0-9_]{2,})=([^\s'"]{4,})/g, "$1=***")
    .replace(/\b(sk-[a-zA-Z0-9-]+-|ghp_|gho_|ghu_|ghr_|github_pat_|nvapi-|AIza)[A-Za-z0-9_\-]{16,}/g, "$1***")
    .replace(/(\/home\/|\/Users\/)[^\s/]+/g, "$1~");
}

async function resolveHermesOwner(): Promise<{ uid: number; username: string } | null> {
  try {
    const home = config.hermes.home;
    let out: string;
    try {
      const r = await execFileP("stat", ["-c", "%u %U", home]);
      out = r.stdout.trim();
    } catch {
      const r = await execFileP("stat", ["-f", "%u %Su", home]);
      out = r.stdout.trim();
    }
    const [uidStr, username] = out.split(/\s+/);
    const uid = parseInt(uidStr, 10);
    if (!Number.isFinite(uid) || !username) return null;
    return { uid, username };
  } catch {
    return null;
  }
}

function extractPlistLabel(plist: string): string | null {
  const match = plist.match(/<key>\s*Label\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/i);
  const label = match?.[1]?.trim();
  if (!label) return null;
  if (label !== "ai.hermes.gateway" && !label.startsWith("ai.hermes.gateway-")) return null;
  return label;
}

async function listDarwinHermesLaunchdTargets(): Promise<LaunchdHermesTarget[]> {
  const loaded = new Set<string>();
  try {
    const r = await execFileP("launchctl", ["list"]);
    for (const line of r.stdout.split(/\r?\n/)) {
      const label = line.trim().split(/\s+/).at(-1) || "";
      if (label === "ai.hermes.gateway" || label.startsWith("ai.hermes.gateway-")) {
        loaded.add(label);
      }
    }
  } catch { /* launchctl probing is best-effort */ }

  const targets = new Map<string, LaunchdHermesTarget>();
  for (const label of loaded) targets.set(label, { label, loaded: true });

  const agentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  try {
    const files = await fs.readdir(agentsDir);
    for (const file of files) {
      if (!/^ai\.hermes\.gateway(?:-.+)?\.plist$/.test(file)) continue;
      const plistPath = path.join(agentsDir, file);
      try {
        const label = extractPlistLabel(await fs.readFile(plistPath, "utf8")) ?? file.replace(/\.plist$/, "");
        targets.set(label, { label, plistPath, loaded: loaded.has(label) });
      } catch {
        const label = file.replace(/\.plist$/, "");
        targets.set(label, { label, plistPath, loaded: loaded.has(label) });
      }
    }
  } catch { /* LaunchAgents can be absent on headless/nonstandard hosts */ }

  return Array.from(targets.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function detectHermesSupervisor(): Promise<HermesSupervisorInfo> {
  const platform = os.platform();

  if (platform === "darwin") {
    const launchdTargets = await listDarwinHermesLaunchdTargets();
    if (launchdTargets.length > 0) {
      const uid = process.getuid?.() ?? 0;
      const manualCommand = launchdTargets
        .map((target) => target.plistPath
          ? `launchctl bootout gui/${uid}/${target.label} 2>/dev/null || true; launchctl bootstrap gui/${uid} ${JSON.stringify(target.plistPath)}; launchctl kickstart -k gui/${uid}/${target.label}`
          : `launchctl kickstart -k gui/${uid}/${target.label}`)
        .join(" && ");
      return {
        kind: "launchd",
        label: `launchd Aqua session (${launchdTargets.length} Hermes gateway${launchdTargets.length === 1 ? "" : "s"})`,
        manualCommand,
        targets: launchdTargets.map((target) => target.label),
      };
    }
  }

  if (platform === "linux") {
    const owner = await resolveHermesOwner();
    if (owner) {
      const candidates = ["hermes-gateway.service", "ai.hermes.gateway.service"];
      const isRoot = process.getuid?.() === 0;
      const targets: string[] = [];
      for (const unit of candidates) {
        try {
          const env = isRoot ? process.env : { ...process.env, XDG_RUNTIME_DIR: `/run/user/${owner.uid}` };
          const cmd = isRoot ? "sudo" : "systemctl";
          const args = isRoot
            ? ["-u", owner.username, "env", `XDG_RUNTIME_DIR=/run/user/${owner.uid}`, "systemctl", "--user", "list-unit-files", unit, "--no-legend"]
            : ["--user", "list-unit-files", unit, "--no-legend"];
          const r = await execFileP(cmd, args, { env });
          if (r.stdout.includes(unit)) targets.push(unit);
        } catch { /* keep probing */ }
      }
      if (targets.length > 0) {
        return {
          kind: "systemd-user",
          label: `systemd user unit (owner: ${owner.username}, ${targets.length} Hermes gateway${targets.length === 1 ? "" : "s"})`,
          manualCommand: targets.map((target) => `XDG_RUNTIME_DIR=/run/user/${owner.uid} systemctl --user restart ${target}`).join(" && "),
          targets,
        };
      }
    }
  }

  return {
    kind: "unsupported",
    label: `${platform} (no known supervisor for Hermes gateway)`,
    manualCommand: "Restart the Hermes gateway by whatever means your Hermes installation uses, then refresh ClawNex.",
    targets: [],
  };
}

export async function restartHermesGateway(): Promise<HermesRestartResult> {
  const supervisor = await detectHermesSupervisor();
  if (supervisor.kind === "unsupported") {
    return {
      ok: false,
      supervisor: "unsupported",
      status: "unsupported",
      detail: `Unsupported supervisor on this host (${supervisor.label}). Run the manual command instead.`,
      manualCommand: supervisor.manualCommand,
      targets: supervisor.targets,
    };
  }

  const start = Date.now();
  const outputs: string[] = [];
  try {
    if (supervisor.kind === "launchd") {
      const uid = process.getuid?.() ?? 0;
      const launchdTargets = await listDarwinHermesLaunchdTargets();
      const targetMap = new Map(launchdTargets.map((target) => [target.label, target]));
      for (const target of supervisor.targets) {
        const targetInfo = targetMap.get(target);
        if (targetInfo?.plistPath) {
          try {
            await execFileP("launchctl", ["bootout", `gui/${uid}/${target}`]);
          } catch { /* not loaded is fine; bootstrap below handles it */ }
          await execFileP("launchctl", ["bootstrap", `gui/${uid}`, targetInfo.plistPath]);
        }
        const r = await execFileP("launchctl", ["kickstart", "-k", `gui/${uid}/${target}`]);
        const out = `${r.stdout}${r.stderr}`.trim();
        if (out) outputs.push(`${target}: ${out}`);
      }
      return {
        ok: true,
        supervisor: "launchd",
        status: "restarted",
        detail: `Restarted ${supervisor.targets.length} Hermes gateway${supervisor.targets.length === 1 ? "" : "s"} via launchctl.`,
        output: outputs.length ? redactSensitive(outputs.join("\n")) : undefined,
        elapsedMs: Date.now() - start,
        manualCommand: supervisor.manualCommand,
        targets: supervisor.targets,
      };
    }

    if (supervisor.kind === "systemd-user") {
      const owner = await resolveHermesOwner();
      if (!owner) {
        return {
          ok: false,
          supervisor: "systemd-user",
          status: "detection-failed",
          detail: "Could not resolve Hermes owner UID for systemctl --user.",
          manualCommand: supervisor.manualCommand,
          targets: supervisor.targets,
        };
      }
      const isRoot = process.getuid?.() === 0;
      for (const target of supervisor.targets) {
        const env = isRoot ? process.env : { ...process.env, XDG_RUNTIME_DIR: `/run/user/${owner.uid}` };
        const cmd = isRoot ? "sudo" : "systemctl";
        const args = isRoot
          ? ["-u", owner.username, "env", `XDG_RUNTIME_DIR=/run/user/${owner.uid}`, "systemctl", "--user", "restart", target]
          : ["--user", "restart", target];
        const r = await execFileP(cmd, args, { env });
        const out = `${r.stdout}${r.stderr}`.trim();
        if (out) outputs.push(`${target}: ${out}`);
      }
      return {
        ok: true,
        supervisor: "systemd-user",
        status: "restarted",
        detail: `Restarted ${supervisor.targets.length} Hermes gateway${supervisor.targets.length === 1 ? "" : "s"} via systemd user unit.`,
        output: outputs.length ? redactSensitive(outputs.join("\n")) : undefined,
        elapsedMs: Date.now() - start,
        manualCommand: supervisor.manualCommand,
        targets: supervisor.targets,
      };
    }

    return {
      ok: false,
      supervisor: "unsupported",
      status: "unsupported",
      detail: "Unhandled Hermes supervisor kind.",
      manualCommand: supervisor.manualCommand,
      targets: supervisor.targets,
    };
  } catch (err) {
    const errAny = err as { stdout?: string; stderr?: string; message?: string };
    const rawOut = `${errAny.stdout ?? ""}${errAny.stderr ?? ""}`.trim();
    return {
      ok: false,
      supervisor: supervisor.kind,
      status: "exec-failed",
      detail: `Restart command failed: ${redactSensitive(errAny.message ?? String(err))}`,
      output: rawOut ? redactSensitive(rawOut) : undefined,
      elapsedMs: Date.now() - start,
      manualCommand: supervisor.manualCommand,
      targets: supervisor.targets,
    };
  }
}
