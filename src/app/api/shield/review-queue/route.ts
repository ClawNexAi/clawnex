import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { decideReviewQueueItem, listReviewQueue, type ReviewQueueStatus } from "@/lib/services/shield-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guardRead(request: NextRequest): NextResponse | null {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, "shield:read");
    return perm || null;
  }
  return requireLocalhost(request);
}

function guardWrite(request: NextRequest): NextResponse | null {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, "alerts:manage");
    return perm || null;
  }
  return requireLocalhost(request);
}

export async function GET(request: NextRequest) {
  const blocked = guardRead(request);
  if (blocked) return blocked;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "open";
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "100", 10) || 100, 1), 500);
  return NextResponse.json({
    queue: listReviewQueue(status, limit),
    timestamp: new Date().toISOString(),
  });
}

export async function PATCH(request: NextRequest) {
  const blocked = guardWrite(request);
  if (blocked) return blocked;
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    const status = body.status as ReviewQueueStatus;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const allowed = new Set(["approved", "rejected", "false_positive", "escalated", "whitelist_draft"]);
    if (!id || !allowed.has(status)) {
      return NextResponse.json({ error: "Expected { id, status } with a valid decision status" }, { status: 400 });
    }
    if (!reason) return NextResponse.json({ error: "A decision reason is required" }, { status: 400 });
    const operator = getOperatorFromRequest(request);
    const row = decideReviewQueueItem({
      id,
      status,
      reason,
      actor: operator?.username || "operator",
    });
    if (!row) return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    return NextResponse.json({ ok: true, item: row });
  } catch {
    return NextResponse.json({ error: "Failed to update review queue item" }, { status: 500 });
  }
}

