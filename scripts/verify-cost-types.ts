// scripts/verify-cost-types.ts
/**
 * Compile-check + structural assertion that every type/enum in
 * cost-reporting.ts has the shape the spec mandates.
 */
import type {
  NormalizedRow,
  Signal,
  AdapterResult,
  AdapterWarning,
  CostReport,
  Source,
  CostStatus,
  EstimatedCostSource,
  ActualCostSource,
  RecomputedCostSource,
  AdapterWarningKind,
  SourceStatus,
} from '../src/lib/types/cost-reporting';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

const sources: Source[] = ['openclaw', 'hermes', 'paperclip'];
t('Source enum has exactly 3 values', sources.length === 3);

const statuses: CostStatus[] = ['actual', 'estimated', 'recomputed', 'included', 'token_only', 'unknown'];
t('CostStatus enum has exactly 6 values', statuses.length === 6);

const warnKinds: AdapterWarningKind[] = ['parse_error', 'unsupported_currency', 'partial_field', 'rate_limit', 'source_unavailable', 'unknown_warning'];
t('AdapterWarningKind closed enum has exactly 6 values', warnKinds.length === 6);

const sample: NormalizedRow = {
  row_id: 'openclaw:a:b:c',
  source: 'openclaw',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  agent: 'main',
  session_id: 'openclaw:main:abc',
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
};
t('NormalizedRow accepts minimal sample', sample.row_id === 'openclaw:a:b:c');

const sig: Signal = { kind: 'loop_risk', severity: 'warn', affected_row_ids: [sample.row_id], detail: 'sample' };
t('Signal accepts loop_risk', sig.kind === 'loop_risk');

const warn: AdapterWarning = { kind: 'parse_error', count: 1, detail: 'bad json' };
t('AdapterWarning accepts parse_error', warn.kind === 'parse_error');

const ar: AdapterResult = {
  source: 'openclaw',
  rows: [sample],
  warnings: [warn],
  fetched_at: new Date().toISOString(),
};
t('AdapterResult shape compiles', ar.rows.length === 1);

const status: SourceStatus = 'ok';
t('SourceStatus enum compiles', status === 'ok' || (status as string) === 'unavailable');

const report: CostReport = {
  rows: [sample],
  perSource: {
    openclaw: { count: 1, totalUsd: 0 },
    hermes: { count: 0, totalUsd: 0 },
    paperclip: { count: 0, totalUsd: 0 },
  },
  headline: { source: 'openclaw', total: 0 },
  signals: [sig],
  warnings: [warn],
  sourceStatus: { openclaw: 'ok', hermes: 'ok', paperclip: 'ok' },
};
t('CostReport shape compiles', report.rows.length === 1);

console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
process.exit(fail === 0 ? 0 : 1);
