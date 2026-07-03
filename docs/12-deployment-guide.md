# ClawNex Deployment Guide

**Document ID:** CLAWNEX-DEP-001
**Version:** 2.4
**Classification:** Confidential
**Last Updated:** 2026-05-14
**Product Version:** v0.15.5-alpha
**Status:** Living Document

---

## 1. Document Purpose

This guide provides step-by-step instructions for deploying ClawNex on a new machine. It is intended for IT staff and deployment engineers setting up the platform for a customer or new environment.

For reconstruction from scratch (disaster recovery), see the Reconstruction Playbook (CLAWNEX-REC-001).

---

## 2. Deployment Prerequisites

### 2.1 Hardware Requirements

| Requirement | Minimum | Recommended |
|------------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Disk | 10 GB free | 50+ GB (depends on retention settings) |
| Architecture | x86_64 or arm64 | arm64 (Apple Silicon) for current builds |

### 2.2 Software Requirements

| Software | Version | Installation |
|----------|---------|-------------|
| macOS | 13+ (Ventura or later) | Pre-installed |
| Node.js | 18+ | `brew install node` or [nodejs.org](https://nodejs.org) |
| npm | 9+ | Included with Node.js |
| Python | 3.12 | `brew install python@3.12` |
| Homebrew | Latest | [brew.sh](https://brew.sh) |
| Git | Any | `xcode-select --install` |
| SQLite | 3.x | Included with macOS |

### 2.3 Network Requirements

| Connection | Required? | Purpose |
|-----------|-----------|---------|
| LM Studio Fleet (LAN) | Yes (for local models) | Model inference |
| Internet | Optional | OpenRouter API, future cloud models |
| OpenClaw instance | Yes | Agent fleet to monitor |

### 2.4 Credentials Required

| Credential | Required? | Source |
|-----------|-----------|--------|
| OpenClaw Gateway token | Recommended | From `~/.openclaw/openclaw.json` on the agent host |
| OpenRouter API key | Optional | From [openrouter.ai](https://openrouter.ai) dashboard |
| LM Studio API key | No | Uses static "lmstudio-local" |
| HeyGen API key | Optional | From [heygen.com](https://heygen.com) dashboard — for floating avatar |
| ElevenLabs API key | Optional | From [elevenlabs.io](https://elevenlabs.io) dashboard — for TTS voice |

---

## 3. Installation Steps

### Step 1: Clone or Copy the Project

```bash
# If from git repository:
git clone <repository-url> ~/sentinel
cd ~/sentinel

# If from archive:
tar xzf clawnex-v0.6.2-alpha.tar.gz -C ~/
cd ~/sentinel
```

### Step 2: Install Node.js Dependencies

```bash
cd ~/sentinel
npm ci
# If no package-lock.json available:
npm install
```

Verify: `ls node_modules/.package-lock.json` should exist.

### Step 3: Set Up Python Environment

```bash
cd ~/sentinel/litellm
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
```

Verify: `~/sentinel/litellm/venv/bin/python3 -c "import litellm; print(litellm.version)"` should print `1.84.10`.

### Step 4: Configure Environment

```bash
cp ~/sentinel/.env.example ~/sentinel/.env.local
```

Edit `~/sentinel/.env.local` with your environment's values:

```bash
# Required
PORT=5001
DATABASE_PATH=./sentinel.db
OPENCLAW_SESSIONS_PATH=/path/to/openclaw/agents/main/sessions
SESSION_WATCHER_ENABLED=true
SESSION_WATCHER_INTERVAL_MS=2000

# Recommended
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=<your-token>

# Model providers (adjust IPs for your network)
LMSTUDIO_FLEET_URL=http://<fleet-ip>:1234/v1
LMSTUDIO_FLEET_NAME=LM Studio Fleet
LMSTUDIO_MAIN_URL=http://<main-ip>:1234/v1
LMSTUDIO_MAIN_NAME=LM Studio Main

# Optional integrations
AUTENSA_URL=http://127.0.0.1:4000
AUTENSA_TOKEN=<your-token>
PAPERCLIP_URL=http://127.0.0.1:3100
```

### Step 5: Configure LiteLLM

Edit `~/sentinel/litellm/config.yaml`:
- Update `api_base` URLs to match your LM Studio IPs
- Update OpenRouter API key reference if using cloud models

Edit `~/sentinel/litellm/start.sh`:
- Update `OPENROUTER_API_KEY` export with your key
- Verify `CLAWNEX_API_URL` points to correct dashboard URL

### Step 6: Set File Permissions

```bash
chmod 600 ~/sentinel/.env.local
chmod 600 ~/sentinel/sentinel.db 2>/dev/null  # May not exist yet
chmod 700 ~/sentinel/litellm/start.sh
chmod 700 ~/sentinel/scripts/watchdog.sh
```

### Step 7: Build and Start Services (Production Mode)

For production deployments, use `next build && next start` instead of `next dev`. The production build is faster, more stable, and uses less memory.

> **⚠ Install-order gotcha — DO NOT SKIP.** `.env.local` MUST exist before you run `npm run build`. Next.js's optimizer evaluates server-side `process.env.X` references at build time when they appear in module-top-level constants (like `src/lib/config.ts`). If you build before writing `.env.local`, expressions like `process.env.RBAC_ENABLED === 'true'` get baked as `false` into the compiled bundle, even if the runtime env is set correctly. Symptoms: `/api/auth/status` returns `rbacEnabled: false` despite `RBAC_ENABLED=true` in `.env.local`; `/setup` redirects to `/login` because `needsSetup` is gated on `rbacEnabled`. **Always: write `.env.local` first, then `npm run build`. If you discover this after the fact: rebuild with the env present and restart the service.**

```bash
# 1. .env.local FIRST (see Step 6 above for content + secret generation)
# 2. then build
cd ~/sentinel && npm run build

# Terminal 1: Dashboard (production)
cd ~/sentinel && npm start

# Terminal 2: LiteLLM
cd ~/sentinel/litellm && bash start.sh
```

> **Note:** For development/debugging, you can still use `npm run dev` for hot-reload support — `next dev` reads `.env.local` on every request, so the build-order trap doesn't apply there.

### Step 8: Verify

```bash
# Dashboard health
curl -s http://127.0.0.1:5001/api/health | python3 -m json.tool

# LiteLLM health
curl -s http://127.0.0.1:4001/health

# Open in browser
open http://127.0.0.1:5001
```

### Step 9: Run Post-Install Verification

Run the automated verification script to confirm all components are healthy:

```bash
bash ~/sentinel/scripts/verify.sh
```

The script checks: Dashboard and LiteLLM health endpoints, database integrity, watchdog cron entry, file permissions on sensitive files, LiteLLM version (must be 1.84.10), and session watcher path. All checks should report **PASS**. Investigate any **FAIL** items before proceeding.

### Step 10: First-Run — Work the Welcome Wizard

Open `http://127.0.0.1:5001` (or your VPS address) in a browser. On a fresh install, Fleet Command loads the **Welcome Wizard** — a 6-step checklist that replaces the classic "run these commands in a terminal" walkthrough. Every step has an in-UI action button; nothing needs to be copy-pasted into a shell.

| # | Step | Action in the Wizard |
|---|------|----------------------|
| 1 | Install ClawNex | Auto-ticked |
| 2 | Add an AI model provider | **Open Configuration** → Model Providers card opens and scrolls into view |
| 3 | Enable Host Security | **Verify Now** (POSTs to `/api/system/install-clawkeeper`) or **Open Updates panel** for the manual path |
| 4 | Sync CVE database | **Sync Now** (POSTs to `/api/cve/sync`) |
| 5 | Configure OpenClaw routing | **Open Configuration** → OpenClaw Routing card opens and scrolls into view. A blue info box appears if `openclaw.json` has zero LLM providers registered — register one in OpenClaw first. Hermes routing is managed later from the separate Hermes Routing card. |
| 6 | Run first shield test | **Open Shield Tests** → run the 27-payload suite to confirm rules are firing |

Step 6 is intentionally last. The wizard stays visible on every browser refresh until every step is complete AND the operator clicks **Get Started →** on the Setup Complete screen. The dismissal flag is written to `config_defaults.wizard_dismissed` so it persists across browsers and sessions.

For operators who prefer to pre-sync CVEs from the shell (e.g. automated provisioning), the wizard also accepts the data from a manual sync:

```bash
# Optional: trigger CVE sync from the shell instead of the wizard
curl -X POST http://127.0.0.1:5001/api/cve/sync

# Verify (should return 108 CVEs)
curl -s http://127.0.0.1:5001/api/cve | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{d.get(\"total\", 0)} CVEs loaded')"
```

The wizard will automatically mark step 4 as complete once the sync has run.

### Step 11: Configure HeyGen & ElevenLabs (Optional)

If using the floating avatar guide feature:

1. Go to Configuration tab in the dashboard
2. Under Voice & Avatar, enter your HeyGen API key (for LiveAvatar)
3. Enter your ElevenLabs API key (for TTS narration)
4. Select your preferred avatar and voice

The floating avatar provides tour narration and panel-aware Q&A.

### Step 12: Install Watchdog

```bash
mkdir -p ~/sentinel/logs
chmod +x ~/sentinel/scripts/watchdog.sh
echo "*/5 * * * * /Users/$(whoami)/sentinel/scripts/watchdog.sh" | crontab -

# Verify
crontab -l
```

### Step 13: Choose OpenClaw Routing Through ClawNex

Open Configuration → OpenClaw Routing and review **OpenClaw Selective Routing**:

- Tick the OpenClaw providers/models that should route through ClawNex.
- Click **Apply OpenClaw Routing**.
- Restart OpenClaw Gateway from the same card if prompted.

OpenClaw enforces this at provider endpoint level. Selecting a model routes that model's provider through `http://127.0.0.1:4001/v1`; if other models share the same provider, they follow that provider route as well.

### Step 14: Choose Hermes Routing Through ClawNex

Open Configuration → Hermes Routing and review the Hermes provider inventory:

- Tick writable Hermes `custom_providers` or model rows that should route through ClawNex.
- Click **Save Hermes Wire**.
- Click **Restart Gateway** so the detected Hermes gateway supervisor reloads provider configuration.
- Use **Revert Hermes Wire** to restore ClawNex-managed Hermes provider edits. Operator edits made after the wire are preserved.

Hermes uses provider-level routing for writable `custom_providers` in `~/.hermes/config.yaml`. Hermes OAuth/session-bound and watcher-only rows remain read-only retrospective inventory.

---

## 4. Post-Deployment Configuration

### 4.1 Shield Whitelist

Fresh installs ship with `proxy_block_mode = 'on'` (block-by-default — safe posture
per the 2026-05-13 hardening pass). If you want a 24-48 hour observation window
before the shield refuses traffic:

1. Go to Prompt Shield tab → Configuration
2. Flip block mode to **observe** (logs but doesn't block)
3. Monitor traffic for false positives from agent system prompts
4. Manage the Rule Whitelist to suppress legitimate-but-noisy detections
5. Flip block mode back to **on** when confident

### 4.2 Block Mode

The shield ships in block mode by default. When tuning is complete or you want to
confirm the posture:

1. Go to Configuration tab
2. Toggle Shield Block Mode to ON

### 4.3 Data Retention

Set retention periods based on your compliance requirements:

1. Go to Configuration tab → Data Retention
2. Set each category appropriately
3. Save

**SOC 2 recommendation:** Audit Trail = 365 days or Unlimited. Alerts = 365 days.

### 4.4 Gateway Token Configuration

Configure the OpenClaw gateway token so ClawNex can connect to your agent fleet:

1. Locate the gateway token on the agent host: `cat ~/.openclaw/openclaw.json` (look for the `token` field)
2. In the ClawNex dashboard, go to **Configuration** tab
3. Expand the **Gateways** section
4. Enter the token in the **Gateway Token** field
5. Click **Save**

Alternatively, set `OPENCLAW_GATEWAY_TOKEN` in `~/sentinel/.env.local` and restart the dashboard.

**Verify:** Go to the **Infrastructure** tab -- the OpenClaw gateway should show **ONLINE** (green).

### 4.5 Verify OpenClaw Routing

Confirm that agent traffic is flowing through ClawNex for scanning:

1. Go to **Configuration** tab
2. Expand the **OpenClaw Routing** panel
3. Each provider should show a routing status:
   - **ROUTED** -- Traffic flows through the LiteLLM proxy (port 4001) and is scanned by the shield
   - **DIRECT** -- Traffic goes directly to the provider, bypassing ClawNex

At least one provider must show **ROUTED** for ClawNex to provide real-time OpenClaw protection. If all providers show **DIRECT**, verify that the agent fleet is configured to use `http://127.0.0.1:4001/v1` as its model endpoint (see Step 13). For Hermes, use the separate **Hermes Routing** panel (see Step 14).

### 4.6 Verify Watchdog

```bash
# Kill dashboard to test recovery
kill $(lsof -ti :5001)
# Wait up to 5 minutes
# Check if it came back
curl -s http://127.0.0.1:5001/api/health
# Check watchdog log
tail -10 ~/sentinel/logs/watchdog.log
```

---

## 5. Production Deployment Considerations

### 5.1 Running as Background Services

For production, always use `next build && next start` instead of `next dev`. The production build provides better performance, stability, and lower memory usage.

```bash
# Dashboard (production build — recommended)
cd ~/sentinel
npm run build
nohup npm start > logs/dashboard.log 2>&1 &

# LiteLLM
nohup bash ~/sentinel/litellm/start.sh > ~/sentinel/logs/litellm.log 2>&1 &
```

### 5.2 Process Management (Optional)

For more robust process management, consider using `pm2`:

```bash
npm install -g pm2

# Dashboard
pm2 start npm --name "clawnex-dashboard" -- start

# LiteLLM
pm2 start ~/sentinel/litellm/start.sh --name "clawnex-litellm" --interpreter bash

# Auto-start on boot
pm2 startup
pm2 save
```

### 5.3 HTTPS / Reverse Proxy

For HTTPS or remote access, ClawNex v0.6.1+ recommends **Caddy** for automatic TLS certificate provisioning. nginx is still supported as an alternative.

#### 5.3.1 Caddy (Recommended — auto-TLS)

Caddy automatically provisions and renews TLS certificates via ACME/Let's Encrypt. No manual certificate management is required.

**Prerequisites:** A public domain name pointing to your host, port 80 and 443 open inbound.

**Install Caddy:**
```bash
brew install caddy
```

**Caddyfile (`/etc/caddy/Caddyfile` or `~/sentinel/Caddyfile`):**
```
clawnex.yourdomain.com {
    reverse_proxy 127.0.0.1:5001 {
        flush_interval -1   # Required for SSE
    }
}
```

**Start Caddy:**
```bash
caddy run --config ~/sentinel/Caddyfile
# Or as a system service:
sudo caddy start --config /etc/caddy/Caddyfile
```

**Configure via dashboard API:**
```bash
# Enable via API (requires system:manage or localhost)
curl -X POST http://127.0.0.1:5001/api/system/https \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "domain": "clawnex.yourdomain.com", "tlsMode": "auto"}'

# Check status
curl http://127.0.0.1:5001/api/system/https
```

**Notes:**
- Caddy automatically redirects HTTP (port 80) to HTTPS (port 443) when a site block declares a hostname — no extra config needed.
- Caddy enables HSTS (`Strict-Transport-Security`) automatically for HTTPS sites. To adjust `max-age` or `includeSubDomains`, add an explicit `header Strict-Transport-Security` directive.
- Certificate auto-renewal runs in the background every 12 hours; renewals are attempted 30 days before expiry. Monitor via `/api/system/https` (see Ops Manual section 14.3).
- The cookie `secure` flag is automatically set when ClawNex detects a TLS/HTTPS request — no additional environment variable required.
- SSE (`/api/events/stream`) requires `flush_interval -1` (Caddy's equivalent of disabling response buffering).
- After enabling Caddy, update `NEXT_PUBLIC_APP_URL` in `.env.local` to the HTTPS domain and rebuild.

**Security header ownership (M1 + L1 — 2026-05-14).** Since DAST Round 15, **Next.js is the single source of truth** for X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and Strict-Transport-Security (including `preload`). Caddy should NOT re-emit these — doing so used to produce duplicate response headers with the worst-case gotcha that HSTS values diverged. If you write your own Caddyfile, mirror the production install:

```
clawnex.yourdomain.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:5001 {
        flush_interval -1
    }
    header {
        # Strip Caddy proxy fingerprint (DAST L1 2026-05-14).
        -Via
        -Server
    }
}
```

The production install script (`deploy/install-prod.sh`) writes this shape automatically; the minimal example above is for operators handcrafting their own Caddy config.

For restricted administrative exposure, keep the dashboard bound to loopback and reach it through SSH/Tailscale/VPN. Public VPS mode assumes Caddy owns the public edge and ClawNex enforces application-layer authentication and RBAC.

#### 5.3.2 nginx (Alternative)

nginx is still supported but Caddy is now preferred. Certificates must be managed manually (e.g., via certbot).

```nginx
server {
    listen 443 ssl;
    server_name clawnex.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_buffering off;  # Required for SSE
    }
}
```

#### 5.3.3 Path A — Tailscale-only test boxes (v0.14.5+)

For private test / demo boxes that should be reachable only inside a tailnet — no public DNS, no Cloudflare, no Let's Encrypt rate-limit exposure on the public CA — ClawNex supports a Tailscale-issued LE cert via DNS-01 challenge. This is faster and cleaner than Path B (the public-domain Caddy + Let's Encrypt workflow used by staging host / <qa-host>) for anything that doesn't need a brand-domain URL.

**When to use Path A:** private test boxes, demo boxes operator wants gated to the tailnet, anything where operators are happy typing `https://<machine>.<tailnet>.ts.net` instead of a custom domain.

**When to use Path B (the existing public-domain workflow above):** public-facing deployments (staging host, customer-prod), or any host where the URL needs to match a brand domain. Path B is unchanged and remains the default.

**Path A prerequisites:**

1. **Tailscale HTTPS feature enabled** on the tailnet (admin console → DNS → HTTPS Certificates). One-time per tailnet.
2. **Box on the tailnet** as a node, with a stable Tailscale IP (`100.x.y.z`) and resolvable MagicDNS FQDN (`<machine>.<tailnet>.ts.net`).
3. **SSH key auth** from the deployer's Mac to the box (the deploy script uses `BatchMode=yes`, no SSH password).
4. **Sudo password known** for the SSH-connected user.
5. **Repo HEAD includes the v0.14.5 patches** — commit `c7393d3` adds `.ts.net` auto-detect to `install-prod.sh` and `$USER:$USER` parameterization to `deploy-prod.sh`. Without these, the deploy aborts on the public DNS preflight and chowns to a non-existent `<operator-user>` user.

**Deploy command:**

```bash
cd ~/sentinel
echo "<sudo-password>" | bash scripts/deploy-prod.sh \
  --host <user>@<tailscale-ip> \
  --domain <machine>.<tailnet>.ts.net \
  --version <package.json version> \
  --sudo-pass-stdin
```

The patched `install-prod.sh` detects the `.ts.net` suffix, skips the public DNS preflight, and proceeds. ClawNex installs cleanly. Caddy gets installed and started — but Caddy's auto-HTTPS will fail trying to issue LE for `.ts.net`, which is expected. The hand-finish below replaces the failing Caddyfile.

**Hand-finish step (Path-A-specific):**

After the deploy script returns, SSH into the box and run the following heredoc to issue the Tailscale cert, drop a Tailscale-aware Caddyfile (with `auto_https off`, explicit `tls` paths, and `bind` to the Tailscale interface for defense-in-depth), and install a weekly renewal timer:

```bash
ssh <user>@<tailscale-ip> "SUDOPW='<sudo-password>' bash -s" <<'REMOTE'
set -uo pipefail

# askpass shim so SUDOPW never lands on a process argv
ASKPASS=$(mktemp /tmp/.askpass-XXXXXX); chmod 700 "$ASKPASS"
cat > "$ASKPASS" <<EOF
#!/bin/bash
echo '$SUDOPW'
EOF
export SUDO_ASKPASS="$ASKPASS"
trap 'rm -f "$ASKPASS"' EXIT
sudo -A -v

TS_IP=$(tailscale ip -4)
FQDN=$(hostname).<TAILNET>.ts.net   # OR hardcode the FQDN here

# 1. Issue the Tailscale cert
sudo -A mkdir -p /var/lib/caddy/certs
sudo -A tailscale cert \
  --cert-file /var/lib/caddy/certs/${FQDN}.crt \
  --key-file  /var/lib/caddy/certs/${FQDN}.key \
  ${FQDN}
sudo -A chown -R caddy:caddy /var/lib/caddy/certs

# 2. Overwrite Caddyfile — auto_https off, explicit tls paths, bind to Tailscale interface
sudo -A tee /etc/caddy/Caddyfile > /dev/null <<CADDYFILE
# CLAWNEX-MANAGED — Tailscale-cert variant.
{
    auto_https off
}

${FQDN} {
    bind ${TS_IP}
    tls /var/lib/caddy/certs/${FQDN}.crt /var/lib/caddy/certs/${FQDN}.key
    encode zstd gzip
    reverse_proxy 127.0.0.1:5001 {
        flush_interval -1
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "geolocation=(), microphone=(), camera=()"
    }
}
CADDYFILE

sudo -A caddy validate --config /etc/caddy/Caddyfile
sudo -A systemctl reload caddy

# 3. Drop systemd renewal timer (weekly; tailscale cert is idempotent)
sudo -A tee /etc/systemd/system/tailscale-cert-renew.service > /dev/null <<UNIT
[Unit]
Description=Renew Tailscale cert for ClawNex
After=tailscaled.service
[Service]
Type=oneshot
ExecStart=/usr/bin/tailscale cert --cert-file /var/lib/caddy/certs/${FQDN}.crt --key-file /var/lib/caddy/certs/${FQDN}.key ${FQDN}
ExecStartPost=/bin/chown -R caddy:caddy /var/lib/caddy/certs
ExecStartPost=/bin/systemctl reload caddy
UNIT

sudo -A tee /etc/systemd/system/tailscale-cert-renew.timer > /dev/null <<TIMER
[Unit]
Description=Renew Tailscale cert weekly
[Timer]
OnCalendar=weekly
Persistent=true
[Install]
WantedBy=timers.target
TIMER

sudo -A systemctl daemon-reload
sudo -A systemctl enable --now tailscale-cert-renew.timer
REMOTE
```

**Verify (must be on the same tailnet):**

```bash
curl -sI https://<FQDN>/ -o /dev/null -w "HTTP %{http_code}\nTLS verify: %{ssl_verify_result}\n"
curl -s -o /dev/null -w "/api/health %{http_code}\n" https://<FQDN>/api/health
echo | openssl s_client -connect <FQDN>:443 -servername <FQDN> 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
```

Expect HTTP 307 (redirect to /login) at root, HTTP 200 at /api/health, TLS verify 0 (no `-k` needed), issuer `Let's Encrypt`, subject matching the FQDN, validity ~90 days.

First-run admin: the deploy script prints a one-time setup URL of the form https://<host>/setup?secret=<setup-secret>. Open it once to claim the admin account. If the URL is lost before claim, recover the secret using your operator-approved host-secret procedure.

> **Setup-secret hygiene.** The deploy script writes the setup URL to its stdout / log file. Treat that log as a secret-bearing artifact: do not paste it into shared chat, screenshots, or CI logs. If you need the secret after the deploy, read it server-side from the host's `.env.local` via your approved procedure rather than re-printing it. Once the first admin completes setup (`needsSetup: false` in `/api/auth/status`), the `/setup` route refuses the secret and any leaked URL becomes inert — rotate per your operator-approved key-rotation procedure if you suspect exposure before claim.

**Common gotchas:**
- `tailscale cert` returns "not enabled" — the tailnet doesn't have HTTPS Certificates enabled in the admin console.
- Caddy fails to bind on the Tailscale IP — confirm `tailscale ip -4` returned a real IP and matches the `bind` directive.
- Cert files unreadable by Caddy — chown to `caddy:caddy` after `tailscale cert`. The renewal timer's `ExecStartPost` does this automatically.
- Loopback HTTPS on `127.0.0.1` returns 000 — that's correct; `bind <ts-ip>` makes Caddy listen only on the Tailscale interface. Verify health via the Tailscale FQDN, not loopback.

**First validated:** 2026-05-08 on Enterprise (FQDN `<tailscale-hostname>`, Tailscale IP `<tailscale-ip>`, operator label redacted).

### 5.4 Self-Hosted Fonts

ClawNex v0.5.4-alpha uses self-hosted woff2 font files instead of Google Fonts CDN links. This means the dashboard works fully offline and does not make external font requests. The fonts (JetBrains Mono, DM Sans, Plus Jakarta Sans) are bundled in the `public/fonts/` directory. No additional configuration is needed.

### 5.5 Log Rotation

For long-running deployments, set up log rotation:

```bash
# /etc/newsyslog.d/clawnex.conf (macOS)
/Users/<user>/sentinel/logs/watchdog.log   644  5  1024  *  J
/Users/<user>/sentinel/logs/dashboard.log  644  3  5120  *  J
/Users/<user>/sentinel/logs/litellm.log    644  3  5120  *  J
```

### 5.6 RBAC Deployment Configuration

ClawNex supports role-based access control (RBAC) to restrict dashboard access to authenticated operators. When enabled, all routes require login and permissions are enforced per-role.

#### 5.6.1 RBAC Environment Variables

Add the following to `~/sentinel/.env.local`:

```bash
# --- RBAC (Role-Based Access Control) ---

# Enable operator login and role-based permissions
RBAC_ENABLED=true

# Required for the Edge Runtime middleware (must match RBAC_ENABLED)
NEXT_PUBLIC_RBAC_ENABLED=true

# Optional — require this secret during initial admin creation
# Recommended for network-exposed deployments to prevent unauthorized setup
SETUP_SECRET=<your-setup-secret>

# Session duration in hours (default: 24)
SESSION_TTL_HOURS=24

# Maximum concurrent sessions per operator (default: 5)
MAX_SESSIONS_PER_OPERATOR=5

# Legacy lockout threshold — progressive lockout now handles this automatically (default: 10)
ACCOUNT_LOCKOUT_THRESHOLD=10

# Login attempts per minute per IP (default: 5)
LOGIN_RATE_LIMIT=5

# --- Mail (Password Reset) ---

# Mail provider: "disabled" | "resend" | "smtp" (default: disabled)
MAIL_PROVIDER=disabled

# Sender address for password reset emails
MAIL_FROM=noreply@example.com

# Resend provider (if MAIL_PROVIDER=resend)
RESEND_API_KEY=<your-resend-api-key>

# SMTP provider (if MAIL_PROVIDER=smtp)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=<your-smtp-username>
SMTP_PASS=<your-smtp-password>
```

> **Important:** `RBAC_ENABLED` and `NEXT_PUBLIC_RBAC_ENABLED` must always match. The server-side variable controls API route protection while the `NEXT_PUBLIC_` variant is required for the Edge Runtime middleware to enforce redirects on the client side.

#### 5.6.2 First-Time Setup Flow

1. Set `RBAC_ENABLED=true` and `NEXT_PUBLIC_RBAC_ENABLED=true` in `~/sentinel/.env.local`
2. Rebuild the application:
   ```bash
   cd ~/sentinel && npm run build
   ```
3. Start the dashboard (`npm start` or `node server.js`)
4. Navigate to the dashboard in your browser — you will be redirected to `/setup`
5. Create the initial admin account (username, optional email, password)
6. If `SETUP_SECRET` is configured, navigate to `/setup?secret=<your-setup-secret>` instead — the setup page will reject requests without the correct secret
7. After setup, log in and create additional operators via **Configuration** → **Operator Management**

### 5.7 Multi-Auth Providers (v0.9.0+)

ClawNex v0.9.0 added two sign-in providers alongside the local password; v0.9.2 promoted Magic Link from placeholder to live:

| Provider | Status | Operator self-enrolls? | Admin enables? |
|---|---|---|---|
| Local password | Always on (break-glass) | n/a | n/a |
| WebAuthn passkeys | Always available | Yes — Auth & Devices card | No toggle needed |
| GitHub OAuth | Off by default | No (admin must link first) | Yes — Authentication Methods card |
| Magic Link (v0.9.2) | Off by default | No enrollment — uses operator email | Yes — Authentication Methods card AND mail provider must be configured |

**Local password remains the break-glass identifier on every account.** Even after enrolling a passkey or linking GitHub, the password keeps working — there is no path to lock yourself out by losing a passkey.

#### 5.7.1 WebAuthn / Passkeys — TLS is mandatory

The WebAuthn spec (and every modern browser) refuses passkey enrollment over plain HTTP. The only exceptions are `localhost` and `127.0.0.1`. **Production deployments MUST be served over HTTPS** or passkey enrollment will fail with a generic browser error.

The Caddy reverse-proxy package (configured by `deploy/install-prod.sh` for Linux bare-metal) gives you valid TLS automatically via Let's Encrypt. If you front ClawNex with your own ingress (nginx, Traefik, AWS ALB, etc.), make sure the URL the browser sees is HTTPS.

Set these environment variables to the **public** URL the browser will see (not the upstream port Next.js binds locally):

```bash
# WebAuthn relying-party identity. Must match the URL the browser uses.
AUTH_RP_ID=clawnex.example.com              # registrable domain only — no scheme, no port, no path
AUTH_RP_NAME=ClawNex                         # human-friendly name shown in the OS passkey UI
AUTH_EXPECTED_ORIGIN=https://clawnex.example.com   # full origin (scheme + host + port if non-default)
```

Defaults assume `localhost:5001` for local dev, which only works without TLS because of the `localhost` exception.

If `AUTH_RP_ID` or `AUTH_EXPECTED_ORIGIN` doesn't match what the browser sends, every WebAuthn ceremony fails verification — the failure message in the browser is generic, so the symptom is "passkey enrollment / sign-in just doesn't work" with no useful clue.

#### 5.7.2 GitHub OAuth — admin enables + provisions

GitHub sign-in is **off by default** even when credentials are present. To turn it on:

1. **Register a GitHub OAuth app** at <https://github.com/settings/developers> → "New OAuth App"
   - Application name: e.g. "ClawNex (production)"
   - Homepage URL: `https://clawnex.example.com`
   - Authorization callback URL: `https://clawnex.example.com/api/auth/github/callback` (must match exactly — GitHub rejects mismatched callbacks)
2. Copy the **Client ID** and generate a **Client Secret**
3. Sign in to ClawNex as an admin → **Configuration** → **Authentication Methods** card
4. Toggle "GitHub OAuth" enabled, paste Client ID + Client Secret, and confirm the Callback URL matches what you registered
5. Click **Save** — changes take effect on the next request, no restart required
6. **Pre-link operators' GitHub accounts.** ClawNex does NOT auto-create operators on first GitHub sign-in (security policy — anyone with a GitHub account would otherwise be able to create a viewer-role account). For each operator who should be able to sign in via GitHub:
   - Have them sign in with their existing local password
   - They open **Configuration** → **Auth & Devices** → **Link GitHub** and complete the OAuth flow
   - Once linked, they can sign in with the **Sign in with GitHub** button on the login page

The bootstrap fallback for GitHub OAuth is environment variables — useful for first-boot deploys where you'd rather not click into the UI:

```bash
GITHUB_OAUTH_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_OAUTH_CLIENT_SECRET=<github-oauth-client-secret>
GITHUB_OAUTH_CALLBACK_URL=https://clawnex.example.com/api/auth/github/callback
```

Env values are used only when the corresponding `config_defaults` row is empty — once the admin saves anything via the UI, the DB value wins. The provider remains OFF by default in either case until an admin flips the toggle.

#### 5.7.3 Magic Link (v0.9.2+)

Magic Link is **off by default** and requires two things to become available:

1. **A configured mail provider.** Go to Configuration → Mail Configuration and pick Resend, SMTP, or Emailit. Send yourself a test email first — the Magic Link delivery path is the same one the test button uses.
2. **Admin toggle flipped.** Configuration → Authentication Methods → MAGIC LINK → Enabled → Save.

When both gates are closed, the login page hides the button entirely and the operator-facing Auth & Devices card shows a **DISABLED** badge. When enabled but mail isn't configured, the Authentication Methods card surfaces an inline `⚠ Mail provider not configured` warning so the admin sees why links won't send.

**Per-operator prerequisites:** each operator must have an **email address on their profile** (Configuration → Operator Management → Edit Name / Email) — Magic Link delivers to that address and only that address. Operators without an email on file can still sign in via password / passkey / GitHub; the `begin` endpoint silently ignores them to avoid leaking which emails are registered.

**Optional environment override:**
```bash
# Default 15 minutes; clamped to [1, 60]
MAGIC_LINK_EXPIRY_MINUTES=15
```

**Security posture summary** (full detail in `docs/11-security-architecture.md` §10.3):
- Token is 32 random bytes, stored only as sha256 hash
- One-shot atomic consume — parallel clicks cannot both create sessions
- All begin-time failure modes collapse to the same "check your inbox" response (no enumeration)
- All consume-time failure modes collapse to `/login?error=magic_link_invalid` (no token enumeration)

#### 5.7.4 Cookie `Secure` flag behind a reverse proxy

The auth-related cookies (session, CSRF, OAuth state, WebAuthn challenge) are set with `Secure` only when Next.js sees the request as HTTPS. Behind a reverse proxy (Caddy, nginx, Traefik, ALB) the upstream request is HTTP from the proxy, so `Secure` is not set even though the browser-facing connection is HTTPS. **This is functional but weaker than ideal** — cookies will work, but they could in principle be sent over HTTP if your deployment ever exposes a non-HTTPS path. Mitigation:

- Always serve the dashboard exclusively over HTTPS at the proxy edge (no HTTP listener at all)
- Or use a reverse proxy that rewrites the `X-Forwarded-Proto` header so a future build can read it

This is a known item tracked in `docs/go-live-checklist.md`.

#### 5.7.5 Live verification checklist

After deploying with multi-auth enabled, exercise each path before declaring the deployment ready:

- [ ] Local password sign-in still works for an existing operator (break-glass invariant)
- [ ] Admin enrolls a passkey via Auth & Devices and signs out / signs back in resident-key (no username field)
- [ ] Passkey revoke from Auth & Devices invalidates that credential
- [ ] Admin links a GitHub account and signs in via "Sign in with GitHub"
- [ ] An unlinked GitHub user attempting to sign in is refused with the "not linked" message (no auto-create)
- [ ] Disabling GitHub OAuth in Authentication Methods hides the login-page button on next page load
- [ ] Admin enables Magic Link + Mail Configuration; operator with email on file requests a link; email arrives and clicks once to sign in
- [ ] Second click of same magic link shows "Sign-in failed" (one-shot invariant)
- [ ] Disabling Magic Link hides the login-page email button on next page load
- [ ] All flows tested in two browsers (recommended: Safari + Chrome) and at least one Touch ID / security key authenticator

#### 5.7.6 Rate limits

Every auth route is per-IP rate-limited to the same sliding window as `/api/auth/login` (default 5/min, controlled by `LOGIN_RATE_LIMIT`). Tune via env if you need looser limits for a load-test environment.

### 5.8 Standalone Deployment

ClawNex supports `output: 'standalone'` in `next.config.mjs`, which produces a self-contained build suitable for deployment without a full `node_modules` tree.

```bash
# Build the standalone bundle
cd ~/sentinel && npm run build

# The build produces:
#   .next/standalone/server.js   — self-contained Node.js server
#   .next/standalone/node_modules — minimal runtime dependencies
#   .next/static                  — static assets (copy into .next/standalone/.next/static)
#   public                        — public assets (copy into .next/standalone/public)

# Copy static assets into the standalone directory
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

# Deploy with:
cd .next/standalone
source ~/sentinel/.env.local && node server.js
```

**Notes:**
- No `npm install` is needed on the target host — all runtime dependencies are bundled
- If the build was created on macOS and deployed to Linux, you may need to rebuild `better-sqlite3` on the target: `cd .next/standalone && npm rebuild better-sqlite3`
- Package size: approximately 8 MB compressed
- All RBAC environment variables must be available in the shell environment when starting `server.js`

---

## 6. Upgrading

### 6.1 Before Upgrading

1. Back up the database: `sqlite3 ~/sentinel/sentinel.db ".backup ~/sentinel/sentinel.db.pre-upgrade"`
2. Back up config: `cp ~/sentinel/.env.local ~/sentinel/.env.local.pre-upgrade`
3. Note current version: `curl -s http://127.0.0.1:5001/api/health | python3 -c "import json,sys;print(json.load(sys.stdin)['version'])"`

### 6.2 Upgrade Procedure

```bash
# Stop services
kill $(lsof -ti :5001) $(lsof -ti :4001) 2>/dev/null
sleep 3

# Apply code changes (git pull, file copy, etc.)
# ...

# Clear build cache
rm -rf ~/sentinel/.next

# Install any new dependencies
cd ~/sentinel && npm ci

# Restart
cd ~/sentinel && npm run dev &
cd ~/sentinel/litellm && bash start.sh &

# Verify
curl http://127.0.0.1:5001/api/health | python3 -m json.tool
```

### 6.2a Canonical remote deploy: `scripts/deploy-prod.sh` (added 2026-05-01, v0.14.5 enhancements 2026-05-08)

For SSH-driven deploys to a remote host (staging host / <qa-host> / customer servers / Tailscale-only test boxes), ClawNex now ships a single durable script at `scripts/deploy-prod.sh`. It supersedes the throwaway `/tmp/deploy-prod-legacy.sh` that previous QA cycles passed around — the old path is **deprecated and should not be used**.

**v0.14.5 enhancements (2026-05-08):**
- **`.ts.net` auto-detect** in `install-prod.sh` — Tailscale-only deploys skip the public DNS preflight automatically (commit `c7393d3`). See §5.3.3 for the Path A workflow.
- **Portable LiteLLM bootstrap** — `install-prod.sh` now stands up LiteLLM via Astral's python-build-standalone python3.12 venv on fresh boxes (commit `6beacc4`). No apt PPA, no distro-specific paths. Solves "fresh Ubuntu 24.04 doesn't ship python3.12 by default."
- **`$USER:$USER` parameterization** in `chown` and preserve-paths (commit `c7393d3`) — replaces the hardcoded `<operator-user>` user. Deploys to test boxes where the SSH user differs no longer leave the install owned by a non-existent account.
- **Three-surface health gate** — final `[8/8]` smoke check now verifies dashboard `/api/health` AND LiteLLM port 4001 AND Caddy port 443 (commit `dc8296b`). A redeploy where Caddy crashes silently used to slip through; now the deploy fails closed if any of the three is missing.

**What it does, in order:**

1. **Pre-flight** — verifies the local tarball (`build/clawnex-vX.Y.Z.tar.gz`) exists, the target host is reachable, and the `OPENCLAW_PRESERVED` invariant holds (aborts before touching anything if `~/.openclaw/openclaw.json` would end up missing — the "never touch OpenClaw" rule, automated).
2. **Deep clean** (default; opt-out with `--no-deep-clean`) — removes `~/sentinel`, the systemd user unit files, `/etc/caddy/Caddyfile`, the watchdog cron entry, and any ClawNex-managed legacy Host Security helper. Leaves OpenClaw, LiteLLM (if external), and operator `~/.openclaw/` data alone.
3. **Upload** — scp's the tarball into `~/`, untars to `~/sentinel/`, runs `npm ci --omit=dev`.
4. **Build** — `next build` with the production env. Caddyfile is regenerated from the domain template (skipped on `.ts.net` — Path A hand-finishes per §5.3.3), the systemd user unit is reinstalled and enabled.
5. **Smoke** — curl `/api/health` against the local bind, then dashboard + LiteLLM port 4001 + Caddy port 443 from the public surface.

**Common invocations:**

```bash
# Standard QA deploy (staging host)
./scripts/deploy-prod.sh \
  --host <deployment-tailscale-host> \
  --domain <qa-host> \
  --version v0.10.0-alpha-2026-05-01

# Sudo password supplied via env (for unattended runs)
SUDO_PASS=... ./scripts/deploy-prod.sh \
  --host <operator-user>@... \
  --domain ... \
  --version ... \
  --sudo-pass-env

# Dry-run (prints every command, executes nothing)
./scripts/deploy-prod.sh --host ... --domain ... --version ... --dry-run

# Skip the deep clean (in-place upgrade — discouraged for full releases,
# but useful for hotfix iteration on a known-good host)
./scripts/deploy-prod.sh --host ... --domain ... --version ... --no-deep-clean
```

**Why deep clean by default.** the operator's standing rule for QA / customer redeploys is "redeploys MUST be clean uninstall + fresh install, never in-place." The deep clean enforces that. `--no-deep-clean` exists for the rare hotfix case where you've already pre-validated the existing install and just want a code swap.

**OpenClaw preservation guard.** Even with `--deep-clean` (the default) the script never deletes `~/.openclaw/`. If the pre-flight detects that the path would be lost — e.g. an operator manually symlinked it inside `~/sentinel/` — the script aborts with `OPENCLAW_PRESERVED check failed`. Same applies by analogy to LiteLLM: ClawNex does not delete or downgrade an externally-managed LiteLLM during deploy.

**Smoke after deploy.** Always finish with a manual sanity check:

```bash
ssh <operator-user>@<host> 'systemctl --user status clawnex'
curl -sI https://<domain>/api/health
```

A green `200` + active systemd unit means the deploy landed. The script also prints the SHA-256 of the deployed tarball so you can match it against what's in `build/`.

### 6.3 Rollback

```bash
# Stop services
kill $(lsof -ti :5001) $(lsof -ti :4001) 2>/dev/null

# Restore database
cp ~/sentinel/sentinel.db.pre-upgrade ~/sentinel/sentinel.db

# Restore config
cp ~/sentinel/.env.local.pre-upgrade ~/sentinel/.env.local

# Restore code (git checkout, file copy, etc.)
# ...

# Clear cache and restart
rm -rf ~/sentinel/.next
cd ~/sentinel && npm run dev &
cd ~/sentinel/litellm && bash start.sh &
```

---

## 7. Uninstallation (3-Step Process)

ClawNex provides a managed 3-step uninstall process via the dashboard or API:

**Step 1: Archive** — Creates a database backup and exports configuration:
```bash
curl -X POST http://127.0.0.1:5001/api/system/archive
```

**Step 2: Purge** — Clears all traffic, metrics, and scan data from the database:
```bash
curl -X POST http://127.0.0.1:5001/api/system/purge
```

**Step 3: Uninstall** — Stops services, removes watchdog, and deletes the installation:
```bash
curl -X POST http://127.0.0.1:5001/api/system/uninstall
```

**Manual uninstall (if dashboard is not running):**

```bash
# Stop services
kill $(lsof -ti :5001) $(lsof -ti :4001) 2>/dev/null

# Remove watchdog
crontab -l | grep -v watchdog | crontab -

# Remove installation
rm -rf ~/sentinel

# Remove backups (if any)
rm -rf ~/sentinel-backups
```

### 7.1 Migrate to New Host

To migrate ClawNex to a new machine, use the migration endpoint which packages the database, configuration, and deployment files into a portable archive:

```bash
curl -X POST http://127.0.0.1:5001/api/system/migrate -o clawnex-migration.tar.gz
```

Transfer the archive to the new host and follow the Installation Steps above, using the migrated database and config in place of fresh ones.

---

## 8. Deployment Checklist

| # | Step | Status |
|---|------|--------|
| 1 | Prerequisites verified (Node.js, Python, Homebrew) | [ ] |
| 2 | Project files installed | [ ] |
| 3 | Node.js dependencies installed | [ ] |
| 4 | Python venv created and dependencies installed | [ ] |
| 5 | .env.local configured | [ ] |
| 6 | LiteLLM config.yaml updated for local network | [ ] |
| 7 | LiteLLM start.sh updated with API keys | [ ] |
| 8 | File permissions set | [ ] |
| 9 | Dashboard starts and /api/health returns ok | [ ] |
| 10 | LiteLLM starts and /health returns ok | [ ] |
| 11 | Dashboard loads in browser | [ ] |
| 12 | Traffic appears in Traffic Monitor | [ ] |
| 13 | Session Watcher shows RUNNING | [ ] |
| 14 | Watchdog cron installed | [ ] |
| 15 | Watchdog tested (manual run) | [ ] |
| 15a | Post-install verification script passes (`bash scripts/verify.sh`) | [ ] |
| 15b | CVE database synced (108 CVEs) | [ ] |
| 15c | HeyGen/ElevenLabs configured (if using avatar) | [ ] |
| 16 | Gateway token configured and gateway shows ONLINE | [ ] |
| 17 | OpenClaw routing verified (providers show ROUTED) | [ ] |
| 18 | Shield whitelist reviewed | [ ] |
| 19 | Retention settings configured | [ ] |
| 20 | Block mode decision made (OBSERVE vs BLOCK) | [ ] |
| 21 | Backup procedure tested | [ ] |
| 22 | Remote access configured (if needed) | [ ] |
| 22a | Caddy installed and Caddyfile configured (if using HTTPS) | [ ] |
| 22b | HTTPS enabled via dashboard API or Caddyfile, domain resolves over TLS | [ ] |
| 23 | RBAC enabled and NEXT_PUBLIC_RBAC_ENABLED set (if required) | [ ] |
| 24 | Initial admin account created via /setup | [ ] |
| 25 | SETUP_SECRET configured (if network-exposed) | [ ] |
| 26 | Additional operators created via Operator Management (5 roles: Admin, Security Manager, Operator, Viewer, Auditor) | [ ] |
| 27 | Mail provider configured (Resend or SMTP) if password reset is needed | [ ] |
| 28 | Test email sent successfully from Mail Configuration card | [ ] |
| 29 | Trust Boundary Audit run (GET /api/trust-audit) and findings reviewed | [ ] |
| 30 | Scheduled Reports configured if recurring email delivery is required | [ ] |
| 31 | Custom Correlation Rules reviewed/imported if custom detection logic is needed | [ ] |
| 32 | AUTH_RP_ID + AUTH_EXPECTED_ORIGIN set to the public HTTPS URL the browser will see (v0.9.0+) | [ ] |
| 33 | Passkey enrollment + sign-in tested end-to-end on a real authenticator (Touch ID / security key) | [ ] |
| 34 | GitHub OAuth app registered with exact callback URL (only if enabling GitHub sign-in) | [ ] |
| 35 | GitHub OAuth enabled in Authentication Methods card + Client ID / Secret / Callback saved | [ ] |
| 36 | At least one operator GitHub account pre-linked via Auth & Devices (no auto-create policy) | [ ] |

---

## 9. Production Hardening Checklist

Apply these items before exposing ClawNex to any network beyond localhost. Every item is a gate — do not skip.

| # | Item | Command / Action | Cadence |
|---|------|------------------|---------|
| 1 | Firewall: deny inbound except 80, 443, SSH | `sudo ufw default deny incoming && sudo ufw allow 80,443,22/tcp && sudo ufw enable` | One-time |
| 2 | LiteLLM bound to 127.0.0.1 only | Verify `lsof -i :4001` shows loopback bind | Each deploy |
| 3 | Dashboard bound to 127.0.0.1 when behind Caddy | Set `HOSTNAME=127.0.0.1` in env, confirm with `lsof -i :5001` | Each deploy |
| 4 | File permissions 600 on secrets | `chmod 600 ~/sentinel/.env.local ~/sentinel/sentinel.db ~/sentinel/litellm/config.yaml` | Each deploy |
| 5 | File permissions 700 on executables | `chmod 700 ~/sentinel/litellm/start.sh ~/sentinel/scripts/watchdog.sh` | Each deploy |
| 6 | Dedicated service user (non-root, non-personal) | See section 14 | One-time |
| 7 | Caddy auto-TLS verified (80/443 open, DNS resolves) | `curl -I https://<domain>` returns 200 with valid cert | Each deploy + weekly |
| 8 | RBAC enabled with strong admin password (>=14 chars) | Verify `RBAC_ENABLED=true` and `NEXT_PUBLIC_RBAC_ENABLED=true` | Each deploy |
| 9 | SETUP_SECRET rotated after initial admin created | Remove or regenerate via `openssl rand -hex 32` | One-time + on breach |
| 10 | Credentials rotated | OpenRouter, Resend, gateway token, SMTP | Quarterly |
| 11 | Dependency audit | `npm audit --production` and `pip list --outdated` | Weekly |
| 12 | LiteLLM pinned to 1.84.10 | `grep 'litellm\[proxy\]==1.84.10' litellm/requirements.txt` | Each deploy |
| 13 | Backups running and off-host | See Ops Manual section 14.4 | Daily |
| 14 | Monitoring alerts configured | Dashboard health, LiteLLM health, cert expiry, disk free | One-time |
| 15 | Audit log retention >= 365 days | Configuration → Data Retention → Audit | One-time |

### 9.1 TLS Certificate Renewal

Caddy handles renewal automatically; validate monthly:

```bash
curl -s http://127.0.0.1:5001/api/system/https | python3 -m json.tool
```

The response includes `certificate.not_after`. Alert if within 14 days of expiry. If renewal fails, see Troubleshooting Guide (doc 17) section 18.

### 9.2 Secret Rotation Cadence

| Secret | Cadence | Trigger |
|--------|---------|---------|
| OpenRouter API key | Quarterly | Suspected leak, employee offboarding |
| Gateway token | On reconfiguration | Agent host change |
| Autensa token | Quarterly | Suspected leak |
| SETUP_SECRET | Once after initial admin | Any time; setup page is inactive after admin exists |
| Resend API key | Annually | Suspected leak |
| SMTP password | Annually | Provider-imposed change |
| Operator passwords | 90 days (recommended) | Enforced at org policy level |

---

## 10. Environment Matrix (Dev / Staging / Production)

| Concern | Dev (local) | Staging | Production |
|---------|-------------|---------|------------|
| Run mode | `npm run dev` | `npm run build && npm start` | `npm run build && npm start` + systemd/pm2 |
| Binding | 127.0.0.1:5001 | 127.0.0.1:5001 behind Caddy | 127.0.0.1:5001 behind Caddy |
| HTTPS | Optional | Required (staging domain) | Required (Caddy auto-TLS) |
| RBAC | Optional | Required | Required |
| SETUP_SECRET | Blank OK | Required | Required then rotated |
| Mail provider | Disabled | SMTP test account | Resend or vetted SMTP |
| Backups | Manual, optional | Daily, retained 7 days | Daily off-host, 14d/12w/12m |
| Retention (traffic) | 1 day | 3 days | 3-7 days (tune to volume) |
| Retention (audit) | 90 days | 365 days | 365+ days (compliance) |
| Watchdog | Optional | Required | Required |
| Monitoring | Optional | Basic | Full (section 9 item 14) |
| Shield block mode | ON (default, change to observe if tuning) | ON (operator may temp-flip to observe during bake-in) | ON |

---

## 11. Pre-Production Readiness Review

Before promoting staging to production, verify every item. Sign-off by engineering lead required.

- [ ] Section 9 Production Hardening Checklist completed
- [ ] Load test run for expected traffic; p99 latency < 200 ms for `/api/shield/scan`
- [ ] Backup restore drill completed within the last 30 days
- [ ] Disaster Recovery runbook exercised within the last 90 days
- [ ] All Sev1/Sev2 runbooks reviewed by on-call
- [ ] RBAC roles and permissions reviewed against principle of least privilege
- [ ] Shield whitelist approved by Security Manager
- [ ] Retention settings match compliance requirements (document which framework)
- [ ] Logs shipping to SIEM (if required) and receiver confirmed
- [ ] Alert thresholds tested (trigger each alert and confirm receipt)
- [ ] Runbook for TLS cert renewal tested (forced renewal)
- [ ] Uninstall procedure (section 7) tested on a disposable clone
- [ ] Change management template in place; maintenance window policy documented
- [ ] Access to prod hosts limited to on-call rotation
- [ ] Secret inventory documented and stored in vault
- [ ] Customer / user communication plan for maintenance windows

---

## 12. Compliance-Aware Deployment Considerations

### 12.1 Air-Gapped / Offline Deployments

- Pre-download all dependencies: `npm ci` on a connected host, then `tar czf node_modules.tgz node_modules/` and transfer
- Bundle the Python venv: `pip download -r litellm/requirements.txt -d litellm/wheels/` and `pip install --no-index --find-links=litellm/wheels/`
- Caddy auto-TLS requires ACME reachability; for air-gapped environments use internal PKI and configure Caddy with `tls <internal-cert>.pem <internal-key>.pem`
- CVE sync requires GitHub reachability; for air-gapped environments, mirror the CVE repo internally and point `CVE_SYNC_URL` to the mirror
- Model inference must be fully local (LM Studio); disable OpenRouter provider entirely

### 12.2 FedRAMP-Adjacent / Regulated Environments

- Enable FIPS-mode OS and validated cryptographic modules where required
- Use only vetted SMTP providers (avoid Resend unless on an approved list)
- Set audit retention to the contractual minimum (commonly 7 years)
- Enable centralized logging to an accredited SIEM
- Document all data flows in a System Security Plan (SSP)
- RBAC must have distinct Admin, Security Manager, Operator, Viewer, and Auditor role assignments; no shared accounts
- Enforce MFA at the identity-provider layer (ClawNex itself is password-only; front it with an IdP proxy if MFA is required)

### 12.3 EU Data Residency (GDPR)

- Deploy to an EU-based host; verify the cloud region
- Disable any external services that egress non-EU (OpenRouter → choose EU-resident models only, or disable cloud providers)
- Configure Caddy ACME to use a regional CA if required
- Ensure Resend or SMTP provider processes data within the EU
- Document data-processing agreement references in your deployment notes

---

## 13. Logging & Observability

### 13.1 Log Locations and Format

| Log | Path | Format | Rotation |
|-----|------|--------|----------|
| Dashboard app | `~/sentinel/logs/clawnex.log` | JSONL (`{ts, level, msg, ctx}`) | Handled by `log-rotation.ts` |
| Dashboard process | `~/sentinel/logs/dashboard.log` | stdout text | Overwritten on restart (redirect via `nohup`) |
| LiteLLM process | `~/sentinel/logs/litellm.log` | stdout text | Overwritten on restart |
| Watchdog | `~/sentinel/logs/watchdog.log` | Plain text lines | Manual (truncate when > 10 MB) |
| Audit (DB-backed) | `sentinel.db` → `audit_log` table | SQLite rows | Retention per Configuration |

### 13.2 Shipping Logs Off-Host

- **Filebeat / Vector / Fluent Bit** tail the JSONL log and forward to ELK, Splunk, Datadog, or Loki
- Audit log can be exported nightly via:
  ```bash
  sqlite3 ~/sentinel/sentinel.db "SELECT * FROM audit_log WHERE created_at > datetime('now','-1 day');" -csv > /var/log/clawnex/audit-$(date +%F).csv
  ```
- Caddy access logs can be enabled by adding `log { output file /var/log/caddy/access.log }` to the Caddyfile

### 13.3 Key Fields for Dashboards

- `level` / `severity`
- `actor` (for audit events)
- `source` (shield-scan, session-watcher, litellm)
- `verdict` (ALLOW, REVIEW, BLOCK)
- Latency in `ctx.elapsed_ms`

---

## 14. Service Account & User Management

### 14.1 Who Runs the Processes

- **Recommended:** A dedicated non-login, non-sudo user (e.g., `clawnex`) owns `~/sentinel/` and runs both services
- Create with: `sudo useradd -m -s /bin/bash clawnex` (Linux)
- Do NOT run as root; do NOT run as a personal login account on shared hosts
- Grant the service user ownership: `sudo chown -R clawnex:clawnex /home/clawnex/sentinel`
- If using systemd, set `User=clawnex` and `Group=clawnex` in both unit files

### 14.2 SSH and Host Access

- Require key-based SSH; disable password authentication
- Restrict sudo to named maintenance users only; service user must not have sudo
- Log all privileged sessions to an auditable sink

### 14.3 Operator Accounts (RBAC)

- Five roles: Admin, Security Manager, Operator, Viewer, Auditor (total 28 permissions)
- Create one Admin for platform management; all other users receive the least-privilege role that fits their role
- Never share accounts; every operator has their own credentials
- Disable accounts at offboarding via Configuration → Operator Management → Deactivate
- Review operator list quarterly

---

## 15. Secrets Management Guidance

### 15.1 Local Environment File (Default)

- `~/sentinel/.env.local` holds all secrets
- Permissions MUST be 600 and owned by the service user
- Never commit `.env.local` to version control
- Back up to an encrypted vault only

### 15.2 External Vault Integration Pattern

For regulated / enterprise deployments, prefer retrieving secrets at process start from an external vault (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager):

```bash
# Example: pull secrets at service start, export into env, then launch
#!/usr/bin/env bash
set -euo pipefail
export OPENCLAW_GATEWAY_TOKEN="$(vault kv get -field=token secret/clawnex/gateway)"
export RESEND_API_KEY="$(vault kv get -field=api_key secret/clawnex/resend)"
export SETUP_SECRET="$(vault kv get -field=setup_secret secret/clawnex/core)"
exec /home/clawnex/sentinel/start-production.sh
```

- Never write fetched secrets to `.env.local` on disk — export only to process env
- Rotate secrets per section 9.2; vault audit log proves access history

---

## 16. Safe Uninstall for Regulated Environments

The standard 3-step uninstall (section 7) preserves the archive. For regulated / data-destruction cases, follow this extended procedure.

**Steps:**
1. Confirm data destruction is authorized in writing (ticket number, approver)
2. Execute the standard 3-step uninstall (archive, purge, uninstall)
3. Securely erase the archive:
   - Linux: `shred -uvz ~/sentinel-backups/*.db`
   - macOS: `rm -P ~/sentinel-backups/*.db` (note: modern filesystems may not honor in-place erase; disk-level erase may be required)
4. Remove backup directory: `rm -rf ~/sentinel-backups/`
5. Remove any off-host backups per the organization's retention policy
6. Remove systemd units / launchd plists / cron entries
7. Remove the service user: `sudo userdel -r clawnex` (Linux)
8. Revoke all API keys generated during the install lifetime
9. Rotate any credentials that were ever stored in the destroyed `.env.local`
10. File a destruction certificate with ticket number, operator, host, and date

**Verification:**
- `ls ~/sentinel* ~/sentinel-backups* 2>/dev/null` returns nothing
- `crontab -l | grep sentinel` returns nothing
- `systemctl status clawnex clawnex-litellm 2>&1 | grep -i 'could not be found'`
- All credentials listed in section 9.2 have been rotated

---

## 17. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-02 | ClawNex Engineering | Initial release |
| 1.1 | 2026-04-02 | ClawNex Engineering | Added VPS deployment scripts (deploy/deploy.sh, deploy/transfer.sh, deploy/demo-traffic.sh, deploy/WALKTHROUGH.md). |
| 1.2 | 2026-04-05 | ClawNex Engineering | v0.5.2-alpha: CVE sync setup, HeyGen/ElevenLabs config, 3-step uninstall, production mode (next build && next start), self-hosted fonts, migration package, updated prerequisites. |
| 1.3 | 2026-04-08 | ClawNex Engineering | Added post-install verification script step, gateway token configuration section, OpenClaw routing verification section, updated deployment checklist. |
| 1.4 | 2026-04-13 | ClawNex Engineering | Added RBAC deployment configuration (environment variables, first-time setup flow, standalone deployment), updated deployment checklist with RBAC steps. |
| 1.5 | 2026-04-13 | ClawNex Engineering | Added mail provider environment variables (RESEND_API_KEY, SMTP_HOST/PORT/USER/PASS, MAIL_FROM, MAIL_PROVIDER) to RBAC section, updated deployment checklist. |
| 1.6 | 2026-04-22 | ClawNex Engineering | v0.6.1-alpha: Expanded section 5.3 into 5.3.1 (Caddy — recommended, auto-TLS) and 5.3.2 (nginx — alternative). Added Caddy install, Caddyfile, API configuration, and SSE flush note. Updated deployment checklist: added Caddy HTTPS steps (22a, 22b), expanded RBAC role list (26), added Trust Audit (29), Scheduled Reports (30), Custom Correlation Rules (31) steps. |
| 1.7 | 2026-04-22 | ClawNex Engineering | Enterprise review: Added section 9 Production Hardening Checklist (15 items + 9.1 TLS renewal + 9.2 secret rotation cadence), section 10 Environment Matrix (Dev/Staging/Production), section 11 Pre-Production Readiness Review, section 12 Compliance Considerations (air-gapped, FedRAMP-adjacent, EU GDPR), section 13 Logging & Observability (log locations, shipping, dashboard fields), section 14 Service Account & User Management, section 15 Secrets Management with external vault pattern, section 16 Safe Uninstall for Regulated Environments with secure-erase. Confirmed Caddy HSTS / HTTP-to-HTTPS redirect automatic; added IP allowlisting via Caddy pattern. |
| 1.8 | 2026-04-22 | ClawNex Engineering | v0.6.2-alpha hardening pass: dashboard bind, ingress, firewall, and file-permission guidance improved. See CHANGELOG §[0.6.2-alpha]. |
| 1.9 | 2026-04-24 | ClawNex Engineering | v0.9.0-alpha multi-auth: added section 5.7 (passkeys + GitHub OAuth + magic-link UI placeholder + cookie-secure-behind-proxy note + live verification checklist + rate limits). New env vars: AUTH_RP_ID, AUTH_RP_NAME, AUTH_EXPECTED_ORIGIN, GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, GITHUB_OAUTH_CALLBACK_URL. Standalone Deployment renumbered to 5.8. Added deployment checklist items 32-36 (RP_ID setup, passkey live test, GitHub OAuth app registration, admin enable, operator pre-link). |
| 2.0 | 2026-04-24 | ClawNex Engineering | v0.10.0-alpha Magic Link rewrite: §5.7 provider table updated with Magic Link Off-by-default + mail-provider prerequisite; §5.7.3 (Magic Link) replaced from "UI placeholder" to full live deployment guide (two-gate enablement, `MAGIC_LINK_EXPIRY_MINUTES` env override, security posture summary with cross-ref to security architecture §10.3). Live verification checklist extended with two Magic Link steps (happy path + one-shot invariant + disable hides button). Also aligned doc version header with revision history (was still showing 1.1 despite revision history at 1.9). |
| 2.2 | 2026-05-05 | ClawNex Engineering | v0.11.2-alpha: deploy tarball is now `clawnex-v0.11.2-alpha-deploy.tar.gz` (or read `package.json` via `--version` default). staging host canonical public hostname remains `<qa-host>` during the testing window — DNS resolves publicly to `<deployment-public-ip>` (VPS provider IP). Don't toggle Caddy hostname between `<qa-host>` and `<qa-host>` — burns Let's Encrypt rate limits (50 certs/week per registered domain `clawnexai.com`; 5 duplicate-cert/week). Two new SQLite tables migrate on first run (`policies`, `policy_rules`) — see CLAWNEX-LLD-001 §27D for schema. Three new in-process services on the dashboard runtime: cost-reporting orchestrator, cost-signals drain detectors, FinOps adapter modules — no new ports, systemd units, or external dependencies. New endpoint `/api/alerts/[id]/evidence` (gated `audit:read`); new endpoints `/api/policies/*` (gated `policies:read/write/test`). |
| 2.3 | 2026-05-08 | ClawNex Engineering | v0.14.5-alpha: new §5.3.3 Path A — Tailscale-only test boxes (Tailscale-issued LE cert via `tailscale cert` DNS-01 challenge, Caddyfile with `auto_https off` + `bind` to Tailscale interface, weekly systemd renewal timer; first validated on Enterprise / `<tailscale-hostname>`). §6.2a deploy-prod.sh enhancements documented: `.ts.net` auto-detect skip in `install-prod.sh` (`c7393d3`), portable LiteLLM bootstrap via Astral python-build-standalone (`6beacc4`), `$USER:$USER` parameterization (`c7393d3`), three-surface health gate (`dc8296b`). |

---

*This is a living document. It will be updated as deployment procedures evolve.*

---

*ClawNex by ClawNex maintainers — clawnexai.com*
