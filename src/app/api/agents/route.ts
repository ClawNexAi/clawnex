/**
 * Agents API — returns real agent data from OpenClaw Gateway or local filesystem.
 * GET /api/agents
 *
 * Priority:
 * 1. OpenClaw Gateway RPC (agents.list)
 * 2. Local filesystem fallback (agents-registry.json + openclaw.json)
 * Gracefully degrades to empty array if all sources are unavailable.
 */

import { NextResponse, NextRequest } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { ensureConnected } from '@/lib/connectors/openclaw-connector';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOpenClawPaths, normalizeOpenClawModel } from '@/lib/openclaw-paths';
import { isAgentIgnored } from '@/lib/services/agent-ignore';
import { getAgentRole } from '@/lib/services/agent-roles';
import { getHermesDb, isHermesAvailable } from '@/lib/services/hermes-db';

// OpenClaw 4.12+'s openclaw.json schema rejects `role` as a field on
// `agents.list[]`, so the gateway never returns one. Enrich each agent
// record from ClawNex's known-roles map so the dashboard can display a
// description in agent cards. If the gateway ever sends a role string
// (future schema bump), prefer that over the local fallback.
function enrichAgentRoles<T extends { id?: string; role?: unknown }>(agents: T[]): T[] {
  return agents.map((a) => {
    if (typeof a.role === 'string' && a.role.trim() !== '') return a;
    if (typeof a.id === 'string') {
      const role = getAgentRole(a.id);
      if (role) return { ...a, role };
    }
    return a;
  });
}
import { config } from '@/lib/config';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

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

interface LocalAgent {
  id: string;
  name: string;
  status: string;
  model: string;
  role?: string;
  emoji?: string;
  codename?: string;
  tools?: string[];
  notes?: string;
  source?: string;
}

function readLocalAgents(): LocalAgent[] {
  const { home: ocHome, configPath } = resolveOpenClawPaths();
  if (!ocHome) return [];

  const agents: LocalAgent[] = [];

  // 1. Scan filesystem for agent directories (~/.openclaw/agents/*/)
  try {
    const agentsDir = join(ocHome, 'agents');
    if (existsSync(agentsDir)) {
      const entries = readdirSync(agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const agentId = entry.name;
        const agentPath = join(agentsDir, agentId);
        const cfgPath = join(agentPath, 'config.json');
        let cfg: {
          name?: string;
          model?: string;
          role?: string;
          identity?: { name?: string; emoji?: string };
          tools?: { allow?: string[]; alsoAllow?: string[] };
        } = {};
        if (existsSync(cfgPath)) {
          try {
            cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
          } catch { /* ignore */ }
        }
        const tools: string[] = [];
        if (cfg.tools?.allow) tools.push(...cfg.tools.allow);
        if (cfg.tools?.alsoAllow) tools.push(...cfg.tools.alsoAllow);
        agents.push({
          id: agentId,
          name: cfg.name || cfg.identity?.name || agentId,
          status: 'discovered',
          model: normalizeOpenClawModel(cfg.model, 'unknown'),
          role: cfg.role || '',
          emoji: cfg.identity?.emoji,
          tools: tools.length > 0 ? tools : undefined,
          source: 'filesystem',
        });
      }
    }
  } catch {
    console.warn('[API/agents] Could not scan agents directory');
  }

  // 2. Merge in agents-registry.json if it exists
  try {
    const registryPath = join(ocHome, 'workspace', 'agents-registry.json');
    if (existsSync(registryPath)) {
      const parsed = JSON.parse(readFileSync(registryPath, 'utf-8'));
      const registry: RegistryAgent[] = Array.isArray(parsed.agents) ? parsed.agents : [];
      for (const reg of registry) {
        const existing = agents.find(a => a.id === reg.agentId);
        if (existing) {
          existing.name = reg.name || existing.name;
          existing.role = reg.role || existing.role;
          existing.emoji = reg.emoji || existing.emoji;
          existing.codename = reg.codename || existing.codename;
          existing.notes = reg.notes || existing.notes;
          if (reg.model && existing.model === 'unknown') existing.model = normalizeOpenClawModel(reg.model, 'unknown');
        } else {
          agents.push({
            id: reg.agentId,
            name: reg.name || reg.agentId,
            status: 'registered',
            model: normalizeOpenClawModel(reg.model, 'unknown'),
            role: reg.role,
            emoji: reg.emoji,
            codename: reg.codename,
            notes: reg.notes,
            source: 'registry',
          });
        }
      }
    }
  } catch {
    console.warn('[API/agents] Could not read agents-registry.json');
  }

  // 3. Merge in openclaw.json agents.list metadata (tools, model overrides)
  if (configPath) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
      const configAgents: ConfigAgent[] = (parsed.agents?.list || []) as ConfigAgent[];
      for (const cfg of configAgents) {
        const existing = agents.find(a => a.id === cfg.id);
        const tools: string[] = [];
        if (cfg.tools?.allow) tools.push(...cfg.tools.allow);
        if (cfg.tools?.alsoAllow) tools.push(...cfg.tools.alsoAllow);
        if (existing) {
          if (cfg.model) existing.model = normalizeOpenClawModel(cfg.model, existing.model);
          if (cfg.name || cfg.identity?.name) existing.name = cfg.name || cfg.identity?.name || existing.name;
          if (cfg.identity?.emoji) existing.emoji = cfg.identity.emoji;
          if (tools.length > 0) existing.tools = tools;
        } else {
          agents.push({
            id: cfg.id,
            name: cfg.name || cfg.identity?.name || cfg.id,
            status: 'configured',
            model: normalizeOpenClawModel(cfg.model, 'default'),
            emoji: cfg.identity?.emoji,
            tools: tools.length > 0 ? tools : undefined,
            source: 'config',
          });
        }
      }
    } catch {
      console.warn('[API/agents] Could not read openclaw.json');
    }
  }

  return agents;
}

function getHermesAgents(): LocalAgent[] {
  if (!config.hermes.enabled || !isHermesAvailable()) return [];
  const db = getHermesDb();
  if (!db) return [];

  try {
    const now = Date.now() / 1000;
    const rows = db.prepare(
      `SELECT source, model, COUNT(*) as session_count, MAX(started_at) as last_active
       FROM sessions
       WHERE started_at > ?
       GROUP BY source`
    ).all(now - 86400) as Array<{ source: string; model: string | null; session_count: number; last_active: number }>;

    return rows.map(row => ({
      id: `hermes:${row.source}`,
      name: `Hermes ${row.source}`,
      status: 'active',
      model: row.model || 'unknown',
      role: 'hermes-agent',
      emoji: '\u{1fab6}',
      source: 'hermes',
    }));
  } catch {
    console.warn('[API/agents] Could not read Hermes agents');
    return [];
  }
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

  const instance = request.nextUrl?.searchParams?.get('instance') || null;
  const hermesAgents = getHermesAgents();

  // If filtering to Hermes instance only, return Hermes agents directly
  if (instance === 'hermes-local') {
    return NextResponse.json({
      agents: hermesAgents,
      total: hermesAgents.length,
      source: 'hermes',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const connector = await ensureConnected();

    if (connector.isConnected()) {
      const agents = await connector.listAgents();
      const visible = enrichAgentRoles(agents.filter((a: { name?: string }) => !isAgentIgnored(a.name)));
      if (visible.length > 0) {
        // If filtering to openclaw-local, return only OpenClaw agents
        if (instance === 'openclaw-local') {
          return NextResponse.json({
            agents: visible,
            total: visible.length,
            source: 'openclaw',
            timestamp: new Date().toISOString(),
          });
        }
        // No instance filter — merge OpenClaw + Hermes agents
        const merged = [...visible, ...hermesAgents];
        return NextResponse.json({
          agents: merged,
          total: merged.length,
          source: 'openclaw',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Fallback: read from local filesystem
    const localAgents = enrichAgentRoles(readLocalAgents().filter(a => !isAgentIgnored(a.name)));
    if (localAgents.length > 0) {
      if (instance === 'openclaw-local') {
        return NextResponse.json({
          agents: localAgents,
          total: localAgents.length,
          source: 'local-filesystem',
          timestamp: new Date().toISOString(),
        });
      }
      const merged = [...localAgents, ...hermesAgents];
      return NextResponse.json({
        agents: merged,
        total: merged.length,
        source: 'local-filesystem',
        timestamp: new Date().toISOString(),
      });
    }

    // No OpenClaw agents found — still return Hermes if available
    if (hermesAgents.length > 0 && !instance) {
      return NextResponse.json({
        agents: hermesAgents,
        total: hermesAgents.length,
        source: 'hermes',
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      agents: [],
      total: 0,
      source: connector.isConnected() ? 'openclaw-empty' : 'offline',
      message: 'No agent data available from gateway or local files',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/agents] Error:', err);

    // Last resort fallback
    try {
      const localAgents = enrichAgentRoles(readLocalAgents().filter(a => !isAgentIgnored(a.name)));
      const fallbackAgents = instance === 'openclaw-local' ? localAgents : [...localAgents, ...hermesAgents];
      if (fallbackAgents.length > 0) {
        return NextResponse.json({
          agents: fallbackAgents,
          total: fallbackAgents.length,
          source: 'local-filesystem-fallback',
          timestamp: new Date().toISOString(),
        });
      }
    } catch { /* ignore */ }

    return NextResponse.json(
      {
        agents: [],
        total: 0,
        source: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 502 },
    );
  }
}
