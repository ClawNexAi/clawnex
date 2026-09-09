/**
 * GET /api/config/providers — list all providers with their models
 * POST /api/config/providers — add new provider
 *
 * Provider creation persists the database row and then syncs LiteLLM YAML.
 * A failed sync returns an explicit partial failure; the saved row remains.
 * Restart stays manual. Config synced does not mean loaded or inference-ready.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import * as configService from '@/lib/services/config-service';
import { syncProvidersToYaml } from '@/lib/litellm/sync';
import { getDb } from '@/lib/db/index';
import { providerRiskLabels } from '@/lib/services/provider-risk-labels';
import { logEvent } from '@/lib/services/audit-logger';
import { resolveLiteLLMConfigPath } from '@/lib/litellm/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rewrite YAML without restarting services. Return failure separately from
 * the already-completed database save so callers cannot claim full success.
 */
function syncLiteLLMConfig(label: string): boolean {
  try {
    const configPath = resolveLiteLLMConfigPath();
    syncProvidersToYaml({ db: getDb(), configPath });
    // 2026-05-09 update per operator directive: NO automatic systemctl restart
    // here. Rapid sequential provider/model saves were triggering per-save
    // restart cycles that left systemctl in `activating` / NRestarts climb.
    // Operator now clicks Restart manually in Infrastructure tab once
    // they're done adding providers. The config.yaml IS still synced on
    // every save so the manual Restart picks up the latest state.
    return true;
  } catch {
    // Do not echo arbitrary filesystem/configuration errors or credentials.
    console.error(`[Provider ${label}] sync failed (non-fatal to the database save).`);
    return false;
  }
}

function authorize(request: NextRequest, permission: 'config:read' | 'config:write'): string | NextResponse {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, permission);
    if (perm) return perm;
    return auth.operator.username;
  }

  const guard = requireLocalhost(request);
  return guard || 'localhost';
}

export async function GET(request: NextRequest) {
  const actor = authorize(request, 'config:read');
  if (actor instanceof NextResponse) return actor;

  const __t0 = Date.now();
  try {
    const providers = configService.listProviders().map(p => {
      const redacted = configService.redactProvider(p);
      return {
        ...redacted,
        risk_labels: providerRiskLabels(p),
        models: redacted.models?.map((model) => ({ ...model })),
      };
    });
    console.log(`[api/config/providers:GET] ${Date.now() - __t0}ms count=${providers.length}`);
    return NextResponse.json({ providers });
  } catch (err) {
    console.error(`[api/config/providers:GET] failed after ${Date.now() - __t0}ms:`, err);
    return NextResponse.json({ error: 'Failed to list providers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const actor = authorize(request, 'config:write');
  if (actor instanceof NextResponse) return actor;

  try {
    const body = await request.json();
    const { name, type, baseUrl, apiKey, id } = body as {
      name?: string;
      type?: string;
      baseUrl?: string;
      apiKey?: string;
      id?: string;
    };

    if (!name || !type || !baseUrl) {
      return NextResponse.json({ error: 'Missing required fields: name, type, baseUrl' }, { status: 400 });
    }

    if (id && configService.getProvider(id)) {
      return NextResponse.json({ error: 'Provider already exists' }, { status: 409 });
    }

    const provider = await configService.addProvider({ id, name, type, baseUrl, apiKey });
    // Persisting the provider and syncing YAML are distinct outcomes.
    const configSynced = syncLiteLLMConfig('Save');
    // Redact api_key in the response — GET already redacts; POST was the
    // last place a plaintext key could leak back to the browser or network
    // logs. The DB row + LiteLLM YAML keep the real value.
    logEvent(
      actor,
      'provider_created',
      'provider',
      provider.id,
      `Created provider "${provider.name}" (${provider.type})`,
      'dashboard',
    );
    if (!configSynced) {
      return NextResponse.json({
        provider: configService.redactProvider(provider), saved: true, configSynced: false,
        error: 'Provider saved, but LiteLLM configuration sync failed. Do not add it again or wire agents yet. Resolve the configuration conflict or filesystem error, then resync and verify readiness.',
      }, { status: 503 });
    }
    return NextResponse.json({ provider: configService.redactProvider(provider), saved: true, configSynced: true }, { status: 201 });
  } catch (err) {
    console.error('[Config API] Error adding provider:', err);
    if (err instanceof configService.ProviderEndpointValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to add provider' }, { status: 500 });
  }
}
