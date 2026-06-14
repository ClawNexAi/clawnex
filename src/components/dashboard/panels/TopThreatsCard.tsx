"use client";

import { useState } from "react";
import { C, F } from "../constants";
import { Badge, Card, Fresh } from "../shared";
import { sevColor, timeAgo } from "../utils";
import type { TabId } from "../types";

export function TopThreatsCard({ threats, onNavigate }: { threats: Array<{ name: string; count: number; severity?: string; lastSeen?: string; sample?: string; actors?: Array<{ actor: string; count: number }> }>; onNavigate: (tab: TabId) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  return (
    <Card title="TOP THREATS DETECTED" accent={C.danger} actions={<Fresh />}>
      {threats.slice(0, 8).map(t => {
        const isOpen = expanded.has(t.name);
        const sc = sevColor(t.severity || "HIGH");
        return (
          <div key={t.name} style={{ marginBottom: 6, background: `${C.danger}06`, borderRadius: 6, border: `1px solid ${C.danger}15`, overflow: "hidden" }}>
            {/* Collapsed header */}
            <div onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(t.name) ? n.delete(t.name) : n.add(t.name); return n; })} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
            }}>
              <span style={{ fontSize: 10, color: C.txT, transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>{"\u25B6"}</span>
              <span style={{ fontSize: 12, fontFamily: F.mono, color: C.tx, flex: 1 }}>{t.name}</span>
              {t.severity && <Badge label={t.severity} color={sc} />}
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: F.mono, color: C.danger }}>{t.count}</span>
            </div>

            {/* Expanded details */}
            {isOpen && (
              <div style={{ padding: "0 12px 10px 28px" }}>
                {/* Actors */}
                {t.actors && t.actors.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 9, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Top Actors:</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                      {t.actors.map(a => (
                        <span key={a.actor} style={{ fontSize: 10, padding: "1px 6px", background: `${C.purp}14`, border: `1px solid ${C.purp}28`, borderRadius: 3, color: C.purp, fontFamily: F.mono }}>{a.actor}: {a.count}</span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Last seen */}
                {t.lastSeen && <div style={{ fontSize: 10, color: C.txT, marginBottom: 4 }}>Last seen: <span style={{ color: C.txS, fontFamily: F.mono }}>{timeAgo(t.lastSeen)}</span></div>}
                {/* Sample */}
                {t.sample && (
                  <div style={{ fontSize: 10, color: C.txT, marginBottom: 6 }}>
                    Sample: <span style={{ color: C.txS, fontFamily: F.mono, background: `${C.bg}`, padding: "1px 4px", borderRadius: 3 }}>{t.sample}</span>
                  </div>
                )}
                {/* Backlinks */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => onNavigate("shield")} style={{ background: "none", border: "none", color: C.info, fontSize: 10, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: F.sans }}>Shield {"\u2192"}</button>
                  <button onClick={() => onNavigate("alertsIncidents")} style={{ background: "none", border: "none", color: C.info, fontSize: 10, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: F.sans }}>Alerts {"\u2192"}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}
