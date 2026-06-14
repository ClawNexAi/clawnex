/**
 * Public API — Agents
 * GET /api/v1/agents
 *
 * Scope: "agents:read"
 * Delegates to the internal /api/agents logic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authenticateRequest } from '@/lib/middleware/api-auth';
import { ensureConnected } from '@/lib/connectors/openclaw-connector';
import { isAgentIgnored } from '@/lib/services/agent-ignore';
import { normalizeOpenClawModel } from '@/lib/openclaw-paths';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RegistryAgent {
  name: string;
  codename: string;
  emoji: string;
  role: string;
  model: string;
  agentId: string;
  soul_path: string;
  notes: string;
}

interface ConfigAgent {
  id: string;
  name?: string;
  model?: string;
  workspace?: string;
  identity?: { name?: string; emoji?: string };
  tools?: { allow?: string[]; alsoAllow?: string[]; deny?: string[] };
}

function readLocalAgents(): Array<{
  id: string;
  name: string;
  status: string;
  model: string;
  role?: string;
  emoji?: string;
  codename?: string;
  tools?: string[];
  notes?: string;
}> {
  const registryPath = join(homedir(), '.openclaw', 'workspace', 'agents-registry.json');
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');

  let registry: RegistryAgent[] = [];
  let configAgents: ConfigAgent[] = [];

  try {
    const raw = readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw);
    registry = parsed.agents || [];
  } catch { /* not available */ }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    configAgents = (parsed.agents?.list || []) as ConfigAgent[];
  } catch { /* not available */ }

  const agents: Array<{
    id: string;
    name: string;
    status: string;
    model: string;
    role?: string;
    emoji?: string;
    codename?: string;
    tools?: string[];
    notes?: string;
  }> = [];

  for (const reg of registry) {
    const configEntry = configAgents.find(c => c.id === reg.agentId);
    const tools: string[] = [];
    if (configEntry?.tools?.allow) tools.push(...configEntry.tools.allow);
    if (configEntry?.tools?.alsoAllow) tools.push(...configEntry.tools.alsoAllow);

    agents.push({
      id: reg.agentId,
      name: reg.name,
      status: 'configured',
      model: normalizeOpenClawModel(configEntry?.model ?? reg.model, 'default'),
      role: reg.role,
      emoji: reg.emoji,
      codename: reg.codename,
      tools: tools.length > 0 ? tools : undefined,
      notes: reg.notes,
    });
  }

  for (const cfg of configAgents) {
    if (cfg.id === 'main') continue;
    if (registry.some(r => r.agentId === cfg.id)) continue;

    agents.push({
      id: cfg.id,
      name: cfg.name || cfg.identity?.name || cfg.id,
      status: 'configured',
      model: normalizeOpenClawModel(cfg.model, 'default'),
      emoji: cfg.identity?.emoji,
      tools: cfg.tools?.allow as string[] | undefined,
    });
  }

  return agents;
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();

  // Authenticate
  const auth = authenticateRequest(request, 'agents:read');
  if (!auth.authenticated) {
    const res = NextResponse.json(
      { ok: false, error: auth.error, meta: { requestId, timestamp } },
      { status: auth.status || 401 },
    );
    if (auth.rateLimit) {
      res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
      res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
      res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
    }
    return res;
  }

  try {
    const connector = await ensureConnected();

    if (connector.isConnected()) {
      const agents = await connector.listAgents();
      const visible = agents.filter((a: { name?: string }) => !isAgentIgnored(a.name));
      if (visible.length > 0) {
        const res = NextResponse.json({
          ok: true,
          data: { agents: visible, total: visible.length, source: 'openclaw' },
          meta: { requestId, timestamp },
        });
        if (auth.rateLimit) {
          res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
          res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
          res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
        }
        return res;
      }
    }

    const localAgents = readLocalAgents().filter(a => !isAgentIgnored(a.name));
    const res = NextResponse.json({
      ok: true,
      data: {
        agents: localAgents,
        total: localAgents.length,
        source: localAgents.length > 0 ? 'local-filesystem' : 'offline',
      },
      meta: { requestId, timestamp },
    });
    if (auth.rateLimit) {
      res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
      res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
      res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
    }
    return res;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error', meta: { requestId, timestamp } },
      { status: 502 },
    );
  }
}
