# ClawNex Security Roadmap

**Last updated:** 2026-06-17
**Status:** Public summary

## Purpose

This roadmap communicates the security work that matters to public users without exposing raw internal risk-register detail. It is intentionally concise and avoids exploit-level descriptions.

## Completed For Public Launch

| Area | Status |
|---|---|
| Public source release review | Complete |
| Clean install/build verification from public source | Complete |
| Tracked-source secret scan | Complete |
| Security disclosure channel | Complete |
| RBAC-first public deployment posture | Complete |
| Installer mode confirmation for local/server/VPS choices | Complete |
| Host Security scanner bundled with ClawNex | Complete |
| Public documentation refresh | In progress |

## Near-Term Security Work

| Area | Why it matters |
|---|---|
| Independent penetration test | Adds external validation beyond internal review and automated testing. |
| Continuous dependency scanning | Reduces time-to-detect for vulnerable dependencies after release. |
| Backup and restore exercise | Proves operational recovery rather than only documenting it. |
| Incident tabletop exercise | Exercises security response before a real incident. |
| Access review cadence | Keeps operator access aligned with least privilege over time. |
| Secret-management maturity | Improves rotation, storage, and operational discipline for provider keys and deployment secrets. |
| Audit tamper-evidence improvements | Strengthens post-incident evidence confidence. |

## Deployment Guidance

- Use the supported installer path for your platform.
- Use RBAC for any shared, server, or public deployment.
- Keep ClawNex and OpenClaw bound and firewalled according to the deployment guide.
- Rotate any provider keys used during testing before production use.
- Treat model-provider API keys and dashboard admin credentials as production secrets.

## Disclosure

Please do not open public GitHub issues for suspected vulnerabilities. Email `security@clawnexai.com` with a concise report and reproduction notes. General questions go to `contact@clawnexai.com`.
