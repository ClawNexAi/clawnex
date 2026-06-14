/**
 * Custom Correlation Rule Engine
 *
 * Allows operators to define correlation rules with conditions and weights.
 * Rules evaluate against incoming events (shield scans, traffic, alerts)
 * and generate correlation findings when thresholds are met.
 */

import { queryAll, queryOne, run } from '../db/index';

// ── Types ──

export interface CorrelationCondition {
  field: string;       // e.g. 'shield_verdict', 'model', 'provider', 'source', 'shield_score'
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'not_contains';
  value: string;
  weight: number;      // 1-10, how much this condition contributes to the rule score
}

export interface CustomCorrelationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  conditions: CorrelationCondition[];
  threshold: number;        // minimum weighted score to trigger (sum of matched condition weights)
  time_window_minutes: number;  // look back window for matching events
  min_event_count: number;  // minimum number of events matching in the window
  action: 'alert' | 'log';
  created_at: string;
  updated_at: string;
  last_triggered?: string;
  trigger_count: number;
}

// ── Schema ──

export function ensureSchema(): void {
  run(`
    CREATE TABLE IF NOT EXISTS custom_correlation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      severity TEXT NOT NULL DEFAULT 'medium',
      conditions TEXT NOT NULL DEFAULT '[]',
      threshold INTEGER NOT NULL DEFAULT 5,
      time_window_minutes INTEGER NOT NULL DEFAULT 15,
      min_event_count INTEGER NOT NULL DEFAULT 3,
      action TEXT NOT NULL DEFAULT 'alert',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_triggered TEXT,
      trigger_count INTEGER NOT NULL DEFAULT 0
    )
  `);
}

// ── CRUD ──

export function getRules(): CustomCorrelationRule[] {
  ensureSchema();
  const rows = queryAll<any>("SELECT * FROM custom_correlation_rules ORDER BY created_at DESC");
  return rows.map(r => ({
    ...r,
    enabled: !!r.enabled,
    conditions: JSON.parse(r.conditions || '[]'),
  }));
}

export function getRule(id: string): CustomCorrelationRule | null {
  ensureSchema();
  const row = queryOne<any>("SELECT * FROM custom_correlation_rules WHERE id = ?", [id]);
  if (!row) return null;
  return {
    ...row,
    enabled: !!row.enabled,
    conditions: JSON.parse(row.conditions || '[]'),
  };
}

export function createRule(params: {
  name: string;
  description?: string;
  severity?: string;
  conditions: CorrelationCondition[];
  threshold?: number;
  time_window_minutes?: number;
  min_event_count?: number;
  action?: string;
}): CustomCorrelationRule {
  ensureSchema();
  const id = `ccr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const timeWindowMinutes = Math.max(1, Math.min(10080, parseInt(String(params.time_window_minutes), 10) || 15));

  run(
    `INSERT INTO custom_correlation_rules (id, name, description, severity, conditions, threshold, time_window_minutes, min_event_count, action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.name,
      params.description || '',
      params.severity || 'medium',
      JSON.stringify(params.conditions),
      params.threshold || 5,
      timeWindowMinutes,
      params.min_event_count || 3,
      params.action || 'alert',
    ]
  );

  return getRule(id)!;
}

export function updateRule(id: string, params: Partial<{
  name: string;
  description: string;
  enabled: boolean;
  severity: string;
  conditions: CorrelationCondition[];
  threshold: number;
  time_window_minutes: number;
  min_event_count: number;
  action: string;
}>): CustomCorrelationRule | null {
  ensureSchema();
  const existing = getRule(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: any[] = [];

  if (params.name !== undefined) { updates.push("name = ?"); values.push(params.name); }
  if (params.description !== undefined) { updates.push("description = ?"); values.push(params.description); }
  if (params.enabled !== undefined) { updates.push("enabled = ?"); values.push(params.enabled ? 1 : 0); }
  if (params.severity !== undefined) { updates.push("severity = ?"); values.push(params.severity); }
  if (params.conditions !== undefined) { updates.push("conditions = ?"); values.push(JSON.stringify(params.conditions)); }
  if (params.threshold !== undefined) { updates.push("threshold = ?"); values.push(params.threshold); }
  if (params.time_window_minutes !== undefined) {
    const timeWindowMinutes = Math.max(1, Math.min(10080, parseInt(String(params.time_window_minutes), 10) || 15));
    updates.push("time_window_minutes = ?");
    values.push(timeWindowMinutes);
  }
  if (params.min_event_count !== undefined) { updates.push("min_event_count = ?"); values.push(params.min_event_count); }
  if (params.action !== undefined) { updates.push("action = ?"); values.push(params.action); }

  if (updates.length === 0) return existing;

  updates.push("updated_at = datetime('now')");
  values.push(id);

  run(`UPDATE custom_correlation_rules SET ${updates.join(", ")} WHERE id = ?`, values);

  return getRule(id);
}

export function deleteRule(id: string): boolean {
  ensureSchema();
  const result = run("DELETE FROM custom_correlation_rules WHERE id = ?", [id]);
  return true;
}

// ── Rule Evaluation ──

const FIELD_EXTRACTORS: Record<string, (row: any) => string | number> = {
  shield_verdict: r => r.shield_verdict || '',
  shield_score: r => r.shield_score || 0,
  model: r => r.model || '',
  provider: r => r.provider || '',
  source: r => r.source || '',
  direction: r => r.direction || '',
  blocked: r => r.blocked || 0,
  cost_usd: r => r.cost_usd || 0,
  total_tokens: r => r.total_tokens || 0,
  status_code: r => r.status_code || 0,
  session_id: r => r.session_id || '',
};

function matchCondition(condition: CorrelationCondition, value: string | number): boolean {
  const strVal = String(value).toLowerCase();
  const condVal = condition.value.toLowerCase();
  const numVal = typeof value === 'number' ? value : parseFloat(String(value));
  const condNum = parseFloat(condition.value);

  switch (condition.operator) {
    case 'eq': return strVal === condVal;
    case 'neq': return strVal !== condVal;
    case 'gt': return !isNaN(numVal) && !isNaN(condNum) && numVal > condNum;
    case 'lt': return !isNaN(numVal) && !isNaN(condNum) && numVal < condNum;
    case 'gte': return !isNaN(numVal) && !isNaN(condNum) && numVal >= condNum;
    case 'lte': return !isNaN(numVal) && !isNaN(condNum) && numVal <= condNum;
    case 'contains': return strVal.includes(condVal);
    case 'not_contains': return !strVal.includes(condVal);
    default: return false;
  }
}

/**
 * Evaluate all enabled custom rules against recent traffic.
 * Returns triggered rules with matched events.
 */
export function evaluateRules(): { rule: CustomCorrelationRule; matchCount: number; weightedScore: number; matchedEvents: any[] }[] {
  ensureSchema();
  const rules = getRules().filter(r => r.enabled);
  if (rules.length === 0) return [];

  const results: { rule: CustomCorrelationRule; matchCount: number; weightedScore: number; matchedEvents: any[] }[] = [];

  for (const rule of rules) {
    // Get events within the time window — coerce to bounded integer to prevent SQL injection
    const mins = Math.max(1, Math.min(10080, parseInt(String(rule.time_window_minutes), 10) || 15));
    const events = queryAll<any>(
      `SELECT * FROM proxy_traffic
       WHERE timestamp >= datetime('now', ?)
       ORDER BY timestamp DESC
       LIMIT 500`,
      [`-${mins} minutes`]
    );

    const matchedEvents: any[] = [];

    for (const event of events) {
      let eventScore = 0;
      let allConditionsMet = true;

      for (const condition of rule.conditions) {
        const extractor = FIELD_EXTRACTORS[condition.field];
        if (!extractor) continue;

        const value = extractor(event);
        if (matchCondition(condition, value)) {
          eventScore += condition.weight;
        } else {
          allConditionsMet = false;
        }
      }

      // Event matches if it meets threshold OR all conditions are met
      if (eventScore >= rule.threshold || (allConditionsMet && rule.conditions.length > 0)) {
        matchedEvents.push({ ...event, _score: eventScore });
      }
    }

    if (matchedEvents.length >= rule.min_event_count) {
      const totalScore = matchedEvents.reduce((sum, e) => sum + (e._score || 0), 0);

      results.push({
        rule,
        matchCount: matchedEvents.length,
        weightedScore: totalScore,
        matchedEvents: matchedEvents.slice(0, 10), // Top 10 for display
      });

      // Update trigger count and last_triggered
      run(
        "UPDATE custom_correlation_rules SET trigger_count = trigger_count + 1, last_triggered = datetime('now') WHERE id = ?",
        [rule.id]
      );
    }
  }

  return results;
}

/**
 * Get available fields for condition builder.
 */
export function getAvailableFields(): { field: string; label: string; type: 'string' | 'number'; examples: string[] }[] {
  return [
    { field: 'shield_verdict', label: 'Shield Verdict', type: 'string', examples: ['ALLOW', 'REVIEW', 'BLOCK', 'BYPASSED'] },
    { field: 'shield_score', label: 'Shield Score', type: 'number', examples: ['0', '25', '60', '85'] },
    { field: 'model', label: 'Model', type: 'string', examples: ['gpt-4o', 'claude-3.5-sonnet', 'gpt-4o-mini'] },
    { field: 'provider', label: 'Provider', type: 'string', examples: ['openai', 'anthropic', 'openrouter'] },
    { field: 'source', label: 'Source', type: 'string', examples: ['proxy', 'watcher'] },
    { field: 'direction', label: 'Direction', type: 'string', examples: ['inbound', 'outbound'] },
    { field: 'blocked', label: 'Blocked', type: 'number', examples: ['0', '1'] },
    { field: 'cost_usd', label: 'Cost (USD)', type: 'number', examples: ['0.01', '0.10', '1.00'] },
    { field: 'total_tokens', label: 'Total Tokens', type: 'number', examples: ['100', '1000', '10000'] },
    { field: 'status_code', label: 'HTTP Status', type: 'number', examples: ['200', '400', '429', '500'] },
    { field: 'session_id', label: 'Session ID', type: 'string', examples: [] },
  ];
}
