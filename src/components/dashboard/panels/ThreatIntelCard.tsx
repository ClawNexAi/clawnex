"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from '../constants';
import { Badge, CollapsibleCard, Stat, Table } from '../shared';
import { Tooltip } from '../tooltip';
import { timeAgo } from '../utils';

export function ThreatIntelCard({ demoMode }: { demoMode?: boolean } = {}) {
  const [intelData, setIntelData] = useState<{ sources: Array<{ name: string; repo: string; lastChecked: string | null; lastCommit: string | null; ruleCount: number; status: string }>; totalPlinyRules: number } | null>(null);
  const [checking, setChecking] = useState(false);

  const fetchIntel = useCallback(async () => {
    if (demoMode) {
      // Demo: 4 monitored Pliny repos, 16 rule total. Last commit on
      // L1B3RT4S yesterday — implies the intel feed is fresh.
      setIntelData({
        totalPlinyRules: 16,
        sources: [
          { name: "L1B3RT4S", repo: "elder-plinius/L1B3RT4S", lastChecked: "2026-04-29T13:00:00Z", lastCommit: "2026-04-28T19:42:11Z", ruleCount: 10, status: "active" },
          { name: "CL4R1T4S", repo: "elder-plinius/CL4R1T4S", lastChecked: "2026-04-29T13:00:00Z", lastCommit: "2026-04-25T09:18:33Z", ruleCount: 0, status: "active" },
          { name: "P4RS3LT0NGV3", repo: "elder-plinius/P4RS3LT0NGV3", lastChecked: "2026-04-29T13:00:00Z", lastCommit: "2026-04-22T11:04:55Z", ruleCount: 3, status: "active" },
          { name: "multimodal-pentesting", repo: "elder-plinius/multimodal-pentesting", lastChecked: "2026-04-29T13:00:00Z", lastCommit: "2026-04-19T16:31:08Z", ruleCount: 3, status: "active" },
        ],
      });
      return;
    }
    try {
      const res = await fetch("/api/threat-intel");
      if (res.ok) setIntelData(await res.json());
    } catch {}
  }, [demoMode]);

  const checkUpdates = useCallback(async () => {
    if (demoMode) { /* no-op in demo */ return; }
    setChecking(true);
    try {
      const res = await fetch("/api/threat-intel/check", { method: "POST" });
      if (res.ok) await fetchIntel();
    } catch {}
    setChecking(false);
  }, [fetchIntel, demoMode]);

  useEffect(() => { fetchIntel(); }, [fetchIntel]);

  const sources = intelData?.sources || [
    { name: "L1B3RT4S", repo: "elder-plinius/L1B3RT4S", lastChecked: null, lastCommit: null, ruleCount: 10, status: "active" },
    { name: "ST3GG", repo: "elder-plinius/ST3GG", lastChecked: null, lastCommit: null, ruleCount: 3, status: "active" },
    { name: "G0DM0D3", repo: "elder-plinius/G0DM0D3", lastChecked: null, lastCommit: null, ruleCount: 0, status: "active" },
    { name: "P4RS3LT0NGV3", repo: "elder-plinius/P4RS3LT0NGV3", lastChecked: null, lastCommit: null, ruleCount: 3, status: "active" },
  ];

  return (
    <CollapsibleCard title="Threat Intelligence" accent={C.danger} count={sources.length} defaultOpen={true}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Stat label="Intel Sources" value={sources.length} color={C.danger} small />
        <Stat label="Pliny Rules" value={intelData?.totalPlinyRules ?? 16} color={C.orange} small />
        <Stat label="Source" value="Elder Pliny" color={C.purp} small />
      </div>

      <Table
        headers={["Source", "Repository", "Rules", "Last Checked", "Status"]}
        rows={sources.map((s, i) => [
          <span key={`n-${i}`} style={{ fontWeight: 700, color: C.danger, fontFamily: F.mono }}>{s.name}</span>,
          <a key={`r-${i}`} href={`https://github.com/${s.repo}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.info, textDecoration: "none", fontFamily: F.mono }}>{s.repo}</a>,
          <span key={`c-${i}`} style={{ color: C.brand, fontWeight: 700 }}>{s.ruleCount}</span>,
          <span key={`lc-${i}`} style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>{s.lastChecked ? timeAgo(s.lastChecked) : "Never"}</span>,
          <Badge key={`st-${i}`} label={s.status === "update_available" ? "UPDATE" : s.status.toUpperCase()} color={s.status === "update_available" ? C.warn : C.green} />,
        ])}
      />

      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <Tooltip placement="top" variant="detail" content={<span>Poll the four monitored Pliny repos for new commits since the last check. New jailbreak techniques landing upstream surface here as <strong>UPDATE</strong> badges; the shield update flow then pulls them into the live rule set.</span>}>
          <button onClick={checkUpdates} disabled={checking} style={{
            padding: "6px 14px", borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: F.mono,
            background: `${C.danger}18`, border: `1px solid ${C.danger}44`, color: C.danger,
            cursor: checking ? "wait" : "pointer",
          }}>{checking ? "Checking..." : "Check for Updates"}</button>
        </Tooltip>
        <span style={{ fontSize: 10, color: C.txT }}>Checks GitHub for new commits to Pliny repos. New techniques → new shield rules.</span>
      </div>

      <div style={{ marginTop: 12, padding: "8px 12px", background: `${C.purp}08`, border: `1px solid ${C.purp}22`, borderRadius: 6 }}>
        <div style={{ fontSize: 10, color: C.purp, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>About This Intel</div>
        <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5 }}>
          Elder Pliny (Pliny the Liberator) publishes cutting-edge AI jailbreak techniques. ClawNex monitors these repos to stay ahead of emerging threats.
          The shield includes 16 Pliny-specific rules across jailbreak (GODMODE, compliance priming, refusal inversion, role hijacking, system override),
          steganography (Unicode Tags block, variation selectors, binary payloads), and encoding (multi-layer, l33tspeak, char substitution) categories.
        </div>
      </div>
    </CollapsibleCard>
  );
}
