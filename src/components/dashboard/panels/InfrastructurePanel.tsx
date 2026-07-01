"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from "../constants";
import { Dot, Badge, Bar, Card, CollapsibleCard, Fresh, LoadingSpinner, PaginationFooter } from "../shared";
import { Tooltip } from "../tooltip";
import { stColor } from "../utils";
import type { TabId, InfraData, DashboardFilters } from "../types";
import { INFRA_DEMO } from "../mock-data";
import { MissionControlBreadcrumb } from "./mission-control/MissionControlBreadcrumb";

/**
 * Latency formatter — operator-readable units instead of raw ms.
 * operator-flagged 2026-05-09: 1497ms reads as engineer noise; 1.5s reads
 * naturally. ms < 1000 stays in ms (sub-second is fine-grained); 1s–60s
 * renders as Xs to one decimal; ≥60s renders as Xmin to one decimal.
 * Negative values render "--" (the existing "no probe yet" sentinel).
 */
function formatLatency(ms: number): string {
  if (ms < 0) return "--";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

export function InfrastructurePanel({ infra: liveInfra, onNavigate, filters, demoMode, incomingFromMissionControl, onMissionControlBackConsumed }: { infra: InfraData | null; onNavigate: (tab: TabId, focus?: string) => void; filters: DashboardFilters; demoMode?: boolean; incomingFromMissionControl?: boolean; onMissionControlBackConsumed?: () => void }) {
  // In demo mode, substitute INFRA_DEMO so the panel body renders a
  // believable services + system metrics view without hitting live APIs.
  // Header counters in the parent dashboard remain LIVE by design (Phase 5
  // demo/live boundary contract); this swap is scoped to the panel body.
  const infra = demoMode ? (INFRA_DEMO as unknown as InfraData) : liveInfra;
  if (!infra) return <LoadingSpinner />;

  const isHermes = filters.selectedInstance === "hermes-local";

  // Filter services by instance when a specific instance is selected
  const filteredServices = filters.selectedInstance === "all"
    ? infra.services
    : isHermes
      ? infra.services.filter(s => /hermes/i.test(s.name))
      : infra.services.filter(s => !/hermes/i.test(s.name));

  // v0.11.5+: rule-of-5 pagination on the general services list. The Hermes-
  // specific branch above renders one service card and doesn't need pagination.
  const [svcPageSize, setSvcPageSize] = useState(5);
  const [svcPage, setSvcPage] = useState(0);
  useEffect(() => { setSvcPage(0); }, [filters.selectedInstance, svcPageSize]);
  const svcTotalPages = Math.max(1, Math.ceil(filteredServices.length / svcPageSize));
  const pagedServices = filteredServices.slice(svcPage * svcPageSize, (svcPage + 1) * svcPageSize);

  // Hermes-specific infrastructure view
  if (isHermes) {
    const hermesSvc = infra.services.find(s => /hermes/i.test(s.name));
    const hermesData = (infra as unknown as Record<string, unknown>).hermes as {
      available?: boolean;
      status?: string;
      statusDetail?: string | null;
      stateDbPath?: string;
      activeProfile?: string | null;
      profiles?: { count: number; names: string[] };
      channels?: { configured: string[]; observed: string[] };
      skills?: { count: number; profilesWithSkills: number };
      tools?: { count: number; names: string[]; profilesWithTools: number };
      sessions?: { total: number; last24h: number };
      messages?: { total: number; last24h: number; lastId: number };
      lastActivity?: string | null;
      watcher?: { enabled: boolean; pollIntervalMs: number };
      shieldVisibility?: { enabled: boolean; mode: string };
    } | undefined;
    const status = hermesData?.status || (hermesData?.available ? "live" : "not_configured");
    const stateColor = hermesData?.available ? status === "live" ? C.green : C.warn : C.danger;
    return (
      <div>
        <Card title="Hermes Agent Health" accent={C.brand} actions={<Fresh />}>
          {hermesSvc && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", marginBottom: 8, background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderLeft: `3px solid ${stColor(hermesSvc.status)}`, borderRadius: 12 }}>
              <Dot color={stColor(hermesSvc.status)} size={8} glow={hermesSvc.status === "online"} />
              <span style={{ fontWeight: 600, fontSize: 13, color: C.tx }}>Hermes Agent</span>
              <Badge label={status.toUpperCase()} color={stateColor} />
              <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>{hermesData?.statusDetail || "state.db diagnostic source"}</span>
            </div>
          )}
          {!hermesSvc && (
            <div style={{ padding: "12px", background: `${C.danger}22`, border: `1px solid ${C.danger}33`, borderLeft: `3px solid ${C.danger}`, borderRadius: 12, fontSize: 13, color: C.txS }}>
              Hermes Agent service not detected. Verify that <span style={{ fontFamily: F.mono, color: C.cyan }}>~/.hermes/state.db</span> exists and is readable.
            </div>
          )}
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
          <Card title="Sessions (24h)" accent={C.brand}>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: F.mono, color: C.brand }}>{hermesData?.sessions?.last24h ?? 0}</div>
            <div style={{ fontSize: 12, color: C.txT, marginTop: 4 }}>Active in last 24 hours</div>
          </Card>
          <Card title="Platforms" accent={C.cyan}>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: F.mono, color: C.cyan }}>{hermesData?.channels?.observed?.length ?? 0}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {(hermesData?.channels?.observed || []).map(s => <Badge key={s} label={s} color={C.cyan} />)}
            </div>
          </Card>
          <Card title="Last Activity" accent={C.info}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: F.mono, color: C.info }}>
              {hermesData?.lastActivity ? new Date(hermesData.lastActivity).toLocaleString() : "No activity"}
            </div>
          </Card>
          <Card title="Data Source" accent={C.purp}>
            <div style={{ fontSize: 12, fontFamily: F.mono, color: C.tx }}>{hermesData?.stateDbPath || "~/.hermes/state.db"}</div>
            <div style={{ fontSize: 11, color: C.txT, marginTop: 4 }}>SQLite (WAL mode, read-only)</div>
            <div style={{ fontSize: 11, color: C.txT }}>Poll: every {Math.round((hermesData?.watcher?.pollIntervalMs || 10000) / 1000)}s</div>
          </Card>
        </div>

        <CollapsibleCard title="Hermes Components" accent={C.info} defaultOpen={true}>
          {[
            { name: "State Database", path: hermesData?.stateDbPath || "~/.hermes/state.db", desc: `${hermesData?.messages?.total ?? 0} messages · cursor ${hermesData?.messages?.lastId ?? 0}`, status: hermesData?.available ? "online" : "offline" },
            { name: "Active Profile", path: hermesData?.activeProfile || "not selected", desc: `${hermesData?.profiles?.count ?? 0} profile(s) detected`, status: hermesData?.activeProfile ? "online" : "degraded" },
            { name: "Channels", path: (hermesData?.channels?.configured || []).join(", ") || "none configured", desc: `${hermesData?.channels?.observed?.length ?? 0} observed source(s)`, status: (hermesData?.channels?.configured?.length || hermesData?.channels?.observed?.length) ? "online" : "degraded" },
            { name: "Skills Library", path: "profiles/*/skills/**/SKILL.md", desc: `${hermesData?.skills?.count ?? 0} skill file(s), ${hermesData?.skills?.profilesWithSkills ?? 0} profile(s) with skills`, status: (hermesData?.skills?.count ?? 0) > 0 ? "online" : "degraded" },
            { name: "Extracted Tools", path: (hermesData?.tools?.names || []).join(", ") || "none detected", desc: `${hermesData?.tools?.count ?? 0} tool(s), ${hermesData?.tools?.profilesWithTools ?? 0} profile(s) with tools`, status: (hermesData?.tools?.count ?? 0) > 0 ? "online" : "degraded" },
            { name: "Prompt Shield Visibility", path: hermesData?.shieldVisibility?.mode || "not-visible", desc: hermesData?.shieldVisibility?.enabled ? "Retro-scan watcher is enabled" : "Hermes messages are not visible to Shield", status: hermesData?.shieldVisibility?.enabled ? "online" : "offline" },
          ].map((comp, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 12px", marginBottom: 4, background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderLeft: `3px solid ${stColor(comp.status)}`, borderRadius: 12 }}>
              <Dot color={stColor(comp.status)} size={6} />
              <span style={{ fontWeight: 600, fontSize: 12, color: C.tx, minWidth: 130 }}>{comp.name}</span>
              <span style={{ fontSize: 11, fontFamily: F.mono, color: C.cyan, minWidth: 200 }}>{comp.path}</span>
              <span style={{ fontSize: 11, color: C.txT }}>{comp.desc}</span>
            </div>
          ))}
        </CollapsibleCard>

        {/* Host info still relevant */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
          <Card title="CPU" accent={C.brand}>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: F.mono, color: infra.system.cpuUsage > 80 ? C.danger : C.brand }}>{infra.system.cpuUsage}%</div>
            <Bar value={infra.system.cpuUsage} max={100} />
            <div style={{ fontSize: 12, color: C.txT, marginTop: 4 }}>{infra.system.cpuCores} cores</div>
          </Card>
          <Card title="Memory" accent={C.cyan}>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: F.mono, color: infra.system.memUsage > 80 ? C.danger : C.cyan }}>{infra.system.memUsage}%</div>
            <Bar value={infra.system.memUsage} max={100} color={C.cyan} />
            <div style={{ fontSize: 12, color: C.txT, marginTop: 4 }}>{infra.system.memUsed} / {infra.system.memTotal}</div>
          </Card>
          <Card title="Storage" accent={C.warn}>
            {(() => {
              const root = infra.disk?.find(d => d.mount === "/");
              if (!root) return <span style={{ fontSize: 12, color: C.txT }}>No disk data</span>;
              const usePct = parseInt(root.usePct) || 0;
              return (
                <>
                  <div style={{ fontSize: 24, fontWeight: 800, fontFamily: F.mono, color: usePct > 80 ? C.danger : C.warn }}>{usePct}%</div>
                  <Bar value={usePct} max={100} color={C.warn} />
                  <div style={{ fontSize: 12, color: C.txT, marginTop: 4 }}>{root.used} used / {root.size} total</div>
                </>
              );
            })()}
          </Card>
          <Card title="Host" accent={C.purp}>
            <div style={{ fontSize: 13, fontFamily: F.mono, color: C.tx }}>{infra.system.hostname}</div>
            <div style={{ fontSize: 12, color: C.txT, marginTop: 4 }}>{infra.system.platform} ({infra.system.arch})</div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab; child
    // cards carry chrome. Mission Control is the baseline.
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* v0.12.0+: Mission Control return breadcrumb. */}
      <MissionControlBreadcrumb
        visible={!!incomingFromMissionControl}
        onClick={() => onMissionControlBackConsumed?.()}
      />
      <Card title="Infrastructure Health" accent={C.brand} actions={<Fresh />}>
        {pagedServices.map((s, i) => {
          const detail = (s as Record<string, unknown>).detail as string || (s as Record<string, unknown>).error as string || "";
          const sc = stColor(s.status);
          const isDegraded = s.status === "degraded";
          const isOffline = s.status === "offline";
          const isNotConfigured = s.status === "not_configured" || (s.status as string) === "NOT_CONFIGURED" || (detail && detail.toLowerCase().includes("not configured"));
          const isLiteLLM = s.name.includes("LiteLLM");
          // Only the NOT_CONFIGURED state navigates to Configuration. Offline/degraded rows rely
          // on the inline Restart button so clicking it doesn't bounce the user away.
          // For LiteLLM specifically, jump straight to Model Providers (what needs to be added).
          const clickable = isNotConfigured;
          const clickTarget: [TabId, string?] = isLiteLLM ? ["configuration", "modelProviders"] : ["configuration"];
          return (
            <div
              key={i}
              onClick={clickable ? () => onNavigate(clickTarget[0], clickTarget[1]) : undefined}
              title={clickable ? "Not yet configured. Click to configure now!" : undefined}
              style={{
                // Status badge column widened from 90px to 150px so "NOT_CONFIGURED"
                // (the longest label) fits cleanly without clipping. Also nudges latency
                // (now 60px) and bar (70px) to keep the row visually balanced.
                display: "grid", gridTemplateColumns: "20px 180px 1fr 150px 60px 70px 120px", alignItems: "center", gap: 6, padding: "8px 12px", marginBottom: 4,
                background: clickable ? `${C.brand}22` : isDegraded ? `${C.warn}22` : isOffline ? `${C.danger}22` : C.glassSurfTrans,
                border: `1px solid ${C.glassSurfBorder}`,
                borderLeft: `3px solid ${clickable ? C.brand : sc}`,
                borderRadius: 12,
                cursor: clickable ? "pointer" : (isDegraded || isOffline ? "help" : "default"),
                transition: "background 0.15s ease",
              }}
              onMouseEnter={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.background = `${C.brand}33`; } : undefined}
              onMouseLeave={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.background = `${C.brand}22`; } : undefined}
            >
              <Dot color={sc} size={8} glow={s.status === "online"} />
              <span style={{ fontWeight: 600, fontSize: 13, color: C.tx }}>{s.name}</span>
              <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{s.url}</span>
              {(() => {
                const upper = s.status.toUpperCase();
                // Status-specific tooltip — every state gets an explanation so the
                // operator can learn the system by hovering. Latency is surfaced on
                // ONLINE since it's the main secondary signal in that row.
                const tipContent = (() => {
                  if (upper === "DEGRADED") return (
                    <span>
                      Service is <strong style={{ color: C.tx }}>running and reachable</strong>, but a deeper health check failed — <em>not offline</em>. Inline detail below the row shows the specific reason. For LiteLLM, the <strong>Restart</strong> button on the right kills the proxy, re-reads <code style={{ fontFamily: F.mono, color: C.cyan }}>litellm/config.yaml</code>, and restarts in place.
                    </span>
                  );
                  if (upper === "NOT_CONFIGURED") return (
                    <span>Service hasn&apos;t been set up yet. Click the row to jump to Configuration and configure it.</span>
                  );
                  if (upper === "OFFLINE") return (
                    <span>
                      Service is <strong style={{ color: C.tx }}>unreachable</strong> — the health probe timed out or the port refused a connection. The watchdog cron retries every 5 minutes and attempts an automatic restart. Check the service logs below for the underlying reason.
                    </span>
                  );
                  // ONLINE
                  return (
                    <span>
                      Service is <strong style={{ color: C.tx }}>healthy</strong>. Latency column shows the round-trip time for the last health probe; anything under <code style={{ fontFamily: F.mono, color: C.cyan }}>200ms</code> is normal, <code style={{ fontFamily: F.mono, color: C.cyan }}>200–500ms</code> turns amber, above <code style={{ fontFamily: F.mono, color: C.cyan }}>500ms</code> red.
                    </span>
                  );
                })();
                const variant = upper === "NOT_CONFIGURED" ? "compact" : "detail";
                return (
                  <Tooltip placement="top" variant={variant} content={tipContent}>
                    <Badge label={upper} color={sc} />
                  </Tooltip>
                );
              })()}
              <span style={{
                fontSize: 11,
                // Color follows service status, not raw latency. A slow-but-
                // healthy service shouldn't read red just because it took a
                // beat to respond. operator-flagged 2026-05-09.
                color:
                  s.status === "online" ? C.txS :
                  s.status === "degraded" ? C.warn :
                  s.status === "offline" ? C.danger :
                  C.txT,
                fontFamily: F.mono,
                textAlign: "right" as const,
              }}>{formatLatency(s.latency)}</span>
              <Bar value={s.status === "online" ? 100 : s.status === "degraded" ? 60 : 0} max={100} color={sc} h={4} />
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                {s.name.includes("LiteLLM") && (
                  <button id="litellm-restart-btn" onClick={async (e) => {
                    e.stopPropagation();
                    const btn = e.currentTarget;
                    const orig = btn.textContent;
                    btn.textContent = "Restarting...";
                    btn.style.opacity = "0.6";
                    btn.style.pointerEvents = "none";
                    try {
                      const res = await fetch("/api/system/litellm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart" }) });
                      const data = await res.json();
                      if (data.ok) {
                        btn.textContent = "Restarted \u2713";
                        btn.style.borderColor = C.green;
                        btn.style.color = C.green;
                        setTimeout(() => { btn.textContent = orig; btn.style.opacity = "1"; btn.style.pointerEvents = "auto"; btn.style.borderColor = `${C.brand}44`; btn.style.color = C.brand; }, 4000);
                      } else {
                        btn.textContent = data.error || "Failed \u2717";
                        btn.style.color = C.danger;
                        btn.style.borderColor = C.danger;
                        setTimeout(() => { btn.textContent = orig; btn.style.opacity = "1"; btn.style.pointerEvents = "auto"; btn.style.borderColor = `${C.brand}44`; btn.style.color = C.brand; }, 5000);
                      }
                    } catch {
                      btn.textContent = "Error \u2717";
                      btn.style.color = C.danger;
                      setTimeout(() => { btn.textContent = orig; btn.style.opacity = "1"; btn.style.pointerEvents = "auto"; btn.style.color = C.brand; }, 5000);
                    }
                  }} style={{ padding: "2px 6px", background: "transparent", border: `1px solid ${C.cyan}55`, borderRadius: 8, color: C.cyan, fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>Restart</button>
                )}
              </div>
            </div>
          );
        })}
        {/* Inline detail for degraded/offline services */}
        {infra.services.filter(s => s.status === "degraded" || s.status === "offline").map((s, i) => {
          const detail = (s as Record<string, unknown>).detail as string || (s as Record<string, unknown>).error as string || "";
          if (!detail) return null;
          const sc = stColor(s.status);
          return (
            <div key={`detail-${i}`} style={{ padding: "6px 12px 6px 25px", marginBottom: 4, fontSize: 11, color: sc, borderLeft: `3px solid ${sc}55`, background: `${sc}22`, borderRadius: 8, border: `1px solid ${sc}33` }}>
              <span style={{ fontWeight: 600 }}>{s.name}:</span> {detail}
            </div>
          );
        })}
        {svcTotalPages > 1 && (
          <PaginationFooter
            currentPage={svcPage}
            totalPages={svcTotalPages}
            pageSize={svcPageSize}
            totalRows={filteredServices.length}
            onPageSizeChange={setSvcPageSize}
            onPageChange={setSvcPage}
          />
        )}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
        <Card title="CPU" accent={C.brand}>
          <div style={{ fontSize: 24, fontWeight: 800, fontFamily: F.mono, color: infra.system.cpuUsage > 80 ? C.danger : C.brand }}>{infra.system.cpuUsage}%</div>
          <Bar value={infra.system.cpuUsage} max={100} />
          <div style={{ fontSize: 12, color: C.txT, marginTop: 4 }}>{infra.system.cpuCores} cores</div>
        </Card>
        <Card title="Memory" accent={C.cyan}>
          <div style={{ fontSize: 24, fontWeight: 800, fontFamily: F.mono, color: infra.system.memUsage > 80 ? C.danger : C.cyan }}>{infra.system.memUsage}%</div>
          <Bar value={infra.system.memUsage} max={100} color={C.cyan} />
          <div style={{ fontSize: 12, color: C.txT, marginTop: 4 }}>{infra.system.memUsed} / {infra.system.memTotal}</div>
        </Card>
        <Card title="Storage" accent={C.warn}>
          {(() => {
            const root = infra.disk?.find(d => d.mount === "/");
            if (!root) return <span style={{ fontSize: 12, color: C.txT }}>No disk data</span>;
            const usePct = parseInt(root.usePct) || 0;
            return (
              <>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: F.mono, color: usePct > 80 ? C.danger : C.warn }}>{usePct}%</div>
                <Bar value={usePct} max={100} color={C.warn} />
                <div style={{ fontSize: 12, color: C.txT, marginTop: 4 }}>{root.used} used / {root.size} total</div>
                <div style={{ fontSize: 12, color: C.txS }}>{root.available} free</div>
              </>
            );
          })()}
        </Card>
        <Card title="Host" accent={C.purp}>
          <div style={{ fontSize: 13, fontFamily: F.mono, color: C.tx }}>{infra.system.hostname}</div>
          <div style={{ fontSize: 12, color: C.txT, marginTop: 4 }}>{infra.system.platform} ({infra.system.arch})</div>
          <div style={{ fontSize: 12, color: C.txT }}>Uptime: {infra.system.uptime}</div>
        </Card>
      </div>

      {/* Service Logs Viewer */}
      <LogViewer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log Viewer sub-component
// ---------------------------------------------------------------------------

function LogViewer() {
  const [entries, setEntries] = useState<Array<{ ts: string; level: string; source: string; msg: string }>>([]);
  const [levelFilter, setLevelFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ lines: "50" });
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      const res = await fetch(`/api/infrastructure/logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch {} finally { setLoading(false); }
  }, [levelFilter, sourceFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const levelColor = (lvl: string) => {
    switch (lvl) {
      case "ERROR": return C.danger;
      case "WARN": return C.warn;
      case "INFO": return C.brand;
      case "DEBUG": return C.txT;
      default: return C.txS;
    }
  };

  return (
    <CollapsibleCard title="Service Logs" accent={C.info} defaultOpen={false} count={entries.length}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
        <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={{ padding: "3px 6px", background: C.srf, border: `1px solid ${C.brd}`, borderRadius: 4, color: C.txS, fontSize: 11, fontFamily: F.mono }}>
          <option value="all">All Levels</option>
          <option value="ERROR">ERROR</option>
          <option value="WARN">WARN</option>
          <option value="INFO">INFO</option>
          <option value="DEBUG">DEBUG</option>
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{ padding: "3px 6px", background: C.srf, border: `1px solid ${C.brd}`, borderRadius: 4, color: C.txS, fontSize: 11, fontFamily: F.mono }}>
          <option value="all">All Sources</option>
          <option value="shield">Shield</option>
          <option value="watcher">Watcher</option>
          <option value="connector">Connector</option>
          <option value="system">System</option>
          <option value="api">API</option>
        </select>
        <button onClick={fetchLogs} style={{ padding: "3px 8px", background: "transparent", border: `1px solid ${C.cyan}55`, borderRadius: 8, color: C.cyan, fontSize: 10, fontWeight: 600, fontFamily: F.mono, cursor: "pointer" }}>Refresh</button>
      </div>
      {loading ? <LoadingSpinner /> : entries.length === 0 ? (
        <div style={{ fontSize: 12, color: C.txT, padding: 12, textAlign: "center" }}>No log entries. Logs will appear as services generate structured output.</div>
      ) : (
        <div style={{ maxHeight: 300, overflowY: "auto", fontSize: 11, fontFamily: F.mono }}>
          {entries.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
              <span style={{ color: C.txT, flexShrink: 0, width: 65 }}>{new Date(e.ts).toLocaleTimeString("en-US", { hour12: false })}</span>
              <span style={{ color: levelColor(e.level), fontWeight: 700, flexShrink: 0, width: 40 }}>{e.level}</span>
              <span style={{ color: C.cyan, flexShrink: 0, width: 70 }}>{e.source}</span>
              <span style={{ color: C.txS, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.msg}</span>
            </div>
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}
