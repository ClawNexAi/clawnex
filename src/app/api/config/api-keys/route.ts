/**
 * API Key Management — Configuration Panel
 * GET    /api/config/api-keys — list all API keys
 * POST   /api/config/api-keys — create a new key
 * DELETE /api/config/api-keys?id=xxx — revoke a key
 *
 * Internal route (no auth required — accessed from the dashboard).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import {
  generateApiKey,
  listApiKeys,
  revokeApiKey,
} from '@/lib/services/api-key-service';
import { logEvent } from '@/lib/services/audit-logger';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Valid scope strings for API keys. */
const VALID_SCOPES = [
  'shield:scan',
  'shield:read',
  'agents:read',
  'alerts:read',
  'audit:read',
  'fleet:read',
  'chat:completions',
  // v0.9.1-alpha — authenticated read of /api/health/detailed. Grant to
  // external monitoring probes (DataDog, Prometheus, Uptime Robot paid
  // tiers) that need the operational payload (OpenClaw connection state,
  // break-glass reason, watcher stats) the public /api/health omits.
  'health:read',
];

/**
 * GET — List all API keys (without hashes).
 */
export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'api_keys:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const keys = listApiKeys();
    return NextResponse.json({
      keys,
      total: keys.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/config/api-keys] GET Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * POST — Create a new API key.
 * Body: { name: string, scopes: string[], rateLimit?: number }
 * Returns the plaintext key once — it is never stored.
 */
export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'api_keys:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { name, scopes, rateLimit } = body as {
      name?: string;
      scopes?: string[];
      rateLimit?: number;
    };

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid 'name' field" },
        { status: 400 },
      );
    }

    if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid 'scopes' field. Must be a non-empty array." },
        { status: 400 },
      );
    }

    // Validate scopes
    const invalidScopes = scopes.filter(s => !VALID_SCOPES.includes(s));
    if (invalidScopes.length > 0) {
      return NextResponse.json(
        { error: `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${VALID_SCOPES.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate rate limit
    const limit = rateLimit ?? 60;
    if (typeof limit !== 'number' || limit < 1 || limit > 10000) {
      return NextResponse.json(
        { error: 'rateLimit must be a number between 1 and 10000' },
        { status: 400 },
      );
    }

    const result = generateApiKey(name.trim(), scopes, limit);

    logEvent(
      'operator',
      'api_key_created',
      'api_key',
      result.id,
      `Created API key "${name}" with scopes: ${scopes.join(', ')}`,
      'dashboard',
    );

    return NextResponse.json(
      {
        key: result.key,
        id: result.id,
        name: result.name,
        keyPrefix: result.keyPrefix,
        scopes: result.scopes,
        rateLimit: result.rateLimit,
        createdAt: result.createdAt,
        message: 'Store this key securely. It will not be shown again.',
        timestamp: new Date().toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[API/config/api-keys] POST Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE — Revoke an API key.
 * Query: ?id=xxx
 */
export async function DELETE(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'api_keys:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: "Missing 'id' query parameter" },
        { status: 400 },
      );
    }

    const result = revokeApiKey(id);

    if (!result.success) {
      return NextResponse.json(
        { error: 'API key not found or already revoked' },
        { status: 404 },
      );
    }

    logEvent(
      'operator',
      'api_key_revoked',
      'api_key',
      id,
      `Revoked API key ${id}`,
      'dashboard',
    );

    return NextResponse.json({
      success: true,
      id,
      message: 'API key revoked successfully.',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/config/api-keys] DELETE Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
