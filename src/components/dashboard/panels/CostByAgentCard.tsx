"use client";

import { useState, useEffect, useMemo } from "react";
import { C, F } from '../constants';
import { Badge, CollapsibleCard, PaginationFooter } from '../shared';
import { Tooltip } from '../tooltip';
import type { DashboardFilters } from '../types';
import { COST_BY_AGENT_DEMO } from '../mock-data';
import { display_cost_usd } from '@/lib/cost-reporting-display';
import type { NormalizedRow, Source } from '@/lib/types/cost-reporting';

// Per-source visual identity. Mirrors TokenCostPanel SOURCE_COLOR / SOURCE_LABEL
// so source attribution is visually consistent across cost panels. internal reviewer Gate-C
// identity-merge constraint: agents from different sources stay in distinct
// rows (key = `${source}::${agent}`), so the source badge is load-bearing —
// it's how operators tell apart e.g. an OpenClaw "Alex" from a Hermes "Alex".
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

// Local shape extending the legacy fetch payload with v1 NormalizedRow rows.
// Both shapes are populated by /api/tokens during the migration window; we
// prefer rows when present and non-empty, and fall back to the legacy
// costByAgent shape otherwise so older endpoints / tests keep working.
type CardData = {
  costByAgent: Array<{ agent: string; model: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number; cost: number; costStatus?: 'known' | 'unknown' | 'invalid' | 'mixed'; invalidCostRows?: number; unpricedRows?: number }>;
  defaultModel: string;
  rows?: NormalizedRow[];
};

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

export function CostByAgentCard({ globalFilters, demoMode, hideDeliveryMirror = false }: { globalFilters: DashboardFilters; demoMode?: boolean; hideDeliveryMirror?: boolean }) {
  const [localRange, setLocalRange] = useState<string | null>(null);
  const [data, setData] = useState<CardData | null>(null);
  // v0.11.5+: rule-of-5 pagination on Cost By Agent table.
  const [agentPageSize, setAgentPageSize] = useState(5);
  const [agentPage, setAgentPage] = useState(0);

  const activeRange = localRange || globalFilters.timeRange;
  const since = useMemo(() => {
    const ms: Record<string, number> = { "1h": 3600000, "6h": 21600000, "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
    return new Date(Date.now() - (ms[activeRange] || 86400000)).toISOString();
  }, [activeRange]);

  useEffect(() => {
    if (demoMode) {
      // Demo: derive per-agent rows from COST_BY_AGENT_DEMO. The pentest-agent
      // entry tops the list with the runaway $147.20 — same narrative as
      // TOKEN_ALERTS ta-1 and ALT-003.
      const rows = COST_BY_AGENT_DEMO.flatMap(a => {
        const totalRequests = a.sessions * 24; // synthetic but plausible
        return Object.entries(a.modelMix).map(([model, share]) => ({
          agent: a.agent,
          model,
          requests: Math.round(totalRequests * share),
          inputTokens: Math.round(a.tokens * share * 0.7),
          outputTokens: Math.round(a.tokens * share * 0.3),
          totalTokens: Math.round(a.tokens * share),
          cost: a.costUsd * share,
        }));
      });
      setData({ costByAgent: rows, defaultModel: "claude-sonnet-4" });
      return;
    }
    (async () => {
      try {
        const instanceParam = globalFilters.selectedInstance !== "all" ? `&instance=${encodeURIComponent(globalFilters.selectedInstance)}` : "";
        const res = await fetch(`/api/tokens?since=${encodeURIComponent(since)}${instanceParam}`);
        if (res.ok) {
          const d = await res.json();
          setData({ costByAgent: d.costByAgent || [], defaultModel: d.defaultModel || "", rows: d.rows });
        }
      } catch {}
    })();
  }, [since, globalFilters.selectedInstance, demoMode]);

  // New aggregation: group NormalizedRows by (source, agent). internal reviewer Gate-C
  // forbids cross-source identity merge, so the map key is `${source}::${agent}`
  // — an OpenClaw "Alex" and a Hermes "Alex" land in two separate buckets.
  // Per-source totals must NEVER be summed (internal reviewer #4); we compute one total per
  // (source, agent) row and sort, but never output a combined sum.
  const byAgentSource = useMemo(() => {
    const map = new Map<string, { source: Source; agent: string; count: number; totalUsd: number; tokens: number; unknownCostRows: number; invalidCostRows: number }>();
    for (const row of data?.rows ?? []) {
      // Render-time delivery-mirror filter — see TokenCostPanel.hideDeliveryMirror
      // state declaration. Applied BEFORE bucketing so the (agent, source) row
      // count and totals match what an operator would expect post-toggle.
      if (hideDeliveryMirror && row.model === 'delivery-mirror') continue;
      // Some sources, especially Hermes v1, do not provide agent identity. Keep
      // those rows visible as an unattributed per-source bucket so mixed actual
      // + default/unpriced cost quality cannot disappear from the agent view.
      const agent = row.agent || `Unattributed ${row.source}`;
      const key = `${row.source}::${agent}`;
      const display = display_cost_usd(row);
      const quality = normalizedRowCostQuality(row, display);
      if (!map.has(key)) map.set(key, { source: row.source, agent, count: 0, totalUsd: 0, tokens: 0, unknownCostRows: 0, invalidCostRows: 0 });
      const cur = map.get(key)!;
      cur.count++;
      // display_cost_usd returns null for token_only / unknown / unsupported_currency
      // — those rows count toward the call count but not the cost total.
      if (display !== null) cur.totalUsd += display;
      if (quality === 'invalid') cur.invalidCostRows++;
      else if (quality === 'unknown') cur.unknownCostRows++;
      cur.tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    }
    return Array.from(map.values()).sort((a, b) => b.totalUsd - a.totalUsd);
  }, [data?.rows, hideDeliveryMirror]);

  if (!data) return null;

  // Decide which rendering path to use. Prefer the new rows-driven path when
  // /api/tokens returned a non-empty rows array (the migration target).
  // Fall back to the legacy costByAgent shape only when rows is undefined or
  // zero-length, so probes and demo mode still render correctly until every
  // endpoint emits the new fields.
  const useNewPath = byAgentSource.length > 0;

  if (useNewPath) {
    return (
      <CollapsibleCard title={`Cost by Agent (${activeRange})`} count={byAgentSource.length} accent={C.warn} defaultOpen={false} actions={
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {["1h", "6h", "24h", "7d", "30d"].map(t => (
            <button key={t} onClick={() => setLocalRange(t === globalFilters.timeRange ? null : t)} style={{
              padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, fontFamily: F.mono, cursor: "pointer",
              background: activeRange === t ? `${C.warn}22` : "transparent",
              border: `1px solid ${activeRange === t ? `${C.warn}55` : C.glassBorderSubtle}`,
              color: activeRange === t ? C.warn : C.txT,
            }}>{t}</button>
          ))}
        </div>
      }>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: "4px 12px", alignItems: "center" }}>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
            <Tooltip placement="bottom" variant="compact" content="Agent name as resolved by the source adapter. Same name from different sources stays as separate rows.">Agent</Tooltip>
          </div>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
            <Tooltip placement="bottom" variant="compact" content="Telemetry stream the row came from: OpenClaw / Hermes / Paperclip.">Source</Tooltip>
          </div>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right" }}>
            <Tooltip placement="bottom" variant="compact" content="Number of cost-bearing rows attributed to this (agent, source) bucket in the window.">Calls</Tooltip>
          </div>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right" }}>
            <Tooltip placement="bottom" variant="compact" content="Sum of input + output tokens across this bucket's rows.">Tokens</Tooltip>
          </div>
          <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right" }}>
            <Tooltip placement="bottom" variant="detail" content="Sum of display cost (resolved per row's cost_status) across this bucket. Excludes rows where cost is unknown or unsupported currency.">Cost</Tooltip>
          </div>
          {(() => {
            const totalPages = Math.max(1, Math.ceil(byAgentSource.length / agentPageSize));
            const safe = Math.min(agentPage, totalPages - 1);
            const paged = byAgentSource.slice(safe * agentPageSize, (safe + 1) * agentPageSize);
            return paged.map(entry => (
              // Render the raw agent name. Paperclip rows already carry a
              // "(Paperclip)" suffix from the adapter, so visual disambiguation
              // is handled at the adapter layer; the source badge remains as the
              // authoritative attribution signal.
              <div key={`${entry.source}::${entry.agent}`} style={{ display: "contents" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.tx }}>{entry.agent}</span>
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
            ));
          })()}
        </div>
        {(() => {
          const totalPages = Math.max(1, Math.ceil(byAgentSource.length / agentPageSize));
          if (totalPages <= 1) return null;
          return (
            <PaginationFooter
              currentPage={Math.min(agentPage, totalPages - 1)}
              totalPages={totalPages}
              pageSize={agentPageSize}
              totalRows={byAgentSource.length}
              onPageSizeChange={(n) => { setAgentPageSize(n); setAgentPage(0); }}
              onPageChange={setAgentPage}
            />
          );
        })()}
      </CollapsibleCard>
    );
  }

  // Legacy fallback path. Preserved verbatim from the pre-Task-16 implementation
  // so probes / endpoints that don't yet emit `rows` keep rendering. Removed
  // once every cost endpoint emits the canonical v1 fields.
  const defaultModel = data.defaultModel;
  const agentMap = new Map<string, Array<typeof data.costByAgent[0]>>();
  for (const row of data.costByAgent) {
    if (!agentMap.has(row.agent)) agentMap.set(row.agent, []);
    agentMap.get(row.agent)!.push(row);
  }
  const agents = Array.from(agentMap.entries()).sort((a, b) => {
    const costA = a[1].reduce((s, r) => s + r.cost, 0);
    const costB = b[1].reduce((s, r) => s + r.cost, 0);
    return costB - costA;
  });

  return (
    <CollapsibleCard title={`Cost by Agent (${activeRange})`} count={agents.length} accent={C.warn} defaultOpen={false} actions={
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {["1h", "6h", "24h", "7d", "30d"].map(t => (
          <button key={t} onClick={() => setLocalRange(t === globalFilters.timeRange ? null : t)} style={{
            padding: "2px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, fontFamily: F.mono, cursor: "pointer",
            background: activeRange === t ? `${C.warn}18` : "transparent",
            border: `1px solid ${activeRange === t ? C.warn : C.brd}`,
            color: activeRange === t ? C.warn : C.txT,
          }}>{t}</button>
        ))}
      </div>
    }>
      {agents.length === 0 && <span style={{ fontSize: 12, color: C.txT }}>No agent traffic in this period.</span>}
      {agents.map(([agent, models]) => {
        const totalCost = models.reduce((s, m) => s + m.cost, 0);
        const totalTokens = models.reduce((s, m) => s + m.totalTokens, 0);
        const totalReqs = models.reduce((s, m) => s + m.requests, 0);
        const costStatus = models.some(m => m.costStatus === 'invalid') ? 'invalid' : models.some(m => m.costStatus === 'mixed') ? 'mixed' : models.some(m => m.costStatus === 'unknown') ? 'unknown' : 'known';
        const hasUnsanctioned = defaultModel && models.some(m => m.model !== defaultModel && m.model !== "unknown");

        return (
          <div key={agent} style={{ marginBottom: 8, background: hasUnsanctioned ? `${C.warn}22` : C.glassSurfTrans, border: `1px solid ${hasUnsanctioned ? `${C.warn}55` : C.glassSurfBorder}`, borderLeft: `4px solid ${hasUnsanctioned ? C.warn : C.brand}`, borderRadius: 14, padding: 10, boxShadow: C.glassCardShadow }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.tx, flex: 1 }}>{agent}</span>
              {hasUnsanctioned && <Badge label="NON-DEFAULT MODEL" color={C.warn} />}
              <CostQualityBadge status={costStatus} unknownRows={models.reduce((s, m) => s + (m.unpricedRows || 0), 0)} />
              <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>{totalReqs} reqs</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.brand, fontFamily: F.mono }}>{totalTokens.toLocaleString()} tokens</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.warn, fontFamily: F.mono }}>${totalCost.toFixed(4)}</span>
            </div>
            {models.map(m => {
              const isDefault = !defaultModel || m.model === defaultModel || m.model === "unknown";
              return (
                <div key={m.model} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0 3px 12px" }}>
                  <span style={{ fontSize: 11, fontFamily: F.mono, color: isDefault ? C.txS : C.warn, flex: 1 }}>{m.model}</span>
                  {!isDefault && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 2, background: `${C.warn}18`, border: `1px solid ${C.warn}33`, color: C.warn, fontWeight: 700 }}>!</span>}
                  <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>{m.requests} reqs</span>
                  <span style={{ fontSize: 10, color: C.txS, fontFamily: F.mono }}>{m.totalTokens.toLocaleString()}</span>
                  <CostQualityBadge status={m.costStatus} unknownRows={m.unpricedRows} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.warn, fontFamily: F.mono }}>${m.cost.toFixed(4)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </CollapsibleCard>
  );
}
