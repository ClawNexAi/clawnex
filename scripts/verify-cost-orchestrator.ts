// scripts/verify-cost-orchestrator.ts
/**
 * Verify orchestrator helpers + integration:
 *  - display_cost_usd resolution per cost_status
 *  - status-downgrade rule (never overwrites actual/estimated/included)
 *  - enrichWithRecompute zero-rate guard (matchedKey===null → null + cost_status downgrade)
 *  - aggregateBySource sums valid display costs only; null and negative values are excluded
 *  - highestReportedSourceTotal picks max non-zero source
 *  - Promise.allSettled rejected fallback uses indexed source name
 *  - signal_context: side-channel maps merge into DetectOpts and reach detectSignals
 *  - signal_context: never appears on the public CostReport
 *
 * NOTE: tsx CJS transform does not support top-level await — body wrapped in
 * async main() and dispatched at the bottom (carry-forward known plan bug #1).
 *
 * detectSignals is replaced via the orchestrator's DI parameter
 * `detectSignalsFn` so we can capture the merged DetectOpts without
 * monkey-patching the cost-signals module.
 */
import {
  display_cost_usd,
  enrichWithRecompute,
  aggregateBySource,
  highestReportedSourceTotal,
  gatherCostRows,
} from '../src/lib/services/cost-reporting';
import type { DetectOpts } from '../src/lib/services/cost-reporting';
import type { NormalizedRow, AdapterResult, Signal } from '../src/lib/types/cost-reporting';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

const baseRow = (over: Partial<NormalizedRow>): NormalizedRow => ({
  row_id: 'test:1',
  source: 'openclaw',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  agent: 'a',
  session_id: 'openclaw:a:b',
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
  recomputed_cost_usd: null,
  cost_status: 'unknown',
  estimated_cost_source: null,
  actual_cost_source: null,
  recomputed_cost_source: null,
  pricing_version: null,
  row_flags: [],
  ...over,
});

async function main() {
  // --- display_cost_usd ---
  t('included → 0', display_cost_usd(baseRow({ cost_status: 'included', actual_cost_usd: 0 })) === 0);
  t('actual → actual_cost_usd', display_cost_usd(baseRow({ cost_status: 'actual', actual_cost_usd: 1.23 })) === 1.23);
  t('estimated → estimated_cost_usd', display_cost_usd(baseRow({ cost_status: 'estimated', estimated_cost_usd: 0.5 })) === 0.5);
  t('recomputed → recomputed_cost_usd', display_cost_usd(baseRow({ cost_status: 'recomputed', recomputed_cost_usd: 0.7 })) === 0.7);
  t('token_only → null', display_cost_usd(baseRow({ cost_status: 'token_only' })) === null);
  t('unknown → null', display_cost_usd(baseRow({ cost_status: 'unknown' })) === null);
  t(
    'unsupported_currency → null even if cost_status would otherwise pay',
    display_cost_usd(baseRow({ cost_status: 'estimated', estimated_cost_usd: 0.5, row_flags: ['unsupported_currency'] })) === null,
  );

  // --- enrichWithRecompute — zero-rate guard ---
  const unknownModel = [baseRow({ row_id: 'test:zr', model: 'definitely-fake-model-zzz', cost_status: 'unknown' })];
  enrichWithRecompute(unknownModel);
  t('zero-rate guard: recomputed_cost_usd stays null', unknownModel[0].recomputed_cost_usd === null);
  t('zero-rate guard: cost_status demoted unknown → token_only (tokens present)', unknownModel[0].cost_status === 'token_only');

  // --- enrichWithRecompute — never overwrites stronger states ---
  const stronger: NormalizedRow[] = [
    baseRow({ row_id: 'test:est', cost_status: 'estimated', estimated_cost_usd: 0.5, model: 'definitely-fake-model-zzz' }),
    baseRow({ row_id: 'test:inc', cost_status: 'included', actual_cost_usd: 0, model: 'definitely-fake-model-zzz' }),
    baseRow({ row_id: 'test:act', cost_status: 'actual', actual_cost_usd: 1.0, model: 'definitely-fake-model-zzz' }),
  ];
  enrichWithRecompute(stronger);
  t('downgrade rule: estimated stays estimated', stronger[0].cost_status === 'estimated');
  t('downgrade rule: included stays included', stronger[1].cost_status === 'included');
  t('downgrade rule: actual stays actual', stronger[2].cost_status === 'actual');

  // --- enrichWithRecompute — successful match ---
  const known = [baseRow({ row_id: 'test:k', model: 'claude-haiku-4-5', cost_status: 'unknown' })];
  enrichWithRecompute(known);
  t('match: recomputed_cost_usd populated', (known[0].recomputed_cost_usd ?? 0) > 0);
  t('match: cost_status promoted unknown → recomputed', known[0].cost_status === 'recomputed');
  t('match: recomputed_cost_source = clawnex_recompute', known[0].recomputed_cost_source === 'clawnex_recompute');

  // --- aggregateBySource ---
  const mixed: NormalizedRow[] = [
    baseRow({ row_id: 'a', source: 'openclaw', cost_status: 'recomputed', recomputed_cost_usd: 1.0 }),
    baseRow({ row_id: 'b', source: 'openclaw', cost_status: 'recomputed', recomputed_cost_usd: 2.0 }),
    baseRow({ row_id: 'c', source: 'hermes', cost_status: 'estimated', estimated_cost_usd: 5.0 }),
    baseRow({ row_id: 'd', source: 'paperclip', cost_status: 'included', actual_cost_usd: 0 }),
    baseRow({ row_id: 'e', source: 'paperclip', cost_status: 'unknown' }), // null → excluded
    baseRow({ row_id: 'f', source: 'hermes', cost_status: 'actual', actual_cost_usd: -42 }),
  ];
  const agg = aggregateBySource(mixed);
  t('aggregate openclaw total = 3.0', Math.abs(agg.openclaw.totalUsd - 3.0) < 1e-9);
  t('aggregate openclaw count = 2', agg.openclaw.count === 2);
  t('aggregate hermes total = 5.0', Math.abs(agg.hermes.totalUsd - 5.0) < 1e-9);
  t('aggregate excludes negative costs', agg.hermes.totalUsd === 5.0);
  t('aggregate flags negative costs as invalid', mixed[5].row_flags.includes('invalid_cost'));
  t('aggregate paperclip total = 0 (included $0 + unknown excluded)', agg.paperclip.totalUsd === 0);
  t('aggregate paperclip count = 2 (rows count, even if cost null)', agg.paperclip.count === 2);

  // --- highestReportedSourceTotal ---
  const headline = highestReportedSourceTotal(agg);
  t('headline: hermes wins at $5', headline?.source === 'hermes' && Math.abs(headline.total - 5.0) < 1e-9);

  // --- gatherCostRows fallback for rejected promise ---
  const fetched_at = new Date().toISOString();
  const oc = { read: async (): Promise<AdapterResult> => ({ source: 'openclaw' as const, rows: [], warnings: [], fetched_at }) };
  const hs = { read: async (): Promise<AdapterResult> => { throw new Error('hermes blew up'); } };
  const pc = { read: async (): Promise<AdapterResult> => ({ source: 'paperclip' as const, rows: [], warnings: [], fetched_at }) };
  const report = await gatherCostRows({}, { openClaw: oc, hermes: hs, paperclip: pc });
  t('rejected hermes promise → sourceStatus.hermes = unavailable', report.sourceStatus.hermes === 'unavailable');
  t('rejected hermes promise → warning kind=source_unavailable', report.warnings.some(w => w.kind === 'source_unavailable'));
  t('other sources unaffected', report.sourceStatus.openclaw === 'ok' && report.sourceStatus.paperclip === 'ok');

  // --- signal_context threading: merge → detectSignals receives merged DetectOpts ---
  let lastDetectOpts: DetectOpts | null = null;
  let lastDetectRowCount = -1;
  const spy = (rows: NormalizedRow[], opts: DetectOpts = {}): Signal[] => {
    lastDetectOpts = opts;
    lastDetectRowCount = rows.length;
    return [];
  };

  const ocSc = {
    read: async (): Promise<AdapterResult> => ({
      source: 'openclaw' as const,
      rows: [baseRow({ row_id: 'oc:r1', source: 'openclaw' })],
      warnings: [],
      fetched_at,
      signal_context: { stopReasonByRowId: { 'oc:r1': 'stop' } },
    }),
  };
  const hsSc = {
    read: async (): Promise<AdapterResult> => ({
      source: 'hermes' as const,
      rows: [baseRow({ row_id: 'hermes:r1', source: 'hermes' })],
      warnings: [],
      fetched_at,
      signal_context: { systemPromptHashByRowId: { 'hermes:r1': 'abc123def456abcd' } },
    }),
  };
  const pcSc = {
    read: async (): Promise<AdapterResult> => ({
      source: 'paperclip' as const,
      rows: [],
      warnings: [],
      fetched_at,
    }),
  };
  const reportSc = await gatherCostRows({}, { openClaw: ocSc, hermes: hsSc, paperclip: pcSc }, spy);
  t(
    'signal_context: detectSignals received merged stopReasonByRowId from OpenClaw',
    (lastDetectOpts as DetectOpts | null)?.stopReasonByRowId?.['oc:r1'] === 'stop',
  );
  t(
    'signal_context: detectSignals received merged systemPromptHashByRowId from Hermes',
    (lastDetectOpts as DetectOpts | null)?.systemPromptHashByRowId?.['hermes:r1'] === 'abc123def456abcd',
  );
  t('signal_context: detectSignals received both rows', lastDetectRowCount === 2);

  // --- signal_context: NEVER appears on the public CostReport ---
  t(
    'CostReport: "signal_context" key NOT present at top level',
    !('signal_context' in (reportSc as unknown as Record<string, unknown>)),
  );
  t(
    'CostReport: JSON.stringify does not contain "signal_context"',
    !JSON.stringify(reportSc).includes('signal_context'),
  );

  // --- instance routing (internal reviewer watchpoint #7) -------------------------------
  // Build adapters that record whether they were called and emit one row each
  // when invoked. The orchestrator must short-circuit filtered-out adapters
  // to synthetic empty results so `perSource` still contains every source.
  const makeRoutingAdapters = () => {
    const calls = { openclaw: 0, hermes: 0, paperclip: 0 };
    const ocAd = {
      read: async (): Promise<AdapterResult> => {
        calls.openclaw++;
        return { source: 'openclaw' as const, rows: [baseRow({ row_id: 'oc:r1', source: 'openclaw', cost_status: 'recomputed', recomputed_cost_usd: 1.0 })], warnings: [], fetched_at };
      },
    };
    const hsAd = {
      read: async (): Promise<AdapterResult> => {
        calls.hermes++;
        return { source: 'hermes' as const, rows: [baseRow({ row_id: 'hs:r1', source: 'hermes', cost_status: 'estimated', estimated_cost_usd: 2.0 })], warnings: [], fetched_at };
      },
    };
    const pcAd = {
      read: async (): Promise<AdapterResult> => {
        calls.paperclip++;
        return { source: 'paperclip' as const, rows: [baseRow({ row_id: 'pc:r1', source: 'paperclip', cost_status: 'actual', actual_cost_usd: 3.0 })], warnings: [], fetched_at };
      },
    };
    return { calls, adapters: { openClaw: ocAd, hermes: hsAd, paperclip: pcAd } };
  };

  // instance: 'all' → every adapter called, every source has rows
  {
    const { calls, adapters: a } = makeRoutingAdapters();
    const r = await gatherCostRows({ instance: 'all' }, a);
    t("instance='all': all 3 adapters called", calls.openclaw === 1 && calls.hermes === 1 && calls.paperclip === 1);
    t("instance='all': perSource has rows from all 3", r.perSource.openclaw.count === 1 && r.perSource.hermes.count === 1 && r.perSource.paperclip.count === 1);
  }

  // instance: undefined → defaults to 'all'
  {
    const { calls, adapters: a } = makeRoutingAdapters();
    const r = await gatherCostRows({}, a);
    t("instance=undefined: defaults to 'all' (all 3 adapters called)", calls.openclaw === 1 && calls.hermes === 1 && calls.paperclip === 1);
    t("instance=undefined: rows from all 3 sources present", r.rows.length === 3);
  }

  // instance: 'hermes-local' → only Hermes adapter called; OpenClaw + Paperclip silenced
  {
    const { calls, adapters: a } = makeRoutingAdapters();
    const r = await gatherCostRows({ instance: 'hermes-local' }, a);
    t("instance='hermes-local': only Hermes adapter called", calls.openclaw === 0 && calls.hermes === 1 && calls.paperclip === 0);
    t("instance='hermes-local': perSource.openclaw.count === 0 (internal reviewer watchpoint #7)", r.perSource.openclaw.count === 0);
    t("instance='hermes-local': perSource.paperclip.count === 0", r.perSource.paperclip.count === 0);
    t("instance='hermes-local': perSource.hermes.count > 0", r.perSource.hermes.count > 0);
    t("instance='hermes-local': sourceStatus stays 'ok' for filtered-out sources (not 'unavailable')", r.sourceStatus.openclaw === 'ok' && r.sourceStatus.paperclip === 'ok');
    t("instance='hermes-local': headline picks Hermes (only filtered source with non-zero total)", r.headline?.source === 'hermes');
  }

  // instance: 'main' (any non-special value) → only OpenClaw adapter called
  {
    const { calls, adapters: a } = makeRoutingAdapters();
    const r = await gatherCostRows({ instance: 'main' }, a);
    t("instance='main': only OpenClaw adapter called", calls.openclaw === 1 && calls.hermes === 0 && calls.paperclip === 0);
    t("instance='main': perSource.hermes.count === 0", r.perSource.hermes.count === 0);
    t("instance='main': perSource.paperclip.count === 0", r.perSource.paperclip.count === 0);
    t("instance='main': perSource.openclaw.count > 0", r.perSource.openclaw.count > 0);
    t("instance='main': headline picks OpenClaw", r.headline?.source === 'openclaw');
  }

  console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
