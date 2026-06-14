"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { C, F } from "../constants";
import { Badge, LoadingSpinner, EmptyState } from "../shared";
import { Tooltip } from "../tooltip";
import { buildFilterQuery, sevColor } from "../utils";
import type { TabId, DashboardFilters, AlertData, EvidencePayload } from "../types";
import { ALERTS_D } from "../mock-data";
import { AcceptRiskButton } from "../risk-acceptance/AcceptRiskWidget";
// v0.8.2+: URL-state-driven deep-link support. When the Alerts panel is
// opened with #tab=alertsIncidents&id=<alertId>&highlight=<alertId> (e.g.
// from the Instance Detail Timeline backlink), the list filters to that
// exact alert and the matching row gets a brief pulse animation. Operator
// can clear via the inline banner.
import { useHashState, type NavigateOpts } from "../url-state";
import { useHighlightPulse } from "../useHighlightPulse";
import { PanelFilters } from "../PanelFilters";
import { MissionControlBreadcrumb } from "./mission-control/MissionControlBreadcrumb";
import { TriageGraphCard } from "../triage/TriageGraphCard";
import { resolveAlertTriageGraph } from "../triage/alert-resolver";

// v0.8.2+: onNavigate accepts the v0.8.2 opts shape so backlinks (correlation
// alerts → Correlations panel; source-aware backlinks → Shield / Audit /
// Traffic Monitor) can carry an id that pre-filters the destination.
//
// v0.11.x+: View Evidence is now a navigation backlink to the exact audit row
// in Audit & Evidence (operator feedback: landing on the tab root is "not good
// enough"). The handler resolves audit_event_id via /api/alerts/:id/evidence
// then calls onNavigate("auditEvidence", { id, focus: "evidence" }). The
// inline-expand UI is retained as a fallback when navigate isn't passed
// (legacy mounts) or the API returns an error or a missing audit_event_id.
//
// v0.11.3+ (Wave 1 of alert→evidence backlink hardening):
//   - The View Evidence handler now passes `fromAlert: alert.id` in the
//     navigate opts so AuditEvidencePanel can render a "← Back to Incident"
//     breadcrumb that lands the operator back on this alert.
//   - `focusedAlertId` + `onAlertFocusConsumed` enable that return path:
//     when set, this panel scrolls the matching alert into view, expands
//     it, briefly highlights it (the existing pulse animation), then calls
//     `onAlertFocusConsumed` so the parent clears the focus state.
//   - Correlation method (forward / fallback_nearest) is now reflected in
//     the inline EVD fallback view as an exact-vs-best-match pill. Same
//     labeling as AuditEvidencePanel — operators always know whether the
//     link is deterministic or a heuristic.
export function AlertsIncidentsPanel({ filters, demoMode, onNavigate, focusedAlertId, onAlertFocusConsumed, incomingFromMissionControl, onMissionControlBackConsumed }: {
  filters: DashboardFilters;
  demoMode: boolean;
  // The opts shape mirrors the dashboard root's `navigate(tab, opts)` (see
  // src/components/dashboard/index.tsx) so we can pass `focus`/`id` through.
  // v0.11.3+: `fromAlert` lets View Evidence carry the originating alert id
  // forward so AuditEvidencePanel can render a breadcrumb back here.
  onNavigate: (tab: TabId, opts?: NavigateOpts) => void;
  focusedAlertId?: string | null;
  onAlertFocusConsumed?: () => void;
  // v0.12.0+: Mission Control return path. When set, renders the breadcrumb.
  incomingFromMissionControl?: boolean;
  onMissionControlBackConsumed?: () => void;
}) {
  const [apiAlerts, setApiAlerts] = useState<AlertData[] | null>(null);
  const [freshCounter, setFreshCounter] = useState(8);

  const [includeSuppressed, setIncludeSuppressed] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const qs = buildFilterQuery(filters, { limit: "100" });
      // v0.9.3+: explicit scope=active aligns with the canonical metric
      // contract. Operator-facing surfaces show alerts that need attention
      // (open + acknowledged + investigating) by default. The Show Suppressed
      // toggle layers suppressed alerts on without changing the rest of the
      // scope.
      const url = includeSuppressed
        ? `/api/alerts?${qs}&scope=active&include_suppressed=true`
        : `/api/alerts?${qs}&scope=active`;
      const res = await fetch(url);
      if (res.ok) { const data = await res.json(); setApiAlerts(data.alerts || []); setFreshCounter(8); }
    } catch {}
  }, [filters, includeSuppressed]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 15000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Freshness counter tick
  useEffect(() => {
    const tick = setInterval(() => setFreshCounter(c => c + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  // v0.8.4+: workflow actions broaden to include "investigate" — distinct
  // from acknowledge ("I'm aware") and resolve ("I'm done"). Investigate
  // means "I'm actively diagnosing root cause" so operators can signal
  // active work-in-flight to colleagues / on-call rotations.
  const handleAction = useCallback(async (id: string, action: "acknowledge" | "investigate" | "resolve") => {
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, by: "operator" }) });
      if (res.ok) fetchAlerts();
    } catch {}
  }, [fetchAlerts]);

  // v0.8.2+: filter state lives in URL hash via useHashState. severity / source
  // / status are multi-select CSV; q is freeform search. Local React state for
  // alertSevFilter / alertSourceFilter / alertStatusFilter has been removed in
  // favor of the URL — refresh / back-button / share-via-paste all preserve the
  // filtered view, and cross-panel deep-links carrying ?id=… pin the list to
  // that exact row regardless of dropdown selections.
  const [urlState, updateUrl] = useHashState();
  const sevSel = urlState.severity ?? [];
  const sourceSel = urlState.source ?? [];
  const statusSel = urlState.status ?? [];
  const ageSel = urlState.age ?? [];
  const qFilter = (urlState.q ?? "").toLowerCase();
  const deepLinkId = urlState.id;
  const highlightId = urlState.highlight ?? urlState.id;
  // Pagination + row-expansion stay in local state — they're per-render
  // ephemeral, not view state worth preserving across reload.
  const [alertPageSize, setAlertPageSize] = useState(15);
  const [alertPage, setAlertPage] = useState(0);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  // T12: inline triage investigation card. Single-expand: only one alert at a
  // time can have its TriageGraphCard open. Separate from expandedAlerts (which
  // controls the description/workflow body) so operators can have the
  // description expanded without the full triage graph, and vice-versa.
  const [investigatingAlertId, setInvestigatingAlertId] = useState<string | null>(null);
  // Evidence inline-expand state. Keyed by alert id. Lazily fetched on first
  // open of "View Evidence". { loading | record | error } captures the three
  // possible states without a separate boolean per alert.
  type EvidenceState =
    | { kind: "loading" }
    | { kind: "ok"; data: EvidencePayload }
    | { kind: "error"; message: string };
  const [evidenceMap, setEvidenceMap] = useState<Record<string, EvidenceState>>({});

  const fetchEvidence = useCallback(async (alertId: string) => {
    setEvidenceMap(prev => ({ ...prev, [alertId]: { kind: "loading" } }));
    try {
      const res = await fetch(`/api/alerts/${alertId}/evidence`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setEvidenceMap(prev => ({
          ...prev,
          [alertId]: { kind: "error", message: body?.reason || body?.error || `HTTP ${res.status}` },
        }));
        return;
      }
      const data = (await res.json()) as EvidencePayload;
      setEvidenceMap(prev => ({ ...prev, [alertId]: { kind: "ok", data } }));
    } catch (err) {
      setEvidenceMap(prev => ({
        ...prev,
        [alertId]: { kind: "error", message: err instanceof Error ? err.message : "Network error" },
      }));
    }
  }, []);

  const toggleEvidence = useCallback((alertId: string) => {
    if (evidenceMap[alertId]) {
      // Already loaded / loading — collapse.
      setEvidenceMap(prev => {
        const next = { ...prev };
        delete next[alertId];
        return next;
      });
      return;
    }
    fetchEvidence(alertId);
  }, [evidenceMap, fetchEvidence]);

  // v0.11.x+: primary "View Evidence" handler. Resolves the alert's audit
  // row via /api/alerts/:id/evidence, then deep-links to Audit & Evidence
  // pre-focused on that exact row. We don't reuse `evidenceMap` here so a
  // stale failed fetch doesn't permanently route the operator into the
  // inline fallback — fresh attempt every click.
  //
  // Fallback hierarchy (each step is a distinct user-visible failure mode):
  //   1. /api/alerts/:id/evidence non-OK → inline-expand renders the error.
  //   2. Response is OK but lacks audit_event_id → inline-expand renders
  //      whatever the payload had (degraded but useful).
  //   3. Network throw → inline-expand renders the network error.
  //   4. onNavigate not passed (legacy mount) → fall straight to
  //      inline-expand without a network round-trip.
  //
  // Operator-perceptible: the button is now a navigation that occasionally
  // collapses to inline detail when the deep-link target can't be resolved.
  const openEvidenceLink = useCallback(async (alertId: string) => {
    if (!onNavigate) {
      // Defensive: legacy callers might have passed undefined. Fall back
      // to the prior toggle behavior so the operator still sees evidence.
      toggleEvidence(alertId);
      return;
    }
    try {
      const res = await fetch(`/api/alerts/${alertId}/evidence`);
      if (!res.ok) {
        // Surface the API error inline — same UX path as the legacy fetch.
        const body = await res.json().catch(() => ({}));
        setEvidenceMap(prev => ({
          ...prev,
          [alertId]: { kind: "error", message: body?.reason || body?.error || `HTTP ${res.status}` },
        }));
        return;
      }
      const data = (await res.json()) as EvidencePayload;
      const auditId = data.audit_event_id;
      if (!auditId || typeof auditId !== "string" || auditId.length === 0) {
        // Payload shape is OK but no audit row was correlated. Render the
        // inline payload so the operator at least sees the detection
        // detail — better than dropping them into Audit & Evidence with
        // no anchor.
        setEvidenceMap(prev => ({ ...prev, [alertId]: { kind: "ok", data } }));
        return;
      }
      // Happy path: deep-link to the exact row. `focus: "evidence"` is
      // semantic-only today — the panel keys its effect on `id` — but
      // keeps the navigate() opts shape consistent with the rest of the
      // codebase (configFocus uses focus, auditFocus uses id).
      // v0.11.3+: pass `fromAlert` so AuditEvidencePanel can render a
      // "← Back to Incident" breadcrumb.
      onNavigate("auditEvidence", { id: auditId, focus: "evidence", fromAlert: alertId });
    } catch (err) {
      setEvidenceMap(prev => ({
        ...prev,
        [alertId]: { kind: "error", message: err instanceof Error ? err.message : "Network error" },
      }));
    }
  }, [onNavigate, toggleEvidence]);

  // Decide whether to surface the "View Evidence" link for a given alert.
  // Two rules — either is sufficient:
  //   1. The alert source is in a known evidence-bearing set (start with
  //      session-watcher; others can be added as their evidence shape lands).
  //   2. The alert's metadata parses to JSON containing audit_event_id —
  //      future-proofs against new sources that opt into the same backlink
  //      contract.
  function alertHasEvidence(a: AlertData): boolean {
    if (a.source === "session-watcher") return true;
    if (!a.metadata) return false;
    try {
      const parsed = JSON.parse(a.metadata) as { audit_event_id?: unknown };
      return typeof parsed.audit_event_id === "string" && parsed.audit_event_id.length > 0;
    } catch {
      return false;
    }
  }

  // v0.8.2+: highlight-on-arrival. When the URL carries a highlight (or id),
  // find the matching row by data-alert-id attribute, scroll it into view,
  // and apply the pulse class for the animation. Done at panel level (not
  // per-row) because React forbids calling hooks inside .map() — the row
  // markup carries the data attribute and this effect drives the animation.
  useEffect(() => {
    if (!highlightId) return;
    // Lazily inject the keyframe + class once. Idempotent.
    const flag = "__clawnex_highlight_pulse_injected__";
    const w = window as unknown as Record<string, unknown>;
    if (!w[flag]) {
      w[flag] = true;
      const style = document.createElement("style");
      style.textContent = `
        @keyframes clawnex-highlight-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.6); background-color: rgba(94, 234, 212, 0.18); }
          40%  { box-shadow: 0 0 0 6px rgba(94, 234, 212, 0.0); background-color: rgba(94, 234, 212, 0.10); }
          100% { box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.0); background-color: transparent; }
        }
        .clawnex-highlight-pulse {
          animation: clawnex-highlight-pulse 2000ms ease-out 2;
          border-radius: 6px;
          transition: background-color 200ms ease;
        }
      `;
      document.head.appendChild(style);
    }
    // Defer one frame so the row exists in the DOM after re-render.
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-alert-id="${CSS.escape(highlightId)}"]`);
      if (!el) return;
      try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { el.scrollIntoView(); }
      el.classList.add("clawnex-highlight-pulse");
      setTimeout(() => el.classList.remove("clawnex-highlight-pulse"), 4200);
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightId, apiAlerts]);

  // v0.11.3+ / v0.11.4+: imperative focus driven by parent state (Back to
  // Incident path). When `focusedAlertId` is set we scroll the matching alert
  // into view, expand it (so the operator sees the description + workflow
  // buttons), and run the existing pulse animation. After we've staged those
  // effects we call `onAlertFocusConsumed` so the parent clears the focus —
  // without that reset, returning to this tab from any other path would
  // re-trigger.
  //
  // v0.11.4 fixes two race conditions in the v0.11.3 implementation:
  //   1. apiAlerts gating: if focusedAlertId arrives before the alerts fetch
  //      settles, the DOM has no alert rows yet and querySelector returns
  //      null. The previous version would consume the focus anyway and the
  //      scroll/highlight would silently do nothing. Now we wait for
  //      apiAlerts !== null and let the effect re-run when it settles.
  //   2. consume-after-raf: previously `onAlertFocusConsumed?.()` was called
  //      synchronously after scheduling the raf. The parent's setAlertFocus
  //      (null) caused this effect to re-run with `focusedAlertId === null`,
  //      which fired the cleanup function, which called
  //      cancelAnimationFrame(raf) BEFORE the raf fired — so scroll/highlight
  //      never ran. Now consume happens INSIDE the raf callback after the DOM
  //      work is staged.
  useEffect(() => {
    if (!focusedAlertId) return;
    if (apiAlerts === null) return; // wait for fetch — DOM has no alert rows yet
    // Lazily inject the keyframe + class once. Reuses the same animation
    // class as the URL-driven highlight path so visual treatment is identical
    // regardless of how the operator arrived.
    const flag = "__clawnex_highlight_pulse_injected__";
    const w = window as unknown as Record<string, unknown>;
    if (!w[flag]) {
      w[flag] = true;
      const style = document.createElement("style");
      style.textContent = `
        @keyframes clawnex-highlight-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.6); background-color: rgba(94, 234, 212, 0.18); }
          40%  { box-shadow: 0 0 0 6px rgba(94, 234, 212, 0.0); background-color: rgba(94, 234, 212, 0.10); }
          100% { box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.0); background-color: transparent; }
        }
        .clawnex-highlight-pulse {
          animation: clawnex-highlight-pulse 2000ms ease-out 2;
          border-radius: 6px;
          transition: background-color 200ms ease;
        }
      `;
      document.head.appendChild(style);
    }
    // Expand the row first so the description is visible when the pulse fires.
    setExpandedAlerts(prev => {
      if (prev.has(focusedAlertId)) return prev;
      const n = new Set(prev);
      n.add(focusedAlertId);
      return n;
    });
    // Capture id locally — focusedAlertId may be cleared by the time raf fires.
    const targetId = focusedAlertId;
    // Defer scroll/highlight one frame so the row is in the DOM after re-render.
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-alert-id="${CSS.escape(targetId)}"]`);
      if (el) {
        try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { el.scrollIntoView(); }
        el.classList.add("clawnex-highlight-pulse");
        setTimeout(() => el.classList.remove("clawnex-highlight-pulse"), 4200);
      }
      // Tell the parent we've consumed the focus so it can null its state.
      // Doing this INSIDE the raf (not synchronously after scheduling it)
      // prevents the parent's state change from triggering this effect's
      // cleanup, which would cancelAnimationFrame the raf before it fires.
      onAlertFocusConsumed?.();
    });
    return () => cancelAnimationFrame(raf);
    // onAlertFocusConsumed intentionally excluded from deps — stable parent
    // ref; including it would re-run on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedAlertId, apiAlerts]);

  const filteredAlerts = useMemo(() => {
    return (apiAlerts || []).filter(a => {
      // Deep-link id wins over multi-select filters — the operator landed
      // here because they wanted THIS row.
      if (deepLinkId && a.id !== deepLinkId) return false;
      if (sevSel.length > 0 && !sevSel.includes(a.severity)) return false;
      if (sourceSel.length > 0 && !sourceSel.includes(a.source)) return false;
      if (statusSel.length > 0 && !statusSel.includes(a.status)) return false;
      // v0.13.0+: age-bucket filter set by IncidentAging drill-through.
      if (ageSel.length > 0) {
        const ageMs = Date.now() - new Date(a.created_at).getTime();
        if (!ageSel.some((bucket) => matchesAgeBucket(ageMs, bucket))) return false;
      }
      if (qFilter) {
        const haystack = `${a.title} ${a.description ?? ""} ${a.source} ${a.severity}`.toLowerCase();
        if (!haystack.includes(qFilter)) return false;
      }
      return true;
    });
  }, [apiAlerts, sevSel, sourceSel, statusSel, ageSel, qFilter, deepLinkId]);

  const alertTotalPages = Math.ceil(filteredAlerts.length / alertPageSize);
  const pagedAlerts = filteredAlerts.slice(alertPage * alertPageSize, (alertPage + 1) * alertPageSize);

  const uniqueSources = useMemo(() => Array.from(new Set((apiAlerts || []).map(a => a.source).filter(Boolean))).sort(), [apiAlerts]);

  // Reset to page 1 whenever any filter dimension changes.
  useEffect(() => { setAlertPage(0); }, [sevSel, sourceSel, statusSel, ageSel, qFilter, alertPageSize]);

  // SLA color helper
  const slaColor = (minutes: number): string => {
    if (minutes <= 30) return C.danger;
    if (minutes <= 120) return C.orange;
    return C.green;
  };

  // Status badge color and style
  const statusColor = (status: string): string => {
    switch (status.toUpperCase()) {
      case "OPEN": return C.danger;
      case "INVESTIGATING": return C.orange;
      case "MITIGATED": return C.warn;
      case "RESOLVED": return C.green;
      default: return C.txS;
    }
  };

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
      {/* v0.12.0+: Mission Control return breadcrumb. Only visible when the
          operator arrived via Mission Control drill-down. */}
      <MissionControlBreadcrumb
        visible={!!incomingFromMissionControl}
        onClick={() => onMissionControlBackConsumed?.()}
      />
      {/* Title with freshness */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: F.sans }}>INCIDENT BOARD</span>
        <span style={{ fontSize: 13, color: C.txT, fontFamily: F.mono }}>{"\u21BB"}{freshCounter}s</span>
      </div>

      {/* v0.8.2+: deep-link banner. Shown only when arrived via a backlink
          carrying ?id=<alertId>. Makes the "you're filtered" state visible
          and gives operator a one-click clear. Without this banner the
          operator might wonder why they only see one row. */}
      {deepLinkId && (
        <div
          ref={(el) => {
            // v0.8.4+: scroll the deep-link banner into view on mount so
            // operators don't miss it. Same pattern as CorrelationsPanel.
            if (el) {
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
          <span>Filtered to alert id <code style={{ color: C.tx }}>{deepLinkId.slice(0, 12)}{deepLinkId.length > 12 ? "\u2026" : ""}</code> from another panel.</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => updateUrl({ id: "", highlight: "" })}
            title="Remove the deep-link filter and show every alert"
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

      {/* v0.8.2+: filter row uses the shared PanelFilters widget instead of
          hand-rolled <select> dropdowns. Filter values are URL-state-driven
          so refresh / back-button / share-via-paste all work, and Timeline
          deep-links can pre-populate filters via the navigate() opts.
          The include-suppressed checkbox stays separate because it's a
          fetch-time toggle (controls the /api/alerts query param) rather
          than a client-side filter dimension. */}
      {apiAlerts !== null && !demoMode && (
        <PanelFilters
          config={{
            search: { placeholder: "Search title, description, source, severity…" },
            severity: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"],
            source: uniqueSources,
            status: ["open", "acknowledged", "investigating", "resolved", "suppressed", "false_positive"],
          }}
          values={urlState}
          onChange={(patch) => updateUrl(patch)}
          resultCount={filteredAlerts.length}
          totalCount={apiAlerts?.length ?? 0}
          showIdBadge
        />
      )}
      {/* v0.13.0+: age-bucket filter chips. Set by IncidentAging drill-through;
          mirrors the severity filter chip pattern. Visible only when active. */}
      {ageSel.length > 0 && apiAlerts !== null && !demoMode && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>Age:</span>
          {ageSel.map((bucket) => (
            <span
              key={bucket}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                fontFamily: F.mono, background: `${C.cyan}22`, color: C.cyan,
                border: `1px solid ${C.cyan}55`,
                letterSpacing: "0.05em", textTransform: "uppercase",
              }}
            >
              {bucket}
              <button
                onClick={() => updateUrl({ age: ageSel.filter((b) => b !== bucket) })}
                aria-label={`Remove age filter: ${bucket}`}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: C.cyan, fontSize: 11, padding: 0, lineHeight: 1, fontFamily: "inherit",
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={() => updateUrl({ age: [] })}
            style={{
              fontSize: 10, fontFamily: F.mono, padding: "2px 7px", borderRadius: 3,
              border: `1px solid ${C.brd}`, background: "transparent", color: C.txT, cursor: "pointer",
            }}
          >
            Clear age filter
          </button>
        </div>
      )}
      {/* include-suppressed + page-size — fetch-time toggle + view-only state,
          both kept outside PanelFilters since they're not URL-filter dimensions. */}
      {apiAlerts !== null && !demoMode && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          <Tooltip placement="top" variant="detail" content={<span>When on, suppressed alerts (matched by an active <strong>risk acceptance</strong>) are returned alongside open alerts. Off by default so headline counts and severity badges reflect only what still needs attention.</span>}>
            <label
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: includeSuppressed ? C.txT : C.txG, cursor: "pointer", fontFamily: F.mono }}
            >
              <input type="checkbox" checked={includeSuppressed} onChange={(e) => setIncludeSuppressed(e.target.checked)} />
              include suppressed
            </label>
          </Tooltip>
          <div style={{ flex: 1 }} />
          <select value={String(alertPageSize)} onChange={e => setAlertPageSize(parseInt(e.target.value))} style={{ fontSize: 11, padding: "2px 6px", background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 3, color: C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}>
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="25">25</option>
            <option value="50">50</option>
          </select>
          <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>{filteredAlerts.length} alerts</span>
          <button onClick={() => setExpandedAlerts(prev => prev.size > 0 ? new Set() : new Set(pagedAlerts.map(a => a.id)))} style={{ padding: "2px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: C.txS, fontSize: 10, fontFamily: F.mono, cursor: "pointer" }}>{expandedAlerts.size > 0 ? "Collapse All" : "Expand All"}</button>
        </div>
      )}

      {/* Real alerts from API — card-based incident board */}
      {apiAlerts === null && !demoMode && <LoadingSpinner />}
      {pagedAlerts.length > 0 && !demoMode && (
        <>
          {pagedAlerts.map(a => {
            const sc = sevColor(a.severity);
            const isCritical = a.severity === "CRITICAL";
            const stC = statusColor(a.status);
            const ageMs = Date.now() - new Date(a.created_at).getTime();
            const ageMin = Math.floor(ageMs / 60000);
            const ageStr = ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m`;
            const ageColor = slaColor(ageMin);
            const isCorrelation = a.source === "correlation-engine";
            const corrId = a.title.startsWith("Correlation:") ? a.title.replace("Correlation: ", "") : null;
            const isOpen = expandedAlerts.has(a.id);

            return (
              // T12: each alert is wrapped in a Fragment so the TriageGraphCard
              // can be a sibling div without breaking the card layout. The key
              // lives on the Fragment; the inner card div no longer carries it.
              // v0.8.2+: data-alert-id powers the highlight-on-arrival pulse.
              <Fragment key={a.id}>
              <div
                data-alert-id={a.id}
                style={{
                  position: "relative",
                  background: isCritical
                    ? `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`
                    : C.glassSurfTrans,
                  border: `1px solid ${sc}22`,
                  borderLeft: `4px solid ${sc}`,
                  // operator-flagged 2026-05-08 from internal dogfood: row spacing/radius
                  // diverged from ShieldTests (which is the established
                  // dense-card density). Aligning to mB 6 / bR 8 for design
                  // language uniformity. Glass + shadow + severity stripe
                  // unchanged.
                  borderRadius: 8, marginBottom: 6, overflow: "hidden",
                  boxShadow: isCritical ? `0 0 16px ${C.danger}22, ${C.glassCardShadow}` : C.glassCardShadow,
                }}
              >
                {/* Collapsed header — always visible */}
                <div onClick={() => setExpandedAlerts(prev => { const n = new Set(prev); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", cursor: "pointer",
                }}>
                  <span style={{ fontSize: 10, color: C.txT, transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", flexShrink: 0 }}>{"\u25B6"}</span>
                  <Badge label={a.severity} color={sc} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.tx, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{a.title}</span>
                  <span style={{ padding: "2px 8px", borderRadius: 999, background: `${ageColor}22`, border: `1px solid ${ageColor}55`, fontSize: 11, fontFamily: F.mono, color: ageColor, fontWeight: 700, flexShrink: 0 }}>{ageStr}</span>
                  <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 9, fontWeight: 700, fontFamily: F.mono, background: `${stC}22`, color: stC, border: `1px solid ${stC}55`, textTransform: "uppercase" as const, letterSpacing: "0.05em", flexShrink: 0 }}>{a.status}</span>
                </div>

                {/* Expanded body */}
                {isOpen && (
                  <div style={{ padding: "0 14px 12px 32px" }}>
                    {/* Description */}
                    <div style={{ fontSize: 12, color: C.txS, marginBottom: 10, lineHeight: 1.5 }}>{a.description || a.title}</div>

                    {/* Source + actions + backlink */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, color: C.txT }}>Source: <span style={{ fontWeight: 600, color: C.txS }}>{a.source}</span></span>
                        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.txT }}>openclaw-local</span>
                        {/* v0.8.4 workflow buttons: ACK → Investigate → Resolve.
                            ACK shows when open. Investigate shows when open or
                            acknowledged (operator can skip ACK and go straight
                            to investigate). Resolve shows for any non-resolved
                            non-suppressed status. */}
                        {a.status === "open" && (
                          <Tooltip placement="top" variant="detail" content={<span><strong>Acknowledge</strong> — handshake before active work. Signals to colleagues / on-call that someone has eyes on this alert. Doesn&apos;t mean you&apos;re fixing it yet, just that it&apos;s not orphaned.</span>}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAction(a.id, "acknowledge"); }}
                              style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${C.cyan}55`, borderRadius: 8, color: C.cyan, fontSize: 10, cursor: "pointer", fontWeight: 600 }}
                            >
                              ACK
                            </button>
                          </Tooltip>
                        )}
                        {(a.status === "open" || a.status === "acknowledged") && (
                          // Workflow status transition (open/ack → investigating).
                          // Renamed from "Investigate" → "TAKE" 2026-05-06 per the reviewer's
                          // duplicate-action feedback: the new triage entry button
                          // (Investigate ▸, below) opens the triage graph; THIS one
                          // signals work-in-flight intent to teammates. Two distinct
                          // verbs avoid the prior visual duplication.
                          <Tooltip placement="top" variant="detail" content={<span><strong>Take</strong> — claim this alert and mark it actively under investigation. Signals work-in-flight to anyone else watching the queue so they don&apos;t double-up. (To open the triage graph for this alert, use <strong>Investigate ▸</strong> below.)</span>}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAction(a.id, "investigate"); }}
                              style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${C.orange}55`, borderRadius: 8, color: C.orange, fontSize: 10, cursor: "pointer", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}
                            >
                              Take
                            </button>
                          </Tooltip>
                        )}
                        {(a.status === "open" || a.status === "acknowledged" || a.status === "investigating") && (
                          <Tooltip placement="top" variant="detail" content={<span><strong>Resolve</strong> — close this alert. It stays in audit history (visible in Audit &amp; Evidence) but drops out of active views and the open-alert KPI. If it recurs, a new alert is created — this one isn&apos;t reopened.</span>}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAction(a.id, "resolve"); }}
                              style={{ padding: "2px 8px", background: `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`, border: 0, borderRadius: 10, color: "#06121f", fontSize: 10, cursor: "pointer", fontWeight: 850, textTransform: "uppercase", letterSpacing: "0.05em" }}
                            >
                              Resolve
                            </button>
                          </Tooltip>
                        )}
                        {a.status !== "suppressed" && (
                          <span onClick={(e) => e.stopPropagation()}>
                            <AcceptRiskButton
                              query={{
                                source_panel: "alerts",
                                rule_id: a.title,
                                agent_id: null,
                                surface_id: null,
                                evidence: [a.severity, a.source],
                              }}
                              onAccepted={fetchAlerts}
                            />
                          </span>
                        )}
                        {/* v0.11.x+: View Evidence is now a deep-link to the
                            exact audit row in Audit & Evidence. Resolves
                            audit_event_id via /api/alerts/:id/evidence, then
                            navigates. Falls back to inline-expand only on
                            error / missing audit_event_id / no navigate prop.
                            When the inline fallback is showing, the button
                            label flips to "Hide Evidence" and the click
                            collapses the inline view (keeps the legacy
                            toggle UX for that fallback case). The label
                            includes a "→" arrow on the primary path so the
                            navigation affordance is obvious without hover. */}
                        {alertHasEvidence(a) && (
                          <Tooltip placement="top" variant="detail" content={evidenceMap[a.id] ? <span><strong>Hide Evidence</strong> — collapse the inline fallback view (the deep-link to Audit &amp; Evidence couldn&apos;t resolve, so we showed it inline instead).</span> : <span><strong>Open in Audit &amp; Evidence</strong> &rarr; — navigates to the exact audit row for this alert and opens its evidence detail. If the linked audit row isn&apos;t resolvable, we&apos;ll render the evidence inline here as a fallback.</span>}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (evidenceMap[a.id]) {
                                  // Inline fallback is open → collapse.
                                  toggleEvidence(a.id);
                                } else {
                                  // Primary path: deep-link.
                                  openEvidenceLink(a.id);
                                }
                              }}
                              style={{ padding: "2px 8px", background: `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`, border: 0, borderRadius: 10, color: "#06121f", fontSize: 10, cursor: "pointer", fontWeight: 850, textTransform: "uppercase", letterSpacing: "0.05em" }}
                            >
                              {evidenceMap[a.id] ? "Hide Evidence" : "View Evidence →"}
                            </button>
                          </Tooltip>
                        )}
                        {/* T12: Investigate ▸ toggles the inline TriageGraphCard
                            below this card. Single-expand: opening one collapses
                            any other. The View Evidence deep-link remains
                            available alongside this button.
                            v0.13.7 fix: on open, also kick off the evidence fetch
                            if not already loaded — otherwise the alert resolver
                            sees evidence:null and all 5 stages collapse to
                            "missing" since it builds artifacts off evidence
                            fields (operator-flagged 2026-05-07: "why is there no
                            evidence data in the red box?"). */}
                        <Tooltip placement="top" variant="detail" content={<span><strong>Investigate ▸</strong> — open the triage graph for this alert. Shows evidence, source event, affected object, related activity, and recommended controls inline — without leaving the panel.</span>}>
                          <button
                            aria-label={`Investigate ${a.title}`}
                            aria-pressed={investigatingAlertId === a.id}
                            aria-expanded={investigatingAlertId === a.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setInvestigatingAlertId((current) => {
                                const next = current === a.id ? null : a.id;
                                // Opening: ensure evidence is loaded so the
                                // triage card has fields to populate the 5 stages.
                                if (next === a.id && !evidenceMap[a.id]) {
                                  fetchEvidence(a.id);
                                }
                                return next;
                              });
                            }}
                            style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${C.cyan}55`, borderRadius: 8, color: C.cyan, fontSize: 10, cursor: "pointer", fontWeight: 600 }}
                          >
                            Investigate ▸
                          </button>
                        </Tooltip>
                      </div>
                      {isCorrelation && corrId ? (
                        // v0.8.2 fix: pass the correlation rule name as id so the
                        // CorrelationsPanel filters to the matching rule's events.
                        // Without id, the destination dumps the full list (operator-reported regression).
                        <button
                          onClick={(e) => { e.stopPropagation(); onNavigate("correlations", { id: corrId, highlight: corrId }); }}
                          title={`Open Correlations pre-filtered to "${corrId}"`}
                          style={{ background: "none", border: "none", color: C.cyan, fontSize: 12, fontWeight: 600, fontFamily: F.mono, cursor: "pointer", padding: 0 }}
                        >
                          {corrId} {"\u2192"}
                        </button>
                      ) : (
                        // Source-aware backlink: shield / session-watcher / etc.
                        // Will pick up id filtering as those panels adopt URL-state in v0.8.3+.
                        <button onClick={(e) => { e.stopPropagation(); onNavigate(a.source === "session-watcher" ? "trafficMonitor" : a.source === "shield" ? "shield" : "auditEvidence"); }} style={{ background: "none", border: "none", color: C.info, fontSize: 11, fontWeight: 600, fontFamily: F.sans, cursor: "pointer", padding: 0 }}>{a.source} {"\u2192"}</button>
                      )}
                    </div>
                    {/* Inline evidence panel \u2014 only rendered after View Evidence
                        has been clicked. Shows the resolved audit row (forward
                        link or fallback nearest-match) plus rule_key, severity,
                        the redacted matched sample, and the surrounding \u00b1200
                        char context window. The match span is highlighted via
                        a tinted background so the operator can confirm at a
                        glance which exact text triggered the alert. */}
                    {evidenceMap[a.id] && (
                      <EvidenceInline state={evidenceMap[a.id]} />
                    )}
                  </div>
                )}
              </div>
              {/* T12: inline triage graph card — sibling to the card div above.
                  Rendered only when this alert's investigation is toggled open.
                  resolveAlertTriageGraph is pure — no I/O, safe for render path.
                  Evidence payload is threaded from evidenceMap when already loaded
                  (operator clicked View Evidence first); null otherwise. The resolver
                  produces safe missing/loading states when evidence is absent. */}
              {investigatingAlertId === a.id && (() => {
                // Narrow evidenceMap entry to "ok" before accessing .data —
                // the EvidenceState discriminated union is defined inside the
                // component body so the conditional-access form can't narrow it.
                const evState = evidenceMap[a.id];
                const evPayload = evState?.kind === "ok" ? evState.data : null;
                return (
                  <div style={{ marginBottom: 12 }}>
                    <TriageGraphCard
                      graph={resolveAlertTriageGraph({
                        alert: a,
                        evidence: evPayload,
                        now: new Date(),
                      })}
                      onNavigate={onNavigate}
                      sourceContext="alertsIncidents"
                      onClose={() => setInvestigatingAlertId(null)}
                    />
                  </div>
                );
              })()}
              </Fragment>
            );
          })}

          {/* Pagination */}
          {alertTotalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}22` }}>
              <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>Page {alertPage + 1} of {alertTotalPages}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setAlertPage(0)} disabled={alertPage === 0} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: alertPage === 0 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: alertPage === 0 ? "not-allowed" : "pointer" }}>{"\u00AB"}</button>
                <button onClick={() => setAlertPage(p => Math.max(0, p - 1))} disabled={alertPage === 0} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: alertPage === 0 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: alertPage === 0 ? "not-allowed" : "pointer" }}>{"\u2039"} Prev</button>
                <button onClick={() => setAlertPage(p => Math.min(alertTotalPages - 1, p + 1))} disabled={alertPage >= alertTotalPages - 1} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: alertPage >= alertTotalPages - 1 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: alertPage >= alertTotalPages - 1 ? "not-allowed" : "pointer" }}>Next {"\u203A"}</button>
                <button onClick={() => setAlertPage(alertTotalPages - 1)} disabled={alertPage >= alertTotalPages - 1} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: alertPage >= alertTotalPages - 1 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: alertPage >= alertTotalPages - 1 ? "not-allowed" : "pointer" }}>{"\u00BB"}</button>
              </div>
            </div>
          )}
        </>
      )}
      {apiAlerts !== null && filteredAlerts.length === 0 && !demoMode && (
        <EmptyState message={
          // Distinguish "no data" from "filters narrowed everything out" so the
          // operator knows whether to clear filters or actually has no alerts.
          (sevSel.length > 0 || sourceSel.length > 0 || statusSel.length > 0 || qFilter || deepLinkId)
            ? "No alerts match the current filters. Clear filters to see the full list."
            : "No alerts. All clear."
        } />
      )}

      {/* Demo mock alerts */}
      {demoMode && (
        <>
          {ALERTS_D.filter(a => filters.selectedSeverity === "all" || a.severity === filters.selectedSeverity).map(alert => {
            const sc = sevColor(alert.severity);
            const isCritical = alert.severity === "CRITICAL";
            const slaMins = alert.slaMinutes;
            const slaC = slaColor(slaMins);
            const stC = statusColor(alert.status);
            const isBreached = slaMins <= 15;

            return (
              <div key={alert.id} style={{
                position: "relative",
                background: isCritical
                  ? `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`
                  : C.glassSurfTrans,
                border: `1px solid ${sc}33`,
                borderLeft: `4px solid ${sc}`,
                borderRadius: 8, padding: 12, marginBottom: 6,
                boxShadow: isCritical ? `0 0 16px ${C.danger}22, ${C.glassCardShadow}` : C.glassCardShadow,
              }}>
                {/* Row 1: severity + title | SLA + status */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                    <Badge label={alert.severity} color={sc} />
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.tx }}>{alert.title}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {/* SLA timer */}
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999,
                      background: `${slaC}22`, border: `1px solid ${slaC}55`, fontSize: 15, fontFamily: F.mono, color: slaC, fontWeight: 700,
                    }}>
                      {alert.sla}
                    </span>
                    {isBreached && <span style={{ fontSize: 11, fontWeight: 700, color: C.danger, fontFamily: F.mono, textTransform: "uppercase" as const }}>BREACHED</span>}
                    {/* Status pill */}
                    <span style={{
                      display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      fontFamily: F.mono, background: `${stC}22`, color: stC, border: `1px solid ${stC}55`,
                      textTransform: "uppercase" as const, letterSpacing: "0.05em",
                    }}>
                      {alert.status}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <div style={{ fontSize: 13, color: C.txS, marginBottom: 10, lineHeight: 1.5 }}>{alert.desc}</div>

                {/* Footer: assignee + correlation link */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, color: C.txT }}>
                    Assignee:{" "}
                    {alert.assignee ? (
                      <span style={{ fontWeight: 700, color: C.tx }}>{alert.assignee}</span>
                    ) : (
                      <span style={{ fontWeight: 700, color: C.danger }}>Unassigned</span>
                    )}
                    {"  "}
                    <span style={{ color: C.txT, fontFamily: F.mono, fontSize: 12 }}>{alert.id}</span>
                  </div>
                  {alert.correlationId && (
                    <button onClick={() => onNavigate("correlations")} style={{
                      background: "transparent", border: "none", color: C.cyan, fontSize: 13, fontWeight: 600,
                      fontFamily: F.sans, cursor: "pointer", padding: "2px 0",
                      opacity: 0.85, transition: "opacity 0.15s ease",
                    }}
                    onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.opacity = "1"; }}
                    onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.opacity = "0.85"; }}
                    >
                      {alert.correlationId} {"\u2192"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvidenceInline \u2014 renders the response from /api/alerts/:id/evidence under
// the alert card. Three states: loading, ok, error. Match-centered snippet
// is rendered with the matched span tinted so operators can read the trigger
// in context. Detection samples come from the scanner with rule-specific
// partial redaction (CC = first6+last4, etc.); the surrounding excerpt was
// run through redact() before persistence so non-matched PII is also stripped.
// ---------------------------------------------------------------------------

type EvidenceInlineState =
  | { kind: "loading" }
  | { kind: "ok"; data: EvidencePayload }
  | { kind: "error"; message: string };

function EvidenceInline({ state }: { state: EvidenceInlineState }) {
  if (state.kind === "loading") {
    return (
      <div style={{
        marginTop: 10, padding: "10px 12px",
        background: `${C.purp}08`, border: `1px solid ${C.purp}33`, borderLeft: `3px solid ${C.purp}`,
        borderRadius: 4, fontSize: 12, color: C.txS, fontFamily: F.mono,
      }}>
        Loading evidence\u2026
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div style={{
        marginTop: 10, padding: "10px 12px",
        background: `${C.danger}08`, border: `1px solid ${C.danger}33`, borderLeft: `3px solid ${C.danger}`,
        borderRadius: 4, fontSize: 12, color: C.danger, fontFamily: F.mono,
      }}>
        Evidence unavailable: {state.message}
      </div>
    );
  }
  const d = state.data;
  return (
    <div style={{
      marginTop: 10, padding: "12px 14px",
      background: `${C.purp}08`, border: `1px solid ${C.purp}44`, borderLeft: `3px solid ${C.purp}`,
      borderRadius: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.purp, fontFamily: F.mono, textTransform: "uppercase", letterSpacing: "0.06em" }}>EVIDENCE</span>
        <span style={{ fontSize: 11, fontFamily: F.mono, color: C.txS }}>EVD-{d.audit_event_id.replace(/-/g, "").slice(0, 4).toUpperCase()}</span>
        {/* v0.11.3+ Layer 4: exact vs best-match pill. Mirrors
            AuditEvidencePanel.CorrelationPill \u2014 operators always know
            whether the link is deterministic (forward) or a heuristic
            (fallback_nearest by session + \u00b160s). */}
        {d.correlation_method === "forward" ? (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "1px 6px", borderRadius: 8,
            background: `${C.green}18`, color: C.green,
            border: `1px solid ${C.green}55`,
            fontSize: 9, fontWeight: 700, fontFamily: F.mono,
            letterSpacing: "0.04em", textTransform: "uppercase",
          }} title="Exact match \u2014 alert metadata carried audit_event_id pointing at this exact audit row.">
            Exact match (audit_event_id)
          </span>
        ) : (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "1px 6px", borderRadius: 8,
            background: `${C.warn}18`, color: C.warn,
            border: `1px solid ${C.warn}55`,
            fontSize: 9, fontWeight: 700, fontFamily: F.mono,
            letterSpacing: "0.04em", textTransform: "uppercase",
          }} title="Best match \u2014 alert lacked audit_event_id; resolved via session + \u00b160s timestamp heuristic.">
            Best match {"\u2014"} fallback by session + {"\u00b1"}60s
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, fontFamily: F.mono, color: C.txT }}>{d.audit_action}</span>
      </div>

      {/* Header grid \u2014 session / direction / model / verdict / score */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 10 }}>
        {[
          { l: "SESSION", v: d.session_id ? d.session_id.slice(0, 8) + "\u2026" : "\u2014" },
          { l: "DIRECTION", v: d.direction ?? "\u2014" },
          { l: "MODEL", v: d.model ?? "\u2014" },
          { l: "VERDICT", v: d.verdict ?? "\u2014" },
          { l: "SCORE", v: d.score != null ? String(d.score) : "\u2014" },
        ].map((cell, i) => (
          <div key={i} style={{ padding: "4px 6px", background: C.bg, borderRadius: 3 }}>
            <div style={{ fontSize: 9, color: C.txT, letterSpacing: "0.06em" }}>{cell.l}</div>
            <div style={{ fontSize: 11, fontFamily: F.mono, color: C.tx }}>{cell.v}</div>
          </div>
        ))}
      </div>

      {/* Detections + match-centered snippets */}
      {d.matched_snippets.length === 0 && (
        <div style={{ fontSize: 11, color: C.txT, fontStyle: "italic", fontFamily: F.mono }}>
          No detections recorded with this audit event.
        </div>
      )}
      {d.matched_snippets.map((m, i) => {
        const sc = m.severity === "CRITICAL" ? C.danger : m.severity === "HIGH" ? C.orange : m.severity === "MEDIUM" ? C.warn : C.txS;
        return (
          <div key={i} style={{
            marginTop: i === 0 ? 0 : 8, padding: "8px 10px",
            background: C.bg, borderRadius: 4, border: `1px solid ${sc}22`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ padding: "1px 6px", borderRadius: 3, background: `${sc}18`, color: sc, fontSize: 9, fontWeight: 700, fontFamily: F.mono, border: `1px solid ${sc}44` }}>{m.severity}</span>
              <span style={{ fontSize: 11, fontFamily: F.mono, color: C.cyan }}>{m.rule_key}</span>
              <span style={{ fontSize: 11, color: C.tx }}>{m.name}</span>
              <span style={{ flex: 1 }} />
              {!m.match_found_in_excerpt && (
                <span style={{ fontSize: 9, color: C.txT, fontFamily: F.mono, fontStyle: "italic" }}>sample only</span>
              )}
            </div>
            <div style={{ fontSize: 10, color: C.txT, marginBottom: 2, fontFamily: F.mono, letterSpacing: "0.04em" }}>MATCHED SAMPLE</div>
            <div style={{
              fontSize: 12, fontFamily: F.mono, color: C.tx,
              padding: "4px 6px", background: `${sc}10`, border: `1px solid ${sc}33`, borderRadius: 3,
              wordBreak: "break-all", marginBottom: 6,
            }}>
              {m.sample || "\u2014"}
            </div>
            {m.match_found_in_excerpt && (m.snippet_before || m.snippet_after) && (
              <>
                <div style={{ fontSize: 10, color: C.txT, marginBottom: 2, fontFamily: F.mono, letterSpacing: "0.04em" }}>\u00b1200 CHAR CONTEXT</div>
                <div style={{
                  fontSize: 11, fontFamily: F.mono, color: C.txS,
                  padding: "6px 8px", background: C.pnl, border: `1px solid ${C.brd}`, borderRadius: 3,
                  whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.4,
                }}>
                  <span>{m.snippet_before}</span>
                  <span style={{ background: `${sc}30`, color: C.tx, padding: "1px 2px", borderRadius: 2, fontWeight: 700 }}>{m.snippet_match}</span>
                  <span>{m.snippet_after}</span>
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* Footer \u2014 small ids row */}
      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 10, fontFamily: F.mono, color: C.txT, flexWrap: "wrap" }}>
        {d.proxy_traffic_id && <span>traffic: <span style={{ color: C.txS }}>{d.proxy_traffic_id.slice(0, 8)}\u2026</span></span>}
        {d.prompt_hash && <span>prompt#: <span style={{ color: C.txS }}>{d.prompt_hash}</span></span>}
        <span>audit: <span style={{ color: C.txS }}>{d.audit_event_id.slice(0, 8)}\u2026</span></span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Age-bucket helpers (v0.13.0+ \u2014 IncidentAging drill-through filter)
// ---------------------------------------------------------------------------

/**
 * Returns true when the given age in ms falls in the named bucket.
 * Bucket labels match IncidentAging.tsx's BUCKETS array exactly so the
 * drill-through filter and the chart are always in sync.
 *
 * Unknown bucket labels return true (don't filter) so future bucket
 * additions in IncidentAging don't silently hide rows here.
 */
export function matchesAgeBucket(ageMs: number, bucket: string): boolean {
  const HOUR = 3600_000;
  const DAY  = 24 * HOUR;
  switch (bucket) {
    case "Current": return ageMs >= 0 && ageMs < HOUR;
    case "1\u20134h":   return ageMs >= HOUR && ageMs < 4 * HOUR;
    case "4\u201324h":  return ageMs >= 4 * HOUR && ageMs < DAY;
    case "1\u20133d":   return ageMs >= DAY && ageMs < 3 * DAY;
    case "3d+":     return ageMs >= 3 * DAY;
    default:        return true;  // unknown bucket \u2014 don't filter
  }
}
