/**
 * Starter correlation rule templates.
 *
 * These are pre-filled condition sets that operators can apply to their
 * deployment with a single click. Deliberately NOT pre-seeded into the
 * database on install — seeding active rules on a fresh deployment with
 * no real telemetry would fire false positives (e.g. the auth-bruteforce
 * rule triggering during operator setup).
 *
 * Instead, the Correlations panel surfaces these as an empty-state
 * offer: "you have no rules yet — start with one of these common
 * patterns." The Configuration panel also exposes them for operators
 * who prefer to tune before applying.
 *
 * When applied, a template is POSTed to /api/correlations/rules and
 * lands as an enabled rule. The operator can disable, edit, or delete
 * it from the Configuration → Correlation Rules card at any time.
 */

export interface CorrelationRuleTemplate {
  key: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  threshold: number;
  time_window_minutes: number;
  min_event_count: number;
  conditions: Array<{ field: string; operator: string; value: string; weight: number }>;
}

export const CORRELATION_STARTER_TEMPLATES: CorrelationRuleTemplate[] = [
  {
    key: 'burst-shield-blocks',
    name: 'Burst of shield blocks',
    description: 'Fires when the Shield blocks at least 10 requests in a 5-minute window.',
    severity: 'medium',
    threshold: 1,
    time_window_minutes: 5,
    min_event_count: 10,
    conditions: [
      { field: 'shield_verdict', operator: 'eq', value: 'BLOCK', weight: 1 },
    ],
  },
  {
    key: 'auth-bruteforce',
    name: 'Authentication brute-force',
    description: 'Fires when 5+ 401/403 responses appear within 2 minutes (possible credential-stuffing).',
    severity: 'high',
    threshold: 1,
    time_window_minutes: 2,
    min_event_count: 5,
    conditions: [
      { field: 'status_code', operator: 'gte', value: '401', weight: 1 },
    ],
  },
  {
    key: 'cross-source-anomaly',
    name: 'Cross-source anomaly',
    description: 'Fires when high-risk Shield reviews (score >= 60) AND elevated HTTP errors (>= 500) co-occur within 10 minutes.',
    severity: 'high',
    threshold: 2,
    time_window_minutes: 10,
    min_event_count: 3,
    conditions: [
      { field: 'shield_score', operator: 'gte', value: '60', weight: 1 },
      { field: 'status_code', operator: 'gte', value: '500', weight: 1 },
    ],
  },
];
