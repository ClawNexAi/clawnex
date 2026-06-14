# Risk Management Policy

Document ID: CLAWNEX-POL-006
Version: 1.3
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-14

## 1. Purpose

This policy defines how ClawNex identifies, assesses, prioritizes, treats, and tracks security, privacy, operational, and compliance risks.

## 2. Scope

Applies to product, infrastructure, deployment, documentation, vendor, and process risks affecting ClawNex.

## 3. Risk Lifecycle

1. Identify
2. Assess
3. Prioritize
4. Treat
5. Track
6. Review

## 4. Minimum Risk Record Fields

Each tracked risk should include:
- risk ID
- title
- description
- category
- likelihood
- impact
- severity/priority
- owner
- treatment decision
- due date
- status

## 5. Treatment Options

- mitigate
- transfer
- avoid
- accept

Accepted risks must be explicit, time-bounded where possible, and approved by an owner.

## 6. Triggering Events for Review

Review risks when:
- a major finding is discovered
- architecture changes materially
- a new vendor is introduced
- an incident occurs
- a public release is planned

## 7. Reporting

High and critical risks should be visible to decision-makers before release or production deployment.

## 8. Related Documents

- Information Security Policy
- Vendor and Third-Party Risk Management Policy
- Incident Response Policy
- security audit reports


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
| 1.3 | 2026-05-14 | Internal reviewer | **DAST Round 15 register update (no body change).** Risk register at `docs/registers/risk-register.md` bumped to v1.6 (review 2026-05-14): R-026 through R-035 added and closed during this remediation pass (Pattern-B leak, browser-driven CSRF, retention bypass, internal reviewer P1 cluster, login timing oracle, anonymous info-leaks, API cacheability, dup headers + `Via`, shield steg-rule neutering, audit actor accuracy). R-036 (H2 style-src `'unsafe-inline'`) opened as the **final pre-OSS launch gate**. R-037 (DNS rebinding) and R-038 (denied-attempt audit logging) opened as residual P2 items. Canonical evidence: [`docs/qa/dast-remediation-2026-05-14.md`](../qa/dast-remediation-2026-05-14.md). |
