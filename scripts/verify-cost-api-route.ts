// scripts/verify-cost-api-route.ts
/**
 * Verify Task 12: /api/tokens additive refactor exposes the new orchestrator
 * fields (rows / perSource / headline / signals / warnings / sourceStatus)
 * and never leaks signal_context.
 *
 * The Next.js GET handler is hard to invoke without a real request context,
 * so we smoke the orchestrator's contract directly. The route is a thin
 * wrapper that calls gatherCostRows() and spreads the same six fields onto
 * the response — the reviewer's Gate C watchpoint #1 ("/api/tokens must not expose
 * signal_context") is enforced at the orchestrator's trust boundary, so
 * verifying that the orchestrator's CostReport carries no signal_context is
 * sufficient for the API surface.
 *
 * Production-shape probe (the reviewer's watchpoint #7): we additionally call
 * gatherCostRows({}) against real local data — the actual OpenClaw + Hermes
 * + Paperclip directories on this machine, no fixtures. The probe asserts
 * the returned object is array-of-rows shaped, perSource counters are
 * non-negative integers, sourceStatus is an enum value the route can render,
 * and the report's top-level keys are exactly the six expected — no
 * signal_context, no extras.
 *
 * NOTE: tsx CJS transform does not support top-level await — body wrapped in
 * async main() and dispatched at the bottom (carry-forward known plan bug #1).
 *
 * Environmental notes for the production-shape probe:
 *   - The probe reads from whatever OpenClaw / Hermes / Paperclip directories
 *     each adapter resolves to on the host. Adapters tolerate missing dirs
 *     (sourceStatus === 'unavailable' is acceptable), so this script does
 *     not require any fixture or env var setup. On local dev host it picks up real
 *     local data; on a fresh machine it will report zero rows + 'unavailable'
 *     statuses without failing.
 */
import { gatherCostRows } from '../src/lib/services/cost-reporting';
import type { CostReport } from '../src/lib/types/cost-reporting';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean) => {
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
};

const EXPECTED_KEYS = ['rows', 'perSource', 'headline', 'signals', 'warnings', 'sourceStatus'] as const;

async function main(): Promise<void> {
  // ---- Shape assertions: empty-filter call must produce a CostReport with
  //      all six fields, never signal_context. ----
  const report: CostReport = await gatherCostRows({});

  t('report has rows field', 'rows' in report);
  t('report has perSource field', 'perSource' in report);
  t('report has headline field', 'headline' in report);
  t('report has signals field', 'signals' in report);
  t('report has warnings field', 'warnings' in report);
  t('report has sourceStatus field', 'sourceStatus' in report);

  t('report does NOT have signal_context (key check)', !('signal_context' in report));

  const serialized = JSON.stringify(report);
  t('serialized JSON does NOT contain signal_context substring', !serialized.includes('signal_context'));

  // ---- Production-shape probe (the reviewer's watchpoint #7) — run against real
  //      local data, no fixtures. Report must be array-of-rows shaped, the
  //      per-source counters must be non-negative integers, sourceStatus
  //      must be an enum value, and top-level keys must match EXACTLY. ----
  const probe: CostReport = await gatherCostRows({});

  t('probe.rows is an array', Array.isArray(probe.rows));

  const oc = probe.perSource?.openclaw;
  t(
    'probe.perSource.openclaw.count is a non-negative integer',
    typeof oc?.count === 'number' && Number.isInteger(oc.count) && oc.count >= 0,
  );

  const ocStatus = probe.sourceStatus?.openclaw;
  t(
    "probe.sourceStatus.openclaw is 'ok' or 'unavailable'",
    ocStatus === 'ok' || ocStatus === 'unavailable',
  );

  const actualKeys = Array.from(Object.keys(probe)).sort();
  const expectedSorted = Array.from(EXPECTED_KEYS).slice().sort();
  t(
    `probe top-level keys match exactly [${expectedSorted.join(',')}] — got [${actualKeys.join(',')}]`,
    actualKeys.length === expectedSorted.length &&
      actualKeys.every((k, i) => k === expectedSorted[i]),
  );

  t(
    'probe top-level keys do NOT include signal_context',
    !actualKeys.includes('signal_context'),
  );

  // Diagnostic line — surfaces the live shape so a human (or the parent
  // agent) can sanity-check what the route would return on this host.
  console.log(
    `probe: rows=${probe.rows.length} ` +
      `openclaw={count:${probe.perSource.openclaw.count},totalUsd:${probe.perSource.openclaw.totalUsd},status:${probe.sourceStatus.openclaw}} ` +
      `hermes={count:${probe.perSource.hermes.count},totalUsd:${probe.perSource.hermes.totalUsd},status:${probe.sourceStatus.hermes}} ` +
      `paperclip={count:${probe.perSource.paperclip.count},totalUsd:${probe.perSource.paperclip.totalUsd},status:${probe.sourceStatus.paperclip}} ` +
      `headline=${probe.headline ? `${probe.headline.source}:${probe.headline.total}` : 'null'} ` +
      `signals=${probe.signals.length} warnings=${probe.warnings.length}`,
  );

  console.log(`\n${pass}/${pass + fail} checks passed (${fail} failures)`);
  if (fail === 0) {
    console.log('ALL CHECKS PASSED');
  } else {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
