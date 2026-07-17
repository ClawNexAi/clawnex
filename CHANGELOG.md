# Changelog

All notable changes to ClawNex are documented here.

Format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning 2.0.0](https://semver.org/) with pre-release suffixes (`-alpha`, `-beta`). See `README.md` for pre-release semantics.

Section ordering per release: **Added, Changed, Deprecated, Removed, Fixed, Security**. Changes with user-facing migration implications carry a **Migration** note.

## [Unreleased]

### Added — Single installer (VPS + macOS) (2026-06-13)

- `install.sh` is now the one entry point for every supported target: Linux VPS
  (systemd + Caddy + Let's Encrypt), macOS local (launchd keep-alive), and
  macOS server (launchd + Homebrew Caddy + TLS by domain class — Let's Encrypt,
  `tailscale cert` guidance for `.ts.net`, or Caddy internal CA). All modes
  drive `setup.sh` as the engine (`--preseeded`/`--no-start`), so OpenClaw
  detection/routing is identical everywhere.
- Clean-slate preflight (Phase 0): prior ClawNex artifacts are detected and,
  with explicit consent (`--clean` non-interactively), removed via
  `scripts/uninstall.sh` — any database is archived to
  `~/clawnex-pre-install-backup-*` first. Never silent. In-place reinstalls
  stop services and defer DB reset to the engine's fresh mode rather than
  uninstalling the tree being installed from.
- Non-interactive contract for QA/CI: `--mode --domain --provider
  --provider-key-env --clean --yes`.
- `scripts/verify-installer-contract.sh` — static invariants binding
  orchestrator, engine, service layers, uninstall parity, and the tarball
  manifest.
- macOS engine gate: `install.sh` refuses early with an actionable message
  when no bash ≥ 4 is available (stock macOS ships 3.2, which cannot parse
  setup.sh — a previously latent mac blocker).

### Removed

- `scripts/install.sh` (offered the deleted Docker path) and
  `deploy/deploy.sh` (legacy Ubuntu deployer) — superseded by `install.sh`.

## [0.15.8-alpha] - 2026-07-17

### Added

- The global instance, client, and severity filters now use a shared ClawNex-styled listbox with keyboard navigation, screen-reader semantics, focus restoration, outside-click dismissal, and viewport-aware positioning.
- The public repository now includes a concise roadmap and structured feature-request workflow for tracking planned work.

### Changed

- The expanded sidebar now scales with the operator's dashboard text-size setting while keeping full panel names readable and avoiding excess space before Favorite controls.

### Security

- Resolved the outstanding CodeQL findings for log injection and remote property injection, including regression coverage for persisted special-property keys and active investigation-exception cache behavior.

## [0.15.7-alpha] - 2026-07-17

### Added

- The dashboard sidebar now supports up to five operator-scoped Favorites and three persistent Recent panels. Star controls remain beside the canonical navigation entries, unavailable panels are excluded, and the Help panel documents both workflows.

### Changed

- Dark and light theme muted-text tiers now maintain readable contrast on nested panel surfaces. Sidebar Favorites, Recent items, group headings, and navigation labels use larger type so the new hierarchy remains legible without enabling accessibility mode.

## [0.15.5-alpha] - 2026-07-02

### Added

- Hermes custom-provider routing can now be saved from Configuration → Hermes Routing, a dedicated sub-panel separate from OpenClaw Routing. Config-backed Hermes `custom_providers` with HTTP-compatible endpoints can be selected and routed through the local LiteLLM proxy for real-time Prompt Shield scanning.
- `/api/connector-routing` now supports `apply-hermes` and `revert-hermes`, using the same operator-intent model as OpenClaw while preserving Hermes-specific safety boundaries.
- `/api/hermes/gateway/restart` detects and restarts known Hermes gateway supervisors so Hermes reloads provider config after a save/revert.
- `scripts/verify-connector-routing-inventory.ts` now proves Hermes custom-provider apply/revert behavior, LiteLLM `key_env` usage, and sidecar secret hygiene.

### Changed

- OpenClaw Routing and Hermes Routing are now distinct operator surfaces. OpenClaw Routing owns OpenClaw provider/model routing plus the legacy OpenClaw wire/revert/restart controls; Hermes Routing owns writable Hermes config-backed rows plus Save Hermes Wire, Revert Hermes Wire, and Restart Gateway controls.
- Hermes routing changes are recorded in a separate local sidecar that stores only endpoint metadata and key environment variable names, never API key values.

### Security

- Hermes routing restore is conservative: ClawNex only reverts a provider if its current endpoint still matches the ClawNex-managed LiteLLM target. Operator edits made after routing are preserved.

## [0.15.4-alpha] - 2026-07-02

### Changed

- Selective Connector Routing now uses a compact badge legend for provider/model/route state definitions instead of repeating the same explanation on every row.
- The local LiteLLM entry is displayed as a non-selectable `PROXY BRIDGE` so operators can see the bridge without mistaking it for an upstream provider to route.
- Shield Tests, Models & Cost, and Tools & Access now use nearby legends for dense repeated labels.
- Provider-level OpenClaw routing guidance remains available in the routing explanation/help docs while the model rows stay cleaner.

## [0.15.3-alpha] - 2026-07-02

### Added

- Selective Connector Routing inventory for OpenClaw and Hermes. Configuration → OpenClaw Routing now discovers provider/model rows, records operator route intent, and shows new/changed/removed drift markers.
- `/api/connector-routing` for inventory sync, OpenClaw selection updates, and applying selected OpenClaw provider-level routing.
- Header Updates badge now treats connector-routing drift as actionable and deep-links operators to the OpenClaw Routing card.
- `connector_routing_items` SQLite table stores provider/model inventory, desired route state, route status, and drift timestamps without storing provider API keys or raw prompt content.
- `scripts/verify-connector-routing-inventory.ts` proves OpenClaw provider/model discovery, selective apply/revert, sidecar secret hygiene, IPv6 localhost route detection, object-style OpenClaw provider-map parsing, and Hermes read-only enforcement.

### Changed

- Welcome Wizard routing now opens the selective routing card first. The old all-provider `Wire LiteLLM` path remains available only as an explicit legacy compatibility action.
- `install.sh` and `setup.sh` no longer preseed or default to legacy all-provider OpenClaw wiring. Operators choose provider/model routing after first sign-in unless they explicitly opt into the legacy wire.
- OpenClaw posture scanning now supports real object-style `models.providers` maps as well as older array-style provider lists.

### Security

- Selective routing sidecars preserve only original/routed base URLs and hashes. Provider API keys remain in OpenClaw-owned configuration and are not copied into ClawNex sidecars.
- Hermes routing remains read-only until Hermes exposes a safe routing/control contract; ClawNex inventories observed Hermes model drift but does not write Hermes config.

## [0.15.2-alpha] - 2026-07-02

### Added

- Hermes Agent diagnostics now report install state, `state.db` readability, schema validity, active profile, configured and observed channels, skill and extracted-tool counts, 24h session/message activity, watcher cadence, and Prompt Shield visibility.
- Hermes ingestion now persists a durable home-scoped high-water cursor in `hermes_ingest_cursors` and normalized, profile/channel-scoped, content-hash-only message scan rows in `hermes_events`.
- Configuration, Infrastructure, Fleet, and detailed Health surfaces now use the shared Hermes diagnostics model so stale, unreadable, or partially configured Hermes installs are visible to operators.
- Auto-detected Hermes homes can be explicitly saved from Configuration → Fleet Connectors after the diagnostic checklist is reviewed.
- `scripts/verify-hermes-integration.ts` covers Hermes diagnostics, durable cursor behavior, normalized event writes, and raw-message non-persistence.

### Changed

- Hermes fleet status now distinguishes live, stale, idle, unreadable, and schema-mismatch states instead of treating every readable `state.db` as fully healthy.
- Hermes watcher restart behavior is now cursor-backed and idempotent across dashboard restarts.

### Security

- Hermes event storage records message hashes and scan metadata only. Raw Hermes message content remains transient to the shield scan path and is not persisted in `hermes_events`.

## [0.15.1-alpha] - 2026-07-01

### Fixed

- Model pricing sync now resolves against the exact pinned stable LiteLLM release tag, `v1.84.10`, and rejects pre-release runtime pins. ClawNex no longer derives model pricing from nightly LiteLLM tags or the unverified upstream tip.
- Configuration → AI & Models now displays the stable pinned pricing source tag instead of appending a pre-release suffix.
- Bundled model pricing data was regenerated from LiteLLM `v1.84.10`.

### Changed

- Product docs, public docs, and operational notes now state the current LiteLLM pin as `1.84.10`.
- Stale wording that implied runtime pricing sync depended on nightly LiteLLM tags was removed.

## [0.15.0-alpha] - 2026-05-17

### Fixed — Veracity audit F1–F6 + behavioral proofs + macOS build unblock (2026-06-12)

Truth-in-documentation pass verifying the dashboard's own counts, posture readings, and public API against what the code actually does. Six factual-drift findings closed, every load-bearing detection/correlation/audit claim proven against a live target, and the macOS `next build` blocker resolved. Full evidence: [`docs/qa/veracity-audit-2026-05-19/VERACITY-AUDIT.md`](docs/qa/veracity-audit-2026-05-19/VERACITY-AUDIT.md).

- **F1 — Trust Audit rule count corrected 14 → 15.** Tooltip claimed a 14-rule scan; actual is 15. Now derived from a client-safe `TRUST_AUDIT_RULE_COUNT` mirror of `AUDIT_RULES` so the surface can't drift from the engine.
- **F2 — Panel count corrected to 26.** Scattered 22 / 23 / 25 claims reconciled to the canonical 26 (the guided tour narrates all `Object.keys(PANEL_HELP)` = 26 panels).
- **F4 — Public `/api/v1/fleet` alert count now applies the production-origin filter.** Parity with the internal `/api/fleet` — both endpoints now report the same number.
- **F5 — `TokenCostPanel` surfaces total fetch failure instead of showing stale data as live.** A failed fetch no longer renders prior data as if it were a fresh reading.
- **F6 — Stale "155 shield rules" corrected to 163.** Current-claim sites updated; genuinely-historical scope statements left untouched.
- **macOS `next build` blocker resolved on Next 16.** The production build that had been failing on the macOS development host (failure originated under Next 14) now completes cleanly on Next 16.
- **Behavioral proofs.** Shield blocks real attacks (26/26 hermetic + live); all 10 correlation rules fire (`verify-correlation-rules` 23/23 + live end-to-end incidents); audit trail truthful (`verify-audit-completeness` 15/15 + 208 live stdout-mirror lines). Six new verifiers landed — `verify-posture-reconciliation`, `verify-count-claims`, `verify-v1-fleet-origin-filter`, `verify-verdict-high-floor`, `verify-correlation-rules`, `verify-audit-completeness` — full verifier suite now 59 green.

### Security — Shield verdict floor: ANY HIGH detection floors to REVIEW (V-B1) (2026-06-12)

- **V-B1 — HIGH-severity detections no longer silently ALLOW.** A HIGH-severity detection in any non-outbound-leak category (e.g. a C2 exfiltration to `webhook.site` / `ngrok`, a reverse-shell command, a jailbreak) that scored below the 25-point REVIEW threshold *in isolation* previously returned ALLOW. Now ANY HIGH detection floors to at least REVIEW (CRITICAL still BLOCK). Verified live — a `webhook.site` exfil prompt that previously returned ALLOW now returns REVIEW — and reproduced hermetically. Verifier: `verify-verdict-high-floor`.

### Changed — Posture reconciliation + de-identification sweep (2026-06-12)

- **F3 — Single shared posture reconciliation.** Security posture was computed in two places that could disagree; a shared `reconcilePosture` in `metric-semantics.ts` now backs every posture surface. The fleet fallback is honestly labeled **"Fleet est. (N)"** rather than presented as an exact reading. Verifier: `verify-posture-reconciliation`.
- **De-identification sweep** ahead of OSS release. Named personas replaced with neutral roles (`implementation-agent` / `internal-reviewer`); GitHub org references normalized to `ProBizSystems/ClawNexAI`. Live QA confirmed the running build is persona-clean.

### Security — Codex 6-round adversarial closure + internal reviewer r4 BLOCKER + DAST Run 3 clean pass (2026-05-17)

13-commit hardening pass on the chat-relay shield surface closing five Codex adversarial rounds plus the reviewer's round-4 BLOCKER. The load-bearing fix at HEAD `a07fea6` is the scan-equals-forward invariant: both chat routes (`/api/v1/chat/completions` and `/api/chat`) sanitize incoming `messages[]` / `history[]` through a shared strict `{role, content}` allowlist and forward a rebuilt `safeMessages` / `safeHistory` representation rather than the raw caller body. The shield's scan input and the upstream forwarded body are the same bytes. DAST Run 3 on staging host returned zero CRITICAL / HIGH / MEDIUM open findings.

**Breaking changes** (Migration):

- Both chat routes now refuse non-`{role, content}` message shapes with `400`. Clients sending `name`, `tool_calls`, `function_call`, `tool_call_id`, or any other sibling field must drop them before the request. Multimodal / structured `content` (arrays, objects, numbers) is also refused — only string `content` is supported until the relay grows a normalize-then-scan pipeline that builds the forwarded payload from the scanned representation. Positive contract: `docs/10-api-reference.md` (`POST /v1/chat/completions` and `POST /api/chat` sections).
- The `Authorization: Bearer cnx_…` form previously listed alongside `X-ClawNex-Key: cnx_…` is documented per-section, not in a single global table — both header forms still work; only the doc layout moved.

**Closure surfaces:**

- New shared module `src/lib/shield/sanitize-chat-payload.ts` — strict `{role, content}` allowlist with role validation.
- New shared module `src/lib/shield/extract-assistant-output.ts` — walks every OpenAI assistant-output channel (`text`, string + array `message.content`, `tool_calls.arguments`, `function_call.arguments`, streaming `delta`, unknown nested fields). Wired into both v1 outbound BLOCK gate and all 3 `/api/chat` LLM-relay branches.
- v1 outbound BLOCK gate (`04cf74e`) — `extractAssistantOutput` + `outboundShieldGate` on the success path; `BLOCK` with `proxy_block_mode` on/block returns generic `503`.
- `/api/chat` outbound parity (`c4a30f5`) — LiteLLM / LM Studio / OpenClaw branches all gate through the same helper.
- Provider hostname allowlist (`a4c628a` + `1ce0adf`) — new `PROVIDER_HOST_ALLOWLIST` of 12 known public LLM providers + operator-extensible `TRUSTED_PROVIDER_HOSTS` env. Closes DNS-rebinding TOCTOU on `addProvider` / `updateProvider`. Risk register R-037 closed.
- Origin host allowlist + DNS-rebinding GET coverage (`8262653` + `eaeeab9`) — new operator-extensible `TRUSTED_HOSTS` env.
- XFF rate-limit trust gate (`b20ff17`) — middleware no longer trusts `X-Forwarded-For` by default; trust gated on `TRUST_PROXY_HEADERS=1` (auto-set by `deploy/install-prod.sh`). Caddyfile template emits `header_up X-Forwarded-For {remote_host}`.
- `getDbPath` resolver (`97417ae`) — archive / migrate / uninstall routes now use the same path resolver as `getDb()`. Closes silent backup failure on post-rebrand installs where the live DB is `clawnex.db` (or `$DATABASE_PATH`).

**Three controls remain code-verified rather than DAST-proven** for environmental reasons (RBAC-off host allowlist on a RBAC-on QA target; provider DNS rebinding without a hostile-DNS rig; v1 sanitize invariant being API-key gated). Listed in `docs/qa/accepted-residuals.md` "Environment-limited DAST verification" — NOT as accepted residuals; they are controls.

**Verifier footprint:** 137 assertions across 8 new Codex-class verifiers — `verify-extract-assistant-output.ts` (37/37), `verify-chat-outbound-block.ts` (13/13), `verify-chat-invariant.ts` (35/35, capture-mock asserts upstream body shape), `verify-v1-outbound-block.ts` (7/7), `verify-middleware-xff-trust.ts` (4/4), `verify-db-path-resolver.ts` (9/9), `verify-origin-allowlist.ts` (16/16), `verify-provider-ssrf-write.ts` (16/16).

Risk register: R-037 closed; R-040 (chat-relay scan-vs-forward divergence) opened and closed in the same pass.

Full evidence: [`docs/qa/dast-run-3-2026-05-17.md`](docs/qa/dast-run-3-2026-05-17.md). Project-history milestone: [`docs/21-project-history.md`](docs/21-project-history.md) → v0.14.5-alpha (2026-05-17). Security assessment cross-reference: [`docs/24-security-assessment.md`](docs/24-security-assessment.md) §"2026-05-17 QA DAST clean pass". Release notes: [`docs/13-release-notes.md`](docs/13-release-notes.md).

### Changed — Next.js 14 → 16 framework upgrade (2026-05-15)

Major-version jump from `next@14.2.35` (caret) to `next@16.2.6` (exact pin). Not a security fix on its own — the upgrade was advised by prior DAST-tool reports for CVE coverage, and lands alongside the DAST Run 2 + Round 3 closures so the same deploy gets both. **Migration notes:**

- **Build script:** `next build` → `next build --webpack`. Next 16 makes Turbopack the build-time default; we keep webpack until our `next.config.mjs` `webpack:` block is migrated to the Turbopack equivalent.
- **Dev script:** `next dev` → `next dev --webpack` (commit `e8d86cd`). Without the explicit flag Next 16 refuses to start when a `webpack:` config is present without a corresponding `turbopack:` config — manifests as a 256 exit status and a crash-loop under launchd.
- **Config keys renamed:** `experimental.serverComponentsExternalPackages` → `serverExternalPackages` (top-level). `experimental.outputFileTracingExcludes` → `outputFileTracingExcludes` (top-level).
- **App Router signatures:** route handler `params` is now `Promise<{...}>` and must be awaited (`(await params).id`). `headers()` from `next/headers` is now async; `cookies()` is async. `RootLayout` is now `async` and `await`s `headers()`.
- **`X-Powered-By` header:** `poweredByHeader: false` added to `next.config.mjs` so SSR HTML responses no longer carry `X-Powered-By: Next.js` (DAST 2026-05-15 #N2; previously Caddy stripped it on the QA edge but local dev host still emitted it).
- **Pin policy:** dropped the caret from `next` and `postcss` so the lock matches the canonical pin policy (commit `bd4439e`). Both now exact: `next@16.2.6`, `postcss@8.5.10`. `node_modules` and `package-lock.json` confirmed pinned.
- **Deprecation warnings:** Next 16 prints `The "middleware" file convention is deprecated. Please use "proxy" instead.` Tracked as a follow-up; non-breaking until a future minor.

### Security — DAST Run 2 + Round 3 closure (2026-05-15 → 2026-05-16)

Two-day closure campaign on top of the Round 15 sweep. Run 2 (2026-05-15) surfaced 8 persisting + 1 new finding against staging host after the Round-15 fixes shipped; Round 3 (2026-05-16) reverified after each landing and surfaced 2 LOW follow-ups (one ops-seed, one input-hygiene) that were also closed. Net posture at the end: **zero CRITICAL / HIGH / MEDIUM / LOW open** beyond the documented residuals **AR-001 (M1 style-src-attr)** and **AR-002 (H8 Pattern-B same-host trust)**. Full evidence: [`docs/qa/dast-run-2-2026-05-15.md`](docs/qa/dast-run-2-2026-05-15.md).

- **C1 (CRIT) — CSRF token now session-bound** (commit `6f0789b`, predates Run 2; verified Run 2). HMAC-SHA256(`SESSION_SECRET`, `session.id`) replaces the prior double-submit equality check in `validateCsrf`. New `src/lib/auth/csrf-hmac.ts` + `csrf-cookie.ts`. `validateSession` now returns `{operator, sessionId}`. Forged cookie/header pairs and mutated tokens both return 403 `CSRF validation failed`. Verifier: `scripts/verify-csrf-session-binding.sh` (12/12).
- **H2 (HIGH) — DB file perms 600 from creation, not from first runtime open** (commit `ca4d3b9`). Prior fix chmod'd 600 *after* `new Database()` and the `journal_mode=WAL` pragma, leaving a race window where the freshly-created DB file existed at 644 from the umask before chmod fired. Closure: `process.umask(0o077)` set before constructing the connection (restored in `finally`), so the DB triple is born 600. `deploy-prod.sh` chmod 600 added on the restored DB triple after tar extraction. `setup.sh` chmod 600 added on the pre-setup DB backup archive. Verifier: `scripts/verify-db-perms.sh` (3/3 under a `umask=022` wrapper that fails if the runtime fix is removed).
- **H5 + H6 (HIGH) — dual-window rate-limit + Caddy edge plugin detection** (commits `f5a28d9` + `a0e4a8d`). App-layer middleware now uses dual buckets: burst (10s) AND sustained (60s); both must pass. Generic `/api/*` policy is 10/10s + 120/min — catches the DAST 15-rapid-requests pattern at hit 11 while leaving headroom for normal multi-panel polling. `/api/health` and `/api/chat` are 5/10s + 10/min. `/api/auth/login` is 8/10s + 30/min. HTML pages 6/10s + 12/min. Edge layer: `deploy/install-prod.sh` auto-detects whether the running Caddy has the `caddy-ratelimit` plugin (`caddy list-modules | grep http.handlers.rate_limit`); emits a `rate_limit { ... }` block with burst (20/10s) + sustained (240/min) zones per `remote_host` if present, prints an xcaddy-build advisory if absent (so unconditional emission can't fail `caddy validate` on stock apt/brew Caddy). Verifier: `scripts/verify-dast-run2-fixes.sh` (7/7) + `scripts/verify-caddyfile-hardening.sh` (15/15).
- **H8 (HIGH) — Pattern-B same-host trust accepted as residual** (commit `45e3c58`). RBAC-off + localhost is the documented trust boundary of single-operator local-first installs (any same-uid process can already read `.env.local` at chmod 600 same-uid-readable, the SQLite DB directly, or replace the dashboard binary — adding an in-process API token cannot raise the bar above zero). `scripts/deploy-prod.sh` already hard-codes `RBAC_ENABLED=true` for production deploys, so the residual cannot apply to a network-reachable host. `requireLocalhost` still refuses remote IPs + non-loopback binds + cross-origin mutations; `ReadinessBanner` / `FleetCommandPanel` / mission-control Phase 6 surface RBAC-off in the UI. Documented as **AR-002** in [`docs/qa/accepted-residuals.md`](docs/qa/accepted-residuals.md) with explicit retest conditions, cross-linked to **R-039** in the risk register.
- **M1 (MED) — `style-src-attr 'unsafe-inline'` accepted as residual, inline note added** (commit `e3ebc8b`). Risk-accepted as **AR-001** previously; this run adds the acceptance rationale as an inline comment next to the CSP directive in `src/middleware.ts:60-68` so future audits short-circuit. Per the staging host DAST agent's analysis: exploitation requires attacker-controlled content reaching a style-attribute value, which is itself an HTML/attribute-injection XSS — close that class at the source. A CSS-variable migration of inline style props would still need `'unsafe-inline'` here (custom-property assignments via `style={{ '--w': … }}` also flow through `style-src-attr`).
- **M4 (MED) — audit pagination 400-rejects invalid limits at the route boundary** (commit `4d0d851`). New `parseAuditLimitOrReject(raw)` helper returns `{ ok: false, error }` for `limit > MAX_AUDIT_LIMIT (100)`, non-finite, non-integer, `< 1`, or trailing-garbage strings. Both `/api/audit` and `/api/v1/audit` return 400 + descriptive error instead of silently normalizing. `clampAuditLimit` retains tolerant behavior for internal service callers; `listEvents` continues to re-clamp as defense-in-depth. Verifier: 33 + 17 = **50/50** assertions in `scripts/verify-audit-pagination-clamp.sh`.
- **M8 (MED) — `/api/chat` rejects non-JSON content-type with 415** (commit `f5a28d9`). Previously a `text/plain` or `application/x-www-form-urlencoded` body produced a 500 from the JSON-parse exception bubbling to the outer catch. Now: explicit `Content-Type` check before parse, returns 415 with `{"error":"Content-Type must be application/json"}`; malformed JSON with the right content-type returns 400.
- **NEW (MED) — `/api/health` (non-V1) drops `version` + `uptime`** (commit `f5a28d9`). The V1 endpoint was stripped in DAST Round 15 (M3); the non-V1 endpoint wasn't. Now returns `{status, name, timestamp}` only.
- **N1 (LOW, Round 3) — well-known crawler / discovery files served as real text** (commit `8786763`). `public/robots.txt`, `public/.well-known/security.txt` (RFC 9116 contact + 1y `Expires`), `public/sitemap.xml` added. `src/middleware.ts publicPaths` allow-list extended for `/robots.txt`, `/sitemap.xml`, `/.well-known/`. Previously the Next catch-all was returning the SPA login HTML — confused scanners and fingerprinted Next.
- **N2 (LOW, Round 3) — `X-Powered-By` stripped from HTML responses** (commit `8786763`). See Next 16 migration notes above.
- **Round 3 Finding 1 (LOW) — Auditor account seeded with role `viewer`** (operator-side fix; no code change). operator reseeded the test account with role=auditor; the seed bug was a QA-account provisioning issue, not a runtime authz flaw. Re-verified Round 3.
- **Round 3 Finding 2 (LOW) — `/api/audit` `since` / `until` ISO 8601 validation** (commit `48027e3`). New `parseAuditDateOrReject(raw, fieldName)` helper. Strict shape regex (YYYY-MM-DD or full RFC 3339), then `Date.parse`, then a UTC-component round-trip check that catches `"2099-13-99"` and `"2026-02-30"` which `Date.parse` silently coerces into adjacent valid dates. Both audit routes now 400 on invalid dates with descriptive error messages. Verifier extended with 17 new date-shape cases; 50/50 total. `?offset=…` and `?from=…` were probed by the DAST agent but are not features of this route — silent-ignore is conventional Next behavior for unknown query args; not closed (would be a feature decision, not a security fix).
- **Pin policy enforcement** (commit `bd4439e`). `next` and `postcss` both dropped from caret to exact per [[pin-dependencies]] memory.

### Security — DAST Round 15 remediation (2026-05-14)

Live DAST sweep against both `localhost:5001` (local dev host, RBAC off) and `<qa-host>` (staging host, RBAC on, Caddy TLS). All reported findings closed except **H2 (`style-src 'unsafe-inline'`)**, which is queued as the final gate before public OSS launch. Full evidence with commit chain, verifier output, and live-verification table: [`docs/qa/dast-remediation-2026-05-14.md`](docs/qa/dast-remediation-2026-05-14.md).

- **P0-A — Origin/Referer enforcement at `requireLocalhost`** (commit `9088ff5`). Shared `validateOriginMatch` helper at `src/lib/auth/origin-match.ts` consumed by both `requireLocalhost` and `validateCsrf`. Closes browser-driven CSRF on `/api/system/purge`, `/api/break-glass/activate`, `/api/proxy/block-mode`, `/api/config/defaults`. New verifier: `scripts/verify-origin-block.sh` (17 unit + 4 live).
- **P0-B — RBAC-off Pattern-B GET leak closed on 21 routes** (commit `ab21c26`). Explicit `else { requireLocalhost(request) }` clause added to fleet, events/stream, alerts, audit, tokens, costs, proxy/stats, shield/history, shield/stats, cve, threat-intel, tools, skills, models, sessions, reports, paperclip/observability, watcher/recent, workspace/agents, infrastructure, docs. New verifier: `scripts/verify-pattern-b.sh` (21 static + 21 live).
- **P0-C — `/api/config/defaults` protected-key denylist** (commit `0949d0c`). `PROTECTED_PREFIXES = ['retention_']` + `PROTECTED_EXACT = {break_glass, proxy_block_mode}` reject the generic-write bypass that previously let attackers set `retention_audit_days=1` and rotate the audit log every day. New verifier: `scripts/verify-config-defaults-protect.sh` (16/16).
- **Loopback-bind trust in `requireLocalhost`** (commit `e0667bf`). `NextRequest.ip` is undefined in self-hosted Node runtime (standalone server.js + plain `next start`); pre-fix `requireLocalhost` fail-closed in production with no IP, making every legitimate same-origin POST return 403. Now trusts `HOSTNAME=127.0.0.1` (OS-guaranteed loopback) when `NextRequest.ip` is undefined.
- **internal reviewer P1 sweep** (commit `cef9de7`, landed overnight): P1-A `x-clawnex-nonce` response header removed; P1-B outbound shield fails CLOSED on scanner exception (503 + audit row); P1-C `body.history[]` shield-scanned alongside the current message; P1-D `fetch()` in `testProvider`/`testGateway` uses `redirect: 'error'`.
- **M4-related — outbound shield on `/api/chat` direct paths** (commit `2e2d78b`). Shared `outboundShieldGate` helper (`src/lib/shield/outbound-gate.ts`) wraps the LM-Studio-direct and OpenClaw-gateway-direct fallback paths that previously skipped outbound scanning. Fail-CLOSED on scanner exception; 503 on BLOCK with `block_mode=on`. New verifier: `scripts/verify-outbound-gate.sh` (6/6).
- **L3 — audit actor accuracy in RBAC-off** (commit `2e2d78b`). `DEFAULT_OPERATOR.username` renamed `admin → localhost` so audit_log entries from unauthenticated localhost-trust actions are distinguishable from real authenticated admin actions. `displayName` clarified to `Local Admin (unauthenticated)`. `role` unchanged (still `admin`). New verifier: `scripts/verify-audit-actor.sh` (4/4).
- **H1 — login response-time floor** (commit `b9b2677`). `MIN_LOGIN_FAILURE_MS = 2000` on every 401 return from `POST /api/auth/login`. Live timing delta on QA after fix: 4ms (was 4× — admin@2638ms vs nonexistent@651ms).
- **H4 — `operatorCount` stripped from anonymous `/api/auth/status`** (commit `b9b2677`). Authenticated callers still see the count.
- **M1 — security headers consolidated to Next.js** (commit `b9b2677` + `install-prod.sh` Caddyfile change). Caddy no longer emits its own header block; HSTS includes `preload` for parity. Each of the 5 security headers now appears exactly once.
- **M2 — `POST /api/auth/login` returns 400 on malformed JSON** (commit `b9b2677`). Was 500 due to parse exception bubbling to the outer catch.
- **M3 — `/api/v1/health` strips `version` + `uptime` from anonymous responses** (commit `b9b2677`). Authenticated v1 callers (any valid key, no scope required) still get the full payload. Invalid-key callers receive the anonymous response — not 401 — to avoid leaking key-validity timing.
- **M5 — forgot-password returns the generic envelope on every branch** (commit `b9b2677`). Previously leaked "RBAC is not enabled" and "Email is not configured" to unauthenticated probes.
- **M6 — `Cache-Control: no-store` on `/api/*`** (commit `b9b2677`). Intermediate caches can no longer replay operator-scoped responses.
- **L1 — Caddy `Via:` + `Server:` headers stripped** (`install-prod.sh` change). Reverse-proxy fingerprint no longer leaked.
- **Shield T06 — steganography rules scan raw text** (commit `0b51a69`). `STEG-ZERO-WIDTH` and `STEG-BIDI-OVERRIDE` previously couldn't fire because `normalizeForScan` stripped exactly the codepoints those rules target. Shield-triage release-grade now 26/26 (T04 base64 remains a Coverage Lab probe, not a release regression).

### Accepted residuals

- **AR-001** (was H2 / M1) — `style-src-attr 'unsafe-inline'` retained on the attribute-level CSP layer. The element-level vector (`<style>` injection) is closed by `style-src-elem 'self'` (commit `944216e`, 2026-05-15); the attribute-level clause is kept so the ~3,169 React `style={{...}}` callsites continue to work. Migration to className-based or CSS-variable-only flow is a separate work package; the attacker-class is XSS-class (close at the source), not a CSS-injection class. Inline acceptance note at `src/middleware.ts:60-68`. Full retest conditions in [`docs/qa/accepted-residuals.md`](docs/qa/accepted-residuals.md) AR-001. Risk-register: R-036 (closed-with-retained-clause).
- **AR-002** (was H8) — Pattern-B same-host trust. RBAC-off + localhost-bind is the documented trust boundary of single-operator local-first installs. `scripts/deploy-prod.sh` hard-codes `RBAC_ENABLED=true` for production deploys, so the residual cannot apply to a network-reachable host. Full retest conditions in [`docs/qa/accepted-residuals.md`](docs/qa/accepted-residuals.md) AR-002. Risk-register: R-039 (closed-accepted).

### Known issues

- **DNS rebinding on `testProvider`/`testGateway`** — internal reviewer P1-D closed the 302-redirect-bypass class. DNS rebinding (hostname resolves to public on first lookup and metadata IP on a second) is a separate class, not closed here. Tracked as R-037.
- **Denied-attempt audit logging** — when guards refuse a request (401/403), no audit_log row is written. Probes from `evil.com` leave no audit trail; only the Caddy/Next access log records them. Tracked as R-038.
- **`/api/audit` `?offset=` / `?from=` silent-ignore** — these query params are not features of the route (no SQL OFFSET; the route uses `since`/`until` not `from`/`to`). Unknown-param silent-ignore is conventional Next behavior. Adding offset support is a feature decision, not a security item. Surfaced as a cosmetic in DAST 2026-05-16 Round 3.
- **Next 16 `middleware` → `proxy` deprecation** — Next 16 prints `The "middleware" file convention is deprecated. Please use "proxy" instead.` Non-breaking until a future minor; tracked for the next framework-hygiene pass.

## [0.14.5-alpha] - 2026-05-08 (Phase 5 + Phase 6 Triage Graph closeout)

The Action Queue's Triage Graph reaches end-to-end completion: 5 new family resolvers (Phase 5) plus 5 upstream rawSource producers (Phase 6) so the dispatch path that landed in earlier v0.14 patches now actually surfaces rows in Mission Control. Stat tiles across the dashboard get a visual lift; deploy script gains Tailscale-only support and portable LiteLLM bootstrap on fresh Linux boxes.

### Added (Phase 5 — family resolvers)

- **5 new triage resolvers** so every dispatch-ready `rawSource.kind` has a per-source 5-stage build path: `correlation-resolver.ts` (multi-source signal join, evidenceTrail surface), `blast-radius-resolver.ts` (root signal → propagation vector → affected sessions; ms-epoch window), `auth-rbac-resolver.ts` (5 finding kinds: rbac_off / overprovisioned_role / missing_permission_check / stale_session / shared_admin_account), `update-cve-resolver.ts` (per-CVE record with packageName / currentVersion / fixedVersion / cveScore), `policy-warning-resolver.ts` (3 scopes: shield_rule / policy_default / config_drift).
- **Action Queue dispatch table** in `ActionQueue.tsx` widened to route the 5 new `rawSource.kind` values (`correlation` / `blast-radius` / `auth-rbac` / `update-cve` / `policy-warning`) to their per-source resolvers and fall back to the generic action-row resolver only when `rawSource` is absent or unrecognized.
- **`scripts/verify-triage-graph-contract.ts` extended** to 236 assertions covering the 5 new resolvers — stage IDs, stage titles, artifact wiring, resolver versions, evidence/trail population, navigation targets, and the redaction allowlist.

### Added (Phase 6 — rawSource producers)

- **5 upstream emitters** at `src/components/dashboard/panels/mission-control/phase6-producers.ts` that turn dispatch-ready families into actual queue rows: `cveToRows` (top-10 by CVSS), `authRbacScan` (RBAC-off + overprovisioned-role detector), `blastRadiusFromAlerts` (top-3 most-recent CRIT alerts → blast graph), `policyWarningScan` (low-confidence + stale Shield-rule scanner), `correlationDetect` (multi-source signals sharing a session_id within 10 minutes).
- Every producer stamps the canonical `ACTION_VERBS` verb on its `SuggestedAction` and respects the operator-permission gate so restricted operators see read-only queue rows where appropriate.
- **`scripts/verify-phase6-producers.ts`** — hermetic harness asserting (1) producer length caps, (2) `rawSource.kind` correctness, (3) verb taxonomy compliance, (4) restricted-gate honors operator perm, (5) end-to-end producer → resolver wiring stamps the family resolverVersion.

### Added (verifiers)

- **Synonym-denylist sweep across the 5 Phase 5 resolvers** (`4a1771e`) — 130 new assertions in `verify-correlation-resolver.ts` / `verify-blast-radius-resolver.ts` / `verify-auth-rbac-resolver.ts` / `verify-update-cve-resolver.ts` / `verify-policy-warning-resolver.ts`. Every banned synonym (Inspect / Audit / Tighten / Constrain / Block / bare Investigate / bare Review / bare View / "Take action" / "Click here" / "Fix issue") is asserted absent from each resolver's stage copy. Total verifier assertion count across the test stack is now **343** (213 prior + 130 sweep).

### Changed (UX)

- **Stat tiles read as elevated panels everywhere they appear.** New theme tokens `glassPanelNested` + `glassPanelNested2` + `glassBorderCyanStrong` lift the nested gradient + stronger cyan border on every Stat consumer (`shared.tsx::Stat`). Visual lift verified across 8 panels (Mission Control KPI row, Fleet Command stat strip, Instance Detail 8-stat row, CVE Database, Traffic Monitor, Token & Cost Intel, Correlations, Access Control small variant) — see `docs/qa/aeade4b-visual-2026-05-08.md`.
- **Card / CollapsibleCard `dimGlow` prop (opt-in).** Operators tweaking custom panels can pass `dimGlow` to dampen the cyan radial halo (.10 → .05) and accent border glow (.44 → .22) on full-width cards that read brighter than peers — used on CVE Database to calm the halo against neighbour Hardening Report.
- **Timeline panel pagination** (`54a6dea`). 10 rows / page, default-open, prev / next controls. Long timelines no longer push the panel below the fold. Same pagination pattern as Shield Tests.
- **Blast-radius "Most Exposed Surfaces" unknown / missing values** render as a muted-italic em dash (`—`) instead of `0` or `null`. Fixes the false-reassurance reading where missing data looked like "no exposure."
- **Alerts row spacing tightened** (`0418c15`) to match Shield Tests density — same padding / radius scale, same single-line collapsed-card pattern.

### Changed (deploy)

- **`deploy-prod.sh` parameterizes the remote user** (`c7393d3`). `chown` / preserve-paths use `$USER:$USER` instead of the hardcoded `<operator-user>`, so deploys to test boxes where the SSH user isn't `<operator-user>` no longer leave the install owned by a non-existent account.
- **`install-prod.sh` auto-detects `*.ts.net` domains** and skips the public DNS preflight check (`c7393d3`). When the domain matches the Tailscale magic-DNS suffix, the script logs an explanatory warning ("Caddy auto-HTTPS won't work for .ts.net. Use `tailscale cert` and a manual Caddyfile after install.") and proceeds. Lets the same script drive both public-domain (Path B, staging host / qa) and Tailscale-only (Path A, test boxes) deploys.
- **`install-prod.sh` bootstraps LiteLLM via portable python3.12 venv on fresh boxes** (`6beacc4`). Uses Astral's python-build-standalone — no apt dependency, distro-agnostic. Solves the "fresh Ubuntu 24.04 doesn't ship python3.12 as default" wedge without forcing operators to wire a PPA.
- **`deploy-prod.sh` `[8/8]` health check now verifies all three ingress surfaces** (`dc8296b`): dashboard `/api/health`, LiteLLM port 4001, Caddy port 443. A redeploy where Caddy crashes silently used to slip through; now the deploy fails closed if any of the three is missing.

### Fixed (CVE producer)

- **CVE producer reads package from title** (`2f6b534`) — pattern `<Package> < <version>` matches the upstream CVE title format. Previously read only `fixed_version`, which left rows with a bare version and no package context. internal reviewer blocker fix.
- **Strip trailing punctuation from CVE package token** (`eba1922`) — trailing `,` / `.` / `;` are removed from the parsed package before the row's `Affected Object` stage builds. internal reviewer polish.

### Docs

- **Visual QA evidence preserved** at `docs/qa/aeade4b-visual-2026-05-08.md` (`a6e4458`) covering the operator's 8-panel sign-off on the Stat lift + dimGlow rollout. Unblocks staging host deploy from the reviewer's visual-evidence concern on `aeade4b`.

## [0.14.5-alpha] - 2026-05-07

### Changed

- **Welcome Wizard "Get Started" button now lands on Mission Control.** Previously routed operators to Fleet Command on wizard dismiss. Mission Control is the operator cockpit; once setup is complete that's where live KPIs / Action Queue / posture data surface. Fleet Command remains accessible from the sidebar for anyone who needs the per-instance view. operator-flagged 2026-05-07.
- **Wizard success copy** updated: "...to jump to Fleet Command" → "...to jump to Mission Control — your live operator cockpit."



### Fixed (internal reviewer conditional sign-off feedback)

- **Banned-`Review`-pattern verifier blind spot.** internal reviewer flagged 2026-05-07: the previous bare-`Review` check was `"Review · alert details"` (specific) while sibling banned-verb checks were generic patterns like `"Investigate · "`. A manual injection of `// TODO: "Review · arbitrary stale action"` slipped past the verifier. Generalised the pattern to `"Review · "` matching the rest of the bare-verb scan; manual Test C now correctly fails the verifier.
- **Historical `"Review · ${f.blastRadius}"` comment** in `ActionQueue.tsx` rewritten — that comment described pre-taxonomy code from v0.13.4 and was the reason the prior generic Review pattern would have falsely tripped. Source no longer contains any `"Review · "` literal.

### Added

- **Self-test loop in `scripts/verify-action-verbs.ts` §4b.** For every banned pattern (Investigate / Inspect / Review / Audit / Block / Tighten / Constrain / View / Take action / Click here / Fix issue), the verifier now constructs a fake source body, injects the pattern, and asserts its own `.includes()` check would catch it. Plus the inverse: confirms the clean baseline doesn't trip. Two assertions per pattern × 11 patterns = 22 self-test assertions ensuring the verifier proves its own catch ability. Catches the regression class internal reviewer found.

### Notes

- Verifier assertion count is now **72 PASS** (up from 50 in v0.14.2 and 41 originally). The exact number will grow as more checks land — what matters is `verify-action-verbs: ok` exits cleanly.
- Negative tests internal reviewer ran in his sign-off pass continue to work: TypeScript catches banned verbs at compile time (Test A); verifier catches banned literals at runtime (Test B); the new generalised pattern + self-test close the regression class Test C exposed.

## [0.14.3-alpha] - 2026-05-07

### Removed

- **Sidebar Alerts & Incidents pulsating red count badge.** operator-flagged 2026-05-07: "we do not need it any more." The header CRITICAL pill remains the canonical "things needing immediate attention" signal; the sidebar duplicate added noise without adding information. Removed:
  - `<CountBadge>` render for `alertsIncidents` in both full-width and minimized rail modes.
  - `activeAlertCount` React state + `setActiveAlertCount` setter.
  - `/api/alerts?scope=active&productionOnly=true&limit=500` poll fetch (one less request per badge poll cycle).
  - Hover-title `(${count})` suffix on the alerts nav item.
- Shield's orange blocked-traffic badge is unchanged — different signal, different visual purpose.

## [0.14.2-alpha] - 2026-05-07

### Added

- **Action Queue verb taxonomy locked per the reviewer's 2026-05-07 call.** 11 canonical verb categories — Open evidence / Diagnose / Review exposure / Restrict capability / Contain agent / Disable integration / Rotate credential / Update policy / Assign owner / Suppress as accepted risk / Escalate. Closed enum at `src/components/dashboard/panels/mission-control/types.ts` (`ACTION_VERBS` + `ActionVerb` type).
- **`SuggestedAction` interface** replaces the prior free-form `suggestedAction: string`. Structured `{ verb: ActionVerb, target: string, detail?: string }` so the queue row can never drift into synonyms or vague copy. `formatSuggestedAction(action)` is the single display formatter — produces `"Verb · target"`.
- **Three new verb-mapper helpers** in `ActionQueue.tsx`:
  - `suggestedActionForAlert(sev, source)` — CRIT → Contain agent · `<source>`; HIGH → Open evidence · session prompt history; MED → Review exposure · alert correlations; WARN/LOW → Review exposure · alert details.
  - `suggestedActionForCostSignal(kind)` — loop_risk / velocity_spike / context_bloat / cache_drop / cache_drop_risk → Diagnose · `<kind-specific target>`; simple_on_expensive → Update policy · model routing.
  - `suggestedActionForFinding(f)` — replaces the old `prescriptiveActionForFinding`. Synonym → canonical conversion: Block → Disable integration; Tighten/Constrain → Restrict capability; Audit → Review exposure. Per-rule ruleId switch covers all 10 trust-audit rule families. The longer per-rule narrative moved to the `detail` field for tooling that wants to surface nuance; queue row only renders verb · target.
- **Stale-collector row** now uses `{ verb: "Diagnose", target: "${name} adapter" }` inline (previously a free-form string).
- **`scripts/verify-action-verbs.ts`** hermetic verifier — 41 assertions across 5 sections:
  1. Taxonomy lock: `ACTION_VERBS` has exactly 11 entries in the right order; banned synonyms (Inspect, Audit, Tighten, Constrain, Block, Investigate, Review, View) NOT in the closed list.
  2. Formatter shape: produces `"Verb · target"`.
  3. Per-source mapper coverage: every verb literal in `ActionQueue.tsx` is in `ACTION_VERBS`; all 4 family mappers + 3 verb-mapper helpers + inline staleCollector pattern present.
  4. Banned vague-copy phrases absent: "Take action", "Click here", "Fix issue", `"Investigate · "`, `"Inspect · "`, `"Audit · "`, `"Block · "`, `"Tighten · "`, `"Constrain · "`, `"View · "`.
  5. `ActionRow.suggestedAction` declared as `SuggestedAction` (not `string`).
  All 41 PASS.

### Changed

- **Long trust-audit queue rows shortened.** Per the reviewer's spec: queue row gets `Verb · target`; longer remediation prose lives in the Triage Graph Fix/Control stage's `previewSummary` (already populated from upstream `Finding.recommendedFix`). Examples:
  - Before: `"Restrict Exec or Write on this agent's role; recheck blast radius."`
  - After: `Restrict capability · Exec/Write` (with `detail` carrying the longer sentence for any consumer that wants it).
- **`action-row-resolver.ts`** updated to use `formatSuggestedAction(row)` everywhere it previously read `row.suggestedAction` as a string. No behavior change for the resolver — it produces the same output strings.

### Notes

- `verbCategory` is stored on every row but is **NOT** part of the v0.14 group-key tuple. internal reviewer deferred verb-as-grouping-key to avoid over-aggressive collapse across families that share remediation shape but represent unlike risks. Future "show me everything I can restrict in one pass" should be a filter or batch-action mode.
- Verifier is wired into the standard verification pass; future contributors adding new source families will be caught by the closed enum at compile time AND the banned-phrase grep at verifier time.
- Memory rule saved at `~/.claude/projects/<openclaw-project-memory>/memory/reference_action_verb_taxonomy.md`.

## [0.14.1-alpha] - 2026-05-07

### Fixed

- **Score-rationale tooltip on Action Queue rows.** v0.14.0 used the native HTML `title=""` attribute, which has a ~700ms browser delay + default rendering — operator reported the tooltip was invisible during normal scanning. Switched to the custom `<Tooltip>` component (cyan glass card, 250ms delay, respects the dashboard's `tooltips_enabled` flag). Wrapped on the severity pill specifically (rather than the whole row) so the hoverable affordance is unambiguous: pill gets `cursor: help`, hover shows "Score 125 = CRIT 100 + recent 10 + exact 15" using the same weights `computeActionPriority` uses.

## [0.14.0-alpha] - 2026-05-07

Action Queue vNext per the reviewer's design spec at `docs/superpowers/specs/2026-05-07-top-action-queue-vnext-design.md`. Mission Control's Top Action Queue now collapses repeat-action pressure into single grouped rows, lets operators filter by severity/family, suppress noisy incident types, and see exactly why each row ranks where it does. Quoted as ~9 hours; shipped in ~3.5 across 7 commits.

### Added

- **`IncidentFamily` taxonomy + `incidentType` field on `ActionRow`.** Closed source-family enum (`alert | cost-signal | infrastructure | trust-audit`) plus a free-form sub-key per row. Set by each `*ToRow` mapper. Drives grouping, filters, suppression, and per-source stale markers downstream.
- **Pure grouping engine** at `src/components/dashboard/panels/mission-control/action-queue-grouping.ts`. Groups rows by `(family, incidentType, restricted, destination)`; preserves CRIT/HIGH visibility via per-group `maxSeverity`; lead-member selection prefers highest priorityScore with severity + row.id tiebreaks. Plus `compareActionGroups` comparator implementing the vNext §7.1 tie-breaker chain. Pure, deterministic, 20/20 hermetic verifier coverage.
- **Group/Raw view toggle** in the queue header. Default grouped (3× same Exec+Write combo across agents → 1 row with `×3` cyan count chip). Toggle persists per browser session via sessionStorage. Pagination resets when mode changes.
- **Filter MVP** — severity + family chip rows above the queue. Multi-select within a dimension (OR), AND across dimensions. Filter state persists per session. "clear" link when active. Applied BEFORE grouping so a hidden CRIT can't accidentally re-emerge as a group's lead.
- **Per-incidentType suppression** with always-visible audit pill. `⊘ suppress` link on every row → adds the row's incidentType to a per-session suppression set. Header pill `⊘ N suppressed` (purple accent) opens a popup listing each type with `Unsuppress` per-type. sessionStorage-backed; tab close clears. Spec §10 guardrails: scoped, reversible, visible somewhere, time-bound by default. DB-backed audit + TTL queued for v1.1.
- **Score rationale on hover** — `explainActionPriority` in `scoring.ts` returns operator-readable strings like "Score 125 = CRIT 100 + recent 10 + exact 15" using the SAME weights `computeActionPriority` uses. Wired into each row container as a `title` attribute.
- **Per-source stale + error markers** in queue header — independent banner per family (alert / cost / infra / trust-audit). One degraded source no longer masks healthy rows from others.
- **Stable tie-breakers** in row sort: priorityScore DESC → severity rank DESC → evidence rank DESC → ageMs ASC (newer first) → row.id ASC. No more jitter from polling order.
- **Hermetic verifier** at `scripts/verify-action-queue-grouping.ts` covering 20 assertions across 10 cases: same-key grouping, different-key separation, restricted-state separation, lead picking with tiebreaks, CRIT preservation, evidence-rank ordering, age range, sort comparator, etc.

### Changed

- **Item-count chip** in queue header now shows the dedup math directly: "5 grouped · 12 raw" (or "12 raw of 18" when filtered) so the operator sees how much grouping/filtering has compressed the input.
- **Age column** on grouped rows shows the freshness range "1m–47m" (newest–oldest) instead of a single value.
- **Severity pill** on grouped rows uses the GROUP's `maxSeverity` so a CRIT member doesn't get hidden behind a HIGH lead.
- **EvidencePill text** raised from 9px to 10px (the reviewer's §9.3 acceptance criterion). Border opacity 33→55 for legibility.
- **`staleCollectorToRow` signature** widened to optionally accept `status` so the row's `family` and `incidentType` derivations have everything they need.

### Notes

- v1 grouping is by `(family, incidentType, restricted, destination)` only — per-affected-object grouping (per-session, per-agent) is queued for v1.1. The current key already captures most of the operator-visible "this is the same problem" signal because incidentType encodes things like `dangerous-combo:exec-write` which matches across agents.
- Suppression uses sessionStorage (per browser session). DB-backed audit + TTL is the v1.1 enhancement.
- Phase 3 of the reviewer's spec (per-source resolvers) was already complete from the overnight push (cost-signal-resolver, collector-health-resolver, alert + trust-audit). vNext is feature-complete against the spec.

## [0.13.15-alpha] - 2026-05-07

### Fixed

- **Deploy `--preserve-data` post-restore phase now fails closed too.** Previously the restore step (after wipe + install) was fail-soft: if `tar -xzf` failed, the script logged a warning and continued, leaving the dashboard to boot against an empty DB. The residual gap I flagged before the morning stress test. Closing it: the restore now (a) checks `tar -xzf` exit code, (b) verifies `$INSTALL_DIR/clawnex.db` exists post-extract, (c) on either failure exits 1 and LEAVES the preserve tar in place at `/tmp/clawnex-data-preserve.tar.gz` so the operator can manually recover. Symmetrical with the pre-wipe gates.
- Validated with a 3-case unit test: corrupt tar (branch A fires), wrong-files-only tar (branch B fires), valid tar (happy path). All three cases produce the correct outcome.

## [0.13.14-alpha] - 2026-05-07

### Fixed (CRITICAL — caught by stress test)

- **Deploy `--preserve-data` Gate 4b: substring match → exact match.** The prior `case "$TAR_LISTING" in *clawnex.db*)` glob passed when the archive contained `clawnex.db-wal` or `clawnex.db-shm` only — those entries CONTAIN the substring "clawnex.db" but are NOT the main DB file. Stress test 2026-05-07 reproduced the silent-data-loss path: with `clawnex.db` chmod 000 (unreadable), `--ignore-failed-read` archived only WAL+SHM, the prior gate passed, deploy continued, wipe ran, restore put back orphan WAL files, dashboard booted against an empty DB. **the operator's admin account was lost on staging host during this test.**
- New Gate 4b uses a `while IFS= read -r tar_line; do … done <<< "$TAR_LISTING"` exact-match loop requiring a literal `clawnex.db` line in the tar listing. WAL/SHM files alone are no longer proof the main DB was captured. The preserve-tar log line now ends with `(... main DB confirmed)` for visibility.
- Re-validated end-to-end: chmod 000 → deploy attempt → Gate 4b fires before wipe → DB safe.

## [0.13.13-alpha] - 2026-05-07

### Added

- **Evidence stage match-span / evidence-trail toggle** — operator-requested 2026-05-07 for fast-decision triage UX. When the operator opens the Evidence stage of an alert-derived artifact AND the underlying `EvidencePayload.matched_snippets[]` is non-empty, the preview pane shows a default-collapsed `▶ Show match span` button. Clicking expands the first server-side-redacted snippet inline: `…before` (dimmed) `<mark>match</mark>` `after…` (dimmed), with the rule key chip + a footer note "Server-side redacted match-span. Full payload remains in Audit & Evidence under RBAC."
- Trust-audit findings get the same toggle pattern but for `Finding.evidence: string[]` — short rule-emitted facts rendered as a bulleted list ("agent has tool 'exec'", etc.). Toggle reads `▶ Show evidence trail`.
- Cost-signal and collector-health resolvers don't surface a toggle — those Evidence stages have no equivalent fast-decision content (cost signals are statistical; collector-health is just probe metadata, fully shown).
- Toggle state persists per-artifact-id in `sessionStorage` so an operator triaging multiple alerts doesn't re-toggle the snippet on each one. Default-collapsed on every fresh browser session per operator directive.

### Changed

- **Spec §10 amendment** — `docs/superpowers/specs/2026-05-06-triage-graph-design.md`: pre-redacted `snippet_before` / `snippet_match` / `snippet_after` fields MAY be surfaced in the Evidence stage. Raw bulk-payload fields and request/response bodies remain forbidden.
- **`scripts/verify-triage-redaction.ts`** allowlist: `alert-resolver.ts`, `types.ts`, and `TriageArtifactPreview.tsx` are now permitted to reference the snippet family terms (rationale documented inline). Other forbidden terms (raw bulk-payload, request/response bodies, secrets, credentials) remain strictly enforced everywhere.
- **`TriageArtifact` type** gains optional `evidenceSnippet?` and `evidenceTrail?` fields. Alert resolver populates `evidenceSnippet` from the first matched-snippet entry; trust-audit resolver populates `evidenceTrail` from `Finding.evidence`.

## [0.13.12-alpha] - 2026-05-07

### Changed

- **Collector Health KPI breakdown rows now strip "(suffix)" from service names and dedupe by service.** operator-flagged 2026-05-07: "OpenClaw Gateway (WebSocket)" was being truncated to "OpenClaw Gateway (W..." in the narrow tile, which read as a UI bug rather than a real signal. Two changes:
  - **Suffix-stripping:** any `"(...)"` is removed from the breakdown row label so "OpenClaw Gateway (WebSocket)" renders as "OpenClaw Gateway".
  - **Service-level dedup:** when multiple collectors share the same stripped name (e.g. several OpenClaw Gateway instances behind different transports), the breakdown shows only one row for that service. Per-service lead selection prefers the first UNHEALTHY entry so problems surface; falls back to the first entry when all are healthy. Insertion order preserved so row ordering tracks the source-of-truth ordering.
  - Health classification uses the same fallback logic as `useCollectorHealth` in `data-hooks.ts` (status string when `lastSeenMsAgo` is 0).

## [0.13.11-alpha] - 2026-05-07

Overnight push. Two P0 + two P1 follow-ons from the to-do list (with operator asleep), plus one reviewer-caught silent-data-loss fix in the deploy script. All commits independently revertable.

### Added

- **Cost-signal Triage Graph resolver** at `src/components/dashboard/triage/cost-signal-resolver.ts` — fully populates the 5-stage triage card for `loop_risk` / `velocity_spike` / `context_bloat` / `cache_drop` / `cache_drop_risk` / `simple_on_expensive` cost-signal MC rows. Per-kind summary + prescriptive remediation copy. Affected Object derived via UUID extraction from row IDs (Hermes adapter format). Routes to Token Cost panel pre-filtered by signal kind.
- **Collector-health Triage Graph resolver** at `src/components/dashboard/triage/collector-health-resolver.ts` — fully populates 5 stages for stale-collector MC rows. Per-collector remediation copy (clawnex / litellm / openclaw / hermes / paperclip + generic fallback) including specific systemctl restart commands. Affected Object stage marks the service itself as resolved (intentionally redundant with Evidence for collector context — see inline comment).
- **`ActionRow.rawSource` union widened** to include `cost-signal` and `stale-collector` variants. Both wired into `ActionQueue.tsx`'s triage dispatch.
- **`/setup` page paste-into-form for SETUP_SECRET** (shipped earlier in window as v0.13.10-alpha; re-included here for the consolidated overnight summary).

### Changed

- **Source-aware missing-state copy in alert-resolver.ts.** Generic "No audit event correlated" replaced with per-source explanations: session-watcher says "this session wasn't routed through the LiteLLM proxy at capture time"; shield says "Shield can fire before the audit log writes"; correlation-engine says "no specific audit event is tied to it directly"; default unchanged. Same per-source split applied to Source Event and Affected Object missing reasons.
- **Alert resolver now extracts `session_id` from `alert.metadata` JSON or `alert.description` regex** when `evidence.session_id` is null. Affected Object stage populates as `derived` (medium confidence) when the session ID came from regex; preview labels the source as `alert.description` so the operator knows it's regex-extracted, not a structured field. UUID 8-4-4-4-12 hex form only — non-UUID id shapes intentionally don't match.
- **`staleCollectorToRow` signature widened** in `ActionQueue.tsx` to optionally accept `status`, `version`, `ingestion_summary` so the per-source resolver gets the full Collector record instead of just the staleness fields.

### Fixed

- **Deploy `--preserve-data` now fails closed on empty / corrupt preserve archive.** Reviewer caught a silent-data-loss path: `tar --ignore-failed-read` swallows a read error on `clawnex.db` itself (not just the optional -wal/-shm), so a zero-exit tar can still produce an empty archive that restores into a blank DB on next deploy. Operator would see no error — just get re-onboarded silently. Now: post-tar `[ -s "$DATA_PRESERVE_TAR" ]` check + `tar -tzf | grep clawnex.db` membership check; if either fails, exit 1 BEFORE the wipe runs. The "first deploy on this host" empty-state branch is unchanged.

### Docs

- **`docs/16-deployment-test-walkthrough.md`** gained a "Preserving operator state across redeploys" subsection covering the `--preserve-data` / `--no-preserve-data` flags, defaults, scope (SQLite-only), and how to verify preservation worked via `curl /api/auth/status` for `operatorCount:1, needsSetup:false`.

## [0.13.10-alpha] - 2026-05-07

### Added

- **Paste-into-form alternative for `SETUP_SECRET`** at `/setup`. Operators on a non-localhost install can now paste the secret into a `<input type="password">` inside the existing disclosure block instead of constructing the URL `?secret=<hex>`. Reveal/Hide toggle, "✓ Will use pasted secret on submit" indicator. Same backend endpoint (`/api/auth/setup`), same constant-time validation — purely a frontend ergonomics + leak-reduction change. URL-flow operators see no difference: when `?secret=` is present in the URL, the disclosure stays collapsed and the URL value still drives the submit. Disclosure auto-expands when no URL secret is present so the operator doesn't need to click first.

### Notes

- operator-flagged 2026-05-07: bookmark `/setup` and paste the rotating secret each redeploy instead of regenerating the deep-link URL each time. Same flow now works for QA's clean-redeploy cadence (where the secret rotates on every deploy).
- Security posture: net positive. The wire path (POST body to `/api/auth/setup`) is unchanged; the secret no longer needs to travel through browser history, SSL terminator logs, server access logs, or screen-share scrollback.
- Typed input takes priority over URL `?secret=` when both are present (operator's most recent action wins — principle of least surprise).

## [0.13.9-alpha] - 2026-05-07

operator-flagged 2026-05-07: empty Mission Control on a fresh install reads as "all clear" because every tile shows 0 — but the truth is "nothing has been observed yet." Two surfaces now make the difference explicit so operators don't mistake an unconfigured install for a green install.

### Added

- **`useSetupComplete(demoMode)` hook** at `src/components/dashboard/useSetupComplete.ts` — small shared hook polling `/api/config/defaults` for the `wizard_dismissed` flag. Returns `null` (loading), `true` (setup complete), or `false` (in progress / not dismissed). Demo mode short-circuits to `true` so demos don't display setup nags. Fail-open on API error.
- **`<MissionControlSetupBanner>`** at `src/components/dashboard/panels/mission-control/MissionControlSetupBanner.tsx` — warn-tinted glass banner rendered at the top of Mission Control when setup is incomplete. Explicit copy: "Tiles below show 0 because nothing has been observed yet — not because everything is clear." Primary CTA navigates to Fleet Command (where the wizard lives). Dismiss-for-session via sessionStorage so the banner reappears on each new visit if setup is still pending. Banner hides automatically once the operator dismisses the wizard.
- **Sidebar "setup pending" dot** in `src/components/dashboard/index.tsx` — small warn-tinted dot next to the Mission Control nav item until the wizard is dismissed. Visible in both full-width and minimized rail modes. Hover title explains the meaning. Demo mode hides the dot.

### Notes

- The KPI tiles still render `0` when data is genuinely zero. Per-hook null-rendering ("—" for never-reported sources) is queued as a separate change — the banner explicitly explains the semantics in the meantime.
- Wizard-state logic in `FleetCommandPanel.tsx` remains unchanged; the new hook reads the same `wizard_dismissed` config flag without refactoring the existing FleetCommand code path.

## [0.13.8-alpha] - 2026-05-07

Three Mission Control alignment + readability fixes operator caught after the v0.13.7 deploy.

### Fixed

- **KPI corner pill no longer wraps to 2 lines.** "ALL CLEAR" was wrapping while OK / DEGRADED / WARN / 24H stayed single-line. Pill span now has `whiteSpace: "nowrap"` + `flexShrink: 0`. The label-side span gets `nowrap + ellipsis` so it truncates gracefully when the tile is narrow.
- **Headline value + unit now stay on the same baseline.** The "2/3" in Collector Health was rendering value (28px) + unit (14px) inline; on narrow tiles the two glyph runs sat at slightly different baselines. Now wrapped in `display: flex; alignItems: baseline; whiteSpace: nowrap` so the unit stays glued to the value at the same baseline.
- **KPI breakdown row labels truncate cleanly.** Long labels like "OpenClaw Gateway (WebSocket)" were wrapping inside the narrow tile and pushing the value off-row. Labels now `whiteSpace: nowrap; overflow: hidden; textOverflow: ellipsis`; long names get `…` instead of forcing the layout.
- **Triage stage-card summary line-clamp 2 → 3.** operator flagged that "...is not bound..." truncation in the Affected Object stage hid the posture-level finding rationale. 3 lines gives missing-state explanations room to read fully without growing the stepper row excessively.

## [0.13.7-alpha] - 2026-05-07

Two real bugs operator caught while reviewing v0.13.6 alerts triage:

### Fixed

- **Alerts triage card no longer renders empty when opened.** The Investigate ▸ click handler at `AlertsIncidentsPanel.tsx:710` only toggled the expansion state but didn't trigger the evidence fetch — so the alert resolver received `evidence: null` and all 5 stages collapsed to "missing" because every artifact is built off evidence fields. Now: opening the triage card kicks off `fetchEvidence(alertId)` if the alert's evidence isn't already cached. Closing leaves the cache alone (so re-opening is instant). operator-flagged 2026-05-07 with screenshot showing all 5 stages on a session-watcher alert empty.
- **Workflow-row stage cards are now clickable.** Stage cards in the 5-column workflow row looked interactive (rounded boxes with state pills) but had no `onClick` — only the chip strip below was wired. Now: clicking a stage card selects the lead artifact for that stage (preferring resolved → derived → stale → first), updating the preview pane the same way clicking the matching chip would. Operator can drill into any stage from either surface. operator-flagged 2026-05-07 ("clicked evidence #1 badge and what i see is #2 badge").

## [0.13.6-alpha] - 2026-05-07

Glass-language pass 2: drop the whole-page `glassChrome` slab from 16 panels (the reviewer's P1 + P2 list) and lift small-text contrast across shared components per the reviewer's 2026-05-06 audit (`docs/qa/design-consistency-live-2026-05-06.md`). Mission Control was the chrome baseline; this brings the rest of the dashboard in line.

### Added

- **`T` text-style helpers** in `src/components/dashboard/constants.ts` — `T.meta` (12px / `C.txS` / 1.45 lh), `T.body` (13px / `C.txS` / 1.5 lh), `T.decoration` (11px / `C.txT` / decorative-only). Codifies the reviewer's rule: don't use `C.txG` for body/help text below 13px; reserve `C.txT`/`C.txG` for decorative metadata, disabled states, or non-critical labels.

### Changed

- **Whole-page `glassChrome` wrapper dropped from 16 panels.** Replaced with bare `<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>` per the reviewer's PanelStack recommendation. Child cards continue to carry chrome individually:
  - **P1 (operator source-of-truth):** AlertsIncidentsPanel, AuditEvidencePanel, PromptShieldPanel, TokenCostPanel, InfrastructurePanel, CorrelationsPanel, BlastRadiusPanel, AgentsSessionsPanel.
  - **P2 (secondary):** ShieldTestsPanel, AccessControlPanel, AccessListsPanel, GovernancePanel, ExecutiveReportsPanel, HelpPanel, AboutPanel, InstanceDetailPanel.
- **Shared-component contrast lifts** (rippled to every panel that uses them):
  - `<PaginationFooter>` — fontSize 11→12 across labels and buttons; matches the reviewer's "12px minimum for dense metadata" rule.
  - `<EmptyState>` — message body copy lifted from `C.txT` to `C.txS` (decision-bearing — operators read it to know what to do).
  - `<CollapsibleCard>` row-count display — 10/`C.txT` → 12/`C.txS`. Card metadata operators scan.
  - `<ReadinessBanner>` — collapsed summary count + refresh-label + per-row label all lifted from 10-11/`C.txT` to 12/`C.txS`. Decision-bearing readiness signals.
  - `RecentTokenEventsFiltered` timestamps + inline pagination labels — 11/`C.txT` → 12/`C.txS`. internal reviewer specifically named "small mono text in dense operational rows" as a hot-spot.
  - `FleetLiveCards` correlation-event count + shield reviewed/allowed counts — 10/`C.txT` → 12/`C.txS`.

### Notes

- Decorative `C.txT` usage stays as-is per the reviewer's rule (Mission Control eyebrow numbers 01/02, disabled-state pagination buttons, status timestamps, separator dots — all decoration, not decision-bearing).
- Tsc green; all triage + Mission Control verifiers green.

## [0.13.5-alpha] - 2026-05-07

First per-source Triage Graph resolver beyond the alert path: trust-audit findings now produce a fully-populated 5-stage card instead of the action-row fallback's 3-pending-2-resolved shape. Closes the most visible launch gap (trust-audit is the highest-volume non-alert MC source).

### Added

- **`src/components/dashboard/triage/trust-audit-resolver.ts`** — `resolveTrustAuditTriageGraph(input)` consumes a `TrustAuditFinding` directly and produces a 5-stage `TriageGraph`:
  - **01 Evidence** — finding id + evidence trail count + confidence (`verified_runtime`/`verified_config`/`verified_filesystem` → resolved; `heuristic_inference`/`unknown` → derived). Primary action navigates to Trust Audit panel pre-filtered.
  - **02 Source Event** — the rule that fired (derived). Primary action opens the rule in Policies & Rules pre-filtered to the rule id.
  - **03 Affected Object** — the agent the finding is bound to. Resolved when `agentId` is set; cleanly missing for posture-level rules with explicit reason. Surface id and capability path surfaced when available. Primary action opens the agent in Agents panel.
  - **04 Related Activity** — same-agent (when scoped) or same-rule (otherwise) query. Primary action opens Trust Audit pre-filtered with a 24h window.
  - **05 Fix / Control** — the rule's `recommendedFix`. Resolved when set; falls back to a generic "open the rule and review controls" derived state. Primary action opens Policies & Rules.

- **`ActionRow.rawSource` field** at `src/components/dashboard/panels/mission-control/types.ts` — optional escape hatch for per-source resolvers. Tagged-union shape (`{ kind: "trust-audit", finding } | { kind: "alert", alert }`); `unknown`-typed payload to keep the type module agnostic about which sources have implemented per-source resolvers. Set by `trustAuditToRow` in v0.13.5; alert path remains via the existing alert-resolver wiring in `AlertsIncidentsPanel.tsx`.

### Changed

- **`TrustAuditFinding` type widened** at `src/components/dashboard/panels/mission-control/data-hooks.ts` to expose the rich fields the upstream `Finding` already carries (`agentId`, `surfaceId`, `capabilityPath`, `containmentState`, `recommendedFix`, `evidence`, `confidence`). The `/api/trust-audit` route already returns them; the type was just narrow. No API change.
- **Triage card resolver dispatch** in `ActionQueue.tsx` — when a row carries `rawSource.kind === "trust-audit"`, the trust-audit resolver runs; otherwise the action-row fallback. Future per-source resolvers (cost-signal, collector-health) can hook in via the same dispatch.

## [0.13.4-alpha] - 2026-05-07

operator + internal reviewer polish round on the Mission Control Action Queue. Three quick UX wins shipped now; two larger asks (incident-type grouping, suppress-by-type) held for design conversation.

### Changed

- **Default page size 8 → 5** — internal reviewer + operator flagged the 8-row default as crowding the queue header on 720px viewports. Five fits cleanly without scroll. Page-size dropdown options unchanged ([5, 8, 10, 15, 25, 50]) so operators who want more density can opt in.
- **Suggested-action 3-line clamp + expand toggle** — long trust-audit suggestions used to grow rows tall and uneven. The cell now line-clamps to 3 lines and shows a `more ▾` / `less ▴` button when the action text exceeds ~110 characters. Toggle is per-row, not global. Short alert-derived suggestions ("Investigate · contain agent") never show the toggle — it would be useless.
- **Prescriptive trust-audit suggestions** — the prior implementation surfaced the descriptive `blastRadius` field as the action ("Review · Combo enables a known abuse pattern (Exec + Write); blast radius depends on..."), which read like an explanation rather than instruction. New mapping is verb-led and prescriptive. For dangerous-tool combinations: per-combo verb-noun pairs ("Restrict Exec or Write on this agent's role; recheck blast radius."). For other trust-audit rule families (direct-path-bypass, tool-freedom, model-privilege-mismatch, dormant-risk, recovery-path-permissiveness, prompt-capability-mismatch, trust-drift, cross-agent-delegation, browser-auth-reachability, comm-surface-permissiveness): per-rule prescriptive defaults. The descriptive `blastRadius` field on the upstream `TrustAuditFinding` is unchanged; it remains the narrative used by the Trust Audit panel itself, where context is appropriate.

## [0.13.3-alpha] - 2026-05-06

internal reviewer polish pass on the v0.13.2 Triage Graph. Six refinements from his post-deploy visual QA, plus a chip-selection regression caught while reading the diff.

### Fixed

- **Chip selection clobber regression** — `TriageGraphCard.useEffect` had `graph.artifacts` in its dep array (added in v0.13.2 commit `4a81ff8`). Action-row resolver returns a fresh graph object per render, so the artifacts-array reference changed every render, firing the effect, which reset `selectedId` to default after every click. Manifested as "I clicked SOURCE · PENDING but the preview stayed on Evidence" (internal reviewer). Fixed by removing `graph.artifacts` from deps and reinstating an `eslint-disable-next-line react-hooks/exhaustive-deps` with a clear inline rationale.

### Changed

- **Operator-facing missing-state copy** in `action-row-resolver.ts` — replaced developer-flavored "resolver not implemented yet" wording with operator-friendly equivalents that match the alert resolver tone:
  - Source Event missing: "No source event resolver is available for this issue type yet."
  - Affected Object missing: "No affected object is linked for this issue type yet."
  - Related Activity missing: "No related activity has been resolved for this issue yet."
  - Fix / Control missing: "No fix or control recommendation is available for this issue type yet."
  - Stage summary fallback: "Resolver not implemented yet." → "Not yet resolved."
- **Pending chip behavior** — `TriageEmptyState` gains an optional `title` prop. `TriageGraphCard` now passes a stage-aware title when the operator selects a non-resolved chip (e.g., "Source Event · Missing"); reason text falls back to `selectedArtifact.previewSummary` when `.reason` is unset. Clicking a missing chip now visibly switches the preview pane and tells the operator which stage they're seeing the pending state for.
- **Vertical density of the workflow row** — stage card padding 12 → 10, gap 6 → 4, summary line-clamp 3 → 2; workflow row margin 12 → 10. Trims ~30-40px off card height so the artifact strip + preview sit higher in 720px viewports.
- **Stage layout** — workflow row switched from `flex-wrap` to `display: grid; grid-template-columns: repeat(5, minmax(0, 1fr))`. Predictable 5-column horizontal stepper. The eyebrow numbers (01-05) carry the sequence; decorative chevron arrows removed (`StageArrow` and the `Fragment` import dropped accordingly).
- **Workflow status button in Alerts & Incidents** — the pre-existing "Investigate" button (which transitions alert workflow status: open/ack → investigating, signaling work-in-flight to teammates) renamed to **"TAKE"** to remove visual duplication with the new "Investigate ▸" triage entry button. Tooltip rewritten to make the distinction explicit and to point operators at "Investigate ▸" for the triage graph. Both buttons now have distinct verbs and distinct purposes.
- **Small-text contrast (the reviewer's recurring watch item)** — bumped the lowest tier of body copy in the triage card:
  - Source-context breadcrumb: 10/txT → 11/txS + fontWeight 600.
  - Artifact strip safety caption ("Resolved from live triageLinks · no raw evidence content in this card"): 10/txT → 11/txS.
  - Empty state title: 12/txS → 13/tx (lifted into primary-text tier for clearer hierarchy).
  - Empty state reason: 11/txT → 12/txS.

## [0.13.2-alpha] - 2026-05-06

Triage Graph Phase 1-4 ships live: `Investigate ▸` button on Mission Control's Action Queue and the Alerts & Incidents panel now opens an inline 5-stage investigation card instead of forcing immediate navigation. Operators can drill from Evidence → Source Event → Affected Object → Related Activity → Fix/Control without leaving the issue context.

### Added (Triage Graph Phase 1-4 — operator-visible)

- **`<TriageGraphCard>`** at `src/components/dashboard/triage/TriageGraphCard.tsx` — reusable compact investigation card. 5 fixed-order workflow stages, horizontal artifact strip, inline preview pane. Uses the post-strip dashboard-flat glass aesthetic (shared `<Card>` + glass tokens). No raw payload/snippet content rendered. Decorative arrow connectors between stages; cyan→green gradient on the active artifact chip and primary preview-pane action.
- **Presentational children** at `src/components/dashboard/triage/`: `TriageStageCard.tsx`, `TriageArtifactStrip.tsx`, `TriageArtifactPreview.tsx`, `TriageEmptyState.tsx`. All client components; all post-strip glass aesthetic.
- **Alert resolver** at `src/components/dashboard/triage/alert-resolver.ts` — converts `AlertData` + `EvidencePayload` into a safe `TriageGraph`. Pure function, no I/O. Uses the actual codebase field names (`audit_event_id`, `proxy_traffic_id`, `session_id`, `correlation_method: "forward" | "fallback_nearest"`, `created_at`). Rule keys come from `evidence.detections[].rule_key` (the field nests under detections, not at evidence root).
- **Action-row resolver** at `src/components/dashboard/triage/action-row-resolver.ts` — fallback resolver for Mission Control rows whose source family doesn't have a deep resolver yet (Phase 5 work). Source Event / Affected Object / Related Activity render as visibly-missing with explicit "Resolver not implemented yet" reasons; Evidence + Fix/Control derive from the row's `clickTarget`.
- **Mission Control Action Queue Investigate ▸**: `src/components/dashboard/panels/mission-control/ActionQueue.tsx` now toggles an inline `<TriageGraphCard>` under the active row instead of immediate navigation via `navigateForRow`. Restricted rows still render the disabled `Restricted` button (no `Investigate ▸` shown). One row expanded at a time. Existing grid layout preserved via Fragment-wrapped sibling-div pattern.
- **Alerts & Incidents Investigate ▸**: `src/components/dashboard/panels/AlertsIncidentsPanel.tsx` adds `Investigate ▸` next to the existing `View Evidence` action. Evidence threading is reused from the existing `evidenceMap` cache (no new fetches). The pre-existing `View Evidence` deep-link path (`onNavigate("auditEvidence", { id, focus: "evidence", fromAlert })`) is preserved. Separate expansion state from the existing description/workflow expansion.
- **Live-integration verifier coverage**: `scripts/verify-triage-graph-contract.ts` now asserts ActionQueue imports `TriageGraphCard` + contains the `Investigate ▸` label + composition uses every T7 child + no draft phrase leaks. `scripts/verify-triage-navigation.ts` asserts triage code consumes `NavigateOpts` and never references `fromIncident` or `timeRange` (forbidden URL keys) and never assigns status as a bare string inside a filter literal. `scripts/verify-triage-redaction.ts` extended to also scan `ActionQueue.tsx` and `AlertsIncidentsPanel.tsx` for raw exfiltration terms (`payload_excerpt`, `request_body`, `response_body`, `connection_string`, `api_key`, `password`); the snippet family is excluded for `AlertsIncidentsPanel.tsx` only because its pre-existing `EvidenceInline` component renders server-pre-redacted payloads.

### Changed

- **`AlertsIncidentsPanel.onNavigate` prop type widened** to the canonical `NavigateOpts` from `url-state.ts`. Was a hand-rolled subset that silently dropped the `filter` and `fromMissionControl` keys the alert resolver's Related Activity action emits. The dashboard's central `navigate()` already accepts `NavigateOpts`, so this is a compile-time tighten with no behavior change.

### Deferred to follow-on plan

- **Triage Graph Phase 5**: 8 additional issue-family resolvers (cost signals, trust audit findings, agent health, etc.). Action-row resolver currently provides a safe `missing`-state fallback for these.
- **Triage Graph Phase 6**: per-operator suppression of the 5-stage card for operators with internalized muscle memory. Per-issue-kind toggle with a "Skip the guide" affordance in the preview pane.

### Notes for upcoming hardening

- `navigateForRow` in `ActionQueue.tsx` is now dead code in the file's primary click path but remains defined; safe to remove in a future cleanup once the team confirms no other consumer of the file calls it.

## [0.13.1-alpha] - 2026-05-06

Post-deploy iteration on the v0.13.0 glass design language. operator eyeballed v0.13.0 on staging host, flagged a series of chrome-level issues, and we fixed them in-place. Plus Triage Graph Phase 1 scaffolding (invisible to operators — no UI yet; setup for the upcoming `Investigate ▸` flow).

### Changed (visible chrome refinements)

- **Mission Control: removed the iframe-style outer shell.** The 1px-bordered glass shell that wrapped all MC content read as an iframe boundary; stripped. Each child component (KPI cards, posture row, action queue, signals row, detection trend) now renders directly with its own glass treatment, no outer container.
- **Mission Control: removed the page-level radial-gradient stage.** The cockpit-scene-setter gradient created a second visible "box edge" against the dashboard background; stripped. MC content now sits flush on the dashboard backdrop.
- **Mission Control: dropped duplicated header chrome** — the local "▸ COMMAND Mission Control ↻ Ns" title prefix duplicated the dashboard's panel-header bar; the local 1h/24h/7d/30d range picker duplicated the dashboard's context-bar picker (which also has 6h support). Both removed. MC now consumes the dashboard's global `timeRange` directly via a new `range` prop. `TimeRange` extended to include "6h" so MC matches the dashboard's full range options.
- **Glass deepening through the shared layer**:
  - `G.card` / `G.stat` / `G.header` / `G.context` / `G.panelHeader` getters in `constants.ts` now emit the new `glass*` tokens (linear gradients, glass borders, blur). Single change ripples to every panel that uses the shared `<Card>` / `<CollapsibleCard>` / `<Stat>` components.
  - Shared `<Card>` and `<CollapsibleCard>`: `borderRadius` 10 → 14, radial-glow `::before` overlay added (the MC-signature depth treatment).
  - Shared `<Stat>` metric tile: full glass treatment (linear-gradient body, cyan-tinted border, blur, lighter radial-glow). Propagates to InstanceDetail's 8 top-row stats, Correlations / BlastRadius / Fleet KPI tiles.
  - `<ReadinessBanner>` (Deployment Readiness): glassified directly (not a shared-Card consumer). Severity-colored left border preserved.
  - Dashboard chrome: sidebar nav vertical gradient + cyan-tinted right edge + blur(20); context bar range buttons use the cyan→green gradient when active; filter dropdowns translucent surfaces; panel-header buttons (A11Y / ? / Shield / Tour / Logout) all glass-pill shape.
- **KPI corner pills now legible.** The dark-text-on-dark-glass regression (introduced when pill backgrounds moved from solid accent to `${accent}22` translucent) — pill text now renders in the accent color itself for high contrast.
- **FinOps disclosure pills now have hover tooltips.** "Local instance healthy" / "Not invoice-reconciled" / "Source totals shown separately" each carry an operator-friendly explanation via the custom `<Tooltip>` component (cyan-styled hover card with proper delay, respects the global `tooltips_enabled` flag). Required-copy text unchanged — verifiers still 12/12.
- **DetectionTrend SVG chart**: dedupe `yGridVals` when `maxVal === 1` (all-zero hourly windows produced duplicate React keys on `<g key={val}>`).

### Added (Triage Graph Phase 1 — scaffolding only, no UI yet)

- **Triage Graph design spec** at `docs/superpowers/specs/2026-05-06-triage-graph-design.md` — internal reviewer wrote it; operator approved two amendments: §5 visual treatment uses the post-strip dashboard-flat glass (not the original cockpit), §17.6 Phase 6 onboarding suppression preference for operators who've internalized the 5-stage muscle memory and want direct navigation.
- **Triage Graph implementation plan** at `docs/superpowers/plans/2026-05-06-triage-graph-plan.md` — 15 bite-sized TDD tasks covering Phase 1 (shared contract) → Phase 4 (Action Queue integration). Phase 5 (8 more issue families) and Phase 6 (suppression) deferred to a follow-on plan.
- **`src/components/dashboard/triage/`** scaffolding (Tasks 1-6 of plan):
  - `types.ts` — TriageIssueKind, TriageStageId, TriageLinkState, TriageNavigationTarget, TriagePreviewField, TriageArtifact, TriageStage, TriageIssueSummary, TriageGraph + TRIAGE_STAGE_ORDER constant
  - `redaction.ts` — forbidden-field deny list + helpers (`isSafeTriageFieldName`, `safeTriageValue`, `redactedTriageMarker`)
  - `navigation.ts` — typed NavigateOpts wrapper (`navigateToTriageTarget`, `withMissionControlContext`, `makeLastHoursFilter`, `makeQueryFilter`)
  - `fixtures.ts` — approved-mockup `TriageGraph` constant (5 stages in canonical order, 6 artifacts, all values safe per spec §10)
  - `scripts/verify-triage-graph-contract.ts`, `verify-triage-redaction.ts`, `verify-triage-navigation.ts` — three CI gates
- **None of the triage code is imported by any live panel yet** — Tasks 7-15 wire the UI components and Action Queue integration. Operators see no behavioral change in v0.13.1 from the triage work.

### Glass rollback runbook

- **`docs/glass-rollback-2026-05-06.md`** — operator-requested escape hatch. Three rollback paths (quick redeploy of v0.12.0-alpha tarball, surgical git-revert of glass commits, in-place token flatten). operator authorized v0.13.0 + v0.13.1 deploys with this runbook in hand if tastes change after living with glass.

## [0.13.0-alpha] - 2026-05-06

Mission Control completion + dashboard-wide glass design language. Closes 11 of the 12 deferrals from v0.12.0 (the 12th — `metric_snapshots` weekAvg — requires a new DB table; deferred to v0.14.0 per "no autonomous schema creation"). Migrates every panel in the dashboard to the canonical glassmorphic aesthetic operator picked over the cyan-cockpit variant.

### Added

- **Glass design language as canonical chrome** (`src/components/dashboard/constants.ts`). 12 new tokens promoted to `ColorPalette`, both dark + light theme variants:
  - `glassChrome` (page-chrome bg with backdrop-filter), `glassPanel` / `glassPanel2` (card body gradient stops), `glassBorderSubtle` / `glassBorderCyan` / `glassBorderStrong`, `glassSurfTrans` / `glassSurfBorder` (mini-card surfaces), `glassTrack` (bar tracks), `glassShadow` / `glassCardShadow`, `glassGreen` (gradient end).
  - Two-tier visual hierarchy per spec §13: cockpit-full for Mission Control (radial gradients + `::before` glow + 18px radius), panel-subdued for deep-work tabs (translucent surfaces + 12-14px radius).
- **Glassified all 25 dashboard panels** — Mission Control + 8 destination panels + 16 long-tail panels. Translucent rgba 22% pills with 55% borders, gradient cyan→green action buttons (`linear-gradient(135deg, C.cyan, C.glassGreen)` + dark text + 850 weight), status dots with `box-shadow: 0 0 15px currentColor` glow, mini-cards on `C.glassSurfTrans` (3.5% white). Pure chrome migration — zero functional changes.
- **Hourly-bucketed Detection Trend** (`/api/shield/stats?bucket=hour`). Real SVG line chart in `DetectionTrend.tsx` replaces the v0.12.0 "pending v1.1" placeholder. Three series (Block / Review / Allow), 24-hour window. Uses `getShieldStatsHourly()` with SQLite `strftime('%Y-%m-%dT%H:00:00Z', scanned_at)` hour-truncation.
- **Active Incidents age fields on `/api/alerts`** — `oldest_open_age_ms` (real: `MIN(created_at WHERE status='open')`) and `ack_but_not_resolved_count` (documented proxy: `updated_at <= cutoff` with 4h threshold since `acknowledged_at` column doesn't exist). OperationalPosture's Incident Hygiene row now wires real values into `scoreIncidentHygiene()` instead of hardcoded zeros.
- **ServiceCheck `version` + `ingestion_summary`** on `/api/infrastructure`. Adapter version strings (WS for OpenClaw, state.db for Hermes, HTTP for LiteLLM/Autensa, live version for Paperclip) and ingestion counters. SignalsAndSourceHealth's SourceHealthCard now renders both per spec §8.3b.
- **`outside_window_fetchable` on `/api/alerts/[id]/evidence`** — boolean per evidence response. Documented proxy: `correlation_method !== 'fallback_nearest'` since no cold-storage backend exists. Evidence Quality posture row uses real count instead of proxying total.
- **`audit` variant on `EvidenceConfidence`** (re-added per operator-confirmed variant A). Maps trust-audit findings to a fifth confidence tier with bonus weight 12 (between exact=15 and fallback=10). Verifier widened to 20 assertions.
- **Trust-audit as 4th Action Queue source**. New `useTrustAuditFindings()` hook + `trustAuditToRow` mapper composes `/api/trust-audit` `report.findings[]` (19 active findings on this install) into the prioritized queue alongside alerts, cost signals, and stale collectors.
- **`STATIC_UNSAFE_REGEX_COUNT`** computed at module load by iterating `ALL_RULES` through `checkRegexSafety`. Replaces the hardcoded `unsafeRegexCount: 0` in `usePolicyCoverage`.
- **`LAB` pill state on Policy Coverage** — purple pill when only lab drafts pending. Three-state pill: SAFE (no unsafe regex AND no lab drafts) / WARN (unsafe regex present) / LAB (lab drafts pending).
- **Stale-state surfacing on cost + collector mini-cards** — STALE badge propagates from `usePolledFetch.state` through MiniCard wrappers in SignalsAndSourceHealth. Spec §10.1 stale-marker contract now satisfied at every metric surface.
- **`age` field on UrlState** (string[] CSV). AlertsIncidentsPanel reads `urlState.age` and filters by bucket (Current / 1–4h / 4–24h / 1–3d / 3d+) using `matchesAgeBucket()` helper. IncidentAging click-through passes `{ age: [bucket.label] }` so drilling into 3d+ lands the operator pre-filtered. Routing verifier asserts the new field.
- **§12.4 RBAC permission propagation into ActionQueue**. `Operator` type with `role: string`; `hasPerm()` matches client-side permissions matrix (mirror of `src/lib/rbac/permissions.ts`); each row's `restricted` flag set per the destination tab's required permission. Default-allow when operator absent (RBAC-off install).

### Changed

- **`/api/alerts?scope=active` semantics fixed client-side** — endpoint includes `acknowledged` and excludes `suppressed`; spec §5.1 says `status IN ('open','investigating','suppressed')`. All four consumers (`useActiveIncidents`, `useEvidenceConfidence`, `useActiveAlerts`, `IncidentAging`) now apply a client-side filter to enforce the spec count.
- **Retired `MissionControlGlassPanel.tsx`** (was the v0.12.0 A/B sibling). Glass became canonical; the modular sub-components now carry the glass treatment. The `missionControlGlass` TabId variant, NAV entry, PANEL_HELP entry, and index.tsx switch case all removed.

### Tracked for v0.14.0

- **`metric_snapshots` weekAvg for Operational Posture rows.** Table doesn't exist; static placeholders (84/79/65/90/58) remain in `OperationalPosture.tsx`. Requires DB schema work; deferred per "no autonomous schema creation" directive. The other 11 v0.12.0 deferrals are now closed.

Spec: `docs/superpowers/specs/2026-05-05-mission-control-design.md` (v1, 796 lines).
Plan: `docs/superpowers/plans/2026-05-05-mission-control-plan.md` (17 tasks executed via subagent-driven-development).

## [0.12.0-alpha] - 2026-05-05

First operator-grade Mission Control — single-screen cockpit at the top of the COMMAND nav group. Implements the locked design at `docs/superpowers/specs/2026-05-05-mission-control-design.md`.

### Added

- **Mission Control panel** (default landing tab) with glass-morphic cockpit chrome (radial gradient + linear gradient + 86% opacity glass per spec §13.1). Reserved for Mission Control; deep-work tabs stay flat workbench.
- **Six KPI cards** in a 6-column responsive grid (collapses to 3 columns at <1240px, 1 column at <760px):
  - Active Incidents (`point_in_time`, poll_30s)
  - Evidence Confidence (`point_in_time`, poll_30s)
  - Shield Activity 24h (`time_windowed`, poll_30s)
  - Cost Risk (`time_windowed`, poll_5m) — required-copy "Highest reported monitored spend"
  - Collector Health (`last_seen`, poll_30s)
  - Policy Coverage (`point_in_time`, static)
- **5-row Operational Posture** score-list panel — replaces the radar polygon (per operator + internal reviewer + implementation agent design negotiation). Each row has a documented formula, current/7d/target trio, click target, and keyboard accessibility.
- **Severity-stacked Incident Aging chart** — 5 buckets (Current / 1-4h / 4-24h / 1-3d / 3d+), color mapping aligned with KpiCard (critical=danger, high=warn, medium=cyan, low=purp). "Alert graveyard" check in the footer.
- **Prioritized Action Queue** — composes alerts + cost signals + stale collectors, sorted by `priority_score = severity + age_bonus + evidence_bonus`. Pagination at 8 default rows. Drill-through reuses the v0.11.3 alert→evidence backlink.
- **Signals + Source Health combined panel** — the reviewer's two-mini-card pattern. Per-source cost rows + drain signal chips (aggregated by kind) + FinOps required-copy disclaimer. Per-collector status rows.
- **Detection Trend (24h)** — SVG polyline chart (Block/Review/Allow series) using per-hour buckets from `/api/shield/stats?bucket=hour`. Replaces the v1.0 placeholder; backend aggregator shipped in the same commit (Item #1).
- **`fromMissionControl` breadcrumb mechanism** — every drill-down attaches the flag; destination panels render "← Back to Mission Control" via the new shared `MissionControlBreadcrumb` component. AuditEvidencePanel renders both the v0.11.3 alert breadcrumb and the new Mission Control breadcrumb in parallel — operator can return to either origin.
- **Pure scoring functions** (`scoring.ts`) for the 5 posture rows + Action Queue priority. All pure (no `Date.now()`, no I/O). 19 hermetic test assertions in `scripts/verify-mission-control-scoring.ts`.
- **CI verifiers**:
  - `scripts/verify-mission-control-copy.ts` — forbidden-phrase grep + required-phrase check (Highest reported monitored spend, Source totals shown side-by-side/separately, Not invoice-reconciled, Core Shield rules + Active egress starter, lab drafts held).
  - `scripts/verify-mission-control-routing.ts` — source-grep asserts every documented click target lands on the right tab + filter + breadcrumb flag.

### Changed

- `TabId` union now includes `missionControl` as the first variant.
- `NAV` (sidebar nav) registers Mission Control as the first item in COMMAND group.
- Default landing tab on fresh login is now `missionControl` (was `fleet`). URL hash with explicit tab still wins.
- Extracted `NavigateOpts` type to `src/components/dashboard/url-state.ts` — single source of truth for the navigate signature; eliminated 7-way inline duplication across MC components.
- Added `incomingFromMissionControl` state slot in `src/components/dashboard/index.tsx` — set when navigate receives `fromMissionControl: true`, cleared on direct sidebar navigation away.

### Fixed (post-ship, same branch — mission-control: close 4 in-scope deferrals)

- **Policy Coverage LAB pill** (spec §5.6) — three-state pill instead of two: WARN (amber) when `unsafeRegexCount > 0`; LAB (purple) when no unsafe regex but `labHeldDrafts > 0`; SAFE (cyan) otherwise. Previously hardcoded SAFE/WARN, ignoring `labHeldDrafts`. Both `KpiRow.tsx` and `MissionControlGlassPanel.tsx` updated.
- **Stale-state coverage on Signals + Source Health mini-cards** (spec §10.1) — `usePolledFetch` already emits `state="stale"` on poll failure with prior data; `MiniCard` already renders the STALE badge when `stale=true`. The `GlassMiniCard` wrapper was missing a `stale` prop entirely. Added `stale` to `GlassMiniCard` and wired `cost.state === "stale"` and `collector.state === "stale"` at both call sites in `GlassSignalsAndSourceHealth`. (Flat-panel `SignalsAndSourceHealth.tsx` already had this wired correctly.)
- **`/api/alerts?scope=active` semantics** (spec §5.1) — endpoint includes `acknowledged` and excludes `suppressed`; spec §5.1 formula is `status IN ('open', 'investigating', 'suppressed')`. Client-side filter applied in `useActiveIncidents`, `useEvidenceConfidence`, `useActiveAlerts`, `IncidentAging`, and `GlassIncidentAging` to enforce spec count. `status` field added to `ActiveAlert` interface.
- **§12.4 RBAC permission propagation into ActionQueue** — `ActionQueue` now accepts an `operator?: Operator` prop. Each row mapper (`alertToRow`, `signalToRow`, `staleCollectorToRow`) accepts the operator and sets `restricted` based on the destination tab's required permission: alert rows → `audit:read`; cost-signal rows → `tokens:read`; stale-collector rows → `dashboard:view`. Default-allow when `operator` is `undefined` (RBAC off / not yet loaded — matches the RBAC-Off Defense Pattern). `Operator` type exported from `ActionQueue.tsx`; `operator` threaded through `MissionControlPanel` → `index.tsx` and `MissionControlGlassPanel` → `index.tsx`. Glass variant's `GlassActionQueue` receives the same treatment with an inline `glassHasPerm` helper and updated `aq*ToRow` mappers; glass `ActionRow` type gains `restricted?: boolean`; Restricted pill render path added to match the flat panel.

### Tracked for v1.1

- weekAvg posture-row values from `metric_snapshots` table: **deferred to v0.14.0**. The `metric_snapshots` table does not exist in the current DB schema. Requires DB schema work; deferred per operator direction not to autonomously create new tables. weekAvg values remain static placeholders (84/79/65/90/58) with inline `TODO(v0.14.0)` comments in `OperationalPosture.tsx`.

The following v1.1 deferrals were closed in commit `mission-control: close 4 backend deferrals (#1, #3, #4, #5)`:
- ~~Hourly-bucketed Detection Trend chart (requires `/api/shield/stats?bucket=hour` aggregator).~~ → **Closed**: `getShieldStatsHourly()` added to prompt-interceptor; route supports `?bucket=hour`; DetectionTrend renders real SVG polyline chart.
- ~~`oldest_open_age_ms` and `acknowledged_but_not_resolved_count` on `/api/alerts` for Incident Hygiene scoring.~~ → **Closed**: Both fields added. `acknowledged_at` column absent; fallback uses `updated_at + 4h` heuristic (documented inline). OperationalPosture + GlassPanel wired.
- ~~`outsideWindowFetchableCount` from `/api/alerts/[id]/evidence`.~~ → **Closed**: `outside_window_fetchable: boolean` added per evidence response. Proxy: `correlation_method !== 'fallback_nearest'` (documented inline). Evidence Quality score uses real count.
- ~~`version` and `ingestion summary` fields on `/api/infrastructure` ServiceCheck.~~ → **Closed**: Both optional fields added; openclaw gets ingestion count from `shield_scans`, others get canonical version strings. SignalsAndSourceHealth + GlassPanel render both lines.

### Closed in v0.12.0 follow-up (mission-control: close items 6, 8, 11 + investigate 2)

- **#6 unsafeRegexCount** — computed at module load via `ALL_RULES + checkRegexSafety`. Was hardcoded 0; now exposes the real count of unsafe patterns in the bundle-baked rule set.
- **#8 Trust-audit as 4th Action Queue source** — `audit` variant added to `EvidenceConfidence` and `ActionEvidenceKind` (bonus weight 12, between exact=15 and fallback=10). New `useTrustAuditFindings()` hook + `trustAuditToRow` mapper. Both flat `ActionQueue.tsx` and glass `GlassActionQueue` updated. Scoring verifier widened to 20 assertions.
- **#11 UrlState `age` extension + AlertsIncidentsPanel filter** — `age` added to `UrlState` + `CSV_KEYS`. `AlertsIncidentsPanel` reads `urlState.age`, filters rows by bucket via `matchesAgeBucket()` helper, and renders chip-style clear UI. `IncidentAging` click handlers now pass `{ age: [b.label] }`. Routing verifier asserts the `age` filter.
- **#2 metric_snapshots investigation** — Branch C: table does not exist. Documented above.

Spec: `docs/superpowers/specs/2026-05-05-mission-control-design.md` (v1, 796 lines).
Plan: `docs/superpowers/plans/2026-05-05-mission-control-plan.md` (17 tasks, 3124 lines, executed via subagent-driven-development with two-stage review per task).

## [0.11.6-alpha] - 2026-05-05

UX patch — Shield Tests row density + internal scroll (operator feedback). Single-line cards (~50px) instead of two-line (~75px), wrapped in a maxHeight: 600 / overflowY: "auto" container so 10 paginated rows fit inside the panel viewport without pushing the footer below the fold. Mirrors the Service Logs scroll pattern.

- **Released:** 2026-05-05
- **Version:** 0.11.6-alpha
- **Type:** Patch (semver-compatible with 0.11.x)
- **Scope:** Shield Tests panel visual density
- **Upgrade path:** Drop-in
- **Breaking changes:** None

### Changed
- **Shield Tests row density** — collapsed header trimmed from two-line to single-line. The payload-preview line is removed from the collapsed view (full payload still renders in the expanded body). Padding `10px 14px` → `8px 12px`; icon font-size 16 → 14; card `borderRadius` 8 → 6; `marginBottom` between cards 12 → 6. Matches the Alerts & Incidents card density operator screenshotted as the target.
- **Internal scroll on Shield Tests list** — `pagedTests.map` wrapped in a `maxHeight: 600` / `overflowY: "auto"` container so 10 compact rows fit inside the viewport with a panel-internal scrollbar instead of forcing the page to scroll past the pagination footer.

### Verified Platforms
- local dev host (macOS 15.x / Node 22) live test — operator confirmed row density + scroll behavior matches the reference screenshots.
- `npx tsc --noEmit` clean.

## [0.11.5-alpha] - 2026-05-05

UX patch release rolling up the operator's smoke-test findings on staging host v0.11.4-alpha into a single drop. Two themes: pagination coverage gap and Blast Radius operator-readability.

- **Released:** 2026-05-05
- **Version:** 0.11.5-alpha
- **Type:** Patch (semver-compatible with 0.11.x)
- **Scope:** UX consistency — pagination and tooltip copy
- **Upgrade path:** Drop-in
- **Breaking changes:** None

### Added
- **`PaginationFooter` shared component** at `src/components/dashboard/shared.tsx` — single source of truth for the rule-of-5 pagination pattern operator approved 2026-05-05. Defaults `[5, 10, 15, 25, 50]`, prev/next chevrons (« ‹ › »), and renders only when `totalPages > 1`. Replaces 8+ historical inline copies of the footer JSX scattered across panels.

### Changed
- **Pagination applied to every operator-facing list panel** (operator directive: any panel with potential to grow > 5 rows auto-paginates with the option hidden when ≤ 5):
  - **Audit & Evidence**, **Alerts & Incidents**, **Cost By Session**, **Recent Token Events**, **Models & Cost** sub-cards, **Correlations** — already paginated in prior releases, normalized to use the shared component.
  - **Live Traffic** (Traffic Monitor) — was unbounded; now paginates default 5/page.
  - **Risk Acceptances** — three independent paginations across Active / Expiring soon / Recently resolved tables.
  - **Trust Audit** — Findings card list paginates default 5/page.
  - **Agents & Sessions** — Agents card grid paginates default 5/page.
  - **Configuration → Developer Tools** — Active SeedTraffic runs list paginates default 5/page.
  - **Infrastructure** — Services Health list paginates default 5/page.
  - **Shield Whitelist** (Configuration / Prompt Shield) — rule whitelist table paginates default 5/page.
  - **Tools & Access** — Tool Inventory + Per-Agent Tool Permissions both paginate default 5/page.
  - **Security Posture → CVE Database** — paginates default 10/page (operator-specified).
  - **Security Posture → Hardening checks** — paginates default 10/page (operator-specified).
  - **Security Posture → Remediation Suggestions** — paginates default 5/page.
  - **Security Posture → Posture by Instance** — paginates default 5/page.
  - **Shield Tests** — 27-test list paginates default 10/page (operator-specified).
  - **Tools & Access → Skills sub-cards** — System Skills / Workspace Skills / Paperclip Plugins each paginate default 5/page (operator-specified).
  - **Configuration → Policies & Rules** — policies list paginates default 5/page; per-policy rules sub-list paginates default 10/page (rule sets can be 100+ items deep on the curated CURATED policy).
  - **Cost By Agent** — agents/source bucket list paginates default 5/page.

- **Blast Radius KPI tooltip rewrite** — operator flagged the entire KPI tooltip set as engineer-speak unfit for a new operator. Per operator: "speak in 6th grade English." Rewrote all 6 KPI bodies in `src/components/dashboard/panels/blast-radius/kpiTooltips.ts`:
  - Lead with what the number IS and what it tells the operator
  - Drop file paths, internal module names, and implementation jargon
  - Concrete examples in plain language ("Discord, Telegram, Slack, webhooks")
  - Honest zero-vs-unknown semantics preserved verbatim
  - Trimmed `Max blast radius` title from "Max blast radius (worst-case reachability edge)" to just "Max blast radius" — fixes the box overflow operator screenshotted (full explanation moved into the tooltip body where it already lived).
  - Added an editorial-rule comment at the top of `kpiTooltips.ts` so future KPI additions follow the same voice.

### Fixed
- **EVD detail flicker + back-button race** (rolled forward from v0.11.4-alpha into the same release line): four React anti-patterns surfaced by Wave 1 alert→evidence deep-link traffic. Documented at length in v0.11.4-alpha entry below.

### Verified Platforms
- local dev host (macOS 15.x / Node 22) live test through every paginated panel
- `npx tsc --noEmit` clean
- 12 FinOps verify scripts → 162/162 PASS
- `scripts/verify-evidence-deep-link.ts` → 40/40 PASS

### Notes for internal reviewer
- Pagination defaults are intentionally per-panel (5 vs 10) following the operator's directive on which lists tend to grow longer (CVE 122 entries, Shield Tests 27 entries, Hardening checks 50+ entries → default 10; smaller curated sets → default 5). The default is overridable per session via the page-size dropdown in the footer.
- Two panels remain unpaginated by design: **HelpPanel** renders fixed UI structures (surface descriptions, glossary card meant for full-scan reading); **ThreatScoreGauge** is a single gauge component, not a list.

## [0.11.4-alpha] - 2026-05-05

Patch release closing two regressions found during v0.11.3-alpha live test on local dev host before staging host deploy: an EVD-detail flicker that made the deep-link unusable, and a Back-to-Incident button that visibly did nothing. Both were React anti-patterns that pre-dated v0.11.3 in latent form but were surfaced by the new deep-link traffic.

- **Released:** 2026-05-05
- **Version:** 0.11.4-alpha
- **Type:** Patch (semver-compatible with 0.11.x)
- **Scope:** Audit & Evidence panel render stability + Alerts & Incidents back-link race
- **Upgrade path:** Drop-in
- **Breaking changes:** None
- **Known issues:** v0.11.3-alpha tarball is obsolete and should not be deployed; use v0.11.4-alpha.

### Fixed
- **Audit & Evidence panel infinite refetch loop.** `urlState.status ?? []`, `urlState.actor ?? []`, and `urlState.source ?? []` were producing fresh empty array literals on every render when the URL filters were unset. `fetchAudit`'s `useCallback` deps included these refs, so its identity changed every render. The `useEffect(() => { fetchAudit(); setInterval(fetchAudit, 30000); ... }, [fetchAudit])` re-ran on every render — clearing and recreating the polling interval and immediately firing a new fetch. The intended 30s polling cadence collapsed into a tight loop bounded only by network RTT (5–20 fetches/second on local dev, visible in the dev log as back-to-back `GET /api/audit?limit=500&since=...` lines). Symptom operator reported: result count flickering 500↔343 because concurrent fetches resolved out-of-order and the 500-row limit was being hit at slightly different sliding-window boundaries each round-trip. Fix: wrap the three array selectors in `useMemo` keyed off the underlying URL value so they only get new identity when the filter actually changes.
- **EVD detail card unmount/remount on every parent render.** `EvidenceDetail`, `ShieldEvidenceDetail`, `BackToIncidentBreadcrumb`, and `CorrelationPill` were defined as inner JSX components inside `AuditEvidencePanel`. Every parent render produced new function identities; React's reconciler compares element `.type` by reference, so each render meant "new component type" → unmount the prior detail and mount a fresh one. The 1s freshness counter (`setInterval(() => setFreshness(p => p + 1), 1000)`) was therefore making the EVD detail blink every second. Fix: convert all four to plain render-helper functions (`renderEvidenceDetail(e, outsideWindow)`, etc.) called as `{renderXxx(...)}` instead of `<Xxx ... />`. Render-helpers bypass the component-type check entirely — they're regular JS function calls returning JSX.
- **Back to Incident button visibly did nothing.** `AlertsIncidentsPanel`'s focus effect was calling `onAlertFocusConsumed?.()` synchronously after scheduling `requestAnimationFrame(...)`. The parent's resulting `setAlertFocus(null)` triggered the effect's cleanup function (`return () => cancelAnimationFrame(raf)`), which cancelled the raf BEFORE the browser had a chance to fire it — so the scroll-into-view + expand + pulse-highlight never ran. Fix: gate the effect on `apiAlerts !== null` so it doesn't fire prematurely on a deep-mount with no alert rows in the DOM yet, and move the consume call INSIDE the raf callback so the parent's state change happens after the visual work is complete.
- **AuditEvidencePanel poll-driven re-fetch + re-scroll.** Even after fixing the infinite refetch loop, the deep-link effect at `[selectedEvidence, apiEvents]` re-ran on every legit 30s poll because `apiEvents` is a new array reference each settle. Each poll re-fetched `/api/audit/[id]`, re-fetched the alert's `correlation_method`, and re-ran `scrollIntoView` — making the page jump back to the EVD row every 30s. Fix: `lastDeepLinkRef` memoizes the per-selection work; the effect now skips the heavy operations when the selection hasn't changed since last handled, while still cheaply handling state-only transitions (row newly arriving in or leaving the time window).

### Verification
- `tsc --noEmit` clean across the codebase.
- All 12 FinOps verify scripts (`scripts/verify-*cost*.ts` — 9 cost scripts + 3 adapter scripts) still green (162/162 assertions).
- `scripts/verify-evidence-deep-link.ts` still passes 40/40 acceptance assertions.
- Live test on local dev host: result count stable at 500, EVD card no longer blinks, Back-to-Incident button switches tab + scrolls + highlights.

### Notes for internal reviewer
- Two of the four bugs (inner-component anti-pattern + selector instability) pre-dated v0.11.3 in dormant form but were never visible because no deep-link traffic flowed through the panel. Wave 1 surfacing them is a useful pre-OSS hygiene win even though it cost an extra patch release.

## [0.11.3-alpha] - 2026-05-05

Patch release: **Wave 1 of the reviewer's alert→evidence backlink hardening**. Closes the v0.11.2-alpha gap where an alert pointing at an audit row outside the dashboard's currently filtered time window surfaced a "NOT IN WINDOW" notice that put the operator at fault. The deep-link is now time-window-proof, restores the operator's filter state on dismissal, distinguishes exact vs. fallback correlations, and includes a Back-to-Incident breadcrumb so the operator never has to manually navigate back to the originating alert.

- **Released:** 2026-05-05
- **Version:** 0.11.3-alpha
- **Type:** Patch (semver-compatible with 0.11.x)
- **Scope:** Alerts ↔ Audit & Evidence deep-link reliability
- **Upgrade path:** Drop-in
- **Breaking changes:** None
- **Known issues:** None — Wave 2 (full Triage Graph 5-link contract) deferred to v0.12.0-alpha pending internal reviewer brainstorm.

### Added
- **`GET /api/audit/[id]`** — RBAC-gated (`audit:read`) single-row fetch endpoint that bypasses the time-window filter the parent `/api/audit` list endpoint applies. Returns `{ event: AuditRecord }` on hit, `404` on miss. Localhost-fallback matches `/api/alerts/[id]/evidence` pattern. Picked a separate dynamic route over extending `/api/audit?id=...` because (a) avoids modifying `audit-logger.ts` (forbidden), (b) aligns with the existing `/api/alerts/[id]/evidence` pattern, (c) keeps single-row contract structurally separate from list pagination/filtering.
- **Back-to-Incident breadcrumb** rendered on the EVD detail panel when navigation arrived via an alert. Click → `onNavigate("alertsIncidents", { focusAlertId })`; AlertsIncidentsPanel scrolls the originating alert into view, expands it, and briefly highlights it. Operator no longer loses their place when investigating evidence and wanting to return to the source alert.
- **Best-match labeling** on EVD detail: forward-link rows show a green "Exact match (audit_event_id)" pill; fallback-correlated rows show an amber "Best match — fallback by session + ±60s" pill with tooltip explaining the heuristic. Distinguishes deterministic links from heuristic correlations so operators know how much to trust the connection.
- **`scripts/verify-evidence-deep-link.ts`** — hermetic verification harness covering the reviewer's six acceptance tests (exact-token proof, deterministic link, old evidence, return path, fallback labeling, regression check). 40 assertions, all green.

### Changed
- **AuditEvidencePanel** uses the new fetch-by-id endpoint when `focusedAuditId` is set. If the row is in the time-window-filtered events list, render via the existing path; if it's NOT in the list, render anyway with an *informational* "Outside current window" notice (replaces v0.11.2's blocking-tone "widen the time filter to find it" copy that put the operator at fault).
- **Filter-state restore semantics**: `savedFilterStateRef` captures `status` / `actor` / `source` / `q` / `currentPage` BEFORE the deep-link clears them; restores on `setSelectedEvidence(null)` (the single dismissal point covering Close / Back to Incident / focus consumed). Audit panel filters no longer permanently broken for normal browsing after a deep-link visit. the reviewer's regression test #6.
- **AlertsIncidentsPanel** receives `focusedAlertId` prop; honors it by scrolling the matched alert into view, expanding it, and applying a brief highlight glow before calling `onAlertFocusConsumed` to clear the focus state.

### Fixed
- v0.11.2-alpha shipped the Audit deep-link with a "NOT IN WINDOW" notice when the audit row was outside the current time window. The notice was technically accurate but operationally unhelpful — internal reviewer correctly flagged this as putting the operator at fault for a state the system created. Wave 1 fixes this by surfacing the row regardless of time-window filter via the new fetch-by-id endpoint.

### Verification
- **Hermetic harness:** 40/40 assertions across 6 acceptance tests (`scripts/verify-evidence-deep-link.ts`).
- **Live API probe (local dev):** `GET /api/audit/<known-id>` returns 200 with full event payload; `GET /api/audit/<bogus-id>` returns 404. End-to-end flow confirmed.
- **Existing verify scripts:** All 12 FinOps verify scripts (`scripts/verify-*cost*.ts` — 9 cost scripts + 3 adapter scripts) still green (162/162 assertions). `tsc --noEmit` clean. `next build` clean on Linux.

### Notes for internal reviewer
- Wave 1 lays the foundation for Wave 2 (full Triage Graph 5-link contract: evidence / sourceEvent / affectedObject / relatedActivity / fix). The fetch-by-id endpoint, breadcrumb stack semantics, and filter-restore pattern will subsume cleanly into the standard `IssueLinks` shape once we lock the brainstorm.

## [0.11.2-alpha] - 2026-05-05

Patch release: fix the v0.11.1-alpha View Evidence behavior to **deep-link to the exact EVD row** in the Audit & Evidence tab instead of inline-expanding within the alert card. operator feedback during testing: "taking me to the main Audit & Evidence tab is not good enough."

### Changed
- **View Evidence button** on AlertsIncidentsPanel now triggers proper navigation: `onNavigate("auditEvidence", { id, focus: "evidence" })` instead of inline-expanding. Mirrors the established `configFocus` deep-link pattern at `index.tsx:135` (the same mechanism used for `Configuration → shieldSettings`, `policiesAndRules`, etc.).
- **AuditEvidencePanel** receives a new `focusedAuditId` prop. When set: filters cleared (so the target row isn't excluded by stale actor/source/q selections), `currentPage` reset to 0, target row's detail panel opened (`setSelectedEvidence`), detail scrolled into view via `scrollIntoView({ behavior: 'smooth' })`, then `onConsumed()` called to let the parent reset focus state — preventing stale focus on next visit.
- **Dashboard root** (`src/components/dashboard/index.tsx`) gained `auditFocus` state alongside the existing `configFocus`. The `navigate(tab, opts)` function sets it when `tab === 'auditEvidence'` and `opts.id` is present.

### Fixed
- v0.11.1-alpha shipped View Evidence as inline-expand only — the v1 simplification I told the implementing subagent to prefer. operator correctly flagged this as insufficient: an alert→evidence link should take the operator to the actual evidence surface, not preview it in-place.

### Known limitations (at v0.11.2 release time — most closed in v0.11.3+)
- ~~If the focused audit row isn't in the panel's currently fetched time window, AuditEvidencePanel surfaces a "NOT IN WINDOW" notice with widen-the-filter guidance + a Dismiss button. Fetch-by-id on `/api/audit` doesn't exist yet — the existing endpoint queries by filter window. v1.1 candidate work.~~ → **Closed in v0.11.3-alpha**: `GET /api/audit/[id]` shipped; AuditEvidencePanel now renders out-of-window rows with an informational "Outside current window" notice instead.
- Inline-expand fallback path retained as a graceful degradation when: navigate prop is absent, the `/api/alerts/[id]/evidence` HTTP fetch errors, the response is missing `audit_event_id`, or a network throw. Operator still sees something meaningful.

## [0.11.1-alpha] - 2026-05-05

Patch release closing the alert→evidence visibility gap operator flagged during v0.11.0-alpha visual smoke. Every Session Shield alert now exposes a **View Evidence** backlink that resolves to the exact `audit_log` row that triggered it, with the matched rule key, the scanner-redacted matched sample, and a match-centered snippet of the redacted payload.

### Added
- **`GET /api/alerts/[id]/evidence`** — RBAC-gated (`audit:read`) endpoint that resolves an alert to its triggering audit event. Forward link via `alert.metadata.audit_event_id` (new alerts); fallback correlation for legacy alerts via `(source='session-watcher', action IN shield_review|shield_detected, resource_id=<session_id parsed from description>)` taking the nearest match within ±60s of `alert.created_at`. Response includes detections array, matched_snippets (±200 char windows around each detection's matched sample via `indexOf`), payload_excerpt, prompt_hash, proxy_traffic_id, and a `correlation_method` indicator (`forward` vs `fallback_nearest`).
- **`View Evidence` inline-expand button** on AlertsIncidentsPanel — shown only when alert source is `session-watcher` OR `alert.metadata.audit_event_id` is set. Expands inline to show verdict / score / model / direction header grid + per-detection match-centered snippet with the matched span tinted.
- **Structured shield evidence view** in AuditEvidencePanel — when a `shield_review` / `shield_detected` audit row is selected, the detail surfaces parsed rule_key + matched sample + match-centered snippet for each detection. Legacy plain-string detail rows fall through to the existing pre-formatted view.
- **session-watcher alerts now carry rich metadata**: `audit_event_id`, `source_event_id` (proxy_traffic.id), `session_id`, `direction`, `model`, `provider`, `verdict`, `score`, `detection_count`, `primary_rule_key`, `primary_rule_name`. Audit `detail` JSON now stores structured `shield_detections`, `payload_excerpt` (with `redact()` applied for privacy-preserving evidence), `prompt_hash`, and `proxy_traffic_id`.
- New `EvidencePayload`, `EvidenceMatchedSnippet`, `EvidenceShieldDetection` types in `src/components/dashboard/types.ts`.

### Known limitations
- Match-centered snippet uses `payload.indexOf(detection.sample)` to find the offset. The scanner produces partial-redacted samples (e.g. `+1-555-XXX-XXXX`), and `redact()` then rewrites the same span to `[PHONE_REDACTED]` in the persisted excerpt — so `indexOf` returns -1 for those rows. In that case the response sets `match_found_in_excerpt: false` and the UI surfaces the sample alone (with rule_key + redacted surrounding context) rather than fabricating a position. Operators still confirm what triggered: rule_key (semantic) + sample (specific evidence) + redacted context (showing OTHER PII redaction markers). True match-centering requires per-detection ±200-char windowing at scan time before `redact()` runs — deferred to v1.1.

## [0.11.0-alpha] - 2026-05-04

Significant follow-up to 0.10.0-alpha shipped on `token-cost-finops-reporting-v1` (32 commits, ff-merged to main; +149 verify-script assertions across 13 scripts): a multi-source Token Cost FinOps reporting pipeline that normalizes LLM cost telemetry across **OpenClaw, Hermes, and Paperclip** into a single canonical row shape with explicit trust labels (Estimated / Actual / Recomputed / Included / Token-only / Unknown), five lightweight drain-detection signals (Possible repeated-call loop / Spend velocity spike / Context bloat risk / Cache hit drop / Cache hit drop risk / Simple task on expensive model), per-source totals with a "Highest reported monitored spend" headline that explicitly avoids cross-source summing, click-to-filter SignalsCard with inline evidence expansion, instance-dropdown source-routing through the orchestrator, dashboard-wide pagination on long sub-cards (default 5/page; options 5/10/15/25/50), drop of the Metric Aggregation TOTAL column (the reviewer's option A — point-in-time snapshot metrics shouldn't be summed across windows), `signal_context` adapter-owned private side-channel for Hermes system-prompt hashing that never crosses the API boundary, `Hide delivery-mirror` global toggle, ~30 header tooltips across the Token & Cost Intel tab, accessibility upgrade on Signals counter rows from clickable divs to native buttons with `:focus-visible` outline, and a HelpPanel **Glossary** section at the bottom of Help (62 terms across 10 categories) that turns dashboard jargon into operator-readable definitions.

### Added
- **Token Cost FinOps Reporting v1** — spec at `docs/superpowers/specs/2026-05-04-token-cost-finops-reporting-design.md`, plan at `docs/superpowers/plans/2026-05-04-token-cost-finops-reporting-plan.md`. Three source adapters (OpenClaw JSONL at `src/lib/adapters/openclaw-cost-adapter.ts`, Hermes state.db at `src/lib/adapters/hermes-cost-adapter.ts`, Paperclip finance-events HTTP at `src/lib/adapters/paperclip-cost-adapter.ts`) emit a canonical `NormalizedRow` shape preserving privacy guarantees. Orchestrator at `src/lib/services/cost-reporting.ts` with status-downgrade rule, recompute zero-rate guard, indexed `Promise.allSettled` rejected fallback, instance routing, and stripped `signal_context` side-channel before the API response. Five drain detectors at `src/lib/services/cost-signals.ts` with explicit guards (≥24 hourly buckets for velocity, ≥10 rows for context bloat, ≥3 days history for cache drop, strict `tool_call_count===0` gate for simple-on-expensive). New `/api/tokens` response fields (`rows`, `perSource`, `headline`, `signals`, `warnings`, `sourceStatus`) alongside legacy fields. 12 FinOps verify scripts under `scripts/verify-*cost*.ts` (9 cost scripts + 3 adapter scripts: hermes, openclaw, paperclip) totaling 162 assertions. Real-data smoke audit at `scripts/cost-report-audit.ts`.
- **Token & Cost Intel UI**: per-source totals row, "Highest reported monitored spend" headline tile, SignalsCard with click-to-filter and inline evidence expansion (per-detector samples + detail string), source-status banner when adapters unreachable, inline trust + signal badges on Recent Token Events, `(Source)` suffix per row across Cost By Agent / Cost By Session, filter-pill banner with Clear ✕.
- **Pagination** on Cost By Session, Recent Token Events, and every Models & Cost sub-card (default 5/page, options [5, 10, 15, 25, 50], prev `‹` / next `›` buttons matching `AuditEvidencePanel` pattern). Pagination footer hidden when `totalPages <= 1`.
- **`Hide delivery-mirror` global toggle** in TokenCostPanel header area; default off (delivery-mirror visible). Propagates to Token Usage by Model, Cost By Agent, Cost By Session, Recent Events.
- **HelpPanel Glossary** — new top-level CollapsibleCard at the bottom of the Help tab with 62 terms across 10 categories (Cost trust labels / Drain signals / Telemetry sources / Virtual models & special markers / Shield & detection / Blast radius & trust audit / Correlations / Auth & access / Policy framework / Infrastructure & deployment). Each entry shows term + plain-English definition + `appearsIn` badges linking back to the relevant tabs. Phase-2 tooltip-vs-glossary refinement pass with internal reviewer still pending.
- **`pricing_version` snapshot** on every recomputed cost row (DB row `source_version` / bundled JSON `__meta.version` / `KEY_BUNDLED_VERSION` setting). Lets operators trace exactly which rate snapshot produced any recomputed dollar figure.
- **30+ header tooltips** across Token & Cost Intel tab on every column header and tile label, including a delivery-mirror explainer in the Token Usage by Model card.
- **Inline evidence expansion** on SignalsCard active rows: detail string + 3 sample affected rows (timestamp / model / tokens / source). Click again to collapse.
- **velocity_spike filter fallback** for Recent Events when `affected_row_ids` is empty — filters to past-hour rows for the source named in the signal's detail string.

### Changed
- **Metric Aggregation (24h) TOTAL column dropped** — point-in-time snapshot metrics produce mathematically meaningless sums across windows; column removed entirely (internal reviewer Gate-C decision: option A).
- **Hermes adapter `agent` field is `null` in v1** — Hermes's `source` column carries channel/platform identity (`cli`, `telegram`), not agent identity; mapping it to `agent` would mislead aggregations.
- **Hermes loop_risk groups by hash only** — not `(agent, hash)` — per Gate-B blocker fix; OpenClaw + Paperclip use structural cohort keys instead.
- **OpenClaw `cost.*` fields no longer blanket-discarded** — per-provider trust map drives whether to use them. v1 alpha defaults all to `recomputed` (option α — no per-adapter audit yet); v1.1 will widen `actual` for verified sources.
- **SignalsCard counter rows** converted from clickable `<div>`s to native `<button>` elements with `:focus-visible` outline (a11y polish per internal reviewer Gate-C non-blocking note).
- **All Token Cost tables collapsed by default** — Cost By Agent / Cost By Session / Recent Events / Metric Aggregation / Token Usage by Model — auto-expand-on-filter for Recent Events when SignalsCard click activates a filter.
- **SignalsCard relocated** to render immediately above Recent Events for cause-effect proximity (operator feedback: "too far away").
- **Default page size on Cost By Session + Recent Events** changed from 10 → 5.

### Fixed
- **Instance dropdown** (`hermes-local`, `main`, etc.) now honored across the new orchestrator path — was silently ignored, surfacing OpenClaw data when the operator selected `hermes-local`. `GatherFilters` extended with `instance?: string`; orchestrator routes to the correct adapter set. internal reviewer Gate-C correctness blocker.
- **Webpack client-bundle leak**: `display_cost_usd` extracted to `src/lib/cost-reporting-display.ts` (pure helper with type-only imports) so client panels don't pull `node:fs` / `node:path` via the orchestrator's adapter graph. `npx next build` now compiles successfully.
- **C2 + H1 from overnight code review (2026-05-02)** — `proxy_traffic` + JSONL double-count when OpenClaw routes through LiteLLM closed via prefer-JSONL dedupe (commit `56716c6`); `computeVerdict` now runs on the full detection list before slicing for the response payload.

### Security
- **`signal_context` adapter-owned private side-channel** never crosses the API boundary — verified by static grep on the route source AND a runtime test that asserts `'signal_context' in /api/tokens response` is `false` plus `JSON.stringify(response)` does not contain the substring.
- **Hermes `system_prompt` plaintext** stays inside the adapter scope: read for in-memory hashing only, never assigned to any returned `NormalizedRow` field, never persisted, never logged. Verified by `verify-hermes-cost-adapter.ts` JSON-stringify substring assertions.
- **OpenClaw token-reader's existing privacy guarantee preserved** — `src/lib/adapters/openclaw-cost-adapter.ts` does NOT reference `message.content`, `message.parts`, `parts[*].text`, `body`, `prompt`, or `messages[*].content`. Enforced by static AST grep in `scripts/verify-openclaw-cost-adapter.ts`.

## [0.10.0-alpha] - 2026-05-04

Three work-streams shipped 2026-04-29 on `trust-boundary-audit`: (1) the reviewer's M-01 metric-semantics findings closed in full, including the Alert Summary fix-for-real after the reviewer's first-pass validation; (2) net-new OpenClaw routing wire/revert/restart system that turns the Welcome Wizard "Configure OpenClaw routing" step into a one-click experience and gives operators an inline sidecar-tracked managed view of what ClawNex wrote to `~/.openclaw/openclaw.json`; (3) dashboard seedtraffic feature -- a new `origin: 'simulation'` provenance value plus a Configuration -> System Management -> Developer Tools card that lets operators seed and reset demo/QA traffic from inside the dashboard (no shell required), with a three-layer gate (env kill-switch + DB toggle + RBAC) so banking-customer prod installs can completely hide the surface.

Two additional follow-ups landed 2026-04-30: (4) `productionOnly` opt-in on `/api/alerts` so the dashboard header CRITICAL pill, sidebar Active Alerts badge, and Fleet Alert Summary card filter shield-test/demo/qa/simulation origins out of headline counters -- closes the last asymmetry from internal reviewer M-01 where per-instance Fleet alert counts already filtered by origin but headline counters did not; (5) About / Credits panel restructure -- "Inner Circle" is now the personal-acknowledgments section (Personal advisor only); a new "Development Team" section lists DLP reviewer (DLP & Policy Architect), approved user (Program Lead & Delivery Orchestrator), UX reviewer (UX Quality Lead & Operator Advocate), and Security advisor (Security Domain Advisor & Validation Lead); a new AI Tooling disclosure makes explicit that ClawNex was built with the assistance of Anthropic Claude (Opus 4.6, 4.7), OpenAI Codex (GPT 5.4, 5.5), and the Claude Code / Hermes / OpenClaw harnesses, with every commit reviewed and shipped under operator authorship.

A large UX + integration sweep landed 2026-05-01 around the OpenClaw 4.12 transition: (6) ClawNex's OpenClaw connector now performs the device-identity handshake (Ed25519 deviceId + signed nonce) that 4.12+ requires alongside the legacy gateway token -- without it the gateway rejects every connection with `device identity required`; (7) the Agent Workspace + Agents & Sessions panels finally show capitalized agent names (`Main / Neo / Trinity / Morpheus / Oracle / Agent Smith`) and operator-facing role descriptions sourced from a new `KNOWN_AGENT_ROLES` map -- OpenClaw's strict schema rejects `role` so the description has to live in ClawNex; (8) a new status-bar **Update notifier** pill aggregates updates across OpenClaw / Clawkeeper / DefenseClaw -- count is *actionable-only* (only Clawkeeper today, since the others have no in-app update path), with informational rows tagged `INFO` in the dropdown; (9) the deploy story moved from the volatile `/tmp/deploy-prod-legacy.sh` to a durable `scripts/deploy-prod.sh` with `--host`/`--domain`/`--version`/`--sudo-pass-stdin`/`--dry-run` parameters, an OpenClaw preservation guard, and an explicit deep-clean phase that removes the artifacts setup.sh installs (clawkeeper.sh, system unit files, watchdog cron, Caddyfile) without touching adjacent products; (10) ~92 tooltips across the dashboard rewritten in plain English (no more `instances[].agents` jargon); (11) several UX bugs fixed -- `[object Object]` rendering when the gateway returns structured `role`/`model` objects, the stuck "X UPDATES" pill that never went to zero (Clawkeeper version comparison was comparing a date string to a semver tag), the corner-pip overlap on the UPDATES button (`Tooltip as="div"` discoverability indicator landed on the "S"); (12) **governance docs are now bundled in the deploy tarball** (`governance-index.md`, `governance-one-pager.md`, `policy-evidence-checklist.md`, all 14 policies + README, both registers) -- the in-product Governance panel was 404'ing because `package.sh` had been excluding them; (13) **Seed Test Correlation gated behind Developer Tools** -- consistent with the existing pattern for `/api/dev/*` and the seedtraffic feature.

A 2026-05-02 follow-up addresses the cost-attribution gap internal reviewer flagged in the 2026-04-30 product-intent validation report (item #4 on his fix-first list, "token and cost attribution by agent/session/model/tool"): (14) **Cost by Session** card lands on Token & Cost Intel — pivots the existing `/api/tokens` data on `sessionId` instead of agent. Per-session rollup comes from JSONL session files via the new `bySession` aggregation in `token-reader.ts`; rows from `proxy_traffic` whose `session_id` doesn't match any OpenClaw agent directory get bucketed under an explicit `unknown` agent label with a tooltip explaining direct-to-Anthropic / direct-to-OpenRouter calls bypassing OpenClaw routing. Per-agent (`costByAgent`) and per-model (`byModel`) attribution were already shipped — this closes the per-session leg. Per-tool attribution remains out of scope (tool calls are local to the agent, never traverse LiteLLM, so there's no token signal at the tool level without OpenClaw cooperation).

A second 2026-05-02 follow-up closed the reviewer's outbound DLP blocking gaps surfaced in the 2026-05-01 retest: (15) **Bug 1 — outbound-leak verdict early-out**: `computeVerdict` in `src/lib/shield/scanner.ts` now BLOCKs on any HIGH outbound-leak detection and REVIEWs on any MEDIUM outbound-leak — closes the case where `OUT-PASSWORD_ASSIGNMENT` (HIGH) and `OUT-ENV_VARIABLE_LEAK` (MEDIUM) detected the leak but verdict stayed ALLOW because aggregate score was below the 25/60 thresholds. Outbound asymmetric vs. inbound: once data leaves it can't be recalled, so a single HIGH egress signal is enough to block; inbound rules keep aggregate-score behavior. (16) **Bug 2 — redact-without-record asymmetry closed**: `PII_PATTERNS` in `scanner.ts` is now a single source of truth used by both `redact()` and `outboundScan()`. Anything the redactor strips also produces an `OUT-PII-<NAME>` detection at category `outbound-leak`. Severity per type: CC/SSN/passport HIGH (BLOCK), email/phone/DOB MEDIUM (REVIEW), IPv4 LOW (record only). Closes the symptom where `1111-2222-3333-4444` rendered as `[CC_REDACTED]` in cleaned output but verdict stayed ALLOW with zero detections.

A third 2026-05-02 ship landed the **operator-honesty pass on the header status row**: (17) the existing "N SHIELD BLOCKS" pill misrepresented the system on installs in OBSERVE mode — those rows weren't blocked, they were *flagged* and allowed through. New explicit posture pill (left-of-shield-blocks slot) reads `OBSERVE` (amber) or `BLOCKING` (danger-red) with a colored outline + tinted fill, click jumps to Configuration → Shield Settings (one-click switch via the new `shieldSettings` focusKey). The count pill label adapts to mode: `BLOCKED` when actively blocking, `WOULD-BLOCK` when observing. Tooltip on each pill explains both modes inline so an operator who hovers learns the semantic without leaving the screen.

Two preparatory artifacts captured 2026-05-02 for tomorrow's brainstorming pass on the **Configurable Rule & Policy Framework** (no code shipped, all held in `docs/20-product-roadmap.md`): (18) `JAIL-CREDENTIAL-EXTRACTION-REQUEST` regex draft + 20-row test corpus targeting the reviewer's last ALLOW row (natural-language "print every API key" requests); (19) `OUT-GENERIC-API-KEY-SHAPE` regex draft + 33-row test corpus targeting fake-but-key-shaped strings that bypass the per-vendor `SEC-*` rules. Both held until the framework data model lands. the reviewer's three-bucket framing for tomorrow (rule lifecycle / action model / scope+override) appended to the roadmap as session input.

The 2026-05-03 push landed **Policy Framework v1** on `policy-framework-v1` — a 28-task branch (54 commits) shipping a starter policy framework that turns ClawNex's previously hard-coded outbound DLP into operator-authored DLP rules grouped under named policies, with curated starter packs, a runtime evaluator, an authoring UI, and the four-manual documentation sweep. (20) **Schema + types** (Tasks 1-2): two new SQLite tables (`policies`, `policy_rules`) plus a TypeScript surface in `src/lib/shield/types.ts`. (21) **Migration + seed** (Tasks 3-4): full `PolicyStore` CRUD layer plus two starter packs — `ClawNex Default` (`source = curated`, `lifecycle = starter`), a 163-rule operator-visible mirror of the inbound jailbreak/cognitive-tampering/secret/path detections from `ALL_RULES`; and `Generic Egress Starter` (`source = system`, `lifecycle = starter`), seeded enabled by default with **12 wire-active outbound starter rules** (7 PII families: email, phone, SSN, credit card, IPv4, date of birth, passport; 5 outbound families: private key material, password assignment, env var leak, internal IP, database URI) plus **2 lab-lifecycle held drafts visible but disabled** (`JAIL-CREDENTIAL-EXTRACTION-REQUEST`, `OUT-GENERIC-API-KEY-SHAPE`). Vendor mutation-locked except for the guarded enable/disable transition (typed phrase + reason). (22) **Policy evaluator** (Tasks 5-7): `safe-regex2` ReDoS gate at save time, span-based redaction helper at `src/lib/shield/redaction.ts` with fail-loud guards (overlap, out-of-range, malformed `rule_key`, zero-length), and the evaluator core at `src/lib/shield/policy-evaluator.ts` enforcing 15 invariants (curated mirror-only; disabled rule/policy no-fire; direction filter; exception suppression with audit; allow-action suppression with audit; verdict-floor monotonicity; redact-span isolation + samples truncation; provenance contract; iteration-cap audit; stored-flags honored + g force-added; reviewed-seed exemption allow-list; curated-mirror source guard). (23) **Outbound cutover** (Tasks 8-9): `src/lib/shield/scanner.ts` layers in policy-framework detections alongside the existing `ALL_RULES` set; the in-source `OUT-*` emission path was removed and replaced with the `OUTBOUND_LEAK_RULE_KEYS` allow-list (12 explicit rule_keys) that restores `category="outbound-leak"` at the wire boundary so `computeVerdict`'s HIGH/MEDIUM early-out fires byte-for-byte unchanged. (24) **QA harness** (Task 10): `scripts/verify-policy-framework.ts` runs 10 probes covering the reviewer's 2026-05-01 retest set plus negative controls. The 15-invariant harness lives separately at `scripts/policy-evaluator-invariants.ts`. (25) **APIs** (Tasks 11-16): three RBAC permissions (`policies:read` / `policies:write` / `policies:test`) plus five endpoints — `GET /api/policies` (list with rule counts), `POST /api/policies` (create custom), `GET|PATCH|DELETE /api/policies/:id`, `GET|POST /api/policies/:id/rules`, `PATCH|DELETE /api/policies/:id/rules/:ruleId`, `POST /api/policies/:id/test` — all gated with the RBAC-Off Defense Pattern (`requireSession`/`requirePermission` when RBAC is on; `requireLocalhost` fallback when off). Vendor-policy PATCH (curated/system) accepts only `enabled` + auxiliary `confirm_phrase`/`reason` for the disable variant; rule POST/PATCH 403s entirely on vendor parents (clone to custom). Type-confusion guards on every PATCH/POST body field after the Round 4 lockdown. (26) **UI** (Tasks 17-23): new `PoliciesAndRulesCard` (read-only listing with rule counts + source/lifecycle badges, click to expand per-rule rows), Add/Edit Policy modal, Add/Edit Rule modal (Pattern Type radio defaults to Literal; `safe-regex2` rejection surfaced inline with `code` discriminator UNSAFE/BAD_SYNTAX/TOO_LONG), Test Pattern dialog (single textarea against the policy's saved rules, gated by `policies:test`), typed-phrase + reason confirm modal for disabling curated/system **policies** (not individual rules — the policy-level enable/disable toggle intercepts vendor sources), header warning ribbon when any vendor policy is disabled, auto-disable after 5 consecutive iteration-cap hits (writes `rule_auto_disabled` audit + HIGH-severity alert via the existing `createAlert` service). (27) **Docs** (Tasks 24-27): operator manual section in `docs/06-...`, advanced operator deep dive in `docs/07-...` §20 (actions, exceptions, ReDoS guidance, full audit-event table), developer architecture chapter in `docs/18-...` §8, plus the safe-claims pass that landed `starter policy framework` / `curated starter packs` / `operator-authored DLP rules` language across README + release notes (and explicitly avoids `enterprise-grade DLP` / `complete leak prevention` / `all DLP categories covered` — enterprise EDM/DCM/OCR remain deferred).

The branch went through five internal reviewer paranoid-review rounds plus multiple internal code-review passes. Each round caught a distinct class of bug before it shipped: round 1 closed the wrapper-not-wired ReDoS gate; round 2 closed the flags-only-PATCH trigger gap (operator could change `flags` without re-running the safety check); round 3 closed the vendor PATCH lockdown holes (curated/system rows accepted PATCH writes); round 4 closed the type-confusion class across every PATCH/POST body (string-where-array-expected, missing-key tolerance); round 5 closed the empty-pattern + invalid `rule_key` + zero-width regex + overlapping redact-span runtime crashes. All findings landed before this CHANGELOG entry; none are deferred.

### Added

- `src/components/dashboard/panels/CostBySessionCard.tsx` (new) — collapsible "Cost by Session" card on Token & Cost Intel showing per-session token + cost rollup with model breakdown, request count, first/last seen timestamps, and time-range buttons (1h/6h/24h/7d/30d). Sits below `CostByAgentCard` as a sister surface — same `/api/tokens` fetch, different rollup axis. The unknown-session bucket carries a detail-variant tooltip (also surfaced as a header `N UNKNOWN` chip) explaining that those rows are `proxy_traffic` `session_id`s that didn't match any OpenClaw agent directory — typically direct-to-Anthropic / direct-to-OpenRouter calls bypassing OpenClaw routing. Closes the per-session leg of the reviewer's 2026-04-30 fix-first item #4.
- **Header shield posture pill** — `OBSERVE` (amber) / `BLOCKING` (danger-red) pill in `src/components/dashboard/index.tsx` left of the shield-blocks count pill. Polled via new `mRes` leg of `Promise.allSettled` against `GET /api/proxy/block-mode` on the same tick as the other badges. Click jumps to Configuration → Shield Settings via new `shieldSettings` focusKey. Keyboard accessible (role=button, tabIndex=0, Enter/Space activates). Detail tooltip explains both modes inline.
- `focusKey="shieldSettings"` on `SHIELD SETTINGS` card (`ConfigurationPanel.tsx`) so the header pill's deep-link auto-expands the card. `ProxySettingsCard` prop signature gained `focusedCard?: string | null` to plumb through. `SHIELD & DETECTION` CategorySection's `focusKeys` array now includes `"shieldSettings"` so the parent group expands on arrival.
- `SessionAggregation` type + `bySession: SessionAggregation[]` in `src/lib/services/token-reader.ts`. Aggregates every JSONL entry by `(sessionId, agentId)` with per-model breakdown, total tokens, total cost, message count, and first/last seen timestamps. Sorted by cost desc.
- `costBySession` array on `GET /api/tokens` response. Two-source merge identical to the existing `costByAgent` flow: JSONL `bySession` first, then `proxy_traffic` rows merged in by `(session_id, model)` — proxy rows whose `session_id` doesn't match any OpenClaw agent directory carry `agent: 'unknown'` so the dashboard can render the explanatory tooltip without the row looking like a bug. Each row also carries `source: 'session' | 'proxy' | 'mixed'` so consumers can distinguish provenance.
- `ORIGIN_SIMULATION = 'simulation'` provenance value in `src/lib/dashboard/metric-semantics.ts`. Joins the existing `production`/`shield-test`/`demo`/`qa` taxonomy and is excluded from `productionOriginSqlClause` by default. New `simulationOriginSqlClause(jsonColumn)` SQL helper for opt-in inclusion.
- `scripts/dashboard-traffic-fixture.ts` -- alert + shield_scan rows now tag `origin: 'simulation'` (was `production`). New `resetAllDashboardTraffic()` export removes every simulation row regardless of run-id (sweeper for "I forgot the run-ids" cleanup). CLI help text updated for the v0.9.3+ provenance contract.
- `src/lib/services/dev-tools-gate.ts` -- three-layer gate: env kill-switch `CLAWNEX_DEV_TOOLS_DISABLED=1` (returns 404 so customer-prod doesn't leak the feature exists), DB toggle `config_defaults.dev_tools_enabled`, RBAC `system:manage` + localhost fallback.
- `GET /api/dev/status` -- consolidated read endpoint (env state, DB toggle state, available bool, run-id list with counts + earliest/latest, env hostname). 404 when env-disabled.
- `POST /api/dev/seed` -- generates a simulation run with auto-generated `qa-YYYY-MM-DD-HH-MM-SS` run-id (or accepts custom `runId`). Returns inserted-row counts. Audit-logged.
- `POST /api/dev/reset` -- accepts `{runId}` to remove a single run, or `{all: true}` to remove every simulation run on the fleet. Audit-logged with removal counts.
- `GET /api/dev/runs` -- alias for `/api/dev/status`'s `activeRuns` field for callers that only want the run list.
- Configuration -> System Management -> **Developer Tools** card. Three render states: env-disabled (component returns null, no DOM trace), DB-toggle-off (typed-phrase enable form requiring "enable developer tools" verbatim), available (full UI with seed button, per-run Reset, two-step "Reset All Simulation" confirm). All mutations RBAC-gated with localhost fallback.
- Header amber ribbon (between header strip and demo banner): when `activeRunCount > 0`, surfaces "**N active simulation run{s}** on this fleet. Rows are tagged `origin: simulation` and excluded from production-grade counters by default. Click to manage / reset in **Configuration -> Developer Tools**." Click navigates straight to the card. Hidden entirely on env-disabled installs.
- **Mode B seed (internal reviewer follow-up 2026-04-29):** the seedtraffic feature now ships in two modes. Mode A (default, unchanged): rows tag `origin: 'simulation'` and are excluded from default counters. **Mode B (`--visible-to-default-counters` CLI flag, "Make simulation visible in default dashboard counters" checkbox in the UI, `visibleToDefaultCounters: true` in the API):** rows tag `origin: 'production'` so Fleet/header/Shield default counters light up. All Mode B rows still carry `simulation: true` + `simulation_run_id` + `simulation_source` + `simulation_visibility: 'default-counters'` so reset is precise. Mode B requires a second typed-phrase confirm (`light up default counters`) on top of the existing three-layer gate. Header ribbon escalates from amber to danger-red whenever any Mode B run is active. Per-run "LIT" badge on the active-runs list. CLI also gains a top-level `reset-all` command. `resetAllDashboardTraffic` and the active-runs queries scope by `simulation: true` flag (was: by `origin='simulation'`) so both modes are reachable. Real production rows (no simulation tag) are never matched by reset-all -- proven via a new safety-invariant test in `scripts/verify-dashboard-traffic-fixture.ts` which now reports 49/49 (was 32/32).
- `src/lib/services/openclaw-routing-wire.ts` — pure-logic engine: `wireLitellmRouting({ force? })`, `revertLitellmRouting()`, `inspectLitellmRouting()`. Manages a `models.providers.litellm` entry (always `set`, ClawNex-owned slot) plus `agents.defaults.model.primary` (`set-if-missing`, never clobbers operator's pinned default).
- `src/lib/services/openclaw-gateway-control.ts` — supervisor detection + restart. Linux/systemd-user (`systemctl --user restart openclaw-gateway` with `XDG_RUNTIME_DIR=/run/user/$UID`, optional `sudo -u <owner>` prefix when dashboard runs as root) and macOS/launchd (`launchctl kickstart -k gui/$UID/ai.openclaw.gateway`). Both verified live.
- `~/.clawnex-routing-managed.json` sidecar marker file recording every key path written, SHA256 of each value at write time, ClawNex + OpenClaw versions, timestamp. Located outside `~/.openclaw/` (per "leave OpenClaw alone") and outside the install dir (so it survives clean redeploys). 0600 perms.
- `POST /api/openclaw/routing` with `{ action: 'wire' | 'revert' | 'inspect', force?: bool }` — RBAC `config:write` + localhost fallback (dual-flag pattern). Audit-logged via `logEvent('config', 'openclaw_routing_wire'|'openclaw_routing_revert', ...)`.
- `GET /api/openclaw/gateway/restart` — supervisor detection only; never restarts. Used by the UI to decide between an active button and a manual fallback hint.
- `POST /api/openclaw/gateway/restart` — triggers platform-appropriate restart. Returns supervisor name + elapsed ms + raw stdout/stderr + manual fallback command. RBAC `config:write` + localhost fallback. Audit-logged via `logEvent('config', 'openclaw_gateway_restart', ...)`.
- Configuration → OpenClaw Routing card buttons: **Wire LiteLLM**, **Revert ClawNex Wire**, **Force Wire (overwrite)**, **Restart Gateway** (cyan, tooltipped with detected supervisor name), **Refresh**. Status badges: WIRED / OPERATOR-OWNED / NOT WIRED + OpenClaw version chip.
- Inline `<details>` "View raw sidecar" disclosure in the OpenClaw Routing card surfacing the full `~/.clawnex-routing-managed.json` JSON contents — operator can audit exactly what ClawNex is tracking without SSH.
- Welcome Wizard step 5 ("Configure OpenClaw routing") becomes one-click: primary action invokes wire + auto-restart in a single click, with live progress in the step description ("Wiring..." → "Restarting..." → "Wired and restarted via systemd-user in <N>ms").
- `scripts/openclaw-routing-test.ts` — sandbox smoke test that copies `openclaw.json` to `/tmp/` and exercises the full wire→idempotent-wire→revert→idempotent-revert cycle without ever touching the real config. `--target=real` mode runs against the actual config; always backs up first to `openclaw.json.before-clawnex-wire.<ts>`.
- `/api/alerts` response now includes scope provenance: `scope` (raw param echoed or null), `effectiveScope` (`'status' | 'active' | 'terminal' | 'all' | 'legacy-default'`), and `include_suppressed` (boolean) so any consumer can tell which set it actually got.
- `/api/openclaw/routing` GET response now includes `openclawVersion` (from `meta.lastTouchedVersion`) and `managed.{sidecar, pathStatus}` so the dashboard can render managed-vs-operator-owned distinctions.
- `/api/alerts` accepts `?productionOnly=true` (additive opt-in, default unchanged). When set, rows are filtered by `productionOriginSqlClause('metadata')` so `shield-test` / `demo` / `qa` / `simulation` origins are excluded. Response echoes `productionOnly` alongside the existing scope/effectiveScope/include_suppressed provenance fields. Dashboard header CRITICAL pill, sidebar Active Alerts badge, and FleetLiveCards Alert Summary card now pass `&productionOnly=true`. Closes the internal reviewer M-01 follow-up asymmetry (2026-04-30, commit `6d894bc`).
- About panel **Development Team** section. DLP reviewer (DLP & Policy Architect), Program Lead (Program Lead & Delivery Orchestrator), UX reviewer (UX Quality Lead & Operator Advocate), Security advisor (Security Domain Advisor & Validation Lead). Distinct from the Inner Circle (which now contains Personal advisor as the personal acknowledgment that doesn't fit the team-roster framing).
- About panel **AI Tooling disclosure**. Plain-language note that ClawNex was built with the assistance of Anthropic Claude (Opus 4.6, 4.7) and OpenAI Codex (GPT 5.4, 5.5), running in the Claude Code CLI, Hermes review harness, and OpenClaw gateway. Every commit was reviewed and shipped under operator authorship -- the disclosure is honest provenance, not a co-author claim.
- `src/lib/services/agent-roles.ts` — `KNOWN_AGENT_ROLES` map + `getAgentRole(id)` helper. Source-side store for operator-facing agent role descriptions. OpenClaw 4.12's strict openclaw.json schema rejects `role` as a field on `agents.list[]` and on `identity` (allowed identity keys: name, theme, emoji, avatar only), so the description has to live in ClawNex. Adding a new agent? Drop an entry here and redeploy. A DB-backed editor with a UI is a follow-up if/when this list grows.
- `src/components/dashboard/UpdateBadge.tsx` — new header pill (next to the version chip) aggregating updates across OpenClaw / Clawkeeper / DefenseClaw via `/api/config/updates`. Count is **actionable-only** (only Clawkeeper today, since OpenClaw upgrades happen outside ClawNex per the never-touch-OpenClaw rule and DefenseClaw rules ship bundled with ClawNex versions). Dropdown shows all three sources with an `INFO` tag on the non-actionable ones so operators see the version delta for awareness without confusing it for an actionable item. Polls every 15 minutes; refresh button forces a server-side cache clear and re-poll. Fires a `clawnex:updates-refreshed` window event after every in-app update action so the badge re-fetches immediately rather than waiting for the next 15-min tick.
- `src/components/dashboard/shared.tsx` — `useStickyBoolean(key, default)` hook. Persists a boolean across reloads via localStorage (SSR-safe, degrades silently). Used for collapse-state preferences ("I never use Hermes, hide it"). `CollapsibleCard` gained an optional `storageKey` prop; the connector subsections in Configuration → Fleet Connectors (`fcOpenClaw`, `fcHermes`, `fcPaperclip`, `fcNemoClaw`) all use the hook now.
- `scripts/deploy-prod.sh` — durable, parameterized production deploy. Supersedes the volatile `/tmp/deploy-prod-legacy.sh`. Flags: `--host`, `--domain`, `--version` (default reads from `package.json`), `--sudo-pass-stdin` / `--sudo-pass-env VAR` / interactive prompt for sudo password, `--dry-run`, `--no-deep-clean`. Pre-flight summary lists exact wipe scope vs. untouched paths; OpenClaw preservation guard aborts the install phase if `~/.openclaw/openclaw.json` would be missing post-wipe. Deep clean removes the artifacts setup.sh / install-prod.sh installed (clawkeeper.sh, unit files, Caddyfile, watchdog cron) — never anything adjacent (OpenClaw, Hermes, Claw3D, paperclip).
- **Status-bar update notifier**. Single-pill button (filled when count > 0, outlined when zero). Click expands a dropdown listing each source's installed → latest version, with the actionable Clawkeeper row distinguished from the informational OpenClaw + DefenseClaw rows. "View details →" deep-links to Configuration → Updates. Mouseover hint via native `title=""` (no `<Tooltip>` wrapper — that wrapper rendered a corner pip directly on the "S" of UPDATES via the `BlockAnchorIndicator` discoverability hint).
- **Capitalized agent names + role descriptions** in Agent Workspace tabs and Agents & Sessions cards. Names live in openclaw.json (`name` is schema-allowed); roles live in `agent-roles.ts` and merge in via `workspace-reader` synthesis + `/api/agents` enrichment. Today's seed: Main, Neo, Trinity, Morpheus, Oracle, Agent Smith.
- **`main` agent pinned to position 0** in Agent Workspace tabs with a green `DEFAULT` chip. Anchors the persistent operator workspace regardless of any custom-named agents the operator has added.
- **Sticky collapse** on Configuration → Fleet Connectors subsections. Operator collapses Hermes/Paperclip/OpenClaw/NemoClaw once, the state persists across reloads.
- Governance docs bundled in the deploy tarball: `governance-index.md`, `governance-one-pager.md`, `policy-evidence-checklist.md`, all 14 `policies/*.md` + `README.md`, both `registers/*.md` (risk-register, vendor-inventory). The in-product Governance panel was 404'ing because `deploy/package.sh` had been deliberately excluding them; the API whitelist already approved every file. The package.sh stage banner now reports the count: "7 operator manuals, 3 governance summaries, 17 policy + register files = 27 total".
- **Policy Framework v1** — starter policy framework: `policies` + `policy_rules` SQLite tables (migration auto-runs on boot), `PolicyStore` CRUD layer, runtime `evaluatePolicies()` that consumes the active rule set, and a curated starter pack (`ClawNex Default`, 163 rules mirroring the existing `SEC-*` / `JAIL-*` / `BIAS-*` / `OUT-*` taxonomy). Operator-authored DLP rules are now first-class — operators can author custom rules, fork the curated mirror, or stack their own policies above it. Enterprise EDM/DCM/OCR remain deferred to a follow-up.
- **`Generic Egress Starter` system policy** — seeded enabled by default alongside the curated mirror. **12 wire-active outbound starter rules** (7 PII families: email, phone, SSN, credit card, IPv4, date of birth, passport; 5 outbound families: private key material, password assignment, env var leak, internal IP, database URI), plus **2 lab-lifecycle held drafts visible but disabled** (`JAIL-CREDENTIAL-EXTRACTION-REQUEST`, `OUT-GENERIC-API-KEY-SHAPE`) — those don't catch anything until an operator clones the pattern into a custom policy. Vendor mutation-locked (only `enabled` + `confirm_phrase` + `reason` accepted on PATCH); disable requires the typed-phrase + reason guard.
- **`safe-regex2` ReDoS gate** at rule save time — every operator-authored or operator-edited regex pattern is checked by `safe-regex2` before insert/update; unsafe regex is rejected at the API boundary with a 400 + structured `code` (`UNSAFE` / `BAD_SYNTAX` / `TOO_LONG`) + reason. Enforced on `POST /api/policies/:id/rules` and `PATCH /api/policies/:id/rules/:ruleId` whenever the resulting state has `is_regex=true` (covers flags-only patches — the Round 2 gap, since `\u{110000}` compiles under no flags but fails under `u`). Five named curated-mirror false-positives route through `createReviewedSeedRule` with a hardcoded allow-list (PHONE_US, CREDIT_CARD, IPv4 in Generic Egress Starter; both held drafts) — bounded patterns that safe-regex2 flags but have no ReDoS history.
- **Span-based redaction helper** (`src/lib/shield/redaction.ts`) — `applySpans()` with four fail-loud guards (negative start, zero/negative length, out-of-range, malformed `rule_key` against `RULE_KEY_FORMAT = /^[A-Z][A-Z0-9_-]*$/`) and overlap detection. The evaluator runs a pre-pass before calling `applySpans`: filters zero-length spans (lookahead/lookbehind), greedy non-overlap selection (longest-first, alpha tiebreak), `RULE_KEY_FORMAT` defense-in-depth filter — each drop emits a `redact_span_skipped` audit row.
- **Policy evaluator core** (`src/lib/shield/policy-evaluator.ts`) — runtime arm. Loads enabled rules from `policy_rules` per scan via `listEnabledRulesForActivePolicies(direction)` (curated excluded at SQL JOIN; defense-in-depth runtime guard audits + skips any leak), applies each rule's regex with stored normalized flags (Option C: stored `flags` honored, `g` force-added at save time, only `g`/`i`/`m`/`s`/`u` accepted), emits one `ShieldDetection` per matching rule (matchCount aggregates hits) with full provenance (`source: 'policy-system' | 'policy-custom'`, `policy_id`, `policy_name`, `policy_source`, `policy_rule_id`, `rule_key`, `action`). Per-rule actions resolve into `{ detections, redactSpans, verdictFloor }`. Iteration cap (`ITERATION_CAP = 1000`) emits a `rule_iteration_capped` audit per `(rule, scan)`; counter increments per consecutive cap and resets on any non-capped evaluation.
- **`OUTBOUND_LEAK_RULE_KEYS` allow-list** in `src/lib/shield/scanner.ts` — 12 explicit rule_keys whose policy-framework detections get `category="outbound-leak"` restored at the wire boundary so `computeVerdict`'s HIGH/MEDIUM early-out (BLOCK on HIGH egress, REVIEW on MEDIUM egress) fires byte-for-byte unchanged. Replaces the in-source `OUT-*` emission path the cutover removed; adding a new outbound-leak rule requires extending this set AND seeding the rule (procedural review per spec §3.4).
- **`scripts/verify-policy-framework.ts`** — 10-probe QA harness covering the reviewer's 2026-05-01 retest set (8 outbound DLP probes + 2 negative controls). Asserts both verdict AND `rule_key` provenance. Exits 1 on any failure for CI use. The 15-invariant evaluator harness is at `scripts/policy-evaluator-invariants.ts` (separate concern: hermetic temp DB, exercises every contract surface).
- **`policies:read` / `policies:write` / `policies:test` RBAC permissions** — three new permission keys gating the five policy-framework endpoints. `policies:read` for all 5 roles; `policies:write` and `policies:test` for Admin + Security Manager only (internal reviewer review #6 — broad read access would let Viewers probe what the shield blocks). All endpoints follow the RBAC-Off Defense Pattern with `requireLocalhost` fallback.
- **`GET /api/policies`** — list every policy with rule counts, source (`curated` / `system` / `custom`), lifecycle, enabled state, and metadata. RBAC `policies:read` + localhost fallback.
- **`POST /api/policies`** — create a custom policy (`name` required non-empty, `description` optional). Source hard-pinned to `custom`. Returns 400 on missing name + 409 on duplicate name. RBAC `policies:write` + localhost fallback. Audit-logged.
- **`GET|PATCH|DELETE /api/policies/:id`** — read/update/delete a single policy. Vendor PATCH lockdown: curated/system rows accept only `enabled`, `confirm_phrase`, and `reason` — every other field returns 403. Disabling a vendor policy requires the typed phrase (e.g. `disable generic egress starter`) plus reason ≥ 10 chars; phrase mismatched without an entry in the server-side phrase map fails closed. DELETE on non-custom 403s. RBAC `policies:write` + localhost fallback. Audit-logged with `policy_create`/`policy_enable`/`policy_disable`/`policy_edit` based on actual changed fields (no-op patches emit no audit). The disable phrase is verified but never persisted — only `confirm_phrase_matched: true` + `reason` go to detail (internal reviewer review #5).
- **`GET|POST /api/policies/:id/rules`** — list rules under a policy / create a new rule under a custom policy. POST 403s if the parent is curated/system (clone-then-customize). Required body fields: `name` (non-empty), `pattern` (non-empty), `direction` (`inbound`/`outbound`/`both`), `severity` (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`). Optional: `is_regex`, `flags`, `rule_key` (auto-slugged if absent; either path validated against `RULE_KEY_FORMAT`), `action` (`score`/`block`/`review`/`redact`/`allow`), `exceptions`, `enabled`. Type-confusion guards on every field. RBAC `policies:write` + localhost fallback. Audit-logged.
- **`PATCH|DELETE /api/policies/:id/rules/:ruleId`** — update/delete a single rule. Both 403 when the parent policy is non-custom (the implicit internal reviewer Gate-5 carry-forward enforcement: the 5 reviewed-exemption rule_keys all live in vendor-shipped policies, so the API cannot enable/promote them). PATCH re-runs `assertRegexSafety` whenever the resulting state has `is_regex=true`, regardless of which field was patched. Cross-policy rule-id-guess prevented via `rule.policy_id === policy.id` check. RBAC `policies:write` + localhost fallback. Audit-logged.
- **`POST /api/policies/:id/test`** — operator-facing test endpoint. Body: `{ text: string }` (single text, not a corpus array). Returns `{ policy_id, matched: [{ rule_key, name, matchCount, samples, suppressed_by_exception? }] }`. Mirrors evaluator semantics (stored flags + iteration cap + exception suppression surfaced as `suppressed_by_exception: true` rather than hidden). RBAC `policies:test` + localhost fallback. Audit-logged with matched count + suppressed count.
- **`PoliciesAndRulesCard`** — read-only listing card on Configuration → Shield & Detection. Shows every policy with rule counts, source + lifecycle badges, version stamp. Click expands per-rule rows showing `rule_key`, truncated pattern, severity, action, and (when it differs from the parent) the rule's lifecycle. Replaces the legacy `PoliciesGuardsPanel` (and the legacy `/api/policies/legacy` route the panel was retargeted to during the compat commit — both deleted at this task).
- **Add/Edit Policy modal** — operator authoring for custom policies (name, description). Vendor rows show a disabled `[EDIT]` with tooltip "Vendor policy — edit disabled in v1." 400 (empty name) and 409 (duplicate) errors surface inline.
- **Add/Edit Rule modal** — Pattern Type defaults to **Literal** (internal reviewer review #4 layer 1 — operator-friendly); switching to Regex shows the "Advanced — invalid patterns can slow the scanner" warning inline. Save-time `safe-regex2` rejection surfaces under the pattern field with code-specific copy (`UNSAFE` / `BAD_SYNTAX` / `TOO_LONG`). Direction checkboxes (Inbound/Outbound — both → `both`); severity dropdown (CRITICAL/HIGH/MEDIUM/LOW); action dropdown (`score` / `block` / `review` / `redact` / `allow` with friendly labels); exceptions textarea (one literal per line); flags hidden behind an "Advanced" toggle (operator-supplied free-form string, normalized server-side). `[Test Pattern]` button gated by `policies:test`.
- **Test Pattern dialog** — single textarea against the policy's saved rules (not the unsaved candidate — v1 limitation surfaced inline in the modal copy). Renders matched rules with `rule_key` + `matchCount` + first sample, badging `(suppressed by exception)` so operators see what would actually fire on the wire.
- **Typed-phrase + reason confirm on disabling curated/system policies** (`PolicyDisableConfirm`) — opens when an operator clicks the enable toggle on a vendor row to disable. Probes the API once on mount to fetch the `expected_phrase` from the 400 response (server is single source of truth — no client-side phrase map). Operator types the phrase verbatim + a reason ≥ 10 chars. Re-enabling is a single-click PATCH (no phrase needed — friction-free protection restoration).
- **Header warning ribbon** — danger-tinted ribbon mirroring the existing dev-tools simulation ribbon, polled on the existing 15s `fetchBadges` tick. (*Mode-aware copy was originally `"<Policy Name> is disabled. <Inbound/Outbound> threat detection is OFF."` / `"Both ClawNex vendor-shipped policies are disabled. Most threat detection is OFF."` — superseded 2026-05-17 per internal reviewer review: ClawNex Default is `source=curated` and wire-inert in v1, so disabling it does NOT take inbound detection offline (the 163 built-in detections still run from `src/lib/shield/rules.ts`). Current copy in `src/components/dashboard/index.tsx` splits the per-policy runtime cost — only Generic Egress Starter disabled actually strips wire-active detection. The v0.10.0 ribbon shipped with the old framing.*) Click navigates to Configuration → `policiesAndRules` focus.
- **Auto-disable on iteration cap** — module-scoped `Map<rule.id, count>` in the evaluator increments on consecutive `rule_iteration_capped` audits and resets on any non-capped evaluation. At 5 consecutive hits, `disableRuleAutoMagic` flips `enabled=0`, writes a `rule_auto_disabled` audit row (detail JSON includes `policy_id`, `rule_key`, `reason: 'iteration_cap_hit'`, `consecutive_hits: 5`), and inserts a HIGH-severity alert via the existing `createAlert` service (5-min dedup built in). Idempotent re-fire guard prevents double-firing on already-disabled rules. Note: the safety mechanism applies to any matching rule including vendor — operator gets the alert + audit and can re-enable via single-click PATCH if appropriate; vendor mutation-lock for normal API edits remains intact.

### Changed

- `FleetLiveCards` Alert Summary fetch now uses `?scope=active&since=...&limit=500` (was `?since=...&limit=5`). The card labels three big numbers as Critical/High/Medium aggregate counts plus a Latest line; with `limit=5` the breakdown lied whenever the active set was larger. The 500-row ceiling is documented inline; if a fleet ever exceeds 500 active alerts, that's the signal we need a dedicated aggregate endpoint, not a higher ceiling.
- `getShieldHistory(limit, since, opts?)` — new third `opts: { includeTestGenerated?: boolean }` parameter, defaults to filtering out `shield-test`/`demo`/`qa` origins via `productionOriginSqlClause('detail')`. Mirrors the `getShieldStats` opt-out pattern shipped in v0.9.2.
- `/api/shield/history` now accepts `?includeTestGenerated=true` and threads through to `getShieldHistory`. Default behavior excludes test-generated origins.
- `/api/shield/stats` instance-filtered path now passes the `includeTestGenerated` flag it was already parsing through to `getShieldHistory` — closes the leak where the global path filtered correctly but the instance-filtered path didn't.
- `InstanceDetailPanel` alert fetch uses explicit `?scope=all&limit=10&since=...` (was `?limit=10&since=...`). Panel feeds `TimelinePanel` as a chronological "what happened in this window" feed alongside audit events; the explicit scope keeps it from contradicting Header/Sidebar/Fleet/Alerts panel which intentionally answer the active-state question.
- Welcome Wizard step 5 `realDone` semantic: now sourced from sidecar-managed state (was: all-providers-routed, which never went green for any operator with even one OAuth-only provider like Claude.ai or ChatGPT Pro). Step keeps `skippable: true` for OAuth-only fleets.
- **OpenClaw connector device-identity handshake (4.12+)**. The `connect` frame ClawNex sends after the WebSocket handshake now includes a `device: { id, publicKey, signature, signedAt, nonce }` object alongside the legacy `auth.token`. Without this, OpenClaw 4.12+ rejects every connection with `device identity required`. ClawNex generates an Ed25519 keypair on first run, persists PEMs in `config_defaults` (keys `clawnex_device_public_key_pem` / `clawnex_device_private_key_pem`), derives `deviceId = sha256(rawPubkey).hex()` (matches OpenClaw's own derivation), and signs the V2 device-auth payload with the private key. **Backwards-compatible** with OpenClaw <4.x: when the gateway's challenge has no `payload.nonce`, the device fields are omitted and the legacy token-only handshake stays intact. Verified live against staging host (4.12) + local dev host (3.28).
- `src/lib/services/workspace-reader.ts` synthesis now consults `KNOWN_AGENT_ROLES` for `role` when openclaw.json doesn't carry one (which is always today, since OpenClaw 4.12's schema rejects the field). Also: `main` agent pinned first in `getAgentFiles` sort (was alphabetical), with a `workspace/` (singular) path special-case so the OpenClaw 4.12+ plural `workspaces/<id>/` layout works alongside `main`'s legacy directory.
- `/api/agents` enriches gateway-returned agent records with role from `KNOWN_AGENT_ROLES` so the Agents & Sessions panel cards can show a description line under each agent name. Same enrichment applied to the local-filesystem fallback.
- `getInstalledClawkeeperVersion` refactored → `getInstalledClawkeeperState` returning `{ exists, mtime: Date | null, displayVersion }`. The previous comparison did `installed-string-with-date !== upstream-semver-tag`, which never matched and pinned `clawkeeperUpdateAvailable = true` permanently. New comparison uses `mtime < latestReleaseDate`. Honest signal: if the local binary's mtime is older than the upstream release's `published_at`, an update is available; otherwise up-to-date.
- `AgentsSessionsPanel` defensive coercion of structured `role` and `model` fields. Centralized into `coerceToString(raw, ...keys)` which accepts a string-or-object; on object, tries `.name` / `.id` / `.model` / etc. Both the filter-list source AND the per-card render use it. Closes the `[object Object]` rendering bug across both fields.
- ~92 tooltips across the dashboard rewritten in plain English. Voice: lead with the operator-facing meaning ("how many services are healthy"), drop `TipCode`-wrapped technical paths/table names/code identifiers in favor of bold operator-friendly terms or plain prose, use bulleted lists for multi-state explanations (block-mode ON/OFF, request-source proxy/watcher/direct, HTTP status 200/400/5xx). Affected files: ConfigurationPanel (33), PromptShieldPanel (9), AgentWorkspacePanel (8), TrafficMonitorPanel (7), FleetCommandPanel (7), AuthMethodsCard (5), TokenCostPanel (4), ToolsAccessPanel (3), ThreatScoreGauge / ShieldTestsPanel / CveCard / FindingsGrid / AccessControlPanel (~2 each), AgentsSessionsPanel + index.tsx (header KPI tooltips), plus 11 smaller files where only an unused `TipCode` import got dropped. `TipCode` is now used in exactly one place — its own export in `tooltip.tsx`.
- Theme toggle icon. Replaced fragile Unicode glyphs (☼/☾) with inline SVGs — orange sun (C.warn) when in dark mode, cyan crescent moon (C.cyan) when in light mode. 16px crisp, 28x24 button hit area, accent-tinted background so the toggle is visually identifiable at a glance.
- `Tools Access` panel: `Configuration → Updates → DefenseClaw Rules` row no longer shows an "Update Available" / "Up to date" badge. The badge was a false affordance — DefenseClaw rules ship bundled with ClawNex versions, so the only update path is bumping ClawNex itself. Row now shows just version + rule count; the status-bar update notifier surfaces "ClawNex update available, includes new rules" when relevant.
- **`src/lib/shield/scanner.ts` — outbound DLP cutover to the policy framework.** The in-source `OUT-PII-*` and `OUT-*` emission loops in `outboundScan()` were removed; both `shieldScan()` and `outboundScan()` now layer in detections from `evaluatePolicies()` alongside the existing `ALL_RULES` set. Policy redact spans apply against the original `text` first, then `PII_PATTERNS` redact runs over the prepared output (Task 8 C1 fix — original ordering would silently corrupt or crash on PII+policy co-occurrence). The 2026-05-02 outbound-leak verdict early-out (BLOCK on HIGH egress, REVIEW on MEDIUM egress) is preserved via the static `OUTBOUND_LEAK_RULE_KEYS` allow-list at `scanner.ts:124` (12 explicit rule_keys mirroring the deleted in-source emissions); category restoration runs at the merge site so `computeVerdict` (lines 332-333) fires byte-for-byte unchanged. Inbound (`shieldScan`) does not have outbound-leak semantics — only egress is asymmetric.
- **`/api/policies` (legacy)** moved to `/api/policies/legacy` during the API cutover (compat commit `b4a006f`) to keep `PoliciesGuardsPanel` alive through Stage-4 dev, then DELETED at Stage 5 when `PoliciesAndRulesCard` mounted as the replacement (commit `33dd4d9`). The framework `/api/policies` is now the canonical list endpoint with a different response shape; external consumers that were calling the legacy hard-coded list need to switch to the framework shape.
- **Configuration → Shield & Detection** group now hosts `PoliciesAndRulesCard` as the canonical operator surface for outbound DLP authoring. The legacy hard-coded outbound rule list panel was removed; its content is reachable via the curated mirror under `ClawNex Default`.

### Fixed

- **internal reviewer M-01 #1** — Fleet Alert Summary derived totals from a 5-record sample. Two-pass fix: `dde68aa` added `scope=active`; `0485888` bumped `limit=5 → limit=500` so the breakdown honestly aggregates the active set.
- **internal reviewer M-01 #2** — Shield History feed and instance-filtered Shield stats path leaked `shield-test`/`demo`/`qa` origins into operator-facing surfaces. `getShieldHistory` now applies `productionOriginSqlClause` by default.
- **internal reviewer M-01 #3** — `/api/alerts` responses had no scope metadata. Added `scope`, `effectiveScope`, `include_suppressed` fields.
- **internal reviewer M-01 #4** — `InstanceDetailPanel` used the legacy no-scope query. Added explicit `?scope=all`.
- **internal reviewer M-01 follow-up (2026-04-30)** — Headline alert counters (header CRITICAL pill, sidebar Active Alerts badge, FleetLiveCards Alert Summary) leaked shield-test / demo / qa / simulation origins. Per-instance Fleet alert counts already excluded those origins via `productionOriginSqlClause`, so a `Run All` Shield Tests sweep would inflate headline numbers but not the per-instance column -- exactly the kind of cross-panel asymmetry the metric-semantics work has been closing. Resolved with the `productionOnly=true` opt-in on `/api/alerts` (commit `6d894bc`).
- The OpenClaw Routing wizard step previously navigated to Configuration but did nothing else — operators had to manually edit `openclaw.json` to wire LiteLLM, then SSH the host to restart `openclaw-gateway`. New flow handles both in one click.
- Three em-dash characters in the OpenClaw Routing card source got JSON-encoded to literal `—` text by the editor, rendering as visible escape sequences in the browser. Replaced with ASCII `--`.
- **`device identity required` rejection from OpenClaw 4.12 gateway**. ClawNex's connector was sending only the legacy `?token=` URL parameter; 4.12 now requires a device-pairing handshake on top. Added Ed25519 keypair + signed-nonce flow (see `Changed` above). Backwards-compatible with 3.28 via a `if (nonce)` guard.
- **`[object Object]` rendering** in Agents & Sessions panel cards. Both `role` and `model` come back from the OpenClaw 4.12+ gateway as either a plain string or a structured object depending on agent type; the prior code blindly cast to string. Defensive coercion via `coerceToString` (see `Changed` above).
- **Update pill stuck at "X UPDATES" forever**. Two stacked bugs. (a) The Clawkeeper version comparison was string-vs-semver and could never match — fixed by switching to mtime-vs-release-date. (b) The badge counted OpenClaw and DefenseClaw, neither of which the operator can update from inside ClawNex; the count produced numbers operators couldn't act on. Now actionable-only (Clawkeeper today), with informational rows tagged `INFO` in the dropdown.
- **Update pill green dot overlapping the "S"**. The Tooltip system renders a 6px cyan corner pip (`BlockAnchorIndicator`) on any anchor with `as="div"` as a hover-discoverability hint — pinned at top-right with 6px inset, which is exactly where the "S" sits. The UpdateBadge had `<Tooltip as="div">`; removing that wrapper and using native `title=""` on the div for hover info kills the pip without losing any operator-facing information (the dropdown carries the same info one click later).
- **Update pill stale after in-app update action**. The badge polled every 15 minutes and didn't react when an operator ran an update via Configuration → Updates. ConfigurationPanel now dispatches a `clawnex:updates-refreshed` window event after `triggerClawkeeperUpdate` and `checkForUpdates`; UpdateBadge listens and re-fetches immediately.
- **Empty ROLE box on Agent Workspace panel** + empty agent description in Agents & Sessions cards. Roles are now sourced from `KNOWN_AGENT_ROLES` and propagate through both `/api/workspace/agents` (workspace-reader) and `/api/agents` (gateway path with post-hoc enrichment).
- **Governance docs 404'ing** in the in-product Governance panel. `package.sh` had been deliberately excluding governance/policies/registers from the deploy artifact. The API whitelist already approved them. Bundle now includes all 27 expected files.
- **Seed Test Correlation button visible in operator-prod**. Now gated behind Developer Tools (same env kill-switch + DB toggle + RBAC pattern as `/api/dev/*` and the seedtraffic feature). Hidden by default; expose via Configuration → Developer Tools.
- **Workspace panel showed `main`'s files for every agent**. workspace-reader's per-agent path resolution had a layout-convention drift (assumed `workspace-<id>/` while OpenClaw 4.12 ships `workspaces/<id>/` plural). Layout-detection logic added — also pinned `main` first with a `DEFAULT` chip, and the AgentWorkspacePanel ROLE conditional was reverted (now always rendered, populated from `KNOWN_AGENT_ROLES`).
- **Token Cost panel "OpenClaw: Connected" indicator was lying** — it OR'd against `health?.status === "ok"`, which is just "the dashboard process is alive." Now reflects the actual connector authenticated state.

### Security

- All wire/revert/restart endpoints gated by RBAC `config:write` + localhost fallback (RBAC-Off Defense Pattern). Mutations audit-logged.
- Sidecar lives at `~/.clawnex-routing-managed.json` with 0600 perms; readable only by the operator who owns it.
- Force-wire requires explicit `force: true` in the request body — guards against accidental overwrite of operator-owned `models.providers.litellm` entries.
- Revert is non-destructive of operator edits to `set-if-missing` paths (e.g. `agents.defaults.model.primary`): the engine SHA256-fingerprints values at write time and refuses to remove a value that was changed externally after the wire. Preserved paths are reported in `preservedPaths`.
- **All five policy-framework endpoints** gated by RBAC (`policies:read` / `policies:write` / `policies:test`) plus `requireLocalhost` fallback (RBAC-Off Defense Pattern). Every mutation is audit-logged via the `audit()` shim wrapping `logEvent` with `source: 'shield-policy'`. Vendor PATCH lockdown on curated/system rows accepts only `enabled` + `confirm_phrase` + `reason` — every other field is rejected at the API boundary so a malicious or buggy client cannot rewrite a curated rule's pattern without cloning it to a custom policy first. Rules under vendor parents 403 on POST/PATCH/DELETE entirely.
- **`safe-regex2` ReDoS gate at save time** prevents operator-authored regex from creating a runtime DoS surface. Enforced on every create + update path, including flags-only PATCHes and the test endpoint's per-rule body. Curated mirror rules ship pre-validated; the gate runs against them on every boot as a regression check.
- **Type-confusion class closed across all PATCH/POST bodies** — every framework endpoint validates body field types (string-where-array-expected, missing-key tolerance, untrimmed-string acceptance) before touching the store. Round 4 internal reviewer paranoid-review surfaced the original gap; remediation landed in commit `51da494`.
- **Empty-pattern + invalid `rule_key` + zero-width regex + overlapping redact-span runtime-crash class** closed in the redact path. Empty/whitespace patterns reject at save time. `rule_key` validates against `RULE_KEY_FORMAT = /^[A-Z][A-Z0-9_-]*$/` (single source of truth exported from `redaction.ts`). The evaluator runs a pre-pass over redact spans before calling `applySpans`: filters zero-length spans (lookahead/lookbehind), greedy non-overlap selection (longest-first, alpha tiebreak), `RULE_KEY_FORMAT` defense-in-depth filter — each drop emits a `redact_span_skipped` audit row with reason. `applySpans` itself retains its four fail-loud guards as the runtime safety net. Round 5 internal reviewer paranoid-review fixes in commit `2a495d9`.
- **Vendor mutation-lock** — curated and system policies are mutation-locked at the API: PATCH accepts only `enabled` + `confirm_phrase` + `reason`; every other field returns 403. Disabling requires the typed phrase + reason ≥ 10 chars; phrase mismatched without a server-side phrase-map entry fails closed. Rules under vendor policies (curated/system) cannot be PATCHed, DELETEd, or have new rules added at all (parent-source check 403s) — clone-then-customize is the operator path. Held drafts (`enabled=false` lab rules in Generic Egress Starter) inherit this lock.

### Migration

- No schema migration required.
- Operators with an existing `models.providers.litellm` entry in `~/.openclaw/openclaw.json` (manually configured) will see the WIRED card show **OPERATOR-OWNED** until they click **Force Wire** to adopt ownership. The existing entry is preserved verbatim if they leave it alone; force-wiring overwrites with ClawNex's canonical values and starts tracking via the sidecar.
- The `/api/alerts` response shape is additive — existing consumers that don't read `scope`/`effectiveScope`/`include_suppressed` are unaffected.
- **Policy framework schema migration auto-runs on boot.** Two new SQLite tables (`policies`, `policy_rules`) are created if absent; the `ClawNex Default` curated mirror (163 rules from `ALL_RULES`) and `Generic Egress Starter` system policy (14 rules — 12 enabled wire-active starter rules + 2 disabled lab held drafts) are seeded if absent. Migration is dual-key idempotent (`policy_framework_schema_version` + `policy_framework_seed_version`). Existing operator deployments pick up the framework on first boot with no manual step.
- **Outbound DLP behavior is preserved by the cutover.** Operators with no custom rules see the same `OUT-PII-*` and `OUT-*` detections the in-source emission path used to produce — those rules now live in `Generic Egress Starter` and emit through the policy evaluator instead. The `OUTBOUND_LEAK_RULE_KEYS` allow-list at the wire boundary keeps `computeVerdict`'s HIGH/MEDIUM early-out semantics intact (verified by `verify-policy-framework.ts` 10/10).
- **Legacy `/api/policies` route removed.** The pre-framework endpoint that fed `PoliciesGuardsPanel` was moved to `/api/policies/legacy` during the API cutover (compat commit `b4a006f`) so the live panel kept working through Stage-4 dev, then deleted at Stage 5 when `PoliciesAndRulesCard` mounted as the replacement (commit `33dd4d9`). The framework `/api/policies` is now the canonical list endpoint. External consumers that were calling the legacy shape need to switch to the framework response shape.
- **No operator action required to opt out.** Operators who want to keep behavior identical to the prior release can leave the starter packs enabled (the default); operators who want to author their own can disable Generic Egress Starter via Configuration → Policies & Rules (subject to the typed-phrase + reason guard) and the header warning ribbon will surface that decision until they re-enable.

### Verified

- `npx tsc --noEmit` exit 0 after each phase.
- `scripts/shield-triage.ts` — Release-grade 26/26 passing, Coverage Lab 0/1 (T04 base64-hidden-payload is the documented coverage gap; properly bucketed as known-gap, not a release-grade regression).
- `scripts/openclaw-routing-test.ts` — 10-scenario sandbox cycle all pass: idempotent wire, idempotent revert, conflict guards, force-wire, SHA-mismatch preservation of `set-if-missing` paths, parent-object cleanup, coexistence with other providers.
- staging host (Linux/systemd-user) supervisor reach verified: `sudo -u <operator-user> env XDG_RUNTIME_DIR=/run/user/1000 systemctl --user is-active openclaw-gateway` returned `active`. `Linger=yes` confirmed.
- test host (macOS/launchd) supervisor verified: `launchctl list | grep openclaw` returned `2421 0 ai.openclaw.gateway`.
- the reviewer's `implementation-agent-fix-validation-2026-04-29.md` confirmed M-01 #2/#3/#4 fixes; `implementation-agent-alert-summary-0485888-validation.md` confirmed M-01 #1 fix-for-real.
- **Policy Framework v1**: `npx tsc --noEmit` clean across the full tree; `npx next build` clean (all 5 new policy framework routes — `/api/policies`, `/api/policies/[id]`, `/api/policies/[id]/rules`, `/api/policies/[id]/rules/[ruleId]`, `/api/policies/[id]/test` — compiled and surface in the production build manifest); `scripts/verify-policy-framework.ts` 10/10 passing; `scripts/policy-evaluator-invariants.ts` 15/15 passing; `scripts/shield-triage.ts` Release-grade 26/26 passing post-cutover (Coverage Lab still 0/1, same documented gap as before — the framework cutover did not regress any release-grade probe). Five internal reviewer paranoid-review rounds + multiple internal code-review passes with all findings closed before the final commit.

## [0.9.2-alpha] - 2026-04-24

Magic Link auth backend promoted from UI placeholder to live provider. Closes the CX-D1…CX-D6 Codex-deferred auth enforcement audit — 5 of 6 findings were verified already closed silently during v0.9.0 work; only `/api/permissiveness` needed a real fix. Final adversarial-review finding #A5 (`/api/system/migrate` path echo) closed — all pre-OSS security hardening now complete.

### Added
- `magic_link_tokens` table (sha256-hashed 32-byte base64url tokens, `issued_at`, `expires_at`, `consumed_at`, `ip`, `user_agent`)
- `src/lib/services/auth/providers/magic-link.ts` — provider module: `MAGIC_LINK_SETTINGS`, `isEnabled`, `isConfigured`, `getEffectiveConfig`, `generateAndStoreToken`, `invalidateOutstandingTokens`, `consumeToken`
- `POST /api/auth/magic-link/begin` — rate-limited 3/min/IP; always returns 200 with the same "check your inbox" copy (no enumeration); emails a link via `sendMail()` when all gates are satisfied
- `GET /api/auth/magic-link/complete?token=...` — atomic consume via `UPDATE ... WHERE consumed_at IS NULL AND expires_at > datetime('now')`; on success issues a session cookie + redirects `/`; on any failure redirects `/login?error=magic_link_invalid` (single generic code)
- `magicLinkAvailable: boolean` in `/api/auth/status` anonymous response — drives login-page button visibility
- `magicLink.enabled` toggle in Authentication Methods admin card (`/api/config/auth-methods`) — persists to `config_defaults.auth_magic_link_enabled`
- LIVE/DISABLED badge + operator-facing copy in Auth & Devices card Magic Link section
- Login page: inline email-form expansion when Magic Link is available; constant "check your inbox" response
- `MAGIC_LINK_EXPIRY_MINUTES` env override (default 15, clamped 1-60)
- `verify-auth-units.ts` — +93 assertions (86 → 152): magic-link provider lifecycle (generate / consume / replay / expired / invalidate), route-shape static checks (begin rate-limits + no-enumeration + effective-config gate; complete consume + session + single error code), role × permission matrix for all 5 roles (grant + deny cells), `requirePermission` end-to-end path with real NextResponse 403 returns, `/api/permissiveness` CX-D1 guard wiring regression

### Changed
- `AuthProviderName` CSV parser in `src/lib/services/auth/index.ts` — `magic_link` promoted from reserved to `ENABLED_PROVIDERS`
- `/api/config/auth-methods` GET returns real Magic Link effective state (`enabled`, `configured`, `available`, `note`) instead of a hardcoded stub
- `/api/system/migrate` response shape: `{ bundle, location }` instead of `{ bundle, path: <absolute> }` (adversarial review finding #A5)
- Dashboard header version chip: `v0.9.1` → `v0.9.2`

### Security
- **CX-D1** — `/api/permissiveness` now guarded with `requireSession` + `requirePermission('config:read')`. Route comment had claimed "reuses existing RBAC middleware" but the handler never called it — exposed installed agent inventory, gateway topology, and dangerous-combo findings to anonymous callers. Route audit confirmed CX-D2 (`/api/chat`), CX-D3 (voice/avatar), CX-D4 (provider SSRF), CX-D5 (install/restart), CX-D6 (workspace) are all already triple-gated.
- **#A5 LOW** — `/api/system/migrate` no longer echoes the absolute filesystem path of the migration tarball. Chains with any hypothetical LFI primitive would have upgraded enumeration → direct secret theft (tarball contains `sentinel.db` with password hashes, session tokens, API keys, plus `.env`).

### Migration
- `magic_link_tokens` schema migrates automatically on first launch. Idempotent.
- No operator-visible breaking changes. Magic Link is OFF by default; admins opt in via Authentication Methods (requires a configured mail provider).

### Verified
- `npx tsc --noEmit` clean
- `npx tsx scripts/verify-auth-units.ts` — **152 / 152 PASS** (was 56 at v0.9.1)
- `npx tsx scripts/verify-emailit-units.ts` — 18 / 18 PASS

## [0.9.1-alpha] - 2026-04-24

Same-day security hardening pass after v0.9.0 ship. Closed every HIGH / MED / LOW finding from the 2026-04-24 adversarial review. Added a new `health:read` API-key scope so enterprise monitoring probes can reach the now-authenticated detailed health endpoint without session cookies.

### Added
- `/api/health/detailed` — authenticated detailed health endpoint with tri-gate auth (API key with `health:read` scope → session cookie → localhost fallback)
- `health:read` scope in the API-key catalog (backend validator + Configuration panel UI)
- `src/lib/services/health-tick.ts` — shared side-effect tick + detailed state reader, called by both `/api/health` and `/api/health/detailed`

### Changed
- `/api/health` response shape is now minimal (`status`, `name`, `version`, `uptime`, `timestamp` only). Operational detail moved to `/api/health/detailed`.
- `/api/auth/github/status` anonymous response shape shrunk to `{ available: boolean }`; authenticated callers still get `{ available, enabled, configured, linked }`.
- Login page `?error=...` decoder collapsed to a single generic "Sign-in failed" message. Specific failure codes remain in the server-side audit log.

### Security
- **#1 HIGH** — `/api/config/auth-methods` now falls back to `requireLocalhost` when RBAC is off
- **#2 MED-HIGH** — Passkey ceremonies now require user verification (`userVerification: "required"` + `requireUserVerification: true`). Rejects proof-of-possession-only signatures from stolen-but-unlocked hardware keys.
- **#3 MED** — `/api/config/mail` PUT now validates every field (CRLF reject, length caps, provider whitelist, port range, TLS coerce)
- **#4 MED** — `/api/auth/github/callback` no longer stores `"unknown"` as `session.ip_address` when IP unavailable
- **#A1 LOW** — Passkey `credential_id` partial index upgraded from plain to UNIQUE (defense-in-depth; WebAuthn's 128+ bits of randomness guarantees uniqueness cryptographically, but the index now enforces it at the DB level)
- **#A2 LOW** — `/api/auth/github/status` split anonymous-minimal vs authenticated-detailed
- **#A3 LOW** — Login page error decoder collapsed to single generic message
- **#A4 LOW** — `/api/health` split into public-minimal + authenticated `/api/health/detailed`

### Migration
- Schema migration runs automatically — drops the non-unique passkey `credential_id` partial index and re-creates it as UNIQUE. Idempotent.
- Operators with passkeys enrolled under v0.9.0 without user verification must re-enroll. v0.9.0 live passkey testing had not yet occurred at the time of this release, so in practice this affects development enrollments only.
- External monitoring tools that previously read `breakGlass` / `openclaw` / `sessionWatcher` / `hermesWatcher` fields from `/api/health` must either (a) issue an API key with `health:read` and hit `/api/health/detailed`, (b) probe from localhost, or (c) continue using the minimal public response.

### Verified
- `npx tsc --noEmit` clean
- `npx tsx scripts/verify-auth-units.ts` — 56 / 56 PASS (was 49)
- `npx tsx scripts/verify-emailit-units.ts` — 18 / 18 PASS

## [0.9.0-alpha] - 2026-04-23

Multi-auth providers. Operators can now sign in with WebAuthn passkeys or a linked GitHub account in addition to the existing local password (which remains the break-glass identifier). Magic-link sign-in is reserved as a "Coming Soon" UI option for the next release. New per-account **Auth & Devices** card lets operators self-manage their passkeys and GitHub link.

### Added

- **Passkeys (WebAuthn) — full ceremony.** `@simplewebauthn/server@13.3.0` and `@simplewebauthn/browser@13.3.0` (exact-pinned per dependency policy). Resident-key / discoverable-credential authentication flow — no username field on the login screen, the browser surfaces enrolled passkeys for the RP and the user picks. Counter regression check enforced (cloned-authenticator defense).
- **GitHub OAuth — sign-in and link.** Standard OAuth 2.0 authorization code flow with state-cookie CSRF defense. **No auto-create**: the GitHub identity must be pre-linked to a ClawNex operator before that GitHub account can sign in. Admins can pre-provision via the new **Link GitHub** button in the Auth & Devices card.
- **Magic Link UI placeholder.** Login page shows a disabled "Email me a magic link" button with a SOON badge; settings card mirrors. Implementation deferred to a later release once SMTP plumbing settles.
- **Auth & Devices settings card.** Lists enrolled passkeys with per-credential label, created-at, last-used-at, and a Revoke button. Inline enrollment from a free-text label field. GitHub section shows linked @username + Unlink, or a Link button when not linked, or a config-required hint when env vars are absent.
- **operators.auth_providers** column (CSV: `local`, `passkey`, `github`, `magic_link`) and **operator_credentials** table with type discriminator (`passkey` rows store credential_id / public_key / counter / transports; `github_link` rows store github_user_id / github_username). Indexed on operator, credential_id, and (unique) github_user_id.
- **Six new auth API routes**:
  - `POST /api/auth/passkey/register/begin` and `/complete` — enrollment for the signed-in operator.
  - `POST /api/auth/passkey/authenticate/begin` and `/complete` — anonymous sign-in, IP rate-limited like `/login`.
  - `GET /api/auth/passkeys` and `DELETE /api/auth/passkeys/:id` — list/revoke for the Auth & Devices card.
- **Five new GitHub OAuth routes**:
  - `GET /api/auth/github/start` (anonymous → redirect to GitHub).
  - `GET /api/auth/github/callback` (handles both sign-in and link flows via a `purpose` cookie).
  - `GET /api/auth/github/link` (auth required → redirect to GitHub in link mode).
  - `GET /api/auth/github/status` (configured? linked-for-current-user?).
  - `DELETE /api/auth/github/unlink`.
- **Audit events** — `passkey_enrolled`, `passkey_revoked`, `github_linked`, `github_unlinked`, `passkey_login_failed`, `github_login_failed`, plus `operator_login` carrying provider context for SOC 2 CC7.x evidence.
- **Six new env vars** (all optional, sensible localhost defaults): `AUTH_RP_ID`, `AUTH_RP_NAME`, `AUTH_EXPECTED_ORIGIN`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_CALLBACK_URL`.

### Changed

- **OperatorRecord** now includes `auth_providers` (CSV string). Defaults to `"local"` for accounts created before this release.

### Migration

- Schema migration runs automatically on first launch (idempotent — `CREATE TABLE IF NOT EXISTS` + tolerated `ALTER TABLE` errors). No operator action required for the local password flow to keep working.
- Passkey registration requires an HTTPS origin OR `localhost` — the WebAuthn spec rejects mixed-content. Set `AUTH_RP_ID` and `AUTH_EXPECTED_ORIGIN` for production deployments behind a custom domain.
- GitHub OAuth is OFF unless `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` are set; the login button auto-hides when the `/api/auth/github/status` endpoint reports `configured: false`.

## [0.8.4-alpha] - 2026-04-23

Filtered Navigation completion + alert workflow expansion. The 4 high/medium-priority panels in the Phase 4 sweep all picked up PanelFilters + URL state. The Range dimension was added to the widget so Traffic Monitor's `scoreMin` joined URL state alongside its other 4 dimensions. operator-requested Investigating button shipped between ACK and Resolve. Plus a new go-live checklist tracking the 4-phase trajectory to public OSS launch.

### Added

- **Investigating button** on alert rows (between ACK and Resolve). Distinct from acknowledged: ACK is "I'm aware, I'll handle it" (handshake); Investigate is "I'm actively diagnosing root cause" (work-in-flight signal). New `markInvestigating()` in alert-manager + `/api/alerts/:id` PATCH action `investigate` + audit-log entry `alert_investigating`. Hover titles explain the semantic difference per button.
- **Range dimension on PanelFilters** — `config.min` accepts `{ label, options: [{value, label}] }` for numeric-threshold filters. Single-select `<select>` styled with warn accent when active. Closes the v0.8.3 known issue where Traffic Monitor's `scoreMin` couldn't fit the multi-select widget shape.
- **`min` and `max` reserved scalar URL keys** — stored as strings; consumers `parseInt` when applying. `max` reserved for future range dimensions on Models & Cost / etc.
- **Agents & Sessions panel** picks up PanelFilters + URL state. Multi-select for status / model / role + freeform search across name + codename + tools + role. Deep-link by id or name pins to a single agent card.
- **Tools & Access panel** picks up PanelFilters + URL state on the Tool Inventory table. Multi-select for risk / type / status + freeform search across name + agentNames.
- **Shield Tests panel** picks up PanelFilters + URL state on the test library. Multi-select for expected verdict (BLOCK / REVIEW / ALLOW) + freeform search across id + name + payload. Operator can scope a Run All to specific categories.
- **Models & Cost panel** picks up PanelFilters + URL state on the Configured Models table. Multi-select for provider name + provider type + freeform search across model_id + name.
- **`docs/go-live-checklist.md`** — living tracker for the "tedious last 10%" between current development state and public OSS launch on `github.com/ProBizSystems/ClawNexAI`. Four phases: outstanding panel work · adjacent products + deployment testing · documentation/training/help-tour sync · marketing comms + 3-website alignment + push + launch. Includes build-freeze policy + open-questions section for the operator to resolve.

### Changed

- **Traffic Monitor `scoreMin`** migrated from local React state → URL state via the new Range dimension. All 5 traffic dimensions now in a single PanelFilters row (consistent rhythm; no special-case `<select>` beside).
- **Resolve button** now eligible from `investigating` status too (was only `open`/`acknowledged` before).

### Out-of-scope (deferred — see go-live checklist Phase 1)

- **Infrastructure** services list — small enough that filters add little value; defer.
- **Workspace** file browser — different domain (file paths, not events); needs its own filter shape.
- **Token & Cost Intel** — stat panel, mostly aggregates not list-shaped.
- **Correlations findings** — already partially filtered via Top Contributing Rules; assess if a separate filter row adds value.
- **Per-Agent Tool Permissions** + **Denied Tools** tables in Tools & Access — different read patterns, straightforward follow-up.
- **Live API models grouped-by-provider** in Models & Cost — each provider already has its own CollapsibleCard so the grouping IS the filter.

### Security

- No new attack surface; UI / state-management release. URL hash is client-side only.
- `markInvestigating` writes to `audit_log` so the workflow transition is captured for SOC 2 / ISO 27001 evidence.

### Migration

- None required for end users. UI / state-management release.
- For developers consuming `/api/alerts/:id`: PATCH action enum widened from `acknowledge | resolve` to `acknowledge | investigate | resolve`. Existing values keep working.

### Verified On

- test host (the operator's Mac) on 2026-04-23. `tsc --noEmit` clean. Live verification of new filter UIs on Trust Audit / Alerts / Audit & Evidence / Risk Acceptances / Traffic Monitor / Agents & Sessions / Tools & Access / Shield Tests / Models & Cost — that's 9 panels now using the shared widget.

## [0.8.3-alpha] - 2026-04-23

Filtered Navigation expansion. Three more panels picked up the v0.8.2 PanelFilters + URL state pattern (Audit & Evidence, Risk Acceptances, Traffic Monitor), plus a operator-reported deep-link bug fix on Alerts → Correlations. Phase 4 sweep of the remaining 8 panels deferred to v0.8.4 (or as-needed).

### Added

- **Audit & Evidence panel** picks up PanelFilters + URL state. Multi-select for result bucket (status URL key), actor (actor URL key), audit action (source URL key) + freeform search (q URL key). Server-side filter still passes the first selected value to /api/audit; additional multi-select narrowing applied client-side. Range + page-size kept separate (view-only state).
- **Risk Acceptances panel** picks up PanelFilters + URL state. Multi-select for source_panel (scope URL key) + freeform search (q URL key). Operator can now filter to "Trust Audit + Blast Radius combos" simultaneously instead of one panel at a time. Refresh button kept separate (fetch-time action).
- **Traffic Monitor panel** picks up PanelFilters + URL state for 4 of its 5 dimensions: source / model / provider / verdict. URL key mapping documented inline (re-uses scope/actor/status keys for model/provider/verdict semantics — each panel reads its own context). Multi-select widening for all four. scoreMin (numeric range) stays a separate hand-rolled `<select>` beside PanelFilters because the multi-select dropdown shape doesn't fit a numeric threshold; future enhancement adds a Range dimension to PanelFilters.

### Fixed

- **Alerts → Correlations deep-link** now filters to the matching rule's events (operator-reported regression — same class as the v0.8.2 Timeline → Alerts fix). Backlink button passes `id: corrId` so the URL becomes `#tab=correlations&id=<rule_name>&highlight=<rule_name>`. CorrelationsPanel reads URL state and applies the deep-link filter BEFORE pagination so matching events appear on page 1 (not in the pagination tail). Match logic accepts EITHER the correlation_rule (rule name, what Alerts backlink passes) OR the correlation row id (so future event-id deep-links also work without a separate URL key). DEEP-LINK banner above the list shows the filtered state with a one-click Clear.

### Changed

- **Audit & Evidence empty-state** distinguishes "no data" from "filters narrowed everything out."
- **Risk Acceptances source_panel filter** widened to multi-select (was single-select).
- **Traffic Monitor source/model/provider/verdict filters** all widened to multi-select (were single-select).
- **`PanelFilters` widget** dimension list explicit ordering: search → severity → source → status → scope → actor → confidence → result-counter → clear-all. Stable rhythm across all 5 panels that now use it.

### Deferred to v0.8.4 (Phase 4 sweep)

Eight panels remain on the hand-rolled / no-filter pattern. Priority-ordered by likely operator use:
1. **Agents & Sessions** — agent list; could filter by name / role / model / status (high value)
2. **Tools & Access** — tool inventory per agent; could filter by tool / risk-level (high value)
3. **Shield Tests** — 27 test payloads; could filter by category (medium)
4. **Models & Cost** — model list; could filter by provider / cost-tier (medium)
5. **Infrastructure** — services list; small, may not need filters (low)
6. **Workspace** — file browser; different domain, may need its own filter shape (low)
7. **Token & Cost Intel** — stats panel; mostly aggregates, not list-shaped (low)
8. **Correlations findings** — already partially filtered via Top Contributing Rules; may not need separate filter row (low)

Plus: **Range dimension on PanelFilters** (numeric min/max) needed for Traffic Monitor scoreMin migration to URL state.

### Security

- No new attack surface; UI / state-management release. URL hash is client-side only — no server roundtrip on filter change.
- Filter values URL-encoded; values containing `&` or `=` decode safely.

### Migration

- None required. UI / state-management release. URL bookmarks now preserve filter state for the 3 newly-converted panels.

### Verified On

- test host (the operator's Mac) on 2026-04-23. `tsc --noEmit` clean. Live verified via chrome-devtools MCP — Alerts → Correlations deep-link now correctly filters to the matching rule (5 of 25 correlations shown, banner visible). Audit & Evidence + Risk Acceptances + Traffic Monitor all render via shared PanelFilters widget.

## [0.8.2-alpha] - 2026-04-23

Filtered Navigation release. operator-stumbled-on bug: clicking an alert backlink in the Instance Detail timeline used to dump the operator in the unfiltered alerts list. Now the destination filters to that exact alert and pulses it briefly. Foundation built for cross-panel deep-linking + standardized filter UI; Trust Audit + Alerts ship as proof. Audit & Evidence + Risk Acceptances + Traffic Monitor refactors deferred to v0.8.3 per spec §5. Spec at `docs/superpowers/specs/2026-04-23-filtered-navigation-design.md`.

### Added

- **URL-as-state foundation** — `src/components/dashboard/url-state.ts`. All view state (active tab + filter values + deep-link id + highlight) lives in `window.location.hash` so refresh / back-button / share-via-paste all work. `useHashState()` hook subscribes to `hashchange`. `pushHashState()` for tab nav (history entry); `writeHashState()` for filter keystrokes (replaceState — avoids history pollution). Reserved keys: `tab`, `q`, `severity`, `source`, `status`, `scope`, `actor`, `confidence`, `id`, `highlight`. New dimensions belong in the `UrlState` interface.
- **Standard PanelFilters widget** — `src/components/dashboard/PanelFilters.tsx`. Config-driven row of search input + multi-select dropdowns + clear-all button + result counter. Each panel passes which dimensions it cares about; the rest are not rendered. Multi-select dropdowns are checkbox lists with outside-click close + accent colors per dimension. Stateless — values from URL hash, onChange writes back. Optional deep-link badge ("deep-link: id=abc…") makes id-based filters visible.
- **`useHighlightPulse` hook** — `src/components/dashboard/useHighlightPulse.ts`. When URL carries `highlight` (or `id` as fallback), the matching row scrolls smoothly into view + gets a 2s × 2 pulse animation. CSS keyframe injected into `<head>` once on first hook usage.
- **Trust Audit filter UI** (NEW — panel previously had no filters): severity (5 levels), confidence (5 EvidenceLevels), freeform search across title/whyItMatters/recommendedFix/ruleId/agentId. URL state powers filtering.
- **Confidence URL key** added to reserved CSV keys alongside severity/source/status/scope/actor — semantic naming for evidence-level filters in Trust Audit + Blast Radius.
- **`navigate()` opts shape** — dashboard's `navigate(tab, opts)` now accepts `{ focus?, filter?, id?, highlight? }` for cross-panel deep-linking. Back-compat string-only path (Welcome Wizard focus-string callers) preserved. When called with opts, writes URL state for the destination + clears unrelated filter params (sidebar nav semantics).

### Fixed

- **Timeline → Alerts deep-link no longer dumps operator in unfiltered list** (operator-reported). Each timeline event now carries the source row's id. Backlink calls `navigate(tab, { id, highlight: id })` so the destination URL becomes `#tab=alertsIncidents&id=<alertId>&highlight=<alertId>`. Alerts panel reads URL `id` and pins the list to that single row + pulses the row on arrival. DEEP-LINK banner above the list shows the filtered state with a one-click Clear shortcut. Audit row backlinks have the same upgrade — Timeline → Audit & Evidence will work the same way once Audit & Evidence picks up URL filtering in v0.8.3.

### Changed

- **Sidebar tab click clears filter params** — clicking a sidebar nav item now resets filter URL params (deliberate-reset semantics). Cross-panel deep-links via the navigate() opts pre-populate filters explicitly. Browser back-button preserves prior filter view.
- **Alerts panel** refactored to use PanelFilters + URL state. Hand-rolled severity/source/status `<select>` dropdowns replaced with the shared widget. Local React state for filter values removed. Pagination + row-expansion stay local (per-render ephemeral). include-suppressed checkbox stays separate (fetch-time toggle, not a client-side filter dimension). Empty-state message distinguishes "no data" from "filters narrowed everything out."
- **Trust Audit panel** filter integration uses an IIFE wrapping `findings.map` so the active findings array can be partitioned client-side without a re-fetch.

### Security

- No new attack surface; UI / state-management release.
- URL hash is client-side only — no server roundtrip on filter change. Filter values are URL-encoded; values containing `&` or `=` decode safely.
- `id` deep-link does not bypass server-side authorization: the panel still fetches the full list via the existing authenticated API and filters client-side. An operator without read permission for a specific row never sees it regardless of URL.

### Migration

- None required for end users. UI / state-management release. URL bookmarks for the dashboard now preserve filter state — old bookmarks (no hash) continue to work, just open the default Fleet Command view.
- For developers: panels that have hand-rolled filter UI continue to work (no breaking change to the existing pattern). To adopt PanelFilters, follow the Trust Audit + Alerts pattern: import `useHashState` + `PanelFilters`, derive filter values from URL state instead of local React state, render `<PanelFilters config={...} values={urlState} onChange={updateUrl} />` above the data list.

### Out-of-scope (deferred to v0.8.3 per spec §5)

- **Audit & Evidence** — refactor existing 4 hand-rolled filters (action / actor / time / search) to PanelFilters + URL state.
- **Risk Acceptances** — refactor existing panel + search to PanelFilters + URL state.
- **Traffic Monitor** — refactor 5+ filters to PanelFilters + URL state. Note: scoreMin (numeric range) doesn't fit the multi-select widget shape; will need either a Range filter dimension added to PanelFilters or kept hand-rolled as a special case.
- **Phase 4 sweep of remaining 8 panels** (Agents & Sessions, Tools & Access, Models & Cost, Infrastructure, Correlations findings, Shield Tests, Workspace, Token & Cost Intel) — incremental v0.8.x releases.
- **Saved-filter presets** ("My open critical alerts" as one-click).
- **Server-side filter enforcement** — today filters are client-side; server returns full list.

### Verified On

- test host (the operator's Mac) on 2026-04-23. `tsc --noEmit` clean. Live verified via chrome-devtools MCP:
  - Timeline → Alerts deep-link: clicking an alert backlink in Instance Detail timeline → URL becomes `#tab=alertsIncidents&id=<alertId>&highlight=<alertId>` → Alerts page title set, DEEP-LINK banner visible, exactly 1 alert card rendered (filtered), row pulses briefly on arrival.
  - Trust Audit filters: search input + Severity ▾ + Confidence ▾ render above findings list; counter shows "18 results"; filter selections write to URL; clear-all button appears when any filter is active.
  - Alerts filters: search input + Severity ▾ + Source ▾ + Status ▾ render via shared widget; result counter shows current/total; include-suppressed checkbox preserved below.

## [0.8.1-alpha] - 2026-04-23

Post-v0.8.0 polish — Exposure Matrix wrap fix + sidebar collapse/rail-mode/expand-all/collapse-all. UI-only release; no API, schema, or dependency changes.

### Added

- **Per-group sidebar collapse** — every group header (`COMMAND`, `SECURITY`, `DEFENSE`, `ACTIVITY`, `GOVERNANCE`, `PERFORMANCE`, `OPERATIONS`, `COMPLIANCE`, `SYSTEM`, `ABOUT`) is now clickable. ▶ caret on the left rotates 90° when open. Collapsed state shows hidden item count on the right (e.g. `▶ COMPLIANCE 4`). Persists per-group via `localStorage.clawnex_collapsed_groups` (JSON array). Smart auto-expand: navigating to a panel inside a collapsed group auto-opens that group on the navigation event (NOT on manual toggle — manual collapse of the active group is allowed and sticks).
- **Sidebar minimize-to-rail** — new `‹ minimize` toggle button at the bottom of the sidebar. Click → sidebar shrinks 170px → 48px (180ms eased transition). In rail mode: icons-only, hover any icon for the full panel name as a native tooltip; badges (alerts count, shield blocks) render as small absolute-positioned bubbles in the corner of each icon; group headers shrink to thin separators (group label + item count visible on hover). Click `›` to expand back. Persists via `localStorage.clawnex_sidebar_minimized` ("0" / "1").
- **`Expand all` / `Collapse all` controls** — two compact text buttons in the sidebar footer above the minimize toggle, only visible in full-width mode. `Collapse all` keeps the active group's panel visible (closes every group except the one containing the active tab) so operators don't lose sight of "you are here" when collapsing for focus. Each button dims when its action is a no-op (already all-open / all-closed-except-active).

### Fixed

- **Exposure Matrix `BLAST RADIUS` column wrap** — the badge inside each row (`MINIMAL · 0`, `LOW · —`, etc.) wrapped at the `·` separator in narrow columns, splitting the band label and numeric across two visual rows. Added `whiteSpace: "nowrap"` + `display: "inline-block"` to the badge span so the content stays on one line regardless of column width.
- **COMMAND group could not be collapsed** — clicking the COMMAND header to collapse appeared to do nothing because the auto-expand-on-active useEffect depended on both `activeTab` AND `collapsedGroups`. Manual collapse triggered the effect, which immediately re-expanded the group containing Fleet Command (the default active tab). Now the effect only depends on `activeTab` so manual collapse of the active group is respected; auto-expand still kicks in on actual navigation events.

### Security

- No new attack surface; UI-only release.
- Per-group / minimize / expand-collapse-all preferences live in `localStorage` only — no server roundtrip, no audit-log entry needed.

### Migration

- None. UI-only release. Operators on v0.8.0-alpha can upgrade in place via `npm run build` + service restart. localStorage keys are namespaced (`clawnex_*`) and absent by default — first-time operators see the v0.8.0 layout (all groups expanded, sidebar full-width).

### Verified On

- test host (the operator's Mac) on 2026-04-23. `tsc --noEmit` clean. Live verified via `chrome-devtools` MCP:
  - Exposure Matrix BLAST RADIUS column: every badge measures 21px tall (single line) with width 62-89px depending on label.
  - Per-group collapse: COMMAND collapse correctly hides 4 items + persists; previously broken active-group collapse now sticks.
  - Rail mode: nav width = 48px in DOM, every item button carries a `title` attribute for hover.
  - Expand all / Collapse all: Collapse all from default state collapses 9 groups + leaves COMMAND expanded with Fleet Command visible; localStorage carries 9 group names.

## [0.8.0-alpha] - 2026-04-23

Risk Acceptance release. Closes the gap operator flagged: not every operator wants every finding to count against the active risk aggregate forever. Operators now have an explicit, time-bound, audit-trailed primitive to suppress findings — `Accept Risk` on Trust Audit + Blast Radius, `Snooze` on Correlations, `Suppress similar` on Alerts. Acceptances expire (90 days default; 30 for Correlations) so risks get re-reviewed periodically. Suppressed findings stay tracked as gross findings — only the active aggregate excludes them. SOC 2 / ISO 27001 evidence trail in audit_log on every accept/revoke/expire/evidence-change. New management panel under GOVERNANCE for cross-panel inventory + revoke. Spec at `docs/superpowers/specs/2026-04-23-risk-acceptance-design.md`.

### Added

- **Risk Acceptance core library** at `src/lib/services/risk-acceptance/` — `types.ts` + `signatures.ts` (deterministic SHA-256 across 3 scopes) + `store.ts` (CRUD against the new SQLite table) + `index.ts` (orchestrator: accept / revoke / applySuppressions / autoExpire / autoRevokeOnEvidenceChange). 56-assertion unit harness (`scripts/verify-risk-acceptance-units.ts`) covers signatures, scope precedence, accept validation, revoke idempotence, autoExpire, evidence-delta auto-revoke, and listAcceptances filters.
- **Three-scope acceptance model** — operators pick per finding:
  - `finding` (default, narrowest) — this exact finding (rule + agent + same evidence). Auto-revokes if evidence shifts.
  - `agent_rule` — this rule for this agent regardless of evidence (e.g. "hermes-discord may have any browser-related risk").
  - `rule_global` — this rule for any agent (use sparingly).
- **`risk_acceptances` SQLite table** — appended to `MIGRATIONS` array; existing deployments auto-migrate on next boot. CHECK constraints enforce `scope_level` and `source_panel` enums. Two indexes for hot lookups (signature, expiry).
- **HTTP API** (`/api/risk-acceptances`) — `GET` (list with status / source_panel / expiring_within_days filters; requires `shield:read`), `POST` (create with full body validation; requires `risk:accept`), `DELETE /:id` (revoke with required reason; requires `risk:accept`). Localhost-only fallback when RBAC is off. Smoke test at `scripts/verify-risk-acceptance.sh` (5/5 assertions).
- **New RBAC permission `risk:accept`** — granted to `admin` + `security_manager`. Operators below those roles can READ acceptances via `shield:read` but cannot create or revoke them.
- **Trust Audit engine integration** — `runTrustAudit()` now calls `autoExpire()` first, then `autoRevokeOnEvidenceChange('trust_audit', findings)`, then partitions findings into active + suppressed. `AuditReport` gains `findingCountsActive`, `findingCountsGross` (alias for the existing `findingCounts`), `totalActiveFindings`, `totalSuppressedFindings`, `suppressedFindings: Array<{finding, acceptance}>`. `summary.overallSeverity` derives from active findings.
- **Permissiveness orchestrator integration** — `scan()` calls autoExpire + autoRevokeOnEvidenceChange for both `blast_radius_combo` and `blast_radius_lint`, then partitions `dangerousCombos` and `postureLints` into active + suppressed. `PermissivenessReport` gains `dangerousCombosSuppressed` and `postureLintsSuppressed` arrays. `dangerousCombos` and `postureLints` fields carry ACTIVE only (back-compat-friendly default for v0.7.x clients — they see fewer findings, which is the correct headline behavior).
- **Correlations evaluate integration** — `/api/correlations/evaluate` POST now applies suppressions to triggered rules. `threat_score` field carries ACTIVE (back-compat-friendly); new fields `threat_score_gross`, `threat_score_active`, `breakdown_gross`, `raw_score_gross`, `triggered_count_gross`, `suppressed_count`, `suppressedRules` provide the full split. metric_snapshots writes the active score; broadcast uses active. The persisted correlation_events table still records every triggered rule (gross — detection-reality semantics).
- **Alerts ingest integration** — `createAlert()` calls `checkAcceptance()` before INSERT; on match, alert is inserted with `status='suppressed'` directly + metadata gains `suppressed_by_acceptance_id` for audit join. Suppressed alerts are NOT broadcast. `listAlerts()` excludes `status='suppressed'` by default; opt back in via the new `?include_suppressed=true` query param.
- **Shared UI widget** at `src/components/dashboard/risk-acceptance/AcceptRiskWidget.tsx` — three exports used by all four panels:
  - `AcceptRiskButton` — small button per finding card. Click opens an inline form (no modal — matches panel idiom): reason (required, ≥3 chars) · scope radio (default narrowest: 'finding') · expires-at date input (default per-panel 90d / 30d for correlations). Per-panel label override: "Snooze" for correlations, "Suppress similar" for alerts, "Accept risk" elsewhere.
  - `SuppressedFindingCard` — greyed-out card for the Accepted Risks section. Shows accepted-by/at, expiry (warns when ≤14d), reason, Revoke button (native `prompt()` for revoke reason).
  - `AcceptedRisksSection` — collapsible details/summary that wraps a list of cards. Renders nothing when count=0.
- **Trust Audit panel UI** — `Accept Risk` button on every active finding card (right of title, left of expand chevron). New `Accepted Risks (N)` collapsible at the bottom of the findings list. Header stat tiles split: "Findings · Active" + new "Accepted" tile when totalSuppressedFindings > 0. Tooltips cite gross/active/suppressed semantics.
- **Blast Radius FindingsGrid UI** — `Accept Risk` on each evaluable combo + each lint card. `Accepted Risks` collapsibles inside both halves. CollapsibleCard titles split when accepted > 0: "Dangerous-tool combinations (14 active · 4 accepted · 131 skipped)".
- **Correlations panel UI** — `Snooze` button on each row in Top Contributing Rules table (new column added). New `Snoozed Rules (N)` collapsible at the bottom of the Top Contributing Rules block. 30-day default expiry per panel.
- **Alerts panel UI** — `Suppress similar` button on each non-suppressed alert row (next to existing ACK / Resolve). New "include suppressed" checkbox in filter row toggles `?include_suppressed=true`. Status filter dropdown gains "Suppressed" option.
- **Risk Acceptance management panel** — new GOVERNANCE-group tab `riskAcceptance`. Three sections: (1) Expiring soon (banner-style, 14d window, only when count > 0), (2) Active acceptances (always visible — table with panel jump-link, scope badge, accepted_by, expires-with-days-remaining, Revoke), (3) Recently revoked / expired (last 30d, audit reference, only when count > 0). Filters: source_panel dropdown + freeform search matching rule_id and reason. 30s auto-poll + manual Refresh button.
- **Nav plumbing** — `TabId` union gains `riskAcceptance`. NAV inserted between `toolsAccess` and `policiesGuards` under GOVERNANCE, icon ✅. `PANEL_HELP.riskAcceptance` block. `PANEL_HELP.help.metrics` count 25 → 26. `HelpPanel.tsx` row + Badge `25 PANELS` → `26 PANELS`.
- **`scripts/verify-risk-acceptance.sh`** — endpoint smoke (5 assertions: GET base + POST + filter + expiring window + DELETE).
- **`scripts/verify-risk-acceptance-units.ts`** — 56 module-level assertions, hermetic via `DATABASE_PATH=:memory:`.
- **`scripts/verify-pre-oss.sh`** — baseline extended 12 → 13 routes (+ `/api/risk-acceptances`, 3000ms budget).

### Changed

- **Trust Audit `summary.findingCounts`** is now gross (every finding the rule engine produced). `summary.overallSeverity` derives from active findings (the headline). v0.7.x clients reading `findings` see only active — correct headline behavior under risk acceptance, which is what they want.
- **Permissiveness `dangerousCombos` / `postureLints`** fields carry ACTIVE only. Gross is reachable via `dangerousCombosSuppressed.length + dangerousCombos.length`.
- **Correlations `threat_score`** field carries ACTIVE (the headline). Gross is reachable via the new `threat_score_gross` field.
- **Alerts default behavior** excludes `status='suppressed'`. Opt-in via `?include_suppressed=true`. Existing explicit `?status=` filters still work.
- **Trust Audit rule count** updated 15 → 15 (no new rule; the Risk Acceptance integration is engine-side, not a new rule).
- **Panel count** badge in HelpPanel updated 25 → 26 (+ Risk Acceptance management panel).

### Security

- **CC7.1 / CC7.2 (Detection + monitoring)** — every accept / revoke / auto-expire / evidence-change writes to `audit_log` via `logEvent()` and is mirrored to stdout via the `[CLAWNEX_AUDIT]` channel. SOC 2 / ISO 27001 evidence trail.
- **CC6.6 (Restricting unauthorized changes)** — new `risk:accept` permission gates POST + DELETE endpoints. Operators below admin / security_manager cannot create or revoke acceptances.
- **A.5.27 (Information from incidents)** — acceptance reasons accumulate as a knowledge base of what the org considers acceptable. Queryable via `GET /api/risk-acceptances`.
- **A.8.34 (Protection of information)** — the `evidence_snapshot` field stores the evidence that was current at accept time. If subsequent scans reveal changed evidence on the same (rule, agent, surface) tuple, the acceptance auto-revokes with `revoke_reason='evidence-changed'` so the operator must re-accept with awareness of the change.
- **No false confidence** — headline counts ALWAYS show "X active · Y accepted" when Y > 0; never just "X". Every panel cites both numbers in tooltips. SP-5 metric-semantic discipline preserved.

### Migration

- **DB migration auto-runs** on next boot via `MIGRATIONS` array; no manual step needed. Existing data is untouched.
- **No new dependencies.** No package.json changes beyond version bump.
- **No breaking API changes.** All new fields on existing endpoints are additive. v0.7.x clients continue to work (they see active counts as the default headline, which is the correct behavior under risk acceptance).
- **Operators on v0.7.3-alpha** can upgrade in place via `npm run build` + service restart.

### Controls Evidence (SOC 2 / ISO 27001)

| Commit | SOC 2 TSC | ISO 27001:2022 Annex A | Risk |
|---|---|---|---|
| db migration + types + signatures | CC6.6, CC7.2 | A.8.31 | R-027 |
| store + orchestrator + audit-log | CC7.1, CC7.2 | A.5.27, A.8.16 | R-027 |
| RBAC permission + API endpoints | CC6.6 | A.5.18, A.8.34 | R-027 |
| 4-panel integrations | CC1.4, CC4.1 | A.5.34 | R-027 |
| RiskAcceptancePanel management UI | CC4.1, CC7.4 | A.5.27, A.5.34 | R-027 |

### Known Issues / Honest Disclosures

- **Blast Radius surface scoring uses gross combos for `effectiveBlastRadius`.** The per-edge `triggeredCombos` count comes from the original (pre-suppression) combo evaluation. Per-card and panel KPI splits show the active count correctly; only the surface-level numeric scores still reflect gross combos. Operator confusion risk: low (the suppressed cards are right there in the Accepted Risks section). Will tighten in v0.8.1 if it produces feedback.
- **Acceptance signature is deterministic by content.** If a rule's evidence-array shape changes between releases (e.g. an evidence string format is reformatted), existing finding-scope acceptances will auto-revoke with `revoke_reason='evidence-changed'` on the next scan. Operator sees a banner and must re-accept. This is correct behavior — the system can't safely assume the new evidence shape matches the old one — but it's worth knowing about during release upgrades.
- **Suppressed alerts don't backfill.** v1 only suppresses NEW alerts via the ingest path. Existing open alerts that match a newly-created acceptance are NOT auto-closed. Operator can do that manually via existing `alerts:manage` permission and the existing acknowledge/resolve UI.
- **No multi-operator approval workflow.** v1 is single-operator self-service. "Requires 2nd reviewer" approval is enterprise-feature territory.
- **No bulk accept / bulk revoke.** Operator handles one acceptance at a time. Future enhancement.
- **No per-instance scope.** When fleet support graduates past single-host (currently test host), acceptances may need per-instance scoping. v1 assumes single-instance.
- **Acceptance signature uses alert title as `rule_id` for alerts.** Alerts don't have a separate rule_id concept; the title is the closest natural-key. Two alerts with different titles for the same root cause won't share an acceptance — operator will need to accept each title.
- **`window.confirm()` and `window.prompt()` are browser-native.** Adequate for safety; not the prettiest UX. Same trade-off as v0.7.3 chip-removal confirms.
- **Existing trust-audit rule count remains 15.** The risk-acceptance integration is engine-side (not a new rule), so v0.7.3's "15 rules" continues to be accurate.

### Verified On

- test host (the operator's Mac, example-profile Hermes profile) on 2026-04-23. `tsc --noEmit` clean. `npx tsx scripts/verify-risk-acceptance-units.ts` 56/56 PASS. `bash scripts/verify-pre-oss.sh` 13/13 PASS. `bash scripts/verify-risk-acceptance.sh` 5/5 PASS. Live verified suppression flow: POST acceptance with `agent_rule` scope on Trust Audit's `comm-surface-permissiveness` rule for `hermes-discord@example-profile` correctly suppressed all 4 findings on that agent (22 gross → 18 active + 4 suppressed). `/api/health` reports `version: 0.8.0-alpha`.

## [0.7.3-alpha] - 2026-04-23

UX cosmetics + safety release. Direct user feedback batch: caret affordances on Correlations collapsibles, confirmation dialog before destructive litellm config mutations, Blast Radius sub-blocks made collapsible-and-collapsed-by-default, AI chat panel closed by default, ClawNex brand gradient unified across surfaces. No new dependencies; no schema changes; no API changes.

### Added
- **Disclosure carets on Correlations collapsibles** — `Why this score` and `Top Contributing Rules` now render with a leading `▶` chevron that rotates 90° on expand. Scoped CSS via inline `<style>` block on `.cn-disclosure[open] > summary .cn-caret`. Closes the affordance gap where operators didn't realize the blocks were expandable. (this commit)
- **Confirmation dialogs before litellm config mutations** — three destructive single-click actions on Configuration → Model Providers now go through `window.confirm()` before mutating `config.yaml`:
  - Removing a configured model from a provider (the `× chip` UX)
  - Removing an entire provider (the red `Remove` button)
  - Removing a model via the Test Result chip toggle (only the destructive branch; the additive `+ MODEL` branch stays one-click since it's reversible)
  Confirmation message names the provider + model and warns about active-session disruption. Matches the existing `confirm()` precedent at the Welcome Wizard reset (line 1113 of `ConfigurationPanel.tsx`).
- **`shared.Stat tooltip` prop** — already added in v0.7.2; documented here for completeness.

### Changed
- **Blast Radius sub-blocks now collapsible + closed by default** — `ExposureMatrix`, `RankedAgentsTable`, `RankedSurfacesTable`, and both halves of `FindingsGrid` (Dangerous-tool combinations / Posture-lint findings) switched from `Card` to `CollapsibleCard` with `defaultOpen={false}` and per-block `count` badge in the header. The KPI strip + provenance legend stay always-visible; the data-bearing tables collapse so operators see a clean overview first and expand only what they want to inspect. Direct user feedback.
- **AI chat panel closed by default** — `chatOpen` initial state flipped from `true` to `false` in `dashboard/index.tsx`. The `ai_panel_default` config setting still works as an opt-in: set `ai_panel_default="open"` in `config_defaults` to restore auto-open behavior. Older explicit `="closed"` values are honored as a no-op. Direct user feedback.
- **ClawNex brand gradient unified** — sidebar header ("ClawNex v0.7.3 ALPHA") now uses the same `linear-gradient(90deg, ${C.brand}, ${C.cyan})` + `WebkitBackgroundClip: text` pattern that the AboutPanel header has used since v0.6.x. Also applied to "ClawNex AI" in the chat panel header (gradient on `ClawNex` only, " AI" stays in the existing `C.tx` color). Three brand surfaces now match.

### Security
- **Reduced blast radius of accidental clicks** — three previously single-click destructive actions on Configuration now require explicit confirm. Mitigates "operator hovers, slips, kills production routing" failure mode. The chip × buttons remain visually identical (no learned UX rewrite); the change is exclusively in the click handler.
- No new attack surface; UI-only release; no scanner additions.

### Migration
- None required. UI-only release. `/api/config/models` and `/api/config/providers` API surfaces unchanged. Operators on v0.7.2 can upgrade in place via `npm run build` + restart.
- **Behavior change to flag for muscle memory:** clicking the `× MODEL` chip or red `Remove` button on a provider now opens a browser confirm dialog. The first click no longer immediately mutates `config.yaml`. If you're scripting against the dashboard via Selenium/Playwright (none known), accept the dialog.
- **Behavior change to flag for habit:** the AI chat panel no longer auto-opens. Click the `AI` button in the header to open it. To restore the v0.7.2 auto-open behavior, set `ai_panel_default=open` in `config_defaults` (Configuration → Defaults).

### Controls Evidence (SOC 2 / ISO 27001)
- **CC6.6 (Restricting unauthorized changes)** — confirmation dialogs on litellm config mutations reduce the probability of accidental change to a system-wide config file. Doesn't add an authorization boundary, but does add a deliberate-action gate.
- **CC1.4 (Communication of objectives)** — disclosure carets and brand gradient uniformity reduce visual ambiguity; operators now see at a glance which surface they're on and which sections expand.

### Verified On
- test host (the operator's Mac) on 2026-04-23. `tsc --noEmit` clean. Live verification via `chrome-devtools` MCP:
  - Correlations panel: 2 `.cn-disclosure` elements, 2 `.cn-caret` elements, both ▶ visible before expand and ▾ (rotated 90°) after.
  - Blast Radius panel: 5 collapsed-by-default blocks (Surface/Channel Exposure Matrix · Most Permissive Agents · Most Exposed Surfaces · Dangerous-tool combinations · Posture-lint findings), each with ▶ caret and `(count)` badge in the header. KPI strip + provenance legend remain always-visible.
  - Chat panel: closed by default; opens via header `AI` button as expected.
  - Sidebar brand: `ClawNex` renders with the canonical brand gradient (matches AboutPanel rendering).

## [0.7.2-alpha] - 2026-04-23

SP-4 polish release. Closes the last lane from the v0.7.0 blast-radius mandate by applying the v0.7.1 metric-semantic discipline to the Correlations panel. No new dependencies, no schema changes, no API changes. The `/api/correlations/evaluate` response shape was already returning everything needed (`weights_applied`, `correlation_multiplier`, `raw_score`, per-rule `score` and `description`); v0.7.2 surfaces it in the panel.

### Added
- **Correlations Top Contributing Rules block** (collapsible) — mirrors the Blast Radius panel's `drivers[]` pattern. Per-rule contribution table: rank, rule name (description in `title=`), severity badge, raw points, % of total, sources observed. Sorted descending by raw points; top 5 of N triggered rules shown. Closes the "operators see a score but can't tell which rules produced it" gap that the existing Why-this-score block only addressed at the per-source level. Renders nothing when no rules are triggered (a 0 score with zero contributors is self-explaining). (2270513)
- **Correlations top-line KPI tooltips** — `Score`, `Level`, `Triggered Rules`, `Findings` now carry inline `title` attributes per the reviewer's metric-semantic discipline: source/inclusion/window/confidence definitions accessible on hover. `cursor: help` on each card. Source/scope cited inline so operators don't need to consult external docs to interpret a KPI. (2270513)

### Changed
- **`shared.Stat`** extended with optional `tooltip?: string` prop (backward-compatible — callers without `tooltip` see no behavior change). When present, renders as native `title` attribute on the outer `<div>` and applies `cursor: help`. Used by Correlations now; Blast Radius can adopt later. (2270513)

### Security
- **Honest semantics on the Correlations panel.** The "Findings" KPI already rendered `—` instead of `0` when `/api/correlations` was unreachable; v0.7.2 documents this contract in the tooltip text so operators know the difference between "0 findings (verified)" and "— (data unreachable)" without reading the source.
- No new attack surface; UI-only changes; no scanner additions.

### Migration
- None required. UI-only release. `/api/correlations/evaluate` response shape unchanged. Operators on v0.7.1 can upgrade in place via `npm run build` + restart.

### Out-of-scope (deferred — not regressed)
- **Weighting re-eval UI** — the spec called for an interactive "preview score with adjusted weights" surface. That's a real new feature, not metric-semantic polish, and is left for a future release.

### Controls Evidence (SOC 2 / ISO 27001)
- **CC1.4 (Communication of objectives)** — Correlations KPI tooltips inline-document source/inclusion/window so operators can interpret each number without external documentation.
- **CC4.1 (Information from incidents)** — Top Contributing Rules block makes per-rule contributions to the threat score operator-discoverable, supporting incident triage and root-cause analysis.

### Verified On
- test host (the operator's Mac) on 2026-04-23. Trust Audit + Blast Radius + Correlations panels all render new data via `chrome-devtools` MCP smoke. `npx tsc --noEmit` clean. Live data: 5 of 5 triggered rules visible (Coordinated Attack Chain CRITICAL 30 raw pts, Data Exfiltration Attempt CRITICAL, Insider Threat Signal CRITICAL, Alert Cascade HIGH, Elevated Alert Volume MEDIUM).

## [0.7.1-alpha] - 2026-04-23

Follow-on hardening release after v0.7.0-alpha. Closes three lanes that were explicitly deferred on the operator's morning handoff: (1) Hermes gateway skill scan so dangerous-combo evaluation extends to Hermes comm-agents, (2) shell-KPI semantic cleanup resolving the reviewer's 5 live-verified v0.6.3 contradictions, (3) Trust Audit consumes the permissiveness scan so combos and posture lints land in the same finding-card surface as other trust-boundary risks. No breaking changes; no schema changes; no dep changes.

### Added
- **Hermes skill scan** — `scanners/hermes.ts` walks every `SKILL.md` under `<profile>/skills/` and extracts backtick-quoted identifiers matching a known tool needle (drawn from the dangerous-combos synonym set + the `toolRiskFor()` rubric in `permissiveness/index.ts`). The deduped per-profile tool union becomes the `toolIds` for the Hermes comm-agent edges in `deriveCommReachability()`, so dangerous-combo evaluation can fire `evaluable:true` on the Hermes side — not just on OpenClaw. New scanner exports: `scanProfileSkills(profileDir)`, `extractToolsFromSkillBody(body)`, `KNOWN_TOOL_NEEDLES`. Confidence on skill-derived tools is `heuristic_inference`; MIN-confidence propagation keeps each edge's overall confidence honest. Live data on test host/example-profile: 22 tools extracted (browser_navigate, browser_snapshot, file_read, bash, etc.), `hermes-telegram` and `hermes-discord` edges now carry tool lists, at least one `hermes-*` combo evaluates `evaluable:true`. (2ecac74)
- **Trust Audit comm-surface-permissiveness rule** (15th audit rule) — consumes the permissiveness report attached to `AuditContext` and emits `Finding`s for evaluable dangerous-tool combinations and posture-lint misconfigurations, so operators see them in one place alongside other trust-boundary risks. Combo metadata (name, rationale, severity) is hand-mirrored from `permissiveness/dangerous-combos.ts` to avoid a runtime dep on the registry shape (KEEP IN SYNC if the registry grows). Each finding cites the combo/lint id + evidence tools/fields and links operators back to the Blast Radius panel for full posture context. (67922d7)

### Changed
- **Shell KPI semantics (SP-5)** — header strip in `src/components/dashboard/index.tsx` now uses labels that match query semantics with inline tooltips for source/inclusion/window/confidence, resolving the reviewer's 5 live-verified v0.6.3 contradictions:
  - `ALERTS` → `CRITICAL ALERTS` (label matches `severity=CRITICAL` query; tooltip points operators to Alerts board for full list)
  - `BLOCK VERDICTS` → `SHIELD BLOCKS` (label matches `shield_scans` table source; tooltip points to Traffic Monitor for broader proxy + session-watcher blocks)
  - `AGENTS` → `FLEET AGENTS` (tooltip explains the live 13-vs-14 divergence with API Agents in Agents & Sessions; sum-from-heartbeats vs registered-total)
  - `SERVICES` and `DOWN` retain labels but gain tooltips citing `/api/infrastructure` source and inclusion criteria
  All five spans are now `cursor: help` for tooltip discoverability. No data path changes — the fix is semantic clarity. (0ffb1dc)
- **Trust Audit engine becomes async** — `runTrustAudit()` returns `Promise<AuditReport>` so it can `await scan({refresh:false})` from the permissiveness lib (which itself never blocks; the scanners are sync but the public API is `async`). Caller `/api/trust-audit/route.ts:runAndPersist()` updated. Cache, RBAC, meta envelope unchanged. (67922d7)
- **`AuditContext.permissivenessReport`** added (typed `unknown` to avoid circular import; rule narrows via type-guard). Existing rules ignore the field; the new rule skips silently if scan failed. (67922d7)
- **Trust Audit rule count** updated 14 → 15 in `PANEL_HELP.trustAudit.desc` and `HelpPanel.tsx`.
- **Permissiveness orchestrator** — empty-tools fallback reason in `evaluateAllCombos` updated to reflect that Hermes skills ARE now scanned (the message used to say "tools live in gateway skills/plugins (not yet joined)"). (2ecac74)
- **Verify-units harness** grew 182 → 202 assertions, all PASS:
  - extractToolsFromSkillBody contract (4)
  - scanProfileSkills walks profile + returns toolUnion (4)
  - reviewer profile carries `skills`/`toolUnion` (4)
  - `KNOWN_TOOL_NEEDLES` coverage (4)
  - hermes-* edge has `toolIds` populated (1)
  - at least one hermes-* combo `evaluable:true` (1)
  - orchestrator combo contract relaxed: `evaluable:true` → evidence with ≥2, `evaluable:false` → reason; previous "every combo is evaluable:false" was already broken by v0.7.0 deeper-reachability OpenClaw join (2 reformulated)

### Security
- **Honest semantics, not louder noise.** SP-5 fixes false-reassurance KPIs — operators no longer see "0 ALERTS" in the header while the deployment-readiness panel says "ALERTS 48". The data values were always honest; only the labels were misleading. The change makes scope-divergence operator-discoverable rather than hidden.
- **Heuristic_inference is named.** Skill tool extraction is regex-over-prose; the confidence label propagates explicitly through every score and finding. No surface promotes a heuristic to verified.
- Scanner remains read-only: filesystem reads + no network calls + no writes.

### Migration
- **Anyone calling `runTrustAudit()` directly** must `await` it. There is exactly one in-tree caller (`/api/trust-audit/route.ts`) which is updated; external callers (none known) need to follow.
- **Trust Audit finding totals will go up** — test host baseline went from 7 findings (v0.7.0) to 22 findings (v0.7.1). The new findings are real (browser+read on Scout, Browser+Read on hermes-discord, telegram channel ID in user allowlist, etc.); the v0.7.0 number was an under-count, not the v0.7.1 over-count. Recalibrate dashboards/badges that depend on the absolute number.
- Header KPI labels change names. Anything that scrapes the dashboard HTML (none expected; this is a dashboard, not an API) for `ALERTS`, `BLOCK VERDICTS`, or `AGENTS` strings should switch to the new labels (`CRITICAL ALERTS`, `SHIELD BLOCKS`, `FLEET AGENTS`).

### Controls Evidence (SOC 2 / ISO 27001)
- **CC7.1 / CC7.2 (Detection)** — comm-surface-permissiveness rule emits Finding records carrying combo id + evidence tools, so dangerous-tool combinations are detected and reported through the same Trust Audit interface as direct-path bypass and shield-mode findings. Evidence trail preserved.
- **CC4.1 / A.5.27 (Information from incidents)** — Hermes profile skill scan adds heuristic visibility into the Hermes runtime's tool surface. Marked `heuristic_inference`; calibrating to verified status awaits a future authoritative tool registry.
- **CC1.4 (Communication of objectives)** — SP-5 KPI relabeling closes the documented header-vs-deeper-panel gap that previously misrepresented the state of detected risk to operators. Inline tooltips inline-document source/inclusion/window so operators don't need to consult external documentation to interpret each KPI.

### Known Issues / Honest Disclosures
- Skill-tool extraction is conservative (backtick-quoted identifiers only). Tools mentioned only in prose ("the agent uses the browser tool" without backticks) are not picked up. This errs on the side of under-reporting rather than fabricating a finding.
- Combo metadata (name + rationale + severity) is hand-mirrored from `permissiveness/dangerous-combos.ts` into `trust-audit/rules.ts` to avoid a circular import. **KEEP IN SYNC** if the registry grows; the linter does not catch divergence today.
- Trust Audit report size will be larger now that comm-surface findings land in the same payload. The 1 MB cache cap in `/api/trust-audit/route.ts` still holds on test host live data (~50KB after this release); high-finding fleets may push the cap and fall back to fresh-on-every-request.
- The "every combo evaluable:false" assertion at v0.7.0 was already incorrect on live test host data (browser_plus_read for Scout fired evaluable:true after the deeper-reachability commit). The v0.7.0 release-day "182/182 PASS" reported in the handoff summary was not reproducible on the same machine the next morning. Fixed in this release as part of bringing the harness into alignment with v0.7.0+v0.7.1 reality.

### Verified On
- test host (the operator's Mac, example-profile Hermes profile) on 2026-04-23. `verify-pre-oss.sh` 12/12 PASS. `verify-permissiveness-units.ts` 202/202 PASS. Trust Audit panel renders new findings via `chrome-devtools` MCP smoke test (Browser + Read on hermes-discord@example-profile, posture-lint on telegram, etc.). `/api/health` reports `version: 0.7.1-alpha`.

## [0.7.0-alpha] - 2026-04-23

Blast Radius + Permissiveness release. Ships SP-1 (data model + scanner) and SP-2 (operator-first panel) of the 20-item blast-radius/permissiveness mandate. Adds the first-class operator view that answers "which agents are reachable from where, under what controls, with what tools, and how bad would it be?" in under 30 seconds — with provenance on every field, honest `—` instead of `0` when confidence collapses to `unknown`, and dual-bot detection that surfaces when OpenClaw-declared posture is vestigial relative to Hermes runtime.

### Added
- **Permissiveness library** at `src/lib/services/permissiveness/` — unified data model: 9 permission dimensions per comm surface, provenance on every field (`EvidenceLevel` ladder `verified_runtime > verified_config > verified_filesystem > heuristic_inference > unknown`), MIN-confidence propagation, dual-bot detection, posture-lint module, dangerous-tool-combination registry. Full spec at `docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md`. (bd4903b spec, 3043e86 scaffold, d11d99a types)
- **Blast Radius panel** (💥 COMMAND group) — new top-level panel with four vertical blocks: Exposure Matrix, Most Permissive Agents, Most Exposed Surfaces, Dangerous Combos + Posture Lints; provenance legend footer; profile selector showing active + dormant profiles. (d8dbed0, 1d79cb7, a5ddd9a)
- **`GET /api/permissiveness`** — aggregated permissiveness report with in-memory 60s cache and manual-refresh via `?refresh=true`. Returns `PermissivenessReport` envelope with profiles, surfaces, dangerousCombos, postureLints, rankings, meta. (226645c)
- **OpenClaw scanner** reads `~/.openclaw/openclaw.json` `channels.{discord,slack,telegram}` blocks; produces `PermissionPosture` with file:keypath provenance on every field; token hashed via SHA-256 (raw token never stored). (4db59f2)
- **Hermes scanner** enumerates `~/.hermes/profiles/*/`; parses `.env` (inline dotenv), `config.yaml` (via `yaml@2.8.3`), `platforms/pairing/{platform}-approved.json`, `channel_directory.json`. 3-step active-profile detection (`active_profile` file → only profile → unknown). (22b831c)
- **Deep OpenClaw reachability join** — scanner now emits `agents[]` (id, name, model, real tool lists from `cfg.agents.list[].tools.allow`) and `bindings[]` (from `cfg.bindings[]`). Orchestrator derives comm-surface edges per binding AND runtime edges on `litellm-proxy` per agent. Tool-risk classification feeds `tool_risk` + `dangerousToolCount` into edge scores. OpenClaw agents (Project owner, Scout, Axiom, test host, Byte, Apex, Nano, Spark, Nova, Relay, Iris, …) now appear in the Most Permissive Agents ranking and Exposure Matrix; dangerous-combo evaluation starts firing `evaluable:true` where agent tool lists support it (e.g., `browser_plus_read` on researcher/Scout with `web_search+read`). (6d14b4a)
- **Token-matching** — prefix + SHA-256 comparison across OpenClaw-declared and Hermes-enforced tokens; classifies surfaces as `not_applicable | no_openclaw_declaration | single_bot_openclaw_enforces | single_bot_hermes_enforces | dual_bot`. (a332d1a)
- **Dangerous-tool-combination registry** with 5 seeded combos: `browser+read`, `read+send`, `exec+write`, `config_mutation+restart`, `delegation+privileged_peer`. `evaluable: false` contract with explicit reason when evidence insufficient — never a fabricated risk. (4541481)
- **Posture-lint module** with 2 seeded rules: `telegram_channel_in_user_allowlist` (catches misconfigurations like chat IDs in `TELEGRAM_ALLOWED_USERS`), `discord_non_snowflake_in_user_allowlist`. Extension point for future rules. (8923717)
- **Blast-radius scoring** — edge formula `audience × allowlist × containment × routing × (tool_risk + combo_bonus + lint_bonus)` clamped 0-100 against calibrated `MAX_RAW=1433.25`. Bands at 20/40/60/80. MIN-confidence propagation; any `unknown` input collapses numeric to `—`. (6c081dd)
- **`scripts/verify-permissiveness.sh`** — endpoint-level smoke test; and **`scripts/verify-permissiveness-units.ts`** — module-level assertion harness (182 assertions against live machine config, run via `npx tsx`). (13c06fe, 6c081dd)
- **Nav integration** — `blastRadius` TabId + COMMAND NAV entry + `PANEL_HELP.blastRadius` + panels count 24→25 badge. (9a20ca6, 7093efc)

### Changed
- `scripts/verify-pre-oss.sh` baseline extended 11 → 12 routes (adds `/api/permissiveness`, 8000ms budget). (13c06fe)
- `yaml` dep pinned exactly at `2.8.3` (patches GHSA-48c2-rrv3-qjmp — deeply-nested-collections DoS in 2.0.0-2.8.2). (58058b2)

### Security
- Every KPI in the Blast Radius panel follows the reviewer's metric-semantic discipline: inline tooltip source/inclusion/window/confidence definition, honest zero vs unknown, cross-panel count reconciliation, no false-reassurance labels. Guards derived from 5 live-verified v0.6.3 shell-KPI contradictions (see spec §2 table).
- **No-fake-data guarantee** — every field traces to a real file:line or env var. Missing evidence → `unknown` with explicit source note. Raw bot tokens never stored; only prefix (first 20 chars) + SHA-256 hash.
- Scanner is read-only filesystem + no network calls + no writes.

### Migration
None required. Panel and API route are additive. No schema changes.

### Controls Evidence (SOC 2 + ISO 27001:2022)
| Area | SOC 2 TSC | ISO 27001:2022 Annex A | Risk |
|---|---|---|---|
| Blast Radius library + panel + API | CC6.1, CC7.2 | A.5.9, A.5.15, A.8.3 | R-024 partial |
| yaml@2.8.3 supply chain fix | CC7.2 | A.5.23 | R-021 hygiene |
| Provenance on every field | CC7.2 | A.8.31 (testing) | R-024 |

### Known Issues / Follow-Ups
- Hermes comm-agent tool lists remain empty (Hermes gateway skills/plugins not yet scanned); dangerous-combo findings on Hermes edges stay `evaluable:false` with explicit reason. OpenClaw side is now joined.
- SP-3 (Trust Audit finding upgrades to consume permissiveness lib) deferred.
- SP-4 (Correlations score transparency) deferred.
- SP-5 (shell-KPI semantic cleanup for the reviewer's 5 live-verified v0.6.3 contradictions) deferred to v0.7.1-alpha.
- NemoClaw + Webhook surfaces render as honest `not_integrated` placeholders until respective adapters ship.

## [0.6.3-alpha] - 2026-04-22

Post-initial-pass quality, honesty, and governance release. Lands the full governance starter pack (14 approved policies, 2 live registers, 4 operational templates, 3 summary artifacts, in-dashboard Governance panel), flips RBAC to a safe default, closes several internal reviewer platform-audit priorities, and extends the security audit as the canonical SOC 2 evidence ledger. Each change below is traceable to a finding (`H-#`), risk (`R-###`), or platform-audit priority (`Pri-#`) where applicable.

### Added
- **In-dashboard Governance panel** (`src/components/dashboard/panels/GovernancePanel.tsx`) under the COMPLIANCE sidebar group — 20 governance docs readable inline via shared `DocReader`: 3 overview docs (one-pager, index, evidence checklist), 14 policies + index, 2 registers. (e4c8f4d) [Pri-6.2]
- **14 approved policies** (`docs/policies/01..14`) with document IDs, approval metadata (Owner & Maintainer signed 2026-04-22, alternate approver pending), and per-policy change logs. (d47ae69)
- **Live registers**: `docs/registers/risk-register.md` (23 active risks with priority, owner, target date, treatment, status, linked evidence) and `docs/registers/vendor-inventory-register.md` (live-reconciled against codebase, grouped by dependency category). (d47ae69) [R-005, R-009]
- **Governance one-pager** (`docs/governance-one-pager.md`) — leadership/enterprise-facing summary with honest posture, compliance trajectory, 90-day roadmap. (d47ae69)
- **Policy evidence checklist** (`docs/policy-evidence-checklist.md`) — every clause across all 14 policies mapped to a concrete artifact or named gap. (d47ae69)
- **4 operational templates** (`docs/templates/`) — incident record, tabletop exercise, DR test record, quarterly access review. (d47ae69)
- **Governance index** (`docs/governance-index.md`) — master entry point to every governance artifact. (d47ae69)
- **Shared `DocReader` component** (`src/components/dashboard/DocReader.tsx`) — extracted from HelpPanel so HelpPanel and GovernancePanel share one markdown-rendering implementation. (e4c8f4d)
- **Starter correlation template catalog** (`src/lib/correlation-templates.ts`) — shared module exporting the 3 starter templates (burst-shield-blocks, auth-bruteforce, cross-source-anomaly). (f1c9bbc) [Pri-4.5]
- **Correlations "Why this score" breakdown** — collapsible `<details>` card between the summary and the findings list, showing per-source raw points, active weight multiplier, final weighted contribution, and a correlation-multiplier rationale card. (abb0f2d) [Pri-3.2, Pri-4.4]
- **Live top-correlations preview on Fleet Command** — compact card showing the top 1-2 active correlations in non-demo mode, fetched from `/api/correlations?limit=2` with 30s refresh. Click-through to Correlations panel. (1eebed5) [Pri-3.4]
- **Starter-templates empty state on Correlations panel** — when an operator has zero custom rules, three one-click APPLY buttons land a starter rule enabled without burying it in the Configuration panel. (f1c9bbc)
- **Correlation evaluator now returns `weights_applied`, `correlation_multiplier`, `raw_score`, `triggered_count`, `unique_sources`** — enables the Why-this-score UI; backwards compatible (optional fields). (abb0f2d)
- **`ClawNex` wordmark hyperlink** in the upper-left status bar → `https://clawnexai.com` (new tab, `rel="noopener noreferrer"`). (3c465f7)
- **Boot-time WARN banner** when `RBAC_ENABLED !== 'true'` — `src/lib/rbac/guard.ts` prints a boxed stderr WARN on first module load so operators can't silently run an unauthenticated dashboard. (21d249b) [Pri-6.1]
- **Trust Audit discovery-fidelity caveat** — inline "Discovery fidelity" note above the tab bar in the Trust Audit panel + prepended caveat in `PANEL_HELP.trustAudit.desc` explaining that agent identity is derived from `proxy_traffic.session_id` and tool inventory from `TOOLS.md`. (a5367a9) [Pri-2]
- **API whitelist expansion** (`src/app/api/docs/route.ts`) — `ALLOWED_DOCS` grew 11 → 31 entries with strict subdirectory support (`policies/*`, `registers/*`) while preserving traversal rejection. (e4c8f4d)

### Changed
- **RBAC is now ON by default** — `.env.example` flipped `RBAC_ENABLED=false` → `RBAC_ENABLED=true` + added `NEXT_PUBLIC_RBAC_ENABLED=true`; extensive opt-out commentary for local-dev. Running RBAC-off now triggers the boot WARN on every restart. README Quickstart updated to reflect new default. (21d249b) [Pri-6.1]
- **Correlation Rule templates live in a shared module** — previously inline in ConfigurationPanel, now in `src/lib/correlation-templates.ts` so both ConfigurationPanel (clone-into-form flow) and CorrelationsPanel (one-click empty-state APPLY) consume one canonical source. (f1c9bbc)
- **ToolsAccessPanel state handling** — replaced the single misleading `<EmptyState message="Loading..."/>` with explicit loading / ready-but-empty / disconnected / error states via `useDataState` + shared state components. Silent fetch-error catch removed; errors now surface in UI. (e662c3f) [Pri-5 targeted]
- **Trust Audit `PANEL_HELP` copy** — rewritten to lead with best-effort framing and to define how operators should interpret `verified_runtime` vs `heuristic_inference` confidence pills. (a5367a9) [Pri-2]
- **Configuration `PANEL_HELP` copy** — lists the four v0.6.2 cards (Scheduled Reports, Correlation Rules, Threat Score Weights, HTTPS) and corrects voice/avatar copy (HeyGen only; removed stale ElevenLabs reference). (c681dab)
- **Correlations `PANEL_HELP` copy** — adds v0.6.2 internal reviewer Task 4 features (Re-evaluate Now preserves old data, stale indicator, 5s TTL cache). (c681dab)
- **Fleet `PANEL_HELP` copy** — mentions the ReadinessBanner that landed in v0.6.2. (c681dab)
- **Help `PANEL_HELP` metrics** — corrected: 22 → 24 panels, 9 → 10 sidebar groups, 35 → 31 readable-inline-in-dashboard docs + 60+ total repo artifacts. (c681dab, e4c8f4d)
- **HelpPanel `PANEL_GUIDE`** — added Trust Audit entry (under SECURITY) and Governance entry (under COMPLIANCE); updated Configuration oneLiner to name the new cards; badges refreshed (24 PANELS, 31 DOCS). (c681dab, e4c8f4d)
- **OSS release readiness checklist** (`docs/oss-release-readiness-checklist-2026-04-22.md`) bumped to v1.2 — removed editorial "Recommended Current Stance" framing per the priority addendum's non-freeze guidance; tightened one mealy-mouthed `[x]` PARTIAL to an honest `[ ]` with scope note. (5a2419d)
- **Security audit** (`docs/security-audit-2026-04-22.md`) bumped to v1.2 — added end-of-day post-initial-pass entry documenting the reviewer's 10-task hardening, governance lane, LiteLLM port-guard, and the four pushback fixes as a single auditable ledger section. (bb69e11)
- **README Quickstart** — RBAC paragraph rewritten to match new safe default; emphasizes `SETUP_SECRET` for network-reachable deployments. (21d249b)

### Fixed
- **Help-tour coverage gap** — `PANEL_GUIDE` was missing Trust Audit entirely (22 of 23 panels listed); now complete. Several `PANEL_HELP` entries were stale or silent about v0.6.2 additions; all refreshed. (c681dab)

### Security
- **RBAC safe default enforcement** — previous `RBAC_ENABLED=false` default meant a fresh clone+run on any network-reachable host exposed an unauthenticated dashboard. Default now flips to `true` and a boot-time WARN fires when RBAC is explicitly disabled. (21d249b) [addresses platform audit Priority 6.1]
- **Auditable-by-default operator changes** — RBAC-off starts emit a visible stderr WARN banner; all `audit_log` entries continue to mirror to stdout as `[CLAWNEX_AUDIT] {json}` (H-9 from v0.6.2). Both are SIEM-ingestable. (21d249b)

### Migration
- **Operators currently running with `RBAC_ENABLED=false` are unchanged** — the code default behavior is identical; only the new-clone onboarding default differs. Existing `.env.local` files continue to work as configured.
- **If you want the new safe default on an existing install**: copy the RBAC block from the updated `.env.example` into your `.env.local`, set `SETUP_SECRET=<generated-setup-secret>`, `npm run build`, restart, and visit `/setup?secret=<setup-secret>` to create the first admin account.
- **Docker build-vs-runtime follow-up** — Dockerfile does not yet forward `RBAC_ENABLED` as a BUILD ARG so the edge-runtime middleware stays off even when docker-compose sets `RBAC_ENABLED=true` at runtime. API-layer `requireSession()` still protects routes but the UX redirect-to-login is currently a no-op. Fix planned for the 2026-04-23 Docker pairing session.

### Controls Evidence (SOC 2 / ISO 27001 mapping)

Each change is traceable to a SOC 2 Trust Services Criterion and an ISO 27001:2022 Annex A control. Commit SHAs are the canonical evidence pointer.

| Commit | SOC 2 | ISO 27001:2022 | Evidence summary |
|---|---|---|---|
| d47ae69 | CC1.1 / CC1.2 / CC1.3 / CC2.1 / CC3.1 / CC5.1 | A.5.1 / A.5.2 / A.5.4 / A.5.10 / A.5.19 | 14 policies + 2 registers + 4 templates + 3 summaries (governance lane) |
| e4c8f4d | CC2.2 / CC6.1 | A.5.10 / A.8.3 | Governance panel (in-dashboard), `/api/docs` whitelist expansion |
| c681dab | CC2.2 | A.5.10 | Help-tour content refreshed to match live platform state |
| 3c465f7 | CC2.2 | A.5.10 | Branding/attribution — neutral |
| 5a2419d | CC1.2 | A.5.1 | OSS readiness honesty pass |
| a5367a9 | CC2.2 / CC7.3 | A.5.10 / A.8.22 | Trust Audit fidelity claim ≈ evidence |
| f1c9bbc | CC7.1 / CC7.2 | A.8.16 | Operator-chosen rule activation (no day-1 false positives) |
| 21d249b | **CC6.1** / CC6.6 / CC7.2 | **A.8.2** / A.8.3 / A.8.5 / A.8.15 | Safe-default authentication + observable unsafe-config WARN |
| bb69e11 | CC4.1 / CC4.2 | A.5.36 | Continuous remediation ledger |
| abb0f2d | CC7.2 | A.8.16 | Explainable threat-score risk rationale |
| 1eebed5 | CC7.2 / CC7.3 | A.8.16 | Live top-signal surfacing on operator landing page |
| e662c3f | CC2.2 / CC7.2 | A.5.10 / A.8.16 | State-disambiguation reduces operator-trust ambiguity |

## [0.6.2-alpha] - 2026-04-22

Pre-OSS hardening release. Consolidates the full output of the 2026-04-22 enterprise security review (2 Critical + 13 High findings addressed), the reviewer's 10-task pre-OSS usability pass, and the LiteLLM orphan-process incident response. See `docs/security-audit-2026-04-22.md` for the complete audit report and `docs/pre-oss-hardening-checklist-for-claude.md` for the task-level breakdown.

### Added
- `docs/security-audit-2026-04-22.md` — consolidated security review + compliance audit report (36 docs reviewed, SOC 2/ISO 27001/NIST mappings, 2 Critical + 13 High + 50+ lower findings, prioritized remediation roadmap)
- `docs/pre-oss-validation-checklist.md` — 9-section manual UI validation checklist for release candidates
- `scripts/verify-pre-oss.sh` — automated smoke test against 11 critical API routes with latency budgets (exits 0/1, portable across macOS + Ubuntu)
- `scripts/generate-sbom.sh` — CycloneDX SBOM generator for Node + Python dependencies (`npm run sbom`)
- Trust Audit persistence + caching: `GET /api/trust-audit` now returns `{report, meta: {last_run, duration_ms, cached}}`; `?refresh=true` forces recompute, default serves last-run cached result from `config_defaults`
- Trust Audit evidence fidelity: `EvidenceLevel` type (`verified_runtime` / `verified_config` / `verified_filesystem` / `heuristic_inference` / `unknown`) on Agent, Capability, Finding, SensitiveAssetHint; `Finding.evidence[]` string array with concrete data references; confidence pills + expandable evidence in UI
- Trust Audit panel now fetches persisted results on mount (no more empty CTA); summary header with last-run / duration / findings / overall-severity / cached badge; keeps old results visible during refresh
- Correlations panel value surfacing: dual fetches (summary + findings), prominent threat score + level pill + source breakdown + triggered rule count + last-evaluated timestamp, "Re-evaluate Now" button that preserves old data during refresh, staleness indicator when evaluation >5 min old
- Custom Correlation Rules productized: intro copy, 3 starter templates (Burst of shield blocks, Auth brute-force, Cross-source anomaly) operators can clone, per-rule enabled/disabled pill, trigger count, last-triggered time
- Threat Score Weights card in Configuration: 7 category weights (`risk_weight_shield`/`_infra`/`_token`/`_access`/`_breakglass`/`_audit`/`_alerts`), slider + number input per field, Reset-to-defaults control, kicks correlation re-evaluation on save
- Deployment Readiness banner on Fleet Command: top-of-panel card summarizing Authentication (RBAC + operator count), Shield mode (observe/block), Providers (routed vs direct), Trust Audit last run, Posture Scan status; severity-coded dots, action links to fix surfaces, new `src/components/dashboard/ReadinessBanner.tsx`
- 8 new exports in `src/components/dashboard/shared.tsx`: `PanelDataState` type, `PanelStateBar`, `PanelEmptyState`, `PanelErrorState`, `PanelDisconnected`, `isStale`, `formatTimeAgo`, `useDataState` hook
- Secret Rotation section in `SECURITY.md` (SETUP_SECRET, SESSION_SECRET, CLAWNEX_INGEST_SECRET, RESEND_API_KEY, SMTP_PASS, LITELLM_MASTER_KEY, operator-created API keys; annual cadence guidance)
- Dedicated `operator_role_changed` audit action (in addition to generic `operator_updated`) captured within the role-change DB transaction
- `.env.local` loader in `litellm/run.py` — parses standard `KEY=VALUE` lines with `os.environ.setdefault`, replaces plaintext secrets in the launchd plist

### Changed
- **Trust Audit hotspot query rewrite**: replaced `action LIKE '%break_glass%'` in `src/lib/services/trust-audit/rules.ts` with explicit `action IN ('break_glass_activated', 'break_glass_deactivated', 'break_glass_expired')` — **700× speedup** (14.2s → 0.02s on 1.84M `audit_log` rows), full audit run 23.5s → 339ms on current dataset
- Composite index `idx_audit_action_time ON audit_log(action, created_at)` applied to schema and live DB
- 4 new perf indexes: `idx_correlation_events_created`, `idx_correlation_events_rule_time`, `idx_alerts_created_at`, `idx_proxy_traffic_latency` (proxy_traffic p95 query 479ms → 11ms)
- N+1 fix in `listProviders()` — single `SELECT` + in-memory group-by (was one `SELECT` per provider)
- 5s TTL in-memory cache on `GET /api/correlations/evaluate` (270ms → 34ms cache hit); POST invalidates cache
- Risk weight defaults in `threat-score.ts` aligned to UI defaults (`risk_weight_token=0.8`, `risk_weight_breakglass=1.5`, `risk_weight_audit=1.2`)
- `nodemailer` 6.10.1 → **8.0.5** (closes 4 advisories including SMTP command injection and CRLF recipient injection)
- `@heygen/liveavatar-web-sdk` pinned exactly to `0.0.12` (removed caret — pre-1.0 caret was effectively unpinned)
- LiteLLM proxy fail-closed by default: `CLAWNEX_ON_SCAN_ERROR=block` in `litellm/clawnex_logger.py`; synthetic BLOCK verdict on scan failure, block-mode treated as ON when dashboard unreachable, break-glass always fails closed, final exception raises instead of silently allowing
- `litellm/run.py` supervised by launchd is now the blessed serving path (replaces ad-hoc `nohup /opt/homebrew/bin/litellm ...` from bash) — the ClawNex callback patch (`_init_custom_logger_compatible_class`) is now actually applied to the listener
- `litellm/config.yaml` sets `general_settings.num_workers: 1` (triple-enforced alongside CLI flag and `LITELLM_NUM_WORKERS` env var) to prevent uvicorn/gunicorn worker preforks
- Dashboard `next start` now binds `-H 127.0.0.1` in production (no longer `0.0.0.0`); same in `package.json` start script

### Fixed
- **C-1 Caddyfile / shell injection (Critical)** — domain input previously validated only by `.includes('.')`; now strict RFC-1123 domain regex at route layer and as defense-in-depth in `caddy-service.ts`; all `execSync` calls that interpolated the domain replaced with `execFileSync` array-args (`src/lib/services/caddy-service.ts`, `src/app/api/system/https/route.ts`)
- **C-2 SQL injection in Custom Correlation evaluator (Critical)** — `time_window_minutes` was string-interpolated into `datetime('now', '-${mins} minutes')`; now coerced to bounded integer (1..10080) on insert/update AND on evaluate; query uses `datetime('now', ?)` parameterized (`src/lib/services/custom-correlation.ts`, `src/app/api/correlations/rules/route.ts`)
- **H-1 `SETUP_SECRET` timing attack (High)** — `!==` string compare replaced with `crypto.timingSafeEqual` with length pre-check; fixed double `request.json()` read (`src/app/api/auth/setup/route.ts`)
- **H-2 Logout CSRF protection (High)** — `POST /api/auth/logout` now invokes `validateCsrf()` when session cookie present; idempotent no-cookie behavior preserved (`src/app/api/auth/logout/route.ts`)
- **H-3 SMTP TLS verification (High)** — removed `rejectUnauthorized: false` default; now `{rejectUnauthorized: true, minVersion: 'TLSv1.2'}` with opt-in `smtpAllowInsecure` per-config flag for self-signed test SMTP (`src/lib/services/mail-service.ts`)
- **H-7 YAML injection in LiteLLM config sync (High)** — provider `name`, `base_url`, `api_key` are now validated via `assertSafeYamlValue()` helper rejecting `"`, newlines, `\`, and values >512 chars before interpolation into generated YAML (`src/app/api/system/litellm/route.ts`)
- **H-8 MCP tool audit logging (High)** — all 10 MCP tool handlers wrapped in `auditedInvoke()`; emits `mcp:<tool>:invoked` and `mcp:<tool>:completed|failed` events with `source='mcp'`; redacts password/key/token fields; previously all 10 tools ran unaudited (`src/mcp/tools.ts`)
- **H-9 Audit log stdout mirror (High)** — every `audit_log` row now mirrored to stdout as `[CLAWNEX_AUDIT] {json}` for journalctl/syslog/SIEM pickup; controllable via `CLAWNEX_AUDIT_STDOUT=false` env (`src/lib/services/audit-logger.ts`)
- **H-10 `sentinel.db` permissions (High)** — `deploy/deploy.sh` now sets `umask 077` and explicitly `chmod 600 sentinel.db* logs/*` after first service start
- **H-11 Port 5001 public exposure (High)** — removed unconditional `ufw allow 5001/tcp` from installer; replaced with conditional `tailscale0`-scoped rule; systemd `ExecStart` and `package.json start` script now bind `-H 127.0.0.1` so Caddy is the only ingress path
- **H-12 LiteLLM proxy fail-open (High)** — see "Changed" entry above
- LiteLLM 150-process orphan incident (2026-04-22): cleaned up 145 orphaned worker processes (state `U`, PPID=1) spawned by an earlier `start.sh` invocation when `--num_workers 1` was not honored by LiteLLM's internal worker manager; freed ~1,155 MB RAM; port 4001 response recovered from 60s scheduler-thrash to 1.6ms
- LiteLLM fork-bomb triple-guard: (a) `lsof` port check in `litellm/start.sh` aborts at shell level, (b) raw-socket bind pre-flight in `litellm/run.py` exits with code 0 in ~20ms before any LiteLLM imports, (c) `config.yaml` sets `general_settings.num_workers: 1`
- `CorrelationsPanel.tsx` auto-refresh intervals (summary 30s, list 20s) replace previously generic `Loading...` spinner; progressive state buckets via shared components
- TrustAuditPanel tab count dropdown no longer claims certainty on heuristic findings; Rule 2 (tool-freedom), Rule 3 (model-privilege), Rule 6 (prompt-capability), Rule 9 (delegation), Rule 10 (browser), Rule 11 (egress), Rule 12 (plugin), Rule 13 (credential-exposure agent path) reworded to disclose inference basis

### Security
- 2 Critical (C-1, C-2) + 9 High (H-1, H-2, H-3, H-6, H-7, H-8, H-9, H-10, H-11, H-12) findings from the 2026-04-22 live security review addressed — see `docs/security-audit-2026-04-22.md` §3–§4 for full detail
- SOC 2 quick wins: SBOM generator (CC7.1), Secret Rotation runbook (CC6.1), dedicated role-change audit event (CC6.3), audit stdout mirror for external log capture (A.5.33)
- `OPENROUTER_API_KEY` migrated from duplicate plaintext locations (`litellm/start.sh` and `~/Library/LaunchAgents/com.clawnex.litellm.plist`) into `.env.local` (chmod 600, gitignored)
- `litellm/start.sh` rewritten — hardcoded `OPENROUTER_API_KEY` removed, sources `.env.local`, port-bind pre-flight check

### Migration
- Operators who previously set `risk_weight_*` overrides can now view/edit them in Configuration → Threat Score Weights. If an override was persisted to a non-canonical key name, it will be ignored; re-enter via the new card.
- Deployments relying on direct `http://<host>:5001` access will stop working when `deploy.sh` is re-run — use Caddy HTTPS (port 443) or scope access via `tailscale0`. If your pilot relies on direct port 5001, keep the current systemd unit and do not re-run `deploy.sh`.
- Integrations that hit `/api/trust-audit` will receive the wrapped `{report, meta}` shape. The previous flat `AuditReport` shape is no longer returned. Add `?refresh=true` to force recompute; default returns cached.
- 4 H findings deferred: H-4 (`curl | bash` clawkeeper updater — needs vendored signed binary), H-5 (next.js 14→15 major upgrade — dedicated project), H-13 (shield whitelist source-signing with HMAC — needs shared-secret bootstrap). Tracked for v0.7.0.

## [0.6.1-alpha] - 2026-04-21

### Added
- Operator deactivate/reactivate toggle (preserves audit history)
- "Forgot your password?" guidance on login screen
- Mail configuration (Resend + SMTP) for password reset emails
- Model selection toggle in Configuration (clickable discovered models, auto LiteLLM sync)
- Fleet Connectors consolidated (OpenClaw, Hermes, Paperclip COMING SOON, NemoClaw ALPHA)
- Access Lists redesign (IP/Domain deny tabs active, User + Allow get Enterprise overlay)
- 7 Enterprise badges (SSO/SAML, MFA, Custom Roles, IP Binding, Two-Person Auth, Agent Fleet Deploy, Compliance Reports)
- Website: clawnexai.com on Cloudflare Pages
- Documentation site: <docs-host> (41 pages, Nextra)
- Email capture form with Emailit integration
- Training video pipeline (28 episodes + promo, HyperFrames + ElevenLabs)
- ClawNex Operator Series scripts (32 episodes, internal reviewer)
- implementation-review coordination protocol (`docs/coordination/`)
- Trust Boundary Audit engine (14 rules) — discovery scan, risk matrix view, remediation guidance, attack surfaces view; dedicated Trust Audit dashboard panel (SECURITY group, 4 views)
- Enhanced MCP tools (10 total): 5 new tools — `configure_provider`, `generate_report`, `run_shield_tests`, `run_trust_audit`, `manage_budget`
- Scheduled Reports — daily/weekly/monthly scheduling, email delivery via Resend or SMTP, per-schedule on/off toggle, Configuration panel card
- Custom Correlation Rules — weighted conditions, threshold scoring, configurable time windows, rule builder UI, Configuration panel card
- Caddy HTTPS Integration — auto-TLS via Caddy, Caddyfile generation, status monitoring, Configuration panel card
- 3 new Configuration panel cards: Scheduled Reports, Custom Correlation Rules, Caddy HTTPS

### Changed
- Progressive lockout with time-based decay (configurable via `lockout_decay_minutes`, default 15)
- Viewer hidden tabs expanded to include `trafficMonitor`, `auditEvidence`, `executiveReports`
- Auditor tab visibility fully aligned with permission matrix
- Help panel documentation reduced from 35 to 11 operator-facing docs
- API endpoint enforces doc allowlist (held-back docs return 400)
- Security architecture document: added Section 12.1 defense-in-depth philosophy with adaptive ASR research data

### Deprecated
- _No deprecations in this release._

### Removed
- Dynamic `require()` in setup route (replaced with static import)
- `SentinelDashboard.tsx` (8,491 lines dead code)

### Fixed
- Session and CSRF cookies now key `secure` flag off actual request protocol, not `NODE_ENV`
- `/setup` redirects to `/login` if setup is already completed
- Password strength heuristic: numeric-only passwords now correctly rate as "Weak"
- Audit Clear button hidden for non-admin roles (was visible but server-blocked)
- Break-glass countdown timer no longer resets every 5s poll cycle
- "Purge Now" button now calls correct `/api/system/purge` endpoint (was calling `/api/system/archive`)
- Model rates `onBlur` reads current input value (was saving stale closure)
- 28th permission `operators:read` added to Permission type and admin role
- Shield scanner JSDoc updated from "121 rules" to "155 rules"

### Security (3 code review rounds + round 13 adversarial)
- 39 API routes got localhost guards for RBAC-disabled mode
- Shell injection fixed in uninstall crontab handling (string interpolation to stdio piping)
- Uninstall route permission corrected: `system:purge` to `system:manage`
- CSRF comparison made timing-safe (`crypto.timingSafeEqual`)
- `NEXT_PUBLIC_RBAC_ENABLED` removed from server-side `isRbacEnabled()`
- Database path removed from settings API response
- Operator management routes reject when RBAC disabled
- Ingest secret comparison made timing-safe
- Rate limiter IP detection: removed spoofable `x-forwarded-for` fallback
- Setup route IP: aligned with login route (uses `request.ip` only)
- Password reset no longer re-enables admin-disabled accounts
- Forgot-password rate limited (3/min/IP)
- Progressive lockout with configurable time-based decay (`lockout_decay_minutes`)

### Migration Notes
- **Uninstall route permission change.** Automation invoking `/api/system/uninstall` must now use an Operator with `system:manage` permission (was `system:purge`). Update any scripts or MCP calls accordingly.
- **`NEXT_PUBLIC_RBAC_ENABLED` no longer honored server-side.** Server code reads `RBAC_ENABLED` only; both variables should still be set for client/server parity. See `docs/11-security-architecture.md`.
- **Progressive lockout decay default.** New installs default to 15 minutes; existing installs retain their prior value. Tune via `lockout_decay_minutes` in `config_defaults`.
- **Doc allowlist enforcement.** API endpoints serving documentation now reject requests for docs not on the operator-facing allowlist. Integrations reading internal docs via API must switch to the filesystem or obtain updated allowlist membership.

## [0.6.0-alpha] - 2026-04-13

### Added
- Role-Based Access Control (RBAC) with 5 roles and 28 permissions
- Session authentication with SHA-256 hashed tokens, configurable TTL, "Remember me"
- Max 5 sessions per operator with oldest-session eviction
- Password security via bcryptjs (12 rounds) with constant-time login
- CSRF protection using double-submit cookie pattern
- Setup Wizard for first-run admin account creation
- Login page with ClawNex branding and session-expired messaging
- Operator management panel (create, edit, remove, password reset, unlock)
- Last-admin invariant to prevent system bricking
- Per-route `requireSession()` and `requirePermission()` middleware on all 94 API routes
- Operator identity display in dashboard header with role badge and logout
- Session expiry detection (60s poll)
- Role-based sidebar tab hiding
- CSRF token auto-injection via `window.fetch` monkey-patch
- Audit trail records real operator usernames
- Standalone deploy mode (`output: 'standalone'`, 8MB compressed tarball)
- Apache 2.0 license with DCO (Developer Certificate of Origin)
- GitHub Actions CI (build + type check + Docker build)
- Dockerfile (multi-stage, non-root user) and docker-compose.yml
- `.env.example` and hardened `.gitignore`

### Security
- 12 rounds of Codex security review with 70+ findings resolved
- All API handlers require session auth when RBAC is enabled
- Chat, voice/avatar proxies, provider management, remote command, workspace, and archive endpoints all protected by session + permission checks

### Migration Notes (v0.6.0 is a significant release)
- **RBAC introduction.** Set `RBAC_ENABLED=true` and `NEXT_PUBLIC_RBAC_ENABLED=true` in `.env`, rebuild, and visit the setup wizard to create the first Admin. Existing deployments remain open (unauthenticated) until these flags flip, enabling a planned migration window.
- **94 API routes now require session + permission middleware.** External integrations must provide a valid session cookie and CSRF token when RBAC is enabled. See `docs/10-api-reference.md`.
- **License change.** Apache 2.0 license with DCO is now the official license. Contributors must sign commits with `-s`.

## [0.5.4-alpha] - 2026-04-11

### Added
- Global tooltip system with hover-anywhere help across 26 UI elements
- Global TIPS toggle in dashboard header with persistent on/off state
- Dotted cyan underline on inline tooltip anchors, corner pip on block anchors
- Light-mode theme for tooltip overlays
- Collapsible sections for Recent Shield Events, Live Traffic, Agents, and Cost by Agent
- Hermes-Agent as fleet gateway instance in global instance selector
- Hermes watcher reading `state.db` every 10s with shield scanning
- Hermes token reader aggregating cost data from Hermes sessions
- Global instance filtering across all panels and APIs
- Manual Hermes instance management in Configuration panel
- Per-agent workspace loading agent-specific files
- Hermes Infrastructure and Models views

### Fixed
- Hydration error from block-level elements inside `<span>` (added `as` prop with `display: contents`)
- Total Cost stat asymmetric width caused by inline-block wrapper breaking flex layout
- Model Pricing sync 404 (stable LiteLLM tag resolution corrected)
- Infrastructure status badge tooltips missing for ONLINE/OFFLINE states
- `Table` headers type widened from `string[]` to `ReactNode[]`
- Respects `prefers-reduced-motion` for tooltip animations

### Changed
- IP Protection roadmap removed (incompatible with open-source direction)
- Open-source direction approved under Apache 2.0 with DCO

### Security
- Chat completions auth replaced with shared `authenticateRequest()` middleware
- Migration export path corrected to actual live filename
- Provider API keys and gateway tokens masked in all GET responses
- Destructive admin endpoints reject non-localhost callers with 403
- Chat completions scope corrected from `chat:write` to `chat:completions`
- LiteLLM config and venv added to `.gitignore`
- Shield scan input capped at 500k characters on public endpoint
- Deploy script switched to `next start` + `NODE_ENV=production`
- Error messages sanitized across 7 catch blocks
- LiteLLM port env validated as 1-65535 before shell interpolation
- MCP CORS restricted from wildcard to localhost
- Report generation queries limited to 10,000 rows
- Alert dedup SELECT+INSERT wrapped in transaction
- Backup/migration artifacts set to chmod 0600
- HTTP security headers added (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- Skills inventory path resolution hardened with symlink check

## [0.5.3-alpha] - 2026-04-10

### Added
- Welcome Wizard with 6-step setup checklist on fresh installs
- Setup Complete screen with "Get Started" button that persists dismissal
- In-wizard Clawkeeper install button (no more copy-paste bash commands)
- Navigate-with-focus: wizard action buttons deep-link to Configuration cards with auto-scroll
- OpenClaw routing empty-providers distinction (friendly info vs error state)
- `resolveOpenClawPaths()` with fallback chain for consistent path detection
- Display Name override in Configuration persisted to `config_defaults`
- Gateway token auto-pull on fresh install via `seed.ts`
- Wizard-aware AI chat assistant responses
- Systemd support in uninstall script for Linux/VPS installs

### Fixed
- LiteLLM Restart button now works (event propagation stopped on button click)
- LiteLLM proxy badge on Instance Detail clickable when offline/degraded
- Fleet Command client name defaults to `os.hostname()` instead of hardcoded string
- Help overlay copy refreshed for wizard flow and LiteLLM restart behavior

## [0.5.2-alpha] - 2026-04-05

### Added
- Global time range context bar controlling all dashboard panels uniformly
- Fleet API `since` parameter for time-filtered queries
- Dynamic stat labels reflecting selected time range
- Contextual Help Flyout (`?` button) with panel-specific content
- Guided Tour Mode walking through all 20 panels
- Instance Detail populated with Services health, Recent Alerts, and Recent Activity
- Collapsible correlation entries with severity, rule name, and event count
- Correlation pagination with configurable page size
- 16 new shield rules (total 155) from Elder Pliny jailbreak research
- Threat Intelligence panel showing 4 monitored GitHub repos
- GitHub repo monitoring with update detection and alerting
- `GET /api/threat-intel` and `POST /api/threat-intel/check` endpoints
- Fleet Command bottom summary cards (Top Correlation, Alert Summary, Prompt Shield)
- Instance Detail unified chronological timeline with severity-colored dots
- Alerts & Incidents card-based incident board layout
- Shield Tests collapsible cards with pass/fail icons and channel tags
- 27 test payloads (expanded from 12) including Pliny-specific and edge cases
- Floating Avatar Guide with HeyGen LiveAvatar integration
- Tour narration via avatar with panel-aware Q&A
- Voice toggle between ElevenLabs and browser TTS
- ElevenLabs auto-validation on API key save
- CVE Database (108 CVEs) with collapsible cards, CVSS scores, and CWE tags
- CWE-to-Shield mapping showing rule coverage per vulnerability class
- CVE sync from GitHub and `GET /api/cve` endpoint
- Archive Database (one-click backup via SQLite `VACUUM INTO`)
- Purge Database with "PURGE" confirmation
- Uninstall ClawNex with 3-step confirmation
- Migrate to New Host with `.tar.gz` bundle generation
- Scheduled Daily Backup (optional cron at 3:00 AM)
- Local Model Cost Rates (manual $/million-tokens input)
- Cost by Agent card in Token & Cost Intel
- Session watcher multi-agent scanning across all agent directories
- Session watcher enable/disable toggle
- Infrastructure Storage card (disk usage)
- Access Control backlinks to Policies & Guards
- Self-hosted fonts (zero CDN dependency)
- Audit four-tier labeling (BLOCKED, OBSERVED, DETECTED, FLAGGED)
- Audit detail with detection names and 200-char payload snippet
- Server-side audit filtering with text search
- Audit pagination (10/15/25/50 entries)
- Domain and IP deny list enforcement in Prompt Shield scanner
- Consolidated Executive Summary (RPT-011) and Traffic Data Export CSV (RPT-012)

### Changed
- Audit panel uses global context bar instead of local time range selector
- Compact stat boxes with reduced padding and condensed fonts
- "Fleet Monthly" renamed to "Fleet Cost (Xd)" reflecting selected range
- Status bar labels: "HEALTHY" to "SERVICES", "CRITICAL" to "DOWN", "BLOCKED" to "BLOCK VERDICTS"
- "Blocked" terminology replaced with "Block Verdicts" dashboard-wide
- Security Posture sections collapsed by default
- Alert severity mapping: shield score mapped to graduated severity levels
- Correlation alerts created for all severity levels, not just CRITICAL
- Executive Reports updated from 6 to 10 types and grouped into 7 collapsible categories
- Traffic Monitor default source filter changed from "proxy" to "litellm"
- Session watcher applies shield whitelist to eliminate false positives
- Observe mode audit entries show "OBSERVED" instead of "BLOCKED"
- Sidebar badges: Prompt Shield respects time range, Alerts counts CRITICAL only
- Model list curated from 36 to 8 models

### Fixed
- Search box removed from context bar (was non-functional placeholder)
- 265 stale false-positive alerts resolved
- 5 failing executive reports fixed
- Fleet API consolidated redundant imports and extracted helpers
- Unicode regex patterns fixed for steganography rules (eliminated false positives)
- Demo placeholder rules removed from Access Control
- Clawkeeper detection fixed (checks file existence instead of nonexistent `--version` flag)
- `delivery-mirror` noise filtered from session watcher (11,824 records cleaned)
- ElevenLabs voice retry on 502 and quota error detection
- Correlation engine redesigned with multi-source aggregation and risk scoring

### Removed
- Non-functional search placeholder from context bar
- Raw "Recent Metric Snapshots" debug panel from Token & Cost Intel
- Duplicate "Agent Souls" sidebar section
- Unused `timeQuery` helper

## [0.4.5-alpha] - 2026-04-02

### Added
- Glassmorphism UI refresh with frosted glass panels and accent glows
- Performance Mode toggle (disables glass effects for low-GPU environments)
- CollapsibleCard component with animated arrow and optional count badge
- Skills & Plugins panel discovering OpenClaw and Paperclip plugins with risk levels
- Agent Ignore List for filtering internal processes from dashboard views
- OpenClaw version tracking with GitHub release checking
- UI Preferences for AI panel default state
- `PUT /api/config/defaults`, `GET /api/skills`, `GET/PUT /api/config/agent-ignore` endpoints
- AI Chat Interface with bubble messages, three display modes, and voice input
- Speaking Avatar with animated shield icon and glow pulse
- Browser TTS for voice output
- D-ID avatar integration with WebRTC and manual connect

### Changed
- Sidebar compacted from 185px to 170px width with 11px font
- Status bar unified to 11px with consistent spacing
- Configuration tab fully collapsible
- Models & Cost tab reordered with provider groups collapsed by default
- Denied Tools shows per-agent context
- Executive Reports expanded to 10 types
- Traffic Monitor removed "Proxy (Node.js)" source
- Uniform sidebar icons using clean geometric Unicode symbols
- Gateway client name field populated from gateways
- All Configuration panels collapsed by default

### Fixed
- Clawkeeper detection (was running nonexistent `--version` flag)
- `delivery-mirror` session watcher noise (11,824 records deleted)
- Legacy proxy records cleaned from database
- OpenClaw provider test uses `/health` instead of `/v1/models`
- Autensa/Paperclip connector pollers auto-started (were never called)
- 30 duplicate alerts cleaned

## [0.4.4-alpha] - 2026-04-02

### Added
- Break-Glass Emergency Bypass with time-limited shield bypass
- Break-glass activation requires stated reason and "CONFIRM" confirmation
- Break-glass duration options (15m to 4h) with auto-expiry
- Persistent red warning banner with live countdown during bypass
- Break-glass audit trail with unscanned traffic count
- Break-glass status exposed in `/api/health`
- Configurable Data Retention per category (Traffic, Metrics, Correlations, Alerts, Audit)
- SOC 2 compliant audit trail with unlimited retention option
- Shield Rule Whitelist management with full 139-rule table
- Whitelist applies only to internal traffic (dashboard scans run all rules)
- LiteLLM Pre-Call Blocking (shield scan before request reaches AI model)

### Changed
- Node.js proxy decommissioned; all traffic flows through LiteLLM
- LiteLLM binding hardened from `0.0.0.0` to `127.0.0.1`
- "PROXY STATUS" renamed to "SHIELD STATUS"
- "PROXY SETTINGS" renamed to "SHIELD SETTINGS"
- Service watchdog checks every 5 minutes with auto-restart and alerts
- 3-day retention enforcement on startup and hourly

### Fixed
- TS2802 Set iteration error resolved for production builds

### Security
- Fail-closed architecture enforced (no bypass without break-glass)
- LiteLLM exact-pinned; current verified pin is 1.84.10
- All dependencies exact-pinned with no version ranges

### Migration Notes
- **LiteLLM pinning.** Deployments MUST NOT `pip install --upgrade` LiteLLM. Reinstall by exact version from `litellm/requirements.txt`. See `docs/12-deployment-guide.md`.
- **LiteLLM binding change.** LiteLLM now binds to `127.0.0.1:4001` only; external access requires an authenticated reverse proxy.

## [0.4.3-alpha] - 2026-04-01

### Added
- LiteLLM integration (Python proxy on port 4001 with ClawNexLogger callback)
- Session Log Watcher for retroactive OpenClaw JSONL session scanning
- Traffic Monitor with filtering by source, model, provider, verdict, and score
- Balanced traffic query using UNION across sources
- Database schema with 15 tables, 13+ indexes, and WAL mode

## [0.4.2-alpha] - 2026-03-31

### Added
- 139-rule Prompt Shield across 10 threat categories
- Severity-weighted scoring engine with BLOCK/REVIEW/ALLOW verdicts
- PII redaction (emails, phones, SSNs, credit cards, DOBs, passports)
- Outbound scanning for data leak detection on model responses
- Live Input Scanner for manual prompt testing

## [0.4.1-alpha] - 2026-03-31

### Added
- 19-tab SOC Dashboard (Fleet Command through Configuration)
- Alert Management with create, deduplicate, acknowledge, and resolve
- Correlation Engine for multi-event pattern matching
- SSE real-time updates via Server-Sent Events
- Dark SOC theme with branded color palette

## [0.4.0-alpha] - 2026-03-31

### Added
- Initial project scaffolding (Next.js 14, TypeScript, Tailwind CSS)
- SQLite database with better-sqlite3
- Environment configuration system
- OpenClaw WebSocket connector
- LM Studio health check connector
- Basic API routing
