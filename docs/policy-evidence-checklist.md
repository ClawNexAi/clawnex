# ClawNex Policy Evidence Checklist

**Last updated:** 2026-06-17
**Status:** Public summary

## Purpose

This checklist maps ClawNex policy commitments to public evidence artifacts. It intentionally points to public-safe summaries instead of raw internal QA notes, exploit matrices, or environment-specific evidence.

## How To Read This Document

- **Implemented** means the public repo contains evidence that the control exists or is documented.
- **Partial** means a control exists but still needs recurring operational execution or higher-assurance evidence.
- **Planned** means the control is on the roadmap and should not be treated as complete.

## Policy Evidence Map

| Policy area | Public evidence | Status |
|---|---|---|
| Information security posture | [Security validation summary](security-validation-summary.md), [security architecture](11-security-architecture.md), [SECURITY.md](../SECURITY.md) | Implemented |
| Access control | [Access control policy](policies/02-access-control-policy.md), RBAC documentation in [advanced user manual](07-advanced-user-manual.md), installer mode guidance in [deployment guide](12-deployment-guide.md) | Implemented |
| Incident response | [Incident response policy](policies/03-incident-response-policy.md), [responsible disclosure policy](../SECURITY.md), [security roadmap](security-roadmap.md) | Implemented |
| Change management | [Change management policy](policies/04-change-management-policy.md), [release notes](13-release-notes.md), [CHANGELOG](../CHANGELOG.md) | Implemented |
| Vendor and third-party risk | [Vendor policy](policies/05-vendor-third-party-risk-policy.md), [NOTICE](../NOTICE), dependency lockfiles | Partial |
| Risk management | [Public risk posture summary](registers/risk-register.md), [security roadmap](security-roadmap.md) | Implemented |
| Secure SDLC | [Secure SDLC policy](policies/07-secure-sdlc-policy.md), [security assessment summary](security-assessment-summary.md), build/test scripts in `scripts/` | Implemented |
| Data classification | [Data classification policy](policies/08-data-classification-policy.md), [data dictionary](14-data-dictionary.md) | Implemented |
| Data retention and disposal | [Data retention policy](policies/09-data-retention-and-disposal-policy.md), configuration docs, deployment docs | Partial |
| Business continuity and disaster recovery | [BCP / DR policy](policies/10-bcp-dr-policy.md), backup guidance in deployment docs | Partial |
| Cryptographic controls | [Cryptographic controls policy](policies/11-cryptographic-controls-policy.md), [security architecture](11-security-architecture.md) | Implemented |
| Asset management | [Asset management policy](policies/12-asset-management-policy.md), dependency manifests, installer docs | Partial |
| Vulnerability management | [Vulnerability management policy](policies/13-vulnerability-management-policy.md), [security validation summary](security-validation-summary.md), [security roadmap](security-roadmap.md) | Implemented |
| Acceptable use | [Acceptable use policy](policies/14-acceptable-use-policy.md), [CONTRIBUTING](../CONTRIBUTING.md), [code of conduct](../CODE_OF_CONDUCT.md) | Implemented |

## Public Assurance Notes

The public evidence set demonstrates that ClawNex has a structured security program, documented controls, and validation work behind the launch. It does not claim certification, third-party penetration testing, SOC 2 completion, or that every self-hosted deployment is secure without correct operator configuration.

## Open Maturity Items

| Item | Status |
|---|---|
| Independent penetration test | Planned |
| Recurring dependency scanning in CI | Planned |
| First public restore exercise report | Planned |
| First tabletop exercise report | Planned |
| Formal access review cadence evidence | Planned |
| Stronger key-management and rotation workflows | Planned |

For suspected vulnerabilities, email `security@clawnexai.com`. General correspondence goes to `contact@clawnexai.com`.
