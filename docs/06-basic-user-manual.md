# ClawNex Basic User Manual

**Document ID:** CLAWNEX-USR-001
**Version:** 1.10
**Classification:** For Distribution
**Last Updated:** 2026-05-08
**Product Version:** v0.15.0-alpha (post-merge `main`)
**Status:** Living Document

---

## 0. About This Document

### 0.1 Intended Audience

This manual is written for day-to-day SOC operators with one of the following RBAC roles:

- **Operator** — Monitors traffic, triages alerts, runs shield tests.
- **Security Manager** — All Operator capabilities plus shield rule and whitelist management, break-glass activation.
- **Viewer** — Read-only access to dashboards and reports.

Admin-only workflows (operator lifecycle, RBAC configuration, HTTPS setup, permission management) are documented in the Advanced User Manual (CLAWNEX-USR-002). Administrators SHOULD read both manuals.

### 0.2 Scope

This manual covers: dashboard navigation, shield verdict interpretation, traffic monitoring, alert triage, break-glass procedures, data retention management, and the 10 threat categories ClawNex detects. It does **not** cover: API usage (see CLAWNEX-API-001), infrastructure troubleshooting (see CLAWNEX-OPS-001), or RBAC administration (see CLAWNEX-USR-002).

### 0.3 Accessibility

ClawNex targets WCAG 2.1 Level AA conformance. Every user action described in this manual is reachable with keyboard-only navigation. Interactive elements with hover tooltips also expose their content via `aria-describedby` on focus (`Tab`). The TIPS system can be globally disabled for screen reader users who prefer uninterrupted announcements (section 2.1c). Known accessibility gaps are catalogued in `docs/22-keyboard-shortcuts.md` §1.2.

### 0.4 See Also

- **docs/07-advanced-user-manual.md** (CLAWNEX-USR-002) — Admin workflows, RBAC, APIs.
- **docs/10-api-reference.md** (CLAWNEX-API-001) — REST API endpoints.
- **docs/17-troubleshooting-guide.md** — "Something's broken" recovery procedures.
- **docs/22-keyboard-shortcuts.md** — Complete keyboard and screen-reader reference.

---

## 1. Welcome to ClawNex

ClawNex is your AI Agent Fleet Security Operations Center. It monitors every conversation between your AI agents and their language models, detects threats, and gives you the controls to protect your fleet.

**Tagline:** "One nexus. Total control."

This manual covers the basics — what you see, what it means, and how to use it. For advanced features, refer to the Advanced User Manual (CLAWNEX-USR-002).

---

## 2. Getting Started

### 2.1 Accessing the Dashboard

Open your browser and navigate to:

```
http://127.0.0.1:5001
```

**Access depends on whether RBAC is enabled:**

- **RBAC disabled (default):** The dashboard loads immediately. No login is required — access is restricted to localhost only. This is the backward-compatible behavior.
- **RBAC enabled:** Login is required. On your first visit, a setup wizard walks you through creating the initial admin account. All subsequent visits require authentication. See section 2.1b below for details.

### 2.1a First-Run: The Welcome Wizard (RBAC Disabled)

On a fresh install, **Fleet Command** opens directly into the **Welcome Wizard** — a guided 7-step checklist that gets you from zero to a working ClawNex control layer. The wizard keeps reappearing on every browser refresh until every step is complete AND you click the **Get Started** button on the completion screen, so you can't accidentally click past it.

| Step | What You Do | Where It Takes You |
|------|-------------|--------------------|
| 1. Install ClawNex | Automatic — ticked as soon as the dashboard starts | — |
| 2. Add an AI model provider | Click **Open Configuration** | Configuration → Model Providers (auto-expanded) |
| 3. Enable Host Security | Click **Verify Now** — verifies the bundled scanner is available. Or click **Open Updates panel** for the manual path. | — (or Configuration → Updates) |
| 4. Sync CVE database | Click **Sync Now** — pulls the feed in place | — |
| 5. Sync Model Pricing | Click **Sync Now** — pulls the LiteLLM price snapshot in place | — |
| 6. Configure OpenClaw routing | Click **Wire LiteLLM** — wires the bridge into `openclaw.json` AND auto-restarts `openclaw-gateway` in one click. (Or click the secondary **Open Configuration** link if you want to inspect first.) | — (or Configuration → OpenClaw Routing) |
| 7. Run first shield test | Click **Open Shield Tests** | Prompt Shield |

Every "Open Configuration" button deep-links into the specific card you need — that card auto-expands and scrolls into view so you don't have to hunt for it.

**Setup Complete screen.** When every step is ticked green, the wizard header flips to a green "You're all set!" banner with a single **Get Started →** button. Click it to dismiss the wizard for good — your dismissal is persisted in the database (`config_defaults.wizard_dismissed = 1`), so Fleet Command will load straight into the fleet table on every subsequent visit.

**Hostname-default display name.** On first run, Fleet Command shows your machine's hostname as the client name (e.g. `my-laptop`, `my-laptop.local`). To override it, go to Configuration → UI Preferences → Display Name and enter whatever label you want — leave it blank to revert to hostname.

### 2.1b Getting Started with RBAC

When RBAC is enabled, ClawNex requires authentication before you can access the dashboard. This section covers the operator-facing workflow.

**First visit — Admin setup wizard.** The first time you open ClawNex with RBAC enabled, a setup wizard prompts you to create the initial **Admin** account. Enter a username and a strong password. This account has full control over the platform, including the ability to create and manage other operator accounts.

**Login page.** After the admin account exists, every visit begins at the login page. Enter your **username** and **password**. Check **Remember me** to extend your session across browser restarts.

**Multi-auth providers (v0.9.0+, expanded v0.9.2).** The login page also offers three alternative sign-in methods alongside the password field. All are additive — your password keeps working as a backup whether you use them or not.

- **Sign in with Passkey.** If you have enrolled a passkey on this account (Touch ID, Windows Hello, or a hardware security key), click **Sign in with Passkey**. Your browser will pop up its passkey selector, you confirm with your fingerprint / PIN / device, and you're in — no username field required. Passkeys are phishing-resistant and don't get reused across sites. To enroll a passkey, see *Auth & Devices* in section 9. v0.9.1 made user verification (fingerprint / PIN / face — not just "tap to confirm") mandatory on every passkey ceremony, so a lost-but-unlocked security key can no longer be used without the second factor.
- **Sign in with GitHub.** If your administrator has enabled GitHub OAuth and linked your GitHub account to your ClawNex operator profile, the **Sign in with GitHub** button appears below Passkey. Click it, authorize via GitHub, and you're returned to the dashboard signed in. New GitHub accounts cannot self-register — your admin must link your account first via the *Auth & Devices* card.
- **Email me a magic link (v0.9.2).** If your administrator has enabled Magic Link AND configured a mail provider (Resend / SMTP / Emailit), you'll see an **Email me a magic link** button below GitHub. Click it, enter the email address on your operator profile, and ClawNex emails you a one-shot sign-in link. The link expires in 15 minutes and can be used only once. When the button isn't visible, your admin either hasn't enabled Magic Link or hasn't configured email yet. If you've typed the wrong email, ClawNex won't tell you — you'll get the same "check your inbox" message whether the email matched your profile or not (this is a deliberate privacy defense, not a bug).

**Local password remains your break-glass option.** Even after enrolling a passkey or linking GitHub, your password keeps working — there is no path to lock yourself out by losing a passkey or unlinking GitHub. If you ever lose access to your other methods, sign in with your password and re-enroll.

**Progressive lockout.** To protect against brute-force attempts, ClawNex automatically locks accounts after repeated failed logins:

| Failed Attempts | Lockout Duration |
|----------------|-----------------|
| 5 | 1 minute |
| 10 | 5 minutes |
| 15 | 30 minutes |
| 20 | Account disabled (admin action required to re-enable) |

When your account is locked, the login page shows a message: *"Your account is locked for X minutes due to repeated failed login attempts."* Wait for the lockout to expire, then try again. If your account is disabled, contact your ClawNex administrator.

**Password reset.** If you forget your password, ask your administrator to use the **Password Reset** page (`/reset-password`). The admin enters your username and sets a new temporary password — you can change it after logging in. Admins can also reset their own password from this page if they know their current credentials.

**Operator identity in the header.** Once logged in, the top-right corner of the header shows your **username**, a **role badge** (e.g. "Admin", "Operator"), and a **Logout** button. Click Logout to end your session immediately.

**Header pill row (top-of-screen).** Across the header, you'll see a row of small pills next to the ClawNex logo:

- **Version pill** — current product version (e.g. `v0.9.2`) followed by an **ALPHA** chip while ClawNex is in pre-release.
- **UPDATES pill (added 2026-05-01)** — the always-on update notifier. When everything is up to date the pill reads `UPDATES` in muted text. When one or more updates are actionable, it brightens to the brand colour and shows a count: `1 UPDATE`, `2 UPDATES`, etc. Click it to expand a dropdown listing every source ClawNex tracks (Host Security Scanner, OpenClaw, ClawNex Shield Rules) with installed → latest version, the time of the last check, and a **REFRESH** button. Sources that have an in-app update flow (currently just Host Security Scanner) are counted in the badge; sources without an in-app path (OpenClaw, ClawNex Shield Rules) appear in the dropdown with an `INFO` tag so you can see drift without inflating the count. The **View details →** link jumps straight to Configuration → Updates. Polled every 15 minutes; refreshes immediately after you run an update from the Configuration card.
- **Theme toggle (rewritten 2026-05-01)** — sun (☀) in dark mode, moon (☾) in light mode, rendered as a brand-orange SVG icon at 16px so it's visible against any background. Click to flip themes; your choice persists across reloads.
- **TIPS toggle** — the global on/off switch for the tooltip system (see §2.1c).

**Header status row (under the pill row).** Below the pill row, the header status strip shows live posture facts. As of 2026-05-02 the row reads from left to right:

`N SERVICES · M DOWN · WIRED · OBSERVE|BLOCKING · K CRITICAL ALERTS · J FLEET AGENTS · I BLOCKED|WOULD-BLOCK`

The new **shield posture pill** (between the wire-status chip and the critical-alerts pill) tells you at a glance whether the Prompt Shield is actively rejecting threats or just watching them:

- **🟡 OBSERVE** (amber pill) — every request is scanned and logged, but threats are *flagged*, not blocked. Agents continue to receive responses. Use this to baseline traffic before tightening.
- **🔴 BLOCKING** (danger-red pill) — threats that score BLOCK are actively rejected before reaching the model. The agent receives an error.

**Click the pill to jump to Configuration → Shield Settings** — the card auto-expands so you can flip the toggle in one click.

The count pill at the right end of the row also adapts to mode. In **OBSERVE mode** it reads `N WOULD-BLOCK` (these were *flagged* — they would have been blocked if you'd been in BLOCK mode); in **BLOCKING mode** it reads `N BLOCKED` (these were actually rejected before reaching the model). The label honesty change closes a long-standing operator-confusion case where the row read "SHIELD BLOCKS" regardless of mode.

**Session expiry.** Sessions expire after a configurable timeout period. When your session expires, the dashboard automatically redirects you to the login page. Your administrator can adjust the session timeout in the RBAC configuration settings.

**Roles.** ClawNex defines five roles. Your administrator assigns one role per operator account:

| Role | What You Can Do |
|------|----------------|
| **Admin** | Full platform access — manage users, configure RBAC, change all settings, and perform every action below |
| **Security Manager** | Manage shield rules, whitelist entries, alert triage, and break-glass activation |
| **Operator** | Monitor traffic, acknowledge and investigate alerts, run shield tests |
| **Viewer** | Read-only access to all dashboards and reports — no configuration changes |
| **Auditor** | Read-only access to audit trails, compliance reports, and security logs |

### 2.1c Hovering for Help — The Tooltip System (new in v0.5.4)

ClawNex is a dense dashboard. To help you learn the system without leaving the screen, most stats, column headers, badges, and controls now carry a hover tooltip that explains what the data means, where it comes from, and how to act on it.

**How to tell which elements have tooltips:**

- **Inline text elements** (column headers, badges, labels) have a dotted cyan underline at rest. Hover the element and the underline brightens to full opacity — that's the "I have help" signal.
- **Stat tiles and cards** show a tiny cyan dot in the top-right corner (a "pip"). Hover the tile and the pip brightens with a soft glow. Stats without a pip don't have a tooltip yet.

**Compact vs detail tooltips:** Short one-liners for stat tiles and badges. Longer paragraphs — with concrete file paths, SQL tables, or threshold numbers you can act on — for verdicts, scores, and anything that needs the *why*, not just the *what*. Technical tokens inside tooltips (model names, file paths, rule IDs) render in monospace with a cyan background so you can spot them at a glance.

**Global TIPS toggle.** The header bar next to the `?` help button has a **TIPS** button showing **ON** or **OFF**. Click it to flip the entire tooltip system on or off. Your setting is persisted in `config_defaults.tooltips_enabled` and survives reloads. Turning tooltips off is free — the system adds zero event listeners and zero DOM overhead when disabled, so there's no perf reason to leave them on if you don't want them.

**Keyboard access.** Focus any tooltiped element with `Tab` and the tooltip shows the same way it does on hover. Press `Escape` to dismiss. Screen readers receive the tooltip text via `aria-describedby`.

**Theme-aware.** Tooltips render with a dark-glass substrate in dark mode and a frosted-white substrate in light mode. The cyan accent bar and arrow stay consistent across themes so the visual language doesn't shift when you switch.

### 2.2 What You're Looking At

The dashboard has three areas:

```
+------------+------------------------------------------+
|            |                                          |
|  Sidebar   |         Main Content Area                |
|  (Tabs)    |         (Active Panel)                   |
|            |                                          |
|            |                                          |
|            |                                          |
+------------+------------------------------------------+
```

- **Left sidebar** — Navigation tabs organized into groups. Click any tab to switch views.
- **Context bar** — Directly above the main content area. Contains the global time range selector (1h, 6h, 24h, 7d, 30d), instance filter, client filter, and severity filter. These controls affect **all panels globally** — selecting "1h" filters every panel to show only data from the last hour.
- **Main content** — The active panel. This is where all the action happens. Each panel has a `?` button in its header that opens a contextual help drawer explaining what you're looking at.
- **Help drawer** — Click the `?` button on any panel to open a right-side drawer with the panel description, key metrics explained, available actions, and links to related panels.
- **Guided Tour** — Click the "Tour" button next to `?` to start a guided walkthrough of all 26 panels. Use Prev/Next to navigate through each panel with contextual help.
- **Break-glass banner** — If break-glass mode is active, a red warning banner appears at the top of the content area (see section 8).

### 2.3 Navigation Groups

| Group | What It's For |
|-------|--------------|
| **COMMAND** | Fleet overview and instance management |
| **SECURITY** | Shield scanning, traffic monitoring, security posture |
| **DEFENSE** | Access control lists |
| **ACTIVITY** | Agent sessions, workspaces, token usage |
| **GOVERNANCE** | Tool permissions and security policies |
| **PERFORMANCE** | Model performance and cost metrics |
| **OPERATIONS** | Infrastructure health, alerts and incidents |
| **COMPLIANCE** | Audit trails, executive reports |
| **SYSTEM** | Configuration and settings |

---

## 3. Understanding Shield Verdicts

Every LLM request that flows through ClawNex is scanned by the Prompt Shield. The shield produces a **verdict** — a color-coded decision:

| Verdict | Color | Meaning | What Happens |
|---------|-------|---------|-------------|
| **ALLOW** | Green | No threats detected | Request proceeds normally |
| **REVIEW** | Yellow/Amber | Suspicious content detected (score 25-59) | Request proceeds but is flagged for review |
| **BLOCK** | Red | Threat detected (score 60+ or CRITICAL rule) | Request is blocked if Shield Block Mode is ON. Logged either way. |
| **BYPASSED** | Grey | Break-glass mode is active | Request proceeds without scanning |

### 3.1 Threat Score

Every scan produces a score from 0 to 100:

| Score Range | Meaning |
|------------|---------|
| 0 | Clean — no rules triggered |
| 1–24 | Low risk — minor pattern matches |
| 25–59 | Medium risk — suspicious content (REVIEW) |
| 60–100 | High risk — threat detected (BLOCK) |

### 3.2 Shield Modes

ClawNex has two shield modes, controlled from the Configuration tab:

| Mode | Behavior |
|------|----------|
| **OBSERVE** (default) | All traffic is scanned and logged. Threats are detected and flagged but NOT blocked. Agents can still send any request. |
| **BLOCK** | Threats that score BLOCK are actively rejected. The request never reaches the AI model. The agent receives an error message. |

**Recommendation:** Start in OBSERVE mode. Review the traffic for a few days to understand what your agents are sending. When you're confident the shield isn't producing false positives on your legitimate traffic, switch to BLOCK mode.

---

## 4. Key Tabs — What They Show

### 4.1 Traffic Monitor (SECURITY group)

This is your primary operational view. It shows every LLM request in real time.

**What you see:**
- **Shield Status** — Current mode (OBSERVE or BLOCK), read-only
- **Session Watcher** — Status of the background log scanner (RUNNING/STOPPED, files watched, messages scanned)
- **Traffic table** — Every request with: time, source, model, provider, verdict, score, latency, tokens, HTTP status
- **Filters** — Filter by source, model, provider, verdict, or minimum score

**Source types in the traffic table:**

| Source | What It Means |
|--------|--------------|
| `litellm` | Live traffic through the LiteLLM proxy (real-time) |
| `session-watcher` | Historical traffic scanned from session log files (retroactive) |
| `break-glass` | Traffic that bypassed the shield during a break-glass window |

**Auto-refresh:** The traffic table updates every 5 seconds automatically.

### 4.2 Prompt Shield (SECURITY group)

This tab lets you manually test the shield and manage the rule whitelist.

**Live Input Scanner:**
- Paste any text and click "Analyze" to see what the shield detects
- Try the "Load Demo Payload" button to see what a real attack looks like
- Results show the verdict, score, and every rule that triggered with severity and confidence

**Rule Whitelist:**
- Click "Manage" to expand the full list of 163 rules
- Toggle rules on/off to whitelist them for internal traffic
- Whitelisted rules are skipped when scanning your agents' system prompts (which legitimately reference files like SOUL.md)
- Dashboard scans (manual testing) always run all rules regardless of whitelist

### 4.3 Alerts & Incidents (OPERATIONS group)

Card-based incident board. Each alert is a collapsible card:

- **Collapsed view:** Severity badge + title + age timer + status pill — scan the list quickly
- **Expanded view (click to open):** Description, source, instance, ACK/Resolve buttons, and backlink to the originating panel

**Alert severities (shown as colored left border):**

| Severity | Color | Meaning |
|----------|-------|---------|
| CRITICAL | Red | Immediate attention required (BLOCK verdict, break-glass activation, service failure) |
| HIGH | Orange | Significant threat or operational event |
| MEDIUM | Yellow | Moderate concern |
| LOW | Blue | Informational |

**Backlinks:** Each alert card links back to its source — correlation alerts link to the Correlations tab (e.g., "Attack Chain →"), shield alerts link to Prompt Shield, session-watcher alerts link to Traffic Monitor.

**Alert lifecycle:**
1. **OPEN** — New alert, needs attention
2. **ACKNOWLEDGED** — Someone is looking at it (click ACK)
3. **INVESTIGATING** — Active investigation
4. **MITIGATED** — Threat contained
5. **RESOLVED** — Issue resolved (click Resolve)
6. **FALSE POSITIVE** — Not a real threat

### 4.4 Audit & Evidence (COMPLIANCE group)

Every action on the platform is recorded here — shield scans, blocks, configuration changes, break-glass activations, alert acknowledgments. This is your compliance evidence trail.

**What gets logged:**
- Every shield block and review
- Block mode changes
- Break-glass activations and deactivations
- Whitelist changes
- Retention setting changes
- Configuration changes

**Time range:** Audit data respects the global context bar time range (1h/6h/24h/7d/30d). To see older audit entries, widen the time range from the context bar.

**This log is append-only.** Entries cannot be modified or deleted through the application.

**View Evidence backlink (v0.11.1+, deep-link refined v0.11.2).** Every Session Shield alert in **Alerts & Incidents** now exposes a `View Evidence →` button. Clicking it deep-links to this Audit & Evidence tab with the exact triggering audit row pre-selected and scrolled into view. Filters that would have hidden the row are cleared, the page is reset to 0, and a smooth scroll lands the operator on the detail card. If the focused row falls outside your current time window, the panel surfaces a "NOT IN WINDOW" notice with widen-the-filter guidance — widen the context-bar time range and the row appears.

The structured detail surfaces the rule_key + matched sample (scanner-redacted, e.g. `+1-555-XXX-XXXX`) + a match-centered ±200-character window of the redacted payload. Use this to confirm the alert fired on a real event without cross-referencing JSONL files by hand.

### 4.4a Token & Cost Intel (ACTIVITY group, expanded in v0.11.0+)

This is your FinOps surface — multi-source LLM cost telemetry from OpenClaw (your local agent fleet's JSONL session files), Hermes (channel-grain spend from `~/.hermes/state.db`), and Paperclip (finance-event grain via HTTP). The tab normalizes everything to one canonical row shape with explicit trust labels so you can tell at a glance what's a recompute, what came from the source, and what's a known-zero subscription line.

**Headline + per-source totals.** The top of the tab shows a "Highest reported monitored spend" headline tile naming the **single source** with the biggest number, plus a per-source totals row underneath. We deliberately don't sum across sources — the same call can appear in multiple sources (e.g. OpenClaw routes through LiteLLM and Paperclip records the same finance event), and summing would double-count. Look at the per-source row when you want the picture; look at the headline when you want a single number.

**Cost trust labels.** Every row in every table carries one of six labels — these are defined in plain English in the **Glossary** section of Help (§10A or open the Help tab). Quick reference:
- **Estimated** — cost the source itself reported pre-settlement (Paperclip estimated=true, Hermes 'estimated' status).
- **Actual** — provider-reported or operator-reconciled, money that hit the wallet. v1 reserves this for source-native flags only — most rows do NOT show "actual" because it requires per-adapter audit (deferred to v1.1).
- **Recomputed** — ClawNex's pricing service multiplied token count × pinned rate-card snapshot. Defensible local recompute, not the provider's invoice. Most rows in v1 lead with this label.
- **Included / no marginal spend** — source-native subscription marker (e.g. Codex-via-ChatGPT). The call was made, but the operator's wallet wasn't charged.
- **Token-only** — token counts are trustworthy but no usable price exists for the model. Cost cell renders `—` rather than a misleading $0.
- **Cost unknown** — insufficient data; surfaces `—`.

**Drain Signals card.** Five lightweight detectors flag spend patterns that are usually fixable:
- **Possible repeated-call loop** — multiple near-identical calls in a short window.
- **Spend velocity spike** — current-hour spend > 4× the trimmed-mean baseline (requires ≥24 hourly buckets of history).
- **Context bloat risk** — last-5-avg input_tokens > 2× first-5-avg within a session (≥10 rows required).
- **Cache hit drop / Cache hit drop risk** — cache-read ratio fell ≥30% vs trailing average (≥3 days history).
- **Simple task on expensive model** — strict zero-tool-call gate + small input + small output + model rate >$5/Mtok.

Click any signal counter row to filter Recent Token Events down to the affected source/window. The filter pill above Recent Events shows what's filtering — click ✕ to clear. The signal row also expands inline with up to 3 sample affected rows so you can confirm the pattern without leaving the card.

**Click-to-filter UX (v0.11.0+).** SignalsCard counter rows are native buttons with a `:focus-visible` outline. Tab + Enter activates the same way the mouse does. The active filter remembers across collapsing/expanding the table.

**Pagination on long tables.** Cost By Session, Recent Token Events, and every Models & Cost sub-card now paginate with prev `‹` / next `›` buttons. Default page size is 5 (changed from 10 in v0.11.0); options are 5, 10, 15, 25, 50.

**Hide delivery-mirror toggle.** OpenClaw routes go through LiteLLM, which mirrors them as a delivery-side row. By default we show both (so you see what's happening on the wire). Click "Hide delivery-mirror" in the header to collapse the duplicates and read only the agent-side rows.

**Instance dropdown.** Pick `hermes-local` to show only Hermes data; pick a specific OpenClaw instance to show only that fleet's rows. The dropdown is honored end-to-end across the orchestrator path (was silently ignored before v0.11.0).

**Metric Aggregation TOTAL column dropped (v0.11.0).** Point-in-time snapshot metrics shouldn't be summed across windows — a "TOTAL" column produced mathematically meaningless numbers. The column is gone; per-window numbers stay.

### 4.5 Infrastructure (OPERATIONS group)

This tab shows the health of all ClawNex services at a glance.

**Service health states:**

| State | Color | Meaning | Click Behavior |
|-------|-------|---------|----------------|
| **ONLINE** | Green | Service is healthy and responding normally | — |
| **DEGRADED** | Amber | Service is responding but with issues (high latency, partial failure) | Hover for detail; use inline Restart on LiteLLM |
| **OFFLINE** | Red | Service is not responding | Hover for detail; use inline Restart on LiteLLM |
| **NOT_CONFIGURED** | Blue | Service hasn't been set up yet | Click the row to jump to Configuration |

**LiteLLM Restart.** If LiteLLM is DEGRADED or OFFLINE, click the **Restart** button on its row. The API is called in place — you won't be bounced away from Infrastructure. The button displays "Restarting..." while it works, then "Restarted ✓" on success (auto-reverts after 4 seconds). Only **NOT_CONFIGURED** rows navigate to Configuration when clicked; offline/degraded rows stay where they are so the Restart action wins.

**Quick LiteLLM restart from anywhere.** When LiteLLM is red, the LiteLLM Proxy badge on **Instance Detail → Services** becomes clickable and jumps straight to Infrastructure, so you can restart without hunting for the tab.

### 4.6 Configuration (SYSTEM group)

This is where you manage platform settings. Every setting lives in a collapsible card. Cards can be deep-linked from elsewhere in the dashboard (e.g. the Welcome Wizard) — when you arrive via a deep link, the target card auto-expands and scrolls into view.

**Sticky collapse (added 2026-05-01).** Inside the larger cards (Fleet Connectors, Updates, OpenClaw Routing) every subsection remembers whether you left it open or collapsed. The state is persisted in `localStorage` so subsections stay the way you set them across reloads. Operators who only ever look at one connector no longer have to re-scroll past the others on every page load.

**UI Preferences:**
- **Display Name** — Override the client name shown on Fleet Command and Instance Detail. Leave blank to use the machine's hostname (`os.hostname()`).
- Theme (light/dark), AI Panel default, and other display options.

**Updates:**
- **ClawNex Shield Rules** — Reports the bundled rule pack version and last-modified date. The rules ship inside the ClawNex release tarball; there is no separate in-app updater because pulling rules from GitHub on a running install would skip code-review for new patterns. The card surfaces the bundled state for awareness only — to refresh rules, take the next ClawNex release.
- **Host Security Scanner** — The scanner is bundled with ClawNex. The **Verify** button checks that the bundled scanner is present on this host; scanner updates arrive through ClawNex releases, not a runtime download. After checking updates, the header **UPDATES pill** refreshes immediately (it listens for the `clawnex:updates-refreshed` window event and re-polls without waiting for the 15-minute schedule).
- **OpenClaw** — Reports installed and latest versions with a link to the release notes. OpenClaw is treated as informational only — ClawNex never installs, updates, or modifies an OpenClaw install (the "never touch OpenClaw" rule). The header pill flags drift but doesn't count it toward the actionable badge total.

**About the Update detection (2026-05-01 fix).** Host Security scanner drift is now detected by comparing the binary's modification time against the latest GitHub release timestamp, not by string-comparing the version label. The previous behaviour ("installed (2026-05-01)" vs `0.1.0`) was permanently treating fresh installs as out-of-date.

**Policies & Rules:**

A **policy** is a named collection of detection **rules** the shield runs on inbound prompts and outbound responses. Each rule has a pattern, a direction, a severity, and an action. The card lists every active policy with a rule count, source badge, and lifecycle badge.

ClawNex ships two starter packs:

- **ClawNex Default** (`CURATED` / `STARTER`) — a 163-rule operator-visible mirror of the inbound jailbreak, cognitive-tampering, secret, and path detections the shield has always run. The mirror lets you audit *what* ClawNex is checking; the wire reads from source-of-truth in v1, so editing a mirror rule has no effect (Edit and Delete are disabled with a tooltip).
- **Generic Egress Starter** (`SYSTEM` / `STARTER`) — **12 enabled outbound starter rules** running on the wire, covering email, phone, SSN, credit card, IPv4, date of birth, passport, private key material, password assignment, env var leak, internal IP, and database URI. These **run on the wire** — disable the policy and outbound DLP detection turns off. **2 additional `LAB`-badged held drafts** (`JAIL-CREDENTIAL-EXTRACTION-REQUEST` and `OUT-GENERIC-API-KEY-SHAPE`) are visible in the policy listing but ship `enabled=0`; they're corpus-validated but not yet field-proven. You see them and can read the pattern; to put one on the wire, clone/copy the pattern into a custom policy after review (vendor rules themselves can't be edited or enabled in place — clone-then-customize is the path).

**Enabling and disabling a starter pack.** Each row has an enabled checkbox. Custom policies toggle on one click. Vendor-shipped policies (CURATED and SYSTEM) are guarded: clicking the checkbox opens a modal that requires you to type a verbatim phrase (e.g. `disable clawnex default protection`) plus a reason of at least 10 characters. The reason is audit-logged; the phrase itself is not (every operator types the same one). Re-enabling is one click.

**Authoring a custom policy.** Click `[+ Add Policy]`, give it a name and optional description — the policy is created at `source = custom`, `lifecycle = custom`, enabled by default. Expand the new row, click `[+ Add Rule]`, and fill out the modal. The rule key auto-slugifies from the name (e.g. `Customer Account ID` → `CUSTOMER-ACCOUNT-ID`) and is what shows up in detection records, audit logs, and the AI chat panel. **Pattern Type** defaults to **Literal** — case-insensitive substring matching that cannot cause performance problems. **Regex (Advanced)** unlocks a regex input with an inline warning; pick it only when you genuinely need character classes, alternation, or anchors. Regex patterns pass a save-time safety gate plus a 1024-char length cap, and any rule that hits the runtime iteration cap five scans in a row is auto-disabled with an alert. Direction is inbound/outbound/both; severity is CRITICAL/HIGH/MEDIUM/LOW. **Exceptions** is one literal substring per line — if any exception appears anywhere in the matched text the detection is suppressed (audit-logged); useful for sandbox markers and known benign patterns.

The five **actions** in plain English: **Score** (default) feeds the threat score and lets the verdict come out of the total. **Block on match** forces the verdict to BLOCK regardless of score. **Review on match** floors the verdict at REVIEW so the request lands in the queue. **Redact match in output** replaces the matched text with `[REDACTED:RULE_KEY]` in the cleaned response and still records the detection so the event is visible. **Allow** drops *this rule's* detection only with a `rule_match_suppressed` audit event — it is not a global whitelist; other rules still fire. The `[Test Pattern]` button (Admin and Security Manager only) lets you paste sample text and see which rules match before saving.

**The header warning ribbon.** Disable ClawNex Default OR Generic Egress Starter and an amber ribbon appears across every dashboard tab naming which policy is off and which detection family is therefore disabled. To recover, open Configuration → Policies & Rules and click the row's checkbox; the ribbon clears immediately and a re-enable event lands in the audit log.

**OpenClaw Routing:**
- Shows each provider's routing status: **ROUTED** (traffic flows through LiteLLM proxy for scanning) or **DIRECT** (traffic bypasses ClawNex).
- **ClawNex-Managed Routing block** (added 2026-04-29) lets you wire / revert / restart from the dashboard:
  - **Wire LiteLLM** — adds a `models.providers.litellm` entry to `~/.openclaw/openclaw.json` pointing at `http://127.0.0.1:4001/v1` so OpenClaw's traffic flows through the ClawNex shield. Also sets `agents.defaults.model.primary` to `litellm/auto` if it was unset (won't clobber an operator's pinned default). Records ownership in a sidecar at `~/.clawnex-routing-managed.json`.
  - **Revert ClawNex Wire** — undoes the wire. Operator edits made after the wire to `set-if-missing` paths (like `agents.defaults.model.primary`) are preserved automatically; the engine SHA-256 fingerprints values at write time and refuses to remove a value that was changed externally.
  - **Force Wire (overwrite)** — surfaced when a `models.providers.litellm` entry exists but ClawNex doesn't have a sidecar (operator-owned or stale). Overwrites with ClawNex's canonical values and starts tracking ownership.
  - **Restart Gateway** — restarts the long-running `openclaw-gateway` daemon so it picks up the new routing without an SSH trip. Tooltipped with the auto-detected supervisor (e.g. `systemd user unit (owner: <operator-user>)` on Linux, `launchd Aqua session` on macOS). On unsupported hosts the button is replaced with a copy-paste manual command.
  - **View raw sidecar** — `<details>` disclosure showing the full `~/.clawnex-routing-managed.json` JSON inline. Lets you audit every path ClawNex is tracking and the SHA-256 fingerprint of each value without SSH.
  - Result panel below the buttons surfaces the engine's status (wired / already-wired / reverted / conflict / restarted) plus supervisor + elapsed ms and any preserved-paths the revert kept in place.
- On a fresh install where `openclaw.json` is present but has no LLM providers registered yet, you'll see a friendly blue info box instead of an error.
- If `openclaw.json` truly can't be read, an amber warning explains it.

**Shield Settings:**
- **Shield Block Mode** — Toggle between OBSERVE and BLOCK.
- **Routing Table** — Shows which models route to which providers.

**Break-Glass Mode:**
- Emergency bypass button (see section 8)

**Data Retention:**
- Configure how long each type of data is kept (see section 7)

**Model Providers:**
- Manage LLM provider connections — supports 15 provider types (LM Studio, OpenRouter, OpenAI, Anthropic, Azure OpenAI, Google Vertex, AWS Bedrock, Mistral, Groq, Together AI, Fireworks, Replicate, Ollama, HuggingFace, Custom/Other).
- Configure model settings (context window, capabilities).

**OpenClaw Gateway Instances:**
- Manage OpenClaw gateway connections.
- **Gateway Token** — Update the gateway authentication token directly from the UI. After saving a new token, the gateway reconnects automatically. The token is auto-pulled from `~/.openclaw/openclaw.json` on first run.

**Scheduled Reports:**
- **What it does:** Automatically generates and emails security reports on a recurring schedule — no need to manually pull reports.
- **How to enable:** In the Scheduled Reports card, click **Add Schedule**. Choose a frequency (Daily, Weekly, or Monthly), enter a delivery email address, and click Save.
- **Toggle on/off:** Each schedule has an enable/disable toggle. Turn a schedule off temporarily without deleting it — your settings are preserved.
- **Report content:** Uses the Executive Reports suite (12 report types) — the scheduled report includes all available report types for the period.

**Custom Correlation Rules:**
- **What it does:** Lets you define your own threat-detection patterns beyond the built-in correlation rules — useful for detecting behavior specific to your environment.
- **How to create a rule:** In the Correlation Rules card, click **New Rule**. Give it a name and description. Add one or more **conditions** (each with a source, severity, or verdict criterion and a weight). Set a **threshold** — the sum of weights of matching conditions must equal or exceed this number to trigger the rule. Set a **time window** (how many minutes of events to look back). Click Save.
- **Example:** A rule with conditions "verdict=BLOCK (weight 3)" and "source=session-watcher (weight 2)", threshold 3, window 10 minutes — triggers when any BLOCK verdict appears in the last 10 minutes.
- **When a rule fires:** It creates a correlation event and an alert, just like built-in rules.

**HTTPS / Caddy:**
- **What it does:** Enables HTTPS for your ClawNex dashboard using Caddy as a reverse proxy with automatic certificate management.
- **How to enable:** In the HTTPS card, enter your domain name and click **Generate Caddyfile**. Then click **Start Caddy**. Caddy requests a certificate automatically via Let's Encrypt — no manual cert management needed.
- **Certificate status:** The card displays the current status (Active, Pending, Error), certificate expiry date, and the domain it covers.
- **Requirements:** The `caddy` binary must be installed on the host (`brew install caddy` on macOS). The domain must point to your server's public IP. Port 80 and 443 must be open for ACME challenge.
- **On dev/local installs:** HTTPS is optional. If Caddy isn't installed, the card shows a "Caddy not found" message but everything else continues to work normally over HTTP on port 5001.

**Developer Tools (v0.9.3+):**
- **What it does:** Lets you seed and reset simulated traffic (alerts + shield scans) directly from the dashboard so you can demo the platform or rehearse incident response without a shell.
- **How to enable:** First-time use shows an "Enable Developer Tools" form. Type the verbatim phrase `enable developer tools` and click Enable. The full UI appears (Seed, Reset per run, Reset All Simulation).
- **Two seed modes:**
  - **Mode A (default, safe):** Click **Seed Traffic** with the checkbox unchecked. Rows tag `origin: simulation` and are **excluded** from production-grade counters by default. Use this for sanity-checking that simulation data flows through the right code paths without polluting Fleet/header counters.
  - **Mode B (visible to default counters):** Check the **"Make simulation visible in default dashboard counters"** box. A second typed-phrase confirm appears — type `light up default counters` exactly. Then click **Seed Traffic (Mode B)**. Rows tag `origin: production` (still with `simulation: true` metadata) so Fleet/header/Shield default counters light up. Use this for M-01 video recording, sales demos, and operator-onboarding walkthroughs where the dashboard must look populated under known synthetic load. **For local / QA / disposable demo / controlled recording only — never on customer-production data.**
- **Run-ID and profile:** Run-IDs are auto-generated (format `qa-YYYY-MM-DD-HH-MM-SS` for Mode A, `mode-b-qa-YYYY-MM-DD-HH-MM-SS` for Mode B). Profile dropdown picks load level (`quiet`, `standard`, `intense`). Each click stacks a new run.
- **Resetting:** Each active run has its own **Reset** button — works the same for Mode A and Mode B (reset scopes by simulation metadata, not by origin, so Mode B rows are precisely removable). **Reset All Simulation** (two-step confirm) sweeps every fixture row regardless of mode or run-id. Real production rows (no simulation tag) are never matched.
- **Per-run badges:** Mode B runs show an amber **LIT** badge in the active-runs list so you can tell at a glance which runs are polluting default counters.
- **Active-runs ribbon:** When at least one simulation run is active, a strip appears at the top of every dashboard tab — amber for Mode A only, **escalating to danger-red when any Mode B run is active**. Click it to land directly on this card.
- **Customer-prod installs:** The Developer Tools card is hidden entirely on installs where the env kill-switch (`CLAWNEX_DEV_TOOLS_DISABLED=1`) is set. The `/api/dev/*` endpoints return 404 in that posture so the feature's existence is not leaked.

---

## 4.7 Trust Audit (SECURITY group)

The Trust Audit panel identifies security boundaries in your environment where agents interact with external systems, and surfaces vulnerabilities or misconfigurations at those boundaries.

**What it shows:**

| View | What You See |
|------|-------------|
| **Findings** | Individual violations with severity (CRITICAL / HIGH / MEDIUM / LOW), description, affected boundary, and remediation guidance |
| **Matrix** | Grid showing which trust boundaries are covered by which of the 15 audit rules — green = pass, red = fail, grey = not applicable |
| **Surfaces** | All detected trust boundaries (e.g., agent→LLM provider, agent→filesystem, agent→network) with type, status, and risk level |
| **Remediation** | Tracked status for each finding: Open, In Progress, Resolved, or Accepted Risk |

**How to trigger a discovery run:**
1. Click the **Discover** button in the Trust Audit panel header
2. The engine scans your environment (checks agent configurations, network rules, credential exposure, data flow paths)
3. Results appear in real time — new findings are added or updated without a page refresh
4. Discovery also runs automatically on a configurable schedule

**Acting on findings:**
- Click any finding row to expand its full description and remediation steps
- Change the status (e.g., "In Progress" when you're working the fix, "Resolved" when done, "Accepted Risk" for known exceptions)
- Resolved and accepted-risk findings are still visible but de-emphasized — your history is preserved

---

## 4.8 Mission Control & the Triage Graph (v0.12.0+, completed v0.14.5)

Mission Control is the operator cockpit — it's the tab the Welcome Wizard's **Get Started →** lands on after setup. It's a six-KPI overview row, an Operational Posture row, and a Top Action Queue showing what most needs your attention right now. Beneath each queue row is the **Triage Graph** — a 5-stage drill-down that builds the answer to "what is this, and what should I do?" in one card without you having to open three other panels.

**The KPI row.** Six tiles: Active Incidents, Evidence Confidence, Shield Activity, Cost Risk, Collector Health, Policy Coverage. Each tile shows a headline number, a status pill (e.g. `10 OPEN`, `EXACT`, `LIVE`), up to 3 breakdown rows, a stacked-bar visual, and a footer with the freshness timestamp. Click any tile to navigate to the source panel pre-filtered. Tiles read as elevated panels — slightly raised against the page surface, with a stronger cyan border on hover (v0.14.5).

**Operational Posture.** Five rows beneath the KPI tiles: Shield Policy Coverage, Evidence Quality, Incident Hygiene, Source Freshness, Cost Discipline. Each row shows a current 0–100 score, the 7-day rolling average, the target threshold, and a color accent (green ≥ target, warn < target, danger far below). Hover for the score's formula — Mission Control deliberately exposes the math so the score is never magic.

**The Top Action Queue.** Prioritized table of issues. Severity pill (CRIT / HIGH / MED / WARN / LOW), title, source family, evidence-confidence pill, age, and a structured **Suggested Action** in `Verb · target` form (e.g. `Diagnose · OpenClaw Gateway adapter`, `Restrict capability · Exec/Write`). The verb is one of 11 canonical values; ClawNex enforces this at the type system AND at verifier time so the queue can never drift into vague phrases like "Take action" or "Click here."

The queue collapses repeats — three rows with the same Exec+Write combo across agents become one grouped row with an `×3` cyan count chip. Toggle Group / Raw with the header switch (persists per browser session). Filter chips above the queue let you scope by severity (multi-select OR) and family (multi-select OR). Suppress noisy `incidentType` rows with the `⊘ suppress` link — a header pill keeps the suppression visible and reversible. Hover any severity pill to see the score rationale ("Score 125 = CRIT 100 + recent 10 + exact 15") in the same weights the queue uses for ordering.

**The Triage Graph.** Click `Investigate ▸` on any queue row and the Triage Graph card opens inline. It renders the same canonical 5-stage flow regardless of source:

1. **Evidence** — what was observed. For alert-derived rows you can hit `▶ Show match span` to see a server-side-redacted snippet (`…before … <mark>match</mark> after…`); for trust-audit rows you can hit `▶ Show evidence trail` to see the rule's short observations. Cost-signal and collector-health rows skip the toggle — those evidence stages are statistical or probe metadata, fully shown.
2. **Source Event** — the upstream event that produced the evidence (a session ID, a CVE record, a correlation rule fire, etc.). Often deep-links to Audit & Evidence or the source panel.
3. **Affected Object** — the principal at risk: agent, session, route, capability, package, etc.
4. **Related Activity** — recent context that might matter (recent traffic, related findings, the agent's tool grants).
5. **Fix / Control** — the recommended remediation in operator-readable prose. The longer narrative lives here so the queue row stays a one-line `Verb · target`.

As of v0.14.5, all 9 source families have a per-source resolver: alert / cost-signal / collector-health / trust-audit / correlation / blast-radius / auth-rbac / update-cve / policy-warning. Pre-v0.14.5 only the first 4 dispatched; the other 5 fell back to a generic resolver. After v0.14.5, every queue row drills into source-aware stage copy. Toggle state persists per artifact in `sessionStorage` so triaging multiple alerts doesn't re-collapse the snippet on each one.

**Setup banner.** On a fresh install where the wizard hasn't been dismissed, Mission Control shows a warn-tinted banner at the top: *"Tiles below show 0 because nothing has been observed yet — not because everything is clear."* Primary CTA navigates to Fleet Command (where the wizard lives). The sidebar nav item also shows a small warn-tinted setup-pending dot until the wizard is dismissed. Demo mode hides both.

---

## 5. Reading the Traffic Table

Each row in the Traffic Monitor represents one LLM request. Here's what the columns mean:

| Column | Meaning |
|--------|---------|
| **TIME** | When the request was processed |
| **SOURCE** | Where the traffic came from (litellm, session-watcher, break-glass) |
| **MODEL** | Which AI model was requested (e.g., qwen/qwen3.5-35b-a3b) |
| **PROVIDER** | Which backend served the request (e.g., lmstudio) |
| **VERDICT** | Shield decision — ALLOW (green), REVIEW (yellow), BLOCK (red), BYPASSED (grey) |
| **SCORE** | Threat score 0–100. Higher = more suspicious |
| **LATENCY** | How long the request took (milliseconds) |
| **TOKENS** | Total tokens used (input + output) |
| **STATUS** | HTTP status code (200 = success, 403 = blocked) |

**Tips:**
- Sort by SCORE descending to find the most suspicious requests
- Filter by VERDICT = BLOCK to see what's being caught
- Filter by SOURCE = session-watcher to see historical analysis
- A score of 0 with verdict ALLOW is perfectly normal — most legitimate traffic scores 0

---

## 6. Managing Alerts

### 6.1 Responding to an Alert

1. Go to the **Alerts & Incidents** tab
2. Review open alerts — CRITICAL and HIGH should be addressed first
3. Click an alert to see details (detection rules that fired, samples, score)
4. **Acknowledge** it to indicate you're aware
5. **Investigate** if needed — check the Traffic Monitor for related requests
6. **Resolve** when the issue is handled, or mark as **False Positive** if it wasn't a real threat

### 6.2 Common Alert Types

| Alert | What It Means | What To Do |
|-------|--------------|------------|
| "Shield BLOCK: [rule name]" | A request was blocked by the shield | Review the detection. If it's a false positive, consider whitelisting the rule. |
| "Shield REVIEW: [rule name]" | Suspicious content detected | Check the traffic entry. May need investigation. |
| "Watchdog: Dashboard recovered" | The dashboard crashed and was auto-restarted | Check logs at `logs/watchdog.log`. Usually transient. |
| "Watchdog: LiteLLM recovered" | LiteLLM crashed and was auto-restarted | Check logs. If recurring, investigate the model provider. |
| "Break-Glass Activated" | Someone activated emergency bypass | Verify it was authorized. All traffic during the window is unscanned. |
| "Break-Glass Expired/Deactivated" | Emergency bypass ended | Review the unscanned traffic count. Consider retroactive analysis. |

---

## 7. Data Retention

ClawNex automatically cleans up old data to prevent the database from growing indefinitely. You can configure how long each type of data is kept.

**Go to:** Configuration tab → Data Retention card

| Category | What It Contains | Default | Options |
|----------|-----------------|---------|---------|
| Traffic Logs | LLM request/response records, shield scan results | 3 days | 1d, 3d, 7d, 14d, 30d, 90d |
| System Metrics | CPU, memory, disk snapshots | 3 days | 1d, 3d, 7d, 14d, 30d, 90d |
| Correlations | Event pattern matches | 3 days | 1d, 3d, 7d, 14d, 30d, 90d |
| Alerts & Incidents | Security alerts and correlated incidents | 90 days | 30d, 90d, 180d, 365d |
| Audit Trail | Immutable action log | 365 days | 90d, 180d, 365d, Unlimited |

**Important:** The audit trail is your compliance evidence. For SOC 2 or similar frameworks, consider setting it to 365 days or Unlimited.

**How it works:** Cleanup runs automatically on startup and once per hour. When you change a setting, it takes effect on the next cleanup cycle.

---

## 8. Break-Glass Mode

Break-glass is an emergency procedure that temporarily bypasses the shield. Use it only when the LiteLLM proxy is down and your agents need to keep working.

**This is a big deal.** When break-glass is active, no traffic is scanned. Any prompt — including malicious ones — goes straight through to the model.

### 8.1 When to Use It

- LiteLLM crashed and the watchdog can't restart it
- You're in a client demo and can't afford downtime
- A critical business process depends on agent availability

### 8.2 How to Activate

1. Go to **Configuration** tab
2. Scroll to **Break-Glass Mode** section
3. Click the **BREAK-GLASS** button
4. In the dialog:
   - Enter a reason (minimum 10 characters) — explain why you need it
   - Select a duration (15 minutes to 4 hours maximum)
   - Type **CONFIRM** (case-sensitive) in the confirmation field
   - Click **Activate Break-Glass**

### 8.3 What Happens When Active

- A **red warning banner** appears at the top of every tab with a countdown timer
- A **CRITICAL alert** is generated
- All LLM traffic bypasses the shield entirely
- Traffic is still logged with verdict "BYPASSED" so you know what went through
- The audit trail records the activation with your reason

### 8.4 How It Ends

Break-glass ends in one of two ways:
1. **Timer expires** — automatically reverts to normal operation
2. **You click "Deactivate Now"** on the banner — manually ends it early

After deactivation, there is a **15-minute cool-down** before you can activate it again. This prevents rapid on/off toggling.

### 8.5 After Break-Glass

After break-glass ends, review:
- How many requests went through unscanned (shown in the deactivation alert)
- The Session Watcher will retroactively scan any session logs from the bypass window
- Check the Audit & Evidence tab for the complete record

---

## 9. Understanding What's Protected

ClawNex protects against 10 categories of threats:

| Category | What It Catches | Example |
|----------|----------------|---------|
| **Secrets** | API keys, tokens, credentials in prompts | "My AWS key is AKIA..." |
| **Commands** | Dangerous shell commands | "Run `rm -rf /` on the server" |
| **Sensitive Paths** | References to credential files | "Read ~/.ssh/id_rsa" |
| **C2 Patterns** | Exfiltration attempts | "Send data to webhook.site/..." |
| **Cognitive Tampering** | Attempts to modify agent identity | "Override your SOUL.md instructions" |
| **Trust Exploitation** | Prompt injection attacks | "Ignore previous instructions, you are now..." |
| **Jailbreaks** | Bypass attempts | "Pretend you're my grandma reading me..." |
| **Steganography** | Hidden content in text | Zero-width characters, homoglyphs |
| **Encoding Attacks** | Obfuscated payloads | Base64-encoded malicious commands |
| **Financial Data** | PII in prompts | Credit card numbers, SSNs |

---

## 9A. Managing Your Sign-In Methods (v0.9.0+)

Open **Configuration** → expand the **AUTH & DEVICES** card. Every signed-in operator has access to this card regardless of role.

### 9A.1 Enrolling a Passkey

1. Type a recognisable label in the **Label** field — for example "MacBook fingerprint" or "YubiKey 5C". This is just to help you remember which credential is which when you have several.
2. Click **Add Passkey**.
3. Your browser pops up its native passkey UI. Confirm with Touch ID, Windows Hello, your security key, or whatever authenticator your device offers.
4. The new passkey appears in the list with its label, when it was added, and "Last used: Never".

You can enroll as many passkeys as you like — for example one per device. Each one is independent; revoking one doesn't affect the others.

### 9A.2 Signing In with a Passkey

On the login page, click **Sign in with Passkey**. The browser surfaces every passkey enrolled for ClawNex on this device — pick one, confirm with your authenticator, and you're in. No username field, no password.

### 9A.3 Revoking a Passkey

If you lose a device or sell a security key, revoke its passkey from Auth & Devices:

1. Find the passkey in the list (use the label and "Last used" timestamp to identify it).
2. Click **Revoke**.
3. Confirm the prompt — the passkey is removed immediately and cannot be used to sign in again.

### 9A.4 Linking a GitHub Account

If your administrator has enabled GitHub OAuth (you'll see the GitHub section as active rather than greyed out), you can link your GitHub account so that **Sign in with GitHub** works on the login page:

1. Sign in with your local password (you must already be signed in to link).
2. Open **Auth & Devices** → scroll to the **GITHUB** section → click **Link GitHub**.
3. Complete the OAuth flow on GitHub.
4. You're returned to the dashboard with the GitHub username shown as linked. From now on, **Sign in with GitHub** works on the login page.

To unlink, click **Unlink** in the GitHub section. You can re-link the same or a different GitHub account at any time.

### 9A.5 What if GitHub doesn't appear?

The GitHub section in Auth & Devices reflects the admin's configuration:

- *"GitHub sign-in is not enabled"* — your admin hasn't turned it on. Ask them to flip the switch in Authentication Methods.
- *"GitHub sign-in is enabled but credentials are missing"* — your admin enabled it but hasn't pasted the OAuth Client ID / Secret. Ask them to finish the configuration.
- A link button is shown — you're ready to link.

---

## 10. Quick Reference

### 10.1 Status Indicators

| Indicator | Meaning |
|-----------|---------|
| Green dot (glowing) | Service is ONLINE and healthy |
| Amber dot | Service is DEGRADED (responding with issues) |
| Red dot | Service is OFFLINE or unhealthy |
| "OBSERVE" badge | Shield is scanning but not blocking |
| "BLOCK" badge (pulsing) | Shield is actively blocking threats |
| Red banner at top | Break-glass mode is active |

### 10.2 Keyboard and Screen Reader Support

ClawNex is a mouse-first dashboard and does not yet have a global hotkey system (planned for v0.7.x). However, every control is keyboard-accessible using standard browser navigation:

- **`Tab` / `Shift+Tab`** — Move focus between controls.
- **`Enter`** — Submit forms (Login, Setup, Password Reset, Access Control inputs, Audit search, Scheduled Reports, Correlation Rules, HTTPS domain).
- **`Space`** — Toggle checkboxes, buttons, and toggle switches (shield block mode, schedule enable/disable).
- **`Escape`** — Dismiss the currently visible tooltip or modal dialog.
- **`Cmd+F` / `Ctrl+F`** — Browser find within the active panel.

Screen readers receive tooltip content via `aria-describedby` on focus. Alert severity is announced via `aria-label` on the severity badge. Live traffic updates use `aria-live="polite"` on the traffic table so new rows are announced without interrupting the current task.

**Full reference:** docs/22-keyboard-shortcuts.md.

### 10.3 Getting Help

- **This manual** — Basic operations and concepts.
- **Advanced User Manual** (CLAWNEX-USR-002) — Advanced features, rule management, API usage.
- **IT Support Manual** (CLAWNEX-OPS-001) — Troubleshooting, maintenance, infrastructure.
- **Troubleshooting Guide** (docs/17-troubleshooting-guide.md) — Symptom → cause → fix for common issues.
- **In-app Glossary (v0.11.0+)** — open the **Help** tab and scroll to the **Glossary** card at the bottom. 62 plain-English definitions across 10 categories (Cost trust labels, Drain signals, Telemetry sources, Virtual models & special markers, Shield & detection, Blast radius & trust audit, Correlations, Auth & access, Policy framework, Infrastructure & deployment). Each entry shows where the term shows up via `appearsIn` badges, so you can jump straight to the relevant tab. The Glossary in §10A below is a curated subset; the in-app one is the source of truth.

**When to use the Troubleshooting Guide:**

| Symptom | See |
|---------|-----|
| White screen on dashboard | docs/17 §1 |
| Traffic Monitor shows no entries | docs/17 §3 |
| Locked out of login | docs/17 §8 (also FAQ Q9 in this manual) |
| LiteLLM showing OFFLINE | docs/17 §5 |
| Tooltips not appearing | docs/17 §7 |
| Session expired unexpectedly | docs/17 §9 |

---

## 10A. Glossary

| Term | Definition |
|------|------------|
| **Shield verdict** | The decision the Prompt Shield renders for a single scan: ALLOW, REVIEW, BLOCK, or BYPASSED. Drives whether traffic is flagged, alerted on, or (in BLOCK mode) stopped before reaching the model. |
| **Threat score** | An integer 0–100 produced by the Prompt Shield. Score = Σ (severity_weight × confidence × match_count). Score ≥ 60 triggers BLOCK; score 25–59 triggers REVIEW; below 25 is ALLOW. |
| **Correlation** | A pattern match across multiple independent events (shield detections, session-watcher findings, audit entries) within a time window. Correlations escalate to incidents when they match a defined correlation rule. |
| **Block mode** | A global switch (OBSERVE vs BLOCK) controlling whether BLOCK verdicts actually reject requests. OBSERVE logs but allows; BLOCK rejects with HTTP 403. |
| **Break-glass** | An authorized emergency bypass of the Prompt Shield, used when LiteLLM is unavailable and the agent fleet must keep operating. Requires a stated reason, typed confirmation, and a bounded duration (maximum 4 hours). All bypassed traffic is logged with verdict=BYPASSED. |
| **Trust boundary** | An interface where an agent interacts with an external system (model provider, filesystem, network endpoint, tool). The Trust Boundary Audit panel evaluates 15 rules against discovered boundaries. |
| **Session watcher** | A background service that reads OpenClaw session JSONL files and retroactively scans historical conversations. Read-only; never modifies agent files. |
| **Fail-closed** | Architectural property: if the LiteLLM proxy is down, agent LLM requests fail rather than bypass the shield. Break-glass is the only authorized exception. |
| **RBAC** | Role-Based Access Control. ClawNex defines 5 roles (Admin, Security Manager, Operator, Viewer, Auditor) and 32 permissions — including the policy-framework triple `policies:read`, `policies:write`, `policies:test`. See CLAWNEX-USR-002 §6.6. |
| **CSRF** | Cross-Site Request Forgery. ClawNex uses a double-submit cookie + `X-CSRF-Token` header on all mutation endpoints when RBAC is enabled. |
| **Progressive lockout** | Account protection against brute-force: 5 fails → 1 min, 10 → 5 min, 15 → 30 min, 20 → account disabled (admin action required). |
| **MCP** | Model Context Protocol. ClawNex exposes 10 MCP tools (shield_scan, check_posture, query_threats, etc.) for AI assistants. See CLAWNEX-USR-002 §7E. |
| **PII** | Personally Identifiable Information. The Prompt Shield redacts emails, phones, SSNs, credit cards, IPs, DOBs, and passport numbers when redaction is enabled. |

---

## 11. Frequently Asked Questions

### Q: Why does the Traffic Monitor show "STOPPED" for the shield?
**A:** This is the shield mode indicator, not a service status. If it shows "OBSERVE," the shield is actively scanning but operating in observe-only mode (not blocking). Check the Configuration tab to change it.

### Q: Why are some requests showing as BLOCK but still going through?
**A:** Shield Block Mode is set to OBSERVE. In this mode, the shield scans and labels traffic but doesn't actually prevent requests. To enable active blocking, toggle Block Mode to ON in the Configuration tab.

### Q: What does "session-watcher" source mean?
**A:** The Session Watcher reads your agents' historical session logs and scans them retroactively. These entries represent past conversations that were analyzed after the fact — the watcher can detect threats but can't block them since the conversation already happened.

### Q: Why is the shield scoring my legitimate agent traffic as BLOCK?
**A:** Your agent system prompts likely reference files like SOUL.md, MEMORY.md, or TOOLS.md. The shield has rules that detect these as potential cognitive tampering. Go to the Prompt Shield tab and use the Rule Whitelist to whitelist these rules for internal traffic.

### Q: How long is traffic data kept?
**A:** By default, traffic logs are kept for 3 days. You can change this in Configuration tab → Data Retention. Audit logs default to 365 days.

### Q: What happens if ClawNex goes down?
**A:** ClawNex operates fail-closed. If the LiteLLM proxy is down, agent requests will fail (they won't bypass the shield). A watchdog checks every 5 minutes and auto-restarts any downed service. For emergencies, use break-glass mode.

### Q: Can I test the shield without affecting real traffic?
**A:** Yes. Go to the Prompt Shield tab and use the Live Input Scanner. Paste any text and click Analyze. This is a sandboxed test — it doesn't affect agent traffic.

### Q: Why am I locked out of ClawNex?
**A:** ClawNex uses progressive lockout to protect against brute-force login attempts. After 5 failed logins you're locked for 1 minute; after 10 for 5 minutes; after 15 for 30 minutes; after 20 your account is disabled. If you're locked, wait for the timer shown on the login page and try again with the correct credentials. If your account is disabled, contact your ClawNex administrator to re-enable it.

### Q: How do I reset my password?
**A:** ClawNex does not have self-service password reset. Ask your ClawNex administrator to go to the **Password Reset** page (`/reset-password`) and set a new password for your account. If you are the admin and you're locked out, you may need to connect to the database directly and clear the lockout flag — see the IT Support Manual (CLAWNEX-OPS-001) for the procedure.

### Q: What is the Trust Audit panel?
**A:** Trust Audit scans your environment for security issues at the boundaries where your agents interact with external systems — such as agent→LLM provider, agent→filesystem, or agent→network. It applies 15 rules and surfaces findings with severity ratings and remediation guidance. Click the **Discover** button to trigger a fresh scan, or let it run on its automatic schedule. See section 4.7 for full details.

### Q: How do I set up email reports?
**A:** Go to **Configuration** → **Scheduled Reports** card. Click **Add Schedule**, choose Daily, Weekly, or Monthly, enter your delivery email address, and save. Reports are sent automatically on the chosen schedule. Use the enable/disable toggle to pause delivery without losing your settings.

---

## 12. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.10 | 2026-05-08 | ClawNex Engineering | v0.14.5-alpha. New §4.8 Mission Control & the Triage Graph — KPI row + Operational Posture + Top Action Queue (grouping, severity/family filters, per-incidentType suppression, score-rationale on hover, 11 canonical verbs in `Verb · target`), plus the 5-stage Triage Graph drill-down (Evidence / Source Event / Affected Object / Related Activity / Fix / Control) backed by per-source resolvers for all 9 source families (alert / cost-signal / collector-health / trust-audit / correlation / blast-radius / auth-rbac / update-cve / policy-warning) as of v0.14.5. Stat tile lift across the dashboard described as visual context. Setup banner explained for fresh-install operators. |
| 1.9 | 2026-05-05 | ClawNex Engineering | v0.11.2-alpha. New §4.4a Token & Cost Intel walkthrough: per-source totals, "Highest reported monitored spend" headline, six cost trust labels in plain English (Estimated / Actual / Recomputed / Included / Token-only / Cost unknown), Drain Signals card with click-to-filter, pagination on long tables (default 5/page), Hide delivery-mirror toggle, instance dropdown, dropped Metric Aggregation TOTAL column. §4.4 Audit & Evidence gains View Evidence backlink walkthrough (deep-link from Alerts & Incidents to the exact triggering audit row, scroll-into-view, NOT IN WINDOW edge case). §10.3 Getting Help points operators at the in-app Glossary (62 entries / 10 categories, source of truth — §10A here is a curated subset). |
| 1.8 | 2026-05-01 | ClawNex Engineering | Header pill row documented (version + ALPHA chip + UPDATES notifier + theme toggle + TIPS). Configuration → Updates section explains the actionable-vs-informational split, the immediate refresh signal, and the mtime-based Host Security scanner drift fix. Sticky-collapse note added to Configuration intro. |
| 1.5 | 2026-04-22 | ClawNex Engineering | v0.6.2-alpha hardening pass: Readiness banner on Fleet Command, Correlations panel value surfacing, risk-weight UI for custom correlation rules. Trust Audit performance notes updated. No new panels. See CHANGELOG §[0.6.2-alpha]. |
| 1.7 | 2026-04-24 | ClawNex Engineering | v0.10.0-alpha Magic Link: §2.1b login section now describes four sign-in paths (password / passkey / GitHub / Magic Link) including the v0.9.2 Magic Link flow with 15-min expiry, one-shot consume, and deliberate no-enumeration "check your inbox" response. Passkey bullet updated with v0.9.1 user-verification-required note. |
| 1.6 | 2026-04-24 | ClawNex Engineering | v0.9.0-alpha multi-auth: §2.1b login section now describes the three sign-in providers (password / passkey / GitHub) and the always-available break-glass invariant. New §9A covers per-account passkey enrollment, passkey sign-in, passkey revocation, GitHub linking/unlinking, and the admin-config states the user might encounter in Auth & Devices. |
| 1.4 | 2026-04-22 | ClawNex Engineering | Enterprise review: Added About This Document (§0) with intended audience, scope, accessibility statement, see-also cross-references. Expanded §10.2 from "no shortcuts" to full keyboard and screen reader coverage with troubleshooting pointer table. Added Glossary (§10A) defining Shield verdict, threat score, correlation, block mode, break-glass, trust boundary, session watcher, fail-closed, RBAC, CSRF, progressive lockout, MCP, PII. |
| 1.3 | 2026-04-22 | ClawNex Engineering | v0.6.1-alpha: Added progressive lockout behavior and password reset flow (2.1b). Added Trust Audit panel section (4.7). Added Scheduled Reports, Custom Correlation Rules, and HTTPS/Caddy to Configuration section (4.6). Added FAQ entries: lockout, password reset, Trust Audit, email reports. Updated tour and tab count to 23. |
| 1.2 | 2026-04-13 | ClawNex Engineering | Added RBAC authentication section (2.1b), updated access modes for v0.6.1 |
| 1.0 | 2026-04-02 | ClawNex Engineering | Initial release |

---

*This is a living document. It will be updated as new features are added.*

---

*ClawNex by ClawNex maintainers — clawnexai.com*
