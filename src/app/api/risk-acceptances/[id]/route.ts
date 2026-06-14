// DELETE /api/risk-acceptances/:id — revoke acceptance
//
// Requires risk:accept permission (admin + security_manager). Body:
// { reason: string }. Returns 200 with the revoked record. 404 when id
// not found, 400 on missing reason or malformed body.
//
// Spec: docs/superpowers/specs/2026-04-23-risk-acceptance-design.md §5

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getAcceptance, revoke } from "@/lib/services/risk-acceptance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authWriteOrFail(req: NextRequest): NextResponse | { actor: string } {
  if (isRbacEnabled()) {
    const auth = requireSession(req);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, "risk:accept");
    if (perm) return perm;
    return { actor: auth.operator.id };
  }
  const guard = requireLocalhost(req);
  if (guard) return guard;
  return { actor: "localhost" };
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = authWriteOrFail(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id || id.length === 0) {
    return NextResponse.json({ error: "missing-id" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const reason = body.reason;
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return NextResponse.json({ error: "invalid-reason", detail: "revoke reason required" }, { status: 400 });
  }

  const existing = getAcceptance(id);
  if (!existing) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  try {
    const revoked = revoke(id, { revoked_by: auth.actor, reason });
    return NextResponse.json({ acceptance: revoked });
  } catch (err) {
    return NextResponse.json(
      { error: "revoke-failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
