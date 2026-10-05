# Issue 33: shared routing module acceptance, 2026-10-05

Status: isolated macOS/Linux contracts, final Linux production build and approved fresh live Hermes Apply/Verify/Restore pass. The first lifecycle exposed an empty-provider-list restoration defect, now repaired and accepted by the repeated exact-settings check. Commit/push to `dev` is approved; publication and issue closure remain separately gated. Tested base: remote `dev` at `44ef75f`.

## Existing implementation retained

The shared module registry in `src/lib/services/routing-modules.ts` supplies instance-scoped inspect/apply/restore behavior. `routing-workflow.ts` owns immutable reviewed plans, readiness/order checks, expiry, locking, replay, operation records and errors. `routing-file-transaction.ts` publishes durable recovery ownership before atomic configuration replacement. The routing API coordinates verification through `routing-reconciliation.ts`; tool modules reuse existing OpenClaw/Hermes parsers and ownership logic. Gateway restart controllers remain separate, reuse supervisor detection, and require explicit operator action.

No additional workflow engine, plugin marketplace, community SDK or new connector was introduced. The existing assisted Hermes model registration action configures the ClawNex provider and proposed selection; it does not write Hermes settings or replace the reviewed lifecycle. Existing context/watchers remain separate from successful proxy-completion evidence.

## Isolation defect and test-first repair

The operator confirmed the public routing API test boundary: OpenClaw-only, Hermes-only, multiple-instance isolation and refusal of unsupported/remote configurations, using temporary configurations and fake services.

The Hermes-only contract failed because an explicit missing `OPENCLAW_HOME` fell back to another installation. A controlled temporary fallback home reproduced the failure on both macOS and Linux: two unrelated OpenClaw inventory entries appeared instead of zero. The fix makes an explicit home authoritative. Missing explicit configuration yields no OpenClaw configuration rather than selecting another user/instance. Existing discovery when no override is set remains unchanged. The complete caller graph was traced before editing because the resolver also serves collectors, cost adapters, posture, legacy recovery and gateway control.

The first approved real Hermes lifecycle exposed another exact-settings defect: when the original primary-model configuration had no `custom_providers` field, Restore removed the managed bridge but left `custom_providers: []`. A fourth public API fixture reproduced this before the fix. Recovery ownership now records whether that container already existed; both Restore paths delete an empty list only if their operation introduced it. Pre-existing empty lists and older ownership records without this information remain conservative. A fifth fixture proves the original empty-list case survives Restore. No unrelated provider entries are deleted.

## Shared public contracts

Run each mode in its own fresh process:

```sh
npx --no-install tsx scripts/verify-routing-module-contract.ts openclaw-only
npx --no-install tsx scripts/verify-routing-module-contract.ts hermes-only
npx --no-install tsx scripts/verify-routing-module-contract.ts hermes-multi
npx --no-install tsx scripts/verify-routing-module-contract.ts hermes-primary
npx --no-install tsx scripts/verify-routing-module-contract.ts hermes-primary-empty
```

All five modes pass on macOS and in the final private Linux QA stage. Both single-module positive-verification cases, both primary-model container-presence cases, the two-instance contract and nine existing regressions passed before the final production build.

The same HTTP-handler boundary proves mandatory stable-instance selection, approval before writes, replay of the original operation, restart-required reporting, positive authenticated callback verification, rejection of provider-probe/configuration-only evidence and semantic restoration. Two Hermes instances share one provider/model but retain distinct identities; Apply does not touch the peer file, restoring one retains the peer route/ownership, and the peer can still restore independently. One instance's authenticated fake callback cannot verify its peer. Unsupported protocols stay visible but cannot be selected for routing. Unknown layouts cannot produce a writable plan; unknown remote targets cannot fall back to a local source. Another discoverable OpenClaw home's bytes remain unchanged.

The tests substitute only external fetch and the operating-system home directory, use a memory database and temporary configuration files, and call real public handlers and services. Callback records are simulated fixture evidence, not real-agent acceptance. No paid requests or live QA routing/service mutations occurred in these checks.

## Regression evidence and limitations

TypeScript validation and diff checks pass. Existing connector inventory, reconciliation, Hermes recovery and routing evidence checks passed during inspection. After the fix, the OpenClaw cost adapter passed all 27 checks and the Hermes integration fixture passed its read-only state ingestion assertions. Linux passed provider-inference API, connector inventory, Hermes recovery, OpenClaw v2 recovery, legacy recovery, routing evidence, routing ingest, OpenClaw cost adapter and reconciliation regressions.

The live-posture `verify-permissiveness-units.ts` diagnostic is not a green acceptance check: unchanged `dev` and the fix both report exactly the same 15 failed assertions and 178 passes when run with memory databases. Those assertions depend on current machine-specific Hermes/Telegram posture. The initial unisolated diagnostic also encountered a malformed local repository database; no repair, reset or claimed database-integrity acceptance was performed. Subsequent comparison used memory databases only. This limitation is separate from the green shared routing and collector/cost fixture contracts.

Prior #19 live OpenClaw acceptance is recorded at its accepted commit and on parent #30: configured-default native request, 1,795 tokens, newly attributable traffic and reviewed Restore. It is supporting evidence for the shared path, not a new live #33 OpenClaw inference.

## Live QA evidence

The first approved deployment used build `cTIr4M_AkuD3leeCyueH4` with dashboard-only restart and retained rollback. Health/login/authentication passed; environment and unit hashes, database inode, unrelated-service PIDs and both agent PIDs were unchanged during deployment. A fresh readiness request passed. Reviewed default-instance Hermes Apply followed by Hermes-only restart changed neither OpenClaw nor the peer Hermes configuration. Before native traffic, Verify correctly reported missing new evidence. One native installed-Hermes SDK request then returned `HERMES_QA_OK`, forwarded the reviewed identity, used the configured default model `openrouter/openai/gpt-oss-20b`, and had zero tools. The transport guard permitted exactly one proxy inference and refused retries, unrelated network requests or missing identity. Verify attributed one new event, 643 tokens, to the default instance; the direct peer reported zero events. Reported-zero cost is proxy accounting, not a guarantee that the provider charges nothing.

Restore returned the original route and credentials but the exact-settings check found the empty-list defect described above. No other setting value, file mode, environment or other-agent configuration changed. The user separately approved the additional repair deployment, two more short requests and guarded removal of only the test-created empty field. That cleanup confirmed every other setting matched the saved original before removing the empty list, retained a private backup and passed semantic equality.

The final production build `nJGZ4yXdKnzzTbdW3aAQb` passed an isolated health/login/authentication smoke check and was installed with dashboard-only restart and retained rollback. A staging-artifact name collision on the first activation attempt stopped before any service stop or live change; distinct final artifact names resolved it. Final deployment preservation checks passed again: authentication enforced (unauthenticated provider API 401), environment/unit unchanged, database inode unchanged, unrelated-service PIDs unchanged and both agent PIDs unchanged during deployment.

The repeated lifecycle used exactly the two additional approved inference requests: one fresh readiness probe and one installed-Hermes native SDK request. Reviewed Apply targeted only the default instance. Verify before that native request was `pending-traffic` with zero matching events, excluding the previous lifecycle's traffic. Native Hermes again returned `HERMES_QA_OK` using its configured default with zero tools and the reviewed identity forwarded by the native client. Final Verify was `protected-and-verified`: one matching event at `2026-10-05T01:12:30.631Z`, 643 tokens, after Apply at `2026-10-05T01:11:48.867Z`. The unchanged direct peer still had zero matching events and did not borrow that proof. There were no extra inference attempts or permitted transport retries.

Final reviewed Restore passed semantic equality with the saved original configuration, including absence of `custom_providers`; the original file mode and `.env` bytes were preserved. YAML formatting is not byte-identical, but every original setting value is equal. The peer Hermes configuration and environment, OpenClaw configuration/PID, other agent configurations, dashboard environment and proxy configuration fingerprints were unchanged. Only Hermes restarted after Apply and Restore and was active at completion. Dashboard health was `ok`, emergency bypass was inactive and the targeted browser workflow had no console errors. Default Hermes and OpenClaw remain direct as originally configured; the peer's pre-existing proposed routing selection remains unchanged. Private rollback/configuration backups and screenshots are retained outside git; no credential or private-host detail is included in this report.
