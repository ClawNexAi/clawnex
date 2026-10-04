import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderApiKeyInput } from '../src/components/dashboard/ProviderApiKeyInput';

const markup = renderToStaticMarkup(<ProviderApiKeyInput
  label="Replacement API key for Fixture"
  value=""
  onChange={() => { throw new Error('Rendering must not change the key'); }}
  placeholder="Leave blank to keep the saved key"
  inputStyle={{ width: '100%' }}
/>);
assert.match(markup, /type="password"/, 'Keys are hidden by default');
assert.match(markup, /aria-label="Replacement API key for Fixture"/, 'The input has an accessible name');
assert.match(markup, /type="button"/, 'Show key does not submit the form');
assert.match(markup, /aria-pressed="false"/, 'Visibility state is announced');
assert.match(markup, />Show key<\//, 'A visible keyboard-accessible Show key button is available');
assert.match(markup, /autocomplete="new-password"/i, 'Do not request stored login autofill');
assert.doesNotMatch(markup, /value="[^"]+"/, 'An empty replacement field contains no stored credential');
console.log('PASS: provider key input is hidden by default and has an accessible, non-submitting visibility control');
