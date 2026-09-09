#!/usr/bin/env tsx
/** Prevent connector creation from leaving its already-mounted routing panel stale. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routingPanel = fs.readFileSync(path.join(root, 'src/components/dashboard/panels/RoutingWorkflowPanel.tsx'), 'utf8');
const configurationPanel = fs.readFileSync(path.join(root, 'src/components/dashboard/panels/ConfigurationPanel.tsx'), 'utf8');

assert.match(routingPanel, /refreshToken\?: string;/, 'routing panel accepts a connector-registry refresh token');
assert.match(routingPanel, /useEffect\([^\n]+\[refresh, refreshToken\]\);/,
  'connector-registry changes trigger a routing inventory refresh');
assert.match(configurationPanel, /connectors=\{\['opencode'\]\}[\s\S]+refreshToken=\{codingAgentConnectorToken\}/,
  'OpenCode routing receives the current coding-agent connector token');

console.log('PASS: adding or removing a coding-agent connector refreshes its mounted routing panel');
