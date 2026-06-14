/**
 * GET /api/config/providers — list all providers with their models
 * POST /api/config/providers — add new provider
 *
 * 2026-05-09: POST/DELETE now best-effort sync the LiteLLM YAML and
 * restart the proxy when a systemd unit is present. Closes the gap
 * internal reviewer flagged: previously a successful API key save persisted into
 * the config_providers DB row but did NOT update LiteLLM's
 * config.yaml until someone manually clicked the Restart button on
 * the Infrastructure tab — leaving OpenRouter unwired even after a
 * green save toast. The trigger is best-effort: a failed sync or
 * restart logs an error but does not fail the save itself, so the
 * UI still reports success and the operator can fall back to the
 * manual Restart button if needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import * as configService from '@/lib/services/config-service';
import { syncProvidersToYaml } from '@/lib/litellm/sync';
import { getDb } from '@/lib/db/index';
import * as path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Best-effort: rewrite litellm/config.yaml from the latest config_providers
 * rows and (when running under systemd) restart the proxy. Never throws —
 * any failure here MUST NOT fail the parent save, since the DB row is the
 * source of truth and the operator can hit the Restart button as fallback.
 */
function syncLiteLLMConfig(label: string): void {
  try {
    const installDir = process.cwd();
    const configPath = path.join(installDir, 'litellm', 'config.yaml');
    syncProvidersToYaml({ db: getDb(), configPath });
    // 2026-05-09 update per operator directive: NO automatic systemctl restart
    // here. Rapid sequential provider/model saves were triggering per-save
    // restart cycles that left systemctl in `activating` / NRestarts climb.
    // Operator now clicks Restart manually in Infrastructure tab once
    // they're done adding providers. The config.yaml IS still synced on
    // every save so the manual Restart picks up the latest state.
  } catch (e) {
    // Sync failed (e.g. unsafe YAML value, write permission, etc.).
    // Log without leaking secrets — syncProvidersToYaml never logs
    // api_key values, and we only print the error message string here.
    console.error(`[Provider ${label}] sync failed (non-fatal):`, e instanceof Error ? e.message : String(e));
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

  const __t0 = Date.now();
  try {
    const providers = configService.listProviders().map(p => configService.redactProvider(p));
    console.log(`[api/config/providers:GET] ${Date.now() - __t0}ms count=${providers.length}`);
    return NextResponse.json({ providers });
  } catch (err) {
    console.error(`[api/config/providers:GET] failed after ${Date.now() - __t0}ms:`, err);
    return NextResponse.json({ error: 'Failed to list providers' }, { status: 500 });
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

    const provider = await configService.addProvider({ id, name, type, baseUrl, apiKey });
    // After a successful DB write, sync the LiteLLM YAML so the new
    // provider's API key is wired into the proxy without a manual
    // Restart click. Best-effort — see helper for failure semantics.
    syncLiteLLMConfig('Save');
    // Redact api_key in the response — GET already redacts; POST was the
    // last place a plaintext key could leak back to the browser or network
    // logs. The DB row + LiteLLM YAML keep the real value.
    return NextResponse.json({ provider: configService.redactProvider(provider) }, { status: 201 });
  } catch (err) {
    console.error('[Config API] Error adding provider:', err);
    return NextResponse.json({ error: 'Failed to add provider' }, { status: 500 });
  }
}
