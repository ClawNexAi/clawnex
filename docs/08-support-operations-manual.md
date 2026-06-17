# ClawNex IT Support & Operations Manual

**Document ID:** CLAWNEX-OPS-001
**Version:** 1.3
**Classification:** Confidential — IT Staff Only
**Last Updated:** 2026-05-08
**Product Version:** v0.15.0-alpha
**Status:** Living Document

---

## 1. Document Purpose

This manual is for IT support staff responsible for installing, maintaining, troubleshooting, and supporting the ClawNex platform. It covers day-to-day operations, common problems and solutions, maintenance procedures, and escalation paths.

**Audience:** System administrators, DevOps engineers, IT support technicians.

**Prerequisites:** Familiarity with macOS, Node.js, Python, SQLite, and basic networking.

---

## 2. Platform Overview for IT Staff

ClawNex consists of two services that must both be running:

| Service | Technology | Port | Process | Start Command |
|---------|-----------|------|---------|--------------|
| **Dashboard** | Node.js / Next.js | 5001 | `node` | `cd ~/sentinel && npm run dev` |
| **LiteLLM Proxy** | Python / LiteLLM 1.83.0 | 4001 | `python3` | `cd ~/sentinel/litellm && bash start.sh` |

**Supporting infrastructure:**

| Component | Type | Location | Purpose |
|-----------|------|----------|---------|
| SQLite Database | File | `~/sentinel/sentinel.db` | All platform data |
| Watchdog | Shell script + cron | `~/sentinel/scripts/watchdog.sh` | Auto-restart services |
| Session files | JSONL | `~/.openclaw/agents/main/sessions/` | Agent session logs (read-only) |
| LM Studio Fleet | External service | `<lm-studio-fleet-ip>`:1234 | Local model inference |
| LM Studio Main | External service | `<lm-studio-main-ip>`:1234 | Backup model inference |

---

## 3. Service Management

### 3.1 Starting Services

**Start Dashboard:**
```bash
cd ~/sentinel
npm run dev
```
Dashboard becomes available at http://127.0.0.1:5001 after ~5 seconds.

**Start LiteLLM:**
```bash
cd ~/sentinel/litellm
bash start.sh
```
LiteLLM becomes available at http://127.0.0.1:4001 after ~3 seconds.

**Start both (background):**
```bash
cd ~/sentinel && nohup npm run dev > logs/dashboard.log 2>&1 &
cd ~/sentinel/litellm && nohup bash start.sh > ~/sentinel/logs/litellm.log 2>&1 &
```

### 3.2 Stopping Services

**Stop Dashboard:**
```bash
# Find and kill the process
kill $(lsof -ti :5001)
```

**Stop LiteLLM:**
```bash
kill $(lsof -ti :4001)
```

**Stop both:**
```bash
kill $(lsof -ti :5001) $(lsof -ti :4001) 2>/dev/null
```

### 3.3 Restarting Services

**Restart Dashboard (clean):**
```bash
kill $(lsof -ti :5001) 2>/dev/null
sleep 2
rm -rf ~/sentinel/.next
cd ~/sentinel && nohup npm run dev > logs/dashboard.log 2>&1 &
```

**Restart LiteLLM:**
```bash
kill $(lsof -ti :4001) 2>/dev/null
sleep 2
cd ~/sentinel/litellm && nohup bash start.sh > ~/sentinel/logs/litellm.log 2>&1 &
```

### 3.4 Checking Service Status

```bash
# Quick health check
curl -s http://127.0.0.1:5001/api/health | python3 -m json.tool
curl -s http://127.0.0.1:4001/health

# Check which processes are listening
lsof -i :5001
lsof -i :4001

# Check if both are up (one-liner)
curl -so /dev/null -w "%{http_code}" http://127.0.0.1:5001/api/health && echo " Dashboard" ; \
curl -so /dev/null -w "%{http_code}" http://127.0.0.1:4001/health && echo " LiteLLM"
```

---

## 4. Watchdog Management

### 4.1 How the Watchdog Works

The watchdog is a shell script that runs via system crontab every 5 minutes. It checks both services and attempts auto-restart if either is down.

**Cron entry:** `*/5 * * * * <repo-root>/scripts/watchdog.sh`

**Behavior:**
- Pings Dashboard health endpoint (5001) and LiteLLM health endpoint (4001)
- If either returns non-200 or times out (5s): kills stale process, restarts, verifies
- Dashboard restart includes clearing `.next` cache
- Posts alerts to ClawNex API on recovery or failure
- Logs to `~/sentinel/logs/watchdog.log`
- Healthy status logged once per hour only (not every 5 minutes)

### 4.2 Checking Watchdog Status

```bash
# Is the cron job installed?
crontab -l | grep watchdog

# Recent watchdog activity
tail -30 ~/sentinel/logs/watchdog.log

# Is the watchdog log growing?
ls -la ~/sentinel/logs/watchdog.log
```

### 4.3 Reinstalling the Watchdog

If the crontab entry is lost:
```bash
echo "*/5 * * * * <repo-root>/scripts/watchdog.sh" | crontab -
```

### 4.4 Disabling the Watchdog

```bash
# Remove the cron entry
crontab -l | grep -v watchdog | crontab -

# Verify
crontab -l
```

### 4.5 Testing the Watchdog

```bash
# Manual run
bash ~/sentinel/scripts/watchdog.sh

# Check log for results
tail -5 ~/sentinel/logs/watchdog.log
```

---

## 5. Database Management

### 5.1 Database Location

```
~/sentinel/sentinel.db        # Main database
~/sentinel/sentinel.db-wal     # Write-ahead log (normal — do not delete while running)
~/sentinel/sentinel.db-shm     # Shared memory (normal — do not delete while running)
```

### 5.2 Database Health Check

```bash
# Check database integrity
sqlite3 ~/sentinel/sentinel.db "PRAGMA integrity_check;"

# Check database size
ls -lh ~/sentinel/sentinel.db

# Check WAL size (should be small — large WAL indicates checkpoint issue)
ls -lh ~/sentinel/sentinel.db-wal

# Force WAL checkpoint (reclaim space)
sqlite3 ~/sentinel/sentinel.db "PRAGMA wal_checkpoint(TRUNCATE);"

# Count records per table
sqlite3 ~/sentinel/sentinel.db "
SELECT 'proxy_traffic', COUNT(*) FROM proxy_traffic
UNION ALL SELECT 'shield_scans', COUNT(*) FROM shield_scans
UNION ALL SELECT 'alerts', COUNT(*) FROM alerts
UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log
UNION ALL SELECT 'metric_snapshots', COUNT(*) FROM metric_snapshots
UNION ALL SELECT 'correlation_events', COUNT(*) FROM correlation_events
UNION ALL SELECT 'operators', COUNT(*) FROM operators
UNION ALL SELECT 'operator_sessions', COUNT(*) FROM operator_sessions
UNION ALL SELECT 'password_reset_tokens', COUNT(*) FROM password_reset_tokens
UNION ALL SELECT 'operator_credentials', COUNT(*) FROM operator_credentials
UNION ALL SELECT 'custom_correlation_rules', COUNT(*) FROM custom_correlation_rules;
"
```

### 5.3 Manual Retention Enforcement

If automatic retention isn't running (e.g., services were down for days):

```bash
# Check current retention settings
curl -s http://127.0.0.1:5001/api/config/retention | python3 -m json.tool

# Force retention run by hitting health endpoint
curl -s http://127.0.0.1:5001/api/health > /dev/null

# Or manually delete old traffic (example: older than 3 days)
sqlite3 ~/sentinel/sentinel.db "
DELETE FROM proxy_traffic WHERE timestamp < datetime('now', '-3 days');
DELETE FROM shield_scans WHERE scanned_at < datetime('now', '-3 days');
DELETE FROM metric_snapshots WHERE recorded_at < datetime('now', '-3 days');
"
```

### 5.4 Database Backup

```bash
# Cold backup (stop services first for guaranteed consistency)
cp ~/sentinel/sentinel.db ~/sentinel/sentinel.db.backup.$(date +%Y%m%d)

# Hot backup (services running — uses SQLite backup API)
sqlite3 ~/sentinel/sentinel.db ".backup ~/sentinel/sentinel.db.backup.$(date +%Y%m%d)"
```

### 5.5 Database Recovery

If the database is corrupted:

```bash
# Option 1: Restore from backup
cp ~/sentinel/sentinel.db.backup.YYYYMMDD ~/sentinel/sentinel.db

# Option 2: Rebuild from scratch (loses all data)
rm ~/sentinel/sentinel.db ~/sentinel/sentinel.db-wal ~/sentinel/sentinel.db-shm
# Restart dashboard — it will recreate the schema
cd ~/sentinel && npm run dev
```

### 5.6 Database Size Warning

If the database exceeds 500MB, check:
1. Is retention running? Check `logs/watchdog.log` for startup messages
2. Are retention settings appropriate? Traffic at 3 days should keep it small
3. Is the WAL file large? Force a checkpoint (see 5.2)
4. Run `VACUUM` to reclaim space: `sqlite3 ~/sentinel/sentinel.db "VACUUM;"`

---

## 6. Log Files

### 6.1 Log Locations

| Log | Path | Source | Rotation |
|-----|------|--------|----------|
| Watchdog | `~/sentinel/logs/watchdog.log` | Watchdog cron | Manual (grows slowly) |
| Dashboard (restart) | `~/sentinel/logs/dashboard.log` | Watchdog restart | Overwritten on restart |
| LiteLLM (restart) | `~/sentinel/logs/litellm.log` | Watchdog restart | Overwritten on restart |
| Dashboard (live) | Terminal stdout | `npm run dev` | Not persisted unless redirected |
| LiteLLM (live) | Terminal stdout | `start.sh` | Not persisted unless redirected |

### 6.2 Important Log Patterns

**Watchdog log — things to look for:**

| Pattern | Meaning | Action |
|---------|---------|--------|
| `ALERT: ClawNex Dashboard is DOWN` | Dashboard crashed | Check if auto-restart succeeded |
| `ALERT: LiteLLM Proxy is DOWN` | LiteLLM crashed | Check if auto-restart succeeded |
| `restart SUCCESSFUL` | Service recovered automatically | Usually no action needed |
| `restart FAILED` | Auto-restart didn't work | Manual intervention required |
| `OK: All services healthy` | Hourly healthy status | Normal operation |

**Dashboard console — things to look for:**

| Pattern | Meaning | Action |
|---------|---------|--------|
| `[SENTINEL DB] Initialized` | Database opened successfully | Normal startup |
| `[Retention] Pruned N rows` | Retention enforcement ran | Normal operation |
| `[SessionWatcher] Started` | Session watcher is polling | Normal startup |
| `[SessionWatcher] Poll error` | Failed to read session files | Check file permissions |
| `Error: Cannot find module` | Stale `.next` cache | Run `rm -rf .next` and restart |

**LiteLLM console — things to look for:**

| Pattern | Meaning | Action |
|---------|---------|--------|
| `[ClawNex] Callbacks injected` | Shield callback registered | Normal startup |
| `[ClawNex Logger] Initialized` | Logger ready | Normal startup |
| `[ClawNex Logger] BLOCKED` | Request was blocked by shield | Review in dashboard |
| `[ClawNex Logger] BREAK-GLASS` | Request bypassed shield | Verify break-glass is authorized |
| `[ClawNex Logger] Scan error` | Shield scan failed | Check if Dashboard is running |
| `[ClawNex Logger] Ingest error` | Failed to log traffic | Check if Dashboard is running |

---

## 7. Troubleshooting Guide

### 7.1 Dashboard Won't Start

**Symptom:** `npm run dev` fails or hangs.

**Diagnostic steps:**
```bash
# 1. Is port 5001 already in use?
lsof -i :5001

# 2. Kill stale process
kill $(lsof -ti :5001) 2>/dev/null

# 3. Clear build cache
rm -rf ~/sentinel/.next

# 4. Check for Node.js errors
cd ~/sentinel && npm run dev 2>&1 | head -50

# 5. Check node_modules integrity
cd ~/sentinel && npm install

# 6. Check disk space
df -h /
```

**Common causes:**
- Stale `.next` cache after file changes → clear `.next`
- Port conflict → kill stale process
- node_modules corruption → `rm -rf node_modules && npm install`
- Disk full → clean up space

### 7.2 LiteLLM Won't Start

**Symptom:** `bash start.sh` fails or LiteLLM exits immediately.

**Diagnostic steps:**
```bash
# 1. Is port 4001 already in use?
lsof -i :4001

# 2. Kill stale process
kill $(lsof -ti :4001) 2>/dev/null

# 3. Check Python environment
cd ~/sentinel/litellm
source venv/bin/activate
python3 -c "import litellm; print(litellm.version)"
# Should print: 1.83.0

# 4. Check for import errors
python3 -c "from clawnex_logger import ClawNexLogger; print('OK')"

# 5. Try running directly
python3 run.py 2>&1 | head -30

# 6. Check environment variables
echo $OPENROUTER_API_KEY
echo $CLAWNEX_API_URL
```

**Common causes:**
- Port conflict → kill stale process
- venv not activated → `source venv/bin/activate`
- Missing dependency → `pip install 'litellm[proxy]==1.83.0' httpx==0.28.1`
- Wrong Python version → verify `python3 --version` is 3.12.x
- Environment variables not set → check `start.sh` exports

### 7.3 Shield Shows "STOPPED" in Traffic Monitor

**Symptom:** Traffic Monitor shows "STOPPED" or "OBSERVE" but traffic isn't being scanned.

**This is NOT an error.** The Traffic Monitor shows the shield MODE (OBSERVE/BLOCK), not whether it's running. If traffic is appearing in the table with verdicts, the shield is working.

**If traffic is NOT appearing:**
1. Check if LiteLLM is running: `curl http://127.0.0.1:4001/health`
2. Check if agents are sending requests through port 4001 (not directly to LM Studio)
3. Check the Session Watcher status — is it RUNNING?

### 7.4 False Positives (Legitimate Traffic Marked as BLOCK)

**Symptom:** Agent system prompts trigger BLOCK verdicts.

**Solution:**
1. Go to Prompt Shield tab in dashboard
2. Click "Manage" on the Rule Whitelist card
3. Search for the rule IDs shown in the detections
4. Toggle them on (whitelisted)
5. Save

**Most common false positives:**
- COG-SOUL, COG-IDENTITY, COG-MEMORY (agent prompts reference these files)
- FIN-SWIFT-CODE (matches common all-caps words)

### 7.5 Database Locked Errors

**Symptom:** Console shows "SQLITE_BUSY" or "database is locked" errors.

**Diagnostic steps:**
```bash
# 1. Check WAL file size
ls -lh ~/sentinel/sentinel.db-wal

# 2. Force checkpoint
sqlite3 ~/sentinel/sentinel.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 3. Check for external SQLite connections
fuser ~/sentinel/sentinel.db 2>/dev/null

# 4. Restart services (last resort)
kill $(lsof -ti :5001) $(lsof -ti :4001) 2>/dev/null
sleep 3
cd ~/sentinel && npm run dev &
cd ~/sentinel/litellm && bash start.sh &
```

**Common causes:**
- External tool (DB browser, sqlite3 CLI) holding a write lock → close it
- WAL checkpoint stuck → force checkpoint
- Heavy concurrent writes → reduce session watcher interval or traffic volume

### 7.6 LM Studio Fleet Unreachable

**Symptom:** LiteLLM returns 502 errors. Traffic Monitor shows errors.

**Diagnostic steps:**
```bash
# 1. Can you reach the fleet? (replace with your LM Studio host IP)
curl -s http://192.168.x.x:1234/v1/models | head -5

# 2. Can you reach the main? (replace with your LM Studio host IP)
curl -s http://192.168.x.y:1234/v1/models | head -5

# 3. Is it a network issue?
ping -c 3 192.168.x.x

# 4. Is LM Studio running on the fleet machine?
# (must be checked on 192.168.x.x directly)
```

**Common causes:**
- LM Studio crashed on the fleet machine → restart LM Studio
- Network issue → check connectivity
- Model not loaded → load model in LM Studio UI
- Wrong IP → verify fleet IP hasn't changed

### 7.7 Session Watcher Not Scanning

**Symptom:** Session Watcher shows RUNNING but 0 messages scanned.

**Diagnostic steps:**
```bash
# 1. Check the session path exists
ls -la ~/.openclaw/agents/main/sessions/

# 2. Check there are JSONL files
ls -la ~/.openclaw/agents/main/sessions/*.jsonl | head -5

# 3. Check file permissions
stat ~/.openclaw/agents/main/sessions/

# 4. Check the configured path
grep OPENCLAW_SESSIONS_PATH ~/sentinel/.env.local
```

**Common causes:**
- Wrong path in `.env.local`
- No session files yet (agents haven't run)
- File permissions (ClawNex user can't read OpenClaw files)
- Session watcher disabled (`SESSION_WATCHER_ENABLED=false`)

### 7.8 High Memory Usage

**Symptom:** Node.js process using excessive memory.

**Diagnostic steps:**
```bash
# Check Node.js memory
ps aux | grep "next" | grep -v grep

# Check database size
ls -lh ~/sentinel/sentinel.db

# Check if retention is working
curl -s http://127.0.0.1:5001/api/config/retention | python3 -m json.tool
```

**Common causes:**
- Many SSE clients connected → check `sseClients` in health endpoint
- Large database → verify retention is running
- Memory leak → restart dashboard (plan to investigate)

### 7.9 Dashboard Loads But Shows No Data

**Symptom:** Dashboard renders but all panels show empty states.

**Diagnostic steps:**
1. Check browser console for JavaScript errors (F12 → Console)
2. Check network tab for failed API calls (F12 → Network)
3. Verify health endpoint: `curl http://127.0.0.1:5001/api/health`
4. Check if database exists: `ls -la ~/sentinel/sentinel.db`
5. If database is missing, restart dashboard to recreate it

### 7.10 ElevenLabs Voice Not Working

**Symptom:** Floating avatar speaks but no audio, or TTS returns an error.

**Diagnostic steps:**
1. Check if the ElevenLabs API key is configured: Go to Configuration tab → Voice & Avatar
2. Test the voice endpoint directly:
   ```bash
   curl -X POST http://127.0.0.1:5001/api/voice/speak \
     -H "Content-Type: application/json" \
     -d '{"text": "Hello world"}'
   ```
3. Check the browser console for audio playback errors
4. Verify the ElevenLabs key is valid and has remaining quota

**Common causes:**
- Missing or invalid API key
- ElevenLabs quota exhausted
- Browser blocking audio autoplay (user interaction required first)

### 7.11 HeyGen Avatar Not Loading

**Symptom:** Avatar area shows blank or error state, no visual avatar appears.

**Diagnostic steps:**
1. Check if the HeyGen API key is configured: Go to Configuration tab → Voice & Avatar
2. Test token creation:
   ```bash
   curl -X POST http://127.0.0.1:5001/api/voice/heygen \
     -H "Content-Type: application/json" \
     -d '{"action": "create_token"}'
   ```
3. Check browser console for WebRTC or connection errors

**Common causes:**
- Missing or invalid HeyGen API key
- Browser does not support WebRTC
- Network firewall blocking WebRTC connections
- HeyGen service outage

### 7.12 CVE Sync Fails

**Symptom:** `POST /api/cve/sync` returns an error or zero CVEs loaded.

**Diagnostic steps:**
```bash
# Test GitHub API access
curl -s https://api.github.com/repos/jgamblin/OpenClawCVEs/contents/ | head -5

# Check current CVE count
curl -s http://127.0.0.1:5001/api/cve | python3 -c "import json,sys; print(json.load(sys.stdin).get('total', 0))"

# Retry sync
curl -X POST http://127.0.0.1:5001/api/cve/sync
```

**Common causes:**
- No internet access (GitHub unreachable)
- GitHub API rate limit exceeded (60 requests/hour unauthenticated)
- Repository structure changed upstream

### 7.13 Break-Glass Won't Activate

**Symptom:** Break-glass button is greyed out or activation returns an error.

**Check for:**
- Break-glass already active → deactivate first
- Cool-down period active → wait 15 minutes after last deactivation
- API returns 429 → cool-down in progress, check remaining seconds

```bash
curl -s http://127.0.0.1:5001/api/break-glass/status | python3 -m json.tool
```

### 7.14 RBAC Login Failures and Account Lockout

**Symptom:** Operator cannot log in; login page shows lockout message or generic error.

**Diagnostic steps:**
```bash
# Check the operator's failed attempt count and locked state
sqlite3 ~/sentinel/sentinel.db "
SELECT username, failed_attempts, locked_until, disabled
FROM operators WHERE username = 'theusername';
"
```

**Lockout tiers:**
- 5 failed attempts → locked 1 minute
- 10 failed attempts → locked 5 minutes
- 15 failed attempts → locked 30 minutes
- 20+ failed attempts → account auto-disabled (admin must re-enable)

**To manually unlock a locked account (not disabled):**
```bash
sqlite3 ~/sentinel/sentinel.db "
UPDATE operators SET locked_until = NULL, failed_attempts = 0
WHERE username = 'theusername';
"
```

**To re-enable a disabled account:**
Use the Operator Management panel (Configuration → Operator Management → find operator → Unlock) or via the API with an admin session cookie.

**Common causes:**
- Operator entered wrong password multiple times
- Shared accounts where multiple users trigger failures
- Automated scripts using stale credentials

### 7.15 CSRF Errors

**Symptom:** API calls return 403 with "CSRF token mismatch" or "Invalid CSRF token".

**Explanation:** ClawNex uses double-submit cookie CSRF protection with timing-safe comparison. Every state-changing request (POST/PUT/PATCH/DELETE) must include the CSRF token from the `csrf_token` cookie as an `X-CSRF-Token` header.

**For curl-based API calls:**
```bash
# Step 1: Obtain session cookie and CSRF token
curl -c cookies.txt -v -X POST http://127.0.0.1:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}' 2>&1 | grep csrf

# Step 2: Extract token from the csrf_token cookie
CSRF=$(grep csrf_token cookies.txt | awk '{print $NF}')

# Step 3: Include token in header
curl -b cookies.txt -X POST http://127.0.0.1:5001/api/shield/scan \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"text":"test","source":"manual"}'
```

**Common causes:**
- Missing `X-CSRF-Token` header on write operations
- Session expired (CSRF token tied to session)
- Token not refreshed after login/logout cycle

### 7.16 Session Expiry Issues

**Symptom:** Operator is redirected to `/login` unexpectedly; dashboard shows authentication error.

**Diagnostic steps:**
```bash
# Check session expiry setting
sqlite3 ~/sentinel/sentinel.db "SELECT key, value FROM config WHERE key = 'session_timeout_hours';"

# Check active sessions for an operator
sqlite3 ~/sentinel/sentinel.db "
SELECT session_id, created_at, last_active, expires_at
FROM operator_sessions WHERE operator_id = (SELECT id FROM operators WHERE username = 'theusername')
ORDER BY last_active DESC;
"
```

**Common causes:**
- Session timeout period too short (default adjustable in Configuration → Session Settings)
- Password was changed, revoking all sessions (this is by design)
- More than 5 concurrent sessions — oldest session was automatically revoked
- Browser cleared cookies

### 7.17 /setup Page Not Loading

**Symptom:** Navigating to `/setup` shows a blank page, 403, or redirect.

**Check for:**
1. **Is there already an admin?** The setup page is only accessible if no operator accounts exist yet. If an admin exists, `/setup` redirects to `/login`.
   ```bash
   sqlite3 ~/sentinel/sentinel.db "SELECT COUNT(*) FROM operators;"
   ```
2. **Is SETUP_SECRET required?** If `SETUP_SECRET` is set in `.env.local`, the URL must include `?secret=<value>`:
   ```
   http://your-host:5001/setup?secret=your-secret-here
   ```
3. **Recover the SETUP_SECRET value** from the host using your operator-approved host-secret retrieval procedure, then append it to the URL.

### 7.18 Middleware Redirect Loops

**Symptom:** Browser shows "too many redirects" error when accessing the dashboard.

**Diagnostic steps:**
1. Open browser DevTools → Network tab → observe which URLs are redirecting
2. Clear all browser cookies for the ClawNex host
3. Verify that `/login`, `/setup`, and `/reset-password` are not requiring authentication (they are public routes)
4. Check that `NEXTAUTH_URL` or equivalent base URL in `.env.local` matches the actual host/port being accessed

**Common causes:**
- Mismatched hostname in environment config vs. actual access URL
- Stale session cookie with invalid token causing auth middleware to loop
- RBAC middleware incorrectly flagging `/login` as a protected route (check middleware version)

### 7.19 Password Reset Email Failures

**Symptom:** Operator clicks "Forgot your password?" but never receives a reset email.

**Diagnostic steps:**
```bash
# Check if mail is configured
sqlite3 ~/sentinel/sentinel.db "SELECT value FROM config WHERE key = 'mail_provider';"

# Check for pending reset tokens (token should exist after the request)
sqlite3 ~/sentinel/sentinel.db "
SELECT operator_id, created_at, expires_at, used
FROM password_reset_tokens ORDER BY created_at DESC LIMIT 5;
"

# Check audit log for reset attempts
sqlite3 ~/sentinel/sentinel.db "
SELECT timestamp, actor, action, detail FROM audit_log
WHERE action LIKE '%password_reset%' ORDER BY timestamp DESC LIMIT 10;
"
```

**Common causes:**
- Mail provider set to **Disabled** → enable Resend or SMTP in Configuration → Mail Configuration
- Invalid Resend API key or unverified "From" address
- SMTP credentials wrong or port blocked by firewall
- Operator email address does not match any operator account (reset silently no-ops for security)
- Reset token expired (30-minute window) — operator must request a new link

**Test mail config:**
Go to Configuration → Mail Configuration → click **Test** to send a test email to verify delivery.

### 7.20 Caddy / HTTPS Not Working

**Symptom:** HTTPS endpoint is unreachable; Caddy process shows as stopped; certificate errors in browser.

**Diagnostic steps:**
```bash
# Check if Caddy is running
pgrep -x caddy && echo "Caddy running" || echo "Caddy not running"

# Check Caddy status via API
curl -b cookies.txt http://127.0.0.1:5001/api/system/https | python3 -m json.tool

# Check Caddyfile exists and is readable
cat ~/sentinel/Caddyfile

# Start Caddy manually
caddy run --config ~/sentinel/Caddyfile

# Check Caddy logs for certificate errors
caddy run --config ~/sentinel/Caddyfile 2>&1 | head -30
```

**Common causes:**
- Caddy not installed → `brew install caddy` or download from caddyserver.com
- Domain DNS not propagated yet → Let's Encrypt cannot issue certificate
- Port 80/443 blocked by firewall → certificate issuance requires port 80 for HTTP challenge
- Caddyfile not generated → run Generate Caddyfile from Configuration → HTTPS card
- Certificate expired and auto-renewal failed → check Caddy logs, re-run Caddy to force renewal

### 7.21 Trust Boundary Audit Not Returning Results

**Symptom:** Trust Boundary Audit tab shows no findings after discovery scan.

**Diagnostic steps:**
```bash
# Check if discovery ran
sqlite3 ~/sentinel/sentinel.db "
SELECT action, timestamp FROM audit_log WHERE action LIKE '%trust_audit%' ORDER BY timestamp DESC LIMIT 5;
"

# Check trust audit findings count
sqlite3 ~/sentinel/sentinel.db "SELECT COUNT(*) FROM trust_audit_findings;" 2>/dev/null || echo "Table may not exist — check schema"

# Trigger discovery manually via API
curl -b cookies.txt -X POST http://127.0.0.1:5001/api/trust-audit/discover
```

**Common causes:**
- No connected agents or session files for the discovery engine to scan
- Discovery not yet run (click **Run Discovery** on the Trust Boundary Audit tab)
- All 15 rules are passing cleanly (no findings is a good result — verify via API that scan ran)

### 7.21A Multi-Auth Provider Failures (v0.9.0+)

**Symptom A: Passkey enrollment / sign-in just doesn't work; browser shows generic error.**

Most common: WebAuthn relying-party identity mismatch.
- Verify the dashboard URL is HTTPS (or `localhost`/`127.0.0.1`). Browsers refuse passkey enrollment over plain HTTP. If you're behind Caddy, confirm the URL the browser actually uses.
- Verify env vars match the public URL exactly:
  ```bash
  grep -E "AUTH_RP_ID|AUTH_EXPECTED_ORIGIN" ~/sentinel/.env.local
  ```
  - `AUTH_RP_ID` must be the registrable domain only (no scheme, no port). Example: `clawnex.example.com`.
  - `AUTH_EXPECTED_ORIGIN` must be the full origin including scheme. Example: `https://clawnex.example.com`.
- Restart the dashboard after changing env vars.
- Tail `~/sentinel/logs/dashboard.log` during enrollment — `@simplewebauthn/server` logs the verification failure with specific error text (e.g. "Unexpected RP ID hash"). Include that line in any escalation.

**Symptom B: GitHub sign-in returns to /login with `?error=github_*`.**

Decode the `?error=` value:
| Error | Cause | Fix |
|-------|-------|-----|
| `github_state_mismatch` | State cookie mismatch (stale tab or forged callback) | Try fresh tab; clear cookies for site |
| `github_signin_failed` | Token exchange or `/user` API failed | Verify Client ID + Secret in Authentication Methods; check ClawNex can reach `github.com` |
| `github_not_linked` | Valid GitHub identity but no operator pre-linked | Admin must link via Auth & Devices (operator signs in with password first) |
| `github_not_configured` | Provider enabled but missing creds | Admin completes Authentication Methods card |
| `github_not_enabled` | Provider toggle is off | Admin enables in Authentication Methods |
| `github_rate_limited` | Per-IP sliding window exceeded | Wait 60s; raise `LOGIN_RATE_LIMIT` if chronic |

**Symptom C: GitHub OAuth app rejects the callback URL.**

GitHub requires byte-exact match between the registered Authorization Callback URL and what ClawNex sends. Compare:
- GitHub OAuth app settings → Authorization callback URL
- ClawNex Authentication Methods → Callback URL field

These must match including scheme, host, port, path.

**Symptom D: Cookie warnings in browser dev console behind Caddy.** (CLOSED in v0.9.2)

Resolved by the 2026-04-25 trust-boundary patch. The auth helpers `publicOrigin()` and `isPublicSecure()` in `src/lib/services/auth/index.ts` now anchor the cookie `Secure` flag and redirect Location headers on `AUTH_EXPECTED_ORIGIN` instead of the upstream `request.nextUrl.origin`. If you still see a missing-Secure warning, it almost certainly means `AUTH_EXPECTED_ORIGIN` is empty or wrong in `.env.local`; verify and rebuild.

**Symptom E: Magic Link "Send link" button does nothing / no email arrives.**

Decision tree:
1. Is the button visible at all? If hidden, either the admin toggle is off OR no mail provider is configured. Open Authentication Methods → confirm Magic Link is enabled. If it shows a 🔒 lock, configure Mail Configuration first (Resend / SMTP / Emailit), then return.
2. Button visible but clicking does nothing in the browser? Check DevTools console for `[magic-link]` errors. If the click never produces a network request, suspect a client-side handler regression — historically this was the nested-`<form>` bug fixed in v0.9.2 (HTML-illegal nesting silently dropped React's `onSubmit`).
3. Button click produces a 200 but no email arrives? Use the admin diagnostic:
   ```bash
   curl -b cookies.txt -X POST -H "X-CSRF-Token: $TOKEN" \
     http://127.0.0.1:5001/api/config/auth-methods/test-magic-link
   ```
   The response carries a verbose `{ ok, code, message }` envelope:
   - `no_email` — the calling admin has no email address on the operator record. Set one via Operator Management.
   - `mail_not_configured` — mail provider was disabled after the toggle was flipped on. Re-configure or disable Magic Link.
   - `magic_link_disabled` — the toggle is off (UI may be stale; force-reload).
   - `send_failed` — the mail provider returned an error. The full provider error is in `message`. For Resend, common causes are unverified domain or wrong `MAIL_FROM`.
4. Email arrives but link returns `?error=magic_link_invalid`? Token TTL is 15 minutes by default. Check whether the user clicked from a slow client (mobile mail apps sometimes delay), whether the token was already consumed (one-shot — second click always fails), or whether `MAGIC_LINK_EXPIRY_MINUTES` is set unusually low.

**Audit log query for failures:**
```bash
sqlite3 ~/sentinel/sentinel.db "SELECT created_at, action, detail FROM audit_log WHERE action IN ('passkey_login_failed','github_login_failed','passkey_enrolled','github_linked','magic_link_test_sent','magic_link_test_failed','operator_login') ORDER BY created_at DESC LIMIT 20;"
```

### 7.22 Scheduled Reports Email Not Delivering

**Symptom:** Scheduled reports are configured but emails are not arriving.

**Diagnostic steps:**
```bash
# Check schedule configuration
curl -b cookies.txt http://127.0.0.1:5001/api/reports/schedule | python3 -m json.tool

# Check audit log for send attempts
sqlite3 ~/sentinel/sentinel.db "
SELECT timestamp, action, detail FROM audit_log
WHERE action LIKE '%report%schedule%' ORDER BY timestamp DESC LIMIT 10;
"
```

**Common causes:**
- Schedule is toggled **off** — check the Enabled state on the schedule card
- Mail provider not configured or misconfigured — test via Configuration → Mail Configuration → Test
- Recipient email address has a typo
- Send failed and was audit-logged — check the detail column for error messages
- Report period has no data (e.g., daily report on a day with zero traffic) — some implementations skip empty reports

---

## 8. Dashboard Operations

### 8.1 Post-Install Verification Script

ClawNex includes a verification script that checks all critical components after installation or restart.

**Running the script:**
```bash
bash ~/sentinel/scripts/verify.sh
```

**What it checks:**
- Dashboard health endpoint (port 5001)
- LiteLLM health endpoint (port 4001)
- Database file exists and passes SQLite integrity check
- Watchdog cron entry is installed
- File permissions on sensitive files (`.env.local`, `sentinel.db`, `start.sh`)
- LiteLLM version is pinned to 1.83.0
- Session watcher path is configured and accessible

**When to run:**
- After initial deployment
- After any service restart or configuration change
- Before a VC demo or client presentation
- When investigating service issues (run first to eliminate common problems)

All checks should report **PASS**. Any **FAIL** items should be investigated before proceeding.

### 8.2 Updating Gateway Token via Configuration UI

The gateway token can be updated directly from the dashboard without editing `.env.local` manually.

**Steps:**
1. Go to **Configuration** tab in the dashboard
2. Expand the **Gateways** section
3. Locate the **Gateway Token** field
4. Enter the new token value (source it from `~/.openclaw/openclaw.json` on the agent host)
5. Click **Save**

**Expected result:**
- A success toast notification appears
- The gateway WebSocket reconnects using the new token
- The **Infrastructure** tab shows the OpenClaw gateway connection as ONLINE

**If the gateway shows OFFLINE after updating:**
- Verify the token matches the value in `~/.openclaw/openclaw.json`
- Check that the gateway WebSocket URL is correct (`ws://127.0.0.1:18789` by default)
- Check browser console for WebSocket connection errors

### 8.3 Restarting LiteLLM from the Dashboard

LiteLLM can be restarted directly from the Infrastructure panel without using the terminal.

**Steps:**
1. Go to **Infrastructure** tab in the dashboard
2. Locate the **LiteLLM Proxy** service card
3. Click the **Restart** button

**Expected behavior:**
- LiteLLM status briefly shows **DEGRADED** (amber) or **OFFLINE** (red)
- Within 3-5 seconds, status returns to **ONLINE** (green)
- Traffic resumes flowing through the proxy

**Verify after restart:**
```bash
curl -s http://127.0.0.1:4001/health
```

**When to use:**
- LiteLLM is showing DEGRADED status
- Traffic is not flowing despite LiteLLM showing ONLINE
- After configuration changes that require a LiteLLM reload
- As an alternative to the terminal-based restart (section 3.3)

**Note:** The dashboard restart is equivalent to killing and restarting the LiteLLM process. It does not clear the Python venv or reinstall dependencies. For deeper issues, use the terminal-based restart procedure in section 3.3.

---

## 9. Maintenance Procedures

### 9.1 Daily Checks

| Check | How | Expected |
|-------|-----|----------|
| Both services running | `curl -so/dev/null -w "%{http_code}" http://127.0.0.1:5001/api/health && curl -so/dev/null -w "%{http_code}" http://127.0.0.1:4001/health` | `200 200` |
| Watchdog running | `crontab -l \| grep watchdog` | Shows cron entry |
| Database size | `ls -lh ~/sentinel/sentinel.db` | Under 500MB |
| Open alerts | `curl -s "http://127.0.0.1:5001/api/alerts?status=open" \| python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('alerts',[])), 'open')"` | Review any CRITICAL/HIGH |
| Watchdog log | `tail -5 ~/sentinel/logs/watchdog.log` | No ALERT or FAILED entries |
| RBAC session table health | `sqlite3 ~/sentinel/sentinel.db "SELECT COUNT(*) FROM operator_sessions WHERE expires_at > datetime('now');"` | Non-zero if operators are active; no errors |
| Caddy process (if HTTPS enabled) | `pgrep -x caddy && echo "Running" \|\| echo "STOPPED"` | Running (if HTTPS configured) |

### 9.2 Weekly Checks

| Check | How | Expected |
|-------|-----|----------|
| Database integrity | `sqlite3 ~/sentinel/sentinel.db "PRAGMA integrity_check;"` | `ok` |
| WAL size | `ls -lh ~/sentinel/sentinel.db-wal` | Under 50MB |
| Disk space | `df -h /` | Sufficient free space |
| npm audit | `cd ~/sentinel && npm audit` | No critical vulnerabilities |
| Python packages | `cd ~/sentinel/litellm && source venv/bin/activate && pip list` | litellm==1.83.0 |

### 9.3 Monthly Checks

| Check | How | Expected |
|-------|-----|----------|
| LiteLLM version | Verify still pinned to 1.83.0 | Do NOT upgrade |
| Backup test | Restore a backup to temp location, verify integrity | Backup is valid |
| Log rotation | Check watchdog.log size, truncate if > 10MB | `> ~/sentinel/logs/watchdog.log` |
| Retention review | Check if retention periods are appropriate | Adjust if needed |
| Shield rule review | Check whitelist is still appropriate | Remove unnecessary exemptions |

### 9.4 Database Maintenance

**Monthly VACUUM (optional — reclaims space after retention deletes):**
```bash
# Stop services first for best results
kill $(lsof -ti :5001) $(lsof -ti :4001) 2>/dev/null
sleep 3
sqlite3 ~/sentinel/sentinel.db "VACUUM;"
# Restart services
cd ~/sentinel && nohup npm run dev > logs/dashboard.log 2>&1 &
cd ~/sentinel/litellm && nohup bash start.sh > ~/sentinel/logs/litellm.log 2>&1 &
```

### 9.5 Updating the Platform

**Before any update:**
1. Backup the database
2. Note current working state
3. Read the changelog

**Dependency updates:**
- **NEVER** update LiteLLM from 1.83.0 — supply chain compromise affected intermediate versions
- All other dependency updates require explicit approval
- After updating: `rm -rf .next`, restart, verify health

**Code updates:**
- After modifying source files: the dev server hot-reloads automatically
- After deleting/renaming files: `rm -rf .next` and restart
- Always verify with `npx tsc --noEmit` (zero errors expected)

---

## 10. Security Considerations for IT Staff

### 10.1 Access Control

- **RBAC disabled (default):** Dashboard has no authentication — relies on localhost-only binding. 103 API route files (including sensitive routes) reject non-localhost callers with 403.
- **RBAC enabled:** Dashboard requires operator login with session cookie auth, CSRF protection, and role-based permissions (5 roles, 28 permissions). See the Deployment Guide for RBAC configuration.
- If remote access is needed, use SSH tunnel: `ssh -L 5001:127.0.0.1:5001 user@host`
- **Never** expose ports 5001 or 4001 directly to the network without RBAC enabled
- LiteLLM binds to 127.0.0.1 — not accessible from LAN

### 10.2 Sensitive Files

| File | Contains | Protection |
|------|----------|-----------|
| `~/sentinel/.env.local` | API keys, tokens | File permissions 600 |
| `~/sentinel/sentinel.db` | All platform data | File permissions 600 |
| `~/sentinel/litellm/start.sh` | OpenRouter API key | File permissions 700 |
| `~/sentinel/litellm/config.yaml` | Provider configs | File permissions 600 |

**Verify permissions:**
```bash
ls -la ~/sentinel/.env.local ~/sentinel/sentinel.db ~/sentinel/litellm/start.sh
```

### 10.3 Credential Rotation

| Credential | Location | Rotation Frequency |
|-----------|----------|-------------------|
| OpenRouter API key | `.env.local`, `litellm/start.sh` | Quarterly or on suspected breach |
| OpenClaw Gateway token | `.env.local` | On gateway reconfiguration |
| Autensa token | `.env.local` | Quarterly |
| SETUP_SECRET | `.env.local` | After initial admin creation (can be removed or rotated; setup page is inaccessible once an admin exists) |
| RESEND_API_KEY | `.env.local` (via Configuration UI) | Annually or on suspected breach; update in Configuration → Mail Configuration |

**After rotating a credential:**
1. Update in `.env.local`
2. Update in `litellm/start.sh` if applicable
3. Restart both services
4. Verify health

### 10.4 Supply Chain Security

- All Node.js dependencies are pinned to exact versions in `package.json`
- All Python dependencies are pinned in `requirements.txt`
- **LiteLLM 1.83.0 is the current verified-safe version** — versions after 1.82.6 up to 1.83.0 were compromised
- Never run `npm update`, `pip install --upgrade`, or any auto-update command
- Every dependency change requires manual verification and approval

---

## 11. Backup & Recovery

### 11.1 What to Back Up

| Item | Path | Frequency | Method |
|------|------|-----------|--------|
| Database | `~/sentinel/sentinel.db` | Daily | SQLite `.backup` command |
| Environment config | `~/sentinel/.env.local` | On change | File copy |
| LiteLLM config | `~/sentinel/litellm/config.yaml` | On change | File copy |
| LiteLLM start script | `~/sentinel/litellm/start.sh` | On change | File copy |
| Source code | `~/sentinel/src/` | On change | Git or file copy |
| Documentation | `~/sentinel/docs/` | On change | Git or file copy |

### 11.2 Backup Script

```bash
#!/bin/bash
BACKUP_DIR=~/sentinel-backups/$(date +%Y%m%d)
mkdir -p "$BACKUP_DIR"

# Database (hot backup)
sqlite3 ~/sentinel/sentinel.db ".backup $BACKUP_DIR/sentinel.db"

# Config files
cp ~/sentinel/.env.local "$BACKUP_DIR/"
cp ~/sentinel/litellm/config.yaml "$BACKUP_DIR/"
cp ~/sentinel/litellm/start.sh "$BACKUP_DIR/"

# Source (if not in git)
tar czf "$BACKUP_DIR/src.tar.gz" -C ~/sentinel src/ docs/ scripts/ public/

echo "Backup complete: $BACKUP_DIR"
ls -la "$BACKUP_DIR"
```

### 11.3 Recovery Procedure

**From backup (partial recovery):**
```bash
# Stop services
kill $(lsof -ti :5001) $(lsof -ti :4001) 2>/dev/null

# Restore database
cp ~/sentinel-backups/YYYYMMDD/sentinel.db ~/sentinel/sentinel.db

# Restore config
cp ~/sentinel-backups/YYYYMMDD/.env.local ~/sentinel/
cp ~/sentinel-backups/YYYYMMDD/config.yaml ~/sentinel/litellm/
cp ~/sentinel-backups/YYYYMMDD/start.sh ~/sentinel/litellm/

# Clear cache and restart
rm -rf ~/sentinel/.next
cd ~/sentinel && npm run dev &
cd ~/sentinel/litellm && bash start.sh &
```

**From scratch (total loss):**
Follow the Reconstruction Playbook (CLAWNEX-REC-001).

---

## 12. System Management Procedures

### 12.1 Archive Database

Before any major operation (upgrade, migration, uninstall), create an archive:

```bash
curl -X POST http://127.0.0.1:5001/api/system/archive
```

This creates a timestamped backup in `~/sentinel-backups/` containing the database and configuration. Verify the backup:

```bash
ls -la ~/sentinel-backups/
sqlite3 ~/sentinel-backups/*/sentinel.db "PRAGMA integrity_check;"
```

### 12.2 Purge Database

To clear all operational data while preserving configuration:

```bash
# WARNING: Destructive operation
curl -X POST http://127.0.0.1:5001/api/system/purge
```

This deletes all traffic logs, metrics, shield scans, and correlation data. Configuration, audit trail, and alerts are preserved. Use this when the database has grown too large or before a fresh start.

### 12.3 Migrate to New Host

```bash
# Generate migration package
curl -X POST http://127.0.0.1:5001/api/system/migrate -o clawnex-migration.tar.gz

# Transfer to new host
scp clawnex-migration.tar.gz user@new-host:~/

# On new host: extract and deploy
ssh user@new-host
tar xzf clawnex-migration.tar.gz -C ~/
cd ~/sentinel && npm ci
cd ~/sentinel/litellm && python3.12 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
# Update .env.local paths for new host
# Start services
```

### 12.4 Uninstall (3-Step)

Follow all three steps in order:

1. **Archive:** `curl -X POST http://127.0.0.1:5001/api/system/archive`
2. **Purge:** `curl -X POST http://127.0.0.1:5001/api/system/purge`
3. **Uninstall:** `curl -X POST http://127.0.0.1:5001/api/system/uninstall`

The uninstall step stops services, removes the watchdog cron entry, and deletes the installation directory. The archive from step 1 is preserved in `~/sentinel-backups/`.

---

## 13. Severity & Escalation Matrix

### 13.1 Severity Levels (Sev1-Sev4) and Response SLOs

| Severity | Definition | Response SLO | Resolution Target | Initial Owner |
|----------|-----------|--------------|-------------------|---------------|
| **Sev1 (CRITICAL)** | Both services down, data loss, security breach, RBAC bypass, LiteLLM version mismatch (supply chain risk), DB corruption | 15 minutes | 4 hours | On-call engineer + Security lead |
| **Sev2 (HIGH)** | One service down and watchdog cannot recover, HTTPS cert failure, auth plane offline, CVE sync hard-failing | 30 minutes | 8 hours | On-call engineer |
| **Sev3 (MEDIUM)** | Performance degradation, elevated false-positive rate, non-critical panel errors, single-operator lockouts | 2 hours | Next business day | Available engineer |
| **Sev4 (LOW)** | Cosmetic issue, log anomaly, documentation defect, feature request | Next business day | Sprint planning | Any engineer |

### 13.2 Escalation Matrix (Tier 1 / 2 / 3)

| Tier | Role | Responsibility | Escalate After | Contact |
|------|------|---------------|----------------|---------|
| **Tier 1** | Frontline operator | Triage, apply runbook, document findings | 30 min of unresolved Sev2+ | `contact@clawnexai.com` |
| **Tier 2** | Senior engineer / SRE | Deep diagnosis, hotfix, service recovery | 2 hours of unresolved Sev1 | On-call rotation (PagerDuty) |
| **Tier 3** | Engineering lead + Security lead | Code changes, incident command, customer comms | Customer-impacting Sev1 > 4 hours | ClawNex Engineering leadership |

### 13.3 On-Call Rotation Guidance

- Primary on-call rotates weekly among Tier 2 engineers
- Secondary on-call acts as backup during Primary absence and co-leads Sev1 incidents
- Handoff every Monday 09:00 local time with a 15-minute sync covering open incidents, pending Sev3 tickets, and scheduled maintenance windows
- Paging thresholds: Sev1 pages immediately 24x7; Sev2 pages during business hours, next-day otherwise; Sev3/Sev4 ticket-only

### 13.4 When to Escalate

- Watchdog has failed to restart a service for 3+ cycles (15 minutes)
- Database corruption detected (integrity check fails)
- Unknown process bound on ports 5001 or 4001
- Credential exposure suspected
- LiteLLM version changed from 1.83.0 (supply chain risk)
- RBAC permission bypass or unexpected admin promotion
- Any failed backup for 2 consecutive days

---

## 14. Runbooks

Every runbook uses the same structure: Purpose, Prerequisites, Steps, Verification, Rollback.

### 14.1 Incident Response Runbook

**Purpose:** Standardize first-hour response to any Sev1 or Sev2 event.

**Prerequisites:**
- Operator has Admin or Security Manager role
- SSH access to the host
- Read access to `~/sentinel/logs/`

**Steps:**
1. Acknowledge the page; open an incident ticket (severity per section 13.1)
2. Capture service state: `curl -s http://127.0.0.1:5001/api/health | tee /tmp/clawnex-health-$(date +%s).json`
3. Capture LiteLLM state: `curl -s http://127.0.0.1:4001/health | tee /tmp/clawnex-litellm-$(date +%s).json`
4. Snapshot logs: `sudo cp ~/sentinel/logs/*.log /tmp/clawnex-incident-$(date +%Y%m%d-%H%M)/`
5. Apply the matching runbook from section 14 or the Troubleshooting Guide (doc 17)
6. Post status update in incident channel every 15 minutes for Sev1, 30 minutes for Sev2
7. After recovery, write a post-incident review within 3 business days

**Verification:**
- `/api/health` returns `{"status":"ok"}`
- No new CRITICAL or HIGH alerts in the last 10 minutes
- Watchdog log shows steady-state healthy entries

**Rollback:**
- If a change caused the incident, follow section 14.2 Change Management rollback steps
- If unrecoverable, follow Disaster Recovery (section 14.5)

### 14.2 Change Management Runbook (Patches / Upgrades)

**Purpose:** Apply platform patches, dependency updates, and upgrades in a controlled way.

**Prerequisites:**
- Change request approved by engineering lead
- Maintenance window scheduled and communicated
- Pre-change backup verified (section 14.4)
- Rollback plan documented

**Steps:**
1. Announce start of maintenance window in ops channel
2. Archive the database: `curl -X POST http://127.0.0.1:5001/api/system/archive`
3. Copy env file: `cp ~/sentinel/.env.local ~/sentinel/.env.local.pre-change`
4. Stop services: `sudo kill $(lsof -ti :5001) $(lsof -ti :4001) 2>/dev/null; sleep 3`
5. Apply change (git pull, dependency bump, config edit) — never touch LiteLLM 1.83.0 pin
6. Clear build cache: `rm -rf ~/sentinel/.next`
7. Install dependencies: `cd ~/sentinel && npm ci`
8. Rebuild: `cd ~/sentinel && npm run build`
9. Start services (production mode): `cd ~/sentinel && nohup npm start > logs/dashboard.log 2>&1 &` and `cd ~/sentinel/litellm && nohup bash start.sh > ~/sentinel/logs/litellm.log 2>&1 &`
10. Run verification script: `bash ~/sentinel/scripts/verify.sh`

**Verification:**
- `bash ~/sentinel/scripts/verify.sh` reports all PASS
- Dashboard `/api/health` returns 200 with expected version field
- Run at least one shield scan and confirm expected verdict

**Rollback:**
- Stop services
- Restore pre-change database from archive created in step 2
- `cp ~/sentinel/.env.local.pre-change ~/sentinel/.env.local`
- `git checkout <previous-tag>` (or restore files)
- Rebuild and restart per steps 6-9
- Confirm verification script reports PASS

### 14.3 Monitoring & Alerting Runbook

**Purpose:** Document what to watch, thresholds, and what alerts mean.

**Prerequisites:** Daily / weekly / monthly checks in sections 9.1-9.3 are scheduled.

**What to watch and thresholds:**

| Signal | Source | Warning Threshold | Critical Threshold | Meaning |
|--------|--------|-------------------|--------------------|---------|
| Dashboard health | `/api/health` | non-200 for 1 cycle | non-200 for 3 cycles | Service degraded / down |
| LiteLLM health | `/api/health` (4001) | non-200 for 1 cycle | non-200 for 3 cycles | Proxy degraded / down |
| Watchdog restart count | `logs/watchdog.log` | 2 in 1 hour | 5 in 1 hour | Service instability |
| Database size | `ls -lh sentinel.db` | 500 MB | 1 GB | Retention not enforcing |
| WAL file size | `ls -lh sentinel.db-wal` | 50 MB | 200 MB | Checkpoint stuck |
| Open CRITICAL alerts | `/api/alerts?severity=CRITICAL&status=open` | > 3 | > 10 | Active incident |
| Failed login rate | `audit_log` filtered to `login_failed` | 10 / 10 min | 50 / 10 min | Brute-force attempt |
| Caddy cert expiry | `/api/system/https` | 14 days | 7 days | Cert renewal failing |
| CVE sync age | `audit_log` last `cve_sync_success` | > 2 days | > 7 days | Threat intel stale |
| Disk free | `df -h /` | 20% | 10% | Log / DB growth unchecked |

**Alert meanings:**
- `ALERT: ClawNex Dashboard is DOWN` — the watchdog could not reach `/api/health`; check section 7.1
- `ALERT: LiteLLM Proxy is DOWN` — the watchdog could not reach `/health` on 4001; check section 7.2
- `restart FAILED` — auto-recovery failed; page on-call (Sev2)
- RBAC `account_disabled` audit — operator hit 20 failed logins; potential attack

### 14.4 Backup & Restore Runbook (with RPO/RTO)

**Purpose:** Ensure recoverability of platform state.

**Targets:**
- **RPO (Recovery Point Objective):** 24 hours for database; 0 hours (immediate) for config (version-controlled)
- **RTO (Recovery Time Objective):** 1 hour for restore-from-backup; 4-6 hours for full reconstruction

**Prerequisites:**
- Backup directory exists at `~/sentinel-backups/` with adequate disk (2x database size minimum)
- Daily cron configured for the backup script

**Steps (backup):**
1. Run the backup script from section 11.2 (hot backup via SQLite `.backup`)
2. Verify: `sqlite3 ~/sentinel-backups/$(date +%Y%m%d)/sentinel.db "PRAGMA integrity_check;"`
3. Copy to off-host storage (S3, rsync target, or equivalent) — never rely on single-host backups
4. Retain daily backups for 14 days, weekly for 12 weeks, monthly for 12 months

**Steps (restore):**
1. Stop services (see section 3.2)
2. Restore database per section 11.3
3. Restore `.env.local` and LiteLLM `start.sh` / `config.yaml`
4. Clear `.next` and restart
5. Run `bash scripts/verify.sh` to confirm health

**Verification:**
- `/api/health` returns 200 within 60 seconds of restart
- Operator list, shield rules, and scheduled reports all appear as expected
- Last audit event in restored DB is within 24 hours of failure time

**Rollback:**
- If restored DB is also corrupt, try the next older backup
- If all backups fail integrity check, follow Disaster Recovery (section 14.5)

### 14.5 Disaster Recovery Runbook

**Purpose:** Recover when backups fail or the host is unrecoverable.

**Prerequisites:**
- Reconstruction Playbook (CLAWNEX-REC-001) available
- Access to a replacement host meeting section 2 requirements
- Credentials for OpenRouter, OpenClaw gateway token, and mail provider

**Steps:**
1. Stand up replacement host per Deployment Guide (CLAWNEX-DEP-001) section 3
2. If any backup archives survive, restore DB + configs (section 14.4)
3. If no backups survive, follow the Reconstruction Playbook fully
4. Re-issue all operator credentials; force password reset at next login
5. Rotate OpenRouter, Autensa, Resend, and gateway tokens (they are now considered exposed)
6. Regenerate SETUP_SECRET and Caddy certificates
7. Communicate service restoration time and data loss window (bounded by RPO)

**Verification:**
- Dashboard reachable at production URL
- Shield scans produce expected verdicts on test payloads
- Watchdog cron is reinstalled and firing
- All operators can log in with their new credentials

**Rollback:**
- None — DR is the rollback path of last resort

### 14.6 Capacity Planning Guide

**When to scale disk:**
- Sustained disk-free below 30% for 7 days
- Database size > 2 GB while retention is at default (likely retention misconfig, investigate before scaling)
- Log volume > 5 GB / week

**When to scale RAM:**
- Node process RSS consistently above 1.5 GB
- Swap usage > 10% of total memory
- SSE client counts > 50 concurrent

**When to scale CPU:**
- Sustained load average > (cores * 0.7) for 15 minutes
- Shield scan latency p99 > 100 ms
- Session watcher falling behind (new files not scanned within 10 s)

**When to consider migration to a larger host:**
- Any two of the above signals persistent for 2 weeks
- Adding multi-tenant clients that double expected traffic
- Regulatory requirement for a dedicated environment

**Upgrade path:**
1. Provision larger host meeting new target profile
2. Take hot backup on current host
3. Migrate via `/api/system/migrate` (section 12.3)
4. Cut DNS / reverse proxy to the new host
5. Monitor for 72 hours before decommissioning the old host

### 14.7 Audit Response Procedure

**Purpose:** Fulfill internal or external audit data requests (SOC 2, ISO 27001, regulator).

**Prerequisites:**
- Operator has Auditor or Admin role
- Audit request is documented in a ticket with scope, time range, and requester

**Steps:**
1. Confirm the request scope (time range, resource types, actors)
2. Export relevant audit log entries:
   ```bash
   sqlite3 ~/sentinel/sentinel.db "SELECT * FROM audit_log WHERE created_at BETWEEN '<start>' AND '<end>' ORDER BY created_at;" -csv > audit-export.csv
   ```
3. If RBAC events are needed, include the `operators`, `sessions`, and `password_reset_tokens` tables (redact `password_hash` and `token_hash`)
4. If shield decisions are needed, export `shield_scans` + `proxy_traffic` joined on `scanned_at`
5. Review exports for secrets/PII; apply redaction per the organization's data handling policy
6. Hand off export via the approved secure channel
7. Log the audit response itself as an audit event: `action: audit_request_fulfilled` with ticket reference

**Verification:**
- Exported row counts match database counts for the requested range
- Redaction review sign-off from second operator
- Audit trail records the fulfillment action with actor and timestamp

**Rollback:**
- If data is inadvertently shared, follow the organization's data-incident procedure
- Rotate any credentials present in the exported data

---

## 15. Revision History Notice

Per section 16, this document is kept under version control; see the revision history for recent changes.

---

## 16. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-02 | ClawNex Engineering | Initial release |
| 1.1 | 2026-04-05 | ClawNex Engineering | v0.5.0-alpha: Added troubleshooting for ElevenLabs voice, HeyGen avatar, CVE sync. Added system management procedures (archive/purge/migrate/uninstall). |
| 1.2 | 2026-04-08 | ClawNex Engineering | v0.5.2-alpha: Added verification script (scripts/verify.sh), gateway token update via Configuration UI, LiteLLM restart from Infrastructure panel. |
| 1.3 | 2026-04-22 | ClawNex Engineering | v0.6.1-alpha: DB health check updated with operators/operator_sessions/password_reset_tokens/custom_correlation_rules tables. New troubleshooting scenarios: RBAC login failures/lockout (7.14), CSRF errors (7.15), session expiry (7.16), /setup not loading (7.17), middleware redirect loops (7.18), password reset email failures (7.19), Caddy/HTTPS (7.20), Trust Boundary Audit (7.21), Scheduled Reports email (7.22). Daily checks updated with RBAC session table health and Caddy process check. Credential rotation table updated with SETUP_SECRET and RESEND_API_KEY. Route count updated to 103 API route files. |
| 1.4 | 2026-04-22 | ClawNex Engineering | Enterprise review: Restructured section 13 into Severity (Sev1-Sev4) + Response SLOs, Escalation Matrix (Tier 1/2/3), and On-Call Rotation. Added section 14 Runbooks with six formal runbooks: Incident Response, Change Management, Monitoring & Alerting (with threshold table), Backup & Restore (with RPO 24h / RTO 1h-6h), Disaster Recovery, Capacity Planning, Audit Response. Every runbook follows Purpose/Prerequisites/Steps/Verification/Rollback structure. |
| 1.5 | 2026-04-22 | ClawNex Engineering | v0.6.2-alpha hardening pass: LiteLLM now supervised by launchd via run.py with triple-enforced num_workers=1 and fork-bomb guards. OPENROUTER_API_KEY moved from plist/start.sh into .env.local (umask 077, chmod 600 on sentinel.db*). Audit stdout mirror added. Trust Audit caching reduces hotspot load. See `docs/security-audit-2026-04-22.md` and CHANGELOG §[0.6.2-alpha]. |
| 1.6 | 2026-04-24 | ClawNex Engineering | v0.9.0-alpha multi-auth: added §7.21A Multi-Auth Provider Failures with 4-symptom diagnostic (passkey RP mismatch, GitHub `?error=` decoder, callback URL mismatch, cookie-Secure-behind-proxy) plus audit-log query examples. Database health check query now counts `operator_credentials` rows. |
| 1.7 | 2026-04-25 | ClawNex Engineering | v0.9.2-alpha trust-boundary patch + Magic Link diagnostic: marked Symptom D (cookie-Secure-behind-proxy) CLOSED (resolved by `publicOrigin()` / `isPublicSecure()` helpers anchoring on `AUTH_EXPECTED_ORIGIN`); added Symptom E "Magic Link Send link does nothing / no email arrives" with 4-step decision tree covering admin toggle visibility, the v0.9.2 nested-form bug regression check, the `/api/config/auth-methods/test-magic-link` admin diagnostic, and token TTL / one-shot semantics; audit-log query expanded to include `magic_link_test_sent` / `magic_link_test_failed` / `operator_login` actions. |
| 1.8 | 2026-05-05 | ClawNex Engineering | v0.11.x-alpha catchup. Daily monitoring should now include: (1) `/api/tokens` response shape sanity — verify `rows`, `perSource`, `headline`, `signals`, `warnings`, `sourceStatus` are all present; missing fields indicate a build/deploy regression; (2) `sourceStatus` reporting `unavailable` for any FinOps adapter is normal during the source's own outage but should not persist (Hermes uses local SQLite, OpenClaw uses local JSONL — only Paperclip is HTTP-dependent); (3) the 12 FinOps verify scripts (`scripts/verify-*cost*.ts` — 9 cost scripts + 3 adapter scripts) totaling 162 assertions should be re-run after any FinOps adapter / orchestrator change. New troubleshooting paths to add to §7: (a) "View Evidence shows NOT IN WINDOW" — operator must widen the context-bar time range until the audit row falls inside the panel's fetch window; legacy alerts that lack `audit_event_id` use the `fallback_nearest` correlation method (±60s heuristic) and may need manual session_id lookup if outside that window. (b) "Two listeners on :5001" white-screen pattern — `pkill -9 -f "next dev"` before restarting dev. (c) Stale `.next` cache after code change → `Cannot find module './XXXX.js'` symptom → `rm -rf .next && restart`. Database health: `policies` and `policy_rules` tables added; verify rule counts in `ClawNex Default` (163) and `Generic Egress Starter` (12 enabled + 2 disabled lab held drafts) post-deploy. |

---

*This is a living document. It will be updated as operational procedures evolve.*

---

*ClawNex by ClawNex maintainers — clawnexai.com*
