import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { createReplayCase, getReplayCase } from "@/lib/services/shield-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(request: NextRequest): NextResponse | null {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, "shield:scan");
    return perm || null;
  }
  return requireLocalhost(request);
}

export async function GET(request: NextRequest) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const replay = getReplayCase(id);
  if (!replay) return NextResponse.json({ error: "Replay case not found" }, { status: 404 });
  return NextResponse.json({ replay });
}

export async function POST(request: NextRequest) {
  const blocked = guard(request);
  if (blocked) return blocked;
  try {
    const body = await request.json();
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) return NextResponse.json({ error: "Replay requires redacted or pasted text" }, { status: 400 });
    if (text.length > 500_000) return NextResponse.json({ error: "Text exceeds maximum length of 500,000 characters" }, { status: 413 });
    const operator = getOperatorFromRequest(request);
    const replay = createReplayCase({
      text,
      sourceType: body.sourceType || "manual",
      sourceId: body.sourceId || null,
      original: body.original,
      actor: operator?.username || "operator",
    });
    return NextResponse.json({ ok: true, replay });
  } catch {
    return NextResponse.json({ error: "Replay failed" }, { status: 500 });
  }
}

