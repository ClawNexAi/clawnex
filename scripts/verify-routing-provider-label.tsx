#!/usr/bin/env tsx
/** User-facing provider labels reconcile agent display names with stable config IDs. */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoutingProviderLabel } from '../src/components/dashboard/panels/RoutingWorkflowPanel';

const named = renderToStaticMarkup(<RoutingProviderLabel providerId="lmstudio" displayName="LM Studio-Fleet" />);
assert.match(named, />LM Studio-Fleet</, 'friendly provider name is the primary label');
assert.match(named, /Config ID:/, 'stable config identifier is explained');
assert.match(named, />lmstudio</, 'stable config identifier remains visible');

const unnamed = renderToStaticMarkup(<RoutingProviderLabel providerId="openrouter" displayName="openrouter" />);
assert.equal((unnamed.match(/openrouter/g) || []).length, 1, 'identical names are not repeated');
assert.doesNotMatch(unnamed, /Config ID:/, 'secondary identifier is omitted when redundant');

console.log('PASS: routing provider labels prioritize friendly names without hiding stable config IDs');
