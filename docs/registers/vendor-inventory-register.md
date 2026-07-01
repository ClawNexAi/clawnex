# ClawNex Vendor Inventory Register

Document ID: CLAWNEX-REG-001
Version: 1.2
Date Created: 2026-04-22
Last Updated: 2026-05-05
Owner: Project owner
Purpose: Track external vendors, service providers, and critical third-party software dependencies that affect the confidentiality, integrity, availability, or supply-chain posture of ClawNex.

## How this register is organized

Vendors and dependencies are grouped by relationship to the product:

1. **Bundled runtime software dependencies** — ship inside the ClawNex image/package. Supply-chain posture matters on every release.
2. **Embedded runtime platforms** — interpreters/images the app runs inside.
3. **Optional external service integrations** — operator opts in per deployment via API keys or URLs. Data exposure depends on whether the operator enables them.
4. **Source code and distribution platforms** — where ClawNex code, issues, and packages live.
5. **Deployment infrastructure (operator choice)** — hosts, DNS, edge. These are the operator's vendors, not the project's, but relevant for the reference VC demo / staging host QA deployment until OSS handoff.

Fields captured:
- Vendor / component name
- Service provided
- Integration pattern (how ClawNex touches it)
- Data touched
- Criticality
- Owner
- Contract / DPA status
- Security / compliance notes
- Next review

Status values for DPA / Contract:
- `OSS — no DPA applicable` — open-source dependency; supply-chain review instead of contractual review
- `Platform ToS — standard` — relying on public terms of service; acceptable in alpha, DPA likely required before enterprise pilots
- `DPA not yet executed — required before pilot` — service is used and a DPA is needed before handling enterprise data
- `Not in use` — listed for completeness; no current exposure

---

## 1. Bundled runtime software dependencies

Ship inside the ClawNex deployment. Pinned versions, reviewed per release.

| Component | Version (pinned) | Service Provided | Data Touched | Criticality | Owner | Contract / DPA | Security / Compliance Notes | Next Review |
|---|---|---|---|---|---|---|---|---|
| Next.js (`next`) | 14.2.35 | Application framework and HTTP server | All request/response data | High | Project owner | OSS — no DPA applicable | Deferred 15.x upgrade tracked as audit finding H-5 / risk R-004. SBOM includes full subtree. | 2026-05-31 |
| React / React DOM | 18 | UI rendering | Rendered dashboard state | High | Project owner | OSS — no DPA applicable | Meta OSS; upgraded with Next.js. | 2026-05-31 |
| `better-sqlite3` | 12.8.0 | Embedded database driver | Full ClawNex DB (events, audit, sessions, secrets metadata) | High | Project owner | OSS — no DPA applicable | Native compile dependency; requires `build-essential python3` on Linux hosts. | 2026-05-31 |
| `bcryptjs` | 2.4.3 | Password hashing for RBAC | Operator password hashes | High | Project owner | OSS — no DPA applicable | Hash-only — no plaintext retained. Rotation policy in Cryptographic Controls Policy. | 2026-05-31 |
| `nodemailer` | 8.0.5 | SMTP transport for password reset | Email metadata + content | Medium | Project owner | OSS — no DPA applicable | Upgraded 6.10.1 → 8.0.5 as audit fix H-6. TLS cert verification enforced (fix H-3). | 2026-05-31 |
| `resend` | 4.1.2 | Managed email delivery wrapper | Email metadata + content | Medium | Project owner | OSS — no DPA applicable | Loaded only when `RESEND_API_KEY` is set; pairs with Resend service integration below. | 2026-05-31 |
| `ws` | 8.20.0 | WebSocket server library | Real-time dashboard/gateway frames | Medium | Project owner | OSS — no DPA applicable | Companion `bufferutil` 4.1.0 / `utf-8-validate` 6.0.6. | 2026-05-31 |
| `zod` | 4.3.6 | Input schema validation | API request bodies | Medium | Project owner | OSS — no DPA applicable | Primary input boundary for trusted validation. | 2026-05-31 |
| `zustand` | 5.0.12 | Client state store | In-memory UI state | Low | Project owner | OSS — no DPA applicable | No sensitive persistence. | 2026-05-31 |
| `uuid` | 13.0.0 | Identifier generation | IDs for sessions/events | Low | Project owner | OSS — no DPA applicable | Standard use. | 2026-05-31 |
| `@heygen/liveavatar-web-sdk` | 0.0.12 (exact) | Voice avatar client SDK | Microphone audio + HeyGen session tokens | Medium | Project owner | OSS — paired with HeyGen service DPA (see §3) | Pinned exact (caret was removed as SOC 2 quick win). Feature opt-in. | 2026-05-31 |
| LiteLLM (proxy framework) | `litellm[proxy]==1.84.10` | AI proxy/gateway framework | All proxied prompt/response traffic | High | Project owner | OSS — no DPA applicable | Hard-pinned and security-reviewed after upstream supply chain and proxy advisories. Future bumps require explicit verification. Tracked in risk R-003/R-004 watch. | 2026-07-01 |
| `httpx` (for LiteLLM) | 0.28.1 | HTTP client for LiteLLM | Outbound provider traffic | High | Project owner | OSS — no DPA applicable | Pinned as part of LiteLLM lock. | 2026-05-31 |

## 2. Host runtime platforms

Required on the operator's host for the Linux bare-metal or macOS install paths.

| Component | Version | Service Provided | Data Touched | Criticality | Owner | Contract / DPA | Security / Compliance Notes | Next Review |
|---|---|---|---|---|---|---|---|---|
| Node.js | 22 LTS | JavaScript runtime for dashboard | All app runtime | High | Project owner | OSS — no DPA applicable | Installed on the host via nodesource (Linux) or Homebrew (macOS). Vulnerability tracking via host package manager. | 2026-05-31 |
| Python 3.12 | 3.12 | Runtime for LiteLLM proxy venv | Proxy-side data | High | Project owner | OSS — no DPA applicable | Installed on the host via apt (Linux) or Homebrew (macOS); LiteLLM venv created under `litellm/venv/`. | 2026-05-31 |
| Caddy 2 | 2.x | TLS ingress / reverse proxy for Linux bare-metal deployments | All request/response data in transit | High | Project owner | OSS — no DPA applicable | Replaces manual nginx/TLS setup for operators. Let's Encrypt automation (see §3). | 2026-05-31 |

## 3. Optional external service integrations

Operator enables these via `.env.local` or Configuration panel. When disabled, no data leaves the deployment for that provider.

| Vendor | Service Provided | Integration Pattern | Data Touched | Criticality | Owner | Contract / DPA | Security / Compliance Notes | Next Review |
|---|---|---|---|---|---|---|---|---|
| OpenRouter | Multi-model routing provider | LiteLLM upstream; `OPENROUTER_API_KEY` in `.env.local` (v0.6.2 moved out of launchd plist) | Prompts, responses, metadata, billing | High (when enabled) | Project owner | Platform ToS — standard; DPA not yet executed — required before pilot | Most commonly enabled provider in the operator's reference deployments. Review their retention / logging defaults. | 2026-05-15 |
| Anthropic | Claude model provider | LiteLLM upstream via `ANTHROPIC_API_KEY` or through OpenRouter | Prompts, responses, metadata | High (when enabled) | Project owner | Platform ToS — standard; DPA not yet executed — required before pilot | Often reached via OpenRouter in current deployments; direct integration supported. | 2026-05-15 |
| OpenAI | GPT model provider | LiteLLM upstream via `OPENAI_API_KEY` or through OpenRouter | Prompts, responses, metadata | High (when enabled) | Project owner | Platform ToS — standard; DPA not yet executed — required before pilot | Supported but not currently the primary routing target. | 2026-05-15 |
| LM Studio (local) | Self-hosted model inference server | HTTP to `LMSTUDIO_*_URL`, default `http://localhost:1234/v1` | Prompts, responses | Medium | Project owner | N/A — runs on operator's own host | No external data egress. Treat as part of operator's infrastructure. | 2026-05-31 |
| Resend | Transactional email | `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Recipient email addresses, reset links, report content | Medium (when enabled) | Project owner | Platform ToS — standard; DPA not yet executed — required before pilot | Used only for password reset and report delivery. Disabled by default. | 2026-05-15 |
| HeyGen | Real-time avatar / presenter | Client SDK `@heygen/liveavatar-web-sdk` + `/api/voice/heygen` | Microphone audio, session tokens | Medium (when enabled) | Project owner | Platform ToS — standard; DPA not yet executed — required before pilot | Off by default; only enabled when operator configures voice avatar. | 2026-05-15 |
| D-ID | Avatar / presenter alternative | `/api/voice/did` | Avatar config, session data | Medium (when enabled) | Project owner | Platform ToS — standard; DPA not yet executed — required before pilot | Off by default; alternative to HeyGen. | 2026-05-15 |
| Let's Encrypt / ISRG | ACME TLS certificate issuance (Linux bare-metal prod) | Via Caddy `CLAWNEX_DOMAIN` | Domain name, certificate metadata | Medium | Project owner | ISRG Subscriber Agreement (accepted by Caddy automation) | Only engaged when operator sets `CLAWNEX_DOMAIN`. Local-dev uses Caddy internal CA. | 2026-05-31 |
| Hermes agent | Self-hosted governance companion | HTTP to `HERMES_HOME`/`HERMES_URL` when configured | Plan/task metadata | Low (when enabled) | Project owner | N/A — sibling project owned by the operator | Not a third party for most purposes; listed here because it shows up in deployments. | 2026-05-31 |

## 4. Source code and distribution platforms

Supply-chain platforms ClawNex depends on for code, packaging, and release.

| Vendor | Service Provided | Data Touched | Criticality | Owner | Contract / DPA | Security / Compliance Notes | Next Review |
|---|---|---|---|---|---|---|---|---|
| GitHub (Microsoft) | Source hosting, issue tracking, CI, release artifacts | Source code, issues, release metadata, maintainer access | High | Project owner | Platform ToS — standard | Branch protection + required review required before OSS launch. 2FA enforced on maintainer account. | 2026-05-15 |
| npm registry | JavaScript dependency distribution | Package manifests, tarballs | High | Project owner | N/A (public registry) | Full dependency tree captured in SBOM (CycloneDX). Integrity via npm lock + pinned versions. | 2026-05-15 |
| PyPI | Python dependency distribution (LiteLLM + httpx) | Package manifests | High | Project owner | N/A (public registry) | Pinned + `pip install --no-deps` pattern for LiteLLM to block transitive drift. | 2026-05-15 |

## 5. Deployment infrastructure (operator choice / reference deployments)

These are the operator's own vendors. Listed here because they apply to the reference deployments run by the operator for VC demos and QA before OSS launch.

| Vendor | Service Provided | Where It Applies | Data Touched | Criticality | Owner | Contract / DPA | Security / Compliance Notes | Next Review |
|---|---|---|---|---|---|---|---|---|
| VPS | Reference QA/demo VPS (staging host) | staging host only | System storage, logs, traffic metadata | High (for staging host specifically) | Project owner | Standard VPS provider terms | Not a product-level vendor. demo host is frozen per 2026-04-11 decision; relevant until OSS handoff shifts deployment to operators. | 2026-05-15 |
| Local Mac (test host) | Primary development + demo workstation | test host only | Full source, `.env.local`, dev DB | High (for test host specifically) | Project owner | N/A | Owner-controlled. Governance relevance: FileVault + screen lock + full-disk encryption baseline. | 2026-05-31 |
| Local Linux (local dev host) | Internal dev box for bare-metal install validation | local dev host only | Test deployments | Medium | Project owner | N/A | macOS dev box; Linux smoke testing performed on staging host. | 2026-05-15 |

## Removed from previous version

The following entries from v1.0 are removed because the code audit on 2026-04-22 showed they are not in use:

- **Cloudflare / DNS / edge** — no code or deployment reference in the current tree.

Entries were reclassified:

- **VPS provider** moved from generic "Vendor" to "Deployment infrastructure — reference deployments" because it is the operator's VPS, not a product-level dependency.
- **Nodemailer / better-sqlite3 / LiteLLM** moved into §1 (bundled dependencies) with version pins.

## Notes

- All entries dated 2026-04-22 reflect the v0.6.2-alpha audit state. Underlying vendor list re-verified on 2026-05-05 against current `package.json` / `.env.example` / `litellm/requirements.txt` at v0.11.6-alpha — no new vendors added or removed. Before any formal compliance assessment, confirm status per entry.
- "DPA not yet executed — required before pilot" is the standard status for external services during alpha. Resolving these contractually is part of the pilot-readiness gate, not the OSS-readiness gate.
- Supply-chain controls (SBOM, pinned versions, integrity hashes) substitute for contracts in the OSS-dependency column. That's appropriate for public ecosystems but should be reviewed at every release.

## Change Log

| Date | Editor | Summary |
|---|---|---|
| 2026-04-22 | internal reviewer | v1.0 — initial seeded register for governance handoff. |
| 2026-04-22 | Claude | v1.1 — reconciled against live `package.json`, `.env.example`, `docker-compose.yml`, `litellm/requirements.txt`, and source grep. Added pinned versions, grouped by integration type, removed Cloudflare (not in use), reclassified VPS provider as reference deployment. |
| 2026-05-05 | Internal reviewer | v1.2 — re-verification pass at v0.11.6-alpha. Re-confirmed every entry against current `package.json`, `.env.example`, `docker-compose.yml`, `litellm/requirements.txt`. No new vendors and no retirements since v1.1. Added the v0.11.6-alpha annotation to the "All entries dated 2026-04-22..." note so the reconciliation date is explicit. Last Updated bumped 2026-04-22 → 2026-05-05. |
| 2026-05-13 | Internal reviewer | v1.3 — Docker install path removed for v1.0 OSS launch. Section 2 relabeled "Embedded runtime platforms" → "Host runtime platforms"; `node:22-slim`, `python3.12 (Debian slim)`, `caddy:2-alpine`, and `tini` rows replaced with host-package framing (Node 22 via apt/Homebrew, Python 3.12, Caddy 2). §4 Docker Hub row removed. §5 local dev host row reframed (no Docker smoke-test). LE row reframed (Linux bare-metal prod). |
