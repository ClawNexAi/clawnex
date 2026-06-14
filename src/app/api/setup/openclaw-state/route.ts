/**
 * OpenClaw State Detection — GET /api/setup/openclaw-state
 *
 * Surfaces a four-state view of OpenClaw's availability for the Quick Setup
 * Card on the Fleet Command panel. Combines the live websocket status from
 * the connector singleton with a filesystem probe so we can also detect
 * "OpenClaw was once installed but isn't running."
 *
 * Returned states:
 *   - "connected"     → OpenClaw running AND handshake authenticated
 *   - "auth-failing"  → OpenClaw running but handshake/auth failed
 *   - "stopped"       → OpenClaw NOT running, but ~/.openclaw/ exists on disk
 *   - "absent"        → OpenClaw not running and no install marker on disk
 *
 * Also returns the host OS so the Quick Setup Card can show OS-correct
 * install commands for Ollama / LMStudio fallbacks (no separate endpoint
 * needed for that one piece of info).
 *
 * @module api/setup/openclaw-state
 */
import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getOpenClawConnector } from "@/lib/connectors/openclaw-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenClawState = "connected" | "auth-failing" | "stopped" | "absent";

export async function GET() {
  const connector = getOpenClawConnector();
  const status = connector.getConnectionStatus();

  let state: OpenClawState;
  let lastError: string | null = null;

  if (status.connected && status.authenticated) {
    state = "connected";
  } else if (status.connected && !status.authenticated) {
    state = "auth-failing";
    lastError = status.lastError ?? null;
  } else {
    // Not connected at all. Check filesystem to distinguish "was once installed
    // but stopped" from "never installed". Mirrors the probe pattern used by
    // src/lib/openclaw-paths.ts — homedir + common install locations.
    const candidates = [
      join(homedir(), ".openclaw"),
      join(homedir(), ".config", "openclaw"),
    ];
    if (process.env.OPENCLAW_HOME) candidates.unshift(process.env.OPENCLAW_HOME);

    const installFound = candidates.some((p) => {
      try {
        return existsSync(p);
      } catch {
        return false;
      }
    });

    state = installFound ? "stopped" : "absent";
  }

  // Host OS — for OS-specific install hints in the Quick Setup Card.
  // process.platform: "darwin" | "linux" | "win32" | ...
  let os: "macos" | "linux" | "other" = "other";
  if (process.platform === "darwin") os = "macos";
  else if (process.platform === "linux") os = "linux";

  return NextResponse.json({
    state,
    lastError,
    os,
    // Echo the underlying booleans so the UI can show debug context if needed
    raw: {
      connected: status.connected,
      authenticated: status.authenticated,
    },
  });
}
