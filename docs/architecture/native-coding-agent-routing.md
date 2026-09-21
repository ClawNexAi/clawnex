# Native coding-agent routing

Native connectors use the same registry and Prepare → Review → Apply → Verify → Restore coordinator as OpenCode. Clients call the local LiteLLM listener directly. There is no connector inference relay or container.

## Pi

Validated contract: `@earendil-works/pi-coding-agent` 0.86.1 on QA.

- Global `~/.pi/agent/models.json`; `PI_CODING_AGENT_DIR` is honored when set in the ClawNex service environment. The adjacent `settings.json` is included in the reviewed file fingerprints.
- Explicit OpenAI Chat Completions providers with declared models are supported. OAuth, extension-provided models, model overrides, model-specific endpoints/headers and project/sandbox settings are excluded.
- Only models already selected by the operator in ClawNex can be mapped. Every affected model requires a live readiness receipt before Apply.
- Apply writes the local base URL, local proxy credential, signed instance header and exact configured model aliases. If the saved default references an affected model, that reference is updated in the same reviewed operation. Original credentials and owned fields are encrypted in a recovery journal before writes.
- Restore compares owned field values before restoring them, preserves unrelated edits, and retains recovery evidence for conflicts or interrupted writes. Recovery journals are mode 0600. No CLI auth/login files are read or changed.
- Start a new session after Apply/Restore. Existing sessions, CLI/environment overrides and Sandcastle's separate configuration are outside this connector's coverage. Verification needs a successful request bearing this global instance's signed identity; merely seeing the same model does not count.

Upstream contract: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md

Validation: `npx tsx scripts/verify-native-agent-routing.ts` and the existing OpenCode lifecycle suite. Fixtures never contact real providers.

## Codex

Validated CLI: `codex-cli` 0.155.1. Global `~/.codex/config.toml` (or the service's `CODEX_HOME`) is the managed boundary. Explicit custom Responses providers, the global model and explicit profile model references are supported. Built-in subscription providers, command-backed authentication, query parameters and environment-sourced HTTP headers are not automatically rewired.

When no custom provider exists, the operator chooses a configured ClawNex model in the routing pane. This stores a draft only. Review and Apply creates the `clawnex` provider, selects it globally, uses the local proxy bearer credential and signed HTTP header, and disables WebSocket transport so requests use the monitored HTTP Responses route. Existing login credentials, sandbox/approval policy and project settings are untouched. TOML is parsed and serialized; values are preserved, but formatting/comments are normalized on writes. Restore removes only owned fields that still match, retaining unrelated changes.

The global selection does not override explicit project, command-line, environment or different-profile selections. Start a new Codex session after Apply/Restore. A configured endpoint is not evidence of successful traffic; Verify requires exact signed-instance evidence.

Upstream schema: https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/core/config.schema.json

## Claude Code

Validated CLI: 2.1.278. Global `~/.claude/settings.json` (or the service's `CLAUDE_CONFIG_DIR`) is the managed boundary. Native Messages routing uses `env.ANTHROPIC_BASE_URL=http://127.0.0.1:4001`; Claude's SDK appends `/v1/messages`. `ANTHROPIC_AUTH_TOKEN` supplies local proxy access. The newline-delimited `ANTHROPIC_CUSTOM_HEADERS` setting carries the signed connector identity without an inference relay.

Initial setup requires an explicit operator model choice. Reviewed Apply assigns that same choice to the default, Sonnet, Opus, Haiku, fast and subagent slots. Existing explicit model slots are mapped individually to operator-configured aliases. Credential helpers and cloud-provider modes are excluded; permissions, hooks, login files and project settings remain unchanged. Modified custom headers cause a restoration conflict instead of overwriting operator edits.

Codex and Claude Apply perform small live Responses/Messages requests, respectively, before writing any configuration. A successful Chat Completions readiness receipt alone is not enough. This preflight is disclosed in the review dialog. Exact instance verification still requires a subsequent successful client request with its signed identity.

Upstream contract: https://code.claude.com/docs/en/llm-gateway-connect
