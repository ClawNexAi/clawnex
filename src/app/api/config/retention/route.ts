/**
 * Data Retention Configuration API
 * GET  /api/config/retention — returns current retention settings
 * PUT  /api/config/retention — update retention settings
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { setSetting } from "@/lib/services/config-service";
import { getRetentionSettings } from "@/lib/db/retention";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KEYS = [
  "retention_traffic_days",
  "retention_metrics_days",
  "retention_correlations_days",
  "retention_alerts_days",
  "retention_audit_days",
];

const LABELS: Record<string, string> = {
  retention_traffic_days: "Traffic Logs (proxy_traffic, shield_scans)",
  retention_metrics_days: "System Metrics (metric_snapshots)",
  retention_correlations_days: "Correlations (correlation_events)",
  retention_alerts_days: "Alerts & Incidents (alerts, incidents)",
  retention_audit_days: "Audit Trail (audit_log)",
};

const OPTIONS: Record<string, number[]> = {
  retention_traffic_days: [1, 3, 7, 14, 30, 90],
  retention_metrics_days: [1, 3, 7, 14, 30, 90],
  retention_correlations_days: [1, 3, 7, 14, 30, 90],
  retention_alerts_days: [30, 90, 180, 365],
  retention_audit_days: [90, 180, 365, 0], // 0 = unlimited
};

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
    const settings = getRetentionSettings();

    const categories = VALID_KEYS.map((key) => ({
      key,
      label: LABELS[key],
      value: settings[key],
      options: OPTIONS[key],
    }));

    return NextResponse.json({ categories });
  } catch (err) {
    console.error("[Retention Config] GET error:", err);
    return NextResponse.json({ error: "Failed to get retention settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { settings } = body as { settings?: Record<string, number> };

    if (!settings || typeof settings !== "object") {
      return NextResponse.json({ error: "Expected { settings: { key: days, ... } }" }, { status: 400 });
    }

    const changes: string[] = [];

    for (const [key, value] of Object.entries(settings)) {
      if (!VALID_KEYS.includes(key)) {
        return NextResponse.json({ error: `Unknown setting: ${key}` }, { status: 400 });
      }

      const validOptions = OPTIONS[key];
      if (!validOptions.includes(value)) {
        return NextResponse.json(
          { error: `Invalid value for ${key}: ${value}. Valid options: ${validOptions.join(", ")}` },
          { status: 400 }
        );
      }

      setSetting(key, String(value));
      changes.push(`${LABELS[key]}: ${value === 0 ? "unlimited" : `${value} days`}`);
    }

    logEvent(
      "operator",
      "retention_settings_updated",
      "config",
      "retention",
      changes.join("; "),
      "dashboard"
    );

    return NextResponse.json({ ok: true, settings: getRetentionSettings() });
  } catch (err) {
    console.error("[Retention Config] PUT error:", err);
    return NextResponse.json({ error: "Failed to update retention settings" }, { status: 500 });
  }
}
