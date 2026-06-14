// scripts/verify-cost-signal-simple-expensive.ts
/**
 * Verify the `simple_on_expensive` detector fires only when ALL conditions are
 * EXPLICITLY satisfied (the reviewer's strict gate):
 *   - input_tokens < 500 AND non-null
 *   - output_tokens < 200 AND non-null
 *   - tool_call_count === 0 (null does NOT count — no inference)
 *   - model non-null
 *   - matched pricing key (rate exists in tier table)
 *   - input rate > $5/Mtok
 *
 * Plan-level note: top-level `await` doesn't compile under tsx CJS, so this
 * script wraps the body in `async function main()`. We don't actually use
 * `await` here, but the wrapper is preserved for consistency with the rest of
 * the verify-script suite.
 *
 * The "cheap model" assertion depends on the local pricing snapshot (LiteLLM
 * bundle + curated fallback). We probe the actual rate before asserting so a
 * future pricing-bundle bump that re-tiers the chosen model surfaces a clear
 * diagnostic instead of a mystery `0/5 PASSED` failure.
 */
import { detectSimpleOnExpensive } from '../src/lib/services/cost-signals';
import { computeCost } from '../src/lib/services/model-pricing';
import type { NormalizedRow } from '../src/lib/types/cost-reporting';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

const baseRow = (over: Partial<NormalizedRow>, idx: number): NormalizedRow => ({
  row_id: `r:${idx}`,
  source: 'hermes',
  provider: 'openai',
  // gpt-4 is $30/Mtok input in the bundled LiteLLM snapshot — unambiguously
  // above the $5 threshold. The plan suggested gpt-5.4 but that prices at
  // $2.50/Mtok in this snapshot (probe at top of main() reveals this); keeping
  // a clearly-above-threshold model insulates the assertion from minor
  // pricing-bundle drift.
  model: 'gpt-4',
  agent: 'a',
  session_id: 's',
  source_agent_id: null,
  timestamp: '2026-05-04T00:00:00Z',
  input_tokens: 100,
  output_tokens: 50,
  cache_read_tokens: null,
  cache_write_tokens: null,
  reasoning_tokens: null,
  tool_call_count: 0,
  currency: 'USD',
  estimated_cost_usd: null,
  actual_cost_usd: null,
  recomputed_cost_usd: 0.001,
  cost_status: 'recomputed',
  estimated_cost_source: null,
  actual_cost_source: null,
  recomputed_cost_source: 'clawnex_recompute',
  pricing_version: 'v1',
  row_flags: [],
  ...over,
});

async function main() {
  // Probe: print actual computed rates for the models used so a pricing-bundle
  // re-tier produces a clear diagnostic instead of a silent failure.
  const expensiveProbe = computeCost('gpt-4', { input: 1_000_000, output: 0 });
  console.log(`probe: gpt-4 rate = $${expensiveProbe.cost.toFixed(2)}/Mtok input (matchedKey=${expensiveProbe.matchedKey})`);
  const cheapProbe = computeCost('claude-haiku-4-5', { input: 1_000_000, output: 0 });
  console.log(`probe: claude-haiku-4-5 rate = $${cheapProbe.cost.toFixed(2)}/Mtok input (matchedKey=${cheapProbe.matchedKey})`);

  // All conditions met → fire
  const fire = baseRow({}, 1);
  const sig = detectSimpleOnExpensive([fire]);
  t('Simple + expensive + tool_call_count=0 → fires', sig.length === 1 && sig[0].kind === 'simple_on_expensive');

  // tool_call_count = null → does NOT fire (the reviewer's strict rule)
  const nullTool = baseRow({ tool_call_count: null }, 2);
  t('tool_call_count=null → does NOT fire', detectSimpleOnExpensive([nullTool]).length === 0);

  // tool_call_count = 1 → does NOT fire
  const oneTool = baseRow({ tool_call_count: 1 }, 3);
  t('tool_call_count=1 → does NOT fire', detectSimpleOnExpensive([oneTool]).length === 0);

  // input_tokens > 500 → does NOT fire
  const big = baseRow({ input_tokens: 1000 }, 4);
  t('input_tokens > 500 → does NOT fire', detectSimpleOnExpensive([big]).length === 0);

  // Cheap model (rate < $5/Mtok input) → does NOT fire
  // claude-haiku-4-5 is < $5/Mtok per current pricing snapshot (probe above
  // confirms). If a future pricing bump re-tiers it, switch to gpt-4o-mini or
  // claude-haiku-3-5 — but the probe above will show why before this fails.
  const cheap = baseRow({ model: 'claude-haiku-4-5' }, 5);
  t('Cheap model → does NOT fire', detectSimpleOnExpensive([cheap]).length === 0);

  console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
