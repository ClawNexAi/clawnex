/**
 * Tools & Access API
 * GET /api/tools — returns real tool permissions from OpenClaw configuration
 *
 * Reads ~/.openclaw/openclaw.json for global tool settings and per-agent tool permissions.
 * Also reads ~/.openclaw/workspace/agents-registry.json for agent metadata.
 * READ-ONLY access to OpenClaw files.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isAgentIgnored } from '@/lib/services/agent-ignore';
import { normalizeOpenClawModel } from '@/lib/openclaw-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AgentToolInfo {
  agentId: string;
  agentName: string;
  model: string;
  tools: string[];
  emoji?: string;
  role?: string;
}

interface ToolSummary {
  name: string;
  type: string;
  risk: string;
  agents: number;
  agentNames: string[];
  status: string;
}

function classifyToolRisk(tool: string): { type: string; risk: string } {
  const toolTypes: Record<string, { type: string; risk: string }> = {
    'bash': { type: 'shell', risk: 'HIGH' },
    'read': { type: 'filesystem', risk: 'LOW' },
    'write': { type: 'filesystem', risk: 'MEDIUM' },
    'edit': { type: 'filesystem', risk: 'MEDIUM' },
    'message': { type: 'communication', risk: 'LOW' },
    'web_search': { type: 'network', risk: 'MEDIUM' },
    'web_fetch': { type: 'network', risk: 'MEDIUM' },
    'bmad-method': { type: 'framework', risk: 'LOW' },
    'group:runtime': { type: 'runtime', risk: 'HIGH' },
    'group:fs': { type: 'filesystem', risk: 'HIGH' },
    'group:web': { type: 'network', risk: 'MEDIUM' },
  };
  return toolTypes[tool] || { type: 'unknown', risk: 'MEDIUM' };
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'agents:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const openclawPath = join(homedir(), '.openclaw', 'openclaw.json');
    const registryPath = join(homedir(), '.openclaw', 'workspace', 'agents-registry.json');

    let openclawConfig: Record<string, unknown> = {};
    let agentRegistry: Array<{ name: string; codename: string; emoji: string; role: string; model: string; agentId: string }> = [];

    // Read openclaw.json
    try {
      const raw = readFileSync(openclawPath, 'utf-8');
      openclawConfig = JSON.parse(raw);
    } catch {
      console.warn('[API/tools] Could not read openclaw.json');
    }

    // Read agents-registry.json
    try {
      const raw = readFileSync(registryPath, 'utf-8');
      const parsed = JSON.parse(raw);
      agentRegistry = parsed.agents || [];
    } catch {
      console.warn('[API/tools] Could not read agents-registry.json');
    }

    // Extract global tools config
    const toolsConfig = (openclawConfig.tools || {}) as Record<string, unknown>;
    const agentsConfig = (openclawConfig.agents || {}) as Record<string, unknown>;
    const agentsList = ((agentsConfig.list || []) as Array<Record<string, unknown>>);

    // Build per-agent tool info
    const agentTools: AgentToolInfo[] = [];
    for (const agent of agentsList) {
      const id = agent.id as string;
      if (!id || id === 'main') continue; // Skip main user agent

      const name = (agent.name as string) || id;
      // Newer OpenClaw configs use { primary: "id", fallback: [...] } — normalize to string.
      const model = normalizeOpenClawModel(agent.model, 'default');
      const identity = agent.identity as Record<string, unknown> | undefined;
      const toolsDef = agent.tools as Record<string, unknown> | undefined;

      let tools: string[] = [];
      if (toolsDef?.allow && Array.isArray(toolsDef.allow)) {
        tools = toolsDef.allow as string[];
      }
      if (toolsDef?.alsoAllow && Array.isArray(toolsDef.alsoAllow)) {
        tools = [...tools, ...(toolsDef.alsoAllow as string[])];
      }

      // Look up registry info
      const regEntry = agentRegistry.find(r => r.agentId === id);

      agentTools.push({
        agentId: id,
        agentName: regEntry?.name || name,
        model,
        tools,
        emoji: regEntry?.emoji || (identity?.emoji as string) || undefined,
        role: regEntry?.role || undefined,
      });
    }

    // Filter out ignored agents (internal OpenClaw processes)
    const visibleAgents = agentTools.filter(a => !isAgentIgnored(a.agentName));

    // Build tool inventory (aggregate across visible agents)
    const toolMap = new Map<string, ToolSummary>();
    for (const agent of visibleAgents) {
      for (const tool of agent.tools) {
        const existing = toolMap.get(tool);
        const { type, risk } = classifyToolRisk(tool);
        if (existing) {
          existing.agents++;
          existing.agentNames.push(agent.agentName);
        } else {
          toolMap.set(tool, {
            name: tool,
            type,
            risk,
            agents: 1,
            agentNames: [agent.agentName],
            status: 'active',
          });
        }
      }
    }

    // Check for denied tools (with agent context, filtered by ignore list)
    const deniedToolsList: Array<{ tool: string; agentName: string; agentId: string }> = [];
    const deniedToolsUnique: string[] = [];
    for (const agent of agentsList) {
      const id = agent.id as string;
      const name = (agent.name as string) || id;
      if (!id || id === 'main') continue;
      if (isAgentIgnored(name)) continue;

      const regEntry = agentRegistry.find(r => r.agentId === id);
      const displayName = regEntry?.name || name;

      const toolsDef = agent.tools as Record<string, unknown> | undefined;
      if (toolsDef?.deny && Array.isArray(toolsDef.deny)) {
        for (const t of toolsDef.deny as string[]) {
          deniedToolsList.push({ tool: t, agentName: displayName, agentId: id });
          if (!deniedToolsUnique.includes(t)) deniedToolsUnique.push(t);
        }
      }
    }

    const toolInventory = Array.from(toolMap.values()).sort((a, b) => b.agents - a.agents);

    return NextResponse.json({
      globalConfig: {
        profile: toolsConfig.profile || 'unknown',
        webSearchEnabled: !!(toolsConfig.web as Record<string, unknown>)?.search,
        webFetchEnabled: !!(toolsConfig.web as Record<string, unknown>)?.fetch,
        agentToAgentEnabled: !!(toolsConfig.agentToAgent as Record<string, unknown>)?.enabled,
      },
      toolInventory,
      agentTools: visibleAgents,
      deniedTools: deniedToolsUnique,
      deniedToolsDetail: deniedToolsList,
      totalTools: toolInventory.length,
      totalAgents: visibleAgents.length,
      source: 'openclaw-config',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/tools] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
