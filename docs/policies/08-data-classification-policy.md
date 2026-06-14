# Data Classification Policy

Document ID: CLAWNEX-POL-008
Version: 1.2
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-05

## 1. Purpose

This policy defines how ClawNex information is classified so that handling, access, retention, and disclosure controls can be applied consistently.

## 2. Scope

Applies to:
- application data
- audit and operational logs
- configuration data
- credentials and secrets
- documentation
- exported reports and evidence artifacts
- backups and archived data

## 3. Classification Levels

### Public
Information approved for unrestricted external sharing.
Examples:
- public OSS documentation
- approved release notes
- public website copy

### Internal
Business and operational information intended for internal team use.
Examples:
- internal runbooks
- planning notes
- non-sensitive operational metrics

### Confidential
Sensitive information that should be restricted to authorized users with a business need.
Examples:
- customer-specific operational data
- internal security findings
- non-public architecture details
- deployment and infrastructure specifics

### Restricted
Highly sensitive information requiring the strongest practical controls.
Examples:
- API keys, secrets, passwords, tokens
- credential-bearing config
- incident evidence containing sensitive exposure
- audit data whose alteration or disclosure would materially increase risk

## 4. Handling Expectations

### Public
May be shared externally once approved.

### Internal
Should not be broadly published or exposed publicly without review.

### Confidential
Should be shared only with authorized individuals and protected in storage and transit where practical.

### Restricted
Must be tightly limited, redacted where possible, and never exposed in public repositories or casual communications.

## 5. Minimum Labeling Guidance

Where practical, documents and reports should be labeled using one of the classification levels above.

## 6. Default Classification Guidance

If classification is uncertain:
- secrets and credentials default to Restricted
- security findings default to Confidential
- internal operational documents default to Internal
- public documentation defaults to Public only after approval

## 7. Related Documents

- Information Security Policy
- Access Control Policy
- Data Retention and Disposal Policy
- security audit reports


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
