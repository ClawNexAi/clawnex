// scripts/verify-cost-signal-cache-drop.ts
/**
 * Verify the `cache_drop` (Hermes precise) and `cache_drop_risk` (OpenClaw
 * structural fallback) detectors fire only when ALL guards pass:
 *   - cache_read + input non-null per row
 *   - ≥3 comparable trailing days (each passes the volume floor)
 *   - Volume floor: ≥10 calls/day OR ≥50k input+cache tokens/day
 *   - Today's cache ratio < 70% of 7d trailing avg (>30% drop)
 *
 * Time anchor: 2026-05-05T12:00:00Z (mid-day UTC). Rows for "today" sit at
 * tNow − [0..11]m so they share `Math.floor(t / ONE_DAY_MS)` with the anchor;
 * trailing days at `tNow − d*ONE_DAY_MS` land in their own clean buckets.
 * (Same anchor lesson as Task 8 — boundaries are brittle if anchored to
 * midnight UTC because rounding could flip rows across day boundaries.)
 *
 * Plan-level note: top-level `await` doesn't compile under tsx CJS, so this
 * script wraps the body in `async function main()`; we don't actually use
 * `await` here, but the wrapper is preserved for consistency with the
 * rest of the verify-script suite.
 */
import { detectCacheDrop } from '../src/lib/services/cost-signals';
import type { NormalizedRow } from '../src/lib/types/cost-reporting';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

const baseRow = (over: Partial<NormalizedRow>, idx: number): NormalizedRow => ({
  row_id: `r:${idx}`,
  source: 'hermes',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  agent: 'a',
  session_id: 's',
  source_agent_id: null,
  timestamp: new Date(Date.parse('2026-05-04T00:00:00Z') - idx * 60_000).toISOString(),
  input_tokens: 1000,
  output_tokens: 100,
  cache_read_tokens: 5000,
  cache_write_tokens: null,
  reasoning_tokens: null,
  tool_call_count: null,
  currency: 'USD',
  estimated_cost_usd: null,
  actual_cost_usd: null,
  recomputed_cost_usd: 0.01,
  cost_status: 'recomputed',
  estimated_cost_source: null,
  actual_cost_source: null,
  recomputed_cost_source: 'clawnex_recompute',
  pricing_version: 'v1',
  row_flags: [],
  ...over,
});

async function main() {
  const tNow = Date.parse('2026-05-05T12:00:00Z');
  const dayMs = 24 * 60 * 60 * 1000;
  const day = (n: number) => new Date(tNow - n * dayMs).toISOString();

  // Hermes: same hash, ≥3 days, ≥10 calls/day, today's ratio drops >30%
  // 7d trailing: ratio ≈ 5000 / (1000 + 5000) = 0.833
  // Today: ratio ≈ 100 / (1000 + 100) = 0.091  → 89% drop
  const hermesDrop: NormalizedRow[] = [];
  for (let d = 1; d <= 7; d++) {
    for (let i = 0; i < 12; i++) hermesDrop.push(baseRow({ row_id: `h:d${d}-${i}`, timestamp: day(d), cache_read_tokens: 5000, input_tokens: 1000 }, d * 100 + i));
  }
  // Today
  for (let i = 0; i < 12; i++) hermesDrop.push(baseRow({ row_id: `h:t-${i}`, timestamp: new Date(tNow - i * 60_000).toISOString(), cache_read_tokens: 100, input_tokens: 1000 }, i));
  const hSigs = detectCacheDrop(hermesDrop, { now: tNow, systemPromptHashByRowId: Object.fromEntries(hermesDrop.map(r => [r.row_id, 'h_AAAA'])) });
  t('Hermes ≥3 days + cache regression → cache_drop fires', hSigs.some(s => s.kind === 'cache_drop'));

  // OpenClaw fallback uses cache_drop_risk (not cache_drop)
  const ocDrop: NormalizedRow[] = [];
  for (let d = 1; d <= 7; d++) {
    for (let i = 0; i < 12; i++) ocDrop.push(baseRow({ row_id: `oc:d${d}-${i}`, source: 'openclaw', timestamp: day(d), cache_read_tokens: 5000, input_tokens: 1000 }, d * 100 + i));
  }
  for (let i = 0; i < 12; i++) ocDrop.push(baseRow({ row_id: `oc:t-${i}`, source: 'openclaw', timestamp: new Date(tNow - i * 60_000).toISOString(), cache_read_tokens: 100, input_tokens: 1000 }, i));
  const ocSigs = detectCacheDrop(ocDrop, { now: tNow });
  t('OpenClaw cache regression → cache_drop_risk fires (NOT cache_drop)', ocSigs.some(s => s.kind === 'cache_drop_risk') && !ocSigs.some(s => s.kind === 'cache_drop'));

  // Volume floor: <10 calls/day → no signal
  // 5 rows/day × 6000 tokens = 30k tokens/day, below the 50k token floor too.
  const lowVol: NormalizedRow[] = [];
  for (let d = 1; d <= 7; d++) {
    for (let i = 0; i < 5; i++) lowVol.push(baseRow({ row_id: `lv:d${d}-${i}`, timestamp: day(d), cache_read_tokens: 5000, input_tokens: 1000 }, d * 100 + i));
  }
  for (let i = 0; i < 5; i++) lowVol.push(baseRow({ row_id: `lv:t-${i}`, timestamp: new Date(tNow - i * 60_000).toISOString(), cache_read_tokens: 100, input_tokens: 1000 }, i));
  t('<10 calls/day → no signal', detectCacheDrop(lowVol, { now: tNow, systemPromptHashByRowId: Object.fromEntries(lowVol.map(r => [r.row_id, 'h_AAAA'])) }).length === 0);

  // <3 days history → no signal
  const fewDays: NormalizedRow[] = [];
  for (let d = 1; d <= 2; d++) {
    for (let i = 0; i < 12; i++) fewDays.push(baseRow({ row_id: `fd:d${d}-${i}`, timestamp: day(d), cache_read_tokens: 5000, input_tokens: 1000 }, d * 100 + i));
  }
  for (let i = 0; i < 12; i++) fewDays.push(baseRow({ row_id: `fd:t-${i}`, timestamp: new Date(tNow - i * 60_000).toISOString(), cache_read_tokens: 100, input_tokens: 1000 }, i));
  t('<3 days history → no signal', detectCacheDrop(fewDays, { now: tNow, systemPromptHashByRowId: Object.fromEntries(fewDays.map(r => [r.row_id, 'h_AAAA'])) }).length === 0);

  console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
