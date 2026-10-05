# Issue #35 — local tested provider catalog, October 5, 2026

Verification status: scoped local implementation and checks on base `cb66938`, recorded before source delivery. #35 remains open; QA deployment/acceptance is pending. At verification, QA still ran the separately operator-accepted #31/#32 build `n83z_JIiILM2yFKm8sm7n`. Current commit/push status is tracked separately in the maintained PBS_Code progress summary.

## What now works

The shared browser-safe `src/lib/provider-catalog.ts` enables LM Studio, OpenAI Compatible, OpenRouter and NVIDIA NIM. It owns their labels, default URLs, discovery paths, authentication requirements and LiteLLM prefixes. The dashboard shows the twelve other previously advertised families as disabled with “adapter not tested” guidance. An explicit OpenAI-compatible endpoint remains an operator choice; disabling a native family does not certify that family's native protocol, SDK or authentication.

New unsupported/unknown/malformed provider types are rejected at the common creation boundary before endpoint validation, database writes or YAML sync. The API returns HTTP 400 and `unsupported-provider-type`, without echoing credentials. Unsupported legacy provider discovery and readiness are also refused before HTTP. Legacy records remain listable/editable, retain their type and credential, and existing YAML adapter behavior is preserved: there is no automatic migration or deletion. Legacy adapter rendering is compatibility, not tested onboarding or fresh readiness certification; those families need a separately validated adapter before the new readiness gate permits them.

Model discovery validates an array of non-empty exact string IDs and deduplicates it. Malformed catalogs return a sanitized model-catalog error, not “connected” or raw upstream data. NVIDIA discovery refuses a missing required credential before any request. OpenRouter's separate credential check and existing normalization/pinned choices remain unchanged. Discovery does not select models, reload LiteLLM or establish inference readiness.

Configured alias qualification uses the tested adapter prefix rather than assuming the provider type equals the prefix. This permits a uniquely scoped `openai/chosen-model` alias for an OpenAI-compatible provider while retaining exact/ambiguous/unrelated endpoint safeguards. There is no arbitrary proxy-alias/upstream-ID schema migration in this change.

## Test-first/public-boundary evidence

| RED observation | GREEN result |
| --- | --- |
| Unsupported native provider creation returned 201 rather than the requested 400. | Twelve disabled families, unknown/fuzzy names and a numeric type return 400; provider table and working YAML are unchanged. |
| Legacy native discovery returned 200 and sent a request. | Discovery and approved inference return 400 with zero requests; legacy row/editability and response redaction remain intact. |
| Object-valued model IDs were accepted as connected. | Invalid catalog is reported without its fake sensitive payload. |
| NVIDIA without a key was reported connected by a permissive fake server. | Authentication error occurs before HTTP. |
| Native-agent fixture using the tested OpenAI-compatible family could not resolve its qualified alias. | Shared adapter-prefix qualification passes Pi, Codex and Claude lifecycle, ambiguous endpoint and unrelated endpoint contracts. |

`verify-provider-onboarding-contract.ts` exercises the real POST/PATCH/test/model routes, memory database, temporary YAML and fake provider/proxy HTTP. Every enabled catalog entry must have an add → discover → selected model/YAML → loaded-model identity → approved completion case. This is simulated completion evidence, not four new live provider requests.

The existing SSRF, save/sync, native-agent and AnythingLLM fixtures previously created new providers with the disabled `openai`/`anthropic` labels. Their fake OpenAI-compatible endpoints now use that tested family; their endpoint-policy, partial-sync, credential, stale-plan, identity and Restore assertions remain. The SSRF fixture also disables normal seed reading. Legacy adapter rendering is independently retained in the existing YAML fixture. No security allowlist, private-address policy, approval requirement or scanner policy was relaxed.

## Verification

| Check | Result |
| --- | --- |
| Real Configuration picker/browser | PASS: four selectable families, twelve disabled families, four URL defaults, no writes/browser exceptions. |
| Provider onboarding, save/sync, inference API | PASS. |
| SSRF write/read regression | 22 passed, zero failed. |
| Proxy readiness, YAML safety/sync, post-deploy rehydrate | PASS; rehydrate has 58 assertions. |
| Shared routing contracts | PASS: OpenClaw-only, Hermes-only and Hermes-multi. A mistyped `two-instance` test argument was rejected by the harness; the correct `hermes-multi` case passed. |
| Hermes recovery, native Pi/Codex/Claude, OpenCode, AnythingLLM | PASS. AnythingLLM uses a temporary fake local HTTP server, not a real agent/service instance. |
| Provider key control regression and TypeScript | PASS. |
| Isolated RBAC-enabled production build | PASS: `qoPNQFMVM3Xb5umIJyvfB`, HEAD archive plus #34/#35 production source, memory DB, absent agent homes. |

Browser reproduction uses the already installed Playwright package, with no application listener or dependency changes:

```sh
rtk proxy node node_modules/tsx/dist/cli.mjs scripts/verify-provider-onboarding-contract.ts
rtk proxy env CLAWNEX_PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs node scripts/verify-provider-catalog-browser.mjs
```

[Rendered picker screenshot](issue-35-browser-evidence/provider-catalog.png) uses fake data. The browser always closes in `finally`.

## Remaining gates

Live QA of the new picker/API and fresh inference for every enabled adapter were not performed. Historical operator evidence is not re-labeled as fresh coverage. Source commit/push was subsequently authorized; dashboard deployment/reload if needed, paid upstream requests, acceptance publication and closure require their separate applicable approvals. Existing aliases/legacy rows were not migrated, and the broader upstream-ID versus arbitrary proxy-alias schema remains a separate unresolved design concern. No duplicate dashboard, gateway or installed connector instance was launched; the inactive local build is not a running application.
