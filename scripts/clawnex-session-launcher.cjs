#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const installDir = path.resolve(__dirname, '..');
const harnesses = {
  codex: { label: 'Codex', protocol: 'responses', bin: 'codex', sourceId: 'codex:global' },
  claude: { label: 'Claude Code', protocol: 'messages', bin: 'claude', sourceId: 'claude:global' },
  opencode: { label: 'OpenCode', protocol: 'chat', bin: 'opencode', sourceId: 'opencode:global' },
  pi: { label: 'Pi', protocol: 'chat', bin: 'pi', sourceId: 'pi:global' },
  hermes: { label: 'Hermes', protocol: 'chat', bin: 'hermes', sourceId: 'hermes:session' },
};

const fail = (message, status = 1) => {
  process.stderr.write(`  ✗ ${message}\n`);
  process.exit(status);
};

function parseArgs(argv) {
  const harnessId = argv.shift();
  const harness = harnesses[harnessId];
  if (!harness) fail('Usage: clawnex run <codex|claude|opencode|pi|hermes> --model <alias> [-- harness arguments]', 2);
  let model = '';
  let dryRun = false;
  let extraArgs = [];
  while (argv.length) {
    const arg = argv.shift();
    if (arg === '--model' || arg === '-m') {
      if (!argv.length) fail('--model requires a configured ClawNex model alias', 2);
      model = argv.shift();
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--') {
      extraArgs = argv.splice(0);
    } else {
      fail(`Unknown launcher option: ${arg}. Put ${harness.label} arguments after --`, 2);
    }
  }
  if (!model) fail(`Select a model: clawnex run ${harnessId} --model <alias>`, 2);
  if (/[\r\n]/.test(model)) fail('Model aliases cannot contain line breaks', 2);
  const forbidden = new Set([
    '--config', '--profile', '-m', '--model', '--model-provider', '--model_provider',
    '--provider', '--api-key', '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-skip-permissions', '--yolo', '--full-auto',
  ]);
  if (harnessId === 'codex') {
    forbidden.add('-c');
    forbidden.add('-p');
  }
  const unsafe = extraArgs.find(arg => forbidden.has(arg) || arg.startsWith('--model=') || arg.startsWith('--provider='));
  if (unsafe) fail(`${unsafe} can override the inspected route or normal safety controls and is not accepted by this launcher`, 2);
  return { harnessId, harness, model, dryRun, extraArgs };
}

function readEnvironment() {
  const envPath = path.join(installDir, '.env.local');
  let stat;
  try { stat = fs.lstatSync(envPath); } catch { fail(`Missing safe ClawNex environment file: ${envPath}`); }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`Missing safe ClawNex environment file: ${envPath}`);
  const values = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  const proxyKey = values.LITELLM_MASTER_KEY || '';
  const ingestSecret = values.CLAWNEX_INGEST_SECRET || '';
  const proxyPort = Number(values.LITELLM_PORT || 4001);
  if (!proxyKey) fail('LITELLM_MASTER_KEY is not configured');
  if (Buffer.byteLength(ingestSecret) < 32) fail('CLAWNEX_INGEST_SECRET must contain at least 32 bytes');
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) fail('LITELLM_PORT is invalid');
  return { proxyKey, ingestSecret, proxyPort };
}

function findBinary(bin) {
  const candidates = [
    ...(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, bin)),
    path.join(os.homedir(), '.npm-global', 'bin', bin),
    path.join(os.homedir(), '.local', 'bin', bin),
    path.join(os.homedir(), '.bun', 'bin', bin),
    path.join(os.homedir(), '.cargo', 'bin', bin),
    `/usr/local/bin/${bin}`,
    `/opt/homebrew/bin/${bin}`,
  ];
  return [...new Set(candidates)].find(candidate => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
  }) || null;
}

function routingIdentity(secret, connector, sourceId) {
  const value = { v: 1, connector, sourceId, nonce: crypto.randomBytes(16).toString('hex') };
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`clawnex-routing-v1:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

async function assertModelLoaded(model, proxyKey, proxyPort) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${proxyPort}/model/info`, {
      headers: { authorization: `Bearer ${proxyKey}` }, signal: AbortSignal.timeout(10000),
    });
  } catch {
    fail(`LiteLLM is not reachable on 127.0.0.1:${proxyPort}`);
  }
  if (!response.ok) fail(`LiteLLM model inventory returned HTTP ${response.status}`);
  let body;
  try { body = await response.json(); } catch { fail('LiteLLM returned an invalid model inventory'); }
  const matches = Array.isArray(body?.data) ? body.data.filter(row => row?.model_name === model) : [];
  if (matches.length !== 1) fail(`Model alias '${model}' is not uniquely loaded in LiteLLM`);
}

function anthropicSse(message) {
  const events = [];
  const emit = (event, data) => events.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const content = Array.isArray(message.content) ? message.content : [];
  emit('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, stop_sequence: null,
    usage: { ...(message.usage || {}), output_tokens: 0 } } });
  content.forEach((block, index) => {
    if (block?.type === 'tool_use') {
      emit('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      emit('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input || {}) } });
    } else if (block?.type === 'thinking') {
      emit('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } });
      emit('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking || '' } });
      if (block.signature) emit('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else {
      emit('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      emit('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block?.text || '' } });
    }
    emit('content_block_stop', { type: 'content_block_stop', index });
  });
  emit('message_delta', { type: 'message_delta', delta: { stop_reason: message.stop_reason || 'end_turn', stop_sequence: message.stop_sequence || null },
    usage: { output_tokens: message.usage?.output_tokens || 0 } });
  emit('message_stop', { type: 'message_stop' });
  return events.join('');
}

function startBridge({ proxyKey, proxyPort, identity, harnessId }) {
  const blocked = new Set(['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'authorization', 'x-clawnex-routing-identity']);
  const server = http.createServer((request, response) => {
    const headers = {};
    for (const [name, value] of Object.entries(request.headers)) if (!blocked.has(name.toLowerCase()) && value !== undefined) headers[name] = value;
    headers.authorization = `Bearer ${proxyKey}`;
    headers['x-clawnex-routing-identity'] = identity;
    headers.host = `127.0.0.1:${proxyPort}`;
    const forward = (body, messagesStream = false) => {
      if (body) headers['content-length'] = String(body.length);
      const upstream = http.request({ host: '127.0.0.1', port: proxyPort, method: request.method, path: request.url, headers }, upstreamResponse => {
        if (!messagesStream || (upstreamResponse.statusCode || 500) >= 300) {
          response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
          return;
        }
        const chunks = [];
        let size = 0;
        upstreamResponse.on('data', chunk => {
          size += chunk.length;
          if (size <= 8 * 1024 * 1024) chunks.push(chunk);
        });
        upstreamResponse.on('end', () => {
          try {
            if (size > 8 * 1024 * 1024) throw new Error('Messages response exceeded 8 MiB');
            const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
            response.end(anthropicSse(message));
          } catch (error) {
            response.writeHead(502, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: { message: `ClawNex could not adapt the Messages response: ${error.message}` } }));
          }
        });
      });
      upstream.on('error', error => {
        if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: `ClawNex session bridge could not reach LiteLLM: ${error.message}` } }));
      });
      if (body) upstream.end(body);
      else request.pipe(upstream);
    };
    if (harnessId !== 'claude' || request.method !== 'POST' || !request.url?.startsWith('/v1/messages')) {
      forward(null);
      return;
    }
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size <= 8 * 1024 * 1024) chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > 8 * 1024 * 1024) {
        response.writeHead(413, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Messages request exceeded 8 MiB' } }));
        return;
      }
      const raw = Buffer.concat(chunks);
      try {
        const body = JSON.parse(raw.toString('utf8'));
        if (body.stream !== true) {
          forward(raw);
          return;
        }
        body.stream = false;
        forward(Buffer.from(JSON.stringify(body)), true);
      } catch {
        forward(raw);
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function privateFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, contents, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function buildPlan(harnessId, model, bridgePort, binary, extraArgs) {
  const v1 = `http://127.0.0.1:${bridgePort}/v1`;
  const root = `http://127.0.0.1:${bridgePort}`;
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_ORG_ID', 'OPENAI_ORGANIZATION', 'CODEX_API_KEY', 'OMNIROUTE_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete env[key];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `clawnex-${harnessId}-`));
  let args;
  if (harnessId === 'codex') {
    env.CLAWNEX_SESSION_KEY = 'clawnex-local-session';
    args = [
      '-c', 'model_provider="clawnex"', '-c', 'model_providers.clawnex.name="ClawNex"',
      '-c', `model_providers.clawnex.base_url="${v1}"`, '-c', 'model_providers.clawnex.env_key="CLAWNEX_SESSION_KEY"',
      '-c', 'model_providers.clawnex.wire_api="responses"', '-c', 'model_providers.clawnex.requires_openai_auth=false',
      '-c', 'model_providers.clawnex.supports_websockets=false', '--model', model,
    ];
  } else if (harnessId === 'claude') {
    Object.assign(env, {
      ANTHROPIC_BASE_URL: root, ANTHROPIC_AUTH_TOKEN: 'clawnex-local-session', ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
    });
    args = ['--model', model];
  } else if (harnessId === 'opencode') {
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      model: `clawnex/${model}`,
      provider: { clawnex: { npm: '@ai-sdk/openai-compatible', name: 'ClawNex', options: { baseURL: v1, apiKey: 'clawnex-local-session' }, models: { [model]: { name: model } } } },
    });
    args = extraArgs[0] === 'run'
      ? ['run', '--standalone', ...extraArgs.slice(1)]
      : ['--standalone', ...extraArgs];
    extraArgs = [];
  } else if (harnessId === 'pi') {
    const piDir = path.join(tempDir, 'pi');
    privateFile(path.join(piDir, 'models.json'), `${JSON.stringify({ providers: { clawnex: {
      baseUrl: v1, apiKey: 'clawnex-local-session', authHeader: true, api: 'openai-completions',
      models: [{ id: model, name: `${model} · ClawNex`, contextWindow: 131072, maxTokens: 16384,
        input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } }, null, 2)}\n`);
    env.PI_CODING_AGENT_DIR = piDir;
    args = ['--provider', 'clawnex', '--model', model];
  } else {
    const hermesHome = path.join(tempDir, 'hermes');
    const q = JSON.stringify;
    privateFile(path.join(hermesHome, 'config.yaml'),
      `model:\n  default: ${q(model)}\n  provider: ${q('custom:clawnex')}\n  base_url: ${q(v1)}\n` +
      `custom_providers:\n  - name: clawnex\n    base_url: ${q(v1)}\n    model: ${q(model)}\n    api_key: clawnex-local-session\n    api_mode: chat_completions\n`);
    env.HERMES_HOME = hermesHome;
    env.OPENAI_API_KEY = 'clawnex-local-session';
    args = ['--model', model, '--provider', 'clawnex'];
  }
  return { binary, args: [...args, ...extraArgs], env, tempDir, v1 };
}

async function main() {
  const { harnessId, harness, model, dryRun, extraArgs } = parseArgs(process.argv.slice(2));
  const { proxyKey, ingestSecret, proxyPort } = readEnvironment();
  const binary = findBinary(harness.bin);
  if (!binary) fail(`${harness.label} is not installed or is not in a supported executable directory`);
  await assertModelLoaded(model, proxyKey, proxyPort);
  if (dryRun) {
    process.stdout.write(`${harness.label} inspected-session launch is ready\n  Model: ${model}\n  Protocol: ${harness.protocol}\n  Proxy: http://127.0.0.1:${proxyPort}/v1\n  Identity: signed session bridge\n  Safety: normal harness approvals and sandbox\n  Config files changed: none\n`);
    return;
  }
  const identity = routingIdentity(ingestSecret, harnessId, harness.sourceId);
  const { server, port } = await startBridge({ proxyKey, proxyPort, identity, harnessId });
  let plan;
  let child;
  const stop = signal => { if (child && !child.killed) child.kill(signal); };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  try {
    plan = buildPlan(harnessId, model, port, binary, extraArgs);
    child = spawn(plan.binary, plan.args, { cwd: process.cwd(), env: plan.env, stdio: 'inherit' });
    const status = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    if (status.signal) process.exitCode = status.signal === 'SIGINT' ? 130 : 1;
    else process.exitCode = status.code ?? 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (plan?.tempDir) fs.rmSync(plan.tempDir, { recursive: true, force: true });
  }
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)));
