# Issue #25 — local Hermes ingestion recovery, October 5, 2026

Verification status: scoped local changes on `cb66938`, recorded before source delivery; #25 remains open and QA deployment/acceptance is pending. Current commit/push status is tracked separately in the maintained PBS_Code progress summary. Existing normalized ingestion was already present in committed dev through earlier curated/investigation changes. The historical `c0cef0b` branch commit is not an ancestor of the verification base; it was not blindly cherry-picked or counted as a newly merged delivery.

## What now works

Hermes ingestion commits a message's traffic, normalized event, applicable audit/incident evidence and cursor in one SQLite transaction. Critical write/scan failures propagate to that transaction instead of being swallowed while advancing the cursor. Failure rolls back partial rows and scan counters, stops the batch at the failed record and leaves the last committed in-memory cursor intact. The next poll can retry the same record. An audit backlink must exist before its incident is allowed to commit, because the general audit logger is otherwise best-effort.

Synchronous traffic/alert broadcasts are buffered until commit, including nested alert transactions. They are discarded on rollback; publication outside this opt-in buffer keeps its previous immediate behavior. The in-memory correlation engine receives the event only after a successful commit, so a failed cursor write cannot contaminate its window. This is not a new durable correlation outbox or an exactly-once guarantee across a process crash after commit.

The collector uses a left join: a user/assistant message without a matching session is retained with unknown model/channel metadata rather than silently disappearing. Malformed non-text content pauses ingestion with an explicit log/current error. Missing tokens, costs and latency remain unknown; watcher rows retain `blocked=0` because retrospective inspection cannot enforce an earlier request. Existing content-capture, policy, whitelist, evidence encryption, permissions and OpenClaw ingestion paths are unchanged.

Initialization distinguishes a missing cursor from a failed/corrupt cursor read. It does not replace failed reads with the newest observed message ID or advertise a baseline whose cursor write failed. Polling retries initialization and restores the committed cursor before collecting. Failed Hermes database opens are not cached forever; a restored source can reopen read-only and continue without replaying successful history.

Current sanitized `lastError` is exposed by watcher status and detailed health. Infrastructure marks a failed collector degraded and reports the actual committed cursor, this-process committed scans and cumulative errors—not the newest merely observed Hermes message ID. A successful retried event clears the current error; error counts remain historical. The source home/profile/channel scheme is retained; this is not a new multi-home/profile-switch ingestion implementation.

## RED → GREEN evidence

| Public boundary | Reproduced failure / verified local result |
| --- | --- |
| Normalized-event store outage | Before, failed message 2 advanced cursor from 1 to 2. Now traffic/event writes and SSE are absent, cursor stays 1, retry ingests once, and restart/repeated polls keep one record. |
| Missing joined session metadata | Before, message 3 produced no traffic. Now it is ingested with null model, `hermes:unknown` channel and its original session ID. |
| Current failure / Infrastructure | Before, watcher had no current error and Infrastructure showed activity rather than ingestion failure. Now its public response is degraded, exposes sanitized failure and the committed cursor. |
| Cursor commit / correlation window | Failed cursor writes roll back traffic, normalized events, audit/alerts and publication. A separate RED assertion found one in-memory correlation event from a rolled-back record; post-commit correlation now keeps the failed window unchanged. |
| Audit evidence outage | Before, the cursor advanced to 8 even though audit storage had failed. Now it stays 7, leaves no new traffic/backlink, retries after recovery, and the public alert evidence endpoint resolves the recovered incident. |
| Cursor read/corruption | Before, failed reads initialized from current max 9, and a malformed cursor was silently replaced with max 10. Now initialization fails visibly, does not skip new events, and resumes from the repaired saved cursor. |
| Source availability | Before, a missing source returned silently. Now it is disclosed; restoration reopens the source and reaches message 10 without replaying prior events. |
| Malformed row/schema | Non-text content and a renamed required session column pause at the committed cursor. Repairing the temporary source resumes without duplicates; neither failure is hidden as healthy activity. |

The new `verify-hermes-ingestion-recovery.ts` fixture uses actual public polling/status functions, SQLite, SSE subscription, Infrastructure, Traffic and alert-evidence routes. It creates one temporary fake source under the user's home for existing path-policy compatibility, a memory ClawNex database, intercepted HTTP and an ephemeral fake WebSocket server. It starts no installed agent, gateway or dashboard and performs no inference. The fake socket refuses authentication; timers/connections, SQLite handles, subscriber and its test directory are cleaned up. The CI workflow now invokes its new `verify:hermes-ingestion-recovery` package command after provider onboarding; CI itself was not run remotely.

## Test setup correction (not concealed)

An early Infrastructure fixture used a system temporary path rejected by the existing Hermes home policy and inherited the default local OpenClaw socket address. Its lazy status getter attempted connections to the already-running local gateway; authentication was refused. The test's exact processes were terminated, and later checks proved none remained. The fixture was moved to its own temporary home-contained directory and explicitly wired to a fake socket before imports. An initial fake-close teardown race and lingering connection timer were corrected with a nonce-less fake challenge/refusal and awaited close. No gateway process was started/restarted, no authenticated RPC/inference succeeded, and QA was untouched. These attempts are not counted as a real OpenClaw or Hermes acceptance test.

## Checks and reproduction

```sh
rtk proxy npm run verify:hermes-ingestion-recovery
rtk proxy node node_modules/tsx/dist/cli.mjs scripts/verify-hermes-integration.ts
rtk proxy node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The recovery matrix, prior Hermes integration/path guards/cost adapter (18 checks), OpenClaw cost adapter (27 checks), evidence deep-link fixture (40 checks), investigation workbench, provider onboarding/inference, signed routing ingestion evidence and native/AnythingLLM/OpenCode routing regressions pass locally. TypeScript passes. Final combined #34/#35/#25 production build `0AHcLBss21I5TuvpaiRpA` passes with RBAC enabled, memory DB, absent agent homes and postbuild hygiene. All 27 scoped source/test/workflow files match the built archive byte-for-byte: [SHA-256 source manifest](issue-34-35-25-source-manifest.json). Build work is in an inactive isolated archive stage, not product or QA `.next`. The pre-existing Next middleware deprecation warning remains.

## Remaining acceptance/delivery

A new real Hermes conversation → Traffic Monitor → incident/investigation browser run has not been authorized or performed on this revision. The issue's old real local conversation evidence remains historical, not fresh acceptance of these changes. The local verification phase performed no paid request, live Hermes configuration change/restart, QA deployment, commit/push, GitHub comment or issue closure. Source commit/push was subsequently authorized; it does not authorize those other actions. Existing OpenClaw collector source was not edited; focused regressions are not whole-repository certification. Multi-home identity/filtering, profile switching and a durable post-commit correlation outbox were not newly implemented or certified. These limits stay explicit until separately scoped/accepted.
