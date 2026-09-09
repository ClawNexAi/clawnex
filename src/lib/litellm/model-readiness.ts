import fs from 'node:fs';
import YAML from 'yaml';
import { createHash } from 'node:crypto';
import { deploymentRevision } from './deployment-revision';

export interface ProxyModelReadinessOptions {
  configPath: string;
  modelAlias: string;
  port: number;
  approved: boolean;
  proxyKey?: string;
  expectedRevision?: string;
  fetchImpl?: typeof fetch;
  inferenceTimeoutMs?: number;
}

const DEFAULT_INFERENCE_TIMEOUT_MS = 125_000;
export const PROVIDER_READINESS_TTL_MS = 30 * 60 * 1000;

export async function checkProxyModelReadiness(options: ProxyModelReadinessOptions) {
  if (!options.approved) return { ready: false, status: 'approval-required' };
  let selected;
  let fingerprint: string;
  let revision: string;
  try {
    if (fs.statSync(options.configPath).size > 4 * 1024 * 1024) throw new Error('oversized');
    const raw = fs.readFileSync(options.configPath, 'utf8');
    fingerprint = createHash('sha256').update(raw).digest('hex');
    const config = YAML.parse(raw);
    const matches = Array.isArray(config?.model_list)
      ? config.model_list.filter((entry: { model_name?: unknown }) => entry.model_name === options.modelAlias) : [];
    if (matches.length !== 1 || options.modelAlias.includes('*') || options.modelAlias === 'no-provider-configured') {
      return { ready: false, status: 'not-configured' };
    }
    selected = matches[0];
    revision = deploymentRevision(options.configPath, options.modelAlias, selected.litellm_params || {});
    if (options.expectedRevision && options.expectedRevision !== revision) return { ready: false, status: 'reload-required' };
  } catch { return { ready: false, status: 'invalid-configuration' }; }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) return { ready: false, status: 'invalid-configuration' };
  const base = `http://127.0.0.1:${options.port}`;
  const fetchImpl = options.fetchImpl || fetch;
  const inferenceTimeoutMs = options.inferenceTimeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.proxyKey) headers.Authorization = `Bearer ${options.proxyKey}`;
  try {
    const response = await fetchImpl(`${base}/model/info`, {
      headers, signal: AbortSignal.timeout(10000), redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) return { ready: false, status: 'proxy-unavailable' };
    const info = await response.json();
    const matches = Array.isArray(info?.data) ? info.data.filter((entry: { model_name?: string }) => entry.model_name === options.modelAlias) : [];
    if (selected.model_info?.x_clawnex_revision !== revision ||
        matches.length !== 1 || matches[0].model_info?.x_clawnex_revision !== revision ||
        matches[0].litellm_params?.model !== selected.litellm_params?.model ||
        matches[0].litellm_params?.api_base !== selected.litellm_params?.api_base) {
      return { ready: false, status: 'reload-required' };
    }
  } catch { return { ready: false, status: 'proxy-unavailable' }; }
  try {
    const response = await fetchImpl(`${base}/v1/chat/completions`, {
      method: 'POST', headers, signal: AbortSignal.timeout(inferenceTimeoutMs), redirect: 'error',
      body: JSON.stringify({ model: options.modelAlias, stream: false, max_tokens: 128,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        metadata: { clawnex_test: 'provider-readiness' },
      }),
    });
    if (!response.ok) return { ready: false, status: 'inference-failed' };
    const data = await response.json();
    const choice = data?.choices?.[0];
    const message = choice?.message;
    const hasCompletion = (typeof message?.content === 'string' && message.content.trim()) ||
      (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) ||
      (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0);
    if (typeof data?.id !== 'string' || !data.id || !hasCompletion || !choice.finish_reason) {
      return { ready: false, status: 'invalid-response' };
    }
    if (createHash('sha256').update(fs.readFileSync(options.configPath)).digest('hex') !== fingerprint ||
        deploymentRevision(options.configPath, options.modelAlias, selected.litellm_params) !== revision) {
      return { ready: false, status: 'configuration-changed' };
    }
    const checkedAt = new Date();
    return { ready: true, status: 'ready', modelAlias: options.modelAlias, fingerprint,
      revision,
      checkedAt: checkedAt.toISOString(), expiresAt: new Date(checkedAt.getTime() + PROVIDER_READINESS_TTL_MS).toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { ready: false, status: 'inference-timeout' };
    }
    return { ready: false, status: 'inference-failed' };
  }
}
