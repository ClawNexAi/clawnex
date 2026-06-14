/**
 * Trust Audit — Rule Definitions
 *
 * 6 initial audit layers:
 * 1. Direct Path & Fallback Bypass
 * 2. Tool Freedom
 * 3. Model-to-Privilege Mismatch
 * 4. Dormant Risk
 * 5. Recovery-Path Permissiveness
 * 6. Prompt-to-Capability Mismatch
 */

import type { AuditRule, AuditContext, Finding, Severity } from './types';
import { queryAll } from '../../db/index';
import * as fs from 'fs';
import * as path from 'path';

let ruleCounter = 0;
function findingId(): string {
  return `TB-${++ruleCounter}`;
}

// ── Rule 1: Direct Path & Fallback Bypass ──

const directPathBypass: AuditRule = {
  id: 'direct-path-bypass',
  name: 'Direct Path & Fallback Bypass',
  description: 'Detects agents or providers making calls outside the LiteLLM proxy path, bypassing real-time shield scanning.',
  category: 'visibility',
  severityBase: 'high',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    // Check for direct (non-routed) providers
    if (ctx.config.directProviderCount > 0) {
      const directAgents = ctx.agents.filter(a => a.routingMode === 'direct' || a.routingMode === 'mixed');

      if (directAgents.length > 0) {
        findings.push({
          id: findingId(),
          ruleId: this.id,
          severity: 'high',
          title: `${directAgents.length} agent(s) bypass real-time shield scanning`,
          agentId: directAgents[0].id,
          capabilityPath: ['direct-provider-access'],
          containmentState: 'unknown',
          assetHints: [],
          whyItMatters: 'These agents communicate with models through providers that are not routed through the LiteLLM proxy. Their traffic is only visible retroactively through the Session Watcher — not scanned in real time.',
          blastRadius: `${directAgents.length} agent(s) have unscanned request paths. Prompt injection, data exfiltration, and jailbreak attempts on these paths will not be blocked — only detected after the fact.`,
          recommendedFix: 'Route these providers through LiteLLM by updating their base_url to point to the proxy. If routing is not possible (OAuth/subscription providers), ensure Session Watcher is actively monitoring their conversation files.',
          evidence: [
            `config_defaults reports ${ctx.config.directProviderCount} direct provider(s)`,
            ...directAgents.map(a => `Agent "${a.name}" (${a.source}) uses ${a.routingMode} routing via model ${a.model}`),
          ],
          // Derived from config_providers base_url + proxy_traffic routing mode — both directly queried.
          confidence: 'verified_config',
        });
      }
    }

    // Check if shield is in observe mode (not blocking)
    if (ctx.config.shieldMode === 'observe') {
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: 'medium',
        title: 'Shield is in observe mode — threats are logged but not blocked',
        capabilityPath: ['shield-mode'],
        containmentState: 'partial',
        assetHints: [],
        whyItMatters: 'Even routed traffic passes through the shield without enforcement. Detected threats generate alerts but the requests still reach the model.',
        blastRadius: 'All routed traffic is functionally unprotected. Shield detection provides visibility but no prevention.',
        recommendedFix: 'Switch to block mode once shield rules are tuned and tested. Use Shield Tests to validate detection coverage before switching.',
        evidence: [`config_defaults.proxy_block_mode = '${ctx.config.shieldMode}'`],
        // Read directly from config_defaults via getSetting — verified config.
        confidence: 'verified_config',
      });
    }

    return findings;
  },
};

// ── Rule 2: Tool Freedom ──

const toolFreedom: AuditRule = {
  id: 'tool-freedom',
  name: 'Tool Freedom Audit',
  description: 'Identifies agents with dangerous tool capabilities (exec, write, browser, config mutation) and correlates with their exposure level.',
  category: 'permission-to-impact',
  severityBase: 'high',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    const dangerousClasses = ['runtime', 'filesystem', 'browser', 'config', 'orchestration'];

    for (const agent of ctx.agents) {
      const agentCaps = ctx.capabilities.filter(c =>
        agent.tools.some(t => c.id.includes(t.toLowerCase()))
      );

      const dangerousCaps = agentCaps.filter(c => dangerousClasses.includes(c.class));

      if (dangerousCaps.length > 0) {
        const maxRisk = Math.max(...dangerousCaps.map(c => c.riskWeight));
        const severity: Severity = maxRisk >= 9 ? 'critical' : maxRisk >= 7 ? 'high' : 'medium';
        const sandboxKnown = agent.sandboxed === true;
        const containmentState: Finding['containmentState'] = agent.sandboxed === true
          ? 'sandboxed'
          : agent.sandboxed === false
            ? 'unsandboxed'
            : 'unknown';

        findings.push({
          id: findingId(),
          ruleId: this.id,
          severity,
          title: `Agent "${agent.name}" appears (based on TOOLS.md inference) to have ${dangerousCaps.length} dangerous capability(ies) — verify against actual tool registry`,
          agentId: agent.id,
          capabilityPath: dangerousCaps.map(c => `${c.class}:${c.name}`),
          containmentState,
          assetHints: [],
          whyItMatters: `This agent's declared tools suggest it can ${dangerousCaps.map(c => c.name.toLowerCase()).join(', ')}. If the declaration matches reality and the agent is compromised via prompt injection or jailbreak, these capabilities define the blast radius.`,
          blastRadius: dangerousCaps.some(c => c.destructive)
            ? 'Destructive actions possible — file modification, command execution, or configuration changes could affect the host system.'
            : 'Non-destructive but externally reachable — data could be exfiltrated or unauthorized actions taken.',
          recommendedFix: sandboxKnown
            ? 'Agent is reported as sandboxed. Verify sandbox boundaries cover all dangerous capabilities.'
            : 'Sandbox state is unknown. Verify via the agent framework and consider enabling sandbox mode or restricting tool access.',
          evidence: [
            `Agent source: ${agent.source}; tools parsed from TOOLS.md (heuristic)`,
            ...dangerousCaps.map(c => `Inferred capability: class=${c.class}, name=${c.name}, risk=${c.riskWeight}/10, destructive=${c.destructive}`),
          ],
          // Capabilities come from CAPABILITY_MAP keyword matches on tool names — pure heuristic.
          confidence: 'heuristic_inference',
        });
      }
    }

    return findings;
  },
};

// ── Rule 3: Model-to-Privilege Mismatch ──

const modelPrivilegeMismatch: AuditRule = {
  id: 'model-privilege-mismatch',
  name: 'Model-to-Privilege Mismatch',
  description: 'Detects agents where the model tier does not match the privilege level — small/cheap models with dangerous tool access.',
  category: 'trust-boundary',
  severityBase: 'high',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    // Models considered "small" or less capable for safety
    const smallModels = ['gpt-4o-mini', 'gpt-3.5-turbo', 'claude-3-haiku', 'gemini-flash', 'phi-', 'qwen-', 'mistral-7b', 'llama-7b', 'llama-8b'];

    for (const agent of ctx.agents) {
      const modelLower = agent.model.toLowerCase();
      const isSmallModel = smallModels.some(sm => modelLower.includes(sm));

      if (!isSmallModel) continue;

      // Check if this agent has dangerous tools
      const agentCaps = ctx.capabilities.filter(c =>
        agent.tools.some(t => c.id.includes(t.toLowerCase()))
      );
      const hasDangerousTools = agentCaps.some(c => c.riskWeight >= 7);

      if (hasDangerousTools) {
        const containmentState: Finding['containmentState'] = agent.sandboxed === true
          ? 'sandboxed'
          : agent.sandboxed === false
            ? 'unsandboxed'
            : 'unknown';

        findings.push({
          id: findingId(),
          ruleId: this.id,
          severity: 'high',
          title: `Small model "${agent.model}" paired with inferred dangerous tool access on agent "${agent.name}"`,
          agentId: agent.id,
          modelRef: agent.model,
          capabilityPath: agentCaps.filter(c => c.riskWeight >= 7).map(c => c.name),
          containmentState,
          assetHints: [],
          whyItMatters: 'Smaller models are generally less capable at refusing harmful instructions and more susceptible to prompt injection. Pairing a small model with dangerous tools (exec, write, browser) creates a high-risk combination.',
          blastRadius: `Agent "${agent.name}" using ${agent.model} appears able to ${agentCaps.filter(c => c.riskWeight >= 7).map(c => c.name.toLowerCase()).join(', ')}. A successful prompt injection against a weaker model is more likely to succeed.`,
          recommendedFix: 'Either upgrade the model to a more capable tier (e.g., GPT-4o, Claude Sonnet) or restrict the tool access for this agent. Do not pair cheap models with privileged tools.',
          evidence: [
            `Model observed in proxy_traffic: ${agent.model}`,
            `Inferred dangerous tools (heuristic): ${agentCaps.filter(c => c.riskWeight >= 7).map(c => c.name).join(', ')}`,
          ],
          // Model name comes from proxy_traffic (runtime), but the dangerous-tool call
          // relies on tool-name parsing. Weakest evidence wins.
          confidence: 'heuristic_inference',
        });
      }
    }

    return findings;
  },
};

// ── Rule 4: Dormant Risk ──

const dormantRisk: AuditRule = {
  id: 'dormant-risk',
  name: 'Dormant Risk Audit',
  description: 'Identifies installed but potentially unused providers, tools, or configurations that widen the attack surface without active benefit.',
  category: 'hygiene',
  severityBase: 'low',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    // Check for providers with no recent traffic
    const providers = queryAll<{ id: string; name: string; type: string }>(
      "SELECT id, name, type FROM config_providers"
    );

    for (const provider of providers) {
      const recentTraffic = queryAll<{ count: number }>(
        "SELECT COUNT(*) as count FROM proxy_traffic WHERE provider = ? AND timestamp >= datetime('now', '-7 days')",
        [provider.name || provider.type]
      );

      if (!recentTraffic[0] || recentTraffic[0].count === 0) {
        findings.push({
          id: findingId(),
          ruleId: this.id,
          severity: 'low',
          title: `Provider "${provider.name}" (${provider.type}) has no traffic in the last 7 days`,
          capabilityPath: ['dormant-provider'],
          containmentState: 'unknown',
          assetHints: ['asset-provider-keys'],
          whyItMatters: 'An inactive provider still has a configured API key and routing entry. If the key is compromised or the provider has a vulnerability, the exposure exists even though the provider is not actively used.',
          blastRadius: 'Limited — provider is not actively routing traffic. But the API key remains valid and could be used outside ClawNex.',
          recommendedFix: 'If this provider is no longer needed, remove it from Configuration > Model Providers. This revokes the routing entry and removes the API key from the config.',
          evidence: [
            `config_providers row: name="${provider.name}", type="${provider.type}"`,
            'proxy_traffic rows in last 7d: 0',
          ],
          // Derived from live SQL against config_providers + proxy_traffic.
          confidence: 'verified_config',
        });
      }
    }

    return findings;
  },
};

// ── Rule 5: Recovery-Path Permissiveness ──

const recoveryPathPermissiveness: AuditRule = {
  id: 'recovery-path-permissiveness',
  name: 'Recovery-Path Permissiveness',
  description: 'Evaluates whether emergency/recovery paths (break-glass, restart, uninstall) are appropriately restricted.',
  category: 'trust-boundary',
  severityBase: 'medium',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    // Check if break-glass is currently active
    if (ctx.config.breakGlassActive) {
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: 'critical',
        title: 'Break-glass is currently active — all shield scanning bypassed',
        capabilityPath: ['break-glass-active'],
        containmentState: 'unsandboxed',
        assetHints: [],
        whyItMatters: 'The emergency override completely disables the Prompt Shield. All traffic flows unscanned. This is the maximum permissive state of the system.',
        blastRadius: 'Every agent request bypasses detection. Jailbreaks, prompt injection, and data exfiltration will not be caught. Traffic is still logged but not inspected.',
        recommendedFix: `Deactivate break-glass immediately after the underlying issue is resolved. Current reason: "${ctx.config.breakGlassReason || 'not specified'}". Expiry: ${ctx.config.breakGlassExpiry || 'unknown'}.`,
        evidence: [
          `config_defaults.break_glass_active = 'true'`,
          `Reason: ${ctx.config.breakGlassReason || 'not specified'}`,
          `Expiry: ${ctx.config.breakGlassExpiry || 'unknown'}`,
        ],
        // Read directly from config_defaults via getSetting.
        confidence: 'verified_config',
      });
    }

    // Check if RBAC is disabled
    if (!ctx.config.rbacEnabled) {
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: 'high',
        title: 'RBAC is disabled — no operator authentication',
        capabilityPath: ['rbac-disabled'],
        containmentState: 'unsandboxed',
        assetHints: [],
        whyItMatters: 'Without RBAC, any user on the local network can access the dashboard, change configuration, activate break-glass, manage operators, and purge data. Localhost guards provide minimal protection.',
        blastRadius: 'Full system access from any local network client. No audit trail attribution — all actions recorded as "operator" instead of real usernames.',
        recommendedFix: 'Enable RBAC by setting RBAC_ENABLED=true. Create an admin account via the setup wizard. This is required for any multi-user or network-exposed deployment.',
        evidence: ['isRbacEnabled() returned false (checked against config + env)'],
        // Derived from isRbacEnabled() which reads config + env.
        confidence: 'verified_config',
      });
    }

    // Check if session IP binding is disabled
    if (ctx.config.rbacEnabled && !ctx.config.sessionBindIp) {
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: 'info',
        title: 'Session IP binding is not enabled',
        capabilityPath: ['session-ip-binding'],
        containmentState: 'partial',
        assetHints: [],
        whyItMatters: 'Without IP binding, a stolen session token can be used from any IP address. With IP binding, sessions are locked to the originating IP.',
        blastRadius: 'Session hijacking risk is elevated if tokens are exposed via XSS, network sniffing, or physical access.',
        recommendedFix: 'Enable session IP binding in Configuration for high-security environments. Note: this is an enterprise feature badge.',
        evidence: [`config_defaults.session_bind_ip = 'false'`],
        confidence: 'verified_config',
      });
    }

    return findings;
  },
};

// ── Rule 6: Prompt-to-Capability Mismatch ──

const promptCapabilityMismatch: AuditRule = {
  id: 'prompt-capability-mismatch',
  name: 'Prompt-to-Capability Mismatch',
  description: 'Detects agents whose declared role/persona (from SOUL.md) contradicts their actual tool capabilities.',
  category: 'trust-boundary',
  severityBase: 'medium',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    // Advisory/read-only keywords in agent personas
    const advisoryKeywords = ['advisor', 'advisory', 'read-only', 'readonly', 'helper', 'assistant', 'viewer', 'observer', 'monitor', 'reporter'];
    const dangerousToolClasses = ['runtime', 'filesystem', 'config', 'orchestration'];

    for (const agent of ctx.agents) {
      // Try to read SOUL.md
      let soulContent = '';
      const soulPaths = [
        path.join(process.cwd(), 'workspaces', agent.id, 'SOUL.md'),
        path.join(process.cwd(), `workspace-${agent.id}`, 'SOUL.md'),
      ];

      for (const sp of soulPaths) {
        try {
          if (fs.existsSync(sp)) {
            soulContent = fs.readFileSync(sp, 'utf-8').toLowerCase();
            break;
          }
        } catch { /* not accessible */ }
      }

      if (!soulContent) continue;

      // Check if persona claims to be advisory/read-only
      const isAdvisoryPersona = advisoryKeywords.some(kw => soulContent.includes(kw));

      if (!isAdvisoryPersona) continue;

      // Check if tools contradict the persona
      const agentCaps = ctx.capabilities.filter(c =>
        agent.tools.some(t => c.id.includes(t.toLowerCase()))
      );
      const hasDangerousTools = agentCaps.some(c => dangerousToolClasses.includes(c.class));

      if (hasDangerousTools) {
        const matchedKeyword = advisoryKeywords.find(kw => soulContent.includes(kw)) || 'advisory';
        const containmentState: Finding['containmentState'] = agent.sandboxed === true
          ? 'sandboxed'
          : agent.sandboxed === false
            ? 'unsandboxed'
            : 'unknown';

        findings.push({
          id: findingId(),
          ruleId: this.id,
          severity: 'medium',
          title: `Agent "${agent.name}" claims "${matchedKeyword}" role (per SOUL.md) but inferred tools look dangerous`,
          agentId: agent.id,
          capabilityPath: agentCaps.filter(c => dangerousToolClasses.includes(c.class)).map(c => c.name),
          containmentState,
          assetHints: [],
          whyItMatters: `This agent's SOUL.md describes it as "${matchedKeyword}" — suggesting limited, safe behavior. But the inferred toolset includes ${agentCaps.filter(c => dangerousToolClasses.includes(c.class)).map(c => c.name.toLowerCase()).join(', ')}. If the inference is correct, the agent's capabilities exceed its declared intent.`,
          blastRadius: 'An attacker who sees this agent described as safe/advisory may underestimate its actual power. The tools it has could be exploited for file modification, command execution, or configuration changes.',
          recommendedFix: 'Either restrict the agent\'s tool access to match its advisory role, or update the SOUL.md to accurately reflect its capabilities. The persona and the toolset should agree.',
          evidence: [
            `SOUL.md file read from workspace; keyword match: "${matchedKeyword}"`,
            `Inferred dangerous tools (heuristic): ${agentCaps.filter(c => dangerousToolClasses.includes(c.class)).map(c => c.name).join(', ')}`,
          ],
          // SOUL.md keyword matching + tool-name heuristics — weakest link governs.
          confidence: 'heuristic_inference',
        });
      }
    }

    return findings;
  },
};

// ── Rule 7: Trust Drift ──

const trustDrift: AuditRule = {
  id: 'trust-drift',
  name: 'Trust Drift Detection',
  description: 'Identifies recent configuration changes that made the system more permissive.',
  category: 'drift',
  severityBase: 'medium',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    const permissiveActions = [
      'shield_mode_change', 'break_glass_activate', 'access_list_remove',
      'provider_add', 'operator_create', 'config_change',
    ];

    const recentPermissive = ctx.recentChanges.filter(c =>
      permissiveActions.some(a => c.action.toLowerCase().includes(a.replace('_', '')))
    );

    if (recentPermissive.length > 0) {
      const grouped = new Map<string, typeof recentPermissive>();
      for (const c of recentPermissive) {
        const key = c.action;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(c);
      }

      for (const [action, changes] of Array.from(grouped.entries())) {
        findings.push({
          id: findingId(),
          ruleId: this.id,
          severity: action.includes('break_glass') ? 'high' : 'medium',
          title: `${changes.length} permissive change(s): ${action} in last 72 hours`,
          capabilityPath: ['config-drift'],
          containmentState: 'unknown',
          assetHints: [],
          whyItMatters: 'Configuration changes that widen access or reduce enforcement increase the blast radius. Drift detection helps operators catch unintended permission creep.',
          blastRadius: `${changes.length} change(s) may have widened the trust boundary. Review each to confirm it was intentional.`,
          recommendedFix: 'Review each change in the Audit & Evidence panel. Confirm the change was authorized and the new state is intended.',
          evidence: [
            `audit_log rows matching "${action}" in last 72h: ${changes.length}`,
            ...changes.slice(0, 5).map(c => `${c.timestamp} — ${c.actor}: ${c.action} — ${c.detail.slice(0, 100)}`),
          ],
          // Direct query against audit_log — config-level verification.
          confidence: 'verified_config',
        });
      }
    }

    return findings;
  },
};

// ── Rule 8: Direct-Path Bypass Enhancements ──

const directPathEnhanced: AuditRule = {
  id: 'direct-path-enhanced',
  name: 'Per-Provider Routing Analysis',
  description: 'Detailed per-provider analysis showing which are routed through LiteLLM vs direct, with specific risk assessment.',
  category: 'visibility',
  severityBase: 'medium',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    const providers = queryAll<{
      id: string; name: string; type: string; base_url: string;
    }>("SELECT id, name, type, base_url FROM config_providers");

    for (const p of providers) {
      const isRouted = p.base_url?.includes('localhost') || p.base_url?.includes('127.0.0.1') || p.base_url?.includes('litellm');
      const isLocal = p.type === 'lmstudio' || p.type === 'ollama';

      if (!isRouted && !isLocal) {
        findings.push({
          id: findingId(),
          ruleId: this.id,
          severity: 'medium',
          title: `Provider "${p.name}" (${p.type}) routes directly — bypasses shield`,
          capabilityPath: ['direct-provider', p.type],
          containmentState: 'unsandboxed',
          assetHints: [],
          whyItMatters: `Traffic to ${p.name} is not intercepted by the Prompt Shield. Requests go directly to ${p.type}, visible only retroactively via Session Watcher.`,
          blastRadius: `All agents using ${p.name} have unscanned request paths for real-time detection.`,
          recommendedFix: `If possible, route ${p.name} through LiteLLM by changing its base_url to http://localhost:4001. If the provider uses OAuth (Claude.ai, ChatGPT Pro), routing is not possible — ensure Session Watcher covers these agents.`,
          evidence: [
            `config_providers row: name="${p.name}", type="${p.type}"`,
            `Base URL: ${p.base_url?.replace(/key=[^&]+/, 'key=***') || 'not set'}`,
          ],
          // Derived directly from config_providers SELECT.
          confidence: 'verified_config',
        });
      }
    }

    return findings;
  },
};

// ── Rule 9: Cross-Agent Delegation ──

const crossAgentDelegation: AuditRule = {
  id: 'cross-agent-delegation',
  name: 'Cross-Agent Delegation Boundary',
  description: 'Detects agents with tools that can spawn, delegate to, or relay commands to other agents — potentially crossing trust boundaries.',
  category: 'trust-boundary',
  severityBase: 'high',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    const delegationKeywords = ['spawn', 'delegate', 'orchestrat', 'relay', 'dispatch', 'invoke', 'call_agent', 'run_agent', 'create_session'];

    for (const agent of ctx.agents) {
      const delegationTools = agent.tools.filter(t =>
        delegationKeywords.some(kw => t.toLowerCase().includes(kw))
      );

      if (delegationTools.length > 0) {
        const containmentState: Finding['containmentState'] = agent.sandboxed === true
          ? 'sandboxed'
          : agent.sandboxed === false
            ? 'unsandboxed'
            : 'unknown';

        findings.push({
          id: findingId(),
          ruleId: this.id,
          severity: 'high',
          title: `Agent "${agent.name}" appears (by tool-name inference) to have delegation capabilities`,
          agentId: agent.id,
          capabilityPath: delegationTools,
          containmentState,
          assetHints: [],
          whyItMatters: 'An agent that can spawn or delegate to other agents can indirectly access capabilities it does not directly possess. A low-trust agent delegating to a high-trust agent crosses the trust boundary.',
          blastRadius: 'The effective blast radius is the UNION of this agent\'s capabilities and every agent it can delegate to. Privilege escalation through delegation is a hidden permissive path.',
          recommendedFix: 'Audit the delegation chain. Ensure delegated agents have equal or lower trust than the delegating agent. Consider adding approval gates for cross-agent delegation.',
          evidence: [
            `Agent tools matching delegation keywords (${delegationKeywords.join(', ')}):`,
            ...delegationTools.map(t => `  - ${t}`),
          ],
          // Keyword-match on tool names; no live tool-registry verification.
          confidence: 'heuristic_inference',
        });
      }
    }

    return findings;
  },
};

// ── Rule 10: Browser/Auth-State Reachability ──

const browserAuthReachability: AuditRule = {
  id: 'browser-auth-reachability',
  name: 'Browser & Auth-State Reachability',
  description: 'Checks if agents with browser tools can reach authenticated sessions, and verifies host-level security posture from the bundled scanner.',
  category: 'blast-radius',
  severityBase: 'high',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    // Check for agents with browser capabilities
    const browserAgents = ctx.agents.filter(a =>
      a.tools.some(t => ['browser', 'puppeteer', 'playwright', 'selenium', 'chrome', 'web_browse'].some(kw => t.toLowerCase().includes(kw)))
    );

    if (browserAgents.length > 0) {
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: 'high',
        title: `${browserAgents.length} agent(s) appear (by tool-name inference) to have browser automation capabilities`,
        capabilityPath: ['browser-automation'],
        containmentState: 'unknown',
        assetHints: [],
        whyItMatters: 'Browser automation tools can access authenticated sessions, cookies, and saved passwords in the browser profile. If an agent is compromised, it could hijack active sessions on any service the operator is logged into.',
        blastRadius: 'Account takeover potential on any service with an active browser session. This is a blast-radius multiplier — one compromised agent could affect systems far beyond the AI stack.',
        recommendedFix: 'Run browser-capable agents in isolated browser profiles (not the operator\'s default profile). Use containerized browsers or headless profiles with no saved credentials.',
        evidence: browserAgents.map(a => `Agent "${a.name}" tools matching browser/puppeteer/playwright/selenium/chrome/web_browse: ${a.tools.filter(t => ['browser', 'puppeteer', 'playwright', 'selenium', 'chrome', 'web_browse'].some(kw => t.toLowerCase().includes(kw))).join(', ')}`),
        // Browser capability inferred from tool-name keyword match.
        confidence: 'heuristic_inference',
      });
    }

    // Check Clawkeeper host hardening
    const latestScan = queryAll<{ check_name: string; status: string; category: string; detail: string }>(
      `SELECT cr.check_name, cr.status, cr.category, cr.detail
       FROM security_check_results cr
       JOIN security_scans s ON cr.scan_id = s.id
       ORDER BY s.scanned_at DESC LIMIT 50`
    );

    const failedHostChecks = latestScan.filter(c => c.status.toUpperCase() === 'FAIL' && c.category === 'Host Hardening');
    const failedNetworkChecks = latestScan.filter(c => c.status.toUpperCase() === 'FAIL' && c.category === 'Network');

    if (failedHostChecks.length > 0) {
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: 'medium',
        title: `${failedHostChecks.length} failed host hardening check(s)`,
        capabilityPath: ['host-hardening'],
        containmentState: 'unknown',
        assetHints: [],
        whyItMatters: 'Failed host hardening checks from the bundled scanner indicate the underlying system is not fully secured. This widens the blast radius if an agent or the dashboard itself is compromised.',
        blastRadius: 'Host-level vulnerabilities can be exploited to escalate from application-level compromise to system-level access.',
        recommendedFix: 'Review failed checks in Security Posture panel and apply the recommended remediations.',
        evidence: [
          `security_check_results rows with status='fail' AND category='Host Hardening': ${failedHostChecks.length}`,
          ...failedHostChecks.slice(0, 5).map(c => `FAIL: ${c.check_name} — ${c.detail?.slice(0, 80) || 'no detail'}`),
        ],
        // Derived from the latest persisted Clawkeeper scan rows.
        confidence: 'verified_config',
      });
    }

    if (failedNetworkChecks.length > 0) {
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: 'medium',
        title: `${failedNetworkChecks.length} failed network security check(s)`,
        capabilityPath: ['network-security'],
        containmentState: 'unknown',
        assetHints: [],
        whyItMatters: 'Failed network checks indicate firewall, port exposure, or encryption issues that increase the attack surface for remote exploitation.',
        blastRadius: 'Network-level exposure could allow external attackers to reach the dashboard or agent communication channels.',
        recommendedFix: 'Review failed network checks in Security Posture and enable the host firewall at minimum.',
        evidence: [
          `security_check_results rows with status='fail' AND category='Network': ${failedNetworkChecks.length}`,
          ...failedNetworkChecks.slice(0, 5).map(c => `FAIL: ${c.check_name} — ${c.detail?.slice(0, 80) || 'no detail'}`),
        ],
        confidence: 'verified_config',
      });
    }

    return findings;
  },
};

// ── Rule 11: Outbound Action & Egress ──

const outboundEgress: AuditRule = {
  id: 'outbound-egress',
  name: 'Outbound Action & Egress Audit',
  description: 'Identifies agents that can deliver data outside the environment — via messaging, web requests, email, or webhook calls.',
  category: 'blast-radius',
  severityBase: 'high',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    const egressKeywords = ['send', 'email', 'slack', 'discord', 'telegram', 'webhook', 'post', 'fetch', 'curl', 'http_request', 'upload'];

    for (const agent of ctx.agents) {
      const egressTools = agent.tools.filter(t =>
        egressKeywords.some(kw => t.toLowerCase().includes(kw))
      );

      if (egressTools.length === 0) continue;

      // Also check if the agent has read access (read + egress = exfiltration path)
      const hasRead = agent.tools.some(t => ['read', 'file', 'workspace', 'browse'].some(kw => t.toLowerCase().includes(kw)));

      const severity: Severity = hasRead ? 'high' : 'medium';

      const containmentState: Finding['containmentState'] = agent.sandboxed === true
        ? 'sandboxed'
        : agent.sandboxed === false
          ? 'unsandboxed'
          : 'unknown';

      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity,
        title: `Agent "${agent.name}" appears (by tool-name inference) to have outbound egress${hasRead ? ' + read access' : ''}`,
        agentId: agent.id,
        capabilityPath: egressTools,
        containmentState,
        assetHints: [],
        whyItMatters: hasRead
          ? 'This agent appears to have both read and external-send tools. If the inference is accurate and the agent is compromised via prompt injection, it could exfiltrate sensitive information — credentials, business data, or internal configurations.'
          : 'This agent appears to have external-send tools. While it may not have direct read access, it could relay information from its conversation context to external endpoints.',
        blastRadius: hasRead
          ? 'Data exfiltration path exists: read access + outbound channel. Stolen data could reach attacker-controlled endpoints.'
          : 'Outbound communication path exists. Could be used for C2 (command and control) or social engineering relay.',
        recommendedFix: 'Add the agent\'s outbound targets to an allow list. Monitor outbound traffic in Traffic Monitor for unexpected destinations. Consider restricting egress to approved domains only.',
        evidence: [
          `Agent tools matching egress keywords (${egressKeywords.join(', ')}):`,
          ...egressTools.map(t => `  - ${t}`),
          ...(hasRead ? ['Agent also has tools matching read/file/workspace/browse — exfiltration path possible'] : []),
        ],
        // Keyword-match on tool names — purely inferred.
        confidence: 'heuristic_inference',
      });
    }

    return findings;
  },
};

// ── Rule 12: Plugin/Extension Trust ──

const pluginTrust: AuditRule = {
  id: 'plugin-trust',
  name: 'Plugin & Extension Trust Audit',
  description: 'Scans workspace directories for installed plugins/skills and checks for dangerous code patterns.',
  category: 'trust-boundary',
  severityBase: 'medium',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    const dangerousPatterns = ['eval(', 'exec(', 'execSync', 'child_process', 'spawn(', 'process.env', 'require("fs")', 'import("fs")', 'fetch(', 'XMLHttpRequest', 'WebSocket'];
    const skillDirs = [
      path.join(process.cwd(), '.agents', 'skills'),
      path.join(process.cwd(), 'skills'),
    ];

    for (const dir of skillDirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const skillPath = path.join(dir, entry.name);
          const files = fs.readdirSync(skillPath).filter(f => f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.py') || f.endsWith('.mjs'));

          for (const file of files) {
            try {
              const content = fs.readFileSync(path.join(skillPath, file), 'utf-8');
              const matched = dangerousPatterns.filter(p => content.includes(p));

              if (matched.length > 0) {
                findings.push({
                  id: findingId(),
                  ruleId: this.id,
                  severity: matched.some(m => ['eval(', 'exec(', 'execSync', 'child_process', 'spawn('].includes(m)) ? 'high' : 'medium',
                  title: `Skill "${entry.name}/${file}" contains code patterns that look dangerous (substring match)`,
                  capabilityPath: matched,
                  containmentState: 'unknown',
                  assetHints: [],
                  whyItMatters: `This plugin/skill file contains literal substrings that often indicate it can ${matched.includes('exec(') || matched.includes('execSync') ? 'execute system commands' : matched.includes('fetch(') ? 'make network requests' : matched.includes('process.env') ? 'access environment variables' : 'perform privileged operations'}. The match is literal text, not AST-based, so review is required to confirm intent.`,
                  blastRadius: 'Plugin code runs with the same permissions as the Node.js process. If the matches represent real calls, they could lead to arbitrary code execution, data access, or network communication.',
                  recommendedFix: `Review the code in ${entry.name}/${file}. If the patterns are intentional and safe, document the justification. If not, remove or sandbox the plugin.`,
                  evidence: [
                    `file read: ${path.join(skillPath, file)}`,
                    ...matched.map(m => `substring match: ${m}`),
                  ],
                  // Literal substring match on source code — high false-positive potential.
                  confidence: 'heuristic_inference',
                });
              }
            } catch { /* file not readable */ }
          }
        }
      } catch { /* directory not accessible */ }
    }

    return findings;
  },
};

// ── Rule 13: Identity & Credential Exposure ──

const credentialExposure: AuditRule = {
  id: 'credential-exposure',
  name: 'Identity & Credential Exposure',
  description: 'Scans for credential files, API keys, and sensitive configuration accessible from agent workspaces.',
  category: 'blast-radius',
  severityBase: 'high',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    const sensitiveFiles = [
      { pattern: '.env', risk: 'Environment variables — may contain API keys and secrets' },
      { pattern: '.env.local', risk: 'Local environment overrides — likely contains real credentials' },
      { pattern: 'config.yaml', risk: 'LiteLLM config — contains provider API keys in cleartext' },
      { pattern: '.ssh', risk: 'SSH keys — server access credentials' },
      { pattern: '.aws/credentials', risk: 'AWS credentials' },
      { pattern: '.gcloud', risk: 'Google Cloud credentials' },
      { pattern: '.npmrc', risk: 'NPM auth tokens' },
      { pattern: '.pypirc', risk: 'PyPI auth tokens' },
    ];

    // Check if any agent workspace has read access to the project root
    for (const agent of ctx.agents) {
      if (!agent.tools.some(t => ['read', 'file', 'workspace', 'browse', 'cat', 'ls'].some(kw => t.toLowerCase().includes(kw)))) continue;

      const reachableSecrets: string[] = [];

      for (const sf of sensitiveFiles) {
        const filePath = path.join(process.cwd(), sf.pattern);
        try {
          if (fs.existsSync(filePath)) {
            reachableSecrets.push(`${sf.pattern}: ${sf.risk}`);
          }
        } catch { /* not accessible */ }
      }

      if (reachableSecrets.length > 0) {
        const containmentState: Finding['containmentState'] = agent.sandboxed === true
          ? 'sandboxed'
          : agent.sandboxed === false
            ? 'unsandboxed'
            : 'unknown';

        findings.push({
          id: findingId(),
          ruleId: this.id,
          severity: 'high',
          title: `Agent "${agent.name}" appears (by tool-name inference) to have read access near ${reachableSecrets.length} sensitive file(s)`,
          agentId: agent.id,
          capabilityPath: ['filesystem-read', 'credential-access'],
          containmentState,
          assetHints: reachableSecrets.map((_, i) => `asset-cred-${i}`),
          whyItMatters: 'An agent whose declared tools include read/file/workspace primitives can potentially access credential files stored in or near its workspace. If the agent is compromised, these credentials could be exfiltrated.',
          blastRadius: `${reachableSecrets.length} sensitive file(s) exist on disk. Exposure could include API keys, cloud credentials, SSH keys, or database passwords.`,
          recommendedFix: 'Restrict agent workspace access with workspaceOnly mode. Move sensitive files outside agent-accessible paths. Use environment variable injection rather than file-based credentials where possible.',
          evidence: [
            `Agent tools matching read/file/workspace/browse/cat/ls keywords (heuristic): ${agent.tools.filter(t => ['read', 'file', 'workspace', 'browse', 'cat', 'ls'].some(kw => t.toLowerCase().includes(kw))).join(', ')}`,
            ...reachableSecrets.map(s => `file exists on disk: ${s}`),
          ],
          // Read capability inferred from tool names; file existence verified on disk.
          // Weakest link is the tool-name inference.
          confidence: 'heuristic_inference',
        });
        break; // One finding per credential exposure check, not per agent
      }
    }

    // Also check if .env.local exists and contains real keys
    try {
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        const keyCount = (content.match(/(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL).*=.+/gi) || []).length;
        if (keyCount > 0) {
          findings.push({
            id: findingId(),
            ruleId: this.id,
            severity: 'medium',
            title: `.env.local contains ${keyCount} credential-like entries`,
            capabilityPath: ['env-credentials'],
            containmentState: 'unknown',
            assetHints: ['asset-env'],
            whyItMatters: 'Environment files with credentials are accessible to any process running on the same machine, including compromised agents with file read capabilities.',
            blastRadius: `${keyCount} credential entries could be exposed if an agent gains file read access to the project directory.`,
            recommendedFix: 'Ensure .env.local is not accessible from agent workspaces. Use OS-level file permissions (chmod 600) to restrict access.',
            evidence: [
              `file exists: ${envPath}`,
              `${keyCount} lines matching KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL regex`,
            ],
            // File existence + regex line-count is a verified filesystem check.
            confidence: 'verified_filesystem',
          });
        }
      }
    } catch { /* not accessible */ }

    return findings;
  },
};

// ── Rule 14: Recovery-Path Enhancements ──

const recoveryPathEnhanced: AuditRule = {
  id: 'recovery-path-enhanced',
  name: 'Recovery-Path Deep Analysis',
  description: 'Enhanced analysis of emergency and recovery paths — break-glass history, maintenance mode, and temporary access patterns.',
  category: 'trust-boundary',
  severityBase: 'medium',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];

    // Check break-glass activation history
    // NOTE: We use an explicit IN (...) list instead of LIKE '%break_glass%' so SQLite can
    // use the composite (action, created_at) index. Wildcard LIKE forced a full scan of
    // audit_log (~1.8M rows) and was the primary source of trust-audit timeouts.
    const breakGlassHistory = queryAll<{ actor: string; created_at: string; detail: string }>(
      `SELECT actor, created_at, detail FROM audit_log
       WHERE action IN ('break_glass_activated', 'break_glass_deactivated', 'break_glass_expired')
         AND created_at >= datetime('now', '-30 days')
       ORDER BY created_at DESC LIMIT 20`
    );

    if (breakGlassHistory.length > 3) {
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: 'medium',
        title: `Break-glass activated ${breakGlassHistory.length} times in the last 30 days`,
        capabilityPath: ['break-glass-frequency'],
        containmentState: 'unknown',
        assetHints: [],
        whyItMatters: 'Frequent break-glass usage suggests either recurring shield issues or operational over-reliance on the emergency bypass. Each activation opens a window where all traffic is unscanned.',
        blastRadius: 'Each break-glass window creates a period of zero detection. Cumulative unscanned windows increase the probability of missed threats.',
        recommendedFix: 'Investigate why break-glass is needed frequently. Common causes: overly aggressive shield rules blocking legitimate traffic, or model routing issues. Fix the root cause instead of bypassing the shield.',
        evidence: [
          `audit_log break_glass_* entries in last 30 days: ${breakGlassHistory.length}`,
          ...breakGlassHistory.slice(0, 5).map(h => `${h.created_at} — ${h.actor}: ${h.detail?.slice(0, 80) || 'no detail'}`),
        ],
        // Direct query against audit_log.
        confidence: 'verified_config',
      });
    }

    // Check for config mutation paths from conversational surfaces
    const mcpSurface = ctx.surfaces.find(s => s.kind === 'mcp-http');
    if (mcpSurface && mcpSurface.policy === 'open') {
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: 'high',
        title: 'MCP HTTP endpoint allows unauthenticated config mutations',
        capabilityPath: ['mcp-config-mutation'],
        containmentState: 'unsandboxed',
        assetHints: [],
        whyItMatters: 'The MCP HTTP transport has no authentication. Any local process can invoke MCP tools including shield scans and resource reads. If MCP tools include config mutation capabilities, the entire system could be reconfigured by an unauthorized local process.',
        blastRadius: 'Any process on localhost can invoke MCP tools. Malware, rogue scripts, or compromised containers could use this path to disable security controls.',
        recommendedFix: 'Add authentication to the MCP HTTP transport, or restrict it to stdio transport only (which inherits process-level authentication).',
        evidence: [
          `surface kind=mcp-http policy='${mcpSurface.policy}'`,
          `mcp_port from config_defaults (non-empty)`,
        ],
        // Surface discovery reads mcp_port directly from config_defaults.
        confidence: 'verified_config',
      });
    }

    return findings;
  },
};

// ── Rule 15 (v0.7.1): Comm-Surface Permissiveness ──
//
// Consumes the permissiveness scan attached to AuditContext by the engine.
// Emits Findings for:
//   - dangerousCombos with evaluable:true   (skill-derived or tool-declared)
//   - postureLints                          (config-derived misconfigurations)
// Skips silently if the scan was unavailable or the report has no findings.
// Rule evidence cites the comm surface, agent, and combo/lint id so operators
// can drill back into the Blast Radius panel for the full posture context.

interface PCommoFinding {
  comboId: string;
  agentId: string;
  evidence: { tool: string; matchedPattern: string }[];
  evaluable: boolean;
  reason?: string;
}

interface PPostureLintFinding {
  ruleId: string;
  surfaceId: string;
  field: string;
  value: string;
  rationale: string;
  severity: 'low' | 'medium' | 'high';
  confidence: 'verified_runtime' | 'verified_config' | 'verified_filesystem' | 'heuristic_inference' | 'unknown';
}

interface PReport {
  dangerousCombos: PCommoFinding[];
  postureLints: PPostureLintFinding[];
}

// Hand-mirror of permissiveness DANGEROUS_COMBOS metadata so Trust Audit
// can render combo names + rationale + severity without taking a runtime
// dep on the registry shape. Keep this in sync with permissiveness/dangerous-combos.ts.
const COMBO_META: Record<string, { name: string; rationale: string; severity: Severity }> = {
  browser_plus_read: {
    name: 'Browser + Read',
    rationale: 'Agent can fetch external content AND read local files — classic exfiltration vector.',
    severity: 'high',
  },
  read_plus_send: {
    name: 'Read + Send',
    rationale: 'Agent can read local data AND send to external surfaces — direct data-egress path.',
    severity: 'high',
  },
  exec_plus_write: {
    name: 'Exec + Write',
    rationale: 'Agent can both generate/edit code and execute it — RCE ladder with persistence.',
    severity: 'critical',
  },
  config_mutation_plus_restart: {
    name: 'Config Mutation + Restart',
    rationale: 'Agent can alter service configuration and force it to reload — privilege escalation vector.',
    severity: 'critical',
  },
  delegation_plus_privileged_peer: {
    name: 'Delegation + Privileged Peer',
    rationale: 'Agent can delegate tasks to a peer with more dangerous capabilities — confused-deputy pattern.',
    severity: 'high',
  },
};

function isPReport(x: unknown): x is PReport {
  return (
    typeof x === 'object' && x !== null &&
    Array.isArray((x as any).dangerousCombos) &&
    Array.isArray((x as any).postureLints)
  );
}

const commSurfacePermissiveness: AuditRule = {
  id: 'comm-surface-permissiveness',
  name: 'Comm-Surface Permissiveness Findings',
  description: 'Surfaces dangerous tool combinations and posture-lint misconfigurations from the permissiveness scan as Trust Audit findings, so operators see them in one place alongside other trust-boundary risks.',
  category: 'permission-to-impact',
  severityBase: 'medium',
  evaluate(ctx: AuditContext): Finding[] {
    const findings: Finding[] = [];
    const report = ctx.permissivenessReport;
    if (!isPReport(report)) return findings;

    // (a) Dangerous combos (evaluable:true only — never fabricate risk)
    for (const combo of report.dangerousCombos) {
      if (!combo.evaluable) continue;
      const meta = COMBO_META[combo.comboId];
      if (!meta) continue;

      const tools = combo.evidence.map((e) => e.tool);
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: meta.severity,
        title: `Agent "${combo.agentId}" has dangerous tool combination: ${meta.name}`,
        agentId: combo.agentId,
        capabilityPath: tools.map((t) => `tool:${t}`),
        containmentState: 'unknown',
        assetHints: [],
        whyItMatters: meta.rationale,
        blastRadius: `Combo enables a known abuse pattern (${meta.name}); blast radius depends on the surface this agent is reachable from — see Blast Radius → Most Permissive Agents for the per-surface score.`,
        recommendedFix: `Remove one side of the ${meta.name} combination from this agent's tool list, or move the agent into a sandboxed runtime that intercepts the dangerous side.`,
        evidence: [
          `combo: ${combo.comboId} (severity=${meta.severity})`,
          ...combo.evidence.map((e) => `tool '${e.tool}' matched pattern '${e.matchedPattern}'`),
        ],
        // Skill-derived tool extraction is heuristic_inference; OpenClaw-declared
        // tools are verified_config. We can't tell which apply per-edge from the
        // combo finding alone — choose the weaker level honestly.
        confidence: 'heuristic_inference',
      });
    }

    // (b) Posture lints (config-derived misconfigurations)
    for (const lint of report.postureLints) {
      const sev: Severity = lint.severity === 'high' ? 'high' : lint.severity === 'medium' ? 'medium' : 'low';
      findings.push({
        id: findingId(),
        ruleId: this.id,
        severity: sev,
        title: `Posture lint on ${lint.surfaceId}: ${lint.ruleId}`,
        surfaceId: lint.surfaceId,
        capabilityPath: [`posture-lint:${lint.ruleId}`],
        containmentState: 'unknown',
        assetHints: [],
        whyItMatters: lint.rationale,
        blastRadius: `Misconfiguration weakens the documented control on ${lint.surfaceId}; combined with a permissive audience this is an exploitable gap.`,
        recommendedFix: `Review the field cited in the lint; correct the value to match the documented schema. See Blast Radius → Findings → Posture Lints for the field path and provenance.`,
        evidence: [
          `field: ${lint.field}`,
          `value: ${lint.value}`,
          `rule: ${lint.ruleId}`,
        ],
        confidence: lint.confidence,
      });
    }

    return findings;
  },
};

// ── Export All Rules ──

export const AUDIT_RULES: AuditRule[] = [
  directPathBypass,
  toolFreedom,
  modelPrivilegeMismatch,
  dormantRisk,
  recoveryPathPermissiveness,
  promptCapabilityMismatch,
  trustDrift,
  directPathEnhanced,
  crossAgentDelegation,
  browserAuthReachability,
  outboundEgress,
  pluginTrust,
  credentialExposure,
  recoveryPathEnhanced,
  commSurfacePermissiveness,
];
