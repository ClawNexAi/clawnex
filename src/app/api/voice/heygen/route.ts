/**
 * HeyGen LiveAvatar API Proxy
 *
 * POST /api/voice/heygen — actions: create_token, list_avatars
 *
 * Creates session tokens for the LiveAvatar SDK. API key stored server-side.
 * The browser handles WebRTC via @heygen/liveavatar-web-sdk.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getSetting } from "@/lib/services/config-service";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic';

const HEYGEN_API = "https://api.liveavatar.com";

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
    const apiKey = getSetting("heygen_api_key");
    if (!apiKey) {
      return NextResponse.json({ error: "HeyGen API key not configured" }, { status: 400 });
    }

    const body = await request.json();
    const { action } = body as { action: string };

    switch (action) {
      case "create_token": {
        const avatarId = getSetting("heygen_avatar_id") || "";
        if (!avatarId) {
          return NextResponse.json({ error: "HeyGen avatar ID not configured" }, { status: 400 });
        }

        const res = await fetch(`${HEYGEN_API}/v1/sessions/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": apiKey,
          },
          body: JSON.stringify({
            avatar_id: avatarId,
            mode: "FULL",
            avatar_persona: {
              persona_id: "default",
              language: "en",
            },
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          console.error("[HeyGen] Create token failed:", res.status, err);
          return NextResponse.json({ error: `HeyGen error: ${res.status}`, detail: err }, { status: 502 });
        }

        const data = await res.json();
        return NextResponse.json({
          session_id: data.data?.session_id,
          session_token: data.data?.session_token,
        });
      }

      case "list_avatars": {
        // Fetch both user avatars and public avatars
        const [userRes, publicRes] = await Promise.allSettled([
          fetch(`${HEYGEN_API}/v1/avatars`, { headers: { "X-API-KEY": apiKey } }),
          fetch(`${HEYGEN_API}/v1/avatars/public`, { headers: { "X-API-KEY": apiKey } }),
        ]);

        const userAvatars = userRes.status === "fulfilled" && userRes.value.ok
          ? (await userRes.value.json()).data?.results || []
          : [];
        const publicAvatars = publicRes.status === "fulfilled" && publicRes.value.ok
          ? (await publicRes.value.json()).data?.results || []
          : [];

        return NextResponse.json({
          user: userAvatars,
          public: publicAvatars.slice(0, 20), // Limit to 20 public avatars
          total: userAvatars.length + publicAvatars.length,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[HeyGen API] Error:", err);
    return NextResponse.json({ error: "HeyGen proxy error" }, { status: 500 });
  }
}
