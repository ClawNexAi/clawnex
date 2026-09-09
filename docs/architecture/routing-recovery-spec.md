# OpenClaw and Hermes routing recovery specification

Date: 2026-09-08
Status: Requirements and shared interaction approved by the operator. Repair order approved after read-only audit. Detailed implementation plan and wireframe remain review artifacts, not deployment authorization.

Companion: [implementation plan and shared-screen wireframe](routing-implementation-plan.md).

## Purpose

Make the existing connection, protection, observation, and safe-disconnection facilities reliable and understandable. This is not a new routing feature built alongside the current one. Replace or improve the existing workflow, preserving useful capabilities and existing evidence surfaces.

Completion requires both functional reliability and a simplified operator interface. They may be implemented separately but must be validated together. A prettier interface alone is insufficient; reliable backend operations behind an incomprehensible interface are also insufficient.

## Evidence and limits

- Operator interview, rounds 1–3, and the final interface qualifier establish the requirements below.
- Supplied OpenClaw and Hermes screenshots show repeated warnings, mixed provider/model rows, technical drift messages, numerous peer controls, and inconsistent action naming/numbering.
- The earlier read-only local dashboard tour covered Configuration, Fleet, Agents, Traffic Monitor, Token & Cost Intel, Tools & Access, and Prompt Shield. This was not functional certification.
- References: [existing routing contract](routing-reconciliation-contract.md), [public HLD](../26-public-high-level-architecture.md), [public LLD](../27-public-low-level-architecture.md), and [basic manual](../06-basic-user-manual.md).
- Local source and the installed v0.15.5 build differ. Version labels are not sufficient provenance. Neither existing documentation nor a green UI indicator alone proves implementation correctness.

## Agreed product boundary

ClawNex uses LiteLLM as its model-traffic proxy and inspection/enforcement integration. Tool-specific connectors and collectors supply additional agent, session, skills, permissions, workspace, token, and cost context. Proxy routing and context collection are complementary, not interchangeable.

OpenClaw and Hermes must offer equivalent operator outcomes wherever their capabilities permit, without requiring identical collection methods. Unsupported, unavailable, stale, and retrospective data must be distinguished from live or verified information. Do not fabricate parity or report missing data as measured zero.

Optional tool integrations are the direction: a Hermes-only installation should not require OpenClaw. Support multiple instances without conflating identity, traffic, configuration ownership, or restoration records. A general downloadable plugin system and additional tool integrations are not part of the immediate routing repair.

## Agreed functional requirements

### Prepare before wiring

Configure the upstream provider in ClawNex first, using the existing provider setup and test facility. Verify what that test actually checks. Only redirect the agent after the replacement path is ready. Preserve its intended provider/model choices; do not silently substitute a default model.

Avoid avoidable downtime. Identify, communicate, and obtain approval for unavoidable interruption before applying changes. Under one minute is an operator target, not a guaranteed bound. Restart only when the connector requires it, with the impact made explicit.

### Approve eligible routes

The default proposed scope is all eligible API-backed routes for the selected instance. Operator approval is required before initial wiring and subsequent wiring changes. Manual refresh/discovery is required; automatic detection is optional. Detection never grants permission to rewrite configuration.

Permit approved eligible routes while leaving unsupported routes untouched, with explicit exclusions and partial instance coverage. OAuth/session-bound routes unsupported by the current connector must not be silently rewritten or represented as protected. This is a connector capability limitation, not a claim that OAuth intrinsically makes all traffic uninspectable.

The current contract routes by provider endpoint. Do not offer apparently independent model switches if selecting one actually changes sibling models sharing that endpoint. The UI must state the true scope before approval.

### Verify the actual agent path

A successful wiring check requires an attributable request originating in the selected tool instance, passing through ClawNex's LiteLLM path, reaching the intended upstream, and returning a response. A request originating only inside ClawNex tests upstream readiness, not agent wiring.

Use existing traffic and investigation evidence views. An incident is not required for a benign successful request. Retrospective session records alone do not establish proxy traversal. Configuration saved and restart completed are intermediate states, not proof of traffic flow.

Display wiring verification separately from enforcement mode: blocking, observe-only, or bypassed. Do not label bypassed traffic protected. A stronger blocking/action test may follow later; it is not a prerequisite for the initial routing-verification definition. Obtain approval before tests with external traffic or cost.

### Preserve failure-policy controls

Default to fail-closed. An authorized installer/admin must be able to explicitly choose fail-open policy. Preserve the existing manual emergency bypass, confirmation, reason, expiry, and audit behavior; reconcile existing controls rather than creating competing mechanisms.

Distinguish scanner failure policy, observe/block mode, temporary bypass, and complete proxy outage. A bypass hook inside a stopped proxy cannot restore transport. Verify the installer/UI exposure of the scanner-error policy rather than assuming the environment-variable implementation is a complete operator workflow.

Independent offline restoration is a longer-term roadmap item. No automatic direct-routing fallback is authorized by this specification.

### Restore safely

Unwiring must restore direct communication to the intended upstream for ClawNex-owned changes, without replacing entire configuration files or erasing later operator edits. Track the exact instance, file/field, prior value, and applied value using secret-safe ownership records.

If the current value differs from the ClawNex-managed value, preserve it and explain the conflict. Interrupted writes, repeated actions, partial failures, unavailable files, and concurrent changes must not result in false success. Determine the appropriate atomicity and recovery mechanisms during technical design.

Restoration must be demonstrated with disposable fixtures and targeted integration tests before relying on it for real installations. Reliability is a testable requirement, not a promise of unconditional '100% foolproof' behavior.

## Interface requirements from the operator

The existing routing screens are too complicated, unclear, and visually unsatisfactory. Reduce choices on the normal path, explain the next action plainly, and provide consistent OpenClaw/Hermes workflows. Preserve instance identity and material coverage exceptions.

Specific issues visible in the supplied screenshots:

- Repeated global and panel warnings compete with the actual task; drift entries such as 'capability changed · unknown' lack actionable context.
- Model and provider checkboxes imply different control scopes despite provider-endpoint enforcement.
- OpenClaw exposes both apply-route and Wire LiteLLM actions without a clear normal path.
- Hermes shows steps 1, 3, and 5 alongside restore, restart, and detect controls; operators must reconstruct the sequence.
- Selected, direct, routed, and read-only badges compete for attention without a concise overall coverage explanation.

### Approved interaction direction

Use the same structure for each tool instance:

```text
Instance identity + connection status
Coverage summary + current enforcement mode
Plain-language next action / concise exception summary
Shared command row
Expandable affected providers and evidence
Expandable technical diagnostics
```

Guide the operator through Prepare → Review changes → Apply → Verify. Present one primary next action for the current state. Keep necessary peer actions in one shared command row, wrapping only when viewport space requires it. Do not remove restoration or emergency access merely to reduce clutter.

Proposed labels are 'Review connection changes', 'Apply approved changes', 'Verify connection', and 'Restore direct connection'. Final labels, placement, and confirmation flows require a reviewed mockup. Move raw drift, bridge implementation details, and ownership diagnostics out of the normal path while retaining access for investigation.

Do not equate deselecting a proposed route, disabling collection, temporarily bypassing inspection, and restoring direct routing. These are distinct operations even if presented within one workflow.

## Verification and acceptance

| Scenario | Required result |
|---|---|
| Upstream not configured or test fails | No agent routing write; explain the prerequisite |
| Eligible and unsupported providers coexist | Approved eligible routes work; excluded routes remain unchanged; partial coverage shown |
| Model selection shares a provider endpoint | Actual affected models/providers disclosed before approval |
| Refresh discovers changes | No automatic wiring mutation |
| Apply/restart completes but no agent traffic is observed | Configured, verification pending; no false verified state |
| Benign request from selected agent | Intended provider response plus attributable proxy evidence |
| Only session-watcher evidence exists | Retrospective visibility, not verified wiring |
| Restore with no intervening edits | Direct routing restored; unrelated configuration unchanged |
| Restore after operator edits | Conflicting values preserved and explained |
| Repeated or interrupted actions | Recoverable outcome; no duplicate destructive effects or false success |
| Unsupported configuration/version | No speculative write; actionable compatibility explanation |
| Equivalent OpenClaw/Hermes task | Same workflow structure and terminology; differences explained only where material |
| Keyboard or narrow viewport | Primary and recovery actions reachable; alerts do not obscure controls |

Test failure-policy behavior independently of routing. Verify blocking versus retrospective detection and whether the current review queue actually holds undelivered content; do not claim quarantine-and-release semantics solely because an approval button exists.

## Delivery boundaries and next decisions

First audit the existing provider test, wiring, restart, verification, restoration, and failure-policy implementations against this document. Produce a focused UI mockup alongside the gap inventory. Then select the implementation baseline and sequence.

Do not reset, downgrade, deploy, or cherry-pick as part of approving this document. Build on recovered v0.15.5; reconcile installed-build/source differences before deployment. Preserve the working tree, installed-build provenance, and recovery artifacts.

Keep Favorites/Recents, sidebar/filter/security improvements, evidence provenance, exact traffic links, UTC handling, and exception-draft ownership protections as preservation requirements. Reintroduce Favorites after routing is validated; other issues follow. Do not bulk-integrate v0.15.9 while resolving routing.

Open design questions include exact UI layout, remote-instance access boundaries, disable-versus-unwire semantics, required compatibility versions, and the practical attribution mechanism for an agent-origin verification request. Research implementation facts before asking the operator to choose product behavior.

Deferred: independent offline recovery command, additional tools, plugin distribution, automatic discovery as a requirement, new live-tail display, and expanded quarantine/release or protection-certification functionality.
