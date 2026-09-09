# OpenCode routing evidence callback — 2026-09-09

## DEBUG REPORT

- **Symptom:** OpenCode successfully answered through the configured ClawNex/LiteLLM endpoint, but Verify connection reported that no matching traffic was observed.
- **Root cause 1:** Generated LiteLLM configuration named the `ClawNexLogger` class. LiteLLM imported it but callback dispatch requires the supported `clawnex_logger_instance`; successful completions therefore produced no `/api/proxy/ingest` record.
- **Fix 1:** The shipped template and every provider-sync path now configure `clawnex_logger.clawnex_logger_instance`. Regression coverage checks empty, single-provider, and mixed-provider generated configurations.
- **Root cause 2:** After OpenCode routing was applied, inventory discovery recomputed the proxy alias from the OpenCode-qualified key and routed LiteLLM endpoint. It compared `lmstudiom4/qwen/...` with the correctly ingested `qwen/...` model.
- **Fix 2:** Routed discovery now uses the exact managed alias recorded during the reviewed apply operation. The public OpenCode routing lifecycle test refreshes inventory after apply and asserts that the written LiteLLM alias is preserved.
- **Live evidence:** LiteLLM restarted as PID `49996` with the instance callback. A real OpenCode request created a verified outbound row at `2026-09-09T15:10:13.719Z` for `qwen/qwen3.6-35b-a3b`, connector `opencode`, source `opencode:global`, HTTP 200, with a proxy request ID. Verification reports `partial-traffic`, 1 of 3 routed models and 27,416 tokens; two models still need post-routing traffic before full verification.
- **Validation:** `verify-litellm-provider-sync`, `verify-opencode-routing`, `verify-routing-reconciliation`, TypeScript, `git diff --check`, and two production builds pass. Installed dashboard build is `mGUM1DgC8n3cR13tPnQ77`; dashboard and LiteLLM health checks pass.
- **Rollback:** Dashboard recovery assets are `/Users/joeybossman/Library/Application Support/ClawNex/recovery-opencode-evidence.MLmVey` and `/Users/joeybossman/Library/Application Support/ClawNex/recovery-opencode-verify.4WOOWb`.
- **Status:** FIXED — ingestion and exact-alias correlation are proven with real OpenCode traffic. Full three-model acceptance remains pending operator traffic through the two remaining configured models.
