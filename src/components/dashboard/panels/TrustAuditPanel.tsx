"use client";
import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { C, F } from "../constants";
import {
  PanelStateBar,
  PanelEmptyState,
  PanelErrorState,
  PanelDisconnected,
  PaginationFooter,
  formatTimeAgo,
  isStale,
  type PanelDataState,
} from "../shared";
import {
  AcceptRiskButton,
  SuppressedFindingCard,
  AcceptedRisksSection,
} from "../risk-acceptance/AcceptRiskWidget";
// v0.8.2+: filter UI for the findings list. URL-state-driven so refresh /
// back-button preserve the filtered view, and cross-panel deep-links can
// pre-apply filters via the navigate() opts.
import { PanelFilters } from "../PanelFilters";
import { Tooltip } from "../tooltip";
import { TRUST_AUDIT_RULE_COUNT } from "@/lib/services/trust-audit/types";
import { useHashState } from "../url-state";
import { MissionControlBreadcrumb } from "./mission-control/MissionControlBreadcrumb";

// ── Types ─────────────────────────────────────────────────────────────────

type EvidenceLevel =
  | "verified_runtime"
  | "verified_config"
  | "verified_filesystem"
  | "heuristic_inference"
  | "unknown";

interface Finding {
  id: string;
  ruleId: string;
  severity: string;
  title: string;
  agentId?: string;
  surfaceId?: string;
  modelRef?: string;
  capabilityPath: string[];
  containmentState: string;
  whyItMatters: string;
  blastRadius: string;
  recommendedFix: string;
  evidence: string[];
  confidence?: EvidenceLevel;
}

interface MatrixEntry {
  surface: string;
  agent: string;
  model: string;
  tools: string[];
  containment: string;
  blastRadius: string;
  severity: string;
}

interface RemediationItem {
  priority: number;
  findingId: string;
  title: string;
  severity: string;
  fix: string;
}

interface AgentSummary {
  id: string;
  name: string;
  source: string;
  model: string;
  routingMode: string;
  tools: string[];
  sandboxed: boolean | null;
  confidence?: EvidenceLevel;
}

interface SuppressionAcceptanceLite {
  id: string;
  scope_level: "finding" | "agent_rule" | "rule_global";
  accepted_by: string;
  accepted_at: string;
  reason: string;
  expires_at: string;
}

interface SuppressedFindingEntry {
  finding: Finding;
  acceptance: SuppressionAcceptanceLite;
}

interface AuditReport {
  timestamp: string;
  duration_ms: number;
  summary: {
    overallSeverity: string;
    surfaceCount: number;
    agentCount: number;
    findingCounts: Record<string, number>;
    findingCountsActive?: Record<string, number>;
    totalFindings: number;
    totalActiveFindings?: number;
    totalSuppressedFindings?: number;
  };
  surfaces: { id: string; name: string; policy: string; publicExposure: boolean; notes?: string }[];
  agents: AgentSummary[];
  findings: Finding[];
  suppressedFindings?: SuppressedFindingEntry[];
  matrix: MatrixEntry[];
  remediationPlan: RemediationItem[];
}

interface AuditMeta {
  last_run: string;
  duration_ms: number;
  cached: boolean;
}

// ── Styling constants ─────────────────────────────────────────────────────

const SEV_COLORS: Record<string, string> = {
  critical: "#f43f5e",
  high: "#fb923c",
  medium: "#fbbf24",
  low: "#38bdf8",
  info: "#556a90",
};

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function computeOverallSeverity(findings: Finding[]): string {
  if (findings.length === 0) return "info";
  let max = 0;
  let best = "info";
  for (const f of findings) {
    const rank = SEVERITY_RANK[f.severity] ?? 0;
    if (rank > max) { max = rank; best = f.severity; }
  }
  return best;
}

// Confidence level → visual pill spec.
function confidencePill(level: EvidenceLevel | undefined): { color: string; label: string } {
  switch (level) {
    case "verified_runtime":  return { color: C.green,   label: "VERIFIED" };
    case "verified_config":   return { color: C.green,   label: "CONFIG" };
    case "verified_filesystem": return { color: C.cyan,  label: "FILESYSTEM" };
    case "heuristic_inference": return { color: C.warn,  label: "INFERRED" };
    case "unknown":           return { color: C.txT,     label: "UNKNOWN" };
    default:                  return { color: C.txT,     label: "UNKNOWN" };
  }
}

// ── Small subcomponents ──────────────────────────────────────────────────

// Glass severity pill — translucent accent bg + border per playbook.
const SeverityPill = ({ severity }: { severity: string }) => (
  <span style={{
    padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
    fontFamily: F.mono, letterSpacing: "0.06em", textTransform: "uppercase",
    color: SEV_COLORS[severity] || C.txS,
    background: `${SEV_COLORS[severity] || C.txS}38`,
    border: `1px solid ${SEV_COLORS[severity] || C.txS}8c`,
  }}>{severity}</span>
);

// Glass confidence pill — same translucent treatment per accent color.
const ConfidencePill = ({ level }: { level: EvidenceLevel | undefined }) => {
  const { color, label } = confidencePill(level);
  return (
    <span
      title={level ? `Evidence level: ${level}` : "Evidence level unknown"}
      style={{
        padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
        fontFamily: F.mono, letterSpacing: "0.06em", textTransform: "uppercase",
        color,
        background: `${color}38`,
        border: `1px solid ${color}8c`,
      }}
    >{label}</span>
  );
};

const StatTile = ({ label, value, color, title }: { label: string; value: React.ReactNode; color?: string; title?: string }) => (
  <div
    title={title}
    style={{
      background: C.glassSurfTrans,
      border: `1px solid ${C.glassBorderSubtle}`,
      borderRadius: 8,
      padding: "10px 14px",
      flex: 1,
      minWidth: 120,
    }}
  >
    <div style={{
      fontSize: 9, color: C.txT, marginBottom: 4,
      textTransform: "uppercase", letterSpacing: "0.1em",
      fontFamily: F.sans, fontWeight: 600,
    }}>{label}</div>
    <div style={{
      fontSize: 18, fontWeight: 700, color: color || C.tx,
      fontFamily: F.mono, lineHeight: 1.1,
    }}>{value}</div>
  </div>
);

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Main Panel ───────────────────────────────────────────────────────────

export function TrustAuditPanel({ incomingFromMissionControl, onMissionControlBackConsumed }: { incomingFromMissionControl?: boolean; onMissionControlBackConsumed?: () => void } = {}) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [meta, setMeta] = useState<AuditMeta | null>(null);
  const [state, setState] = useState<PanelDataState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<"findings" | "matrix" | "remediation" | "surfaces">("findings");
  // v0.11.5+: pagination on the Findings card list — operator directive
  // 2026-05-05. Default 5 per page; footer hidden when totalPages<=1.
  const [findingsPageSize, setFindingsPageSize] = useState(5);
  const [findingsPage, setFindingsPage] = useState(0);
  // v0.8.2+: filter state lives in URL hash so refresh / back-button preserve view
  // and Timeline → Trust Audit deep-links can pre-apply filters.
  const [urlFilterState, updateUrlFilter] = useHashState();
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchAudit = useCallback(async (forceRefresh: boolean) => {
    setState(hasDataRef.current ? "refreshing" : "loading");
    setError(null);

    try {
      const url = forceRefresh ? "/api/trust-audit?refresh=true" : "/api/trust-audit";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!mountedRef.current) return;

      if (data.error) {
        throw new Error(data.error);
      }

      // Handle new wrapped shape {report, meta}. If the backend ever returns
      // the raw AuditReport again, fall back gracefully.
      const nextReport: AuditReport = data.report ?? data;
      const nextMeta: AuditMeta = data.meta ?? {
        last_run: nextReport.timestamp,
        duration_ms: nextReport.duration_ms,
        cached: false,
      };

      setReport(nextReport);
      setMeta(nextMeta);
      hasDataRef.current = true;

      // Transition to ready / empty / stale based on payload + age.
      if (!nextReport || (nextReport.findings.length === 0 && nextReport.agents.length === 0)) {
        setState("empty");
      } else if (isStale(nextMeta.last_run, 60 * 60 * 1000)) {
        setState("stale");
      } else {
        setState("ready");
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : "Audit failed";
      setError(msg);
      const isNetwork = err instanceof TypeError
        || /network|failed to fetch|load failed|econnrefused|timeout|unreachable/i.test(msg);
      setState(isNetwork ? "disconnected" : "error");
    }
  }, []);

  // Initial mount — fetch cached result immediately (no ?refresh).
  useEffect(() => {
    fetchAudit(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRecompute = useCallback(() => {
    fetchAudit(true);
  }, [fetchAudit]);

  // v0.11.5+: reset findings pagination to page 0 whenever filters change.
  // Without this, narrowing filters on page 3 leaves the operator on an
  // empty page since fewer rows now match.
  useEffect(() => {
    setFindingsPage(0);
  }, [urlFilterState.q, urlFilterState.severity, urlFilterState.confidence, findingsPageSize]);

  // Overall severity derived from findings (independent of the backend's
  // summary so confidence/severity filters in the UI can stay consistent).
  const derivedOverall = useMemo(
    () => report ? computeOverallSeverity(report.findings) : "info",
    [report]
  );

  const isRefreshing = state === "refreshing";
  const isLoading = state === "loading";
  const isStaleState = state === "stale";
  const hasReport = report !== null;

  // Glass card style — linear gradient with glassBorderCyan per playbook.
  const cardStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, ${C.glassPanel} 0%, ${C.glassPanel2} 100%)`,
    border: `1px solid ${C.glassBorderCyan}`,
    borderRadius: 10,
    padding: 16, marginBottom: 12,
  };

  const toggleEvidence = (findingId: string) => {
    setExpandedEvidence(prev => {
      const next = new Set(prev);
      if (next.has(findingId)) next.delete(findingId); else next.add(findingId);
      return next;
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
      {/* v0.12.0+: Mission Control return breadcrumb. */}
      <MissionControlBreadcrumb
        visible={!!incomingFromMissionControl}
        onClick={() => onMissionControlBackConsumed?.()}
      />
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.tx, margin: 0 }}>Trust Boundary & Blast Radius Audit</h2>
          <p style={{ fontSize: 12, color: C.txS, margin: "4px 0 0" }}>
            Who can reach your agents, what they can do, and what happens if trust is wrong.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            <PanelStateBar
              state={state}
              lastUpdated={meta?.last_run}
              onRefresh={handleRecompute}
              errorMessage={error || undefined}
            />
            {isStaleState && (
              <span style={{
                fontSize: 11, color: C.warn, fontFamily: F.sans, fontWeight: 600,
                padding: "3px 8px", borderRadius: 4,
                background: `${C.warn}38`, border: `1px solid ${C.warn}8c`,
              }}>
                Results &gt;1h old — consider refresh
              </span>
            )}
            {isRefreshing && (
              <span style={{
                fontSize: 11, color: C.warn, fontFamily: F.sans, fontWeight: 600,
                padding: "3px 8px", borderRadius: 4,
                background: `${C.warn}38`, border: `1px solid ${C.warn}8c`,
              }}>
                Recomputing…
              </span>
            )}
            {meta?.cached && state === "ready" && (
              <span style={{
                fontSize: 11, color: C.info, fontFamily: F.sans, fontWeight: 600,
                padding: "3px 8px", borderRadius: 4,
                background: `${C.info}38`, border: `1px solid ${C.info}8c`,
              }}>
                Cached result
              </span>
            )}
          </div>
        </div>
        <Tooltip placement="left" variant="detail" content={<span>Execute the full <strong>{TRUST_AUDIT_RULE_COUNT}-rule trust-boundary scan</strong> across the LiteLLM proxy, dashboard, agents, surface capabilities, and sensitive assets. Typical run: ~15s. Previous result stays visible while scanning so the panel never goes blank. Result is cached briefly — bypass the cache by clicking again.</span>}>
          <button onClick={handleRecompute} disabled={isLoading || isRefreshing} style={{
            padding: "8px 20px", borderRadius: 6, border: "none",
            cursor: (isLoading || isRefreshing) ? "wait" : "pointer",
            background: `linear-gradient(135deg, ${C.cyan} 0%, ${C.green} 100%)`, color: "#04070e", fontSize: 13, fontWeight: 700, fontFamily: F.sans,
            opacity: (isLoading || isRefreshing) ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}>
            {isRefreshing ? "Scanning..." : isLoading ? "Loading..." : "Run Audit"}
          </button>
        </Tooltip>
      </div>

      {/* State buckets where we have no data yet */}
      {!hasReport && isLoading && (
        <div style={{ ...cardStyle, textAlign: "center", padding: 60 }}>
          <div style={{
            width: 24, height: 24, margin: "0 auto 12px",
            border: `2px solid ${C.glassBorderSubtle}`, borderTop: `2px solid ${C.brand}`,
            borderRadius: "50%", animation: "spin 0.8s linear infinite",
          }} />
          <div style={{ color: C.txS, fontSize: 13, fontFamily: F.mono, letterSpacing: "0.05em" }}>
            Loading last audit result...
          </div>
        </div>
      )}

      {!hasReport && state === "disconnected" && (
        <PanelDisconnected onRetry={handleRecompute} lastSeen={meta?.last_run} />
      )}

      {!hasReport && state === "error" && (
        <PanelErrorState
          title="Trust audit failed"
          error={error || "Unknown error"}
          onRetry={handleRecompute}
          hint="Check that the dashboard backend is running and that the config_defaults table is accessible."
        />
      )}

      {!hasReport && state === "empty" && (
        <PanelEmptyState
          icon="🔬"
          title="No trust audit has been run yet"
          description={`The trust audit performs ${TRUST_AUDIT_RULE_COUNT} trust-boundary and blast-radius checks across your LiteLLM proxy, dashboard, agents, capabilities, and sensitive assets. Typical run time is ~15s on a typical install. Result quality improves when you have run at least one shield scan, have at least one agent, and have a LiteLLM provider configured.`}
          actionLabel="Run Audit Now"
          onAction={handleRecompute}
        />
      )}

      {/* When we DO have a report — always keep it visible, including during refreshing. */}
      {hasReport && report && (
        <>
          {/* Summary header — stat tiles */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <StatTile
              label="Last Run"
              value={formatTimeAgo(meta?.last_run)}
              title={meta?.last_run ? new Date(meta.last_run).toLocaleString() : undefined}
            />
            <StatTile
              label="Duration"
              value={formatDuration(meta?.duration_ms ?? report.duration_ms)}
            />
            <StatTile
              label={report.summary.totalSuppressedFindings && report.summary.totalSuppressedFindings > 0
                ? `Findings · Active`
                : "Findings"}
              value={report.findings.length}
              title={report.summary.totalSuppressedFindings && report.summary.totalSuppressedFindings > 0
                ? `${report.summary.totalFindings} gross findings; ${report.summary.totalSuppressedFindings} suppressed by accepted risks. Active = gross − suppressed. Headlines and badges use active.`
                : undefined}
            />
            {report.summary.totalSuppressedFindings && report.summary.totalSuppressedFindings > 0 ? (
              <StatTile
                label="Accepted"
                value={report.summary.totalSuppressedFindings}
                color={C.txT}
                title={`${report.summary.totalSuppressedFindings} findings suppressed by operator-accepted risks. See Accepted Risks at the bottom of the Findings list to inspect or revoke.`}
              />
            ) : null}
            <StatTile
              label="Overall Severity"
              value={derivedOverall.toUpperCase()}
              color={SEV_COLORS[derivedOverall] || C.tx}
              title={
                derivedOverall === "critical" ? "CRITICAL — at least one CRITICAL finding is active. Treat as live incident: drop everything, page on-call, investigate before any other panel work."
                : derivedOverall === "high" ? "HIGH — no CRITICAL findings, but at least one HIGH-severity issue is active. Investigate within hours; real risk if left untouched."
                : derivedOverall === "medium" ? "MEDIUM — only MEDIUM-severity findings are active. Investigate within days; could escalate if conditions change."
                : derivedOverall === "low" ? "LOW — only LOW-severity hardening opportunities active. Track and address during normal cadence; no immediate action required."
                : "INFO — only informational findings. Surfaced for awareness; no action expected."
              }
            />
            {meta?.cached && (
              <StatTile
                label="Source"
                value="CACHED"
                color={C.info}
                title="This result is served from cache. Click Run Audit to recompute."
              />
            )}
          </div>

          {/* Severity count cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
            <Tooltip as="div" placement="bottom" variant="detail" content={
              derivedOverall === "critical" ? <span><strong style={{ color: SEV_COLORS.critical }}>CRITICAL overall</strong> — the highest-severity finding active right now is CRITICAL. <strong>Drop-everything posture.</strong> Active exploitation, data exposure, or availability collapse. Filter the Findings list below to severity = CRITICAL to see what tripped it, then run the Run Audit again after remediation to confirm the band drops.</span>
              : derivedOverall === "high" ? <span><strong style={{ color: SEV_COLORS.high }}>HIGH overall</strong> — no CRITICAL findings active, but at least one HIGH. <strong>Investigate within hours.</strong> Real risk if left untouched (privilege escalation, tool freedom, dormant attack surface). Filter to HIGH below to triage.</span>
              : derivedOverall === "medium" ? <span><strong style={{ color: SEV_COLORS.medium }}>MEDIUM overall</strong> — only MEDIUM-severity findings active. <strong>Investigate within days.</strong> Notable but not actively exploited; could escalate if conditions change (new agent added, recovery path widened, etc.).</span>
              : derivedOverall === "low" ? <span><strong style={{ color: SEV_COLORS.low }}>LOW overall</strong> — only LOW-severity hardening opportunities. Track and address during your normal cadence; no immediate action required.</span>
              : <span><strong style={{ color: SEV_COLORS.info }}>INFO overall</strong> — only informational findings. Surfaced for awareness; no action expected.</span>
            }>
              <div style={{ ...cardStyle, textAlign: "center", borderColor: `${SEV_COLORS[derivedOverall]}40`, marginBottom: 0 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: SEV_COLORS[derivedOverall], fontFamily: F.mono }}>
                  {derivedOverall.toUpperCase()}
                </div>
                <div style={{ fontSize: 10, color: C.txS, textTransform: "uppercase", letterSpacing: "0.1em" }}>Overall</div>
              </div>
            </Tooltip>
            {(["critical", "high", "medium", "low"] as const).map(sev => {
              const count = report.summary.findingCounts[sev] || 0;
              const tip =
                sev === "critical" ? <span><strong style={{ color: SEV_COLORS.critical }}>{count} CRITICAL finding{count === 1 ? "" : "s"}</strong> — active exploitation paths, data-exposure boundaries that have already failed, or availability collapse. <strong>Page on-call.</strong> Each finding below has an evidence trail and a recommended fix.</span>
                : sev === "high" ? <span><strong style={{ color: SEV_COLORS.high }}>{count} HIGH finding{count === 1 ? "" : "s"}</strong> — credible attack surfaces that aren&apos;t actively exploited but could be (privilege escalation paths, dormant attack vectors, tool freedom that violates least-privilege). Investigate within hours.</span>
                : sev === "medium" ? <span><strong style={{ color: SEV_COLORS.medium }}>{count} MEDIUM finding{count === 1 ? "" : "s"}</strong> — risks that depend on additional conditions (new agent, broadened recovery path) to escalate. Worth a planned mitigation; not on fire.</span>
                : <span><strong style={{ color: SEV_COLORS.low }}>{count} LOW finding{count === 1 ? "" : "s"}</strong> — hardening opportunities. Best-practice deviations rather than exploitable bugs. Address when you have cycles.</span>;
              return (
                <Tooltip key={sev} as="div" placement="bottom" variant="detail" content={tip}>
                  <div style={{ ...cardStyle, textAlign: "center", marginBottom: 0 }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: SEV_COLORS[sev], fontFamily: F.mono }}>
                      {count}
                    </div>
                    <div style={{ fontSize: 10, color: C.txS, textTransform: "uppercase", letterSpacing: "0.1em" }}>{sev}</div>
                  </div>
                </Tooltip>
              );
            })}
          </div>

          {/* Secondary stats row */}
          <div style={{ display: "flex", gap: 16, marginBottom: 20, fontSize: 12, color: C.txS, flexWrap: "wrap" }}>
            <span>{report.summary.surfaceCount} surfaces</span>
            <span>{report.summary.agentCount} agents</span>
            <span>{report.summary.totalFindings} findings</span>
            {meta && <span>Last run took {formatDuration(meta.duration_ms)}</span>}
            <span style={{ marginLeft: "auto", fontFamily: F.mono, fontSize: 11 }}
                  title={meta?.last_run ? new Date(meta.last_run).toLocaleString() : undefined}>
              {meta?.last_run ? new Date(meta.last_run).toLocaleString() : new Date(report.timestamp).toLocaleString()}
            </span>
          </div>

          {/* Discovery fidelity note — honest caveat about what this panel does today */}
          <div style={{
            padding: "10px 12px",
            marginBottom: 12,
            background: `${C.info}0c`,
            border: `1px solid ${C.info}33`,
            borderLeft: `3px solid ${C.info}`,
            borderRadius: 4,
            fontSize: 11,
            color: C.txS,
            lineHeight: 1.55,
          }}>
            <div style={{ fontWeight: 700, color: C.info, marginBottom: 4, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>Discovery fidelity</div>
            Agent identity is derived from <span style={{ fontFamily: F.mono, color: C.cyan }}>proxy_traffic.session_id</span>; tool inventory is inferred from <span style={{ fontFamily: F.mono, color: C.cyan }}>TOOLS.md</span> where present. Treat <span style={{ fontFamily: F.mono, color: C.green }}>verified_runtime</span> confidence as a fact and <span style={{ fontFamily: F.mono, color: C.warn }}>heuristic_inference</span> as an advisory hypothesis. A fuller discovery model (real agent metadata, authoritative tool registry, live sandbox detection) is on the roadmap.
          </div>

          {/* Tab Bar */}
          <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.glassBorderSubtle}`, paddingBottom: 0 }}>
            {([
              { id: "findings" as const, label: `Findings (${report.findings.length})`, tip: <span>Per-rule findings ranked by severity. Each has a confidence pill (verified vs inferred), a why-it-matters explanation, blast-radius impact, and a recommended fix. Filter by severity / confidence / freeform search.</span> },
              { id: "matrix" as const, label: "Matrix", tip: <span>The <strong>surface × agent × tools</strong> grid. Shows which agents reach which surfaces, what containment posture covers them, and the worst-case blast radius if that boundary fails.</span> },
              { id: "remediation" as const, label: "Remediation", tip: <span>Prioritized to-do list extracted from the findings. Highest-impact, lowest-effort fixes first. Each item links back to its source finding for the full evidence trail.</span> },
              { id: "surfaces" as const, label: "Surfaces", tip: <span>The discovered <strong>attack surfaces</strong> (HTTP endpoints, MCP tools, file-system paths) and their declared policies + public-exposure flags. The raw inventory the matrix and findings are built on.</span> },
            ]).map(tab => (
              <Tooltip key={tab.id} placement="top" variant="detail" content={tab.tip}>
                <button onClick={() => setActiveView(tab.id)} style={{
                  padding: "8px 16px", border: "none", cursor: "pointer",
                  background: activeView === tab.id ? `${C.brand}18` : "transparent",
                  color: activeView === tab.id ? C.brand : C.txS,
                  fontSize: 12, fontWeight: 600, fontFamily: F.sans,
                  borderBottom: activeView === tab.id ? `2px solid ${C.brand}` : "2px solid transparent",
                }}>{tab.label}</button>
              </Tooltip>
            ))}
          </div>

          {/* Findings View — v0.8.2+ filter row above active findings.
              Filters: severity (5 levels), confidence (5 evidence levels),
              freeform search across title/whyItMatters/recommendedFix. URL
              state powers the filtering so refresh/back-button preserve view
              and cross-panel deep-links can pre-apply filters. */}
          {activeView === "findings" && (() => {
            const sevOptions = ["critical", "high", "medium", "low", "info"];
            const confOptions = ["verified_runtime", "verified_config", "verified_filesystem", "heuristic_inference", "unknown"];
            const q = (urlFilterState.q ?? "").toLowerCase();
            const sevSel = urlFilterState.severity ?? [];
            const confSel = urlFilterState.confidence ?? [];
            const dlId = urlFilterState.id;
            const filtered = report.findings.filter(f => {
              if (dlId && f.id !== dlId) return false;
              if (sevSel.length > 0 && !sevSel.includes(f.severity)) return false;
              if (confSel.length > 0 && (!f.confidence || !confSel.includes(f.confidence))) return false;
              if (q) {
                const haystack = `${f.title} ${f.whyItMatters} ${f.recommendedFix} ${f.ruleId} ${f.agentId ?? ""}`.toLowerCase();
                if (!haystack.includes(q)) return false;
              }
              return true;
            });
            const findingsTotalPages = Math.max(1, Math.ceil(filtered.length / findingsPageSize));
            const pagedFindings = filtered.slice(findingsPage * findingsPageSize, (findingsPage + 1) * findingsPageSize);
            return (
              <>
                <PanelFilters
                  config={{
                    search: { placeholder: "Search title, why-it-matters, fix, rule, agent…" },
                    severity: sevOptions,
                    confidence: confOptions,
                  }}
                  values={urlFilterState}
                  onChange={(patch) => updateUrlFilter(patch)}
                  resultCount={filtered.length}
                  totalCount={report.findings.length}
                  showIdBadge
                />
                {pagedFindings.map(f => {
            const isExpanded = expandedFinding === f.id;
            const evidenceOpen = expandedEvidence.has(f.id);
            const hasEvidence = Array.isArray(f.evidence) && f.evidence.length > 0;
            return (
              <div key={f.id} style={{
                ...cardStyle,
                borderColor: isExpanded ? `${SEV_COLORS[f.severity]}8c` : C.glassBorderCyan,
              }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                  onClick={() => setExpandedFinding(isExpanded ? null : f.id)}
                >
                  <SeverityPill severity={f.severity} />
                  <ConfidencePill level={f.confidence} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.tx, flex: 1 }}>{f.title}</span>
                  <AcceptRiskButton
                    query={{
                      source_panel: "trust_audit",
                      rule_id: f.ruleId,
                      agent_id: f.agentId ?? null,
                      surface_id: f.surfaceId ?? null,
                      evidence: Array.isArray(f.evidence) ? f.evidence : [],
                    }}
                    onAccepted={() => fetchAudit(true)}
                  />
                  <span style={{ fontSize: 11, color: C.txG }}>{isExpanded ? "▲" : "▼"}</span>
                </div>
                {isExpanded && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.glassBorderSubtle}` }}>
                    {/* Why It Matters — glassSurfTrans detail block */}
                    <div style={{ marginBottom: 10, padding: "8px 10px", background: C.glassSurfTrans, borderRadius: 6, border: `1px solid ${C.glassBorderSubtle}` }}>
                      <div style={{ fontSize: 10, color: C.txG, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Why It Matters</div>
                      <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.6 }}>{f.whyItMatters}</div>
                    </div>
                    {/* Blast Radius — glassSurfTrans detail block */}
                    <div style={{ marginBottom: 10, padding: "8px 10px", background: C.glassSurfTrans, borderRadius: 6, border: `1px solid ${C.glassBorderSubtle}` }}>
                      <div style={{ fontSize: 10, color: C.txG, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Blast Radius</div>
                      <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.6 }}>{f.blastRadius}</div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: C.txG, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Recommended Fix</div>
                      <div style={{ fontSize: 12, color: C.brand, lineHeight: 1.6 }}>{f.recommendedFix}</div>
                    </div>
                    {hasEvidence && (
                      <div>
                        <Tooltip placement="top" variant="detail" content={<span>The raw evidence trail behind this finding — config snippets, runtime probes, file-system paths the rule consulted. Use this to <strong>verify the finding is real</strong> before acting on it (or to justify suppressing it).</span>}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleEvidence(f.id); }}
                            style={{
                              background: "transparent", border: "none", padding: 0,
                              color: C.txG, fontSize: 10, fontFamily: F.sans,
                              textTransform: "uppercase", letterSpacing: "0.1em",
                              cursor: "pointer", marginBottom: 4,
                            }}
                          >
                            Evidence ({f.evidence.length}) {evidenceOpen ? "▲" : "▼"}
                          </button>
                        </Tooltip>
                        {evidenceOpen && (
                          <div style={{
                            background: C.glassSurfTrans,
                            border: `1px solid ${C.glassBorderSubtle}`,
                            borderRadius: 6,
                            padding: "8px 10px",
                          }}>
                            {f.evidence.map((e, i) => (
                              <div key={i} style={{
                                fontSize: 11, color: C.txS, fontFamily: F.mono,
                                padding: "2px 0", wordBreak: "break-word",
                              }}>{e}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
                {findingsTotalPages > 1 && (
                  <PaginationFooter
                    currentPage={findingsPage}
                    totalPages={findingsTotalPages}
                    pageSize={findingsPageSize}
                    totalRows={filtered.length}
                    onPageSizeChange={setFindingsPageSize}
                    onPageChange={setFindingsPage}
                  />
                )}
              </>
            );
          })()}

          {/* Accepted Risks (v0.8.0+) — collapsed by default. Findings here
              are still tracked as gross findings in the underlying audit, but
              excluded from the active aggregate (overallSeverity, severity
              counts). The full audit-log entry for each acceptance carries
              the SOC 2 evidence trail. */}
          {activeView === "findings" && report.suppressedFindings && (
            <AcceptedRisksSection count={report.suppressedFindings.length}>
              {report.suppressedFindings.map(({ finding, acceptance }) => (
                <SuppressedFindingCard
                  key={finding.id}
                  title={finding.title}
                  acceptance={acceptance}
                  meta={`severity: ${finding.severity} · rule: ${finding.ruleId}${finding.agentId ? ` · agent: ${finding.agentId}` : ""}`}
                  onRevoked={() => fetchAudit(true)}
                />
              ))}
            </AcceptedRisksSection>
          )}

          {/* Matrix View */}
          {activeView === "matrix" && (
            <div style={{ ...cardStyle, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                    {["Severity", "Confidence", "Surface", "Agent", "Model", "Tools", "Containment", "Blast Radius"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.txG, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: F.mono }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.matrix.slice(0, 20).map((m, i) => {
                    // Derive confidence for matrix row from the worst-confidence
                    // finding that mentions this agent; fall back to agent's
                    // own confidence if no finding exists.
                    const agent = report.agents.find(a => a.name === m.agent);
                    const agentFindings = report.findings.filter(f => f.agentId === agent?.id);
                    const rowConfidence = agentFindings.length > 0
                      ? (agentFindings.map(f => f.confidence).find(c => c === "heuristic_inference")
                         || agentFindings[0].confidence)
                      : agent?.confidence;
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                        <td style={{ padding: "6px 10px" }}><SeverityPill severity={m.severity} /></td>
                        <td style={{ padding: "6px 10px" }}><ConfidencePill level={rowConfidence} /></td>
                        <td style={{ padding: "6px 10px", color: C.txS, fontSize: 11 }}>{m.surface}</td>
                        <td style={{ padding: "6px 10px", color: C.tx, fontWeight: 600, fontSize: 11 }}
                            title={m.agent}>
                          {m.agent.length > 16 ? `${m.agent.slice(0, 16)}…` : m.agent}
                        </td>
                        <td style={{ padding: "6px 10px", color: C.txS, fontFamily: F.mono, fontSize: 10 }}>{m.model}</td>
                        <td style={{ padding: "6px 10px", color: C.txS, fontSize: 10 }}>{m.tools.slice(0, 3).join(", ") || "—"}</td>
                        <td style={{ padding: "6px 10px", fontSize: 10,
                                     color: m.containment === "Sandboxed" ? C.brand : m.containment === "Unknown" ? C.txT : C.warn }}>
                          {m.containment}
                        </td>
                        <td style={{ padding: "6px 10px", color: C.txS, fontSize: 10, maxWidth: 300 }}>
                          {m.blastRadius.length > 80 ? `${m.blastRadius.slice(0, 80)}…` : m.blastRadius}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Remediation View */}
          {activeView === "remediation" && report.remediationPlan.map(r => (
            <div key={r.findingId} style={{ ...cardStyle, display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                background: C.glassSurfTrans, border: `1px solid ${C.glassBorderCyan}`,
                color: C.brand, fontSize: 12, fontWeight: 700, fontFamily: F.mono, flexShrink: 0,
              }}>#{r.priority}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <SeverityPill severity={r.severity} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.tx }}>{r.title}</span>
                </div>
                <div style={{ fontSize: 12, color: C.brand, lineHeight: 1.6 }}>{r.fix}</div>
              </div>
            </div>
          ))}

          {/* Surfaces View — now includes agents with sandboxed=null shown as UNKNOWN */}
          {activeView === "surfaces" && (
            <>
              {report.surfaces.map(s => (
                <div key={s.id} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: s.publicExposure ? C.danger : C.brand,
                    // Status dot glow per playbook.
                    boxShadow: `0 0 6px ${s.publicExposure ? C.danger : C.brand}, 0 0 12px ${s.publicExposure ? C.danger : C.brand}44`,
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.tx }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: C.txS }}>{s.notes}</div>
                  </div>
                  <span style={{
                    padding: "3px 10px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                    fontFamily: F.mono, textTransform: "uppercase",
                    color: s.policy === "rbac" ? C.brand : s.policy === "api-key" ? "#a78bfa" : C.warn,
                    background: `${s.policy === "rbac" ? C.brand : s.policy === "api-key" ? "#a78bfa" : C.warn}38`,
                  }}>{s.policy}</span>
                </div>
              ))}

              {/* Agents — show sandbox state honestly */}
              {report.agents.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{
                    fontSize: 11, color: C.txG, textTransform: "uppercase",
                    letterSpacing: "0.1em", fontFamily: F.sans, fontWeight: 600,
                    marginBottom: 8,
                  }}>Agents ({report.agents.length})</div>
                  {report.agents.map(a => {
                    const sandboxBadge = a.sandboxed === true
                      ? { label: "SANDBOXED", color: C.brand }
                      : a.sandboxed === false
                        ? { label: "UNSANDBOXED", color: C.warn }
                        : { label: "UNKNOWN", color: C.txT };
                    return (
                      <div key={a.id} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.tx }}>{a.name}</span>
                            <ConfidencePill level={a.confidence} />
                          </div>
                          <div style={{ fontSize: 11, color: C.txS, marginTop: 2 }}>
                            {a.source} · {a.model} · {a.routingMode} · {a.tools.length} tool(s)
                          </div>
                        </div>
                        <span
                          title={a.sandboxed === null
                            ? "Sandbox state cannot be determined from available data — treat as unknown, not unsandboxed."
                            : undefined}
                          style={{
                            padding: "3px 10px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                            fontFamily: F.mono, textTransform: "uppercase",
                            color: sandboxBadge.color,
                            background: `${sandboxBadge.color}38`,
                            border: `1px solid ${sandboxBadge.color}8c`,
                          }}
                        >{sandboxBadge.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
