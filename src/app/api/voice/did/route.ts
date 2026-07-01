/**
 * D-ID Agents Streaming API Proxy
 *
 * POST /api/voice/did — actions: create_agent, list_presenters, create_stream, speak, stop
 *
 * Proxies requests to D-ID's API. API key stored server-side.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getSetting, setSetting } from "@/lib/services/config-service";
import { sanitizeLogField } from "@/lib/security/log-sanitize";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic';

const DID_API = "https://api.d-id.com";
const DID_ID_RE = /^[A-Za-z0-9_.:@-]{1,160}$/;

function didPath(...segments: string[]): string {
  return segments.map((segment) => {
    if (!DID_ID_RE.test(segment)) {
      throw new Error("Invalid D-ID resource identifier");
    }
    return encodeURIComponent(segment);
  }).join("/");
}

async function didFetch(pathname: string, method: string, body?: Record<string, unknown>): Promise<Response> {
  const apiKey = getSetting("did_api_key");
  if (!apiKey) throw new Error("D-ID API key not configured");

  const headers: Record<string, string> = {
    "Authorization": `Basic ${apiKey}`,
    "Accept": "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";

  const url = new URL(pathname, DID_API);
  if (url.origin !== DID_API) {
    throw new Error("Invalid D-ID request target");
  }

  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

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
    const apiKey = getSetting("did_api_key");
    if (!apiKey) {
      return NextResponse.json({ error: "D-ID API key not configured" }, { status: 400 });
    }

    const body = await request.json();
    const { action } = body as { action: string };

    switch (action) {
      case "list_presenters": {
        const res = await didFetch("/clips/presenters", "GET");
        if (!res.ok) {
          return NextResponse.json({ error: `D-ID error: ${res.status}` }, { status: 502 });
        }
        const data = await res.json();
        return NextResponse.json({ presenters: data.presenters || data.clips || data });
      }

      case "create_agent": {
        const presenterId = getSetting("did_presenter_id") || "v2_public_Amber@0zSz8kflCN";
        const voiceId = getSetting("elevenlabs_voice_id") || "en-US-JennyMultilingualV2Neural";
        const voiceProvider = getSetting("voice_provider");

        const agentBody: Record<string, unknown> = {
          preview_name: "ClawNex SOC Analyst",
          presenter: {
            type: "clip",
            presenter_id: presenterId,
            voice: voiceProvider === "elevenlabs"
              ? { type: "elevenlabs", voice_id: voiceId }
              : { type: "microsoft", voice_id: "en-US-JennyMultilingualV2Neural" },
          },
          llm: {
            provider: "openai",
            model: "gpt-4o-mini",
            instructions: "You are the ClawNex SOC analyst assistant. Repeat exactly what the user says without modification.",
          },
        };

        const res = await didFetch("/agents", "POST", agentBody);
        if (!res.ok) {
          const err = await res.text();
          const detail = sanitizeLogField(err, 500);
          console.error("[D-ID] Create agent failed:", { status: res.status, detail });
          return NextResponse.json({ error: `D-ID error: ${res.status}`, detail }, { status: 502 });
        }

        const data = await res.json();
        const agentId = data.id;
        if (agentId) {
          setSetting("did_agent_id", agentId);
        }
        return NextResponse.json({ agent_id: agentId, status: data.status });
      }

      case "create_stream": {
        const agentId = getSetting("did_agent_id");
        if (!agentId) {
          return NextResponse.json({ error: "No D-ID agent created. Create one first." }, { status: 400 });
        }

        const res = await didFetch(`/${didPath("agents", agentId, "streams")}`, "POST", {});
        if (!res.ok) {
          const err = await res.text();
          const detail = sanitizeLogField(err, 500);
          console.error("[D-ID] Create stream failed:", { status: res.status, detail });
          return NextResponse.json({ error: `D-ID stream error: ${res.status}`, detail }, { status: 502 });
        }

        const data = await res.json();
        return NextResponse.json({
          stream_id: data.id || data.stream_id,
          session_id: data.session_id,
          offer: data.offer,
          ice_servers: data.ice_servers,
        });
      }

      case "sdp_answer": {
        const { stream_id, answer } = body as { stream_id: string; answer: unknown };
        const agentId = getSetting("did_agent_id");
        if (!agentId || !stream_id) {
          return NextResponse.json({ error: "Missing agent_id or stream_id" }, { status: 400 });
        }

        const res = await didFetch(`/${didPath("agents", agentId, "streams", stream_id, "sdp")}`, "POST", {
          answer,
        });
        if (!res.ok) {
          const err = await res.text();
          const detail = sanitizeLogField(err, 500);
          console.error("[D-ID] SDP failed:", { status: res.status, detail });
          return NextResponse.json({ error: `D-ID SDP error: ${res.status}`, detail }, { status: 502 });
        }

        return NextResponse.json({ ok: true });
      }

      case "speak": {
        const { stream_id, text } = body as { stream_id: string; text: string };
        const agentId = getSetting("did_agent_id");
        if (!agentId || !stream_id || !text) {
          return NextResponse.json({ error: "Missing agent_id, stream_id, or text" }, { status: 400 });
        }

        // Clean text
        const clean = text
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .replace(/\[([^\]]+)\]/g, "$1")
          .replace(/[#*_`]/g, "")
          .replace(/\n{2,}/g, ". ")
          .replace(/\n/g, " ")
          .trim()
          .slice(0, 3000);

        const res = await didFetch(`/${didPath("agents", agentId, "streams", stream_id)}`, "POST", {
          script: {
            type: "text",
            input: clean,
          },
        });

        if (!res.ok) {
          const err = await res.text();
          const detail = sanitizeLogField(err, 500);
          console.error("[D-ID] Speak failed:", { status: res.status, detail });
          return NextResponse.json({ error: `D-ID speak error: ${res.status}`, detail }, { status: 502 });
        }

        return NextResponse.json({ ok: true });
      }

      case "stop": {
        const { stream_id } = body as { stream_id: string };
        const agentId = getSetting("did_agent_id");
        if (!agentId || !stream_id) {
          return NextResponse.json({ ok: true }); // Graceful no-op
        }

        await didFetch(`/${didPath("agents", agentId, "streams", stream_id)}`, "DELETE").catch(() => {});
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const detail = sanitizeLogField(err instanceof Error ? err.message : err);
    console.error("[D-ID API] Error:", { detail });
    return NextResponse.json({ error: detail || "D-ID proxy error" }, { status: 500 });
  }
}
