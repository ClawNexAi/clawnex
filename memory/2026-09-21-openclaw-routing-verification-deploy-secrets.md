# OpenClaw routing verification after preserved deployment — 2026-09-21

## DEBUG REPORT

- **Symptom:** OpenClaw successfully answered through the routed GPT-OSS-20B model, but **Verify connection** repeatedly reported that no matching traffic was observed after the latest routing operation.
- **Root cause:** Two independent production defects combined. First, `deploy-prod.sh --preserve-data` regenerated `CLAWNEX_INGEST_SECRET`, so the preserved ClawNex-managed identity header no longer validated in LiteLLM. Second, verification treated the inventory snapshot and drift events created by the Verify request itself as the evidence baseline, excluding valid traffic sent immediately before the click.
- **Fix:** Preserved-data deployments now retain validated session, evidence-encryption, ingest, and LiteLLM master secrets; fresh deployments still generate them. Verification now uses only the latest operator apply/revert/restart operation as its baseline. OpenClaw restart operations now record source `default`.
- **Evidence:** QA retained the same 64-byte ingest-secret fingerprint through two preserved deployments. The stale managed header was guarded by its recovery hash, re-signed once, and confirmed valid against the running LiteLLM secret. A real OpenClaw CLI request after the deployed restart route produced a successful outbound row with connector `openclaw`, source `default`, verified identity, request ID, model `openrouter/openai/gpt-oss-20b`, and timestamp `2026-09-21T16:22:34.898Z`. The production verifier returned `verified`, `protected-and-verified`, and one matching event.
- **Regression tests:** `scripts/verify-preserve-deploy-secrets.mjs` covers preserved runtime secrets and fresh-install fallbacks. `scripts/verify-routing-evidence.ts` proves changed snapshots and drift discovery do not move the post-operation baseline. `scripts/verify-openclaw-routing-actions.ts` checks that restart operations target the default instance.
- **Related:** `memory/2026-09-09-openclaw-restart-order.md` documented the earlier absence of identity-verified OpenClaw evidence but did not include a preserved deployment between apply and verification.
- **Status:** DONE
