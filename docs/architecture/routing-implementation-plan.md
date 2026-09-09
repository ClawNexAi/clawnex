# Routing implementation plan and shared-screen wireframe

Date: 2026-09-08
Status: Source implementation delivered; see [implementation and verification](routing-implementation-progress.md). This document retains the approved plan and original findings. Installed deployment and operator acceptance remain separate gates.
Requirements: [approved routing recovery specification](routing-recovery-spec.md).

## Outcome and scope

Repair recovered v0.15.5 using existing code where sound. Deliver reliable preparation, approved wiring, attributable verification, safe restoration, and one understandable operator workflow for OpenClaw and Hermes. Favorites follows routing validation; other issues wait.

The work is complete only when both tool modules pass the same applicable behavioral contracts and the operator validates the shared interface. A clean build or successful configuration write is insufficient.

## Audit findings driving the plan

| Finding | Existing implementation | Required change |
|---|---|---|
| Green check is not proxy readiness | `config-service.ts:testProvider` fetches provider `/models` or gateway health | Reuse discovery test but distinguish it from an approved inference test through the intended LiteLLM alias |
| Apply can bypass prerequisites | `connector-routing-inventory.ts:applyOpenClawDesiredRouting` and `applyHermesDesiredRouting` write without a readiness gate | Server-enforced prepared plan tied to current configuration and provider readiness |
| Recovery record saved after configuration | Both apply paths write agent configuration before sidecar persistence | Durable journal before mutation; recover interrupted operations |
| Restoration has competing ownership semantics | Legacy OpenClaw restore differs from selective apply; Hermes guards endpoint but restores other fields | Unified restoration orchestration, field-level conflict checks, legacy ownership migration |
| Verification accepts wrong evidence | Source-prefix/model matching, moving snapshot baseline, no exact instance or successful-response requirement | Stable operation baseline and provenance-backed successful exchange |

These are static source findings. Fault-injection and live-agent tests still need to establish behavior. The recovered source differs from the installed build, so do not claim every finding has been reproduced on localhost.

## Shared module design

```text
Shared routing screen and authorized request handlers
                         |
                 Routing coordinator
      prepare / apply / verify / restore / inspect
              /                         \
      OpenClaw module                Hermes module
      config + restart               config + restart
              \                         /
       Shared journal, readiness, audit, evidence contracts
```

The coordinator owns ordering, approvals, instance scoping, concurrency, recovery state, and operator-visible results. Tool modules own parsing, capability discovery, field-change proposals, supported configuration versions, and restart requirements. Existing observation collectors remain separate; their capabilities can be reported without pretending collection proves routing.

The interface includes error behavior and preconditions, not merely method names. Every operation addresses a stable tool instance; no global 'apply every known Hermes home' action. Two actual tool modules establish the seam; do not invent a community module runtime now.

Proposed caller operations:

| Operation | Contract |
|---|---|
| Inspect instance | Read configuration and operation status; no external configuration writes or new verification baseline |
| Prepare changes | Return affected fields/providers/models, exclusions, readiness, configuration fingerprint, restart impact, and approval plan ID; no wiring |
| Apply approved plan | Validate authorization, scope, fingerprint, readiness, and idempotency; journal then apply only approved changes |
| Verify operation | Evaluate attributable successful proxy evidence against this operation; no provider call unless explicitly approved |
| Prepare/apply restoration | Preview and restore still-owned fields through the same approval/journal machinery; preserve conflicts |

Reuse parsers, credential-preview redaction, capability classifications, supervisor detection, provider configuration, and fixture data. Replace competing workflow paths rather than layering a third implementation on top. Keep older entry points only as explicitly tested compatibility wrappers where necessary.

## Delivery sequence and gates

### 1. Establish a safe implementation baseline

Record source HEAD, dirty changes, installed build identity, and recovery artifacts without resetting the worktree. Map differences that affect routing, evidence, and the header hotfix. Use a separate test database and disposable tool configurations; do not point verification scripts at operator homes.

Gate: known source/build provenance and isolated tests. No deployment or downgrade during this step.

### 2. Make preparation, apply, and restoration safe

Start by writing failing contract tests for the audited failure cases. Extract shared coordination incrementally while preserving the tool parsers.

Provider preparation must validate credentials, the requested provider/model alias, protocol compatibility, loaded LiteLLM configuration, and the proxy path before allowing agent writes. The existing `/models` test remains useful discovery evidence, but must not stand in for successful inference. Readiness expires when relevant configuration changes. Any external/cost-bearing probe requires explicit consent and uses harmless test content.

Plans are immutable, instance-scoped, and bound to configuration fingerprints. Acquire an instance lock and recheck file state immediately before writing. Reject stale approvals. Repeated submissions use an idempotency key. Locks do not control external editors, so compare the current file against the reviewed state and report races rather than promising absolute exclusion.

Persist and flush the recovery journal before the first configuration write. Record old/new owned field state, intent, progress, and outcome with restricted permissions. Use same-directory atomic file replacement, preserve necessary file metadata, and explicitly handle symlinks and permissions. Multi-file operations are not a single filesystem transaction: journal each step and compensate only changes still owned when safe. Otherwise stop with a recoverable partial state.

Never place plaintext credentials in the journal, logs, previews, or reports. If a field embeds a secret, preserve it through an existing secure reference mechanism or classify the operation unsupported pending a secure restoration design; do not silently redact away information required for recovery.

Restoration compares every affected field, not just the endpoint. Preserve later operator edits to endpoint, credential reference, protocol mode, defaults, and bridge entries. Retain unresolved ownership records. Detect corrupt/missing journals distinctly from 'nothing was ever wired'. Never remove a proxy bridge still referenced by preserved configuration.

Inspect both legacy and selective OpenClaw ownership formats. Offer one restoration preview spanning applicable records, but do not merge ownership blindly or delete edited entries under legacy 'set' semantics. Deselecting a proposed route is not implicit permission to restore an already-active route.

Gate: both modules pass readiness, stale-plan, double-submit, write-failure, interruption, operator-edit, corrupt-journal, legacy-ownership, and restore round-trip tests. No unapproved restart. Necessary interruption and restart scope must appear in the approved plan.

### 3. Make verification and failure policy truthful

Use the successful apply operation and its configuration fingerprint as the stable verification baseline. Routine reads and unchanged refreshes must not move that baseline. Historical evidence remains available but is stale for changed routes.

Bind proxy evidence to instance, provider route, model alias, request ID, operation, and successful completion. Determine the mechanism from each supported tool: instance-specific proxy credentials or another server-validated identity mapping may be appropriate. Do not trust arbitrary client metadata or infer tool identity solely from a model name. Do not claim attribution until this mechanism is proven with two instances using the same model.

Verification must reject watcher-only records, errors, blocked requests without provider completion, another instance's traffic, and evidence predating the applied configuration. Count provider routes consistently; model rows do not create duplicate coverage denominators. If only some models have been exercised, disclose that limitation rather than claiming every model was tested.

A supervisor restart command returning success is not readiness. Wait for an appropriate bounded readiness signal or retain 'restart requested / verification pending'. Where automatic agent-origin tests are unavailable, show a harmless instruction for the operator to send through that agent and then correlate its evidence. Do not invent unsupported agent-control commands.

Preserve blocking/observe controls and break-glass. Implement or reconcile authorized fail-open/fail-closed selection with actual proxy behavior. Explicitly distinguish scanner outage from stopped proxy transport; this phase adds no automatic direct fallback or offline recovery utility.

Gate: identical-model cross-instance tests, watcher/error exclusions, refresh stability, partial coverage, protocol/alias mappings, and policy-mode tests pass. Demonstrate a successful benign request from each real tool in an approved test environment.

### 4. Replace the confusing interface with the shared screen

Use one reusable routing screen driven by the shared operation state and tool module capabilities. Replace duplicate legacy/selective normal-path controls. Reuse existing provider setup, evidence navigation, dialogs, audit presentation, and break-glass access.

Keep prerequisites visible, one primary next action, a consistent shared command row, provider-level scope, and expandable model/technical detail. State exclusions and conflicts in plain language. Global notices should deep-link to the affected instance and not repeat expanded warnings over that same screen.

Gate: keyboard operation, focus restoration, narrow/wide layouts, overlay visibility, consistent peer-action placement, and novice task walkthrough for both modules. Tool absence must not break the other module.

### 5. Integrated validation and deployment handoff

Run source checks plus isolated behavioral suites, then agreed live-agent scenarios for both tools. Record exact build identity and evidence, including restoration back to direct communication. Confirm preserved investigation features and the overlay repair. Review installed-build/source differences before any replacement.

Gate: operator accepts wiring, partial coverage, verification, and restore behavior on both tools. Deployment is a separate explicit action with backup and recovery instructions, not an automatic consequence of finishing the plan. Favorites resumes only afterward.

## Shared-screen wireframe

Low-fidelity layout proposal, not a screenshot or final visual design. Example counts and names below are illustrative, not current live measurements. Reuse the dashboard's typography, colors, and accessible controls; reserve warning color for actual attention items.

### A. Prepare: upstream is not ready

```text
┌ OpenClaw · Development VPS                         [Instance ▾] ┐
│ CONNECTION  Direct                 ENFORCEMENT  Blocking        │
│ Prepare → Review → Apply → Verify                              │
│                                                               │
│ Configure the upstream before changing OpenClaw.               │
│ OpenRouter needs a successful proxy connection test.           │
│ No agent configuration has changed.                           │
│                                                               │
│ [Configure provider]  [Refresh configuration]                   │
│ ▸ Providers and affected models                               │
│ ▸ Technical details                                           │
└───────────────────────────────────────────────────────────────┘
```

The enforcement label describes configured policy, not protection of currently direct routes. 'Configure provider' opens the existing provider facility scoped to the missing prerequisite.

### B. Review: eligible routes and exclusions

```text
┌ Hermes · Local                                     [Instance ▾]┐
│ CONNECTION  Ready to apply         ENFORCEMENT  Blocking        │
│ Prepare ✓ → Review → Apply → Verify                            │
│                                                               │
│ Connect 2 provider routes through ClawNex.                      │
│ 1 route will remain direct. No changes until you approve.      │
│                                                               │
│ INCLUDE  PROVIDER       AFFECTED MODELS         READINESS        │
│ [✓]      OpenRouter    ▸ 3 models              Tested           │
│ [✓]      Local models  ▸ 2 models              Tested           │
│ —        Session login  1 model                Not supported    │
│                                                               │
│ Excluded: session-login routing cannot be changed safely.      │
│ Impact: gateway restart required; active work may interrupt.   │
│                                                               │
│ [Review and apply…]  [Refresh configuration]                    │
│ ▸ Exact configuration changes                                 │
│ ▸ Technical details                                           │
└───────────────────────────────────────────────────────────────┘
```

Confirmation shows instance, affected endpoints/models, exclusions, restart impact, readiness freshness, and explicit approval. Existing managed instances also expose 'Restore direct connection…' in the same command row. No per-model checkbox where enforcement is provider-wide.

### C. Applied: waiting for agent evidence

```text
┌ OpenClaw · Development VPS                         [Instance ▾]┐
│ CONNECTION  Verification pending   ENFORCEMENT  Blocking        │
│ Prepare ✓ → Review ✓ → Apply ✓ → Verify                        │
│                                                               │
│ Configuration applied. Waiting for a successful agent request. │
│ Send the displayed harmless prompt from this OpenClaw instance.│
│ [Copy test prompt]                                             │
│                                                               │
│ [Check verification]  [Refresh configuration]                   │
│ [Restore direct connection…]                                   │
│ ▸ Request evidence                                            │
│ ▸ Technical details                                           │
└───────────────────────────────────────────────────────────────┘
```

The three command buttons above are one wrapping flex row, not separate desktop rows. The copy control belongs to the test instruction, not the command row. Copying or checking evidence does not initiate a paid provider request. If the tool supports automated testing, expose it only with explicit traffic/cost consent.

### D. Verified partial coverage and restoration

```text
┌ Hermes · Local                                     [Instance ▾]┐
│ CONNECTION  Verified: 2 routes      ENFORCEMENT  Blocking        │
│ COVERAGE    Partial: 1 route remains direct                     │
│                                                               │
│ Latest successful exchange: 12:04 UTC  [View evidence]          │
│ ▸ Provider coverage and tested models                          │
│                                                               │
│ [Review connection changes]  [Check verification]               │
│ [Restore direct connection…]                                   │
│ ▸ Technical details                                           │
└───────────────────────────────────────────────────────────────┘
```

Again, peer commands share one wrapping row. With bypass active, display 'Bypassed: inspection disabled' prominently and retain existing audited bypass management; do not display 'protected'.

Restoration dialog:

```text
Restore direct connection — Hermes · Local

OpenRouter: restore its previous direct endpoint.
Local models: endpoint edited outside ClawNex; leave unchanged.

1 route can be restored. 1 conflict needs your review.
Unrelated settings and later operator edits will be preserved.
Restart impact: displayed here when required.

[Cancel]                         [Restore eligible route]
```

Afterward, report restored routes and unresolved conflicts separately. Never show a blanket success banner for partial restoration. If no field is safe to restore, the primary action becomes reviewing the conflict, not a misleading restore confirmation.

## Review target

Approve the layout and operator language before frontend implementation. The next coding step, once authorized, is isolated failing tests for readiness and restoration—not a live configuration change. Exact module filenames and types can be finalized during that extraction without changing this operator contract.
