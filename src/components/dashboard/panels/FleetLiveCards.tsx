"use client";

import { useState, useEffect } from "react";
import { C, F } from "../constants";
import { Card, Badge, Bar, Fresh } from "../shared";
import { sevColor, timeAgo } from "../utils";
import type { TabId, DashboardFilters } from "../types";

export function FleetLiveCards({ filters, onNavigate }: { filters: DashboardFilters; onNavigate: (tab: TabId) => void }) {
  const [data, setData] = useState<{
    correlations: Array<{ id: string; correlation_rule: string; severity: string; description: string; created_at: string; event_count: number }>;
    topTokenModels: Array<{ model: string; totalTokens: number }>;
    shieldStats: { total: number; blocked: number; reviewed: number; topCategories?: Array<{ category: string; count: number }> };
    alertSummary: { total: number; critical: number; high: number; medium: number; latest?: { title: string; severity: string; created_at: string } };
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [corrRes, statsRes, shieldRes, alertRes] = await Promise.allSettled([
          fetch(`/api/correlations?since=${encodeURIComponent(filters.since)}&limit=5`),
          fetch("/api/proxy/stats"),
          fetch(`/api/shield/stats?since=${encodeURIComponent(filters.since)}`),
          // internal reviewer M-01 #1 fix-for-real (2026-04-29): the Alert Summary card
          // labels three big numbers as Critical / High / Medium aggregate
          // counts and a Latest line. Earlier this fetched limit=5, which
          // turned the "summary" into a sample of the most recent 5 — totals
          // and severity breakdowns derived from a 5-row page lied whenever
          // the active set was larger. Bumped to limit=500 (matches the
          // sidebar badge query in dashboard/index.tsx:371) so the breakdown
          // honestly aggregates the active set. `alerts[0]` is still the
          // newest record and feeds the Latest line. If a fleet ever has
          // >500 active alerts at once the count undercounts — that's the
          // signal we need a real aggregate endpoint, not a higher ceiling.
          //
          // internal reviewer M-01 follow-up 2026-04-30: also passes productionOnly=true
          // so Shield Tests run-all output and other test-generated origins
          // don't pollute the Alert Summary breakdown. Mode B simulation rows
          // (origin='production') are still counted, matching the operator-
          // visible-by-design contract.
          fetch(`/api/alerts?scope=active&productionOnly=true&since=${encodeURIComponent(filters.since)}&limit=500`),
        ]);
        const corrs = corrRes.status === "fulfilled" && corrRes.value.ok ? (await corrRes.value.json()).correlations || [] : [];
        const stats = statsRes.status === "fulfilled" && statsRes.value.ok ? await statsRes.value.json() : {};
        const shield = shieldRes.status === "fulfilled" && shieldRes.value.ok ? await shieldRes.value.json() : {};
        const alertData = alertRes.status === "fulfilled" && alertRes.value.ok ? await alertRes.value.json() : {};
        const alerts = alertData.alerts || [];
        setData({
          correlations: corrs.slice(0, 3),
          topTokenModels: (stats.topModels || []).slice(0, 5),
          shieldStats: { total: shield.total ?? 0, blocked: shield.blocked ?? 0, reviewed: shield.reviewed ?? 0, topCategories: shield.topCategories },
          alertSummary: {
            total: alerts.length,
            critical: alerts.filter((a: { severity: string }) => a.severity === "CRITICAL").length,
            high: alerts.filter((a: { severity: string }) => a.severity === "HIGH").length,
            medium: alerts.filter((a: { severity: string }) => a.severity === "MEDIUM").length,
            latest: alerts[0] || null,
          },
        });
      } catch {}
    })();
  }, [filters.since]);

  const topCorr = data?.correlations?.[0];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
      {/* Top Correlation */}
      <Card title="Top Correlation" accent={C.danger} actions={<Fresh />}>
        {topCorr ? (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <Badge label={topCorr.severity} color={sevColor(topCorr.severity)} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.tx }}>{topCorr.correlation_rule.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</span>
            </div>
            <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5, marginBottom: 8 }}>{topCorr.description?.slice(0, 120)}{(topCorr.description?.length || 0) > 120 ? "..." : ""}</div>
            {/* internal reviewer 2026-05-06 contrast: dense metadata 10/txT → 12/txS. */}
            <div style={{ fontSize: 12, color: C.txS, marginBottom: 10 }}>{topCorr.event_count || 0} events — {timeAgo(topCorr.created_at)}</div>
            <button onClick={() => onNavigate("correlations")} style={{ background: "none", border: "none", color: C.info, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: F.sans }}>Full analysis {"\u2192"}</button>
          </div>
        ) : (
          <div>
            <span style={{ fontSize: 12, color: C.txT }}>No active correlations.</span>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => onNavigate("correlations")} style={{ background: "none", border: "none", color: C.info, fontSize: 11, cursor: "pointer", padding: 0 }}>Open Correlations {"\u2192"}</button>
            </div>
          </div>
        )}
      </Card>

      {/* Alert Summary */}
      <Card title="Alert Summary" accent={C.orange} actions={<Fresh />}>
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: data?.alertSummary?.critical ? C.danger : C.txT, fontFamily: F.mono }}>{data?.alertSummary?.critical || 0}</div>
              <div style={{ fontSize: 9, color: C.txT, textTransform: "uppercase" }}>Critical</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: data?.alertSummary?.high ? C.orange : C.txT, fontFamily: F.mono }}>{data?.alertSummary?.high || 0}</div>
              <div style={{ fontSize: 9, color: C.txT, textTransform: "uppercase" }}>High</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: data?.alertSummary?.medium ? C.warn : C.txT, fontFamily: F.mono }}>{data?.alertSummary?.medium || 0}</div>
              <div style={{ fontSize: 9, color: C.txT, textTransform: "uppercase" }}>Medium</div>
            </div>
          </div>
          {data?.alertSummary?.latest && (
            <div style={{ fontSize: 11, color: C.txS, padding: "6px 0", borderTop: `1px solid ${C.brd}22` }}>
              Latest: <Badge label={data.alertSummary.latest.severity} color={sevColor(data.alertSummary.latest.severity)} /> <span style={{ fontWeight: 600 }}>{data.alertSummary.latest.title?.slice(0, 50)}</span>
            </div>
          )}
          <button onClick={() => onNavigate("alertsIncidents")} style={{ background: "none", border: "none", color: C.info, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, marginTop: 6, fontFamily: F.sans }}>View Alerts {"\u2192"}</button>
        </div>
      </Card>

      {/* Prompt Shield */}
      <Card title="Prompt Shield" accent={C.cyan} actions={<Fresh />}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: C.brand, fontFamily: F.mono }}>{data?.shieldStats?.blocked || 0}</span>
            {(data?.shieldStats?.blocked || 0) > 0 ? (
              <Badge label="BLOCKED" color={C.danger} />
            ) : (
              <Badge label="CLEAR" color={C.green} />
            )}
          </div>
          <div style={{ fontSize: 11, color: C.txS, marginBottom: 4 }}>Threats blocked in {filters.timeRange}</div>
          {/* internal reviewer 2026-05-06 contrast: dense metadata 10/txT → 12/txS. */}
          <div style={{ fontSize: 12, color: C.txS, marginBottom: 8 }}>{data?.shieldStats?.reviewed || 0} reviewed — {(data?.shieldStats?.total || 0) - (data?.shieldStats?.blocked || 0) - (data?.shieldStats?.reviewed || 0)} allowed</div>
          <Bar value={data?.shieldStats?.blocked || 0} max={Math.max(data?.shieldStats?.total || 1, 1)} color={C.danger} h={6} />
          <button onClick={() => onNavigate("shield")} style={{ background: "none", border: "none", color: C.info, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, marginTop: 10, fontFamily: F.sans }}>Open Prompt Shield {"\u2192"}</button>
        </div>
      </Card>
    </div>
  );
}
