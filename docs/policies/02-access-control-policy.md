# Access Control Policy

Document ID: CLAWNEX-POL-002
Version: 1.3
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-14

## 1. Purpose

This policy defines how access to ClawNex systems, environments, administrative functions, and sensitive data is granted, reviewed, and revoked.

## 2. Scope

Applies to:
- ClawNex dashboard access
- RBAC roles and permissions
- API keys
- deployment and infrastructure access
- repository and CI access
- secrets stores and operational credentials

## 3. Principles

- Least privilege
- Need-to-know
- Separation of duties where practical
- Named accountability for privileged access
- Prompt removal of unneeded access

## 4. Access Requirements

- Access must be granted to named individuals or controlled service identities.
- Shared credentials should be avoided unless technically unavoidable and documented.
- Administrative access must be limited to authorized maintainers.
- Network-exposed deployments should use RBAC-enabled operation.

## 5. Provisioning

Access requests must include:
- requester identity
- requested access level
- business justification
- approving owner

## 6. Review

Access should be reviewed at least quarterly for privileged roles and key service accounts.

## 7. Revocation

Access must be revoked or reduced when:
- no longer needed
- role changes
- contributor/contractor relationship ends
- compromise is suspected

## 8. API Keys and Secrets

- API keys must be scoped where possible.
- Secrets must not be published in public repositories.
- Rotations must occur on schedule or immediately after suspected exposure.

## 9. Break-Glass Access

Emergency override access must:
- be time-bounded where possible
- require reason capture
- be audited
- be reviewed after use

## 10. Enforcement

Improper access provisioning or failure to revoke access is a policy violation and may block release or deployment.

## 11. Related Documents

- Information Security Policy
- Incident Response Policy
- SECURITY.md


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
| 1.3 | 2026-05-14 | Internal reviewer | **DAST Round 15 evidence cross-reference (no body change).** Authentication production posture remains as written: RBAC required for any network-reachable deployment; RBAC-off is localhost-only single-operator mode. New evidence rows now landed in `docs/policy-evidence-checklist.md §02`: RBAC-on QA blocked sensitive routes (21/21 Pattern-B + 4/4 mutation endpoints), `requireLocalhost` Origin/Referer enforcement (P0-A `9088ff5`), Pattern-B route guard verifier (`scripts/verify-pattern-b.sh`), login timing envelope (H1 `MIN_LOGIN_FAILURE_MS = 2000` floor, live delta 4ms on QA), `operatorCount` stripped from anonymous `/api/auth/status` (H4), `DEFAULT_OPERATOR.username = 'localhost'` for audit-distinguishable RBAC-off actions (L3). Canonical evidence: [`docs/qa/dast-remediation-2026-05-14.md`](../qa/dast-remediation-2026-05-14.md). |
