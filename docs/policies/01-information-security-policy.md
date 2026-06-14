# Information Security Policy

Document ID: CLAWNEX-POL-001
Version: 1.2
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-05

## 1. Purpose

This policy defines the overarching information security expectations for ClawNex, its codebase, supporting infrastructure, documentation, and operational data.

## 2. Scope

This policy applies to:
- ClawNex source code and repositories
- build, CI, packaging, and deployment systems
- development, staging, demo, and production environments
- operator accounts, API keys, secrets, and audit records
- contractors, contributors, and internal maintainers with access to ClawNex systems

## 3. Policy Statement

ClawNex will protect the confidentiality, integrity, and availability of its systems and data through proportionate technical, administrative, and operational controls.

## 4. Core Security Principles

1. Least privilege
2. Secure-by-default configuration
3. Verify before trust
4. Auditability of security-relevant actions
5. Timely remediation of identified weaknesses
6. Honest disclosure of alpha-state limitations

## 5. Control Objectives

ClawNex will maintain controls for:
- logical access
- authentication and session security
- secrets handling
- vulnerability and dependency management
- logging and auditability
- incident detection and response
- change management
- secure deployment and release practices

## 6. Roles and Responsibilities

### Owner
Responsible for approving this policy and ensuring resources exist to implement it.

### Maintainers
Responsible for implementing security controls, reviewing changes, and remediating findings.

### Contributors
Responsible for following repository security and disclosure requirements.

## 7. Minimum Requirements

- Security-relevant changes must be reviewed before release.
- Critical findings must be addressed before public exposure where practical.
- Secrets must not be committed to source control.
- Public claims about product security must reflect the actual current state.
- Audit-relevant actions must be logged where supported by the platform.

## 8. Exceptions

Any exception to this policy must be documented with:
- justification
- owner
- duration
- remediation plan

## 9. Enforcement

Violations may result in access restriction, rollback of changes, or suspension of release until risk is addressed.

## 10. Related Documents

- SECURITY.md
- security audit reports
- Secure SDLC Policy
- Access Control Policy
- Incident Response Policy


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
