/**
 * Model Configuration API
 * GET    /api/config/models — list all configured models
 * POST   /api/config/models — add a model and auto-sync LiteLLM
 * DELETE /api/config/models — remove a model and auto-sync LiteLLM
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import * as configService from '@/lib/services/config-service';
import { logEvent } from '@/lib/services/audit-logger';
import { syncProvidersToYaml } from '@/lib/litellm/sync';
import { getDb } from '@/lib/db/index';
import * as path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sync the LiteLLM config.yaml from the latest DB state.
 *
 * Was: `fetch('/api/system/litellm', { method: 'POST', body: { action: 'restart' } })`
 * Two problems with that shape:
 *   1. Under RBAC, the internal POST went through CSRF middleware but only the
 *      session cookie was forwarded — no x-csrf-token. The middleware rejected
 *      it and the sync silently never happened.
 *   2. The call was fire-and-forget (no await on the fetch promise; the catch
 *      block just logged). Both failure modes — CSRF reject AND a real sync
 *      error — looked identical to the UI: "syncing: true" with nothing
 *      actually syncing.
 *
 * Fix: call syncProvidersToYaml directly (same pattern providers/route.ts
 * already uses). Synchronous. Returns whether the sync succeeded so the
 * caller can tell the UI honestly. No automatic systemctl restart — that
 * was operator-removed 2026-05-09 because rapid sequential saves were churning
 * the unit; operator clicks Restart manually in Infrastructure tab.
 */
function syncLiteLLMConfig(label: string): boolean {
  try {
    const installDir = process.cwd();
    const configPath = path.join(installDir, 'litellm', 'config.yaml');
    syncProvidersToYaml({ db: getDb(), configPath });
    return true;
  } catch (e) {
    console.error(`[Config/Models ${label}] sync failed (non-fatal):`, e instanceof Error ? e.message : String(e));
    return false;
  }
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
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId') || undefined;
    const models = configService.listModels(providerId);
    return NextResponse.json({ models });
  } catch (err) {
    console.error('[Config API] Error listing models:', err);
    return NextResponse.json({ error: 'Failed to list models' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const { provider_id, model_id, name } = body as { provider_id: string; model_id: string; name?: string };

    if (!provider_id || !model_id) {
      return NextResponse.json({ error: 'provider_id and model_id are required' }, { status: 400 });
    }

    configService.addModel(provider_id, model_id, name);

    const operator = getOperatorFromRequest(request);
    logEvent(
      operator?.username || 'admin', 'model_added', 'config', model_id,
      `Model ${model_id} added to provider ${provider_id}`, 'dashboard',
    );

    // Sync the LiteLLM YAML so the new model lands on the next restart.
    // Best-effort — the DB row is the source of truth; if the sync fails
    // we tell the UI so the operator can investigate (was previously hidden).
    const synced = syncLiteLLMConfig('add');

    return NextResponse.json({ ok: true, synced });
  } catch (err) {
    console.error('[Config API] Error adding model:', err);
    return NextResponse.json({ error: 'Failed to add model' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
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
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');
    const modelId = searchParams.get('modelId');

    if (!providerId || !modelId) {
      return NextResponse.json({ error: 'providerId and modelId are required' }, { status: 400 });
    }

    configService.removeModel(providerId, modelId);

    const operator = getOperatorFromRequest(request);
    logEvent(
      operator?.username || 'admin', 'model_removed', 'config', modelId,
      `Model ${modelId} removed from provider ${providerId}`, 'dashboard',
    );

    // Sync the LiteLLM YAML so the removal lands on the next restart.
    const synced = syncLiteLLMConfig('delete');

    return NextResponse.json({ ok: true, synced });
  } catch (err) {
    console.error('[Config API] Error removing model:', err);
    return NextResponse.json({ error: 'Failed to remove model' }, { status: 500 });
  }
}
