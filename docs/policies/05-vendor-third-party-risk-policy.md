# Vendor and Third-Party Risk Management Policy

Document ID: CLAWNEX-POL-005
Version: 1.2
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-05

## 1. Purpose

This policy defines how ClawNex evaluates, tracks, and manages risk from third-party vendors, hosted services, open-source dependencies, and external processing partners.

## 2. Scope

Applies to:
- cloud/email providers
- LLM/model providers
- observability or relay providers
- package and dependency ecosystems
- infrastructure and DNS/CDN providers
- security and compliance tooling vendors

## 3. Requirements

For material vendors, maintain at minimum:
- vendor name
- service provided
- data touched
- owner
- business criticality
- security/privacy considerations
- contract/DPA status where relevant

## 4. Risk Factors

Consider:
- data sensitivity
- availability dependency
- auth/secret dependency
- legal/privacy dependency
- concentration risk
- operational lock-in

## 5. Reviews

Material vendors should be reviewed periodically and when:
- a new service is introduced
- scope of data changes materially
- a major incident occurs
- a major contract/security posture change occurs

## 6. Open-Source Dependencies

Dependencies should be monitored for vulnerabilities and updated according to risk and compatibility.

## 7. Minimum Controls

- maintain a vendor inventory
- document critical external dependencies
- generate or maintain SBOM artifacts where practical
- track known high-risk packages or unresolved CVEs

## 8. Related Documents

- Risk Management Policy
- Information Security Policy
- Secure SDLC Policy


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
