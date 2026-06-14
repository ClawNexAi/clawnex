// GET /api/permissiveness
//
// Returns a PermissivenessReport (see src/lib/services/permissiveness/types.ts).
// Query params:
//   ?refresh=true — force rescan, bypass cache
//
// Cache: in-memory 60s TTL (cache.ts).
//
// Auth: requireSession + requirePermission('config:read'). Report exposes
// installed agents, gateway topology, and infrastructure posture — treat as
// config-level information, not a public health signal.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §6

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requirePermission } from "@/lib/rbac/guard";
import { scan } from "@/lib/services/permissiveness";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireSession(req);
  if (auth instanceof NextResponse) return auth;

  const perm = requirePermission(auth.operator, "config:read");
  if (perm) return perm;

  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get("refresh") === "true";

  try {
    const report = await scan({ refresh });
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "no-store",
        "X-Permissiveness-Cache": report.meta.cached ? "hit" : "miss",
        "X-Permissiveness-Scan-Ms": String(report.meta.scanDurationMs),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "scan failed";
    console.error("[/api/permissiveness] scan failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
