import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { applyInspectionProfile, getActiveInspectionProfile, getInspectionProfile, listInspectionProfiles } from "@/lib/services/shield-profiles";

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
    const perm = requirePermission(auth.operator, "config:write");
    return perm || null;
  }
  return requireLocalhost(request);
}

export async function GET(request: NextRequest) {
  const blocked = guardRead(request);
  if (blocked) return blocked;
  return NextResponse.json({
    active: getActiveInspectionProfile(),
    profiles: listInspectionProfiles(),
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const blocked = guardWrite(request);
  if (blocked) return blocked;
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    const profile = getInspectionProfile(id);
    if (profile.id !== id) {
      return NextResponse.json({ error: "Unknown inspection profile" }, { status: 400 });
    }
    const operator = getOperatorFromRequest(request);
    const applied = applyInspectionProfile(id, operator?.username || "operator");
    return NextResponse.json({ ok: true, active: applied });
  } catch {
    return NextResponse.json({ error: "Failed to apply inspection profile" }, { status: 500 });
  }
}

