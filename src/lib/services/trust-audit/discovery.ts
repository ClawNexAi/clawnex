/**
 * Trust Audit — Discovery Layer
 *
 * Reads config/runtime state and normalizes into canonical audit entities.
 * This is the data gathering phase — no rules, no scoring.
 */

import { queryAll, queryOne } from '../../db/index';
import { isRbacEnabled } from '../../rbac/guard';
import { getSetting } from '../config-service';
import { ALL_RULES } from '../../shield/rules';
import type { Surface, Agent, Capability, SensitiveAssetHint, AuditContext, ConfigChange } from './types';
import * as fs from 'fs';
import * as path from 'path';

// ── Surface Discovery ──

export function discoverSurfaces(): Surface[] {
  const surfaces: Surface[] = [];
  const rbac = isRbacEnabled();

  // LiteLLM proxy
  surfaces.push({
    id: 'litellm-proxy',
    kind: 'litellm-proxy',
    name: 'LiteLLM Proxy (Shield Scanner)',
    policy: rbac ? 'rbac' : 'localhost',
    publicExposure: false,
    notes: 'All routed traffic passes through this surface',
  });

  // Dashboard
  surfaces.push({
    id: 'dashboard',
    kind: 'dashboard',
    name: 'ClawNex Dashboard',
    policy: rbac ? 'rbac' : 'open',
    publicExposure: !rbac, // open to any local network user when RBAC off
    notes: rbac ? '5 roles, 32 permissions' : 'No authentication — localhost only',
  });

  // Public API (v1)
  surfaces.push({
    id: 'api-v1',
    kind: 'api-v1',
    name: 'Public API (/api/v1/*)',
    policy: 'api-key',
    publicExposure: true,
    notes: 'API key authentication with scoped permissions',
  });

  // MCP Server
  const mcpPort = getSetting('mcp_port');
  if (mcpPort) {
    surfaces.push({
      id: 'mcp-http',
      kind: 'mcp-http',
      name: `MCP HTTP Transport (port ${mcpPort})`,
      policy: 'open', // CORS-restricted but no auth
      publicExposure: false,
      notes: 'CORS restricted to localhost but no authentication — any local process can invoke MCP tools',
    });
  }

  // Session Watcher
  surfaces.push({
    id: 'session-watcher',
    kind: 'session-watcher',
    name: 'Session Watcher (retroactive)',
    policy: 'localhost',
    publicExposure: false,
    notes: 'Read-only filesystem watcher — no inbound surface but provides retroactive visibility',
  });

  return surfaces;
}

// ── Agent Discovery ──

export function discoverAgents(): Agent[] {
  const agents: Agent[] = [];

  // Query configured providers to determine routing
  const providers = queryAll<{
    id: string;
    name: string;
    type: string;
    base_url: string;
  }>("SELECT id, name, type, base_url FROM config_providers");

  // Get agents from traffic data (using session_id as proxy for agent identity)
  const trafficSessions = queryAll<{
    session_id: string;
    model: string;
    source: string;
  }>(
    "SELECT session_id, model, source FROM proxy_traffic WHERE session_id IS NOT NULL AND session_id != '' GROUP BY session_id ORDER BY timestamp DESC LIMIT 50"
  );

  for (const t of trafficSessions) {
    if (!t.session_id) continue;
    const tools = discoverAgentTools(t.session_id);

    // NOTE on `sandboxed`: we currently have no live hook into an agent
    // framework's sandbox state. `null` means "unknown" — not "false". UI
    // layers render this as an explicit UNKNOWN indicator rather than
    // silently flipping it to "unsandboxed" which could be either a false
    // positive (scary) or false negative (unsafe) depending on reality.
    agents.push({
      id: t.session_id,
      name: t.session_id,
      source: (t.source === 'watcher' ? 'hermes' : 'openclaw') as Agent['source'],
      model: t.model || 'unknown',
      fallbackModels: [],
      routingMode: t.source === 'proxy' ? 'routed' : 'direct',
      tools,
      sandboxed: null,
      // Agents discovered via proxy_traffic rows have been observed in live
      // runtime — the strongest evidence level we can assign.
      confidence: 'verified_runtime',
    });
  }

  // Also check Hermes instances
  const hermesInstances = queryAll<{ id: string; name: string }>(
    "SELECT id, name FROM hermes_instances WHERE is_active = 1"
  );

  for (const h of hermesInstances) {
    if (!agents.find(a => a.id === h.id)) {
      agents.push({
        id: h.id,
        name: h.name,
        source: 'hermes',
        model: 'unknown',
        fallbackModels: [],
        routingMode: 'direct', // Hermes typically uses direct provider access
        tools: [],
        sandboxed: null,
        // Hermes instances come from persisted config — verified at config
        // level, but we haven't necessarily seen runtime traffic for them.
        confidence: 'verified_config',
      });
    }
  }

  return agents;
}

function discoverAgentTools(agentId: string): string[] {
  const tools: string[] = [];

  // Check workspace for TOOLS.md
  const workspacePaths = [
    path.join(process.cwd(), 'workspaces', agentId, 'TOOLS.md'),
    path.join(process.cwd(), `workspace-${agentId}`, 'TOOLS.md'),
  ];

  for (const p of workspacePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        // Extract tool names from markdown
        const matches = content.match(/^[-*]\s+`?(\w+)`?/gm);
        if (matches) {
          tools.push(...matches.map(m => m.replace(/^[-*]\s+`?/, '').replace(/`?$/, '')));
        }
      }
    } catch {
      // Workspace not accessible
    }
  }

  // Skills inventory not available in proxy_traffic schema — tools come from workspace files only

  return Array.from(new Set(tools)); // deduplicate
}

// ── Capability Classification ──

const CAPABILITY_MAP: Record<string, Omit<Capability, 'id'>> = {
  'exec': { class: 'runtime', name: 'Command Execution', riskWeight: 10, destructive: true, externalReach: true },
  'process': { class: 'runtime', name: 'Process Management', riskWeight: 9, destructive: true, externalReach: true },
  'write': { class: 'filesystem', name: 'File Write', riskWeight: 8, destructive: true, externalReach: false },
  'edit': { class: 'filesystem', name: 'File Edit', riskWeight: 7, destructive: true, externalReach: false },
  'read': { class: 'filesystem', name: 'File Read', riskWeight: 3, destructive: false, externalReach: false },
  'apply_patch': { class: 'filesystem', name: 'Apply Patch', riskWeight: 8, destructive: true, externalReach: false },
  'browser': { class: 'browser', name: 'Browser Automation', riskWeight: 8, destructive: false, externalReach: true },
  'web_fetch': { class: 'web', name: 'Web Fetch', riskWeight: 5, destructive: false, externalReach: true },
  'web_search': { class: 'web', name: 'Web Search', riskWeight: 3, destructive: false, externalReach: true },
  'send_message': { class: 'messaging', name: 'Send Message', riskWeight: 7, destructive: false, externalReach: true },
  'config_write': { class: 'config', name: 'Configuration Mutation', riskWeight: 9, destructive: true, externalReach: false },
  'restart': { class: 'config', name: 'Service Restart', riskWeight: 9, destructive: true, externalReach: false },
  'cron': { class: 'orchestration', name: 'Cron/Job Creation', riskWeight: 8, destructive: true, externalReach: false },
  'spawn_session': { class: 'orchestration', name: 'Session Spawning', riskWeight: 7, destructive: false, externalReach: false },
};

export function classifyCapabilities(tools: string[]): Capability[] {
  const capabilities: Capability[] = [];

  for (const tool of tools) {
    const toolLower = tool.toLowerCase();

    for (const [key, cap] of Object.entries(CAPABILITY_MAP)) {
      if (toolLower.includes(key)) {
        // Tool-name parsing is a pattern match against a static CAPABILITY_MAP.
        // Until we have a live tool registry hook we can't verify the agent
        // actually holds this capability at runtime — flag as inferred.
        capabilities.push({ id: `cap-${key}-${tool}`, ...cap, confidence: 'heuristic_inference' });
      }
    }

    // Catch-all for unclassified tools
    if (!Object.keys(CAPABILITY_MAP).some(k => toolLower.includes(k))) {
      capabilities.push({
        id: `cap-unknown-${tool}`,
        class: 'plugin',
        name: tool,
        riskWeight: 5,
        destructive: false,
        externalReach: false,
        confidence: 'heuristic_inference',
      });
    }
  }

  return capabilities;
}

// ── Sensitive Asset Discovery ──

export function discoverSensitiveAssets(): SensitiveAssetHint[] {
  const assets: SensitiveAssetHint[] = [];

  // Database file — we read the path from config, but we don't fs.stat it here,
  // so we can only claim config-level verification.
  const dbPath = getSetting('database_path') || './clawnex.db';
  assets.push({
    id: 'asset-db',
    kind: 'database',
    location: dbPath,
    confidence: 100,
    notes: 'SQLite database with all operational data, operator credentials, sessions',
    evidenceLevel: 'verified_config',
  });

  // .env file — existence confirmed by fs.existsSync; this is a live filesystem check.
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    assets.push({
      id: 'asset-env',
      kind: 'credential',
      location: '.env.local',
      confidence: 100,
      notes: 'Environment variables — may contain API keys, secrets',
      evidenceLevel: 'verified_filesystem',
    });
  }

  // LiteLLM config — existence confirmed by fs.existsSync.
  const litellmConfig = path.join(process.cwd(), 'litellm', 'config.yaml');
  if (fs.existsSync(litellmConfig)) {
    assets.push({
      id: 'asset-litellm-config',
      kind: 'api-key',
      location: 'litellm/config.yaml',
      confidence: 95,
      notes: 'LiteLLM configuration — contains provider API keys in cleartext (architecturally required)',
      evidenceLevel: 'verified_filesystem',
    });
  }

  // Provider API keys — direct SELECT against config_providers is live config.
  const providerCount = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM config_providers WHERE api_key IS NOT NULL AND api_key != ''"
  );
  if (providerCount && providerCount.count > 0) {
    assets.push({
      id: 'asset-provider-keys',
      kind: 'api-key',
      location: 'config_providers table',
      confidence: 100,
      notes: `${providerCount.count} provider API keys stored in database`,
      evidenceLevel: 'verified_config',
    });
  }

  return assets;
}

// ── Recent Config Changes ──

export function discoverRecentChanges(hours: number = 72): ConfigChange[] {
  const changes = queryAll<{
    action: string;
    actor: string;
    created_at: string;
    detail: string;
  }>(
    `SELECT action, actor, created_at, detail FROM audit_log
     WHERE created_at >= datetime('now', '-${hours} hours')
     ORDER BY created_at DESC
     LIMIT 100`
  );

  return changes.map(c => ({
    action: c.action,
    actor: c.actor || 'unknown',
    timestamp: c.created_at,
    detail: c.detail || '',
  }));
}

// ── Build Full Audit Context ──

export function buildAuditContext(): AuditContext {
  const surfaces = discoverSurfaces();
  const agents = discoverAgents();

  // Collect all tools across all agents
  const allTools = Array.from(new Set(agents.flatMap(a => a.tools)));
  const capabilities = classifyCapabilities(allTools);
  const sensitiveAssets = discoverSensitiveAssets();
  const recentChanges = discoverRecentChanges();

  // Config state
  const shieldMode = (getSetting('proxy_block_mode') || 'observe') as 'block' | 'observe' | 'off';
  // Break-glass status from config_defaults (stored as key-value)
  const breakGlassActive = getSetting('break_glass_active') === 'true';
  const breakGlassReason = getSetting('break_glass_reason') || undefined;
  const breakGlassExpiry = getSetting('break_glass_expires_at') || undefined;

  const providers = queryAll<{ base_url: string }>("SELECT base_url FROM config_providers");
  const routedCount = providers.filter(p =>
    p.base_url?.includes('localhost') || p.base_url?.includes('127.0.0.1')
  ).length;

  return {
    surfaces,
    agents,
    capabilities,
    sensitiveAssets,
    recentChanges,
    config: {
      rbacEnabled: isRbacEnabled(),
      shieldMode,
      breakGlassActive: breakGlassActive,
      breakGlassReason: breakGlassReason,
      breakGlassExpiry: breakGlassExpiry,
      sessionBindIp: getSetting('session_bind_ip') === 'true',
      providerCount: providers.length,
      routedProviderCount: routedCount,
      directProviderCount: providers.length - routedCount,
      // v0.11.6+ — derived from ALL_RULES.length at module load to prevent
      // doc/source drift (internal reviewer audit 2026-05-05). Trust Audit operators see
      // the live count, not a hardcoded number that goes stale.
      totalShieldRules: ALL_RULES.length,
    },
  };
}
