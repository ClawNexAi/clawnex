// src/lib/services/cost-reporting.ts
/**
 * Cost Reporting Orchestrator — gathers rows from all three source adapters
 * (OpenClaw, Hermes, Paperclip), enriches with derived recompute, aggregates
 * per-source totals, and runs drain detectors. Returns a single CostReport.
 *
 * Per-source totals are NEVER summed. Headline = highest reported source.
 *
 * PRIVACY (load-bearing):
 *   - Each adapter may attach an `AdapterResult.signal_context` side-channel
 *     for detector inputs (e.g. system_prompt hashes from Hermes,
 *     stopReason metadata from OpenClaw). The orchestrator MERGES those maps
 *     into a single DetectOpts value, forwards it to detectSignals, and
 *     STRIPS signal_context before returning the public CostReport.
 *   - The CostReport interface in `cost-reporting.ts` types intentionally
 *     does not have a `signal_context` field; this module is the trust
 *     boundary that enforces it never crosses the public API surface.
 *
 * Spec: docs/superpowers/specs/2026-05-04-token-cost-finops-reporting-design.md
 */

import type {
  NormalizedRow,
  AdapterResult,
  AdapterWarning,
  CostReport,
  Source,
  PerSourceTotal,
  Signal,
  SourceStatus,
} from '@/lib/types/cost-reporting';
import { computeCost } from '@/lib/services/model-pricing';
import { openClawCostAdapter } from '@/lib/adapters/openclaw-cost-adapter';
import { hermesCostAdapter } from '@/lib/adapters/hermes-cost-adapter';
import { paperclipCostAdapter } from '@/lib/adapters/paperclip-cost-adapter';
import { detectSignals as defaultDetectSignals } from '@/lib/services/cost-signals';
import { display_cost_usd } from '@/lib/cost-reporting-display';

// Re-exported so server-side callers (e.g. verify scripts) keep their
// existing `@/lib/services/cost-reporting` import path. Client components
// must import directly from `@/lib/cost-reporting-display` — importing from
// this module pulls the adapter graph (node:fs / node:path) into the bundle.
export { display_cost_usd };

const SOURCES: readonly Source[] = ['openclaw', 'hermes', 'paperclip'] as const;

/**
 * Detector inputs that ride alongside NormalizedRow but never appear in the
 * public CostReport. The orchestrator owns the build of this value (merging
 * each adapter's signal_context) and is the only caller responsible for
 * forwarding it to detectSignals.
 */
export interface DetectOpts {
  /** Hermes system_prompt hashes by row_id (16-char hex digests; never plaintext) */
  systemPromptHashByRowId?: Record<string, string>;
  /** OpenClaw stopReason enum values by row_id (e.g. 'stop', 'toolUse') */
  stopReasonByRowId?: Record<string, string | null>;
}

/**
 * Mutate rows in place: populate recomputed_cost_usd when math + non-default
 * rate match. Apply the status-downgrade rule on miss; never overwrite
 * stronger states (actual / estimated / included).
 *
 * Zero-rate guard: when `computeCost` returns matchedKey===null (the default
 * zero-rate fallback), do NOT populate recomputed_cost_usd. A genuine $0 from
 * the default fallback would otherwise masquerade as a verified recompute.
 */
export function enrichWithRecompute(rows: NormalizedRow[]): void {
  for (const row of rows) {
    // Skip if a previous pass (or adapter) already populated a recompute.
    if (row.recomputed_cost_usd !== null) continue;
    // No recompute path for non-USD rows — the orchestrator does not
    // FX-convert. Non-USD rows surface via the unsupported_currency flag.
    if (row.currency !== 'USD') continue;

    const hasInputs =
      row.provider != null &&
      row.model != null &&
      row.input_tokens != null &&
      row.output_tokens != null;

    if (!hasInputs) {
      // status-downgrade rule (math-inputs-missing branch): only demote
      // unknown→token_only when at least one token field is non-null.
      // Stronger states (actual/estimated/included) stay unchanged.
      if (
        row.cost_status === 'unknown' &&
        (row.input_tokens != null || row.output_tokens != null)
      ) {
        row.cost_status = 'token_only';
      }
      continue;
    }

    const result = computeCost(row.model!, {
      input: row.input_tokens!,
      output: row.output_tokens!,
      cacheRead: row.cache_read_tokens ?? 0,
      cacheWrite: row.cache_write_tokens ?? 0,
    });

    if (result.matchedKey === null) {
      // Zero-rate guard: pricing matched the default $0 rate. Don't populate
      // recomputed_cost_usd — that would lie about a verified $0 cost. Apply
      // the downgrade rule: unknown→token_only only; stronger states stay.
      if (row.cost_status === 'unknown') {
        row.cost_status = 'token_only';
      }
      continue;
    }

    // Successful match — populate the recompute trio.
    row.recomputed_cost_usd = result.cost;
    row.recomputed_cost_source = 'clawnex_recompute';
    row.pricing_version = result.pricing_version;

    // Status promotion: only when current cost_status is unknown. Never
    // overwrite estimated/included/actual — a real upstream cost beats a
    // synthesized recompute.
    if (row.cost_status === 'unknown') {
      row.cost_status = 'recomputed';
    }
  }
}

/**
 * Per-source totals: count = total rows from that source; totalUsd = sum of
 * display_cost_usd values, treating null as exclusion (NOT zero). A null
 * display value means "no usable cost" — folding it as $0 would understate
 * by hiding the row's missing-cost status.
 */
export function aggregateBySource(rows: NormalizedRow[]): Record<Source, PerSourceTotal> {
  const out: Record<Source, PerSourceTotal> = {
    openclaw: { count: 0, totalUsd: 0 },
    hermes: { count: 0, totalUsd: 0 },
    paperclip: { count: 0, totalUsd: 0 },
  };
  for (const row of rows) {
    out[row.source].count++;
    const reportedCost = row.cost_status === 'actual'
      ? row.actual_cost_usd
      : row.cost_status === 'estimated'
        ? row.estimated_cost_usd
        : row.cost_status === 'recomputed'
          ? row.recomputed_cost_usd
          : row.cost_status === 'included'
            ? 0
            : null;
    if (reportedCost !== null && (!Number.isFinite(reportedCost) || reportedCost < 0)) {
      if (!row.row_flags.includes('invalid_cost')) row.row_flags.push('invalid_cost');
      continue;
    }
    const display = display_cost_usd(row);
    if (display !== null) out[row.source].totalUsd += display;
  }
  return out;
}

/**
 * Highest non-zero per-source total. Returns null if all sources are
 * zero/empty. Per-source totals are NEVER summed — a single source is
 * picked as the headline to avoid double-counting cost shared between
 * OpenClaw, Hermes, and Paperclip telemetry streams.
 */
export function highestReportedSourceTotal(
  perSource: Record<Source, PerSourceTotal>,
): { source: Source; total: number } | null {
  let best: { source: Source; total: number } | null = null;
  for (const source of SOURCES) {
    const total = perSource[source].totalUsd;
    if (total > 0 && (best === null || total > best.total)) {
      best = { source, total };
    }
  }
  return best;
}

/** Adapter set — overridable for tests so verify scripts can mock without IO. */
export interface AdapterSet {
  openClaw: { read: (opts?: { sinceMs?: number }) => Promise<AdapterResult> };
  hermes:   { read: (opts?: { sinceMs?: number }) => Promise<AdapterResult> };
  paperclip:{ read: (opts?: { sinceMs?: number }) => Promise<AdapterResult> };
}

const DEFAULT_ADAPTERS: AdapterSet = {
  openClaw: openClawCostAdapter,
  hermes: hermesCostAdapter,
  paperclip: paperclipCostAdapter,
};

export interface GatherFilters {
  sinceMs?: number;
  /**
   * Instance dropdown value from the dashboard filter. Routes which adapters
   * the orchestrator actually calls so the source/instance provenance the
   * dropdown promises is enforced server-side. internal reviewer watchpoint #7: showing
   * OpenClaw rows when the user picked `hermes-local` violates trust.
   *
   * Accepted values:
   *   - 'all' | undefined  → all three adapters called
   *   - 'hermes-local'     → only Hermes adapter called; the others are
   *                          short-circuited to synthetic empty AdapterResults
   *                          (count===0, source still appears in perSource so
   *                          panels render the source row with 0 rows rather
   *                          than treating it as `unavailable`).
   *   - 'paperclip'        → only Paperclip adapter called (defensive — the
   *                          dropdown does not currently expose this label).
   *   - any other string   → treated as an OpenClaw instance/agent name; only
   *                          the OpenClaw adapter is called.
   *
   * v1 limitation: when an OpenClaw-instance value (e.g. 'main') is passed,
   * the orchestrator routes by source-class only — it does NOT yet sub-scope
   * the OpenClaw adapter to a specific agent directory under
   * `~/.openclaw/agents/`. Multi-instance OpenClaw filtering is a follow-up;
   * the legacy `/api/tokens` reader path applies the per-agent filter on the
   * legacy fields, so the dashboard cards that consume the legacy shape stay
   * consistent. Sub-scoping the orchestrator's OpenClaw adapter is tracked
   * for v1.1 once the adapter signature stabilizes.
   */
  instance?: string;
}

/** Detector function type — overridable for tests. Default is the real `detectSignals`. */
export type DetectSignalsFn = (rows: NormalizedRow[], opts?: DetectOpts) => Signal[];

/**
 * Collect rows from all three source adapters in parallel via
 * Promise.allSettled. A rejected adapter promise (defense-in-depth — adapters
 * are supposed to swallow their own errors) is mapped to an empty AdapterResult
 * with a `source_unavailable` warning, keeping the orchestrator deterministic
 * even when an adapter is broken.
 *
 * The merged DetectOpts is built from each result's signal_context side-channel
 * and forwarded to detectSignals. signal_context is NEVER copied onto the
 * returned CostReport.
 *
 * The optional `detectSignalsFn` parameter exists for verify-script DI; the
 * default resolves to the real `detectSignals` from cost-signals.ts.
 */
export async function gatherCostRows(
  filters: GatherFilters = {},
  adapters: AdapterSet = DEFAULT_ADAPTERS,
  detectSignalsFn: DetectSignalsFn = defaultDetectSignals,
): Promise<CostReport> {
  // Instance routing — internal reviewer watchpoint #7. The dashboard's instance dropdown
  // promises source/instance provenance, so when the operator picks
  // `hermes-local` we MUST NOT pull OpenClaw rows. We short-circuit the
  // filtered-out adapters to synthetic empty AdapterResults rather than
  // skipping them in the Promise.allSettled — that way `perSource` still
  // contains an entry for every Source (count===0) and `sourceStatus` reads
  // 'ok' instead of 'unavailable' (the source isn't broken, just filtered).
  const instance = filters.instance ?? 'all';
  const callOpenClaw = instance === 'all' || (instance !== 'hermes-local' && instance !== 'paperclip');
  const callHermes = instance === 'all' || instance === 'hermes-local';
  const callPaperclip = instance === 'all' || instance === 'paperclip';
  const fetched_at_pre = new Date().toISOString();
  const emptyResult = (source: Source): AdapterResult => ({
    source,
    rows: [],
    warnings: [],
    fetched_at: fetched_at_pre,
  });

  const settled = await Promise.allSettled([
    callOpenClaw ? adapters.openClaw.read(filters) : Promise.resolve(emptyResult('openclaw')),
    callHermes ? adapters.hermes.read(filters) : Promise.resolve(emptyResult('hermes')),
    callPaperclip ? adapters.paperclip.read(filters) : Promise.resolve(emptyResult('paperclip')),
  ]);
  const fetched_at = new Date().toISOString();
  const results: AdapterResult[] = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          source: SOURCES[i],
          rows: [],
          warnings: [{ kind: 'source_unavailable' as const, count: 1, detail: String(r.reason) }],
          error: String(r.reason),
          fetched_at,
        },
  );

  const allRows: NormalizedRow[] = [];
  for (const r of results) allRows.push(...r.rows);

  enrichWithRecompute(allRows);

  // Merge each adapter's signal_context side-channel into a single DetectOpts
  // value for the detectors. signal_context never leaves this function — it
  // is consumed here and the public CostReport returned below has no field
  // to carry it.
  const detectOpts: DetectOpts = {};
  for (const r of results) {
    const sc = r.signal_context;
    if (!sc) continue;
    if (sc.systemPromptHashByRowId) {
      detectOpts.systemPromptHashByRowId = {
        ...(detectOpts.systemPromptHashByRowId ?? {}),
        ...sc.systemPromptHashByRowId,
      };
    }
    if (sc.stopReasonByRowId) {
      detectOpts.stopReasonByRowId = {
        ...(detectOpts.stopReasonByRowId ?? {}),
        ...sc.stopReasonByRowId,
      };
    }
  }

  const perSource = aggregateBySource(allRows);
  const headline = highestReportedSourceTotal(perSource);
  const signals = detectSignalsFn(allRows, detectOpts);

  const allWarnings: AdapterWarning[] = [];
  for (const r of results) allWarnings.push(...r.warnings);

  const sourceStatus: Record<Source, SourceStatus> = {
    openclaw: results[0].error ? 'unavailable' : 'ok',
    hermes:   results[1].error ? 'unavailable' : 'ok',
    paperclip:results[2].error ? 'unavailable' : 'ok',
  };

  // Note: signal_context is INTENTIONALLY not copied onto the public report.
  // The CostReport type does not declare it, and detectOpts has been consumed.
  return { rows: allRows, perSource, headline, signals, warnings: allWarnings, sourceStatus };
}
