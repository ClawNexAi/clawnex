"use client";

/**
 * RecentTokenEventsFiltered — recent token events list with optional inline
 * trust + signal badges per row (Task 18 of the FinOps reporting surface).
 *
 * Design rule (internal reviewer Gate C watchpoint #5, LOAD-BEARING):
 * Trust badges and signal badges are two visually distinct categories.
 *   - Trust badges: neutral gray (C.txT) — always rendered when applicable.
 *     They tell the operator how to read the cost number (Actual vs Estimated
 *     vs Recomputed vs Token-only vs Cost unknown vs Included), so they are
 *     the FIRST thing the eye lands on per row.
 *   - Signal badges: warning-tier (C.warn, yellow/orange) — only rendered
 *     when a detector fires for that row (loop risk, velocity spike, context
 *     bloat, cache drop, simple-on-expensive). They must NOT visually blend
 *     with trust badges; the contrast is what tells the operator "this is a
 *     warning, not a description of how the cost was calculated."
 *
 * Backward compatibility: the existing legacy `entries` prop and rendering
 * remain untouched. The new `rows`/`signals` props are additive — when both
 * are non-empty, they take over the table; otherwise we fall back to the
 * legacy session-log entries view. This keeps Task 18 a no-op for callers
 * that haven't been wired up to the multi-source orchestrator yet.
 */

import { useState, useEffect, useMemo } from "react";
import { C, F } from '../constants';
import { Badge, CollapsibleCard, Table } from '../shared';
import { Tooltip } from '../tooltip';
import { timeAgo } from '../utils';
import type { NormalizedRow, Signal } from '@/lib/types/cost-reporting';

// Operator-facing trust labels keyed by NormalizedRow.cost_status.
// Internal enum stays technical (e.g. 'token_only'); only the rendered
// label is humanized (e.g. 'Token-only'). Keep parity with the spec table
// in §"Inline badges (per row in tables)".
const TRUST_BADGE_LABEL: Record<NormalizedRow['cost_status'], string> = {
  actual: 'Actual',
  estimated: 'Estimated',
  recomputed: 'Recomputed',
  included: 'Included / no marginal spend',
  token_only: 'Token-only',
  unknown: 'Cost unknown',
};

// Operator-facing signal labels keyed by Signal.kind. As above, the internal
// enum stays technical for stable telemetry; the UI uses these strings.
const SIGNAL_BADGE_LABEL: Record<Signal['kind'], string> = {
  loop_risk: 'Possible loop',
  velocity_spike: 'Velocity spike',
  context_bloat: 'Context bloat',
  cache_drop: 'Cache drop',
  cache_drop_risk: 'Cache drop risk',
  simple_on_expensive: 'Simple on expensive',
};

/**
 * Local copy of the signal labels used by the filter-pill banner. Kept local
 * (not imported from SignalsCard) on purpose — the banner sentence reads
 * differently from the inline badge ("Possible repeated-call loop" vs the
 * terser badge "Possible loop"), and we don't want a cross-file coupling that
 * forces both to share the same wording.
 */
const HUMAN_LABELS: Record<Signal['kind'], string> = {
  loop_risk: 'Possible repeated-call loop',
  velocity_spike: 'Spend velocity spike',
  context_bloat: 'Context bloat risk',
  cache_drop: 'Cache hit drop',
  cache_drop_risk: 'Cache hit drop risk',
  simple_on_expensive: 'Simple task on expensive model',
};

/**
 * Build the {trust, signals} label pair for a row. Trust label always
 * starts with cost_status; the 'unsupported_currency' row flag adds a
 * second neutral trust badge ('Unsupported currency') because it is a
 * trust qualifier on the cost number, not a detector firing. Signal
 * labels are sourced by filtering signals whose affected_row_ids contains
 * this row's row_id — keeps the per-row lookup O(signals × affected).
 */
function rowBadges(row: NormalizedRow, signals: Signal[]): { trust: string[]; signals: string[] } {
  const trust: string[] = [TRUST_BADGE_LABEL[row.cost_status]];
  if (row.row_flags.includes('unsupported_currency')) trust.push('Unsupported currency');
  const signalsForRow = signals.filter(s => s.affected_row_ids.includes(row.row_id));
  const signalLabels = signalsForRow.map(s => SIGNAL_BADGE_LABEL[s.kind]);
  return { trust, signals: signalLabels };
}

type LegacyEntry = { model: string; totalTokens: number; costTotal: number; timestamp: string };

export function RecentTokenEventsFiltered({
  entries,
  rows,
  signals,
  signalFilter,
  onClearSignalFilter,
  focusedCard,
  hideDeliveryMirror = false,
}: {
  entries: LegacyEntry[];
  rows?: NormalizedRow[];
  signals?: Signal[];
  signalFilter?: Signal['kind'] | null;
  onClearSignalFilter?: () => void;
  // When the parent panel sets `focusedCard` to a value matching this card's
  // focusKey ("recentTokenEvents"), the underlying CollapsibleCard force-opens
  // and scrolls into view — same mechanism used by the Welcome Wizard. The
  // parent appends a "#timestamp" suffix on every signal click so repeat
  // clicks always re-trigger the open effect even if the card was manually
  // collapsed in between.
  focusedCard?: string | null;
  // Render-time delivery-mirror filter. Drops rows where `model ===
  // 'delivery-mirror'` from the new (rows-driven) path. Default OFF so
  // the row is visible with its tooltip context. The legacy `entries`
  // path already filters delivery-mirror unconditionally — left untouched.
  hideDeliveryMirror?: boolean;
}) {
  const [modelFilter, setModelFilter] = useState("all");
  // Pagination state — mirrors AuditEvidencePanel's convention exactly.
  // Default page size 5 (operator UX directive 2026-05-04: keep tables compact so
  // the SignalsCard ↔ Recent Events feedback loop fits on one screen);
  // options [5,10,15,25,50]. Only applied to the new NormalizedRow path; the
  // legacy `entries` path keeps its existing `slice(0, 20)` cap to avoid
  // touching pre-Task-19 wiring.
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);

  // When the orchestrator-driven rows are available, drive the table from them.
  // Otherwise fall back to the legacy session-log entries shape so existing
  // callers (TokenCostPanel pre-Task-19 wiring) keep rendering unchanged.
  const useNormalized = Array.isArray(rows) && rows.length > 0;

  // Filter out delivery-mirror and apply model filter (legacy path).
  const filtered = useMemo(() => {
    return entries
      .filter(e => e.model !== "delivery-mirror" && e.model !== "delivery")
      .filter(e => modelFilter === "all" || e.model === modelFilter);
  }, [entries, modelFilter]);

  // Same filter applied to NormalizedRow.model (new path). Rows with a null
  // model are kept under "all" but never match a specific model filter.
  // Additionally narrows by `signalFilter` when set: keep only rows whose
  // row_id appears in `affected_row_ids` of any signal whose `kind` matches.
  const filteredRows = useMemo(() => {
    if (!useNormalized) return [];
    let out = (rows ?? []).filter(r => modelFilter === "all" || r.model === modelFilter);
    // Render-time delivery-mirror filter — applied after model filter so the
    // dropdown still lists delivery-mirror as an option (operator can opt
    // back in to seeing only delivery-mirror rows even when the toggle is on).
    if (hideDeliveryMirror) {
      out = out.filter(r => r.model !== 'delivery-mirror');
    }
    if (signalFilter && (signals?.length ?? 0) > 0) {
      const matchingSignals = (signals ?? []).filter(s => s.kind === signalFilter);
      const filteringRowIds = new Set(matchingSignals.flatMap(s => s.affected_row_ids));

      // velocity_spike fallback: the detector emits this signal with an empty
      // affected_row_ids list (it attaches to the per-source tile, not to
      // individual rows). To still give the operator something useful when
      // they click the row, we filter Recent Events down to rows from the
      // current hour matching the source named in `signal.detail`. Detail
      // format: "<source>: current hour $X vs baseline $Y (Zx)" — see
      // cost-signals.ts L246.
      if (signalFilter === 'velocity_spike' && filteringRowIds.size === 0) {
        const sourcePrefixMatch = matchingSignals[0]?.detail.match(/^(\w+):/);
        const filterSource = sourcePrefixMatch?.[1];
        if (!filterSource) return out;
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        out = out.filter(r => r.source === filterSource && Date.parse(r.timestamp) >= oneHourAgo);
      } else {
        out = out.filter(r => filteringRowIds.has(r.row_id));
      }
    }
    return out;
  }, [rows, modelFilter, useNormalized, signalFilter, signals, hideDeliveryMirror]);

  const uniqueModels = useMemo(() => {
    if (useNormalized) {
      return Array.from(new Set((rows ?? []).map(r => r.model).filter((m): m is string => !!m))).sort();
    }
    return Array.from(new Set(entries.filter(e => e.model !== "delivery-mirror" && e.model !== "delivery").map(e => e.model))).sort();
  }, [entries, rows, useNormalized]);

  // Reset to page 1 whenever pagination-affecting state changes.
  useEffect(() => { setCurrentPage(0); }, [pageSize, modelFilter, signalFilter]);

  if (!useNormalized && entries.length === 0) return null;
  if (useNormalized && (rows ?? []).length === 0) return null;

  const visibleCount = useNormalized ? filteredRows.length : filtered.length;
  const sigList = signals ?? [];

  // Slice for the current page (new path only). Legacy path keeps its
  // existing 20-row hard cap.
  const totalPages = useNormalized ? Math.ceil(filteredRows.length / pageSize) : 0;
  const pagedRows = useNormalized ? filteredRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : [];

  // Dynamic card title — when a signal filter is active, surface the
  // filtered/total row counts directly in the heading so the operator sees
  // the active narrowing even if they scrolled past the pill banner.
  // velocity_spike's filter is past-hour-of-source rather than per-row, so
  // the "X of Y" framing doesn't apply — show the count alone for that kind.
  const cardTitle = signalFilter
    ? signalFilter === 'velocity_spike'
      ? `Recent Events · filtered: ${filteredRows.length} (past hour)`
      : `Recent Events · filtered: ${filteredRows.length} of ${(rows ?? []).length}`
    : 'Recent Events';

  return (
    <CollapsibleCard
      title={cardTitle}
      accent={C.info}
      count={visibleCount}
      defaultOpen={false}
      focusKey="recentTokenEvents"
      focusedCard={focusedCard ?? null}
    >
      {signalFilter && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          marginBottom: 12,
          background: `${C.warn}22`,
          border: `1px solid ${C.warn}55`,
          borderRadius: 8,
          fontFamily: F.mono,
          fontSize: 11,
        }}>
          <span style={{ color: C.warn, fontWeight: 700 }}>●</span>
          <span style={{ color: C.tx }}>
            Filtered by signal: <strong style={{ color: C.warn }}>{HUMAN_LABELS[signalFilter]}</strong>
          </span>
          <span style={{ color: C.txT }}>
            {signalFilter === 'velocity_spike'
              ? `· Showing ${filteredRows.length} rows from the past hour (velocity_spike has no per-row attribution)`
              : `· Showing ${filteredRows.length} of ${(rows ?? []).length} rows`}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => onClearSignalFilter?.()}
            style={{
              padding: '3px 8px',
              background: 'transparent',
              border: `1px solid ${C.brd}`,
              borderRadius: 3,
              color: C.txS,
              fontFamily: F.mono,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Clear ✕
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <select value={modelFilter} onChange={e => setModelFilter(e.target.value)} style={{ fontSize: 10, padding: "2px 6px", background: C.bg, border: `1px solid ${modelFilter !== "all" ? C.brand : C.brd}`, borderRadius: 3, color: modelFilter !== "all" ? C.brand : C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}>
          <option value="all">All Models</option>
          {uniqueModels.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {useNormalized ? (
        <>
        <Table
          headers={[
            <Tooltip key="h-model" placement="bottom" variant="compact" content="Provider's model identifier (e.g. claude-sonnet-4-6, gpt-5.4).">Model</Tooltip>,
            <Tooltip key="h-tokens" placement="bottom" variant="compact" content="Total tokens for this row: input + output + cache-read + cache-write + reasoning.">Tokens</Tooltip>,
            <Tooltip key="h-cost" placement="bottom" variant="detail" content="Resolved cost for this row per its cost_status (actual / estimated / recomputed / included $0 / token_only or unknown displayed as —).">Cost</Tooltip>,
            <Tooltip key="h-badges" placement="bottom" variant="detail" content="Trust badges (gray, neutral) describe how the cost figure was resolved. Signal badges (warning, yellow) indicate the row was flagged by a drain detector.">Badges</Tooltip>,
            <Tooltip key="h-time" placement="bottom" variant="compact" content="Timestamp of this individual cost-bearing event.">Time</Tooltip>,
          ]}
          rows={pagedRows.map((r, i) => {
            const tokensTotal =
              (r.input_tokens ?? 0) +
              (r.output_tokens ?? 0) +
              (r.cache_read_tokens ?? 0) +
              (r.cache_write_tokens ?? 0) +
              (r.reasoning_tokens ?? 0);
            const cost = r.actual_cost_usd ?? r.estimated_cost_usd ?? r.recomputed_cost_usd;
            const badges = rowBadges(r, sigList);
            return [
              // Per-row delivery-mirror tooltip removed 2026-05-04 per operator
              // feedback: redundant when every row carries it. Canonical
              // delivery-mirror explanation lives on the "Token Usage by Model
              // (session logs)" card in TokenCostPanel.tsx — that's the single
              // source of truth surface.
              <span key={`m-${i}`} style={{ fontSize: 11, fontFamily: F.mono }}>{r.model ?? "—"}</span>,
              <span key={`t-${i}`} style={{ fontWeight: 700, color: C.brand }}>{tokensTotal.toLocaleString()}</span>,
              <span key={`c-${i}`} style={{ color: C.warn }}>{cost == null ? "—" : `$${cost.toFixed(6)}`}</span>,
              // Badge cell: trust badges (neutral gray) ALWAYS render first;
              // signal badges (warning yellow/orange) follow only when a
              // detector fired for this row. The two color treatments are
              // visually distinct on purpose — see file header.
              <div key={`b-${i}`} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {badges.trust.map((label, ti) => (
                  <Badge key={`tb-${i}-${ti}`} label={label} color={C.txT} />
                ))}
                {badges.signals.map((label, si) => (
                  <Badge key={`sb-${i}-${si}`} label={label} color={C.warn} />
                ))}
              </div>,
              <span key={`ts-${i}`} style={{ fontSize: 12, color: C.txS }}>{timeAgo(r.timestamp)}</span>,
            ];
          })}
        />
        {/* Pagination footer — styled identically to AuditEvidencePanel. */}
        {filteredRows.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}22` }}>
            {/* internal reviewer 2026-05-06 contrast: pagination label is decision-bearing — 11/txT → 12/txS. */}
            <span style={{ fontSize: 12, color: C.txS, fontFamily: F.mono }}>
              Page {totalPages === 0 ? 1 : currentPage + 1} of {totalPages === 0 ? 1 : totalPages}
            </span>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: currentPage === 0 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage === 0 ? "not-allowed" : "pointer" }}>{"‹"}</button>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: currentPage >= totalPages - 1 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage >= totalPages - 1 ? "not-allowed" : "pointer" }}>{"›"}</button>
              <select value={String(pageSize)} onChange={e => setPageSize(parseInt(e.target.value))} style={{ fontSize: 11, padding: "2px 6px", background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 3, color: C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="15">15</option>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </div>
          </div>
        )}
        </>
      ) : (
        <Table
          headers={["Model", "Tokens", "Cost", "Time"]}
          rows={filtered.slice(0, 20).map((e, i) => [
            <span key={`m-${i}`} style={{ fontSize: 11, fontFamily: F.mono }}>{e.model}</span>,
            <span key={`t-${i}`} style={{ fontWeight: 700, color: C.brand }}>{e.totalTokens.toLocaleString()}</span>,
            <span key={`c-${i}`} style={{ color: C.warn }}>${e.costTotal.toFixed(6)}</span>,
            <span key={`ts-${i}`} style={{ fontSize: 11, color: C.txT }}>{timeAgo(e.timestamp)}</span>,
          ])}
        />
      )}
    </CollapsibleCard>
  );
}
