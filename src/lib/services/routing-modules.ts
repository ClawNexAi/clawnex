import {
  applyOpenClawDesiredRouting, applyHermesDesiredRouting, revertHermesRouting,
  setConnectorRoutingSelections, syncConnectorRoutingInventory,
  type ConnectorId, type ConnectorRoutingSummary, type RoutingApplyScope,
} from './connector-routing-inventory';
import { inspectLitellmRouting, revertLitellmRouting } from './openclaw-routing-wire';

/** Tool-specific parsing/writes stay behind this interface; approval and ordering
 * belong to the coordinator. A source ID is mandatory, never an all-instances write.
 */
export interface RoutingModule {
  id: ConnectorId;
  inspect(sourceId: string): ConnectorRoutingSummary;
  apply(scope: RoutingApplyScope & { sourceId: string }): ReturnType<typeof applyOpenClawDesiredRouting>;
  restore(scope: RoutingApplyScope & { sourceId: string }): ReturnType<typeof applyOpenClawDesiredRouting> | ReturnType<typeof revertHermesRouting>;
}

function inspect(id: ConnectorId, sourceId: string): ConnectorRoutingSummary {
  const summary = syncConnectorRoutingInventory('inspect')[id];
  const items = summary.items.filter(item => item.sourceId === sourceId);
  if (!sourceId || !items.length) throw new Error('This instance has no supported local routing configuration. Refresh the instance list.');
  return { ...summary, sourceId, items,
    selected: items.filter(item => item.present && item.desiredRoute === 'routed').length,
    pendingChanges: items.filter(item => item.present && item.desiredRoute !== item.currentRoute).length,
  };
}

const modules: Record<ConnectorId, RoutingModule> = {
  openclaw: {
    id: 'openclaw', inspect: sourceId => inspect('openclaw', sourceId),
    apply: scope => applyOpenClawDesiredRouting({ ...scope, restore: false }),
    restore: scope => {
      const summary = inspect('openclaw', scope.sourceId);
      setConnectorRoutingSelections('openclaw', summary.items.filter(item =>
        item.present && item.providerId !== 'litellm' && ['provider-routing', 'model-inventory'].includes(item.capability)).map(item => item.id), 'direct');
      const result = applyOpenClawDesiredRouting({ ...scope, restore: true });
      if (!result.ok || !inspectLitellmRouting().sidecar) return result;
      const legacy = revertLitellmRouting();
      return { ...result, ok: legacy.ok, status: legacy.ok ? 'applied' : 'error',
        restartRequired: result.restartRequired || legacy.status === 'reverted',
        detail: `${result.detail} Legacy bridge recovery: ${legacy.detail}`,
        skippedProviders: [...result.skippedProviders, ...(legacy.preservedPaths || []).map(keys => ({ providerId: keys.join('.'), reason: 'Legacy field changed or remains referenced; preserved with its recovery record.' }))],
      };
    },
  },
  hermes: {
    id: 'hermes', inspect: sourceId => inspect('hermes', sourceId),
    apply: scope => applyHermesDesiredRouting({ ...scope, restore: false }),
    restore: scope => revertHermesRouting(scope),
  },
};

export function getRoutingModule(id: ConnectorId): RoutingModule {
  const module = modules[id];
  if (!module) throw new Error('Unsupported routing module.');
  return module;
}
