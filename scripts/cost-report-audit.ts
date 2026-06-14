// scripts/cost-report-audit.ts
/**
 * Real-data smoke for the v1 FinOps reporting orchestrator.
 *
 * Walks current local data, runs gatherCostRows(), and prints per-source
 * coverage statistics: % of rows where each cost column populated, broken
 * down by source. Run pre-commit on PRs touching cost code.
 *
 * NOTE: top-level await fails under tsx CJS — wrapped in main() per plan
 * carry-forward bug.
 */
import { gatherCostRows } from '../src/lib/services/cost-reporting';
import type { Source } from '../src/lib/types/cost-reporting';

async function main() {
  const report = await gatherCostRows({});
  const sources: Source[] = ['openclaw', 'hermes', 'paperclip'];

  console.log(`\nFetched ${report.rows.length} rows total. Source status:`);
  for (const s of sources) {
    console.log(`  ${s.padEnd(10)} ${report.sourceStatus[s].padEnd(12)} ${report.perSource[s].count} rows, total $${report.perSource[s].totalUsd.toFixed(4)}`);
  }
  console.log(`\nHeadline: ${report.headline ? `$${report.headline.total.toFixed(4)} from ${report.headline.source}` : 'no source has spend > $0'}`);

  console.log('\n--- Coverage by cost column (per source) ---');
  for (const s of sources) {
    const rows = report.rows.filter(r => r.source === s);
    if (rows.length === 0) { console.log(`  ${s}: no rows`); continue; }
    const pct = (n: number) => `${((n / rows.length) * 100).toFixed(0).padStart(3)}%`;
    console.log(`  ${s.padEnd(10)} (${rows.length} rows):`);
    console.log(`    estimated_cost_usd  populated: ${pct(rows.filter(r => r.estimated_cost_usd != null).length)}`);
    console.log(`    actual_cost_usd     populated: ${pct(rows.filter(r => r.actual_cost_usd != null).length)}`);
    console.log(`    recomputed_cost_usd populated: ${pct(rows.filter(r => r.recomputed_cost_usd != null).length)}`);
    console.log(`    cost_status='actual':       ${pct(rows.filter(r => r.cost_status === 'actual').length)}`);
    console.log(`    cost_status='estimated':    ${pct(rows.filter(r => r.cost_status === 'estimated').length)}`);
    console.log(`    cost_status='recomputed':   ${pct(rows.filter(r => r.cost_status === 'recomputed').length)}`);
    console.log(`    cost_status='included':     ${pct(rows.filter(r => r.cost_status === 'included').length)}`);
    console.log(`    cost_status='token_only':   ${pct(rows.filter(r => r.cost_status === 'token_only').length)}`);
    console.log(`    cost_status='unknown':      ${pct(rows.filter(r => r.cost_status === 'unknown').length)}`);
    console.log(`    row_flags=unsupported_curr: ${pct(rows.filter(r => r.row_flags.includes('unsupported_currency')).length)}`);
  }

  console.log('\n--- Signals fired ---');
  const signalCounts: Record<string, number> = {};
  for (const sig of report.signals) signalCounts[sig.kind] = (signalCounts[sig.kind] ?? 0) + 1;
  for (const [k, n] of Object.entries(signalCounts)) console.log(`  ${k.padEnd(25)} ${n}`);

  console.log('\n--- Warnings ---');
  for (const w of report.warnings) console.log(`  ${w.kind.padEnd(25)} count=${w.count}${w.detail ? ` detail=${w.detail}` : ''}`);
}

main().catch(e => { console.error(e); process.exit(1); });
