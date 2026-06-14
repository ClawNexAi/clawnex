# Secure SDLC Policy

Document ID: CLAWNEX-POL-007
Version: 1.3
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-14

## 1. Purpose

This policy defines the minimum secure development lifecycle expectations for ClawNex from design through release.

## 2. Scope

Applies to all code, configuration, packaging, and deployment artifacts maintained for ClawNex.

## 3. SDLC Requirements

### Design
- Security-sensitive features should consider misuse and trust-boundary implications.
- Product claims should not exceed actual implementation.

### Build
- Dependencies should be known and reviewable.
- Build output should be reproducible where practical.

### Review
- Security-relevant changes should receive review before release.
- High-risk areas include auth, RBAC, audit, break-glass, routing, external execution, and deployment exposure.

### Test
- Build/lint/verification steps should be run before release.
- Critical regressions should block release.

### Release
- Known risks and deferrals should be documented.
- Security documentation should be updated alongside meaningful changes.

### Post-Release
- Vulnerabilities and incidents should feed back into design and remediation.

## 4. Dependency Management

- Use maintained package versions where practical.
- Track or generate SBOM artifacts.
- Review high-severity dependency findings for remediation or documented acceptance.

## 5. Secrets Handling

- Secrets must not be committed to public source control.
- Test/demo secrets must not be treated as production controls.

## 6. Disclosure and Remediation

Security findings should be triaged by severity and tracked through remediation or documented acceptance.

## 7. Related Documents

- Information Security Policy
- Change Management Policy
- SECURITY.md
- security audit reports


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
| 1.3 | 2026-05-14 | Internal reviewer | **DAST Round 15 evidence cross-reference (no body change).** Release-gate evidence inventory now includes DAST + per-fix verifier scripts: `scripts/verify-origin-block.sh` (P0-A — 17 unit + 4 live), `scripts/verify-pattern-b.sh` (P0-B — 21 static + 21 live), `scripts/verify-config-defaults-protect.sh` (P0-C — 16/16), `scripts/verify-outbound-gate.sh` (M4-related — 6/6), `scripts/verify-audit-actor.sh` (L3 — 4/4), plus pre-existing `verify-rbac-fail-open`, `verify-ssrf-guard`, `verify-symlink-escape`, `verify-nfkc-normalization`, `verify-post-redaction`, `verify-workspace-secret-redaction`, `verify-deploy-ssh-injection`, `verify-nextjs-cves`. Outbound shield fail-CLOSED is now uniform across all chat paths (`/api/v1/chat/completions` + LiteLLM proxy + LM-Studio-direct + OpenClaw-gateway-direct) via the shared `src/lib/shield/outbound-gate.ts` helper. Canonical evidence: [`docs/qa/dast-remediation-2026-05-14.md`](../qa/dast-remediation-2026-05-14.md). |
