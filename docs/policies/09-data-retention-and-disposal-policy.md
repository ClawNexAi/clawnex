# Data Retention and Disposal Policy

Document ID: CLAWNEX-POL-009
Version: 1.3
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-14

## 1. Purpose

This policy defines how long ClawNex data should be retained and how it should be disposed of when no longer needed.

## 2. Scope

Applies to:
- operational database records
- metric snapshots
- audit logs
- security scans and posture results
- correlation and alert data
- exported reports
- backups and archives
- temporary artifacts containing sensitive content

## 3. Principles

- retain only what is necessary
- preserve evidence needed for security and operational review
- remove data that no longer has a justified purpose
- handle sensitive disposal deliberately

## 4. Retention Guidance

Retention periods should be documented and justified by operational, legal, or security need.
At minimum, maintain defined retention expectations for:
- audit records
- alerts and incidents
- scan results
- metric snapshots
- backups
- generated reports

## 5. Disposal Requirements

When data reaches the end of its retention period or is no longer needed, it should be deleted or otherwise disposed of using methods appropriate to its sensitivity and environment.

## 6. Sensitive Artifacts

Special care should be taken with:
- database backups
- migration/export bundles
- temporary files with secrets
- generated archives
- copied config files containing credentials

## 7. Exceptions

Any retention exception should record:
- what is being retained longer
- why
- owner
- target review date

## 8. Related Documents

- Data Classification Policy
- Information Security Policy
- BCP / DR Policy


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
| 1.3 | 2026-05-14 | Internal reviewer | **DAST Round 15 evidence cross-reference (no body change).** Retention bypass closed by P0-C (`0949d0c`): `/api/config/defaults` PUT now rejects writes to keys matching `PROTECTED_PREFIXES = ['retention_']` or `PROTECTED_EXACT = {break_glass, proxy_block_mode}`. The canonical writer for retention keys remains `/api/config/retention` with its OPTIONS allow-list (`retention_audit_days ∈ {90, 180, 365, 0}` etc.). The bypass that previously enabled `retention_audit_days=1` (audit-log rotated daily, forensic trail destroyed) is now structurally impossible. Verifier: `scripts/verify-config-defaults-protect.sh` (16/16 — 8 protected keys rejected, 8 legitimate keys allowed). Canonical evidence: [`docs/qa/dast-remediation-2026-05-14.md`](../qa/dast-remediation-2026-05-14.md). |
