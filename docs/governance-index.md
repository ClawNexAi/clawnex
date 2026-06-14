# ClawNex Governance Index

Document ID: CLAWNEX-GOV-INDEX
Version: 1.3
Date Created: 2026-04-22
Last Updated: 2026-05-08
Owner: Project owner
Purpose: Single entry point for all ClawNex governance, policy, register, template, and readiness artifacts.

## Policies (approved 2026-04-22)

See [policies/README.md](policies/README.md) for the full index with status.

- [01 — Information Security Policy](policies/01-information-security-policy.md)
- [02 — Access Control Policy](policies/02-access-control-policy.md)
- [03 — Incident Response Policy](policies/03-incident-response-policy.md)
- [04 — Change Management Policy](policies/04-change-management-policy.md)
- [05 — Vendor & Third-Party Risk Policy](policies/05-vendor-third-party-risk-policy.md)
- [06 — Risk Management Policy](policies/06-risk-management-policy.md)
- [07 — Secure SDLC Policy](policies/07-secure-sdlc-policy.md)
- [08 — Data Classification Policy](policies/08-data-classification-policy.md)
- [09 — Data Retention and Disposal Policy](policies/09-data-retention-and-disposal-policy.md)
- [10 — BCP / DR Policy](policies/10-bcp-dr-policy.md)
- [11 — Cryptographic Controls Policy](policies/11-cryptographic-controls-policy.md)
- [12 — Asset Management Policy](policies/12-asset-management-policy.md)
- [13 — Vulnerability Management Policy](policies/13-vulnerability-management-policy.md)
- [14 — Acceptable Use Policy](policies/14-acceptable-use-policy.md)

## Registers

- [Risk Register](registers/risk-register.md) — 23 active + 2 closed (P0: 2, P1: 11, P2: 9, P3: 1, Closed: 2)
- [Vendor Inventory Register](registers/vendor-inventory-register.md) — grouped by dependency category, live-reconciled against codebase

## Operational templates

- [Incident Record Template](templates/incident-record-template.md)
- [Tabletop Exercise Template](templates/tabletop-exercise-template.md)
- [DR Test Record Template](templates/dr-test-record-template.md)
- [Quarterly Access Review Template](templates/quarterly-access-review-template.md)

## Governance summaries and mappings

- [Governance One-Pager](governance-one-pager.md) — leadership / enterprise-facing summary
- [Policy Evidence Checklist](policy-evidence-checklist.md) — maps each policy to concrete proof artifacts

## Readiness, audit, and security docs

- [OSS Release Readiness Checklist (2026-04-22)](oss-release-readiness-checklist-2026-04-22.md)
- [Security Audit (2026-04-22)](security-audit-2026-04-22.md)
- [Pre-OSS Platform Audit (2026-04-22)](pre-oss-platform-audit-2026-04-22.md)
- [Pre-OSS Hardening Checklist](pre-oss-hardening-checklist-for-claude.md)
- [Pre-OSS Validation Checklist](pre-oss-validation-checklist.md)
- [SECURITY.md](../SECURITY.md)

## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | internal reviewer | Initial governance index. |
| 1.1 | 2026-04-22 | Claude | Added registers summary, governance one-pager + evidence checklist links, corrected filename references. |
| 1.2 | 2026-04-22 | Claude | v0.6.3-alpha pass: refreshed risk register counts (23 active + 2 closed after R-001 and R-010 shipped closed). |
| 1.3 | 2026-05-05 | Internal reviewer (audit pass) | Source-truth verification at v0.11.6-alpha (staging host LIVE). Last Updated bumped 2026-04-22 → 2026-05-05; cross-link integrity re-verified against current `policies/` and `registers/` filenames. Risk register summary on this index left intact — counts (23 active + 2 closed; P0:2 / P1:11 / P2:9 / P3:1) still match the underlying register at version 1.3. No body changes to linked artifacts other than per-policy header reconciliation (see each policy's own changelog). |
