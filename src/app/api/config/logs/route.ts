/**
 * Log Configuration API
 * GET  /api/config/logs — returns current log retention and rotation settings
 * PUT  /api/config/logs — update log retention and rotation settings
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getSetting, setSetting } from "@/lib/services/config-service";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Config keys and their defaults */
const LOG_CONFIG_KEYS: Record<string, { label: string; default: number; min: number; max: number }> = {
  retention_logs_days: {
    label: "Log retention period (days)",
    default: 14,
    min: 1,
    max: 365,
  },
  log_max_size_mb: {
    label: "Max log file size before rotation (MB)",
    default: 10,
    min: 1,
    max: 100,
  },
  log_max_rotated_files: {
    label: "Max number of rotated log files",
    default: 5,
    min: 1,
    max: 20,
  },
};

/**
 * Read a single config value, falling back to the defined default.
 */
function getLogConfigValue(key: string): number {
  const meta = LOG_CONFIG_KEYS[key];
  if (!meta) return 0;
  const raw = getSetting(key);
  if (raw !== undefined) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return meta.default;
}

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
    const settings: Record<string, { label: string; value: number; min: number; max: number }> = {};

    for (const [key, meta] of Object.entries(LOG_CONFIG_KEYS)) {
      settings[key] = {
        label: meta.label,
        value: getLogConfigValue(key),
        min: meta.min,
        max: meta.max,
      };
    }

    return NextResponse.json({ settings });
  } catch (err) {
    console.error("[Log Config] GET error:", err);
    return NextResponse.json({ error: "Failed to get log settings" }, { status: 500 });
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
    const { retention_days, max_size_mb, max_rotated_files } = body as {
      retention_days?: number;
      max_size_mb?: number;
      max_rotated_files?: number;
    };

    const changes: string[] = [];

    // Validate and apply each setting if provided
    if (retention_days !== undefined) {
      const meta = LOG_CONFIG_KEYS.retention_logs_days;
      if (typeof retention_days !== "number" || retention_days < meta.min || retention_days > meta.max) {
        return NextResponse.json(
          { error: `retention_days must be between ${meta.min} and ${meta.max}` },
          { status: 400 },
        );
      }
      setSetting("retention_logs_days", String(retention_days));
      changes.push(`retention: ${retention_days} days`);
    }

    if (max_size_mb !== undefined) {
      const meta = LOG_CONFIG_KEYS.log_max_size_mb;
      if (typeof max_size_mb !== "number" || max_size_mb < meta.min || max_size_mb > meta.max) {
        return NextResponse.json(
          { error: `max_size_mb must be between ${meta.min} and ${meta.max}` },
          { status: 400 },
        );
      }
      setSetting("log_max_size_mb", String(max_size_mb));
      changes.push(`max size: ${max_size_mb}MB`);
    }

    if (max_rotated_files !== undefined) {
      const meta = LOG_CONFIG_KEYS.log_max_rotated_files;
      if (typeof max_rotated_files !== "number" || max_rotated_files < meta.min || max_rotated_files > meta.max) {
        return NextResponse.json(
          { error: `max_rotated_files must be between ${meta.min} and ${meta.max}` },
          { status: 400 },
        );
      }
      setSetting("log_max_rotated_files", String(max_rotated_files));
      changes.push(`max rotated files: ${max_rotated_files}`);
    }

    if (changes.length === 0) {
      return NextResponse.json(
        { error: "No valid settings provided. Expected: retention_days, max_size_mb, max_rotated_files" },
        { status: 400 },
      );
    }

    // Audit trail
    logEvent(
      "operator",
      "log_settings_updated",
      "config",
      "logs",
      changes.join("; "),
      "dashboard",
    );

    // Return updated settings
    const updated: Record<string, number> = {};
    for (const key of Object.keys(LOG_CONFIG_KEYS)) {
      updated[key] = getLogConfigValue(key);
    }

    return NextResponse.json({ ok: true, settings: updated });
  } catch (err) {
    console.error("[Log Config] PUT error:", err);
    return NextResponse.json({ error: "Failed to update log settings" }, { status: 500 });
  }
}
