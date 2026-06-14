/**
 * Central OpenClaw path resolution.
 * Priority: OPENCLAW_HOME env var → ~/.openclaw → scan /home/*\/.openclaw → /root/.openclaw
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let cached: { home: string | null; configPath: string | null } | null = null;

export function resolveOpenClawPaths(): { home: string | null; configPath: string | null } {
  if (cached) return cached;

  const candidates: string[] = [];
  if (process.env.OPENCLAW_HOME) candidates.push(process.env.OPENCLAW_HOME);
  candidates.push(path.join(os.homedir(), '.openclaw'));
  candidates.push(path.join(os.homedir(), '.config', 'openclaw'));

  // Scan /home/* for .openclaw directories
  try {
    const homeDirs = fs.readdirSync('/home', { withFileTypes: true });
    for (const dir of homeDirs) {
      if (dir.isDirectory()) {
        candidates.push(`/home/${dir.name}/.openclaw`);
      }
    }
  } catch { /* ignore */ }
  candidates.push('/root/.openclaw');

  for (const candidate of candidates) {
    const configPath = path.join(candidate, 'openclaw.json');
    if (fs.existsSync(configPath)) {
      cached = { home: candidate, configPath };
      return cached;
    }
  }

  cached = { home: null, configPath: null };
  return cached;
}

/** Read openclaw.json and return the parsed contents, or null if not found. */
export function readOpenClawConfig(): Record<string, unknown> | null {
  const { configPath } = resolveOpenClawPaths();
  if (!configPath) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Extract the gateway token from openclaw.json. */
export function getGatewayTokenFromOpenClaw(): string | null {
  const config = readOpenClawConfig();
  if (!config) return null;
  const gateway = config.gateway as { auth?: { token?: string } } | undefined;
  return gateway?.auth?.token || null;
}

/** Clear the cache (for testing or after config changes). */
export function clearOpenClawPathCache(): void {
  cached = null;
}

/**
 * Normalize an agent/gateway model field to a plain string.
 *
 * Older OpenClaw configs used `model: "provider/id"`. Newer configs (2026-04+) use a
 * fallback-chain shape `{primary: "provider/id", fallback: ["provider/id2", ...]}`.
 * This helper coerces either form to the primary string so the frontend can render
 * it directly without triggering React error #31 ("Objects are not valid as a React child").
 *
 * Returns the provided fallback (default "default") when the input is missing,
 * empty, or an unrecognized shape.
 */
export function normalizeOpenClawModel(value: unknown, fallback: string = "default"): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object") {
    const obj = value as { primary?: unknown };
    if (typeof obj.primary === "string" && obj.primary.length > 0) return obj.primary;
  }
  return fallback;
}
