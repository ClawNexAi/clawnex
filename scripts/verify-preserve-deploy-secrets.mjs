#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./deploy-prod.sh', import.meta.url), 'utf8');

assert.match(source, /if \[ "\$PRESERVE_DATA" = "-1" \]; then\s+PRESERVE_DATA=1\s+fi/,
  'deployments preserve operator data by default');
assert.match(source, /--no-preserve-data\) PRESERVE_DATA=0/,
  'a clean install requires the explicit destructive flag');

for (const [envName, preservedName] of [
  ['SESSION_SECRET', 'PRESERVED_SESSION_SECRET'],
  ['EVIDENCE_ENCRYPTION_KEY', 'PRESERVED_EVIDENCE_ENCRYPTION_KEY'],
  ['CLAWNEX_INGEST_SECRET', 'PRESERVED_INGEST_SECRET'],
  ['LITELLM_MASTER_KEY', 'PRESERVED_LITELLM_MASTER_KEY'],
]) {
  assert.match(source, new RegExp(`${preservedName}=\\$\\(grep -E '\\^${envName}='`),
    `preserved-data deploy reads ${envName} before replacing the installation`);
  assert.match(source, new RegExp(`\\$\\{${preservedName}:-`),
    `preserved-data deploy reuses ${envName} with a fresh-install fallback`);
}

assert.match(source, /SETUP_SECRET=\$\(openssl rand -hex 32\)/,
  'setup secret still rotates for each deployment');

console.log('PASS: preserved-data deploy retains runtime secrets while fresh installs generate them');
