/**
 * Shield Whitelist API
 * GET  /api/shield/whitelist — returns current whitelist + all available rules
 * PUT  /api/shield/whitelist — update the whitelist (expects { rules: string[] })
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getSetting, setSetting } from "@/lib/services/config-service";
import { ALL_RULES } from "@/lib/shield/rules";
import { INTERNAL_TRAFFIC_WHITELIST } from "@/lib/shield/scanner";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic';

const SETTING_KEY = "shield_whitelist";

function getWhitelist(): string[] {
  const raw = getSetting(SETTING_KEY);
  if (!raw) return [...INTERNAL_TRAFFIC_WHITELIST];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...INTERNAL_TRAFFIC_WHITELIST];
  } catch {
    return [...INTERNAL_TRAFFIC_WHITELIST];
  }
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'shield:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const whitelist = getWhitelist();

    const availableRules = ALL_RULES.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      severity: r.severity,
      whitelisted: whitelist.includes(r.id),
    }));

    return NextResponse.json({ whitelist, rules: availableRules });
  } catch (err) {
    console.error("[Shield Whitelist] GET error:", err);
    return NextResponse.json({ error: "Failed to get whitelist" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'shield:config');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { rules } = body as { rules?: string[] };

    if (!Array.isArray(rules)) {
      return NextResponse.json({ error: "Expected { rules: string[] }" }, { status: 400 });
    }

    // Validate that all rule IDs exist
    const validIds = new Set(ALL_RULES.map((r) => r.id));
    const invalid = rules.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Unknown rule IDs: ${invalid.join(", ")}` }, { status: 400 });
    }

    setSetting(SETTING_KEY, JSON.stringify(rules));

    logEvent("operator", "shield_whitelist_updated", "shield", SETTING_KEY, `${rules.length} rules whitelisted`, "dashboard");

    return NextResponse.json({ ok: true, whitelist: rules });
  } catch (err) {
    console.error("[Shield Whitelist] PUT error:", err);
    return NextResponse.json({ error: "Failed to update whitelist" }, { status: 500 });
  }
}
