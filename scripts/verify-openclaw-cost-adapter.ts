// scripts/verify-openclaw-cost-adapter.ts
/**
 * Verifies OpenClaw cost adapter:
 *  1. Privacy: source code does not reference any conversation-content path
 *     (message.content, message.parts, parts[*].text, body, prompt, messages[*].content).
 *  2. Normalization: synthetic JSONL line → expected canonical row
 *  3. row_id is collision-safe and stable
 *  4. tool_call_count = 0 only when stopReason='stop' (per row, not per session)
 *  5. Trust map: known providers → expected initial cost_status
 */
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openClawCostAdapter } from '../src/lib/adapters/openclaw-cost-adapter';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; if (!ok) console.error(`FAIL: ${name}`); };

// 1. Privacy AST grep — fail if any forbidden member path appears in adapter source
const adapterSrc = readFileSync('src/lib/adapters/openclaw-cost-adapter.ts', 'utf8');
const FORBIDDEN_PATHS = [
  'message.content',
  'message.parts',
  '.body',         // not message.body or req.body — adapter source must not access body
  'prompt',
  'messages[',
  '.text',
];
for (const p of FORBIDDEN_PATHS) {
  // Allow incidental tokens — only fail on member-access patterns. Use word-boundary heuristic:
  // for paths starting with '.', look for the literal preceded by an identifier char.
  const re = p.startsWith('.')
    ? new RegExp(`[a-zA-Z_$][\\w$]*\\${p}`)
    : new RegExp(`\\b${p.replace(/[.\[\]]/g, m => '\\' + m)}`);
  t(`Adapter source does not reference forbidden path '${p}'`, !re.test(adapterSrc));
}

// 2. Normalization — write a synthetic JSONL line under a temp agent dir
const tmpRoot = mkdtempSync(join(tmpdir(), 'openclaw-test-'));
const agentDir = join(tmpRoot, 'agents', 'testagent', 'sessions');
mkdirSync(agentDir, { recursive: true });
const sessionId = 'abc123';
const jsonlPath = join(agentDir, `${sessionId}.jsonl`);
const sample = {
  type: 'message',
  id: 'msg-001',
  parentId: null,
  timestamp: '2026-05-04T00:00:00.000Z',
  message: {
    role: 'assistant',
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 },
    stopReason: 'stop',
    responseId: 'resp-001',
    timestamp: 1772755200000,
  },
};
writeFileSync(jsonlPath, JSON.stringify(sample) + '\n');

async function main() {
const result = await openClawCostAdapter.read({ sinceMs: 0, openclawRoot: tmpRoot });
t('Adapter returns AdapterResult', result.source === 'openclaw' && Array.isArray(result.rows));
t('Adapter emitted exactly one row', result.rows.length === 1);

const row = result.rows[0];
t('row_id format', row.row_id === 'openclaw:testagent:abc123:msg-001');
t('source = openclaw', row.source === 'openclaw');
t('provider extracted', row.provider === 'anthropic');
t('model extracted', row.model === 'claude-haiku-4-5');
t('agent = parent dir', row.agent === 'testagent');
t('session_id collision-safe', row.session_id === 'openclaw:testagent:abc123');
t('source_agent_id null', row.source_agent_id === null);
t('input_tokens preserved', row.input_tokens === 100);
t('output_tokens preserved', row.output_tokens === 50);
t('cache_read_tokens', row.cache_read_tokens === 0);
t('reasoning_tokens null (OpenClaw does not break out)', row.reasoning_tokens === null);
t('tool_call_count = 0 when stopReason=stop', row.tool_call_count === 0);
t('currency = USD (OpenClaw default when populated)', row.currency === 'USD');
t('estimated_cost_usd null (v1 alpha)', row.estimated_cost_usd === null);
t('actual_cost_usd null (v1 alpha)', row.actual_cost_usd === null);
t('recomputed_cost_usd null (orchestrator-owned)', row.recomputed_cost_usd === null);
t('cost_status starts as unknown (orchestrator promotes later)', row.cost_status === 'unknown');
t('row_flags empty', row.row_flags.length === 0);

// 3. tool_call_count behavior on stopReason=toolUse
const sample2 = { ...sample, message: { ...sample.message, stopReason: 'toolUse' } };
writeFileSync(join(agentDir, 'def456.jsonl'), JSON.stringify({ ...sample2, id: 'msg-002' }) + '\n');
const result2 = await openClawCostAdapter.read({ sinceMs: 0, openclawRoot: tmpRoot });
const tooluse = result2.rows.find(r => r.row_id.includes('def456'));
t('tool_call_count = null when stopReason=toolUse', tooluse !== undefined && tooluse.tool_call_count === null);

console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
