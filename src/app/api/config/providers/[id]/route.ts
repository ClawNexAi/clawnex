/**
 * PATCH /api/config/providers/[id] — update a provider
 * DELETE /api/config/providers/[id] — remove a provider
 *
 * Database removal and YAML synchronization are reported separately.
 * The operator must reload LiteLLM to retire its previously loaded routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as configService from '@/lib/services/config-service';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { syncProvidersToYaml } from '@/lib/litellm/sync';
import { getDb } from '@/lib/db/index';
import { logEvent } from '@/lib/services/audit-logger';
import { resolveLiteLLMConfigPath } from '@/lib/litellm/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Best-effort YAML resync after a provider mutation. Identical
 * semantics to the helper in ../route.ts (POST handler) — duplicated
 * here intentionally to avoid pulling a tiny shared module into
 * scope on a launch-blocking patch. Never throws.
 */
function syncLiteLLMConfig(label: string): boolean {
  try {
    const configPath = resolveLiteLLMConfigPath();
    syncProvidersToYaml({ db: getDb(), configPath });
    // 2026-05-09 update per operator directive: NO automatic systemctl restart.
    // Sync only — operator clicks Restart manually in Infrastructure tab.
    return true;
  } catch {
    console.error(`[Provider ${label}] sync failed (non-fatal to database removal).`);
    return false;
  }
}

function authorize(request: NextRequest): string | NextResponse {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
    return auth.operator.username;
  }

  const guard = requireLocalhost(request);
  return guard || 'localhost';
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorize(request);
    if (actor instanceof NextResponse) return actor;

    const { id } = await params;
    const provider = configService.getProvider(id);
    const result = configService.removeProvider(id);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // Remove the YAML entry; this does not revoke the running proxy's loaded key.
    const configSynced = syncLiteLLMConfig('Remove');
    logEvent(
      actor,
      'provider_deleted',
      'provider',
      id,
      `Deleted provider "${provider?.name || id}"${provider?.type ? ` (${provider.type})` : ''}`,
      'dashboard',
    );
    if (!configSynced) {
      return NextResponse.json({ success: false, removed: true, configSynced: false,
        error: 'Provider removed from ClawNex, but configuration sync failed. The proxy may still have the old routes and credentials. Resolve the sync failure, reload LiteLLM and verify removal.',
      }, { status: 503 });
    }
    return NextResponse.json({ success: true, removed: true, configSynced: true });
  } catch (err) {
    console.error('[Config API] Error removing provider:', err);
    return NextResponse.json({ error: 'Failed to remove provider' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorize(request);
    if (actor instanceof NextResponse) return actor;

    const { id } = await params;
    const existing = configService.getProvider(id);
    if (!existing) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });

    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const allowed = ['name', 'baseUrl', 'apiKey'] as const;
    const supplied = allowed.filter(field => input[field] !== undefined);
    if (!supplied.length) {
      return NextResponse.json({ error: 'Provide at least one field: name, baseUrl, apiKey' }, { status: 400 });
    }
    if (supplied.some(field => typeof input[field] !== 'string')) {
      return NextResponse.json({ error: 'Provider fields must be strings' }, { status: 400 });
    }
    if (input.name !== undefined && !(input.name as string).trim()) {
      return NextResponse.json({ error: 'Provider name cannot be empty' }, { status: 400 });
    }
    if (input.baseUrl !== undefined && !(input.baseUrl as string).trim()) {
      return NextResponse.json({ error: 'Provider base URL cannot be empty' }, { status: 400 });
    }

    const provider = await configService.updateProvider(id, {
      ...(input.name !== undefined ? { name: (input.name as string).trim() } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: (input.baseUrl as string).trim() } : {}),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey as string } : {}),
    });
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });

    const configSynced = syncLiteLLMConfig('Update');
    logEvent(actor, 'provider_updated', 'provider', id,
      `Updated provider "${provider.name}" fields: ${supplied.join(', ')}`, 'dashboard');
    if (!configSynced) {
      return NextResponse.json({
        provider: configService.redactProvider(provider), updated: true, configSynced: false,
        error: 'Provider updated in ClawNex, but configuration sync failed. Resolve the sync failure, reload LiteLLM and verify readiness.',
      }, { status: 503 });
    }
    return NextResponse.json({ provider: configService.redactProvider(provider), updated: true, configSynced: true });
  } catch (err) {
    console.error('[Config API] Error updating provider:', err);
    if (err instanceof configService.ProviderEndpointValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update provider' }, { status: 500 });
  }
}
