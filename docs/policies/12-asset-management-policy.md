# Asset Management Policy

Document ID: CLAWNEX-POL-012
Version: 1.2
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-05

## 1. Purpose

This policy defines how ClawNex tracks and manages important information assets, technical assets, and supporting dependencies.

## 2. Scope

Applies to:
- source repositories
- deployment environments
- databases and storage locations
- secrets and credentials stores
- critical vendor dependencies
- documentation and recovery artifacts

## 3. Asset Categories

- code and build assets
- runtime infrastructure assets
- data assets
- identity and credential assets
- documentation and evidence assets
- vendor and service dependencies

## 4. Minimum Asset Inventory Expectations

Material assets should have an identifiable owner and enough information to support:
- security review
- continuity planning
- incident response
- access review
- vendor review where applicable

## 5. Asset Lifecycle

Assets should be:
- identified
- categorized
- assigned an owner
- reviewed periodically
- retired or removed when no longer needed

## 6. Related Documents

- Vendor and Third-Party Risk Management Policy
- Data Classification Policy
- BCP / DR Policy


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
