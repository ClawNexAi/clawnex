# ClawNex Release Notes & Changelog

**Document ID:** CLAWNEX-REL-001
**Version:** 1.20
**Classification:** For Distribution
**Last Updated:** 2026-06-12
**Status:** Living Document

**See also:** `20-product-roadmap.md`, `21-project-history.md`, `14-data-dictionary.md`, `11-security-architecture.md`, `12-deployment-guide.md`.

---

## Release Metadata Conventions

Each release entry below is structured against a fixed metadata contract so that release managers, change advisory boards, and procurement can consume the document without reading narrative prose:

| Field | Meaning |
|-------|---------|
| Release Date | Calendar date the build was tagged for distribution |
| Version | Semantic version plus release stage (`alpha` / `beta` / `rc` / GA) |
| Type | `alpha`, `beta`, `rc`, `GA`, `hotfix` |
| Scope | New features, bugfixes, security fixes, breaking changes, deprecations |
| Upgrade Path | Supported source version(s) and procedure |
| Known Issues | Caveats that did not block release |
| Breaking Changes | Explicit callouts requiring operator action |
| Deprecations | Items marked for removal with target release |
| Security Fixes | Findings addressed, with CVE/CX reference when available |
| Verified Platforms | OS / Node / Python matrix exercised before release |

---

## Current Release: v0.15.0-alpha (2026-06-12) — Veracity audit + behavioral proofs + shield-verdict floor + macOS build unblock + de-identification

**Release Date:** 2026-06-12 (veracity audit + behavioral-proof + de-identification work landed under the existing v0.15.0-alpha tag — no version bump)
**Version:** v0.15.0-alpha
**Type:** Alpha (documentation-veracity + behavioral hardening + build fix; no new operator-visible features)
**Status:** Local-only `main`. Not pushed to remote.
**Scope:** A truth-in-documentation pass verifying the dashboard's own counts, posture readings, and public API against actual code behavior; one behavioral shield-verdict floor; behavioral proofs of the shield / correlation / audit claims against a live target; the macOS `next build` blocker resolved on Next 16; and a de-identification sweep ahead of OSS release.
**Upgrade Path:** Source: any v0.14.x-alpha or the 2026-05-17 v0.15.0-alpha build. In-place upgrade (`npm run build` + service restart). No schema migration.
**Breaking Changes:** None.
**Security Fixes:** V-B1 — shield verdict engine now floors ANY HIGH-severity detection to at least REVIEW (CRITICAL still BLOCK). A HIGH detection in a non-outbound-leak category (e.g. C2 exfil to `webhook.site` / `ngrok`, reverse-shell command, jailbreak) that scored below the 25-point REVIEW threshold *in isolation* previously returned ALLOW. Verified live (`webhook.site` exfil ALLOW → REVIEW) + hermetic. Verifier: `verify-verdict-high-floor`.

**Veracity audit — six factual-drift fixes:**

- **F1 — Trust Audit rule count corrected 14 → 15.** Now derived from a client-safe `TRUST_AUDIT_RULE_COUNT` mirror of `AUDIT_RULES` so the tooltip can't drift from the engine.
- **F2 — Panel count corrected to 26.** Scattered 22 / 23 / 25 claims reconciled to the canonical 26 (the guided tour narrates all `Object.keys(PANEL_HELP)` = 26 panels).
- **F3 — Single shared posture reconciliation.** A shared `reconcilePosture` in `metric-semantics.ts` now backs every posture surface; the fleet fallback is honestly labeled **"Fleet est. (N)"** rather than presented as an exact reading.
- **F4 — Public `/api/v1/fleet` alert count now applies the production-origin filter** for parity with the internal `/api/fleet` — both endpoints report the same number.
- **F5 — `TokenCostPanel` surfaces a total fetch failure** instead of silently displaying stale data as if it were live.
- **F6 — Stale "155 shield rules" corrected to 163.** Current-claim sites updated; genuinely-historical scope statements left untouched.

**Behavioral proofs (claims demonstrated against a running target, not inferred from source):**

- Shield blocks real attacks — 26/26 hermetic + live.
- All 10 correlation rules fire — `verify-correlation-rules` 23/23 + live end-to-end incidents.
- Audit trail truthful — `verify-audit-completeness` 15/15 + 208 live stdout-mirror lines.
- Six new verifiers — `verify-posture-reconciliation`, `verify-count-claims`, `verify-v1-fleet-origin-filter`, `verify-verdict-high-floor`, `verify-correlation-rules`, `verify-audit-completeness`. Full verifier suite now **59 green**.

**Build / platform:**

- **macOS `next build` blocker resolved on Next 16.** The production build that had been failing on the macOS development host (failure originated under Next 14) now completes cleanly on Next 16.

**De-identification sweep (ahead of OSS release):**

- Named personas replaced with neutral roles (`implementation-agent` / `internal-reviewer`); GitHub org references normalized to `clawnexai/clawnex`. Live QA confirmed the running build is persona-clean.

---

### Within-release security pass: v0.15.0-alpha (2026-05-17) — Chat relay scan/forward parity + Codex 6-round closure + DAST clean pass

**Release Date:** 2026-05-17 (version bump from prior v0.14.5-alpha tag landing the chat-relay hardening + DAST Run 3 closure work under the new v0.15.0-alpha tag)
**Version:** v0.15.0-alpha
**Type:** Alpha (security hardening + audit evidence; no new operator-visible features)
**Status:** Public release line.
**Scope:** Security validation and hardening pass before public source release. The public validation summary reports zero open Critical, High, or Medium findings in the tested public-launch posture.
**Upgrade Path:** Source: any v0.14.x-alpha. In-place upgrade. **One breaking contract change** on chat routes (see Breaking Changes below).
**Breaking Changes:**
- `/api/v1/chat/completions` and `/api/chat` now strictly validate `messages[]` / `history[]` entries against the documented message contract. Invalid message shapes now receive 400. The positive contract is documented in [`docs/10-api-reference.md`](10-api-reference.md).
**Latest commit:** `a07fea6`.

**Security hardening — public summary:**

- Chat relay inputs are strictly validated before being routed upstream.
- Prompt Shield scan/forward parity was reviewed and regression-tested.
- Authentication, RBAC, CSRF, anonymous information exposure, API input validation, security headers, and deployment posture were included in the validation scope.
- Public source was checked for source completeness and committed secrets before launch.

Public evidence lives in [`security-validation-summary.md`](security-validation-summary.md), [`security-assessment-summary.md`](security-assessment-summary.md), and [`security-roadmap.md`](security-roadmap.md).

---

## Previous: v0.14.5-alpha (2026-05-08) — Triage Graph end-to-end + Stat lift + Tailscale-only deploy support

**Release Date:** 2026-05-08 (no version bump — additive work landed under the existing v0.14.5-alpha tag)
**Version:** v0.14.5-alpha
**Type:** Alpha (additive feature work + UX polish + deploy infra)
**Status:** Local-only `main`. Not yet pushed to staging host.
**Scope:** Twelve commits land between the reviewer's verb-taxonomy sign-off (`5b69e8f`, 2026-05-07) and end-of-day 2026-05-08 (`eba1922`). The Action Queue's Triage Graph reaches end-to-end completeness — Phase 5 family resolvers + Phase 6 upstream rawSource producers — so all 9 source families now drill into a 5-stage triage card. Stat tiles across the dashboard read as elevated panels. Deploy script gains Tailscale-only support for private test boxes; LiteLLM bootstrap on fresh Linux is now distro-agnostic.
**Upgrade Path:** Source: any v0.14.x-alpha. In-place upgrade (`npm run build` + service restart). No schema migration. Drop-in.
**Breaking Changes:** None.
**Latest commit:** `eba1922`.

**What this means for the operator (Triage Graph):**
- Click `Investigate ▸` on any Action Queue row and the inline Triage Graph card now opens regardless of the row's source family. Before this release: 4 of 9 families dispatched (alert / cost-signal / collector-health / trust-audit); after this release: all 9 families dispatch with per-family stage copy and navigation targets. The 5 newly-wired families: correlation (multi-source signal join), blast-radius (root-signal propagation), auth-rbac (5 finding kinds: rbac_off / overprovisioned_role / missing_permission_check / stale_session / shared_admin_account), update-cve (per-CVE row), policy-warning (3 scopes: shield_rule / policy_default / config_drift).
- Each per-family resolver builds the canonical 5 stages (Evidence → Source Event → Affected Object → Related Activity → Fix / Control). Operators see source-aware copy in every stage; no generic-fallback "we don't know what this is" cards.
- 5 upstream producers now actually emit rows for those 5 dispatch-ready families — before this release, the resolvers existed but no rows reached them in default fixtures. After: top-10 CVEs by CVSS, 3 most-recent CRIT alerts → blast graphs, RBAC-off + overprovisioned-role detector, low-confidence + stale Shield rule scanner, multi-source correlation in a 10-minute window all surface in Mission Control's Top Action Queue under live data.

**What this means for the operator (visual):**
- Every numbered Stat tile across the dashboard now reads as an elevated panel — clearer separation from the surrounding card chrome, slightly stronger cyan border on hover, no flatness regression. Visible on Mission Control KPI row, Fleet Command stat strip, Instance Detail 8-stat row, CVE Database, Traffic Monitor, Token & Cost Intel, Correlations, and Access Control.
- Long Timeline panels paginate at 10 rows / page (default-open) so the panel no longer pushes its footer below the fold. Same pagination shape as Shield Tests.
- Blast Radius "Most Exposed Surfaces" displays an em dash in muted italic when an exposure value is unknown / missing, so a missing data point can't read as "no exposure."
- Alerts row spacing is tightened to match Shield Tests density (single-line collapsed cards, same padding/radius scale).

**What this means for the operator (deploy):**
- **Path A — Tailscale-only test boxes** (new). Same `scripts/deploy-prod.sh` works for private tailnet boxes (e.g. `<tailscale-hostname>`) — the install script auto-detects the `.ts.net` suffix and skips the public DNS preflight. Operator hand-finishes the box with `tailscale cert` + a Tailscale-aware Caddyfile (full template in `docs/12-deployment-guide.md` §5.3.3). Path B (public domain via Caddy + Let's Encrypt, used by staging host / <qa-host>) is unchanged.
- **Portable LiteLLM bootstrap.** Fresh Ubuntu 24.04 boxes don't ship python3.12 by default. The install script now downloads Astral's python-build-standalone binary and stands up a portable venv — no apt PPA required, no distro-specific paths. Operators redeploying onto a fresh box no longer have to pre-install a Python toolchain.
- **Three-surface health gate.** The deploy script's final `[8/8]` smoke check now verifies dashboard `/api/health` AND LiteLLM port 4001 AND Caddy port 443. A redeploy where Caddy crashes silently used to slip through; now the deploy fails closed if any of the three is missing.
- **Remote user parameterization.** `chown` and preserve-paths now use `$USER:$USER` from the SSH-connected account, not the hardcoded `<operator-user>`. Deploys to test boxes where the SSH user isn't `<operator-user>` no longer leave the install owned by a non-existent account.

**Verifier coverage:**
- `npx tsc --noEmit` — clean.
- `npx tsx scripts/verify-action-verbs.ts` — 72 PASS (carried over from v0.14.5).
- `npx tsx scripts/verify-triage-graph-contract.ts` — 236 assertions PASS (extended for 5 new resolvers).
- `npx tsx scripts/verify-phase6-producers.ts` — 25 assertions PASS (5 producers × 5 contract checks each).
- 130 new synonym-denylist assertions across `verify-correlation-resolver.ts` / `verify-blast-radius-resolver.ts` / `verify-auth-rbac-resolver.ts` / `verify-update-cve-resolver.ts` / `verify-policy-warning-resolver.ts`. Total verifier assertions across the test stack: 343.

**Verified Platforms:** local dev host (macOS 15.x / Node 22) — visual sweep + verifier suite green.

**Commit map (most-recent-first):** `eba1922` strip trailing punctuation from CVE package token · `2f6b534` CVE producer reads package from title · `7e219cc` Phase 6 rawSource producers (5 families) · `dc8296b` deploy [8/8] expanded health check · `6beacc4` portable python3.12 LiteLLM bootstrap · `0418c15` Alerts row spacing · `a6e4458` visual QA evidence preserved · `54a6dea` Timeline pagination + blast-radius unknown-state polish · `c7393d3` Tailscale-only deploy support + remote-user parameterization · `4a1771e` synonym-denylist sweep · `aeade4b` Stat tile lift + opt-in dimGlow · `a0a7cd5` Phase 5 family resolvers + dispatch verifier.

---

### Post-release security hardening (2026-05-13 → 2026-05-14, same v0.14.5-alpha tag)

A multi-batch security pass landed against three independent reviews (R13
recurring carry-over, R14 review, multi-vector adversarial assessment).
41+ findings closed; no API surface or schema breakage. Operators
running v0.14.5-alpha shipped before 2026-05-13 should redeploy against
the latest tarball to pick up these changes.

**Breaking deployment change:**

- **Docker mode removed entirely** (commits 51adedb → cfa6fc6). ClawNex
  is host-native — OpenClaw and Hermes observe host filesystem and
  processes, and the dashboard rewrites litellm/config.yaml in-place as
  part of provider auto-sync. Both patterns fight container isolation.
  v1.0 OSS launch surface is now Linux bare-metal + macOS only. Previous
  `docker-compose up` instructions in earlier docs / release notes are
  superseded by `bash install.sh` (single entrypoint, two modes).

**Security highlights (full list in commit log between `5cbdfd4` and
`9149f91` plus the `9252354` shield update):**

- Shield fail-CLOSED on scanner exception (was fail-OPEN — crash-the-
  scanner attack class eliminated)
- Shield NFKC + zero-width strip + Cyrillic/Greek confusables fold
  (Garak encoding.UnicodeConfusables probe now neutralized)
- Dashboard chat (`/api/chat`) gains shield scan — previously unscanned
- CSP migrated to per-request nonce (drop `'unsafe-inline'`)
- MCP HTTP SSE transport requires `MCP_API_KEY` (was no-auth)
- RBAC fail-closed at central guard (RBAC-off mode now localhost-only)
- CSRF defense independent of RBAC (Origin/Referer match enforced even
  when RBAC is off)
- `proxy_block_mode` default flipped from `'off'` to `'on'` on fresh
  installs (shield blocks by default; operator can opt to observe)
- Session cookie `sameSite='strict'` on all 4 setters
- Network-target guardrails on provider test and write paths.
- Workspace reader redacts `*_api_key` / token / secret values before
  returning to operators
- Rate limiter persists timestamps to SQLite (`rate_limit_buckets`
  table) — survives process restart
- Host Security install pins to a specific upstream commit + verifies
  SHA-256 of downloaded bytes
- SMTP enforces TLSv1.2+ regardless of `smtpTls` config
- Setup endpoint requires localhost when `SETUP_SECRET` is unset
- React + react-dom pinned to exact 18.3.1

**Verifier scripts added** (`scripts/verify-*.sh`, all PASS locally):
symlink-escape, post-redaction, rbac-fail-open,
workspace-secret-redaction, ssrf-guard, deploy-ssh-injection,
nfkc-normalization, nextjs-cves.

---

### Security validation closure pass (2026-05-15 → 2026-05-16, same v0.14.5-alpha tag)

Follow-up validation work closed the actionable findings identified during the pre-launch security campaign. The public validation posture is summarized in [`security-validation-summary.md`](security-validation-summary.md).

This release also includes the **Next.js 14 → 16 framework upgrade** that the prior DAST agent had advised for CVE coverage. Both the build (`next build --webpack`) and dev (`next dev --webpack`) scripts now pass `--webpack` explicitly because Next 16 defaults to Turbopack and refuses to start when a `webpack:` config is present without a corresponding `turbopack:` block. App-Router signatures changed: `params` is now `Promise<{...}>` (await before destructure), `headers()` and `cookies()` are async, `RootLayout` is async. `next` and `postcss` dropped from caret to exact pins per the dependency-pin policy.

---

### Security hardening campaign (2026-05-14, same v0.14.5-alpha tag)

A focused pre-launch security campaign improved localhost/public deployment separation, authentication behavior, shield fail-closed behavior, HTTP response hygiene, and installer/deploy defaults. The detailed internal evidence is not published; the public posture is summarized in [`security-validation-summary.md`](security-validation-summary.md) and [`security-roadmap.md`](security-roadmap.md).

---

## v0.11.6-alpha (2026-05-05) — Shield Tests row density + scroll fix

**Release Date:** 2026-05-05
**Version:** v0.11.6-alpha
**Type:** Alpha (patch release)
**Status:** LIVE on `https://<qa-host>`
**Scope:** UX patch — Shield Tests row density + internal scroll. Single-line cards (~50px) instead of two-line (~75px), wrapped in a `maxHeight: 600 / overflowY: "auto"` container so 10 paginated rows fit inside the panel viewport without pushing the footer below the fold. Mirrors the Service Logs scroll pattern.
**Upgrade Path:** Supported source: v0.11.4-alpha or v0.11.5-alpha. Upgrade in place via `npm run build` + service restart. No schema migration. Drop-in patch.
**Breaking Changes:** None.
**Latest commit:** `04a2fed` (Pass 2 doc sweep) — runtime patch landed in commit `36caa01`; v0.11.6-alpha tarball at `deploy/clawnex-v0.11.6-alpha-deploy.tar.gz`.

**Changed:**
- **Shield Tests row density** — collapsed header trimmed from two-line to single-line. The payload-preview line is removed from the collapsed view (full payload still renders in the expanded body). Padding `10px 14px` → `8px 12px`; icon font-size 16 → 14; card `borderRadius` 8 → 6; `marginBottom` between cards 12 → 6. Matches the Alerts & Incidents card density.
- **Internal scroll on Shield Tests list** — `pagedTests.map` wrapped in a `maxHeight: 600` / `overflowY: "auto"` container so 10 compact rows fit inside the viewport with a panel-internal scrollbar.

**Verified Platforms:** local dev host (macOS 15.x / Node 22) — operator-confirmed row density + scroll behavior matches reference screenshots. staging host (Ubuntu 24.04 / Node 22) — `npm run build` clean on remote, deploy succeeded, public health 200 with fresh Let's Encrypt cert. `npx tsc --noEmit` clean. 12 FinOps verify scripts → 162/162 assertions PASS. 40/40 evidence deep-link assertions still PASS.

---

## v0.11.5-alpha (2026-05-05) — Rule-of-5 pagination sweep + Blast Radius KPI rewrite

**Release Date:** 2026-05-05
**Version:** v0.11.5-alpha
**Type:** Alpha (patch release — superseded same-day by v0.11.6-alpha)
**Scope:** UX patch rolling up the operator's local dev host smoke-test findings on v0.11.4-alpha into one drop. Two themes: pagination coverage gap + Blast Radius operator-readability. Extracted `PaginationFooter` shared component (`src/components/dashboard/shared.tsx`); applied `default 5/page; options [5,10,15,25,50]; footer hidden when totalPages <= 1` standard to every operator-facing list with > 5 rows. Rewrote all 6 Blast Radius KPI tooltips in plain operator language (per operator: "speak in 6th grade English") and trimmed the overflow on the "Max blast radius" header.
**Upgrade Path:** Skip — go straight to v0.11.6-alpha.
**Breaking Changes:** None.
**Latest commit:** `eade25d` (sweep) + `5c8ad10` (release).

**Changed (paginated):**
- Live Traffic, Risk Acceptances (Active + Expiring + Resolved), Trust Audit findings, Agents & Sessions card grid, Configuration → Active SeedTraffic runs, Infrastructure services list, Shield Whitelist, Tools & Access (Tool Inventory + Per-Agent Permissions), CVE Database (default 10), Hardening checks (default 10), Remediation Suggestions, Posture by Instance, Shield Tests (default 10), System/Workspace/Paperclip Skills, Cost By Agent, Policies list + per-policy rules.
- Blast Radius — "Max blast radius (worst-case reachability edge)" → "Max blast radius" (overflow fixed; full text moved into tooltip body); all 6 KPI tooltip bodies rewritten in plain language with concrete examples (Discord, Telegram, Slack, etc.).

---

## v0.11.4-alpha (2026-05-05) — EVD flicker + back-button race fix

**Release Date:** 2026-05-05
**Version:** v0.11.4-alpha
**Type:** Alpha (patch release — superseded same-day by v0.11.5-alpha + v0.11.6-alpha)
**Scope:** Patch release fixing four React anti-patterns surfaced by Wave 1 alert→evidence deep-link traffic on v0.11.3-alpha during local dev host pre-staging host test. Two pre-dated v0.11.3 in latent form (inner-component anti-pattern + URL-hash selector instability); two were introduced by the deep-link wiring itself (lastDeepLinkRef memoization gap + Back-to-Incident raf race).
**Upgrade Path:** Skip — go straight to v0.11.6-alpha.
**Breaking Changes:** None.
**Latest commit:** `402e85d`.

**Fixed:**
- **AuditEvidencePanel infinite refetch loop.** `urlState.status ?? []`, `actor ?? []`, and `source ?? []` were producing fresh empty arrays on every render. `fetchAudit`'s `useCallback` therefore invalidated every render → its `useEffect` re-ran every render → the 30s polling interval was destroyed and recreated each time, with a fresh fetch fired immediately. The intended 30s cadence collapsed into a tight loop bounded only by network RTT (5–20 fetches/second on local dev host). Symptom: result count flickering 500↔343 because concurrent fetches resolved out-of-order at the 500-row sliding-window boundary. Fix: wrap the three array selectors in `useMemo` keyed off the underlying URL value.
- **EVD detail card unmount/remount on every parent render.** `EvidenceDetail`, `ShieldEvidenceDetail`, `BackToIncidentBreadcrumb`, and `CorrelationPill` were defined as inner JSX components inside the panel — every parent render produced new function identities; React's reconciler compared element `.type` by reference and treated each as a fresh component type. Combined with the 1s freshness ticker, the detail blinked every second. Fix: convert all four to render-helper function calls (`renderEvidenceDetail(e, outsideWindow)`) instead of JSX components.
- **Poll-driven re-fetch + re-scroll on the deep-link.** Even after fixing the refetch loop, the effect at `[selectedEvidence, apiEvents]` re-ran on every legitimate 30s poll because `apiEvents` is a new array reference each settle. Each poll re-fetched `/api/audit/[id]`, re-fetched correlation_method, and re-ran `scrollIntoView` — making the page jump back to the EVD row every poll cycle. Fix: `lastDeepLinkRef` memoizes per-selection deep-link work.
- **Back to Incident button visibly did nothing.** AlertsIncidentsPanel's focus effect was calling `onAlertFocusConsumed?.()` synchronously after scheduling `requestAnimationFrame(...)`. The parent's resulting `setAlertFocus(null)` triggered the effect cleanup, which called `cancelAnimationFrame(raf)` BEFORE the browser fired the raf — so scroll/expand/highlight never ran. Fix: gate effect on `apiAlerts !== null` AND move the consume call INSIDE the raf callback.

**Verified Platforms:** local dev host (macOS 15.x / Node 22) live test — stable result count, no EVD blink, back button scrolls + expands + highlights as expected. staging host (Ubuntu 24.04 / Node 22) — `npm run build` clean on remote, deploy succeeded, https://<qa-host> health 200 with fresh Let's Encrypt cert. `npx tsc --noEmit` clean. 12 FinOps verify scripts (`scripts/verify-*cost*.ts`) — 162/162 assertions PASS. 40/40 evidence deep-link assertions still pass (`scripts/verify-evidence-deep-link.ts`).

**Known Issues:**
- **macOS local `next build` — environment-dependent, status open.** the reviewer's independent clean detached build at HEAD `04a2fed` PASSED with `npm run build` exit 0; my own clean detached build at the same HEAD on the same Mac (Darwin 25.3.0, Node v22.22.0, Next.js 14.2.35) still FAILS with `PageNotFoundError: Cannot find module for page: /api/access-control` even after `pkill -9 -f next`, `rm -rf .next node_modules/.cache .turbo`. The discrepancy is unexplained — same commit, same machine, different worktree/env state somewhere. Tracked on the launch checklist (`docs/go-live-checklist.md` Phase 2) until reproduced consistently or root-caused. Linux production deploys are unaffected (staging host builds via `npm run build` on Linux remote and just shipped v0.11.6-alpha cleanly).

---

## v0.11.3-alpha (2026-05-05) — Time-window-proof evidence link + Back to Incident breadcrumb

**Release Date:** 2026-05-05
**Version:** v0.11.3-alpha
**Type:** Alpha (patch release — superseded same-day by v0.11.4-alpha)
**Scope:** Wave 1 of the reviewer's alert→evidence backlink hardening. Closed the v0.11.2-alpha gap where an alert pointing at an audit row outside the dashboard's current time window surfaced a "NOT IN WINDOW" notice that put the operator at fault. Also introduced the "Back to Incident" breadcrumb and "Best match" correlation labeling.
**Upgrade Path:** Skip — go straight to v0.11.6-alpha. v0.11.3-alpha shipped with four React render anti-patterns (latent for two, introduced for two) that v0.11.4-alpha fixes. v0.11.3-alpha tarball is obsolete.
**Breaking Changes:** None.
**Latest commit:** `61e7173` (followed by `402e85d` which is v0.11.4-alpha).

**Added:**
- `GET /api/audit/[id]` — RBAC-gated (`audit:read`) single-row fetch endpoint that bypasses the time-window filter the parent `/api/audit` list endpoint applies. Returns `{ event: AuditRecord }` on hit, `404` on miss. Localhost-fallback matches `/api/alerts/[id]/evidence` pattern. Picked a separate dynamic route over extending `/api/audit?id=...` because it avoids modifying `audit-logger.ts` (forbidden), aligns with the existing `/api/alerts/[id]/evidence` pattern, and keeps single-row contract structurally separate from list pagination/filtering.
- "Back to Incident" breadcrumb on EVD detail when navigation arrived via an alert. Click → `onNavigate("alertsIncidents", { focusAlertId })`. AlertsIncidentsPanel scrolls the originating alert into view, expands it, and briefly highlights it.
- "Best-match" labeling on EVD detail: forward-link rows show a green "Exact match (audit_event_id)" pill; fallback-correlated rows show an amber "Best match — fallback by session + ±60s" pill with tooltip explaining the heuristic. Distinguishes deterministic links from heuristic correlations.
- `scripts/verify-evidence-deep-link.ts` — hermetic verification harness covering the reviewer's six acceptance tests (exact-token proof, deterministic link, old evidence, return path, fallback labeling, regression check). 40 assertions, all green.

**Changed:**
- AuditEvidencePanel uses the new fetch-by-id endpoint when `focusedAuditId` is set. If the row is in the time-window-filtered events list, render via the existing path; if it's NOT in the list, render anyway with an *informational* "Outside current window" notice (replaces v0.11.2's blocking-tone "widen the time filter to find it" copy that put the operator at fault).
- Filter-state restore semantics: `savedFilterStateRef` captures `status` / `actor` / `source` / `q` / `currentPage` BEFORE the deep-link clears them; restores on `setSelectedEvidence(null)` (the single dismissal point covering Close / Back to Incident / focus consumed). the reviewer's regression test #6 — Audit panel filters no longer permanently broken for normal browsing after a deep-link visit.

**Fixed:**
- v0.11.2-alpha shipped the Audit deep-link with a "NOT IN WINDOW" notice when the audit row was outside the current time window. The notice was technically accurate but operationally unhelpful — internal reviewer flagged this as putting the operator at fault for a state the system created. Wave 1 fixes this by surfacing the row regardless of time-window filter via the new fetch-by-id endpoint.

**Verified Platforms:** local dev host (macOS 15.x / Node 22) hermetic harness 40/40 PASS + live API probe (`GET /api/audit/<known-id>` 200 with full payload, `GET /api/audit/<bogus-id>` 404). 12 FinOps verify scripts 162/162 PASS. `npx tsc --noEmit` clean.

---

## v0.11.2-alpha (2026-05-05) — Alert → Evidence deep-link refinement

**Release Date:** 2026-05-05
**Version:** v0.11.2-alpha
**Type:** Alpha (patch release — superseded same-day by v0.11.3-alpha + v0.11.4-alpha)
**Scope:** Patch release fixing the v0.11.1-alpha View Evidence behavior to deep-link to the exact EVD row in the Audit & Evidence tab instead of inline-expanding within the alert card. operator feedback: "taking me to the main Audit & Evidence tab is not good enough." Replaced inline-expand with proper navigation that pre-selects the target row, scrolls it into view, and clears filters that would have hidden it.
**Upgrade Path:** Skip — go straight to v0.11.6-alpha.
**Breaking Changes:** None.
**Latest commit:** `6c2b3a2`.

**Changed:**
- View Evidence button on AlertsIncidentsPanel now triggers proper navigation: `onNavigate("auditEvidence", { id, focus: "evidence" })` instead of inline-expanding. Mirrors the established `configFocus` deep-link pattern at `index.tsx:135` (the same mechanism used for `Configuration → shieldSettings`, `policiesAndRules`, etc.).
- AuditEvidencePanel receives a new `focusedAuditId` prop. When set: filters cleared (so the target row isn't excluded by stale actor/source/q selections), `currentPage` reset to 0, target row's detail panel opened (`setSelectedEvidence`), detail scrolled into view via `scrollIntoView({ behavior: 'smooth' })`, then `onConsumed()` called to let the parent reset focus state.
- Dashboard root (`src/components/dashboard/index.tsx`) gained `auditFocus` state alongside the existing `configFocus`.

**Fixed:**
- v0.11.1-alpha shipped View Evidence as inline-expand only — the v1 simplification to ship faster. operator correctly flagged this as insufficient: an alert→evidence link should take the operator to the actual evidence surface, not preview it in-place.

**Known Issues at v0.11.2 (closed in v0.11.3-alpha):**
- ~~If the focused audit row isn't in the panel's currently fetched time window, AuditEvidencePanel surfaces a "NOT IN WINDOW" notice with widen-the-filter guidance + a Dismiss button. Fetch-by-id on `/api/audit` doesn't exist yet — the existing endpoint queries by filter window. v1.1 candidate.~~ → **Closed in v0.11.3-alpha**: `/api/audit/[id]` fetch-by-id endpoint shipped, AuditEvidencePanel now renders the row anyway with an informational "Outside current window" notice.

**Verified Platforms:** local dev host (macOS 15.x / Node 22), staging host (Ubuntu 24.04 / Node 22) — `npx tsc --noEmit` clean; `npx next build` ✓ Compiled successfully on Linux; 12 FinOps verify scripts (162 / 162 assertions PASS); 15-invariant policy evaluator harness PASS; 10-probe verify-policy-framework harness PASS; 26/26 release-grade Shield Tests PASS.

---

## v0.11.1-alpha (2026-05-05) — Alert → Evidence backlink (v1)

**Release Date:** 2026-05-05
**Version:** v0.11.1-alpha
**Type:** Alpha (patch release)
**Scope:** Closes the alert→evidence visibility gap operator flagged during v0.11.0-alpha visual smoke. Every Session Shield alert now exposes a View Evidence backlink that resolves to the exact `audit_log` row that triggered it, with the matched rule key, the scanner-redacted matched sample, and a match-centered snippet of the redacted payload. v0.11.2-alpha replaced the inline-expand UX with a proper deep-link.
**Upgrade Path:** Supported source: v0.11.0-alpha. Upgrade in place via `npm run build` + service restart. No schema migration. session-watcher alerts written after upgrade carry the new metadata; legacy alerts use the fallback correlation path.
**Breaking Changes:** None.

**Added:**
- `GET /api/alerts/[id]/evidence` — RBAC-gated (`audit:read`) endpoint that resolves an alert to its triggering audit event. Forward link via `alert.metadata.audit_event_id` (new alerts); fallback correlation for legacy alerts via `(source='session-watcher', action IN shield_review|shield_detected, resource_id=<session_id parsed from description>)` taking the nearest match within ±60s of `alert.created_at`. Response includes detections array, matched_snippets (±200 char windows around each detection's matched sample via `indexOf`), payload_excerpt, prompt_hash, proxy_traffic_id, and a `correlation_method` indicator (`forward` vs `fallback_nearest`).
- View Evidence button on AlertsIncidentsPanel — shown only when alert source is `session-watcher` OR `alert.metadata.audit_event_id` is set.
- Structured shield evidence view in AuditEvidencePanel — when a `shield_review`/`shield_detected` audit row is selected, the detail surfaces parsed rule_key + matched sample + match-centered snippet for each detection.
- session-watcher alerts now carry rich metadata: `audit_event_id`, `source_event_id` (proxy_traffic.id), `session_id`, `direction`, `model`, `provider`, `verdict`, `score`, `detection_count`, `primary_rule_key`, `primary_rule_name`. Audit `detail` JSON now stores structured `shield_detections`, `payload_excerpt` (with `redact()` applied for privacy), `prompt_hash`, `proxy_traffic_id`.
- New `EvidencePayload`, `EvidenceMatchedSnippet`, `EvidenceShieldDetection` types in `src/components/dashboard/types.ts`.

**Known Issues:**
- Match-centered snippet uses `payload.indexOf(detection.sample)` to find the offset. The scanner produces partial-redacted samples (e.g. `+1-555-XXX-XXXX`), and `redact()` then rewrites the same span to `[PHONE_REDACTED]` in the persisted excerpt — so `indexOf` returns -1 for those rows. In that case the response sets `match_found_in_excerpt: false` and the UI surfaces the sample alone (with rule_key + redacted surrounding context) rather than fabricating a position. True match-centering requires per-detection ±200-char windowing at scan time before `redact()` runs — deferred to v1.1.

---

## v0.11.0-alpha (2026-05-04) — Token Cost FinOps Reporting v1

**Release Date:** 2026-05-04
**Version:** v0.11.0-alpha
**Type:** Alpha (significant follow-up to v0.10.0-alpha)
**Scope:** Multi-source Token Cost FinOps reporting pipeline that normalizes LLM cost telemetry across **OpenClaw, Hermes, and Paperclip** into a single canonical row shape with explicit trust labels (Estimated / Actual / Recomputed / Included / Token-only / Unknown), five lightweight drain-detection signals (Possible repeated-call loop / Spend velocity spike / Context bloat risk / Cache hit drop / Cache hit drop risk / Simple task on expensive model), per-source totals with a "Highest reported monitored spend" headline that explicitly avoids cross-source summing, click-to-filter SignalsCard with inline evidence expansion, instance-dropdown source-routing through the orchestrator, dashboard-wide pagination on long sub-cards (default 5/page; options 5/10/15/25/50), drop of the Metric Aggregation TOTAL column, `signal_context` adapter-owned private side-channel for Hermes system-prompt hashing that never crosses the API boundary, `Hide delivery-mirror` global toggle, ~30 header tooltips across the Token & Cost Intel tab, accessibility upgrade on Signals counter rows from clickable divs to native buttons with `:focus-visible` outline, and a HelpPanel **Glossary** section at the bottom of Help (62 terms across 10 categories) that turns dashboard jargon into operator-readable definitions.
**Upgrade Path:** Supported source: v0.10.0-alpha. Upgrade in place via `npm run build` + service restart. No schema migration — the FinOps pipeline reads existing OpenClaw JSONL session files, Hermes `~/.hermes/state.db`, and Paperclip via the existing connector. `/api/tokens` response gains additive fields; legacy fields preserved.
**Branch:** `token-cost-finops-reporting-v1` (32 commits, ff-merged to main, branch deleted).
**Breaking Changes:** None at the API surface (additive only). UI: Metric Aggregation TOTAL column dropped — point-in-time snapshot metrics produced mathematically meaningless sums.

**Added:**
- Token Cost FinOps Reporting v1 — spec at `docs/superpowers/specs/2026-05-04-token-cost-finops-reporting-design.md`, plan at `docs/superpowers/plans/2026-05-04-token-cost-finops-reporting-plan.md`. Three source adapters (OpenClaw JSONL at `src/lib/adapters/openclaw-cost-adapter.ts`, Hermes state.db at `src/lib/adapters/hermes-cost-adapter.ts`, Paperclip finance-events HTTP at `src/lib/adapters/paperclip-cost-adapter.ts`) emit a canonical `NormalizedRow` shape preserving privacy guarantees. Orchestrator at `src/lib/services/cost-reporting.ts` with status-downgrade rule, recompute zero-rate guard, indexed `Promise.allSettled` rejected fallback, instance routing, and stripped `signal_context` side-channel before the API response. Five drain detectors at `src/lib/services/cost-signals.ts` with explicit guards. New `/api/tokens` response fields (`rows`, `perSource`, `headline`, `signals`, `warnings`, `sourceStatus`) alongside legacy fields. 12 FinOps verify scripts under `scripts/verify-*cost*.ts` (9 cost scripts + 3 adapter scripts: hermes, openclaw, paperclip) totaling 162 assertions.
- Token & Cost Intel UI: per-source totals row, "Highest reported monitored spend" headline tile, SignalsCard with click-to-filter and inline evidence expansion, source-status banner when adapters unreachable, inline trust + signal badges on Recent Token Events, `(Source)` suffix per row across Cost By Agent / Cost By Session, filter-pill banner with Clear ✕.
- Pagination on Cost By Session, Recent Token Events, and every Models & Cost sub-card.
- `Hide delivery-mirror` global toggle in TokenCostPanel header area.
- HelpPanel Glossary — 62 terms across 10 categories. Phase-2 tooltip-vs-glossary refinement pass with internal reviewer still pending.
- `pricing_version` snapshot on every recomputed cost row.
- 30+ header tooltips across Token & Cost Intel tab.
- Inline evidence expansion on SignalsCard active rows.
- `velocity_spike` filter fallback for Recent Events when `affected_row_ids` is empty.

**Changed:**
- Metric Aggregation (24h) TOTAL column dropped.
- Hermes adapter `agent` field is `null` in v1 — Hermes's `source` column carries channel/platform identity (`cli`, `telegram`), not agent identity.
- Hermes loop_risk groups by hash only — not `(agent, hash)` — per Gate-B blocker fix.
- OpenClaw `cost.*` fields no longer blanket-discarded — per-provider trust map drives whether to use them.
- SignalsCard counter rows converted from clickable `<div>`s to native `<button>` elements with `:focus-visible` outline.
- All Token Cost tables collapsed by default — auto-expand-on-filter for Recent Events when SignalsCard click activates a filter.
- SignalsCard relocated to render immediately above Recent Events for cause-effect proximity.
- Default page size on Cost By Session + Recent Events changed from 10 → 5.

**Fixed:**
- Instance dropdown (`hermes-local`, `main`, etc.) now honored across the new orchestrator path — was silently ignored.
- Webpack client-bundle leak: `display_cost_usd` extracted to `src/lib/cost-reporting-display.ts` (pure helper with type-only imports) so client panels don't pull `node:fs` / `node:path` via the orchestrator's adapter graph. `npx next build` now compiles successfully.
- C2 + H1 from overnight code review (2026-05-02) — `proxy_traffic` + JSONL double-count when OpenClaw routes through LiteLLM closed via prefer-JSONL dedupe; `computeVerdict` now runs on the full detection list before slicing for the response payload.

**Security:**
- `signal_context` adapter-owned private side-channel never crosses the API boundary — verified by static grep on the route source AND a runtime test.
- Hermes `system_prompt` plaintext stays inside the adapter scope: read for in-memory hashing only, never assigned to any returned `NormalizedRow` field, never persisted, never logged.
- OpenClaw token-reader's existing privacy guarantee preserved — `src/lib/adapters/openclaw-cost-adapter.ts` does NOT reference `message.content`, `message.parts`, `parts[*].text`, `body`, `prompt`, or `messages[*].content`. Enforced by static AST grep.

**Verified Platforms:** local dev host (macOS), staging host (Ubuntu 24.04 / Node 22) — 12 FinOps verify scripts 162/162 PASS, `tsc --noEmit` clean, `next build` clean on Linux.

---

## v0.10.0-alpha (2026-05-04) — Configurable Rule & Policy Framework

**Release Date:** 2026-05-04
**Version:** v0.10.0-alpha
**Type:** Alpha (P0 feature release)
**Scope:** Operator-authored DLP via the Configurable Rule & Policy Framework v1 — three orthogonal axes (source / lifecycle / action), three seed-rule helpers with separated safety gates, force-add `g` flag, `OUTBOUND_LEAK_RULE_KEYS` allow-list, vendor PATCH lockdown at the API boundary, iteration cap with auto-disable, 15-invariant + 10-probe verification harnesses, two starter policies (163 curated mirror + 12 enabled wire-active outbound starters + 2 disabled lab held drafts = 177 total seeded rules). Plus three earlier 2026-04-29 work-streams (internal reviewer M-01 metric-semantics findings, OpenClaw routing wire/revert/restart, dashboard seedtraffic with three-layer-gated Developer Tools), 2026-04-30 follow-ups (`productionOnly` filter on `/api/alerts`, About/Credits panel restructure), 2026-05-01 OpenClaw 4.12 transition sweep (Ed25519 device-identity handshake, capitalized agent names + role descriptions, status-bar update notifier, `scripts/deploy-prod.sh`, governance docs bundled in tarball, ~92 plain-English tooltip rewrites), and 2026-05-02 follow-ups (Cost by Session card, outbound-leak verdict early-out, redact-without-record asymmetry closed, posture pill in header).
**Upgrade Path:** Supported source: v0.9.2-alpha. Upgrade in place via `npm run build` + service restart. Schema migration runs automatically — adds `policies` + `policy_rules` tables. Migration is dual-key idempotent (`policy_framework_schema_version` + `policy_framework_seed_version`). Outbound DLP semantics preserved across the cutover via `OUTBOUND_LEAK_RULE_KEYS` allow-list.
**Branch:** `policy-framework-v1` (54 commits, ff-merged to main, branch deleted). Five internal reviewer paranoid-review rounds during Stage 4 + four more accuracy rounds against operator-facing copy.
**Breaking Changes:** None. `OUT-*` rule keys preserved in detection records and audit logs; `category="outbound-leak"` semantics preserved at the wire boundary.

**Added (Policy Framework v1):**
- Two new SQLite tables (`policies`, `policy_rules`) plus a TypeScript surface in `src/lib/shield/types.ts`.
- Two starter packs: `ClawNex Default` (`source = curated`, `lifecycle = starter`) — 163-rule operator-visible mirror; `Generic Egress Starter` (`source = system`, `lifecycle = starter`) — 12 enabled wire-active outbound starter rules + 2 lab-lifecycle held drafts (`JAIL-CREDENTIAL-EXTRACTION-REQUEST`, `OUT-GENERIC-API-KEY-SHAPE`).
- Policy evaluator at `src/lib/shield/policy-evaluator.ts` enforcing 15 invariants. `safe-regex2` ReDoS gate at save time. Span-based redaction helper at `src/lib/shield/redaction.ts` with fail-loud guards.
- Three seed-rule helpers with separated safety gates: `createRule` (full), `createCuratedMirrorRule` (compile-only), `createReviewedSeedRule` (compile-only + 5-key allow-list + required `safety_exemption_reason`).
- 5 endpoints under `/api/policies/*` with full CRUD + `/api/policies/:id/test`. Three new RBAC permissions: `policies:read`, `policies:write`, `policies:test`.
- `PoliciesAndRulesCard.tsx` with Add/Edit Policy + Add/Edit Rule + Test Pattern modals. Typed-phrase + reason confirm modal for disabling curated/system policies. Header warning ribbon when any vendor policy is disabled. Auto-disable after 5 consecutive iteration-cap hits.
- `scripts/policy-evaluator-invariants.ts` — 15-invariant hermetic harness. `scripts/verify-policy-framework.ts` — 10-probe DLP harness.

**Added (other 2026-04-29 → 2026-05-02 work-streams):**
- OpenClaw routing wire/revert/restart system + ClawNex-Managed sidecar (`~/.clawnex-routing-managed.json`).
- Dashboard seedtraffic with three-layer-gated Developer Tools card (env kill-switch + DB toggle + RBAC).
- `productionOnly` opt-in on `/api/alerts` filtering shield-test/demo/qa/simulation origins from headline counters.
- About/Credits panel restructure: Inner Circle / Development Team / AI Tooling disclosure.
- OpenClaw 4.12 device-identity handshake via Ed25519 keypair.
- Capitalized agent names + role descriptions sourced from `KNOWN_AGENT_ROLES`.
- Status-bar update notifier pill aggregating updates across OpenClaw / Host Security / ClawNex Shield Rules (actionable-only count).
- `scripts/deploy-prod.sh` durable parameterized production deploy.
- Governance docs bundled in deploy tarball (governance-index, one-pager, evidence checklist, 14 policies + README, both registers).
- ~92 plain-English tooltip rewrites.
- Cost by Session card on Token & Cost Intel.
- Outbound-leak verdict early-out: `computeVerdict` BLOCKs on any HIGH outbound-leak detection, REVIEWs on any MEDIUM.
- Posture pill in header (OBSERVE / BLOCKING) replacing the misleading "N SHIELD BLOCKS" pill on observe-mode installs.

**Verified Platforms:** local dev host (macOS), staging host (Ubuntu 24.04 / Node 22) — 15-invariant policy harness PASS, 10-probe DLP harness PASS, `tsc --noEmit` clean, `next build` clean.

## In Development: post-v0.11.2-alpha work on `main`

**Branch:** `main` (local-only, no remote push).
**Latest commit:** `6c2b3a2` (release: bump v0.11.1-alpha → v0.11.2-alpha).
**Status:** No work staged for the next release yet. v0.11.2-alpha is the current shipped release.

The historical content of the prior "In Development" block has been absorbed into the v0.10.0-alpha and v0.11.x-alpha release entries above. Two work-streams shipped 2026-04-29 (originally pre-merge to v0.10.0):

1. **internal reviewer M-01 metric-semantics findings closed in full.** Fleet Alert Summary now aggregates over the active scope (`?scope=active&limit=500` instead of the legacy 5-record sample); `getShieldHistory` applies `productionOriginSqlClause` by default so Shield History + instance-filtered Shield stats no longer leak `shield-test`/`demo`/`qa` origins; `/api/alerts` responses now include `scope`/`effectiveScope`/`include_suppressed` provenance metadata; `InstanceDetailPanel` uses explicit `?scope=all` for its chronological feed.

2. **OpenClaw routing wire/revert/restart system (net-new).** ClawNex now writes the LiteLLM bridge into `~/.openclaw/openclaw.json` for the operator, tracks ownership in a sidecar at `~/.clawnex-routing-managed.json` so operations are cleanly revertable, and restarts `openclaw-gateway` automatically using the platform's supervisor (systemd-user on Linux with `Linger=yes`, launchd on macOS). The Welcome Wizard's "Configure OpenClaw routing" step (5) becomes one-click instead of a three-step manual process. New surfaces in the Configuration → OpenClaw Routing card: Wire LiteLLM / Force Wire / Revert ClawNex Wire / Restart Gateway buttons + inline raw-sidecar disclosure for full operator transparency.

**Scope vs. v0.9.2:** OpenClaw schema is identical for our use case across 2026.3.x and 2026.4.x (verified via `docs.openclaw.ai/concepts/model-providers.md` + `docs.openclaw.ai/providers/litellm.md`); single direct-edit path supports both versions.

**Verification:** Type-check clean. `scripts/shield-triage.ts` reports release-grade 26/26 + 1 Coverage Lab (T04 known gap). `scripts/openclaw-routing-test.ts` 10-scenario sandbox cycle all pass (idempotent wire, idempotent revert, conflict guards, force-wire, SHA-mismatch preservation, parent cleanup, coexistence with other providers). staging host + test host supervisor reach verified live.

**See:** `CHANGELOG.md` Unreleased section for the full additive/change/fixed/security/migration breakdown.

A follow-up sweep landed 2026-05-01 covering the OpenClaw 4.12 transition + dashboard UX/integration:

3. **OpenClaw 4.12 connector device-identity handshake.** OpenClaw 2026.4.x added a separate device-pairing layer on top of the legacy `?token=` URL parameter. ClawNex's connector now generates an Ed25519 keypair on first run (PEMs persisted to `config_defaults`), derives `deviceId = sha256(rawPubkey).hex()` (matches OpenClaw's own `fingerprintPublicKey`), and signs the V2 device-auth payload that 4.12 expects. Backwards-compatible with 3.28 via an `if (nonce)` guard — older gateways that don't send a nonce in their challenge keep working unchanged.

4. **Status-bar update notifier**. New pill next to the version chip aggregating updates across OpenClaw / Host Security / ClawNex Shield Rules via `/api/config/updates`. Count is *actionable-only* (only Host Security has an in-app update path; OpenClaw upgrades happen outside per the never-touch-OpenClaw rule, and ClawNex Shield Rules rules ship bundled with ClawNex versions). Dropdown shows all three sources with an `INFO` tag on the non-actionable ones for awareness without misleading the count. Polls every 15 minutes; a `clawnex:updates-refreshed` window event triggers immediate re-fetch when an in-app update completes.

5. **Capitalized agent names + role descriptions** on Agent Workspace tabs and Agents & Sessions cards. Names live in openclaw.json (the `name` field is schema-allowed); role descriptions live in `src/lib/services/agent-roles.ts` (`KNOWN_AGENT_ROLES`) since OpenClaw 4.12's strict schema rejects `role`. Today's seed: Main, Neo, Trinity, Morpheus, Oracle, Agent Smith. `main` is pinned to position 0 in the tab bar with a green `DEFAULT` chip.

6. **Plain-English tooltip pass.** ~92 tooltips across the dashboard rewritten — header KPIs, ConfigurationPanel, PromptShield, AgentWorkspace, TrafficMonitor, FleetCommand, AuthMethods, TokenCost, ToolsAccess, ThreatScore, ShieldTests, Cve, blast-radius, AccessControl, AgentsSessions. Voice: lead with operator-facing meaning; drop `TipCode`-wrapped technical paths/identifiers. Bullets for multi-state explanations.

7. **`scripts/deploy-prod.sh`** — durable, parameterized production deploy. Supersedes the volatile `/tmp/deploy-prod-legacy.sh`. Flags: `--host`, `--domain`, `--version` (default reads from `package.json`), `--sudo-pass-stdin` / `--sudo-pass-env VAR` / interactive prompt, `--dry-run`, `--no-deep-clean`. OpenClaw preservation guard, deep-clean phase that targets only ClawNex-installed artifacts.

8. **Governance docs bundled in the deploy tarball** — `governance-index.md`, `governance-one-pager.md`, `policy-evidence-checklist.md`, all 14 policies + README, both registers (risk-register, vendor-inventory). The Governance panel was 404'ing because `package.sh` had been excluding them. Fixed in `deploy/package.sh`.

9. **Seed Test Correlation gated behind Developer Tools.** Consistent with the existing `/api/dev/*` and seedtraffic gating pattern. Hidden by default; expose via Configuration → Developer Tools.

10. **Misc UX fixes**: empty ROLE box on Agent Workspace panel (now sourced from `KNOWN_AGENT_ROLES`); `[object Object]` rendering when the gateway returns structured `role`/`model` (defensive `coerceToString`); update pill stuck at "X UPDATES" forever (Host Security version comparison was string-vs-semver — now mtime-vs-release-date); update pill green dot overlapping the "S" (Tooltip's `BlockAnchorIndicator` corner pip); Token Cost panel "Connected" indicator was OR'd with `health.status` (always true) — now reflects actual connector state; Agent Workspace showed `main`'s files for every agent (`workspace-reader` layout-convention drift); theme toggle SVG icon (orange sun / cyan moon) replaced fragile Unicode glyphs.

11. **Configurable Rule & Policy Framework v1 (`policy-framework-v1` branch).** A starter policy framework with operator-authoring built in. Two starter policies ship by default with **different runtime semantics**: `ClawNex Default` (`source = curated`, `lifecycle = starter`) — a 163-rule operator-visible **wire-inert mirror** of the inbound jailbreak / cognitive-tampering / secret / path detections the built-in shield runs from source (audit-visible reference data, NOT wire-active in v1); and `Generic Egress Starter` (`source = system`, `lifecycle = starter`) — **12 enabled outbound starter rules running on the wire**, comprising 7 PII families (email, phone, SSN, credit card, IPv4, date of birth, passport) and 5 outbound families (private key material, password assignment, env var leak, internal IP, database URI), plus **2 lab held drafts visible but disabled** (`JAIL-CREDENTIAL-EXTRACTION-REQUEST` and `OUT-GENERIC-API-KEY-SHAPE`) that operators can review the visible pattern and clone/copy into a custom policy after review (vendor rules can't be edited or enabled in place — clone-then-customize is the path). Three of the 12 enabled rules (PHONE_US, CREDIT_CARD, IPv4) and both held drafts route through `createReviewedSeedRule` with a hardcoded 5-key allow-list because their bounded patterns false-positive on `safe-regex2`'s static heuristic — explicit per-rule code-reviewed exemptions, not a generic bypass. Operator-authored DLP rules support literal substring (default) or opt-in regex with a 3-layer ReDoS defense (save-time `safe-regex2` static AST gate + 1024-char length cap + runtime `ITERATION_CAP = 1000` with auto-disable after 5 consecutive cap hits). Per-rule actions (`score` / `block` / `review` / `redact` / `allow`) with redact-span resolution that physically separates full match data from the truncated `samples` field. Per-rule literal exceptions with `rule_match_suppressed` audit events. RBAC: `policies:read` for all 5 roles, `policies:write` and `policies:test` for Admin + Security Manager only. 11 REST endpoints under `/api/policies/*` with full CRUD + the test endpoint. Disabling a vendor-shipped policy (`source IN ('curated', 'system')`) requires a typed-phrase confirmation plus a reason and lights an amber header warning ribbon across all dashboard tabs. Outbound-leak verdict semantics preserved across the OUT-* in-source-to-policy cutover via `OUTBOUND_LEAK_RULE_KEYS` allow-list at the scanner wire boundary. Migration is dual-key idempotent (`policy_framework_schema_version` + `policy_framework_seed_version`). **Enterprise EDM / DCM / OCR remain deferred** — those are enterprise-tier scope outside the OSS surface. Spec: `docs/superpowers/specs/2026-05-03-policy-framework-design.md`. Operator docs: `docs/06-basic-user-manual.md` Configuration → Policies & Rules. Engineer authoring guide: `docs/07-advanced-user-manual.md` §20. Architecture: `docs/18-developer-manual.md` §8 Policy framework subsection.

**See:** `CHANGELOG.md` Unreleased section for the full additive/change/fixed/security/migration breakdown.

---

## Previous Release: v0.9.2-alpha

**Release Date:** 2026-04-24
**Version:** v0.9.2-alpha
**Type:** Alpha (Magic Link auth backend — completes the v0.9.0 multi-auth surface)
**Status:** Alpha — Functional, under active development
**Scope:** Promotes Magic Link from a reserved "Coming Soon" UI stub to a live auth provider. Operators with an email address on their profile can request an email-delivered one-shot sign-in link when the admin has the provider turned on AND a mail provider is configured. Also includes the CX-D1…CX-D6 Codex-deferred auth enforcement audit — only `/api/permissiveness` needed a fix; the other five findings had been closed silently during v0.9.0 development.
**Upgrade Path:** Supported source: v0.9.1-alpha. Upgrade in place via `npm run build` + service restart. Schema migration runs automatically — adds `magic_link_tokens` table + two indexes. Magic Link is disabled by default; admins opt in via Authentication Methods.

### v0.9.2 — Magic Link auth backend + CX-D1…D6 audit

**Breaking Changes (v0.9.2):** None.

**Added (v0.9.2):**
- **Magic Link auth provider** — email-delivered one-shot sign-in. Raw token is 32 bytes base64url, only sha256(token) persists. 15-minute default TTL (`MAGIC_LINK_EXPIRY_MINUTES` env override, clamped 1-60). One-shot via atomic consumed_at UPDATE. Double-gate enablement: admin setting + mail provider configured.
- `/api/auth/magic-link/begin` — rate-limited 3/min/IP, case-insensitive email lookup, always returns the same success message (no enumeration).
- `/api/auth/magic-link/complete` — GET with `?token=...`, atomically validates and consumes; on success creates a session + redirects to `/`, on any failure redirects to `/login?error=magic_link_invalid` (single generic code).
- `magic_link_tokens` table in `src/lib/db/schema.ts` with `idx_magic_link_tokens_hash` + `idx_magic_link_tokens_operator` indexes.
- `src/lib/services/auth/providers/magic-link.ts` — provider module with `MAGIC_LINK_SETTINGS`, `isEnabled`, `isConfigured`, `getEffectiveConfig`, `generateAndStoreToken`, `invalidateOutstandingTokens`, `consumeToken`.
- `/api/auth/status` response now includes `magicLinkAvailable: boolean` for anonymous callers (matches the github anonymous pattern).
- `magicLink.enabled` toggle in Authentication Methods admin card — persists to `config_defaults.auth_magic_link_enabled`.
- Magic Link section rewritten on Auth & Devices card — LIVE / DISABLED badge driven by global availability.
- Login page `Email me a magic link` button — only renders when available; click expands into an inline email form; after submit shows a constant "check your email" message regardless of whether the email matched.

**Changed (v0.9.2):**
- `AuthProviderName` CSV parser in `src/lib/services/auth/index.ts` — `magic_link` promoted from reserved to `ENABLED_PROVIDERS`.
- `/api/config/auth-methods` GET returns real Magic Link effective state (`enabled`, `configured`, `available`, `note`) instead of a hardcoded stub; PUT accepts `{ magicLink: { enabled } }`.

**Security — CX-D1…D6 Codex-deferred audit (completed 2026-04-24):**
- **CX-D1** — full 119-route authentication sweep. 14 routes un-guarded, 13 intentionally anonymous (login / ceremony / health / csrf / forgot-password / setup / status / logout / v1 API-key paths). **1 real miss closed**: `/api/permissiveness` — route comment claimed "reuses existing RBAC middleware" but never called it. Now gated with `requireSession` + `requirePermission('config:read')`. 3 regression assertions added.
- **CX-D2** (`/api/chat`) — verified already triple-gated (`requireSession` + `chat:use` + `requireLocalhost`). No action.
- **CX-D3** (voice / avatar — `/api/voice/did`, `/api/voice/heygen`, `/api/voice/speak`, `/api/config/voice`) — all 4 routes gated with `voice:use` + localhost. No action.
- **CX-D4** (provider SSRF — `/api/config/providers/[id]/test`, `/api/config/gateways/[id]/test`) — both triple-gated with `config:write` + localhost. No action.
- **CX-D5** (install / restart / purge / migrate / litellm / uninstall / install-clawkeeper) — all gated with `system:manage` + localhost. No action.
- **CX-D6** (`/api/workspace`, `/api/workspace/file`, `/api/workspace/agents`) — all gated with `workspace:read`. No action.

**Migration (v0.9.2):**
- Schema migration runs automatically on first launch — creates `magic_link_tokens` + 2 indexes. Idempotent.
- Existing operators do NOT need to re-enroll or re-link anything. Magic Link is off by default and has no per-operator enrollment state.
- Admins who want Magic Link live flip the toggle in Configuration → Authentication Methods. Requires a configured mail provider (Resend / SMTP / Emailit in Mail Configuration) — the card surfaces a warning line when the admin enables the toggle without a mail provider present.

**Verified Platforms (v0.9.2):**
- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — verified 2026-04-24. `tsc --noEmit` clean. `npx tsx scripts/verify-auth-units.ts` 86/86 PASS (59 from v0.9.1 + 27 new covering magic-link provider lifecycle + 2 route-shape groups). `npx tsx scripts/verify-emailit-units.ts` 18/18 PASS.

---

## Previous Release: v0.9.1-alpha

**Release Date:** 2026-04-24
**Version:** v0.9.1-alpha
**Type:** Alpha (Adversarial review hardening + enterprise monitoring hooks)
**Status:** Superseded by v0.9.2-alpha on 2026-04-24 (Magic Link auth backend + CX-D1…D6 audit).
**Scope:** Second-pass security hardening closing every HIGH / MEDIUM / LOW finding from the 2026-04-24 adversarial review, plus a new `health:read` API-key scope that unlocks detailed operational state for external monitoring probes without giving them session cookies. No breaking changes for the multi-auth surface shipped in v0.9.0.
**Upgrade Path:** Supported source: v0.9.0-alpha. Upgrade in place via `npm run build` + service restart. Schema migration runs automatically — drops the non-unique passkey `credential_id` partial index and re-creates it as `UNIQUE`. Existing API keys keep working; new `health:read` scope is opt-in.

### v0.9.1 — Security hardening + `health:read` scope

**Breaking Changes (v0.9.1):**
- `/api/health` response shape is now minimal (`status`, `name`, `version`, `uptime`, `timestamp` only). Operational detail (OpenClaw connection state, break-glass reason, watcher stats, SSE client count) moved to new `/api/health/detailed`. Callers who depended on those fields from the public endpoint must either hit `/api/health/detailed` with a session cookie, issue an API key with the new `health:read` scope, or probe from localhost.
- `/api/auth/github/status` anonymous response shape shrunk to `{ available: boolean }`. Authenticated callers still receive `{ available, enabled, configured, linked }`.
- Login page `?error=...` query-string decoder collapsed to a single generic "Sign-in failed" message. Specific failure codes are still captured in the server-side audit log for admin debugging.

**Added (v0.9.1):**
- `/api/health/detailed` — authenticated detailed health endpoint. Tri-gate auth: API key with `health:read` scope → session cookie → localhost fallback.
- `health:read` scope in the API-key catalog (backend validator + Configuration panel UI).
- `src/lib/services/health-tick.ts` — shared side-effect tick + detailed state reader, called by both `/api/health` and `/api/health/detailed`.
- Adversarial review report: `docs/adversarial-review-2026-04-24.md` (431 lines, 2 passes of remediation fully captured).
- Pre-OSS hardening section in `docs/go-live-checklist.md` tracking remaining #A5 migrate-path echo for final pre-launch work.

**Changed (v0.9.1) — Adversarial review remediation:**
- **Finding #1 HIGH** — `/api/config/auth-methods` now falls back to `requireLocalhost` when RBAC is off, matching the dual-gate pattern used by every other mutation-capable config route.
- **Finding #2 MEDIUM-HIGH** — Passkey ceremonies now require user verification (`userVerification: "required"` + `requireUserVerification: true` at verify time). Rejects proof-of-possession-only signatures from stolen-but-unlocked hardware keys. Modern platform authenticators + YubiKey-with-PIN keep working; older keys without UV support no longer enroll.
- **Finding #3 MEDIUM** — `/api/config/mail` PUT validates every field before persisting: CRLF rejected on header fields, length capped, provider whitelisted, port range-checked, TLS boolean-coerced. Prevents SMTP-redirect and header-injection against all three providers (resend / smtp / emailit).
- **Finding #4 MEDIUM** — `/api/auth/github/callback` no longer stores the literal string "unknown" as `session.ip_address` when `request.ip` is unavailable. Fixes `SESSION_BIND_IP` fail-closed behavior for GitHub-authenticated sessions.
- **Finding #A1 LOW** — `operator_credentials.credential_id` partial index upgraded from plain to `UNIQUE`. Migration drops the old non-unique index first so re-runs are idempotent.
- **Finding #A2 LOW** — `/api/auth/github/status` split into anonymous-minimal (`{available}`) + authenticated-detailed (`{available, enabled, configured, linked}`). Login page uses the new shape.
- **Finding #A3 LOW** — Login page error decoder collapsed to a single generic user-facing message ("Sign-in failed. Please try a different method or contact your admin for assistance."). Specific failure codes (`github_state_mismatch`, `github_not_linked`, etc.) remain captured in the server-side audit log via `logEvent` calls in the callback route.
- **Finding #A4 LOW** — `/api/health` split into public-minimal + authenticated `/api/health/detailed`. Public response no longer leaks break-glass state, OpenClaw connection detail, or watcher internals to anonymous callers.

**Migration (v0.9.1):**
- Schema migration runs automatically on first launch — drops non-unique passkey `credential_id` index, re-creates as `UNIQUE`.
- Internal callers of `/api/health` that need the detailed payload (ConfigurationPanel Hermes test, MCP `clawnex://security-status` resource) migrated to `/api/health/detailed` as part of the commit chain — no operator action required.
- External monitoring tools that previously read `breakGlass` / `openclaw` / `sessionWatcher` / `hermesWatcher` fields from `/api/health` must now either: (a) issue an API key with `health:read` scope and hit `/api/health/detailed`, or (b) probe from localhost, or (c) continue using the minimal public response. Free-tier "is it alive?" uptime probes are unaffected.
- Operators with passkeys enrolled under v0.9.0 without user verification must re-enroll. v0.9.0 live passkey testing had not yet occurred at time of this release, so in practice this affects development enrollments only.

**Security Fixes (v0.9.1):**
- Review findings #1, #2, #3, #4, #A1, #A2, #A3, #A4 — see `docs/adversarial-review-2026-04-24.md` for detail, exploit scenarios, and per-finding commit hashes. Finding #A5 (migrate path echo) remains tracked in `go-live-checklist.md` Phase 3.5 for the pre-OSS hardening pass.

**Verified Platforms (v0.9.1):**
- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — verified 2026-04-24. `tsc --noEmit` clean across all remediation + health-tick extraction + tri-gate route. `npx tsx scripts/verify-auth-units.ts` 56/56 PASS (added 7 new assertions covering UNIQUE passkey constraint + `health:read` scope round-trip). `npx tsx scripts/verify-emailit-units.ts` 18/18 PASS.

---

## Previous Release: v0.9.0-alpha

**Release Date:** 2026-04-23
**Version:** v0.9.0-alpha
**Type:** Alpha (Multi-auth providers — Passkeys + GitHub OAuth + Magic Link UI placeholder)
**Status:** Superseded by v0.9.1-alpha on 2026-04-24 (security hardening + health:read).
**Scope:** Operators can sign in with WebAuthn passkeys or a linked GitHub account in addition to local password (which remains the break-glass identifier). New per-account **Auth & Devices** card lets operators self-manage their passkeys and GitHub link. Magic-link sign-in is reserved as a "Coming Soon" UI option.
**Upgrade Path:** Supported source: v0.8.4-alpha. Upgrade in place via `npm run build` + service restart. Schema migration runs automatically; existing local password sign-in keeps working without operator action.

### v0.9.0 — Multi-auth providers (Passkeys + GitHub + Magic Link UI)

**Breaking Changes (v0.9.0):** None. Local password sign-in is unchanged. New columns + tables are additive.

**Added (v0.9.0):**
- WebAuthn passkeys: full registration + resident-key authentication ceremony, counter regression check, IP rate-limited
- GitHub OAuth (sign-in + link), no-auto-create policy: admin must pre-link before that GitHub account can sign in
- Auth & Devices settings card (list/enroll/revoke passkeys, link/unlink GitHub)
- Login page: "Sign in with Passkey" button (always shown), "Sign in with GitHub" button (shown when configured), "Email me a magic link" button (disabled, SOON badge)
- 11 new auth API routes (4 passkey ceremony + 2 passkey mgmt + 5 GitHub)
- New schema: `operators.auth_providers` CSV column, `operator_credentials` table with type discriminator

**Changed (v0.9.0):**
- `OperatorRecord.auth_providers` added to types — backed by an idempotent `ALTER TABLE` migration

**Migration (v0.9.0):**
- Schema migrations are auto-applied on first launch (`CREATE TABLE IF NOT EXISTS` + tolerated `ALTER TABLE` errors).
- Set `AUTH_RP_ID` and `AUTH_EXPECTED_ORIGIN` for production HTTPS deployments — `localhost` defaults work for dev.
- GitHub OAuth requires `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` to be set; otherwise the button auto-hides on the login page.

**Verified Platforms (v0.9.0):**
- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — verified 2026-04-23. tsc --noEmit clean across all 11 new routes + 2 provider modules + UI changes.

---

### v0.8.4 — Filtered Navigation completion + alert workflow expansion

**Breaking Changes (v0.8.4):** None. PATCH /api/alerts/:id action enum widened (acknowledge|investigate|resolve); existing values keep working.

**Added (v0.8.4):**
- Investigating button on alerts (markInvestigating + API + UI + audit log)
- Range dimension on PanelFilters (config.min); min/max scalar URL keys
- Agents & Sessions, Tools & Access, Shield Tests, Models & Cost — all picked up PanelFilters + URL state
- docs/go-live-checklist.md — living tracker, 4-phase trajectory

**Changed (v0.8.4):**
- Traffic Monitor scoreMin migrated to URL state (all 5 dimensions in single widget)
- Resolve button eligible from investigating status

**Migration (v0.8.4):** None for end users.

**Verified Platforms (v0.8.4):**
- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — verified 2026-04-23. tsc --noEmit clean. 9 panels render via shared PanelFilters widget.

---

## Previous Release: v0.8.3-alpha

**Release Date:** 2026-04-23
**Version:** v0.8.3-alpha
**Type:** Alpha (Filtered Navigation expansion — Audit & Evidence + Risk Acceptances + Traffic Monitor pick up the v0.8.2 pattern; Alerts → Correlations deep-link bug fix)
**Status:** Superseded by v0.8.4-alpha
**Scope:** Three additional panels migrated to PanelFilters + URL state (Audit & Evidence, Risk Acceptances, Traffic Monitor). Alerts → Correlations deep-link now correctly filters to the matching rule's events (operator-reported regression, same class as the v0.8.2 Timeline → Alerts fix). Phase 4 sweep of remaining 8 panels deferred to v0.8.4 with explicit priority-ordered inventory in the CHANGELOG.
**Upgrade Path:** Supported source: v0.8.2-alpha. Upgrade in place via `npm run build` + service restart. URL bookmarks for the 3 newly-converted panels now preserve filter state.

### v0.8.3 — Filtered Navigation Expansion

**Breaking Changes (v0.8.3):** None.

**Added (v0.8.3):**
- Audit & Evidence panel migrated to PanelFilters + URL state (4 dimensions multi-select)
- Risk Acceptances panel migrated to PanelFilters + URL state (scope multi-select widening)
- Traffic Monitor panel migrated to PanelFilters + URL state (4 of 5 dimensions; scoreMin numeric range stays separate pending Range dimension addition)

**Fixed (v0.8.3):**
- Alerts → Correlations deep-link no longer dumps operator in unfiltered list (operator-reported regression)

**Migration (v0.8.3):** None for end users.

**Verified Platforms (v0.8.3):**
- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — verified 2026-04-23 via chrome-devtools MCP. Alerts → Correlations deep-link correctly filters (5 of 25 correlations shown for "Elevated Alert Volume" rule). Three migrated panels render via shared PanelFilters widget. tsc --noEmit clean.

---

## Previous Release: v0.8.2-alpha

**Release Date:** 2026-04-23
**Version:** v0.8.2-alpha
**Type:** Alpha (Filtered Navigation — URL-as-state + PanelFilters widget + Timeline → Alerts deep-link + Trust Audit filters)
**Status:** Superseded by v0.8.3-alpha
**Scope:** operator-stumbled-on bug fix: Timeline → Alerts backlink no longer dumps operator in unfiltered list. Foundation built for cross-panel deep-linking + standardized filter UI; Trust Audit + Alerts ship as proof-of-concept. URL hash carries tab + filters + id + highlight so refresh / back-button / share-via-paste all work. Audit & Evidence + Risk Acceptances + Traffic Monitor refactors deferred to v0.8.3.
**Upgrade Path:** Supported source: v0.8.1-alpha. Upgrade in place via `npm run build` + service restart. URL bookmarks now preserve filter state.

### v0.8.2 — Filtered Navigation Foundation

**Breaking Changes (v0.8.2):** None.

**Added (v0.8.2):**
- URL-as-state foundation (`url-state.ts` — useHashState hook + reserved keys: tab/q/severity/source/status/scope/actor/confidence/id/highlight)
- PanelFilters shared widget (config-driven multi-select dropdowns + freeform search + result counter + clear-all)
- useHighlightPulse hook (scroll-into-view + 2s pulse animation when URL carries id/highlight)
- Trust Audit filter UI (severity + confidence + freeform search — panel previously had no filters)
- Timeline → Alerts deep-link with id-based filtering + DEEP-LINK banner + row pulse on arrival
- `confidence` URL key for evidence-level filters (Trust Audit + Blast Radius)

**Changed (v0.8.2):**
- Sidebar tab click clears filter URL params (deliberate-reset semantics)
- Cross-panel `navigate(tab, opts)` accepts `{ focus?, filter?, id?, highlight? }` for deep-linking
- Alerts panel refactored to PanelFilters + URL state

**Fixed (v0.8.2):**
- Timeline backlink no longer dumps operator in unfiltered Alerts list (operator-reported)

**Migration (v0.8.2):** None for end users; URL bookmarks now preserve filter state.

**Verified Platforms (v0.8.2):**
- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — verified 2026-04-23 via chrome-devtools MCP. Timeline → Alerts deep-link works end-to-end (URL carries id, banner renders, exactly 1 row filtered, row pulses on arrival). Trust Audit + Alerts filter UIs render via shared widget. tsc --noEmit clean.

---

## Previous Release: v0.8.1-alpha

**Release Date:** 2026-04-23
**Version:** v0.8.1-alpha
**Type:** Alpha (UX polish — sidebar collapse + rail mode + Expand all/Collapse all + Exposure Matrix wrap fix)
**Status:** Superseded by v0.8.2-alpha
**Scope:** Per-group sidebar collapse with persistence + smart auto-expand. Sidebar minimize-to-rail (170px → 48px) with hover-tooltipped icons. Expand all / Collapse all buttons (latter keeps active group visible). Exposure Matrix BLAST RADIUS column wrap fix. Bug fix: COMMAND group could not be collapsed (auto-expand effect was over-firing). UI-only release; no API/schema/dependency changes.
**Upgrade Path:** Supported source: v0.8.0-alpha. Upgrade in place via `npm run build` + service restart.

### v0.8.1 — Sidebar UX Polish + Exposure Matrix Wrap Fix

**Breaking Changes (v0.8.1):** None.

**Added (v0.8.1):**
- Per-group sidebar collapse with `▶` caret + count badge + localStorage persistence. Smart auto-expand on navigation only.
- Sidebar minimize-to-rail mode (icons-only, hover tooltips for labels, badge bubbles in corner).
- `Expand all` / `Collapse all` controls in sidebar footer. `Collapse all` keeps active group visible.

**Fixed (v0.8.1):**
- Exposure Matrix BLAST RADIUS column: badge no longer wraps `MINIMAL · —` across two lines (added `whiteSpace: nowrap` + `display: inline-block`).
- COMMAND group can now be collapsed (auto-expand effect was over-firing on `collapsedGroups` change; restricted to `activeTab` change only).

**Migration (v0.8.1):** None. UI-only.

**Verified Platforms (v0.8.1):**
- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — verified 2026-04-23: tsc clean; chrome-devtools MCP confirms all behaviors live; localStorage persistence works across reloads.

---

## Previous Release: v0.8.0-alpha

**Release Date:** 2026-04-23
**Version:** v0.8.0-alpha
**Type:** Alpha (Risk Acceptance — operator-explicit, time-bound, audit-trailed suppression of findings across 4 panels + management UI)
**Status:** Superseded by v0.8.1-alpha
**Scope:** New core lib at `src/lib/services/risk-acceptance/` + new SQLite table `risk_acceptances` + new RBAC permission `risk:accept` + new HTTP API `/api/risk-acceptances` (GET/POST/DELETE) + integrations into Trust Audit, Blast Radius, Correlations, Alerts + new management panel under GOVERNANCE. 90-day default expiry (30d for Correlations). Three scope levels (finding / agent_rule / rule_global). Full audit-log evidence trail. SOC 2 / ISO 27001 controls (CC6.6, CC7.1, CC7.2, A.5.27, A.8.16, A.8.34) addressed. Spec at `docs/superpowers/specs/2026-04-23-risk-acceptance-design.md`; plan at `docs/superpowers/plans/2026-04-23-risk-acceptance-plan.md`.
**Upgrade Path:** Supported source: v0.7.3-alpha. Upgrade in place via `npm run build` + service restart. DB migration auto-runs on next boot. No new dependencies; no breaking API changes.

### v0.8.0 — Risk Acceptance Across All Risk-Bearing Surfaces

Closes the "every operator wants every finding to count forever" gap that operator flagged. Operators now have an explicit, time-bound, audit-trailed primitive to say "yes, I see this, I accept it, here's why, here's until when, here's how broadly." The system never silently widens scope; defaults to narrowest; auto-revokes when evidence shifts.

**Breaking Changes (v0.8.0):**

None. All new fields on existing endpoints are additive. The `findings` array on `/api/trust-audit` and the `dangerousCombos`/`postureLints` arrays on `/api/permissiveness` carry ACTIVE only (the headline behavior); existing v0.7.x clients continue to work and see the suppressed-aware default.

**Added (v0.8.0):**

- **Risk Acceptance core library** — types, signatures, store, orchestrator, 56-assertion test harness.
- **`risk_acceptances` SQLite table** — auto-migrates on boot via the `MIGRATIONS` array.
- **`risk:accept` RBAC permission** — granted to admin + security_manager.
- **HTTP API** `/api/risk-acceptances` — GET/POST/DELETE with full validation + audit-log integration.
- **Trust Audit integration** — engine partitions findings; report carries gross + active + suppressed.
- **Blast Radius integration** — orchestrator partitions combos + lints; report carries active + suppressed arrays.
- **Correlations integration** — evaluate route partitions triggered rules; threat_score is active by default; gross + suppressed reachable via new fields.
- **Alerts integration** — createAlert() checks acceptance before INSERT; matched alerts get status='suppressed' directly; listAlerts() default excludes suppressed; `?include_suppressed=true` opt-in.
- **Shared UI widget** — AcceptRiskButton + SuppressedFindingCard + AcceptedRisksSection used by all four panels for consistent affordance.
- **Per-panel UI integrations** — Accept Risk / Snooze / Suppress similar buttons on every active finding card; Accepted Risks collapsibles at the bottom of each panel; header counts split into "X active · Y accepted" when accepted > 0.
- **Risk Acceptance management panel** — new GOVERNANCE-group tab with three sections: expiring soon (banner-style 14d), active acceptances (always visible), recently revoked / expired (last 30d audit reference). Filters + search + manual refresh. Panel-jump shortcuts.
- **`scripts/verify-risk-acceptance-units.ts`** + **`scripts/verify-risk-acceptance.sh`** — 56 module-level assertions + 5 endpoint assertions.
- **Pre-OSS baseline** extended 12 → 13 routes.

**Changed (v0.8.0):**

- Trust Audit `summary.findingCounts` is now gross; new `findingCountsActive` for active. `overallSeverity` derives from active.
- Permissiveness `dangerousCombos` / `postureLints` carry active only. New `*Suppressed` arrays carry the suppressed entries.
- Correlations `threat_score` carries active. New `threat_score_gross`, `threat_score_active`, `breakdown_gross`, `raw_score_gross`, `triggered_count_gross`, `suppressed_count`, `suppressedRules` fields.
- Alerts `listAlerts()` default-excludes `status='suppressed'`. New `?include_suppressed=true` query param.
- HelpPanel badge 25 → 26 PANELS.

**Security Fixes (v0.8.0):**

- New permission gate (`risk:accept`) on POST + DELETE — only admin + security_manager can create or revoke acceptances.
- Every accept / revoke / expire / evidence-change writes to `audit_log` AND mirrors to stdout via the `[CLAWNEX_AUDIT]` channel for tamper-evidence.
- Evidence-snapshot delta detection — finding-scope acceptances auto-revoke when the underlying evidence changes, forcing operator re-review.
- Headlines NEVER show false-confidence "0" — always "X active · Y accepted" when Y > 0.

**Known Issues (v0.8.0):**

- Blast Radius surface scoring (`effectiveBlastRadius`) still uses gross combos for the per-edge `triggeredCombos` count. Per-card and panel KPI splits show active correctly; only the surface-level numeric scores still reflect gross. Will tighten in v0.8.1.
- Acceptance signatures are deterministic by content. Existing finding-scope acceptances will auto-revoke if a rule's evidence shape changes between releases. Operator must re-accept with awareness of the new evidence.
- Suppressed alerts don't backfill — only NEW alerts respect newly-created acceptances. Existing open alerts must be manually acknowledged/closed.
- v1 is single-operator self-service. No multi-operator approval workflow, no bulk accept/revoke, no per-instance scope. Future enhancements.
- Browser-native `confirm()` / `prompt()` for revoke flow (matches v0.7.3 trade-off).

**Migration (v0.8.0):**

```bash
# From v0.7.3-alpha
git pull
# DB migration auto-runs; no new dependencies; no breaking changes
rm -rf .next
npm run build
# restart service via your usual mechanism
# verify
./scripts/verify-pre-oss.sh                       # 13/13 PASS expected
npx tsx scripts/verify-permissiveness-units.ts    # 202/202 PASS expected
npx tsx scripts/verify-risk-acceptance-units.ts   # 56/56 PASS expected
./scripts/verify-risk-acceptance.sh               # 5/5 PASS expected
```

**Controls Evidence (v0.8.0) — SOC 2 Trust Services Criteria:**

| Commit | SOC 2 TSC | ISO 27001:2022 Annex A | Risk |
|---|---|---|---|
| db migration + types + signatures | CC6.6, CC7.2 | A.8.31 | R-027 |
| store + orchestrator + audit-log integration | CC7.1, CC7.2 | A.5.27, A.8.16 | R-027 |
| RBAC permission + API endpoints | CC6.6 | A.5.18, A.8.34 | R-027 |
| 4-panel integrations (Trust Audit, Blast Radius, Correlations, Alerts) | CC1.4, CC4.1 | A.5.34 | R-027 |
| RiskAcceptancePanel management UI | CC4.1, CC7.4 | A.5.27, A.5.34 | R-027 |

**Verified Platforms (v0.8.0):**

- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — full stack verified 2026-04-23: `tsc --noEmit` clean; `npx tsx scripts/verify-risk-acceptance-units.ts` 56/56 PASS; `bash scripts/verify-pre-oss.sh` 13/13 PASS; `bash scripts/verify-risk-acceptance.sh` 5/5 PASS. Live suppression flow tested: POST `agent_rule` scope acceptance on Trust Audit's `comm-surface-permissiveness` rule for `hermes-discord@example-profile` correctly suppressed all 4 findings on that agent (22 gross → 18 active + 4 suppressed). `/api/health` reports `version: 0.8.0-alpha`.

---

## Previous Release: v0.7.3-alpha

**Release Date:** 2026-04-23
**Version:** v0.7.3-alpha
**Type:** Alpha (UX cosmetics + safety — disclosure carets, confirm dialogs on litellm mutations, Blast Radius collapsibles, chat-default closed, brand gradient uniformity)
**Status:** Superseded by v0.8.0-alpha
**Scope:** Direct user feedback batch. Five visual/safety polish items: (1) ▶ carets on Correlations Why-this-score / Top-contributing-rules collapsibles for affordance, (2) `confirm()` dialog before three destructive litellm config.yaml mutations on Configuration → Model Providers, (3) Blast Radius sub-blocks (Exposure Matrix, Most Permissive Agents, Most Exposed Surfaces, Dangerous Combos, Posture Lints) switched to `CollapsibleCard` and closed-by-default, (4) AI chat panel closed by default (still opt-in via `ai_panel_default=open`), (5) ClawNex brand gradient unified across sidebar header + chat panel header to match the AboutPanel canonical rendering.
**Upgrade Path:** Supported source: v0.7.2-alpha. Upgrade in place via `npm run build` + service restart. No new dependencies; no schema changes; UI-only.

### v0.7.3 — UX Cosmetics + Click-Safety

UI-only release. Direct user feedback addressed: discoverability (carets), accident-prevention (confirms), defaults (collapsed Blast Radius blocks + closed chat), and brand uniformity.

**Breaking Changes (v0.7.3):**

| Change | Impact | Required Action |
|--------|--------|-----------------|
| Three Configuration → Model Providers click handlers now go through `window.confirm()` | Operator clicks no longer mutate `config.yaml` until they accept the dialog. Any UI automation (Selenium / Playwright) must accept the dialog. | None for human operators. Update test scripts to handle the dialog. |
| AI chat panel no longer auto-opens on dashboard load | Operator must click the `AI` button to open chat | Set `ai_panel_default=open` in `config_defaults` to restore the v0.7.2 auto-open behavior. |
| Blast Radius sub-blocks closed by default | Operators see a clean overview first; click to expand each block | None. Counts are visible in the header so operators know what's behind each fold. |

**Added (v0.7.3):**

- **▶ disclosure carets** on the Correlations panel's `Why this score` and `Top Contributing Rules` collapsibles. Scoped CSS via inline `<style>` block; rotates 90° when `details[open]`.
- **`confirm()` dialogs** before three destructive litellm config mutations on Configuration → Model Providers: chip-× model removal, full-provider Remove button, and the destructive branch of the Test Result chip toggle. Confirmation message names the provider + model and warns about active-session disruption.

**Changed (v0.7.3):**

- **Blast Radius sub-blocks switched to `CollapsibleCard`** — `defaultOpen={false}` + per-block `count` badge. Affects: ExposureMatrix, RankedAgentsTable, RankedSurfacesTable, FindingsGrid (both halves: Dangerous-tool combinations + Posture-lint findings).
- **AI chat panel closed by default** — `chatOpen` initial state flipped from `true` to `false`. `ai_panel_default` config setting still works as opt-in.
- **ClawNex brand gradient unified** — sidebar header `ClawNex` and chat panel header `ClawNex AI` now use the same `linear-gradient(90deg, ${C.brand}, ${C.cyan})` + `WebkitBackgroundClip: text` pattern as the AboutPanel.

**Security Fixes (v0.7.3):**

- Reduced blast radius of accidental clicks on Configuration → Model Providers. The dashboard previously allowed a single misclick to drop a model (or an entire provider) from `config.yaml` and break active sessions. Now requires explicit confirmation.
- No new attack surface; UI-only release; no scanner additions.

**Known Issues (v0.7.3):**

- The `window.confirm()` modal is browser-native (not custom-styled). Adequate for safety; not the prettiest UX. If we want a styled modal later, the `confirm()` pattern can be swapped for a controlled-state modal without changing the click-flow contract.
- `Card` → `CollapsibleCard` swap on Blast Radius blocks adds a slight padding shift when expanded vs collapsed (CollapsibleCard reduces vertical padding when closed). Acceptable trade-off for the affordance.
- The brand gradient is webkit-prefixed; Firefox/Safari modern versions support it via `background-clip: text` (no prefix), but to maintain pixel-parity with the AboutPanel rendering we use the existing `WebkitBackgroundClip` only. No fallback color is provided — if a browser ignores the property the text will render in the current `color` (transparent → invisible). This matches the existing AboutPanel risk profile.

**Migration (v0.7.3):**

```bash
# From v0.7.2-alpha
git pull
# No new dependencies; no schema changes; UI-only
rm -rf .next
npm run build
# restart service via your usual mechanism
# verify
./scripts/verify-pre-oss.sh                   # 12 PASS / 0 FAIL expected
npx tsx scripts/verify-permissiveness-units.ts # 202 PASS / 0 FAIL expected
```

**Controls Evidence (v0.7.3) — SOC 2 Trust Services Criteria:**

| Commit | SOC 2 TSC | ISO 27001:2022 Annex A | Risk |
|---|---|---|---|
| this commit (cosmetic + confirms) | CC1.4, CC6.6 | A.5.34, A.8.2 | R-027 (accidental misconfiguration) |

**Verified Platforms (v0.7.3):**

- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — full stack verified 2026-04-23: `tsc --noEmit` clean; chrome-devtools MCP smoke confirms 2 `.cn-caret` on Correlations + 5 collapsed `CollapsibleCard` sections on Blast Radius (Surface/Channel Exposure Matrix, Most Permissive Agents, Most Exposed Surfaces, Dangerous-tool combinations, Posture-lint findings) + chat panel closed by default + sidebar brand gradient applied. `/api/health` reports `version: 0.7.3-alpha`.

---

## Previous Release: v0.7.2-alpha

**Release Date:** 2026-04-23
**Version:** v0.7.2-alpha
**Type:** Alpha (SP-4 polish — Correlations KPI tooltips + Top Contributing Rules drivers)
**Status:** Superseded by v0.7.3-alpha
**Scope:** Closes the last lane from the v0.7.0 blast-radius mandate by applying the v0.7.1 metric-semantic discipline to the Correlations panel: inline KPI tooltips on Score / Level / Triggered Rules / Findings, plus a new "Top Contributing Rules" collapsible drivers block that mirrors the Blast Radius `drivers[]` pattern. Backward-compatible addition of optional `tooltip` prop to `shared.Stat`. UI-only release; no API or schema changes.
**Upgrade Path:** Supported source: v0.7.1-alpha. Upgrade in place via `npm run build` + service restart. No new dependencies; no schema changes; `/api/correlations/evaluate` response shape unchanged (already returned everything the new UI surfaces).

### v0.7.2 — Correlations Score Transparency Polish

UI-only release surfacing data the evaluator API has been returning since v0.6.2. Closes the last open lane from the original 20-item blast-radius mandate.

**Breaking Changes (v0.7.2):**

None. UI-only.

**Added (v0.7.2):**

- **Correlations Top Contributing Rules block** (collapsible) — per-rule contribution table mirroring the Blast Radius `drivers[]` pattern. Columns: rank, rule name (description in hover title), severity badge, raw points, % of total, sources observed. Sorted desc by raw points; top 5 of N triggered rules shown. Renders nothing when no rules triggered.
- **Correlations top-line KPI tooltips** — `Score`, `Level`, `Triggered Rules`, `Findings` carry inline `title` attributes per the reviewer's metric-semantic discipline. Source/inclusion/window/confidence inline-discoverable on hover. `cursor: help` on each card.

**Changed (v0.7.2):**

- `shared.Stat` extended with optional `tooltip?: string` prop. Backward-compatible: callers without `tooltip` see no behavior change. Native `title=` + `cursor: help` when present. Used by Correlations now; Blast Radius can adopt later.

**Security Fixes (v0.7.2):**

- Honest semantics on the Correlations panel — the "Findings" KPI already rendered `—` instead of `0` when `/api/correlations` was unreachable; v0.7.2 documents this contract in the tooltip text so operators know the difference between "0 findings (verified)" and "— (data unreachable)" without reading source.

**Known Issues (v0.7.2):**

- **Weighting re-eval UI deferred.** The original SP-4 spec called for an interactive "preview score with adjusted weights" surface. That's a real new feature, not metric-semantic polish, and is left for a future release.

**Migration (v0.7.2):**

```bash
# From v0.7.1-alpha
git pull
# No new dependencies; no schema changes; UI-only
rm -rf .next
npm run build
# restart service via your usual mechanism
# verify
./scripts/verify-pre-oss.sh                   # 12 PASS / 0 FAIL expected
npx tsx scripts/verify-permissiveness-units.ts # 202 PASS / 0 FAIL expected
```

**Controls Evidence (v0.7.2) — SOC 2 Trust Services Criteria:**

| Commit | SOC 2 TSC | ISO 27001:2022 Annex A | Risk |
|---|---|---|---|
| 2270513 correlations SP-4 polish | CC1.4, CC4.1 | A.5.34 | R-026 (false-confidence) |

**Verified Platforms (v0.7.2):**

- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — full stack verified 2026-04-23: `verify-pre-oss.sh` 12/12 PASS; `verify-permissiveness-units.ts` 202/202 PASS; Correlations panel renders new Top Contributing Rules block + KPI tooltips via `chrome-devtools` MCP smoke (5/5 triggered rules visible: Coordinated Attack Chain CRITICAL 30 raw pts, Data Exfiltration Attempt, Insider Threat Signal, Alert Cascade, Elevated Alert Volume); `/api/health` reports `version: 0.7.2-alpha`.

---

## Previous Release: v0.7.1-alpha

**Release Date:** 2026-04-23
**Version:** v0.7.1-alpha
**Type:** Alpha (post-v0.7.0 hardening — Hermes skill scan + shell KPI semantics + Trust Audit consumes permissiveness)
**Status:** Superseded by v0.7.2-alpha
**Scope:** Closes three lanes deferred from v0.7.0-alpha: (1) Hermes profile skill scan so dangerous-combo evaluation extends to Hermes comm-agents (heuristic_inference confidence), (2) shell-KPI semantic cleanup for the reviewer's 5 live-verified v0.6.3 contradictions (label/query alignment + inline tooltips), (3) Trust Audit comm-surface-permissiveness rule (15th audit rule) that consumes the permissiveness scan and emits Findings for evaluable dangerous-tool combinations and posture-lint misconfigurations alongside other trust-boundary risks.
**Upgrade Path:** Supported source: v0.7.0-alpha. Upgrade via `npm run build` + service restart. No new dependencies. No database schema changes. The only behavioural caller-visible change is `runTrustAudit()` becoming async (one in-tree caller updated; external callers — none known — must `await` the result).

### v0.7.1 — Hermes Skill Scan + Shell KPI Semantics + Trust Audit Permissiveness Integration

Follow-on hardening release after v0.7.0-alpha. Closes three lanes that were explicitly deferred on the operator's morning handoff.

**Breaking Changes (v0.7.1):**

| Change | Impact | Required Action |
|--------|--------|-----------------|
| `runTrustAudit()` returns `Promise<AuditReport>` instead of `AuditReport` | One in-tree caller (`/api/trust-audit/route.ts`) updated; any external caller must `await` | Find and `await` any external `runTrustAudit()` call site. None known in the tree. |
| Header KPI labels renamed: `ALERTS` → `CRITICAL ALERTS`, `BLOCK VERDICTS` → `SHIELD BLOCKS`, `AGENTS` → `FLEET AGENTS` | UI text only — anything scraping the dashboard HTML for these strings would break | Update HTML scrapers (none known; this is a dashboard, not an API). The underlying data values + sources are unchanged. |
| Trust Audit finding totals will go up | test host baseline 7 → 22 findings | Recalibrate any dashboards / badges / alerting that depend on the absolute number. The new findings are real (e.g. Browser+Read on Scout, Browser+Read on hermes-discord, telegram channel ID in user allowlist). |

**Added (v0.7.1):**

- **Hermes skill scan** — `scanners/hermes.ts` walks every `SKILL.md` under `<profile>/skills/` and extracts backtick-quoted identifiers matching a known tool needle. The deduped per-profile tool union becomes the `toolIds` for the Hermes comm-agent edges in `deriveCommReachability()`, so dangerous-combo evaluation can fire `evaluable:true` on the Hermes side. New scanner exports: `scanProfileSkills(profileDir)`, `extractToolsFromSkillBody(body)`, `KNOWN_TOOL_NEEDLES`. Confidence on skill-derived tools is `heuristic_inference`. Live data on test host/example-profile: 22 tools extracted; `hermes-telegram` and `hermes-discord` edges now carry tool lists.
- **Trust Audit comm-surface-permissiveness rule** (15th rule) — consumes the permissiveness report and emits `Finding`s for evaluable dangerous-tool combinations and posture-lint misconfigurations. Combo metadata hand-mirrored from `permissiveness/dangerous-combos.ts` to avoid a runtime dep on the registry shape.

**Changed (v0.7.1):**

- **Shell KPI semantics (SP-5)** — header strip in `src/components/dashboard/index.tsx` now uses labels matching query semantics with inline tooltips:
  - `ALERTS` → `CRITICAL ALERTS` (matches `severity=CRITICAL` query; tooltip points to Alerts board for full list)
  - `BLOCK VERDICTS` → `SHIELD BLOCKS` (matches `shield_scans` source; tooltip points to Traffic Monitor for broader proxy + session-watcher blocks)
  - `AGENTS` → `FLEET AGENTS` (tooltip explains the live 13-vs-14 divergence with API Agents in Agents & Sessions)
  - `SERVICES` and `DOWN` retain labels but gain tooltips citing source + inclusion criteria
  All five spans are now `cursor: help` for tooltip discoverability.
- **Trust Audit engine becomes async** — `runTrustAudit()` returns `Promise<AuditReport>` so it can `await scan({refresh:false})` from the permissiveness lib (which uses its own 60s cache).
- **`AuditContext.permissivenessReport`** added (typed `unknown` to avoid circular import).
- **Trust Audit rule count** updated 14 → 15 in `PANEL_HELP.trustAudit.desc` and `HelpPanel.tsx`.
- **Permissiveness orchestrator** empty-tools fallback reason updated to reflect that Hermes skills ARE now scanned.
- **Verify-units harness** grew 182 → 202 assertions, all PASS.

**Security Fixes (v0.7.1):**

- **Honest semantics, not louder noise.** SP-5 fixes false-reassurance KPIs — operators no longer see "0 ALERTS" in the header while the deployment-readiness panel says "ALERTS 48". The data values were always honest; only the labels were misleading. The change makes scope-divergence operator-discoverable rather than hidden.
- **Heuristic_inference is named.** Skill tool extraction is regex-over-prose; the confidence label propagates explicitly through every score and finding. No surface promotes a heuristic to verified.
- Scanner remains read-only: filesystem reads + no network calls + no writes.

**Known Issues (v0.7.1):**

- Skill-tool extraction is conservative (backtick-quoted identifiers only). Tools mentioned only in prose ("the agent uses the browser tool" without backticks) are not picked up. This errs on the side of under-reporting rather than fabricating a finding.
- Combo metadata (name + rationale + severity) is hand-mirrored from `permissiveness/dangerous-combos.ts` into `trust-audit/rules.ts` to avoid a circular import. **KEEP IN SYNC** if the registry grows; the linter does not catch divergence today.
- Trust Audit report size grows now that comm-surface findings land in the same payload. The 1 MB cache cap in `/api/trust-audit/route.ts` still holds on test host live data (~50KB after this release); high-finding fleets may push the cap and fall back to fresh-on-every-request.
- The "every combo evaluable:false" assertion at v0.7.0 was already incorrect on live test host data after the deeper-reachability commit. The v0.7.0 release-day "182/182 PASS" reported in the handoff summary was not reproducible on the same machine the next morning. Fixed in this release.
- SP-4 (Correlations score transparency) — still deferred.

**Migration (v0.7.1):**

```bash
# From v0.7.0-alpha
git pull
# No new dependencies; no schema changes
rm -rf .next
npm run build
# restart service via your usual mechanism
# verify
./scripts/verify-pre-oss.sh                   # 12 PASS / 0 FAIL expected
npx tsx scripts/verify-permissiveness-units.ts # 202 PASS / 0 FAIL expected
```

**Controls Evidence (v0.7.1) — SOC 2 Trust Services Criteria:**

| Commit | SOC 2 TSC | ISO 27001:2022 Annex A | Risk |
|---|---|---|---|
| 2ecac74 hermes skill scan | CC4.1, CC7.2 | A.5.27, A.8.31 | R-024 |
| 0ffb1dc shell KPI semantics | CC1.4, CC4.1 | A.5.34 | R-026 (false-reassurance) |
| 67922d7 trust-audit comm-surface rule | CC7.1, CC7.2 | A.5.25, A.8.16 | R-024 |

**Verified Platforms (v0.7.1):**

- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — full stack verified 2026-04-23: `verify-pre-oss.sh` 12/12 PASS; `verify-permissiveness-units.ts` 202/202 PASS; Trust Audit panel renders new findings via `chrome-devtools` MCP smoke test; `/api/health` reports `version: 0.7.1-alpha`.

---

## Previous Release: v0.7.0-alpha

**Release Date:** 2026-04-23
**Version:** v0.7.0-alpha
**Type:** Alpha (Blast Radius + Permissiveness model)
**Status:** Superseded by v0.7.1-alpha
**Scope:** SP-1 (permissiveness data model + scanner) + SP-2 (Blast Radius panel + rankings) + deeper OpenClaw reachability join. New top-level 💥 Blast Radius panel under COMMAND answers "which agents, from where, with what tools, how bad" in under 30 seconds against live OpenClaw + Hermes config. New `/api/permissiveness` endpoint. OpenClaw agents (primary operator + 13 others) now visible with real tool lists; dangerous-combo evaluation fires `evaluable:true` where evidence supports it. Provenance on every field; MIN-confidence propagation; honest `—` instead of `0` when inputs are unknown. the reviewer's metric-semantic discipline enforced throughout the new panel.
**Upgrade Path:** Supported source: v0.6.3-alpha. Upgrade via `npm install` (new `yaml@2.8.3` dep) + `npm run build` + service restart. No database schema changes. Fully backwards compatible — existing panels untouched; new panel is additive.

### v0.7.0 — Blast Radius + Permissiveness

First release of the unified blast-radius operating model carved out of the 20-item mandate. SP-1 builds the data model (9 permission dimensions per comm surface, dual-bot detection, posture-lint module, dangerous-tool-combination registry, MIN-confidence propagation). SP-2 builds the operator-first panel (Exposure Matrix, Most Permissive Agents, Most Exposed Surfaces, Dangerous Combos + Posture Lints, provenance legend). Deeper reachability join lands OpenClaw agents (14 of them including Project owner) with real tool lists and per-agent routing classification. Spec: `docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md`.

**Breaking Changes (v0.7.0):**

None. Fully additive.

**Added (v0.7.0):**

- **Permissiveness library** at `src/lib/services/permissiveness/` — scanners (openclaw, hermes, runtime-surfaces), scoring (edge formula + MIN-confidence + drivers), token-matching (dual-bot detection), posture-lints (2 seeded rules), dangerous-combos (5 seeded combos with evaluable-with-reason contract), cache (60s TTL), index orchestrator.
- **`GET /api/permissiveness`** — returns `PermissivenessReport` with profiles, surfaces, dangerousCombos, postureLints, rankings, meta. `?refresh=true` bypasses cache. `X-Permissiveness-Cache` + `X-Permissiveness-Scan-Ms` response headers.
- **💥 Blast Radius panel** under COMMAND nav group — four vertical blocks with provenance on every cell. Row expansion shows 9-dimension posture per profile layer. Drill buttons jump to Tools & Access / Access Lists / Agents / Routing.
- **Deep OpenClaw reachability** — 14 OpenClaw agents visible (primary operator, Nova, Axiom, Byte, Iris, test host, Scout, Spark, Nano, Apex, Relay, BMad Master, Concierge, Skill Installer) on litellm-proxy surface; 13 comm-surface bindings produce edges on Discord/Telegram/Slack.
- **`scripts/verify-permissiveness.sh`** — endpoint smoke test. **`scripts/verify-permissiveness-units.ts`** — 182-assertion module harness against live config.
- Token-identity classification — dual-bot detected on this machine for both Discord (OpenClaw 1473… ≠ Hermes 1493…) and Telegram (OpenClaw 8586826… ≠ Hermes 8795956…).
- Posture-lint rule fires on live data: `TELEGRAM_ALLOWED_USERS=<telegram-chat-id>` flagged as channel-ID-in-user-allowlist misconfiguration.

**Changed (v0.7.0):**

- `scripts/verify-pre-oss.sh` baseline extended 11 → 12 routes (+/api/permissiveness, 8000ms budget).
- `yaml` dependency pinned at `2.8.3` (patches GHSA-48c2-rrv3-qjmp).
- `PANEL_HELP` + HelpPanel badge: 24 → 25 panels.

**Security Fixes (v0.7.0):**

- `yaml` dependency bumped from 2.6.1 (initial add) → 2.8.3 during session after `npm audit` flagged GHSA-48c2-rrv3-qjmp (deeply-nested-collections DoS in 2.0.0-2.8.2).
- Raw bot tokens never stored; only prefix (first 20 chars) + SHA-256 hash.
- Every field carries provenance; missing evidence collapses confidence to `unknown` and renders `—`, never `0`.

**Known Issues (v0.7.0):**

- Hermes comm-agent tool lists remain empty (Hermes gateway skills/plugins not yet scanned); dangerous-combo findings on Hermes edges stay `evaluable:false` with explicit reason. OpenClaw side is now joined.
- SP-3 (Trust Audit finding upgrades to consume permissiveness lib) — deferred.
- SP-4 (Correlations score transparency) — deferred.
- SP-5 (shell-KPI semantic cleanup for the reviewer's 5 live-verified v0.6.3 contradictions) — next lane, targeted for v0.7.1-alpha.
- NemoClaw + Webhook surfaces render as honest `not_integrated` placeholders until respective adapters ship.

**Migration (v0.7.0):**

```bash
# From v0.6.3-alpha
git pull
npm install          # picks up yaml@2.8.3 + regenerates package-lock
rm -rf .next
npm run build
# restart service via your usual mechanism (systemd or `npm start`)
# verify
./scripts/verify-permissiveness.sh
./scripts/verify-pre-oss.sh     # 12 PASS / 0 FAIL expected
```

**Controls Evidence (v0.7.0) — SOC 2 Trust Services Criteria:**

| Commit | SOC 2 TSC | ISO 27001:2022 Annex A | Risk |
|---|---|---|---|
| bd4903b spec | CC6.1, CC7.2 | A.5.15, A.8.3 | R-024 partial |
| 58058b2 yaml patch | CC7.2 | A.5.23 | R-021 hygiene |
| d11d99a types + 6c081dd scoring | CC7.2 | A.8.31 | R-024 |
| e467650 orchestrator | CC6.1, CC7.2 | A.5.9, A.5.15, A.8.3 | R-024 |
| 226645c API + 13c06fe verify | CC6.1, CC7.2 | A.8.31 | R-024 |
| a5ddd9a panel | CC6.1 | A.5.9 | R-024 |
| 6d14b4a deeper reachability | CC6.1, CC7.2 | A.5.9, A.5.15, A.8.3 | R-024 |

**Verified Platforms (v0.7.0):**

- macOS 15 (test host) — Node 22 / Next.js 14.2.35 — full stack verified 2026-04-23: `verify-pre-oss.sh` 12 PASS / 0 FAIL; `verify-permissiveness-units.ts` 182/182 PASS.

---

## Previous Release: v0.6.3-alpha

**Release Date:** 2026-04-22
**Version:** v0.6.3-alpha
**Type:** Alpha (post-initial-pass quality + governance + safe-default pass)
**Status:** Superseded by v0.7.0-alpha
**Scope:** Governance starter pack (14 policies + 2 registers + 4 templates + 3 summaries + in-dashboard panel), RBAC-on-by-default + boot WARN, Trust Audit discovery-fidelity honesty copy, Correlations Why-this-score breakdown, Fleet live top-correlations preview, Correlations starter-templates empty state, ToolsAccessPanel state-component wiring, OSS readiness honesty, security audit extended as SOC 2 evidence ledger.
**Upgrade Path:** Supported source: v0.6.2-alpha. Upgrade via `npm run build` + service restart. No database schema changes. `.env.example` defaults changed (RBAC now on by default); existing `.env.local` files continue to work as-is. See **Migration** table below for operators who want to adopt the new safe default.

### v0.6.3 — Post-Initial-Pass Quality, Honesty, and Governance

Non-feature release that converts latent v0.6.2 value into visible operator value, lands the full governance lane so ClawNex has a real paperwork axis for enterprise conversations, and flips a single unsafe default (RBAC) that was a footgun for clone-and-run OSS users. Closes 6 of the reviewer's platform-audit priorities (2, 3.2, 3.4, 4.4, 4.5, 5 targeted, 6.1, 6.2).

**Breaking Changes (v0.6.3):**

| Change | Impact | Required Action |
|--------|--------|-----------------|
| `RBAC_ENABLED=true` is now the default in `.env.example` | Fresh clone + copy of `.env.example` → `.env.local` now boots with operator authentication required | For local-dev opt-out, uncomment the `# RBAC_ENABLED=false / # NEXT_PUBLIC_RBAC_ENABLED=false` block at the bottom of the RBAC section. Server emits a boxed WARN on every start when RBAC is off. Existing `.env.local` files are unchanged. |
| `/api/correlations/evaluate` POST response adds five optional fields (`weights_applied`, `correlation_multiplier`, `raw_score`, `triggered_count`, `unique_sources`) | Backwards compatible; existing consumers ignore the new fields | None. New UI consumes the fields; old clients keep working. |
| `/api/docs` whitelist expanded from 11 → 31 entries; now supports subdirectory paths (`policies/*`, `registers/*`) | Additional read-only doc paths available to any caller with `dashboard:view` | None. Traversal rejection is preserved; the whitelist is explicit. |

**Added (v0.6.3):**

| Surface | Description | Commit |
|---------|-------------|--------|
| Governance panel | New COMPLIANCE-group sidebar tab rendering 20 governance docs inline via shared `DocReader` | e4c8f4d |
| 14 approved policies | Document IDs, approval metadata, per-policy change logs | d47ae69 |
| Risk register (23 rows) | Priority, owner, target date, treatment, status, linked evidence | d47ae69 |
| Vendor inventory register | Live-reconciled, 5 categories, DPA status per vendor | d47ae69 |
| Governance one-pager | Leadership-facing summary | d47ae69 |
| Policy evidence checklist | Policy clauses → artifacts/gaps | d47ae69 |
| 4 operational templates | Incident, tabletop, DR, access review | d47ae69 |
| Correlations Why-this-score | Collapsible per-source breakdown with weights + multiplier rationale | abb0f2d |
| Fleet top-correlations preview | Live top-1-2 correlations in non-demo mode | 1eebed5 |
| Correlations starter-templates empty state | One-click APPLY when rules.length===0 | f1c9bbc |
| ToolsAccessPanel state components | Distinct loading / empty / disconnected / error states | e662c3f |
| Trust Audit discovery-fidelity note | Inline caveat above tab bar + PANEL_HELP rewrite | a5367a9 |
| ClawNex wordmark hyperlink | Status-bar wordmark → `https://clawnexai.com` | 3c465f7 |
| Boot-time RBAC-off WARN | Boxed stderr banner on first `rbac/guard.ts` load | 21d249b |
| Shared `DocReader` component | Extracted for reuse between HelpPanel + GovernancePanel | e4c8f4d |
| Shared correlation-templates module | `src/lib/correlation-templates.ts` | f1c9bbc |

**Security Fixes (v0.6.3):**

| Reference | Finding | Severity | Resolution |
|-----------|---------|----------|------------|
| Pri-6.1 (platform-audit) | `RBAC_ENABLED=false` default on clone-and-run exposes unauthenticated dashboard | High (posture) | Flipped default to `true`; boot WARN on opt-out; README Quickstart updated |
| Pri-2 (platform-audit) | Trust Audit fidelity claims exceed discovery evidence | Medium (product-truth) | Inline caveat in panel + PANEL_HELP rewrite explicitly naming what discovery derives from |

**Known Issues (v0.6.3):**

- **State-component coverage is targeted, not exhaustive** — ToolsAccessPanel migrated in this release; remaining panels with naive "Loading..." strings (AgentWorkspace mid-panel file loader; Configuration sub-cards) are scoped as a follow-up lane.
- **Trust Audit discovery itself is unchanged** — this release adds honesty copy about fidelity; a discovery rewrite (real agent metadata, authoritative tool registry, live sandbox detection) is a separate workstream.
- Deferred security follow-up items remain tracked in the public security roadmap.

**Migration (v0.6.3) — Adopting the new RBAC safe default on an existing install:**

```bash
# 1. Generate a setup secret
echo "SETUP_SECRET=$(openssl rand -hex 32)" >> .env.local

# 2. Enable RBAC (both vars required — code + middleware)
echo "RBAC_ENABLED=true" >> .env.local
echo "NEXT_PUBLIC_RBAC_ENABLED=true" >> .env.local

# 3. Rebuild (middleware uses a build-time constant)
npm run build

# 4. Restart the service, then visit /setup?secret=<your-secret> to create the first admin
```

**Controls Evidence (v0.6.3) — SOC 2 Trust Services Criteria:**

| Commit | SOC 2 TSC | ISO 27001:2022 | Evidence |
|---|---|---|---|
| d47ae69 Governance starter pack | CC1.1 / CC1.2 / CC1.3 / CC2.1 / CC3.1 / CC5.1 | A.5.1 / A.5.2 / A.5.4 / A.5.10 / A.5.19 | 14 policies + 2 registers + 4 templates |
| e4c8f4d Governance panel + docs whitelist | CC2.2 / CC6.1 | A.5.10 / A.8.3 | In-dashboard readable governance; subdir-aware whitelist |
| 21d249b RBAC safe default + boot WARN | **CC6.1** / CC6.6 / CC7.2 | **A.8.2** / A.8.3 / A.8.5 / A.8.15 | Authenticated-by-default; observable unsafe-config |
| a5367a9 Trust Audit honesty | CC2.2 / CC7.3 | A.5.10 / A.8.22 | Claim-to-evidence alignment |
| f1c9bbc Starter-templates UX | CC7.1 / CC7.2 | A.8.16 | Operator-chosen rule activation |
| abb0f2d Why-this-score | CC7.2 | A.8.16 | Explainable risk scoring |
| 1eebed5 Top-correlations preview | CC7.2 / CC7.3 | A.8.16 | Live top-signal surfacing |
| e662c3f ToolsAccessPanel state | CC2.2 / CC7.2 | A.5.10 / A.8.16 | State-disambiguation |
| c681dab Help-tour coverage | CC2.2 | A.5.10 | Documentation accuracy |
| 5a2419d OSS readiness honesty | CC1.2 | A.5.1 | Governance tone |
| bb69e11 Audit ledger v1.2 | CC4.1 / CC4.2 | A.5.36 | Continuous remediation log |
| 3c465f7 Wordmark hyperlink | CC2.2 | A.5.10 | Branding — neutral |

**Verified Platforms (v0.6.3):**

Same matrix as v0.6.2 below. No new OS / runtime / dependency versions introduced. `npm run build` clean on Node 22.22.0 / macOS 14.5 (test host).

---

## v0.6.2-alpha

**Release Date:** 2026-04-22
**Version:** v0.6.2-alpha
**Type:** Alpha (pre-OSS hardening)
**Status:** Superseded by v0.6.3-alpha
**Scope:** Pre-OSS hardening pass — security audit (2 Critical + 9 High findings resolved), the reviewer's 10-task pre-OSS hardening work, LiteLLM fork-bomb guards, plaintext-secret cleanup, MCP audit logging, shared panel-state exports.
**Upgrade Path:** Supported source: v0.6.1-alpha. Upgrade via `npm run build` + service restart. DB schema is additive (4 new indexes, new `config_defaults` keys for trust-audit caching). No manual migration required — schema migrations run automatically on first startup.

### v0.6.2 — Pre-OSS Hardening Pass

Hardening-focused release that closed the major findings from the 2026-04-22 security review and landed the pre-OSS hardening checklist. No new dashboard surfaces; this release sharpened what v0.6.1 shipped.

**Security summary:**
- LiteLLM process supervision and service startup checks improved.
- Provider key handling moved out of service definitions and into environment files.
- Audit mirroring and MCP invocation auditing improved.
- Operator role changes received dedicated audit events.
- Trust Audit caching, UI state handling, readiness indicators, and correlation rule workflows improved.

**Pre-OSS hardening highlights:**
1. **Trust Audit caching** — `/api/trust-audit` now serves the last cached report from `config_defaults.trust_audit_last_report` when available; re-runs are explicit via `POST /api/trust-audit/run`. New cache keys: `trust_audit_last_report` (JSON), `trust_audit_last_run_at` (ISO ts), `trust_audit_last_duration_ms` (int), `trust_audit_last_summary` (metadata fallback).
2. **Evidence pills on Trust Audit findings** — Each finding now carries a compact evidence pill (severity × category × surface) rendered above the detail block.
3. **UI state refactor** — Introduced shared panel-state components in `src/components/dashboard/shared.tsx`: `PanelDataState`, `PanelStateBar`, `PanelEmptyState`, `PanelErrorState`, `PanelDisconnected`, `isStale`, `formatTimeAgo`, `useDataState`. 15 panels migrated to the shared state bar for consistent loading/empty/error/disconnected presentation.
4. **Correlations value surfacing** — Top-line correlation scores are pulled into the Fleet Command Top Correlation card with backlinks.
5. **Readiness banner** — Fleet Command renders a compact GREEN/AMBER/RED readiness banner summarizing service health, shield status, and recent alert pressure.
6. **Risk-weight UI** — Shield rule and correlation-rule weights are now editable inline with live verdict preview.
7. **Custom correlation rules productized** — 4 starter templates (credential-leak-burst, prompt-injection-chain, cost-anomaly, trust-boundary-violation) ship in the UI with one-click clone-to-edit.
8. **API perf pass (+4 indexes)** — `idx_audit_action_time(audit_log)`, `idx_correlation_events_created`, `idx_correlation_events_rule_time`, `idx_alerts_created_at`, `idx_proxy_traffic_latency`. Hot dashboard queries dropped from ~140ms p95 to ~35ms p95 on a 3-day retention window.
9. **Verification script** — `scripts/verify-v062.sh` walks health, RBAC, shield, trust audit, and correlations in a single pass. Exits non-zero on any check failure.
10. **Shared panel-state exports** — (see item 3 above) — now the documented contract for new panels; see `18-developer-manual.md` §22.

**Breaking Changes (v0.6.2):**

| Change | Impact | Required Action |
|--------|--------|-----------------|
| `/api/trust-audit` response shape changed from `TrustAuditReport` to `{ report: TrustAuditReport, meta: { last_run_at, last_duration_ms, cached: boolean } }` | MCP `run_trust_audit` clients and any custom dashboards consuming the raw route must unwrap `.report` | Update clients to read `response.report` for findings and `response.meta` for freshness; MCP tool handler already updated |
| `systemd` unit in `deploy/clawnex.service` now binds Next.js to `127.0.0.1` only (`-H 127.0.0.1`) | Direct-to-port-5001 remote access no longer works out of the box | Front the dashboard with Caddy (preferred) or Tailscale for remote access; see `15-vps-deployment-quickstart.md` |
| `ufw allow 5001/tcp` removed from `install-vps.sh` | Port 5001 is no longer opened in UFW by default | When using Caddy: no action needed (80/443 are opened). When not using Caddy: open 5001 manually, but only behind a VPN — direct exposure is discouraged |
| `OPENROUTER_API_KEY` removed from launchd plist and `start.sh` on macOS | Any downstream tooling reading the env var from the plist will not find it | Source `OPENROUTER_API_KEY` from `~/sentinel/.env` only |

**Deprecations (v0.6.2):**

| Item | Deprecated In | Target Removal | Replacement |
|------|---------------|----------------|-------------|
| Direct `/api/trust-audit` return without wrapper | v0.6.2 | Removed in v0.6.2 | `{ report, meta }` wrapper |
| Plaintext `OPENROUTER_API_KEY` in launchd plist | v0.6.2 | Removed in v0.6.2 | `.env` sourcing only |
| Unconditional `ufw allow 5001/tcp` in installer | v0.6.2 | Removed in v0.6.2 | Caddy-fronted 80/443, or operator-opt-in for direct 5001 behind a VPN |

**Security Fixes (v0.6.2):**

| Reference | Finding | Severity | Resolution |
|-----------|---------|----------|------------|
| C-1 | LiteLLM fork-bomb when port 4001 already bound | Critical (availability) | Triple-guard: `lsof` in `start.sh`, socket check in `run.py`, `num_workers: 1` in `config.yaml` |
| C-2 | `OPENROUTER_API_KEY` stored plaintext in launchd plist and `start.sh` | Critical (credential exposure) | Removed from plist and `start.sh`; sourced from `.env` only |
| H-1 | Audit events not mirrored to stdout — SIEM gap | High (observability) | Unconditional stdout mirror with `[AUDIT]` prefix |
| H-2 | MCP tool invocations not audit-logged | High (observability) | `mcp:<tool>:invoked/completed/failed` audit events with duration |
| H-3 | Operator role changes indistinguishable from other updates in audit log | High (forensics) | New `operator_role_changed` audit action |
| H-6 | Next.js default binding `0.0.0.0` in systemd unit | High (exposure) | systemd unit binds `-H 127.0.0.1`; Caddy or Tailscale required for remote access |
| H-7 | UFW opens port 5001/tcp unconditionally | High (exposure) | `ufw allow 5001/tcp` removed from installer |
| H-8 | `/api/trust-audit` re-runs on every panel load | High (DoS potential) | Caching layer via `trust_audit_last_report` config key; explicit re-run required |
| H-9 | LiteLLM error logs silently written to a path that may not exist | High (support friction) | Error log path `~/.sentinel/litellm-error.log` (macOS) or systemd journal (Linux) documented in troubleshooting guide |
| H-10 | Hot audit/alert/correlation queries >100ms p95 on 3-day retention | High (perf) | 4 new indexes: `idx_audit_action_time`, `idx_correlation_events_created`, `idx_correlation_events_rule_time`, `idx_alerts_created_at`, `idx_proxy_traffic_latency` |
| H-11 | Panel loading/empty/error states visually inconsistent across 15 panels | High (UX consistency) | Shared panel-state components in `shared.tsx` |
| H-12 | Custom correlation rules had no starter templates — bare rule-builder | High (adoption) | 4 productized starter templates with one-click clone |

No external CVEs were disclosed against ClawNex in this release window.

**Known Issues (v0.6.2) — deferred High findings:**

| ID | Area | Description | Workaround | Target Fix |
|----|------|-------------|------------|------------|
| H-4 | Installer | `curl \| bash` install pattern in docs is deferred pending Host Security updater vendoring | Operators can download `install-vps.sh` and review before running | v0.7.0 |
| H-5 | Dependencies | Next.js 14.2.33 pin — 14.2.x has known low-severity advisories; upgrade pending stability review | None required (advisories are low-severity); pin will move to 14.2.latest in v0.7.0 | v0.7.0 |
| H-13 | Supply chain | Shield rule source files not HMAC-signed; `/api/health` upstream probe is slow (>2s on cold path) | Health endpoint behind cache; shield rules protected by file permissions | v0.7.0 |

**Verified Platforms (v0.6.2):**

| Platform | OS / Distro | Node.js | Python | Status |
|----------|-------------|---------|--------|--------|
| macOS (primary dev) | macOS 14.x (Sonoma) | 22.11.x | 3.12.x | Verified |
| macOS (Apple Silicon VM) | macOS 14.x on Parallels | 22.11.x | 3.12.x | Verified |
| Ubuntu LTS | Ubuntu 22.04 LTS | 22.11.x | 3.12.x | Verified |
| Ubuntu LTS | Ubuntu 24.04 LTS | 22.11.x | 3.12.x | Verified (VPS QA) |
| Debian | Debian 12 | 22.11.x | 3.12.x | Verified |
| Windows (native) | Windows 11 | — | — | Not supported (use WSL2) |
| Windows (WSL2) | WSL2 Ubuntu 22.04 | 22.11.x | 3.12.x | Best-effort |

**Dependency Pins (v0.6.2):**
- `litellm==1.83.0` (supply-chain pin — see `reference_litellm_compromise.md`)
- `better-sqlite3==12.8.0`
- `bcryptjs==3.0.0` (exact pin, pure-JS, 12 rounds)
- `next==14.2.33` (H-5 deferred to v0.7.0)
- All other dependencies pinned exactly per `feedback_pin_dependencies.md`

---

## v0.6.1-alpha

**Release Date:** 2026-04-14
**Version:** v0.6.1-alpha
**Type:** Alpha (hotfix + feature-dense)
**Status:** Superseded by v0.6.2-alpha
**Upgrade Path:** Supported source: v0.6.0-alpha. Upgrade via clean redeploy per `12-deployment-guide.md`. DB schema is additive (3 new tables, new `config_defaults` keys). No manual migration required — schema migrations run automatically on first startup. No rollback required for in-flight sessions; existing sessions remain valid.

### v0.6.1 — QA Fixes & Operator Lifecycle

Hotfix release addressing findings from the first full QA test battery (157 tests, 5 RBAC roles).

**Auth/Session Fixes:**
- **Cookie secure flag** — Session and CSRF cookies now key `secure` off the actual request protocol (`https:`), not `NODE_ENV`. Fixes HTTP deployments where `NODE_ENV=production` caused browsers to silently reject Secure cookies.
- **Rate limiter IP detection** — Login rate limiter now falls back to `x-forwarded-for` when `request.ip` is unavailable (standalone mode without reverse proxy).
- **Progressive lockout** — Replaces flat 30-minute lockout with tiered escalation: 5 failures → 1 minute, 10 → 5 minutes, 15 → 30 minutes, 20+ → account auto-disabled (requires admin re-enable). Auto-disable logged to audit trail.
- **Setup page redirect** — `/setup` now checks auth status on mount and redirects to `/login` if setup is already completed (prevents re-rendering the wizard after admin creation).

**Operator Management:**
- **Deactivate/Reactivate toggle** — Admins can now deactivate operator accounts without deleting them (preserves audit history). Deactivated operators cannot log in. Reactivation re-enables the account.
- **Password reset** — Admin-initiated password reset already existed; added "Forgot your password? Contact your ClawNex administrator" guidance on the login screen.
- **Password strength** — Fixed strength heuristic: numeric-only passwords (e.g. `12345678`) now correctly rate as "Weak" instead of "Fair". Requires 2+ character classes for diversity credit.

**RBAC UI Enforcement:**
- **Audit Clear button** — Now hidden for non-admin roles (was visible but server-blocked).
- **Viewer hidden tabs** — Added `trafficMonitor`, `auditEvidence`, `executiveReports` to viewer's hidden panel list.
- **Auditor hidden tabs** — Fully aligned with permission matrix. Auditor now only sees: Fleet Command, Token & Cost Intel, Audit & Evidence, Executive Reports, Help, Credits & Info.

**Documentation:**
- Help panel documentation reduced from 35 to 11 operator-facing docs. Architecture, security assessment, and internal docs held back from the UI.
- API endpoint enforces doc allowlist (held-back docs return 400 even via direct API call).
- PII scrubbed from all docs (IP addresses, hostnames, infrastructure details removed).

**Mail Configuration (Password Reset):**
- **Resend + SMTP support** — New "Mail Configuration" card in Configuration with provider selector (Disabled / Resend / SMTP), from email, API key or SMTP credentials, and a test button to verify delivery.
- **Forgot password flow** — Login page now has a "Forgot your password?" link. Operator enters their email, receives a reset link, and sets a new password. Reset links expire after 30 minutes. All sessions revoked on password change.
- **API endpoints** — `GET /api/config/mail`, `PUT /api/config/mail` (read/update mail settings), `POST /api/config/mail` (send test email), `POST /api/auth/forgot-password` (request reset link), `POST /api/auth/reset-password` (consume reset token and set new password).

**Model Selection Toggle:**
- **Interactive model discovery** — Clicking Test on a model provider now discovers all available models from the provider's API and displays them as clickable toggles.
- **One-click add/remove** — Green "+ MODEL" adds a model to LiteLLM config; amber "MODEL x" removes it. Each action auto-syncs `config.yaml` and restarts LiteLLM so the model is immediately routable. No manual config editing needed.

**Fleet Connectors:**
- **Consolidated gateway card** — OpenClaw and Hermes gateway cards merged into a single "Fleet Connectors" card with 4 collapsible sections: OpenClaw (LIVE), Hermes (LIVE), Paperclip (COMING SOON), NemoClaw (ALPHA). Each section independently expandable with status indicators and instance management.

**Trust Boundary Audit:**
- **14 rules** — New rule set covering cross-agent trust boundary violations: prompt injection via tool responses, memory poisoning, indirect instruction hijacking, capability escalation, context leakage, and more.
- **Discovery engine** — Automatically scans active sessions and tool interactions to surface trust boundary candidates.
- **4 dashboard views** — Matrix view (rules × agents), remediation view (actionable fix guidance per finding), surfaces view (attack surface enumeration), and a summary panel added to the SECURITY group as a dedicated **Trust Audit** panel.
- **API endpoints** — `GET /api/trust-audit`, `POST /api/trust-audit/run`, `GET /api/trust-audit/rules`.

**Enhanced MCP Tools (10 total):**
- Original 5 tools retained: `get_security_status`, `get_alerts`, `get_traffic_stats`, `run_shield_scan`, `get_system_health`.
- 5 new tools shipped in v0.6.1: `configure_provider` (add/update LLM provider configs via MCP), `generate_report` (trigger any of the 12 executive report types), `run_shield_tests` (run the full test suite remotely), `run_trust_audit` (trigger a trust boundary audit scan), `manage_budget` (read/write cost budget thresholds).

**Scheduled Reports:**
- **Three schedules** — Daily (06:00), weekly (Monday 07:00), monthly (1st of month 08:00). Each schedule independently enable/disable.
- **Email delivery** — Reports delivered via the configured mail provider (Resend or SMTP). Requires mail configuration to be active.
- **On/off toggle** — Per-schedule enable/disable without losing the schedule config.
- **Configuration card** — New "Scheduled Reports" card in the Configuration tab.
- **API endpoints** — `GET /api/config/scheduled-reports`, `PUT /api/config/scheduled-reports`.

**Custom Correlation Rules:**
- **Weighted conditions** — Each condition in a rule carries an individual weight (0.0–1.0). Total weighted score drives the verdict.
- **Threshold scoring** — Rules fire when the weighted score meets or exceeds a configurable threshold (0.0–1.0).
- **Time windows** — Rules evaluate events within a configurable rolling time window (1m–24h).
- **Configuration card** — New "Custom Correlation Rules" card in the Configuration tab with full create/edit/delete UI.
- **API endpoints** — `GET /api/config/correlation-rules`, `POST /api/config/correlation-rules`, `PUT /api/config/correlation-rules/:id`, `DELETE /api/config/correlation-rules/:id`.

**Caddy HTTPS Integration:**
- **Auto-TLS** — Caddy handles certificate provisioning and renewal automatically via ACME/Let's Encrypt. Zero manual cert management.
- **Caddyfile generation** — ClawNex generates a ready-to-use Caddyfile for the configured domain with correct upstream proxy rules.
- **Status monitoring** — Configuration card shows Caddy service status (running / stopped / not installed) and the active domain.
- **Configuration card** — New "HTTPS / Caddy" card in the Configuration tab.
- **Ports** — Caddy listens on 80 (redirect) and 443 (TLS). Port 5001 remains the direct access fallback.

**Dashboard Updates:**
- **Trust Audit panel** — New panel added to the SECURITY group in the sidebar. Shows rule results matrix, last-run timestamp, and remediation queue.
- **3 new Configuration panel cards** — Scheduled Reports, Custom Correlation Rules, HTTPS / Caddy (described above).
- **23 panels total** — up from 22 in v0.6.0.

**Code Cleanup:**
- Removed dynamic `require()` in setup route (replaced with static import).
- Version bumped to 0.6.1-alpha across all 9 code locations.

**Breaking Changes (v0.6.1):**

| Change | Impact | Required Action |
|--------|--------|-----------------|
| Progressive lockout replaces flat 30-minute lockout | Operators exceeding 20 failed logins are now auto-disabled and require admin re-enable | Train admins on the Operator Management reactivation workflow (Admin role only) |
| Cookie `Secure` flag keys off request protocol (not `NODE_ENV`) | HTTP-only deployments that previously set `NODE_ENV=production` will now accept session cookies that were silently rejected before | Confirm reverse proxy protocol headers (`X-Forwarded-Proto`) are set correctly for HTTPS deployments |
| Help panel docs reduced from 35 to 11 | Deep-link URLs to held-back docs now return 400 | Update bookmarks to canonical `/docs/` paths; internal architecture docs retrieved directly from the file system |
| Auditor role hidden-tabs fully aligned with permission matrix | Auditor-role operators lose access to tabs they incidentally reached before | Communicate scope change to compliance teams before upgrade |

**Deprecations (v0.6.1):**

| Item | Deprecated In | Target Removal | Replacement |
|------|---------------|----------------|-------------|
| Flat 30-minute lockout | v0.6.1 | Removed in v0.6.1 | Progressive lockout (5/1m, 10/5m, 15/30m, 20/disable) |
| Separate OpenClaw and Hermes gateway cards | v0.6.1 | Removed in v0.6.1 | Consolidated "Fleet Connectors" card |
| `NODE_ENV`-driven cookie `Secure` flag | v0.6.1 | Removed in v0.6.1 | Request-protocol-driven detection |
| Legacy proxy-source traffic (`source='proxy'`) | v0.4.4 | v0.7.0 | `source='litellm'` / `source='session-watcher'` / `source='break-glass'` |

**Security Fixes (v0.6.1):**

| Reference | Finding | Severity | Resolution |
|-----------|---------|----------|------------|
| CX-41 | Cookie `Secure` flag rejected over HTTP when `NODE_ENV=production` | High (availability) | Protocol-driven detection |
| CX-42 | Rate limiter accepted missing `request.ip` silently in standalone mode | Medium | `x-forwarded-for` fallback with header-spoof guard |
| CX-43 | Setup wizard re-renderable after initial admin creation | Medium | `/setup` redirects to `/login` when already provisioned |
| CX-44 | Held-back internal docs reachable via direct API call | Medium | Allowlist enforcement in docs API |
| CX-45 | Password strength heuristic under-weighted numeric-only passwords | Low | Requires 2+ character classes for diversity credit |

No external CVEs were disclosed against ClawNex in this release window. Upstream supply-chain exposure is tracked via the LiteLLM 1.83.0 pin (see `11-security-architecture.md`).

**Known Issues (v0.6.1):**

| ID | Area | Description | Workaround | Target Fix |
|----|------|-------------|------------|------------|
| KI-0610-01 | Scheduled reports | Monthly schedule does not skip months where mail provider is misconfigured — it logs `failed` rows instead of skipping | Monitor `scheduled_report_runs` for `status='failed'` | v0.6.2 |
| KI-0610-02 | Trust Boundary Audit | First run after fresh install may surface `warn` statuses for agents with zero sessions due to empty surface set | Trigger a second run after first session activity | v0.6.2 |
| KI-0610-03 | Caddy HTTPS | `caddy_status` flips to `unknown` briefly when Caddy is reloaded without service restart | Poll `/api/config/https` after reload; refresh Configuration card | v0.6.2 |
| KI-0610-04 | Custom Correlation Rules | Rules with `time_window_seconds > 86400` (24h) are accepted but truncated to 24h at evaluation | UI now caps input at 24h; pre-existing DB rows unchanged | v0.6.2 |
| KI-0610-05 | MCP tool `run_shield_tests` | Does not stream progress — returns only on completion of full suite | Run from UI for progress bar | v0.7.0 |

**Verified Platforms (v0.6.1):**

| Platform | OS / Distro | Node.js | Python | Status |
|----------|-------------|---------|--------|--------|
| macOS (primary dev) | macOS 14.x (Sonoma) | 22.11.x | 3.12.x | Verified |
| macOS (Apple Silicon VM) | macOS 14.x on Parallels | 22.11.x | 3.12.x | Verified |
| Ubuntu LTS | Ubuntu 22.04 LTS | 22.11.x | 3.12.x | Verified |
| Ubuntu LTS | Ubuntu 24.04 LTS | 22.11.x | 3.12.x | Verified (VPS QA) |
| Debian | Debian 12 | 22.11.x | 3.12.x | Verified |
| Windows (native) | Windows 11 | — | — | Not supported (use WSL2) |
| Windows (WSL2) | WSL2 Ubuntu 22.04 | 22.11.x | 3.12.x | Best-effort |

**Dependency Pins (v0.6.1):**
- `litellm==1.83.0` (supply-chain pin — see `reference_litellm_compromise.md`)
- `better-sqlite3==12.8.0`
- `bcryptjs==3.0.0` (exact pin, pure-JS, 12 rounds)
- `next==14.2.33`
- All other dependencies pinned exactly per `feedback_pin_dependencies.md`

---

## v0.6.0-alpha

**Release Date:** 2026-04-13
**Version:** v0.6.0-alpha
**Type:** Alpha (feature release — security foundation)
**Status:** Superseded by v0.6.1-alpha
**Upgrade Path:** Supported source: v0.5.5-alpha. Clean redeploy required (per `feedback_clean_redeploy.md`). First visit after upgrade routes to `/setup` for admin creation; plan a brief outage window during the initial wizard.

**Breaking Changes:** RBAC is OFF by default until `/setup` is completed. Once completed, all dashboard routes and all 96 internal API routes require authentication — scripts and integrations must present a valid `clawnex_session` cookie or API key. CSRF headers required on all mutating verbs.

**Security Fixes:** All 7 previously deferred Codex findings from v0.5.5 closed by RBAC layer (unauthenticated admin plane, SSRF, command execution, file disclosure, secret bundle protection).

### Role-Based Access Control (RBAC)

The headline feature of v0.6.0: a complete operator identity and access control system.

**Session Authentication:**
- Session tokens: `crypto.randomBytes(32)` → SHA-256 hash stored in SQLite
- Cookie: `clawnex_session`, HttpOnly, SameSite=Lax, Secure when HTTPS
- Configurable session TTL (default 24h), "Remember me" for 30 days
- Instant revocation by deleting the session row
- Max 5 sessions per operator (oldest destroyed when exceeded)
- Expired session cleanup piggybacks on health check

**5 Roles, 28 Permissions:**

| Role | Description |
|------|-------------|
| Admin | Full access — system management, operator management, purge, break-glass |
| Security Manager | Security ops lead — shield config, break-glass, alert management, audit read |
| Operator | Day-to-day SOC — view all, scan, manage alerts, NO config changes |
| Viewer | Read-only — view panels, no mutations |
| Auditor | Cross-cutting — read ALL audit data + export reports, NO operational actions |

**Password Security:**
- bcryptjs (12 rounds, pure JS, exact-pinned)
- Constant-time login (dummy bcrypt hash for nonexistent users — no timing-based user enumeration)
- Account lockout: 10 failed attempts → locked (admin re-enables)

**CSRF Protection:**
- Double-submit cookie pattern
- `clawnex_csrf` cookie (not HttpOnly — JS reads it) + `X-CSRF-Token` header
- Required on POST/PUT/DELETE/PATCH when RBAC enabled

**Setup Wizard:**
- First visit with RBAC enabled and zero operators → `/setup` page
- Creates the initial admin account with username, optional email, password
- Password strength indicator (Weak/Fair/Good/Strong)
- Atomic check-then-create in SQLite transaction (race-safe)

**Login Page:**
- ClawNex branding (logo, gradient title)
- Session expired message when redirected with `?expired=1`
- "Remember me" checkbox for 30-day sessions

**Operator Management (Admin-only):**
- Create/edit/remove operators with role assignment
- Password reset (inline)
- Unlock locked accounts
- Display name and email management
- Last-admin invariant (prevents bricking the system)

**Middleware:**
- Edge Runtime cookie-gate (checks cookie PRESENCE only — not validity)
- Per-route `requireSession()` + `requirePermission()` is the real security boundary
- All 94 API routes protected when RBAC enabled

**Dashboard Integration:**
- Operator identity display in header (username + role badge + logout)
- Session expiry detection (60s poll)
- Role-based sidebar hiding (`ROLE_HIDDEN_TABS`)
- CSRF token auto-injection via `window.fetch` monkey-patch
- Audit trail records real operator usernames

**Standalone Deploy:**
- `output: 'standalone'` in next.config.mjs — pre-built deployment package
- 8MB compressed tarball (vs full `npm install` on target)
- `node server.js` with `.env` sourced — no `next start` or `npm` needed on target

**OSS Prep:**
- Apache 2.0 license (Copyright 2026 ClawNex maintainers)
- DCO (Developer Certificate of Origin)
- GitHub Actions CI (build + type check)
- .env.example
- .gitignore hardened (credentials, databases, IDE files)
- 12 rounds of Codex security review, 70+ findings resolved

---

## v0.5.4-alpha

**Release Date:** 2026-04-11
**Status:** Superseded by v0.6.0-alpha

### Global Tooltip System

- **Hover-anywhere help surface** — A new ClawNex-wide tooltip primitive wraps any UI element with contextual help. Tooltips render through a portal (`#clawnex-tooltip-root` in `layout.tsx`) so parent `overflow: hidden` containers never clip them. Hover + keyboard focus both trigger; `Escape` or blur dismisses; a module-level event bus guarantees that only one tooltip is visible at a time. Positioning auto-flips when an edge would be clipped and clamps to the viewport with a 12px margin.
- **Global TIPS toggle** — New **TIPS** button in the dashboard header, next to the `?` help button, visible at all times. Flipping it OFF turns every tooltip in the dashboard into a pass-through — no event listeners, no extra DOM, no portal work. State persists via `config_defaults.tooltips_enabled` and rehydrates on load.
- **Discoverability language** — At-rest visual hints tell operators which elements carry extra help before they have to hover-hunt:
  - **Span anchors** (inline text, badges, column headers) get a dotted cyan underline at rest that brightens to full opacity on hover. Theme-aware alpha so the underline reads on both dark and light substrates. `cursor: help` universally.
  - **Block anchors** (Stat tiles, cards wrapped in `as="div"`) get a portal-rendered corner pip — a 6px cyan dot pinned to the anchor's top-right via `readAnchorRect()`, tracked by `ResizeObserver` on the first child so it follows flex reflows, card expansion, and responsive rewraps. Scroll and resize listeners reposition it. Fades from ~40% alpha at rest to 100% with a glow halo on hover.
- **Light-mode theme for overlays** — Tooltip substrate flips between the deep-space dark glass (`rgba(10,16,28,0.92)`) and a frosted near-white panel (`rgba(255,255,255,0.94)`) with darker text (`#0b1524`) and softer warm shadows when the dashboard is in light mode. The signature 2px cyan accent bar and arrow tint stay consistent on both themes.
- **Respects `prefers-reduced-motion`** — Scale/translate entry animation disabled for users who opt out; opacity-only fallback at 120ms.
- **26 tooltips shipped** across Fleet Command, Prompt Shield, Traffic Monitor, Agents & Sessions, Token & Cost Intel, Infrastructure, Access Control, and Configuration. Voice is compact for stats, detail-variant with a file path or concrete number for deeper panels.

### Collapsible Sections

Four high-density sections converted from `Card` to `CollapsibleCard`, giving operators the ability to hide reference data they're not actively triaging. Each shows a count pill in the collapsed header so the data stays discoverable:

- **Recent Shield Events** (Prompt Shield) — shows filtered scan count
- **Live Traffic** (Traffic Monitor) — shows filtered/total request count
- **Agents** (Agents & Sessions) — shows agent count
- **Cost by Agent** (Token & Cost Intel) — shows distinct agent count

All default to open so existing workflows are unchanged.

### Fixes

- **Hydration error on first paint** — Wrapping block-level `<Stat>` elements inside a `<span>` violated HTML nesting rules and triggered a Next.js "missing required error components" white-screen fallback. Fixed by adding an `as="span" | "div"` prop to the Tooltip primitive, and for block anchors using `display: contents` so the child stays a direct layout participant (preserves `flex: 1`, grid placement, etc.). Positioning falls back to `firstElementChild.getBoundingClientRect()` since contents-display boxes have no frame.
- **Total Cost stat asymmetric width** — Same root cause as the hydration error; the inline-block wrapper broke the parent flex row's `flex: 1` layout and squished the Total Cost tile against its neighbors. Fixed by the same `display: contents` change.
- **Model Pricing sync 404** — `getLiteLLMTag()` only appended `-nightly` for clean `x.y.0` versions and tried a plain `v<version>` tag for patch versions like `1.82.6` — which doesn't exist on GitHub. The pricing JSON lives only on `-nightly` tags. Now always appends `-nightly`. Verified: 2151 models sync successfully on the pinned version.
- **Infrastructure status badge tooltips missing for ONLINE/OFFLINE** — Only `DEGRADED` and `NOT_CONFIGURED` states had tooltip coverage, so operators with a healthy fleet never saw the feature. Expanded to all four states with per-state guidance including the latency column thresholds for `ONLINE` and watchdog restart behavior for `OFFLINE`.
- **`Table` headers type too narrow** — `string[]` widened to `ReactNode[]` to support tooltip-wrapped headers without casting.

### Security Hardening (Codex Audit)

Two rounds of Codex security review (standard + adversarial) identified critical, high, and medium findings. Applied fixes:

- **[P1 FIXED] Chat completions auth** — replaced broken custom `authenticateApiKey()` (queried non-existent `revoked` column, skipped scope/expiry/rate-limit) with shared `authenticateRequest()` middleware enforcing `chat:completions` scope
- **[P2 FIXED] Migration export path** — fixed `litellm/litellm_config.yaml` to `litellm/config.yaml` (the actual live filename)
- **[HIGH FIXED] Secret redaction** — provider API keys and gateway tokens masked in all GET responses (`api_key_masked` / `token_masked` fields, plaintext cleared). Config defaults secrets (gateway tokens, voice API keys) also masked.
- **[HIGH FIXED] Localhost guard** — destructive admin endpoints (`system/purge`, `system/uninstall`, `break-glass/activate`, `break-glass/deactivate`, `config/api-keys POST`) reject non-localhost callers with 403. Guard does NOT trust `X-Forwarded-For` (spoofable) — fails CLOSED in production.
- **[MEDIUM FIXED] Scope mismatch** — chat completions endpoint now checks `chat:completions` matching the UI/api-keys scope (was `chat:write`)
- **[MEDIUM FIXED] Committed secrets** — `litellm/config.yaml` and `litellm/venv/` added to `.gitignore`
- **[HIGH FIXED] Shield scan input unbounded** — public `/api/v1/shield/scan` now has 500k character limit matching internal route
- **[HIGH FIXED] Deploy script runs dev mode** — `deploy.sh` now uses `next start` + `NODE_ENV=production`
- **[HIGH FIXED] Error message leakage** — 7 catch blocks sanitized to return generic "Internal server error"
- **[HIGH FIXED] LiteLLM port env injection** — validated as 1-65535 before shell interpolation
- **[HIGH FIXED] MCP CORS wildcard** — `Access-Control-Allow-Origin` restricted from `*` to `http://127.0.0.1:5001`
- **[MEDIUM FIXED] Report generation DoS** — LIMIT 10000 on 11 unbounded queries
- **[MEDIUM FIXED] Alert dedup race** — SELECT+INSERT wrapped in transaction
- **[MEDIUM FIXED] Backup/migration permissions** — chmod 0600 on all sensitive artifacts
- **[MEDIUM FIXED] HTTP security headers** — X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy added via next.config.mjs
- **[MEDIUM FIXED] Skills inventory trust boundary** — resolved-path + symlink check
- **[LOW] Provider URL scheme warning** — logs when credentials sent over plain HTTP to non-localhost

Previously deferred findings (resolved in v0.6.0 RBAC):

- **[RESOLVED] Unauthenticated admin plane** — All 94 API handlers now require session auth when RBAC enabled.
- **[RESOLVED] /api/chat billable proxy** — Protected by `requireSession()` + `chat:use` permission.
- **[RESOLVED] Voice/avatar proxies** — Protected by `requireSession()` + `voice:use` permission.
- **[RESOLVED] Provider management SSRF** — Protected by `requireSession()` + `config:write` permission (admin-only).
- **[RESOLVED] Remote command execution** — Protected by `requireSession()` + `system:manage` permission (admin-only).
- **[RESOLVED] Workspace file disclosure** — Protected by `requireSession()` + `workspace:read` permission.
- **[RESOLVED] Archive/migrate secret bundles** — Protected by `requireSession()` + `system:manage` permission (admin-only).

### Hermes-Agent Integration

- **Hermes as fleet gateway instance** — Hermes-Agent (Nous Research) appears as a peer instance alongside OpenClaw in the global instance selector dropdown. Selecting "Hermes Agent" filters all panels to show only Hermes data.
- **Hermes watcher** — reads `~/.hermes/state.db` (SQLite, WAL mode) in read-only mode every 10s. Shield-scans new messages and logs results to `proxy_traffic` with `source='hermes-watcher'`. Generates alerts for BLOCK/REVIEW verdicts.
- **Hermes token reader** — aggregates token/cost data from Hermes sessions table. Uses Hermes's own `actual_cost_usd` when available, falls back to ClawNex's `computeCost()` via the LiteLLM price table.
- **Global instance filtering** — every panel passes `selectedInstance` to its API calls. Backend APIs filter by instance: `hermes-local` returns only Hermes data, `openclaw-local` returns only OpenClaw data, `all` returns everything merged.
- **New files:** `hermes-db.ts`, `hermes-watcher.ts`, `hermes-watcher-runner.ts`, `hermes-token-reader.ts`
- **Modified APIs:** health, fleet, agents, tokens, traffic, shield stats/history, alerts, audit — all accept `instance` query param
- **Modified panels:** AgentsSessionsPanel, TokenCostPanel, TrafficMonitorPanel, PromptShieldPanel, AlertsIncidentsPanel, AuditEvidencePanel, CostByAgentCard — all pass instance filter
- **Manual Hermes instance management** — Configuration panel now has "HERMES AGENT INSTANCES" card with add/remove form matching the OpenClaw gateway pattern. New `hermes_instances` DB table + `/api/config/hermes-instances` API with localhost guard.
- **Per-agent workspace** — Agent Workspace now loads files from `workspace-<agentId>/` per agent, showing each agent's unique SOUL.md, not the shared workspace.
- **Hermes Infrastructure view** — when Hermes selected, shows agent health, components (state.db, config, memory, skills, logs), sessions, platforms.
- **Hermes Models view** — shows model config (openai/gpt-5.4), provider (OpenRouter), custom providers from config.yaml.

### Roadmap Changes

- **IP Protection roadmap killed in full.** All phases (source removal, machine-binding, AES encryption, JS/Python obfuscation, runtime integrity checking, deployment watermarking, SQLCipher, license server) are incompatible with the open-source direction ClawNex is moving toward. `docs/ip-protection-strategy.md` removed.
- **Open-source direction approved.** ClawNex will be released under **Apache 2.0** with **DCO (Developer Certificate of Origin)** sign-off on commits. Prep work (SECURITY.md, CONTRIBUTING.md, license audit, git history scrub, public repo cutover) is on the v0.5.5+ roadmap.
- **New roadmap items added:** Help tab, About tab (combined Credits/Disclaimers), Hermes-Agent connector (Nous Research's MIT-licensed self-improving agent framework), and OSS release prep.

---

## v0.5.3-alpha

**Release Date:** 2026-04-10
**Status:** Superseded by v0.5.4-alpha

### First-Run Experience

- **Welcome Wizard** — Fleet Command now renders a 6-step setup checklist on fresh installs: Install ClawNex → Add AI model provider → Install Host Security → Sync CVE database → Configure OpenClaw routing → Run first shield test. The shield-test step is intentionally last so the wizard keeps reappearing on every browser refresh until all prior steps are complete.
- **Setup Complete screen** — When every step passes, the wizard transitions to a green "You're all set!" state with a single **Get Started →** button. Clicking it writes `wizard_dismissed=1` to `config_defaults`, so the wizard never reappears on subsequent refreshes for that operator.
- **In-wizard Host Security install** — The Install Host Security step now has an **Install Now** button that POSTs to `/api/system/install-clawkeeper` directly. No more copy-paste bash commands. A secondary "Open Updates panel" link jumps to Configuration → Updates if the operator prefers the manual path.
- **Navigate-with-focus** — Wizard action buttons deep-link into specific Configuration cards (Model Providers, OpenClaw Routing, Updates). Target cards auto-expand and scroll into view so the operator lands on the right control without hunting.

### Infrastructure Panel Hardening

- **LiteLLM Restart in place** — Clicking Restart on the LiteLLM row now actually calls the restart API. Previously, the parent row's `onClick` handler intercepted the click and bounced the operator to Configuration. Event propagation is now stopped on the button, and the row-click navigation is restricted to `NOT_CONFIGURED` services only. Offline/degraded rows rely on the inline Restart button.
- **LiteLLM proxy badge on Instance Detail** — When LiteLLM is offline or degraded, the badge in the Services row becomes clickable and navigates to the Infrastructure tab so the operator can hit Restart from there.

### OpenClaw Routing Panel

- **Empty-providers distinction** — The routing guide no longer shows a red "Could not read openclaw.json" error when `openclaw.json` was read successfully but contained zero LLM providers. It now shows a friendly blue info box explaining that the config is present but empty, and instructs the operator to add a provider in OpenClaw first. The error state is reserved for actual read failures.
- **Path resolution helper** — Introduced `resolveOpenClawPaths()` with a fallback chain (`OPENCLAW_HOME` env → `~/.openclaw` → `~/.config/openclaw` → scan `/home/*/.openclaw` → `/root/.openclaw`), used uniformly across the fleet, routing, and agents APIs so path detection is consistent.

### Identity & Defaults

- **Hostname-default display name** — Fleet Command's client name defaults to the machine's hostname (`os.hostname()`) and falls back to `"local"` if unavailable. The hardcoded `"Project owner"` string is gone.
- **Display Name override** — Operators can override the display name via Configuration → UI Preferences → Display Name. The value is persisted in `config_defaults.display_name` and appears in Fleet Command, the Welcome Wizard, and Instance Detail.
- **Gateway token auto-pull on fresh install** — `seed.ts` now calls `getGatewayTokenFromOpenClaw()` on first run and seeds the token into `config_gateways.token`, so manual deploys that bypass `setup.sh` still get the token automatically.

### Chat Assistant

- **Wizard-aware responses** — The AI chat assistant's system prompt now includes v0.5.3 platform awareness (Welcome Wizard, Setup Complete flow, LiteLLM restart behavior, OpenClaw routing nuances, display name override). New keyword fallbacks for "wizard", "setup", "litellm", "restart".

### Help, Tour, and Docs

- **PANEL_HELP refreshed** — Help overlay copy for Fleet Command, Instance Detail, Infrastructure, Configuration, and Security Posture updated to reflect wizard flow, LiteLLM restart button, and navigate-with-focus behavior. Both the in-app Guided Tour and FloatingAvatar narration read directly from `PANEL_HELP`, so they pick up all updates automatically.
- **Uninstall script — systemd support** — `scripts/uninstall.sh` now detects and removes systemd units (`clawnex-dashboard.service`, `clawnex-litellm.service`) in addition to the existing macOS launchd handling, so VPS/Linux installs can be cleanly uninstalled.

---

## v0.5.2-alpha (2026-04-05)

### Global Context Bar

- **Truly global time range** — The context bar (1h, 6h, 24h, 7d, 30d) now controls ALL dashboard panels uniformly. Previously, Fleet Command and Audit & Evidence had independent time handling; now every panel responds to the global selector.
- **Fleet API `since` parameter** — `GET /api/fleet` now accepts a `since` query parameter (ISO-8601 timestamp). Threat counts, alert counts, and cost calculations are all filtered to the selected time window. When omitted, defaults to 24h for threats/alerts and 30d for cost (backward compatible).
- **Audit panel unified** — Removed the local time range selector (30m/1h/6h/24h/7d/30d) from Audit & Evidence. Audit data now respects the global context bar, consistent with all other panels.
- **Dynamic stat labels** — Fleet Command "Threats" stat box label now reflects the selected time range (e.g., "Threats (1h)", "Threats (7d)") instead of always showing "Threats (24h)".
- **Search box removed** — Removed non-functional search placeholder from the context bar. Individual panels retain their own functional search fields (Audit, Traffic).

### New Features

- **Contextual Help Flyout** — `?` button in every panel header opens a right-side drawer with panel description, key metrics explained, available actions, and links to related panels. Content is specific to the active panel.
- **Guided Tour Mode** — "Tour" button walks new users through all 20 panels (22 as of v0.6.1) sequentially with Prev/Next/Finish controls. Each stop shows contextual help for that panel.
- **Instance Detail populated** — Replaced "coming soon" placeholder with real data: Services health panel, Recent Alerts table (collapsible, time-filtered), and Recent Activity table (collapsible, time-filtered).
- **Collapsible correlation entries** — Each correlation in the Correlations tab is now collapsible (click header to expand). Shows severity, rule name, event count, and time in collapsed state. Full timeline and AI recommendation visible when expanded.
- **Correlation pagination** — Page size selector (5/10/25/50) with Prev/Next navigation for correlation entries.

### UI/UX

- **Compact stat boxes** — Fleet Command stat boxes tightened: reduced padding (14px→8px), condensed number font (28px→20px), smaller labels (11px→9px), narrower minimum width (130px→90px), tighter gap (12px→6px). Numbers now fit compactly without overflow.
- **Dynamic cost label** — "Fleet Monthly" renamed to "Fleet Cost (Xd)" reflecting the actual selected time range.
- **Status bar labels clarified** — "HEALTHY" → "SERVICES" (counts infrastructure services, not fleet instances), "CRITICAL" → "DOWN" (offline services), "BLOCKED" → "BLOCK VERDICTS" (shield verdicts).
- **Shield Summary synced** — Shield Summary card in Fleet Command now pulls from the same source as the status bar badge (shield/stats API), with the global time range applied.
- **"Block Verdicts" terminology** — Replaced "Blocked" with "Block Verdicts" across Instance Detail and status bar to accurately reflect that it counts verdicts, not necessarily stopped requests.
- **Security Posture collapsible** — Hardening Report and Remediation Suggestions now use CollapsibleCard, collapsed by default.
- **Agent Workspace cleaned** — Removed duplicate "Agent Souls" sidebar section; top bar agent tabs remain as single selector.
- **Recent Metric Snapshots removed** — Removed raw debug data panel from Token & Cost Intel (was noise: session_count=0, agent_count=0 on repeat).

### Changes

- **Alert severity mapping** — Session watcher now maps shield score to appropriate severity instead of hardcoding CRITICAL for all BLOCKs: score ≥80 → CRITICAL, ≥60 → HIGH, else MEDIUM. REVIEW verdicts: ≥50 → HIGH, ≥25 → MEDIUM, else LOW.
- **Correlation alerts diversified** — Correlation engine now creates alerts for all severity levels, not just CRITICAL.

### Threat Intelligence (Pliny the Liberator)

- **16 new shield rules** — Rule count increased from 139 to 155. Added detection for techniques from Elder Pliny's published jailbreak research:
  - **Jailbreak (10):** GODMODE divider/tag, compliance priming, refusal inversion, anti-refusal, fake system tags, l33tspeak output forcing, role hijacking, system prompt override, chain-of-thought manipulation
  - **Steganography (3):** Unicode Tags block (U+E0001-E007F), variation selector abuse, binary-encoded payloads
  - **Encoding (3):** Multi-layer encoding, l33tspeak instructions, character substitution obfuscation
- **Threat Intelligence panel** — New "Threat Intelligence" card in Policies & Guards tab. Shows 4 monitored GitHub repos (L1B3RT4S, ST3GG, G0DM0D3, P4RS3LT0NGV3), rule counts per source, last checked times, and update status.
- **GitHub monitoring** — "Check for Updates" button polls GitHub API for latest commit SHAs. When a new commit is detected, creates a MEDIUM alert and marks the source as "UPDATE AVAILABLE" in the UI.
- **`GET /api/threat-intel`** — Returns intel source list, rule counts, and check status.
- **`POST /api/threat-intel/check`** — Polls GitHub repos, stores commit SHAs, creates alerts on changes, audit-logs the check.

### Design Language Rollout (2026-04-04)

- **Fleet Command bottom summary cards** — Three cards below the fleet table: Top Correlation (with "Full analysis →"), Alert Summary (CRITICAL/HIGH/MEDIUM counts + latest alert + "View Alerts →"), Prompt Shield (block count + rate bar + "Open Prompt Shield →").
- **Instance Detail timeline** — Replaced flat tables with unified chronological timeline. Continuous vertical connecting line, severity-colored dots, compact rows (6px spacing), backlinks ("Alerts →" / "Audit →") on every row. Consecutive duplicate events grouped with expand toggle (▶ x9).
- **Alerts & Incidents incident board** — Replaced table with collapsible card-based layout. Each alert is a card with severity left border, bold title, age timer, status pill. Collapsed: one-line summary. Expanded: description, source, ACK/Resolve buttons, backlink to originating panel (correlation name, Traffic, Shield, or Audit).
- **Shield Tests collapsible cards** — Each test is a collapsible card with pass/fail icon, source tag (L1B3RT4S, P4RS3LT0NGV3, TOKENADE), channel tag (email, chat, web, webhook), verdict badge, elapsed time. Expanded: full payload, layers, detections triggered, score, individual "Run This Test" button.
- **27 test payloads** — Expanded from 12 to 27 tests. Added 6 Pliny-specific tests (GODMODE divider, refusal inversion, compliance priming, fake system tags, anti-refusal, system override) + 9 edge cases (l33tspeak evasion, indirect exfil, grandma+C2 combo, role hijack+key leak, CoT compliance trick, multi-layer encoding, subtle PII harvest, 2 benign false-positive checks).

### Floating Avatar & Voice

- **Floating Avatar Guide** — Draggable, minimizable floating window with HeyGen LiveAvatar integration. Persists across tab changes. Connect/disconnect avatar with 2-minute auto-disconnect to save credits.
- **Tour narration** — "Start Tour" button (doesn't auto-narrate — lets operator connect avatar first). Avatar narrates panel descriptions as tour advances. Prev/Next/Restart/Exit controls.
- **Panel-aware Q&A** — Ask the avatar questions about the current panel. Context injected automatically (panel description + metrics). Voice input via mic button.
- **Shared HeyGen session** — ChatPanel and FloatingAvatar share the same HeyGen session. Connect once, speak from either.
- **HeyGen FULL mode** — Switched from LITE to FULL mode for `session.repeat()` TTS + lip-sync support.
- **Voice toggle in chat** — 🎤 EL / 🔊 toggle button to switch between ElevenLabs and browser TTS.
- **ElevenLabs auto-validation** — When API key is saved, auto-tests against ElevenLabs API. If valid, sets as default voice provider. If removed, reverts to browser.

### CVE Integration (2026-04-05)

- **CVE Database** — 108 CVEs synced from `jgamblin/OpenClawCVEs` (updated hourly on GitHub). New `cve_records` table in SQLite. Collapsible CVE cards in Security Posture with severity badges, CVSS scores, CWE tags, and "View Advisory →" links.
- **CWE-to-Shield mapping** — 15 CWE categories mapped to shield rule categories. Each CVE shows "Shield Coverage" — which rules protect against that vulnerability class. Connects CVEs to active detection.
- **Sync from GitHub** — `POST /api/cve/sync` fetches `cves.json` + `ghsa-advisories.json`, enriches with affected versions, fixed versions, and CWEs.
- **`GET /api/cve`** — Returns CVE records sorted by severity, with installed version for comparison.

### System Management (2026-04-05)

- **Archive Database** — One-click backup to `backups/sentinel-backup-YYYY-MM-DD.db`. Uses SQLite `VACUUM INTO` for consistency.
- **Purge Database** — Wipes operational data (traffic, alerts, audit, scans, metrics, correlations) while preserving all configuration. Requires "PURGE" confirmation.
- **Uninstall ClawNex** — 3-step confirmation via dashboard (Type YES → Type UNINSTALL → Type DO IT NOW). Archives DB first, stops services, generates removal script. Also available via `bash scripts/uninstall.sh` with same 3-level confirmation.
- **Migrate to New Host** — Creates a `.tar.gz` migration bundle with DB + .env + LiteLLM config + manifest with instructions.
- **Scheduled Daily Backup** — Optional cron job at 3:00 AM. Enable/disable from Configuration.
- **Local Model Cost Rates** — Manual $/million-tokens input for local models (input + output). Overrides openclaw.json rates for accurate cost tracking.

### Additional Changes (2026-04-05)

- **Cost by Agent** — New card in Token & Cost Intel with local time filter (1h/6h/24h/7d/30d). Groups traffic by agent with model breakdown. Flags non-default model usage with "NON-DEFAULT MODEL" badge.
- **Session watcher multi-agent** — Now scans ALL agent directories, not just main. Subagent sessions ingested going forward.
- **Session watcher disable** — Enable/Disable toggle in Traffic Monitor to stop session file scanning when using API-only mode.
- **Top Threats enriched** — Expandable cards with actor breakdown, last seen, payload sample, and backlinks to Shield/Alerts.
- **Executive Reports categorized** — Grouped into 7 collapsible categories (Executive, Security, Compliance, etc.) with tighter spacing.
- **Expand All / Collapse All** — Toggle buttons on Alerts, Correlations, and Shield Tests panels.
- **Agent Workspace indicators** — SHARED/UNIQUE tags on each file showing whether edits affect all agents or one.
- **Infrastructure Storage card** — Disk usage (used/total/free) added alongside CPU/Memory/Host.
- **Access Control backlinks** — "View Shield Rules →" and "Full Rule Details →" linking to Policies & Guards.
- **Traffic Monitor stats** — Moved to top of page, using compact Stat component.
- **Self-hosted fonts** — Google Fonts replaced with local woff2 files. Zero CDN dependency.
- **ElevenLabs voice fix** — Proper retry on 502, quota error detection, autoplay handling.
- **Version bumped to v0.5.2-alpha** — welcome message updated to 155 rules.

### Code Cleanup

- **Fleet API refactored** — Consolidated 4 redundant `require('node:fs/path/os')` blocks into single ES module imports. Extracted `readOpenClawConfig()` and `buildCostMap()` helpers. Replaced hardcoded `p95: 142` with calculated value from traffic data.
- **Unused `timeQuery` helper** — Removed (was added but not used).
- **Unicode regex fix** — STEG-PLINY-UNICODE-TAGS and STEG-PLINY-VARIATION-SELECTORS rules fixed from broken `\uE0001` patterns to proper `\u{E0001}` with `/u` flag. Eliminated false positives on normal text.
- **Demo rules removed** — Hardcoded PATH-001/URL-001 placeholder rules removed from Access Control. Real data only.

---

## v0.4.5-alpha (2026-04-02)

### UI/UX Overhaul

- **Glassmorphism refresh** — Frosted glass panels with `backdrop-filter: blur()`, semi-transparent rgba backgrounds, accent glows, subtle white borders. Premium SOC aesthetic inspired by military-grade HUD interfaces.
- **Performance Mode** — Lightning bolt (⚡) toggle in status bar disables all glass effects for remote desktop or low-GPU environments. Falls back to solid opaque panels.
- **Sidebar compacted** — Reduced from 185px to 170px width, 11px font, `white-space: nowrap` for labels like "Alerts & Incidents". Group headers tightened.
- **Status bar unified** — Fleet indicators, clock, and toggle buttons all normalized to 11px with consistent spacing.
- **CollapsibleCard component** — Reusable expandable/collapsible card with animated arrow indicator and optional count badge. Applied across Models & Cost and Configuration tabs.
- **Configuration tab fully collapsible** — All panels (Updates, Default AI Model, Model Providers, Gateways, Shield Settings, Data Retention, UI Preferences, Agent Ignore List) now collapsible.

### New Features

- **Skills & Plugins panel** — New section in Tools & Access tab. Discovers OpenClaw system skills (`~/.openclaw/skills/`) and workspace skills (`~/.openclaw/workspace/skills/`). Shows Paperclip plugins if Paperclip is connected. Each entry shows name, description, risk level (HIGH/MEDIUM/LOW), and status.
- **Agent Ignore List** — Configurable from Configuration tab. Filters internal OpenClaw processes (e.g., "Skill Installer") from all dashboard views (Tools & Access, Agents & Sessions). Prefix-matching with add/remove UI.
- **OpenClaw version tracking** — Updates panel now checks `github.com/openclaw/openclaw/releases` for the latest version. Shows installed vs latest with "View Release" link when update available.
- **UI Preferences** — Configuration card to set AI panel default state (open or closed on dashboard load). Persisted to database.
- **PUT /api/config/defaults** — New endpoint for setting individual config defaults from the dashboard.
- **GET /api/skills** — New endpoint returning unified skills inventory from all sources.
- **GET/PUT /api/config/agent-ignore** — New endpoint for agent ignore list management.

### Changes

- **Models & Cost tab** — Configured Models moved to top position, provider groups below (collapsed by default). "ORGANIZATION_OWNER" label replaced with "LM Studio Fleet" / "LM Studio Main".
- **Denied Tools** — Now shows which agent has which tool denied (with agent name context). Hidden when no visible agents have denied tools.
- **Executive Reports** — Updated from 6 to 10 reports aligned with current platform: added Break-Glass Audit Trail, Data Retention Compliance, Traffic & Threat Summary, Skills & Plugins Inventory, Shield Whitelist Review. Removed SLA Compliance (not yet implemented).
- **Traffic Monitor** — Removed "Proxy (Node.js)" from source dropdown. Default source filter changed from "proxy" to "litellm".
- **Traffic API** — Balanced query updated: replaced proxy source with break-glass source.

### Fixes

- **Host Security detection** — Was running `clawkeeper.sh --version` which doesn't exist. Now checks file existence and reports installation date.
- **delivery-mirror noise** — Session watcher now skips `delivery-mirror` and `delivery` model entries. Existing 11,824 noise records deleted from database.
- **Old Node.js proxy data** — 10 legacy proxy records cleaned from database.
- **Proxy ingest source field** — `/api/proxy/ingest` now accepts caller-specified `source` field (for break-glass traffic tracking).

### Late Session Updates (2026-04-02 PM)

**Audit & Evidence Overhaul:**
- Four-tier audit labeling: BLOCKED (red, real-time block), OBSERVED (cyan, block criteria met but observe mode), DETECTED (orange, retroactive session watcher), FLAGGED (yellow, REVIEW verdict)
- Session watcher now applies shield whitelist — eliminates false positives from SOUL.md, MEMORY.md references
- 265 stale false-positive alerts resolved as `false_positive`
- Audit detail now includes detection names + 200-char payload snippet for remediation
- Server-side filtering: exclude noise events (`agent_event`, `chat_event`), text search across actions/actors/detail
- Pagination: 15 entries default, options 10/15/25/50, Previous/Next controls
- ~~Time period selector: 30m, 1h, 6h, 24h, 7d, 30d~~ (replaced by global context bar in v0.4.6)
- Column filters: Result, Actor, Action dropdowns

**Executive Reports:**
- Fixed 5 failing reports: Traffic & Threat Summary, Break-Glass Audit Trail, Data Retention Compliance, Skills & Plugins Inventory, Shield Whitelist Review
- Added Consolidated Executive Summary (RPT-011)
- Added Traffic Data Export CSV (RPT-012) for pivot tables
- Total: 12 report types

**Access List Enforcement:**
- Domain and IP deny lists now enforced by Prompt Shield scanner
- Custom deny rules injected as C2 category detections (HIGH severity)
- 30-second cache for performance
- Coming Soon banners for unimplemented features (User lists, IP/Domain allowlists)

**Other:**
- Gateway client name field + All Clients dropdown populated from gateways
- OpenClaw provider test fixed (uses /health instead of /v1/models)
- All Configuration panels collapsed by default
- Observe mode audit entries now show "OBSERVED" instead of misleading "BLOCKED"

**UX Polish & Fixes (2026-04-03):**
- Fleet Command: version from meta.lastTouchedVersion (2026.3.28), real agent count (13), session count (224), threats filtered to 24h excluding session-watcher noise
- Correlations: real API entries now render with full mockup design (timeline, panel links, AI recommendations)
- Sidebar badges: Prompt Shield count respects time range, Alerts badge counts CRITICAL only
- Security Posture: widened ID/Severity columns, fixed grid to 280px + 1fr
- Sidebar icons: meaningful emoji matching function (shield, lock, robot, etc.)
- Session watcher: 10s default polling, dropdown selector (2s-60s), Poll Now button
- Alerts & Incidents: severity/source/status filters + pagination
- Prompt Shield: direction + verdict filters on Recent Scans
- Token Events: model filter, delivery-mirror excluded, CollapsibleCard
- Correlations: duplicate Seed Test button removed
- Autensa/Paperclip connectors: pollers auto-started (were never called)
- Correlation Engine redesigned: multi-source aggregation + risk scoring (CLAWNEX-CORR-001)

**Previous UX Polish (2026-04-03):**
- Uniform sidebar icons — clean geometric Unicode symbols from same visual family (replaced emoji hodgepodge)
- Alerts & Incidents: severity/source/status filters + pagination (10/15/25/50) + 30 duplicate alerts cleaned
- Prompt Shield: direction and verdict dropdown filters on Recent Scans & Events
- Policies & Guards: custom hover tooltips with larger font (13px), descriptive explanations for each policy
- Token & Cost Intel: Recent Token Events moved to CollapsibleCard with model filter, delivery-mirror entries filtered out, Recent Metric Snapshots moved to bottom collapsed
- Correlations: removed duplicate "Seed Test Correlation" button
- Autensa + Paperclip connectors: pollers were never started — now auto-start on Infrastructure page load
- OpenRouter models added to chat dropdown (3 models matching openclaw.json config)
- Model list cleaned (36 → 8 curated models), provider Test no longer auto-persists discovered models
- D-ID avatar integration: backend proxy + frontend WebRTC component with manual connect button

**AI Chat Interface:**
- Chat messages restyled as bubbles (user on right, assistant on left, glass surfaces)
- Three display modes: Bubbles only, Bubbles + Avatar, Avatar only
- Speaking Avatar: animated shield icon with glow pulse during speech
- Voice input: microphone button using Web Speech API
- Browser TTS for voice output (ElevenLabs + HeyGen integration in progress)
- Mode preference persisted to config_defaults
- Design document: CLAWNEX-AVA-001

---

## v0.4.4-alpha (2026-04-02)

### New Features

- **Break-Glass Emergency Bypass**
  - Manual, time-limited shield bypass for authorized emergency scenarios
  - Requires stated reason (min 10 chars) + type "CONFIRM" to activate
  - Duration options: 15m, 30m, 1h, 2h, 4h (auto-expires)
  - 15-minute cool-down between activations
  - Persistent red warning banner with live countdown across all dashboard tabs
  - CRITICAL alert on activation, HIGH alert on expiry, INFO on manual deactivation
  - All bypass traffic logged with source="break-glass", verdict="BYPASSED"
  - Full audit trail with unscanned traffic count
  - Break-glass status exposed in /api/health for external monitoring

- **Configurable Data Retention**
  - Per-category retention settings manageable from Configuration tab
  - Traffic Logs: 1d–90d (default 3d)
  - System Metrics: 1d–90d (default 3d)
  - Correlations: 1d–90d (default 3d)
  - Alerts & Incidents: 30d–365d (default 90d)
  - Audit Trail: 90d–unlimited (default 365d)
  - SOC 2 compliant — audit trail supports unlimited retention
  - All retention changes audit-logged

- **Shield Rule Whitelist**
  - Manage whitelisted rules from Prompt Shield tab
  - Full 139-rule table with search, category filter, and checkboxes
  - Whitelist applies only to internal traffic (LiteLLM, OpenClaw sessions)
  - Dashboard scans always run all rules
  - Default whitelist: 9 rules (cognitive-file + FIN-SWIFT-CODE)
  - Persisted to database, changes take effect immediately

- **LiteLLM Pre-Call Blocking**
  - Shield scan runs BEFORE the request reaches the AI model
  - When block mode is ON and verdict is BLOCK, request is rejected
  - Agent receives clear error message with verdict and score
  - Break-glass aware — skips scan when break-glass is active

### Changes

- **Node.js proxy decommissioned** — All traffic now flows through LiteLLM on port 4001. The standalone Node.js HTTP proxy (port 1235) has been removed.
- **LiteLLM binding hardened** — Changed from `0.0.0.0` to `127.0.0.1` (localhost only)
- **Traffic Monitor cleanup** — "PROXY STATUS" renamed to "SHIELD STATUS" with read-only mode indicator. Block mode toggle moved to Configuration tab only.
- **"PROXY SETTINGS" renamed to "SHIELD SETTINGS"** — Updated description to reference LiteLLM
- **Fixed TS2802 Set iteration error** — Resolved TypeScript strict mode error that blocked production builds

### Security

- **Fail-closed architecture enforced** — If LiteLLM is down, requests fail (no bypass without break-glass)
- **Supply chain protection** — LiteLLM pinned to 1.82.6 (supply chain compromise in later versions)
- **All dependencies exact-pinned** — No version ranges allowed

### Infrastructure

- **Service watchdog** — Shell script via system crontab, checks every 5 minutes, auto-restarts downed services, posts alerts
- **3-day retention enforcement** — Automatic cleanup of high-volume tables on startup and hourly
- **Retention now configurable** — Operators can adjust per-category from the dashboard

---

## v0.4.3-alpha (2026-04-01)

### New Features

- **LiteLLM Integration** — Python LiteLLM 1.82.6 proxy on port 4001 with ClawNexLogger callback
- **Session Log Watcher** — Retroactive scanning of OpenClaw JSONL session files
- **Traffic Monitor** — Real-time LLM traffic view with filtering by source, model, provider, verdict, score
- **Balanced traffic query** — UNION across sources ensures no source buries another

### Infrastructure

- **Node.js LLM proxy** — Transparent HTTP proxy on port 1235 (later decommissioned in v0.4.4)
- **Database schema** — 15 tables, 13+ indexes, WAL mode

---

## v0.4.2-alpha (2026-03-31)

### New Features

- **139-Rule Prompt Shield** — 10 threat categories: secrets, commands, sensitive paths, C2, cognitive file, trust exploitation, jailbreaks, steganography, encoding, financial
- **Scoring engine** — Severity-weighted scoring with BLOCK/REVIEW/ALLOW verdicts
- **PII redaction** — Emails, phones, SSNs, credit cards, IPs, DOBs, passports
- **Outbound scanning** — Data leak detection on model responses
- **Live Input Scanner** — Manual prompt testing from the dashboard

---

## v0.4.1-alpha (2026-03-31)

### New Features

- **19-tab SOC Dashboard** — Fleet Command, Instance Detail, Correlations, Security Posture, Prompt Shield, Shield Tests, Traffic Monitor, Access Control, Agents & Sessions, Agent Workspace, Token & Cost Intel, Tools & Access, Policies & Guards, Models & Cost, Infrastructure, Alerts & Incidents, Audit & Evidence, Executive Reports, Access Lists, Configuration
- **Alert Management** — Create, deduplicate, acknowledge, resolve alerts
- **Correlation Engine** — Multi-event pattern matching
- **SSE Real-time Updates** — Server-Sent Events for live dashboard
- **Dark SOC theme** — Custom design language with branded color palette

---

## v0.4.0-alpha (2026-03-31)

### Initial Release

- Project scaffolding (Next.js 14 + TypeScript + Tailwind)
- SQLite database with better-sqlite3
- Environment configuration system
- OpenClaw WebSocket connector
- LM Studio health check connector
- Basic API routing

---

## Roadmap

| Feature | Priority | Status |
|---------|----------|--------|
| Voice Avatar | P2 | Planned (mockup exists) |
| Enterprise Polish | P1 | Planned |
| Multi-Instance Packaging | P1 | Planned |
| RBAC / User Authentication | P1 | Shipped (v0.6.0) |
| HTTPS / TLS Termination | P1 | Shipped (v0.6.1) |
| Trust Boundary Audit | P1 | Shipped (v0.6.1) |
| Enhanced MCP Tools (10 total) | P2 | Shipped (v0.6.1) |
| Scheduled Reports | P2 | Shipped (v0.6.1) |
| Custom Correlation Rules | P2 | Shipped (v0.6.1) |
| Pre-OSS hardening pass (audit C-1/C-2 + 9 Highs + the reviewer's 10 tasks) | P1 | Shipped (v0.6.2) |
| Next.js upgrade (H-5) | P1 | Scheduled (v0.7.0) |
| HMAC shield rule source-signing (H-13) | P1 | Scheduled (v0.7.0) |
| Host Security updater vendoring / replace `curl \| bash` (H-4) | P2 | Scheduled (v0.7.0) |
| External SIEM Integration | P2 | Planned |
| Webhook Notifications | P2 | Planned |
| ML-Based Threat Detection | P3 | Planned |
| Multi-Tenant Support | P2 | Planned |
| Rate Limiting | P2 | Planned |

---

## Version Numbering

ClawNex follows semantic versioning:

```
v{major}.{minor}.{patch}-{stage}

major: Breaking changes
minor: New features
patch: Bug fixes and improvements
stage: alpha → beta → rc → (none for GA)
```

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-02 | ClawNex Engineering | Initial release covering v0.4.0 through v0.4.4 |
| 1.1 | 2026-04-11 | ClawNex Engineering | Added v0.5.2 through v0.5.4, Hermes integration, OSS direction, roadmap updates |
| 1.2 | 2026-04-13 | ClawNex Engineering | Added v0.6.0 RBAC release; v0.6.1-alpha QA fixes and operator lifecycle |
| 1.3 | 2026-04-22 | ClawNex Engineering | v0.6.1-alpha: Trust Boundary Audit, Enhanced MCP (10 tools), Scheduled Reports, Custom Correlation Rules, Caddy HTTPS, 3 new Configuration cards, 23 panels. Roadmap updated to reflect shipped items. |
| 1.4 | 2026-04-22 | ClawNex Engineering | Enterprise review pass: added Release Metadata Conventions, explicit Breaking Changes / Deprecations / Security Fixes / Known Issues / Verified Platforms matrices for v0.6.1; added upgrade path and metadata block to v0.6.0 entry; added cross-references. |
| 1.5 | 2026-04-22 | ClawNex Engineering | v0.6.2-alpha pre-OSS hardening: added Current Release section with C-1/C-2 + 9 High fixes, the reviewer's 10-task hardening checklist, `/api/trust-audit` wrapper shape breaking change, systemd `-H 127.0.0.1` binding change, 4 deferred High findings (H-4/H-5/H-13), updated roadmap table with v0.7.0 scheduling for H-4/H-5/H-13. |
| 1.17 | 2026-05-05 | ClawNex Engineering | Added 4 new release entries: v0.10.0-alpha (Configurable Rule & Policy Framework v1) with full metadata; v0.11.0-alpha (Token Cost FinOps Reporting v1) with full metadata; v0.11.1-alpha (Alert → Evidence backlink v1); v0.11.2-alpha (Alert → Evidence deep-link refinement, currently LIVE on https://<qa-host>). Removed stale "In Development" block; replaced with brief unreleased placeholder noting v0.11.2-alpha is the current shipped release with no work staged for the next release yet. |
| 1.20 | 2026-06-12 | ClawNex Engineering | Led the v0.15.0-alpha Current Release with the 2026-06-12 veracity-audit milestone (no version bump): trust-audit, panel-count, posture reconciliation, production-origin filter parity, Token & Cost Intel fetch-failure surfacing, shield-rule count, and behavioral verification updates. Demoted the 2026-05-17 chat-relay hardening to a within-release sub-section. |

---

*This document is updated with every release.*

---

*ClawNex by ClawNex maintainers — clawnexai.com*

---

## Appendix A — v0.5.2-alpha Fresh Install Fixes (2026-04-07)

Historic addendum for the v0.5.2 release window covering fresh-install hardening. Retained in the appendix for continuity.

- **Purge DB** — each table DELETE wrapped individually so missing tables don't stop the purge
- **Migration API** — error details now propagated to the UI
- **Infrastructure** — Paperclip/Autensa only shown when explicitly configured (not default localhost)
- **Host Security update** — fallback to GitHub direct download when clawkeeper.dev is unreachable
- **Agent Ignore List** — no longer pre-populated with "Skill Installer" on fresh install
- **Local Model Cost Rates** — Add button disabled when input is empty
- **LiteLLM config** — cleaned of personal routes; ships with template config
- **Routing table** — no longer carries over personal routes from source machine
- **WALKTHROUGH.md** — added macOS deployment section (scp, rsync, manual options)
- **ClawNex maintainers branding** — added to sidebar, scripts, docs, slide deck
- **Version bumped to 0.5.2-alpha**
