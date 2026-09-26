import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-launcher-matrix-'));
const bin = path.join(root, 'bin');
const requests = path.join(root, 'requests.jsonl');
const portFile = path.join(root, 'port');
const secret = 'fixture-ingest-secret-that-is-at-least-32-bytes';
const proxyKey = 'fixture-proxy-key';
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(path.join(root, 'scripts'));
fs.copyFileSync(new URL('../clawnex', import.meta.url), path.join(root, 'clawnex'));
fs.copyFileSync(new URL('./clawnex-session-launcher.cjs', import.meta.url), path.join(root, 'scripts', 'clawnex-session-launcher.cjs'));
fs.chmodSync(path.join(root, 'clawnex'), 0o755);

const serverSource = `
const fs=require('fs'),http=require('http');
const out=process.argv[2], portFile=process.argv[3];
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
 fs.appendFileSync(out,JSON.stringify({url:req.url,headers:req.headers,body})+'\\n');
 res.setHeader('content-type','application/json');
 if(req.url==='/model/info') res.end(JSON.stringify({data:[{model_name:'provider/model'}]}));
 else res.end(JSON.stringify({ok:true}));
});});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(portFile,String(server.address().port)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
const serverScript = path.join(root, 'fixture-server.cjs');
fs.writeFileSync(serverScript, serverSource);
const server = spawn(process.execPath, [serverScript, requests, portFile], { stdio: 'inherit' });
for (let i = 0; i < 100 && !fs.existsSync(portFile); i += 1) await new Promise(resolve => setTimeout(resolve, 20));
assert.ok(fs.existsSync(portFile), 'fixture server started');
const port = fs.readFileSync(portFile, 'utf8').trim();
fs.writeFileSync(path.join(root, '.env.local'), `LITELLM_PORT=${port}\nLITELLM_MASTER_KEY=${proxyKey}\nCLAWNEX_INGEST_SECRET=${secret}\n`, { mode: 0o600 });

const harnessSource = `#!/usr/bin/env node
const fs=require('fs'),path=require('path');
const id=path.basename(process.argv[1]); let base='', temp='';
if(id==='codex'){const hit=process.argv.find(x=>x.startsWith('model_providers.clawnex.base_url='));base=JSON.parse(hit.split('=').slice(1).join('='));}
if(id==='claude')base=process.env.ANTHROPIC_BASE_URL+'/v1';
if(id==='opencode')base=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT).provider.clawnex.options.baseURL;
if(id==='pi'){temp=process.env.PI_CODING_AGENT_DIR;const c=JSON.parse(fs.readFileSync(path.join(temp,'models.json'),'utf8'));base=c.providers.clawnex.baseUrl;}
if(id==='hermes'){temp=process.env.HERMES_HOME;const raw=fs.readFileSync(path.join(temp,'config.yaml'),'utf8');base=JSON.parse(raw.match(/base_url: (.+)/)[1]);}
fetch(base+'/probe',{headers:{authorization:'Bearer clawnex-local-session'}}).then(()=>{
 const capture={id,args:process.argv.slice(2),base,temp,env:{
  OPENAI_API_KEY:process.env.OPENAI_API_KEY,ANTHROPIC_AUTH_TOKEN:process.env.ANTHROPIC_AUTH_TOKEN,
  OPENCODE_CONFIG_CONTENT:process.env.OPENCODE_CONFIG_CONTENT,PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR,HERMES_HOME:process.env.HERMES_HOME,
  CLAWNEX_LITELLM_API_KEY:process.env.CLAWNEX_LITELLM_API_KEY,CLAWNEX_ROUTING_IDENTITY:process.env.CLAWNEX_ROUTING_IDENTITY,
 }};fs.writeFileSync(process.env.CAPTURE,JSON.stringify(capture));
}).catch(e=>{console.error(e);process.exitCode=1});
`;
for (const id of ['codex', 'claude', 'opencode', 'pi', 'hermes']) fs.writeFileSync(path.join(bin, id), harnessSource, { mode: 0o755 });

const baseEnv = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` };
for (const id of ['codex', 'claude', 'opencode', 'pi', 'hermes']) {
  const capturePath = path.join(root, `${id}.json`);
  const launcherArgs = ['run', id, '--model', 'provider/model'];
  if (id === 'opencode') launcherArgs.push('--', 'run', 'fixture prompt');
  const run = spawnSync(path.join(root, 'clawnex'), launcherArgs, {
    env: { ...baseEnv, CAPTURE: capturePath, OPENAI_API_KEY: 'must-not-reach-child', ANTHROPIC_API_KEY: 'must-not-reach-child' }, encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${id}: ${run.stderr || run.stdout}`);
  const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
  assert.equal(capture.id, id);
  assert.equal(capture.env.CLAWNEX_LITELLM_API_KEY, undefined);
  assert.equal(capture.env.CLAWNEX_ROUTING_IDENTITY, undefined);
  assert.ok(!JSON.stringify(capture).includes(proxyKey));
  if (id === 'opencode') {
    assert.equal(JSON.parse(capture.env.OPENCODE_CONFIG_CONTENT).model, 'clawnex/provider/model');
    assert.ok(capture.args.includes('--standalone'), 'OpenCode must not reuse a background server with stale configuration');
    assert.deepEqual(capture.args.slice(0, 2), ['run', '--standalone']);
  }
  if (capture.temp) assert.equal(fs.existsSync(path.dirname(capture.temp)), false);
}

const logged = fs.readFileSync(requests, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const probes = logged.filter(request => request.url.endsWith('/probe'));
assert.equal(probes.length, 5);
for (const request of probes) {
  assert.equal(request.headers.authorization, `Bearer ${proxyKey}`);
  const token = request.headers['x-clawnex-routing-identity'];
  assert.equal(typeof token, 'string');
  const [payload, signature] = token.split('.');
  assert.equal(signature, crypto.createHmac('sha256', secret).update(`clawnex-routing-v1:${payload}`).digest('base64url'));
  const identity = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.ok(['codex', 'claude', 'opencode', 'pi', 'hermes'].includes(identity.connector));
}

const dryRun = spawnSync(path.join(root, 'clawnex'), ['run', 'codex', '--model', 'provider/model', '--dry-run'], { env: baseEnv, encoding: 'utf8' });
assert.equal(dryRun.status, 0, dryRun.stderr);
assert.match(dryRun.stdout, /Safety: normal harness approvals and sandbox/);
assert.match(dryRun.stdout, /Config files changed: none/);
assert.ok(!dryRun.stdout.includes(proxyKey) && !dryRun.stdout.includes(secret));

for (const id of ['codex', 'claude', 'opencode', 'pi', 'hermes']) {
  const unsafeFlag = id === 'claude' ? '--dangerously-skip-permissions' : '--yolo';
  const rejected = spawnSync(path.join(root, 'clawnex'), ['run', id, '--model', 'provider/model', '--', unsafeFlag], { env: baseEnv, encoding: 'utf8' });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /normal safety controls/);
}

for (const [id, flag] of [['claude', '-p'], ['pi', '-p'], ['opencode', '-c']]) {
  const accepted = spawnSync(path.join(root, 'clawnex'), ['run', id, '--model', 'provider/model', '--dry-run', '--', flag, 'safe argument'], { env: baseEnv, encoding: 'utf8' });
  assert.equal(accepted.status, 0, `${id} should accept its safe ${flag} flag: ${accepted.stderr}`);
}
for (const flag of ['-c', '-p']) {
  const rejected = spawnSync(path.join(root, 'clawnex'), ['run', 'codex', '--model', 'provider/model', '--dry-run', '--', flag, 'override'], { env: baseEnv, encoding: 'utf8' });
  assert.equal(rejected.status, 2, `Codex ${flag} must remain blocked`);
}

server.kill('SIGTERM');
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS: five-harness launcher matrix uses a signed secret-isolating session bridge and safe defaults');
