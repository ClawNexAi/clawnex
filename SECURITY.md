# Security Policy

ClawNex is an AI Agent Fleet Security Operations Center (SOC). Security is the product — we take vulnerability reports seriously.

## Supported Versions

During the alpha phase (v0.x), only the **latest minor release** receives security fixes. Earlier alpha versions are considered obsolete and will not be patched. Users on older versions should upgrade.

| Version | Supported |
|---|---|
| v0.15.0-alpha | Yes (current — chat-relay scan-equals-forward invariant via shared sanitize+rebuild allowlist on `/api/v1/chat/completions` + `/api/chat`; 13-commit hardening pass closing 5 Codex adversarial rounds plus internal reviewer round-4 BLOCKER; 2026-05-17 DAST Run 3 clean pass on staging host — zero CRITICAL / HIGH / MEDIUM open findings. Risk register R-037 (provider DNS rebinding, closed via hostname allowlist) and R-040 (chat-relay scan-vs-forward divergence, opened and closed in the same pass) both resolved. 137 assertions across 8 new Codex-class verifiers. New operator-extensible env vars: `TRUST_PROXY_HEADERS`, `TRUSTED_HOSTS`, `TRUSTED_PROVIDER_HOSTS`. Documented residual AR-001 (CSP `style-src-attr 'unsafe-inline'`) remains accepted and queued as the final gate before public OSS launch. Full DAST evidence: `docs/qa/dast-run-3-2026-05-17.md`. LIVE on `https://<qa-host>`.) |
| v0.14.5-alpha | Yes — Triage Graph end-to-end across 9 source families; Mission Control cockpit; Tailscale-native deploy path; 2026-05-13/14 security hardening pass + 2026-05-14 DAST Round 15 remediation pass — 50+ findings closed across R13/R14/multi-vector/live-DAST reviews. Docker mode removed, RBAC fail-closed, nonce-based CSP, MCP HTTP key auth, NFKC shield, SSRF guards, sameSite=strict, rate-limiter persistence, requireLocalhost Origin/Referer enforcement, 21 Pattern-B GET routes hardened, login timing-oracle envelope, anonymous info-leak reduction across `/api/auth/status` + `/api/v1/health` + forgot-password, `Cache-Control: no-store` on `/api/*`, security header dedup with Caddy `-Via`/`-Server` strip, shield steg-rule raw-text scan, audit actor accuracy in RBAC-off, outbound shield gate on `/api/chat` direct paths. Full DAST evidence: `docs/qa/dast-remediation-2026-05-14.md`. (Superseded by v0.15.0-alpha 2026-05-17.) |
| v0.11.0-v0.11.6 | Yes (security fixes only — upgrade to v0.14.5+ strongly recommended; pre-dates the 2026-05-13 hardening pass) |
| v0.10.0 | Yes (security fixes only — upgrade to v0.14.5+ strongly recommended; Configurable Rule & Policy Framework v1, operator-authored DLP rules) |
| v0.9.0-v0.9.2 | Yes (security fixes only — upgrade to v0.14.5+ strongly recommended) |
| v0.8.x | Yes (security fixes only) |
| v0.7.x | Yes (security fixes only) |
| v0.6.x and earlier | No — upgrade |

Once v1.0 ships, the last two minor releases will be supported in parallel.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

### How to report

Email your report to **security@clawnexai.com** with the subject line:

```
[SECURITY] Short description of the issue
```

*(Placeholder — the canonical disclosure contact will be confirmed before the public repo cutover. Until then, contact the project owner directly via the channel you already know.)*

### What to include

Please provide the following information in your report so we can triage quickly:

- **Affected version(s)** — exact version string from `/api/health` (e.g. `0.9.0-alpha`)
- **Affected component** — which subsystem (Shield Engine, Proxy Route Handler, API endpoint, Dashboard UI, MCP Server, LiteLLM callback, etc.)
- **Vulnerability type** — what category it falls under (e.g. command injection, XSS, SSRF, authentication bypass, denial of service, information disclosure, prompt injection)
- **Impact** — what an attacker could do if this were exploited
- **Reproduction steps** — exact steps a person with a clean ClawNex install could follow to trigger the issue
- **Proof of concept** — code, payload, screenshots, or video if available
- **Your suggested fix** (optional but appreciated)
- **Credit preference** — how you'd like to be credited in the release notes (name, handle, anonymous, or "do not credit")

### What to expect

- **Acknowledgment** within **72 hours** of receipt
- **Initial triage and severity assessment** within **7 days**
- **Fix timeline** depends on severity:
  - Critical (pre-auth RCE, auth bypass, data exfiltration): target **7 days**
  - High (authenticated RCE, privilege escalation, shield bypass): target **14 days**
  - Medium (information disclosure, CSRF, stored XSS): target **30 days**
  - Low (reflected XSS, minor information leaks, best-practice issues): target **60 days**
- **Coordinated disclosure** — we aim to ship a patch before public disclosure. If you've set a disclosure deadline, tell us in your initial report and we'll work with you to meet it
- **Credit** in our release notes and changelog (unless you request otherwise)

## Scope

The following components are in scope for the security program:

- **Dashboard (`src/`)** — every route, component, API endpoint, and middleware
- **Shield engine (`src/lib/shield/`)** — rule evaluation, scoring, verdict generation, bypass conditions
- **Proxy integration (`litellm/clawnex_logger.py`)** — callback handling, data serialization, permission boundary
- **MCP server (`src/mcp/`)** — tool definitions, resource handlers, auth
- **Auth/RBAC routes (`src/app/api/auth/`)** — authentication and role-based access control, including multi-auth providers (passkey + GitHub OAuth + Magic Link, latter live in v0.9.2)
- **Multi-auth provider modules (`src/lib/services/auth/`)** — challenge store, credentials service, local/passkey/github provider implementations
- **Operator management (`src/app/api/config/operators/`)** — operator CRUD and configuration
- **Session service (`src/lib/services/session-service.ts`)** — session lifecycle and token handling
- **Public API (`src/app/api/v1/`)** — versioned endpoints with API key auth, rate limiting, scope enforcement
- **Deploy scripts (`deploy/`, `setup.sh`, `scripts/`)** — installer, uninstaller, update flows

The following are **out of scope**:

- Third-party dependencies (report upstream — we'll bump the pinned version when a patched release is available)
- Vulnerabilities in LiteLLM itself (pinned to v1.83.0 — report to BerriAI/litellm)
- Self-inflicted configuration errors (e.g. exposing the dashboard to the public internet without a reverse proxy)
- Social engineering of ClawNex users or maintainers
- DoS via resource exhaustion on a single-node deployment (this is the operator's scaling responsibility, not a vulnerability)
- Vulnerabilities requiring physical access to the host

## Safe Harbor

We support **good-faith security research**. If you:

- Report vulnerabilities promptly through the channel above
- Avoid privacy violations, destruction of data, or service interruption during testing
- Do not exploit a vulnerability beyond what is necessary to demonstrate it
- Give us reasonable time to address the issue before public disclosure

...then we will not pursue legal action against you for your research, and will credit you in our advisories.

## Secret Rotation

ClawNex holds several production secrets. Operators should establish rotation procedures as part of SOC 2 CC6.1 controls. The table below documents the rotation steps for each secret ClawNex uses.

| Secret | Rotation procedure |
|---|---|
| `SETUP_SECRET` | One-shot; zeroed (rendered inert) after the first admin is created. Regenerate only for fresh deployments (e.g. bootstrapping a new environment). **Handling discipline:** the deploy script writes the setup URL to its stdout and log file — treat that artifact as secret-bearing. Do not paste it into shared chat, screenshots, or CI logs. To retrieve the secret server-side post-deploy: `ssh <user>@<host> 'grep SETUP_SECRET ~/clawnex/.env.local'`. If the stored value is ever exposed before the first admin claims it, wipe `.env.local`, generate a new value with `openssl rand -hex 32`, restart the dashboard (`systemctl restart clawnex-dashboard`), and complete setup. Once `operatorCount: 0` flips to `1` in `/api/auth/status`, any leaked setup URL is inert — but rotate anyway if you suspect exposure before claim. |
| `SESSION_SECRET` (if present) | Rotating invalidates every active dashboard session — plan a maintenance window. Generate a new 32-byte random string, update `.env.local`, restart the dashboard (`systemctl restart clawnex-dashboard`), and notify operators that they must sign in again. |
| `CLAWNEX_INGEST_SECRET` | Used by the LiteLLM callback logger to POST to `/api/v1/ingest`. Generate a new secret, update both `.env.local` (dashboard) and any LiteLLM proxy config that references it, then `systemctl restart clawnex-*` (dashboard and LiteLLM). Until both sides are updated, ingest events will be rejected as 401. |
| `RESEND_API_KEY` | Revoke the old key in the Resend dashboard, create a new one, update `.env.local` (or the value in Configuration → Mail if stored there), restart the dashboard. |
| `SMTP_PASS` | Rotate the password at your SMTP provider, update via Configuration → Mail (persists to `config_defaults` — no restart needed). The new password takes effect on the next `sendMail` call. |
| `LITELLM_MASTER_KEY` | Rotate in `litellm/config.yaml`, restart the LiteLLM service (`systemctl restart clawnex-litellm`), and update any downstream proxy clients (Claude Code, Codex, Cursor) that authenticated with the old master key. |
| API keys (Configuration → API Keys) | Revoke the key in the UI, create a new one with the same scopes, and hand the plaintext off to the consumer. No service restart is required — revocation takes effect on the next request. |

### Rotation cadence

- **Annually, at minimum** — rotate every production secret at least once per year, even absent any compromise signal. Calendar it (e.g. first Monday of January).
- **Immediately on suspicion of compromise** — treat any unexpected egress, unknown-device session, leaked commit, or third-party breach notification as a rotation trigger. Prefer over-rotation to under-rotation.
- **Immediately after staff departure** — when an operator with access to production secrets leaves the team, rotate every secret they could have read. This includes `.env.local` values and the LiteLLM master key.

Document each rotation (secret name, date, actor) in your internal change log so the audit trail survives beyond what ClawNex's own audit_log records.

## Security Posture

ClawNex maintains a continuous DAST + code-review program. The most recent assessment (2026-05-17 DAST Run 3, paired with the Codex 6-round adversarial closure and internal reviewer round-4 BLOCKER fix) ran against `<qa-host>` (staging host, RBAC on, production-like) and returned **zero CRITICAL / HIGH / MEDIUM open findings**. Two documented residuals remain accepted with explicit retest conditions: AR-001 (CSP `style-src-attr 'unsafe-inline'`) and AR-002 (Pattern-B same-host trust under RBAC-off). Both are tracked in `docs/qa/accepted-residuals.md`.

External independent validation (penetration test, third-party audit) is **not** yet completed and is tracked as R-017 in `docs/registers/risk-register.md`, targeted for Q3 2026 before any enterprise pilot.

Evidence artifacts:
- `docs/qa/dast-run-3-2026-05-17.md` — DAST Run 3 canonical evidence (most recent)
- `docs/qa/accepted-residuals.md` — AR-001 and AR-002 accepted residuals with retest conditions
- `docs/qa/dast-remediation-2026-05-14.md` — Round 15 evidence (historical, superseded by Run 3)
- `docs/24-security-assessment.md` — round-by-round security review history
- `docs/registers/risk-register.md` — open + closed risks with priority
- `docs/policy-evidence-checklist.md` — SOC-aligned control evidence map

## Bug Bounty

ClawNex does not currently have a paid bug bounty program. If that changes, this section will be updated.

## PGP / Signed Communication

We do not currently publish a PGP key. If your report contains sensitive details that require end-to-end encryption, email the placeholder above and we will establish a secure channel.

---

*Thank you for helping keep ClawNex and its users safe.*
