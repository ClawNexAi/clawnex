// scripts/verify-cost-quality-behavior.ts
//
// Hermetic behavior checks for the audit-loop cost-quality fixes. This avoids
// the real adapter graph and local user telemetry while proving the contracts
// the dashboard and /api/tokens rely on.

process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';

import type { AdapterSet, DetectOpts } from '../src/lib/services/cost-reporting';
import type { AdapterResult, NormalizedRow, Signal, Source } from '../src/lib/types/cost-reporting';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function section(name: string): void {
  console.log(`\n[${name}]`);
}

function row(overrides: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    row_id: `test:${Math.random().toString(16).slice(2)}`,
    source: 'openclaw',
    provider: 'openrouter',
    model: 'openrouter/anthropic/claude-haiku-4',
    agent: 'main',
    session_id: 'session-1',
    source_agent_id: null,
    timestamp: '2026-06-30T00:00:00.000Z',
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
    ...overrides,
  };
}

function adapter(source: Source, rows: NormalizedRow[], extra: Partial<AdapterResult> = {}): AdapterResult {
  return {
    source,
    rows,
    warnings: [],
    fetched_at: '2026-06-30T00:00:00.000Z',
    ...extra,
  };
}

async function main(): Promise<void> {
  const { gatherCostRows } = await import('../src/lib/services/cost-reporting');
  const { display_cost_usd } = await import('../src/lib/cost-reporting-display');
  const {
    classifyProxyCostStatus,
    costStatusFromSource,
    mergeCostStatus,
    summarizeLegacyCostQuality,
    unknownRowsForStatus,
  } = await import('../src/lib/services/token-cost-quality');

  section('1. Display cost rejects invalid and unpriced rows');
  {
    check('negative actual cost is not displayable', display_cost_usd(row({
      cost_status: 'actual',
      actual_cost_usd: -0.01,
    })) === null);
    check('invalid_cost flag is not displayable even with positive amount', display_cost_usd(row({
      cost_status: 'actual',
      actual_cost_usd: 1.25,
      row_flags: ['invalid_cost'],
    })) === null);
    check('included rows display as zero', display_cost_usd(row({ cost_status: 'included' })) === 0);
    check('token_only rows have no display cost', display_cost_usd(row({ cost_status: 'token_only' })) === null);
  }

  section('2. Cost report aggregation honors quality and strips private side-channel');
  {
    let detectOptsSeen: DetectOpts | undefined;
    const invalid = row({
      row_id: 'openclaw:invalid',
      cost_status: 'actual',
      actual_cost_usd: -5,
      recomputed_cost_usd: 0,
      row_flags: ['invalid_cost'],
    });
    const known = row({
      row_id: 'hermes:known',
      source: 'hermes',
      cost_status: 'estimated',
      estimated_cost_usd: 2.5,
      estimated_cost_source: 'hermes_state',
      recomputed_cost_usd: 0,
    });
    const unsupported = row({
      row_id: 'paperclip:unsupported',
      source: 'paperclip',
      cost_status: 'actual',
      actual_cost_usd: 10,
      recomputed_cost_usd: 0,
      row_flags: ['unsupported_currency'],
    });
    const adapters: AdapterSet = {
      openClaw: { read: async () => adapter('openclaw', [invalid], {
        signal_context: { stopReasonByRowId: { [invalid.row_id]: 'stop' } },
      }) },
      hermes: { read: async () => adapter('hermes', [known], {
        signal_context: { systemPromptHashByRowId: { [known.row_id]: 'abc123' } },
      }) },
      paperclip: { read: async () => adapter('paperclip', [unsupported]) },
    };
    const report = await gatherCostRows({}, adapters, (_rows, opts): Signal[] => {
      detectOptsSeen = opts;
      return [{
        kind: 'loop_risk',
        severity: 'warn',
        affected_row_ids: [],
        detail: 'synthetic detector proof',
      }];
    });
    check('invalid row is counted but excluded from OpenClaw total', report.perSource.openclaw.count === 1 && report.perSource.openclaw.totalUsd === 0);
    check('known estimated row contributes to Hermes total', report.perSource.hermes.count === 1 && report.perSource.hermes.totalUsd === 2.5);
    check('unsupported currency is counted but excluded from Paperclip total', report.perSource.paperclip.count === 1 && report.perSource.paperclip.totalUsd === 0);
    check('headline uses highest usable source total only', report.headline?.source === 'hermes' && report.headline.total === 2.5);
    check('detectors receive merged side-channel data', detectOptsSeen?.stopReasonByRowId?.[invalid.row_id] === 'stop' && detectOptsSeen?.systemPromptHashByRowId?.[known.row_id] === 'abc123');
    check('public report strips signal_context', !JSON.stringify(report).includes('signal_context'));
  }

  section('3. Legacy /api/tokens cost-quality helpers classify rows deterministically');
  {
    check('trusted session/proxy sources classify as known', costStatusFromSource('openclaw') === 'known' && costStatusFromSource('litellm') === 'known');
    check('fallback/default session prices classify as unknown', costStatusFromSource('fallback') === 'unknown' && costStatusFromSource('default') === 'unknown');
    check('unknown status counts all requests as unpriced', unknownRowsForStatus('unknown', 7) === 7);
    check('mixed status counts all requests as unpriced', unknownRowsForStatus('mixed', 3) === 3);
    check('proxy negative costs classify as invalid', classifyProxyCostStatus({ invalidCostRows: 1, unpricedRows: 0 }) === 'invalid');
    check('proxy missing/zero costs classify as unknown', classifyProxyCostStatus({ invalidCostRows: 0, unpricedRows: 2 }) === 'unknown');
    check('proxy fully priced rows classify as known', classifyProxyCostStatus({ invalidCostRows: 0, unpricedRows: 0 }) === 'known');
    check('invalid dominates merged legacy status', mergeCostStatus('known', 'invalid') === 'invalid');

    const summary = summarizeLegacyCostQuality([
      { invalidCostRows: 0, unpricedRows: 2 },
      { invalidCostRows: 1, unpricedRows: 0 },
    ]);
    check('legacy top-level quality reports invalid before unknown', summary.status === 'invalid');
    check('legacy top-level quality preserves invalid and unpriced counts', summary.invalidCostRows === 1 && summary.unpricedRows === 2);
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
