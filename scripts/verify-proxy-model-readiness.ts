import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { deploymentRevision } from '../src/lib/litellm/deployment-revision';
import { checkProxyModelReadiness, PROVIDER_READINESS_TTL_MS } from '../src/lib/litellm/model-readiness';

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-model-readiness-'));
  try {
    const configPath = path.join(temp, 'config.yaml');
    fs.writeFileSync(configPath, YAML.stringify({ model_list: [{ model_name: 'fixture-model',
      litellm_params: { model: 'openai/fixture-model', api_base: 'https://example.test/v1', api_key: 'fixture-key' },
    }] }));
    let requests = 0;
    const fetchImpl: typeof fetch = async () => { requests++; throw new Error('Unexpected network request'); };
    const result = await checkProxyModelReadiness({ configPath, modelAlias: 'fixture-model', port: 4001, approved: false, fetchImpl });
    assert.equal(result.ready, false);
    assert.equal(result.status, 'approval-required');
    assert.equal(requests, 0);
    console.log('PASS: inference requires explicit consent before any network request');
    const unknown = await checkProxyModelReadiness({ configPath, modelAlias: 'unselected-model', port: 4001, approved: true, fetchImpl });
    assert.equal(unknown.status, 'not-configured');
    assert.equal(requests, 0);
    console.log('PASS: unselected aliases cannot trigger an upstream probe');
    const stale = await checkProxyModelReadiness({ configPath, modelAlias: 'fixture-model', port: 4001, approved: true,
      fetchImpl: async input => {
        assert.equal(String(input), 'http://127.0.0.1:4001/model/info');
        return Response.json({ data: [{ model_name: 'fixture-model', litellm_params: { model: 'openai/wrong-model' } }] });
      },
    });
    assert.equal(stale.status, 'reload-required');
    assert.equal(stale.ready, false);
    console.log('PASS: matching alias with stale live deployment does not run inference');
    const loaded = YAML.parse(fs.readFileSync(configPath, 'utf8')).model_list;
    loaded[0].model_info = { x_clawnex_revision: deploymentRevision(configPath, 'fixture-model', loaded[0].litellm_params) };
    fs.writeFileSync(configPath, YAML.stringify({ model_list: loaded }));
    let completionStatus = 200;
    let completionBody: unknown = { id: 'fixture-response', choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] };
    const proxy: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/model/info')) return Response.json({ data: loaded });
      assert.equal(String(input), 'http://127.0.0.1:4001/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'fixture-model');
      assert.equal(body.stream, false);
      assert.equal(body.messages[0].content, 'Reply with OK.');
      return Response.json(completionBody, { status: completionStatus });
    };
    const ready = await checkProxyModelReadiness({ configPath, modelAlias: 'fixture-model', port: 4001, approved: true, fetchImpl: proxy });
    assert.equal(ready.ready, true);
    assert.ok(ready.expiresAt && ready.checkedAt);
    assert.equal(Date.parse(ready.expiresAt) - Date.parse(ready.checkedAt), PROVIDER_READINESS_TTL_MS);
    console.log('PASS: readiness remains usable for a multi-model routing review window');
    completionStatus = 401;
    const rejected = await checkProxyModelReadiness({ configPath, modelAlias: 'fixture-model', port: 4001, approved: true, fetchImpl: proxy });
    assert.equal(rejected.ready, false);
    completionStatus = 200;
    completionBody = { choices: [] };
    const malformed = await checkProxyModelReadiness({ configPath, modelAlias: 'fixture-model', port: 4001, approved: true, fetchImpl: proxy });
    assert.equal(malformed.ready, false);
    console.log('PASS: only a successful selected-model completion establishes readiness');
    const timeoutProxy: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/model/info')) return Response.json({ data: loaded });
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error('Missing timeout signal'));
        if (signal.aborted) return reject(signal.reason);
        const guard = setTimeout(() => reject(new Error('Expected the injected timeout to abort first')), 100);
        signal.addEventListener('abort', () => { clearTimeout(guard); reject(signal.reason); }, { once: true });
      });
    };
    const timedOut = await checkProxyModelReadiness({ configPath, modelAlias: 'fixture-model', port: 4001,
      approved: true, fetchImpl: timeoutProxy, inferenceTimeoutMs: 5 });
    assert.equal(timedOut.ready, false);
    assert.equal(timedOut.status, 'inference-timeout');
    console.log('PASS: slow upstream completion is reported as a timeout instead of a generic provider failure');
    completionBody = { id: 'fixture-response', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] };
    const edited = structuredClone(loaded);
    edited[0].litellm_params.api_key = 'changed-key';
    fs.writeFileSync(configPath, YAML.stringify({ model_list: edited }));
    const oldKey = await checkProxyModelReadiness({ configPath, modelAlias: 'fixture-model', port: 4001, approved: true, fetchImpl: proxy });
    assert.equal(oldKey.ready, false);
    assert.equal(oldKey.status, 'reload-required');
    console.log('PASS: credential edits invalidate the loaded deployment identity');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
