<p align="center">
  <img src="public/clawnex-icon-dark.png" alt="ClawNex logo" width="160">
</p>

<h1 align="center">ClawNex</h1>

<p align="center"><strong>One nexus. Total control.</strong></p>

<p align="center">
  <a href="https://github.com/ClawNexAi/clawnex/actions/workflows/ci.yml"><img src="https://github.com/ClawNexAi/clawnex/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ClawNexAi/clawnex/actions/workflows/codeql.yml"><img src="https://github.com/ClawNexAi/clawnex/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache 2.0"></a>
  <a href="DCO"><img src="https://img.shields.io/badge/Sign--off-DCO-brightgreen" alt="DCO"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.15.5--alpha-orange" alt="Version 0.15.5-alpha"></a>
</p>

ClawNex is a runtime security control plane for AI agent fleets. It sits between agents and model providers, scans model traffic, surfaces fleet risk, tracks cost, governs operator access, and preserves audit evidence when something goes wrong.

- Website: [clawnexai.com](https://clawnexai.com)
- Documentation: [docs.clawnexai.com](https://docs.clawnexai.com)
- Product gallery: [clawnexai.com/gallery](https://clawnexai.com/gallery)
- Current version: `0.15.5-alpha`
- Status: public alpha, functional and under active development

## Getting Started

ClawNex supports macOS local installs, macOS server installs, and Linux/VPS installs.

Requirements:

- Node.js 22+
- Python 3.10+; Python 3.12 is validated
- Git
- macOS or Linux

```bash
git clone https://github.com/ClawNexAi/clawnex.git clawnex
cd clawnex
bash install.sh
```

The installer detects the host, recommends an install mode, asks you to confirm the deployment approach, configures auth, builds ClawNex, and starts the service layer for the selected mode.

| Path | Use it for | Start here |
|---|---|---|
| **macOS local** | Evaluation, local testing, development | `bash install.sh`, choose Local, then choose RBAC or localhost-only mode |
| **macOS server** | Hosting from a Mac with server-style auth | `bash install.sh`, choose Server, provide the domain |
| **Linux/VPS** | Public-facing server with systemd, Caddy, HTTPS | `bash install.sh`, confirm VPS mode, provide the domain |

When RBAC is enabled, the installer prints a one-time setup URL. Open it to create the first admin account.

For production details, use the [deployment guide](docs/12-deployment-guide.md), [VPS quickstart](docs/15-vps-deployment-quickstart.md), and [troubleshooting guide](docs/17-troubleshooting-guide.md).

### Uninstall

From the ClawNex checkout:

```bash
bash scripts/uninstall.sh
```

Or from anywhere, pass the install path explicitly:

```bash
bash ~/clawnex/scripts/uninstall.sh ~/clawnex
```

## Why ClawNex

AI agents are not just chat windows. They call tools, cross trust boundaries, touch secrets, route through providers, and create operational questions that are hard to answer after the fact:

- What did the agent send to the model?
- Was the prompt malicious, encoded, or trying to exfiltrate data?
- Which agents, channels, providers, and sessions were affected?
- Who changed policy, acknowledged an alert, accepted a risk, or used break-glass?
- Can the team prove what happened?

ClawNex gives operators a single place to see, scan, control, and audit those flows.

## What It Does

| Capability | Operator outcome |
|---|---|
| **Mission Control** | Fleet posture, critical alerts, policy coverage, evidence confidence, cost risk, and top actions in one cockpit. |
| **Prompt Shield** | 163 built-in detections for jailbreaks, prompt injection, exfiltration, credential exposure, steganography, unsafe commands, and sensitive paths. |
| **Fleet Command** | Live instance health, active agents, sessions, service status, gateway state, and threat trends. |
| **Connector Routing** | Selective OpenClaw and Hermes custom-provider routing through LiteLLM for real-time Prompt Shield scanning, with read-only handling for OAuth/session-bound traffic. |
| **Traffic Monitor** | Every model request tracked with source, model, provider, verdict, score, latency, tokens, and status. |
| **Correlations** | Multi-signal findings from shield events, traffic, alerts, audit events, cost signals, trust audit, and blast radius data. |
| **Blast Radius** | Trust-boundary and channel exposure analysis: who can reach agents, what they can do, and where risk concentrates. |
| **Host Security** | Built-in host checks, OpenClaw CVE awareness, remediation guidance, and posture scoring. |
| **Access Control** | RBAC, operator roles, auth methods, break-glass, risk acceptance, and audited administrative actions. |
| **Token & Cost Intel** | Model, provider, agent, and session cost visibility with drain signals for abnormal spend patterns. |
| **Evidence & Reporting** | Audit trail, incident evidence, executive reports, compliance artifacts, and exportable records. |

<details>
<summary><strong>Detailed capability notes</strong></summary>

### Command And Triage

- **Mission Control + Triage Graph** is the operator cockpit. It combines KPIs, operational posture, alert aging, policy coverage, source freshness, and a top action queue. Queue rows can expand into a staged triage graph: Evidence -> Source Event -> Affected Object -> Related Activity -> Fix / Control.
- **Alerts & Incidents** provides severity triage, ack/take/resolve workflows, suppression controls, and investigation links.
- **Correlation Engine** detects multi-event patterns across shield scans, traffic, audit events, alerts, cost signals, collector health, trust audit, blast radius, auth/RBAC, CVE/update, and policy-warning sources.

### Shield And Traffic

- **Prompt Shield** scans inbound and outbound model traffic through built-in ClawNex Shield Rules and enabled operator-authored policy rules.
- Verdicts are `ALLOW`, `REVIEW`, or `BLOCK`.
- **Shield Tests** provide a repeatable validation suite for detection coverage.
- **Traffic Monitor** records model traffic with source, model, provider, verdict, score, latency, token counts, status, and filterable investigation metadata.
- **OpenAI-compatible endpoint**: `POST /api/v1/chat/completions` with inline shield scanning and LiteLLM forwarding.

### Policy, Trust, And Blast Radius

- **Configurable Rule & Policy Framework** supports operator-authored DLP rules, literal or guarded-regex matching, per-rule actions, exceptions, and RBAC-gated policy management.
- **Trust Boundary Audit** discovers reachable surfaces, models trust risk, produces findings, and provides remediation guidance.
- **Blast Radius** models channel exposure, agent reachability, dangerous tool combinations, configuration mistakes, and confidence labels.
- **Risk Acceptance** supports scoped acceptances with deterministic evidence signatures so changed evidence can invalidate stale acceptance decisions.

### Identity, Access, And Evidence

- **RBAC** ships with Admin, Security Manager, Operator, Viewer, and Auditor roles.
- **Authentication options** include local credentials, WebAuthn passkeys, GitHub OAuth, and email-delivered Magic Link when a mail provider is configured.
- **Break-glass** is available for emergencies with reason capture, lifecycle tracking, and audit evidence.
- **Audit & Evidence** records security-sensitive configuration changes, auth events, policy actions, shield events, break-glass actions, and investigation context.

### Cost, Reports, And Operations

- **Token & Cost Intel** tracks OpenClaw, Hermes, Paperclip, and direct/API activity with source trust labels and drain detectors such as loop risk, velocity spike, context bloat, cache drop, and simple-on-expensive routing.
- **Executive Reports** provide security, incident, operational, compliance, and governance report exports.
- **Infrastructure** tracks ClawNex, LiteLLM Proxy, OpenClaw Gateway, model providers, and local service health.
- **Scheduled Reports** can deliver daily, weekly, or monthly summaries through configured mail providers.

### Developer And Integration Surface

- **MCP Server** exposes ClawNex tools to compatible AI clients.
- **API surface** includes internal dashboard APIs and public v1 endpoints.
- **LiteLLM integration** provides the model proxy layer and ClawNex callback logging.

</details>

## How It Works

At a high level:

1. Agents send model traffic through a local LiteLLM proxy.
2. ClawNex scans prompts and responses before the request completes.
3. Verdicts, traffic, alerts, correlations, cost signals, and audit events land in the local ClawNex database.
4. Operators use the dashboard to investigate, tune policy, manage access, and export evidence.

For architecture details, start with the [high-level architecture](docs/02-high-level-architecture.md), then use the [low-level architecture](docs/03-low-level-architecture.md) and [security architecture](docs/11-security-architecture.md).

## Tech Stack

- **Next.js 16** App Router
- **React 18**
- **SQLite** with `better-sqlite3`, WAL mode, migrations, and retention controls
- **LiteLLM 1.84.10** as the upstream proxy
- **TypeScript** across the app and API layer
- **Python** for LiteLLM callback logging and related service utilities
- **Tailwind CSS** and a self-hosted UI/font asset model
- **Caddy** for public Linux/VPS HTTPS deployments

## Enterprise Readiness

| Capability | Status | Notes |
|---|---|---|
| RBAC | Shipped | 5 operator roles with policy, audit, and admin permissions |
| Session authentication | Shipped | Configurable TTL and local admin setup |
| WebAuthn passkeys | Shipped | Touch ID, Windows Hello, and security-key style flows |
| GitHub OAuth | Shipped | Admin-enabled and operator-linked |
| Magic Link | Shipped | Requires a configured mail provider |
| Immutable audit trail | Shipped | Security-sensitive activity is recorded for evidence |
| Scheduled reports | Shipped | Daily, weekly, monthly delivery options |
| Trust Boundary Audit | Shipped | Findings, matrix, surfaces, and remediation views |
| Caddy HTTPS | Shipped | Public Linux/VPS deploy path with generated Caddyfile |
| Supply-chain pinning | Shipped | Pinned LiteLLM and exact npm dependencies |
| SBOM generation | Shipped | `npm run sbom` / `scripts/generate-sbom.sh` support |
| Policy framework | Shipped | Built-in mirror, outbound starter rules, and custom rules |
| SOC 2 / ISO 27001 evidence | Shipped templates | Executive report and governance artifacts |
| SSO / SAML | Planned | Roadmap |
| Custom roles | Planned | Roadmap |
| High availability | Planned | Roadmap |
| External SIEM integration | Planned | Roadmap |
| Webhook notifications | Planned | Roadmap |
| Multi-tenant isolation | Planned | Roadmap |

## Deployment Options

| Option | Status | Notes |
|---|---|---|
| macOS local | Shipped | Best for evaluation and development |
| macOS server | Shipped | Server-style mode on macOS |
| Linux/VPS | Shipped | systemd, Caddy, HTTPS, public-domain auth defaults |
| Air-gapped / on-premises | Supported | Self-hosted runtime with local assets |
| Managed cloud | Planned | Commercial roadmap |

## Documentation

| Need | Start here |
|---|---|
| Install ClawNex | [Deployment guide](docs/12-deployment-guide.md) |
| Deploy on a VPS | [VPS deployment quickstart](docs/15-vps-deployment-quickstart.md) |
| Learn the dashboard | [Basic user manual](docs/06-basic-user-manual.md) |
| Configure advanced controls | [Advanced user manual](docs/07-advanced-user-manual.md) |
| Understand the architecture | [High-level architecture](docs/02-high-level-architecture.md) |
| Review security design | [Security architecture](docs/11-security-architecture.md) |
| Review validation posture | [Security validation summary](docs/security-validation-summary.md) |
| Integrate with APIs or MCP | [API and MCP guide](docs/19-api-mcp-integration-guide.md) |
| Troubleshoot a host | [Troubleshooting guide](docs/17-troubleshooting-guide.md) |
| Track what changed | [Release notes](docs/13-release-notes.md) and [changelog](CHANGELOG.md) |

<details>
<summary><strong>Full numbered documentation suite</strong></summary>

| Doc | Audience |
|---|---|
| `docs/01-infrastructure-design.md` | Sysadmins — runtime topology, ports, services |
| `docs/02-high-level-architecture.md` | Everyone — the 10-minute system overview |
| `docs/03-low-level-architecture.md` | Engineers — module and data layer design |
| `docs/04-product-requirements.md` | Product and Engineering — current scope |
| `docs/05-reconstruction-playbook.md` | Engineers — rebuild and recovery guidance |
| `docs/06-basic-user-manual.md` | Operators — dashboard operation |
| `docs/07-advanced-user-manual.md` | Power users — shield tuning, RBAC, break-glass |
| `docs/08-support-operations-manual.md` | Support — escalation and common incidents |
| `docs/09-user-stories-test-cases.md` | QA — user stories and acceptance tests |
| `docs/10-api-reference.md` | Developers — API reference |
| `docs/11-security-architecture.md` | Security — auth, RBAC, audit, fail-closed design |
| `docs/12-deployment-guide.md` | Sysadmins — install walkthroughs |
| `docs/13-release-notes.md` | Everyone — release notes |
| `docs/14-data-dictionary.md` | Engineers — SQLite schema |
| `docs/15-vps-deployment-quickstart.md` | Sysadmins — VPS quickstart |
| `docs/16-deployment-test-walkthrough.md` | Operators — deployment validation |
| `docs/17-troubleshooting-guide.md` | Everyone — common issues and fixes |
| `docs/18-developer-manual.md` | Developers — implementation reference |
| `docs/19-api-mcp-integration-guide.md` | Developers — public API and MCP integration |
| `docs/20-product-roadmap.md` | Everyone — roadmap |
| `docs/21-project-history.md` | Everyone — project history |
| `docs/22-keyboard-shortcuts.md` | Everyone — keyboard navigation |
| `docs/23-help-surfaces-index.md` | Content and Engineering — help assets |
| `docs/security-validation-summary.md` | Security — public validation summary |
| `docs/security-assessment-summary.md` | Security — public assessment summary |
| `docs/security-roadmap.md` | Security — public roadmap and maturity items |

</details>

## Development

For source development:

Use Node.js 22 for local development. It is the safest recommended install target; newer Node releases may work, but they can run ahead of native dependency engine support and produce warnings.

```bash
git clone https://github.com/ClawNexAi/clawnex.git clawnex
cd clawnex
npm install
(cd litellm && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt)
npm run dev
```

The development server runs at `http://localhost:5001`.

Useful commands:

```bash
npm run build
npm run lint
npm run sbom
```

## Versioning

ClawNex follows Semantic Versioning with pre-release stages:

| Stage | Meaning | Guarantees |
|---|---|---|
| `alpha` | Feature-complete within current scope; still changing | No backward-compatibility guarantee across minor versions |
| `beta` | Stable API surface under evaluation | Breaking changes only with deprecation notice |
| `GA` | Generally available | SemVer guarantees; breaking changes only in major versions |

`0.15.5-alpha` is public alpha software. APIs, configuration keys, and operational workflows may change before GA.

## Contributing

Contributions are welcome. ClawNex uses Developer Certificate of Origin sign-off on commits:

```bash
git commit -s -m "Describe your change"
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor workflow.

## Security

Please do not open public issues for security-sensitive bugs. Use the responsible disclosure process in [SECURITY.md](SECURITY.md).

## Support

- Documentation: [docs.clawnexai.com](https://docs.clawnexai.com) and `docs/`
- Issues: [GitHub Issues](https://github.com/ClawNexAi/clawnex/issues)
- Commercial and general inquiries: `contact@clawnexai.com`

## License

ClawNex is released under the [Apache License 2.0](LICENSE) with [DCO](DCO) sign-off required for contributions. Third-party attribution lives in [NOTICE](NOTICE).

## Acknowledgments

- **LiteLLM** — proxy engine used by ClawNex
- **Nous Research Hermes-Agent** — inspiration and integration target
- **Elder Pliny** — jailbreak threat-intel that informs the shield rule set
- **Next.js, React, SQLite, and Caddy** communities

---

ProBizSystems — [clawnexai.com](https://clawnexai.com)
