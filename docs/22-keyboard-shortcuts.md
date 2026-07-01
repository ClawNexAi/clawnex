# ClawNex Keyboard Shortcuts

**Document:** 22-keyboard-shortcuts
**Document ID:** CLAWNEX-A11Y-001
**Version:** 1.5
**Last Updated:** 2026-05-08
**Product Version:** v0.15.1-alpha
**Classification:** For Distribution
**Status:** Living Document

---

## 1. Accessibility Statement

### 1.1 Target Conformance

ClawNex targets **WCAG 2.1 Level AA** conformance. All interactive controls are reachable with keyboard-only input; all informational content is exposed to assistive technology via semantic HTML and ARIA attributes.

### 1.2 Known Gaps (v0.6.2-alpha)

| Gap | Impact | Remediation Target |
|-----|--------|-------------------|
| No global command palette (Cmd+K) | Keyboard power users cannot jump between panels quickly | v0.7.x |
| No vim-style panel hotkeys (`g f`, `g s`) | Slower panel switching for keyboard-first operators | v0.7.x |
| Alert list not fully virtualized for screen readers when >200 items | Potential announcement lag | v0.7.0 |
| Trust Audit matrix cells lack a dedicated keyboard drill-down | Users must Tab through the grid linearly | v0.7.0 |
| HeyGen floating avatar is visually-only | Screen reader users bypass it; text-equivalent help exists in PANEL_HELP and Chat Assistant | Future |

### 1.3 Compatibility

Tested with:
- macOS VoiceOver (Ventura, Sonoma, Sequoia) on Safari and Chrome
- NVDA 2024.1 on Windows 11 + Chrome/Edge
- JAWS 2024 on Windows 11 + Chrome

---

## 2. Current State (v0.6.2-alpha)

ClawNex is a mouse-first dashboard. Most interactions happen via hover, click, and standard form controls. There is intentionally **no custom global hotkey system** yet — every interaction runs through standard browser input handling, which keeps accessibility predictable and avoids collisions with screen readers, browser extensions, and OS-level shortcuts.

A full command palette (`Cmd+K` / `Ctrl+K`) and customizable hotkey system is on the future roadmap (v0.7.x or later). Until then, this document covers what actually exists.

---

## Tooltip System

| Shortcut | Action | Context |
|---|---|---|
| `Tab` | Move focus between tooltiped elements | Any panel |
| `Shift+Tab` | Move focus backward | Any panel |
| Focus + wait | Tooltip appears after the 300ms delay, same as hover | Any tooltiped element |
| `Escape` | Dismiss the currently visible tooltip | While a tooltip is visible |
| Blur (click elsewhere) | Dismiss the tooltip | While a tooltip is visible |

The `aria-describedby` attribute points at the tooltip's generated id, so screen readers announce the tooltip content automatically on focus.

---

## Form Inputs

Enter-to-submit is wired on several inline inputs throughout the dashboard:

| Panel | Input | Enter Action |
|---|---|---|
| **Login page** (`/login`) | Password field | Submits login form |
| **Setup page** (`/setup`) | Confirm password field | Submits initial setup form |
| **Password Reset page** (`/reset-password`) | New password field | Submits password reset form |
| **Access Control** | Path check input | Runs `checkPath()` |
| **Access Control** | URL check input | Runs `checkUrl()` |
| **Audit & Evidence** | Search box | Runs `fetchAudit()` |
| **Configuration** → Local Model Costs | New model name | Runs `addModel()` |
| **Configuration** → Access Lists | New entry | Runs `handleAdd()` |
| **Configuration** → Scheduled Reports | Report name / schedule fields | Submits save action |
| **Configuration** → Correlation Rules | Rule name / condition fields | Submits save action |
| **Configuration** → HTTPS | Domain / cert path fields | Submits save action |
| **Chat Panel** | Message input | Sends the message (same as clicking Send) |
| **Floating Avatar** | Question input | Submits the question to the assistant |

Escape does not clear form inputs by default — use `Cmd+A` (or `Ctrl+A`) then `Delete` to clear.

---

## Configuration Panel — New Card Interactions (v0.6.1)

Three new cards shipped in v0.6.1: **Scheduled Reports**, **Correlation Rules**, and **HTTPS**. Each contains form inputs (wired with Enter-to-submit, see table above) and toggle switches.

| Card | Toggle / Control | Behavior |
|---|---|---|
| **Scheduled Reports** | Enable/Disable toggle | Activates or suspends the scheduled report job. Click-only. |
| **Correlation Rules** | Rule enabled toggle | Toggles a specific correlation rule on or off. Click-only. |
| **HTTPS** | Enable HTTPS toggle | Enables or disables Caddy HTTPS. Takes effect on next server restart. Click-only. |

Toggle switches follow standard HTML `<input type="checkbox">` focus/keyboard semantics — `Tab` to reach, `Space` to toggle.

---

## Configuration Panel — v0.9.0 cards

Two new cards shipped in v0.9.0: **Authentication Methods** (admin-only) and **Auth & Devices** (per-account).

**Authentication Methods card** (admin-only):
- `Tab` to GitHub OAuth Enabled checkbox → `Space` to toggle
- `Tab` to Client ID input → type → `Tab` to Client Secret input → type → `Tab` to Callback URL input → type → `Tab` to **Save** button → `Enter` to persist
- Magic Link toggle (v0.9.2+): `Tab` to Magic Link Enabled checkbox → `Space` to toggle. No credentials fields — Magic Link uses the Mail Configuration provider. When enabled without a mail provider configured, a warning line appears below the toggle (not focusable).

**Auth & Devices card** (every operator):
- Passkey list rows: `Tab` to **Revoke** button on each row → `Enter` or `Space` to invoke confirmation prompt
- New-passkey row: `Tab` to Label input → type → `Tab` to **Add Passkey** button → `Enter` to invoke browser passkey UI
- GitHub link row: `Tab` to **Link GitHub** (when not linked) or **Unlink** (when linked) → `Enter` or `Space` to invoke

The browser passkey enrollment / authentication UI is fully keyboard-accessible via the OS passkey selector — exact behavior varies by platform (macOS Touch ID prompt, Windows Hello prompt, etc.).

---

## Trust Audit Panel

The Trust Audit panel has four views: **Findings**, **Matrix**, **Remediation**, and **Surfaces**. View switching is click-only (tab buttons at the top of the panel). Within each view:

| Interaction | Mechanism | Notes |
|---|---|---|
| Switch view | Click tab button | No keyboard shortcut; standard tab focus applies |
| Filter inputs | Type in search/filter box | Enter-to-submit not wired — filters apply on input change |
| `Tab` / `Shift+Tab` | Move focus between controls in the active view | Standard browser behavior |

---

## Global Toggles

These are click-only for now, no keyboard shortcut:

| Control | Location | Behavior |
|---|---|---|
| **TIPS toggle** | Dashboard header | Flips the entire tooltip system on or off. State persists via `config_defaults.tooltips_enabled`. |
| **Demo Mode** | Status bar | Previews the multi-tenant / filled-state view without touching real data. |
| **Dark / Light theme** | Status bar | Instant theme flip, persists via localStorage. |
| **Help drawer (?) ** | Dashboard header | Opens the per-panel help flyout with description, key metrics, actions, and related panels. |

Feel free to file an issue (or a PR, once the public repo is live) proposing keyboard shortcuts for any of these.

---

## Browser Defaults Worth Knowing

ClawNex is a standard Next.js single-page app. All normal browser shortcuts work:

| Shortcut | Action |
|---|---|
| `Cmd+R` / `Ctrl+R` | Reload the dashboard |
| `Cmd+Shift+R` / `Ctrl+Shift+R` | Hard reload (bypass cache) |
| `Cmd+F` / `Ctrl+F` | Find in current panel |
| `F12` / `Cmd+Option+I` | Open browser dev tools (for debugging panels or inspecting the API) |
| `Cmd+[` / `Alt+Left` | Browser back |
| `Cmd+]` / `Alt+Right` | Browser forward |
| `Cmd++` / `Ctrl++` | Zoom in |
| `Cmd+-` / `Ctrl+-` | Zoom out |
| `Cmd+0` / `Ctrl+0` | Reset zoom |

If the dashboard ever gets into a weird state, a hard reload (`Cmd+Shift+R`) is the fastest recovery path that doesn't lose your SQLite state.

---

## Screen Reader Behavior

ClawNex implements the following ARIA patterns for assistive technology users:

| Surface | Pattern | Effect |
|---------|---------|--------|
| Tooltip system | `aria-describedby` points at the generated tooltip id | Screen reader announces tooltip content on focus |
| Alert severity badge | `aria-label="CRITICAL severity"` (etc.) | Color-blind users hear the severity |
| Traffic table | `aria-live="polite"` on the `<tbody>` | New rows announced without interrupting current task |
| Break-glass banner | `role="alert"` with `aria-live="assertive"` | Announced immediately on activation |
| Panel help drawer | `role="dialog"` with `aria-labelledby` and focus trap | Screen reader enters dialog mode; Tab cycles within |
| Shield verdict badges | `aria-label` mirrors verbal verdict | "BLOCK: score 85" instead of just visual red |
| Session expiry warning | `role="status"` with `aria-live="polite"` | Countdown announced politely |
| Break-glass countdown | `aria-live="off"` after initial activation announcement | Avoids per-second noise |

### Landmarks

The dashboard exposes standard ARIA landmarks:
- `<nav aria-label="Primary navigation">` — Left sidebar.
- `<header role="banner">` — Top header with user identity and global controls.
- `<main>` — Active panel.
- `<aside aria-label="Help">` — Right-side help drawer when open.

Screen reader users can jump directly between landmarks using their reader's navigation keys (VO-U for VoiceOver rotor, NVDA's D key for landmarks).

---

## Focus Order Reference

Documenting focus order on every panel is essential for keyboard-only navigation. The following sections describe the Tab order for each entry point and all 26 panels.

### Authentication Pages

**`/login`:**
1. Username field
2. Password field
3. Remember-me checkbox
4. Forgot-password link (if mail configured)
5. Login button
6. **Sign in with Passkey** button (v0.9.0+) — Enter or Space to invoke; opens browser native passkey selector
7. **Sign in with GitHub** button (v0.9.0+, only when admin has enabled GitHub OAuth) — Enter or Space to redirect to GitHub authorize
8. **Email me a magic link** button (v0.9.2+, only when admin has enabled Magic Link AND a mail provider is configured) — `Enter` or `Space` expands into an inline email form; focus auto-advances to the email input; `Tab` to **Send link** → `Enter` submits. After submit, focus moves to the "check your inbox" confirmation panel.

The browser passkey UI takes over keyboard focus once invoked — return to dashboard focus is governed by the OS / browser passkey selector. After successful sign-in, focus lands on the dashboard sidebar root by default.

**`/setup` (first-run admin creation):**
1. Username field
2. Email field (optional)
3. Password field
4. Confirm password field
5. Setup-secret field (if `SETUP_SECRET` env set)
6. Create Admin button

**`/reset-password` (admin-initiated):**
1. Current password field (if resetting own)
2. New password field
3. Confirm new password field
4. Reset button

### Main Dashboard Chrome

Every panel shares this preceding focus order:
1. Skip-to-content link (visually hidden, focusable)
2. Sidebar toggle
3. Sidebar navigation tabs (all 26, in group order)
4. Context bar: time range selector → instance filter → client filter → severity filter
5. TIPS toggle → Help drawer (`?`) → Tour button → theme toggle
6. Role badge → Logout button
7. Main content area (panel-specific, see below)
8. Floating avatar toggle (if enabled)

### Panel Focus Order (26 panels)

Every panel follows the convention: **panel header** → **primary action buttons** → **filter/search controls** → **data region** → **secondary actions**.

| Panel | Header Actions | Data Region Tab Order |
|-------|---------------|----------------------|
| Fleet Command | Refresh, Add Instance | Instance cards (grid order, row-major) |
| Instance Detail | Back, Services, Edit | Service badges → metric tiles |
| Traffic Monitor | Refresh, Export | Filters → traffic table rows |
| Prompt Shield | Run Test, Manage Rules | Scanner input → Analyze → Detections → Rule list |
| Shield Tests | Run All, Filter Category | Test rows |
| Trust Audit | Discover, View toggle | Matrix cells → Findings list → Surfaces list |
| Security Posture | Refresh, Run Scan | Check rows → Remediation button |
| Alerts & Incidents | New Alert, Filter | Alert cards (collapsed) → ACK → Resolve |
| Correlations | New Rule, Filter | Correlation cards → Rule list |
| Infrastructure | Refresh | Service rows → inline Restart button |
| Agent Workspace | Refresh | File tree → file contents |
| Agents & Sessions | Filter | Session cards |
| Skills & Plugins | Filter by risk | Skill rows |
| Access Control | Add, Test | Path input → URL input → entry list |
| Governance | Filter | Permission rows |
| Token & Cost Intel | Time range | Chart → summary tiles |
| Models & Cost | Provider filter | Model rows |
| Audit & Evidence | Filter, Search, Export | Filter bar → search → audit rows → pagination |
| Executive Reports | Report type selector | Report card → Export button |
| Configuration | Expand All | Card list (UI Prefs → Updates → OpenClaw → Shield → Break-Glass → Retention → Providers → Gateways → Scheduled Reports → Correlation Rules → HTTPS → Operators → API Keys → Mail → Voice) |
| Help | Search | Doc tiles |
| Chat Panel | Clear | Message input → Send |
| Guided Tour | Prev, Next, Finish | Tour content → controls |

**Verification methodology:** Focus order is verified with the Accessibility Insights extension (`Tab Stops` mode) on every release. Deviations are filed as accessibility bugs against `docs/20-product-roadmap.md` → A11y section.

---

## Future Work

Planned for a later release (no committed version yet):

- **Command palette** (`Cmd+K` / `Ctrl+K`) — fuzzy search across panels, recent alerts, agents, config settings, and documentation
- **Panel navigation hotkeys** — `g f` (go to Fleet), `g s` (go to Prompt Shield), `g a` (go to Alerts), etc. (vim-style leader keys)
- **Quick filters** — `/` to focus the nearest search box, `f` to toggle filter drawer
- **Alert triage hotkeys** — `a` to acknowledge, `r` to resolve, `j`/`k` to navigate the card list

If you have a strong opinion on which shortcuts to prioritize, drop it in a GitHub issue (once the public repo is up) or in `docs/20-product-roadmap.md` → v0.7.x section.

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-22 | ClawNex Engineering | Initial release: tooltip keyboard behavior, form-input Enter-to-submit, v0.6.1 Configuration card interactions, Trust Audit view switching, global toggles, browser defaults, future-work roadmap. |
| 1.1 | 2026-04-22 | ClawNex Engineering | Enterprise review: added CLAWNEX-A11Y-001 document ID; §1 Accessibility Statement with WCAG 2.1 AA target, known gaps table, assistive-tech compatibility; Screen Reader Behavior section with ARIA patterns and landmarks; Focus Order Reference with Tab order for Login, Setup, Password Reset, main dashboard chrome, and all 23 panels; verification methodology note. |
| 1.2 | 2026-04-22 | ClawNex Engineering | v0.6.2-alpha version bump: known-gaps and current-state labels moved from v0.6.1-alpha to v0.6.2-alpha; alert-virtualization remediation target shifted from v0.6.2 to v0.7.0 (not shipped this release). No shortcut changes. |
| 1.3 | 2026-04-24 | ClawNex Engineering | v0.9.0-alpha multi-auth: §Focus Order Reference / Authentication Pages now lists Sign in with Passkey + Sign in with GitHub + Email me a magic link buttons on `/login`. New Configuration Panel — v0.9.0 cards section documents Tab order for Authentication Methods (admin) + Auth & Devices (per-account) including passkey enrollment / revocation / GitHub link UI keyboard interactions. |
| 1.5 | 2026-05-05 | ClawNex Engineering | v0.11.2-alpha: no new shortcuts in this window. SignalsCard counter rows on the Token & Cost Intel tab were converted from clickable `<div>`s to native `<button>` elements (a11y polish per internal reviewer Gate-C non-blocking note) — they now participate in Tab order with a `:focus-visible` outline and respond to Enter/Space. View Evidence buttons on Alerts & Incidents are native `<button>` elements and follow standard activation rules. The new HelpPanel **Glossary** section is a CollapsibleCard at the bottom of Help — Tab/Enter to toggle, Tab through child category cards. |

---

## See Also

- **docs/06-basic-user-manual.md** §10.2 — Operator-facing keyboard reference.
- **docs/07-advanced-user-manual.md** §6.5 — RBAC permission reference (affects which panels appear in the Tab order).
- **docs/23-help-surfaces-index.md** — How tooltip, PANEL_HELP, and chat surfaces coordinate.
- **docs/17-troubleshooting-guide.md** §7 — Tooltip-related troubleshooting.

---

*A ClawNex Project — clawnexai.com*
