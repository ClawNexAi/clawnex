# ClawNex

**One nexus. Total control.**

[![CI](https://github.com/clawnexai/clawnex/actions/workflows/ci.yml/badge.svg)](https://github.com/clawnexai/clawnex/actions/workflows/ci.yml)
[![CodeQL](https://github.com/clawnexai/clawnex/actions/workflows/codeql.yml/badge.svg)](https://github.com/clawnexai/clawnex/actions/workflows/codeql.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![DCO](https://img.shields.io/badge/Sign--off-DCO-brightgreen)](DCO)
[![Version](https://img.shields.io/badge/version-0.15.0--alpha-orange)](CHANGELOG.md)

## Problem

AI agent fleets make thousands of LLM calls per day with no inline inspection. Prompt injection, data exfiltration, wallet-draining loops, and jailbreaks pass through undetected — and without immutable evidence, an incident becomes a reconstruction exercise instead of an investigation.

## Solution

ClawNex is an AI Agent Fleet Security Operations Center (SOC) that sits between AI agents (managed by OpenClaw) and their LLM providers (via a LiteLLM proxy). It scans every prompt and response through a 163-rule shield, correlates signals across sources, and surfaces fleet-wide visibility in a single pane of glass — with an immutable audit trail, RBAC, and scheduled compliance reporting built in.

**Version:** 0.15.0-alpha
**Last Updated:** 2026-05-08
**Status:** Alpha — functional, under active development
**License:** Apache License 2.0 with Developer Certificate of Origin (DCO). Direction decided 2026-04-11; `LICENSE` file added at public repository cutover.

---

## What it does

- **Mission Control + Triage Graph** (v0.12.0+, completed v0.14.5) — the operator cockpit. KPI row + Operational Posture + Top Action Queue with grouped rows, severity / family filters, per-incident-type suppression, score rationale on hover, and per-source stale markers. Click `Investigate ▸` on any queue row to expand the **Triage Graph** inline — a 5-stage drill-down (Evidence → Source Event → Affected Object → Related Activity → Fix / Control) backed by per-source resolvers across all 9 source families (alert / cost-signal / collector-health / trust-audit / correlation / blast-radius / auth-rbac / update-cve / policy-warning). 343 hermetic assertions in the test stack guard the contract end-to-end.
- **Shield scanner** — 163 rules across 10 categories (PII, financial, C2, jailbreak, exfiltration, cognitive tampering, etc.) scans every inbound and outbound model call through the LiteLLM proxy. Verdicts: `ALLOW` / `REVIEW` / `BLOCK`.
- **Fleet command** — live visibility into every registered gateway, instance health, shield coverage, threats in the last 1h/6h/24h/7d/30d, and fleet-wide cost.
- **Prompt Shield panel** — manual scanning, rule whitelist management, recent shield events, threat score breakdowns.
- **Traffic Monitor** — every proxy request/response with verdict, score, latency, tokens, status. Filter by source, model, provider, verdict, score threshold.
- **Token & Cost Intel** — multi-source FinOps reporting (v0.11.0+) across **OpenClaw + Hermes + Paperclip** with explicit trust labels (Estimated / Actual / Recomputed / Included / Token-only / Unknown), per-source totals (no cross-source summing), "Highest reported monitored spend" headline, five drain detectors (`loop_risk`, `velocity_spike`, `context_bloat`, `cache_drop`, `simple_on_expensive`), instance routing, click-to-filter SignalsCard, pagination on long tables, and a `Hide delivery-mirror` toggle. Privacy guarantees verified by static AST grep + runtime tests (no `signal_context` leak; Hermes prompt plaintext stays in-adapter; OpenClaw token-reader cannot read message content).
- **Infrastructure** — service health for ClawNex Dashboard (5001), LiteLLM Proxy (4001), Session Watcher, OpenClaw Connector. Inline restart buttons for recoverable services. Latency tracking.
- **Access Control + Break-Glass** — operator permissions, emergency override with audit trail.
- **Alerts & Incidents** — open alert queue, severity triage, ack/close workflow.
- **Audit & Evidence** — immutable audit trail for every config change, break-glass action, whitelist edit. **Alert → Evidence backlink** (v0.11.1+, deep-link refined v0.11.2): every Session Shield alert exposes a `View Evidence →` button that deep-links to the exact triggering audit row, scrolls it into view, with `payload_excerpt` already redacted at audit-write time.
- **Correlation Engine** — multi-event pattern detection across shield scans, traffic, and alerts.
- **Executive Reports + Compliance** — SOC 2 / ISO 27001 evidence templates (in progress).
- **Role-Based Access Control** (v0.6.0+) — 5 operator roles (Admin, Security Manager, Operator, Viewer, Auditor) with 32 permissions (including the policy-framework triple `policies:read`, `policies:write`, `policies:test`). Session-based auth, progressive lockout, CSRF HMAC binding. Enterprise features (SSO, MFA, custom roles) are on the roadmap.
- **Multi-Auth Providers** (v0.9.0+, expanded v0.9.2) — operators can sign in with **WebAuthn passkeys** (Touch ID / Windows Hello / security keys; user-verification required per v0.9.1), a **linked GitHub account**, an **email-delivered Magic Link** (v0.9.2 — one-shot, 15-min TTL, atomic consume), or the always-available local password break-glass. Per-account self-service via the **Auth & Devices** card; admin enable / configure via the **Authentication Methods** card. Magic Link requires a configured mail provider (Resend / SMTP / Emailit).
- **Filtered Navigation** (v0.8.x) — shared `PanelFilters` widget with multi-select dimensions + freeform search + numeric range across 9 panels (Trust Audit, Alerts, Audit & Evidence, Risk Acceptances, Traffic Monitor, Agents & Sessions, Tools & Access, Shield Tests, Models & Cost). URL-as-state with cross-panel deep-links. **Investigating** button on alert rows (distinct from acknowledged).
- **Risk Acceptance** (v0.7.x) — operators can accept findings with three scope levels (per-finding, per-agent-rule, global) and deterministic SHA-256 evidence signatures so changing the underlying signal auto-revokes the acceptance.
- **Global Tooltip System** (v0.5.4+) — hover any stat, badge, column, or control for contextual help. Toggle on/off from the header TIPS button.
- **MCP Server** — Model Context Protocol server (10 tools) so Claude Code and other MCP clients can consume ClawNex tools directly. Includes `configure_provider`, `generate_report`, `run_shield_tests`, `run_trust_audit`, and `manage_budget` (v0.6.1+). MCP audit logging added in v0.6.2.
- **Trust Boundary Audit** — 14-rule audit engine that discovers the platform's trust surface, generates a risk matrix, and provides remediation guidance. Dedicated dashboard panel with 4 views (Discovery, Matrix, Remediation, Surfaces).
- **Scheduled Reports** — daily, weekly, and monthly report delivery via Resend or SMTP. On/off toggle per schedule, configurable from the Configuration panel.
- **Custom Correlation Rules** — operator-defined rules with weighted conditions, threshold scoring, configurable time windows, and a rule builder UI.
- **Configurable Rule & Policy Framework** (v0.10.0+, `policy-framework-v1`) — a starter policy framework that ships two starter policies with different runtime semantics: **`ClawNex Default`** is `source=curated` and `lifecycle=starter` — an operator-visible **wire-inert mirror** of all 163 built-in inbound jailbreak / cognitive-tampering / secret detections from `src/lib/shield/rules.ts` (the built-in Shield runs from source in v1; this row is audit-visible reference data). **`Generic Egress Starter`** is `source=system` and `lifecycle=starter` — a **wire-active outbound starter policy** running 12 enabled rules — email, phone, SSN, credit card, IPv4, date of birth, passport, private key material, password assignment, env var leak, internal IP, database URI — plus **2 lab held drafts visible but disabled** (`JAIL-CREDENTIAL-EXTRACTION-REQUEST`, `OUT-GENERIC-API-KEY-SHAPE`) that operators can review and clone/copy into a custom policy. Operators also author their own (`source=custom`). **Operator-authored DLP rules** support literal substring or opt-in regex (with a save-time safety gate, 1024-char length cap, and runtime iteration cap with auto-disable), per-rule actions (`score` / `block` / `review` / `redact` / `allow`), and per-rule literal exceptions. Disabling a vendor pack requires a typed-phrase confirmation and lights a header warning ribbon. RBAC-gated via `policies:read` (all roles), `policies:write` and `policies:test` (Admin + Security Manager). **Enterprise EDM / DCM / OCR deferred** — those remain enterprise-tier scope outside the OSS surface.
- **Caddy HTTPS Integration** — auto-TLS via Caddy with Caddyfile generation, status monitoring, and a dedicated Configuration panel card.
- **3 new Configuration panel cards** (v0.6.1): Scheduled Reports, Custom Correlation Rules, Caddy HTTPS.
- **In-app Glossary** (v0.11.0+) — 62 plain-English definitions across 10 categories (Cost trust labels, Drain signals, Telemetry sources, Virtual models & special markers, Shield & detection, Blast radius & trust audit, Correlations, Auth & access, Policy framework, Infrastructure & deployment) at the bottom of the Help tab. Each entry shows where the term appears via `appearsIn` cross-references.
- **OpenAI-compatible endpoint** — `POST /api/v1/chat/completions` with inline shield scanning, forwards to the local LiteLLM proxy.

## Tech stack

- **Next.js 14** App Router (server components + client components, SSE streaming)
- **React 18**
- **SQLite** (`better-sqlite3`) — 22-table schema, WAL mode, migrations, retention policies
- **LiteLLM 1.83.0** (pinned for supply-chain reasons) as the upstream proxy
- **TypeScript** throughout, with Python for the LiteLLM callback logger (`litellm/clawnex_logger.py`)
- **Tailwind CSS** + glassmorphism design system, dark + light theme toggle
- **The internal + public v1 HTTP API**, the operator-facing dashboard, **10 MCP tools** (counts drift with each release — see `src/app/api/**/route.ts` and `src/components/dashboard/panels/` for the live figures; the v0.6.x snapshot was 103 internal + 7 public-v1 routes across 23 panels)

## Enterprise Readiness

| Capability | Status | Notes |
|------------|--------|-------|
| RBAC (5 roles, 32 permissions) | Shipped (v0.6.0; policy-framework permissions added v0.10.0) | Admin, Security Manager, Operator, Viewer, Auditor — including `policies:read`, `policies:write`, `policies:test` |
| Session authentication | Shipped (v0.6.0) | SHA-256 tokens, configurable TTL, "Remember me" |
| CSRF protection | Shipped (v0.6.0) | Double-submit cookie, timing-safe comparison |
| Progressive lockout | Shipped (v0.6.1) | Configurable decay (`lockout_decay_minutes`) |
| WebAuthn passkeys | Shipped (v0.9.0; UV required v0.9.1) | Resident-key flow; Touch ID / Hello / security keys; user verification mandatory |
| GitHub OAuth sign-in | Shipped (v0.9.0) | Admin enables + provisions per-operator link; no auto-create |
| Magic Link sign-in | Shipped (v0.9.2) | Email-delivered one-shot (15-min TTL, sha256-hashed, atomic consume); double-gate: admin toggle + mail provider configured |
| Immutable audit trail | Shipped (v0.4.2) | 4-tier labeling, unlimited retention option |
| Scheduled Reports | Shipped (v0.6.1) | Daily/weekly/monthly via Resend or SMTP |
| Trust Boundary Audit | Shipped (v0.6.1) | 14 rules, discovery, matrix, remediation |
| HTTPS (auto-TLS via Caddy) | Shipped (v0.6.1) | Caddyfile generation, status monitoring |
| Supply-chain pinning | Shipped (v0.4.4) | LiteLLM pinned, npm deps exact-pinned |
| SBOM generation | Shipped (v0.6.2) | `scripts/generate-sbom.sh` produces npm + Python SBOM artifacts |
| LiteLLM fork-bomb guards | Shipped (v0.6.2) | Added in the v0.6.2 security audit pass |
| Configurable Rule & Policy Framework | Shipped (v0.10.0; `policy-framework-v1`) | Starter policy framework — one `source=curated` wire-inert mirror (`ClawNex Default`) + one `source=system` wire-active outbound starter (`Generic Egress Starter`) + operator-authored `source=custom` policies; enterprise EDM/DCM/OCR deferred |
| Secrets hygiene | Shipped (v0.6.2) | Secrets moved out of plist/start.sh into `.env.local` |
| SOC 2 / ISO 27001 evidence | Shipped (templates) | Evidence templates in Executive Reports |
| SSO / SAML | Planned | Roadmap (P1) |
| Multi-factor authentication (MFA) | Partial (v0.9.0) | Passkeys are phishing-resistant + cryptographic 2FA; explicit TOTP/recovery-code MFA still on roadmap |
| Custom roles / fine-grained permissions | Planned | Roadmap (P1) |
| High availability (multi-node) | Planned | Roadmap (P2) |
| External SIEM integration | Planned | Roadmap (P2) |
| Webhook notifications | Planned | Roadmap (P2) |
| Multi-tenant isolation | Planned | Roadmap (P2) |

## Deployment Options

| Option | Status | Notes |
|--------|--------|-------|
| Self-hosted (macOS, Linux) | Shipped | `bash install.sh` auto-detects environment |
| Self-hosted (VPS) | Shipped | Transfer and deploy script; Caddy HTTPS |
| Air-gapped / on-premises | Supported | Zero CDN dependency, self-hosted fonts |
| Managed cloud | Planned | Commercial roadmap |

## Versioning Policy

ClawNex follows **Semantic Versioning** (`MAJOR.MINOR.PATCH`) with the following pre-release semantics:

| Stage | Meaning | Guarantees |
|-------|---------|------------|
| `alpha` | Feature-complete within scope; may still shift | No backward-compatibility guarantees across minor versions |
| `beta` | Stable API surface under evaluation | Breaking changes only with deprecation notice |
| `GA` (no suffix) | Generally available | SemVer guarantees; breaking changes only in major versions |

v0.15.0-alpha is alpha: functional and in production for early adopters, but API surface and configuration keys may change before GA. staging environment is currently LIVE on `https://<qa-host>`.

## Documentation

The `docs/` directory holds the full enterprise documentation suite — 24 numbered documents plus supplementary design and content files. If you're new to ClawNex, start with the highlighted entries below. For the complete index:

**Numbered suite (`docs/01-24-*.md`):**

| Doc | Audience |
|---|---|
| `docs/01-infrastructure-design.md` | Sysadmins — runtime topology, ports, services |
| `docs/02-high-level-architecture.md` | Everyone — the 10-minute system overview (START HERE) |
| `docs/03-low-level-architecture.md` | Engineers — module and data layer design |
| `docs/04-product-requirements.md` | Product, Engineering — PRD for the current scope |
| `docs/05-reconstruction-playbook.md` | Engineers — how to rebuild ClawNex from first principles |
| `docs/06-basic-user-manual.md` | Operators — how to drive the dashboard |
| `docs/07-advanced-user-manual.md` | Power users — shield tuning, RBAC, break-glass |
| `docs/08-support-operations-manual.md` | Support — escalation tree, common incidents |
| `docs/09-user-stories-test-cases.md` | QA — user stories and acceptance tests |
| `docs/10-api-reference.md` | Developers — internal and public v1 API |
| `docs/11-security-architecture.md` | Security — RBAC, multi-auth, audit, fail-closed design |
| `docs/12-deployment-guide.md` | Sysadmins — macOS and Linux install walkthroughs |
| `docs/13-release-notes.md` | Everyone — what changed in each release |
| `docs/14-data-dictionary.md` | Engineers — the SQLite schema in detail |
| `docs/15-vps-deployment-quickstart.md` | Sysadmins — generic VPS quickstart |
| `docs/17-troubleshooting-guide.md` | Everyone — common issues and fixes |
| `docs/18-developer-manual.md` | Developers — every subsystem, every decision, every file |
| `docs/19-api-mcp-integration-guide.md` | Developers — public API and MCP integration |
| `docs/20-product-roadmap.md` | Everyone — what's shipped, what's next |
| `docs/21-project-history.md` | Everyone — the full story of how ClawNex came to be |
| `docs/22-keyboard-shortcuts.md` | Everyone — keyboard navigation reference |
| `docs/23-help-surfaces-index.md` | Content, Engineering — where each help asset lives |
| `docs/24-security-assessment.md` | Security — audit findings + remediation status |

**Supplementary design documents:**

- `docs/correlation-engine-design.md` — Correlation engine and risk scoring
- `docs/ai-voice-avatar-design.md` — AI voice and avatar stack
- `docs/clawnex-brochure.md` — Enterprise buyer brochure
- `docs/clawnex-operator-series-outline.md` — Training video series outline
- `docs/infographic-prompts.md` — Infographic generation prompts

## Getting started

**Requirements:** Node.js 22+, Python 3.12, macOS or Linux. Run `install.sh`, answer a few prompts, get a working install.

```bash
git clone https://github.com/clawnexai/clawnex.git && cd clawnex
bash install.sh
```

`install.sh` walks you through:

1. **Install mode** — `[1]` Linux bare-metal (systemd + Caddy + Let's Encrypt) or `[2]` macOS local (dev/testing)
2. **Domain** — your public DNS name (or `localhost` for local-only)
3. **AI provider** — OpenRouter / OpenAI / Anthropic / Skip (configure later)
4. **Confirm** — the installer generates fresh secrets, writes config, builds the Next.js bundle, installs systemd units + Caddy (Linux), and starts everything

When it finishes, it prints your one-time setup URL — open it in a browser to create the admin account.

### Path 1 — Linux bare-metal, Ubuntu 24.04 (~15-25 min)

Prereqs (one-time):

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git python3 python3-pip python3-venv cron sqlite3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
```

Then `bash install.sh`, pick mode `[1]`, enter your domain. Requires a public DNS A-record pointed at the host for LE HTTP-01.

### Path 2 — macOS local (~10-15 min)

```bash
brew install node@22 python git
bash install.sh
```

Pick mode `[2]`, accept `localhost` as the domain. Open `http://localhost:5001/setup` when ready.

### Setup URL + admin creation

install.sh generates a one-time SETUP_SECRET, writes it to .env.local, and prints a setup URL of the form https://<host>/setup?secret=<setup-secret>. Open it to create your admin account in the Welcome Wizard.

**Lost the URL?** Recover the value from `.env.local` on the host using your operator-approved secret-retrieval procedure, then append it as `?secret=<setup-secret>` to your `/setup` URL.

Operator authentication (RBAC) is ON by default. For a localhost-only dev machine you can set `RBAC_ENABLED=false` + `NEXT_PUBLIC_RBAC_ENABLED=false` to skip login, but the server logs a WARN on every boot and this is unsafe for any network-reachable host.

### Dev mode (working on the source)

```bash
git clone https://github.com/clawnexai/clawnex.git && cd clawnex
npm install
(cd litellm && python3.12 -m venv venv && source venv/bin/activate && pip install -r requirements.txt)
npm run dev   # http://localhost:5001
```

## Contributing

ClawNex uses **DCO (Developer Certificate of Origin)** sign-off on commits. Every commit must be signed:

```bash
git commit -s -m "Your commit message"
```

The `-s` flag appends a `Signed-off-by:` line that certifies the commit complies with the DCO. See `CONTRIBUTING.md` for the full contributor workflow.

## Security

Found a vulnerability? Please report responsibly — see `SECURITY.md` for the disclosure process. Do not file public issues for security bugs.

## Support Channels

### Community (Available Now)

- **Documentation.** The 24-document suite in `docs/` plus supplementary design documents
- **GitHub issues.** For bug reports, feature requests, and questions (on public repository cutover)
- **DCO-signed contributions.** Pull requests welcome under the Apache 2.0 + DCO model — see `CONTRIBUTING.md`

### Commercial Support (Roadmap)

Commercial support tiers with priority response SLAs, implementation services, and custom rule authoring are on the commercial roadmap. Contact `sales@clawnexai.com` for early-access conversations.

### Reporting Security Issues

Security vulnerabilities MUST be reported via the process described in `SECURITY.md`. Do not file security-sensitive issues as public GitHub issues.

## License

ClawNex is released under the **Apache License 2.0** with a **Developer Certificate of Origin (DCO)** sign-off requirement on contributions. The Apache 2.0 license includes an explicit patent grant from every contributor. The full license text lives in `LICENSE` at the repository root (added at public cutover). All code under `src/` is covered.

## Acknowledgments

- **LiteLLM** (BerriAI) — the proxy engine beneath ClawNex
- **Nous Research Hermes-Agent** — inspiration and integration target (v0.5.5+)
- **Elder Pliny** — jailbreak threat-intel that informs the shield rule set
- **Next.js + React + SQLite** communities — the foundations we build on

---

*A ClawNex Project — clawnexai.com*
*Last Updated: 2026-05-08*
