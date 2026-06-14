# Incident Response Policy

Document ID: CLAWNEX-POL-003
Version: 1.3
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-14

## 1. Purpose

This policy establishes the minimum process for identifying, triaging, containing, investigating, and communicating security incidents affecting ClawNex.

## 2. Scope

Applies to suspected or confirmed incidents involving:
- unauthorized access
- credential exposure
- code compromise
- malicious dependency or supply-chain event
- data exposure
- security control bypass
- operational misuse of break-glass or privileged pathways

## 3. Objectives

- contain harm quickly
- preserve evidence
- restore safe operation
- learn from incidents
- communicate accurately and promptly

## 4. Severity Levels

- Sev 1: active compromise, public exposure, or critical control bypass
- Sev 2: significant security weakness with realistic exploitability
- Sev 3: contained or lower-impact issue
- Sev 4: advisory or non-urgent issue

## 5. Response Phases

1. Detection
2. Triage
3. Containment
4. Eradication
5. Recovery
6. Post-incident review

## 6. Minimum Requirements

- Preserve logs and audit evidence when possible.
- Do not destroy evidence before triage.
- Record incident timeline, owner, severity, and actions taken.
- Rotate exposed secrets after confirmed or suspected compromise.
- Document customer/community communication decisions.

## 7. Communications

Material incidents must be communicated to relevant stakeholders with factual, non-speculative status updates.

## 8. Post-Incident Review

Each significant incident should produce:
- root cause summary
- impacted systems/data
- containment actions
- corrective actions
- owner and due dates

## 9. Testing

At least one tabletop or simulated incident exercise should be run and documented periodically.

## 10. Related Documents

- Information Security Policy
- Risk Management Policy
- SECURITY.md
- Support / operations runbooks


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
| 1.3 | 2026-05-14 | Internal reviewer | **DAST Round 15 evidence cross-reference (no body change).** Tamper-visible audit log control supplemented by [`docs/qa/dast-remediation-2026-05-14.md`](../qa/dast-remediation-2026-05-14.md) — L3 audit actor accuracy fix (`DEFAULT_OPERATOR.username = 'localhost'`) makes RBAC-off unauthenticated actions distinguishable in `audit_log` from real authenticated admin actions, materially improving post-incident forensic accuracy. **Open gap acknowledged:** denied-attempt audit logging (R-038) — when `requireLocalhost` / `requireSession` / `validateOriginMatch` refuses a request (401/403), no `audit_log` row is written; probes from `evil.com` leave no audit trail. Tracked as future work; requires guard-layer wiring + rate-limit-aware suppression so attackers can't cheaply inflate the audit table. |
