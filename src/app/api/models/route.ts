/**
 * Models API — returns merged model data from OpenClaw Gateway + LM Studio.
 * GET /api/models
 *
 * Merges models from both sources. Gracefully degrades if either is offline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { ensureConnected } from '@/lib/connectors/openclaw-connector';
import { getLMStudioInventory } from '@/lib/connectors/lmstudio-connector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UnifiedModel {
  id: string;
  name: string;
  provider: string;
  source: 'openclaw' | 'lmstudio-fleet' | 'lmstudio-main';
  routing: 'Cloud' | 'Local';
  contextWindow?: number;
  reasoning?: boolean;
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'dashboard:view');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const models: UnifiedModel[] = [];
  const sources: { id: string; name: string; status: string; count: number }[] = [];

  // Fetch OpenClaw models
  try {
    const connector = await ensureConnected();
    if (connector.isConnected()) {
      const ocModels = await connector.listModels();
      for (const m of ocModels) {
        models.push({
          id: m.id,
          name: m.name || m.id,
          provider: m.provider || 'unknown',
          source: 'openclaw',
          routing: 'Cloud',
          contextWindow: m.contextWindow,
          reasoning: m.reasoning,
        });
      }
      sources.push({ id: 'openclaw-gateway', name: 'OpenClaw Gateway', status: 'online', count: ocModels.length });
    } else {
      sources.push({ id: 'openclaw-gateway', name: 'OpenClaw Gateway', status: 'offline', count: 0 });
    }
  } catch (err) {
    console.error('[API/models] OpenClaw error:', err);
    sources.push({ id: 'openclaw-gateway', name: 'OpenClaw Gateway', status: 'error', count: 0 });
  }

  // Fetch LM Studio models
  try {
    const inventory = await getLMStudioInventory();

    if (inventory.fleet.status === 'online') {
      for (const m of inventory.fleet.models) {
        models.push({
          id: m.id,
          name: m.id,
          provider: 'LM Studio Fleet',
          source: 'lmstudio-fleet',
          routing: 'Local',
        });
      }
    }
    sources.push({
      id: 'lmstudio-fleet',
      name: inventory.fleet.name || 'LM Studio Fleet',
      status: inventory.fleet.status,
      count: inventory.fleet.modelCount,
    });

    if (inventory.main.status === 'online') {
      for (const m of inventory.main.models) {
        models.push({
          id: m.id,
          name: m.id,
          provider: 'LM Studio Main',
          source: 'lmstudio-main',
          routing: 'Local',
        });
      }
    }
    sources.push({
      id: 'lmstudio-main',
      name: inventory.main.name || 'LM Studio Main',
      status: inventory.main.status,
      count: inventory.main.modelCount,
    });
  } catch (err) {
    console.error('[API/models] LM Studio error:', err);
    sources.push({ id: 'lmstudio-inventory', name: 'LM Studio inventory', status: 'error', count: 0 });
  }

  return NextResponse.json({
    models,
    total: models.length,
    sources,
    timestamp: new Date().toISOString(),
  });
}
