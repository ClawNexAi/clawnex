"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { C, F } from "../constants";
import { Dot, Badge, Card, CollapsibleCard, Stat, EmptyState, PaginationFooter } from "../shared";
import { Tooltip } from "../tooltip";
import type { TabId, DashboardFilters } from "../types";
import { TopThreatsCard } from "./TopThreatsCard";
import { PROXY_TRAFFIC_DEMO, PROXY_STATS_DEMO, PROXY_BLOCK_MODE_DEMO, WATCHER_STATUS_DEMO, TOP_THREATS_DEMO } from "../mock-data";
// v0.8.3+: PanelFilters + URL state. URL key mapping documented inline at
// the urlState destructure (this panel re-uses scope/actor/status keys for
// model/provider/verdict semantics — each panel reads its own context).
import { PanelFilters } from "../PanelFilters";
import { useHashState } from "../url-state";
import { MissionControlBreadcrumb } from "./mission-control/MissionControlBreadcrumb";

interface ProxyTrafficEntry {
  id: string;
  timestamp: string;
  direction: string;
  model: string | null;
  provider: string | null;
  prompt_hash: string | null;
  messages_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  shield_verdict: string | null;
  shield_score: number | null;
  shield_detections: unknown[];
  blocked: number;
  block_reason: string | null;
  status_code: number | null;
  error: string | null;
  source: string | null;
}

interface WatcherStatus {
  running: boolean;
  enabled: boolean;
  uptime: number | null;
  filesWatched: number;
  messagesScanned: number;
  lastScanTime: string | null;
  errors: number;
  pollIntervalMs: number;
  sessionsDirectory: string;
}

interface ProxyStats {
  today: { requests: number; blocked: number; avgLatency: number; totalTokens: number };
  allTime: { requests: number };
  topModels: Array<{ model: string; cnt: number }>;
  verdicts: Array<{ shield_verdict: string; cnt: number }>;
  topThreats: Array<{ name: string; count: number; severity?: string; lastSeen?: string; sample?: string; actors?: Array<{ actor: string; count: number }> }>;
}

function formatTrafficTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "---";
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
  const parsed = new Date(hasTimezone ? timestamp : `${timestamp}Z`);
  return Number.isNaN(parsed.getTime()) ? "---" : parsed.toLocaleTimeString();
}

export function TrafficMonitorPanel({ filters, onNavigate, demoMode, incomingFromMissionControl, onMissionControlBackConsumed }: { filters: DashboardFilters; onNavigate: (tab: TabId) => void; demoMode?: boolean; incomingFromMissionControl?: boolean; onMissionControlBackConsumed?: () => void }) {
  const [traffic, setTraffic] = useState<ProxyTrafficEntry[]>([]);
  const [stats, setStats] = useState<ProxyStats | null>(null);
  const [blockMode, setBlockMode] = useState("off");
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [urlState, updateUrl] = useHashState();
  const trafficIdFilter = urlState.id ?? "";
  // v0.11.5+: pagination matches the global standard operator approved 2026-05-05.
  // Default 5 rows / page; size options [5, 10, 15, 25, 50]; footer hidden when
  // totalPages <= 1. Mirrors the AuditEvidencePanel + Cost By Session pattern.
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);

  const fetchAll = useCallback(async () => {
    if (demoMode) {
      // Demo mode short-circuits all four fetches with seeded mock data so
      // the panel renders meaningful traffic, verdict mix, watcher status,
      // and block-mode without touching live APIs. See mock-data.ts.
      setBlockMode(PROXY_BLOCK_MODE_DEMO.blockMode);
      setTraffic(PROXY_TRAFFIC_DEMO as unknown as ProxyTrafficEntry[]);
      setStats({
        today: { requests: PROXY_STATS_DEMO.count, blocked: PROXY_STATS_DEMO.blocked, avgLatency: 612, totalTokens: PROXY_STATS_DEMO.total_tokens },
        allTime: { requests: 18_421 },
        topModels: [
          { model: "claude-sonnet-4", cnt: 612 },
          { model: "claude-haiku-4", cnt: 304 },
          { model: "llama-3.1-8b", cnt: 218 },
          { model: "claude-opus-4", cnt: 113 },
        ],
        verdicts: [
          { shield_verdict: "ALLOW", cnt: PROXY_STATS_DEMO.allowed },
          { shield_verdict: "BLOCK", cnt: PROXY_STATS_DEMO.blocked },
          { shield_verdict: "REVIEW", cnt: PROXY_STATS_DEMO.reviewed },
        ],
        topThreats: TOP_THREATS_DEMO.slice(0, 5).map(t => ({
          name: t.topRule,
          count: t.count,
          severity: t.severity,
          lastSeen: t.lastSeen,
          sample: t.category,
          actors: [{ actor: "pentest-agent", count: Math.max(1, t.count - 1) }],
        })),
      });
      setWatcherStatus(WATCHER_STATUS_DEMO as unknown as WatcherStatus);
      setLoading(false);
      return;
    }
    try {
      const instanceParam = filters.selectedInstance !== "all" ? `&instance=${encodeURIComponent(filters.selectedInstance)}` : "";
      const trafficIdParam = trafficIdFilter ? `&id=${encodeURIComponent(trafficIdFilter)}` : "";
      const statsInstanceParam = filters.selectedInstance !== "all" ? `?instance=${encodeURIComponent(filters.selectedInstance)}` : "";
      const [blockRes, trafficRes, statsRes, watcherRes] = await Promise.allSettled([
        fetch("/api/proxy/block-mode"),
        fetch(`/api/proxy/traffic?limit=50${instanceParam}${trafficIdParam}`),
        fetch(`/api/proxy/stats${statsInstanceParam}`),
        fetch("/api/watcher/status"),
      ]);
      if (blockRes.status === "fulfilled" && blockRes.value.ok) {
        const d = await blockRes.value.json();
        setBlockMode(d.blockMode || "off");
      }
      if (trafficRes.status === "fulfilled" && trafficRes.value.ok) {
        const d = await trafficRes.value.json();
        setTraffic(d.traffic || []);
      }
      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        setStats(await statsRes.value.json());
      }
      if (watcherRes.status === "fulfilled" && watcherRes.value.ok) {
        setWatcherStatus(await watcherRes.value.json());
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [filters.selectedInstance, demoMode, trafficIdFilter]);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 5000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  // v0.8.3+: traffic filters live in URL hash via useHashState (multi-select).
  // URL key mapping for this panel — each panel reads only the keys it
  // semantically owns; switching panels clears filters anyway:
  //   source URL key   → traffic source (litellm / session-watcher)
  //   scope URL key    → traffic model (e.g. qwen/qwen3-coder-next)
  //   actor URL key    → traffic provider (the LLM provider producing the traffic)
  //   status URL key   → shield verdict (ALLOW / REVIEW / BLOCK)
  //   q URL key        → freeform search across model + provider + tools
  // scoreMin (numeric range) doesn't fit the multi-select widget shape; kept
  // as a separate hand-rolled <select> beside PanelFilters for now. Future
  // enhancement: add a Range dimension to PanelFilters.
  const sourceSel = urlState.source ?? [];
  const modelSel = urlState.scope ?? [];
  const providerSel = urlState.actor ?? [];
  const verdictSel = urlState.status ?? [];
  const qFilter = (urlState.q ?? "").toLowerCase();
  // v0.8.4: scoreMin migrated from local state → URL `min` key (Range
  // dimension on PanelFilters). Refresh / share-via-paste preserves it.
  const scoreMinFilter = urlState.min ?? "0";

  const verdictColor = (v: string | null) => {
    if (!v) return C.txT;
    if (v === "BLOCK") return C.danger;
    if (v === "REVIEW") return C.warn;
    return C.green;
  };

  // Compute unique values for filter dropdowns
  const uniqueModels = useMemo(() => Array.from(new Set(traffic.map(t => t.model).filter(Boolean) as string[])).sort(), [traffic]);
  const uniqueProviders = useMemo(() => Array.from(new Set(traffic.map(t => t.provider).filter(Boolean) as string[])).sort(), [traffic]);

  // Apply filters
  // v0.8.3: filter logic — multi-select for each dimension; empty = all.
  // Same semantics as Alerts/Audit/Risk Acceptances refactors.
  const filteredTraffic = useMemo(() => {
    return traffic.filter(t => {
      if (trafficIdFilter && t.id !== trafficIdFilter) return false;
      const tSource = t.source || "litellm";
      if (sourceSel.length > 0 && !sourceSel.includes(tSource)) return false;
      if (modelSel.length > 0 && (!t.model || !modelSel.includes(t.model))) return false;
      if (providerSel.length > 0 && (!t.provider || !providerSel.includes(t.provider))) return false;
      if (verdictSel.length > 0 && (!t.shield_verdict || !verdictSel.includes(t.shield_verdict))) return false;
      if (scoreMinFilter !== "0" && (t.shield_score ?? 0) < parseInt(scoreMinFilter)) return false;
      if (qFilter) {
        // Search across the operator-meaningful textual fields on a traffic
        // entry. ProxyTrafficEntry doesn't have a `tools` field, so this is
        // model + provider + verdict — broad enough for typical investigation.
        const haystack = `${t.model ?? ""} ${t.provider ?? ""} ${t.shield_verdict ?? ""}`.toLowerCase();
        if (!haystack.includes(qFilter)) return false;
      }
      return true;
    });
  }, [traffic, trafficIdFilter, sourceSel, modelSel, providerSel, verdictSel, scoreMinFilter, qFilter]);

  // v0.11.5+: pagination derivation. Reset to page 0 whenever filters change
  // or page size changes — otherwise a filter that drops the row count below
  // the current page leaves the operator on an empty page.
  const totalPages = Math.max(1, Math.ceil(filteredTraffic.length / pageSize));
  const pagedTraffic = filteredTraffic.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  useEffect(() => {
    setCurrentPage(0);
  }, [trafficIdFilter, sourceSel, modelSel, providerSel, verdictSel, scoreMinFilter, qFilter, pageSize]);

  const hasActiveFilters = !!trafficIdFilter || sourceSel.length > 0 || modelSel.length > 0 || providerSel.length > 0 || verdictSel.length > 0 || scoreMinFilter !== "0" || !!qFilter;

  if (loading) return <div style={{ padding: 20, textAlign: "center", color: C.txT }}>Loading traffic monitor...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* v0.12.0+: Mission Control return breadcrumb. */}
      <MissionControlBreadcrumb
        visible={!!incomingFromMissionControl}
        onClick={() => onMissionControlBackConsumed?.()}
      />
      {/* Stats — top of page */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Stat label="Requests Today" value={stats?.today.requests ?? 0} color={C.brand} />
        <Stat label="Blocked Today" value={stats?.today.blocked ?? 0} color={(stats?.today.blocked ?? 0) > 0 ? C.danger : C.txT} />
        <Stat label="Avg Latency" value={`${stats?.today.avgLatency ?? 0}ms`} color={C.info} />
        <Stat label="Top Model" value={stats?.topModels?.[0]?.model ? (stats.topModels[0].model.length > 20 ? stats.topModels[0].model.slice(0, 20) + ".." : stats.topModels[0].model) : "---"} color={C.purp} />
      </div>

      {/* Status Bar */}
      <Card title="SHIELD STATUS" accent={C.cyan} dimGlow>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.txS, letterSpacing: "0.05em" }}>SHIELD MODE:</span>
            <span style={{
              padding: "8px 20px", borderRadius: 8,
              border: blockMode === "on" ? `2px solid ${C.danger}` : `2px solid ${C.glassBorderSubtle}`,
              background: blockMode === "on" ? `${C.danger}38` : C.glassSurfTrans,
              color: blockMode === "on" ? C.danger : C.txS,
              fontWeight: 800, fontSize: 13, fontFamily: F.mono, letterSpacing: "0.08em",
              animation: blockMode === "on" ? "pulse 2s ease-in-out infinite" : "none",
            }}>
              {blockMode === "on" ? "BLOCK" : "OBSERVE"}
            </span>
            <Tooltip placement="right" variant="detail" content={
              blockMode === "on"
                ? <span><strong>BLOCK mode</strong> — the Shield is actively rejecting flagged requests before they reach the model. If you need to triage false positives without disrupting agents, switch back to OBSERVE in <strong>Configuration → Shield Settings</strong>.</span>
                : <span><strong>OBSERVE mode</strong> — the Shield scans and logs every request but doesn&apos;t actually block anything. Useful for the first week or two on a fresh install while you tune out false positives. <strong>Flip to BLOCK</strong> in <strong>Configuration → Shield Settings</strong> once you trust the rules to do the right thing.</span>
            }>
              <span style={{ fontSize: 11, color: C.txT, borderBottom: `1px dotted ${C.txT}`, cursor: "help" }}>
                {blockMode === "on" ? "Threats are actively blocked" : "Threats are logged but not blocked"}
              </span>
            </Tooltip>
          </div>
        </div>
      </Card>

      {/* Session Watcher Status */}
      <Card title="SESSION WATCHER" accent={C.purp} dimGlow actions={
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <Tooltip placement="bottom" variant="detail" content={<span>Toggle the <strong>Session Watcher</strong>. When on, ClawNex reads each agent&apos;s conversation log on disk and runs the Shield over every message after the fact. This catches traffic from providers that can&apos;t be proxied — OAuth-bound services like Claude.ai, ChatGPT Pro, Gemini, etc. — so they&apos;re still observable.</span>}>
            <button onClick={() => {
              const action = watcherStatus?.running ? "disable" : "enable";
              fetch("/api/watcher/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).then(() => setTimeout(fetchAll, 500)).catch(() => {});
            }} style={{ padding: "2px 8px", borderRadius: 3, border: `1px solid ${watcherStatus?.running ? C.danger : C.green}`, background: "transparent", color: watcherStatus?.running ? C.danger : C.green, fontSize: 10, fontWeight: 700, fontFamily: F.mono, cursor: "pointer" }}>{watcherStatus?.running ? "Disable" : "Enable"}</button>
          </Tooltip>
          <Tooltip placement="bottom" variant="detail" content={<span>How often the watcher scans for new messages. <strong>2s–5s</strong> = near-real-time but more disk I/O. <strong>10s</strong> (default) is the sweet spot for most installs. <strong>30s–60s</strong> for low-volume agents where you don&apos;t need instant detection.</span>}>
            <select defaultValue="10000" onChange={e => { fetch("/api/watcher/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_interval", interval: parseInt(e.target.value) }) }).catch(() => {}); }} style={{ fontSize: 10, padding: "2px 4px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 3, color: C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}>
              <option value="2000">2s</option>
              <option value="5000">5s</option>
              <option value="10000">10s</option>
              <option value="30000">30s</option>
              <option value="60000">60s</option>
            </select>
          </Tooltip>
          <button onClick={() => { fetch("/api/watcher/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "poll_now" }) }).then(() => fetchAll()).catch(() => {}); }} disabled={!watcherStatus?.running} style={{ padding: "2px 8px", borderRadius: 3, border: `1px solid ${watcherStatus?.running ? C.brand : C.txG}`, background: "transparent", color: watcherStatus?.running ? C.brand : C.txG, fontSize: 10, fontWeight: 700, fontFamily: F.mono, cursor: watcherStatus?.running ? "pointer" : "default" }}>Poll Now</button>
        </div>
      }>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Dot color={watcherStatus?.running ? C.green : C.txT} size={8} glow={watcherStatus?.running} />
            <span style={{ fontSize: 12, fontWeight: 700, color: watcherStatus?.running ? C.green : C.txT }}>
              {watcherStatus?.running ? "RUNNING" : watcherStatus?.enabled === false ? "DISABLED" : "STOPPED"}
            </span>
          </div>
          <div style={{ width: 1, height: 20, background: C.glassBorderSubtle }} />
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: F.mono, color: C.brand }}>{watcherStatus?.filesWatched ?? 0}</div>
              <div style={{ fontSize: 9, color: C.txT, fontWeight: 700, letterSpacing: "0.06em" }}>FILES</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: F.mono, color: C.info }}>{watcherStatus?.messagesScanned ?? 0}</div>
              <div style={{ fontSize: 9, color: C.txT, fontWeight: 700, letterSpacing: "0.06em" }}>SCANNED</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: F.mono, color: watcherStatus?.errors ? C.warn : C.txT }}>{watcherStatus?.errors ?? 0}</div>
              <div style={{ fontSize: 9, color: C.txT, fontWeight: 700, letterSpacing: "0.06em" }}>ERRORS</div>
            </div>
          </div>
          {watcherStatus?.lastScanTime && (
            <>
              <div style={{ width: 1, height: 20, background: C.glassBorderSubtle }} />
              <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>
                Last: {new Date(watcherStatus.lastScanTime).toLocaleTimeString()}
              </span>
            </>
          )}
        </div>
      </Card>


      {/* Verdict Distribution */}
      {stats && stats.verdicts && stats.verdicts.length > 0 && (
        <Card title="VERDICT DISTRIBUTION" accent={C.brand} dimGlow>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {stats.verdicts.map((v) => (
              <div key={v.shield_verdict} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Badge label={v.shield_verdict} color={verdictColor(v.shield_verdict)} />
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: F.mono, color: C.tx }}>{v.cnt}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Top Threats — enriched with actors, last seen, sample, backlinks */}
      {stats && stats.topThreats && stats.topThreats.length > 0 && <TopThreatsCard threats={stats.topThreats} onNavigate={onNavigate} />}

      {/* Traffic Filters */}
      <CollapsibleCard title="LIVE TRAFFIC" accent={C.info} count={filteredTraffic.length} dimGlow actions={
        <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>Auto-refresh 5s &middot; {filteredTraffic.length}/{traffic.length} entries</span>
      }>
        {trafficIdFilter && (
          <div role="status" style={{ marginBottom: 10, padding: "8px 10px", border: `1px solid ${C.cyan}66`, borderRadius: 6, background: `${C.cyan}0d`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: C.txS, fontSize: 12 }}>
              Showing the traffic record selected from an investigation: <span style={{ color: C.cyan, fontFamily: F.mono }}>{trafficIdFilter}</span>
            </span>
            <button type="button" onClick={() => updateUrl({ id: undefined })} style={{ padding: "5px 9px", borderRadius: 4, border: `1px solid ${C.cyan}`, background: "transparent", color: C.cyan, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              Show all traffic
            </button>
          </div>
        )}
        {/* v0.8.3: 4 multi-select dimensions live in the shared PanelFilters
            widget; scoreMin (numeric range) stays a separate hand-rolled
            <select> beside it because the multi-select dropdown shape doesn't
            fit a numeric threshold. Future: Range dimension on PanelFilters. */}
        {/* v0.8.4: scoreMin folded into PanelFilters via the new Range
            (config.min) dimension — single shared widget for all 5 filter
            dimensions, URL state for all of them. */}
        <PanelFilters
          config={{
            search: { placeholder: "Search model, provider, tools…" },
            source: ["litellm", "session-watcher"],
            scope: uniqueModels,
            actor: uniqueProviders,
            status: ["ALLOW", "REVIEW", "BLOCK"],
            min: {
              label: "Score",
              options: [
                { value: "0", label: "All Scores" },
                { value: "1", label: "Score ≥ 1" },
                { value: "10", label: "Score ≥ 10" },
                { value: "25", label: "Score ≥ 25" },
                { value: "50", label: "Score ≥ 50" },
                { value: "75", label: "Score ≥ 75" },
              ],
            },
          }}
          values={urlState}
          onChange={(patch) => updateUrl(patch)}
          resultCount={filteredTraffic.length}
          totalCount={traffic.length}
        />

        {filteredTraffic.length === 0 ? (
          <EmptyState message={hasActiveFilters ? "No traffic matches the current filters. Clear filters to see everything." : "No traffic recorded yet. Point OpenClaw to LiteLLM proxy on localhost:4001 to begin monitoring."} />
        ) : (
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.mono }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.glassBorderSubtle}`, color: C.txT, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>TIME</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>
                    <Tooltip variant="detail" content={
                      <span>
                        Where this request was observed:
                        <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
                          <li><strong>proxy</strong> — passed through the local safety proxy. Shield scanned it in real time.</li>
                          <li><strong>watcher</strong> — picked up from an agent&apos;s session log on disk. Shield scanned it after the fact.</li>
                          <li><strong>direct</strong> — the agent talked to the provider without going through either path. <em>No shield coverage.</em></li>
                        </ul>
                      </span>
                    }>SOURCE</Tooltip>
                  </th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>MODEL</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>PROVIDER</th>
                  <th style={{ textAlign: "center", padding: "8px 6px" }}>
                    <Tooltip variant="detail" content={
                      <span>
                        Shield verdict on the request payload: <strong style={{ color: C.green }}>ALLOW</strong> (clean), <strong style={{ color: C.warn }}>REVIEW</strong> (flagged but passed through), or <strong style={{ color: C.danger }}>BLOCK</strong> (high-confidence threat). Use the <em>All Verdicts</em> filter above to narrow the view.
                      </span>
                    }>VERDICT</Tooltip>
                  </th>
                  <th style={{ textAlign: "right", padding: "8px 6px" }}>
                    <Tooltip variant="detail" content={
                      <span>
                        0–100 threat score from the Shield — a weighted sum of every rule that matched on this request. Filter to <strong>≥ 50</strong> or <strong>≥ 75</strong> to surface only the high-confidence traffic worth triaging.
                      </span>
                    }>SCORE</Tooltip>
                  </th>
                  <th style={{ textAlign: "right", padding: "8px 6px" }}>LATENCY</th>
                  <th style={{ textAlign: "right", padding: "8px 6px" }}>TOKENS</th>
                  <th style={{ textAlign: "center", padding: "8px 6px" }}>
                    <Tooltip variant="detail" content={
                      <span>
                        HTTP status returned to the caller:
                        <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
                          <li><strong>200</strong> — normal request, succeeded.</li>
                          <li><strong>400</strong> — Shield <strong style={{ color: C.danger }}>BLOCKED</strong> the request (only happens when Block Mode is on).</li>
                          <li><strong>5xx</strong> — the upstream provider or proxy failed. Check the <em>error</em> column in the JSON view for why.</li>
                        </ul>
                      </span>
                    }>STATUS</Tooltip>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedTraffic.map((t) => (
                  <tr key={t.id} style={{
                    borderBottom: `1px solid ${C.glassBorderSubtle}`,
                    background: t.blocked ? `${C.danger}22` : C.glassSurfTrans,
                    transition: "background 0.2s",
                  }}>
                    <td style={{ padding: "7px 6px", color: C.txS, whiteSpace: "nowrap" }}>
                      {formatTrafficTime(t.timestamp)}
                    </td>
                    <td style={{ padding: "7px 6px" }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: t.source === "session-watcher" ? `${C.purp}38` : t.source === "litellm" ? `${C.info}38` : `${C.cyan}38`,
                        color: t.source === "session-watcher" ? C.purp : t.source === "litellm" ? C.info : C.cyan,
                        border: `1px solid ${t.source === "session-watcher" ? C.purp : t.source === "litellm" ? C.info : C.cyan}8c`,
                        letterSpacing: "0.04em",
                      }}>
                        {t.source === "session-watcher" ? "SESSION" : t.source === "litellm" ? "LITELLM" : "PROXY"}
                      </span>
                    </td>
                    <td style={{ padding: "7px 6px", color: C.tx, fontWeight: 600 }}>
                      {t.model ? (t.model.length > 28 ? t.model.slice(0, 28) + ".." : t.model) : "---"}
                    </td>
                    <td style={{ padding: "7px 6px", color: C.txS }}>
                      {t.provider || "---"}
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "center" }}>
                      {t.shield_verdict ? <Badge label={t.shield_verdict} color={verdictColor(t.shield_verdict)} /> : <span style={{ color: C.txT }}>---</span>}
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: verdictColor(t.shield_verdict), fontWeight: 700 }}>
                      {t.shield_score ?? "---"}
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: C.txS }}>
                      {t.latency_ms != null ? `${t.latency_ms}ms` : "---"}
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: C.txS }}>
                      {t.total_tokens ?? "---"}
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "center" }}>
                      {t.blocked ? (
                        <span style={{ color: C.danger, fontWeight: 800, fontSize: 11 }}>BLOCKED</span>
                      ) : t.error ? (
                        <span style={{ color: C.warn, fontWeight: 700, fontSize: 11 }}>ERROR</span>
                      ) : (
                        <span style={{ color: t.status_code && t.status_code < 400 ? C.green : C.warn, fontWeight: 600, fontSize: 11 }}>{t.status_code || "---"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <PaginationFooter
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalRows={filteredTraffic.length}
                onPageSizeChange={setPageSize}
                onPageChange={setCurrentPage}
              />
            )}
          </div>
        )}
      </CollapsibleCard>
    </div>
  );
}
