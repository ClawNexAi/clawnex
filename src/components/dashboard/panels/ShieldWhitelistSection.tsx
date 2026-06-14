"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from '../constants';
import { Badge, Card, PaginationFooter } from '../shared';
import { Tooltip } from '../tooltip';
import { sevColor } from '../utils';

// ---------------------------------------------------------------------------
// Panel-specific types
// ---------------------------------------------------------------------------

interface WhitelistRule { id: string; title: string; category: string; severity: string; whitelisted: boolean; }

// Human-readable group headers, keyed by the prefix segment of the rule ID
// (everything before the first hyphen). Used to visually cluster whitelisted
// chips by purpose so operators can tell at a glance why each entry exists.
const GROUP_LABELS: Record<string, string> = {
  COG: "OpenClaw Internal",
  FIN: "Financial",
  PII: "Personal Data",
  C2: "Command & Control",
  JBR: "Jailbreak",
  EXF: "Exfiltration",
};

// ---------------------------------------------------------------------------
// ShieldWhitelistSection
// ---------------------------------------------------------------------------

export function ShieldWhitelistSection() {
  const [rules, setRules] = useState<WhitelistRule[] | null>(null);
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [filterCat, setFilterCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  // v0.11.5+: rule-of-5 pagination on the whitelist table.
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filterCat, search, pageSize]);

  const fetchWhitelist = useCallback(async () => {
    try {
      const res = await fetch("/api/shield/whitelist");
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules);
        setWhitelist(data.whitelist);
        setDirty(false);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchWhitelist(); }, [fetchWhitelist]);

  const handleToggle = useCallback((ruleId: string) => {
    setWhitelist((prev) => {
      const next = prev.includes(ruleId) ? prev.filter((id) => id !== ruleId) : [...prev, ruleId];
      setDirty(true);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/shield/whitelist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: whitelist }),
      });
      if (res.ok) { setDirty(false); fetchWhitelist(); }
    } catch {} finally { setSaving(false); }
  }, [whitelist, fetchWhitelist]);

  if (!rules) return null;

  const categories = Array.from(new Set(rules.map((r: WhitelistRule) => r.category))).sort();
  const filtered = rules.filter((r: WhitelistRule) => {
    if (filterCat !== "all" && r.category !== filterCat) return false;
    if (search && !r.id.toLowerCase().includes(search.toLowerCase()) && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedRules = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const whitelistedCount = whitelist.length;

  return (
    <Card title={`Rule Whitelist (${whitelistedCount} active)`} accent={C.purp} actions={
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {dirty && <span style={{ fontSize: 11, color: C.warn, fontFamily: F.mono }}>unsaved</span>}
        <button onClick={() => setExpanded(!expanded)} style={{
          padding: "3px 10px", background: "transparent", color: C.txS, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4,
          fontSize: 12, cursor: "pointer", fontFamily: F.mono,
        }}>
          {expanded ? "Collapse" : "Manage"}
        </button>
      </div>
    }>
      <div style={{ fontSize: 13, color: C.txS, marginBottom: expanded ? 12 : 0, lineHeight: 1.6 }}>
        <strong>Why these rules?</strong> OpenClaw agents read their own <span style={{ fontFamily: F.mono, color: C.cyan }}>SOUL.md</span>,{" "}
        <span style={{ fontFamily: F.mono, color: C.cyan }}>IDENTITY.md</span>, <span style={{ fontFamily: F.mono, color: C.cyan }}>MEMORY.md</span>,{" "}
        and system config files on every boot. Without these exemptions, normal agent startup would trigger a flood of{" "}
        <strong style={{ color: C.danger }}>CRITICAL</strong> cognitive-tampering detections on the internal LiteLLM + session-watcher paths.{" "}
        <strong style={{ color: C.tx }}>External traffic, dashboard scans, and the Prompt Shield live scanner still run every rule</strong> —
        the exemptions are scoped narrowly to internal agent traffic only. Remove any entry you don&apos;t trust via the{" "}
        <span style={{ color: C.brand }}>Manage</span> button.
      </div>

      {!expanded && whitelistedCount > 0 && (() => {
        // Group chips by rule ID prefix so the "OpenClaw internal" set visually clusters
        // together. Currently only the COG-* family exists, but this scales if future
        // whitelist entries appear under new prefixes.
        const groups: Record<string, Array<{ id: string; title: string }>> = {};
        for (const id of whitelist) {
          const rule = rules.find(r => r.id === id);
          const prefix = id.split('-')[0] || 'OTHER';
          const label = GROUP_LABELS[prefix] || prefix;
          if (!groups[label]) groups[label] = [];
          groups[label].push({ id, title: rule?.title || id });
        }
        return (
          <div style={{ marginTop: 10 }}>
            {Object.entries(groups).map(([groupLabel, entries]) => (
              <div key={groupLabel} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                  {groupLabel} ({entries.length})
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {entries.map(({ id, title }) => (
                    <Badge key={id} label={`${id} — ${title}`} color={C.txT} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {expanded && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <Tooltip placement="top" variant="compact" content="Search by rule ID (e.g. COG-002) or rule title.">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules..."
                style={{ flex: 1, minWidth: 160, padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none" }}
              />
            </Tooltip>
            <Tooltip placement="top" variant="compact" content="Narrow the list to a single rule category.">
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                style={{ padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none" }}
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </Tooltip>
          </div>

          <div style={{ maxHeight: 360, overflowY: "auto", border: `1px solid ${C.glassBorderCyan}`, borderRadius: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                  {["Skip", "Rule ID", "Name", "Category", "Severity"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: C.txS, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRules.map((rule: WhitelistRule) => {
                  const isWL = whitelist.includes(rule.id);
                  return (
                    <tr key={rule.id} onClick={() => handleToggle(rule.id)}
                      style={{ borderBottom: `1px solid ${C.glassBorderSubtle}`, background: isWL ? `${C.purp}38` : C.glassSurfTrans, cursor: "pointer" }}
                    >
                      <td style={{ padding: "6px 10px", textAlign: "center" }}>
                        <span style={{
                          display: "inline-block", width: 16, height: 16, borderRadius: 3,
                          border: `2px solid ${isWL ? C.purp : C.glassBorderSubtle}`, background: isWL ? C.purp : "transparent",
                          lineHeight: "12px", textAlign: "center", fontSize: 11, color: "#fff", fontWeight: 700,
                        }}>{isWL ? "\u2713" : ""}</span>
                      </td>
                      <td style={{ padding: "6px 10px", fontFamily: F.mono, fontSize: 12, color: C.txT }}>{rule.id}</td>
                      <td style={{ padding: "6px 10px", color: C.tx }}>{rule.title}</td>
                      <td style={{ padding: "6px 10px" }}><Badge label={rule.category} color={C.purp} /></td>
                      <td style={{ padding: "6px 10px" }}><Badge label={rule.severity} color={sevColor(rule.severity)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <PaginationFooter
              currentPage={page}
              totalPages={totalPages}
              pageSize={pageSize}
              totalRows={filtered.length}
              onPageSizeChange={setPageSize}
              onPageChange={setPage}
            />
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <span style={{ fontSize: 12, color: C.txT, alignSelf: "center" }}>{filtered.length} rules shown · {whitelistedCount} whitelisted</span>
            <Tooltip placement="top" variant="detail" content={<span>Persist the whitelist. Takes effect immediately for the next request — no restart. Each whitelisted rule is logged to audit so you can prove the exemption was deliberate.</span>}>
              <button onClick={handleSave} disabled={!dirty || saving}
                style={{
                  padding: "7px 18px", background: dirty ? `linear-gradient(135deg, ${C.cyan} 0%, ${C.green} 100%)` : C.glassSurfTrans, color: dirty ? "#04070e" : C.txT, border: "none",
                  borderRadius: 6, fontWeight: 700, fontSize: 13, fontFamily: F.sans,
                  cursor: dirty && !saving ? "pointer" : "not-allowed", opacity: dirty ? 1 : 0.5,
                }}
              >{saving ? "Saving..." : "Save Whitelist"}</button>
            </Tooltip>
          </div>
        </>
      )}
    </Card>
  );
}
