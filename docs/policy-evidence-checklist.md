# ClawNex Policy Evidence Checklist

**Document ID:** CLAWNEX-GOV-002
**Version:** 1.3
**Date:** 2026-04-22
**Last Updated:** 2026-05-14
**Owner:** Project owner
**Purpose:** For each approved policy, list the concrete artifact(s) that demonstrate the policy is real — what an auditor or enterprise prospect could actually open and verify. Honestly flag gaps so the next step is visible.

## How to read this document

Each policy has a table with three columns:

- **Control area** — the specific commitment or clause inside the policy.
- **Evidence artifact** — the file path, script, runbook, configuration, or audit log that demonstrates the commitment is operational.
- **Status** — one of:
  - **Implemented** — evidence exists and is current.
  - **Partial** — evidence exists but is incomplete or not continuously enforced.
  - **Gap** — no evidence yet; closure path named.

Paths are relative to the repository root unless otherwise noted.

---

## 01 — Information Security Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Overarching security posture documented | `docs/security-audit-2026-04-22.md`, `SECURITY.md` | Implemented |
| Security-relevant actions audited | `src/lib/services/audit-logger.ts`, 58-event catalog (see `docs/11-security-architecture.md §14`), stdout mirror | Implemented |
| Release gate before public exposure | `scripts/verify-pre-oss.sh` (13 reachability routes; PASS/FAIL/AUTH per route, latency budget enforced) | Implemented |
| Timely remediation of findings | Audit remediation log — 2/2 Criticals, 9/13 Highs closed with 4 deferred + rationale | Implemented |
| Honest disclosure of alpha limitations | `docs/governance-one-pager.md` §"What a prospective enterprise user should know" | Implemented |
| Independent external validation | External penetration test | Gap — targeted Q3 2026, tracked as R-017 |
| DAST sweep against localhost + QA environments | [`docs/qa/dast-remediation-2026-05-14.md`](qa/dast-remediation-2026-05-14.md) (Round 15) + [`docs/qa/dast-run-2-2026-05-15.md`](qa/dast-run-2-2026-05-15.md) (Run 2 + Round 3 closure pass) — both targets. All RBAC-on actionable findings closed at commit `48027e3`; **AR-001** (style-src-attr) and **AR-002** (Pattern-B same-host trust) are accepted residuals. | Implemented |

## 02 — Access Control Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Authentication implemented | `src/app/api/auth/*`, `src/lib/services/auth.ts` | Implemented |
| Safe-by-default authentication posture | `.env.example` `RBAC_ENABLED=true` default + `NEXT_PUBLIC_RBAC_ENABLED=true` (v0.6.3 commit 21d249b) | Implemented |
| Observable unsafe-configuration signal | `src/lib/rbac/guard.ts` boot-time WARN banner fires once per process when RBAC is off (v0.6.3 commit 21d249b) | Implemented |
| Password hashing | `bcryptjs` 2.4.3 (see vendor register §1) | Implemented |
| Setup/bootstrap secret protected | `SETUP_SECRET` + `crypto.timingSafeEqual` (audit fix H-1) | Implemented |
| CSRF on state-changing routes | `validateCsrf()` in `src/app/api/auth/logout/route.ts` (fix H-2) | Implemented |
| Session hardening | `SESSION_TTL_HOURS`, `MAX_SESSIONS_PER_OPERATOR`, `ACCOUNT_LOCKOUT_THRESHOLD`, `LOGIN_RATE_LIMIT`, `SESSION_BIND_IP` in `.env.example` | Implemented |
| RBAC with defined roles/permissions | 5 roles × 28 permissions matrix (documented) | Implemented |
| Role-change audit event | `operator_role_changed` event in `src/app/api/config/operators/[id]/route.ts` | Implemented |
| RBAC-on QA blocked sensitive routes | `scripts/verify-pattern-b.sh --live https://<qa-host>` — 21/21 routes return 401; [`docs/qa/dast-remediation-2026-05-14.md`](qa/dast-remediation-2026-05-14.md) §2 (C5) | Implemented |
| `requireLocalhost` Origin/Referer enforcement (CSRF) | `src/lib/middleware/localhost-guard.ts` + `src/lib/auth/origin-match.ts` + `scripts/verify-origin-block.sh` (17 unit + 4 live) | Implemented |
| Pattern-B route guard verifier | `scripts/verify-pattern-b.sh` (static + live `--live <base-url>` mode) — 21/21 PASS on both targets | Implemented |
| Login timing envelope | `MIN_LOGIN_FAILURE_MS = 2000` floor on every 401 return from `POST /api/auth/login`; live delta on QA = 4ms | Implemented |
| Authentication info-leak reduction | H4 strips `operatorCount` from anonymous `/api/auth/status`; M3 strips `version`/`uptime` from anonymous `/api/v1/health`; L3 `DEFAULT_OPERATOR.username = 'localhost'` | Implemented |
| Quarterly access review | `docs/templates/quarterly-access-review-template.md` | Partial — template exists; first cycle not yet executed |
| SSO / SAML integration | — | Gap — not on v0.6.x roadmap |

## 03 — Incident Response Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Public reporting channel | `SECURITY.md` | Implemented |
| Incident record template | `docs/templates/incident-record-template.md` | Implemented |
| Tamper-visible audit log | stdout-mirrored audit events (fix H-9); 58-event catalog (see `docs/11-security-architecture.md §14`) | Partial — hash-chain/WORM tracked as R-008 |
| Documented LiteLLM supply-chain incident response | Pinned `litellm==1.83.0`, run.py port-guard triple-lock, LiteLLM 150-process post-incident writeup | Implemented |
| DAST remediation evidence | [`docs/qa/dast-remediation-2026-05-14.md`](qa/dast-remediation-2026-05-14.md) — Round 15 evidence with commit chain, verifier output, live verification table | Implemented |
| Denied-attempt audit logging | `requireLocalhost` / `requireSession` / `validateOriginMatch` denials currently NOT audit-logged | Gap — tracked as R-038 in `docs/registers/risk-register.md` |
| Tabletop exercise executed | `docs/templates/tabletop-exercise-template.md` | Gap — first execution pending |

## 04 — Change Management Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Release changelog | `CHANGELOG.md` (with `[0.6.2-alpha]` entry) | Implemented |
| Docs versioned per release | 36 docs updated to v0.6.2-alpha on 2026-04-22 | Implemented |
| Release verification | `scripts/verify-pre-oss.sh` | Implemented |
| Dependency pinning | Exact versions in `package.json`, `litellm/requirements.txt` | Implemented |
| Branch protection + required review | GitHub branch protection on `main` | Partial — enforced by single maintainer; formal review gate pending alternate approver (R-019) |
| Controlled security remediation | DAST Round 15 in [`docs/qa/dast-remediation-2026-05-14.md`](qa/dast-remediation-2026-05-14.md) (8 atomic commits) + DAST Run 2 + Round 3 in [`docs/qa/dast-run-2-2026-05-15.md`](qa/dast-run-2-2026-05-15.md) (10 atomic commits at `48027e3`). Both: per-fix verifiers, live-verified before/after deploy, register updates, accepted-residual documentation. | Implemented |
| Deployment verification on staging host | `scripts/deploy-prod.sh` + post-deploy live verifier sweep (origin-block + pattern-b + header dedup + L1 Via strip + M3/M5/M6 envelope checks) | Implemented |
| Rollback procedure | — | Gap — no written rollback runbook beyond git revert |

## 05 — Vendor & Third-Party Risk Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Vendor inventory | `docs/registers/vendor-inventory-register.md` (live-reconciled 2026-04-22) | Implemented |
| SBOM (CycloneDX) | `scripts/generate-sbom.sh` + `npm run sbom` → `sbom.json` | Implemented |
| Dependency pinning | `package.json`, `package-lock.json`, `litellm/requirements.txt` | Implemented |
| Supply-chain incident response | LiteLLM pin to 1.83.0; documented in register §1 and `feedback_pin_dependencies.md` | Implemented |
| Executed DPAs with model providers | — | Gap — tracked as R-018; required before pilot |
| Vendor review cadence executed | — | Gap — first cycle scheduled 2026-05-15 per register Next-Review column |

## 06 — Risk Management Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Risk register maintained | `docs/registers/risk-register.md` v1.8 (Round 15 closures + R-036 H2 closed-with-retained-clause → AR-001 + R-039 H8 closed-as-accepted → AR-002, post DAST Run 2 + Round 3 closure 2026-05-16) | Implemented |
| Risk identification from audits | Register v1.2 cross-references security audit findings | Implemented |
| Owner + target date per risk | Present on every R-### row | Implemented |
| Review cadence executed | — | Gap — first full register review scheduled end-of-cycle |

## 07 — Secure SDLC Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Security findings remediation evidence | 2/2 Critical, 9/13 High closed on 2026-04-22; DAST Round 15 closures 2026-05-14 in [`docs/qa/dast-remediation-2026-05-14.md`](qa/dast-remediation-2026-05-14.md); DAST Run 2 + Round 3 closures 2026-05-15 → 2026-05-16 in [`docs/qa/dast-run-2-2026-05-15.md`](qa/dast-run-2-2026-05-15.md) (final commit `48027e3`) | Implemented |
| Input validation at boundaries | `zod` schemas across API routes; explicit JSON parse-error → 400 in `POST /api/auth/login` (M2 2026-05-14) | Implemented |
| Injection defenses | `execFileSync` array args + strict `DOMAIN_REGEX` (fix C-1); parameterized SQL + bounded integer coercion (fix C-2); `assertSafeYamlValue()` (fix H-7) | Implemented |
| Audit logging on sensitive surfaces | All 10 MCP tools wrapped in `auditedInvoke()` (fix H-8) | Implemented |
| Release gate tied to security | `scripts/verify-pre-oss.sh` + audit report review + per-fix verifier suite (`verify-origin-block.sh`, `verify-pattern-b.sh`, `verify-config-defaults-protect.sh`, `verify-outbound-gate.sh`, `verify-audit-actor.sh`) | Implemented |
| Outbound shield fail-closed across all chat paths | `src/lib/shield/outbound-gate.ts` used by `/api/v1/chat/completions` (internal reviewer P1-B) and `/api/chat` LM-Studio + OpenClaw direct paths (M4-related); fail-CLOSED on scanner exception | Implemented |
| Chat history scanned for prompt injection | `src/app/api/chat/route.ts` scans `body.history[]` entries alongside the current `message` (internal reviewer P1-C) | Implemented |
| SSRF redirect hardening | `redirect: 'error'` on `testProvider`/`testGateway` fetches (internal reviewer P1-D); DNS-rebinding class tracked separately as R-037 | Partial — redirect class closed; DNS rebinding still open |
| Automated SAST / pre-merge static analysis | — | Gap — not yet in CI |
| Per-feature threat modeling | STRIDE applied in 2026-04-22 audit | Partial — not yet a per-PR requirement |

## 08 — Data Classification Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Four-tier classification documented | Data Classification policy §classification tiers; 4-tier taxonomy | Implemented |
| Secrets never committed | `.gitignore` enforces `.env.local`; audit confirms no secrets in tree | Implemented |
| Database file permissions | `chmod 600 sentinel.db*` in `deploy/deploy.sh` (fix H-10) | Implemented |
| Data-at-rest encryption | — | Gap — SQLite file encrypted only by filesystem (e.g., FileVault on test host); database-level encryption not configured |
| Classification markings in code | — | Partial — policy exists but code-level tagging is aspirational |

## 09 — Data Retention and Disposal Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Retention Policy Matrix | Documented in policy §retention matrix | Implemented |
| Backup directory configured | `~/clawnex-backups/` via `scripts/backup.sh` on Linux bare-metal | Implemented |
| Protected retention keys denylist | `src/app/api/config/defaults/route.ts` rejects `retention_*` keys via `PROTECTED_PREFIXES` (P0-C 2026-05-14); canonical writer is `/api/config/retention` with value-range validation. `scripts/verify-config-defaults-protect.sh` (16/16). | Implemented |
| Automated retention enforcement | — | Gap — no scheduled purge job; manual cleanup only |
| Disposal procedure exercised | — | Gap — to be validated with first DR test |

## 10 — BCP / DR Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Data directories defined for recovery | `~/clawnex/clawnex.db`, `~/clawnex/logs/`, `~/clawnex-backups/` on Linux bare-metal | Implemented |
| DR test template | `docs/templates/dr-test-record-template.md` | Implemented |
| Documented RTO / RPO | — | Gap — no numeric targets set yet |
| First DR test executed | — | Gap — tracked as R-022 |

## 11 — Cryptographic Controls Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Passwords hashed (not stored plaintext) | `bcryptjs` 2.4.3 | Implemented |
| Timing-safe secret comparison | `crypto.timingSafeEqual` (fix H-1) | Implemented |
| TLS for outbound SMTP | `rejectUnauthorized: true`, `minVersion: 'TLSv1.2'` in `src/lib/services/mail-service.ts` (fix H-3) | Implemented |
| TLS for inbound (Linux bare-metal) | Caddy 2 + Let's Encrypt automation; HSTS 2yr preload header | Implemented |
| HTTPS enforcement surface | `src/app/api/system/https/route.ts` + Configuration panel card | Implemented |
| Centralized key management / rotation automation | — | Gap — tracked as R-021; partial mitigation via `SECURITY.md` Secret Rotation runbook |

## 12 — Asset Management Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Software asset inventory | SBOM (CycloneDX, per release) | Implemented |
| Third-party service inventory | `docs/registers/vendor-inventory-register.md` | Implemented |
| Deployment / instance inventory | Reference deployments listed in vendor register §5 | Partial — pre-OSS; will need formal operator inventory post-launch |
| Hardware asset register | — | Gap — not applicable in alpha (the operator's Mac + VPS only); becomes relevant post-OSS |

## 13 — Vulnerability Management Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Formal vulnerability assessment | `docs/security-audit-2026-04-22.md` + `docs/qa/dast-remediation-2026-05-14.md` (DAST Round 15) + `docs/qa/dast-run-2-2026-05-15.md` (DAST Run 2 + Round 3 closure pass at commit `48027e3`) | Implemented |
| Continuous DAST against staging | `docs/qa/dast-remediation-2026-05-14.md` — live sweeps against `localhost:5001` (local dev host, RBAC off) + `<qa-host>` (staging host, RBAC on) | Implemented |
| Intake → triage → fix → verify → deploy → register lifecycle | Round 15 closure walks the full lifecycle: DAST report → risk register entries R-026..R-035 → atomic fix commits → per-fix verifier scripts → `deploy-prod.sh` to staging host → live verification table → register status update | Implemented |
| Dependency vulnerability monitoring baseline | SBOM + pinned versions + `npm audit` on demand | Partial |
| Continuous dep scanning (Dependabot / Snyk) | — | Gap — on v0.7.x roadmap |
| Findings ledger | Audit remediation table inside audit report + DAST register entries | Implemented |
| Deferred-findings rationale | v0.7.0 deferred list (H-4, H-5, H-13) + H2 style-src (closed 2026-05-15 → retained `style-src-attr` clause documented as **AR-001** in [`docs/qa/accepted-residuals.md`](qa/accepted-residuals.md)) + H8 Pattern-B same-host trust (closed-as-accepted → **AR-002**) | Implemented |

## 14 — Acceptable Use Policy

| Control area | Evidence artifact | Status |
|---|---|---|
| Contributor expectations | `CONTRIBUTING.md` | Implemented |
| Public security reporting channel | `SECURITY.md` | Implemented |
| Repository license | Apache 2.0 (pre-OSS; pending final drop) | Partial — license file pending OSS-launch gate per R-020 |
| Contributor agreement / DCO or CLA | DCO signoff on commits | Partial — DCO process documented; enforcement tooling post-launch |

---

## Cross-policy gap summary

Gaps that block pilot readiness (not OSS launch):

1. **External penetration test** — R-017 — blocks SOC 2 / ISO 27001 external validation
2. **Executed DPAs with model providers** — R-018 — required before handling regulated enterprise data
3. **Named alternate approver** — R-019 — needed to retire "self-approval" footer on all 14 policies
4. **Data-at-rest encryption beyond filesystem** — tracked under Cryptographic Controls §gap
5. **Continuous dependency scanning in CI** — tracked under Vuln Management §gap

Gaps that are operational exercises (cheapest to close):

1. First tabletop exercise (Incident Response Policy)
2. First DR test (BCP/DR Policy, R-022)
3. First quarterly access review (Access Control Policy)
4. First vendor review cycle (Vendor & Third-Party Risk Policy)

These four can be closed in the next 4–6 weeks using the templates already in `docs/templates/`.

---

## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Claude | Initial evidence checklist covering all 14 approved policies; mapped against live v0.6.2-alpha artifacts and the 2026-04-22 audit remediation log. |
| 1.1 | 2026-04-22 | Claude | v0.6.3-alpha pass: added Access Control Policy evidence for (1) RBAC safe-by-default posture shipped in `.env.example` and (2) observable unsafe-configuration stderr WARN signal in `src/lib/rbac/guard.ts`. Commit 21d249b. |
| 1.2 | 2026-05-05 | Internal reviewer (audit pass) | Source-truth verification at v0.11.6-alpha. Last Updated added; Version 1.1 → 1.2. Stale fact corrections: "42-event catalog" → "58-event catalog" (auth/passkey/github events added through v0.9.x; reference now points at `docs/11-security-architecture.md §14`); "11 checks, 11/11 passing" claim about `verify-pre-oss.sh` → "13 reachability routes (PASS/FAIL/AUTH per route, latency budget enforced)" — the script never had 11 named checks; the original number appears to have been a misread of the route list count. No body changes to per-policy evidence rows beyond those two factual corrections. |
| 1.3 | 2026-05-14 | Internal reviewer | **DAST Round 15 evidence pass.** Added evidence rows across 7 of the 14 policies: 01 (DAST sweep performed), 02 (RBAC-on QA blocked sensitive routes / `requireLocalhost` Origin enforcement / Pattern-B verifier / login timing envelope / auth info-leak reduction), 03 (DAST remediation evidence + denied-attempt audit gap surfaced), 04 (controlled remediation + staging host deploy verification), 06 (register version reference updated), 07 (DAST as formal vuln assessment + continuous DAST + intake-to-deploy lifecycle + outbound shield fail-closed everywhere + chat history scanned + SSRF redirect class closed), 09 (protected retention keys), 13 (DAST formal assessment + continuous DAST + lifecycle + deferred H2 rationale). Every new row cross-links to [`docs/qa/dast-remediation-2026-05-14.md`](qa/dast-remediation-2026-05-14.md) which is the single canonical evidence artifact for Round 15. |
| 1.4 | 2026-05-16 | Internal reviewer | **DAST Run 2 + Round 3 closure pass.** Cross-linked the new closure-evidence artifact [`docs/qa/dast-run-2-2026-05-15.md`](qa/dast-run-2-2026-05-15.md) into the same 7 policies. Risk-register reference bumped v1.6 → v1.8. Deferred-findings rationale updated: H2 style-src closed 2026-05-15 → retained `style-src-attr` clause documented as **AR-001** in [`docs/qa/accepted-residuals.md`](qa/accepted-residuals.md); H8 Pattern-B same-host trust closed-as-accepted → **AR-002**. Both have explicit retest conditions. The "queued as final pre-OSS gate" framing is now superseded — all RBAC-on actionable DAST findings are closed on staging host at commit `48027e3`. |
