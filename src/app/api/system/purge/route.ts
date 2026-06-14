/**
 * Purge DB API
 * POST /api/system/purge — wipes operational data, keeps configuration
 * Body: { confirm: "PURGE" }
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { run, queryOne } from "@/lib/db/index";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'system:purge');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    if (body.confirm !== "PURGE") {
      return NextResponse.json({ error: "Confirmation required. Send { confirm: \"PURGE\" }" }, { status: 400 });
    }

    // Audit log BEFORE purge. Capture the row's id so the audit_log DELETE
    // below can preserve it — without this, the pre-purge "initiated" entry
    // got wiped by its own DELETE FROM audit_log and only the post-purge
    // "complete" row survived (CRIT #20). The forensic trail needs both
    // entries: who started, when, with what counts.
    const operator = getOperatorFromRequest(request);
    const actor = operator?.username || 'operator';
    const prePurgeAuditId = require("crypto").randomUUID();
    try {
      run(
        `INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at) VALUES (?, ?, 'db_purge', 'system', NULL, 'Full operational data purge initiated', 'dashboard', datetime('now'))`,
        [prePurgeAuditId, actor]
      );
    } catch {}

    // Count before purge — each table may not exist on fresh install
    const safeCount = (table: string): number => {
      try { return queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ${table}`)?.cnt || 0; } catch { return 0; }
    };
    const trafficCount = safeCount("proxy_traffic");
    const alertCount = safeCount("alerts");
    const auditCount = safeCount("audit_log");
    const shieldCount = safeCount("shield_scans");
    const metricCount = safeCount("metric_snapshots");
    const corrCount = safeCount("correlation_events");

    // Purge operational tables — keep config tables intact. audit_log is
    // special-cased to preserve the pre-purge "initiated" row by id; every
    // other row in audit_log is wiped along with proxy_traffic / alerts /
    // shield_scans / etc. Wrap each DELETE individually so one missing
    // table doesn't stop others.
    try { run(`DELETE FROM proxy_traffic`); } catch { /* table may not exist yet */ }
    try { run(`DELETE FROM alerts`); } catch { /* table may not exist yet */ }
    try { run(`DELETE FROM audit_log WHERE id != ?`, [prePurgeAuditId]); } catch { /* table may not exist yet */ }
    try { run(`DELETE FROM shield_scans`); } catch { /* table may not exist yet */ }
    try { run(`DELETE FROM metric_snapshots`); } catch { /* table may not exist yet */ }
    try { run(`DELETE FROM correlation_events`); } catch { /* table may not exist yet */ }
    try { run(`DELETE FROM cve_records`); } catch { /* table may not exist yet */ }

    // VACUUM to reclaim space
    try { run("VACUUM"); } catch {}

    // Post-purge audit entry
    try {
      run(
        `INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at) VALUES (?, ?, 'db_purge_complete', 'system', NULL, ?, 'dashboard', datetime('now'))`,
        [require("crypto").randomUUID(), actor, `Purged: ${trafficCount} traffic, ${alertCount} alerts, ${auditCount} audit, ${shieldCount} scans, ${metricCount} metrics, ${corrCount} correlations`]
      );
    } catch {}

    return NextResponse.json({
      ok: true,
      purged: { traffic: trafficCount, alerts: alertCount, audit: auditCount, shieldScans: shieldCount, metrics: metricCount, correlations: corrCount },
      preserved: ["config_defaults", "config_providers", "config_models", "config_gateways", "access_lists"],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Purge] Error:", err);
    return NextResponse.json({ error: "Purge failed" }, { status: 500 });
  }
}
