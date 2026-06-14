/**
 * Host Security Scanner Compatibility API
 * POST /api/system/install-clawkeeper
 *
 * The endpoint name is kept for existing wizard/UI callers. It no longer
 * downloads Clawkeeper from the network; host security scanning is bundled
 * with ClawNex under third_party/clawkeeper/.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { findHostSecurityScanner } from "@/lib/services/host-security/scanner-path";
import { run } from "@/lib/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'system:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const scanner = findHostSecurityScanner();

    // Audit log
    try {
      run(
        `INSERT INTO audit_log (id, actor, action, resource, detail, created_at) VALUES (?, 'operator', 'clawkeeper_install', 'system', ?, datetime('now'))`,
        [require("crypto").randomUUID(), scanner ? `ClawNex host security scanner available at ${scanner.path}` : "Host security scanner unavailable"]
      );
    } catch {}

    if (scanner) {
      return NextResponse.json({
        ok: true,
        status: scanner.source === "bundled"
          ? "builtin_available"
          : scanner.source === "env"
            ? "configured_available"
            : "legacy_available",
        path: scanner.path,
        message: "Host security scanner is built into ClawNex; no network install is required.",
      });
    } else {
      return NextResponse.json({ ok: false, error: "Bundled host security scanner not found" }, { status: 500 });
    }
  } catch (err) {
    console.error("[Host Security Scanner] Error:", err);
    return NextResponse.json({ error: "Scanner availability check failed" }, { status: 500 });
  }
}
