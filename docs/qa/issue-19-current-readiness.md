# Issue 19: current-dev readiness acceptance, 2026-10-05

Status: local checks and fresh QA acceptance passed; the operator approved committing and pushing the four scoped files to `dev`. Issue publication and closure await separate approval. The tested base is `b0ffcb1`, which includes readiness integration commit `58b50a3`. The scoped metadata compatibility fix and logger regression repair were deployed to QA with explicit approval. The commit containing this report records the approved fix and acceptance evidence; remote integration is verified after push.

## Prior implementation inventory

Reviewed the original report at `2330896:docs/qa/issue-19-litellm-provider-readiness.md` and the issue's recovery/integration history.

- Retained authenticated credential validation before catalog success, explicit selected-model generation, shared config-path resolution and explicit service-manager failures.
- Adapted readiness to require successful inference through the exact loaded alias/revision, with configuration/credential invalidation and a 30-minute receipt. Reviewed routing approval remains separately bounded.
- Rejected provider-save automatic restarts, wildcard-generated health targets, silent malformed-alias deduplication and unrelated historical macOS memory changes.

## Current evidence

The eight inspected readiness/control/sync/callback runtime files on QA match current-dev source hashes. Two read-only QA checks returned HTTP 200 for proxy liveness and authenticated model inventory. The running process reads the dashboard's actual configuration path. The selected alias `openrouter/openai/gpt-oss-20b` is uniquely loaded with matching adapter and revision; generated aliases contain neither wildcards nor repeated OpenRouter prefixes.

QA Infrastructure reports `online` with the explicit caveat: proxy reachable, model inference not tested, upstream probes require operator approval. A separately approved selected-model probe then succeeded, and the provider UI displayed its 30-minute readiness validity. Catalog access is not treated as inference evidence.

All ten existing TypeScript suites passed locally and in an isolated Linux QA stage: LiteLLM health checks (35 assertions), probe consent, control safety, provider sync, routing-provider safety, proxy-model readiness, provider readiness, provider-inference API, onboarding contract and provider save/sync. TypeScript checking and diff whitespace checks passed locally.

The installed QA LiteLLM passed a disposable loopback-only native-proxy fixture: signed identities across tools/instances, streaming, pre-upstream blocking, scanner-outage fail-closed behavior, and manual bypass without a false claim of verified protection. No live security policy was changed for these fixtures.

The routing-logger evidence Python fixture passed locally. The service-logger fixture initially failed to import because its fake LiteLLM SDK lacked the newer Messages/Responses logging classes. Repairing that external SDK stub restored execution. The confirmed public proxy-hook/HTTP boundary now also covers authenticated scanning, failed internal authentication blocking with audit ingestion, and explicit environment-selected scanner-error allowance without fabricated scanning or bypass activation. The repaired fixture passes locally and in the isolated Linux stage. Production callback behavior was not modified.

## OpenClaw blocker reproduced and repaired

The operator approved a temporary single-provider reviewed Apply/Verify/Restore lifecycle, the selected-model probe, one isolated OpenClaw request and necessary OpenClaw-only gateway restarts. The first native CLI attempt rejected an explicit model override under the existing model allowlist before inference. Verify correctly found no matching new traffic, rather than accepting historical traffic or the provider probe.

The operator separately approved one additional request using the already-configured default model and the same lifecycle. That retry stopped at configuration validation before inference: installed OpenClaw 2026.9.5 rejects `meta.lastTouchedAt`. ClawNex's `applyOpenClawDesiredRouting` adds that field during reviewed Apply. Further live retries stopped; the additional default-model inference request was not sent. The existing allowlist was never widened or disabled.

Both temporary routes were restored through reviewed Restore, and the gateway was restarted after restoration. Every original OpenClaw setting value and file permission matches the private baseline; JSON formatting changed, so byte-for-byte equality is not claimed. The original direct endpoint is restored and the signed header is absent. All other inspected agent configs, dashboard environment, LiteLLM YAML and unrelated service PIDs remain unchanged. Emergency bypass was inactive before and after testing.

The operator confirmed the reviewed Apply/Restore test boundary and approved repair. A new regression failed before the fix: Apply changed empty metadata to include `lastTouchedAt`. Removing that write preserves OpenClaw-owned metadata; ClawNex timestamps remain in its recovery journal. The regression now passes for empty, absent and legacy metadata, unchanged configured defaults/model policy, and semantic restoration of every original setting. The installed CLI schema separately accepted empty metadata and rejected the added field.

Ten routing regression suites passed locally: provider-inference API, connector routing inventory, reconciliation, file transaction, OpenClaw v2 recovery, legacy recovery, routing evidence, Hermes recovery, OpenCode routing and native-agent routing. The updated provider-inference API and OpenClaw v2 recovery regressions also passed in the isolated Linux release stage. TypeScript checking, both Python logger fixtures and diff whitespace checks passed. The production Linux build and isolated standalone health/login/authentication smoke checks passed.

## Approved QA deployment and live acceptance

The operator explicitly approved a dashboard-only deployment with a retained rollback build, then up to two short requests: a fresh readiness probe and one configured-default native OpenClaw request. QA build `BQSX_WlOJfG9l31xpuKHl` was activated. Health recovered; unauthenticated provider access remained HTTP 401. The environment, service unit, database inode and unrelated LiteLLM/Caddy/OmniRoute service PIDs were preserved. The three activated source files match the staged fix. The previous build and original source files are retained in a private rollback directory.

At `https://qa.clawnexai.com/#tab=configuration`, the fresh approved model probe passed. Reviewed Apply affected one provider and one model. The installed OpenClaw CLI validated the actual routed settings without warnings. Only the OpenClaw gateway restarted for Apply and Restore.

The configured-default native `openclaw agent exec` request ran from 2026-10-05 00:10:39 to 00:11:02 UTC, without a CLI model override or model-policy changes. A private test-only config retained the reviewed provider endpoint and signed identity, denied all tools, disabled plugins and bounded output. It returned `OK`, `ok: true`, one assistant turn and 1,795 tokens (1,746 input, 49 output, including 38 reasoning tokens). Reported cost was zero; this is not an independent billing assertion. The installed CLI emits no tool-call counter, so the helper's extra counter assertion failed despite the successful native result. No request was repeated to satisfy that reporting assertion. Tool denial was configured; an observed zero tool-call count is not claimed. This proves native OpenClaw inference, not an externally delivered gateway conversation.

The dashboard's Verify reported **Routed models verified**, one newly attributable traffic event after Apply, all one routed models verified, and the same 1,795 tokens. This accepts real-agent traffic rather than historical traffic or the standalone provider probe. Browser console errors: `[]`. Emergency bypass remained inactive.

Reviewed Restore returned the original direct endpoint and removed the signed identity header. The gateway restarted after Restore. Every original OpenClaw setting value and file permission matches the baseline; JSON formatting differs, so byte equality is not claimed. Other inspected agent settings, environment and LiteLLM YAML remain byte-identical, and unrelated service PIDs remain unchanged. The dashboard restart was explicitly approved and is excluded from that unrelated-PID assertion. The final UI reported **Direct connection**, three services online and zero down.

Next gate: complete the approved four-file commit/push and verify the remote `dev` commit. Publish a sanitized acceptance summary and close issue 19 only with separate operator approval.
