/**
 * GET /api/paperclip/observability — surface Paperclip's dashboard / agents /
 * activity / approvals to ClawNex operators.
 *
 * Read-only proxy. Never mutates Paperclip. Cached upstream by Paperclip
 * itself (the connector adds no caching layer — every ClawNex request fetches
 * fresh). Server-side connector handles auth via PAPERCLIP_API_KEY +
 * PAPERCLIP_COMPANY_ID env vars; ClawNex operators never see the Paperclip
 * key, only the data it unlocks.
 *
 * Auth: requireSession + requirePermission('config:read'). Paperclip data
 * exposes infrastructure topology (agent inventory, cost spend, pending
 * approvals) — same sensitivity tier as the permissiveness scan, so the
 * same permission gate.
 *
 * Spec: docs/paperclip-integration-design-2026-04-25.md
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requirePermission } from "@/lib/rbac/guard";
import { getPaperclipObservability } from "@/lib/connectors/paperclip-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireSession(req);
  if (auth instanceof NextResponse) return auth;

  const perm = requirePermission(auth.operator, "config:read");
  if (perm) return perm;

  try {
    const data = await getPaperclipObservability();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "paperclip observability fetch failed";
    console.error("[/api/paperclip/observability] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
