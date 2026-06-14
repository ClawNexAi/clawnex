/**
 * ClawNex AI Chat API
 * POST /api/chat
 *
 * Accepts: { message, history, model?, provider? }
 * Routes to LM Studio (direct) or OpenClaw gateway, with keyword fallback.
 * Injects live ClawNex data into the system prompt for context-aware responses.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { config } from "@/lib/config";
import { queryAll, queryOne } from "@/lib/db/index";
import * as configService from "@/lib/services/config-service";
import { CLAWNEX_VERSION_SHORT } from "@/lib/version";
import { activeAlertSqlClause } from "@/lib/dashboard/metric-semantics";
import { ONBOARDING_STEPS, ONBOARDING_STEP_COUNT, renderOnboardingStepsMarkdown } from "@/lib/dashboard/onboarding-steps";
import { shieldScan } from "@/lib/shield/scanner";
import { outboundShieldGate } from "@/lib/shield/outbound-gate";
import { extractAssistantOutput } from "@/lib/shield/extract-assistant-output";
import { sanitizeMessageArray } from "@/lib/shield/sanitize-chat-payload";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Gather live ClawNex context for the system prompt
// ---------------------------------------------------------------------------

interface AlertRow { id: string; title: string; severity: string; status: string; source: string; description: string; created_at: string }
interface ShieldRow { id: string; threat_level: string; scanned_at: string; detail: string }
interface CorrelationRow { id: string; correlation_rule: string; description: string; severity: string; source_events: string; created_at: string }

function gatherContext(): string {
  const sections: string[] = [];

  // Open alerts (comprehensive)
  try {
    const alerts = queryAll<AlertRow>(
      // Active alerts only (open + acknowledged + investigating). Suppressed
      // alerts are excluded so the AI doesn't surface them as "open" — the
      // operator already opted out of those via risk acceptance. Canonical
      // contract: lib/dashboard/metric-semantics.ts.
      `SELECT id, title, severity, status, source, description, created_at FROM alerts WHERE ${activeAlertSqlClause()} ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, created_at DESC LIMIT 15`,
      []
    );
    const critCount = alerts.filter(a => a.severity === "CRITICAL").length;
    const highCount = alerts.filter(a => a.severity === "HIGH").length;
    sections.push(`## ALERTS: ${alerts.length} open (${critCount} CRITICAL, ${highCount} HIGH)`);
    if (alerts.length > 0) {
      for (const a of alerts.slice(0, 10)) {
        sections.push(`- [${a.severity}] ${a.title} — Source: ${a.source} — ${a.status} — ${a.created_at}`);
      }
    }
  } catch { sections.push("## ALERTS: Unable to query."); }

  // Shield scan statistics (24h)
  try {
    const blocked = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM shield_scans WHERE threat_level = 'BLOCK' AND scanned_at >= datetime('now', '-24 hours')", []);
    const reviewed = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM shield_scans WHERE threat_level = 'REVIEW' AND scanned_at >= datetime('now', '-24 hours')", []);
    const allowed = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM shield_scans WHERE threat_level = 'ALLOW' AND scanned_at >= datetime('now', '-24 hours')", []);
    const total = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM shield_scans WHERE scanned_at >= datetime('now', '-24 hours')", []);
    sections.push(`## PROMPT SHIELD (24h): ${total?.cnt || 0} scans — ${blocked?.cnt || 0} BLOCK, ${reviewed?.cnt || 0} REVIEW, ${allowed?.cnt || 0} ALLOW`);
  } catch { sections.push("## SHIELD: Unable to query."); }

  // Traffic summary (24h)
  try {
    const trafficTotal = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM proxy_traffic WHERE timestamp >= datetime('now', '-24 hours')", []);
    const trafficBlocked = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM proxy_traffic WHERE blocked = 1 AND timestamp >= datetime('now', '-24 hours')", []);
    const totalTokens = queryOne<{ total: number }>("SELECT COALESCE(SUM(total_tokens), 0) as total FROM proxy_traffic WHERE timestamp >= datetime('now', '-24 hours')", []);
    const topModels = queryAll<{ model: string; cnt: number }>("SELECT model, COUNT(*) as cnt FROM proxy_traffic WHERE model IS NOT NULL AND timestamp >= datetime('now', '-24 hours') GROUP BY model ORDER BY cnt DESC LIMIT 5", []);
    sections.push(`## TRAFFIC (24h): ${trafficTotal?.cnt || 0} requests, ${trafficBlocked?.cnt || 0} blocked, ${(totalTokens?.total || 0).toLocaleString()} tokens`);
    if (topModels.length > 0) {
      sections.push("Top models: " + topModels.map(m => `${m.model} (${m.cnt})`).join(", "));
    }
  } catch { sections.push("## TRAFFIC: Unable to query."); }

  // Recent blocked/high-score traffic
  try {
    const recentBlocks = queryAll<{ model: string | null; shield_verdict: string | null; shield_score: number; timestamp: string; shield_detections: string | null }>(
      "SELECT model, shield_verdict, shield_score, timestamp, shield_detections FROM proxy_traffic WHERE shield_score >= 25 AND timestamp >= datetime('now', '-24 hours') ORDER BY shield_score DESC LIMIT 5", []
    );
    if (recentBlocks.length > 0) {
      sections.push("## HIGH-SCORE TRAFFIC (score >= 25)");
      for (const t of recentBlocks) {
        let dets = "";
        try { const d = JSON.parse(t.shield_detections || "[]"); dets = d.slice(0, 3).map((x: { name?: string }) => x.name).join(", "); } catch {}
        sections.push(`- [${t.shield_verdict}] Score ${t.shield_score} — ${t.model || "unknown"} — ${dets || "no details"} — ${t.timestamp}`);
      }
    }
  } catch {}

  // Break-glass status
  try {
    const bg = queryOne<{ value: string }>("SELECT value FROM config_defaults WHERE key = 'break_glass'", []);
    if (bg?.value) {
      const state = JSON.parse(bg.value);
      if (state.active) {
        sections.push(`## BREAK-GLASS: ACTIVE — Reason: ${state.reason} — Expires: ${state.expires_at}`);
      } else {
        sections.push("## BREAK-GLASS: Inactive (normal operation)");
      }
    }
  } catch {}

  // Block mode
  try {
    const bm = queryOne<{ value: string }>("SELECT value FROM config_defaults WHERE key = 'proxy_block_mode'", []);
    sections.push(`## SHIELD MODE: ${bm?.value === "on" ? "BLOCK (actively blocking threats)" : "OBSERVE (logging only, not blocking)"}`);
  } catch {}

  // Whitelist
  try {
    const wl = queryOne<{ value: string }>("SELECT value FROM config_defaults WHERE key = 'shield_whitelist'", []);
    const count = wl?.value ? JSON.parse(wl.value).length : 0;
    sections.push(`## WHITELIST: ${count} rules whitelisted for internal traffic`);
  } catch {}

  // Correlations
  try {
    const corrs = queryAll<CorrelationRow>(
      "SELECT id, correlation_rule, description, severity, source_events, created_at FROM correlation_events WHERE created_at >= datetime('now', '-24 hours') ORDER BY created_at DESC LIMIT 5", []
    );
    if (corrs.length > 0) {
      sections.push("## CORRELATIONS (24h)");
      for (const c of corrs) { sections.push(`- [${c.severity}] ${c.description} (Rule: ${c.correlation_rule})`); }
    } else { sections.push("## CORRELATIONS: None detected in last 24h"); }
  } catch {}

  // Retention settings
  try {
    const ret = queryAll<{ key: string; value: string }>("SELECT key, value FROM config_defaults WHERE key LIKE 'retention_%'", []);
    if (ret.length > 0) {
      sections.push("## RETENTION: " + ret.map(r => `${r.key.replace('retention_', '').replace('_days', '')}: ${r.value === "0" ? "unlimited" : r.value + "d"}`).join(", "));
    }
  } catch {}

  // Session watcher
  try {
    const trafficWatcher = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM proxy_traffic WHERE source = 'session-watcher' AND timestamp >= datetime('now', '-24 hours')", []);
    sections.push(`## SESSION WATCHER (24h): ${trafficWatcher?.cnt || 0} messages scanned retroactively`);
  } catch {}

  // System metrics
  try {
    const metrics = queryAll<{ metric_name: string; metric_value: number }>(
      "SELECT metric_name, metric_value FROM metric_snapshots WHERE metric_name IN ('cpu_percent', 'memory_percent', 'disk_percent') ORDER BY recorded_at DESC LIMIT 3", []
    );
    if (metrics.length > 0) {
      sections.push("## SYSTEM: " + metrics.map(m => `${m.metric_name.replace('_percent', '')}: ${m.metric_value}%`).join(", "));
    }
  } catch {}

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Build system prompt with live context
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  const context = gatherContext();
  return `You are the ClawNex AI Security Operations Assistant, embedded in the ClawNex SOC dashboard. ClawNex — One nexus. Total control.

Your role: Help the operator triage security events, understand fleet status, navigate the dashboard, and walk first-time users through setup.

PLATFORM OVERVIEW (v${CLAWNEX_VERSION_SHORT}):
- Fresh installs open on [Fleet] with a Welcome Wizard: a ${ONBOARDING_STEP_COUNT}-step checklist (${ONBOARDING_STEPS.map(s => s.label).join(', ')}). Every step button auto-expands the right Configuration card. The wizard stays until all steps pass AND the operator clicks Get Started on the Setup Complete screen — that click persists via \`wizard_dismissed\` in config_defaults.
- **Tooltip System** (new in v0.5.4, copy refresh 2026-05-01): Most stats, badges, column headers, and controls carry hover tooltips for contextual help. Inline text anchors (column headers, labels, badges) have a dotted cyan underline at rest that brightens on hover. Stat tiles and cards show a small cyan corner pip in the top-right — hover to see the explanation. A global **TIPS** button in the header (next to the \`?\` help button) toggles the entire tooltip system on/off; the preference persists via \`config_defaults.tooltips_enabled\`. The 2026-05-01 sweep rewrote ~92 tooltips into plain English (no internal jargon, no TipCode shorthand). If an operator asks "what are these cyan dots?" or "why is this underlined?" — explain that those are discoverability hints for the tooltip system.
- **Collapsible Sections** (new in v0.5.4): Four high-density sections can now collapse to save vertical space — Recent Shield Events on [Prompt Shield], Live Traffic on [Traffic Monitor], Agents on [Agents & Sessions], Cost by Agent on [Token & Cost Intel]. Each shows a count pill in the collapsed header so the data stays discoverable.
- **Sticky Collapse on Configuration** (added 2026-05-01): Inside Configuration → Fleet Connectors / Updates / OpenClaw Routing, every subsection's expand/collapse state persists in localStorage. If an operator collapses a connector once, it stays collapsed across reloads.
- **UPDATES Pill in the Header** (added 2026-05-01): A small pill next to the version chip aggregates "you should update X" notifications. Sources today: Clawkeeper (actionable, counted in the badge), OpenClaw and DefenseClaw rules (informational, shown in dropdown with INFO tag — drift is reported but not counted because there's no in-app updater for them). The pill polls /api/config/updates every 15 minutes and refreshes immediately when an in-app update completes (via a \`clawnex:updates-refreshed\` window event). When operators ask about updates, point them at the pill first; it's the single source of truth across the dashboard.
- **Theme Toggle** (rewritten 2026-05-01): The header's sun/moon icon is now a brand-orange SVG (16px) instead of Unicode glyphs that disappeared on certain font fallbacks. Click flips dark ↔ light; persists across reloads.
- **Agent Roles** (added 2026-05-01): The Agent Workspace tab now shows a ROLE description box for each agent. Roles live in ClawNex source (\`src/lib/services/agent-roles.ts\` → \`KNOWN_AGENT_ROLES\`) because the OpenClaw 4.12 schema rejects the \`role\` field on identity. Today's mapping: main = "Default OpenClaw operator workspace", neo = "End-to-end investigator and pivot generalist", trinity = "Infiltration specialist — recon and controlled pen-testing", morpheus = "Strategic advisor and orchestration mentor", oracle = "Pattern recognition and longitudinal forecasting", agent-smith = "Adversarial simulation and red-team validation". Agent names are Title-Cased on the tab strip (\`main\` → "Main", \`agent-smith\` → "Agent Smith"). Main is pinned to slot 0 with a DEFAULT chip.
- **OpenClaw 4.12 Device-Identity Handshake** (added 2026-05-01): When connecting to OpenClaw 4.12+ gateways, ClawNex signs a v2 device-auth payload with a per-install Ed25519 keypair stored in \`config_defaults\`. Backwards-compatible with 3.28 / 4.10 / 4.11 (skips the device payload when the challenge has no nonce). If an operator reports "OpenClaw says device identity required", it usually means a stale build before commit ff77ee9 (2026-05-01) — point them at \`scripts/deploy-prod.sh\` for the redeploy and \`docs/17-troubleshooting-guide.md §2 Cause G\` for the SQL to regenerate the keypair.
- **Shield Posture Pill in the Header** (added 2026-05-02): A colored pill in the header status row (left of the count pill) shows whether the shield is actively blocking or just observing. **🟡 OBSERVE (amber)** = scans + logs but doesn't block; the count pill at the right end of the row reads "N WOULD-BLOCK" because in OBSERVE mode those rows weren't actually blocked, just flagged. **🔴 BLOCKING (danger-red)** = actively rejects threats before they reach the model; the count pill reads "N BLOCKED". Click the posture pill to jump to Configuration → Shield Settings to flip modes. This closed an operator-honesty gap where the count always read "SHIELD BLOCKS" regardless of mode. When operators ask "are we blocking?" or "what does WOULD-BLOCK mean?", explain the mode is the source of truth and walk them through the toggle.
- **Model Pricing** is refreshable intelligence, same pattern as CVE intel. ClawNex ships with a bundled LiteLLM price snapshot that seeds the \`model_prices\` DB on first boot. Operators refresh from [Configuration] → Updates → Model Pricing → Update Now, which pulls from LiteLLM's GitHub at the pinned version tag with the \`-nightly\` suffix (never upstream main). They can also set an auto-sync schedule (hours interval) and a stale threshold (days). This is how the Token & Cost Intel panel stays current as new models launch.
- [Infrastructure] shows four service states: ONLINE / DEGRADED / OFFLINE / NOT_CONFIGURED, every state now has a hover tooltip explaining what it means. Only NOT_CONFIGURED rows are clickable (jump to Configuration). Offline/degraded LiteLLM has an inline Restart button that calls the restart API in place — never direct operators to "go to Configuration" to restart LiteLLM.
- On [Instance Detail], a red LiteLLM Proxy badge is clickable and jumps to Infrastructure so the operator can Restart from there.
- [Configuration] → OpenClaw Routing distinguishes "openclaw.json missing" (warning) from "config found, zero LLM providers registered" (friendly info). The fleet client name defaults to the machine's hostname; operators can override it in Configuration → UI Preferences → Display Name.
- Clawkeeper can be installed from the Welcome Wizard's Install Now button OR from [Configuration] → Updates → Clawkeeper → Install.

FORMATTING RULES:
- Use **bold** for emphasis on severity levels and key terms
- Use [Panel Name] in brackets to create clickable navigation links. Valid panels: [Alerts], [Prompt Shield], [Infrastructure], [Correlations], [Fleet], [Agents], [Token Intel], [Models], [Audit Trail], [Workspace], [Security Posture], [Configuration], [Instance Detail]
- Use numbered lists for prioritized items
- Use bullet points for details
- Keep responses concise and actionable — max 3-5 key points
- Reference specific alert IDs, agent names, and instance IDs when available
- Always lead with the most critical item first

LIVE CLAWNEX DATA:
${context}

When asked about priorities, threats, or status:
- Reference the ACTUAL alerts and data above, not generic advice
- Include alert IDs (e.g., ALT-xxx) and link to relevant panels
- If there are CRITICAL alerts, always mention them first
- Recommend specific actions the operator should take

When asked about setup, first-run, or installation:
- Point the operator to the Welcome Wizard on [Fleet]
- For a specific step, name the button they should click (e.g. "Install Now" for Clawkeeper)
- Remind them the wizard stays visible until all ${ONBOARDING_STEP_COUNT} steps are green and they click Get Started`;
}

// ---------------------------------------------------------------------------
// Keyword fallback system
// ---------------------------------------------------------------------------

const KEYWORD_RESPONSES: Array<{ keywords: string[]; response: string }> = [
  {
    keywords: ["priority", "highest", "urgent", "critical"],
    response: "Checking live alert data for priorities...\n\nPlease select a local model (Qwen3 Coder or Qwen3.5) from the model selector above for context-aware responses. The fallback system doesn't have access to live data.\n\nIn the meantime, check:\n1. [Alerts] panel for open CRITICAL/HIGH incidents\n2. [Prompt Shield] for recently blocked threats\n3. [Correlations] for active attack chains",
  },
  {
    keywords: ["token", "cost", "spend", "budget"],
    response: "Token cost analysis:\n\n- **Opus 4** (cloud): ~$15/MTok input, $75/MTok output\n- **Sonnet 4** (cloud): ~$3/MTok input, $15/MTok output\n- **Haiku 3.5** (cloud): ~$0.80/MTok input, $4/MTok output\n- **Local models** (LM Studio): $0 per token\n\nCheck [Token Intel] for live usage metrics and [Models] for model inventory.",
  },
  {
    keywords: ["shield", "scan", "threat", "block", "prompt"],
    response: "Prompt Shield has **163 built-in detections** across 10 categories, plus the starter Shield/DLP policy framework for operator-authored custom rules.\n\nCheck [Prompt Shield] for:\n- Recent blocked threats and scan history\n- Interactive scanner for manual testing\n- Rule statistics and category breakdown",
  },
  {
    keywords: ["agent", "agents", "pentest", "compromised"],
    response: "Agent monitoring is available in:\n\n1. [Agents] — Full registry with status and model assignments\n2. [Workspace] — Agent file viewer with drift detection\n3. [Token Intel] — Per-agent token burn rates\n\nFor compromise investigation, check the Workspace panel for Soul.md drift and Token Intel for unusual burn rates.",
  },
  {
    keywords: ["fleet", "status", "health"],
    response: "Fleet status overview:\n\n1. [Fleet] — Instance health, CPU/memory, posture scores\n2. [Infrastructure] — Service liveness and system resources\n3. [Alerts] — Active incidents\n\nCheck these panels for current operational status.",
  },
  {
    keywords: ["model", "models", "llm"],
    response: "Check [Models] for the full model inventory across every configured provider (OpenClaw Gateway, OpenRouter, Anthropic, OpenAI, LM Studio, local Ollama, etc.). Add or edit providers in [Configuration] → Model Providers.",
  },
  {
    keywords: ["welcome", "wizard", "setup", "first run", "install clawkeeper", "get started", "onboarding"],
    response: `Fresh installs open the Welcome Wizard on [Fleet] with a ${ONBOARDING_STEP_COUNT}-step checklist:\n\n${renderOnboardingStepsMarkdown()}\n\nThe wizard stays until every step is green AND you click Get Started on the Setup Complete screen.`,
  },
  {
    keywords: ["litellm", "restart", "proxy down", "proxy offline"],
    response: "LiteLLM is the scan-everything proxy on port 4001. If it's down:\n\n1. Go to [Infrastructure] and click **Restart** on the LiteLLM row — that calls the restart API directly, no navigation away.\n2. On [Instance Detail] a red LiteLLM badge is clickable and jumps to Infrastructure for you.\n3. If Restart fails, check \`~/sentinel/logs/litellm.log\` and verify provider credentials in [Configuration] → Model Providers.",
  },
  {
    keywords: ["openclaw routing", "openclaw routed", "is openclaw routed", "wire openclaw", "wire litellm", "openclaw bridge", "models.providers.litellm", "openclaw to litellm", "openclaw direct", "openclaw bypass"],
    response: "**OpenClaw → LiteLLM bridge.** For ClawNex's Prompt Shield to scan agent traffic in real time, OpenClaw has to route through the LiteLLM proxy at `http://127.0.0.1:4001/v1`. ClawNex manages this for you (v0.9.3+):\n\n1. **[Configuration] → OpenClaw Routing** card shows the current state — **WIRED** (sidecar present, ClawNex owns the entry), **OPERATOR-OWNED** (manual edit, no ClawNex sidecar), or **NOT WIRED** (OpenClaw is bypassing the shield).\n2. Click **Wire LiteLLM** — ClawNex writes the `models.providers.litellm` entry, records ownership in `~/.clawnex-routing-managed.json`, and auto-restarts the gateway in one click.\n3. Click **Revert ClawNex Wire** to undo cleanly. SHA-256 fingerprints at write time mean operator edits to set-if-missing paths are preserved automatically.\n4. **Restart Gateway** uses the platform-appropriate supervisor (systemd-user on Linux, launchd on macOS) — no SSH.\n5. **View raw sidecar** disclosure shows the audit JSON inline.\n\nWelcome Wizard step 5 invokes the same engine. OAuth-only fleets can skip — those providers can't be proxied; their traffic is still visible retroactively via the Session Watcher.",
  },
  {
    keywords: ["correlation", "attack", "chain"],
    response: "The Correlation Engine detects multi-step attack patterns:\n\n1. **Attack Chain** — Multiple shield BLOCKs from same session\n2. **Token Burn** — Denial-of-wallet detection\n3. **Service Cascade** — Multiple services failing\n4. **Auth Storm** — Brute force attempts\n\nCheck [Correlations] for active patterns.",
  },
  {
    keywords: ["tooltip", "tooltips", "pip", "pips", "cyan dot", "cyan dots", "dotted underline", "tips toggle", "hover help"],
    response: "**Tooltip System** (new in v0.5.4) — hover any stat, badge, column header, or control for contextual help.\n\n**How to spot a tooltiped element:**\n\n- **Dotted cyan underline** on inline text (column headers, badges, labels). Brightens on hover.\n- **Tiny cyan dot** (a \"pip\") in the top-right corner of stat tiles and cards. Fades in with a soft glow on hover.\n\n**Global toggle:** The **TIPS** button in the header (next to the `?` help button) flips the entire system on or off. State persists via `config_defaults.tooltips_enabled`.\n\n**Keyboard access:** Tab to focus an element, same tooltip shows. Escape to dismiss.\n\nIf tooltips aren't appearing at all, check [Infrastructure] Service Logs for hydration errors, or see the Troubleshooting Guide §11.",
  },
  {
    keywords: ["collapse", "collapsible", "collapsed", "expand card", "hide section"],
    response: "**Collapsible Sections** (new in v0.5.4) — four high-density sections can be collapsed to save vertical space:\n\n1. **Recent Shield Events** on [Prompt Shield]\n2. **Live Traffic** on [Traffic Monitor]\n3. **Agents** on [Agents]\n4. **Cost by Agent** on [Token Intel]\n\nClick the chevron on the card header to collapse. The header shows a count pill in the collapsed state so you don't lose track of what's inside. State is per-session — a page reload reopens them.",
  },
  {
    keywords: ["update", "updates", "update available", "update pill", "updates pill", "new version"],
    response: "**UPDATES pill** (in the header, next to the version chip).\n\nClick it to see every source ClawNex tracks:\n\n1. **Clawkeeper** — actionable. Counted in the badge. Click an in-app **Update** button from [Configuration] → Updates → Clawkeeper to clear it.\n2. **OpenClaw** — informational only (INFO tag). ClawNex never installs/updates OpenClaw, so drift is reported but not counted.\n3. **DefenseClaw rules** — informational only (INFO tag). Rules ship bundled with ClawNex releases; they update when you take a new ClawNex release.\n\nThe pill polls every 15 minutes; the **REFRESH** button in the dropdown forces a re-poll. After running an Update from Configuration, the pill updates within seconds (via a `clawnex:updates-refreshed` window event).",
  },
  {
    keywords: ["device identity", "device-identity", "ed25519", "device pairing", "device required", "openclaw 4.12"],
    response: "**OpenClaw 4.12 device-identity handshake.** OpenClaw 4.12+ requires a per-device pairing on top of the bearer token. ClawNex generates an Ed25519 keypair on first connect and persists it in `config_defaults`.\n\nIf the gateway logs `device identity required` or the connector loops on connect/disconnect:\n\n1. Confirm your build is on or after commit `ff77ee9` (2026-05-01) — the handshake landed there.\n2. If the keypair is missing (e.g. DB restored from a pre-4.12 snapshot), run:\n   ```sql\n   DELETE FROM config_defaults WHERE key IN ('openclaw_device_private_key','openclaw_device_public_key');\n   ```\n   then restart ClawNex. The connector regenerates on the next connect.\n3. The handshake is backwards-compatible with OpenClaw 3.28 / 4.10 / 4.11 — those gateways issue a challenge without a nonce and ClawNex skips the device payload.\n\nFull walkthrough: see Troubleshooting Guide §2 Cause G.",
  },
  {
    keywords: ["agent role", "agent roles", "role box", "what is neo", "what is trinity", "what is morpheus", "what is oracle", "agent smith"],
    response: "**Agent ROLE box** on the Agent Workspace tab.\n\nEach agent has a one-line role description so operators don't have to read its IDENTITY.md to tell agents apart. The mapping today:\n\n- **main** — Default OpenClaw operator workspace (pinned to slot 0 with a DEFAULT chip)\n- **neo** — End-to-end investigator and pivot generalist\n- **trinity** — Infiltration specialist — recon and controlled pen-testing\n- **morpheus** — Strategic advisor and orchestration mentor\n- **oracle** — Pattern recognition and longitudinal forecasting\n- **agent-smith** — Adversarial simulation and red-team validation\n\nRoles live in ClawNex source (`src/lib/services/agent-roles.ts` → `KNOWN_AGENT_ROLES`), not `openclaw.json` — the OpenClaw 4.12 identity schema rejects unknown keys. To extend, edit the map and rebuild.",
  },
  {
    keywords: ["seed test correlation", "seed correlation", "fake correlation"],
    response: "**Seed Test Correlation** is gated behind Developer Tools (added 2026-05-01).\n\nThe button only appears when Developer Tools is enabled on this install. To enable: [Configuration] → Developer Tools → type `enable developer tools` exactly. On customer-prod hosts (env kill-switch `CLAWNEX_DEV_TOOLS_DISABLED=1`) the button is hidden entirely and the Correlations panel just reads \"No correlations detected.\"",
  },
  {
    keywords: ["observe", "blocking", "block mode", "shield mode", "shield posture", "would block", "would-block", "are we blocking"],
    response: "**Shield posture** lives in the header status row, left of the count pill (added 2026-05-02).\n\n- **🟡 OBSERVE (amber)** — every request is scanned and logged, but threats are *flagged*, not blocked. Agents continue to receive responses. The count pill at the right end of the row reads **N WOULD-BLOCK** because those rows weren't actually blocked.\n- **🔴 BLOCKING (danger-red)** — threats that score BLOCK are actively rejected before reaching the model. The agent receives an error. The count pill reads **N BLOCKED**.\n\nClick the posture pill (or go to [Configuration] → Shield Settings) to flip the toggle. New installs default to OBSERVE for the first 24-48h while you baseline traffic; flip to BLOCKING once the shield isn't producing false positives on legitimate agent output.",
  },
  {
    keywords: ["help", "what", "how", "can you"],
    response: "I'm the ClawNex AI Assistant. I can help with:\n\n- **Security triage** — Alert priorities, threat assessment\n- **Fleet monitoring** — Agent status, service health\n- **Cost tracking** — Token usage, model costs\n- **Navigation** — I'll point you to the right panel\n\nFor best results, select a local model (Qwen3.5 35B recommended) from the dropdown above.",
  },
];

function keywordFallback(message: string): string {
  const lower = message.toLowerCase();
  for (const entry of KEYWORD_RESPONSES) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.response;
    }
  }
  return `I can help with security operations, fleet monitoring, and alert triage.\n\nFor context-aware responses, select a local model from the dropdown above. The fallback system provides navigation help only.\n\nTry: "What is the highest priority?", "Show shield status", or "Is pentest-agent compromised?"`;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'chat:use');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  try {
    const { message, history, model, provider } = body as {
      message?: string;
      history?: Array<{ role: string; content: string }>;
      model?: string;
      provider?: string;
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'message' field" }, { status: 400 });
    }

    // internal reviewer 2026-05-17 round-4 BLOCKER + operator directive: enforce the
    // scan-equals-forward invariant by rebuilding the forwarded history
    // from a sanitized representation. Allowlist is {role, content} ONLY
    // (no tool_calls, no function_call, no tool_call_id, no name) and
    // entries WITHOUT content are rejected (the prior "role-only marker
    // tolerance" was an attack vector — caller could pass {role:"user",
    // tool_calls:[...]} and the round-4 type check would let it through).
    // Generic error message — no field-naming for recon minimization.
    //
    // The earlier round-4 fix only rejected non-string content, while
    // line 397's splice still forwarded raw history with any sibling
    // fields the caller chose. This commit rebuilds safeHistory from
    // sanitized entries and forwards THAT.
    const sanitizedHistory = sanitizeMessageArray(history, { optional: true });
    if (!sanitizedHistory.ok) {
      return NextResponse.json(
        {
          error: "Unsupported history shape. Each entry must contain exactly { role, content } with role in (system, user, assistant, function, tool) and content as a string.",
        },
        { status: 400 },
      );
    }
    const safeHistory = sanitizedHistory.messages;

    // CRITICAL #5: shield-scan the dashboard chat input. Was completely
    // unscanned — operator-supplied prompts went straight to the LLM with a
    // system prompt loaded with live SOC telemetry (alert counts, agent
    // status, shield stats). Mythos / Garak goal-hijack + prompt-leaking
    // probes had a wide-open exfil channel. Now mirrors /api/v1/chat/completions:
    // scan, honor proxy_block_mode, fail-CLOSED on scanner exception.
    // internal reviewer P1-C 2026-05-14: scan body.history[] too, not just `message`.
    // Earlier fix scanned only the current user message — but `history`
    // gets spliced directly into the LLM context below, so a malicious
    // prompt injected via the chat-history payload bypassed the shield
    // entirely. Scan every history entry's content + the current message
    // under the same block-mode + fail-CLOSED policy.
    const scanTargets: { label: string; text: string }[] = [
      { label: "message", text: message },
    ];
    for (let i = 0; i < safeHistory.length; i++) {
      // safeHistory entries always have string content (sanitizer
      // guarantees it). Empty strings still skipped to keep the
      // scanner from scoring trivial inputs.
      if (safeHistory[i].content.length > 0) {
        scanTargets.push({ label: `history[${i}]`, text: safeHistory[i].content });
      }
    }

    // Hoisted out of the inbound-try block so the LM-Studio + OpenClaw
    // fallback paths below can share the same block_mode policy on their
    // outbound shield wrap (M4-related fix).
    const blockMode = configService.getSetting("proxy_block_mode") || "on";

    try {
      for (const target of scanTargets) {
        const scan = shieldScan(target.text);
        if (scan.verdict === "BLOCK") {
          if (blockMode === "on" || blockMode === "block") {
            return NextResponse.json(
              {
                error: "Message blocked by ClawNex Shield.",
                where: target.label,
                score: scan.score,
                detections: scan.stats,
              },
              { status: 400 },
            );
          }
          console.warn(`[chat] shield BLOCK (monitor-only) at ${target.label}: score=${scan.score} detections=${scan.stats.total}`);
        }
      }
    } catch (err) {
      console.error("[chat] shield scan error — failing CLOSED:", err);
      return NextResponse.json(
        { error: "Shield scanner unavailable. Retry shortly." },
        { status: 503 },
      );
    }

    // Build messages with live context.
    // internal reviewer round-4 BLOCKER: splice safeHistory (rebuilt from sanitized
    // {role, content}) — NOT raw history. Raw history may contain
    // sibling fields the scanner never saw (tool_calls smuggling).
    const systemPrompt = buildSystemPrompt();
    const messages = [
      { role: "system", content: systemPrompt },
      ...safeHistory.slice(-20),
      { role: "user", content: message },
    ];

    // Try LiteLLM proxy first (port 4001) — this ensures traffic is shield-scanned
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const res = await fetch(`http://127.0.0.1:${process.env.LITELLM_PORT || "4001"}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || "openclaw", messages, max_tokens: 2048, temperature: 0.7 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        // Codex 2026-05-17 round 3 #1: this branch returned the LiteLLM
        // response without an outbound shield gate — sibling of the v1
        // route Codex caught in round 1. Same vulnerability class.
        // Fix: scan EVERY assistant-output channel (extractAssistantOutput
        // walks message.content, tool_calls.arguments, function_call,
        // delta, unknown nested fields) and route through the same
        // outbound shield gate the LM Studio + OpenClaw branches use.
        // Defense-in-depth — even though we only return `content` below,
        // an exfil-embedding model could route bytes through tool_calls
        // that future versions of this handler might forward.
        const scanInput = extractAssistantOutput(data);
        const gate = outboundShieldGate(scanInput, blockMode, "litellm:proxy");
        if (!gate.ok) return gate.response;
        const content = data.choices?.[0]?.message?.content || "No response from model.";
        return NextResponse.json({ role: "assistant", content, source: "litellm", model: data.model || model });
      }
      console.warn(`[Chat API] LiteLLM returned ${res.status}, trying direct`);
    } catch (err) {
      console.warn("[Chat API] LiteLLM unreachable:", err instanceof Error ? err.message : "unknown");
    }

    // Route to LM Studio directly if a local model is selected
    if (provider === "lmstudio-fleet" || provider === "lmstudio-main" || provider?.startsWith("provider-")) {
      // Try config DB first, fall back to env config
      let baseUrl: string;
      const dbProvider = configService.getProvider(provider || "");
      if (dbProvider) {
        baseUrl = dbProvider.base_url;
      } else if (provider === "lmstudio-fleet") {
        baseUrl = config.lmstudio.fleet.url;
      } else if (provider === "lmstudio-main") {
        baseUrl = config.lmstudio.main.url;
      } else {
        baseUrl = config.lmstudio.fleet.url; // fallback
      }
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: model || "qwen/qwen3-coder-next", messages, max_tokens: 2048, temperature: 0.7 }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          // Codex round 3 #1 class-sweep: comprehensive extraction across
          // all assistant-output channels for the gate's scan input.
          // `content` is still the canonical user-facing field we return.
          const scanInput = extractAssistantOutput(data);
          const gate = outboundShieldGate(scanInput, blockMode, `lmstudio:${provider}`);
          if (!gate.ok) return gate.response;
          const content = data.choices?.[0]?.message?.content || "No response from model.";
          return NextResponse.json({ role: "assistant", content, source: provider, model: data.model || model });
        }
        console.warn(`[Chat API] LM Studio ${provider} returned ${res.status}, falling back`);
      } catch (err) {
        console.warn(`[Chat API] LM Studio ${provider} unreachable:`, err instanceof Error ? err.message : "unknown");
      }
    }

    // Try OpenClaw gateway HTTP chat completions
    try {
      const gatewayUrl = config.openclaw.url.replace("ws://", "http://").replace("wss://", "https://");
      const completionsUrl = `${gatewayUrl}/v1/chat/completions`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(completionsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.openclaw.token ? { Authorization: `Bearer ${config.openclaw.token}` } : {}),
          "X-OpenClaw-Scopes": "operator.write",
        },
        body: JSON.stringify({ model: "openclaw", messages, max_tokens: 1024, temperature: 0.7 }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        // Codex round 3 #1 class-sweep: comprehensive extraction here too.
        const scanInput = extractAssistantOutput(data);
        const gate = outboundShieldGate(scanInput, blockMode, "openclaw-gateway");
        if (!gate.ok) return gate.response;
        const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || "No response from model.";
        return NextResponse.json({ role: "assistant", content, source: "openclaw", model: data.model || "openclaw" });
      }

      console.warn(`[Chat API] Gateway returned ${res.status}, falling back to keyword matching`);
    } catch (err) {
      console.warn("[Chat API] Gateway unreachable, using keyword fallback:", err instanceof Error ? err.message : "unknown");
    }

    // Fallback: keyword matching
    const fallbackResponse = keywordFallback(message);
    return NextResponse.json({ role: "assistant", content: fallbackResponse, source: "fallback", model: "keyword-matcher" });
  } catch (error) {
    console.error("[Chat API] Error:", error);
    return NextResponse.json({ error: "Internal chat error" }, { status: 500 });
  }
}
