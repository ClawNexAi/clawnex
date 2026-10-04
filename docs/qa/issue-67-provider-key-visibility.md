# Provider key visibility (#67)

Show/Hide applies only to newly typed create/replacement keys. Saved keys are never fetched for reveal. Both forms start hidden; cancellation clears the unsaved key, and changing the edited provider clears its replacement field. The native visibility button exposes `aria-pressed` and `aria-controls`, and never submits the form.

## Local verification

1. Run `npm run verify:provider-key-input`, `npm run verify:tooltip-layout`, and `npx tsx scripts/verify-provider-save-sync.ts`. The API test uses a memory database and temporary YAML, exercising real POST/GET/PATCH responses and checking routine logs for fake credential leakage.
2. Open your own test browser tab and note its ID: `browse newtab about:blank --json`.
3. Run `node scripts/provider-key-browser-fixture.mjs <tab-id>`. It bundles the real Configuration panel with fake providers and a fake fetch boundary; no live database, credentials, or service is used. The command prints the HTML and generated flow paths.
4. Run `browse chain < <printed-flow-path>`. Require every assertion to pass and inspect output for `ERROR`: some installed browser versions continue a chain after failures. The flow verifies default masking, Show/Hide value preservation, Enter activation, independent create/edit state, cancellation, provider switching, zero provider submissions, and equal TIPS on/off widths at 1440px and 1024px. Read the generated screenshot.
5. Close only your test tab: `browse closetab <tab-id>`.

Local browser acceptance passed on 2026-10-04 with no console errors. The key-input width was 1197px in both TIPS states at 1440px, and 781px in both states at 1024px in this standalone panel fixture. No key/toggle overlap was observed.

Deployment and authenticated QA acceptance remain required before issue closure. No stored-secret reveal endpoint or permission changes were introduced.
