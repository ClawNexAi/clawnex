/**
 * CVE Records API
 * GET /api/cve — returns stored CVE records with optional severity filter
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { queryAll, queryOne } from "@/lib/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const { searchParams } = new URL(request.url);
  const severity = searchParams.get("severity");
  const limit = parseInt(searchParams.get("limit") || "100");

  try {
    let cves;
    if (severity) {
      cves = queryAll<Record<string, unknown>>(
        "SELECT * FROM cve_records WHERE severity = ? ORDER BY date_published DESC LIMIT ?",
        [severity.toUpperCase(), limit]
      );
    } else {
      cves = queryAll<Record<string, unknown>>(
        "SELECT * FROM cve_records ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, date_published DESC LIMIT ?",
        [limit]
      );
    }

    // Get sync status
    const lastSync = queryOne<{ synced_at: string }>(
      "SELECT MAX(synced_at) as synced_at FROM cve_records"
    );
    const totalCount = queryOne<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM cve_records"
    );
    const critCount = queryOne<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM cve_records WHERE severity = 'CRITICAL'"
    );
    const highCount = queryOne<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM cve_records WHERE severity = 'HIGH'"
    );

    // Check installed version against affected versions
    let installedVersion = "unknown";
    try {
      const fs = require("node:fs");
      const path = require("node:path");
      const os = require("node:os");
      const ocPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
      const ocConfig = JSON.parse(fs.readFileSync(ocPath, "utf-8"));
      installedVersion = ocConfig?.meta?.lastTouchedVersion || "unknown";
    } catch {}

    return NextResponse.json({
      cves,
      total: totalCount?.cnt || 0,
      critical: critCount?.cnt || 0,
      high: highCount?.cnt || 0,
      lastSync: lastSync?.synced_at || null,
      installedVersion,
    });
  } catch (err) {
    console.error("[CVE API] Error:", err);
    return NextResponse.json({ error: "Failed to fetch CVEs" }, { status: 500 });
  }
}
