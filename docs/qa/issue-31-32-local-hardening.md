# Issues 31 and 32: local routing hardening, 2026-10-05

Status: local implementation and isolated regression evidence verified; the operator subsequently approved committing and pushing the five scoped files to `dev` on October 5. Tested base: `75393a86ce62b8c73e0fdb6f6092f638953c7c04`. The resulting delivery commit is recorded in the PBS_Code progress summary. No QA deployment or fresh real-agent acceptance is claimed. Issues #31 and #32 remain open.[39][38] Issue #33 was already accepted and closed; this queue performed its regression checks rather than reopening it.[37]

## Scope and authority

The operator requested #31, then #32, then #33 within a two-hour window. Implementation and testing used the previously agreed local-only public routing boundary: real routing/readiness/ingest handlers, temporary agent configurations, isolated databases and fake external services. That test phase performed no new live QA configuration changes, paid inference, service restarts, deployment, commits, pushes, GitHub edits or issue closures. The subsequent “commit and push to dev” approval authorizes only delivery of these scoped changes and this evidence document; QA deployment, paid inference and issue closure remain separately gated.

The existing coordinator, module registry, parsers, ownership/recovery helpers, callback and collector boundaries remain in place. No dependency, schema migration, new connector or additional routing engine was introduced. Existing unrelated worktree changes were preserved.

## Test-first defects repaired

Each defect failed on both OpenClaw and Hermes before its repair. As a final counter-check, the new public fixture was copied into a disposable archive of unchanged `75393a8`, without copying modified production code: all 14 defect runs failed at the intended assertion. The corresponding runs pass with the local changes.

| Issue / scenario | Unchanged production behavior | Local repaired behavior |
| --- | --- | --- |
| #31 `selection-during-validation` | Apply returned 200 after a selection was withdrawn during asynchronous loaded-deployment validation. | Rechecks selections, files and ownership after readiness; returns 400 before agent or journal writes. |
| #31 `approval-expiry-during-validation` | Apply returned 200 after the reviewed plan expired during readiness. | Rechecks expiry immediately before claiming the write; returns 400 without mutation. |
| #31 `missing-recovery` | Restore returned 200/no-op while the instance still pointed at ClawNex after its recovery journal disappeared. | Verifies the resulting scoped inventory; returns 409/incomplete, preserves settings and retained backups, and never guesses original fields. |
| #32 `cross-route-identity` | Model B's completion with route A's valid identity made the instance fully verified. | Evidence must match a single `(model alias, current route identity)` tuple; wrong combinations are excluded from coverage and accounting. |
| #32 `retired-ownership-evidence` | A completion bearing the old identity still verified the instance after ownership disappeared. | Requires current intact ownership; remains pending with zero qualifying events. Recovery guidance replaces misleading instructions to send more traffic. |
| #32 `shared-model-routes` | One provider's completion verified two independent provider routes sharing an alias. | Coverage and reconciliation-event promotion remain route-specific; the peer stays pending until its own identity completes. |
| #32 `model-change-after-apply` | Adding an eligible model after Apply, then observing it with an intact identity, produced full verification without a new review. | Compares current normalized routing state with the immutable source-specific snapshot captured by successful reviewed Apply. A new/changed model needs readiness and reviewed Apply, then fresh proof. Restore preserves the operator-added model. |

The approval snapshot is explicitly scoped to the selected source. An inventory refresh may include multiple Hermes sources; the operation must not reference the first or an empty generic snapshot. Ordinary refreshes never replace the operation's approval snapshot or evidence-time baseline.

Normalized routing state includes stable instance/provider/model identity, endpoint, alias, identity fingerprint, route choice, capability and presence. It excludes provider secrets and unrelated observed timestamps. Verification is evidence for the reviewed routing scope, not a claim about every setting in an agent file or every untested model.

## Additional public contracts

The public fixture also proves retained locks are not removed to force a write; corrupt journals are not treated as unwired state or overwritten; atomic configuration-publication failure leaves the original file and a restricted 0600 recovery journal; and a failed plan cannot be blindly replayed. Conflicting operator endpoint edits survive Restore and unresolved ownership is retained.

Verification rejects an unauthorized callback (401). Authenticated but wrong-instance, inbound, failed, blocked, bypassed, error-bearing, unsigned or watcher-only records do not prove successful routing. A valid completion after those negatives verifies only its own route. Missing cost telemetry is not converted into free inference.

Unchanged GET/sync/repeated Verify preserves the baseline and valid evidence. A later explicit Apply establishes a new time boundary: historical completions are excluded until a new qualifying completion arrives. A newly reviewed model's Restore preserves the operator addition while restoring owned connection fields.

The five #33 public modes pass again: OpenClaw-only, Hermes-only, two Hermes instances sharing a model, Hermes primary without a provider-list field, and Hermes primary with a pre-existing empty list. They retain independent selections, files, journals and proof; support approval/replay/Restore; and refuse unknown remote targets, unsupported layouts and unsupported protocols. The missing-recovery test also passes in both primary-model container modes.

## Reproduction commands

Run from the product repository. `node --import tsx` avoids the sandbox's `tsx` CLI IPC restriction. Each case uses a fresh process and fixture-only data.

```sh
for mode in openclaw-only hermes-only hermes-multi hermes-primary hermes-primary-empty; do
  rtk proxy node --import tsx scripts/verify-routing-module-contract.ts "$mode"
done

for mode in openclaw-only hermes-only; do
  for scenario in selection-during-validation approval-expiry-during-validation retained-operation-lock corrupt-ownership publish-failure missing-recovery restore-conflict cross-route-identity retired-ownership-evidence shared-model-routes invalid-completions refresh-and-historical-evidence model-change-after-apply; do
    rtk proxy node --import tsx scripts/verify-routing-module-contract.ts "$mode" "$scenario"
  done
done

rtk proxy node --import tsx scripts/verify-routing-module-contract.ts hermes-primary missing-recovery
rtk proxy node --import tsx scripts/verify-routing-module-contract.ts hermes-primary-empty missing-recovery
```

Result: 33/33 public contract runs pass (five standard modes, 26 normal-module scenario runs and two extra primary-mode recovery checks). The same-alias cases additionally check that the peer's unresolved reconciliation events are not promoted.

## Regression and build evidence

| Check | Local result |
| --- | --- |
| Routing evidence, reconciliation and authenticated-ingest fixtures | PASS; legacy synthetic evidence fixture now supplies current identity and its approved snapshot. |
| Provider credential/readiness and selected-proxy-model readiness fixtures | PASS; consent, loaded revision, invalidation, failure and timeout boundaries retained. |
| Connector inventory and assisted Hermes model registration fixture | PASS with public-host DNS validation allowed; original sandbox restriction resolved without code edits. |
| File transaction, legacy recovery, OpenClaw v2 recovery and Hermes recovery | PASS; write ordering, encrypted credentials, tamper/missing-key refusal, conflict preservation and round trips retained. |
| Native Pi/Codex/Claude shared routing and OpenCode routing fixtures | PASS; native protocols, stale-file checks, unique provider matching and Restore retained. |
| OpenClaw cost adapter and Hermes watcher/integration fixture | PASS; 27 OpenClaw checks and read-only Hermes ingestion assertions. Hermes fixture home was redirected to a task-created temporary directory. |
| Mission Control existing navigation audit | PASS; 20/20 click-target checks. |
| Python logger evidence and installed native LiteLLM proxy fixtures | PASS; three tools/two instances sharing one alias, streaming, identity stripping, native Messages/Responses blocking, scanner failure and manual bypass behavior. |
| TypeScript and scoped diff whitespace | PASS. |
| Isolated production build | PASS with RBAC enabled, memory database and absent fixture agent homes. Built in a temporary HEAD archive plus only the four scoped changed code/test files; the installed dashboard and repository `.next` were not replaced. |

The native LiteLLM fixture required sandbox permission to bind disposable loopback ports. It used the installed SDK/proxy executable but only temporary config, fake credentials, local scanner and local upstream; no real agent lifecycle or paid provider call. OpenCode and connector-inventory fixtures required public-host DNS resolution for provider-endpoint validation. These permissions did not extend to deployment, paid inference or live-agent mutation.

The first sandboxed connector-inventory run failed at `scripts/verify-connector-routing-inventory.ts:158`, “Readable Hermes credentials can configure a model in ClawNex.” The same restriction reproduced the assertion in an untouched `75393a8` archive. After allowing public-host DNS validation, the complete fixture passes on both unchanged production and this change. No fixture, endpoint-validation policy or production inventory/registration implementation was edited to force the pass. This was a sandbox environment limitation, not a code regression. There is no claim of blanket repository, browser, Linux or current QA acceptance.

## Files and delivery gate

The implementation changes are limited to `src/lib/services/routing-workflow.ts` and `src/lib/services/routing-reconciliation.ts`; fixtures are `scripts/verify-routing-module-contract.ts` and `scripts/verify-routing-evidence.ts`. This document is the fifth scoped delivery file. The PBS_Code progress summary records the resulting commit and keeps source delivery separate from QA acceptance and production promotion.

Older Apply operations whose stored snapshot is absent or not bound to the selected instance will remain pending under the stricter verifier. A fresh reviewed Apply and fresh attributable completion are required; routine refresh or Restart cannot retroactively approve a configuration. No such live re-Apply was performed in this local-only queue.

Next gate after the approved commit/push: obtain narrowly scoped QA deployment/lifecycle authority, then repeat fresh real OpenClaw and Hermes Apply/Verify/Restore with preserved original settings and bounded approved requests. Prior #19/#33 acceptance supports the unchanged architecture but does not certify the new verifier changes on QA. Publication and #31/#32 closure remain separately authorized.[39][38]

## Sources

[37] https://github.com/ClawNexAi/clawnex/issues/33
[38] https://github.com/ClawNexAi/clawnex/issues/32
[39] https://github.com/ClawNexAi/clawnex/issues/31
