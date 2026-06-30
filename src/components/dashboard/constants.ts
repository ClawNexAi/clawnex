import type React from "react";
import type { TabId, NavItem } from "./types";

// ---------------------------------------------------------------------------
// Panel Help Content — contextual help for each tab
// ---------------------------------------------------------------------------

/**
 * PANEL_HELP — Contextual help definitions for every dashboard tab.
 *
 * Each entry provides a human-readable title, description, key metrics,
 * available actions, and links to related tabs. Used by the help overlay
 * to give users panel-specific guidance.
 */
export const PANEL_HELP: Record<TabId, { title: string; desc: string; metrics: string[]; actions: string[]; related: TabId[] }> = {
  missionControl: {
    title: "Mission Control",
    desc: "Cockpit overview — fleet safety posture, evidence quality, action queue, and cost-risk signals at a glance. Drills into deep-work tabs for investigation.",
    metrics: [
      "Active incidents (open / investigating / suppressed)",
      "Evidence confidence (forward correlation %)",
      "Shield activity (24h block / review / allow)",
      "Cost risk (USD + drain signals)",
      "Collector health (online / stale)",
      "Policy coverage (active rules / lab-held)",
    ],
    actions: [
      "Acknowledge or contain a high-severity incident",
      "Drill into evidence for any flagged action",
      "Investigate cost-drain signals on a per-agent basis",
      "Review policy coverage gaps before changes",
    ],
    related: ["alertsIncidents", "auditEvidence", "tokenCost", "shield", "infrastructure"],
  },
  fleet: {
    title: "Fleet Command",
    desc: "Your command center. On a fresh install this panel shows the Welcome Wizard — a 7-step checklist that walks you through installing ClawNex, adding a model provider, enabling host security, syncing CVEs, syncing model pricing from LiteLLM GitHub, configuring OpenClaw routing, and running your first shield test. Once every step passes you'll see a Setup Complete screen with a Get Started button; after dismissing, the panel switches to the full fleet view showing all instances ranked by risk, with real-time stats on threats, alerts, agents, sessions, and cost. Below the fleet table, three summary cards show the top correlation, alert breakdown, and prompt shield status. v0.5.4+: every stat tile carries a hover tooltip — look for a tiny cyan pip in the top-right corner of each tile. Flip the TIPS button in the header if you want to silence tooltips temporarily. v0.6.2+: a Readiness Banner appears at the top of the dashboard showing live signals for Authentication, Shield, Providers, Trust Audit, and Security Posture with color-coded dots and action links — so you can see at a glance which onboarding or operational steps still need attention.",
    metrics: ["Instances — total fleet instances", "Healthy — instances with status 'healthy'", "Threats — shield block verdicts in the selected period", "Alerts — open alerts in the selected period", "Active Agents — total AI agents across fleet", "Sessions — total sessions across fleet", "Fleet Cost — total spend in the selected period"],
    actions: ["Welcome Wizard: buttons on each step jump to the right Configuration card, auto-expanded", "Click Verify Now on the Host Security step to confirm the bundled scanner is available", "Click any instance row to drill into Instance Detail", "Use the context bar to filter by time range, instance, or client", "Hover any stat tile with a cyan corner pip for a plain-English explanation", "Toggle Demo Mode (status bar) to preview multi-tenant view"],
    related: ["instance", "correlations", "configuration"],
  },
  instance: {
    title: "Instance Detail",
    desc: "Deep dive into a single fleet instance. Shows services health and a unified event timeline. The timeline merges alerts and audit events chronologically with severity-colored dots, a continuous connecting line, and backlinks to source panels. Consecutive duplicate events are grouped with an expand toggle. If LiteLLM Proxy is offline or degraded, its badge in the Services row becomes clickable and jumps straight to the Infrastructure tab so you can hit Restart.",
    metrics: ["Status — instance health (healthy/degraded/critical)", "CPU/Memory — current resource usage", "P95 Latency — 95th percentile response time", "Cost — total spend for this instance"],
    actions: ["Switch instances using the tabs at the top", "Click any timeline event to navigate to Alerts or Audit", "Expand grouped events (x9) to see individual entries", "Click a red LiteLLM badge to open Infrastructure and restart the proxy"],
    related: ["fleet", "infrastructure", "alertsIncidents"],
  },
  correlations: {
    title: "Correlations",
    desc: "The threat intelligence hub. The correlation engine aggregates signals from shield scans, traffic, infrastructure, alerts, and access lists into a unified risk score (0-100). Correlation entries show detected attack patterns with AI recommendations. v0.6.2 additions (internal reviewer Task 4): the threat score and level pill are prominent at the top with a source breakdown showing which signals contributed; the Re-evaluate Now button preserves the previous result while fetching a fresh one so the panel never flashes empty; a stale indicator appears when the last evaluation is older than 5 minutes. GET /api/correlations/evaluate now caches for 5 seconds (270ms cold → 34ms warm). 2026-05-01: the empty-state Seed Test Correlation action is now gated behind Developer Tools — the button only appears when /api/dev/status reports the surface as available (and is hidden entirely on customer-prod where the env kill-switch is set).",
    metrics: ["Threat Score — 0-100 composite risk score", "Level — LOW/MEDIUM/HIGH/CRITICAL pill", "Source Breakdown — which sources contribute most to the score", "Rules Triggered — how many correlation rules fired", "Last evaluated — stale indicator if >5 min old"],
    actions: ["Click Re-evaluate Now to recalculate the threat score (previous result stays visible during fetch)", "Expand any correlation entry to see the event timeline", "Click panel links in events to navigate to the source", "Use page size selector (5/10/25/50) for pagination", "Watch for the stale indicator when the last evaluation is older than 5 minutes", "Seed Test Correlation (Developer Tools only) — drops a synthetic correlation event into the live stream for rendering-path verification"],
    related: ["fleet", "alertsIncidents", "shield"],
  },
  blastRadius: {
    title: "Blast Radius",
    desc: "Unified blast-radius + permissiveness operating view. Answers in one screen: which agents are reachable from where, under what controls, with what tools, and how bad would it be if one were abused? Scans ~/.openclaw/openclaw.json channels.* blocks AND ~/.hermes/profiles/*/ (.env + config.yaml + pairing + channel_directory) for real posture. Detects dual-bot configurations (OpenClaw declares one bot, Hermes runs another), granularity gaps (OpenClaw declares per-guild posture Hermes doesn't enforce), and misconfigurations like channel IDs mixed into user allowlists. Every field carries provenance — one 'unknown' input collapses the whole claim to 'unknown' rather than lying with a green zero. Four vertical blocks: Exposure Matrix (Surface × posture × enforcer), Most Permissive Agents (ranked), Most Exposed Surfaces (ranked), Dangerous Combos + Posture Lints (side-by-side findings). Every KPI tooltip inline-defines its source, inclusion criteria, and confidence — no label-narrower-than-operator-reading gaps.",
    metrics: ["Surfaces — modeled (K integrated, L not_integrated)", "Reachable agents — joined from openclaw + hermes + runtime providers", "Dangerous combos — N evaluable · M skipped (insufficient evidence)", "Posture lints — rule findings against live config", "Max blast radius — highest edge score; '—' if inputs are unknown"],
    actions: ["Click Refresh to force a fresh scan (bypasses 60s cache)", "Expand any row in the Exposure Matrix to see the 9-dimension posture", "Click drilldown links to jump to Tools & Access / Access Lists / Agents / Routing", "Hover any KPI for its source + inclusion + confidence definition", "Review Posture Lints for live misconfigurations"],
    related: ["trustAudit", "toolsAccess", "accessLists", "agents", "correlations"],
  },
  trustAudit: {
    title: "Trust Audit",
    desc: "Best-effort permission-to-impact analysis using runtime, config, and filesystem signals. Treat `verified_runtime` findings as facts; treat `heuristic_inference` findings as advisory hypotheses. Discovery today derives agent identity from `proxy_traffic.session_id` and tool inventory from `TOOLS.md` where present — a fuller discovery model (real agent metadata, authoritative tool registry, live sandbox detection) is explicitly on the roadmap. The Trust Boundary and Blast Radius Audit surfaces who can reach which agents, what those agents can do, and what the blast radius would be if a trust boundary failed. v0.7.1 runs 15 rules across three layer groups: the original 6 (Direct Path Bypass, Tool Freedom, Model-to-Privilege Mismatch, Dormant Risk, Recovery-Path Permissiveness, Prompt-to-Capability Mismatch), 8 layers from the pre-OSS hardening pass, plus the v0.7.1 Comm-Surface Permissiveness rule that consumes the permissiveness scan and emits Findings for evaluable dangerous tool combinations and posture-lint misconfigurations alongside the other trust-boundary risks. Every finding carries an Evidence Level (verified_runtime / verified_config / verified_filesystem / heuristic_inference / unknown) shown as a confidence pill; expand any finding to see the underlying evidence trail. Agent surfaces and capabilities also carry a sandboxed flag where detectable. Performance pass: the break-glass hotspot query is now 700× faster (14.2s → 0.02s) via a composite index on audit_log(action, created_at); results are served from a short cache with last-run timestamp.",
    metrics: ["Overall severity", "Finding counts by severity with confidence pills", "Evidence level distribution across findings", "Surface count with sandboxed markers", "Agent count", "Last-run timestamp and cached-vs-fresh state"],
    actions: ["Click Run Audit to execute a fresh trust boundary scan", "Review findings sorted by severity", "Expand any finding to inspect the evidence trail behind the confidence pill", "Check the remediation plan for prioritized fixes", "Inspect the channel-to-capability matrix", "Look for sandboxed/unsandboxed markers on agent surfaces"],
    related: ["securityPosture", "shield", "accessControl", "configuration"],
  },
  securityPosture: {
    title: "Security Posture",
    desc: "Shows your security grade based on bundled host-hardening checks. Covers prerequisites, installation, host hardening, network, and security audit categories. Each check is scored and graded A-F. If the scanner is not available, verify it from the Welcome Wizard (Fleet Command) or from Configuration → Updates — this panel will start reporting as soon as the first scan finishes.",
    metrics: ["Grade — letter grade (A through F)", "Score — percentage of checks passed", "Passed/Failed/Warned — check result counts", "Hardening tiers — Basic, Standard, Advanced"],
    actions: ["Click Run Scan to execute a fresh security audit", "Verify the Host Security scanner from the Welcome Wizard or Configuration → Updates if it's missing", "Expand Hardening Report to see failed checks by tier", "Review Remediation Suggestions for prioritized fixes"],
    related: ["infrastructure", "configuration", "fleet"],
  },
  shield: {
    title: "Prompt Shield",
    desc: "The content scanner. Every LLM request is scanned by the 163 built-in Shield detections (inbound jailbreak / cognitive-tampering / secret-leak rules) plus any enabled policy-framework rules — both vendor system policies (Generic Egress Starter, wire-active outbound DLP) and operator-authored custom policies — matching the scan direction. The manual Live Input Scanner in this panel posts inbound only; the live wire path runs the full inbound + outbound matrix on every LiteLLM request. Coverage spans secrets, command injection, C2 beacons, jailbreaks, PII, and more. Shows scan history, detection stats, and the Live Input Scanner for manual testing. The Recent Shield Events section is collapsible (v0.5.4+) — click the chevron to hide the feed when you're focused on running scans. Hover the Verdict, Threat Score, and Detections stat tiles (they have cyan corner pips) for plain-English explanations of how each number is computed and what the thresholds mean. v0.9.2+: each shield_scans row carries a `detail.origin` provenance tag (production / manual / shield-test / demo / qa). Default counters here filter to production + manual origins so a Shield Tests run doesn't pollute the operator-facing badges; pass `?includeTestGenerated=true` on `/api/shield/stats` or `/api/shield/history` to see the full set.",
    metrics: ["Total Scans — production-origin requests scanned in the selected period", "Block Verdicts — requests that met BLOCK threshold", "Review Verdicts — requests flagged for review", "Top Categories — most frequently triggered rule categories"],
    actions: ["Use Live Input Scanner to test prompts manually (origin = manual; counts toward production stats)", "Filter Recent Scans by direction and verdict", "Collapse Recent Shield Events to focus on a scan workflow", "Hover the Verdict / Threat Score / Detections stats for threshold explanations", "Navigate to Configuration to manage shield whitelist"],
    related: ["trafficMonitor", "shieldTests", "accessLists"],
  },
  shieldTests: {
    title: "Shield Tests",
    desc: "27 test payloads covering jailbreaks, steganography, encoding, C2, financial, and Pliny-specific techniques. Each test is a collapsible card showing pass/fail, source tag (L1B3RT4S, P4RS3LT0NGV3, etc.), channel, verdict, and elapsed time. Expand to see the full payload, detections triggered, and score.",
    metrics: ["Pass/Fail — green checkmark or red X per test", "Score — shield score for the payload", "Source — which threat intel source the test targets", "Detections — specific rules that triggered"],
    actions: ["Click Run All Tests to execute the full suite", "Expand any test to see full payload and detection details", "Click Run This Test to re-run an individual test", "Review failures to identify gaps in detection coverage"],
    related: ["shield", "configuration"],
  },
  trafficMonitor: {
    title: "Traffic Monitor",
    desc: "Real-time view of all LLM traffic. Session Watcher can be enabled/disabled and scans all agent directories. Top Threats section shows enriched threat data with actor breakdown, samples, and backlinks. The Live Traffic table is collapsible (v0.5.4+) with a count pill in the collapsed header. Column headers (SOURCE, VERDICT, SCORE, STATUS) carry hover tooltips — look for the dotted cyan underline — explaining exactly what each column measures and how to filter it.",
    metrics: ["Source — litellm (live), session-watcher (retroactive), break-glass (bypassed)", "Verdict — ALLOW/REVIEW/BLOCK/BYPASSED", "Score — shield scan score (0-100)", "Top Threats — expandable with actors, last seen, and samples"],
    actions: ["Enable/Disable session watcher", "Filter by source, model, provider, verdict, or minimum score", "Collapse Live Traffic when triaging Top Threats", "Hover column headers for filter/interpretation tips", "Expand Top Threats for actor breakdown and backlinks", "Click Poll Now for immediate session scan"],
    related: ["shield", "tokenCost", "auditEvidence"],
  },
  accessControl: {
    title: "Access Control",
    desc: "Manage domain and IP deny lists. Denied domains and IPs are enforced by the Prompt Shield scanner as custom C2 category detections. Any LLM request referencing a denied domain or IP will trigger a HIGH severity detection.",
    metrics: ["Deny List entries — domains and IPs being blocked", "Hit count — how many times deny rules have triggered"],
    actions: ["Add domains or IPs to the deny list", "Remove false positives from the list", "View deny list hit history"],
    related: ["shield", "accessLists"],
  },
  agents: {
    title: "Agents & Sessions",
    desc: "Overview of all AI agents registered with OpenClaw. Shows each agent's model, status, session count, token usage, and tool permissions. Agents on the ignore list (configured in Configuration) are hidden. The Agents card is collapsible (v0.5.4+) with a count pill in the collapsed header. Hover the API Agents and API Source stat tiles (cyan corner pips) to see where the list is coming from — OpenClaw live fetch vs. local filesystem fallback.",
    metrics: ["Status — active/idle/offline", "Sessions — conversation count per agent", "Tokens Used — total token consumption", "Tool Permissions — which tools each agent can access"],
    actions: ["Review tool permissions for each agent", "Collapse the Agents list when you're focused on workspace files", "Hover API Agents / API Source for live-vs-fallback explanations", "Check denied tools for security restrictions", "Configure the agent ignore list in Configuration"],
    related: ["workspace", "toolsAccess", "tokenCost"],
  },
  workspace: {
    title: "Agent Workspace",
    desc: "Browse agent workspace files — SOUL files, workflows, configurations. Select an agent from the top bar to view their files. Click any file to view its contents in the right panel. 2026-05-01: agent names on the tab strip are now Title-Cased (Main, Neo, Trinity, Morpheus, Oracle, Agent Smith) rather than slugs. Main is pinned to the leftmost slot with a DEFAULT chip. Below the tab strip, a ROLE box prints a one-line description of what each agent is for — these descriptions live in ClawNex source (KNOWN_AGENT_ROLES in src/lib/services/agent-roles.ts) because the OpenClaw 4.12 identity schema rejects unknown keys. Workspace layout detection handles both the 4.12+ plural layout (~/.openclaw/workspaces/<id>/), the legacy hyphenated layout (~/.openclaw/workspace-<id>/), and the main agent's special-case singular path.",
    metrics: ["Key Files — total workspace files", "Agent Files — files specific to the selected agent", "Total Size — combined file size", "Recent Changes — files modified recently", "ROLE — one-line description of what the agent is for"],
    actions: ["Select an agent from the top tabs (Main is pinned to slot 0)", "Click any file to view contents", "Look for RECENTLY MODIFIED indicators for drift detection", "Read the ROLE box to understand what the agent is for"],
    related: ["agents", "toolsAccess"],
  },
  tokenCost: {
    title: "Token & Cost Intel",
    desc: "Multi-source FinOps reporting (v0.11.0+) across OpenClaw + Hermes + Paperclip. Every row carries an explicit cost trust label — Estimated / Actual / Recomputed / Included / Token-only / Cost unknown — see the in-app Glossary at the bottom of Help for definitions. The headline tile shows the highest single-source spend (we deliberately don't sum across sources because they overlap — same call appears in OpenClaw + Paperclip). The Drain Signals card flags 5 patterns: possible repeated-call loop, spend velocity spike, context bloat risk, cache hit drop, simple task on expensive model. Click any signal counter row to filter Recent Token Events. Per-source totals row + per-row trust badges. Pagination on long tables (default 5/page; options 5/10/15/25/50). Hide delivery-mirror toggle in header. Instance dropdown routes to the correct adapter set (`hermes-local` → only Hermes; OpenClaw instance name → only that fleet). Privacy guarantees verified by static AST grep + runtime tests — no `signal_context` leak; Hermes `system_prompt` plaintext stays in-adapter; OpenClaw token-reader cannot read message content.",
    metrics: ["Total Tokens — aggregate by model", "Per-source totals — OpenClaw / Hermes / Paperclip side-by-side (NOT summed)", "Highest reported monitored spend — single-source headline", "Cost trust label — Estimated / Actual / Recomputed / Included / Token-only / Cost unknown", "Drain Signals — 5 detectors with click-to-filter", "Source status — ok / unavailable per adapter"],
    actions: ["Use the time filter to analyze spend periods", "Click a Drain Signals counter row to filter Recent Token Events", "Hover any column header for trust-label semantics", "Toggle Hide delivery-mirror to collapse LiteLLM-side mirror rows", "Pick an instance from the dropdown to scope to one source", "Click View Evidence on any row's session to see the triggering audit event", "Set local model cost rates in Configuration → Local Model Cost Rates"],
    related: ["modelsCost", "agents", "fleet"],
  },
  toolsAccess: {
    title: "Tools & Access",
    desc: "Inventory of tools and skills available to your agents. Shows system skills, workspace skills, and Paperclip plugins. Each entry shows risk level and status. Also displays which tools are denied per agent.",
    metrics: ["Risk Level — HIGH/MEDIUM/LOW for each skill", "Status — active/inactive/restricted", "Denied Tools — tools blocked per agent"],
    actions: ["Review HIGH risk tools for appropriate restrictions", "Check denied tools per agent for security posture"],
    related: ["agents", "configuration"],
  },
  modelsCost: {
    title: "Models & Cost",
    desc: "Model inventory and cost tracking. Shows configured AI models across all providers (LM Studio, OpenRouter, OpenClaw, etc.) with their status and cost rates. Provider test buttons verify connectivity.",
    metrics: ["Provider Status — online/offline for each provider", "Model Count — models per provider", "Cost Rates — input/output token pricing"],
    actions: ["Click Test on any provider to verify connectivity", "Review model configurations", "Check cost rates for budget planning"],
    related: ["tokenCost", "configuration"],
  },
  infrastructure: {
    title: "Infrastructure",
    desc: "System health with four-state monitoring: ONLINE (green), DEGRADED (amber — running but issues), OFFLINE (red), and NOT_CONFIGURED (blue — service hasn't been set up yet). Only NOT_CONFIGURED rows are clickable and jump to Configuration; offline/degraded rows show inline detail plus an inline Restart button on the LiteLLM row that calls the restart API directly without navigating away.",
    metrics: ["CPU/Memory/Storage — utilization with color-coded bars", "Service Status — ONLINE/DEGRADED/OFFLINE/NOT_CONFIGURED", "Latency — response time per service", "Detail — inline explanation for degraded/offline services"],
    actions: ["Click Restart on the LiteLLM row to restart the proxy in place", "Click a NOT_CONFIGURED row to jump to Configuration and set it up", "Hover over degraded services for issue details", "Monitor CPU/memory for resource exhaustion"],
    related: ["fleet", "configuration"],
  },
  alertsIncidents: {
    title: "Alerts & Incidents",
    desc: "Card-based incident board. Each alert is a collapsible card with severity border, title, age timer, and status. Expand to see description, source, ACK/Resolve actions, and backlinks to the originating panel (Correlations, Shield, Traffic, or Audit). **View Evidence backlink (v0.11.1+, deep-link refined v0.11.2):** every Session Shield alert exposes a `View Evidence →` button that deep-links to the exact triggering audit row in the Audit & Evidence tab — clears filters that would have hidden it, scrolls smooth into view. Inline-expand fallback for legacy alerts / API errors.",
    metrics: ["Severity — CRITICAL/HIGH/MEDIUM/LOW (left border color)", "Age — time since alert was created", "Status — OPEN/ACKNOWLEDGED/INVESTIGATING/RESOLVED", "Source — correlation-engine, session-watcher, shield, etc."],
    actions: ["Click any card to expand details and actions", "ACK to acknowledge, Resolve to close", "Click `View Evidence →` to deep-link to the exact triggering audit row (session-watcher alerts)", "Click the backlink (e.g. 'Attack Chain →') to see the source correlation or event", "Filter by severity, source, or status at the top"],
    related: ["correlations", "auditEvidence", "shield"],
  },
  auditEvidence: {
    title: "Audit & Evidence",
    desc: "Immutable compliance audit trail. Every platform action is recorded — shield blocks, configuration changes, break-glass activations, alert acknowledgments. Data is filtered by the global context bar time range. **Structured shield evidence (v0.11.1+):** when a `shield_review` / `shield_detected` row is selected, the detail surfaces parsed rule_key + scanner-redacted matched sample + match-centered ±200-character snippet of the redacted `payload_excerpt` for each detection. Legacy plain-string detail rows fall through to the existing pre-formatted view. **Deep-link target (v0.11.2+):** AlertsIncidentsPanel's View Evidence button lands here with the exact audit row pre-selected and scrolled into view; if the row is outside the current time window, a `NOT IN WINDOW` notice surfaces with widen-the-filter guidance.",
    metrics: ["Action — what happened (shield_block, config_change, etc.)", "Actor — who/what performed the action", "Result — BLOCKED/OBSERVED/DETECTED/FLAGGED", "Detail — structured evidence: shield_detections, payload_excerpt (redacted at write time), prompt_hash, proxy_traffic_id"],
    actions: ["Filter by Result, Actor, or Action dropdowns", "Use the search box to find specific events", "Export data via Executive Reports for compliance audits", "If you arrive via View Evidence and see NOT IN WINDOW, widen the context-bar time range until the row appears"],
    related: ["alertsIncidents", "executiveReports"],
  },
  executiveReports: {
    title: "Executive Reports",
    desc: "Generate formatted reports for leadership, compliance auditors, and stakeholders. 12 report types covering traffic summaries, shield analysis, break-glass audits, data retention, and more.",
    metrics: ["12 Report Types — from executive summary to CSV data export", "Time Range — reports respect the global context bar period"],
    actions: ["Click Generate on any report", "Export as formatted text or CSV", "Use the Consolidated Executive Summary for board presentations"],
    related: ["auditEvidence", "alertsIncidents"],
  },
  accessLists: {
    title: "Access Lists",
    desc: "Manage domain and IP deny lists. Deny entries are evaluated by the Prompt Shield scanner. Any LLM traffic referencing a denied domain or IP triggers a HIGH severity detection.",
    metrics: ["Deny Entries — total blocked domains/IPs", "Hit Count — deny rule trigger count"],
    actions: ["Add suspicious domains or IPs to the deny list", "Review and remove false positives"],
    related: ["shield", "accessControl"],
  },
  riskAcceptance: {
    title: "Risk Acceptances",
    desc: "Operator-explicit, time-bound, audit-trailed suppression of findings across Trust Audit, Blast Radius, Correlations, and Alerts. Each acceptance records who accepted what, why, until when, and at what scope — finding (this exact finding), agent_rule (this rule for this agent), or rule_global (this rule for any agent). Default expiry is 90 days (30 days for Correlations) so risks get re-reviewed periodically. Suppressed findings are still tracked as gross findings; only the active aggregate excludes them. Scoped suppression auto-revokes when the underlying evidence changes (operator must re-accept with awareness of the new evidence). Every accept / revoke / expire / evidence-change writes to audit_log for SOC 2 / ISO 27001 evidence (CC7.1, CC7.2, A.5.27, A.8.34).",
    metrics: ["Active acceptances — every operator-accepted risk currently in effect", "Expiring soon — acceptances expiring within 14 days, banner-style at top", "Recently revoked / expired — last 30 days for audit reference", "Source panel filter — drill to Trust Audit / Blast Radius / Correlations / Alerts", "Search — match rule_id and reason text"],
    actions: ["Click an acceptance's panel name to jump to where it lives", "Revoke an acceptance to bring the suppressed finding back to active", "Renew an expiring acceptance by revoking + re-accepting with a fresh expiry", "Filter by source panel to see what's been suppressed across each surface", "Audit who accepted what — accepted_by + reason + audit_log row"],
    related: ["trustAudit", "blastRadius", "correlations", "alertsIncidents"],
  },
  help: {
    title: "Help",
    desc: "Your starting point for learning the dashboard. Covers what each panel does, how to navigate, keyboard shortcuts, the tooltip system, troubleshooting common issues, and links into the full developer manual and enterprise doc suite. If you're new to ClawNex, start here.",
    metrics: ["Panels — 26 dashboard tabs organized into 10 sidebar groups", "Tooltips — 26+ hover tooltips across 8 panels (toggle with TIPS button)", "Keyboard Shortcuts — Escape for tooltips, Enter for form submission, browser defaults", "Documentation — 60+ repo artifacts; 31 readable inline in the dashboard (11 operator docs + 20 governance docs via the Governance panel)"],
    actions: ["Browse the panel reference cards for a quick overview of each tab", "Check keyboard shortcuts for navigation tips", "Review the tooltip system explanation if you're seeing cyan dots or underlines", "Jump to Troubleshooting for common fixes", "Open the full developer manual for deep architecture reference", "Open the Governance Index for policies, registers, and the policy-evidence checklist"],
    related: ["about", "fleet", "configuration"],
  },
  about: {
    title: "Credits & Info",
    desc: "Version information, upstream project attribution, personal acknowledgments from the creator, disclaimers, responsible-disclosure contact, and license details. ClawNex is open-source under Apache 2.0 with DCO sign-off.",
    metrics: ["Version — current ClawNex release", "License — Apache 2.0 (patent grant, DCO sign-off)", "Dependencies — upstream projects that ClawNex builds on", "Acknowledgments — people who made this possible"],
    actions: ["Review upstream attribution for license compliance", "Check the responsible-disclosure contact for reporting security issues", "Read the disclaimers for scope and limitations"],
    related: ["help", "configuration"],
  },
  configuration: {
    title: "Configuration",
    desc: "Platform settings hub. v0.9.2 organizes 24 cards into 6 collapsible categories (AI & MODELS, FLEET & ROUTING, SHIELD & DETECTION, ACCESS CONTROL, INTEGRATIONS, SYSTEM) — first load shows only the six group headers so you can open just what you need. Each card expand/collapse choice persists per-category in localStorage. 2026-05-01: every subsection inside the larger cards (Fleet Connectors, Updates, OpenClaw Routing) now also persists its expand/collapse state via the useStickyBoolean hook — so an operator who only ever looks at one connector doesn't have to re-scroll past the others on every reload. Cards auto-expand and scroll into view when the Welcome Wizard or other panels deep-link here with a specific target (e.g. Model Providers, OpenClaw Routing, Updates, Authentication Methods, Developer Tools, Shield Settings — added 2026-05-02 from the new header posture pill). Coverage by category: AI & MODELS (Default AI Model, Model Providers, Local Model Cost Rates, AI Voice & Avatar — HeyGen / ElevenLabs / D-ID); FLEET & ROUTING (Fleet Connectors, OpenClaw Routing, MCP Server); SHIELD & DETECTION (Shield Settings, Custom Correlation Rules with 3 starter templates, Threat Score Weights 7 risk_weight_* sliders, Agent Ignore List); ACCESS CONTROL (Operator Management — full CRUD with role dropdown + unlock + reset-password + session timeout; Authentication Methods — admin toggle of GitHub OAuth and Magic Link providers; Auth & Devices — per-operator passkey enrollment + GitHub link management + Magic Link status; My Sessions; API Keys with scoped permissions); INTEGRATIONS (Mail Configuration — Resend / SMTP / Emailit with test-send button; Scheduled Reports; Modules toggle); SYSTEM (Updates — Host Security Scanner / ClawNex Shield Rules / Model Pricing refresh; Data Retention per category; UI Preferences; HTTPS / TLS via Caddy; Developer Tools — v0.9.3+ admin-only seed/reset of simulation traffic, gated by env kill-switch + DB toggle + RBAC; System Management — archive / purge / migrate / uninstall). v0.9.3+ adds the ClawNex-Managed Routing block to the OpenClaw Routing card: Wire LiteLLM, Force Wire (overwrite), Revert ClawNex Wire, Restart Gateway buttons + a 'View raw sidecar' disclosure showing the exact ~/.clawnex-routing-managed.json contents. The Welcome Wizard's step 5 invokes the same engine in one click (wire + auto-restart). Multi-auth providers (v0.9.0, Magic Link live v0.9.2): Authentication Methods gates GitHub OAuth + Magic Link at the provider level; Auth & Devices is where each operator enrolls their own passkeys and links their own GitHub account. Local password always works as the break-glass identifier regardless of what else is enabled.",
    metrics: ["Block Mode — OBSERVE or BLOCK", "Retention — per-category data retention periods", "OpenClaw Routing — ROUTED vs DIRECT per provider, plus ClawNex-Managed status (WIRED / OPERATOR-OWNED / NOT WIRED) and detected gateway supervisor", "Local Cost Rates — $/M tokens per model", "Correlation Rules — enabled/disabled with trigger count", "Threat Score Weights — risk_weight_* coefficients", "Scheduled Reports — on/off + cadence", "Operators — active / locked count with role badges", "Auth providers — per-provider enabled state + per-operator enrollment counts", "API Keys — issued key count with scopes"],
    actions: ["Browse cards by category — click a category header to expand that group only", "Wire / Revert / Force Wire / Restart the OpenClaw → LiteLLM bridge from the OpenClaw Routing card (sidecar-tracked, fully revertable)", "Edit gateway token for OpenClaw connection", "Add model providers (15 types with auto-fill URLs)", "Manage operators (admin-only) in Operator Management — add / disable / role-change / reset password / unlock", "Enable GitHub OAuth or Magic Link in Authentication Methods (admin-only); Magic Link also requires a configured mail provider", "Enroll a passkey, link / unlink GitHub, or check Magic Link availability on your account via Auth & Devices", "Configure Mail Configuration (Resend / SMTP / Emailit) — required before Magic Link and Scheduled Reports can deliver", "Verify the Host Security scanner from the Updates card", "Override the display name in UI Preferences (leave blank to use hostname)", "Set local model cost rates", "Seed or reset demo / QA traffic via the Developer Tools card (admin-only, env + DB-toggle + RBAC gated; rows tagged origin: simulation and excluded from production-grade counters)", "Archive / Purge / Migrate / Uninstall via System Management", "Configure voice and avatar (HeyGen / D-ID) with test buttons", "Build custom correlation rules from 3 starter templates", "Tune risk scoring via the 7 Threat Score Weights sliders", "Enable HTTPS for Docker deployments via the HTTPS card"],
    related: ["accessControl", "shield", "infrastructure", "correlations"],
  },
  governance: {
    title: "Governance",
    desc: "Read ClawNex's governance lane from inside the dashboard. Ships with 14 approved policies, 2 live registers (risk + vendor inventory), and three summary artifacts (one-pager, governance index, policy evidence checklist). Every policy carries a document ID, approval metadata (Owner & Maintainer sign-off pending a named alternate approver — tracked as risk R-019), and a change log. The Overview section is the fastest path for enterprise prospects and security reviewers; Policies and Registers expand below for deep reads. Markdown renders inline via the shared DocReader — click any row to open a doc, click Close to return to the list.",
    metrics: ["Overview — 3 summary docs (one-pager, index, evidence checklist)", "Policies — 14 approved + index (signed 2026-04-22)", "Registers — 2 live (risk register with 23 active risks; vendor inventory reconciled against codebase)", "Compliance posture — SOC 2 ~42% / ISO 27001:2022 ~38% / NIST CSF 2.0 Tier 2 (per 2026-04-22 audit)"],
    actions: ["Start with the Governance One-Pager for the leadership view", "Open the Policy Evidence Checklist to see which commitments have concrete artifacts vs gaps", "Read the Risk Register to see live priorities (P0/P1/P2 breakdown)", "Open any policy to inspect its control areas, approval metadata, and change log"],
    related: ["auditEvidence", "executiveReports", "about"],
  },
};

// ---------------------------------------------------------------------------
// Glossary — operator-readable definitions for jargon used across the dashboard
// ---------------------------------------------------------------------------

/**
 * GLOSSARY — operator-readable definitions for jargon terms used across the
 * dashboard. Each entry has a category, the term as displayed, a one-to-three-
 * sentence plain-English definition, and optional `appearsIn` cross-references
 * to the panels where the term shows up.
 *
 * As new features ship, append entries here. Categories are unstable for now —
 * add new categories as needed.
 */
export interface GlossaryEntry {
  term: string;
  category: string;
  definition: string;
  appearsIn?: TabId[];
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: "Estimated",
    category: "Cost trust labels",
    definition: "Cost figure carried by the source itself before the call settled (e.g. Paperclip's estimated=true rows, Hermes 'estimated' status backed by a provider models API). Not a ClawNex computation.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Actual",
    category: "Cost trust labels",
    definition: "Provider-reported or operator-reconciled cost — money that demonstrably hit the wallet. v1 reserves this label for source-native flags only (e.g. Hermes cost_status='actual', source-native subscription markers). Most rows in v1 do NOT show 'actual' because it requires per-adapter audit (deferred to v1.1).",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Recomputed",
    category: "Cost trust labels",
    definition: "Cost computed by ClawNex's pricing service from token counts × pinned rate-card snapshot. Not the source's number, not the provider's invoice — a defensible local recompute. Most rows in v1 lead with this label.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Included / no marginal spend",
    category: "Cost trust labels",
    definition: "Source explicitly flagged this row as a subscription / included route (e.g. Codex-via-ChatGPT subscription). The call was made, but the operator's wallet wasn't charged for it. Shown as $0 actual cost.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Token-only",
    category: "Cost trust labels",
    definition: "Token counts are trustworthy, but no usable price exists for this model in ClawNex's rate table. The cost cell renders as '—' rather than a misleading $0.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Cost unknown",
    category: "Cost trust labels",
    definition: "Insufficient data to compute or label cost (missing model, missing token counts, unsupported currency, etc.). Surfaces as '—' so the operator sees the gap rather than a fake zero.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Possible repeated-call loop",
    category: "Drain signals",
    definition: "Detector found multiple near-identical calls in a short window — possible runaway loop or repeated-prompt pattern. Hermes uses system_prompt hash matching across sessions; OpenClaw + Paperclip use structural (session/agent/model) heuristics. Conservative wording — 'possible' not 'confirmed'.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Spend velocity spike",
    category: "Drain signals",
    definition: "Spend in the current hour is significantly above the 7-day rolling baseline for this source (>4× trimmed-mean baseline). Requires at least 24 hours of historical data + a non-zero baseline before firing, so new installs won't false-alarm.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Context bloat risk",
    category: "Drain signals",
    definition: "Input tokens grew substantially over the lifetime of a single session (last-5-row average more than 2× the first-5-row average). In a multi-turn conversation the entire growing context is paid on every call — context compaction (summarizing prior turns) is the standard fix.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Cache hit drop",
    category: "Drain signals",
    definition: "Cache-hit ratio (Anthropic-style prompt caching) dropped >30% vs the trailing 7-day average for the same system_prompt. Precise cohort identity — Hermes only, since the system_prompt hash is the cohort key. Suggests the cached prompt may have changed without the operator realizing.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Cache hit drop risk",
    category: "Drain signals",
    definition: "Cache-hit ratio appears to have dropped vs trailing average for an OpenClaw (agent, model) cohort. Less precise than Cache hit drop because OpenClaw doesn't expose system_prompt — treat as a hint to investigate, not a confirmation.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Simple task on expensive model",
    category: "Drain signals",
    definition: "A simple call (input < 500 tokens, output < 200 tokens, no tool calls) ran on a model whose input rate exceeds $5 per million tokens. Consider whether a cheaper model would suffice for this workload pattern.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "OpenClaw",
    category: "Telemetry sources",
    definition: "Per-message session JSONL files at ~/.openclaw/agents/<agentId>/sessions/. ClawNex reads only token-usage and model metadata — never conversation content (load-bearing privacy guarantee).",
    appearsIn: ["tokenCost", "fleet", "agents"],
  },
  {
    term: "Hermes",
    category: "Telemetry sources",
    definition: "Per-session SQLite table at ~/.hermes/state.db. FinOps-aware (carries cost_status, cost_source, pricing_version columns natively). System prompts are hashed in memory for loop detection only — plaintext never leaves the adapter.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Paperclip",
    category: "Telemetry sources",
    definition: "Agent-orchestration platform reachable over HTTP. ClawNex pulls per-finance-event cost data via /api/companies/:id/costs/finance-events. Curtailed ingestion — only provider/model/tokens/cost/agent/timestamp/estimated/subscription fields are read. Paperclip's project/issue/budget features stay in Paperclip.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Source",
    category: "Telemetry sources",
    definition: "Which telemetry stream a row of cost data came from: openclaw, hermes, or paperclip. Per-source totals are shown side-by-side, never summed — the same call appearing in multiple sources would double-count.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Instance",
    category: "Telemetry sources",
    definition: "Filter dropdown that scopes the Token Cost view to a single source (e.g. 'hermes-local' shows only Hermes data). 'all' shows everything.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "delivery-mirror",
    category: "Virtual models & special markers",
    definition: "OpenClaw's internal echo/test virtual model. Used for tool-test / message-passing probes; never invokes a real LLM. Always reports zero tokens and zero cost. The 'Hide delivery-mirror' toggle at the top of the Token Cost tab filters these out across all panels.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Highest reported monitored spend",
    category: "Virtual models & special markers",
    definition: "The largest single-source total across OpenClaw / Hermes / Paperclip. NOT a sum across sources — same call appearing in multiple sources would double-count, so we show the highest reported figure as a conservative top-line.",
    appearsIn: ["tokenCost"],
  },
  {
    term: "Pricing version",
    category: "Virtual models & special markers",
    definition: "Snapshot tag for the rate-card source used to recompute a row's cost. DB-backed rates carry the source_version column; bundled JSON failsafe carries the bundle's __meta.version. Lets you trace exactly which rate snapshot produced any given recomputed dollar figure.",
    appearsIn: ["tokenCost"],
  },
  // ------------------------------------------------------------------------
  // Append-only additions (v0.9.x dashboard-wide jargon coverage). New
  // categories below — order is preserved at render time.
  // ------------------------------------------------------------------------
  {
    term: "Verdict",
    category: "Shield & detection",
    definition: "Final disposition the Shield assigned to a request: BLOCK / REVIEW / ALLOW. WOULD-BLOCK is shown when the Shield is in OBSERVE mode — it would have blocked, but didn't.",
    appearsIn: ["shield", "trafficMonitor", "shieldTests"],
  },
  {
    term: "Score",
    category: "Shield & detection",
    definition: "Risk score (0–100) the Shield computed from the rules that matched. Higher = riskier. Used as the secondary signal when no early-out fires.",
    appearsIn: ["shield", "trafficMonitor", "shieldTests"],
  },
  {
    term: "Detections",
    category: "Shield & detection",
    definition: "Specific rules from the Shield's 163-detection built-in library (or operator-authored custom policy rules) that matched this request. Each detection carries severity (critical/high/medium/low) and a rule key like OUT-PII-EMAIL.",
    appearsIn: ["shield", "trafficMonitor", "shieldTests"],
  },
  {
    term: "Layers triggered",
    category: "Shield & detection",
    definition: "Which categories of Shield rules fired on this request: jailbreak, outbound-leak, financial, sensitive-path, etc. Useful for triaging what kind of risk a request represents.",
    appearsIn: ["shield", "trafficMonitor"],
  },
  {
    term: "OBSERVE mode",
    category: "Shield & detection",
    definition: "Shield is detecting and recording threats but NOT blocking — the call still goes through. Used during initial deployment or rule tuning. Pairs with WOULD-BLOCK labels in evidence.",
    appearsIn: ["shield", "trafficMonitor", "configuration"],
  },
  {
    term: "BLOCKING mode",
    category: "Shield & detection",
    definition: "Shield actively blocks requests it judges unsafe (BLOCK verdict). Production posture once the operator has tuned rules to an acceptable false-positive rate.",
    appearsIn: ["shield", "configuration"],
  },
  {
    term: "Shield posture",
    category: "Shield & detection",
    definition: "Current Shield mode (OBSERVE or BLOCKING) — visible as a pill in the dashboard header so operators always know whether the Shield is enforcing or just watching.",
    appearsIn: ["fleet", "shield"],
  },
  {
    term: "Outbound leak",
    category: "Shield & detection",
    definition: "Category for rules that detect data flowing OUT of the system (PII, secrets, credentials, internal IPs, etc.) toward an external model or service. Treated more strictly than inbound rules because outbound data leaves the operator's control.",
    appearsIn: ["shield", "trafficMonitor"],
  },
  {
    term: "DLP",
    category: "Shield & detection",
    definition: "Data Loss Prevention. The class of Shield rules that scan for sensitive content (PII, credentials, secrets) being sent to LLMs. ClawNex's outbound-leak rules are the primary DLP surface.",
    appearsIn: ["shield", "shieldTests"],
  },
  {
    term: "Coverage Lab",
    category: "Shield & detection",
    definition: "Shield tests categorized as 'aspirational' rather than 'release-grade' — they test patterns the Shield doesn't yet catch (e.g. base64-hidden payloads). Tracked for visibility, not as regressions.",
    appearsIn: ["shieldTests"],
  },
  {
    term: "Pliny",
    category: "Shield & detection",
    definition: "Reference to 'Elder Pliny' jailbreak research — a public corpus of prompt-injection / jailbreak techniques. ClawNex's Shield Tests panel includes a Pliny category to verify rule coverage against this corpus.",
    appearsIn: ["shieldTests"],
  },
  {
    term: "Steganography",
    category: "Shield & detection",
    definition: "Hiding instructions inside other content — zero-width unicode, base64, image metadata, etc. Shield Tests has a dedicated category for these techniques.",
    appearsIn: ["shieldTests"],
  },
  {
    term: "C2",
    category: "Shield & detection",
    definition: "Command-and-control. Shield Tests category for prompts attempting to make the LLM behave as a C2 channel — exfiltrating data, fetching attacker-controlled URLs, etc.",
    appearsIn: ["shieldTests"],
  },
  {
    term: "Break-glass override",
    category: "Shield & detection",
    definition: "Emergency disable for the Access Control deny lists. Requires typed-phrase confirmation + reason and is fully audit-logged. For incidents only.",
    appearsIn: ["accessControl"],
  },
  {
    term: "Blast radius",
    category: "Blast radius & trust audit",
    definition: "How far an agent's actions can reach — which tools, skills, sources, and communication surfaces it can use. The Blast Radius panel is a matrix of these capabilities × agents, surfacing dangerous combinations.",
    appearsIn: ["blastRadius"],
  },
  {
    term: "Permissiveness",
    category: "Blast radius & trust audit",
    definition: "Library that scores how permissive each agent's blast radius is. Feeds dangerous-combo detection (e.g. an agent with both file-read AND network-write access) and posture-lint findings into Trust Audit.",
    appearsIn: ["blastRadius", "trustAudit"],
  },
  {
    term: "Trust boundary",
    category: "Blast radius & trust audit",
    definition: "The line between trusted and untrusted code/data in an agent's execution. Trust Audit catalogs how each agent crosses these boundaries (auth gates, sandbox edges, network egress) and where weaknesses live.",
    appearsIn: ["trustAudit"],
  },
  {
    term: "Dangerous combo",
    category: "Blast radius & trust audit",
    definition: "Two or more capabilities that, in combination, form a high-risk pattern (e.g. read-secrets + arbitrary-network = exfiltration vector). Surfaced by the permissiveness library as a Trust Audit finding.",
    appearsIn: ["blastRadius", "trustAudit"],
  },
  {
    term: "Posture-lint",
    category: "Blast radius & trust audit",
    definition: "Static analysis of the agent fleet's overall security posture — identifies weak patterns at the configuration level (e.g. Shield in OBSERVE on a production agent, missing auth on a tool). Feeds Trust Audit findings.",
    appearsIn: ["trustAudit"],
  },
  {
    term: "Sandboxed",
    category: "Blast radius & trust audit",
    definition: "An agent that runs inside a process / network / filesystem isolation layer — its blast radius is capped by the sandbox boundary regardless of what tools it has. Trust Audit flags sandboxed agents differently from unsandboxed ones.",
    appearsIn: ["trustAudit", "blastRadius"],
  },
  {
    term: "Confidence pill",
    category: "Blast radius & trust audit",
    definition: "Visual indicator on Trust Audit findings showing how certain ClawNex is about the finding (verified / strong / probable / weak / heuristic). Lets operators triage by confidence.",
    appearsIn: ["trustAudit"],
  },
  {
    term: "Correlation rule",
    category: "Correlations",
    definition: "Operator-defined rule that matches on combinations of signals (Shield verdict, score, model, source, etc.) and triggers an action when met. The Correlations engine is the policy/automation surface over individual events.",
    appearsIn: ["correlations"],
  },
  {
    term: "Attack chain",
    category: "Correlations",
    definition: "Multi-step pattern where individual events are benign but the sequence forms an attack — e.g. recon prompt → exfil prompt → C2-shaped output. Correlations attempts to detect chains via temporal/identity grouping rules.",
    appearsIn: ["correlations"],
  },
  {
    term: "Token burn anomaly",
    category: "Correlations",
    definition: "Cross-tab finding: an unusual spike in token spend correlated with security signals (e.g. high-volume calls from a recently-flagged agent). Bridges cost data to security data.",
    appearsIn: ["correlations"],
  },
  {
    term: "Service cascade",
    category: "Correlations",
    definition: "A cascading-failure or cascading-attack pattern across multiple services — e.g. one failure triggers retry storms across the fleet. Detected by Correlations from infrastructure + alert telemetry.",
    appearsIn: ["correlations"],
  },
  {
    term: "Auth storm",
    category: "Correlations",
    definition: "Sudden volume of auth attempts (login, magic-link request, passkey ceremony, etc.) on a single account or across the operator population. Flagged by Correlations as suspicious activity.",
    appearsIn: ["correlations"],
  },
  {
    term: "RBAC",
    category: "Auth & access",
    definition: "Role-Based Access Control. Operators are assigned roles (Admin / Security Manager / Viewer / Auditor); each role gets a fixed set of permissions. Mutation-bearing endpoints check RBAC; read endpoints often allow more.",
    appearsIn: ["accessLists", "configuration"],
  },
  {
    term: "Magic Link",
    category: "Auth & access",
    definition: "Email-based passwordless auth. ClawNex sends a one-time signed link; clicking it logs the operator in. Backed by Resend on the email side; pinned to the configured public domain.",
    appearsIn: ["configuration"],
  },
  {
    term: "Passkey",
    category: "Auth & access",
    definition: "WebAuthn-based passwordless auth. The operator's device (phone, yubikey, or platform authenticator) holds a private key that signs login challenges. Strongest auth method ClawNex supports.",
    appearsIn: ["configuration"],
  },
  {
    term: "Setup secret",
    category: "Auth & access",
    definition: "One-time URL token printed by the deployment script (e.g. /setup?secret=<long-hex>) that lets the very first operator claim the admin account on a fresh install. Burned after first use.",
    appearsIn: ["configuration"],
  },
  {
    term: "Curated policy",
    category: "Policy framework",
    definition: "Vendor-managed policy that mirrors a known-good rule set (e.g. ClawNex Default). Visible to operators but NOT wire-active in v1 — its purpose is reference / cloning.",
    appearsIn: ["governance"],
  },
  {
    term: "System policy",
    category: "Policy framework",
    definition: "ClawNex-shipped policy that IS wire-active out of the box (e.g. Generic Egress Starter). Vendor-managed; operators cannot edit rules in place but can disable the whole policy with a typed-phrase confirmation.",
    appearsIn: ["governance"],
  },
  {
    term: "Custom policy",
    category: "Policy framework",
    definition: "Operator-authored policy. Fully editable; rules are subject to safety gates (regex safety, rule-key format, etc.) at save time. Wire-active when enabled.",
    appearsIn: ["governance"],
  },
  {
    term: "Rule lifecycle",
    category: "Policy framework",
    definition: "Maturity tag for a rule, orthogonal to source: draft / lab / starter / strict / custom. A rule can be lifecycle=lab inside a starter-grade policy, meaning it's visible for review but not wire-active.",
    appearsIn: ["governance"],
  },
  {
    term: "Rule action",
    category: "Policy framework",
    definition: "What a rule's match does: score (contribute to risk score), allow (suppress this rule's own detection — audited), redact (mask the matched span), review (force REVIEW verdict), block (force BLOCK verdict).",
    appearsIn: ["governance"],
  },
  {
    term: "Rule key",
    category: "Policy framework",
    definition: "Stable, human-readable identifier for a rule (e.g. OUT-PII-EMAIL, JAIL-CREDENTIAL-EXTRACTION-REQUEST). Format: uppercase letters / digits / hyphen / underscore. Used in detection evidence and audit logs.",
    appearsIn: ["governance", "shield"],
  },
  {
    term: "Held draft",
    category: "Policy framework",
    definition: "A rule shipped with lifecycle='lab' AND enabled=false. Visible in the policy framework but not firing — surfaces a known pattern operators can choose to clone into a custom policy and tune.",
    appearsIn: ["governance"],
  },
  {
    term: "Policy test",
    category: "Policy framework",
    definition: "Restricted scan oracle on a single policy: POST /api/policies/:id/test with { text } returns { policy_id, matched } where each matched row is { rule_key, name, matchCount, samples, optional suppressed_by_exception }. Capped at 1000 iterations per scan. Requires the policies:test permission (admin / security_manager only). Audit-logged as policy_test with matched_rule_count, suppressed_count, and verdict (matched / no_match) on every call.",
    appearsIn: ["governance"],
  },
  {
    term: "Typed-phrase vendor disable",
    category: "Policy framework",
    definition: "Two-step confirmation required before disabling a vendor-shipped policy (source = curated or system). The dashboard prompts the operator to type a server-defined phrase (`disable clawnex default protection` for ClawNex Default; `disable generic egress starter` for Generic Egress Starter — never hardcoded in the client; the modal fetches the expected phrase from the server's 400 response) plus a free-text reason ≥10 chars. The reason is recorded in the `policy_disable` audit row's `detail` alongside `confirm_phrase_matched: true`; the typed phrase itself is never persisted.",
    appearsIn: ["governance"],
  },
  {
    term: "Policy audit provenance",
    category: "Policy framework",
    definition: "Every Shield detection that comes from the policy framework carries policy_id + policy_name + policy_source + policy_rule_id + rule_key + action on the detection envelope. When the evaluator suppresses a match (exception clause matched, or rule action='allow'), it emits a rule_match_suppressed audit row whose detail.suppression_kind is 'exception' or 'allow_action'. There is no rule_exception_suppressed event — the consolidated rule_match_suppressed event with the suppression_kind discriminator is the canonical surface.",
    appearsIn: ["governance", "auditEvidence"],
  },
  {
    term: "LiteLLM",
    category: "Infrastructure & deployment",
    definition: "Open-source proxy that normalizes calls to many LLM providers behind a single OpenAI-compatible API. ClawNex uses it as the data plane that LLM traffic flows through. Pinned to version 1.83.0 globally.",
    appearsIn: ["modelsCost", "trafficMonitor", "configuration"],
  },
  {
    term: "Caddy",
    category: "Infrastructure & deployment",
    definition: "Reverse proxy running in front of the ClawNex dashboard on production hosts. Handles TLS termination via Let's Encrypt and adds security headers (HSTS, etc.). Configured automatically by the deploy script.",
    appearsIn: ["configuration"],
  },
  {
    term: "Hardening grade",
    category: "Infrastructure & deployment",
    definition: "Letter grade (A–F) from the bundled host security scanner that summarizes the host's security posture across prerequisites, host hardening, network, and audit checks. Lower grade = more remediation needed.",
    appearsIn: ["securityPosture"],
  },
  {
    term: "Welcome Wizard",
    category: "Infrastructure & deployment",
    definition: "First-run setup flow on the Fleet Command tab — walks a new operator through claiming the admin account, configuring providers, and enabling key features. Disappears after setup completes.",
    appearsIn: ["fleet"],
  },
  {
    term: "Heartbeat",
    category: "Infrastructure & deployment",
    definition: "Periodic ping from a service to a coordinator (e.g. fleet → dashboard, agent → openclaw-gateway, paperclip-agent → paperclip-server). Lets the dashboard tell live from unreachable.",
    appearsIn: ["fleet", "instance"],
  },
];

// ---------------------------------------------------------------------------
// Color Palette (artifact v4.2)
// ---------------------------------------------------------------------------

/**
 * Theme color palettes — dark and light variants.
 *
 * Semantic color tokens used across every dashboard surface. Prefix
 * conventions: `bg` = background, `srf` = surface, `brd` = border,
 * `tx` = text. Named accents (`brand`, `warn`, `danger`, etc.) are
 * used for status indicators and data-viz.
 */
type ColorPalette = {
  bg: string; bgS: string; pnl: string; srf: string; srfA: string;
  brd: string; brdS: string; tx: string; txS: string; txT: string; txG: string;
  brand: string; warn: string; danger: string; info: string; purp: string;
  orange: string; cyan: string; green: string;
  // Glass design language — v0.13.0+ canonical aesthetic. Two tiers:
  //   - glass*Cockpit fields are for Mission Control's full cockpit treatment
  //     (radial gradients + ::before glow + heavy blur + 18px radius)
  //   - glass*Panel fields are for deep-work tabs' subdued glass treatment
  //     (translucent surfaces + 12px radius + no ::before glow)
  // Both tiers use the same color tokens; the difference is in chrome and
  // composition. See docs/superpowers/specs/2026-05-05-mission-control-design.md
  // §13 for the spec rationale.
  glassChrome: string;       // outer page chrome bg (with backdrop-filter)
  glassPanel: string;        // card body gradient stop 1
  glassPanel2: string;       // card body gradient stop 2
  // Nested-tile fill — one tier lighter than glassPanel/glassPanel2 so a
  // <Stat> tile reads as elevated when it sits inside a Card or directly on
  // the page background. Without this delta the child surface == parent
  // surface and tiles disappear into the card body.
  glassPanelNested: string;  // nested tile gradient stop 1 (lighter)
  glassPanelNested2: string; // nested tile gradient stop 2
  glassBorderSubtle: string; // chrome / mini-card border
  glassBorderCyan: string;   // card primary border
  glassBorderCyanStrong: string; // nested-tile border (stronger than glassBorderCyan)
  glassBorderStrong: string; // emphasis border (active states, mark)
  glassSurfTrans: string;    // mini-card / score-row body surface
  glassSurfBorder: string;   // mini-card / score-row border
  glassTrack: string;        // bar/stack track background
  glassShadow: string;       // outer chrome drop shadow (full)
  glassCardShadow: string;   // card drop shadow (subdued)
  glassGreen: string;        // gradient end — slightly brighter than `green`
};

export const DARK_THEME: ColorPalette = {
  bg: "#04070e",
  bgS: "#070c1a",
  pnl: "#0b1222",
  srf: "#101d34",
  srfA: "#0a1326",
  brd: "#14213d",
  brdS: "#1c2e52",
  tx: "#e5eaf3",
  txS: "#8899bb",
  txT: "#556a90",
  txG: "#3a4e6e",
  brand: "#00e5a0",
  warn: "#fbbf24",
  danger: "#f43f5e",
  info: "#38bdf8",
  purp: "#a78bfa",
  orange: "#fb923c",
  cyan: "#22d3ee",
  green: "#22c55e",
  glassChrome: "rgba(4, 10, 20, 0.58)",
  glassPanel: "rgba(13, 31, 55, 0.92)",
  glassPanel2: "rgba(7, 18, 32, 0.92)",
  glassPanelNested: "rgba(24, 48, 78, 0.92)",
  glassPanelNested2: "rgba(16, 36, 60, 0.92)",
  glassBorderSubtle: "rgba(255, 255, 255, 0.08)",
  glassBorderCyan: "rgba(85, 188, 255, 0.18)",
  glassBorderCyanStrong: "rgba(85, 188, 255, 0.42)",
  glassBorderStrong: "rgba(38, 217, 255, 0.48)",
  glassSurfTrans: "rgba(255, 255, 255, 0.035)",
  glassSurfBorder: "rgba(255, 255, 255, 0.075)",
  glassTrack: "rgba(255, 255, 255, 0.07)",
  glassShadow: "0 18px 60px rgba(0, 0, 0, 0.35)",
  glassCardShadow: "0 10px 34px rgba(0, 0, 0, 0.22)",
  glassGreen: "#2ee59d",
};

export const LIGHT_THEME: ColorPalette = {
  bg: "#f8fafc",
  bgS: "#f1f5f9",
  pnl: "#ffffff",
  srf: "#e2e8f0",
  srfA: "#f1f5f9",
  brd: "#cbd5e1",
  brdS: "#94a3b8",
  tx: "#0f172a",
  txS: "#475569",
  txT: "#64748b",
  txG: "#94a3b8",
  brand: "#00c889",
  warn: "#d97706",
  danger: "#dc2626",
  info: "#0284c7",
  purp: "#7c3aed",
  orange: "#ea580c",
  cyan: "#0891b2",
  green: "#16a34a",
  glassChrome: "rgba(248, 250, 252, 0.78)",
  glassPanel: "rgba(248, 250, 252, 0.92)",
  glassPanel2: "rgba(241, 245, 249, 0.92)",
  glassPanelNested: "rgba(255, 255, 255, 1.0)",
  glassPanelNested2: "rgba(252, 254, 255, 1.0)",
  glassBorderSubtle: "rgba(0, 0, 0, 0.06)",
  glassBorderCyan: "rgba(8, 145, 178, 0.20)",
  glassBorderCyanStrong: "rgba(8, 145, 178, 0.45)",
  glassBorderStrong: "rgba(8, 145, 178, 0.48)",
  glassSurfTrans: "rgba(0, 0, 0, 0.025)",
  glassSurfBorder: "rgba(0, 0, 0, 0.05)",
  glassTrack: "rgba(0, 0, 0, 0.07)",
  glassShadow: "0 18px 60px rgba(0, 0, 0, 0.10)",
  glassCardShadow: "0 10px 34px rgba(0, 0, 0, 0.06)",
  glassGreen: "#16a34a",
};

let currentTheme: "dark" | "light" = "dark";

/** C — Mutable design-system color palette. Updated by setTheme(). */
export const C: ColorPalette = { ...DARK_THEME };

/**
 * setTheme — Switch the active color palette between dark and light.
 * Copies the selected theme's values into the shared C object so all
 * existing references update automatically.
 */
export function setTheme(theme: "dark" | "light") {
  currentTheme = theme;
  const source = theme === "dark" ? DARK_THEME : LIGHT_THEME;
  for (const key of Object.keys(source) as (keyof ColorPalette)[]) {
    (C as Record<string, string>)[key] = source[key];
  }
  // Re-apply high contrast if it was on — theme switch resets C to base values
  if (highContrastEnabled) applyHighContrast(true);
}

/** getTheme — Returns the current active theme name. */
export function getTheme(): "dark" | "light" {
  return currentTheme;
}

// ---------------------------------------------------------------------------
// High Contrast Mode — accessibility toggle for low-vision / bright rooms
// ---------------------------------------------------------------------------

let highContrastEnabled = false;

/** High-contrast text-tier overrides per theme. */
const HIGH_CONTRAST_DARK = { txS: "#b0c4e0", txT: "#8899bb", txG: "#5a7099" };
const HIGH_CONTRAST_LIGHT = { txS: "#1e293b", txT: "#334155", txG: "#64748b" };

/**
 * applyHighContrast — bumps the muted text tiers (txS, txT, txG) to
 * higher-contrast values so secondary text, sidebar group labels, and
 * card subtitles are more readable for operators with lower vision or
 * difficult lighting conditions. Call after setTheme() or on its own.
 */
export function applyHighContrast(enabled: boolean) {
  highContrastEnabled = enabled;
  if (enabled) {
    const hc = currentTheme === "dark" ? HIGH_CONTRAST_DARK : HIGH_CONTRAST_LIGHT;
    C.txS = hc.txS;
    C.txT = hc.txT;
    C.txG = hc.txG;
  } else {
    // Restore from the base theme
    const source = currentTheme === "dark" ? DARK_THEME : LIGHT_THEME;
    C.txS = source.txS;
    C.txT = source.txT;
    C.txG = source.txG;
  }
}

/** isHighContrast — Returns whether high-contrast mode is currently active. */
export function isHighContrast(): boolean {
  return highContrastEnabled;
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/**
 * F — Font-family tokens.
 *
 * `mono` for code / data, `sans` for body copy, `disp` for headings.
 */
export const F = {
  mono: "'JetBrains Mono', monospace",
  sans: "'DM Sans', sans-serif",
  disp: "'Plus Jakarta Sans', sans-serif",
};

// ---------------------------------------------------------------------------
// Text style helpers (T) — codify the reviewer's 2026-05-06 contrast/readability rule
//
// WHY: glass surfaces (C.glassSurfTrans / C.glassChrome / C.glassPanel2)
// reduce the contrast ratio of muted text. the reviewer's audit flagged that small
// (10–12px) decision-bearing copy at C.txT or C.txG becomes hard to read at
// operator speed. The rule he wrote into docs/qa/design-consistency-live-
// 2026-05-06.md:
//
//   - Don't use C.txG for body/help text below 13px.
//   - Use C.txS as the minimum for meaningful secondary text.
//   - Reserve C.txT / C.txG for decorative metadata, disabled states,
//     or labels that are not decision-critical.
//   - 12px minimum for dense metadata; 13px minimum for explanatory body.
//
// HOW TO USE:
//
//   <span style={T.meta}>3 of 27 results</span>          // pagination, counts
//   <span style={T.body}>Activate this rule before...</span>  // help/explain
//   <span style={T.decoration}>↻ 14s</span>              // freshness ticker
//
// Components are free to spread these into existing inline styles when
// only color/size/lineHeight should change:
//
//   <div style={{ ...T.meta, fontFamily: F.mono }}>{value}</div>
//
// Decorative metadata (eyebrow numbers "01"/"02", separators, disabled
// states, status timestamps where the surrounding row already carries the
// meaning) may continue to use C.txT / C.txG at <13px — that is why
// `T.decoration` exists as an explicit opt-in, not a default.
// ---------------------------------------------------------------------------

export const T = {
  /**
   * Dense metadata — counts, ranges, refresh labels, pagination footers,
   * filter chips, table-row metadata where the operator may need to scan.
   * Decision-bearing but compact. 12px / C.txS / 1.45 line-height.
   */
  meta: { fontSize: 12, color: DARK_THEME.txS, lineHeight: 1.45 },
  /**
   * Explanatory body copy — help text, accordion descriptions, readiness
   * messages, status detail. Operators read this to decide. 13px / C.txS / 1.5.
   */
  body: { fontSize: 13, color: DARK_THEME.txS, lineHeight: 1.5 },
  /**
   * Decorative metadata — timestamps, separators, disabled-state labels,
   * eyebrow numbers, decoration that's NOT decision-critical. 11px / C.txT.
   * Use sparingly — when in doubt, prefer T.meta.
   */
  decoration: { fontSize: 11, color: DARK_THEME.txT, letterSpacing: "0.04em" },
} as const;

// ---------------------------------------------------------------------------
// Performance mode — disables backdrop-filter for remote desktop / low-GPU
// ---------------------------------------------------------------------------

/**
 * perfMode — Runtime flag that disables `backdrop-filter` when true.
 *
 * Toggle via {@link setPerfMode}. When enabled, the {@link G} glassmorphism
 * object falls back to opaque surfaces, which is necessary for remote
 * desktop or low-GPU environments where CSS blur is too expensive.
 */
export let perfMode = false;

/**
 * setPerfMode — Toggle performance mode on or off.
 *
 * @param on - `true` to disable backdrop-filter effects, `false` to re-enable.
 */
export function setPerfMode(on: boolean) { perfMode = on; }

/**
 * blur — Returns a `CSSProperties` object with `backdrop-filter` and its
 * WebKit prefix. Returns an empty object when {@link perfMode} is active.
 *
 * @param px - Blur radius in pixels.
 */
export function blur(px: number): React.CSSProperties {
  if (perfMode) return {};
  return { backdropFilter: `blur(${px}px)`, WebkitBackdropFilter: `blur(${px}px)` };
}

// ---------------------------------------------------------------------------
// Glassmorphism surface styles — frosted glass panels over dark background
// ---------------------------------------------------------------------------

/**
 * G — Glassmorphism surface-style factory.
 *
 * Each getter returns a `CSSProperties` object appropriate for its UI
 * context (card, stat chip, header bar, etc.). All getters respect
 * {@link perfMode}: when performance mode is active they return opaque
 * fallbacks instead of blurred glass.
 *
 * Also exposes a {@link G.glow} helper for accent-colored box-shadows.
 */
export const G = {
  /** Card / panel glass surface — v0.13.0+ promoted to the canonical glass
   *  treatment operator picked from the reviewer's mockup. Cards now use a vertical
   *  linear-gradient (panel→panel2) for depth, the cyan-tinted glass border,
   *  and the card-tier shadow. The shared <Card> in shared.tsx applies a 14px
   *  border-radius via override; this object provides the surface chrome. */
  get card(): React.CSSProperties {
    const light = currentTheme === "light";
    if (light) return {
      background: `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`,
      boxShadow: C.glassCardShadow,
      border: `1px solid ${C.glassBorderCyan}`,
    };
    return {
      background: perfMode ? C.pnl : `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`,
      ...blur(18),
      border: perfMode ? `1px solid ${C.brd}` : `1px solid ${C.glassBorderCyan}`,
      boxShadow: perfMode ? undefined : C.glassCardShadow,
    };
  },
  /** Stat / inner element glass — translucent surface for nested rows / mini-cards. */
  get stat(): React.CSSProperties {
    const light = currentTheme === "light";
    if (light) return {
      background: C.glassSurfTrans,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
      border: `1px solid ${C.glassSurfBorder}`,
    };
    return {
      background: perfMode ? C.srf : C.glassSurfTrans,
      ...blur(12),
      border: perfMode ? `1px solid ${C.brd}` : `1px solid ${C.glassSurfBorder}`,
    };
  },
  /** Header bar glass — used by the dashboard top bar. */
  get header(): React.CSSProperties {
    const light = currentTheme === "light";
    if (light) return {
      background: C.glassChrome,
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
      borderBottom: `1px solid ${C.glassBorderSubtle}`,
    };
    return {
      background: perfMode ? C.bgS : C.glassChrome,
      ...blur(20),
      borderBottom: perfMode ? `1px solid ${C.brd}` : `1px solid ${C.glassBorderSubtle}`,
    };
  },
  /** Context bar glass — filter-row chrome below the top header. */
  get context(): React.CSSProperties {
    const light = currentTheme === "light";
    if (light) return {
      background: C.glassChrome,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
      borderBottom: `1px solid ${C.glassBorderSubtle}`,
    };
    return {
      background: perfMode ? C.pnl : C.glassChrome,
      ...blur(16),
      borderBottom: perfMode ? `1px solid ${C.brd}` : `1px solid ${C.glassBorderSubtle}`,
    };
  },
  /** Panel header glass — the per-panel title strip. */
  get panelHeader(): React.CSSProperties {
    const light = currentTheme === "light";
    if (light) return {
      background: C.glassChrome,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
      borderBottom: `1px solid ${C.glassBorderSubtle}`,
    };
    return {
      background: perfMode ? C.pnl : C.glassChrome,
      ...blur(12),
      borderBottom: perfMode ? `1px solid ${C.brd}` : `1px solid ${C.glassBorderSubtle}`,
    };
  },
  /** Glow helper -- returns box-shadow for accent color */
  glow: (color: string, intensity: number = 0.12) => {
    if (currentTheme === "light") {
      return `0 2px 8px rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, ${intensity * 0.6})`;
    }
    return `0 0 20px rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, ${intensity}), inset 0 1px 0 rgba(255, 255, 255, 0.03)`;
  },
};

// ---------------------------------------------------------------------------
// Nav structure matching artifact screenshots
// ---------------------------------------------------------------------------

// Re-export NavItem from types for convenience
export type { NavItem } from "./types";

/**
 * NAV — Ordered list of sidebar navigation items, grouped by functional area.
 *
 * Groups: COMMAND, SECURITY, DEFENSE, ACTIVITY, GOVERNANCE, PERFORMANCE,
 * OPERATIONS, COMPLIANCE, SYSTEM.
 */
export const NAV: NavItem[] = [
  { id: "missionControl", label: "Mission Control", icon: "\uD83D\uDE80", group: "COMMAND" },
  { id: "fleet", label: "Fleet Command", icon: "\uD83D\uDDA5", group: "COMMAND" },
  { id: "instance", label: "Instance Detail", icon: "\uD83D\uDD0D", group: "COMMAND" },
  { id: "correlations", label: "Correlations", icon: "\uD83D\uDD17", group: "COMMAND" },
  { id: "blastRadius", label: "Blast Radius", icon: "\uD83D\uDCA5", group: "COMMAND" },
  { id: "securityPosture", label: "Security Posture", icon: "\uD83D\uDCAA", group: "SECURITY" },
  { id: "trustAudit", label: "Trust Audit", icon: "\uD83D\uDD2D", group: "SECURITY" },
  { id: "shield", label: "Prompt Shield", icon: "\uD83D\uDEE1", group: "SECURITY" },
  { id: "shieldTests", label: "Shield Tests", icon: "\u2714", group: "SECURITY" },
  { id: "trafficMonitor", label: "Traffic Monitor", icon: "\uD83D\uDCE1", group: "SECURITY" },
  { id: "accessControl", label: "Access Control", icon: "\uD83D\uDD12", group: "DEFENSE" },
  { id: "agents", label: "Agents & Sessions", icon: "\uD83E\uDD16", group: "ACTIVITY" },
  { id: "workspace", label: "Agent Workspace", icon: "\uD83D\uDCC2", group: "ACTIVITY" },
  { id: "tokenCost", label: "Token & Cost Intel", icon: "\uD83D\uDCB0", group: "ACTIVITY" },
  { id: "toolsAccess", label: "Tools & Access", icon: "\uD83D\uDD27", group: "GOVERNANCE" },
  { id: "riskAcceptance", label: "Risk Acceptances", icon: "\u2705", group: "GOVERNANCE" },
  { id: "modelsCost", label: "Models & Cost", icon: "\uD83E\uDDE0", group: "PERFORMANCE" },
  { id: "infrastructure", label: "Infrastructure", icon: "\uD83D\uDCE6", group: "OPERATIONS" },
  { id: "alertsIncidents", label: "Alerts & Incidents", icon: "\uD83D\uDD14", group: "OPERATIONS" },
  { id: "auditEvidence", label: "Audit & Evidence", icon: "\uD83D\uDCCB", group: "COMPLIANCE" },
  { id: "executiveReports", label: "Executive Reports", icon: "\uD83D\uDCC4", group: "COMPLIANCE" },
  { id: "accessLists", label: "Access Lists", icon: "\uD83D\uDD10", group: "COMPLIANCE" },
  { id: "governance", label: "Governance", icon: "\uD83D\uDCDC", group: "COMPLIANCE" },
  { id: "configuration", label: "Configuration", icon: "\u2699\uFE0F", group: "SYSTEM" },
  { id: "help", label: "Help", icon: "\u2753", group: "ABOUT" },
  { id: "about", label: "Credits & Info", icon: "\u2139\uFE0F", group: "ABOUT" },
];
