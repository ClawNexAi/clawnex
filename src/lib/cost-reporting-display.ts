// src/lib/cost-reporting-display.ts
/**
 * Pure display-cost helper, extracted from `cost-reporting.ts` so client
 * components (e.g. CostByAgentCard, CostBySessionCard) can import it without
 * pulling the orchestrator's adapter graph — and with it `node:fs` /
 * `node:path` — into the browser bundle.
 *
 * INVARIANT: This module imports ONLY types. No adapters, no Node runtime,
 * no orchestrator. Anything that breaks that invariant re-introduces the
 * webpack failure this file exists to prevent.
 *
 * Behavior is identical to the previous `display_cost_usd` in
 * `services/cost-reporting.ts`; that module now re-exports from here so
 * server-side callers keep their existing import path.
 */

import type { NormalizedRow } from '@/lib/types/cost-reporting';

/**
 * Resolve the single column that powers per-source totals + headline.
 * - row_flags including 'unsupported_currency' → null (excluded from totals)
 * - included → 0 (subscription-paid, contributes a $0 row count)
 * - actual → actual_cost_usd
 * - estimated → estimated_cost_usd
 * - recomputed → recomputed_cost_usd
 * - token_only / unknown → null (no usable cost; excluded from totals)
 */
export function display_cost_usd(row: NormalizedRow): number | null {
  if (row.row_flags.includes('unsupported_currency')) return null;
  switch (row.cost_status) {
    case 'included':   return 0;
    case 'actual':     return row.actual_cost_usd;
    case 'estimated':  return row.estimated_cost_usd;
    case 'recomputed': return row.recomputed_cost_usd;
    case 'token_only': return null;
    case 'unknown':    return null;
  }
}
