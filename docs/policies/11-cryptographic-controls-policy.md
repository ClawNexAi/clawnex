# Cryptographic Controls Policy

Document ID: CLAWNEX-POL-011
Version: 1.2
Effective Date: 2026-04-22
Owner: Project owner
Approved By: Project owner (Owner & Maintainer)
Approval Date: 2026-04-22
Approval Method: Self-approval by sole project maintainer; pending named alternate approver.
Next Review: 2027-04-22
Last Updated: 2026-05-05

## 1. Purpose

This policy defines expectations for the selection and use of cryptographic controls within ClawNex.

## 2. Scope

Applies to:
- password hashing
- session tokens
- secret handling
- transport encryption
- integrity-protection mechanisms
- any future encryption-at-rest controls

## 3. Principles

- use established, reviewed cryptographic primitives
- avoid custom cryptographic design where standard controls exist
- protect secrets in storage and transit
- use integrity protection where immutability or tamper evidence matters

## 4. Minimum Requirements

- credentials and passwords must not be stored in plaintext
- security-sensitive transport should use TLS where feasible
- insecure TLS verification bypasses should not be enabled by default
- security tokens should be generated with sufficient entropy
- cryptographic exceptions must be documented

## 5. At-Rest Considerations

Where application-layer encryption at rest is not implemented, deployment guidance must document compensating controls such as full-disk encryption or equivalent platform controls.

## 6. Rotation and Lifecycle

Secrets and cryptographic material should be rotated:
- on suspected compromise
- on role/ownership change where applicable
- on documented cadence for material secrets

## 7. Related Documents

- Information Security Policy
- Access Control Policy
- SECURITY.md


## Change Log

| Version | Date | Editor | Summary |
|---|---|---|---|
| 1.0 | 2026-04-22 | Project owner | Initial policy draft under v0.6.2-alpha governance lane. |
| 1.1 | 2026-04-22 | Project owner | Signed off by Owner & Maintainer pending named alternate approver. |
| 1.2 | 2026-05-05 | Project owner | Audit pass — no body change; reconciled header/changelog version mismatch (header was stuck at 1.0 while changelog already showed 1.1 sign-off on 2026-04-22); added Last Updated marker. |
