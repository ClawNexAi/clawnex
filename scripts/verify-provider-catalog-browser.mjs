/** Render the real Configuration panel with fake HTTP; no dashboard server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = await import(pathToFileURL(process.env.CLAWNEX_PLAYWRIGHT_MODULE || require.resolve('playwright')).href);
const fixture = spawnSync(process.execPath, ['scripts/provider-key-browser-fixture.mjs'], { encoding: 'utf8' });
assert.equal(fixture.status, 0, fixture.stderr);
const fixturePath = fixture.stdout.trim();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'http://clawnex-provider.test/'
    ? route.fulfill({ contentType: 'text/html', body: fs.readFileSync(fixturePath, 'utf8') }) : route.abort());
  await page.goto('http://clawnex-provider.test/');
  const selector = page.locator('select').filter({ has: page.locator('option[value="lmstudio"]') });
  await selector.waitFor();
  const enabled = await selector.locator('option:enabled').evaluateAll(options => options.map(option => option.value));
  assert.deepEqual(enabled.sort(), ['lmstudio', 'nvidia-nim', 'openai-compatible', 'openrouter']);
  assert.equal(await selector.locator('option:disabled').count(), 12);
  for (const [type, url] of [
    ['lmstudio', 'http://localhost:1234/v1'], ['openai-compatible', 'http://localhost:8080/v1'],
    ['openrouter', 'https://openrouter.ai/api/v1'], ['nvidia-nim', 'https://integrate.api.nvidia.com/v1'],
  ]) {
    await selector.selectOption(type);
    assert.equal(await page.getByPlaceholder('http://localhost:1234/v1', { exact: true }).inputValue(), url);
  }
  assert.equal(await page.getByText('Only tested onboarding adapters can be added.', { exact: false }).count(), 1);
  assert.equal(await page.evaluate(() => window.__fixtureMutations.length), 0, 'picker changes never submit configuration');
  assert.deepEqual(errors, []);
  const screenshot = path.join(path.dirname(fixturePath), 'provider-catalog.png');
  await selector.scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshot });
  console.log('PASS: real provider picker enables four tested families, disables twelve untested adapters, applies defaults and sends no writes');
  console.log(`Evidence: ${screenshot}`);
} finally { await browser.close(); }
