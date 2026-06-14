// scripts/verify-hermes-cost-adapter.ts
/**
 * Verify Hermes cost adapter:
 *  1. Normalization: sample sessions row → canonical row
 *  2. Hermes 'cost_status' field maps to canonical cost_status per trust map
 *     - included → included with actual_cost_usd=0
 *     - estimated + cost_source LIKE '%provider%' → estimated with estimated_cost_usd populated
 *     - actual (unverified in v1) → unknown (orchestrator demotes)
 *  3. agent field is null in v1 (Hermes 'source' is channel/platform, not agent)
 *  4. system_prompt text never appears in returned rows
 *  5. Task 6a: adapter-owned signal_context side-channel
 *     - signal_context.systemPromptHashByRowId populated for fixture rows
 *     - Each hash is a 16-char lowercase-hex string
 *     - Distinct prompts → distinct hashes
 *     - signal_context carries hashes only — no plaintext leak
 *
 * NOTE: tsx CJS transform does not support top-level await — body is wrapped
 * in async main() and dispatched at the bottom.
 */
import { mkdirSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hermesCostAdapter } from '../src/lib/adapters/hermes-cost-adapter';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

async function main() {
  // Build a temp Hermes state.db
  const tmp = join(tmpdir(), `hermes-test-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const dbPath = join(tmp, 'state.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT,
      model_config TEXT, system_prompt TEXT, parent_session_id TEXT,
      started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,
      message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0, billing_provider TEXT,
      billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL,
      actual_cost_usd REAL, cost_status TEXT, cost_source TEXT,
      pricing_version TEXT, title TEXT, api_call_count INTEGER DEFAULT 0
    )
  `);
  const ins = db.prepare(`INSERT INTO sessions (id, source, model, system_prompt, started_at, input_tokens, output_tokens, tool_call_count, cost_status, cost_source, estimated_cost_usd, actual_cost_usd, billing_provider) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // (a) included subscription row
  ins.run('s-included', 'cli', 'gpt-5.4', 'You are an assistant.', Date.now() / 1000, 1000, 100, 5, 'included', 'none', null, null, 'openai');
  // (b) estimated row with provider source
  ins.run('s-estimated', 'telegram', 'gpt-5.4', 'You help users.', Date.now() / 1000, 500, 50, 2, 'estimated', 'provider_models_api', 0.012, null, 'openai');
  // (c) actual row (unverified in v1)
  ins.run('s-actual-unverified', 'cli', 'gpt-5.4', 'Helpful agent.', Date.now() / 1000, 800, 80, 0, 'actual', 'official', null, 0.025, 'openai');
  db.close();

  const result = await hermesCostAdapter.read({ sinceMs: 0, hermesDbPath: dbPath });
  t('Adapter returns hermes source', result.source === 'hermes');
  t('Three rows emitted', result.rows.length === 3);

  const included = result.rows.find(r => r.row_id === 'hermes:s-included')!;
  t('Included row: cost_status=included', included.cost_status === 'included');
  t('Included row: actual_cost_usd=0', included.actual_cost_usd === 0);
  t('Included row: actual_cost_source=hermes_state', included.actual_cost_source === 'hermes_state');
  t('Included row: agent=null in v1', included.agent === null);

  const est = result.rows.find(r => r.row_id === 'hermes:s-estimated')!;
  t('Estimated row: cost_status=estimated', est.cost_status === 'estimated');
  t('Estimated row: estimated_cost_usd populated', est.estimated_cost_usd === 0.012);
  t('Estimated row: estimated_cost_source=hermes_state', est.estimated_cost_source === 'hermes_state');

  const actUnverified = result.rows.find(r => r.row_id === 'hermes:s-actual-unverified')!;
  t('Actual-unverified row: cost_status=unknown (orchestrator handles)', actUnverified.cost_status === 'unknown');
  t('Actual-unverified row: actual_cost_usd=null', actUnverified.actual_cost_usd === null);

  // system_prompt text never in any row
  const rowsJson = JSON.stringify(result.rows);
  t(
    'system_prompt text NOT in returned rows',
    !rowsJson.includes('You are an assistant.') &&
      !rowsJson.includes('You help users.') &&
      !rowsJson.includes('Helpful agent.'),
  );

  // row_id format
  t('row_id format hermes:<sessions.id>', included.row_id === 'hermes:s-included' && est.row_id === 'hermes:s-estimated');

  // --- Task 6a: adapter-owned signal_context side-channel ---
  // The Hermes adapter must populate result.signal_context.systemPromptHashByRowId
  // with a 16-hex-char hash for each fixture row that has a system_prompt.
  // Plaintext must NEVER appear in any value of that map.
  const sc = result.signal_context;
  t('signal_context present on Hermes AdapterResult', sc != null);
  const hashes = sc?.systemPromptHashByRowId ?? {};
  t(
    'signal_context.systemPromptHashByRowId populated for all 3 fixture rows',
    Object.keys(hashes).length === 3 &&
      typeof hashes['hermes:s-included'] === 'string' &&
      typeof hashes['hermes:s-estimated'] === 'string' &&
      typeof hashes['hermes:s-actual-unverified'] === 'string',
  );
  const hexShape = /^[0-9a-f]{16}$/;
  t(
    'every hash is a 16-char lowercase-hex string',
    Object.values(hashes).every(h => hexShape.test(h)),
  );
  // The 3 fixture prompts are distinct, so the 3 hashes must also be distinct.
  const distinctHashCount = new Set(Object.values(hashes)).size;
  t('distinct prompts produce distinct hashes (3 → 3)', distinctHashCount === 3);
  // signal_context carries hashes only — no plaintext leak in the side-channel itself.
  const scJson = JSON.stringify(sc ?? {});
  t(
    'signal_context contains hashes only — no plaintext prompt text',
    !scJson.includes('You are an assistant.') &&
      !scJson.includes('You help users.') &&
      !scJson.includes('Helpful agent.'),
  );

  // Cleanup
  rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
