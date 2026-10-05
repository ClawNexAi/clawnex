/** Tested onboarding capabilities. This module is safe to import in the dashboard. */
export const PROVIDER_CATALOG = [
  { type: 'lmstudio', name: 'LM Studio', defaultUrl: 'http://localhost:1234/v1', enabled: true, discoveryPath: 'models', auth: 'optional-bearer', liteLLMPrefix: 'openai' },
  { type: 'openai-compatible', name: 'OpenAI Compatible', defaultUrl: 'http://localhost:8080/v1', enabled: true, discoveryPath: 'models', auth: 'optional-bearer', liteLLMPrefix: 'openai' },
  { type: 'openrouter', name: 'OpenRouter', defaultUrl: 'https://openrouter.ai/api/v1', enabled: true, discoveryPath: 'models', auth: 'verified-bearer', liteLLMPrefix: 'openrouter' },
  { type: 'nvidia-nim', name: 'NVIDIA NIM', defaultUrl: 'https://integrate.api.nvidia.com/v1', enabled: true, discoveryPath: 'models', auth: 'required-bearer', liteLLMPrefix: 'nvidia_nim' },
  ...[
    ['ollama', 'Ollama'], ['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI (GPT)'],
    ['google-gemini', 'Google Gemini'], ['azure-openai', 'Azure OpenAI'], ['groq', 'Groq'],
    ['together', 'Together AI'], ['mistral', 'Mistral AI'], ['cohere', 'Cohere'],
    ['fireworks', 'Fireworks AI'], ['deepseek', 'DeepSeek'], ['perplexity', 'Perplexity'],
  ].map(([type, name]) => ({ type, name, defaultUrl: '', enabled: false, discoveryPath: '', auth: '', liteLLMPrefix: '' })),
] as const;

export class UnsupportedProviderTypeError extends Error {
  constructor() {
    super('Provider type is not supported for tested onboarding. Choose LM Studio, OpenAI Compatible, OpenRouter or NVIDIA NIM. Existing provider records are preserved.');
    this.name = 'UnsupportedProviderTypeError';
  }
}

export function testedProviderCapability(type: unknown) {
  const capability = typeof type === 'string' ? PROVIDER_CATALOG.find(item => item.type === type && item.enabled) : undefined;
  if (!capability) throw new UnsupportedProviderTypeError();
  return capability;
}

export function discoveryModelIds(payload: unknown): string[] {
  const rows = Array.isArray(payload) ? payload : payload && typeof payload === 'object' && 'data' in payload ? payload.data : null;
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || typeof row.id !== 'string' ||
      !row.id.trim() || row.id !== row.id.trim())) throw new Error('Invalid model catalog: expected an array of exact model IDs. Check the provider API root and adapter.');
  return [...new Set(rows.map(row => row.id as string))];
}
