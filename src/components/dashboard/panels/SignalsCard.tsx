// src/components/dashboard/panels/SignalsCard.tsx
"use client";

/**
 * SignalsCard — compact counter card surfacing detector signals on the
 * Token Cost tab.
 *
 * One row per signal kind; each row shows a count and an operator-friendly
 * label (NOT the internal enum literal). Clicking a row toggles a filter on
 * the rows table below — `onFilter(kind)` to apply, `onFilter(null)` to clear.
 *
 * The internal enum (e.g. `loop_risk`) stays technical and is only used for
 * filter state and click-handler dispatch. Only `HUMAN_LABELS[k]` ever appears
 * in rendered text. This is internal reviewer Gate C watchpoint #3 — load-bearing.
 *
 * Spec: docs/superpowers/specs/2026-05-04-token-cost-finops-reporting-design.md
 *       § "Signals card"
 */

import { useMemo } from 'react';
import { C, F } from '../constants';
import { Card } from '../shared';
import { Tooltip } from '../tooltip';
import type { NormalizedRow, Signal } from '@/lib/types/cost-reporting';

interface Props {
  signals: Signal[];
  onFilter?: (kind: Signal['kind'] | null) => void;
  activeFilter?: Signal['kind'] | null;
  /**
   * Optional NormalizedRow set, passed through from TokenCostPanel. Used by
   * the inline-evidence expansion to look up affected_row_ids and render a
   * compact sample of rows that triggered the active signal. When absent,
   * the expansion still renders the detail-string header but skips the
   * per-row sample list.
   */
  rows?: NormalizedRow[];
}

/**
 * Format a timestamp as HH:MM:SS local time. Used in the inline-evidence
 * expansion to keep sample rows compact (full date is redundant — the row is
 * recent by construction).
 */
function formatTimeShort(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function truncateModel(model: string | null, max = 24): string {
  if (!model) return '—';
  return model.length > max ? `${model.slice(0, max - 1)}…` : model;
}

/**
 * Operator-friendly labels for each Signal kind. Every member of the
 * `Signal['kind']` union must have an entry here — TypeScript enforces
 * exhaustiveness via the `Record<Signal['kind'], string>` constraint.
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
 * Per-kind hover explanations. One sentence (sometimes two) describing what
 * THAT detector found and any caveats specific to its source coverage. These
 * are intentionally more technical than HUMAN_LABELS — labels are the at-rest
 * read for an operator scanning the card; tooltips are the deep-dive when they
 * pause on a row before clicking through to filter Recent Events.
 */
const SIGNAL_TOOLTIP: Record<Signal['kind'], string> = {
  loop_risk: "Multiple near-identical calls in a short window — possible runaway loop or repeated-prompt pattern. Hermes uses system_prompt hash matching; OpenClaw + Paperclip use structural (session/agent/model) heuristics.",
  velocity_spike: "Spend in the current hour is significantly above the 7-day rolling baseline for this source. Requires at least 24 hours of historical data + a non-zero baseline before firing.",
  context_bloat: "Input tokens grew substantially over the lifetime of a single session — context may be accumulating without compaction. Fires only on sessions with at least 10 rows where last-5-avg > 2× first-5-avg.",
  cache_drop: "Cache-hit ratio (Anthropic-style prompt caching) dropped significantly vs the trailing 7-day average for the same system_prompt. Precise — Hermes only, since system_prompt is the cohort key.",
  cache_drop_risk: "Cache-hit ratio appears to have dropped vs the trailing average for this (agent, model) cohort. Less precise than cache_drop because OpenClaw doesn't expose system_prompt — treat as a hint rather than a confirmation.",
  simple_on_expensive: "Simple call (input < 500 tokens, output < 200 tokens, no tool calls) on a model whose input rate exceeds $5/Mtok. Consider whether a cheaper model would suffice for this workload pattern.",
};

export function SignalsCard({ signals, onFilter, activeFilter, rows }: Props) {
  const counts = useMemo(() => {
    const c: Partial<Record<Signal['kind'], number>> = {};
    for (const s of signals) c[s.kind] = (c[s.kind] ?? 0) + 1;
    return c;
  }, [signals]);

  // Bucket signals by kind once so the inline-evidence expansion below has
  // O(1) access to the matching signal(s) for the active row.
  const signalsByKind = useMemo(() => {
    const m: Partial<Record<Signal['kind'], Signal[]>> = {};
    for (const s of signals) {
      (m[s.kind] ??= []).push(s);
    }
    return m;
  }, [signals]);

  // Index rows by row_id for the affected-row sample lookup (B-feature). We
  // build the index even if `rows` is undefined — the loop is a no-op then.
  const rowsById = useMemo(() => {
    const m = new Map<string, NormalizedRow>();
    for (const r of rows ?? []) m.set(r.row_id, r);
    return m;
  }, [rows]);

  // No signals → don't render the card at all (the surface stays quiet when
  // there's nothing to surface; this is the "operator inbox is empty" state).
  if (Object.keys(counts).length === 0) {
    return null;
  }

  // The card title is wrapped in a Tooltip so the click-to-filter affordance
  // is discoverable on hover — the small footer hint at the bottom of the card
  // is easy to miss. `Card`'s `title` prop is typed `string`, but its render
  // path passes the value straight through `<h3>{title}</h3>`, which happily
  // accepts any ReactNode. We cast through `unknown` to satisfy TS without
  // changing the shared.tsx primitive (out of scope).
  const titleNode = (
    <Tooltip
      placement="bottom"
      variant="detail"
      content="Drain detection signals fired against monitored cost telemetry. Click any signal below to filter the Recent Events table to only the rows that triggered it."
    >
      Signals
    </Tooltip>
  ) as unknown as string;

  return (
    <Card title={titleNode} accent={C.warn}>
      {Object.entries(counts).map(([kind, count]) => {
        const k = kind as Signal['kind'];
        const isActive = activeFilter === k;
        // Native <button> per internal reviewer Gate C accessibility polish (2026-05-04):
        // built-in keyboard activation (Space/Enter), focus ring, role=button
        // semantics for screen readers. Button defaults are reset inline so
        // the row visually matches its previous <div> rendering — width 100%,
        // left-aligned text, transparent border, font inheritance, no padding
        // surprises. :focus-visible outline is provided via a small <style>
        // tag scoped by class — inline styles can't express :focus-visible
        // and this codebase doesn't use styled-jsx in panels.
        //
        // Wrapping <div>: holds both the click target (<button>) and the
        // inline evidence expansion (rendered as a SIBLING of the button when
        // active). The expansion MUST NOT live inside the button — nesting
        // interactive content inside a button is a WCAG violation and breaks
        // the existing per-kind tooltip on the label.
        return (
          <div key={k}>
            <button
              type="button"
              className="signals-row-button"
              onClick={() => onFilter?.(isActive ? null : k)}
              style={{
                display: 'flex',
                gap: 12,
                padding: '6px 8px',
                cursor: onFilter ? 'pointer' : 'default',
                background: isActive ? C.bgS : 'transparent',
                borderRadius: 4,
                fontFamily: F.mono,
                fontSize: 12,
                border: 'none',
                width: '100%',
                textAlign: 'left' as const,
                font: 'inherit',
                color: 'inherit',
                alignItems: 'center',
              }}
            >
              <span style={{ color: C.warn, fontWeight: 700, minWidth: 20, textAlign: 'right' }}>{count}</span>
              {/* Per-kind detail tooltip on the human-readable label. The Tooltip
                  primitive uses pointer-events:none on its portal, so the row's
                  onClick (filter toggle) still fires when the user clicks the
                  label — verified in tooltip.tsx (`role="tooltip"` content has
                  pointer-events:none, and the inline span anchor only adds a
                  dotted underline). */}
              <Tooltip placement="right" variant="detail" content={SIGNAL_TOOLTIP[k]}>
                <span style={{ color: C.tx }}>{HUMAN_LABELS[k]}</span>
              </Tooltip>
              {isActive && (
                <>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: C.warn, fontStyle: 'italic', fontSize: 10 }}>← filtering</span>
                </>
              )}
            </button>
            {isActive && <SignalEvidence kind={k} signals={signalsByKind[k] ?? []} rowsById={rowsById} />}
          </div>
        );
      })}
      {/* Keyboard focus ring — only visible during keyboard navigation, not
          mouse clicks. Rules live in src/app/globals.css (.signals-row-button
          :focus + :focus-visible) so the page doesn't emit an inline <style>
          tag — H2 2026-05-14 migration to drop CSP style-src 'unsafe-inline'.
          The warn color follows the active theme via the --clawnex-warn CSS
          variable defined in globals.css. */}
      {onFilter && (
        <div style={{ fontSize: 10, color: C.txT, marginTop: 8, fontStyle: 'italic' }}>
          Click a signal to filter Recent Events below.
        </div>
      )}
    </Card>
  );
}

/**
 * Inline evidence expansion for the active signal row. Rendered as a SIBLING
 * of the row's <button> (never inside it — see button-in-button a11y note in
 * the parent). Renders one of two shapes:
 *
 *   • Per-row signals (loop_risk, context_bloat, cache_drop, cache_drop_risk,
 *     simple_on_expensive): italic header from `signal.detail`, then up to 3
 *     compact sample rows looked up via `affected_row_ids` → `rowsById`. Beyond
 *     3 we render "…and N more".
 *
 *   • velocity_spike: the detail string already encodes all the evidence
 *     (current hour total, baseline, ratio) — no row list. We append a hint
 *     line so the operator knows the Recent Events table below has been
 *     filtered to past-hour rows for the same source (see Part C in
 *     RecentTokenEventsFiltered for the corresponding filter fallback).
 */
function SignalEvidence({
  kind,
  signals,
  rowsById,
}: {
  kind: Signal['kind'];
  signals: Signal[];
  rowsById: Map<string, NormalizedRow>;
}) {
  if (signals.length === 0) return null;

  // velocity_spike has empty affected_row_ids by design — render the detail
  // string verbatim plus the filter-hint line.
  if (kind === 'velocity_spike') {
    const sig = signals[0];
    // Parse "<source>: ..." prefix for the hint. Falls back to a generic
    // wording when the prefix is missing (defensive; the detector always
    // emits one in current form).
    const sourceMatch = sig.detail.match(/^(\w+):/);
    const sourceLabel = sourceMatch?.[1] ?? 'this source';
    return (
      <div
        style={{
          padding: '6px 12px 8px 12px',
          fontFamily: F.mono,
          fontSize: 11,
          color: C.tx,
        }}
      >
        <div style={{ fontStyle: 'italic', color: C.warn, marginBottom: 4 }}>{sig.detail}</div>
        <div style={{ fontSize: 10, color: C.txT }}>
          Recent Events filtered to {sourceLabel} rows from the past hour.
        </div>
      </div>
    );
  }

  // Per-row signals: header (detail) + sample of up to 3 affected rows. We
  // collect across ALL signals of this kind in case multiple loops/contexts
  // fired — the operator wants to see breadth, not a single instance.
  const affectedIds = signals.flatMap(s => s.affected_row_ids);
  const sampleIds = affectedIds.slice(0, 3);
  const moreCount = Math.max(0, affectedIds.length - sampleIds.length);
  const headerDetail = signals[0].detail;

  return (
    <div
      style={{
        padding: '6px 12px 8px 12px',
        fontFamily: F.mono,
        fontSize: 11,
        color: C.tx,
      }}
    >
      <div style={{ fontStyle: 'italic', color: C.warn, marginBottom: 4 }}>{headerDetail}</div>
      {sampleIds.length === 0 ? (
        <div style={{ fontSize: 10, color: C.txT }}>(no per-row attribution available)</div>
      ) : (
        sampleIds.map(rid => {
          const r = rowsById.get(rid);
          if (!r) {
            // affected_row_id pointed at a row not in the current rows
            // window (e.g. paginated/filtered upstream). Show the id stub so
            // the evidence line still anchors to something concrete.
            return (
              <div key={rid} style={{ fontSize: 10, color: C.txT }}>
                row {rid.slice(0, 12)}… (not in current window)
              </div>
            );
          }
          const inT = r.input_tokens ?? 0;
          const outT = r.output_tokens ?? 0;
          return (
            <div
              key={rid}
              style={{
                display: 'flex',
                gap: 8,
                fontSize: 10,
                color: C.txS,
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: C.txT, minWidth: 64 }}>{formatTimeShort(r.timestamp)}</span>
              <span style={{ minWidth: 180 }}>{truncateModel(r.model)}</span>
              <span style={{ color: C.brand }}>
                {inT.toLocaleString()} → {outT.toLocaleString()}
              </span>
              <span style={{ color: C.txT, textTransform: 'uppercase', fontSize: 9 }}>{r.source}</span>
            </div>
          );
        })
      )}
      {moreCount > 0 && (
        <div style={{ fontSize: 10, color: C.txT, marginTop: 2 }}>…and {moreCount} more</div>
      )}
    </div>
  );
}
