import fs from 'node:fs';
import { isNativeAgent } from './native-agent-config';
import { assertNativeProtocolReadiness } from './native-agent-readiness';
import { randomUUID } from 'node:crypto';
import { queryOne, run } from '../db';
import { getRoutingModule } from './routing-modules';
import { inspectLitellmRouting } from './openclaw-routing-wire';
import { selectedRoutingPrerequisites, assertSelectedLiveDeployments } from './provider-routing-readiness';
import { stableRoutingFingerprint, recordRoutingOperation } from './routing-reconciliation';
import { routingOwnershipFingerprint, syncConnectorRoutingInventory, withConnectorRoutingLock, type ConnectorId, type ConnectorRoutingSummary } from './connector-routing-inventory';

export interface RoutingPlan {
  id: string;
  connector: ConnectorId;
  sourceId: string;
  operation: 'apply' | 'restore';
  fingerprint: string;
  files: Record<string, string>;
  providers: string[];
  models: string[];
  exclusions: number;
  legacyPaths: string[];
  prerequisites: string[];
  restartRequired: boolean;
  expiresAt: string;
}

function state(summary: ConnectorRoutingSummary) {
  const files: Record<string, string> = {};
  for (const item of summary.items) {
    const file = item.metadata.configPath;
    if (typeof file !== 'string' || !item.present) continue;
    if (isNativeAgent(summary.connector) && Array.isArray(item.metadata.configPaths)) {
      for (const additional of item.metadata.configPaths) {
        if (typeof additional !== 'string') continue;
        if (fs.existsSync(additional)) {
          const stat = fs.lstatSync(additional);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new Error('Unsupported agent configuration file.');
        }
        files[additional] = stableRoutingFingerprint(fs.existsSync(additional) ? fs.readFileSync(additional, 'utf8') : '');
      }
    }
    if (isNativeAgent(summary.connector) && !fs.existsSync(file)) continue;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new Error('Unsupported configuration file. No routing changes were made.');
    files[file] = stableRoutingFingerprint(fs.readFileSync(file, 'utf8'));
  }
  if (!Object.keys(files).length) throw new Error('This instance has no supported local configuration access.');
  const fingerprint = stableRoutingFingerprint({ files,
    ownership: routingOwnershipFingerprint(summary.connector),
    legacyOwnership: summary.connector === 'openclaw' ? inspectLitellmRouting().sidecar : null,
    items: summary.items.map(item => ({ id: item.id, fingerprint: item.fingerprint, desiredRoute: item.desiredRoute })).sort((a, b) => a.id.localeCompare(b.id)),
  });
  return { files, fingerprint };
}

export function prepareRoutingPlan(connector: ConnectorId, sourceId: string, operation: 'apply' | 'restore'): RoutingPlan {
  const summary = getRoutingModule(connector).inspect(sourceId);
  const snapshot = state(summary);
  const eligible = summary.items.filter(item => item.present && ['provider-routing', 'model-inventory'].includes(item.capability) &&
    (operation === 'restore' ? item.currentRoute === 'routed' : item.desiredRoute === 'routed') &&
    item.providerId !== 'litellm' && item.providerId !== 'clawnex-litellm');
  const plan: RoutingPlan = {
    id: randomUUID(), connector, sourceId, operation, ...snapshot,
    providers: [...new Set(eligible.map(item => item.providerId))],
    models: [...new Set(eligible.map(item => item.modelId).filter(Boolean))],
    exclusions: new Set(summary.items.filter(item => item.present && ['read-only', 'unsupported'].includes(item.capability)).map(item => item.providerId)).size,
    legacyPaths: operation === 'restore' && connector === 'openclaw' ? (inspectLitellmRouting().sidecar?.paths || []).map(record => record.path.join('.')) : [],
    prerequisites: operation === 'apply' ? selectedRoutingPrerequisites(summary) : [],
    restartRequired: true, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
  run('INSERT INTO routing_change_plans (id, plan_json) VALUES (?, ?)', [plan.id, JSON.stringify(plan)]);
  return plan;
}

/** An immutable server-side plan is the approval token. Repeat submits replay its result. */
export async function executeRoutingPlan(id: string, approved: boolean, actor: string) {
  if (!approved) throw new Error('Approve the reviewed changes before applying them.');
  const row = queryOne<{ plan_json: string; status: string; result_json: string | null }>('SELECT * FROM routing_change_plans WHERE id = ?', [id]);
  if (!row) throw new Error('Routing plan not found. Review the connection changes again.');
  if (row.status === 'completed' && row.result_json) return JSON.parse(row.result_json);
  const plan: RoutingPlan = JSON.parse(row.plan_json);
  if (row.status !== 'prepared') throw new Error('This routing operation needs recovery review before retrying.');
  if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error('Review expired. Refresh and approve a new plan.');
  const summary = getRoutingModule(plan.connector).inspect(plan.sourceId);
  if (state(summary).fingerprint !== plan.fingerprint) throw new Error('Configuration or selections changed since review. Review the changes again.');
  if (plan.operation === 'apply') {
    const prerequisites = selectedRoutingPrerequisites(summary);
    if (prerequisites.length) throw new Error(prerequisites.join(' '));
  }
  return withConnectorRoutingLock(plan.connector, () => executeLockedRoutingPlan(id, approved, actor));
}

async function executeLockedRoutingPlan(id: string, approved: boolean, actor: string) {
  if (!approved) throw new Error('Approve the reviewed changes before applying them.');
  const stored = queryOne<{ plan_json: string; status: string; result_json: string | null }>('SELECT * FROM routing_change_plans WHERE id = ?', [id]);
  if (!stored) throw new Error('Routing plan not found. Review the connection changes again.');
  if (stored.status === 'completed' && stored.result_json) return JSON.parse(stored.result_json);
  if (stored.status !== 'prepared') throw new Error('This routing operation needs recovery review before retrying.');
  const plan: RoutingPlan = JSON.parse(stored.plan_json);
  if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error('Review expired. Refresh and approve a new plan.');
  const module = getRoutingModule(plan.connector);
  const summary = module.inspect(plan.sourceId);
  if (state(summary).fingerprint !== plan.fingerprint) throw new Error('Configuration or selections changed since review. Review the changes again.');
  if (plan.operation === 'apply') {
    const prerequisites = selectedRoutingPrerequisites(summary);
    if (prerequisites.length) throw new Error(prerequisites.join(' '));
    await assertSelectedLiveDeployments(summary);
    await assertNativeProtocolReadiness(summary);
  }
  const claimed = run("UPDATE routing_change_plans SET status = 'applying' WHERE id = ? AND status = 'prepared'", [id]);
  if (claimed.changes !== 1) throw new Error('This routing plan is already being applied.');
  try {
    const scope = { sourceId: plan.sourceId, expectedFiles: plan.files };
    const result = plan.operation === 'apply' ? module.apply(scope) : module.restore(scope);
    const inventory = syncConnectorRoutingInventory(plan.operation);
    const operationId = recordRoutingOperation({ connector: plan.connector, operation: plan.operation === 'restore' ? 'revert' : 'apply',
      sourceId: plan.sourceId, actor, outcome: result.status, detail: result.detail, afterSnapshotId: inventory.reconciliation.lastSnapshotIds[plan.connector] });
    const response = { ...result, operationId, sourceId: plan.sourceId };
    run("UPDATE routing_change_plans SET status = 'completed', result_json = ? WHERE id = ?", [JSON.stringify(response), id]);
    return response;
  } catch (error) {
    run("UPDATE routing_change_plans SET status = 'failed' WHERE id = ?", [id]);
    recordRoutingOperation({ connector: plan.connector, sourceId: plan.sourceId, operation: plan.operation, actor, outcome: 'failed', detail: 'Routing operation failed; inspect retained recovery ownership before retrying.' });
    throw error;
  }
}
