/**
 * Voice & Avatar Configuration API
 * GET  /api/config/voice — returns voice/avatar settings
 * PUT  /api/config/voice — update settings
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getSetting, setSetting, getAllSettings } from "@/lib/services/config-service";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_KEYS = [
  "voice_provider",      // "browser" | "elevenlabs"
  "elevenlabs_api_key",
  "elevenlabs_voice_id",
  "avatar_provider",     // "shield" | "heygen" | "did" | "comfyui"
  "heygen_api_key",
  "heygen_avatar_id",
  "did_api_key",
  "did_presenter_id",
  "did_agent_id",
  "comfyui_url",
  "chat_mode",           // "bubbles" | "bubbles+avatar" | "avatar"
] as const;

const DEFAULTS: Record<string, string> = {
  voice_provider: "browser",
  elevenlabs_api_key: "",
  elevenlabs_voice_id: "",  // operator-configured
  avatar_provider: "shield",
  heygen_api_key: "",
  heygen_avatar_id: "",
  did_api_key: "",
  did_presenter_id: "",
  did_agent_id: "",
  comfyui_url: "",
  chat_mode: "bubbles",
};

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const __t0 = Date.now();
  try {
    // 2026-04-22 (Task 9 — perf): batch-fetch all config_defaults once rather
    // than 11 sequential SELECTs (one per VOICE_KEYS entry).
    const all = getAllSettings();
    const byKey = new Map<string, string>();
    for (const row of all) byKey.set(row.key, row.value);
    const settings: Record<string, string> = {};
    for (const key of VOICE_KEYS) {
      settings[key] = byKey.get(key) || DEFAULTS[key] || "";
    }
    // Mask API keys for security
    const masked = { ...settings };
    if (masked.elevenlabs_api_key && masked.elevenlabs_api_key.length > 8) {
      masked.elevenlabs_api_key = masked.elevenlabs_api_key.slice(0, 6) + "..." + masked.elevenlabs_api_key.slice(-4);
    }
    if (masked.heygen_api_key && masked.heygen_api_key.length > 8) {
      masked.heygen_api_key = masked.heygen_api_key.slice(0, 6) + "..." + masked.heygen_api_key.slice(-4);
    }
    if (masked.did_api_key && masked.did_api_key.length > 8) {
      masked.did_api_key = masked.did_api_key.slice(0, 6) + "..." + masked.did_api_key.slice(-4);
    }

    const response = NextResponse.json({ settings: masked, hasElevenLabs: !!settings.elevenlabs_api_key, hasHeyGen: !!settings.heygen_api_key, hasDID: !!settings.did_api_key });
    console.log(`[api/config/voice:GET] ${Date.now() - __t0}ms`);
    return response;
  } catch (err) {
    console.error(`[api/config/voice:GET] failed after ${Date.now() - __t0}ms:`, err);
    return NextResponse.json({ error: "Failed to get voice settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { settings } = body as { settings?: Record<string, string> };

    if (!settings || typeof settings !== "object") {
      return NextResponse.json({ error: "Expected { settings: { key: value, ... } }" }, { status: 400 });
    }

    const changes: string[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (!VOICE_KEYS.includes(key as typeof VOICE_KEYS[number])) continue;
      setSetting(key, value);
      // Don't log API keys in audit
      if (key.includes("api_key")) {
        changes.push(`${key}: ${value ? "configured" : "removed"}`);
      } else {
        changes.push(`${key}: ${value}`);
      }
    }

    // Auto-validate ElevenLabs key — if valid, set as default voice provider
    if (settings.elevenlabs_api_key) {
      try {
        const testRes = await fetch("https://api.elevenlabs.io/v1/voices", {
          headers: { "xi-api-key": settings.elevenlabs_api_key },
          signal: AbortSignal.timeout(8000),
        });
        if (testRes.ok) {
          setSetting("voice_provider", "elevenlabs");
          changes.push("voice_provider: auto-set to elevenlabs (key validated)");
        } else {
          changes.push("elevenlabs_api_key: test FAILED (invalid key)");
        }
      } catch {
        changes.push("elevenlabs_api_key: test FAILED (unreachable)");
      }
    } else if (settings.elevenlabs_api_key === "") {
      // Key removed — revert to browser
      setSetting("voice_provider", "browser");
      changes.push("voice_provider: reverted to browser (key removed)");
    }

    logEvent("operator", "voice_settings_updated", "config", "voice", changes.join("; "), "dashboard");

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Voice Config] PUT error:", err);
    return NextResponse.json({ error: "Failed to update voice settings" }, { status: 500 });
  }
}
