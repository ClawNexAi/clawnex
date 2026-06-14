/**
 * Agent Ignore List — shared helper for filtering internal/noise agents.
 * Patterns are matched as prefixes against agent names.
 */

import { getSetting } from './config-service';

const SETTING_KEY = 'agent_ignore_patterns';

const DEFAULT_PATTERNS: string[] = [];

export function getAgentIgnorePatterns(): string[] {
  try {
    const raw = getSetting(SETTING_KEY);
    if (!raw) return [...DEFAULT_PATTERNS];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...DEFAULT_PATTERNS];
  } catch {
    return [...DEFAULT_PATTERNS];
  }
}

export function isAgentIgnored(agentName: string | undefined | null): boolean {
  if (!agentName) return false;
  const patterns = getAgentIgnorePatterns();
  return patterns.some((pattern) => agentName.startsWith(pattern));
}
