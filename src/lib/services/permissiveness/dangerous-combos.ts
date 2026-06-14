// Dangerous tool-combination registry.
//
// Hand-seeded (not learned). Each combo declares a tool-pattern: OR-of-AND
// where the outer array represents AND groups, and each inner array is the
// OR set of synonyms for that group. A combo is `evaluable` only if every
// AND group matches at least one synonym in the agent's toolset.
//
// When evidence is insufficient, the finding carries `evaluable: false` with
// an explicit reason — NEVER a fabricated risk.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §4 (DangerousCombo) + §5 (bonus)

import type { DangerousCombo, DangerousComboFinding } from "./types";

export const DANGEROUS_COMBOS: DangerousCombo[] = [
  {
    id: "browser_plus_read",
    name: "Browser + Read",
    toolPattern: [
      ["browser", "fetch", "web_fetch", "web_search", "web_browse"],
      ["read", "file_read", "fs_read"],
    ],
    rationale:
      "Agent can fetch external content AND read local files — classic exfiltration vector (content fetched from attacker-controlled URL can trigger read of sensitive file, then egress via the same browser).",
    severity: "high",
  },
  {
    id: "read_plus_send",
    name: "Read + Send",
    toolPattern: [
      ["read", "file_read", "fs_read"],
      [
        "send",
        "email",
        "slack_post",
        "discord_post",
        "telegram_post",
        "http_post",
        "webhook",
        "post",
      ],
    ],
    rationale:
      "Agent can read local data AND send to external surfaces — direct data-egress path. No browser intermediary required.",
    severity: "high",
  },
  {
    id: "exec_plus_write",
    name: "Exec + Write",
    toolPattern: [
      ["bash", "exec", "shell", "run_command", "execute"],
      ["write", "file_write", "edit", "fs_write"],
    ],
    rationale:
      "Agent can both generate/edit code and execute it — RCE ladder with persistence. Prompt injection can escalate into durable compromise.",
    severity: "critical",
  },
  {
    id: "config_mutation_plus_restart",
    name: "Config Mutation + Restart",
    toolPattern: [
      ["config_write", "edit_config", "openclaw_config_set", "settings_set", "env_write"],
      ["restart", "reload", "systemctl", "service_control", "kill_process"],
    ],
    rationale:
      "Agent can alter service configuration and force it to reload — privilege escalation and persistence vector via config poisoning.",
    severity: "critical",
  },
  {
    id: "delegation_plus_privileged_peer",
    name: "Delegation + Privileged Peer",
    toolPattern: [
      ["delegate", "dispatch_agent", "call_agent", "invoke_agent", "agent_to_agent"],
      ["bash", "exec", "config_write", "file_write"],
    ],
    rationale:
      "Agent can delegate tasks to a peer that has more dangerous capabilities than itself — confused-deputy / lateral-escalation pattern.",
    severity: "high",
  },
];

function matchPatternGroup(toolIds: string[], synonyms: string[]): { tool: string; needle: string } | null {
  for (const tool of toolIds) {
    const lower = tool.toLowerCase();
    for (const needle of synonyms) {
      const n = needle.toLowerCase();
      if (lower === n || lower.includes(n)) {
        return { tool, needle };
      }
    }
  }
  return null;
}

export function evaluateCombo(
  combo: DangerousCombo,
  agentId: string,
  agentToolIds: string[] | null | undefined,
): DangerousComboFinding {
  if (!agentToolIds || agentToolIds.length === 0) {
    return {
      comboId: combo.id,
      agentId,
      evidence: [],
      evaluable: false,
      reason: "Agent tool list is empty or missing; cannot evaluate combo against unknown toolset.",
    };
  }

  const evidence: { tool: string; matchedPattern: string }[] = [];
  const matches: boolean[] = [];
  for (const group of combo.toolPattern) {
    const hit = matchPatternGroup(agentToolIds, group);
    if (hit) {
      evidence.push({ tool: hit.tool, matchedPattern: hit.needle });
      matches.push(true);
    } else {
      matches.push(false);
    }
  }

  const allMatched = matches.every(Boolean);
  if (!allMatched) {
    const missingIdx = matches.findIndex((m) => !m);
    const missing = combo.toolPattern[missingIdx].join("|");
    return {
      comboId: combo.id,
      agentId,
      evidence,
      evaluable: false,
      reason: `Missing evidence for AND-group ${missingIdx + 1}/${combo.toolPattern.length} ({${missing}}); combo requires all groups to match.`,
    };
  }

  return { comboId: combo.id, agentId, evidence, evaluable: true };
}

export function evaluateAllCombos(
  agentId: string,
  agentToolIds: string[] | null | undefined,
): DangerousComboFinding[] {
  return DANGEROUS_COMBOS.map((c) => evaluateCombo(c, agentId, agentToolIds));
}

export function findCombo(comboId: string): DangerousCombo | undefined {
  return DANGEROUS_COMBOS.find((c) => c.id === comboId);
}
