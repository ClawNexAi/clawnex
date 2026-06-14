// scripts/verify-cost-signal-loop-risk.ts
/**
 * Verify the loop_risk detector across all three sources:
 *
 *  - OpenClaw: ≥5 rows in same session_id + model, input_tokens within ±5%,
 *    within 10 min, repeated stopReason → fires.
 *  - OpenClaw insufficient rows (4) → no signal.
 *  - OpenClaw token diff >5% → no signal.
 *  - Hermes: hash(system_prompt) repeated across ≥3 sessions within 24h with
 *    rising input_tokens → fires (agent=null per Gate A — adapter emits null).
 *  - Hermes negative: 3 rows with DIFFERENT hashes → no signal.
 *  - Paperclip: ≥5 events same source_agent_id + model within 10 min → fires.
 *
 * NOTE: tsx CJS transform does not support top-level await — body wrapped in
 * async main() and dispatched at the bottom (carry-forward known plan bug #1).
 */
import { detectLoopRisk } from '../src/lib/services/cost-signals';
import type { NormalizedRow } from '../src/lib/types/cost-reporting';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

const baseRow = (over: Partial<NormalizedRow>, idx: number): NormalizedRow => ({
  row_id: `test:${idx}`,
  source: 'openclaw',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  agent: 'a',
  session_id: 's-1',
  source_agent_id: null,
  timestamp: new Date(Date.now() + idx * 60_000).toISOString(),
  input_tokens: 100,
  output_tokens: 50,
  cache_read_tokens: null,
  cache_write_tokens: null,
  reasoning_tokens: null,
  tool_call_count: null,
  currency: 'USD',
  estimated_cost_usd: null,
  actual_cost_usd: null,
  recomputed_cost_usd: null,
  cost_status: 'recomputed',
  estimated_cost_source: null,
  actual_cost_source: null,
  recomputed_cost_source: 'clawnex_recompute',
  pricing_version: 'test',
  row_flags: [],
  ...over,
});

async function main() {
  // OpenClaw — 5 rows same session, model, tokens within ±5%, within 10 min,
  // repeated stopReason → should fire.
  const tNow = Date.parse('2026-05-04T00:00:00Z');
  const ocLoop: NormalizedRow[] = [];
  for (let i = 0; i < 5; i++) {
    ocLoop.push(baseRow({
      row_id: `oc:${i}`,
      timestamp: new Date(tNow + i * 60_000).toISOString(), // every minute
      input_tokens: 100 + (i % 2), // within ±5%
    }, i));
  }
  const ocSignals = detectLoopRisk(ocLoop, {
    stopReasonByRowId: Object.fromEntries(ocLoop.map(r => [r.row_id, 'stop'])),
  });
  t('OpenClaw 5 same-session same-model rows → loop_risk fires',
    ocSignals.length === 1 && ocSignals[0].kind === 'loop_risk');
  t('Signal references all 5 rows', ocSignals[0]?.affected_row_ids.length === 5);

  // OpenClaw — only 4 rows → should NOT fire.
  const ocBelow = ocLoop.slice(0, 4);
  t('OpenClaw 4 rows → no signal', detectLoopRisk(ocBelow, {}).length === 0);

  // OpenClaw — 5 rows but token diff > 5% → should NOT fire.
  const ocWideToken = ocLoop.map(r => ({ ...r, input_tokens: r.input_tokens! + (50 * Math.random() | 0) }));
  ocWideToken[0].input_tokens = 100;
  ocWideToken[1].input_tokens = 200;
  t('OpenClaw token diff >5% → no signal', detectLoopRisk(ocWideToken, {}).length === 0);

  // Hermes — 3 sessions same system_prompt_hash, rising tokens, agent=null
  // (matches the real adapter contract per Gate A; agent identity is not
  // available for Hermes in v1).
  const hermesRows: NormalizedRow[] = [
    baseRow({ row_id: 'h:1', source: 'hermes', agent: null, session_id: 'sess-a', input_tokens: 100, timestamp: new Date(tNow).toISOString() }, 1),
    baseRow({ row_id: 'h:2', source: 'hermes', agent: null, session_id: 'sess-b', input_tokens: 200, timestamp: new Date(tNow + 60 * 60_000).toISOString() }, 2),
    baseRow({ row_id: 'h:3', source: 'hermes', agent: null, session_id: 'sess-c', input_tokens: 300, timestamp: new Date(tNow + 120 * 60_000).toISOString() }, 3),
  ];
  const hSignals = detectLoopRisk(hermesRows, {
    systemPromptHashByRowId: { 'h:1': 'h_AAAA', 'h:2': 'h_AAAA', 'h:3': 'h_AAAA' },
  });
  t('Hermes 3 same-hash agent=null rising tokens → loop_risk fires',
    hSignals.length === 1 && hSignals[0].kind === 'loop_risk');

  // Hermes negative — 3 rows with DIFFERENT hashes → no cohort, no signal.
  // Validates the hash-only grouping doesn't false-fire when prompts diverge.
  const hermesNegSignals = detectLoopRisk(hermesRows, {
    systemPromptHashByRowId: { 'h:1': 'h_AAAA', 'h:2': 'h_BBBB', 'h:3': 'h_CCCC' },
  });
  t('Hermes 3 rows with different hashes → no signal',
    hermesNegSignals.length === 0);

  // Paperclip — 5 events same agentId + model within 10 min.
  const pcRows: NormalizedRow[] = [];
  for (let i = 0; i < 5; i++) {
    pcRows.push(baseRow({
      row_id: `pc:${i}`,
      source: 'paperclip',
      source_agent_id: 'uuid-xx',
      timestamp: new Date(tNow + i * 60_000).toISOString(),
    }, 100 + i));
  }
  const pcSignals = detectLoopRisk(pcRows, {});
  t('Paperclip 5 same-agent same-model events within 10 min → loop_risk fires',
    pcSignals.length === 1);

  console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
