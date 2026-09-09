# Connector Routing Reconciliation Contract

## Confirmed Architecture

ClawNex discovers OpenClaw from the resolved `openclaw.json` and discovers Hermes from each configured Hermes `config.yaml` plus normalized rows written by the Hermes watcher. OpenClaw provider endpoints and Hermes `custom_providers` with HTTP(S) endpoints are writable. Hermes built-in, OAuth/session-bound, and watcher-only entries are read-only unless the operator first exposes them through a writable custom provider configuration.

Routing is provider-endpoint based. Selecting one model selects its provider endpoint and therefore affects sibling models using that endpoint. The local LiteLLM target is `http://127.0.0.1:${LITELLM_PORT}/v1`.

## Action Semantics

- **Sync inventory** rereads the integration configuration, compares a secret-free normalized snapshot, and records drift.
- **Apply routing** changes only explicitly selected writable providers and records a recoverable sidecar before the write.
- **Revert** restores only ClawNex-managed provider changes whose current value still matches the managed value. It does not discover models.
- **Restart** restarts the affected runtime so it reloads its configuration. Restart success is not routing verification.
- **Verify** must compare the persisted route with the active configuration and, where available, correlate observed traffic before reporting protected status.

## Snapshot and Drift Rules

Snapshots contain provider/model identity, endpoint without credentials or URL query data, credential-reference type, default model, route target, effective route, and writability. They never contain API keys, bearer tokens, raw prompts, or raw configuration blobs.

Ordering and irrelevant formatting do not change a fingerprint. Added, removed, reassigned, endpoint, authentication-reference, default-model, and route changes create a drift event. Repeated syncs of the same unresolved state do not create duplicate events.

## Known Limitations

Provider-level routing is the safe enforcement boundary in the current Hermes/OpenClaw integrations. A model row can be selected for operator clarity, but applying it changes the provider endpoint. OAuth/session-bound providers cannot be transparently proxied by this local integration and must remain visibly direct or unsupported.
