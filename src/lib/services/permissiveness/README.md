# Permissiveness

Unified blast-radius + permissiveness model for ClawNex. Consumed by the Blast Radius panel and (later, in SP-3) Trust Audit findings.

## Scope

- OpenClaw-layer posture (`channels.*` in `~/.openclaw/openclaw.json`)
- Hermes-layer posture (`~/.hermes/profiles/*/` tree — `.env`, `config.yaml`, pairing, channel directory)
- 5 existing runtime surfaces (litellm-proxy, dashboard, api-v1, mcp-http, session-watcher)
- Dangerous-tool-combination registry (5 seeded)
- Posture-lint rules (2 seeded)

## Design + plan

- Spec: `docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md`
- Plan: `docs/superpowers/plans/2026-04-23-blast-radius-permissiveness-plan.md`

## No-fake-data guarantee

Every field traces to a real file:line or env var. Missing evidence renders as `unknown` with explicit source note, never faked. Bot tokens are NEVER stored raw — only prefix (first 20 chars) + SHA-256 hash.
