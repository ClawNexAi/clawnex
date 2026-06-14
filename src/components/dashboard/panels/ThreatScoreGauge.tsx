"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from "../constants";
import { Card, Stat, Gauge } from "../shared";
import { Tooltip } from "../tooltip";
import type { TabId } from "../types";

export function ThreatScoreGauge({ onNavigate }: { onNavigate: (tab: TabId) => void }) {
  const [scoreData, setScoreData] = useState<{ threat_score: number; level: string; breakdown: Record<string, number>; triggered_rules: number; state_summary?: Record<string, unknown> } | null>(null);
  const [prevScore, setPrevScore] = useState<number | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [lastEval, setLastEval] = useState<string | null>(null);

  const evaluate = useCallback(async () => {
    setEvaluating(true);
    try {
      const res = await fetch("/api/correlations/evaluate", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setScoreData(prev => {
          if (prev) setPrevScore(prev.threat_score);
          return data;
        });
        setLastEval("Updated " + new Date().toLocaleTimeString());
        setTimeout(() => setLastEval(null), 3000);
      }
    } catch {}
    setEvaluating(false);
  }, []);

  useEffect(() => {
    evaluate();
    const iv = setInterval(evaluate, 30000);
    return () => clearInterval(iv);
  }, [evaluate]);

  if (!scoreData) return null;

  const { threat_score, level, breakdown, triggered_rules } = scoreData;
  const levelColor = level === "CRITICAL" ? C.danger : level === "HIGH" ? C.orange : level === "MEDIUM" ? C.warn : C.green;
  const sortedSources = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);

  return (
    <Card title="OVERALL THREAT SCORE" accent={levelColor} glow={threat_score > 50 ? levelColor : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <Gauge value={threat_score} label={level} color={levelColor} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <Stat label="Score" value={threat_score} color={levelColor} small />
            <Stat label="Level" value={level} color={levelColor} small />
            <Stat label="Trend" value={prevScore === null ? "\u2192 Stable" : threat_score > prevScore ? "\u2191 Rising" : threat_score < prevScore ? "\u2193 Falling" : "\u2192 Stable"} color={prevScore !== null && threat_score > prevScore ? C.danger : prevScore !== null && threat_score < prevScore ? C.green : C.txS} small />
            <Stat label="Rules Triggered" value={triggered_rules} color={triggered_rules > 0 ? C.orange : C.green} small />
          </div>
          {sortedSources.length > 0 && (
            <div style={{ fontSize: 11, color: C.txS, marginTop: 6 }}>
              <span style={{ fontWeight: 700, color: C.txT, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>Source Breakdown: </span>
              {sortedSources.map(([src, pts], i) => (
                <span key={src}>
                  <span style={{ color: C.tx, fontFamily: F.mono }}>{src}</span>
                  <span style={{ color: levelColor, fontWeight: 700, fontFamily: F.mono }}> {Math.round(pts)}pts</span>
                  {i < sortedSources.length - 1 && <span style={{ color: C.txG }}> · </span>}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastEval && <span style={{ fontSize: 10, color: C.green, fontFamily: F.mono }}>{"\u2713"} {lastEval}</span>}
          <Tooltip placement="left" variant="detail" content={<span>Recompute the composite threat score right now, bypassing the 5-second cache. Pulls fresh signals from shield scans, access violations, traffic anomalies, infrastructure health, and access-list hits — combined using the <strong>Threat Score Weights</strong> you set in Configuration. The previous result stays visible while the new one computes.</span>}>
            <button onClick={evaluate} disabled={evaluating} style={{ padding: "4px 12px", borderRadius: 4, border: `1px solid ${C.brand}`, background: evaluating ? `${C.brand}22` : "transparent", color: C.brand, fontSize: 10, fontWeight: 700, fontFamily: F.mono, cursor: evaluating ? "wait" : "pointer" }}>{evaluating ? "Evaluating..." : "Re-evaluate"}</button>
          </Tooltip>
        </div>
      </div>
    </Card>
  );
}
