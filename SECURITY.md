# Security Policy

ClawNex is an AI Agent Fleet Security Operations Center (SOC). Security is the product — we take vulnerability reports seriously.

## Supported Versions

During the alpha phase (v0.x), only the **latest minor release** receives security fixes. Earlier alpha versions are considered obsolete and will not be patched. Users on older versions should upgrade.

| Version | Supported |
|---|---|
| v0.15.0-alpha | Yes (current). Latest public validation summary reports no open Critical, High, or Medium findings in the tested public-launch posture. |
| v0.14.x-alpha and earlier | No. Upgrade to the latest public release. |

Once v1.0 ships, the last two minor releases will be supported in parallel.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

### How to report

Email your report to **security@clawnexai.com** with the subject line:

```
[SECURITY] Short description of the issue
```

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
- Vulnerabilities in LiteLLM itself (pinned to v1.84.10 — report to BerriAI/litellm)
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
| `SETUP_SECRET` | One-shot; zeroed (rendered inert) after the first admin is created. Regenerate only for fresh deployments (e.g. bootstrapping a new environment). **Handling discipline:** the deploy script writes the setup URL to its stdout and log file — treat that artifact as secret-bearing. Do not paste it into shared chat, screenshots, or CI logs. To retrieve the secret server-side post-deploy: `ssh <user>@<host> 'grep SETUP_SECRET ~/clawnex/.env.local'`. If the stored value is ever exposed before the first admin claims it, wipe `.env.local`, generate a new value with `openssl rand -hex 32`, restart the dashboard (`systemctl restart clawnex-dashboard`), and complete setup. Once setup is complete, the original setup URL is inert — but rotate anyway if you suspect exposure before claim. |
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

ClawNex maintains a security validation and code-review program. The latest public validation summary reports **zero open Critical, High, or Medium findings** in the tested public-launch posture.

Public evidence artifacts:

- `docs/security-validation-summary.md` — public validation summary
- `docs/security-assessment-summary.md` — public assessment summary
- `docs/security-roadmap.md` — security roadmap and maturity items
- `docs/registers/risk-register.md` — public risk posture summary
- `docs/policy-evidence-checklist.md` — public policy evidence map

External independent validation, including third-party penetration testing, is still planned and is tracked in the public security roadmap.

## Bug Bounty

ClawNex does not currently have a paid bug bounty program. If that changes, this section will be updated.

## PGP / Signed Communication

We do not currently publish a PGP key. If your report contains sensitive details that require end-to-end encryption, email the placeholder above and we will establish a secure channel.

---

*Thank you for helping keep ClawNex and its users safe.*
