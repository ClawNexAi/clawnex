"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import type { TabId, DashboardFilters, CorrelationData } from '../types';
import { C, F } from '../constants';
import {
  Dot,
  Badge,
  EmptyState,
  Card,
  Stat,
  Gauge,
  PanelStateBar,
  PanelEmptyState,
  PanelErrorState,
  PanelDisconnected,
  isStale,
  formatTimeAgo,
  useDataState,
} from '../shared';
import { buildFilterQuery, sevColor, timeAgo } from '../utils';
import { Tooltip } from '../tooltip';
import { CORRS } from '../mock-data';
import { CORRELATION_STARTER_TEMPLATES, type CorrelationRuleTemplate } from '@/lib/correlation-templates';
import {
  AcceptRiskButton,
  SuppressedFindingCard,
  AcceptedRisksSection,
} from "../risk-acceptance/AcceptRiskWidget";
// v0.8.2+: read URL state so the Alerts → Correlations backlink (which now
// passes ?id=<correlation_rule>) can pre-filter the apiCorrs list to that
// rule's events. Without this, clicking a Correlation alert in Alerts dumps
// the operator in the unfiltered correlations list (operator-reported regression).
import { useHashState } from "../url-state";

// ---------------------------------------------------------------------------
// Correlation rule definitions — operator-facing tooltips.
//
// The 10 canonical rules in /api/correlations/evaluate carry domain jargon
// like "Alert Cascade" or "Denial-of-Wallet" that operators don't all
// already know. These tooltips tell them what the rule means, what tripped
// it, and what to look at next. Custom rules fall through to the rule's
// own description field.
// ---------------------------------------------------------------------------

function correlationRuleTip(name: string): React.ReactNode | null {
  // Normalize: lowercase + strip punctuation/whitespace so "Denial-Of-Wallet",
  // "Denial of Wallet", and "denial_of_wallet" all collapse to one key.
  const key = name.toLowerCase().replace(/[\s_\-]+/g, "");
  switch (key) {
    case "coordinatedattackchain":
      return <span><strong>Coordinated Attack Chain</strong> — multiple shield BLOCK verdicts hit across <strong>different</strong> rule categories within 24h. Single-category bursts are usually one bad actor or a false positive; cross-category bursts suggest an attacker probing several attack surfaces in parallel. Investigate the source IPs, affected agents, and whether the categories have a common theme.</span>;
    case "reconnaissanceprobe":
      return <span><strong>Reconnaissance Probe</strong> — many shield REVIEW (not BLOCK) verdicts across multiple categories. Looks like someone is mapping out which payloads get past the shield without crossing the block threshold. Often precedes a real attack. Check Traffic Monitor for the source and review the payloads that triggered.</span>;
    case "denialofwallet":
      return <span><strong>Denial-of-Wallet</strong> — current-hour token burn is 5×+ above the rolling 24h average. Either a runaway agent loop, a prompt-injection-induced infinite generation, or a deliberate cost attack against your LLM budget. Open Token &amp; Cost Intel and identify the agent driving the spike.</span>;
    case "infrastructureunderstress":
      return <span><strong>Infrastructure Under Stress</strong> — both CPU and memory are sustained above 90%. Latency suffers, scans queue up, and the watcher starts dropping events. Investigate the host (Infrastructure tab) — usually a runaway process or a thundering-herd of agents.</span>;
    case "dataexfiltrationattempt":
      return <span><strong>Data Exfiltration Attempt</strong> — shield BLOCK verdicts in the C2 / exfil category. Patterns like webhook.site, ngrok tunnels, base64-encoded payloads to external hosts, or DNS-tunnel signals. Often paired with prompt injection that asks the agent to forward conversation history. <strong>Treat as live incident</strong> until proven benign.</span>;
    case "insiderthreatsignal":
      return <span><strong>Insider Threat Signal</strong> — config changes happened in the last 10 minutes <em>at the same time as</em> shield blocks. Could be an admin investigating an active threat (legit), or an insider weakening defenses to let traffic through (not legit). Review the audit log alongside the shield block timeline before acting.</span>;
    case "breakglassduringactivethreat":
    case "breakglassduringthreat":
      return <span><strong>Break-Glass During Active Threat</strong> — shield bypass is on while CRITICAL alerts are open. The shield is your primary defense; turning it off during an incident is a risky combination. Verify the break-glass session is intentional and time-boxed, then confirm the bypass reason is documented.</span>;
    case "alertcascade":
      return <span><strong>Alert Cascade</strong> — five or more new alerts inside 10 minutes. Either a coordinated multi-vector attack (the attacker is hitting many surfaces at once) or a system issue producing duplicate alerts (e.g. a flapping service). If the alerts cluster around one source, treat it as an attack; if they&apos;re spread across unrelated systems, look for a flapping component.</span>;
    case "elevatedalertvolume":
      return <span><strong>Elevated Alert Volume</strong> — more than 20 open alerts. Less about a specific incident, more about <em>queue depth</em>. The team isn&apos;t keeping up. Triage the oldest CRITICAL/HIGH alerts first, suppress noise rules, or stand up another operator. Stale alerts erode the value of every other signal.</span>;
    case "shieldunderheavyload":
      return <span><strong>Shield Under Heavy Load</strong> — the shield processed 500+ scans in 24h <em>and</em> the block rate is above 10%. Either a real attack wave or a misconfigured agent flooding the proxy. Check Traffic Monitor for the source pattern and Prompt Shield for the block-verdict distribution.</span>;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Types for the /api/correlations/evaluate response payload
// ---------------------------------------------------------------------------

interface SuppressedCorrelationRule {
  rule: string;
  severity: string;
  score: number;
  description: string;
  sources: string[];
  acceptance: {
    id: string;
    scope_level: "finding" | "agent_rule" | "rule_global";
    accepted_by: string;
    accepted_at: string;
    reason: string;
    expires_at: string;
  };
}

interface ThreatScoreSummary {
  threat_score: number;
  threat_score_gross?: number;
  threat_score_active?: number;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  breakdown: Record<string, number>;
  // v0.6.2 Why-this-score additions. Optional so older cached responses
  // (and the GET endpoint prior to this change) still deserialize cleanly.
  weights_applied?: Record<string, number>;
  correlation_multiplier?: number;
  raw_score?: number;
  raw_score_gross?: number;
  triggered_count?: number;
  triggered_count_gross?: number;
  suppressed_count?: number;
  unique_sources?: number;
  triggered_rules: number;
  total_rules?: number;
  evaluated_at: string;
  rules?: Array<{
    rule: string;
    severity: string;
    triggered: boolean;
    score: number;
    description: string;
    sources: string[];
    events: Array<{ type: string; source: string; time?: string }>;
  }>;
  /** v0.8.0+ — triggered rules suppressed by accepted risks. */
  suppressedRules?: SuppressedCorrelationRule[];
  state_summary?: Record<string, unknown>;
}

interface CorrelationsListResponse {
  correlations: CorrelationData[];
  total: number;
  windowSize: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Fetch helpers — raise on non-OK so useDataState can transition to error /
// disconnected. A TypeError (network failure) will bubble up naturally and be
// classified as `disconnected` by the shared hook.
// ---------------------------------------------------------------------------

async function fetchThreatSummary(): Promise<ThreatScoreSummary> {
  const res = await fetch("/api/correlations/evaluate", { method: "POST" });
  if (!res.ok) {
    throw new Error(`Evaluate failed: HTTP ${res.status}`);
  }
  return res.json() as Promise<ThreatScoreSummary>;
}

function makeListFetcher(filters: DashboardFilters): () => Promise<CorrelationData[]> {
  return async () => {
    const qs = buildFilterQuery(filters, { limit: "50" });
    const res = await fetch(`/api/correlations?${qs}`);
    if (!res.ok) {
      throw new Error(`Correlations list failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as CorrelationsListResponse;
    return data.correlations || [];
  };
}

// ---------------------------------------------------------------------------
// CorrelationsPanel
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export function CorrelationsPanel({ filters, demoMode, onNavigate }: { filters: DashboardFilters; demoMode: boolean; onNavigate: (tab: TabId) => void }) {
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  // Seed Test Correlation is gated behind the Developer Tools card (the same
  // env kill-switch + DB toggle + RBAC pattern used for /api/dev/* surfaces).
  // Hidden by default so banking/customer-prod installs don't see it. Operator
  // turns it on in Configuration → Developer Tools to expose the seed button.
  const [devToolsAvailable, setDevToolsAvailable] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dev/status")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setDevToolsAvailable(Boolean(d.available)); })
      .catch(() => { /* env-disabled or fetch failed — keep false */ });
    return () => { cancelled = true; };
  }, []);
  const [expandedCorrs, setExpandedCorrs] = useState<Set<string>>(new Set());
  const [corrPageSize, setCorrPageSize] = useState(10);
  const [corrPage, setCorrPage] = useState(0);

  // --- Summary (threat score) state ---
  // Note: the evaluate endpoint returns `evaluated_at`; we use that as the
  // canonical last-updated stamp so the staleness hint reflects server time,
  // not client fetch time.
  const summaryQuery = useDataState<ThreatScoreSummary>({
    fetcher: fetchThreatSummary,
    staleAfterMs: STALE_THRESHOLD_MS,
    refreshIntervalMs: 30_000,
  });

  // --- Findings list state ---
  const listFetcher = useMemo(() => makeListFetcher(filters), [filters]);
  const listQuery = useDataState<CorrelationData[]>({
    fetcher: listFetcher,
    staleAfterMs: 60_000,
    refreshIntervalMs: 20_000,
  });

  const { data: summary, state: summaryState, refresh: refreshSummary } = summaryQuery;
  const { data: apiCorrs, state: listState, refresh: refreshList, error: listError } = listQuery;

  // Prefer server-reported `evaluated_at` for the staleness check, falling back
  // to the hook-tracked `lastUpdated` if it's missing.
  const lastEvalIso = summary?.evaluated_at ?? summaryQuery.lastUpdated?.toISOString() ?? null;
  const summaryStale = isStale(lastEvalIso, STALE_THRESHOLD_MS);

  // Re-evaluate both summary + list. Summary is the expensive one; findings
  // auto-refresh on their own interval but we also kick them here so the list
  // reflects any new correlations the evaluation just persisted.
  const reevaluateAll = useCallback(() => {
    refreshSummary();
    refreshList();
  }, [refreshSummary, refreshList]);

  // --- Custom rule count (gates the starter-templates empty-state card) ---
  // Separate from the evaluator's `total_rules` which includes built-ins.
  const [customRuleCount, setCustomRuleCount] = useState<number | null>(null);
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ key: string; ok: boolean; message: string } | null>(null);

  const refreshCustomRuleCount = useCallback(async () => {
    try {
      const res = await fetch('/api/correlations/rules');
      if (res.ok) {
        const data = await res.json();
        setCustomRuleCount(Array.isArray(data.rules) ? data.rules.length : 0);
      }
    } catch { /* leave as-is; empty-state card will not render on uncertainty */ }
  }, []);

  useEffect(() => {
    if (!demoMode) refreshCustomRuleCount();
  }, [demoMode, refreshCustomRuleCount]);

  const applyStarterTemplate = useCallback(async (tpl: CorrelationRuleTemplate) => {
    setApplyingTemplate(tpl.key);
    setApplyResult(null);
    try {
      const res = await fetch('/api/correlations/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tpl.name,
          description: tpl.description,
          severity: tpl.severity,
          threshold: tpl.threshold,
          time_window_minutes: tpl.time_window_minutes,
          min_event_count: tpl.min_event_count,
          conditions: tpl.conditions,
        }),
      });
      if (res.ok) {
        setApplyResult({ key: tpl.key, ok: true, message: `Applied — "${tpl.name}" is now active. Edit from Configuration → Correlation Rules.` });
        await refreshCustomRuleCount();
        refreshSummary();
        refreshList();
      } else {
        const data = await res.json().catch(() => ({}));
        setApplyResult({ key: tpl.key, ok: false, message: data.error || `Could not apply template (HTTP ${res.status}).` });
      }
    } catch {
      setApplyResult({ key: tpl.key, ok: false, message: 'Network error while applying template.' });
    } finally {
      setApplyingTemplate(null);
    }
  }, [refreshCustomRuleCount, refreshSummary, refreshList]);

  const seedTestCorrelation = useCallback(async () => {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch("/api/correlations/test", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSeedResult(data.message || "Test correlation seeded successfully.");
        setTimeout(() => {
          refreshList();
          refreshSummary();
        }, 1500);
      } else {
        setSeedResult("Failed to seed test correlation.");
      }
    } catch {
      setSeedResult("Error seeding test correlation.");
    }
    setSeeding(false);
  }, [refreshList, refreshSummary]);

  const filteredMockCorrs = demoMode ? CORRS.filter(cor => {
    if (filters.selectedSeverity !== "all" && cor.severity !== filters.selectedSeverity) return false;
    return true;
  }) : [];

  // -------------------------------------------------------------------------
  // Summary block rendering
  // -------------------------------------------------------------------------

  const renderSummaryBlock = () => {
    if (demoMode) return null;

    // First-load with no data yet — show a lightweight skeleton card rather
    // than hijacking the whole page with a generic spinner.
    const noData = summary === null;
    const isFirstLoad = noData && (summaryState === "loading" || summaryState === "idle");
    const disconnected = noData && summaryState === "disconnected";
    const errored = noData && summaryState === "error";

    if (isFirstLoad) {
      return (
        <Card title="OVERALL THREAT SCORE" accent={C.brand}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 4px", color: C.txS, fontSize: 13, fontFamily: F.sans }}>
            <Dot color={C.warn} size={8} pulse />
            <span>Evaluating correlations…</span>
          </div>
        </Card>
      );
    }

    if (disconnected) {
      return (
        <Card title="OVERALL THREAT SCORE" accent={C.danger}>
          <PanelDisconnected onRetry={refreshSummary} lastSeen={summaryQuery.lastUpdated} />
        </Card>
      );
    }

    if (errored) {
      return (
        <Card title="OVERALL THREAT SCORE" accent={C.danger}>
          <PanelErrorState
            title="Evaluation failed"
            error={summaryQuery.error || "Unknown error evaluating correlations."}
            onRetry={refreshSummary}
            hint="The correlation engine couldn't complete an evaluation. Check the server logs for details."
          />
        </Card>
      );
    }

    if (!summary) return null;

    const { threat_score, level, breakdown, triggered_rules } = summary;
    const levelColor = level === "CRITICAL" ? C.danger : level === "HIGH" ? C.orange : level === "MEDIUM" ? C.warn : C.green;
    const sortedSources = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
    const totalPts = sortedSources.reduce((acc, [, v]) => acc + v, 0);
    const refreshing = summaryState === "refreshing";

    return (
      <Card
        title="OVERALL THREAT SCORE"
        accent={levelColor}
        glow={threat_score > 50 ? levelColor : undefined}
        actions={
          <PanelStateBar
            state={summaryStale && summaryState === "ready" ? "stale" : summaryState}
            lastUpdated={lastEvalIso}
            onRefresh={reevaluateAll}
          />
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <Gauge value={threat_score} label={level} color={levelColor} />
          </div>

          <div style={{ flex: 1, minWidth: 280 }}>
            {/* Stat cards row — v0.7.2 SP-4 polish: inline tooltips per the reviewer's
                metric-semantic discipline. Source/inclusion/window/confidence
                inline-discoverable on hover. cursor: help via Stat's tooltip prop. */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <Stat
                label="Score"
                value={threat_score}
                color={levelColor}
                small
                tooltip={`Threat score 0-100 · source: /api/correlations/evaluate (raw_score × correlation_multiplier, clamped 100) · window: ${filters.since}. See "Why this score" for the per-source breakdown and multiplier rationale.`}
              />
              <Stat
                label="Level"
                value={level}
                color={levelColor}
                small
                tooltip={`Severity band derived from score. Bands: CRITICAL ≥ 80, HIGH ≥ 60, MEDIUM ≥ 40, LOW ≥ 20, MINIMAL otherwise. Source: /api/correlations/evaluate.level.`}
              />
              <Stat
                label="Triggered Rules"
                value={triggered_rules}
                color={triggered_rules > 0 ? C.orange : C.green}
                small
                tooltip={`Correlation rules that fired in the current window · source: /api/correlations/evaluate.triggered_count · window: ${filters.since}. Each triggered rule contributes points to the sources it observed (see breakdown).`}
              />
              <Stat
                label="Findings"
                value={apiCorrs?.length ?? "—"}
                color={C.brand}
                small
                tooltip={`Distinct correlation findings rendered in the table below · source: /api/correlations · window: ${filters.since}. Renders "—" honestly when /api/correlations is unreachable. Differs from Triggered Rules: a finding is a unique multi-signal correlation; a triggered rule is the rule that produced it.`}
              />
            </div>

            {/* Source breakdown as horizontal stacked bar */}
            {sortedSources.length > 0 && totalPts > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: C.txT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700, fontFamily: F.sans }}>
                  Source Breakdown
                </div>
                <div style={{
                  display: "flex", width: "100%", height: 10, borderRadius: 5, overflow: "hidden",
                  background: `${C.txG}22`, marginBottom: 6,
                }}>
                  {sortedSources.map(([src, pts]) => {
                    const srcColor =
                      src === "shield" ? C.brand :
                      src === "infra" ? C.cyan :
                      src === "token" ? C.orange :
                      src === "access" ? C.info :
                      src === "breakglass" ? C.danger :
                      src === "audit" ? C.purp :
                      src === "alerts" ? C.warn :
                      src === "traffic" ? C.green :
                      C.txS;
                    const pct = (pts / totalPts) * 100;
                    return (
                      <div
                        key={src}
                        title={`${src}: ${Math.round(pts)}pts (${pct.toFixed(0)}%)`}
                        style={{ width: `${pct}%`, height: "100%", background: srcColor }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: C.txS, fontFamily: F.mono }}>
                  {sortedSources.map(([src, pts]) => {
                    const srcColor =
                      src === "shield" ? C.brand :
                      src === "infra" ? C.cyan :
                      src === "token" ? C.orange :
                      src === "access" ? C.info :
                      src === "breakglass" ? C.danger :
                      src === "audit" ? C.purp :
                      src === "alerts" ? C.warn :
                      src === "traffic" ? C.green :
                      C.txS;
                    return (
                      <span key={src} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Dot color={srcColor} size={7} />
                        <span style={{ color: C.tx }}>{src}</span>
                        <span style={{ color: srcColor, fontWeight: 700 }}>{Math.round(pts)}pts</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Last evaluated + staleness hint */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 11, color: C.txT, fontFamily: F.mono }}>
              <span>
                Last evaluated:{" "}
                <span
                  title={lastEvalIso ? new Date(lastEvalIso).toLocaleString() : "never"}
                  style={{ color: C.txS }}
                >
                  {formatTimeAgo(lastEvalIso)}
                </span>
              </span>
              {summaryStale && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "2px 8px", borderRadius: 4,
                  background: `${C.warn}18`, border: `1px solid ${C.warn}44`,
                  color: C.warn, fontSize: 10, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                }}>
                  <Dot color={C.warn} size={6} /> Summary may be stale — re-evaluate
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <Tooltip placement="left" variant="detail" content={<span>Recompute the threat score and re-fire every enabled correlation rule against the recent event window. Bypasses the 5-second cache. Previous result stays visible during the recompute so you don&apos;t lose your place. Logged to audit.</span>}>
              <button
                onClick={reevaluateAll}
                disabled={refreshing}
                style={{
                  padding: "7px 16px", borderRadius: 10,
                  border: 0,
                  background: refreshing ? `${C.brand}22` : `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`,
                  color: refreshing ? C.brand : "#06121f", fontSize: 11, fontWeight: 850, fontFamily: F.mono,
                  cursor: refreshing ? "wait" : "pointer",
                  textTransform: "uppercase" as const, letterSpacing: "0.08em",
                  whiteSpace: "nowrap" as const,
                }}
              >
                {refreshing ? "Evaluating…" : "Re-evaluate Now"}
              </button>
            </Tooltip>
          </div>
        </div>
      </Card>
    );
  };

  // -------------------------------------------------------------------------
  // Existing findings list (PRESERVED — only wrapped with state handling below)
  // -------------------------------------------------------------------------

  const renderMockCorrs = () => filteredMockCorrs.map(cor => {
    const sc = sevColor(cor.severity);
    const isCritical = cor.severity === "CRITICAL";
    return (
      <div key={cor.id} style={{
        background: isCritical ? `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})` : C.glassSurfTrans,
        border: `1px solid ${C.glassBorderCyan}`,
        borderLeft: `4px solid ${sc}`,
        borderRadius: 10, padding: 18, marginBottom: 16,
        boxShadow: isCritical ? `0 0 20px ${C.danger}22, ${C.glassCardShadow}` : C.glassCardShadow,
      }}>
        {/* Header: severity badge + title + instance ID */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Badge label={cor.severity} color={sc} />
          {(() => {
            const tip = correlationRuleTip(cor.rule);
            const node = <span style={{ fontSize: 15, fontWeight: 700, color: C.tx, ...(tip ? { borderBottom: `1px dotted ${C.txT}`, cursor: "help" } : {}) }}>{cor.rule}</span>;
            return tip ? <Tooltip placement="top" variant="detail" content={tip}>{node}</Tooltip> : node;
          })()}
          <span style={{ fontSize: 13, color: C.txT, fontFamily: F.mono }}>{"—"} {cor.id}</span>
        </div>

        {/* Summary */}
        <div style={{ fontSize: 14, color: C.txS, marginBottom: 14, lineHeight: 1.5 }}>{cor.desc}</div>

        {/* Event timeline */}
        <div style={{ marginBottom: 14, position: "relative" as const }}>
          {cor.events.map((e, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "6px 0",
              position: "relative" as const,
            }}>
              {/* Vertical line + dot */}
              <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", width: 16, flexShrink: 0, position: "relative" as const }}>
                <Dot color={sc} size={8} glow={isCritical} />
                {i < cor.events.length - 1 && (
                  <div style={{ position: "absolute" as const, top: 14, left: "50%", transform: "translateX(-50%)", width: 2, height: "calc(100% + 4px)", background: `${sc}33` }} />
                )}
              </div>

              {/* Timestamp */}
              <span style={{ fontFamily: F.mono, fontSize: 13, color: C.txT, minWidth: 65, flexShrink: 0 }}>{e.time}</span>

              {/* Event description */}
              <span style={{ fontSize: 13, color: C.txS, flex: 1 }}>{e.type}</span>

              {/* Badge if any */}
              {e.badge && <Badge label={e.badge} color={e.badge === "BLOCKED" ? C.danger : C.orange} />}

              {/* Panel link */}
              {e.link && (
                <button onClick={() => onNavigate(e.link)} style={{
                  background: "transparent", border: "none", color: C.info, fontSize: 12, fontFamily: F.sans,
                  cursor: "pointer", padding: "2px 0", whiteSpace: "nowrap" as const, fontWeight: 600,
                  opacity: 0.85, transition: "opacity 0.15s ease",
                }}
                onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.opacity = "1"; }}
                onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.opacity = "0.85"; }}
                >
                  {e.linkLabel} {"→"}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* AI Recommendation */}
        <div style={{
          padding: "12px 14px", background: `${C.warn}08`, borderRadius: 6,
          borderTop: `3px solid ${C.warn}`,
          border: `1px solid ${C.warn}22`,
        }}>
          <div style={{ fontSize: 11, color: C.warn, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: F.sans }}>AI RECOMMENDATION</div>
          <div style={{ fontSize: 13, color: C.txS, lineHeight: 1.5 }}>{cor.recommendation}</div>
        </div>
      </div>
    );
  });

  // v0.8.2+: deep-link filter. When URL carries ?id=<value>, narrow apiCorrs
  // to entries whose correlation_rule (rule name) OR id matches. Alerts panel
  // backlink passes the human-readable rule name (e.g. "Coordinated Attack
  // Chain") because that's what the alert title carries; Timeline-style
  // event-id deep-links would pass the correlation row's id directly. We
  // accept either match so both flows work without semantic gymnastics.
  const [corrUrlState, updateCorrUrl] = useHashState();
  const correlationsDeepLinkId = corrUrlState.id;

  const renderApiCorrs = () => {
    if (!apiCorrs || apiCorrs.length === 0) return null;
    // Apply deep-link filter BEFORE pagination so the operator sees the
    // matching events on the first page, not somewhere in the pagination tail.
    const visibleCorrs = correlationsDeepLinkId
      ? apiCorrs.filter(c => c.correlation_rule === correlationsDeepLinkId || c.id === correlationsDeepLinkId)
      : apiCorrs;
    const start = corrPage * corrPageSize;
    const pageItems = visibleCorrs.slice(start, start + corrPageSize);
    const totalPages = Math.ceil(visibleCorrs.length / corrPageSize);

    // Map event types to relevant panel links
    const getEventLink = (evt: { type: string; source: string }): { link: TabId; label: string } | null => {
      const t = (evt.type + " " + evt.source).toLowerCase();
      if (t.includes("alert") || t.includes("block")) return { link: "alertsIncidents", label: "Alerts & Incidents" };
      if (t.includes("shield") || t.includes("scan")) return { link: "shield", label: "Prompt Shield" };
      if (t.includes("posture") || t.includes("harden")) return { link: "securityPosture", label: "Security Posture" };
      if (t.includes("infra") || t.includes("cpu") || t.includes("memory")) return { link: "infrastructure", label: "Infrastructure" };
      if (t.includes("access") || t.includes("deny") || t.includes("ip")) return { link: "accessLists", label: "Access Lists" };
      if (t.includes("agent")) return { link: "agents", label: "Agents & Sessions" };
      return null;
    };

    const getRecommendation = (c: CorrelationData): string => {
      const rule = c.correlation_rule.toLowerCase();
      if (rule.includes("attack_chain") || rule.includes("coordinated")) return `Investigate the correlated events for coordinated attack activity. Review source agents and block attacker IPs via Access Lists. Consider enabling Block Mode if not already active.`;
      if (rule.includes("token_burn") || rule.includes("runaway")) return `Token burn detected — check for stuck agent loops or denial-of-wallet attacks. Review agent health and consider rate limiting.`;
      return `Review the ${c.event_count} correlated events. Check if the pattern indicates a genuine threat or a false positive from automated processes.`;
    };

    return (
      <>
        {/* v0.8.2+: deep-link banner. Shown only when arrived via Alerts →
            Correlations backlink that carries ?id=<rule_name>. Operator gets
            visible cue + one-click clear.
            v0.8.4+: ref + scrollIntoView on mount when deep-linked so the
            operator doesn't scroll past the banner. The CORRELATION FINDINGS
            card sits below the OVERALL THREAT SCORE + Why-this-score + Top
            Contributing Rules cards which are tall — without auto-scroll
            operators land at the top of the panel and miss the filter context. */}
        {correlationsDeepLinkId && (
          <div
            ref={(el) => {
              if (el) {
                // Defer one frame so the rest of the panel finishes rendering
                // before we scroll. block:start positions the banner at the
                // top of the viewport so the filtered list is immediately
                // visible below it.
                requestAnimationFrame(() => {
                  try { el.scrollIntoView({ behavior: "smooth", block: "start" }); }
                  catch { el.scrollIntoView(); }
                });
              }
            }}
            style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
              padding: "8px 12px", borderRadius: 4,
              background: `${C.cyan}10`, border: `1px solid ${C.cyan}55`,
              fontSize: 11, color: C.txS, fontFamily: F.mono,
            }}
          >
            <span style={{ color: C.cyan, fontWeight: 700 }}>DEEP-LINK</span>
            <span>Filtered to correlation rule <code style={{ color: C.tx }}>{correlationsDeepLinkId}</code> — {visibleCorrs.length} matching event{visibleCorrs.length === 1 ? "" : "s"}.</span>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => updateCorrUrl({ id: "", highlight: "" })}
              title="Remove the deep-link filter and show every correlation"
              style={{
                fontSize: 10, fontWeight: 700, fontFamily: "inherit", letterSpacing: "0.04em",
                padding: "3px 8px", borderRadius: 3,
                background: "transparent", border: `1px solid ${C.cyan}`, color: C.cyan,
                cursor: "pointer", textTransform: "uppercase",
              }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Pagination header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: C.txT }}>
            {correlationsDeepLinkId
              ? `${visibleCorrs.length} of ${apiCorrs.length} correlations`
              : `${apiCorrs.length} correlations`}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select value={corrPageSize} onChange={e => { setCorrPageSize(Number(e.target.value)); setCorrPage(0); }} style={{ fontSize: 11, padding: "2px 6px", background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 3, color: C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}>
              {[5, 10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            {totalPages > 1 && (
              <>
                <button disabled={corrPage === 0} onClick={() => setCorrPage(p => p - 1)} style={{ fontSize: 11, padding: "2px 8px", background: "transparent", border: `1px solid ${C.brd}`, borderRadius: 3, color: corrPage === 0 ? C.txT : C.brand, cursor: corrPage === 0 ? "default" : "pointer" }}>Prev</button>
                <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>{corrPage + 1}/{totalPages}</span>
                <button disabled={corrPage >= totalPages - 1} onClick={() => setCorrPage(p => p + 1)} style={{ fontSize: 11, padding: "2px 8px", background: "transparent", border: `1px solid ${C.brd}`, borderRadius: 3, color: corrPage >= totalPages - 1 ? C.txT : C.brand, cursor: corrPage >= totalPages - 1 ? "default" : "pointer" }}>Next</button>
              </>
            )}
            <button onClick={() => setExpandedCorrs(prev => prev.size > 0 ? new Set() : new Set(pageItems.map(c => c.id)))} style={{ padding: "2px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: C.txS, fontSize: 10, fontFamily: F.mono, cursor: "pointer" }}>{expandedCorrs.size > 0 ? "Collapse All" : "Expand All"}</button>
          </div>
        </div>

        {pageItems.map(c => {
          const sc = sevColor(c.severity);
          const isCritical = c.severity === "CRITICAL";
          const isExpanded = expandedCorrs.has(c.id);

          return (
            <div key={c.id} style={{
              background: isCritical ? `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})` : C.glassSurfTrans,
              border: `1px solid ${C.glassBorderCyan}`,
              borderLeft: `4px solid ${sc}`,
              borderRadius: 10, marginBottom: 8, overflow: "hidden",
              boxShadow: isCritical ? `0 0 20px ${C.danger}22, ${C.glassCardShadow}` : C.glassCardShadow,
            }}>
              {/* Clickable header — always visible */}
              <div onClick={() => setExpandedCorrs(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", cursor: "pointer",
              }}>
                <span style={{ fontSize: 11, color: C.txT, transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>{"▶"}</span>
                <Badge label={c.severity} color={sc} />
                {(() => {
                  const display = c.correlation_rule.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
                  const tip = correlationRuleTip(c.correlation_rule) ?? (c.description ? <span><strong>{display}</strong> — {c.description}</span> : null);
                  const node = <span style={{ fontSize: 14, fontWeight: 700, color: C.tx, flex: 1, ...(tip ? { borderBottom: `1px dotted ${C.txT}`, cursor: "help" } : {}) }}>{display}</span>;
                  return tip ? <Tooltip as="div" placement="top" variant="detail" content={tip}>{node}</Tooltip> : node;
                })()}
                <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>{c.event_count} events</span>
                <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>{timeAgo(c.created_at)}</span>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ padding: "0 18px 18px" }}>
                  <div style={{ fontSize: 13, color: C.txS, marginBottom: 14, lineHeight: 1.5 }}>{c.description}</div>
                  <div style={{ marginBottom: 14 }}>
                    {c.source_events_parsed.map((evt, i) => {
                      const link = getEventLink(evt);
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
                          <div style={{ width: 16, display: "flex", justifyContent: "center", flexShrink: 0, position: "relative" as const }}>
                            <Dot color={sc} size={8} glow={isCritical} />
                            {i < c.source_events_parsed.length - 1 && (
                              <div style={{ position: "absolute" as const, top: 14, left: "50%", transform: "translateX(-50%)", width: 2, height: "calc(100% + 4px)", background: `${sc}33` }} />
                            )}
                          </div>
                          <span style={{ fontFamily: F.mono, fontSize: 12, color: C.txT, minWidth: 65, flexShrink: 0 }}>{evt.time ? new Date(evt.time).toLocaleTimeString() : timeAgo(c.created_at)}</span>
                          <span style={{ fontSize: 12, color: C.txS, flex: 1 }}>{evt.type}</span>
                          {link && (
                            <button onClick={() => onNavigate(link.link)} style={{ background: "transparent", border: "none", color: C.info, fontSize: 11, fontFamily: F.sans, cursor: "pointer", padding: "2px 0", whiteSpace: "nowrap" as const, fontWeight: 600 }}>{link.label} {"→"}</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ padding: "10px 14px", background: `${C.warn}08`, borderRadius: 6, borderTop: `3px solid ${C.warn}`, border: `1px solid ${C.warn}22` }}>
                    <div style={{ fontSize: 10, color: C.warn, fontWeight: 700, marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>AI RECOMMENDATION</div>
                    <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>{getRecommendation(c)}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  // -------------------------------------------------------------------------
  // Findings-list state rendering — chosen so the list can load independently
  // of the summary. If the list already has data, we keep showing it even
  // while a refresh is in-flight.
  // -------------------------------------------------------------------------

  const renderListBody = () => {
    if (demoMode) return renderMockCorrs();

    const hasList = apiCorrs !== null;
    const listEmpty = hasList && (apiCorrs?.length ?? 0) === 0;

    // First load, no data yet.
    if (!hasList && (listState === "loading" || listState === "idle")) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "24px 4px", color: C.txS, fontSize: 13 }}>
          <Dot color={C.warn} size={8} pulse />
          <span>Loading correlation findings…</span>
        </div>
      );
    }

    if (!hasList && listState === "disconnected") {
      return <PanelDisconnected onRetry={refreshList} lastSeen={listQuery.lastUpdated} />;
    }

    if (!hasList && listState === "error") {
      return (
        <PanelErrorState
          title="Couldn't load correlations"
          error={listError || "Unknown error loading correlation findings."}
          onRetry={refreshList}
        />
      );
    }

    if (listEmpty) {
      return (
        <PanelEmptyState
          title="No correlations detected yet"
          description="Correlations link related events across Shield, traffic, infra, audit, and alerts to surface attack patterns like denial-of-wallet, coordinated attack chains, and insider-threat signals. Re-evaluate to scan current platform state, or seed a test correlation to verify the engine."
          actionLabel="Re-evaluate Now"
          onAction={reevaluateAll}
        />
      );
    }

    return renderApiCorrs();
  };

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Why-this-score breakdown — compact per-source table showing raw points,
  // active weight multiplier, and final weighted contribution, plus the
  // correlation multiplier rationale. Makes the top-line threat score
  // self-explaining instead of opaque. Only renders when the evaluator
  // returned the v0.6.2+ weights_applied / correlation_multiplier fields.
  // -------------------------------------------------------------------------

  const renderWhyThisScore = () => {
    if (demoMode || !summary) return null;
    const weightsApplied = summary.weights_applied;
    const multiplier = summary.correlation_multiplier;
    if (!weightsApplied || multiplier === undefined) return null;
    const rows = Object.entries(summary.breakdown)
      .filter(([, weighted]) => weighted > 0)
      .sort((a, b) => b[1] - a[1]);
    if (rows.length === 0) return null;

    const rawScore = summary.raw_score ?? rows.reduce((acc, [, v]) => acc + v, 0);
    const multiplierLabel =
      multiplier >= 2.5 ? `${multiplier}× — 3+ triggered rules across 3+ unique sources`
      : multiplier >= 2.0 ? `${multiplier}× — 3+ triggered rules`
      : multiplier >= 1.5 ? `${multiplier}× — 2+ triggered rules`
      : `${multiplier}× — single-rule or single-source event`;

    return (
      <details className="cn-disclosure" style={{
        margin: "12px 0 16px",
        background: `${C.info}0a`,
        border: `1px solid ${C.info}33`,
        borderLeft: `3px solid ${C.info}`,
        borderRadius: 6,
      }}>
        <summary style={{
          cursor: "pointer",
          padding: "10px 14px",
          fontSize: 11,
          fontWeight: 700,
          color: C.info,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          listStyle: "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="cn-caret">▶</span>
            <span>Why this score</span>
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.txT, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
            {rawScore.toFixed(1)} raw × {multiplier}× = {summary.threat_score}
          </span>
        </summary>
        <div style={{ padding: "4px 14px 14px" }}>
          <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.6, marginBottom: 10 }}>
            Each triggered correlation rule contributes points to the sources it observed. Points are scaled by the active risk weight for that source, then the total is multiplied by a correlation multiplier that rewards multi-rule, multi-source attack patterns. Tune the weights at <span style={{ fontFamily: F.mono, color: C.cyan }}>Configuration → Threat Score Weights</span>.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.mono }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.brd}` }}>
                <th style={{ padding: "6px 8px", textAlign: "left" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>Source</th>
                <th style={{ padding: "6px 8px", textAlign: "right" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>Raw pts</th>
                <th style={{ padding: "6px 8px", textAlign: "right" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>Weight</th>
                <th style={{ padding: "6px 8px", textAlign: "right" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>Weighted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([source, weighted]) => {
                const weight = weightsApplied[source] ?? 1;
                const raw = weight > 0 ? weighted / weight : weighted;
                const srcColor =
                  source === "shield" ? C.brand :
                  source === "infra" ? C.cyan :
                  source === "token" ? C.orange :
                  source === "access" ? C.info :
                  source === "breakglass" ? C.danger :
                  source === "audit" ? C.purp :
                  source === "alerts" ? C.warn :
                  source === "traffic" ? C.green :
                  C.txS;
                return (
                  <tr key={source} style={{ borderBottom: `1px solid ${C.brd}14` }}>
                    <td style={{ padding: "5px 8px", color: C.tx }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Dot color={srcColor} size={6} />
                        {source}
                      </span>
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right" as const, color: C.txS }}>{raw.toFixed(1)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" as const, color: weight === 1 ? C.txT : weight > 1 ? C.warn : C.info }}>{weight.toFixed(2)}×</td>
                    <td style={{ padding: "5px 8px", textAlign: "right" as const, color: srcColor, fontWeight: 700 }}>{weighted.toFixed(1)}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `1px solid ${C.brd}` }}>
                <td style={{ padding: "6px 8px", color: C.txT, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>Raw total</td>
                <td style={{ padding: "6px 8px" }} />
                <td style={{ padding: "6px 8px" }} />
                <td style={{ padding: "6px 8px", textAlign: "right" as const, color: C.tx, fontWeight: 700 }}>{rawScore.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{
            marginTop: 10,
            padding: "8px 10px",
            background: `${C.brand}08`,
            border: `1px solid ${C.brand}22`,
            borderRadius: 4,
            fontSize: 11,
            color: C.txS,
            lineHeight: 1.55,
          }}>
            <div style={{ color: C.brand, fontWeight: 700, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3 }}>Correlation multiplier</div>
            {multiplierLabel}. Final score: <span style={{ fontFamily: F.mono, color: C.tx }}>{rawScore.toFixed(1)} × {multiplier} = {Math.min(100, Math.round(rawScore * multiplier))}</span> (capped at 100).
          </div>
        </div>
      </details>
    );
  };

  // -------------------------------------------------------------------------
  // Top Contributing Rules — v0.7.2 SP-4 polish.
  //
  // Mirrors the Blast Radius panel's `drivers[]` pattern: shows which
  // correlation rules contributed the most to the current threat score,
  // with explicit per-rule contribution, severity, sources observed, and a
  // truncated description. Closes the "operators can't see *which* rules
  // produced the score" gap that "Why this score" only addressed at the
  // per-source level.
  //
  // Renders only when `summary.rules` is present (v0.6.2+ evaluator
  // response) and at least one rule is triggered. If no rules triggered,
  // we render nothing — the threat score being 0 with no contributors is
  // self-explaining.
  // -------------------------------------------------------------------------

  const renderTopContributingRules = () => {
    if (demoMode || !summary || !summary.rules) return null;
    const triggered = summary.rules.filter((r) => r.triggered).slice();
    if (triggered.length === 0) return null;

    triggered.sort((a, b) => b.score - a.score);
    const top = triggered.slice(0, 5);
    const totalContribution = triggered.reduce((acc, r) => acc + r.score, 0);

    const sevColor = (sev: string) =>
      sev === "CRITICAL" ? C.danger :
      sev === "HIGH" ? C.orange :
      sev === "MEDIUM" ? C.warn :
      C.info;

    return (
      <details
        className="cn-disclosure"
        style={{
          margin: "0 0 16px",
          background: `${C.brand}0a`,
          border: `1px solid ${C.brand}33`,
          borderLeft: `3px solid ${C.brand}`,
          borderRadius: 6,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            padding: "10px 14px",
            fontSize: 11,
            fontWeight: 700,
            color: C.brand,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            listStyle: "none",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
          title="Top contributing correlation rules — ranked by raw point contribution to the current threat score. Source: /api/correlations/evaluate.rules[]. Click to expand."
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="cn-caret">▶</span>
            <span>Top Contributing Rules</span>
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.txT, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
            {top.length} of {triggered.length} triggered · {totalContribution.toFixed(0)} raw pts
          </span>
        </summary>
        <div style={{ padding: "4px 14px 14px" }}>
          <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.6, marginBottom: 10 }}>
            Each row is a rule that fired in the current window, ranked by raw point contribution before source weighting. Multiply by the source weight (see &quot;Why this score&quot;) to get the rule&apos;s weighted contribution. Sources column shows which signals the rule observed.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.mono }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.brd}` }}>
                <th style={{ padding: "6px 8px", textAlign: "left" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em", width: 28 }}>#</th>
                <th style={{ padding: "6px 8px", textAlign: "left" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>Rule</th>
                <th style={{ padding: "6px 8px", textAlign: "left" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>Severity</th>
                <th style={{ padding: "6px 8px", textAlign: "right" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>Raw pts</th>
                <th style={{ padding: "6px 8px", textAlign: "right" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>% of total</th>
                <th style={{ padding: "6px 8px", textAlign: "left" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>Sources</th>
                <th style={{ padding: "6px 8px", textAlign: "right" as const, color: C.txT, fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}></th>
              </tr>
            </thead>
            <tbody>
              {top.map((r, i) => {
                const pct = totalContribution > 0 ? (r.score / totalContribution) * 100 : 0;
                return (
                  <tr key={r.rule} style={{ borderBottom: `1px solid ${C.brd}14` }}>
                    <td style={{ padding: "6px 8px", color: C.txT, fontWeight: 700 }}>{i + 1}</td>
                    <td
                      style={{ padding: "6px 8px", color: C.tx }}
                      title={r.description}
                    >
                      {r.rule}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: `${sevColor(r.severity)}22`,
                          color: sevColor(r.severity),
                          border: `1px solid ${sevColor(r.severity)}55`,
                          textTransform: "uppercase" as const,
                        }}
                      >
                        {r.severity}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" as const, color: sevColor(r.severity), fontWeight: 700 }}>
                      {r.score.toFixed(0)}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" as const, color: C.txS }}>
                      {pct.toFixed(0)}%
                    </td>
                    <td style={{ padding: "6px 8px", color: C.txT, fontSize: 11 }}>
                      {r.sources.join(", ") || "—"}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" as const }}>
                      <AcceptRiskButton
                        query={{
                          source_panel: "correlations",
                          rule_id: r.rule,
                          agent_id: null,
                          surface_id: null,
                          evidence: [...r.sources].sort(),
                        }}
                        onAccepted={refreshSummary}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Snoozed Rules — v0.8.0+. Triggered rules excluded from the
              active threat score by accepted risks. 30-day default expiry
              for correlations because rules describe recurring patterns
              (per spec §7 / DEFAULT_EXPIRY_DAYS). */}
          {summary.suppressedRules && summary.suppressedRules.length > 0 && (
            <AcceptedRisksSection count={summary.suppressedRules.length}>
              {summary.suppressedRules.map((s) => (
                <SuppressedFindingCard
                  key={`sup-${s.acceptance.id}`}
                  title={`${s.rule} (${s.severity}, ${s.score} raw pts)`}
                  acceptance={s.acceptance}
                  meta={`sources: ${s.sources.join(", ")}`}
                  onRevoked={refreshSummary}
                />
              ))}
            </AcceptedRisksSection>
          )}
        </div>
      </details>
    );
  };

  // -------------------------------------------------------------------------
  // Starter-templates empty state — shown when the operator has zero custom
  // rules. Deliberately NOT pre-seeded at install time: templates are
  // applied by explicit operator choice so they don't fire false positives
  // on day-1 deployments with no real telemetry yet.
  // -------------------------------------------------------------------------

  const renderStarterTemplates = () => {
    if (demoMode) return null;
    if (customRuleCount === null || customRuleCount > 0) return null;

    return (
      <div style={{
        margin: "16px 0",
        padding: "14px 16px",
        background: `${C.brand}08`,
        border: `1px solid ${C.brand}33`,
        borderLeft: `3px solid ${C.brand}`,
        borderRadius: 6,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.brand, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
          Start with a common correlation rule
        </div>
        <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.55, marginBottom: 12 }}>
          You have no custom rules yet. Apply a starter template with one click — it&rsquo;ll land enabled and start watching for its pattern.
          You can edit, disable, or delete any of these from Configuration → Correlation Rules at any time.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
          {CORRELATION_STARTER_TEMPLATES.map(tpl => {
            const busy = applyingTemplate === tpl.key;
            const result = applyResult?.key === tpl.key ? applyResult : null;
            return (
              <div key={tpl.key} style={{
                padding: "10px 12px",
                background: C.glassSurfTrans,
                border: `1px solid ${C.glassSurfBorder}`,
                borderRadius: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: C.tx }}>{tpl.name}</span>
                  <Badge label={tpl.severity.toUpperCase()} color={sevColor(tpl.severity)} />
                </div>
                <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.55, marginBottom: 10 }}>
                  {tpl.description}
                </div>
                <Tooltip placement="top" variant="detail" content={<span>Create the rule directly with the template&apos;s pre-tuned conditions, threshold, and time window. Lands as <strong>enabled</strong> in <strong>Custom Correlation Rules</strong>. You can edit it after — this just spares you from typing the conditions from scratch.</span>}>
                  <button
                    onClick={() => applyStarterTemplate(tpl)}
                    disabled={busy || applyingTemplate !== null}
                    style={{
                      padding: "5px 12px",
                      background: busy ? `${C.brand}22` : `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`,
                      border: 0,
                      borderRadius: 10,
                      color: busy ? C.brand : "#06121f",
                      fontSize: 11,
                      fontWeight: 850,
                      fontFamily: F.mono,
                      cursor: busy || applyingTemplate !== null ? "wait" : "pointer",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase" as const,
                    }}
                  >
                    {busy ? "APPLYING…" : "APPLY"}
                  </button>
                </Tooltip>
                {result && (
                  <div style={{ marginTop: 8, fontSize: 11, color: result.ok ? C.green : C.danger, lineHeight: 1.5 }}>
                    {result.message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab; child
    // cards carry chrome. Mission Control is the baseline.
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* v0.7.3: scoped CSS for disclosure carets — `<details>` strips its
          native marker via listStyle:none for visual consistency, and an
          explicit .cn-caret chevron rotates 90° when the disclosure opens.
          Rules live in src/app/globals.css (`.cn-disclosure > summary
          .cn-caret` + `.cn-disclosure[open] > summary .cn-caret`) — H2
          2026-05-14 migration to drop CSP style-src 'unsafe-inline'. */}

      {/* Summary block (non-demo only) */}
      {renderSummaryBlock()}

      {/* Why-this-score — collapsible breakdown showing per-source raw pts,
          active weight, and correlation multiplier rationale. */}
      {renderWhyThisScore()}

      {/* Top Contributing Rules — v0.7.2 SP-4 polish: per-rule contribution
          drivers, mirroring Blast Radius drivers[] pattern. */}
      {renderTopContributingRules()}

      {/* Starter templates — shown only when the operator has no custom rules */}
      {renderStarterTemplates()}

      {/* Demo mode: show mock correlations first, then live API section header */}
      {demoMode && filteredMockCorrs.length > 0 && renderMockCorrs()}

      {demoMode && apiCorrs && apiCorrs.length > 0 && (
        <div style={{ fontSize: 13, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", margin: "16px 0 8px", fontFamily: F.sans }}>
          Live API Correlations
        </div>
      )}

      {/* Live findings list — always rendered when not in demo, with its own state handling */}
      {!demoMode && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: F.sans }}>
              Correlation Findings
            </span>
            <PanelStateBar
              state={listState}
              lastUpdated={listQuery.lastUpdated}
              onRefresh={refreshList}
            />
          </div>
          {renderListBody()}
        </div>
      )}

      {/* Demo-mode fallthrough: when mock + live are both empty, surface the seed
          helper — but only when Developer Tools are enabled. With Developer Tools
          off, the empty state shows without the seed action. */}
      {demoMode && apiCorrs !== null && apiCorrs.length === 0 && filteredMockCorrs.length === 0 && (
        devToolsAvailable
          ? <EmptyState message="No correlations detected. Seed test data to verify the engine works." action={{ label: "Seed Test Correlation", onClick: seedTestCorrelation }} />
          : <EmptyState message="No correlations detected." />
      )}

      {/* Non-demo empty: PanelEmptyState above already handles the empty
          message. Seed button only renders when Developer Tools are enabled
          (Configuration → Developer Tools), since seeding test correlations
          is a developer/QA action that doesn't belong in operator-prod. */}
      {!demoMode && apiCorrs !== null && apiCorrs.length === 0 && devToolsAvailable && (
        <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
          <button
            onClick={seedTestCorrelation}
            disabled={seeding}
            style={{
              padding: "6px 14px", borderRadius: 6,
              border: `1px solid ${C.brd}`, background: "transparent",
              color: C.txS, fontSize: 11, fontFamily: F.mono, cursor: seeding ? "wait" : "pointer",
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}
          >
            {seeding ? "Seeding…" : "Seed Test Correlation"}
          </button>
        </div>
      )}

      {/* Seed result feedback */}
      {seedResult && (
        <div style={{ marginTop: 12, fontSize: 12, color: C.txS, fontFamily: F.sans }}>{seedResult}</div>
      )}
    </div>
  );
}
