"use client";

import { useEffect, useState, useCallback } from "react";
import { C, F } from "../constants";
import { Stat, Card, Badge, Bar, Spark, Fresh, Table, TokenRateBadge, EmptyState, PanelStateBar, PanelEmptyState } from "../shared";
import { stColor } from "../utils";
import { INST } from "../mock-data";
import { FleetLiveCards } from "./FleetLiveCards";
import { Tooltip } from "../tooltip";
import { ReadinessBanner } from "../ReadinessBanner";
import type { TabId, DashboardFilters, FleetInstance } from "../types";

export function FleetCommandPanel({ fleetApi, filters, demoMode, threatTrend, onNavigate }: { fleetApi: FleetInstance[] | null; filters: DashboardFilters; demoMode: boolean; threatTrend?: number[]; onNavigate: (tab: TabId, focus?: string) => void }) {
  // null = still loading; true = show wizard; false = hide
  const [wizardNeeded, setWizardNeeded] = useState<boolean | null>(null);
  // When true, all setup steps in `lib/dashboard/onboarding-steps.ts` have
  // passed. Combined with dismissal below, controls the completion screen.
  const [wizardAllComplete, setWizardAllComplete] = useState<boolean>(false);
  // Bump this counter to force the wizard to re-check its step completion (e.g. after an install succeeds).
  const [wizardReloadTick, setWizardReloadTick] = useState(0);
  // Track last refresh so PanelStateBar can show "Updated N min ago" honestly.
  // fleetApi is owned by the parent dashboard; we reflect its identity changes
  // as "refreshed" events rather than fetching independently.
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  useEffect(() => {
    if (fleetApi !== null) setLastRefresh(new Date());
  }, [fleetApi]);

  // Refetch readiness state when the operator returns to this tab/window.
  // Without this, changes made outside the wizard (e.g. provider added via
  // Configuration in another tab, RBAC enabled by re-running setup.sh, mail
  // provider configured directly) leave the "Setup not complete" banner
  // stale until manual reload — issue #34. We don't poll on a timer because
  // that'd fire 8 fetches every interval for nothing 95% of the time;
  // visibility/focus events cover the realistic out-of-band-change flow.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setWizardReloadTick(t => t + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  useEffect(() => {
    if (demoMode) { setWizardNeeded(false); return; }
    (async () => {
      try {
        const [provRes, scanRes, cveRes, clawRes, routeRes, defRes, pricingRes] = await Promise.allSettled([
          fetch("/api/config/providers"),
          // Phase 2a-fix: wizard's "Run first shield test" signal explicitly
          // opts in to test-generated scans. Without this, an operator on a
          // fresh install runs the Shield Tests panel (source=shield-test →
          // origin=shield-test) and the wizard step never goes green
          // because production-default stats exclude those scans. Header /
          // sidebar / Fleet active-alert badges still use the production
          // default elsewhere — this opt-in is scoped to the wizard.
          fetch("/api/shield/stats?includeTestGenerated=true"),
          fetch("/api/cve"),
          fetch("/api/config/updates"),
          fetch("/api/openclaw/routing"),
          fetch("/api/config/defaults"),
          fetch("/api/config/model-pricing"),
        ]);
        let hasProvider = false;
        let hasScans = false;
        let hasCve = false;
        let hasHostSecurity = false;
        let routingOk = false;
        let dismissed = false;
        let pricingSynced = false;
        if (provRes.status === "fulfilled" && provRes.value.ok) {
          try {
            const d = await provRes.value.json();
            const realProviders = (d.providers || []).filter((p: { type: string }) => p.type !== "openclaw");
            hasProvider = realProviders.length > 0;
          } catch {}
        }
        // 2026-05-09 (operator-flagged): OpenClaw being connected NO LONGER
        // auto-satisfies the "add a model provider" wizard step. The
        // earlier shortcut auto-completed the step on any host where
        // ~/.openclaw/openclaw.json existed (which survives every redeploy
        // because deploy-prod.sh explicitly never touches that path), so
        // operators were never prompted to add a real provider during
        // setup. Now the step requires either a real (non-openclaw)
        // provider OR an explicit skip. OpenClaw integration still works
        // for ClawNex's own AI features regardless of step state — the
        // step is just about onboarding visibility, not about gating
        // ClawNex AI capability.
        if (scanRes.status === "fulfilled" && scanRes.value.ok) {
          try {
            const d = await scanRes.value.json();
            hasScans = (d.total || 0) > 0;
          } catch {}
        }
        if (cveRes.status === "fulfilled" && cveRes.value.ok) {
          try {
            const d = await cveRes.value.json();
            hasCve = Boolean(d.lastSync) || (d.total || 0) > 0;
          } catch {}
        }
        if (clawRes.status === "fulfilled" && clawRes.value.ok) {
          try {
            const d = await clawRes.value.json();
            // /api/config/updates returns { clawkeeper: { installedVersion: "not installed" | "installed (YYYY-MM-DD)" } }
            hasHostSecurity = Boolean(d.clawkeeper && d.clawkeeper.installedVersion && d.clawkeeper.installedVersion !== "not installed");
          } catch {}
        }
        if (routeRes.status === "fulfilled" && routeRes.value.ok) {
          try {
            const d = await routeRes.value.json();
            // Routing step passes when config was found AND (no providers yet OR all routed)
            routingOk = Boolean(d.found) && (!(d.providers && d.providers.length) || d.providers.every((p: { routed: boolean }) => p.routed));
          } catch {}
        }
        let skipProvider = false, skipHostSecurity = false, skipCve = false, skipRouting = false, skipShield = false, skipPricing = false;
        if (defRes.status === "fulfilled" && defRes.value.ok) {
          try {
            const d = await defRes.value.json();
            const s = d?.settings || {};
            dismissed = s.wizard_dismissed === "1" || s.wizard_dismissed === "true";
            // Skip flags: any non-empty "1"/"true" value counts as skipped.
            const isSkip = (v: string | undefined) => v === "1" || v === "true";
            skipProvider = isSkip(s.wizard_skip_provider);
            skipHostSecurity = isSkip(s.wizard_skip_clawkeeper);
            skipCve = isSkip(s.wizard_skip_cve);
            skipRouting = isSkip(s.wizard_skip_routing);
            skipShield = isSkip(s.wizard_skip_shield);
            skipPricing = isSkip(s.wizard_skip_pricing);
            // The pricing step is only "done" when the operator has explicitly synced at
            // least once — not just because the DB auto-seeded. Track via pricing_ever_synced.
            if (s.pricing_ever_synced === "1") pricingSynced = true;
          } catch {}
        }
        // Secondary check: if /api/config/model-pricing reports everSynced=true
        // (perhaps from a different code path), honor that too.
        if (!pricingSynced && pricingRes.status === "fulfilled" && pricingRes.value.ok) {
          try {
            const d = await pricingRes.value.json();
            if (d.everSynced) pricingSynced = true;
          } catch {}
        }
        // A step counts as "done" for wizard-completion purposes if its real check passes OR the operator explicitly skipped it.
        const allDone = (hasProvider || skipProvider)
          && (hasHostSecurity || skipHostSecurity)
          && (hasCve || skipCve)
          && (pricingSynced || skipPricing)
          && (routingOk || skipRouting)
          && (hasScans || skipShield);
        setWizardAllComplete(allDone);
        // Wizard is hidden ONLY when every step is complete AND the operator has explicitly dismissed it.
        // Until then, it shows either the in-progress checklist or the "Setup Complete" screen.
        setWizardNeeded(!(allDone && dismissed));
      } catch {
        // On unexpected error, default to showing the wizard — safer for first-run.
        setWizardNeeded(true);
      }
    })();
  }, [demoMode, wizardReloadTick]);

  // Real API instances
  // Note: realInstances has `posture: number | null` (null = unscanned) which
  // diverges from the demo INST mock (all numbers). Use Omit+override so both
  // can coexist in the same fleet list; renderers below handle null explicitly.
  type FleetRow = Omit<typeof INST[0], 'posture'> & { posture: number | null };
  const realInstances: FleetRow[] = (fleetApi || []).map((f: FleetInstance) => ({
    id: f.id, client: f.client, ver: f.version || "live", status: f.status as string,
    up: f.uptime ? Math.min(99.99, 99 + Math.random()) : 99.9,
    cpu: f.cpu || 0, mem: f.mem || 0, disk: f.disk || 0,
    threats: f.threats || 0, alerts: f.alerts || 0,
    region: f.region || "local", hb: 12, agents: f.agents || 0,
    sessions: f.sessions || 0, p95: f.p95 || 0, cost: f.cost || 0,
    // Preserve null vs. number so the renderer can distinguish "unscanned" from "score".
    posture: f.posture == null ? null : f.posture,
    spark: threatTrend && threatTrend.length >= 2 ? threatTrend : [50],
  }));
  // Only include demo instances when demoMode is on. Widen demo rows to the
  // same FleetRow shape (posture stays a number for mock data) so both types unify.
  const demoInstances: Array<FleetRow & { isDemo?: boolean }> = demoMode
    ? INST.map(i => ({ ...i, posture: i.posture as number | null, isDemo: true }))
    : [];
  const allInst: Array<FleetRow & { isDemo?: boolean }> = [...realInstances, ...demoInstances];
  const fleet = allInst.filter(f => {
    if (filters.selectedInstance !== "all" && f.id !== filters.selectedInstance) return false;
    if (filters.selectedClient !== "all" && f.client !== filters.selectedClient) return false;
    return true;
  });
  const totalThreats = fleet.reduce((s, f) => s + f.threats, 0);
  const totalAlerts = fleet.reduce((s, f) => s + f.alerts, 0);
  const totalAgents = fleet.reduce((s, f) => s + f.agents, 0);
  const totalSessions = fleet.reduce((s, f) => s + f.sessions, 0);
  const totalCost = fleet.reduce((s, f) => s + f.cost, 0);
  const healthyCount = fleet.filter(f => f.status === "healthy").length;

  // Render the readiness banner above any downstream content (wizard, empty
  // state, or normal fleet). The banner fetches its own signals independently
  // so it always reflects the real environment, not demo mock data.
  // setupComplete drives auto-collapse: while the wizard is showing AND not all
  // steps are green, the banner defaults to minimized so the wizard owns the
  // viewport. After dismissal (wizardNeeded=false) or once all steps pass, the
  // banner expands. Operator's manual toggle (handled inside the banner) wins.
  const setupComplete = wizardNeeded === false || wizardAllComplete;
  const banner = <ReadinessBanner onNavigate={onNavigate} demoMode={demoMode} setupComplete={setupComplete} />;

  if (wizardNeeded === true) {
    return (
      <div style={{
        background: C.glassChrome,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${C.glassBorderSubtle}`,
        borderRadius: 14,
        boxShadow: C.glassShadow,
        padding: 16,
      }}>
        {banner}
        {/* Only show the "Setup not complete" warning when there are actually
            outstanding steps. When everything is done but the operator hasn't
            yet clicked "Get Started" to dismiss the wizard, this banner
            contradicts the wizard's own "✓ You're all set!" success box. */}
        {!wizardAllComplete && (
          <div style={{
            marginBottom: 12, padding: "8px 12px",
            background: `${C.warn}18`, border: `1px solid ${C.warn}55`, borderRadius: 999,
            fontSize: 12, color: C.txS,
          }}>
            <strong style={{ color: C.warn }}>Setup not complete</strong> — work through the checklist below to connect providers and register agents.
          </div>
        )}
        <WelcomeWizard
          onNavigate={onNavigate}
          onReload={() => setWizardReloadTick(t => t + 1)}
          allComplete={wizardAllComplete}
          onAllCompleteChange={setWizardAllComplete}
        />
      </div>
    );
  }

  // Fleet empty / still loading — show the banner + an explicit state bucket.
  if (fleet.length === 0 && !demoMode) {
    // Still fetching fleet (no response yet)
    if (fleetApi === null || wizardNeeded === null) {
      return (
        <div style={{
          background: C.glassChrome,
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          border: `1px solid ${C.glassBorderSubtle}`,
          borderRadius: 14,
          boxShadow: C.glassShadow,
          padding: 16,
        }}>
          {banner}
          <div style={{ marginBottom: 8 }}>
            <PanelStateBar state="loading" customLabel="Loading fleet data..." />
          </div>
          <EmptyState message="Loading fleet data..." />
        </div>
      );
    }
    // Wizard complete but still no fleet rows — fresh install, no agents detected yet.
    // The "Open Setup Wizard" action clears the wizard_dismissed flag (and any
    // skip flags so previously-skipped steps re-appear) and then bumps the
    // reload tick. Without the flag clear, the click was a no-op because the
    // wizard's check still saw the dismissal as authoritative.
    return (
      <div style={{
        background: C.glassChrome,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${C.glassBorderSubtle}`,
        borderRadius: 14,
        boxShadow: C.glassShadow,
        padding: 16,
      }}>
        {banner}
        <PanelEmptyState
          title="No fleet data yet"
          description="Complete the Setup Wizard to connect providers and register agents. Once traffic flows, agents will appear in the fleet table."
          actionLabel="Open Setup Wizard"
          onAction={async () => {
            const wizardKeys = [
              "wizard_dismissed",
              "wizard_skip_provider",
              "wizard_skip_clawkeeper",
              "wizard_skip_cve",
              "wizard_skip_routing",
              "wizard_skip_shield",
              "wizard_skip_pricing",
            ];
            try {
              await Promise.all(wizardKeys.map(k => fetch("/api/config/defaults", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: k, value: "" }),
              })));
            } catch { /* swallow — the reload tick below will surface a fetch error if the page state is unhealthy */ }
            setWizardReloadTick(t => t + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div style={{
      background: C.glassChrome,
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      border: `1px solid ${C.glassBorderSubtle}`,
      borderRadius: 14,
      boxShadow: C.glassShadow,
      padding: 16,
    }}>
      {banner}
      <div style={{
        display: "flex", justifyContent: "flex-end", alignItems: "center",
        marginBottom: 8, gap: 10,
      }}>
        <PanelStateBar
          state={fleetApi === null ? "loading" : "ready"}
          lastUpdated={lastRefresh}
          onRefresh={() => setWizardReloadTick(t => t + 1)}
        />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <Tooltip as="div" placement="bottom" variant="detail" content={
          <span>
            Every registered ClawNex gateway (local or remote) counts as one instance. Configure them under <strong>Configuration → Gateways</strong>. This is not a license count — it reflects what the dashboard is currently watching.
          </span>
        }>
          <Stat label="Instances" value={fleet.length} color={C.brand} />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={
          <span>
            Instances whose latest health check reported <strong style={{ color: C.green }}>OK</strong> — all four core services (<strong>ClawNex API</strong>, <strong>LiteLLM</strong>, <strong>Shield</strong>, <strong>Watcher</strong>) came back healthy. If even one of them fails, the whole instance drops out of this count.
          </span>
        }>
          <Stat label="Healthy" value={healthyCount} color={C.green} />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={
          <span>
            Shield <strong style={{ color: C.danger }}>BLOCK</strong> verdicts in the selected time range. The time range comes from the <strong>context bar</strong> at the top of the dashboard — change it to 1h / 6h / 24h / 7d / 30d to refocus. Click-through to the <strong>Prompt Shield</strong> panel for per-scan details.
          </span>
        }>
          <Stat label={`Threats (${filters.timeRange})`} value={totalThreats} color={totalThreats > 0 ? C.danger : C.green} />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={
          <span>
            <strong>Active Alerts</strong> across the fleet ({filters.timeRange}) — alerts that are open, acknowledged, or being investigated. Resolved, suppressed, and false-positive alerts are excluded. Manage them in the <strong>Alerts &amp; Incidents</strong> panel.
          </span>
        }>
          <Stat label="Active Alerts" value={totalAlerts} color={totalAlerts > 0 ? C.orange : C.green} />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={
          <span>
            Agents the session watcher has seen activity from in the last 24 hours. An agent goes idle after 30 minutes of silence and drops out of this count after 24 hours. Sourced from each agent&apos;s session logs on disk.
          </span>
        }>
          <Stat label="Active Agents" value={totalAgents} color={C.cyan} />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={
          <span>
            Open Claude Code session files across the fleet. Each session is one log file. Multiple sessions per agent is normal — the CLI starts a fresh file every time the operator opens a new context.
          </span>
        }>
          <Stat label="Sessions" value={totalSessions} color={C.info} />
        </Tooltip>
        <Stat label={`Fleet Cost (${filters.timeRange})`} value={`$${totalCost.toLocaleString()}`} color={C.warn} />
      </div>

      <Card title="Fleet - Ranked by Risk" accent={C.brand} actions={<Fresh />}>
        {fleet.length === 0 ? <EmptyState message="No fleet instances configured. Add gateways in Configuration." /> : (
        <Table
          headers={[
            "",
            "Client",
            "Region",
            "Ver",
            "CPU",
            "Mem",
            "Disk",
            "Threats",
            "P95",
            "Agents",
            <Tooltip key="h-cost" placement="top" variant="detail" content={
              <span>
                <strong style={{ color: C.tx }}>24-hour total spend</strong> for this instance. ClawNex computes this directly from token counts × the pinned LiteLLM pricing snapshot, rather than trusting the cost numbers OpenClaw emits — those are unreliable on OpenRouter routes. Refresh pricing in Configuration → Updates → Model Pricing.
              </span>
            }>
              <span style={{ borderBottom: `1px dotted ${C.txT}`, cursor: "help" }}>Cost</span>
            </Tooltip>,
            <Tooltip key="h-post" placement="top" variant="detail" content={
              <span>
                <strong style={{ color: C.tx }}>Hardening score (0–100)</strong> — the latest Host Security scan result. Same number as the Readiness Banner&apos;s Hardening Scan row and the Security Posture panel. Shows a dash until a real scan runs (a fresh install is <em>unknown</em>, not 100%). To populate it, click <strong>Security Posture</strong> in the sidebar then <strong>Run Scan</strong>. Distinct from the dynamic <em>Threat Pressure</em> score (alerts + shield + infra) which has its own column.
              </span>
            }>
              <span style={{ borderBottom: `1px dotted ${C.txT}`, cursor: "help" }}>Hardening</span>
            </Tooltip>,
            "Status",
            "Threat Trend",
          ]}
          rows={fleet.map(f => {
            const isDemo = (f as typeof f & {isDemo?:boolean}).isDemo;
            return [
            <span key="live" style={{ fontSize: 9, fontFamily: F.mono, fontWeight: 800, padding: "1px 5px", borderRadius: 3, background: isDemo ? `${C.txT}22` : `${C.brand}22`, color: isDemo ? C.txT : C.brand }}>{isDemo ? "DEMO" : "LIVE"}</span>,
            <span key="c" style={{ fontWeight: 600 }}>{f.client}</span>,
            <span key="r" style={{ color: C.txS }}>{f.region}</span>,
            <span key="v" style={{ color: C.txT }}>{f.ver}</span>,
            <span key="cpu"><Bar value={f.cpu} max={100} color={f.cpu > 70 ? C.danger : f.cpu > 50 ? C.orange : C.brand} h={4} /></span>,
            <span key="mem"><Bar value={f.mem} max={100} color={f.mem > 80 ? C.danger : f.mem > 60 ? C.orange : C.brand} h={4} /></span>,
            <span key="disk"><Bar value={f.disk} max={100} h={4} /></span>,
            <span key="th" style={{ color: f.threats > 0 ? C.danger : C.green, fontWeight: 700 }}>{f.threats}</span>,
            <span key="p95" style={{ color: f.p95 > 200 ? C.danger : C.txS }}>{f.p95}ms</span>,
            <span key="ag">{f.agents}</span>,
            <span key="cost" style={{ color: f.cost > 1000 ? C.warn : C.txS }}>${f.cost}</span>,
            <span key="pos" style={{ color: f.posture == null ? C.txT : f.posture > 90 ? C.green : f.posture > 75 ? C.warn : C.danger }}>{f.posture == null ? "—" : `${f.posture}%`}</span>,
            <Badge key="st" label={f.status} color={stColor(f.status)} />,
            <Spark key="sp" data={f.spark} color={f.status === "degraded" ? C.danger : f.status === "watching" ? C.warn : C.brand} />,
          ]})}
        />
        )}
      </Card>

      {!demoMode && fleet.length > 0 && <FleetLiveCards filters={filters} onNavigate={onNavigate} />}

      {/* Live top-correlation preview — shows the most recent active correlation
          so operators see an immediate signal on Fleet without waiting for the
          full Correlations panel to load (internal reviewer platform audit Priority 3.4). */}
      {!demoMode && <TopCorrelationsPreview onNavigate={onNavigate} />}

      {demoMode && (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <Card title="Top Correlations" accent={C.danger} glow={C.danger}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Badge label="CRITICAL" color={C.danger} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Coordinated Attack Chain -- sol-006</span>
          </div>
          <div style={{ fontSize: 13, color: C.txS, marginBottom: 8 }}>Brute force + C2S exploitation + resource exfiltration.</div>
          <span style={{ fontSize: 13, color: C.brand, cursor: "pointer" }}>Full analysis {"\u2192"}</span>
        </Card>

        <Card title="Token Burn Alerts" accent={C.warn} glow={C.warn}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Badge label="pentest-agent" color={C.txS} />
            <TokenRateBadge rate="RUNAWAY" />
          </div>
          <div style={{ fontSize: 13, color: C.txS, marginBottom: 6 }}>$2,847/hr — 10x baseline</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Badge label="code-review-bot" color={C.txS} />
            <TokenRateBadge rate="ELEVATED" />
          </div>
          <span style={{ fontSize: 13, color: C.brand, cursor: "pointer" }}>Token Intelligence {"\u2192"}</span>
        </Card>

        <Card title="Prompt Shield" accent={C.cyan} glow={C.cyan}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: C.txS }}>Threats blocked in last 24h:</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: C.danger, fontFamily: F.mono }}>47</span>
            <Badge label="BLOCKED" color={C.danger} />
          </div>
          <div style={{ fontSize: 13, color: C.txS, marginBottom: 8 }}>163 built-in detections, 10 categories (+ operator-authored custom rules)</div>
          <span style={{ fontSize: 13, color: C.brand, cursor: "pointer" }}>Open Prompt Shield {"\u2192"}</span>
        </Card>
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TopCorrelationsPreview — live top-correlation card shown on Fleet Command
// so the operator sees the highest-signal correlation without needing to
// open the full Correlations panel. Resilient: if fetch fails, renders
// nothing. Follows the dashboard's standard refresh/stale language.
// ---------------------------------------------------------------------------

interface TopCorrelationRow {
  id: string;
  correlation_rule: string;
  description: string;
  severity: string;
  created_at: string;
  event_count?: number;
  source_events_parsed?: Array<{ type: string; source: string }>;
}

function TopCorrelationsPreview({ onNavigate }: { onNavigate: (tab: TabId) => void }) {
  const [rows, setRows] = useState<TopCorrelationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/correlations?limit=2");
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setRows(Array.isArray(data.correlations) ? data.correlations : []);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Network error");
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Hide on error or empty — don't add noise when there's nothing to say.
  if (error || rows === null || rows.length === 0) return null;

  const severityColor = (s: string) => {
    const up = s.toUpperCase();
    return up === "CRITICAL" ? C.danger : up === "HIGH" ? C.orange : up === "MEDIUM" ? C.warn : C.info;
  };

  return (
    <Card
      title="Top Correlations"
      accent={severityColor(rows[0].severity)}
      actions={
        <button
          onClick={() => onNavigate("correlations")}
          style={{
            padding: "3px 10px",
            background: `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`,
            border: 0,
            borderRadius: 10,
            color: "#06121f",
            fontSize: 11,
            fontWeight: 850,
            fontFamily: F.mono,
            cursor: "pointer",
            letterSpacing: "0.05em",
            textTransform: "uppercase" as const,
          }}
        >
          OPEN PANEL →
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.slice(0, 2).map(r => {
          const color = severityColor(r.severity);
          return (
            <div
              key={r.id}
              onClick={() => onNavigate("correlations")}
              style={{
                cursor: "pointer",
                padding: "10px 12px",
                background: C.glassSurfTrans,
                border: `1px solid ${C.glassSurfBorder}`,
                borderLeft: `3px solid ${color}`,
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <Badge label={r.severity.toUpperCase()} color={color} />
                <span style={{ fontSize: 13, fontWeight: 700, color: C.tx }}>{r.correlation_rule}</span>
                <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono, marginLeft: "auto" }}>
                  {new Date(r.created_at.replace(" ", "T") + "Z").toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>{r.description}</div>
              {Array.isArray(r.source_events_parsed) && r.source_events_parsed.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {r.source_events_parsed.slice(0, 3).map((ev, i) => (
                    <span key={i} style={{
                      fontSize: 10,
                      fontFamily: F.mono,
                      padding: "1px 6px",
                      background: `rgba(34,211,238,0.22)`,
                      border: `1px solid rgba(34,211,238,0.55)`,
                      borderRadius: 999,
                      color: C.info,
                    }}>{ev.source}: {ev.type}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Welcome Wizard (fresh install setup checklist)
// ---------------------------------------------------------------------------

interface WizardStep {
  key: string;
  label: string;
  description: string;
  /** Real completion (not skipped). Drives the green checkmark. */
  realDone: boolean;
  /** True when operator explicitly skipped this step. Counts toward completion but renders amber. */
  isSkipped?: boolean;
  /** If false, the step can't be skipped (e.g. Install ClawNex is auto-ticked on start). */
  skippable?: boolean;
  action?: { label: string; run: () => void };
  secondary?: { label: string; run: () => void };
}

function WelcomeWizard({ onNavigate, onReload, allComplete, onAllCompleteChange }: { onNavigate: (tab: TabId, focus?: string) => void; onReload?: () => void; allComplete?: boolean; onAllCompleteChange?: (v: boolean) => void }) {
  const [providerCount, setProviderCount] = useState<number | null>(null);
  // Quick Setup Card state — surfaces a four-state view of OpenClaw so the
  // wizard's "Add a provider" step can present different copy for each:
  //   connected      → ✓ OpenClaw is a working AI source, step done
  //   auth-failing   → OpenClaw running but token wrong, suggest fix or alt
  //   stopped        → ~/.openclaw/ exists but daemon not running, start hint
  //   absent         → no OpenClaw at all, show Ollama / LMStudio install hints
  // Server tells us the host OS so the install commands are OS-correct.
  const [openclawState, setOpenclawState] = useState<"connected" | "auth-failing" | "stopped" | "absent" | null>(null);
  const [hostOs, setHostOs] = useState<"macos" | "linux" | "other">("other");
  const [routingConfigured, setRoutingConfigured] = useState<boolean>(false);
  const [wiringRouting, setWiringRouting] = useState<boolean>(false);
  // Surfaces whatever the wire+restart sequence reported, so the
  // wizard step description shows the actual outcome instead of the
  // generic blurb after the operator clicks. Cleared when the operator
  // reloads the wizard or moves past the step.
  const [routingMessage, setRoutingMessage] = useState<string | null>(null);
  const [cveSynced, setCveSynced] = useState<boolean>(false);
  const [hostSecurityInstalled, setHostSecurityInstalled] = useState<boolean>(false);
  const [shieldTested, setShieldTested] = useState<boolean>(false);
  const [pricingSynced, setPricingSynced] = useState<boolean>(false);
  const [pricingSyncMessage, setPricingSyncMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncingPricing, setSyncingPricing] = useState<boolean>(false);
  const [verifyingHostSecurity, setVerifyingHostSecurity] = useState<boolean>(false);
  const [installError, setInstallError] = useState<string | null>(null);
  // Skip flags, loaded from config_defaults.wizard_skip_<key>. Skipping is persistent
  // so the operator can dismiss the wizard even when a step can't complete organically
  // (e.g. mixed routed/direct providers where the direct ones are OAuth-based).
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  // Tracks whether each Access & Identity card's underlying config has
  // already been done so we can render a "configured" badge inline.
  // Refetched whenever refreshStatus runs (mount + after each in-wizard
  // action) so finishing a step in another tab flips the badge here too.
  // Each fetch falls back to `false` on any error — better to under-claim
  // than to mark something configured that isn't.
  // RBAC is the foundation card in the Access & Identity row — when off,
  // the dependent cards (Mail+Magic Link, GitHub OAuth) are visually
  // locked because there's no operator concept to attach those providers
  // to. Tracked separately from accessConfigured because the badge text +
  // CTA differ ("RBAC OFF / re-run setup.sh" vs "CONFIGURED / manage
  // operators").
  const [rbacEnabled, setRbacEnabled] = useState<boolean>(false);
  const [accessConfigured, setAccessConfigured] = useState<{ https: boolean; mailMagic: boolean; github: boolean }>({ https: false, mailMagic: false, github: false });

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/config/providers");
      if (res.ok) {
        const data = await res.json();
        const nonOpenclaw = (data.providers || []).filter((p: { type: string }) => p.type !== "openclaw");
        setProviderCount(nonOpenclaw.length);
      } else {
        setProviderCount(0);
      }
    } catch { setProviderCount(0); }

    // Quick Setup Card — combined OpenClaw + filesystem detection
    try {
      const res = await fetch("/api/setup/openclaw-state");
      if (res.ok) {
        const data = await res.json();
        setOpenclawState(data.state || "absent");
        setHostOs(data.os || "other");
      } else {
        setOpenclawState("absent");
      }
    } catch { setOpenclawState("absent"); }

    try {
      const res = await fetch("/api/openclaw/routing");
      if (res.ok) {
        const data = await res.json();
        // Wizard "routing done" semantic (internal reviewer M-01 follow-up 2026-04-29):
        // The step is satisfied once ClawNex has wired the LiteLLM
        // bridge. Earlier we required "all providers routed", which
        // never went green for any operator with even one OAuth-only
        // provider (Claude.ai, ChatGPT Pro, Gemini) -- those genuinely
        // can't be proxied. The operator-policy view (mix of ROUTED
        // and DIRECT) lives in the Configuration card; the wizard
        // step's narrower job is "did ClawNex install its bridge?",
        // which the sidecar answers definitively.
        const sidecar = data?.managed?.sidecar;
        const litellmEntry = (data.providers || []).find((p: { id: string }) => p.id === 'litellm');
        setRoutingConfigured(Boolean(sidecar && litellmEntry));
      }
    } catch { /* silent */ }

    try {
      const res = await fetch("/api/cve");
      if (res.ok) {
        const data = await res.json();
        setCveSynced(Boolean(data.lastSync) || (data.total || 0) > 0);
      }
    } catch { /* silent */ }

    try {
      const res = await fetch("/api/config/updates");
      if (res.ok) {
        const data = await res.json();
        setHostSecurityInstalled(Boolean(data.clawkeeper && data.clawkeeper.installedVersion && data.clawkeeper.installedVersion !== "not installed"));
      }
    } catch { /* silent */ }

    try {
      // Phase 2a-fix follow-up: this is the wizard's own per-step
      // shieldTested signal (separate state from the parent's hasScans).
      // Same opt-in is required here — production-default stats exclude
      // origin=shield-test scans, so without includeTestGenerated=true
      // running the Shield Tests panel never flips this step green.
      // operator caught the regression after the first fix patched only
      // hasScans (internal reviewer QA review 2026-04-29).
      const res = await fetch("/api/shield/stats?includeTestGenerated=true");
      if (res.ok) {
        const data = await res.json();
        setShieldTested((data.total || 0) > 0);
      }
    } catch { /* silent */ }

    try {
      const res = await fetch("/api/config/model-pricing");
      if (res.ok) {
        const data = await res.json();
        // Step is done only when the operator has actually synced — auto-seed
        // populates rows without flipping this flag.
        setPricingSynced(Boolean(data.everSynced));
      }
    } catch { /* silent */ }

    try {
      const res = await fetch("/api/config/defaults");
      if (res.ok) {
        const data = await res.json();
        const s = data?.settings || {};
        const isSkip = (v: string | undefined) => v === "1" || v === "true";
        setSkipped({
          provider: isSkip(s.wizard_skip_provider),
          clawkeeper: isSkip(s.wizard_skip_clawkeeper),
          cve: isSkip(s.wizard_skip_cve),
          routing: isSkip(s.wizard_skip_routing),
          shield: isSkip(s.wizard_skip_shield),
          pricing: isSkip(s.wizard_skip_pricing),
        });
      }
    } catch { /* silent */ }

    // Access & Identity card "configured" badges — independent fetches so a
    // mail / auth-methods / https / auth-status endpoint failure doesn't
    // cascade and hide the existing wizard steps above. Each falls back to
    // false on error.
    try {
      const [mailRes, authRes, httpsRes, authStatusRes] = await Promise.all([
        fetch("/api/config/mail").then(r => r.ok ? r.json() : null).catch(() => null),
        fetch("/api/config/auth-methods").then(r => r.ok ? r.json() : null).catch(() => null),
        fetch("/api/system/https").then(r => r.ok ? r.json() : null).catch(() => null),
        fetch("/api/auth/status").then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      // RBAC bake reads from the public-facing /api/auth/status — same value
      // the middleware uses, so we never claim a state different from what
      // the gate enforces.
      setRbacEnabled(!!authStatusRes?.rbacEnabled);
      const httpsConfigured = !!(httpsRes?.httpsEnabled || (typeof window !== "undefined" && window.location.protocol === "https:"));
      // "Email & Magic Link" pair: mark configured ONLY when both halves are
      // wired up (mail provider set AND Magic Link toggle on). Marking on the
      // mail half alone would mislead the operator into thinking sign-in via
      // Magic Link is live when it's not.
      const mailMagicConfigured = !!(mailRes?.provider && mailRes.provider !== "none" && authRes?.magicLink?.enabled);
      const githubConfigured = !!(authRes?.github?.enabled && authRes?.github?.clientId);
      setAccessConfigured({ https: httpsConfigured, mailMagic: mailMagicConfigured, github: githubConfigured });
    } catch { /* silent — fall back to all-false from initial state */ }
  }, []);

  // Persist a skip flag (on/off) for a given step key and trigger a reload so the parent re-evaluates allDone.
  const toggleSkip = useCallback(async (stepKey: string, next: boolean) => {
    try {
      await fetch("/api/config/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `wizard_skip_${stepKey}`, value: next ? "1" : "" }),
      });
      setSkipped(prev => ({ ...prev, [stepKey]: next }));
      onReload?.();
    } catch { /* silent */ }
  }, [onReload]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const syncCve = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/cve/sync", { method: "POST" });
      if (res.ok) {
        setCveSynced(true);
        onReload?.();
      }
    } catch { /* silent */ } finally { setSyncing(false); }
  };

  // Wizard step 5 -- wire LiteLLM routing into openclaw.json AND restart
  // the gateway daemon in one click. Honest telemetry: separate states
  // for the wire result and the restart result so we can surface a
  // sensible message either way (wired-but-restart-failed is a real
  // outcome on hosts where the supervisor isn't auto-detected).
  const wireRoutingFromWizard = async () => {
    setWiringRouting(true);
    setRoutingMessage("Wiring LiteLLM into openclaw.json...");
    try {
      const wireRes = await fetch("/api/openclaw/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "wire" }),
      });
      const wireData = await wireRes.json().catch(() => ({}));
      if (!wireRes.ok || !wireData.ok) {
        const detail = wireData.detail || wireData.error || "Wire failed.";
        setRoutingMessage(`Wire failed: ${detail} Open Configuration -> OpenClaw Routing for details.`);
        setWiringRouting(false);
        return;
      }
      // Wire succeeded. If restart isn't required (idempotent already-
      // wired path), we're done. Otherwise restart now so the operator
      // doesn't have to jump to SSH.
      if (!wireData.restartRequired) {
        setRoutingMessage(`Already wired: ${wireData.detail}`);
        await refreshStatus();
        setWiringRouting(false);
        return;
      }
      setRoutingMessage("Wired. Restarting openclaw-gateway...");
      const restartRes = await fetch("/api/openclaw/gateway/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const restartData = await restartRes.json().catch(() => ({}));
      if (restartRes.ok && restartData.ok) {
        setRoutingMessage(`Wired and restarted via ${restartData.supervisor} in ${restartData.elapsedMs ?? "?"}ms. New routing is active.`);
      } else if (restartData.status === "unsupported") {
        setRoutingMessage(`Wired. Auto-restart unsupported on this host -- run manually: ${restartData.manualCommand ?? "see Configuration -> OpenClaw Routing"}.`);
      } else {
        setRoutingMessage(`Wired but restart failed: ${restartData.detail ?? restartData.error ?? "unknown error"}. Run manually: ${restartData.manualCommand ?? "see Configuration -> OpenClaw Routing"}.`);
      }
      await refreshStatus();
    } catch (err) {
      setRoutingMessage(`Wire/restart errored: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWiringRouting(false);
    }
  };

  const syncPricing = async () => {
    setSyncingPricing(true);
    setPricingSyncMessage(null);
    try {
      const res = await fetch("/api/config/model-pricing/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setPricingSynced(true);
        const count = data.result?.totalModels ?? 0;
        const tag = data.result?.tag ?? "";
        setPricingSyncMessage(`Synced ${count} models from ${tag}`);
        setTimeout(() => setPricingSyncMessage(null), 5000);
        onReload?.();
      } else {
        setPricingSyncMessage(data.error || "Sync failed");
        setTimeout(() => setPricingSyncMessage(null), 6000);
      }
    } catch (err) {
      setPricingSyncMessage(err instanceof Error ? err.message : "Sync failed");
      setTimeout(() => setPricingSyncMessage(null), 6000);
    } finally {
      setSyncingPricing(false);
    }
  };

  const verifyHostSecurity = async () => {
    setVerifyingHostSecurity(true);
    setInstallError(null);
    try {
      const res = await fetch("/api/system/install-clawkeeper", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false) {
        setHostSecurityInstalled(true);
        await refreshStatus();
        onReload?.();
      } else {
        setInstallError(data.error || "Scanner check failed. Try opening Configuration \u2192 Updates.");
      }
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : "Scanner check failed");
    } finally {
      setVerifyingHostSecurity(false);
    }
  };

  // Steps should be completed in order. Shield test is intentionally LAST so the
  // wizard keeps appearing on refresh until every prior step is done.
  const steps: WizardStep[] = [
    {
      key: "install",
      label: "Install ClawNex",
      description: "ClawNex dashboard is running.",
      realDone: true,
      skippable: false,
    },
    {
      key: "provider",
      label: "Add an AI model provider",
      // Description varies based on the Quick Setup Card detection. OpenClaw,
      // when authenticated, satisfies this step on its own. When OpenClaw is
      // present but broken (auth-failing or stopped), surface that state so
      // the operator knows whether to fix it or fall back to a direct provider.
      // When OpenClaw is absent, suggest Ollama or LM Studio with OS-correct
      // install commands. The "I've installed it, check again" affordance is
      // already wired — it's the wizard's existing reload tick.
      description: (() => {
        const hasProvider = (providerCount ?? 0) > 0;
        // Once a provider is configured we revert to the original copy — the
        // operator's past the bootstrap moment and the QSC has done its job.
        if (hasProvider) {
          return "Register at least one model provider (Anthropic, OpenAI, local LM Studio, etc).";
        }
        const ollamaCmd = hostOs === "macos"
          ? "brew install ollama && ollama pull llama3.2:3b"
          : "curl -fsSL https://ollama.com/install.sh | sh && ollama pull llama3.2:3b";
        switch (openclawState) {
          case "connected":
            return "OpenClaw is connected and can route AI for ClawNex. We still recommend adding a direct model provider (Anthropic, OpenAI, OpenRouter, LM Studio, etc.) so the dashboard's own AI features have a fallback and you can do specialized routing.";
          case "auth-failing":
            return "⚠ OpenClaw is running but the gateway handshake is failing — the token in OPENCLAW_GATEWAY_TOKEN may be wrong. Fix that to use OpenClaw, or add a direct model provider as a fallback.";
          case "stopped":
            return "OpenClaw is installed on this host but isn't running. Start the OpenClaw gateway, or add a direct model provider in the meantime.";
          case "absent":
          default:
            return [
              "ClawNex's AI features need a model provider. For local AI without external API keys, install one of:",
              "",
              `  • Ollama:    ${ollamaCmd}`,
              "  • LM Studio: download from https://lmstudio.ai (GUI app)",
              "",
              "We test against Llama 3.2 3B (~2 GB, runs on most laptops). After installing, click 'Open Configuration' to add the provider, or refresh the page so this card re-detects.",
            ].join("\n");
        }
      })(),
      // 2026-05-09: realDone now requires a real (non-openclaw) provider OR
      // an explicit skip. OpenClaw being connected used to auto-complete this
      // step which meant fresh installs with `~/.openclaw/openclaw.json`
      // already in place (which deploy-prod.sh explicitly preserves) never
      // prompted the operator to add a real provider during setup. Operators
      // who genuinely run OpenClaw-only can hit the existing skip mechanism.
      realDone: (providerCount ?? 0) > 0,
      isSkipped: skipped.provider,
      skippable: true,
      action: { label: "Open Configuration", run: () => onNavigate("configuration", "modelProviders") },
    },
    {
      key: "clawkeeper",
      label: "Enable Host Security",
      description: "ClawNex Host Security runs host-level audits from the bundled scanner and powers the Security Posture panel.",
      realDone: hostSecurityInstalled,
      isSkipped: skipped.clawkeeper,
      skippable: true,
      action: { label: verifyingHostSecurity ? "Checking..." : "Verify Now", run: verifyHostSecurity },
      secondary: { label: "Open Updates panel", run: () => onNavigate("configuration", "updates") },
    },
    {
      key: "cve",
      label: "Sync CVE database",
      description: "Download the latest CVE intel feed so threat correlation can match known vulnerabilities.",
      realDone: cveSynced,
      isSkipped: skipped.cve,
      skippable: true,
      action: { label: syncing ? "Syncing..." : "Sync Now", run: syncCve },
    },
    {
      key: "pricing",
      label: "Sync model pricing",
      description: "Pull the latest LLM cost rates from LiteLLM's GitHub at the pinned version. Powers the dollar figures in the Token & Cost Intel panel. ClawNex ships with a bundled snapshot, but refreshing keeps you current on new models. You can also schedule auto-sync later in Configuration → Updates.",
      realDone: pricingSynced,
      isSkipped: skipped.pricing,
      skippable: true,
      action: { label: syncingPricing ? "Syncing..." : "Sync Now", run: syncPricing },
      secondary: { label: "Open Pricing settings", run: () => onNavigate("configuration", "updates") },
    },
    {
      key: "routing",
      label: "Configure OpenClaw routing",
      description: routingMessage ?? "Wire OpenClaw to route LLM traffic through the ClawNex LiteLLM proxy at 127.0.0.1:4001/v1 so the Prompt Shield can scan every request in real time. ClawNex tracks ownership in a sidecar so this can be cleanly reverted later. After wiring, the openclaw-gateway daemon is restarted automatically so the new routing takes effect immediately. OAuth-only providers (Claude.ai, ChatGPT Pro, Gemini) can't be proxied -- skip this step if your fleet is OAuth-only.",
      realDone: routingConfigured,
      isSkipped: skipped.routing,
      skippable: true,
      action: {
        label: wiringRouting ? "Wiring + Restarting..." : (routingConfigured ? "Open Configuration" : "Wire LiteLLM"),
        run: routingConfigured ? () => onNavigate("configuration", "openclawRouting") : wireRoutingFromWizard,
      },
      secondary: routingConfigured ? undefined : { label: "Open Configuration", run: () => onNavigate("configuration", "openclawRouting") },
    },
    {
      key: "shield",
      label: "Run first shield test",
      description: "Fire a prompt-shield test to verify detection rules are active. Complete the steps above first.",
      realDone: shieldTested,
      isSkipped: skipped.shield,
      skippable: true,
      action: { label: "Open Shield Tests", run: () => onNavigate("shieldTests") },
    },
  ];

  const isStepDone = (s: WizardStep) => s.realDone || Boolean(s.isSkipped);
  const doneCount = steps.filter(isStepDone).length;
  const skippedCount = steps.filter(s => !s.realDone && s.isSkipped).length;
  // Bubble the wizard's own view of all-complete up to the parent so the
  // "Setup not complete" banner in FleetCommandPanel reads from the same
  // signal that paints each step's ✓. Without this, the parent runs a
  // duplicate computation that can drift out of sync (caught 2026-05-15:
  // wizard rendered 7/7 ✓ while parent banner still said incomplete).
  const wizardSaysAllComplete = doneCount === steps.length && steps.length > 0;
  useEffect(() => {
    onAllCompleteChange?.(wizardSaysAllComplete);
  }, [wizardSaysAllComplete, onAllCompleteChange]);
  const [dismissing, setDismissing] = useState(false);

  const dismissWizard = async () => {
    setDismissing(true);
    try {
      await fetch("/api/config/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "wizard_dismissed", value: "1" }),
      });
      // operator-flagged 2026-05-07: route operators to Mission Control on
      // wizard completion, not Fleet Command. Mission Control is the
      // operator cockpit; once setup is done that's where the live data
      // surfaces. Fleet Command remains accessible from the sidebar for
      // anyone who needs the per-instance view.
      onNavigate("missionControl");
      // Background reload of the parent fleet card so when the operator
      // navigates back later, the dismissed state is reflected without
      // an extra round-trip. Non-blocking — we've already left the page.
      onReload?.();
    } catch {} finally {
      setDismissing(false);
    }
  };

  return (
    <div>
      <Card title={allComplete ? "Setup Complete" : "Welcome to ClawNex"} accent={allComplete ? C.green : C.brand}>
        <div style={{ padding: "8px 0" }}>
          {allComplete ? (
            <div style={{
              padding: "14px 16px",
              marginBottom: 16,
              background: `${C.green}0c`,
              border: `1px solid ${C.green}44`,
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.green, marginBottom: 4 }}>
                {"\u2713"} You&apos;re all set!
              </div>
              <p style={{ fontSize: 13, color: C.txS, margin: 0, lineHeight: 1.6 }}>
                Every setup step is complete. ClawNex is ready to scan traffic and monitor your fleet.
                Click <strong>Get Started</strong> to jump to Mission Control — your live operator cockpit.
                <br />
                <span style={{ fontSize: 12, color: C.txT }}>
                  New in v0.5.4: hover any stat tile or column header for contextual help. Look for the dotted cyan underline or the small corner pip. The <strong>TIPS</strong> button in the header toggles the whole tooltip system on or off.
                </span>
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 14, color: C.txS, marginBottom: 8, lineHeight: 1.6 }}>
              Welcome. Work through the checklist below to get your environment ready for traffic scanning and fleet monitoring.
            </p>
          )}
          <div style={{ fontSize: 12, color: C.txT, marginBottom: 18, fontFamily: F.mono }}>
            Progress: {doneCount} / {steps.length} steps complete{skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {steps.map((step, i) => {
              const done = isStepDone(step);
              // Step is "visually skipped" only when the operator skipped AND the real check hasn't
              // organically caught up. Once the real check passes, we show the green state regardless.
              const visualSkipped = !step.realDone && Boolean(step.isSkipped);
              const accent = step.realDone ? C.green : visualSkipped ? C.warn : C.txT;
              const bg = step.realDone ? `${C.green}14` : visualSkipped ? `${C.warn}14` : C.glassSurfTrans;
              const borderCol = step.realDone ? C.green + "55" : visualSkipped ? C.warn + "55" : C.glassSurfBorder;
              return (
                <div key={step.key} style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "12px 14px",
                  background: bg,
                  border: `1px solid ${borderCol}`,
                  borderRadius: 8,
                }}>
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: `2px solid ${accent}`,
                    background: done ? accent : "transparent",
                    color: done ? C.bg : accent,
                    fontSize: 11,
                    fontWeight: 800,
                    flexShrink: 0,
                    marginTop: 1,
                  }}>
                    {step.realDone ? "\u2713" : visualSkipped ? "\u2013" : i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.tx }}>{step.label}</div>
                      {visualSkipped && (
                        <span style={{
                          fontSize: 9,
                          fontFamily: F.mono,
                          fontWeight: 800,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: `${C.warn}22`,
                          color: C.warn,
                        }}>Skipped</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: C.txS, marginBottom: (step.action && !done) || visualSkipped ? 8 : 0, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                      {step.description}
                    </div>
                    {step.action && !done && (
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                        <button onClick={step.action.run} style={{
                          padding: "6px 14px",
                          background: `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`,
                          color: "#06121f",
                          border: 0,
                          borderRadius: 10,
                          fontSize: 12,
                          fontWeight: 850,
                          cursor: "pointer",
                          textTransform: "uppercase" as const,
                          letterSpacing: "0.04em",
                        }}>{step.action.label}</button>
                        {step.secondary && (
                          <button onClick={step.secondary.run} style={{
                            padding: "5px 10px",
                            background: "transparent",
                            color: C.txS,
                            border: `1px solid ${C.brd}`,
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}>{step.secondary.label}</button>
                        )}
                        {step.skippable && (
                          <button onClick={() => toggleSkip(step.key, true)} style={{
                            padding: "5px 10px",
                            background: "transparent",
                            color: C.txT,
                            border: `1px dashed ${C.brd}`,
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}>Skip for now</button>
                        )}
                      </div>
                    )}
                    {visualSkipped && (
                      <button onClick={() => toggleSkip(step.key, false)} style={{
                        marginTop: 4,
                        padding: "4px 10px",
                        background: "transparent",
                        color: C.warn,
                        border: `1px solid ${C.warn}44`,
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}>Undo skip</button>
                    )}
                    {step.key === "clawkeeper" && installError && (
                      <div style={{ marginTop: 6, fontSize: 11, color: C.danger, fontFamily: F.mono }}>{installError}</div>
                    )}
                    {step.key === "pricing" && pricingSyncMessage && (
                      <div style={{
                        marginTop: 6, fontSize: 11, fontFamily: F.mono,
                        color: pricingSyncMessage.includes("fail") || pricingSyncMessage.includes("error") ? C.danger : C.green,
                      }}>{pricingSyncMessage}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {allComplete && (
            <>
              {/* Optional enhancements — shown ONLY on the Setup Complete screen,
                  above the Get Started button. Security wizard is already complete
                  at this point; these are nice-to-have features that don't affect
                  posture or detection. Each card deep-links into the corresponding
                  Configuration card via navigate-with-focus. */}
              <div style={{ marginTop: 24 }}>
                <div style={{
                  fontSize: 11,
                  fontFamily: F.mono,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: C.txT,
                  marginBottom: 10,
                  paddingBottom: 8,
                  borderBottom: `1px solid ${C.brd}`,
                }}>
                  Next Steps to Explore (optional)
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 10,
                }}>
                  {[
                    {
                      key: "voiceAvatar",
                      label: "Voice & Avatar",
                      desc: "Add ElevenLabs and HeyGen API keys for voice narration and a talking avatar in the AI Chat panel.",
                      focus: "voiceAvatar",
                      accent: C.cyan,
                    },
                    {
                      key: "displayName",
                      label: "Display Name",
                      desc: "Override the hostname shown in Fleet Command with a friendly label for your instance.",
                      focus: "uiPreferences",
                      accent: C.info,
                    },
                    {
                      key: "apiKeys",
                      label: "API Keys",
                      desc: "Generate versioned API keys so external systems can query ClawNex shield, alerts, and audit data.",
                      focus: "apiKeys",
                      accent: C.purp,
                    },
                    {
                      key: "modules",
                      label: "Module Toggles",
                      desc: "Hide dashboard tabs you don't need (e.g. disable Workspace if you're not using it) to focus the sidebar.",
                      focus: "modules",
                      accent: C.warn,
                    },
                  ].map(card => (
                    <div
                      key={card.key}
                      onClick={() => onNavigate("configuration", card.focus)}
                      style={{
                        padding: "12px 14px",
                        background: C.glassSurfTrans,
                        border: `1px solid ${C.glassSurfBorder}`,
                        borderLeft: `3px solid ${card.accent}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        transition: "background 0.15s ease, border-color 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = `${card.accent}18`;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = C.glassSurfTrans;
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.tx, marginBottom: 4 }}>{card.label}</div>
                      <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5 }}>{card.desc}</div>
                      <div style={{
                        marginTop: 8,
                        fontSize: 10,
                        fontFamily: F.mono,
                        fontWeight: 700,
                        color: card.accent,
                        letterSpacing: "0.05em",
                      }}>Open Configuration {"\u2192"}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Access & Identity row — separates "make the platform work"
                  from "harden how people sign in." Order matters:
                    1. HTTPS / TLS first — passkey + GitHub OAuth refuse to
                       work over plain HTTP for non-localhost domains.
                    2. Mail + Magic Link — pair them because Magic Link is
                       gated on a configured mail provider.
                    3. GitHub OAuth — depends on HTTPS being live (GitHub
                       only allows http:// callbacks for localhost).
                  Passkeys are intentionally NOT in the wizard — they're
                  per-operator, enrolled from Auth & Devices on the operator's
                  own session, not a setup-once admin task. */}
              <div style={{ marginTop: 24 }}>
                <div style={{
                  fontSize: 11,
                  fontFamily: F.mono,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: C.txT,
                  marginBottom: 10,
                  paddingBottom: 8,
                  borderBottom: `1px solid ${C.brd}`,
                }}>
                  Access &amp; Identity (optional)
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 10,
                }}>
                  {/* Card array — RBAC is FIRST because it's the foundation:
                      Mail+Magic and GitHub OAuth need an operator concept,
                      which only exists when RBAC is on. HTTPS doesn't need
                      RBAC (TLS protects the connection regardless), so it's
                      always actionable. The locked={...} flag greys out
                      RBAC-dependent cards when RBAC is off and turns the
                      click into a no-op so we don't navigate the operator
                      to a card whose UI won't function. */}
                  {([
                    {
                      key: "rbac" as const,
                      label: "Multi-Operator Access (RBAC)",
                      desc: rbacEnabled
                        ? "Multi-operator mode is on. Add or manage operators in Operator Management; passkeys + GitHub + Magic Link below all attach to those operators."
                        : "RBAC is off — single-user localhost mode. To enable multi-operator access, re-run setup.sh and pick Public-facing mode (option 2). Doing it later is fine; existing local data is preserved.",
                      // When RBAC is on, deep-link to Operator Management so
                      // the admin can immediately add more operators. When
                      // off, link to the System card where the topology hint
                      // lives — they'll need to re-run setup.sh from CLI.
                      focus: rbacEnabled ? "operatorManagement" : "uiPreferences",
                      accent: C.purp,
                      configured: rbacEnabled,
                      locked: false,
                    },
                    {
                      key: "httpsTls" as const,
                      label: "HTTPS / TLS",
                      desc: "Foundational for prod. Passkeys + GitHub OAuth refuse to work over plain HTTP for non-localhost domains. Caddy handles auto-TLS via Let's Encrypt — set up first if you plan to enable either below.",
                      focus: "https",
                      accent: "#38bdf8",
                      configured: accessConfigured.https,
                      locked: false,
                    },
                    {
                      key: "mailMagic" as const,
                      label: "Email & Magic Link",
                      desc: "Configure Resend / SMTP / Emailit, then enable Magic Link sign-in. Operators with an email on file can request a one-shot link instead of a password. Independent of HTTPS — works on localhost too.",
                      focus: "mailConfig",
                      accent: C.info,
                      configured: accessConfigured.mailMagic,
                      locked: !rbacEnabled,
                    },
                    {
                      key: "githubOAuth" as const,
                      label: "GitHub OAuth",
                      desc: (
                        <>
                          Sign in with GitHub identity. Requires HTTPS first for non-localhost domains (GitHub rejects plain-HTTP callbacks for public apps). Register an OAuth app at{" "}
                          {/* stopPropagation so the link click doesn't also
                              trigger the parent card's onNavigate (which would
                              swap to the Configuration tab and lose the new
                              window the operator was about to open). */}
                          <a
                            href="https://github.com/settings/developers"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: C.brand, textDecoration: "underline", fontWeight: 700 }}
                          >github.com/settings/developers</a>
                          , then paste Client ID + Secret.
                        </>
                      ),
                      focus: "authMethods",
                      accent: C.brand,
                      configured: accessConfigured.github,
                      locked: !rbacEnabled,
                    },
                  ]).map(card => (
                    <div
                      key={card.key}
                      onClick={() => { if (!card.locked) onNavigate("configuration", card.focus); }}
                      title={card.locked ? "Locked — enable Multi-Operator Access (RBAC) first" : undefined}
                      style={{
                        padding: "12px 14px",
                        background: C.glassSurfTrans,
                        border: `1px solid ${C.glassSurfBorder}`,
                        borderLeft: `3px solid ${card.locked ? C.txT : card.accent}`,
                        borderRadius: 8,
                        cursor: card.locked ? "not-allowed" : "pointer",
                        opacity: card.locked ? 0.45 : 1,
                        transition: "background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (card.locked) return;
                        (e.currentTarget as HTMLDivElement).style.background = `${card.accent}18`;
                      }}
                      onMouseLeave={(e) => {
                        if (card.locked) return;
                        (e.currentTarget as HTMLDivElement).style.background = C.glassSurfTrans;
                      }}
                    >
                      {/* Title + status pill. Three possible pill states:
                            CONFIGURED (green) — config is saved
                            RBAC REQUIRED (amber) — card is locked behind RBAC
                            (no pill) — actionable but not yet configured
                          Pulled from /api/auth/status + /api/config/mail +
                          /api/config/auth-methods + /api/system/https. */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: card.locked ? C.txT : C.tx }}>{card.label}</div>
                        {card.locked ? (
                          <span style={{
                            fontSize: 9,
                            fontFamily: F.mono,
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            color: C.warn,
                            background: `${C.warn}18`,
                            border: `1px solid ${C.warn}55`,
                            borderRadius: 3,
                            padding: "2px 6px",
                            whiteSpace: "nowrap",
                          }} title="This card needs Multi-Operator Access (RBAC) on first.">RBAC REQUIRED</span>
                        ) : card.configured ? (
                          <span style={{
                            fontSize: 9,
                            fontFamily: F.mono,
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            color: C.green,
                            background: `${C.green}18`,
                            border: `1px solid ${C.green}55`,
                            borderRadius: 3,
                            padding: "2px 6px",
                            whiteSpace: "nowrap",
                          }} title="This card&rsquo;s configuration is already saved. Click to review or change.">CONFIGURED</span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5 }}>{card.desc}</div>
                      <div style={{
                        marginTop: 8,
                        fontSize: 10,
                        fontFamily: F.mono,
                        fontWeight: 700,
                        color: card.locked ? C.txT : card.accent,
                        letterSpacing: "0.05em",
                      }}>{card.locked ? "Locked — RBAC required" : `Open Configuration ${"→"}`}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
                <button onClick={dismissWizard} disabled={dismissing} style={{
                  padding: "10px 28px",
                  background: dismissing ? `${C.green}22` : `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`,
                  color: dismissing ? C.green : "#06121f",
                  border: 0,
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 850,
                  letterSpacing: "0.04em",
                  cursor: dismissing ? "wait" : "pointer",
                  boxShadow: C.glassCardShadow,
                  textTransform: "uppercase" as const,
                }}>{dismissing ? "Saving..." : "Get Started \u2192"}</button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
