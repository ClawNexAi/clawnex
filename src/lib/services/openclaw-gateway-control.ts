/**
 * OpenClaw gateway control -- restart the long-running `openclaw-gateway`
 * daemon so it picks up changes ClawNex made to `~/.openclaw/openclaw.json`
 * (most commonly: a fresh `models.providers.litellm` entry written by
 * src/lib/services/openclaw-routing-wire.ts).
 *
 * Why this module exists:
 *   The wire engine writes the JSON, but the gateway daemon caches its
 *   config in memory. Without a restart, traffic keeps flowing the old
 *   way -- LiteLLM stays bypassed, the wire is half-done. Telling the
 *   operator "now SSH and restart" turns a one-click wire into a
 *   four-step process and contradicts the dashboard-as-control-plane
 *   premise. So we restart from the dashboard itself.
 *
 * Supervisor detection:
 *   The daemon is supervised differently per platform:
 *     - Linux:  systemd user unit at ~/.config/systemd/user/openclaw-gateway.service
 *               Verified on a staging Linux host 2026-04-29 (Linger=yes, deployment operator owns it).
 *     - macOS:  launchd agent labelled `ai.openclaw.gateway`
 *               Verified on a macOS test host 2026-04-29.
 *   Other supervisors (raw process, runit, sysvinit, Windows) are not
 *   supported in v1 -- the engine reports `unsupported` and the UI
 *   surfaces the manual command for the operator to copy.
 *
 * Permissions:
 *   - systemd user units don't require sudo when invoked by their owner.
 *     If the dashboard process runs as root (clawnex-dashboard.service is
 *     a system unit), we use `sudo -u <openclaw-owner> env XDG_RUNTIME_DIR=...`
 *     to drop into the right user context. The systemd user instance is
 *     persistent because Linger=yes is enabled by deploy.sh's setup of
 *     OpenClaw, so it's reachable even without an active login session.
 *   - launchctl talks to the operator's GUI Aqua session; the Next.js
 *     dev server runs in that same session, so no privilege escalation.
 *
 * What we DON'T do:
 *   - We don't `daemon-reload` or otherwise mutate the unit file.
 *   - We don't restart the LiteLLM proxy or the dashboard itself.
 *   - We don't wait for OpenClaw's gateway to confirm "ready" -- that
 *     would require a health probe contract OpenClaw doesn't expose
 *     today. We return success when the supervisor reports the unit
 *     restarted; the operator can verify via the routing card refresh.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { resolveOpenClawPaths } from '../openclaw-paths';

const execFileP = promisify(execFile);

export type Supervisor = 'systemd-user' | 'launchd' | 'unsupported';

export interface SupervisorInfo {
  kind: Supervisor;
  /** Human-readable platform/supervisor name, for UI display. */
  label: string;
  /** Manual restart command an operator would copy/paste if our restart
   *  fails or the supervisor is unsupported. Always populated. */
  manualCommand: string;
}

export interface RestartResult {
  ok: boolean;
  supervisor: Supervisor;
  /** Human-readable status code: 'restarted' on success, or one of the
   *  failure modes ('unsupported', 'detection-failed', 'exec-failed'). */
  status: 'restarted' | 'unsupported' | 'detection-failed' | 'exec-failed';
  detail: string;
  /** Combined stdout + stderr from the supervisor command, if any.
   *  Sanitized through `redactSensitive()` before exposure (internal reviewer M-01
   *  followup item B, 2026-04-29) — env-var-shaped tokens, common API
   *  key prefixes, and absolute home paths are masked. The redaction
   *  is best-effort defense-in-depth; restart commands shouldn't echo
   *  secrets in the first place, but the dashboard surface returning
   *  raw output to admins is a real disclosure surface. */
  output?: string;
  /** Wall-clock time of the restart command in milliseconds. Useful for
   *  the operator to spot pathologically slow restarts. */
  elapsedMs?: number;
  /** Manual command the operator can run to do this themselves. */
  manualCommand: string;
}

/**
 * Best-effort redaction for stdout/stderr exposed to dashboard
 * operators. Targets:
 *   - `KEY=value` env-var assignments (common in stderr stack traces)
 *   - Bearer/Token-shaped strings (sk-..., ghp_..., 32+ hex/base64 runs)
 *   - Absolute home paths (/home/<user>/, /Users/<user>/) -> /~/
 * Conservative on false positives (we'd rather over-mask than leak).
 * internal reviewer M-01 followup item B, 2026-04-29.
 */
function redactSensitive(s: string): string {
  if (!s) return s;
  return s
    // Env var assignments inside a command line / stack trace.
    // e.g. AUTH_TOKEN=abc123 -> AUTH_TOKEN=***
    .replace(/\b([A-Z][A-Z0-9_]{2,})=([^\s'"]{4,})/g, '$1=***')
    // Common API key/token prefixes followed by long opaque run.
    // e.g. sk-or-v1-... -> sk-or-v1-***
    .replace(/\b(sk-[a-zA-Z0-9-]+-|ghp_|gho_|ghu_|ghr_|github_pat_|nvapi-|AIza)[A-Za-z0-9_\-]{16,}/g, '$1***')
    // Home directories anywhere in the string.
    .replace(/(\/home\/|\/Users\/)[^\s/]+/g, '$1~');
}

export function _redactSensitiveForTests(s: string): string {
  return redactSensitive(s);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Resolve the UID of the user who owns `~/.openclaw/`. On staging Linux the
 * dashboard may run as root while openclaw is owned by the deployment operator
 * (UID 1000ish); on macOS they're the same user. The returned UID is what
 * we feed into
 * `XDG_RUNTIME_DIR=/run/user/$UID` and `sudo -u <user>`.
 */
async function resolveOpenClawOwner(): Promise<{ uid: number; username: string } | null> {
  const { home } = resolveOpenClawPaths();
  if (!home) return null;
  try {
    // `stat -c %u %U` prints "<uid> <username>" -- works on Linux. On macOS
    // we use `stat -f %u %Su`. Try Linux first, fall back to macOS.
    let out: string;
    try {
      const r = await execFileP('stat', ['-c', '%u %U', home]);
      out = r.stdout.trim();
    } catch {
      const r = await execFileP('stat', ['-f', '%u %Su', home]);
      out = r.stdout.trim();
    }
    const [uidStr, username] = out.split(/\s+/);
    const uid = parseInt(uidStr, 10);
    if (!Number.isFinite(uid)) return null;
    return { uid, username };
  } catch {
    return null;
  }
}

export async function detectSupervisor(): Promise<SupervisorInfo> {
  const platform = os.platform();

  if (platform === 'linux') {
    const owner = await resolveOpenClawOwner();
    if (owner) {
      try {
        // Probe: is there a systemd user unit named openclaw-gateway?
        // We use `systemctl --user list-unit-files` so we don't touch
        // service state, just confirm the unit exists.
        const env = { XDG_RUNTIME_DIR: `/run/user/${owner.uid}` };
        const isRoot = process.getuid?.() === 0;
        const cmd = isRoot ? 'sudo' : 'systemctl';
        const args = isRoot
          ? ['-u', owner.username, 'env', `XDG_RUNTIME_DIR=/run/user/${owner.uid}`, 'systemctl', '--user', 'list-unit-files', 'openclaw-gateway.service', '--no-legend']
          : ['--user', 'list-unit-files', 'openclaw-gateway.service', '--no-legend'];
        const r = await execFileP(cmd, args, { env: isRoot ? process.env : { ...process.env, ...env } });
        if (r.stdout.includes('openclaw-gateway')) {
          return {
            kind: 'systemd-user',
            label: `systemd user unit (owner: ${owner.username})`,
            manualCommand: `XDG_RUNTIME_DIR=/run/user/${owner.uid} systemctl --user restart openclaw-gateway`,
          };
        }
      } catch { /* fall through */ }
    }
  }

  if (platform === 'darwin') {
    try {
      // launchctl list prints PID, exit-status, and label in tab-separated
      // columns. Grep for the openclaw label.
      const r = await execFileP('launchctl', ['list']);
      if (r.stdout.includes('ai.openclaw.gateway')) {
        const uid = process.getuid?.() ?? 0;
        return {
          kind: 'launchd',
          label: 'launchd Aqua session (macOS)',
          manualCommand: `launchctl kickstart -k gui/${uid}/ai.openclaw.gateway`,
        };
      }
    } catch { /* fall through */ }
  }

  return {
    kind: 'unsupported',
    label: `${platform} (no known supervisor for openclaw-gateway)`,
    manualCommand: 'Restart openclaw-gateway by whatever means your platform supports (e.g. `pkill openclaw-gateway` if it auto-respawns).',
  };
}

// ---------------------------------------------------------------------------
// Restart
// ---------------------------------------------------------------------------

export async function restartOpenClawGateway(): Promise<RestartResult> {
  const sup = await detectSupervisor();

  if (sup.kind === 'unsupported') {
    return {
      ok: false,
      supervisor: 'unsupported',
      status: 'unsupported',
      detail: `Unsupported supervisor on this host (${sup.label}). Run the manual command instead.`,
      manualCommand: sup.manualCommand,
    };
  }

  const start = Date.now();
  try {
    if (sup.kind === 'systemd-user') {
      const owner = await resolveOpenClawOwner();
      if (!owner) {
        return {
          ok: false,
          supervisor: 'systemd-user',
          status: 'detection-failed',
          detail: 'Could not resolve OpenClaw owner UID for systemctl --user.',
          manualCommand: sup.manualCommand,
        };
      }
      const isRoot = process.getuid?.() === 0;
      const cmd = isRoot ? 'sudo' : 'systemctl';
      const args = isRoot
        ? ['-u', owner.username, 'env', `XDG_RUNTIME_DIR=/run/user/${owner.uid}`, 'systemctl', '--user', 'restart', 'openclaw-gateway']
        : ['--user', 'restart', 'openclaw-gateway'];
      const env = isRoot ? process.env : { ...process.env, XDG_RUNTIME_DIR: `/run/user/${owner.uid}` };
      // `systemctl restart` exits 0 on success; non-zero throws and
      // execFileP rejects, which we catch below.
      const r = await execFileP(cmd, args, { env });
      const elapsedMs = Date.now() - start;
      const rawOut = `${r.stdout}${r.stderr}`.trim();
      return {
        ok: true,
        supervisor: 'systemd-user',
        status: 'restarted',
        detail: `Restarted openclaw-gateway via systemd user unit (owner: ${owner.username}).`,
        output: rawOut ? redactSensitive(rawOut) : undefined,
        elapsedMs,
        manualCommand: sup.manualCommand,
      };
    }

    if (sup.kind === 'launchd') {
      const uid = process.getuid?.() ?? 0;
      const r = await execFileP('launchctl', ['kickstart', '-k', `gui/${uid}/ai.openclaw.gateway`]);
      const elapsedMs = Date.now() - start;
      const rawOut = `${r.stdout}${r.stderr}`.trim();
      return {
        ok: true,
        supervisor: 'launchd',
        status: 'restarted',
        detail: 'Restarted openclaw-gateway via launchctl.',
        output: rawOut ? redactSensitive(rawOut) : undefined,
        elapsedMs,
        manualCommand: sup.manualCommand,
      };
    }

    // Defensive: detectSupervisor only returns the three variants above.
    // This branch is unreachable, present to satisfy the type narrower.
    return {
      ok: false,
      supervisor: 'unsupported',
      status: 'unsupported',
      detail: 'Unhandled supervisor kind.',
      manualCommand: sup.manualCommand,
    };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const errAny = err as { code?: string | number; stderr?: string; stdout?: string; message?: string };
    const rawOut = `${errAny.stdout ?? ''}${errAny.stderr ?? ''}`.trim();
    return {
      ok: false,
      supervisor: sup.kind,
      status: 'exec-failed',
      detail: `Restart command failed: ${redactSensitive(errAny.message ?? String(err))}`,
      output: rawOut ? redactSensitive(rawOut) : undefined,
      elapsedMs,
      manualCommand: sup.manualCommand,
    };
  }
}
