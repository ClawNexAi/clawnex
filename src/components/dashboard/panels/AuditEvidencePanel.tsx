"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, F } from "../constants";
import { Card, Table, LoadingSpinner, EmptyState } from "../shared";
import { Tooltip } from "../tooltip";
import { sevColor } from "../utils";
import type { DashboardFilters, AuditData, TabId } from "../types";
import { AUDIT_LOG } from "../mock-data";
// v0.8.3+: PanelFilters + URL-state-driven filters. Audit & Evidence keeps
// its server-side filtering (the /api/audit endpoint accepts actor/action/
// search params); the URL state only mirrors what the operator selected so
// refresh / back-button preserve the view and deep-links can pre-filter.
import { PanelFilters } from "../PanelFilters";
import { useHashState } from "../url-state";
import { MissionControlBreadcrumb } from "./mission-control/MissionControlBreadcrumb";

// v0.11.x+: `focusedAuditId` + `onConsumed` enable cross-panel deep-links to
// land on a specific audit row (e.g. clicking "View Evidence" on an alert
// in Alerts & Incidents). When `focusedAuditId` is set we clear filters that
// might exclude the target, reset pagination, open the matching detail row,
// scroll it into view, and call `onConsumed` so the parent resets the focus
// — without that reset a re-mount would re-trigger the focus on stale state.
//
// v0.11.3+ (Wave 1 of alert→evidence backlink hardening):
//   - When the focused row falls OUTSIDE the current time window we no longer
//     show a "widen the time filter" warning. We fetch it directly via
//     GET /api/audit/:id (which bypasses the time-window predicate), render
//     the detail anyway, and surface an INFORMATIONAL "Outside current time
//     window" notice so the operator knows it's a deep-link surface, not a
//     row from the current list view.
//   - `incomingFromAlert` carries the originating alert id when the operator
//     arrived via "View Evidence" from Alerts & Incidents. The detail card
//     renders a "← Back to Incident" breadcrumb; clicking it calls
//     `onNavigate("alertsIncidents", { focusAlertId })`. The parent clears
//     the breadcrumb state via `onBackConsumed` after the navigation fires.
//   - Filters that we transiently clear to focus on the deep-linked row are
//     captured into `savedFilterStateRef` BEFORE clearing and RESTORED when
//     `onConsumed` fires (i.e. the focus is dismissed). Previously we cleared
//     and left cleared, which was a real regression for operators who had
//     filters set when a deep-link arrived (internal reviewer regression #6).
export function AuditEvidencePanel({
  filters,
  demoMode,
  operatorRole,
  focusedAuditId,
  onConsumed,
  incomingFromAlert,
  onBackConsumed,
  onNavigate,
  incomingFromMissionControl,
  onMissionControlBackConsumed,
}: {
  filters: DashboardFilters;
  demoMode: boolean;
  operatorRole?: string;
  focusedAuditId?: string | null;
  onConsumed?: () => void;
  incomingFromAlert?: string | null;
  onBackConsumed?: () => void;
  onNavigate?: (tab: TabId, opts?: { id?: string; highlight?: string; focus?: string; fromAlert?: string; focusAlertId?: string }) => void;
  // v0.12.0+: Mission Control return path. Renders alongside the existing
  // v0.11.3 BackToIncidentBreadcrumb so the operator can return to either
  // origin independently.
  incomingFromMissionControl?: boolean;
  onMissionControlBackConsumed?: () => void;
}) {
  const [apiEvents, setApiEvents] = useState<AuditData[] | null>(null);
  const [freshness, setFreshness] = useState(0);
  const freshnessRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  // v0.8.3: filter state from URL hash. result → status, actor → actor,
  // action → source (re-using `source` URL key for the action dimension since
  // the audit "action" semantically is the event source — config_write,
  // alert.acknowledge, etc.), q → search. Each is multi-select except q.
  const [urlState, updateUrl] = useHashState();
  // v0.11.4+: memoize the URL-derived array selectors. Without useMemo,
  // `urlState.status ?? []` returns a NEW array literal each render when the
  // underlying value is undefined. Anything depending on these refs (notably
  // `fetchAudit`'s useCallback deps) would treat each render as a filter
  // change, recreating the polling interval and firing a new fetch every
  // render — driving the panel into a refetch loop bounded only by network
  // RTT. Stabilizing these refs so they only change when the filter actually
  // changes returns the polling cadence to the intended 30s.
  const resultSel = useMemo(() => urlState.status ?? [], [urlState.status]);
  const actorSel = useMemo(() => urlState.actor ?? [], [urlState.actor]);
  const actionSel = useMemo(() => urlState.source ?? [], [urlState.source]);
  const searchText = urlState.q ?? "";

  const fetchAudit = useCallback(async () => {
    try {
      const params: Record<string, string> = {
        limit: "500",
        since: filters.since,
        exclude_actions: "agent_event,chat_event",
      };
      if (filters.selectedInstance !== "all") params.instance = filters.selectedInstance;
      // Multi-select: server expects single value today, so we send the first
      // selected. Future enhancement: extend /api/audit to accept CSV.
      if (actorSel.length > 0) params.actor = actorSel[0];
      if (actionSel.length > 0) params.action = actionSel[0];
      if (searchText.trim()) params.search = searchText.trim();
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`/api/audit?${qs}`);
      if (res.ok) { const data = await res.json(); setApiEvents(data.events || []); }
    } catch {}
    setFreshness(0);
  }, [filters.since, filters.selectedInstance, actorSel, actionSel, searchText]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    try {
      const olderThan = filters.since;
      const res = await fetch(`/api/audit?olderThan=${encodeURIComponent(olderThan)}`, { method: "DELETE" });
      if (res.ok) {
        await fetchAudit();
      }
    } catch {}
    setClearing(false);
    setClearConfirm(false);
  }, [filters.since, fetchAudit]);

  useEffect(() => {
    fetchAudit();
    const interval = setInterval(fetchAudit, 30000);
    return () => clearInterval(interval);
  }, [fetchAudit]);

  useEffect(() => {
    freshnessRef.current = setInterval(() => setFreshness(p => p + 1), 1000);
    return () => { if (freshnessRef.current) clearInterval(freshnessRef.current); };
  }, []);

  // Derive result from action/detail
  function deriveResult(e: AuditData): string {
    const a = (e.action || "").toLowerCase();
    const d = (e.detail || "").toLowerCase();
    // Session watcher detections are retroactive — not blocked, just detected
    if (a.includes("detected") || (a.includes("shield") && e.actor === "session-watcher")) return "DETECTED";
    // Observe mode — threat met block criteria but was not stopped
    if (a.includes("observed")) return "OBSERVED";
    if (a.includes("block") || d.includes("block")) return "BLOCKED";
    if (a.includes("quarantin") || d.includes("quarantin")) return "QUARANTINED";
    if (a.includes("flag") || d.includes("flag")) return "FLAGGED";
    if (a.includes("fail") || d.includes("fail") || d.includes("error")) return "FAILED";
    if (a.includes("creat") || d.includes("creat")) return "CREATED";
    if (a.includes("allow") || d.includes("allow") || d.includes("success") || a.includes("ack")) return "SUCCESS";
    if (a.includes("alert") || a.includes("warn") || a.includes("expir")) return "FLAGGED";
    if (a.includes("review") || d.includes("review")) return "FLAGGED";
    return "SUCCESS";
  }

  function resultColor(result: string): string {
    switch (result) {
      case "CREATED": case "SUCCESS": return C.green;
      case "BLOCKED": case "FAILED": return C.danger;
      case "DETECTED": return C.orange;
      case "OBSERVED": return C.cyan;
      case "QUARANTINED": return C.orange;
      case "FLAGGED": return C.warn;
      default: return C.txS;
    }
  }

  function isSystemActor(actor: string): boolean {
    // "sentinel" is kept alongside "clawnex" so legacy audit rows written
    // before the v0.9 rebrand still render with system-actor styling. The
    // post-startup DB migration in src/lib/db/schema.ts rewrites them, but
    // we keep the include() here as belt-and-suspenders in case the migration
    // has been skipped or the row predates the migration's introduction.
    return actor.includes("@system") || actor.includes("clawnex") || actor.includes("sentinel") || actor.includes("watchdog") || actor.includes("shield") || actor.includes("_engine") || actor.includes("_monitor") || actor === "system";
  }

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toTimeString().slice(0, 8);
    } catch { return "--"; }
  }

  function formatEvidence(id: string): string {
    return `EVD-${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
  }

  function formatTarget(e: AuditData): string {
    if (e.resource_type && e.resource_id) return `${e.resource_type}/${e.resource_id.slice(0, 12)}`;
    if (e.resource_type) return e.resource_type;
    if (e.detail) return e.detail.slice(0, 40);
    return "--";
  }

  // Demo data mapped to the same table format
  const demoRows = demoMode ? AUDIT_LOG.filter(e => filters.selectedSeverity === "all" || e.severity === filters.selectedSeverity).map((e, i) => {
    const result = e.action.includes("block") ? "BLOCKED" : e.action.includes("alert") ? "FLAGGED" : e.action.includes("review") ? "FLAGGED" : e.action.includes("ack") ? "SUCCESS" : "CREATED";
    return [
      <span key="t" style={{ fontSize: 13, color: C.txT, fontFamily: F.mono }}>{e.ts}</span>,
      <span key="a" style={{ fontSize: 13, fontFamily: F.mono, color: e.actor.includes("engine") || e.actor === "system" ? C.purp : C.tx }}>{e.actor}</span>,
      <span key="act" style={{ fontSize: 12, fontFamily: F.mono, color: C.cyan }}>{e.action}</span>,
      <span key="tgt" style={{ fontSize: 13, color: C.txS }}>{e.resource}</span>,
      <span key="res" style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, fontFamily: F.mono, background: `${resultColor(result)}22`, color: resultColor(result), border: `1px solid ${resultColor(result)}55`, textTransform: "uppercase", letterSpacing: "0.05em" }}>{result}</span>,
      <span key="ev" style={{ fontSize: 12, fontFamily: F.mono, color: C.cyan }}>{`EVD-${(4400 + i).toString()}`}</span>,
    ];
  }) : [];

  const [selectedEvidence, setSelectedEvidence] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(0);
  // v0.11.x+: deep-link focus support. The detail card for the focused
  // audit row scrolls into view via this ref once it renders. The "missing"
  // banner state captures the case where the focused id wasn't in the
  // /api/audit response (typical cause: row is older than filters.since).
  const detailRef = useRef<HTMLTableRowElement | null>(null);
  // v0.11.3+: replaces the prior `focusMissingId` "widen the time filter"
  // warning. When we deep-link to a row outside the current time window we
  // fetch it via /api/audit/:id and render the detail anyway. This state
  // holds (a) the fetched row and (b) the correlation_method we resolved
  // it through ('forward' = exact via metadata audit_event_id, 'fallback_nearest'
  // = best match via session+timestamp). When `outsideWindowEvent` is set
  // the detail panel renders the row with an informational "Outside current
  // time window" notice instead of the operator-blaming warning we used to.
  const [outsideWindowEvent, setOutsideWindowEvent] = useState<AuditData | null>(null);
  // The correlation_method that produced `outsideWindowEvent`. Drives the
  // exact-vs-best-match pill (Layer 4). Only meaningful when the operator
  // arrived here via "View Evidence" deep-link (i.e. when alertOriginId
  // is set). When the operator clicked an audit row directly we treat it
  // as 'forward' (it IS the exact row).
  const [outsideWindowCorrMethod, setOutsideWindowCorrMethod] = useState<"forward" | "fallback_nearest" | null>(null);
  // v0.11.3+: the alert id we backlinked from. Only used by the deep-link
  // path so the EVD detail can call /api/alerts/:id/evidence to get
  // correlation_method (exact vs best-match) — without this we'd have to
  // re-derive it from the alert's metadata which is not available here.
  // Kept in a ref because it doesn't drive any rendering directly.
  const alertOriginRef = useRef<string | null>(null);
  // v0.11.4+: memoize per-selection deep-link work. Without this, every
  // `apiEvents` poll re-runs the heavy effect — re-fetches /api/audit/:id,
  // re-fetches correlation_method, re-runs scrollIntoView — causing the EVD
  // detail to flicker and the page to jump back to the row on each poll.
  // We capture the id we last positioned, and skip the work if it matches.
  // Reset to null when selection clears so the next deep-link reruns cleanly.
  const lastDeepLinkRef = useRef<string | null>(null);
  // v0.11.3+: filter-restore semantics (internal reviewer regression #6). Saved BEFORE
  // we clear filters for the focus, then restored when the focus is
  // consumed (via onConsumed / Back to Incident / detail close).
  const savedFilterStateRef = useRef<{
    status: string[];
    actor: string[];
    source: string[];
    q: string;
    page: number;
  } | null>(null);

  // v0.8.3: client-side filter on top of server-side fetch. Multi-select for
  // each dimension (CSV in URL); empty = all. Result is derived client-side
  // from event content via deriveResult, so result filtering stays purely
  // client-side. Actor + action also re-applied here so multi-select beyond
  // the server-side single-value param works correctly.
  const realEvents = (apiEvents || []).map(e => ({ ...e, _result: deriveResult(e) }));
  // Map result-bucket label (success/blocked/etc) → array of _result values
  // it represents. Lets us multi-select against the bucket names.
  const RESULT_BUCKET: Record<string, string[]> = {
    success: ["CREATED", "SUCCESS"],
    blocked: ["BLOCKED"],
    observed: ["OBSERVED"],
    detected: ["DETECTED"],
    flagged: ["FLAGGED", "QUARANTINED"],
  };
  const filteredReal = realEvents.filter(e => {
    if (resultSel.length > 0) {
      const matchesAny = resultSel.some(b => (RESULT_BUCKET[b] ?? []).includes(e._result));
      if (!matchesAny) return false;
    }
    if (actorSel.length > 0 && (!e.actor || !actorSel.includes(e.actor))) return false;
    if (actionSel.length > 0 && !actionSel.includes(e.action)) return false;
    return true;
  });

  const totalPages = Math.ceil(filteredReal.length / pageSize);
  const pagedEvents = filteredReal.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const eventCount = demoMode ? demoRows.length : filteredReal.length;

  // Unique values for filters
  const uniqueActors = Array.from(new Set(realEvents.map(e => e.actor).filter(Boolean) as string[])).sort();
  const uniqueActions = Array.from(new Set(realEvents.map(e => e.action).filter(Boolean))).sort();

  // Reset page when filters change
  // Reset to page 1 whenever any filter dimension changes.
  useEffect(() => { setCurrentPage(0); }, [resultSel, actorSel, actionSel, pageSize, searchText]);

  // v0.11.x+: respond to a parent-driven focus on a specific audit row. We:
  //   1. SAVE the current filter state (internal reviewer regression #6 — v0.11.3+).
  //      Without this we used to clear filters and leave cleared after
  //      the operator dismissed the focus.
  //   2. Clear filters that could hide the target (status/actor/source/q
  //      are URL-state-driven multi-selects + freeform search). Operator
  //      can re-filter manually after.
  //   3. Reset pagination — the row could be on any page given list order.
  //   4. Pre-select the row so the detail block opens immediately. The
  //      filtered+paged effect below positions it onto the visible page.
  //   5. Capture the originating alert id (if any) so the exact-vs-best
  //      match label can be resolved.
  //   6. Call `onConsumed` so the parent resets `auditFocus` to null —
  //      without that, navigating away and back would re-trigger.
  // Whether the row actually exists in the current window is checked in a
  // second effect once /api/audit has returned.
  useEffect(() => {
    if (!focusedAuditId) return;
    // (1) Save filter state before we clear it. Only save if we don't
    // already have a saved snapshot — successive focus jumps shouldn't
    // overwrite the operator's true pre-deep-link state.
    if (!savedFilterStateRef.current) {
      savedFilterStateRef.current = {
        status: resultSel,
        actor: actorSel,
        source: actionSel,
        q: searchText,
        page: currentPage,
      };
    }
    // (2) Clear filters by writing empty values into URL state. updateUrl merges
    // a patch; explicit empties clear the keys (PanelFilters writes "" / [] for empty).
    updateUrl({ status: [], actor: [], source: [], q: "" });
    // (3) Reset pagination.
    setCurrentPage(0);
    // (4) Pre-select the row.
    setSelectedEvidence(focusedAuditId);
    // (5) Capture origin alert id (if backlink). This is the alert id the
    // operator was viewing when they clicked "View Evidence".
    alertOriginRef.current = incomingFromAlert ?? null;
    // Reset the outside-window state for this focus — populated only if the
    // row turns out to be outside the current /api/audit window.
    setOutsideWindowEvent(null);
    setOutsideWindowCorrMethod(null);
    // (6) Tell parent we've taken ownership of the focus so it can reset.
    onConsumed?.();
    // Intentionally exclude updateUrl/onConsumed from deps — both are stable
    // refs from the parent and adding them re-runs this effect on unrelated
    // re-renders. resultSel/actorSel/actionSel/searchText/currentPage are
    // intentionally captured at-time-of-focus only, not as live deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedAuditId, incomingFromAlert]);

  // v0.11.3+: restore saved filter state when the operator dismisses the
  // focused detail (closes the detail card, clicks Back to Incident, or
  // clicks Dismiss on the outside-window banner). `selectedEvidence === null`
  // is the post-dismissal signal — when the deep-link is consumed the panel
  // returns to general-browse mode and the original filters should be back.
  useEffect(() => {
    // Only restore when we transitioned from a focus to no-focus AND we have
    // a saved snapshot. If selectedEvidence becomes null because the
    // operator never had a focus active, savedFilterStateRef is also null
    // and this no-ops.
    if (selectedEvidence === null) {
      // v0.11.4+: clear the per-selection memo so the next deep-link to the
      // same id re-runs the position + scroll work cleanly.
      lastDeepLinkRef.current = null;
      if (savedFilterStateRef.current) {
        const saved = savedFilterStateRef.current;
        savedFilterStateRef.current = null;
        updateUrl({
          status: saved.status,
          actor: saved.actor,
          source: saved.source,
          q: saved.q,
        });
        setCurrentPage(saved.page);
        // Also clear any outside-window detail since we're returning to browse.
        setOutsideWindowEvent(null);
        setOutsideWindowCorrMethod(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvidence]);

  // v0.11.x+ / v0.11.3+ / v0.11.4+: once /api/audit has returned, position
  // the focused row onto the visible page and scroll its detail card into
  // view. If the focused id isn't in the fetched window (likely cause: row
  // predates filters.since), call GET /api/audit/:id directly — it bypasses
  // the time-window filter — and render the detail anyway with an
  // informational "Outside current time window" notice. If the alert origin
  // id is set we also resolve correlation_method via
  // /api/alerts/:id/evidence to label the match as exact (forward) vs
  // best-match (fallback_nearest).
  //
  // v0.11.4: gate the heavy work on `lastDeepLinkRef` so that apiEvents
  // polling (which produces a new array reference every settle) doesn't
  // re-fetch /api/audit/:id, re-fetch correlation_method, or re-scroll the
  // page on every poll. The polling-driven re-runs caused the EVD detail
  // card to flicker and the page to jump back to the row every few seconds.
  // Transitions where the row newly appears in or disappears from
  // `filteredReal` are still handled cheaply (state-only updates, no fetch).
  useEffect(() => {
    if (!selectedEvidence) return;
    if (apiEvents === null) return; // still loading, retry on next settle
    const idx = filteredReal.findIndex(e => e.id === selectedEvidence);
    const inWindow = idx >= 0;
    const alreadyHandled = lastDeepLinkRef.current === selectedEvidence;

    if (inWindow) {
      // Row newly appeared in the window (via polling) — clear any stale
      // outside-window state from a prior visit. Guarded so we don't trigger
      // an unnecessary state update on every poll.
      if (outsideWindowEvent !== null || outsideWindowCorrMethod !== null) {
        if (outsideWindowEvent !== null) setOutsideWindowEvent(null);
        if (outsideWindowCorrMethod !== null) setOutsideWindowCorrMethod(null);
      }
      // Skip the position + scroll work if we've already handled this id.
      // Without this gate we'd re-page and re-scroll on every apiEvents poll.
      if (alreadyHandled) return;
      const targetPage = Math.floor(idx / pageSize);
      if (targetPage !== currentPage) {
        // Don't mark handled yet — we'll re-run after the page change and
        // do the scroll on that pass.
        setCurrentPage(targetPage);
        return;
      }
      lastDeepLinkRef.current = selectedEvidence;
      // For in-window rows that arrived via deep-link, still resolve the
      // correlation_method so the exact-vs-best-match pill renders.
      const alertId = alertOriginRef.current;
      let cancelled = false;
      if (alertId) {
        (async () => {
          try {
            const evRes = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/evidence`);
            if (!evRes.ok) {
              if (!cancelled) setOutsideWindowCorrMethod("forward");
              return;
            }
            const evBody = await evRes.json();
            if (cancelled) return;
            const m = evBody?.correlation_method;
            if (m === "forward" || m === "fallback_nearest") {
              setOutsideWindowCorrMethod(m);
            }
          } catch {
            /* best-effort label */
          }
        })();
      }
      // Defer one frame so the detail row is in the DOM before scrolling.
      const raf = requestAnimationFrame(() => {
        const el = detailRef.current;
        if (!el) return;
        try { el.scrollIntoView({ behavior: "smooth", block: "start" }); }
        catch { el.scrollIntoView(); }
      });
      return () => { cancelled = true; cancelAnimationFrame(raf); };
    }

    // Row is outside the time window. v0.11.3+: fetch it directly via the
    // new fetch-by-id endpoint and render anyway. Best-effort — if the row
    // truly doesn't exist (404) we silently leave the detail closed; the
    // alert evidence path will have shown an inline error.
    //
    // v0.11.4: skip the fetch if we've already loaded this exact id — once
    // outsideWindowEvent matches the selection, polling shouldn't re-trigger
    // network calls.
    if (alreadyHandled && outsideWindowEvent?.id === selectedEvidence) {
      return;
    }
    lastDeepLinkRef.current = selectedEvidence;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/audit/${encodeURIComponent(selectedEvidence)}`);
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        if (body && body.event && body.event.id === selectedEvidence) {
          setOutsideWindowEvent(body.event as AuditData);
        }
      } catch {
        // Best-effort. Operator will see a closed detail; the originating
        // alert flow will have surfaced a more specific error already.
      }
      // If we have an alert origin, ask the alerts/:id/evidence route what
      // correlation_method resolved this. We don't bind to its full payload
      // — only the method label drives the exact-vs-best-match pill.
      const alertId = alertOriginRef.current;
      if (!alertId) {
        // No alert origin → operator clicked a row directly that happens to
        // be outside the window (rare, since selection only happens via
        // deep-link or in-window click). Treat as exact.
        if (!cancelled) setOutsideWindowCorrMethod("forward");
        return;
      }
      try {
        const evRes = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/evidence`);
        if (!evRes.ok) {
          if (!cancelled) setOutsideWindowCorrMethod("forward");
          return;
        }
        const evBody = await evRes.json();
        if (cancelled) return;
        const m = evBody?.correlation_method;
        if (m === "forward" || m === "fallback_nearest") {
          setOutsideWindowCorrMethod(m);
        } else {
          setOutsideWindowCorrMethod("forward");
        }
      } catch {
        if (!cancelled) setOutsideWindowCorrMethod("forward");
      }
    })();
    return () => { cancelled = true; };
    // pageSize / currentPage are read inside but we only re-run on the
    // selection or fetched-event-set changing; otherwise we'd thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvidence, apiEvents]);

  const thStyle = { textAlign: "left" as const, padding: "8px 10px", borderBottom: `1px solid ${C.brd}`, color: C.txT, fontWeight: 600, fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: F.sans };
  const tdStyle = { padding: "8px 10px", borderBottom: `1px solid ${C.brd}22` };

  // Shape persisted by session-watcher into audit_log.detail for shield_review
  // / shield_detected events. We render this enriched view (rule_key, severity,
  // matched samples, ±200-char context) when present; fall back to the raw
  // pre-formatted detail string for legacy rows.
  interface ShieldAuditDetectionRow {
    id: string;
    name: string;
    severity: string;
    samples?: string[];
    rule_key?: string;
    matchCount?: number;
  }
  interface ShieldAuditDetail {
    summary?: string;
    shield_detections?: ShieldAuditDetectionRow[];
    payload_excerpt?: string;
    payload_excerpt_truncated?: boolean;
    payload_total_length?: number;
    proxy_traffic_id?: string;
    session_id?: string;
    direction?: string;
    model?: string | null;
    verdict?: string;
    score?: number;
    prompt_hash?: string;
  }

  // Build a match-centered snippet from the (already-redacted) excerpt by
  // string-searching for the (already-redacted) sample. Mirrors the API-side
  // helper so this view can render without a round-trip when the audit row is
  // selected directly in this panel (operator landed here from the Evidence
  // column rather than from an alert backlink).
  function centerSnippet(payload: string, sample: string, window = 200): {
    before: string; match: string; after: string; found: boolean;
  } {
    if (!payload || !sample) return { before: "", match: sample || "", after: "", found: false };
    const idx = payload.indexOf(sample);
    if (idx < 0) return { before: "", match: sample, after: "", found: false };
    const start = Math.max(0, idx - window);
    const end = Math.min(payload.length, idx + sample.length + window);
    return {
      before: (start > 0 ? "…" : "") + payload.slice(start, idx),
      match: payload.slice(idx, idx + sample.length),
      after: payload.slice(idx + sample.length, end) + (end < payload.length ? "…" : ""),
      found: true,
    };
  }

  // v0.11.4+: defined as plain render-helpers (not JSX components) so they're
  // called as `{renderShieldEvidenceDetail(detail)}` not `<ShieldEvidenceDetail
  // detail={detail} />`. Reason: when these were inner JSX components, every
  // parent re-render (including the 1s freshness tick) gave them new function
  // identities. React's reconciler compares element `.type` by reference, so
  // a new function ref means "new component type" → unmount + remount the
  // EVD detail every second → visible flicker. Render-helpers bypass the
  // type-comparison entirely; they're just JS function calls returning JSX.
  function renderShieldEvidenceDetail(detail: ShieldAuditDetail) {
    const det = detail.shield_detections ?? [];
    const excerpt = detail.payload_excerpt ?? "";
    return (
      <div style={{ marginTop: 8, padding: "10px 12px", background: `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`, border: `1px solid ${C.glassBorderCyan}`, borderLeft: `3px solid ${C.purp}`, borderRadius: 14, boxShadow: C.glassCardShadow }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.purp, fontFamily: F.mono, textTransform: "uppercase", letterSpacing: "0.06em" }}>SHIELD EVIDENCE</span>
          {detail.verdict && <span style={{ fontSize: 11, fontFamily: F.mono, color: C.tx }}>{detail.verdict}</span>}
          {detail.score != null && <span style={{ fontSize: 11, fontFamily: F.mono, color: C.txT }}>score {detail.score}</span>}
          <span style={{ flex: 1 }} />
          {detail.proxy_traffic_id && (
            <span style={{ fontSize: 10, fontFamily: F.mono, color: C.txT }}>traffic {detail.proxy_traffic_id.slice(0, 8)}…</span>
          )}
        </div>
        {det.length === 0 && (
          <div style={{ fontSize: 11, color: C.txT, fontStyle: "italic", fontFamily: F.mono }}>No detections recorded.</div>
        )}
        {det.map((d, i) => {
          const sc = d.severity === "CRITICAL" ? C.danger : d.severity === "HIGH" ? C.orange : d.severity === "MEDIUM" ? C.warn : C.txS;
          const sample = (d.samples && d.samples[0]) || "";
          const ctx = centerSnippet(excerpt, sample);
          return (
            <div key={i} style={{
              marginTop: i === 0 ? 0 : 8, padding: "8px 10px",
              background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ padding: "1px 6px", borderRadius: 3, background: `${sc}18`, color: sc, fontSize: 9, fontWeight: 700, fontFamily: F.mono, border: `1px solid ${sc}44` }}>{d.severity}</span>
                <span style={{ fontSize: 11, fontFamily: F.mono, color: C.cyan }}>{d.rule_key ?? d.id}</span>
                <span style={{ fontSize: 11, color: C.tx }}>{d.name}</span>
                {d.matchCount && d.matchCount > 1 && (
                  <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>×{d.matchCount}</span>
                )}
              </div>
              <div style={{
                fontSize: 12, fontFamily: F.mono, color: C.tx,
                padding: "4px 6px", background: `${sc}10`, border: `1px solid ${sc}33`, borderRadius: 3,
                wordBreak: "break-all", marginBottom: ctx.found ? 6 : 0,
              }}>
                {sample || "—"}
              </div>
              {ctx.found && (ctx.before || ctx.after) && (
                <div style={{
                  fontSize: 11, fontFamily: F.mono, color: C.txS,
                  padding: "6px 8px", background: C.pnl, border: `1px solid ${C.brd}`, borderRadius: 3,
                  whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.4,
                }}>
                  <span>{ctx.before}</span>
                  <span style={{ background: `${sc}30`, color: C.tx, padding: "1px 2px", borderRadius: 2, fontWeight: 700 }}>{ctx.match}</span>
                  <span>{ctx.after}</span>
                </div>
              )}
            </div>
          );
        })}
        {detail.proxy_traffic_id && (
          <div style={{ marginTop: 8, fontSize: 10, color: C.txT, fontFamily: F.mono }}>
            Open in Traffic Monitor: <span style={{ color: C.txS }}>{detail.proxy_traffic_id}</span>
          </div>
        )}
        {detail.payload_excerpt_truncated && (
          <div style={{ marginTop: 6, fontSize: 10, color: C.txT, fontFamily: F.mono, fontStyle: "italic" }}>
            payload excerpt truncated (full length: {detail.payload_total_length ?? "?"} chars)
          </div>
        )}
      </div>
    );
  }

  // v0.11.3+ Layer 4: exact-match (forward) vs best-match (fallback_nearest) pill.
  // Inline component so it can sit alongside the EVD header without leaking
  // into the module-level types. Tooltip explains the fallback heuristic.
  // v0.11.4+: render-helper, not a JSX component (see renderShieldEvidenceDetail
  // for rationale). Called as `{renderCorrelationPill(method)}`.
  function renderCorrelationPill(method: "forward" | "fallback_nearest") {
    if (method === "forward") {
      return (
        <Tooltip placement="top" variant="detail" content={<span><strong>Exact match</strong> &mdash; the alert&apos;s metadata carried <code>audit_event_id</code> pointing at this exact audit row. Deterministic; not a heuristic.</span>}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 8px", borderRadius: 10,
            background: `${C.green}18`, color: C.green,
            border: `1px solid ${C.green}55`,
            fontSize: 10, fontWeight: 700, fontFamily: F.mono,
            letterSpacing: "0.04em", textTransform: "uppercase",
          }}>
            Exact match (audit_event_id)
          </span>
        </Tooltip>
      );
    }
    return (
      <Tooltip placement="top" variant="detail" content={<span><strong>Best match</strong> &mdash; the alert lacked <code>audit_event_id</code> in its metadata, so we fell back to nearest-match correlation by <code>session_id</code> + &plusmn;60s timestamp window. This is a heuristic, not a deterministic link.</span>}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 8px", borderRadius: 10,
          background: `${C.warn}18`, color: C.warn,
          border: `1px solid ${C.warn}55`,
          fontSize: 10, fontWeight: 700, fontFamily: F.mono,
          letterSpacing: "0.04em", textTransform: "uppercase",
        }}>
          Best match {"—"} fallback by session + {"±"}60s
        </span>
      </Tooltip>
    );
  }

  // v0.11.3+ "Back to Incident" breadcrumb. Only renders when the operator
  // arrived via "View Evidence" deep-link from Alerts & Incidents (i.e. the
  // parent passed `incomingFromAlert`). Click handler navigates back to the
  // alerts panel pre-focused on the originating alert. Calls onBackConsumed
  // so the parent clears `incomingFromAlert` after navigation fires {"—"}
  // otherwise a future visit would render a stale breadcrumb.
  // v0.11.4+: render-helper, not a JSX component (see renderShieldEvidenceDetail
  // for rationale). Called as `{renderBackToIncidentBreadcrumb()}`.
  function renderBackToIncidentBreadcrumb() {
    if (!incomingFromAlert || !onNavigate) return null;
    return (
      <button
        onClick={() => {
          // Clear local detail focus so saved filters get restored before
          // navigating away. Snap the breadcrumb state back too.
          setSelectedEvidence(null);
          setOutsideWindowEvent(null);
          setOutsideWindowCorrMethod(null);
          alertOriginRef.current = null;
          onBackConsumed?.();
          onNavigate("alertsIncidents", { focusAlertId: incomingFromAlert });
        }}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "3px 10px", marginBottom: 8,
          background: "transparent", border: `1px solid ${C.cyan}55`,
          borderRadius: 4, color: C.cyan, fontSize: 11, fontWeight: 700,
          fontFamily: F.sans, cursor: "pointer", textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        <span style={{ fontSize: 12 }}>{"←"}</span>
        <span>Back to Incident</span>
      </button>
    );
  }

  // v0.11.4+: render-helper, not a JSX component (see renderShieldEvidenceDetail
  // for rationale). Called as `{renderEvidenceDetail(e, false)}`.
  function renderEvidenceDetail(e: AuditData, outsideWindow = false) {
    // Ref hooks here so the detail row can be scrolled into view by the
    // focus-deep-link effect (`scrollIntoView`). When the row is rendered
    // because the operator clicked it locally, the ref is harmless — only
    // the focus effect reads it.
    return (
      <tr ref={detailRef}><td colSpan={6} style={{ padding: 0 }}>
        <div style={{ margin: "0 10px 8px", padding: "14px 16px", background: `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`, border: `1px solid ${C.glassBorderCyan}`, borderLeft: `4px solid ${C.cyan}`, borderRadius: 14, boxShadow: C.glassCardShadow }}>
          {/* v0.11.3+: breadcrumb back to the originating alert. Only renders
              when the operator arrived via deep-link with fromAlert set. */}
          {renderBackToIncidentBreadcrumb()}
          {/* v0.11.3+: informational notice (NOT a warning) when the row is
              outside the current time window. Operator does NOT have to widen
              the time filter; the row is already loaded via /api/audit/:id. */}
          {outsideWindow && (
            <div style={{
              padding: "6px 10px", marginBottom: 10, borderRadius: 8,
              background: `${C.cyan}22`, border: `1px solid ${C.cyan}55`,
              fontSize: 11, fontFamily: F.mono, color: C.txS,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ color: C.cyan, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Outside current window</span>
              <span>Loaded directly via deep-link &mdash; this row predates the dashboard&apos;s active time range.</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: F.mono, color: C.cyan }}>{formatEvidence(e.id)}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.tx }}>Evidence Record</span>
            </div>
            {/* v0.11.3+ Layer 4: correlation method pill \u2014 only when we
                came in via deep-link (alertOriginRef set) AND we resolved
                a method. Direct in-panel clicks don't show a pill. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {outsideWindowCorrMethod && alertOriginRef.current
                && renderCorrelationPill(outsideWindowCorrMethod)}
              <button onClick={() => setSelectedEvidence(null)} style={{ background: "none", border: `1px solid ${C.brd}`, borderRadius: 4, color: C.txT, fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>Close {"\u2715"}</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {[
              { label: "Event ID", value: e.id },
              { label: "Timestamp", value: e.created_at },
              { label: "Actor", value: e.actor || "\u2014" },
              { label: "Action", value: e.action },
              { label: "Resource Type", value: e.resource_type || "\u2014" },
              { label: "Resource ID", value: e.resource_id || "\u2014" },
              { label: "Source", value: e.source || "\u2014" },
              { label: "Result", value: deriveResult(e) },
            ].map((item, i) => (
              <div key={i} style={{ padding: "6px 8px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 12 }}>
                <div style={{ fontSize: 10, color: C.txT, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 12, fontFamily: F.mono, color: C.tx, wordBreak: "break-all" }}>{item.value}</div>
              </div>
            ))}
          </div>
          {e.detail && (() => {
            // Shield review/detected rows now persist a structured JSON detail
            // (session-watcher) so we can render rule_key + match-centered
            // snippet alongside the raw payload. Legacy plain-string detail
            // (anything that isn't valid JSON) falls back to the existing
            // pre-formatted view for backward compatibility.
            let parsed: ShieldAuditDetail | null = null;
            try { parsed = JSON.parse(e.detail) as ShieldAuditDetail; } catch { /* legacy string */ }
            const isShield =
              parsed && Array.isArray(parsed.shield_detections) &&
              (e.action === "shield_detected" || e.action === "shield_review");
            if (isShield && parsed) {
              return renderShieldEvidenceDetail(parsed);
            }
            return (
              <div style={{ marginTop: 8, padding: "8px 10px", background: C.pnl, borderRadius: 4 }}>
                <div style={{ fontSize: 10, color: C.txT, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Detail</div>
                <pre style={{ fontSize: 12, fontFamily: F.mono, color: C.txS, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{e.detail}</pre>
              </div>
            );
          })()}
        </div>
      </td></tr>
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
      {/* v0.12.0+: Mission Control return breadcrumb. Renders alongside the
          v0.11.3 BackToIncidentBreadcrumb when both are active (e.g. operator
          arrived via MC → alert → evidence). The two breadcrumbs are independent;
          clicking one does not affect the other's state. */}
      <MissionControlBreadcrumb
        visible={!!incomingFromMissionControl}
        onClick={() => onMissionControlBackConsumed?.()}
      />
      {/* Clear confirmation dialog */}
      {clearConfirm && (
        <div style={{
          padding: "12px 16px", marginBottom: 12, background: `${C.danger}10`, border: `1px solid ${C.danger}44`,
          borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 13, color: C.danger, fontFamily: F.sans }}>
            Clear {eventCount} audit events older than {filters.timeRange}?
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setClearConfirm(false)} style={{ padding: "4px 12px", background: "transparent", border: `1px solid ${C.brd}`, borderRadius: 4, color: C.txS, fontSize: 12, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleClear} disabled={clearing} style={{ padding: "4px 12px", background: C.danger, border: "none", borderRadius: 4, color: "#fff", fontSize: 12, fontWeight: 700, cursor: clearing ? "wait" : "pointer" }}>{clearing ? "Clearing..." : "Confirm Clear"}</button>
          </div>
        </div>
      )}

      {/* v0.8.3: filter row uses shared PanelFilters widget. URL-state-driven
          so refresh / back-button / share-via-paste preserve view; cross-panel
          deep-links (Timeline → Audit, future panels) can pre-filter via the
          navigate() opts. Server-side filter terms still go to /api/audit;
          additional client-side narrowing (multi-select) layered on top. */}
      <PanelFilters
        config={{
          search: { placeholder: "Search actions, actors, detail…" },
          status: ["success", "blocked", "observed", "detected", "flagged"],
          actor: uniqueActors,
          source: uniqueActions,
        }}
        values={urlState}
        onChange={(patch) => updateUrl(patch)}
        resultCount={filteredReal.length}
        totalCount={realEvents.length}
        showIdBadge
      />
      {/* v0.11.3+: the prior "NOT IN WINDOW" warning banner that asked the
          operator to widen the time filter has been removed. Replaced by an
          informational "Outside current window" notice rendered INSIDE the
          EVD detail card itself (see EvidenceDetail above), with the row
          loaded via /api/audit/:id (bypassing the time-window filter). The
          operator no longer has to take any action — the row is already
          here. internal reviewer requirement #3 + acceptance test #3. */}
      {/* Range + page-size kept separate — Range is panel-wide filter (set
          via the global time-range buttons in the header), page-size is view-
          only state. Neither belongs in the URL filter widget. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 600 }}>Range: {filters.timeRange}</span>
        <div style={{ flex: 1 }} />
        <select value={String(pageSize)} onChange={e => setPageSize(parseInt(e.target.value))} style={{ fontSize: 11, padding: "2px 6px", background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 3, color: C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}>
          <option value="10">10</option>
          <option value="15">15</option>
          <option value="25">25</option>
          <option value="50">50</option>
        </select>
        <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>{eventCount} events</span>
      </div>

      <Card
        title={`IMMUTABLE AUDIT TRAIL`}
        accent={C.brand}
        actions={<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {(!operatorRole || operatorRole === 'admin') && <Tooltip placement="left" variant="detail" content={<span><strong style={{ color: C.danger }}>Destructive — admin only.</strong> Wipes the audit log table for this instance. <strong>Three-step confirm</strong> required. Use only when archiving the database first or recovering from corrupted entries — compliance frameworks generally require append-only retention.</span>}><button onClick={() => setClearConfirm(true)} disabled={eventCount === 0} style={{ padding: "2px 8px", background: eventCount === 0 ? `${C.brd}` : `${C.danger}18`, border: `1px solid ${eventCount === 0 ? C.brd : C.danger}44`, borderRadius: 3, color: eventCount === 0 ? C.txT : C.danger, fontSize: 11, fontWeight: 600, fontFamily: F.sans, cursor: eventCount === 0 ? "not-allowed" : "pointer" }}>Clear</button></Tooltip>}
          <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>&#x21BB;{freshness}s</span>
        </div>}
      >
        {apiEvents === null && !demoMode && <LoadingSpinner />}

        {/* v0.11.3+: when the deep-linked row was OUTSIDE the current time
            window we fetched it via /api/audit/:id and render its detail
            here as a standalone single-row table. The detail card's
            informational notice + correlation pill explain the context.
            Only renders when the operator's selected id resolved to an
            outside-window row AND that row isn't also present in the
            current list view (defensive — the in-window path takes
            precedence). */}
        {outsideWindowEvent
          && selectedEvidence === outsideWindowEvent.id
          && !filteredReal.some(e => e.id === outsideWindowEvent.id)
          && !demoMode && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 10 }}>
            <tbody>
              {renderEvidenceDetail(outsideWindowEvent, true)}
            </tbody>
          </table>
        )}

        {/* Render table manually so we can insert evidence detail inline */}
        {(demoMode ? demoRows.length > 0 : filteredReal.length > 0) && (
          demoMode ? (
            <Table headers={["TIME", "ACTOR", "ACTION", "TARGET", "RESULT", "EVIDENCE"]} rows={demoRows} />
          ) : (
            <>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>
                {["TIME", "ACTOR", "ACTION", "TARGET", "RESULT", "EVIDENCE"].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pagedEvents.map(e => {
                  const isSelected = selectedEvidence === e.id;
                  const result = e._result;
                  return (<>
                    <tr key={e.id} style={{ background: isSelected ? C.glassSurfTrans : "transparent", transition: "background 0.15s" }}>
                      <td style={tdStyle}><span style={{ fontSize: 13, color: C.txT, fontFamily: F.mono }}>{formatTime(e.created_at)}</span></td>
                      <td style={tdStyle}><span style={{ fontSize: 13, fontFamily: F.mono, color: isSystemActor(e.actor || "") ? C.purp : C.tx }}>{e.actor || "--"}</span></td>
                      <td style={tdStyle}><span style={{ fontSize: 12, fontFamily: F.mono, color: C.cyan }}>{e.action}</span></td>
                      <td style={tdStyle}><span style={{ fontSize: 13, color: C.txS }}>{formatTarget(e)}</span></td>
                      <td style={tdStyle}><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, fontFamily: F.mono, background: `${resultColor(result)}22`, color: resultColor(result), border: `1px solid ${resultColor(result)}55`, textTransform: "uppercase", letterSpacing: "0.05em" }}>{result}</span></td>
                      <td style={tdStyle}><span onClick={() => setSelectedEvidence(isSelected ? null : e.id)} style={{ fontSize: 12, fontFamily: F.mono, color: C.cyan, cursor: "pointer", textDecoration: "underline", textDecorationColor: `${C.cyan}44`, textUnderlineOffset: 2 }}>{formatEvidence(e.id)}</span></td>
                    </tr>
                    {isSelected && renderEvidenceDetail(e)}
                  </>);
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}22` }}>
                <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>
                  Page {currentPage + 1} of {totalPages} ({eventCount} total)
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setCurrentPage(0)} disabled={currentPage === 0} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: currentPage === 0 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage === 0 ? "not-allowed" : "pointer" }}>{"\u00AB"}</button>
                  <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: currentPage === 0 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage === 0 ? "not-allowed" : "pointer" }}>{"\u2039"} Prev</button>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: currentPage >= totalPages - 1 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage >= totalPages - 1 ? "not-allowed" : "pointer" }}>Next {"\u203A"}</button>
                  <button onClick={() => setCurrentPage(totalPages - 1)} disabled={currentPage >= totalPages - 1} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.brd}`, background: "transparent", color: currentPage >= totalPages - 1 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage >= totalPages - 1 ? "not-allowed" : "pointer" }}>{"\u00BB"}</button>
                </div>
              </div>
            )}
            </>
          )
        )}

        {apiEvents !== null && filteredReal.length === 0 && !outsideWindowEvent && !demoMode && (
          <EmptyState message={
            (resultSel.length > 0 || actorSel.length > 0 || actionSel.length > 0 || searchText)
              ? "No events match the current filters. Clear filters to see everything."
              : "No audit events recorded yet."
          } />
        )}
      </Card>
    </div>
  );
}
