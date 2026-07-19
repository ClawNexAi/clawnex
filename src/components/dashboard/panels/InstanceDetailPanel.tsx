"use client";

import { useState, useEffect } from "react";
import { C, F } from "../constants";
import { Stat, Card, Dot, EmptyState } from "../shared";
import { stColor } from "../utils";
import { INST, ALERTS_D, AUDIT_LOG, INFRA_DEMO } from "../mock-data";
import { TimelinePanel } from "./TimelinePanel";
import type { TabId, DashboardFilters, FleetInstance } from "../types";

// v0.8.2+: onNavigate accepts the v0.8.2 opts shape (id + highlight) for
// cross-panel deep-linking, with back-compat for the focus-string-only path.
export function InstanceDetailPanel({ fleetApi, demoMode, filters, onNavigate }: {
  fleetApi: FleetInstance[] | null;
  demoMode: boolean;
  filters: DashboardFilters;
  onNavigate: (tab: TabId, focusOrOpts?: string | { focus?: string; id?: string; highlight?: string }) => void;
}) {
  const instances = demoMode ? INST : (fleetApi || []).map(f => ({
    id: f.id, client: f.client, ver: f.version || "live", status: f.status,
    cpu: f.cpu, mem: f.mem, disk: f.disk ?? null,
    threats: f.threats, alerts: f.alerts ?? null,
    region: f.region || "local", agents: f.agents,
    sessions: f.sessions ?? null, p95: f.p95 ?? null, cost: f.cost ?? null,
    posture: f.posture || 80,
    spark: Array.from({ length: 12 }, () => Math.round((f.cpu ?? 30) + (Math.random() - 0.5) * 10)),
  }));
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [recentAlerts, setRecentAlerts] = useState<Array<{ id: string; title: string; severity: string; source: string; status: string; created_at: string }>>([]);
  // v0.8.2+: audit row carries `id` so the Timeline backlink can deep-link to
  // a specific audit event in the Audit & Evidence panel via URL hash.
  const [recentAudit, setRecentAudit] = useState<Array<{ id: string; action: string; actor: string; detail: string; created_at: string }>>([]);
  const [services, setServices] = useState<Array<{ name: string; status: string }>>([]);

  useEffect(() => {
    if (demoMode) {
      // Demo: shape ALERTS_D + AUDIT_LOG into the schemas TimelinePanel
      // expects, and use INFRA_DEMO services so the Services card renders
      // a believable mix (online + degraded + offline). Cross-references
      // INST.s-003 narrative — alert ALT-001/-002 from the COR-001 chain
      // shows up in the timeline, audit entries reflect the same window.
      setRecentAlerts(ALERTS_D.slice(0, 8).map((a, i) => ({
        id: a.id,
        title: a.title,
        severity: a.severity,
        source: a.source,
        status: a.status,
        created_at: new Date(Date.now() - (i + 1) * 9 * 60 * 1000).toISOString(),
      })));
      setRecentAudit(AUDIT_LOG.slice(0, 8).map((e, i) => ({
        id: `audit-d-${i + 1}`,
        action: e.action,
        actor: e.actor,
        detail: e.detail,
        created_at: new Date(Date.now() - (i + 1) * 7 * 60 * 1000).toISOString(),
      })));
      setServices(INFRA_DEMO.services.map(s => ({ name: s.name, status: s.status })));
      return;
    }
    (async () => {
      try {
        // internal reviewer metric-corroboration #4 (2026-04-29): InstanceDetail feeds
        // `recentAlerts` into TimelinePanel as a chronological "what
        // happened in this window" feed alongside audit events — that's
        // recent history, not active-state. Explicit scope=all aligns the
        // fetch with the operator's mental model and keeps it from
        // contradicting Header / Sidebar / Fleet / Alerts panel which
        // intentionally answer the active-state question with scope=active.
        const [aRes, auRes, iRes] = await Promise.allSettled([
          fetch(`/api/alerts?scope=all&limit=10&since=${encodeURIComponent(filters.since)}`),
          fetch(`/api/audit?limit=10&since=${encodeURIComponent(filters.since)}&exclude_actions=agent_event,chat_event`),
          fetch("/api/infrastructure"),
        ]);
        if (aRes.status === "fulfilled" && aRes.value.ok) { const d = await aRes.value.json(); setRecentAlerts(d.alerts || []); }
        if (auRes.status === "fulfilled" && auRes.value.ok) { const d = await auRes.value.json(); setRecentAudit(d.events || []); }
        if (iRes.status === "fulfilled" && iRes.value.ok) { const d = await iRes.value.json(); setServices(d.services || []); }
      } catch {}
    })();
  }, [filters.since, demoMode]);

  if (instances.length === 0) return <EmptyState message="No instances available. Add gateways in Configuration or enable Demo Mode." />;

  const inst = instances[Math.min(selectedIdx, instances.length - 1)];

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab.
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        {instances.map((f, i) => (
          <button key={f.id} onClick={() => setSelectedIdx(i)} style={{
            padding: "6px 12px", borderRadius: 999, fontSize: 13, fontFamily: F.mono, cursor: "pointer",
            background: i === selectedIdx ? `rgba(34,211,238,0.22)` : C.glassSurfTrans,
            border: `1px solid ${i === selectedIdx ? `rgba(34,211,238,0.55)` : C.glassSurfBorder}`,
            color: i === selectedIdx ? C.cyan : C.txS,
          }}>
            {f.client.split(" ")[0]}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Status" value={(() => { const degraded = services.some(s => s.status === "degraded"); const offline = services.some(s => s.status === "offline"); return offline ? "DEGRADED" : degraded ? "DEGRADED" : inst.status.toUpperCase(); })()} color={(() => { const degraded = services.some(s => s.status === "degraded"); const offline = services.some(s => s.status === "offline"); return offline ? C.danger : degraded ? C.warn : stColor(inst.status); })()} small />
        <Stat label="Threats" value={inst.threats ?? "Unavailable"} color={inst.threats == null ? C.txT : inst.threats > 0 ? C.danger : C.green} small />
        <Stat label="CPU" value={inst.cpu == null ? "Unavailable" : `${inst.cpu}%`} color={inst.cpu == null ? C.txT : inst.cpu > 70 ? C.danger : C.brand} small />
        <Stat label="Memory" value={inst.mem == null ? "Unavailable" : `${inst.mem}%`} color={inst.mem == null ? C.txT : inst.mem > 80 ? C.danger : C.brand} small />
        <Stat label="Agents" value={inst.agents ?? "N/A"} color={inst.agents == null ? C.txT : C.cyan} small />
        <Stat label="Sessions" value={inst.sessions ?? "Unavailable"} color={inst.sessions == null ? C.txT : C.info} small />
        <Stat label={`Cost (${filters.timeRange})`} value={inst.cost == null ? "Unavailable" : `$${inst.cost}`} color={inst.cost == null ? C.txT : C.warn} small />
        <Stat label="P95 Latency" value={inst.p95 == null ? "Unavailable" : `${inst.p95}ms`} color={inst.p95 == null ? C.txT : inst.p95 > 200 ? C.danger : C.green} small />
      </div>

      {/* Services */}
      {services.length > 0 && (
        <Card title="Services" accent={C.cyan}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {services.map(s => {
              const detail = (s as Record<string, unknown>).detail as string || (s as Record<string, unknown>).error as string || "";
              const isDown = s.status === "degraded" || s.status === "offline";
              const isNotConfigured = s.status === "not_configured" || (s.status as string) === "NOT_CONFIGURED" || (detail && detail.toLowerCase().includes("not configured"));
              const isLiteLLM = s.name.includes("LiteLLM");
              // LiteLLM badge click routing:
              //   NOT_CONFIGURED (blue) → Configuration, auto-expand Model Providers card
              //   OFFLINE / DEGRADED (red/amber) → Infrastructure, hit Restart
              let clickHandler: (() => void) | undefined;
              let clickTitle: string | undefined;
              if (isLiteLLM && isNotConfigured) {
                clickHandler = () => onNavigate("configuration", "modelProviders");
                clickTitle = "LiteLLM isn't configured yet — click to open Configuration → Model Providers";
              } else if (isLiteLLM && isDown) {
                clickHandler = () => onNavigate("infrastructure");
                clickTitle = "LiteLLM is down — click to open Infrastructure and restart";
              }
              const linkable = Boolean(clickHandler);
              return (
                <div
                  key={s.name}
                  onClick={clickHandler}
                  title={clickTitle || detail}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                    background: C.glassSurfTrans,
                    border: `1px solid ${C.glassSurfBorder}`,
                    borderRadius: 12,
                    cursor: linkable ? "pointer" : (isDown ? "help" : "default"),
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={linkable ? (e) => { (e.currentTarget as HTMLDivElement).style.background = `${stColor(s.status)}22`; } : undefined}
                  onMouseLeave={linkable ? (e) => { (e.currentTarget as HTMLDivElement).style.background = `${stColor(s.status)}10`; } : undefined}
                >
                  <Dot color={stColor(s.status)} size={6} glow={s.status === "online"} />
                  <span style={{ fontSize: 12, color: stColor(s.status), fontFamily: F.mono, fontWeight: 600 }}>{s.name}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Timeline */}
      <TimelinePanel alerts={recentAlerts} audit={recentAudit} filters={filters} onNavigate={onNavigate} />
    </div>
  );
}
