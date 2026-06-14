# Business Continuity and Disaster Recovery Policy

Document ID: CLAWNEX-POL-010
Version: 1.2
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-05

## 1. Purpose

This policy defines the minimum continuity and recovery expectations for ClawNex in the event of service disruption, data loss, infrastructure failure, or security incident.

## 2. Scope

Applies to:
- source and release artifacts
- operational database and supporting files
- deployment configuration
- core supporting services needed for ClawNex operation

## 3. Objectives

- restore service safely
- preserve critical data where possible
- reduce downtime and confusion during disruption
- document recovery responsibilities and evidence

## 4. Minimum Requirements

- critical systems and recovery dependencies must be identified
- backups should exist for material operational data where required
- recovery procedures should be documented
- at least one recovery test or restore exercise should be performed periodically

## 5. Recovery Priorities

Priority should be given to:
1. restoring safe access and control
2. restoring required data stores and configuration
3. restoring monitoring, auditability, and security controls
4. restoring normal supporting functions

## 6. Disaster Recovery Expectations

Recovery documentation should cover:
- rebuild from source
- configuration restoration
- database restoration
- secret rotation where compromise is suspected
- validation steps before declaring service restored

## 7. Testing

Tabletop exercises and practical recovery tests should be run and documented periodically.

## 8. Related Documents

- Data Retention and Disposal Policy
- Incident Response Policy
- deployment and reconstruction guides


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
