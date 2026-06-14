"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from "../constants";
import { Card, Table, LoadingSpinner, EmptyState, EnterpriseCard } from "../shared";
import { timeAgo } from "../utils";
import type { DashboardFilters } from "../types";


export function AccessListsPanel({ demoMode, filters }: { demoMode: boolean; filters: DashboardFilters }) {
  const [tab, setTab] = useState<"IP" | "DOMAIN" | "USER">("IP");
  const [mode, setMode] = useState<"deny">("deny");
  const [entries, setEntries] = useState<Array<{ id: string; list_type: string; entry_type: string; value: string; reason: string | null; added_by: string | null; created_at: string }>>([]);
  const [newValue, setNewValue] = useState("");
  const [newReason, setNewReason] = useState("");
  const [loading, setLoading] = useState(true);

  const isEnterprise = tab === "USER";

  const fetchEntries = useCallback(async () => {
    if (tab === "USER") { setLoading(false); return; }
    try {
      const res = await fetch(`/api/access-lists?list_type=${mode}&entry_type=${tab}`);
      if (res.ok) { const data = await res.json(); setEntries(data.entries || []); }
    } catch {}
    setLoading(false);
  }, [mode, tab]);

  useEffect(() => { setLoading(true); setEntries([]); fetchEntries(); }, [fetchEntries]);

  const addEntry = useCallback(async () => {
    if (!newValue.trim() || isEnterprise) return;
    try {
      const res = await fetch("/api/access-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_type: mode, entry_type: tab, value: newValue.trim(), reason: newReason.trim() || undefined }),
      });
      if (res.ok) { setNewValue(""); setNewReason(""); fetchEntries(); }
    } catch {}
  }, [newValue, newReason, mode, tab, fetchEntries, isEnterprise]);

  const removeEntry = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/access-lists?id=${id}`, { method: "DELETE" });
      if (res.ok) fetchEntries();
    } catch {}
  }, [fetchEntries]);

  const mockEntries = demoMode ? [
    { id: "m1", list_type: "deny", entry_type: "DOMAIN", value: "malicious-site.com", reason: "Known C2 domain", added_by: "admin", created_at: "2026-03-15T00:00:00Z" },
    { id: "m2", list_type: "deny", entry_type: "IP", value: "203.0.113.50", reason: "Suspicious source", added_by: "admin", created_at: "2026-03-10T00:00:00Z" },
  ] : [];

  const displayEntries = entries.length > 0 ? entries : mockEntries.filter(e => e.list_type === mode && e.entry_type === tab);

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab.
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
      {filters.selectedInstance !== "all" && (
        <div style={{ fontSize: 12, color: C.txS, padding: "8px 12px", background: `${C.info}08`, border: `1px solid ${C.info}22`, borderRadius: 6, marginBottom: 12 }}>
          <strong style={{ color: C.info }}>&#x2139;</strong> Access lists (domain and IP deny rules) are enforced globally across all instances.
        </div>
      )}

      {/* Entry type tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["IP", "DOMAIN"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 14px", borderRadius: 6, fontSize: 12, fontFamily: F.sans, fontWeight: 700, cursor: "pointer",
            background: tab === t ? `${C.brand}18` : "transparent",
            border: `1px solid ${tab === t ? C.brand : C.glassBorderSubtle}`,
            color: tab === t ? C.brand : C.txS,
          }}>{t}</button>
        ))}
        {/* USER tab — enterprise badge */}
        <button onClick={() => setTab("USER")} style={{
          padding: "6px 14px", borderRadius: 6, fontSize: 12, fontFamily: F.sans, fontWeight: 700, cursor: "pointer",
          background: tab === "USER" ? `${C.purp}18` : "transparent",
          border: `1px solid ${tab === "USER" ? C.purp : C.glassBorderSubtle}`,
          color: tab === "USER" ? C.purp : C.txS,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          USER
          <span style={{ fontSize: 8, fontWeight: 700, color: C.purp, background: `${C.purp}18`, border: `1px solid ${C.purp}44`, borderRadius: 3, padding: "1px 4px", letterSpacing: "0.05em" }}>ENT</span>
        </button>

        <div style={{ flex: 1 }} />

        {/* Deny mode (active) */}
        <button style={{
          padding: "6px 14px", borderRadius: 6, fontSize: 12, fontFamily: F.sans, fontWeight: 700,
          background: `${C.danger}18`, border: `1px solid ${C.danger}`, color: C.danger, cursor: "default",
        }}>Deny</button>

        {/* Allow mode — enterprise badge */}
        <button style={{
          padding: "6px 14px", borderRadius: 6, fontSize: 12, fontFamily: F.sans, fontWeight: 700, cursor: "not-allowed",
          background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, color: C.txT,
          display: "flex", alignItems: "center", gap: 6, opacity: 0.5,
        }}>
          Allow
          <span style={{ fontSize: 8, fontWeight: 700, color: C.purp, background: `${C.purp}18`, border: `1px solid ${C.purp}44`, borderRadius: 3, padding: "1px 4px", letterSpacing: "0.05em" }}>ENT</span>
        </button>
      </div>

      {/* Enterprise overlay for USER tab */}
      {tab === "USER" && (
        <EnterpriseCard
          feature="User-Based Access Control"
          description="Control access by operator identity. Deny or allow specific users across the fleet. Available in ClawNex Enterprise."
        />
      )}

      {/* Active deny list status */}
      {!isEnterprise && (
        <div style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 8, background: `${C.green}0c`, border: `1px solid ${C.green}33`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, color: C.green }}>{"\u2713"}</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>{tab} Deny List — Active</div>
            <div style={{ fontSize: 11, color: C.txT, marginTop: 2 }}>Denied {tab === "DOMAIN" ? "domains" : "IPs"} are enforced by the Prompt Shield. Any LLM traffic containing a denied {tab === "DOMAIN" ? "domain" : "IP"} will be flagged as a HIGH severity detection.</div>
          </div>
        </div>
      )}

      {/* Main content — only for IP and DOMAIN */}
      {!isEnterprise && (
        <Card title={`${tab} Deny List`} accent={C.danger}>
          {loading ? <LoadingSpinner /> : displayEntries.length > 0 ? (
            <Table
              headers={["Value", "Reason", "Added By", "Date", "Actions"]}
              rows={displayEntries.map(item => [
                <span key="v" style={{ fontFamily: F.mono, fontSize: 13, color: C.tx }}>{item.value}</span>,
                <span key="r" style={{ fontSize: 13, color: C.txS }}>{item.reason || "--"}</span>,
                <span key="a" style={{ fontSize: 13, color: C.txT }}>{item.added_by || "--"}</span>,
                <span key="d" style={{ fontSize: 13, color: C.txT, fontFamily: F.mono }}>{timeAgo(item.created_at)}</span>,
                <button key="del" onClick={() => removeEntry(item.id)} style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${C.danger}44`, borderRadius: 4, color: C.danger, fontSize: 11, cursor: "pointer" }}>Remove</button>,
              ])}
            />
          ) : (
            <EmptyState message={`No ${tab.toLowerCase()} deny list entries. Add one below.`} />
          )}

          {/* Add new entry */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.glassBorderSubtle}` }}>
            <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder={tab === "IP" ? "192.168.1.100 or 10.0.0.0/8" : "malicious-domain.com"} onKeyDown={e => e.key === "Enter" && addEntry()} style={{
              flex: 1, padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 13, outline: "none",
            }} />
            <input value={newReason} onChange={e => setNewReason(e.target.value)} placeholder="Reason (optional)" onKeyDown={e => e.key === "Enter" && addEntry()} style={{
              flex: 1, padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6, color: C.tx, fontFamily: F.sans, fontSize: 13, outline: "none",
            }} />
            <button onClick={addEntry} disabled={!newValue.trim()} style={{
              padding: "6px 14px", background: !newValue.trim() ? C.brd : C.danger, color: "#fff",
              border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: !newValue.trim() ? "not-allowed" : "pointer",
            }}>+ Add</button>
          </div>
        </Card>
      )}

      {/* Enterprise upsell for allow lists */}
      <div style={{ marginTop: isEnterprise ? 0 : 16 }}>
        <EnterpriseCard
          feature="Network Allow Lists"
          description="Restrict LLM traffic to approved domains and IP ranges only. Everything not on the allow list is automatically blocked. Available in ClawNex Enterprise."
        />
      </div>
    </div>
  );
}
