# AnythingLLM chat routing

Tracked in [#48](https://github.com/ClawNexAi/clawnex/issues/48). The first supported contract is AnythingLLM 1.16.1's developer API.

Register an instance under Configuration → Fleet & Routing → Fleet Connectors. Supply its origin, a developer API key, and the ClawNex origin reachable by that instance. Docker containers need a host-reachable address; their localhost is not the host. Remote DNS names must satisfy the existing trusted-provider host policy.

Registration reads configuration only. Under AnythingLLM Routing, default chat is selected initially. Choose an upstream model already configured and tested in ClawNex. Workspace overrides are opt-in. Workspaces without an explicit provider follow the default and have no misleading independent routing toggle. Refresh discovers new workspaces, preserving selections by stable workspace ID. Review lists affected inherited workspaces as well as explicit changes.

The adapter reserves an unused AnythingLLM LiteLLM connection and switches selected chat routes to it. Existing Generic OpenAI/OpenRouter/etc. endpoints and credentials are untouched. An existing LiteLLM connection is never taken over. Selected workspace models can differ; the reserved default model is fixed in this first version. Restore a managed workspace before changing its model. Router-managed workspaces are unsupported because changing their provider can clear router configuration. Agent overrides and embeddings remain outside chat-routing coverage.

Management requests use the supported `/api/v1/system`, `/api/v1/workspaces`, `/api/v1/system/update-env`, and `/api/v1/workspace/:slug/update` endpoints. HTTP 200 does not imply success: application errors and readback mismatches fail the operation. AnythingLLM does not offer an atomic compare-and-set across these APIs. ClawNex re-reads before writes, retains recovery ownership before mutation, and refuses observed operator conflicts; concurrent external edits cannot be made fully transactional.

Review plans are server-stored, expire after five minutes, and bind current configuration plus selections. Apply and restore use a cross-process lease. Partial failures retain recovery data and require another review. Restore changes only still-owned provider/model fields. It retains the reserved LiteLLM connection for reuse, since the API masks credentials and cannot prove whether an operator changed a saved key. Restoring all routes also disables inference with that instance's relay key.

Management and relay keys are encrypted with AES-256-GCM, an instance-ID AAD, and a purpose-derived key from `EVIDENCE_ENCRYPTION_KEY`. Preserve that key with the database during deployment/recovery. No key is returned to the dashboard. The relay accepts only the instance's random bearer key and models in its managed routes, drops client provider/credential/attribution overrides, bounds request size and concurrency, and forwards streaming chat to localhost LiteLLM. LiteLLM continues to enforce Shield policy and report token/cost telemetry. A server-signed identity attributes evidence to the AnythingLLM instance.

Verification requires successful non-bypassed traffic after the latest operation. It proves instance/model traffic, not individual workspace or agent coverage. Send a new chat from AnythingLLM before pressing Verify connection.

Run `npx tsx scripts/verify-anythingllm-routing.ts`, `npx tsx scripts/verify-routing-evidence.ts`, `npx tsx scripts/verify-routing-ingest-evidence.ts`, and `python3 scripts/verify-routing-logger-evidence.py`. For an isolated browser fixture, run `npx tsx scripts/routing-ui-fixture.ts --anythingllm` (or add `--production` after building).
