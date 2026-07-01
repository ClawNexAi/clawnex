import fs from 'node:fs';
import { getLiteLLMSyncTags, getSyncUrl } from '../src/lib/services/model-pricing-store';

function check(name: string, condition: boolean): void {
  if (!condition) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: ${name}`);
}

const stableTags = getLiteLLMSyncTags('1.84.10');
check('stable LiteLLM pin tries the exact release tag first', stableTags[0] === 'v1.84.10');
check('stable LiteLLM pin has no fallback tags', stableTags.length === 1);

const prefixedTags = getLiteLLMSyncTags('v1.84.10');
check('leading v is normalized without duplicating the prefix', prefixedTags[0] === 'v1.84.10');

let rejectedNightly = false;
try {
  getLiteLLMSyncTags('1.84.10-nightly');
} catch {
  rejectedNightly = true;
}
check('nightly LiteLLM pins are rejected', rejectedNightly);

check(
  'sync URL points at the exact release tag path',
  getSyncUrl(stableTags[0]) === 'https://raw.githubusercontent.com/BerriAI/litellm/v1.84.10/model_prices_and_context_window.json',
);

const chatRoute = fs.readFileSync('src/app/api/chat/route.ts', 'utf-8');
check('operator assistant no longer references nightly pricing sync', !/nightly/i.test(chatRoute));

if (process.exitCode) process.exit(process.exitCode);
