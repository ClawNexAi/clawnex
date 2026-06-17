# Change Management Policy

Document ID: CLAWNEX-POL-004
Version: 1.3
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-14

## 1. Purpose

This policy defines how changes to ClawNex code, configuration, deployment procedures, and security-relevant behavior are proposed, reviewed, approved, and released.

## 2. Scope

Applies to:
- application code changes
- dependency updates
- infrastructure or deployment changes
- security control changes
- configuration defaults
- release and packaging changes

## 3. Principles

- changes should be traceable
- risky changes should be reviewed before release
- emergency changes should be documented after the fact
- release claims must match what actually shipped

## 4. Standard Changes

Standard changes should include:
- description
- rationale
- files/components affected
- review evidence
- verification evidence

## 5. Emergency Changes

Emergency changes may move faster, but still require:
- owner
- reason
- scope
- post-change verification
- retrospective documentation

## 6. Release Controls

Before release:
- build must pass
- critical blockers must be reviewed
- known deferrals must be documented
- release notes must reflect actual state

## 7. Security-Sensitive Changes

Changes affecting auth, RBAC, logging, shielding, routing, break-glass, audit, or deployment exposure should receive heightened review.

## 8. Rollback Expectation

Where practical, releases and deployments should have a rollback or recovery path documented.

## 9. Records

Relevant changes should be reflected in changelogs, pull requests, issue history, or release notes.

## 10. Related Documents

- Information Security Policy
- Secure SDLC Policy
- release notes


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
| 1.3 | 2026-05-14 | Internal reviewer | Security validation evidence cross-reference added to the public evidence checklist. The internal remediation campaign followed controlled-change discipline with scoped commits, verification, and deployment review. |
