/**
 * ClawNex Settings API
 * GET /api/settings
 *
 * Returns current configuration (URLs only, no tokens), rule counts, DB stats.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { config } from "@/lib/config";
import { queryOne } from "@/lib/db/index";
import { ALL_RULES, secretRules, commandRules, sensitivePathRules, c2Rules, cognitiveFileRules, trustExploitRules, jailbreakRules, steganographyRules, encodingRules, financialRules } from "@/lib/shield/rules";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

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

  try {
    // Configuration (URLs only, no tokens/secrets)
    const connections = {
      openclaw: { url: config.openclaw.url, type: "websocket" },
      paperclip: { url: config.paperclip.url, type: "http" },
      autensa: { url: config.autensa.url, type: "http" },
      claw3d: { url: config.claw3d.url, type: "http" },
      lmstudioFleet: { url: config.lmstudio.fleet.url, name: config.lmstudio.fleet.name, type: "http" },
      lmstudioMain: { url: config.lmstudio.main.url, name: config.lmstudio.main.name, type: "http" },
    };

    // Shield rule counts by category
    const shieldRules = {
      total: ALL_RULES.length,
      categories: {
        secrets: secretRules.length,
        commands: commandRules.length,
        sensitivePaths: sensitivePathRules.length,
        c2Patterns: c2Rules.length,
        cognitiveFile: cognitiveFileRules.length,
        trustExploitation: trustExploitRules.length,
        jailbreaks: jailbreakRules.length,
        steganography: steganographyRules.length,
        encoding: encodingRules.length,
        financial: financialRules.length,
      },
    };

    // Database stats -- row counts per table
    const tables = [
      "metric_snapshots",
      "security_scans",
      "security_check_results",
      "alerts",
      "incidents",
      "shield_scans",
      "correlation_events",
      "audit_log",
      "maintenance_items",
      "access_lists",
    ];

    const dbStats: Record<string, number> = {};
    for (const table of tables) {
      try {
        const result = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ${table}`);
        dbStats[table] = result?.cnt ?? 0;
      } catch {
        dbStats[table] = -1; // table might not exist
      }
    }

    const totalRows = Object.values(dbStats).filter((v) => v >= 0).reduce((sum, v) => sum + v, 0);

    // Config values
    const configValues = {
      port: config.port,

      clawkeeperScanInterval: `${config.clawkeeper.scanIntervalMs / 1000}s`,
    };

    return NextResponse.json({
      connections,
      shieldRules,
      database: {
        tables: dbStats,
        totalRows,
        tableCount: tables.length,
      },
      config: configValues,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Settings API] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve settings" },
      { status: 500 },
    );
  }
}
