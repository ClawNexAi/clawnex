// scripts/verify-cost-signal-bloat.ts
/**
 * Verify the context_bloat detector across all six guard paths:
 *
 *  - Same session, last-5 avg > 2× first-5 avg → signal fires.
 *  - <10 rows in session → no signal (min-window guard).
 *  - First-5 avg = 0 → no signal (divide-by-zero / meaningless multiplier).
 *  - Flat tokens (last-5 not > 2× first-5) → no signal.
 *  - Paperclip rows (session_id === null) → never eligible.
 *  - input_tokens null in any compared row → no signal (filtered at intake).
 *
 * NOTE: tsx CJS transform does not support top-level await — body wrapped in
 * async main() and dispatched at the bottom (carry-forward known plan bug #1).
 */
import { detectContextBloat } from '../src/lib/services/cost-signals';
import type { NormalizedRow } from '../src/lib/types/cost-reporting';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

async function main() {
  const baseRow = (
    idx: number,
    sessionId: string | null,
    inputTokens: number | null,
    source: 'openclaw' | 'hermes' | 'paperclip' = 'openclaw',
  ): NormalizedRow => ({
    row_id: `r:${idx}`,
    source,
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    agent: 'a',
    session_id: sessionId,
    source_agent_id: null,
    timestamp: new Date(Date.parse('2026-05-04T00:00:00Z') + idx * 60_000).toISOString(),
    input_tokens: inputTokens,
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
    pricing_version: 'v1',
    row_flags: [],
  });

  // 10 rows in same session, last-5 avg > 2× first-5 avg → fire
  const bloat: NormalizedRow[] = [];
  for (let i = 0; i < 5; i++) bloat.push(baseRow(i, 's-bloat', 100));
  for (let i = 5; i < 10; i++) bloat.push(baseRow(i, 's-bloat', 500));
  const sigs = detectContextBloat(bloat);
  t('Same session, rising tokens → context_bloat fires', sigs.length === 1 && sigs[0].kind === 'context_bloat');

  // <10 rows in session → no signal
  const tooFew = bloat.slice(0, 9);
  t('<10 rows → no signal', detectContextBloat(tooFew).length === 0);

  // First-5 avg = 0 → no signal
  const zeroFirst: NormalizedRow[] = [];
  for (let i = 0; i < 5; i++) zeroFirst.push(baseRow(i, 's-zero', 0));
  for (let i = 5; i < 10; i++) zeroFirst.push(baseRow(i, 's-zero', 500));
  t('First-5 avg = 0 → no signal', detectContextBloat(zeroFirst).length === 0);

  // Last-5 not > 2× first-5 → no signal
  const flat: NormalizedRow[] = [];
  for (let i = 0; i < 10; i++) flat.push(baseRow(i, 's-flat', 100 + i));
  t('Flat tokens → no signal', detectContextBloat(flat).length === 0);

  // Paperclip rows (null session_id) → never fire
  const pc: NormalizedRow[] = [];
  for (let i = 0; i < 10; i++) pc.push(baseRow(i, null, 100 + i * 100, 'paperclip'));
  t('Paperclip null session_id → no signal', detectContextBloat(pc).length === 0);

  // input_tokens null in any compared row → no signal
  const sparseTokens: NormalizedRow[] = [];
  for (let i = 0; i < 10; i++) sparseTokens.push(baseRow(i, 's-sparse', i === 7 ? null : (i < 5 ? 100 : 500)));
  t('input_tokens null in window → no signal', detectContextBloat(sparseTokens).length === 0);

  console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
