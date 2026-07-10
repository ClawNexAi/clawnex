"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from "../constants";
import { CollapsibleCard } from "../shared";
import type { DashboardFilters } from "../types";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function ExecutiveReportsPanel({ filters, demoMode }: { filters: DashboardFilters; demoMode: boolean }) {
  interface ReportDef {
    id: string;
    key: string;
    title: string;
    subtitle: string;
    category: string;
    frequency: string;
    formats: Array<"pdf" | "md" | "xlsx">;
  }

  const REPORT_DEFS: ReportDef[] = [
    { id: "RPT-001", key: "fleet_posture", title: "Fleet Security Posture", subtitle: "Executive", category: "Executive", frequency: "Weekly", formats: ["pdf", "md"] },
    { id: "RPT-002", key: "shield_analysis", title: "Prompt Shield Analysis", subtitle: "Security", category: "Security", frequency: "Daily", formats: ["pdf", "md"] },
    { id: "RPT-003", key: "traffic_summary", title: "Traffic & Threat Summary", subtitle: "Security", category: "Security", frequency: "Daily", formats: ["pdf", "md"] },
    { id: "RPT-004", key: "incident_report", title: "Incident Report", subtitle: "Incident", category: "Incident", frequency: "Ad-hoc", formats: ["pdf", "md"] },
    { id: "RPT-005", key: "break_glass_audit", title: "Break-Glass Audit Trail", subtitle: "Compliance", category: "Compliance", frequency: "Ad-hoc", formats: ["pdf", "md"] },
    { id: "RPT-006", key: "retention_compliance", title: "Data Retention Compliance", subtitle: "Compliance", category: "Compliance", frequency: "Monthly", formats: ["pdf", "md"] },
    { id: "RPT-007", key: "agent_activity", title: "Agent Activity Summary", subtitle: "Operational", category: "Operational", frequency: "Daily", formats: ["pdf", "md"] },
    { id: "RPT-008", key: "skills_inventory", title: "Skills & Plugins Inventory", subtitle: "Governance", category: "Governance", frequency: "Weekly", formats: ["pdf", "md"] },
    { id: "RPT-009", key: "cost_analysis", title: "Cost & Token Analysis", subtitle: "Financial", category: "Financial", frequency: "Monthly", formats: ["pdf", "md", "xlsx"] },
    { id: "RPT-010", key: "whitelist_review", title: "Shield Whitelist Review", subtitle: "Security", category: "Security", frequency: "Monthly", formats: ["pdf", "md"] },
    { id: "RPT-011", key: "consolidated_summary", title: "Consolidated Executive Summary", subtitle: "Executive", category: "Executive", frequency: "Weekly", formats: ["pdf", "md"] },
    { id: "RPT-012", key: "consolidated_csv", title: "Traffic Data Export (CSV)", subtitle: "Data", category: "Data", frequency: "Ad-hoc", formats: ["xlsx"] },
    { id: "RPT-013", key: "soc2", title: "SOC 2 Type II Evidence Report", subtitle: "Compliance", category: "Compliance", frequency: "Monthly", formats: ["pdf", "md"] },
    { id: "RPT-014", key: "iso27001", title: "ISO 27001 Compliance Report", subtitle: "Compliance", category: "Compliance", frequency: "Monthly", formats: ["pdf", "md"] },
  ];

  const [selectedFormats, setSelectedFormats] = useState<Record<string, "pdf" | "md" | "xlsx">>(() => {
    const init: Record<string, "pdf" | "md" | "xlsx"> = {};
    for (const r of REPORT_DEFS) init[r.key] = "md";
    return init;
  });
  const [generating, setGenerating] = useState<string | null>(null);
  const [genTimes, setGenTimes] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  interface ComplianceSection {
    control: string;
    name: string;
    status: "PASS" | "PARTIAL" | "FAIL";
    evidence_count: number;
    summary: string;
    details: string[];
  }
  interface ComplianceReportData {
    type: string;
    title: string;
    generated: string;
    period: { from: string; to: string };
    sections: ComplianceSection[];
    overall_status: string;
    score: number;
    content?: string;
  }
  const [complianceReport, setComplianceReport] = useState<ComplianceReportData | null>(null);
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());

  // Fetch last-generated times from config
  const fetchGenTimes = useCallback(async () => {
    try {
      const res = await fetch("/api/config/defaults");
      if (res.ok) {
        const data = await res.json();
        const settings = data.settings || {};
        const times: Record<string, string> = {};
        for (const r of REPORT_DEFS) {
          const key = `report_generated_${r.key}`;
          if (settings[key]) times[r.key] = settings[key];
        }
        setGenTimes(times);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchGenTimes(); }, [fetchGenTimes]);

  // Format "Generated Xh ago" or "Never generated"
  function formatGenTime(key: string): string {
    const ts = genTimes[key];
    if (!ts) return "Never generated";
    try {
      const diff = Date.now() - new Date(ts).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "Generated just now";
      if (mins < 60) return `Generated ${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `Generated ${hrs}h ago`;
      return `Generated ${Math.floor(hrs / 24)}d ago`;
    } catch { return "Never generated"; }
  }

  async function handleExport(reportDef: ReportDef) {
    const format = selectedFormats[reportDef.key] || "md";
    setGenerating(reportDef.key);
    setToast(null);

    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: reportDef.key,
          format,
          timeRange: filters.timeRange,
          instance: filters.selectedInstance !== "all" ? filters.selectedInstance : undefined,
        }),
      });

      if (!res.ok) {
        setToast("Failed to generate report");
        setGenerating(null);
        return;
      }

      const data = await res.json();

      if (data.fallback) {
        setToast(data.fallback);
      }

      // For compliance reports, show inline viewer AND download
      const isCompliance = reportDef.key === "soc2" || reportDef.key === "iso27001";
      if (isCompliance && data.sections) {
        setComplianceReport({
          type: data.type,
          title: data.title,
          generated: data.generated,
          period: data.period,
          sections: data.sections,
          overall_status: data.overall_status,
          score: data.score,
          content: data.content,
        });
        setExpandedControls(new Set());
      }

      // Download the file
      const mimeType = data.format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8";
      const blob = new Blob([data.content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename || `${reportDef.key}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Update gen times
      setGenTimes(prev => ({ ...prev, [reportDef.key]: data.generatedAt }));
    } catch {
      setToast("Error generating report");
    }
    setGenerating(null);
  }

  const formatBadgeColors: Record<string, string> = {
    pdf: C.cyan,
    md: C.purp,
    xlsx: C.green,
  };

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab.
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Toast notification */}
      {toast && (
        <div style={{
          padding: "10px 16px", marginBottom: 12, background: `${C.orange}18`, border: `1px solid ${C.orange}44`,
          borderRadius: 6, color: C.orange, fontSize: 13, fontFamily: F.sans, display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{toast}</span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: C.orange, cursor: "pointer", fontSize: 16, fontWeight: 700, padding: "0 4px" }}>x</button>
        </div>
      )}

      {/* Compliance Report Viewer */}
      {complianceReport && (
        <div style={{
          marginBottom: 16, padding: 16, background: `${C.bg}cc`, border: `1px solid ${C.purp}44`,
          borderRadius: 8, fontFamily: F.sans,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.tx }}>{complianceReport.title}</div>
              <div style={{ fontSize: 11, color: C.txT, fontFamily: F.mono, marginTop: 2 }}>
                Generated: {new Date(complianceReport.generated).toLocaleString()} &middot; Period: {new Date(complianceReport.period.from).toLocaleDateString()} - {new Date(complianceReport.period.to).toLocaleDateString()}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={() => {
                const r = complianceReport;
                const statusColor = r.overall_status === "COMPLIANT" ? "#16a34a" : r.overall_status === "PARTIAL" ? "#d97706" : "#dc2626";
                const esc = escapeHtml;
                const html = `<!DOCTYPE html><html><head><title>${esc(r.title)}</title><style>
                  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #1a1a1a; line-height: 1.6; }
                  h1 { font-size: 22px; border-bottom: 2px solid #00c889; padding-bottom: 8px; }
                  h2 { font-size: 16px; margin-top: 24px; color: #333; }
                  .meta { font-size: 12px; color: #666; margin-bottom: 20px; }
                  .status-bar { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: #f5f5f5; border-radius: 8px; margin-bottom: 20px; }
                  .status { font-size: 14px; font-weight: 700; padding: 4px 12px; border-radius: 4px; color: white; }
                  .section { margin-bottom: 16px; padding: 12px 16px; border: 1px solid #e0e0e0; border-radius: 6px; }
                  .section-header { display: flex; justify-content: space-between; align-items: center; }
                  .badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 3px; color: white; }
                  .pass { background: #16a34a; } .partial { background: #d97706; } .fail { background: #dc2626; }
                  .evidence { font-size: 12px; color: #666; } .summary { font-size: 13px; margin-top: 8px; }
                  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #999; text-align: center; }
                  @media print { body { margin: 20px; } }
                </style></head><body>
                <h1>${esc(r.title)}</h1>
                <div class="meta">Generated: ${esc(new Date(r.generated).toLocaleString())} &bull; Period: ${esc(new Date(r.period.from).toLocaleDateString())} - ${esc(new Date(r.period.to).toLocaleDateString())}</div>
                <div class="status-bar"><span class="status" style="background:${statusColor}">${esc(r.overall_status)}</span><span>Score: ${r.score}%</span><span>${r.sections.filter(s => s.status === "PASS").length}/${r.sections.length} controls passed</span></div>
                ${r.sections.map(s => `<div class="section"><div class="section-header"><div><strong>${esc(s.control)}</strong> — ${esc(s.name)}</div><span class="badge ${esc(s.status.toLowerCase())}">${esc(s.status)}</span></div><div class="evidence">${s.evidence_count} evidence items</div><div class="summary">${esc(s.summary)}</div></div>`).join("")}
                <div class="footer">ClawNex &mdash; ProBizSystems &bull; ${new Date().toISOString()}</div>
                </body></html>`;
                const w = window.open("", "_blank");
                if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300); }
              }} style={{
                padding: "3px 10px", background: `${C.purp}18`, border: `1px solid ${C.purp}44`, borderRadius: 4, color: C.purp, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: F.mono,
              }} title="Open the report in a new window styled for print, then trigger the browser print dialog so you can save as PDF or send to printer.">Export PDF</button>
              <button onClick={() => setComplianceReport(null)} style={{
                background: "none", border: "none", color: C.txS, cursor: "pointer", fontSize: 18, fontWeight: 700, padding: "0 4px",
              }}>x</button>
            </div>
          </div>

          {/* Overall Status Bar */}
          <div style={{
            display: "flex", gap: 16, alignItems: "center", padding: "10px 14px", marginBottom: 14,
            background: complianceReport.overall_status === "COMPLIANT" ? `${C.green}14` : complianceReport.overall_status === "PARTIAL" ? `${C.orange}14` : `${C.danger}14`,
            border: `1px solid ${complianceReport.overall_status === "COMPLIANT" ? C.green : complianceReport.overall_status === "PARTIAL" ? C.orange : C.danger}33`,
            borderRadius: 6,
          }}>
            <span style={{
              fontSize: 12, fontWeight: 700, fontFamily: F.mono, textTransform: "uppercase", letterSpacing: "0.05em",
              color: complianceReport.overall_status === "COMPLIANT" ? C.green : complianceReport.overall_status === "PARTIAL" ? C.orange : C.danger,
            }}>{complianceReport.overall_status}</span>
            <span style={{ fontSize: 12, color: C.txS }}>Score: <strong style={{ color: C.tx }}>{complianceReport.score}%</strong></span>
            <span style={{ fontSize: 12, color: C.txS }}>
              {complianceReport.sections.filter(s => s.status === "PASS").length}/{complianceReport.sections.length} controls passing
            </span>
          </div>

          {/* Sections */}
          {complianceReport.sections.map(section => {
            const statusColor = section.status === "PASS" ? C.green : section.status === "PARTIAL" ? C.orange : C.danger;
            const isExpanded = expandedControls.has(section.control);
            return (
              <div key={section.control} style={{
                marginBottom: 6, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, overflow: "hidden",
              }}>
                <button onClick={() => {
                  setExpandedControls(prev => {
                    const next = new Set(prev);
                    if (next.has(section.control)) next.delete(section.control);
                    else next.add(section.control);
                    return next;
                  });
                }} style={{
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px", background: C.glassSurfTrans, border: "none", cursor: "pointer",
                  textAlign: "left",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 3, fontSize: 10,
                      fontWeight: 700, fontFamily: F.mono, textTransform: "uppercase",
                      background: `${statusColor}22`, color: statusColor, border: `1px solid ${statusColor}44`,
                    }}>{section.status}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.tx, fontFamily: F.mono }}>{section.control}</span>
                    <span style={{ fontSize: 12, color: C.txS }}>{section.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>{section.evidence_count} evidence</span>
                    <span style={{ fontSize: 12, color: C.txT }}>{isExpanded ? "\u25B2" : "\u25BC"}</span>
                  </div>
                </button>
                {isExpanded && (
                  <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.glassBorderSubtle}` }}>
                    <div style={{ fontSize: 12, color: C.txS, marginBottom: 8, lineHeight: 1.5 }}>{section.summary}</div>
                    <div style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>
                      {section.details.map((d, i) => (
                        <div key={i} style={{ padding: "2px 0" }}>- {d}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Grouped by category */}
      {(() => {
        const categories: Record<string, ReportDef[]> = {};
        for (const r of REPORT_DEFS) {
          if (!categories[r.category]) categories[r.category] = [];
          categories[r.category].push(r);
        }
        const catAccents: Record<string, string> = { Executive: C.brand, Security: C.danger, Compliance: C.purp, Incident: C.orange, Operational: C.cyan, Governance: C.info, Financial: C.warn, Data: C.green };

        return Object.entries(categories).map(([cat, reports]) => (
          <CollapsibleCard key={cat} title={cat} accent={catAccents[cat] || C.txS} count={reports.length} defaultOpen={false}>
            {reports.map(r => (
              <div key={r.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 0", borderBottom: `1px solid ${C.glassBorderSubtle}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.tx }}>{r.title}</div>
                  <div style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, marginTop: 1 }}>
                    {r.frequency} &middot; {formatGenTime(r.key)}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  {r.formats.map(fmt => {
                    const isSelected = selectedFormats[r.key] === fmt;
                    const badgeColor = formatBadgeColors[fmt] || C.txS;
                    return (
                      <button key={fmt} onClick={() => setSelectedFormats(prev => ({ ...prev, [r.key]: fmt }))} style={{
                        padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700, fontFamily: F.mono,
                        textTransform: "uppercase", cursor: "pointer",
                        border: `1px solid ${badgeColor}${isSelected ? "" : "44"}`,
                        background: isSelected ? `${badgeColor}28` : "transparent",
                        color: badgeColor,
                      }}>{fmt}</button>
                    );
                  })}
                  <button onClick={() => handleExport(r)} disabled={generating === r.key} style={{
                    padding: "3px 10px", background: generating === r.key ? `${C.brand}44` : C.brand,
                    color: C.bg, border: "none", borderRadius: 4, fontSize: 10, fontWeight: 700,
                    fontFamily: F.sans, cursor: generating === r.key ? "wait" : "pointer",
                    textTransform: "uppercase", letterSpacing: "0.04em", marginLeft: 2,
                  }}>{generating === r.key ? "..." : "Export"}</button>
                </div>
              </div>
            ))}
          </CollapsibleCard>
        ));
      })()}
    </div>
  );
}
