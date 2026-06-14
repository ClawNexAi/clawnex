/**
 * Audit shim for the policy-framework API surface.
 *
 * The audit-logger module exports `logEvent(actor, action, resourceType?,
 * resourceId?, detail?, source?)` with positional args. The policy-framework
 * API routes (Tasks 12-16) prefer the more idiomatic
 * `audit(action, payload, actor)` shape — payload is a structured object
 * that gets JSON-stringified into the audit log's detail column, and the
 * resource type/id are derived from the action prefix + payload keys.
 *
 * Action prefixes:
 *   - `policy_*`  → resource_type='policy', resource_id=payload.policy_id
 *   - `rule_*`    → resource_type='policy_rule', resource_id=payload.rule_id
 *
 * All audit rows route through source='shield-policy' so they're filterable
 * in the Infrastructure log viewer.
 *
 * @module services/policy-audit
 */

import { logEvent } from './audit-logger';

export function audit(
  action: string,
  payload: Record<string, unknown>,
  actor: string,
): void {
  const resourceType = action.startsWith('rule_') ? 'policy_rule' : 'policy';
  const resourceId = (payload.rule_id ?? payload.policy_id ?? null) as string | null;
  logEvent(
    actor,
    action,
    resourceType,
    resourceId ?? undefined,
    JSON.stringify(payload),
    'shield-policy',
  );
}
