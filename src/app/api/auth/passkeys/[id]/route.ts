// DELETE /api/auth/passkeys/:id
//
// Revoke one of the current operator's passkeys. Refuses to delete a row
// that doesn't belong to the requester (admins manage other operators
// via the Operator Management card, not this endpoint).

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/rbac/guard";
import {
  listPasskeysForOperator,
  deleteCredential,
} from "@/lib/services/auth/credentials-service";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const owned = listPasskeysForOperator(session.operator.id).find((c) => c.id === id);
  if (!owned) {
    // Don't reveal whether the id exists for someone else — same 404 either way.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  deleteCredential(id);
  logEvent(
    session.operator.username,
    "passkey_revoked",
    "operator",
    session.operator.id,
    `Passkey "${owned.label ?? "unnamed"}" revoked`,
    "auth",
  );

  return NextResponse.json({ ok: true });
}
