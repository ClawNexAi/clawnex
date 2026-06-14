"use client";

import { useState, useMemo } from "react";
import type { ShieldHistoryItem } from '../types';
import { C, F } from '../constants';
import { Badge, CollapsibleCard, Fresh, LoadingSpinner, EmptyState } from '../shared';

// ---------------------------------------------------------------------------
// ShieldScansFiltered
// ---------------------------------------------------------------------------

export function ShieldScansFiltered({ history }: { history: ShieldHistoryItem[] | null }) {
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [pageSize, setPageSize] = useState(15);

  const filtered = useMemo(() => {
    if (!history) return [];
    return history.filter(h => {
      if (verdictFilter !== "all" && h.threat_level.toUpperCase() !== verdictFilter) return false;
      return true;
    });
  }, [history, verdictFilter]);

  const verdictColors: Record<string, string> = { BLOCK: C.danger, REVIEW: C.warn, ALLOW: C.green };

  return (
    <CollapsibleCard title="Recent Shield Events" accent={C.info} count={filtered.length} defaultOpen={false} actions={
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <select value={verdictFilter} onChange={e => setVerdictFilter(e.target.value)} style={{ fontSize: 10, padding: "2px 4px", background: C.bg, border: `1px solid ${verdictFilter !== "all" ? C.danger : C.brd}`, borderRadius: 3, color: verdictFilter !== "all" ? C.danger : C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}>
          <option value="all">All Verdicts</option>
          <option value="ALLOW">ALLOW</option>
          <option value="REVIEW">REVIEW</option>
          <option value="BLOCK">BLOCK</option>
        </select>
        <select value={String(pageSize)} onChange={e => setPageSize(Number(e.target.value))} style={{ fontSize: 10, padding: "2px 4px", background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 3, color: C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}>
          {[10, 15, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <Fresh />
      </div>
    }>
      {history === null ? <LoadingSpinner /> : filtered.length === 0 ? <EmptyState message={verdictFilter !== "all" ? "No events match filter." : "No shield events yet."} /> : (
        <div style={{ position: "relative", paddingLeft: 22 }}>
          {/* Continuous vertical line */}
          <div style={{ position: "absolute", left: 8, top: 6, bottom: 6, width: 2, background: `${C.txT}44`, borderRadius: 1 }} />

          {filtered.slice(0, pageSize).map((h, i) => {
            const verdict = h.threat_level.toUpperCase();
            const color = verdictColors[verdict] || C.txT;
            const layers = h.layers_triggered && h.layers_triggered !== "none" ? h.layers_triggered : h.direction;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", position: "relative" }}>
                {/* Dot on the line */}
                <div style={{ position: "absolute", left: -18, top: "50%", transform: "translateY(-50%)", width: 12, display: "flex", justifyContent: "center" }}>
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: verdict === "BLOCK" ? `0 0 6px ${color}` : `0 0 3px ${color}66` }} />
                </div>
                <span style={{ fontSize: 11, fontFamily: F.mono, color: C.txT, minWidth: 42, flexShrink: 0 }}>
                  {new Date(h.scanned_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
                <Badge label={verdict} color={color} />
                <span style={{ fontSize: 11, color: C.tx, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {layers}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: F.mono, color, flexShrink: 0 }}>
                  {h.score ?? 0}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleCard>
  );
}
