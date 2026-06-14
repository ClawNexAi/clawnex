/**
 * DELETE /api/config/providers/[id] — remove a provider
 *
 * 2026-05-09: After a successful delete the LiteLLM YAML is re-synced
 * so the removed provider's API key disappears from config.yaml on the
 * same beat the DB row is dropped. Without this, a deleted provider's
 * key stayed live in the proxy until the operator manually hit
 * Restart — internal reviewer flagged this as the same root cause as the missed
 * save trigger. Best-effort by design.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as configService from '@/lib/services/config-service';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { syncProvidersToYaml } from '@/lib/litellm/sync';
import { getDb } from '@/lib/db/index';
import * as path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Best-effort YAML resync after a provider mutation. Identical
 * semantics to the helper in ../route.ts (POST handler) — duplicated
 * here intentionally to avoid pulling a tiny shared module into
 * scope on a launch-blocking patch. Never throws.
 */
function syncLiteLLMConfig(label: string): void {
  try {
    const installDir = process.cwd();
    const configPath = path.join(installDir, 'litellm', 'config.yaml');
    syncProvidersToYaml({ db: getDb(), configPath });
    // 2026-05-09 update per operator directive: NO automatic systemctl restart.
    // Sync only — operator clicks Restart manually in Infrastructure tab.
  } catch (e) {
    console.error(`[Provider ${label}] sync failed (non-fatal):`, e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (isRbacEnabled()) {
      const auth = requireSession(request);
      if (auth instanceof NextResponse) return auth;
      const perm = requirePermission(auth.operator, 'config:write');
      if (perm) return perm;
    } else {
      const guard = requireLocalhost(request);
      if (guard) return guard;
    }

    const { id } = await params;
    const result = configService.removeProvider(id);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // After a successful removal, drop the provider's entry from YAML
    // so its API key is no longer live in the proxy.
    syncLiteLLMConfig('Remove');
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Config API] Error removing provider:', err);
    return NextResponse.json({ error: 'Failed to remove provider' }, { status: 500 });
  }
}
