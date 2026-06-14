// scripts/verify-paperclip-cost-adapter.ts
/**
 * Verify Paperclip cost adapter against a mock HTTP fixture:
 *  - Normalization
 *  - estimated=true → estimated_cost_usd populated
 *  - estimated=false unverified → null all costs
 *  - non-USD → row_flags=['unsupported_currency'], all costs null, warning emitted
 *  - source_agent_id carries the raw UUID
 *  - HTTP failure → adapter returns { rows: [], error }
 *  - subscription marker (metadataJson.subscriptionRun=true) → cost_status='included', actual_cost_usd=0
 *
 * Wrapped in main() because tsx CJS transform doesn't support top-level await.
 */
import { paperclipCostAdapter } from '../src/lib/adapters/paperclip-cost-adapter';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => {
  ok ? pass++ : fail++;
  if (!ok) console.error(`FAIL: ${name}`);
};

const FIXTURE_FINANCE_EVENTS = [
  {
    id: 'fe-001',
    companyId: 'co-1',
    agentId: 'uuid-alex',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    quantity: 150,
    unit: 'tokens',
    amountCents: 1,
    currency: 'USD',
    estimated: true,
    occurredAt: '2026-05-04T00:00:00Z',
    metadataJson: { inputTokens: 100, outputTokens: 50, toolCallCount: 0 },
  },
  {
    id: 'fe-002',
    companyId: 'co-1',
    agentId: 'uuid-bob',
    provider: 'openai',
    model: 'gpt-5.4',
    quantity: 200,
    unit: 'tokens',
    amountCents: 50,
    currency: 'USD',
    estimated: false,
    occurredAt: '2026-05-04T00:01:00Z',
    metadataJson: null,
  },
  {
    id: 'fe-003',
    companyId: 'co-1',
    agentId: 'uuid-eve',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    quantity: 80,
    unit: 'tokens',
    amountCents: 100,
    currency: 'EUR',
    estimated: true,
    occurredAt: '2026-05-04T00:02:00Z',
    metadataJson: null,
  },
  {
    id: 'fe-004',
    companyId: 'co-1',
    agentId: 'uuid-codex',
    provider: 'openai',
    model: 'gpt-5.4',
    quantity: 500,
    unit: 'tokens',
    amountCents: 0,
    currency: 'USD',
    estimated: false,
    occurredAt: '2026-05-04T00:03:00Z',
    metadataJson: { subscriptionRun: true, inputTokens: 400, outputTokens: 100 },
  },
];

const FIXTURE_AGENTS = [
  { id: 'uuid-alex', name: 'Alex' },
  { id: 'uuid-bob', name: 'Bob' },
  { id: 'uuid-eve', name: 'Eve' },
  { id: 'uuid-codex', name: 'CodexAgent' },
];

async function mockFetch(url: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> {
  if (url.endsWith('/finance-events') || url.includes('/finance-events?')) {
    return { ok: true, json: async () => FIXTURE_FINANCE_EVENTS };
  }
  if (url.endsWith('/agents') || url.includes('/agents?')) {
    return { ok: true, json: async () => FIXTURE_AGENTS };
  }
  return { ok: false, json: async () => ({}) };
}

async function main(): Promise<void> {
  const result = await paperclipCostAdapter.read({
    baseUrl: 'http://test.local/api',
    apiKey: 'test',
    companyId: 'co-1',
    fetcher: mockFetch as unknown as typeof fetch,
  });

  t('Adapter returns paperclip source', result.source === 'paperclip');
  t('Four rows emitted', result.rows.length === 4);

  const r1 = result.rows.find(r => r.row_id === 'paperclip:fe-001')!;
  t('estimated=true: cost_status=estimated', r1.cost_status === 'estimated');
  t('estimated=true: estimated_cost_usd = 0.01', Math.abs((r1.estimated_cost_usd ?? 0) - 0.01) < 1e-9);
  t('agent display = "Alex (Paperclip)"', r1.agent === 'Alex (Paperclip)');
  t('source_agent_id = raw UUID', r1.source_agent_id === 'uuid-alex');
  t('input_tokens from metadataJson', r1.input_tokens === 100);

  const r2 = result.rows.find(r => r.row_id === 'paperclip:fe-002')!;
  t('estimated=false unverified: cost_status=unknown', r2.cost_status === 'unknown');
  t('estimated=false unverified: all costs null', r2.estimated_cost_usd === null && r2.actual_cost_usd === null);

  const r3 = result.rows.find(r => r.row_id === 'paperclip:fe-003')!;
  t('non-USD: cost_status=unknown', r3.cost_status === 'unknown');
  t('non-USD: row_flags includes unsupported_currency', r3.row_flags.includes('unsupported_currency'));
  t('non-USD: currency=EUR preserved', r3.currency === 'EUR');
  t('non-USD: all cost columns null', r3.estimated_cost_usd === null && r3.actual_cost_usd === null);
  t('non-USD: warning emitted',
    result.warnings.some(w => w.kind === 'unsupported_currency' && w.count >= 1));

  const r4 = result.rows.find(r => r.row_id === 'paperclip:fe-004')!;
  t('subscription marker: cost_status=included', r4.cost_status === 'included');
  t('subscription marker: actual_cost_usd=0', r4.actual_cost_usd === 0);
  t('subscription marker: actual_cost_source=paperclip_finance_event', r4.actual_cost_source === 'paperclip_finance_event');

  // Failure mode
  const failResult = await paperclipCostAdapter.read({
    baseUrl: 'http://test.local/api',
    apiKey: 'test',
    companyId: 'co-1',
    fetcher: (async () => { throw new Error('network down'); }) as unknown as typeof fetch,
  });
  t('On HTTP failure: rows=[] and error set', failResult.rows.length === 0 && !!failResult.error);

  console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
