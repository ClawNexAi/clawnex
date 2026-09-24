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
assert.match(routingPanel, /if \(!sources\.length && summary\.status === 'ok'\) sources\.push\(summary\.sourceId\);/,
  'a registered connector remains selectable when its configuration has no routable provider rows');
assert.match(routingPanel, /OpenCode is connected, but its global config has no explicit OpenAI-compatible provider endpoint\./,
  'empty OpenCode provider configuration receives an actionable prerequisite instead of add-instance guidance');

console.log('PASS: connector changes refresh routing and empty OpenCode configuration stays visible with actionable guidance');
