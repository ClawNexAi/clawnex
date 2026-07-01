"use client";

/**
 * Cost by Session card — per-session token + cost breakdown.
 *
 * Sister surface to CostByAgentCard; both consume /api/tokens but pivot the
 * data on a different axis. This one rolls cost up by session_id, attributing
 * each session to the agent that owns it where possible. Unmatched session_ids
 * (proxy_traffic rows whose session_id doesn't map to any OpenClaw agent
 * directory) land in an explicit `unknown` bucket on the legacy path — these
 * are calls that bypassed OpenClaw routing entirely (direct-to-Anthropic,
 * direct-to-OpenRouter, etc.).
 *
 * Task 17 (multi-source): when /api/tokens returns the v1 `rows` field, we
 * aggregate by `(source, session_id)`. the reviewer's spec rule (LOAD-BEARING):
 * Paperclip rows have `session_id == null` and MUST be skipped here — they
 * surface only on the agent-grouped view, never under a synthetic "no session"
 * bucket. internal reviewer Gate-C identity-merge constraint: same session_id from
 * different sources stays separate (key includes `${source}::` prefix);
 * collisions across sources are theoretically impossible (OpenClaw uses
 * `openclaw:<agent>:<file>`, Hermes uses raw UUIDs) but the prefix guarantees
 * correctness regardless.
 *
 * @module dashboard/panels/CostBySessionCard
 */

import { useState, useEffect, useMemo } from "react";
import { C, F } from '../constants';
import { Badge, CollapsibleCard } from '../shared';
import { Tooltip } from '../tooltip';
import type { DashboardFilters } from '../types';
import { display_cost_usd } from '@/lib/cost-reporting-display';
import type { NormalizedRow, Source } from '@/lib/types/cost-reporting';

// Per-source visual identity. Mirrors CostByAgentCard's local copy so source
// attribution stays visually consistent across cost panels. Declared locally
// per the Task 17 instruction — the shared-module refactor is deferred so
// this task stays scoped to a single file.
const SOURCE_COLOR: Record<Source, string> = {
  openclaw: C.cyan,
  hermes: C.brand,
  paperclip: C.purp,
};

const SOURCE_LABEL: Record<Source, string> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  paperclip: 'Paperclip',
};

interface SessionRow {
  sessionId: string;
  agent: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  firstSeen?: string;
  lastSeen?: string;
  source: 'session' | 'proxy' | 'mixed';
  costStatus?: 'known' | 'unknown' | 'invalid' | 'mixed';
  invalidCostRows?: number;
  unpricedRows?: number;
}

// Local shape extending the legacy fetch payload with v1 NormalizedRow rows.
// Both shapes are populated by /api/tokens during the migration window; we
// prefer rows when present and non-empty, and fall back to the legacy
// costBySession shape otherwise so older endpoints / tests keep working.
type CardData = {
  costBySession: SessionRow[];
  rows?: NormalizedRow[];
};

const UNKNOWN_TOOLTIP = (
  <span>
    Session traffic from the LiteLLM proxy whose <code style={{ background: "rgba(255,255,255,0.06)", padding: "0 3px", borderRadius: 2 }}>session_id</code>{" "}
    didn&apos;t match any OpenClaw agent directory under{" "}
    <code style={{ background: "rgba(255,255,255,0.06)", padding: "0 3px", borderRadius: 2 }}>~/.openclaw/agents/&lt;id&gt;/sessions/</code>.
    Most often these are calls that <strong>bypassed OpenClaw routing</strong> —
    direct-to-Anthropic or direct-to-OpenRouter requests that ClawNex saw via
    the proxy but couldn&apos;t attribute to a fleet agent. Cost is still real;
    the agent label just isn&apos;t recoverable from this data alone.
  </span>
);

function shortSession(id: string): string {
  if (!id) return "—";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function CostQualityBadge({ status, unknownRows }: { status?: string; unknownRows?: number }) {
  if (status === 'invalid') return <Badge label="INVALID COST" color={C.danger} />;
  if (status === 'mixed') return <Badge label="MIXED COST" color={C.warn} />;
  if (status === 'unknown' || (unknownRows || 0) > 0) return <Badge label="COST UNKNOWN" color={C.txT} />;
  return null;
}

function normalizedRowCostQuality(row: NormalizedRow, display: number | null): 'known' | 'unknown' | 'invalid' {
  if (row.row_flags.includes('invalid_cost')) return 'invalid';
  const costValues = [row.actual_cost_usd, row.estimated_cost_usd, row.recomputed_cost_usd];
  if (costValues.some((value) => typeof value === 'number' && (!Number.isFinite(value) || value < 0))) {
    return 'invalid';
  }
  return display === null ? 'unknown' : 'known';
}

export function CostBySessionCard({ globalFilters, demoMode, hideDeliveryMirror = false }: { globalFilters: DashboardFilters; demoMode?: boolean; hideDeliveryMirror?: boolean }) {
  const [localRange, setLocalRange] = useState<string | null>(null);
  const [data, setData] = useState<CardData | null>(null);
  // Pagination state — mirrors AuditEvidencePanel's convention exactly.
  // Default page size 5 (operator UX directive 2026-05-04: keep tables compact so
  // the SignalsCard ↔ Recent Events feedback loop fits on one screen);
  // options [5,10,15,25,50].
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);

  const activeRange = localRange || globalFilters.timeRange;
  const since = useMemo(() => {
    const ms: Record<string, number> = { "1h": 3600000, "6h": 21600000, "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
    return new Date(Date.now() - (ms[activeRange] || 86400000)).toISOString();
  }, [activeRange]);

  useEffect(() => {
    if (demoMode) {
      // No fixture mock for per-session yet. Demo mode renders nothing rather
      // than fabricating session_ids that look real but aren't traceable.
      setData({ costBySession: [] });
      return;
    }
    (async () => {
      try {
        const instanceParam = globalFilters.selectedInstance !== "all" ? `&instance=${encodeURIComponent(globalFilters.selectedInstance)}` : "";
        const res = await fetch(`/api/tokens?since=${encodeURIComponent(since)}${instanceParam}`);
        if (res.ok) {
          const d = await res.json();
          setData({ costBySession: d.costBySession || [], rows: d.rows });
        }
      } catch {}
    })();
  }, [since, globalFilters.selectedInstance, demoMode]);

  // New aggregation: group NormalizedRows by (source, session_id). internal reviewer Gate-C
  // forbids cross-source identity merge, so the map key is
  // `${source}::${session_id}` — an OpenClaw session and a Hermes session with
  // the same id (theoretically impossible given the id schemas, but the prefix
  // guarantees correctness) land in two separate rows.
  //
  // LOAD-BEARING: rows with `session_id == null` (Paperclip) are skipped. Per
  // the reviewer's spec, Paperclip rows appear in agent-grouped view only — they must
  // never be grouped under a synthetic "no session" bucket here.
  //
  // Per-source totals must NEVER be summed (internal reviewer #4); we compute one total per
  // (source, session_id) row and sort, but never output a combined sum.
  const bySessionSource = useMemo(() => {
    const map = new Map<string, {
      source: Source;
      sessionId: string;
      agent: string | null;
      count: number;
      totalUsd: number;
      tokens: number;
      unknownCostRows: number;
      invalidCostRows: number;
      firstSeen: string;
      lastSeen: string;
    }>();
    for (const row of data?.rows ?? []) {
      // Paperclip null-session skip — load-bearing. See header comment.
      if (!row.session_id) continue;
      // Render-time delivery-mirror filter — see TokenCostPanel.hideDeliveryMirror
      // state declaration. Applied BEFORE bucketing so per-session totals
      // match what an operator would expect post-toggle.
      if (hideDeliveryMirror && row.model === 'delivery-mirror') continue;
      const key = `${row.source}::${row.session_id}`;
      const display = display_cost_usd(row);
      if (!map.has(key)) {
        map.set(key, {
          source: row.source,
          sessionId: row.session_id,
          agent: row.agent,
          count: 0,
          totalUsd: 0,
          tokens: 0,
          unknownCostRows: 0,
          invalidCostRows: 0,
          firstSeen: row.timestamp,
          lastSeen: row.timestamp,
        });
      }
      const cur = map.get(key)!;
      cur.count++;
      // display_cost_usd returns null for token_only / unknown / unsupported_currency
      // — those rows count toward the call count but not the cost total.
      if (display !== null) cur.totalUsd += display;
      const quality = normalizedRowCostQuality(row, display);
      if (quality === 'invalid') cur.invalidCostRows++;
      else if (quality === 'unknown') cur.unknownCostRows++;
      cur.tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
      if (row.timestamp < cur.firstSeen) cur.firstSeen = row.timestamp;
      if (row.timestamp > cur.lastSeen) cur.lastSeen = row.timestamp;
    }
    return Array.from(map.values()).sort((a, b) => b.totalUsd - a.totalUsd);
  }, [data?.rows, hideDeliveryMirror]);

  // Reset to page 1 whenever pagination-affecting state changes.
  useEffect(() => { setCurrentPage(0); }, [pageSize, activeRange]);

  if (!data) return null;

  // Decide which rendering path to use. Prefer the new rows-driven path when
  // /api/tokens returned a non-empty rows array (the migration target).
  // Fall back to the legacy costBySession shape only when rows is undefined or
  // zero-length, so probes and demo mode still render correctly until every
  // endpoint emits the new fields.
  const useNewPath = bySessionSource.length > 0;

  if (useNewPath) {
    // Slice for current page. the operator's screenshot showed ~52 rows here, so
    // pagination is the load-bearing UX win on this card.
    const totalPages = Math.ceil(bySessionSource.length / pageSize);
    const pagedRows = bySessionSource.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
    return (
      <CollapsibleCard
        title={`Cost by Session (${activeRange})`}
        count={bySessionSource.length}
        accent={C.purp}
        defaultOpen={false}
        actions={
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {["1h", "6h", "24h", "7d", "30d"].map(t => (
              <button key={t} onClick={() => setLocalRange(t === globalFilters.timeRange ? null : t)} style={{
                padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, fontFamily: F.mono, cursor: "pointer",
                background: activeRange === t ? `${C.purp}18` : "transparent",
                border: `1px solid ${activeRange === t ? C.purp : C.brd}`,
                color: activeRange === t ? C.purp : C.txT,
              }}>{t}</button>
            ))}
          </div>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto auto auto", gap: "4px 12px", alignItems: "center" }}>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
            <Tooltip placement="bottom" variant="compact" content="Session identifier from the source. OpenClaw uses agent:file format; Hermes uses raw UUID.">Session</Tooltip>
          </div>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
            <Tooltip placement="bottom" variant="compact" content="Owning agent for this session, when the source exposes it. May be blank for Hermes (no agent identity in v1).">Agent</Tooltip>
          </div>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
            <Tooltip placement="bottom" variant="compact" content="Telemetry stream this session came from: OpenClaw / Hermes.">Source</Tooltip>
          </div>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right" }}>
            <Tooltip placement="bottom" variant="compact" content="Number of cost-bearing rows attributed to this session in the window.">Calls</Tooltip>
          </div>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right" }}>
            <Tooltip placement="bottom" variant="compact" content="Sum of input + output tokens across this session's rows.">Tokens</Tooltip>
          </div>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right" }}>
            <Tooltip placement="bottom" variant="compact" content="Sum of display cost across this session's rows.">Cost</Tooltip>
          </div>
          {pagedRows.map(entry => (
            <div key={`${entry.source}::${entry.sessionId}`} style={{ display: "contents" }}>
              <span title={entry.sessionId} style={{ fontSize: 12, fontWeight: 700, color: C.tx, fontFamily: F.mono }}>{shortSession(entry.sessionId)}</span>
              <span style={{ fontSize: 12, color: entry.agent ? C.txS : C.txT, fontFamily: entry.agent ? undefined : F.mono }}>{entry.agent ?? "—"}</span>
              <Badge label={SOURCE_LABEL[entry.source]} color={SOURCE_COLOR[entry.source]} />
              <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono, textAlign: "right" }}>{entry.count}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.brand, fontFamily: F.mono, textAlign: "right" }}>{entry.tokens.toLocaleString()}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.warn, fontFamily: F.mono, textAlign: "right" }}>${entry.totalUsd.toFixed(4)}</span>
              {(entry.invalidCostRows > 0 || entry.unknownCostRows > 0) && (
                <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", marginTop: -2, marginBottom: 2 }}>
                  <CostQualityBadge status={entry.invalidCostRows > 0 ? "invalid" : "unknown"} unknownRows={entry.unknownCostRows} />
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Pagination footer — styled identically to AuditEvidencePanel. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}22` }}>
          <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>
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
      </CollapsibleCard>
    );
  }

  // Legacy fallback path. Preserved verbatim from the pre-Task-17 implementation
  // so probes / endpoints that don't yet emit `rows` keep rendering. Removed
  // once every cost endpoint emits the canonical v1 fields.
  const sessionMap = new Map<string, SessionRow[]>();
  for (const row of data.costBySession) {
    if (!sessionMap.has(row.sessionId)) sessionMap.set(row.sessionId, []);
    sessionMap.get(row.sessionId)!.push(row);
  }
  const sessions = Array.from(sessionMap.entries())
    .map(([sessionId, rows]) => ({
      sessionId,
      rows,
      totalCost: rows.reduce((s, r) => s + r.cost, 0),
      totalTokens: rows.reduce((s, r) => s + r.totalTokens, 0),
      totalRequests: rows.reduce((s, r) => s + r.requests, 0),
      agent: rows[0]?.agent || "unknown",
      costStatus: rows.some(r => r.costStatus === 'invalid') ? 'invalid' : rows.some(r => r.costStatus === 'mixed') ? 'mixed' : rows.some(r => r.costStatus === 'unknown') ? 'unknown' : 'known',
      unpricedRows: rows.reduce((s, r) => s + (r.unpricedRows || 0), 0),
      isUnknown: (rows[0]?.agent || "unknown") === "unknown",
      firstSeen: rows.map(r => r.firstSeen).filter(Boolean).sort()[0],
      lastSeen: rows.map(r => r.lastSeen).filter(Boolean).sort().slice(-1)[0],
    }))
    .sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens);

  // Pagination (legacy path) — same convention as the new path.
  const legacyTotalPages = Math.ceil(sessions.length / pageSize);
  const legacyPagedSessions = sessions.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const unknownCount = sessions.filter(s => s.isUnknown).length;

  return (
    <CollapsibleCard
      title={`Cost by Session (${activeRange})`}
      count={sessions.length}
      accent={C.purp}
      defaultOpen={false}
      actions={
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {unknownCount > 0 && (
            <Tooltip as="span" placement="top" variant="detail" content={UNKNOWN_TOOLTIP}>
              <span style={{
                fontSize: 9, fontWeight: 700, fontFamily: F.mono,
                padding: "2px 5px", borderRadius: 999,
                background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`,
                color: C.txS, letterSpacing: "0.05em",
              }}>
                {unknownCount} UNKNOWN
              </span>
            </Tooltip>
          )}
          {["1h", "6h", "24h", "7d", "30d"].map(t => (
            <button key={t} onClick={() => setLocalRange(t === globalFilters.timeRange ? null : t)} style={{
              padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, fontFamily: F.mono, cursor: "pointer",
              background: activeRange === t ? `${C.purp}22` : "transparent",
              border: `1px solid ${activeRange === t ? `${C.purp}55` : C.glassBorderSubtle}`,
              color: activeRange === t ? C.purp : C.txT,
            }}>{t}</button>
          ))}
        </div>
      }
    >
      {sessions.length === 0 && <span style={{ fontSize: 12, color: C.txT }}>No session traffic in this period.</span>}
      {legacyPagedSessions.map(s => (
        <div key={s.sessionId} style={{
          marginBottom: 8,
          background: s.isUnknown ? `${C.txT}22` : C.glassSurfTrans,
          border: `1px solid ${s.isUnknown ? `${C.txT}55` : C.glassSurfBorder}`,
          borderLeft: `4px solid ${s.isUnknown ? C.txT : C.purp}`,
          borderRadius: 14, padding: 10,
          boxShadow: C.glassCardShadow,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <span title={s.sessionId} style={{ fontSize: 11, fontWeight: 700, color: C.tx, fontFamily: F.mono }}>
              {shortSession(s.sessionId)}
            </span>
            {s.isUnknown ? (
              <Tooltip as="span" placement="top" variant="detail" content={UNKNOWN_TOOLTIP}>
                <span style={{
                  fontSize: 9, fontWeight: 700, fontFamily: F.mono,
                  padding: "2px 5px", borderRadius: 999,
                  background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`,
                  color: C.txS, letterSpacing: "0.05em",
                }}>
                  UNKNOWN
                </span>
              </Tooltip>
            ) : (
              <span style={{
                fontSize: 10, fontWeight: 600, color: C.txS, fontFamily: F.mono,
                padding: "1px 5px", borderRadius: 3,
                background: `${C.brand}10`, border: `1px solid ${C.brand}33`,
              }}>
                {s.agent}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>{s.totalRequests} reqs</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.brand, fontFamily: F.mono }}>{s.totalTokens.toLocaleString()} tokens</span>
            <CostQualityBadge status={s.costStatus} unknownRows={s.unpricedRows} />
            <span style={{ fontSize: 12, fontWeight: 800, color: C.warn, fontFamily: F.mono }}>${s.totalCost.toFixed(4)}</span>
          </div>
          {s.rows.map(m => (
            <div key={`${s.sessionId}:${m.model}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0 3px 12px" }}>
              <span style={{ fontSize: 11, fontFamily: F.mono, color: C.txS, flex: 1 }}>{m.model}</span>
              <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>{m.requests} reqs</span>
              <span style={{ fontSize: 10, color: C.txS, fontFamily: F.mono }}>{m.totalTokens.toLocaleString()}</span>
              <CostQualityBadge status={m.costStatus} unknownRows={m.unpricedRows} />
              <span style={{ fontSize: 10, fontWeight: 700, color: C.warn, fontFamily: F.mono }}>${m.cost.toFixed(4)}</span>
            </div>
          ))}
          {(s.firstSeen || s.lastSeen) && (
            <div style={{ display: "flex", gap: 12, paddingLeft: 12, marginTop: 4, fontSize: 9, color: C.txT, fontFamily: F.mono, opacity: 0.7 }}>
              {s.firstSeen && <span>first {new Date(s.firstSeen).toLocaleString()}</span>}
              {s.lastSeen && <span>last {new Date(s.lastSeen).toLocaleString()}</span>}
            </div>
          )}
        </div>
      ))}
      {/* Pagination footer — styled identically to AuditEvidencePanel and the
          new-path counterpart above. */}
      {sessions.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}22` }}>
          <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>
            Page {legacyTotalPages === 0 ? 1 : currentPage + 1} of {legacyTotalPages === 0 ? 1 : legacyTotalPages}
          </span>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: currentPage === 0 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage === 0 ? "not-allowed" : "pointer" }}>{"‹"}</button>
            <button onClick={() => setCurrentPage(p => Math.min(legacyTotalPages - 1, p + 1))} disabled={currentPage >= legacyTotalPages - 1} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: currentPage >= legacyTotalPages - 1 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage >= legacyTotalPages - 1 ? "not-allowed" : "pointer" }}>{"›"}</button>
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
    </CollapsibleCard>
  );
}
