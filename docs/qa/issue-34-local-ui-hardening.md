# Issue #34 — local shared routing UI hardening, October 5, 2026

Verification status: scoped local implementation/tests/build pass on base `cb66938`, recorded before source delivery. #34 remains open; QA deployment/acceptance is pending. The operator accepted #31/#32 separately; that does not accept these subsequent UI edits. Current commit/push status is tracked separately in the maintained PBS_Code progress summary.

## Changes and test-first evidence

| Boundary | Before | Local result |
| --- | --- | --- |
| Unreadable configuration | A real rendered panel with an error summary/empty inventory said Direct connection. | Says Configuration unavailable with recovery guidance; state-dependent commands/route selection are disabled. Read-only summaries are disclosed separately. |
| Failed inventory refresh after Verify | A simulated 503 surfaced an error but left cached Routed models verified visible. | Removes stale inventory/proof from the UI, surfaces the read failure and offers Retry reading configuration. |
| Defensive cached-proof scope | A fake API response changing route/identity while retaining its fingerprint could preserve the old proof label. | Cache key also includes selected instance, route, capability and current identity ownership/intactness. Unchanged refresh preserves proof. |

Each corresponding browser assertion failed before its local change and passed afterward. The third row is defensive HTTP-boundary hardening, not a demonstrated production inventory-fingerprint bug: normal `persistDiscovery` already hashes current route, capability and metadata into each fingerprint. The adversarial fake-response cases intentionally retain that old digest. No server fingerprint, approval baseline, evidence collector or routing policy implementation was changed.

The older static OpenClaw-action fixture matched an exact disabled expression and initially failed solely because the new unavailable guard changed that source text. Its pattern now permits that guard while still excluding a routed-provider-count gate. The real browser workflow separately proves restart is enabled after restoring the final routed provider; the static fixture was not used as a substitute for public behavior.

## Public component-browser matrix

`scripts/verify-routing-ui-browser.mjs` bundles the real routing component and shared facilities with installed esbuild, then runs installed Chromium/Playwright against intercepted HTTP and fake API responses. It opens no app server, socket listener, installed agent, live provider or duplicate dashboard. Every browser closes in `finally`; no dependency was installed or changed.

20/20 scenario runs pass: ten cases for each of OpenClaw and Hermes, at 1440×1000, 768×1000 and 375×1000. The cases are unavailable/empty, unavailable with stale rows, read-only, changed route, changed identity, failed refresh, unchanged refresh, reviewed Apply/pending/verified/Restore, missing prerequisites and incomplete/conflicting Restore. Each run checks visible-control bounds and browser errors; commands are asserted against the selected connector/instance and explicit approved plan. Peer actions remain in one shared wrapping command row, and an absent peer has no phantom controls.

The full workflow begins keyboard focus on Cancel, keeps Tab inside review, returns focus to the originating action on Escape, performs no execution on cancellation, requires explicit Apply, shows pending before the fake completion, verifies after it, then restores Direct connection. A conflicting Restore does not claim direct/success. Fake API responses here test UI behavior, not backend write/attribution correctness; the separately accepted #31/#32 contracts supply that layer.

Reproduce using an already-installed Playwright module; no new dependency is required by the source delivery:

```sh
rtk proxy env CLAWNEX_PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs node scripts/verify-routing-ui-browser.mjs workflow openclaw
rtk proxy env CLAWNEX_PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs node scripts/verify-routing-ui-browser.mjs workflow hermes
```

Run each tool with scenarios `unavailable`, `unavailable-with-rows`, `read-only`, `route-change`, `identity-change`, `refresh-error`, `stable-refresh`, `workflow`, `prerequisites` and `restore-conflict`. Without the override, the script resolves a normally installed `playwright` package.

## Build and regression

- TypeScript `--noEmit --incremental false`: PASS.
- Existing OpenClaw routing actions, provider-label and coding-agent visibility fixtures: PASS.
- Scoped diff whitespace: PASS.
- Isolated RBAC-enabled production build: PASS, build `Ae4Xj7aaRiKIBoduxD5RL`, memory database and absent OpenClaw/Hermes/Pi homes, tracked HEAD archive plus the changed component only.

The built component and local component both hash to `43b54be350476d1ed47e10fac6aa9c176672444b46c98eaadfebc11b6618fd18`. Product/installed `.next`, live database, QA runtime, gateway settings and other user edits were not replaced. Build output retains the pre-existing middleware deprecation warning; no Next.js upgrade was performed.

Before/after screenshots use synthetic fixture data:

- [Unavailable before](issue-34-browser-evidence/unavailable-before.png) / [after](issue-34-browser-evidence/unavailable-after.png).
- [Adversarial route response before](issue-34-browser-evidence/route-change-before.png) / [after](issue-34-browser-evidence/route-change-after.png).
- [Failed refresh before](issue-34-browser-evidence/refresh-error-before.png) / [after](issue-34-browser-evidence/refresh-error-after.png).
- [Hermes controls at 375px](issue-34-browser-evidence/hermes-375.png).

## Remaining delivery/acceptance

This is real rendered component evidence, not fresh full-dashboard/global-overlay/CSP or cross-device browser certification. Surrounding shell mobile limits and earlier CSP findings are not silently cleared. The existing separate policy notice was preserved; component routing status does not independently certify the current enforcement mode. No real inference/agent restart was run, and the fake pending/verified responses are not live routing evidence.

Changed source is the shared `RoutingWorkflowPanel.tsx`; fixture maintenance is `verify-openclaw-routing-actions.ts`; the new browser script and this note/screenshots are scoped source-delivery artifacts. Source commit/push was subsequently authorized; any further QA deployment/full-shell acceptance and GitHub publication/closure remain separately gated. At verification, QA continued running accepted operator build `n83z_JIiILM2yFKm8sm7n` from `cb66938`, not this temporary local build.
