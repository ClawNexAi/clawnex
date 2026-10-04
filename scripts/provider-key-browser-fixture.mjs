/** Build the real Configuration UI with fake API responses, without a live DB or network. */
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-key-ui-'));
const result = await build({
  absWorkingDir: root, bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ConfigurationPanel } from './src/components/dashboard/panels/ConfigurationPanel';
    import { TooltipsProvider, useTooltipsEnabled } from './src/components/dashboard/tooltip';
    window.__fixtureMutations = [];
    window.fetch = async (url, init) => {
      const endpoint = String(url);
      const method = init?.method || 'GET';
      if (method !== 'GET') {
        window.__fixtureMutations.push({ endpoint, method });
        if (endpoint !== '/api/config/defaults') throw new Error('Unexpected fixture mutation');
        return Response.json({ ok: true });
      }
      if (endpoint === '/api/config/providers') return Response.json({ providers: [
        { id: 'fixture', name: 'Fixture', type: 'openai-compatible', base_url: 'http://localhost:1234/v1', api_key: '••••', models: [] },
        { id: 'fixture-two', name: 'Second fixture', type: 'openai-compatible', base_url: 'http://localhost:1235/v1', api_key: '••••', models: [] }
      ] });
      if (endpoint === '/api/config/defaults') return Response.json({ settings: { tooltips_enabled: '0' } });
      if (endpoint === '/api/auth/me') return Response.json({ rbacEnabled: false });
      return Response.json({}, { status: 404 });
    };
    function Tips() {
      const { enabled, setEnabled } = useTooltipsEnabled();
      return <button id="fixture-tips" onClick={() => setEnabled(!enabled)} aria-pressed={enabled}>TIPS</button>;
    }
    createRoot(document.getElementById('root')).render(<TooltipsProvider><Tips /><ConfigurationPanel focusCard="modelProviders" /></TooltipsProvider>);
  ` },
});
const html = '<!doctype html><html><meta charset="utf-8"><title>Provider key UI fixture</title>'
  + '<body style="margin:24px;background:#080e18;color:#e5eaf3;font-family:system-ui"><div id="clawnex-tooltip-root"></div><div id="root"></div><script>'
  + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(path.join(dir, 'index.html'));
if (process.argv[2]) {
  if (!/^\d+$/.test(process.argv[2])) throw new Error('Supply the ID of a browser tab you opened');
  const flow = JSON.parse(fs.readFileSync(path.join(root, 'scripts/verify-provider-key-browser-flow.json'), 'utf8'));
  const replacements = { TAB_ID: process.argv[2], FIXTURE_PATH: path.join(dir, 'index.html'), SCREENSHOT_PATH: path.join(dir, 'verified.png') };
  const commands = flow.map(command => command.map(arg => replacements[arg] ?? arg));
  fs.writeFileSync(path.join(dir, 'flow.json'), JSON.stringify(commands));
  console.log(path.join(dir, 'flow.json'));
}
