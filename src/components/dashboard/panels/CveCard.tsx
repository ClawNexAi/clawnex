"use client";

import { useState, useEffect, useCallback } from "react";
import type { TabId } from '../types';
import { C, F } from '../constants';
import { Badge, Stat, CollapsibleCard, LoadingSpinner, PaginationFooter } from '../shared';
import { Tooltip } from '../tooltip';
import { timeAgo } from '../utils';

// ---------------------------------------------------------------------------
// CveCard
// ---------------------------------------------------------------------------

export function CveCard({ onNavigate, demoMode }: { onNavigate?: (tab: TabId, focus?: string) => void; demoMode?: boolean }) {
  const [cveData, setCveData] = useState<{ cves: Array<{ cve_id: string; severity: string; cvss: number | null; title: string; date_published: string; fixed_version: string; cwes: string; html_url: string }>; total: number; critical: number; high: number; lastSync: string | null; installedVersion: string } | null>(null);
  const [cveState, setCveState] = useState<"loading" | "ready" | "error">("loading");
  const [syncing, setSyncing] = useState(false);
  const [expandedCves, setExpandedCves] = useState<Set<string>>(new Set());
  // v0.11.5+: rule-of-5 pagination — operator directive: CVE list defaults to 10/page.
  const [cvePageSize, setCvePageSize] = useState(10);
  const [cvePage, setCvePage] = useState(0);
  useEffect(() => { setCvePage(0); }, [cvePageSize]);

  const fetchCves = useCallback(async () => {
    setCveState("loading");
    if (demoMode) {
      // Demo mode: synthetic CVE feed with one critical entry that matches
      // the COR-001 attack chain (CVE-2024-1067 in API gateway). Cross-refs
      // INST s-003 (Pinnacle AI) and ALT-001 in the demo narrative.
      setCveData({
        installedVersion: "2026-04-29",
        lastSync: "2026-04-29T11:14:22Z",
        total: 12,
        critical: 1,
        high: 3,
        cves: [
          { cve_id: "CVE-2024-1067", severity: "CRITICAL", cvss: 9.8, title: "API Gateway authentication bypass", date_published: "2024-01-12T00:00:00Z", fixed_version: "api-gateway 4.2.1", cwes: "CWE-287, CWE-290", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-1067" },
          { cve_id: "CVE-2024-2031", severity: "HIGH", cvss: 8.4, title: "Container escape via mount namespace", date_published: "2024-02-08T00:00:00Z", fixed_version: "containerd 1.7.5", cwes: "CWE-269", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-2031" },
          { cve_id: "CVE-2024-3187", severity: "HIGH", cvss: 7.5, title: "TLS handshake DoS", date_published: "2024-03-21T00:00:00Z", fixed_version: "openssl 3.0.13", cwes: "CWE-400", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-3187" },
          { cve_id: "CVE-2024-4209", severity: "HIGH", cvss: 7.1, title: "Improper input validation in JSON parser", date_published: "2024-04-04T00:00:00Z", fixed_version: "fastjson 2.0.40", cwes: "CWE-20, CWE-94", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-4209" },
          { cve_id: "CVE-2024-5104", severity: "MEDIUM", cvss: 6.8, title: "Information disclosure via cache poisoning", date_published: "2024-05-14T00:00:00Z", fixed_version: "varnish 7.4.2", cwes: "CWE-200", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-5104" },
          { cve_id: "CVE-2024-6022", severity: "MEDIUM", cvss: 6.5, title: "RCE via deserialization", date_published: "2024-06-02T00:00:00Z", fixed_version: "redis-py 5.0.4", cwes: "CWE-502", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-6022" },
          { cve_id: "CVE-2024-7841", severity: "MEDIUM", cvss: 5.9, title: "Path traversal in static-file middleware", date_published: "2024-07-19T00:00:00Z", fixed_version: "express-static-server 0.5.4", cwes: "CWE-22, CWE-23", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-7841" },
          { cve_id: "CVE-2024-8512", severity: "MEDIUM", cvss: 5.3, title: "Open redirect in OAuth callback handler", date_published: "2024-08-08T00:00:00Z", fixed_version: "passport-oauth2 1.8.0", cwes: "CWE-601", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-8512" },
          { cve_id: "CVE-2024-9034", severity: "MEDIUM", cvss: 4.7, title: "Timing side-channel in JWT verifier", date_published: "2024-09-23T00:00:00Z", fixed_version: "jose 5.2.0", cwes: "CWE-208, CWE-311", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-9034" },
          { cve_id: "CVE-2024-10145", severity: "LOW", cvss: 4.2, title: "CSRF token reuse window", date_published: "2024-10-31T00:00:00Z", fixed_version: "csurf 1.12.0", cwes: "CWE-352", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-10145" },
          { cve_id: "CVE-2024-11203", severity: "LOW", cvss: 3.8, title: "Stack overflow in ASN.1 parser", date_published: "2024-11-12T00:00:00Z", fixed_version: "node-forge 1.3.4", cwes: "CWE-121", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2024-11203" },
          { cve_id: "CVE-2025-00102", severity: "LOW", cvss: 3.1, title: "Race condition in session-cookie issuance", date_published: "2025-01-04T00:00:00Z", fixed_version: "express-session 1.18.1", cwes: "CWE-362", html_url: "https://nvd.nist.gov/vuln/detail/CVE-2025-00102" },
        ],
      });
      setCveState("ready");
      return;
    }
    try {
      const res = await fetch("/api/cve?limit=50");
      if (!res.ok) throw new Error(`CVE endpoint returned ${res.status}`);
      setCveData(await res.json());
      setCveState("ready");
    } catch {
      setCveState("error");
    }
  }, [demoMode]);

  const syncCves = useCallback(async () => {
    if (demoMode) { /* no-op in demo */ return; }
    setSyncing(true);
    try {
      const res = await fetch("/api/cve/sync", { method: "POST" });
      if (res.ok) await fetchCves();
    } catch {}
    setSyncing(false);
  }, [fetchCves, demoMode]);

  useEffect(() => { fetchCves(); }, [fetchCves]);

  const sevColor2 = (s: string) => s === "CRITICAL" ? C.danger : s === "HIGH" ? C.orange : s === "MEDIUM" ? C.warn : C.info;

  // CWE → Shield rule category + example rules mapping
  const cweToShield: Record<string, { category: string; rules: string[]; desc: string }> = {
    "CWE-22": { category: "sensitive-path", rules: ["PATH-SSH-KEY", "PATH-ETC-SHADOW", "PATH-ENV-FILE"], desc: "Path Traversal" },
    "CWE-23": { category: "sensitive-path", rules: ["PATH-SSH-KEY", "PATH-ETC-SHADOW"], desc: "Relative Path Traversal" },
    "CWE-36": { category: "sensitive-path", rules: ["PATH-GIT-CREDS", "PATH-ENV-FILE"], desc: "Absolute Path Traversal" },
    "CWE-78": { category: "command", rules: ["CMD-REVERSE-SHELL", "CMD-EXEC-EVAL", "CMD-BASH-EXEC"], desc: "OS Command Injection" },
    "CWE-79": { category: "steganography", rules: ["STEG-TAG-ABUSE"], desc: "Cross-site Scripting (XSS)" },
    "CWE-94": { category: "jailbreak", rules: ["JAIL-PLINY-SYSTEM-OVERRIDE", "JAIL-RECURSIVE-PROMPT"], desc: "Code Injection" },
    "CWE-200": { category: "secret", rules: ["SEC-AWS-KEY", "SEC-ANTHROPIC", "SEC-OPENAI"], desc: "Information Exposure" },
    "CWE-284": { category: "trust-exploit", rules: ["TRUST-IGNORE-PREV", "TRUST-AUTHORITY-SPOOF"], desc: "Improper Access Control" },
    "CWE-287": { category: "trust-exploit", rules: ["TRUST-AUTHORITY-SPOOF", "JAIL-PLINY-ROLE-HIJACK"], desc: "Authentication Bypass" },
    "CWE-290": { category: "jailbreak", rules: ["JAIL-PLINY-FAKE-SYSTEM-TAG", "JAIL-PLINY-GODMODE-TAG"], desc: "Authentication Bypass by Spoofing" },
    "CWE-311": { category: "secret", rules: ["SEC-PRIVATE-KEY", "SEC-JWT"], desc: "Missing Encryption" },
    "CWE-352": { category: "c2", rules: ["C2-WEBHOOK", "C2-NGROK"], desc: "Cross-Site Request Forgery" },
    "CWE-502": { category: "encoding", rules: ["ENC-BASE64-LONG", "ENC-PLINY-MULTI-LAYER"], desc: "Deserialization of Untrusted Data" },
    "CWE-918": { category: "c2", rules: ["C2-CLOUD-METADATA", "C2-DNS-TUNNEL"], desc: "Server-Side Request Forgery (SSRF)" },
    "CWE-1321": { category: "command", rules: ["CMD-EXEC-EVAL", "CMD-BASH-EXEC"], desc: "Prototype Pollution" },
  };

  function getShieldCoverage(cwes: string[]): Array<{ cwe: string; category: string; rules: string[]; desc: string }> {
    const coverage: Array<{ cwe: string; category: string; rules: string[]; desc: string }> = [];
    for (const cwe of cwes) {
      const mapping = cweToShield[cwe];
      if (mapping) coverage.push({ cwe, ...mapping });
    }
    return coverage;
  }

  return (
    <CollapsibleCard title="CVE Database" accent={C.danger} count={cveData?.total || 0} defaultOpen={true} dimGlow>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Stat label="Total CVEs" value={cveData?.total ?? 0} color={C.danger} small />
        <Stat label="Critical" value={cveData?.critical ?? 0} color={C.danger} small />
        <Stat label="High" value={cveData?.high ?? 0} color={C.orange} small />
        <Stat label="Installed" value={cveData?.installedVersion ?? "?"} color={C.brand} small />
        <Stat label="Last Sync" value={cveData?.lastSync ? timeAgo(cveData.lastSync) : "Never"} color={C.txT} small />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <Tooltip placement="top" variant="detail" content={<span>Pull the latest CVE entries from the curated AI-security feed. Each entry brings CVSS score, description, fixed-version, and CWE list — used here to map known vulnerabilities to the Shield rules that already block them.</span>}>
          <button onClick={syncCves} disabled={syncing} style={{
            padding: "6px 14px", borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: F.mono,
            background: `${C.danger}18`, border: `1px solid ${C.danger}44`, color: C.danger,
            cursor: syncing ? "wait" : "pointer",
          }}>{syncing ? "Syncing..." : "Sync from GitHub"}</button>
        </Tooltip>
        <span style={{ fontSize: 10, color: C.txT, alignSelf: "center" }}>Source: jgamblin/OpenClawCVEs (updated hourly)</span>
      </div>

      {cveState === "loading" ? (
        <LoadingSpinner />
      ) : cveState === "error" ? (
        <span style={{ fontSize: 12, color: C.danger }}>CVE data is unavailable. Retry the panel refresh before relying on these counts.</span>
      ) : (!cveData || cveData.cves.length === 0) ? (
        <span style={{ fontSize: 12, color: C.txT }}>No CVEs synced yet. Click &quot;Sync from GitHub&quot; to fetch the latest data.</span>
      ) : (
        cveData.cves.slice(cvePage * cvePageSize, (cvePage + 1) * cvePageSize).map(cve => {
          const isOpen = expandedCves.has(cve.cve_id);
          const sc = sevColor2(cve.severity);
          let cwes: string[] = [];
          try { cwes = cve.cwes ? JSON.parse(cve.cwes) : []; } catch {}

          return (
            <div key={cve.cve_id} style={{
              marginBottom: 6, background: C.bg, border: `1px solid ${sc}22`,
              borderLeft: `4px solid ${sc}`, borderRadius: 6, overflow: "hidden",
            }}>
              <div onClick={() => setExpandedCves(prev => { const n = new Set(prev); n.has(cve.cve_id) ? n.delete(cve.cve_id) : n.add(cve.cve_id); return n; })} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
              }}>
                <span style={{ fontSize: 10, color: C.txT, transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>{"\u25B6"}</span>
                <Badge label={cve.severity || "N/A"} color={sc} />
                <span style={{ fontSize: 12, fontWeight: 700, color: C.danger, fontFamily: F.mono }}>{cve.cve_id}</span>
                <span style={{ fontSize: 11, color: C.tx, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{cve.title}</span>
                {cve.cvss && <span style={{ fontSize: 10, fontWeight: 700, color: sc, fontFamily: F.mono }}>CVSS {cve.cvss}</span>}
                <span style={{ fontSize: 10, color: C.txT }}>{cve.date_published}</span>
              </div>

              {isOpen && (
                <div style={{ padding: "0 12px 10px 30px" }}>
                  <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5, marginBottom: 8 }}>{cve.title}</div>
                  {cve.fixed_version && <div style={{ fontSize: 11, color: C.txT }}>Fixed in: <span style={{ color: C.green, fontWeight: 600 }}>{cve.fixed_version}</span></div>}
                  {cwes.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {cwes.map(c => <span key={c} style={{ fontSize: 9, padding: "1px 5px", background: `${C.purp}14`, border: `1px solid ${C.purp}28`, borderRadius: 3, color: C.purp, fontFamily: F.mono }}>{c}</span>)}
                    </div>
                  )}
                  {/* Shield Coverage — which rules protect against this CVE class */}
                  {(() => {
                    const coverage = getShieldCoverage(cwes);
                    if (coverage.length === 0) return null;
                    const totalRules = coverage.reduce((s, c) => s + c.rules.length, 0);
                    return (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: `${C.green}08`, border: `1px solid ${C.green}22`, borderRadius: 6 }}>
                        <div style={{ fontSize: 9, color: C.green, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Shield Coverage ({totalRules} rules)</div>
                        {coverage.map(c => (
                          <div key={c.cwe} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                            <span style={{ fontSize: 9, padding: "1px 4px", background: `${C.purp}14`, border: `1px solid ${C.purp}28`, borderRadius: 2, color: C.purp, fontFamily: F.mono }}>{c.cwe}</span>
                            <span style={{ fontSize: 10, color: C.txT }}>{c.desc}:</span>
                            <span style={{ fontSize: 10, color: C.green, fontFamily: F.mono }}>{c.rules.join(", ")}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                    {cve.html_url && (
                      <a href={cve.html_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: C.info, textDecoration: "none", fontWeight: 600 }}>View Advisory {"\u2192"}</a>
                    )}
                    {cwes.length > 0 && onNavigate && (
                      <button onClick={() => onNavigate("configuration", "policiesAndRules")} style={{ background: "none", border: "none", color: C.info, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: F.sans }}>View Rules {"\u2192"}</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
      {cveData && cveData.cves.length > 0 && (() => {
        const totalPages = Math.max(1, Math.ceil(cveData.cves.length / cvePageSize));
        if (totalPages <= 1) return null;
        return (
          <PaginationFooter
            currentPage={Math.min(cvePage, totalPages - 1)}
            totalPages={totalPages}
            pageSize={cvePageSize}
            totalRows={cveData.cves.length}
            onPageSizeChange={setCvePageSize}
            onPageChange={setCvePage}
          />
        );
      })()}
    </CollapsibleCard>
  );
}
