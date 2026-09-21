import type { ConnectorRoutingSummary } from './connector-routing-inventory';

/** A chat-completions receipt alone cannot establish Responses/Messages support. */
export async function assertNativeProtocolReadiness(summary: ConnectorRoutingSummary): Promise<void> {
  if (summary.connector !== 'codex' && summary.connector !== 'claude') return;
  const key = process.env.LITELLM_MASTER_KEY;
  if (!key) throw new Error('The local LiteLLM access key is not configured.');
  const models = [...new Set(summary.items.filter(i => i.present && i.itemType === 'model' && i.desiredRoute === 'routed' && i.capability === 'model-inventory').map(i => String(i.metadata.proxyModelAlias || i.modelId)))];
  for (const model of models) {
    const messages = summary.connector === 'claude';
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${process.env.LITELLM_PORT || '4001'}/v1/${messages ? 'messages' : 'responses'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(messages ? { 'anthropic-version': '2023-06-01' } : {}) },
        body: JSON.stringify(messages ? { model, max_tokens: 32, messages: [{ role: 'user', content: 'Reply OK.' }] } : { model, max_output_tokens: 64, input: 'Reply OK.', stream: false }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch { throw new Error(`${summary.connector} protocol test could not reach the local proxy. Configuration was not changed.`); }
    if (!response.ok) throw new Error(`${summary.connector} ${messages ? 'Messages' : 'Responses'} API test failed (${response.status}) for ${model}. Configuration was not changed.`);
    const data = await response.json().catch(() => null);
    if (!data || data.error || (messages ? !Array.isArray(data.content) : !Array.isArray(data.output))) throw new Error(`${summary.connector} received an incompatible protocol response for ${model}. Configuration was not changed.`);
  }
}
