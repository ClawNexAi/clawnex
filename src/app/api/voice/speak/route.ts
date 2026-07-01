/**
 * Voice TTS Proxy API
 * POST /api/voice/speak — converts text to speech via ElevenLabs
 *
 * Body: { text: string }
 * Returns: audio/mpeg stream
 *
 * Falls back to empty response if ElevenLabs is not configured.
 * API key is stored server-side — never exposed to the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getSetting } from "@/lib/services/config-service";
import { sanitizeLogField } from "@/lib/security/log-sanitize";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'voice:use');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { text } = body as { text?: string };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing 'text' field" }, { status: 400 });
    }

    const apiKey = getSetting("elevenlabs_api_key");
    const voiceId = getSetting("elevenlabs_voice_id") || "<elevenlabs_voice_id>";
    const provider = getSetting("voice_provider") || "browser";

    if (provider !== "elevenlabs" || !apiKey) {
      return NextResponse.json({ provider: "browser", message: "ElevenLabs not configured" }, { status: 200 });
    }

    // Clean text for speech (remove markdown formatting)
    const cleanText = text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\[([^\]]+)\]/g, "$1")
      .replace(/[#*_`]/g, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .trim();

    if (!cleanText) {
      return NextResponse.json({ provider: "elevenlabs", message: "No speakable text" }, { status: 200 });
    }

    // Call ElevenLabs API
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: cleanText.slice(0, 5000), // ElevenLabs limit
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      console.error("[Voice/Speak] ElevenLabs returned non-OK status", {
        status: res.status,
        error: sanitizeLogField(errText, 500),
      });
      return NextResponse.json({ error: `ElevenLabs error: ${res.status}`, provider: "elevenlabs" }, { status: 502 });
    }

    // Stream the audio back to the browser
    const audioBuffer = await res.arrayBuffer();
    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("[Voice/Speak] Error", {
      error: err instanceof Error ? sanitizeLogField(err.message) : sanitizeLogField(err),
    });
    return NextResponse.json({ error: "TTS failed" }, { status: 500 });
  }
}
