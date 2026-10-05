import { getProvider, listModels } from './config-service';
import { PROVIDER_CATALOG } from '../provider-catalog';

/** Resolve an agent's provider-scoped model id to the exact alias exposed by LiteLLM. */
export function resolveConfiguredProxyModel(
  modelId: string,
  hints: { providerId?: string | null; baseUrl?: string | null; protocol?: 'messages' } = {},
): { providerId: string; modelAlias: string } | null {
  const normalizedBaseUrl = hints.baseUrl?.replace(/\/$/, '') || null;
  const eligible = listModels().filter(model => {
    const provider = getProvider(model.provider_id);
    if (!provider?.is_active || provider.type === 'openclaw') return false;
    if (hints.protocol === 'messages' && normalizedBaseUrl) {
      // Messages clients append /v1/messages; OpenAI-compatible providers
      // include /v1 in their API base. Compare only these equivalent roots.
      return provider.base_url.replace(/\/$/, '').replace(/\/v1$/, '') === normalizedBaseUrl.replace(/\/v1$/, '');
    }
    if (!hints.providerId && !normalizedBaseUrl) return true;
    return provider.id === hints.providerId || provider.type === hints.providerId ||
      (normalizedBaseUrl !== null && provider.base_url.replace(/\/$/, '') === normalizedBaseUrl);
  });
  const candidates = [modelId];
  if (hints.providerId && modelId.startsWith(`${hints.providerId}/`)) {
    candidates.push(modelId.slice(hints.providerId.length + 1));
  }
  for (const candidate of candidates) {
    const exact = eligible.filter(model => model.model_id === candidate);
    if (exact.length === 1) return { providerId: exact[0].provider_id, modelAlias: exact[0].model_id };
  }
  for (const candidate of candidates) {
    const qualified = eligible.filter(model => {
      const provider = getProvider(model.provider_id);
      if (!provider) return false;
      const capability = PROVIDER_CATALOG.find(item => item.type === provider.type && item.enabled);
      return model.model_id === `${capability?.liteLLMPrefix || provider.type}/${candidate}`;
    });
    if (qualified.length === 1) return { providerId: qualified[0].provider_id, modelAlias: qualified[0].model_id };
  }
  return null;
}
