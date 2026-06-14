# ClawNex — Governance & Security Summary

**Document ID:** CLAWNEX-GOV-001
**Version:** 1.3
**Date:** 2026-05-08
**Product Version:** v0.15.0-alpha
**Owner & Maintainer:** Project owner
**Audience:** Leadership, VC, prospective enterprise pilots, security questionnaires

## What ClawNex is

ClawNex is an LLM security dashboard and proxy gateway. It routes AI traffic through a LiteLLM-based gateway with a 163-rule pre/post scan pipeline, exposes 25 operator panels with RBAC, an MCP tool surface (10 tools), and a 58-event audit catalog. Every security-relevant action is logged and mirrored to stdout for external ingest.

## Stage

Alpha. Single-maintainer open-source project preparing for an Apache 2.0 public release. **Not yet pilot-ready for regulated enterprise data.** Reference deployments are local dev host (local dev), staging host (VPS provider QA, currently LIVE at https://<qa-host> running v0.11.6-alpha), and test host (Mac dev-box reserve).

## Security posture (as of 2026-04-22)

| Item | State |
|---|---|
| Internal security audit | Completed 2026-04-22; published in `docs/security-audit-2026-04-22.md` |
| Critical findings | 2 of 2 closed |
| High findings | 9 of 13 closed; 4 deferred to v0.7.0 with documented rationale |
| Automated release verification | `scripts/verify-pre-oss.sh` — 13 reachability routes (PASS/FAIL/AUTH per route, latency budget enforced) |
| SBOM generation | CycloneDX on every release, via `npm run sbom` |
| External penetration test | Not yet conducted. Scoping targeted Q3 2026. |
| Secret management | `.env.local` chmod 600, pinned to file; KMS/vault integration on roadmap |

## Governance artifacts (live as of 2026-05-05; underlying policies signed off 2026-04-22)

| Artifact | Count / State |
|---|---|
| Approved policies | 14 (Information Security, Access Control, Incident Response, Change Management, Vendor Risk, Risk Management, Secure SDLC, Data Classification, Data Retention, BCP/DR, Crypto Controls, Asset Management, Vuln Management, Acceptable Use) |
| Risk register | 23 active + 2 closed (P0: 2, P1: 11, P2: 9, P3: 1, Closed: 2) |
| Vendor inventory | Live-reconciled against codebase; grouped by bundled / embedded / optional / supply-chain / deployment |
| Operational templates | Incident record, tabletop exercise, DR test record, quarterly access review |
| Governance index | `docs/governance-index.md` |

Policies are signed off by Owner & Maintainer pending a named alternate approver (tracked as risk R-019).

## Compliance trajectory

| Framework | Readiness (control coverage) | Primary gap |
|---|---|---|
| SOC 2 Type II | ~55-60% (honest-estimate) | No external audit history; no operating evidence window yet |
| ISO 27001:2022 | ~50-55% (honest-estimate) | Full DPA set, audit trail longevity, external validation |
| NIST CSF 2.0 | Tier 2 today | Tier 3 requires formal risk integration + measurable outcomes |

These numbers come from the 2026-04-22 security audit's control-mapping section. The governance lane landed in v0.6.3-alpha (14 approved policies, 2 live registers, 4 templates, in-dashboard Governance panel) and remains current at v0.11.6-alpha. Numbers are honest-estimate only; no external audit has been performed.

## What a prospective enterprise user should know — straight answers

1. **Alpha software.** Production use requires the operator to accept alpha-state limitations.
2. **No external pen test yet.** All review to date is internal (automated + manual). Tracked as risk R-017.
3. **DPAs not yet executed** with external model providers (OpenRouter, Anthropic, OpenAI, HeyGen, Resend, D-ID). Operators currently rely on those providers' public terms. Tracked as R-018.
4. **Single-maintainer bus factor.** A named alternate approver is being appointed. Tracked as R-019.
5. **Single-file secret storage** (`.env.local`, chmod 600). Adequate for alpha; not yet KMS-backed. Tracked as R-021.
6. **Trust Audit discovery fidelity** — current discovery derives agent identity from `session_id` and tool inventory from `TOOLS.md` files. Findings are explicitly labeled with confidence pills so operators know what to trust; a discovery rewrite is its own workstream. Tracked as R-024.

## What's changing in the next 90 days

- **Public OSS launch on github.com/operator** (Apache 2.0 + DCO) — gated on the launch checklist at `docs/go-live-checklist.md`. Deployment-testing pass + governance audit pass + macOS install-path fix are the final gates.
- **macOS local `next build` failure** — fixable launch-prep item; affects `setup.sh:1232` for any macOS operator running the tarball install. Pre-existed back to v0.11.2-alpha base; tracked on the launch checklist (Phase 2). Linux deploys (staging host) unaffected.
- **Named alternate approver + secret-escrow plan (R-019)** — pre-OSS priority.
- **First tabletop exercise** using `docs/templates/tabletop-exercise-template.md`.
- **First DR / restore exercise** using `docs/templates/dr-test-record-template.md` (closes R-022).
- **OSS license audit against SBOM** + NOTICE file generation (pre-launch gate for R-020).
- **External penetration test** scoping and vendor selection (R-017).
- **Trust Audit discovery rewrite (R-024)** — separate workstream.
- **Remaining v0.7.0 security items**: H-4 clawkeeper signed installer, H-5 Next.js 15 upgrade, H-13 source-signed shield whitelist.

## Where to look (evidence map, one level deep)

| Topic | Entry point |
|---|---|
| Governance index | `docs/governance-index.md` |
| All policies | `docs/policies/README.md` |
| Risks | `docs/registers/risk-register.md` |
| Vendors / supply chain | `docs/registers/vendor-inventory-register.md` |
| Policy evidence map | `docs/policy-evidence-checklist.md` |
| Security disclosure | `SECURITY.md` |
| Latest security audit | `docs/security-audit-2026-04-22.md` |
| Release readiness gate | `docs/oss-release-readiness-checklist-2026-04-22.md` |
| Release verification script | `scripts/verify-pre-oss.sh` |
| SBOM | Regenerated per release — see `sbom.json` |

## One-paragraph takeaway for a reader in a hurry

ClawNex is an alpha-stage LLM security platform with a serious, documented security posture (0 open Criticals, 4 of 13 Highs deferred with published rationale), a fully-landed governance starter pack readable inline in the dashboard itself (14 approved policies, 25-entry risk register with 2 closed and an auditable change log, live vendor inventory, four operational templates), safe-by-default authentication with four providers shipped through v0.9.x (passkeys, GitHub OAuth, Magic Link, local password as break-glass) plus 5-role RBAC, and a published roadmap to pilot readiness (external pen test, DPAs, alternate approver, KMS). The honest gating items for enterprise use are external validation and operating history — not architectural.

---

## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Claude | Initial one-pager produced from governance handoff; cross-referenced against v0.6.2-alpha state, audit report, and live registers. |
| 1.1 | 2026-04-22 | Claude | Bumped to reflect v0.6.3-alpha state: risk register counts updated (23 active + 2 closed); SOC 2 / ISO 27001 honest-estimate readiness refreshed (42→55-60%, 38→50-55%) after governance lane landed; straight-answers section expanded with R-024/R-025/R-021; 90-day roadmap reordered with 2026-04-23 pairing session at the top. |
| 1.2 | 2026-04-25 | Project owner | Pre-merge sign-off pass; no body change. |
| 1.3 | 2026-05-05 | Internal reviewer (audit pass) | Source-truth verification pass for current product state at v0.11.6-alpha (staging host LIVE on https://<qa-host>). Updates: Date 2026-04-25 → 2026-05-05; Product Version v0.10.0-alpha → v0.11.6-alpha; "163-rule pre/post scan" → 163 rules; "23 operator panels" → 25; "42-event audit catalog" → 58 (auth/passkey/github events added through v0.9.x); reference deployments hostname mapping corrected (local dev host = local dev, staging host = QA, test host = Mac dev-box reserve); `verify-pre-oss.sh` description corrected (13 reachability routes, not "11 checks"); governance-artifacts header updated to "live as of 2026-05-05; underlying policies signed off 2026-04-22"; 90-day roadmap rewritten for current state (OSS launch on github.com/operator, macOS install-path fix, alternate approver, tabletop, DR test, license audit, external pen test, Trust Audit discovery rewrite, v0.7.0 carryover); v0.6.3-alpha governance-lane reference clarified ("landed in v0.6.3-alpha and remains current at v0.11.6-alpha"); "safe-by-default authentication as of v0.6.3-alpha" expanded to "four providers shipped through v0.9.x (passkeys, GitHub OAuth, Magic Link, local password) plus 5-role RBAC". |
| 1.4 | 2026-05-13 | Internal reviewer | Docker install path removed for v1.0 OSS launch — ClawNex consolidated to Linux bare-metal + macOS only. R-016 (Docker smoke-test) and R-025 (Docker BUILD ARG) removed from the straight-answers list; corresponding R-numbers closed in `docs/registers/risk-register.md`. 90-day roadmap pruned. |
