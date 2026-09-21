#!/usr/bin/env tsx
/** Keep the OpenClaw apply → restart → verify workflow actionable in one panel. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/dashboard/panels/RoutingWorkflowPanel.tsx'),
  'utf8',
);
const restartRoute = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/openclaw/gateway/restart/route.ts'),
  'utf8',
);

assert.match(source, /fetch\('\/api\/openclaw\/gateway\/restart', \{ method: 'POST' \}\)/,
  'restart action calls the audited OpenClaw gateway restart endpoint');
assert.match(source, /aria-label="Restart OpenClaw instance"/,
  'routed OpenClaw instances expose a restart control');
assert.match(source, /disabled=\{busy \|\| !sourceId \|\| pending\} onClick=\{restartOpenClaw\}/,
  'OpenClaw restart remains available after restoring the final routed provider');
assert.match(source, /Send one new OpenClaw request, then verify the connection\./,
  'successful restart explains the final evidence step');
assert.match(source, /Manual command:/,
  'unsupported supervisors surface the safe manual fallback');
assert.match(restartRoute, /connector: 'openclaw',[\s\S]*sourceId: 'default',[\s\S]*operation: 'restart'/,
  'OpenClaw restarts reset evidence for the routed default instance');

console.log('PASS: OpenClaw routing exposes restart and verification guidance');
