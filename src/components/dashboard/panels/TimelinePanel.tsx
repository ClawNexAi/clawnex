"use client";

import { useState, useMemo, useEffect } from "react";
import { C, F } from "../constants";
import { CollapsibleCard, Badge, Fresh, PaginationFooter } from "../shared";
import type { TabId, DashboardFilters } from "../types";

/**
 * Instance Detail's Timeline section. Renders the most recent N alerts +
 * audit events sorted reverse-chronologically with backlinks to the source
 * panel.
 *
 * v0.8.2+: backlinks now carry the source row's id so the destination panel
 * can pre-filter to that exact row + pulse it on arrival. operator-stumbled-on
 * pain point — clicking "Alerts →" used to dump the operator in the full
 * unfiltered alerts list.
 *
 * onNavigate signature accepts the v0.8.2 opts shape: passing { id, highlight }
 * makes the destination panel filter to that row and animate on mount. The
 * back-compat string-only path still works for callers that don't carry an id.
 */
export function TimelinePanel({ alerts, audit, filters, onNavigate }: {
  alerts: Array<{ id: string; title: string; severity: string; source: string; status: string; created_at: string }>;
  // v0.8.2+: audit carries id for Timeline → Audit & Evidence deep-link
  audit: Array<{ id: string; action: string; actor: string; detail: string; created_at: string }>;
  filters: DashboardFilters;
  onNavigate: (tab: TabId, opts?: { id?: string; highlight?: string }) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  // Default 10 rows per page, expanded-by-default — operator directive 2026-05-08.
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(0);
  useEffect(() => { setCurrentPage(0); }, [pageSize]);

  const typeColors: Record<string, string> = { CRITICAL: C.danger, ERROR: C.orange, WARN: C.warn, INFO: C.cyan, REMEDIATE: C.green };

  // Build raw timeline. Each item carries the source row's id so the backlink
  // can deep-link the destination panel to that exact row.
  const rawTimeline = useMemo(() => {
    const items = [
      ...alerts.map(a => ({
        time: a.created_at,
        type: a.severity === "CRITICAL" ? "CRITICAL" : a.severity === "HIGH" ? "ERROR" : a.severity === "MEDIUM" ? "WARN" : "INFO",
        label: a.title,
        detail: a.source,
        tab: "alertsIncidents" as TabId,
        sourceId: a.id,
      })),
      ...audit.filter(e => e.action !== "agent_event").map(e => ({
        time: e.created_at,
        type: e.action.includes("block") ? "CRITICAL" : e.action.includes("break_glass") ? "ERROR" : e.action.includes("config") ? "WARN" : "INFO",
        label: e.action.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        detail: e.detail?.slice(0, 80) || "",
        tab: "auditEvidence" as TabId,
        sourceId: e.id,
      })),
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 50);
    return items;
  }, [alerts, audit]);

  // Group consecutive duplicate events. The group's `sourceId` is the FIRST
  // event's id (the most recent occurrence) — that's what the backlink jumps
  // to when the operator clicks the parent row. Expanded individual events
  // each carry their own sourceId for finer-grained deep-link.
  const grouped = useMemo(() => {
    const result: Array<{ events: typeof rawTimeline; label: string; type: string; time: string; tab: TabId; sourceId: string; count: number }> = [];
    for (const evt of rawTimeline) {
      const last = result[result.length - 1];
      if (last && last.label === evt.label && last.type === evt.type) {
        last.events.push(evt);
        last.count++;
      } else {
        result.push({ events: [evt], label: evt.label, type: evt.type, time: evt.time, tab: evt.tab, sourceId: evt.sourceId, count: 1 });
      }
    }
    return result;
  }, [rawTimeline]);

  if (grouped.length === 0) return <CollapsibleCard title={`Timeline (${filters.timeRange})`} accent={C.orange} defaultOpen={true} count={0}><span style={{ fontSize: 12, color: C.txT }}>No events in this period.</span></CollapsibleCard>;

  const totalEvents = grouped.reduce((acc, g) => acc + g.events.length, 0);
  const totalPages = Math.max(1, Math.ceil(grouped.length / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);
  const visibleGroups = grouped.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <CollapsibleCard title={`Timeline (${filters.timeRange})`} accent={C.orange} defaultOpen={true} count={totalEvents} actions={<Fresh />}>
      <div style={{ position: "relative", paddingLeft: 22 }}>
        {/* Continuous vertical line */}
        <div style={{ position: "absolute", left: 8, top: 6, bottom: 6, width: 2, background: `${C.txT}44`, borderRadius: 1 }} />

        {visibleGroups.map((group, vi) => {
          // Preserve absolute index across pages so expandedGroups keys remain
          // stable when the operator paginates (otherwise gi=0 on page 2 would
          // collide with gi=0 on page 1).
          const gi = safePage * pageSize + vi;
          const isExpanded = expandedGroups.has(gi);
          const isGrouped = group.count > 1;
          const color = typeColors[group.type] || C.txT;

          return (
            <div key={gi}>
              {/* Main row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", position: "relative" }}>
                {/* Dot centered on the line */}
                <div style={{ position: "absolute", left: -18, top: "50%", transform: "translateY(-50%)", width: 12, display: "flex", justifyContent: "center" }}>
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: group.type === "CRITICAL" ? `0 0 8px ${color}` : `0 0 3px ${color}66` }} />
                </div>
                <span style={{ fontSize: 12, fontFamily: F.mono, color: C.txT, minWidth: 42, flexShrink: 0 }}>
                  {new Date(group.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
                <Badge label={group.type} color={color} />
                <span style={{ fontSize: 12, color: C.tx, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{group.label}</span>
                {isGrouped && (
                  <span onClick={() => setExpandedGroups(prev => { const n = new Set(prev); n.has(gi) ? n.delete(gi) : n.add(gi); return n; })} style={{ fontSize: 9, color: C.txT, fontFamily: F.mono, padding: "1px 6px", background: `${color}15`, border: `1px solid ${color}33`, borderRadius: 3, cursor: "pointer" }}>
                    {isExpanded ? "\u25BC" : "\u25B6"} x{group.count}
                  </span>
                )}
                {/* Backlink to source — v0.8.2+ passes id + highlight so the
                    destination filters to this exact row and pulses it on
                    arrival. Operator no longer dropped in unfiltered list. */}
                <button
                  onClick={() => onNavigate(group.tab, { id: group.sourceId, highlight: group.sourceId })}
                  title={`Open ${group.tab === "alertsIncidents" ? "Alerts" : "Audit & Evidence"} pre-filtered to this row`}
                  style={{
                    background: "none", border: "none", color: C.info, fontSize: 11, cursor: "pointer",
                    padding: "2px 4px", fontFamily: F.sans, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" as const,
                  }}
                >
                  {group.tab === "alertsIncidents" ? "Alerts" : "Audit"} {"\u2192"}
                </button>
              </div>

              {/* Expanded duplicates */}
              {isGrouped && isExpanded && group.events.slice(1).map((evt, ei) => (
                <div key={ei} style={{ display: "flex", alignItems: "center", gap: 10, padding: "3px 0 3px 0", position: "relative" }}>
                  <div style={{ position: "absolute", left: -18, top: "50%", transform: "translateY(-50%)", width: 12, display: "flex", justifyContent: "center" }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: `${color}88` }} />
                  </div>
                  <span style={{ fontSize: 10, fontFamily: F.mono, color: C.txT, minWidth: 42 }}>
                    {new Date(evt.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                  <span style={{ fontSize: 10, color: C.txS, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{evt.detail}</span>
                  <button
                    onClick={() => onNavigate(evt.tab, { id: evt.sourceId, highlight: evt.sourceId })}
                    title={`Open ${evt.tab === "alertsIncidents" ? "Alerts" : "Audit & Evidence"} pre-filtered to this row`}
                    style={{ background: "none", border: "none", color: C.info, fontSize: 10, cursor: "pointer", padding: 0, flexShrink: 0 }}
                  >{"\u2192"}</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {grouped.length > pageSize && (
        <PaginationFooter
          currentPage={safePage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRows={grouped.length}
          onPageSizeChange={setPageSize}
          onPageChange={setCurrentPage}
        />
      )}
    </CollapsibleCard>
  );
}
