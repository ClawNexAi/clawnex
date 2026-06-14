# Getting Support

**Product Version:** v0.14.5-alpha
**Last Updated:** 2026-05-14

## Documentation

ClawNex ships with comprehensive documentation accessible from the **Help** panel in the dashboard:

- **Basic User Manual** — getting started, panel overview, first-run setup, sign-in providers (local / passkey / GitHub / Magic Link), Token & Cost Intel walkthrough (v0.11.0+ multi-source FinOps), Alert → Evidence backlink (v0.11.1+)
- **Advanced User Manual** — shield tuning, RBAC, break-glass, operator management, multi-auth provider administration, Configurable Rule & Policy Framework v1 authoring (v0.10.0+), Token Cost FinOps deep-dive (cost trust labels + drain detectors + privacy guarantees), Alert → Evidence advanced (correlation methods + match-not-in-excerpt limitation)
- **API Reference** — all endpoints with request/response examples (including the 13 multi-auth routes from v0.9.0, the `/api/health/detailed` + `health:read` scope from v0.9.1, the `/api/auth/magic-link/{begin,complete}` routes from v0.9.2, the `/api/policies/*` policy framework routes from v0.10.0, the additive `/api/tokens` FinOps fields from v0.11.0, and `/api/alerts/[id]/evidence` from v0.11.1)
- **Troubleshooting Guide** — common issues and fixes (passkey enrollment, GitHub OAuth, Magic Link failure modes, View Evidence NOT IN WINDOW, Token Cost instance-filter / source-status / dev-cache, Policy Framework vendor-rule edit / iteration cap auto-disable)
- **Deployment Guide** — installation, RBAC configuration, standalone deployment, multi-auth env-var setup (`AUTH_RP_ID`, `AUTH_EXPECTED_ORIGIN`, `GITHUB_OAUTH_*`, `EMAILIT_API_KEY`, `MAGIC_LINK_EXPIRY_MINUTES`)
- **In-app Glossary** (v0.11.0+) — open the Help tab and scroll to the Glossary card. 62 plain-English definitions across 10 categories.

## Community Support

- **GitHub Issues** — bug reports and feature requests: https://github.com/clawnex/clawnex/issues
- **GitHub Discussions** — questions, ideas, and community conversation: https://github.com/clawnex/clawnex/discussions

## Reporting Bugs

When filing a bug report, include:

1. ClawNex version (from `/api/health` or the dashboard header)
2. Operating system and Node.js version
3. Steps to reproduce the issue
4. Expected vs actual behavior
5. Browser console errors (if UI-related)

## Security Vulnerabilities

Do **not** file public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.

## Commercial Support

For enterprise deployments, priority support, and custom integrations, contact **info@clawnexai.com**.
