"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { C, F, PANEL_HELP, NAV, GLOSSARY } from "../constants";
import type { GlossaryEntry } from "../constants";
import { Card, CollapsibleCard, Badge } from "../shared";
import { DocReader } from "../DocReader";
import type { TabId } from "../types";

// ---------------------------------------------------------------------------
// Panel reference data — one card per sidebar group
// ---------------------------------------------------------------------------

const PANEL_GUIDE: Array<{
  group: string;
  panels: Array<{ id: TabId; label: string; oneLiner: string; doc?: string }>;
}> = [
  {
    group: "COMMAND",
    panels: [
      { id: "fleet", label: "Fleet Command", oneLiner: "Live fleet overview — instances, threats, alerts, agents, sessions, cost. Home of the Welcome Wizard on fresh installs.", doc: "06-basic-user-manual.md" },
      { id: "instance", label: "Instance Detail", oneLiner: "Deep-dive into a single instance — services health, unified timeline of alerts + audit events, LiteLLM badge routing.", doc: "06-basic-user-manual.md" },
      { id: "correlations", label: "Correlations", oneLiner: "Multi-signal threat intelligence — attack chain detection, token burn anomalies, service cascades, auth storms.", doc: "07-advanced-user-manual.md" },
      { id: "blastRadius", label: "Blast Radius", oneLiner: "Tools/skills/sources/comm-surfaces × agents matrix. Permissiveness lib feeds dangerous-combo and posture-lint findings into Trust Audit.", doc: "07-advanced-user-manual.md" },
    ],
  },
  {
    group: "SECURITY",
    panels: [
      { id: "securityPosture", label: "Security Posture", oneLiner: "ClawNex Host Security hardening grade (A–F). Prerequisites, host hardening, network, and audit checks with remediation guidance.", doc: "07-advanced-user-manual.md" },
      { id: "trustAudit", label: "Trust Audit", oneLiner: "Trust Boundary and Blast Radius Audit — 15 rules across 5 evidence levels. Confidence pills, expandable evidence, sandboxed flag. v0.7.1+ consumes permissiveness lib for comm-surface dangerous-combo + posture-lint findings.", doc: "07-advanced-user-manual.md" },
      { id: "shield", label: "Prompt Shield", oneLiner: "163-detection inbound content scanner (plus enabled system + custom policy rules from the framework matching scan direction; live wire runs both directions). Manual inbound scanner, recent events (collapsible), verdict/score/detections stats, rule whitelist.", doc: "07-advanced-user-manual.md" },
      { id: "shieldTests", label: "Shield Tests", oneLiner: "27 test payloads — jailbreaks, steganography, encoding, C2, financial, Pliny techniques. Run All or individual.", doc: "07-advanced-user-manual.md" },
      { id: "trafficMonitor", label: "Traffic Monitor", oneLiner: "Real-time LLM traffic table (collapsible) with filters by source, model, provider, verdict, score. Top Threats enrichment.", doc: "10-api-reference.md" },
    ],
  },
  {
    group: "DEFENSE",
    panels: [
      { id: "accessControl", label: "Access Control", oneLiner: "Domain and IP deny lists enforced by the shield scanner. Break-glass emergency override with full audit trail.", doc: "07-advanced-user-manual.md" },
    ],
  },
  {
    group: "ACTIVITY",
    panels: [
      { id: "agents", label: "Agents & Sessions", oneLiner: "Agent registry from OpenClaw or local filesystem. Cards with model, status, tools, workspace link. Collapsible.", doc: "07-advanced-user-manual.md" },
      { id: "workspace", label: "Agent Workspace", oneLiner: "Browse agent files — SOUL.md, workflows, configs. Select an agent, click a file to inspect contents.", doc: "07-advanced-user-manual.md" },
      { id: "tokenCost", label: "Token & Cost Intel", oneLiner: "Token usage by model, total cost (LiteLLM-pinned rates), per-agent cost breakdown (collapsible), session log analysis.", doc: "07-advanced-user-manual.md" },
    ],
  },
  {
    group: "GOVERNANCE",
    panels: [
      { id: "toolsAccess", label: "Tools & Access", oneLiner: "Inventory of agent tools and skills — system, workspace, plugins. Risk levels and denied-tool lists per agent.", doc: "07-advanced-user-manual.md" },
      { id: "riskAcceptance", label: "Risk Acceptances", oneLiner: "Operator-explicit, time-bound, audit-trailed suppression of findings across Trust Audit, Blast Radius, Correlations, and Alerts. v0.8.0+ — 90d default expiry (30d for Correlations).", doc: "07-advanced-user-manual.md" },
    ],
  },
  {
    group: "PERFORMANCE",
    panels: [
      { id: "modelsCost", label: "Models & Cost", oneLiner: "Model inventory across all providers with status, cost rates, and connectivity test buttons.", doc: "07-advanced-user-manual.md" },
    ],
  },
  {
    group: "OPERATIONS",
    panels: [
      { id: "infrastructure", label: "Infrastructure", oneLiner: "Service health (ONLINE/DEGRADED/OFFLINE/NOT_CONFIGURED), CPU/memory/storage, host info, service logs viewer.", doc: "06-basic-user-manual.md" },
      { id: "alertsIncidents", label: "Alerts & Incidents", oneLiner: "Card-based incident board. Severity borders, age timers, ACK/Resolve workflow, backlinks to source panels.", doc: "06-basic-user-manual.md" },
    ],
  },
  {
    group: "COMPLIANCE",
    panels: [
      { id: "auditEvidence", label: "Audit & Evidence", oneLiner: "Immutable audit trail — every config change, break-glass action, whitelist edit, shield block. Searchable + filterable.", doc: "14-data-dictionary.md" },
      { id: "executiveReports", label: "Executive Reports", oneLiner: "12 report types — executive summary, traffic analysis, shield breakdown, break-glass audit, CSV export.", doc: "07-advanced-user-manual.md" },
      { id: "accessLists", label: "Access Lists", oneLiner: "Manage domain and IP deny lists evaluated by the shield scanner.", doc: "07-advanced-user-manual.md" },
      { id: "governance", label: "Governance", oneLiner: "Read governance docs inline — 14 policies, risk + vendor registers, one-pager, policy evidence checklist. Enterprise/audit-facing.", doc: "governance-index.md" },
    ],
  },
  {
    group: "SYSTEM",
    panels: [
      { id: "configuration", label: "Configuration", oneLiner: "Everything-hub — 24 cards in 6 collapsible categories (AI & Models, Fleet & Routing, Shield & Detection, Access Control, Integrations, System). v0.9 adds Operator Management, Authentication Methods (GitHub OAuth + Magic Link admin toggles), Auth & Devices (per-operator passkey + GitHub + Magic Link status), Mail Configuration (Resend / SMTP / Emailit), API Keys with scoped permissions. Local password remains the break-glass identifier.", doc: "07-advanced-user-manual.md" },
      { id: "help", label: "Help", oneLiner: "This panel. Onboarding tour, keyboard shortcuts, panel reference, tooltip system explainer, and inline documentation viewer.", doc: "06-basic-user-manual.md" },
      { id: "about", label: "Credits & Info", oneLiner: "Build version + channel, credits, attribution, and the About-tab dedications curated by the operator. Read-only.", doc: "06-basic-user-manual.md" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Keyboard shortcuts data
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  { keys: "Tab / Shift+Tab", action: "Move focus between tooltiped elements" },
  { keys: "Escape", action: "Dismiss the currently visible tooltip" },
  { keys: "Enter", action: "Submit inline form inputs (search, add model, send chat message)" },
  { keys: "Cmd+R / Ctrl+R", action: "Reload the dashboard" },
  { keys: "Cmd+Shift+R", action: "Hard reload (bypass cache — fixes most weird states)" },
  { keys: "Cmd+F / Ctrl+F", action: "Browser find in current panel" },
  { keys: "F12 / Cmd+Opt+I", action: "Open browser dev tools" },
];

// ---------------------------------------------------------------------------
// Expandable Panel Row
// ---------------------------------------------------------------------------

function PanelRow({ panel, onNavigate, onOpenDoc }: {
  panel: { id: TabId; label: string; oneLiner: string; doc?: string };
  onNavigate: (tab: TabId) => void;
  onOpenDoc: (file: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const help = PANEL_HELP[panel.id];

  return (
    <div style={{
      background: C.glassSurfTrans, border: `1px solid ${expanded ? `${C.brand}44` : C.glassSurfBorder}`,
      borderRadius: 6, marginBottom: 4, transition: "border-color 0.15s ease",
    }}>
      {/* Collapsed header — always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", gap: 10, padding: "8px 12px", cursor: "pointer",
          alignItems: "center",
        }}
        onMouseEnter={e => { if (!expanded) (e.currentTarget.parentElement as HTMLDivElement).style.borderColor = `${C.brand}33`; }}
        onMouseLeave={e => { if (!expanded) (e.currentTarget.parentElement as HTMLDivElement).style.borderColor = C.glassSurfBorder; }}
      >
        <span style={{ color: C.txT, fontSize: 10, fontFamily: F.mono, flexShrink: 0, width: 14, textAlign: "center", transition: "transform 0.2s" }}>
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
        <span
          onClick={e => { e.stopPropagation(); onNavigate(panel.id); }}
          style={{ fontWeight: 600, fontSize: 13, color: C.brand, minWidth: 150, flexShrink: 0, cursor: "pointer" }}
          title={`Go to ${panel.label}`}
        >
          {panel.label}
        </span>
        <span style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>{panel.oneLiner}</span>
      </div>

      {/* Expanded detail */}
      {expanded && help && (
        <div style={{ padding: "0 12px 12px 36px", borderTop: `1px solid ${C.glassBorderSubtle}` }}>
          {/* Description */}
          <p style={{ fontSize: 12, color: C.txS, lineHeight: 1.7, margin: "10px 0 12px" }}>
            {help.desc}
          </p>

          {/* Key Metrics */}
          {help.metrics.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, fontFamily: F.mono, letterSpacing: "0.05em", marginBottom: 6 }}>KEY METRICS</div>
              {help.metrics.map((m, i) => {
                const [label, ...rest] = m.split(" — ");
                return (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 12 }}>
                    <span style={{ color: C.tx, fontWeight: 600, minWidth: 120, flexShrink: 0 }}>{label}</span>
                    <span style={{ color: C.txT }}>{rest.join(" — ")}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Available Actions */}
          {help.actions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.green, fontFamily: F.mono, letterSpacing: "0.05em", marginBottom: 6 }}>AVAILABLE ACTIONS</div>
              {help.actions.map((a, i) => (
                <div key={i} style={{ fontSize: 12, color: C.txS, lineHeight: 1.6, paddingLeft: 10, marginBottom: 2 }}>
                  <span style={{ color: C.green, marginRight: 6 }}>{"\u2022"}</span>{a}
                </div>
              ))}
            </div>
          )}

          {/* Related Panels */}
          {help.related.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.purp, fontFamily: F.mono, letterSpacing: "0.05em", marginBottom: 6 }}>RELATED PANELS</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {help.related.map(r => (
                  <span
                    key={r}
                    onClick={() => onNavigate(r)}
                    style={{
                      padding: "2px 8px", background: `${C.purp}14`, border: `1px solid ${C.purp}28`,
                      borderRadius: 4, fontSize: 11, color: C.purp, fontFamily: F.mono, cursor: "pointer",
                    }}
                  >
                    {PANEL_HELP[r]?.title || r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Doc Reference */}
          {panel.doc && (
            <div style={{ borderTop: `1px solid ${C.glassBorderSubtle}`, paddingTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: C.txT }}>See also:</span>
              <span
                onClick={() => onOpenDoc(panel.doc!)}
                style={{
                  fontFamily: F.mono, fontSize: 11, color: C.cyan, cursor: "pointer",
                  textDecoration: "underline dotted", textDecorationColor: `${C.cyan}55`,
                  textUnderlineOffset: "3px",
                }}
                title={`Open ${panel.doc} in the doc reader`}
              >
                docs/{panel.doc}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HelpPanel
// ---------------------------------------------------------------------------

export function HelpPanel({ onNavigate }: { onNavigate: (tab: TabId) => void }) {
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const docReaderRef = useRef<HTMLDivElement | null>(null);

  const handleOpenDoc = useCallback((file: string) => {
    setOpenDoc(file);
    // Scroll to the doc reader after React renders it
    setTimeout(() => {
      docReaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, []);

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab.
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Doc Reader — renders above everything when a doc is selected */}
      <div ref={docReaderRef} />
      {openDoc && <DocReader file={openDoc} onClose={() => setOpenDoc(null)} />}

      {/* Intro */}
      <Card title="Welcome to ClawNex Help" accent={C.brand}>
        <p style={{ fontSize: 13, color: C.txS, lineHeight: 1.7, margin: 0 }}>
          ClawNex is an AI Agent Fleet Security Operations Center — a single pane of glass for monitoring, scanning, and securing your AI agent fleet.
          Click any panel name below to navigate directly, or expand a row for the full description, key metrics, available actions, and a link to the relevant doc.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {/* Counts derived from NAV / PANEL_GUIDE so they can't drift from
              the dashboard's actual panel set. internal reviewer dogfood QA 2026-04-28
              caught the prior hardcoded "26 PANELS" / "Panel Reference (23)"
              mismatch — fix is to compute, not type. */}
          <Badge label={`${NAV.length} PANELS`} color={C.brand} />
          <Badge label="163 SHIELD DETECTIONS" color={C.danger} />
          <Badge label={`${NAV.length}+ TOOLTIPS`} color={C.cyan} />
          <Badge label="31 DOCS" color={C.info} />
        </div>
      </Card>

      {/* Tooltip System Explainer */}
      <CollapsibleCard title="The Tooltip System" accent={C.cyan} defaultOpen={false} count={NAV.length}>
        <div style={{ fontSize: 13, color: C.txS, lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 10px" }}>
            Most stats, badges, column headers, and controls carry a <strong style={{ color: C.tx }}>hover tooltip</strong> with contextual help.
            Two visual hints tell you which elements have tooltips:
          </p>
          <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
            <div style={{ flex: 1, padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.cyan, marginBottom: 4, fontFamily: F.mono }}>INLINE TEXT</div>
              <div style={{ fontSize: 12, color: C.txS }}>
                A <span style={{ textDecoration: "underline dotted", textDecorationColor: `${C.brand}88`, textUnderlineOffset: "3px", textDecorationThickness: "1.5px" }}>dotted cyan underline</span> at rest.
                Brightens to full opacity on hover. <span style={{ fontFamily: F.mono, fontSize: 11, color: C.txT }}>cursor: help</span>.
              </div>
            </div>
            <div style={{ flex: 1, padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.cyan, marginBottom: 4, fontFamily: F.mono }}>STAT TILES & CARDS</div>
              <div style={{ fontSize: 12, color: C.txS }}>
                A tiny <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: C.brand, verticalAlign: "middle", marginRight: 2 }} /> cyan dot (a &ldquo;pip&rdquo;) in the top-right corner.
                Brightens with a soft glow on hover.
              </div>
            </div>
          </div>
          <p style={{ margin: "0 0 8px" }}>
            The <strong style={{ color: C.tx }}>TIPS</strong> button in the header (next to the <strong>?</strong> help button) toggles the entire system on or off.
            Setting persists via <span style={{ fontFamily: F.mono, fontSize: 11, color: C.cyan }}>config_defaults.tooltips_enabled</span>.
          </p>
          <p style={{ margin: 0, fontSize: 12, color: C.txT }}>
            Keyboard: <span style={{ fontFamily: F.mono }}>Tab</span> to focus a tooltiped element, <span style={{ fontFamily: F.mono }}>Escape</span> to dismiss.
            Screen readers receive content via <span style={{ fontFamily: F.mono }}>aria-describedby</span>.
          </p>
        </div>
      </CollapsibleCard>

      {/* Panel Reference — expandable rows per group */}
      <CollapsibleCard title="Panel Reference" accent={C.brand} count={PANEL_GUIDE.reduce((s, g) => s + g.panels.length, 0)} defaultOpen={false}>
        <p style={{ fontSize: 12, color: C.txT, marginBottom: 12, margin: "0 0 12px" }}>
          Click the arrow to expand for key metrics, available actions, related panels, and a link to the relevant doc.
          Click the panel name to navigate directly.
        </p>
        {PANEL_GUIDE.map(group => (
          <div key={group.group} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, fontFamily: F.mono, color: C.txT, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
              {group.group}
            </div>
            {group.panels.map(p => (
              <PanelRow key={p.id} panel={p} onNavigate={onNavigate} onOpenDoc={handleOpenDoc} />
            ))}
          </div>
        ))}
      </CollapsibleCard>

      {/* Keyboard Shortcuts */}
      <CollapsibleCard title="Keyboard Shortcuts" accent={C.info} defaultOpen={false} count={SHORTCUTS.length}>
        <div style={{ fontSize: 12, fontFamily: F.mono }}>
          {SHORTCUTS.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
              <span style={{ color: C.cyan, fontWeight: 700, minWidth: 160, flexShrink: 0 }}>{s.keys}</span>
              <span style={{ color: C.txS }}>{s.action}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: C.txT, marginTop: 10, margin: "10px 0 0" }}>
          A full command palette (<span style={{ fontFamily: F.mono }}>Cmd+K</span>) and panel navigation hotkeys are on the future roadmap.
        </p>
      </CollapsibleCard>

      {/* Troubleshooting Quick Reference */}
      <CollapsibleCard title="Troubleshooting Quick Reference" accent={C.warn} defaultOpen={false}>
        <div style={{ fontSize: 13, color: C.txS, lineHeight: 1.7 }}>
          {[
            { issue: "White screen / \"missing required error components\"", fix: "Kill dev server, rm -rf .next, rebuild, restart.", doc: "17-troubleshooting-guide.md" },
            { issue: "LiteLLM shows OFFLINE", fix: "Click Restart on the Infrastructure panel's LiteLLM row. Check litellm/config.yaml for bad provider URLs.", doc: "17-troubleshooting-guide.md" },
            { issue: "Tooltips not appearing", fix: "Check the TIPS toggle in the header (next to ?). If ON and still missing, hard reload (Cmd+Shift+R).", doc: "17-troubleshooting-guide.md" },
            { issue: "Model Pricing shows STALE", fix: "Go to Configuration \u2192 Updates \u2192 Model Pricing \u2192 Update Now.", doc: "17-troubleshooting-guide.md" },
            { issue: "OpenClaw shows OFFLINE", fix: "Verify OpenClaw gateway is running, token matches config, port 18789 is reachable. If routing is wired but the gateway hasn't picked it up, click Restart Gateway in Configuration → OpenClaw Routing.", doc: "17-troubleshooting-guide.md" },
            { issue: "OpenClaw Routing wire conflict (OPERATOR-OWNED badge)", fix: "Existing models.providers.litellm entry exists without a ClawNex sidecar. Click Force Wire to overwrite + adopt ownership, or remove the entry manually with jq first and then click Wire LiteLLM.", doc: "17-troubleshooting-guide.md" },
            { issue: "Restart Gateway button missing / unsupported", fix: "Engine couldn't detect a known supervisor (systemd user unit on Linux, launchd Aqua agent on macOS). Result panel surfaces the manual command to run on the host.", doc: "17-troubleshooting-guide.md" },
            { issue: "Port 5001 already in use", fix: "pkill -9 -f 'next dev'; pkill -9 -f 'next-server'; then restart.", doc: "17-troubleshooting-guide.md" },
          ].map((item, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: C.tx, marginBottom: 2 }}>{item.issue}</div>
              <div style={{ fontSize: 12, color: C.txT }}>
                {item.fix}
                {item.doc && (
                  <span
                    onClick={() => handleOpenDoc(item.doc)}
                    style={{ marginLeft: 8, fontFamily: F.mono, fontSize: 11, color: C.cyan, cursor: "pointer", textDecoration: "underline dotted", textDecorationColor: `${C.cyan}55`, textUnderlineOffset: "3px" }}
                  >
                    docs/{item.doc}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleCard>

      {/* Documentation Links */}
      <CollapsibleCard title="Documentation" accent={C.purp} defaultOpen={false} count={11}>
        <div style={{ fontSize: 13, color: C.txS, lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 8px" }}>
            Click any doc name to open it in the reader above.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[
              { doc: "06-basic-user-manual.md", desc: "Operator operations guide" },
              { doc: "07-advanced-user-manual.md", desc: "Shield tuning, RBAC, break-glass" },
              { doc: "17-troubleshooting-guide.md", desc: "12 common issues + fixes" },
              { doc: "10-api-reference.md", desc: "71 internal + 7 public endpoints" },
              { doc: "14-data-dictionary.md", desc: "Database schema, 28 tables" },
              { doc: "19-api-mcp-integration-guide.md", desc: "External integration guide" },
              { doc: "13-release-notes.md", desc: "What changed in each version" },
              { doc: "CHANGELOG.md", desc: "Version-by-version changes" },
              { doc: "CONTRIBUTING.md", desc: "How to contribute (DCO, workflow)" },
              { doc: "SECURITY.md", desc: "Vulnerability reporting policy" },
              { doc: "SUPPORT.md", desc: "Getting help and filing issues" },
            ].map(d => (
              <div
                key={d.doc}
                onClick={() => handleOpenDoc(d.doc)}
                style={{ padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6, cursor: "pointer", transition: "border-color 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${C.purp}66`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = C.glassSurfBorder; }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: C.purp, fontFamily: F.mono }}>{d.doc.replace(".md", "")}</div>
                <div style={{ fontSize: 11, color: C.txT }}>{d.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleCard>

      {/* Glossary — operator-readable definitions for jargon, grouped by
          category. Wrapped in an outer CollapsibleCard (defaultOpen=false)
          so the whole section collapses to a single header by default;
          per-category cards inside also default closed so an operator
          opens only the section they need. Lives at the very bottom of
          the help panel per the operator's 2026-05-04 ask. Entries are sorted
          alphabetically at render time so the source list stays
          append-only. */}
      <CollapsibleCard title="Glossary" accent={C.cyan} defaultOpen={false} count={GLOSSARY.length}>
        <p style={{ fontSize: 12, color: C.txT, lineHeight: 1.6, margin: "0 0 12px" }}>
          Plain-English definitions for jargon used across the dashboard. Expand a category to read its terms.
          As new features ship, this list grows — append entries to <span style={{ fontFamily: F.mono, fontSize: 11, color: C.cyan }}>GLOSSARY</span> in <span style={{ fontFamily: F.mono, fontSize: 11, color: C.cyan }}>src/components/dashboard/constants.ts</span>.
        </p>
        {(() => {
          // Group entries by category, preserving the order categories first
          // appear in the GLOSSARY array. Within each category, entries are
          // sorted alphabetically by term at render time so the source list
          // stays append-only.
          const byCategory = new Map<string, GlossaryEntry[]>();
          for (const entry of GLOSSARY) {
            const list = byCategory.get(entry.category);
            if (list) list.push(entry);
            else byCategory.set(entry.category, [entry]);
          }
          return Array.from(byCategory.entries()).map(([category, entries]) => {
            const sorted = [...entries].sort((a, b) => a.term.localeCompare(b.term));
            return (
              <CollapsibleCard
                key={category}
                title={category}
                accent={C.cyan}
                defaultOpen={false}
                count={sorted.length}
              >
                {sorted.map((entry, i) => (
                  <div
                    key={entry.term}
                    style={{
                      padding: "10px 0",
                      borderBottom: i < sorted.length - 1 ? `1px solid ${C.glassBorderSubtle}` : "none",
                    }}
                  >
                    <div style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 700, color: C.brand, marginBottom: 4 }}>
                      {entry.term}
                    </div>
                    <div style={{ fontSize: 12, color: C.tx, lineHeight: 1.5 }}>
                      {entry.definition}
                    </div>
                    {entry.appearsIn && entry.appearsIn.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                        {entry.appearsIn.map(tabId => (
                          <Badge
                            key={tabId}
                            label={PANEL_HELP[tabId]?.title || tabId}
                            color={C.cyan}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CollapsibleCard>
            );
          });
        })()}
      </CollapsibleCard>
    </div>
  );
}
