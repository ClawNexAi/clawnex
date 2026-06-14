// scripts/verify-cost-signal-velocity.ts
/**
 * Verify the velocity_spike detector across all four guard paths:
 *
 *  - Insufficient history (<24 hourly buckets) → no signal.
 *  - 7d steady $1/hr baseline + current hour 5× → spike fires.
 *  - Zero baseline (no historical spend) → no signal even if current hour
 *    spikes hard.
 *  - Current hour at 3× (below 4× threshold) → no signal.
 *
 * NOTE: tsx CJS transform does not support top-level await — body wrapped in
 * async main() and dispatched at the bottom (carry-forward known plan bug #1).
 */
import { detectVelocitySpike } from '../src/lib/services/cost-signals';
import type { NormalizedRow } from '../src/lib/types/cost-reporting';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

async function main() {
  // Anchor mid-hour (12:55 UTC) so the "current hour" spike rows placed
  // 30-50 min before tNow land in the SAME hour bucket as tNow itself.
  // (Plan-bug carry-forward: the plan's literal `12:00:00Z` anchor put those
  // rows in the previous bucket, which made the spike test fail.)
  const tNow = Date.parse('2026-05-05T12:55:00Z'); // current-hour anchor
  const baseRow = (timestamp: string, cost: number, idx: number): NormalizedRow => ({
    row_id: `r:${idx}`,
    source: 'hermes',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    agent: 'a',
    session_id: 's',
    source_agent_id: null,
    timestamp,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
    tool_call_count: null,
    currency: 'USD',
    estimated_cost_usd: null,
    actual_cost_usd: null,
    recomputed_cost_usd: cost,
    cost_status: 'recomputed',
    estimated_cost_source: null,
    actual_cost_source: null,
    recomputed_cost_source: 'clawnex_recompute',
    pricing_version: 'v1',
    row_flags: [],
  });

  // 1. Insufficient history: <24 hours of data → no signal.
  const sparse: NormalizedRow[] = [];
  for (let h = 0; h < 5; h++) sparse.push(baseRow(new Date(tNow - h * 3600_000).toISOString(), 1, h));
  t('Insufficient history → no signal', detectVelocitySpike(sparse, { now: tNow }).length === 0);

  // 2. 7d steady $1/hr baseline + current hour 5× → spike fires.
  const steady: NormalizedRow[] = [];
  const HOURS = 7 * 24;
  for (let h = 1; h <= HOURS; h++) {
    steady.push(baseRow(new Date(tNow - h * 3600_000).toISOString(), 1.0, h));
  }
  // Current hour: 5 rows × $1 = $5 (5× baseline of $1/hr)
  for (let i = 0; i < 5; i++) {
    steady.push(baseRow(new Date(tNow - (50 - i * 5) * 60_000).toISOString(), 1.0, 1000 + i));
  }
  const sigSteady = detectVelocitySpike(steady, { now: tNow });
  t('7d steady $1/hr + current 5× → spike fires', sigSteady.some(s => s.kind === 'velocity_spike'));

  // 3. Zero baseline guard: no historical spend → no signal even if current
  //    hour spikes. Suppresses false positives during onboarding/idle.
  const zeroBase: NormalizedRow[] = [];
  for (let h = 1; h <= HOURS; h++) zeroBase.push(baseRow(new Date(tNow - h * 3600_000).toISOString(), 0, h));
  zeroBase.push(baseRow(new Date(tNow - 30 * 60_000).toISOString(), 100, 999));
  t('Zero baseline → no signal', detectVelocitySpike(zeroBase, { now: tNow }).length === 0);

  // 4. Below 4× threshold (3×) → no signal.
  const below: NormalizedRow[] = [];
  for (let h = 1; h <= HOURS; h++) below.push(baseRow(new Date(tNow - h * 3600_000).toISOString(), 1.0, h));
  below.push(baseRow(new Date(tNow - 30 * 60_000).toISOString(), 3.0, 999));
  t('Below 4× → no signal', detectVelocitySpike(below, { now: tNow }).length === 0);

  console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
