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
