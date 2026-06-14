// GET /api/auth/passkeys
//
// Returns the current operator's enrolled passkeys for the Auth & Devices
// settings card. Public-key bytes are never returned — only the metadata
// the user needs to recognise and manage each credential.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/rbac/guard";
import { listPasskeysForOperator } from "@/lib/services/auth/credentials-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  const rows = listPasskeysForOperator(session.operator.id);
  return NextResponse.json({
    passkeys: rows.map((c) => ({
      id: c.id,
      label: c.label,
      transports: c.transports?.split(",") ?? [],
      createdAt: c.created_at,
      lastUsedAt: c.last_used_at,
    })),
  });
}
