/**
 * GET /api/config/defaults — get all default settings
 * PUT /api/config/defaults — set a single default { key, value }
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import * as configService from '@/lib/services/config-service';
import { logEvent } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pattern-based secret detection — any key containing these substrings
// is treated as a secret and masked in GET responses + audit logs.
// More resilient than a hardcoded allowlist: new secret-bearing keys
// are automatically caught without code changes.
const SECRET_PATTERNS = [
  "_key", "_token", "_secret", "_password", "_credential",
  "api_key", "apikey", "bearer", "auth_token",
];

// P0-C 2026-05-14: keys that must NOT be writable through this generic
// endpoint. Each one has a dedicated route that enforces value
// validation, audit semantics, or both — bypassing through here would
// let a config:write operator set e.g. retention_audit_days=1, which
// the canonical /api/config/retention rejects via its OPTIONS allow-
// list. the reviewer's DAST showed this exact bypass against the live build.
//
// PROTECTED_PREFIXES catches every key starting with that string.
// PROTECTED_EXACT matches the full key.
const PROTECTED_PREFIXES = ["retention_"];
const PROTECTED_EXACT = new Set(["break_glass", "proxy_block_mode"]);

function isProtectedKey(key: string): { protected: boolean; canonical?: string } {
  if (PROTECTED_EXACT.has(key)) {
    if (key === "break_glass") return { protected: true, canonical: "/api/break-glass/activate or /api/break-glass/deactivate" };
    if (key === "proxy_block_mode") return { protected: true, canonical: "/api/proxy/block-mode" };
  }
  for (const prefix of PROTECTED_PREFIXES) {
    if (key.startsWith(prefix)) return { protected: true, canonical: "/api/config/retention" };
  }
  return { protected: false };
}

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_PATTERNS.some(p => lower.includes(p));
}

function maskValue(key: string, value: string): string {
  if (!isSecretKey(key)) return value;
  if (!value || value.length <= 8) return value ? "****" : "";
  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 8, 16))}${value.slice(-4)}`;
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
    const settings = configService.getAllSettings();
    const defaults: Record<string, string> = {};
    for (const s of settings) {
      defaults[s.key] = maskValue(s.key, s.value);
    }

    // Also include the resolved default model info
    const defaultModel = configService.getDefaultModel();

    return NextResponse.json({
      settings: defaults,
      defaultModel: defaultModel ? {
        providerId: defaultModel.provider.id,
        providerName: defaultModel.provider.name,
        modelId: defaultModel.model.model_id,
        modelName: defaultModel.model.name,
      } : null,
    });
  } catch (err) {
    console.error('[Config API] Error getting defaults:', err);
    return NextResponse.json({ error: 'Failed to get defaults' }, { status: 500 });
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
    const { key, value } = body as { key?: string; value?: string };

    if (!key || typeof key !== 'string' || value === undefined) {
      return NextResponse.json({ error: 'Expected { key: string, value: string }' }, { status: 400 });
    }

    // P0-C: reject keys that have dedicated, validated endpoints. Allowing
    // them through here bypasses value-range and audit-semantics checks.
    const protection = isProtectedKey(key);
    if (protection.protected) {
      return NextResponse.json(
        {
          error: `Setting "${key}" is protected and cannot be changed through this endpoint.`,
          hint: `Use the dedicated route: ${protection.canonical}`,
        },
        { status: 400 },
      );
    }

    configService.setSetting(key, String(value));
    // Audit log — mask secret values so they don't appear in plaintext in the audit trail
    const auditValue = isSecretKey(key) ? maskValue(key, String(value)) : String(value);
    const operator = getOperatorFromRequest(request);
    const actor = operator?.username || 'operator';
    logEvent(actor, 'config_default_changed', 'config', key, `${key} = ${auditValue}`, 'dashboard');

    // Response — never echo secret values back to the caller
    return NextResponse.json({ ok: true, key, value: isSecretKey(key) ? maskValue(key, String(value)) : String(value) });
  } catch (err) {
    console.error('[Config API] Error setting default:', err);
    return NextResponse.json({ error: 'Failed to set default' }, { status: 500 });
  }
}
