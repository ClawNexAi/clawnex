# Issue #12 Operational Data Accuracy Audit

Status: research complete; implementation pending

Branch: `feature/12-operational-data-accuracy`

Issue: [#12 Roadmap: Operational data accuracy](https://github.com/ClawNexAi/clawnex/issues/12)

Evidence date: 2026-07-19

## Purpose

This audit defines how ClawNex must report operational telemetry for OpenClaw and Hermes. Its goal is to prevent a displayed zero, healthy state, or current value from implying measurement when the underlying source is stale, unavailable, derived, or not applicable.

This phase changes no runtime behavior. It records confirmed defects and establishes the implementation contract, tests, and rollout order.

## Method

The audit combined:

- Static tracing from dashboard cards to API routes and their underlying files, connectors, and SQLite tables.
- Read-only inspection of the established local development instance on port 5001.
- Read-only inspection of the fresh QA deployment at `qa.clawnexai.com` and its ClawNex and Hermes databases.
- Cross-panel comparisons among Mission Control, Fleet Command, Infrastructure, Traffic Monitor, Models & Cost, and Token & Cost Intel.

No synthetic values were inserted and no QA data was modified.

## Required Data Contract

Every operational measurement must expose a state and provenance. A bare scalar is not sufficient.

```ts
type TelemetryState =
  | "measured"
  | "derived"
  | "stale"
  | "unavailable"
  | "not_applicable";

type TelemetryValue<T> = {
  value: T | null;
  state: TelemetryState;
  source: string;
  observedAt: string | null;
  staleAfterMs: number | null;
  reason?: string;
};
```

Definitions:

- **Measured:** directly observed from the authoritative source within its freshness budget.
- **Derived:** calculated from measured inputs; the formula and input sources are identified.
- **Stale:** a previously valid observation is older than its freshness budget. The last value may be shown only with an explicit stale label and timestamp.
- **Unavailable:** the source cannot provide the measurement. The UI shows `Unavailable`, never `0`.
- **Not applicable:** the measurement does not apply to that connector or configuration.

Zero is a valid value only when the source measured zero. Missing timestamps, failed collectors, unsupported metrics, and absent rows are not zero.

## Canonical Definitions

| Metric | Canonical meaning | Authoritative source |
| --- | --- | --- |
| OpenClaw configured agents | Number of configured agent entries, with the treatment of the primary agent stated explicitly | `openclaw.json` |
| OpenClaw active sessions | Sessions active inside the selected time window | Session inventory/connector with an explicit window |
| OpenClaw stored sessions | All session files currently inventoried | Session filesystem inventory |
| Hermes sessions | Sessions observed inside the selected time window | Hermes `sessions` table |
| Connector availability | Adapter can reach/read its source now | Connector diagnostic |
| Connector activity | Most recent successfully observed source event | Source event timestamp/cursor |
| Traffic | Rows observed by ClawNex, grouped by source and selected window | `proxy_traffic` |
| Cost | Non-negative cost for the selected window and declared sources | Cost orchestrator with source status |
| Latency p95 | Statistical p95 over measured positive latency rows in the selected window | `proxy_traffic.latency_ms` |
| Ingestion | Events actually accepted by each collector, split by collector/source | Collector cursor/event tables |

Availability and activity are separate. An installed, readable Hermes database can be available while its activity is stale.

## Confirmed Findings

### P0: Same-response OpenClaw counts disagree

The local `/api/fleet` response reported 13 agents and 139 sessions at the instance level while its nested OpenClaw connector reported 14 agents and 57 sessions. The route mixes configuration, connector, and filesystem definitions and then presents them under identical labels.

Required correction: name and expose configured agents, active sessions, and stored sessions separately. Fleet and Mission Control must consume the same canonical fields.

### P0: Hermes health conflates availability with freshness

Hermes can be labeled `healthy`, `live`, and zero-risk when its database is merely readable. Local evidence showed activity roughly 5.5 days old and no sessions in 24 hours. QA showed a readable Hermes database with historical sessions while the database file itself had not changed since 2026-06-17.

Required correction: expose `available` independently from `activityState`. A readable source with old activity is `available` and `stale`, not operationally healthy/live.

### P0: Unsupported Hermes measurements are rendered as measured zero

Fleet currently emits numeric zero for Hermes CPU, memory, disk, threats, alerts, p95 latency, and cost even when Hermes supplies no such measurement.

Required correction: emit `unavailable` or `not_applicable` with `value: null`. Cards and totals must not include these values as measured zero.

### P0: Cost values do not reconcile and lack provenance

Local Fleet cost was approximately `$0.04` while Token & Cost Intel reported approximately `$3.82`. They use different source sets and windows without explaining that distinction. QA aggregation also found a negative stored traffic cost total (`-60230`), which must never flow into an operational cost KPI.

Required correction: centralize cost calculation, reject or quarantine negative/non-finite values, declare source coverage and time window, and expose measured/recomputed/token-only/unavailable status.

### P0: Infrastructure ingestion reports the wrong activity

The Infrastructure OpenClaw ingestion summary counts `shield_scans`, while Traffic Monitor may contain recent `session-watcher` rows. Local evidence displayed zero ingested events despite recent traffic records.

Required correction: report ingestion per collector using the collector's actual event/cursor source. Never label shield scan count as total OpenClaw ingestion.

### P0: Missing timestamps become healthy collectors

Mission Control maps absent `last_seen_ms_ago` to zero and then falls back to `status === "online"`. This turns unknown freshness into healthy status and can inflate collector-health scores.

Required correction: require `observedAt` and freshness budget for health scoring. Missing freshness is `unavailable`, not current.

### P1: Stale state only appears after a request failure

The polling hook preserves prior data as stale after fetch errors, but successful old data does not age into stale state when its source timestamp exceeds the budget.

Required correction: evaluate source age on every render/poll and transition measured data to stale independently of HTTP success.

### P1: Latency unavailable is represented as zero

Fleet initializes p95 to zero and uses zero when no positive latency rows exist. Zero milliseconds therefore means both measured zero and no data.

Required correction: return null/unavailable when the sample is empty and include sample count and window.

### P1: Policy coverage contains a hard-coded operational count

Mission Control hard-codes 163 core Shield rules. The displayed coverage can drift from the installed rule set.

Required correction: count active installed rules from the policy source and include rule-set version/observed time.

### P1: Version-like labels include placeholders

Infrastructure can display protocol/storage labels such as `HTTP`, `WS`, or `state.db` as though they were software versions.

Required correction: separate `adapterType`, `transport`, and `version`. Show version only when measured.

### P1: Model sources can be duplicated

The Models API can append separate LM Studio source rows and a generic error row, producing duplicate offline/error entries.

Required correction: use stable source IDs and merge each configured endpoint into one status record.

### P1: Shared operational filters do not guarantee shared semantics

Panels can apply different time windows, source inclusion, and fallback rules while presenting values together. This is the root of several count and cost disagreements.

Required correction: every response includes the effective instance, source set, time range, and query timestamp. Cross-panel links preserve that scope.

## API Remediation Specification

### 1. Add a common telemetry envelope

Introduce a shared server type and constructors for measured, derived, stale, unavailable, and not-applicable values. Constructors must validate timestamps and reject invalid numeric values.

For one compatibility release, retain existing scalar fields and add a `telemetry` object. Dashboard consumers migrate to `telemetry`; legacy scalars are removed only after all first-party consumers and tests use the new contract.

### 2. Build canonical source adapters

OpenClaw adapter:

- Read configured agent and model inventory from `openclaw.json`.
- Report active and stored sessions as separate metrics.
- Attach source path, observation timestamp, time window, and freshness budget.

Hermes adapter:

- Report installation/readability separately from recent activity.
- Read session/message counts and latest activity from Hermes tables.
- Return unavailable for host resource, latency, alert, threat, and cost metrics unless a real source exists.

Shared totals:

- Include only measured or valid derived values.
- Track excluded stale/unavailable sources and surface that coverage beside the total.
- Never silently coerce null or invalid values to zero.

### 3. Centralize cost and traffic semantics

- Use one cost-report service for Fleet, Mission Control, and Token & Cost Intel.
- Require an explicit time range and source set.
- Validate costs as finite and non-negative before aggregation.
- Split direct proxy, session watcher, OpenClaw, and Hermes coverage.
- Label recomputed and token-only estimates distinctly from provider-reported cost.

### 4. Correct collector freshness

Each collector response must include:

- stable collector ID
- availability state
- latest successful observation timestamp
- freshness budget
- last error timestamp/reason when present
- ingestion count and cursor for the selected window

Mission Control computes health from these fields rather than route status strings.

### 5. Reconcile panel contracts

Fleet Command, Mission Control, Infrastructure, Traffic Monitor, Models & Cost, and Token & Cost Intel must use the same metric definitions. Each panel may summarize differently, but identical labels must resolve to identical values and scope.

## UI Requirements

- Render `Unavailable`, `Not applicable`, and `Stale <age>` explicitly.
- Show zero only for a measured zero.
- Provide a concise provenance tooltip or disclosure containing source, observed time, freshness budget, time window, and derivation.
- Display partial-coverage warnings on totals when one or more relevant sources are stale or unavailable.
- Preserve the current dashboard layout; this work corrects meaning and state presentation rather than moving functions.
- Do not use green/healthy styling for readable-but-stale connectors.

## Verification Plan

### Contract tests

- Every operational metric carries state, source, and timestamp metadata.
- Missing source data produces unavailable, not zero.
- Stale timestamps age successfully fetched data into stale state.
- Negative, non-finite, and malformed costs are excluded and reported as data-quality errors.
- Empty latency samples produce unavailable with sample count zero.

### Fixture matrix

Cover OpenClaw and Hermes in these states:

- current activity with non-zero values
- current measured zero
- installed/readable but stale
- unavailable source
- unsupported/not-applicable metric
- recovery from stale to measured
- source disappears after prior measurement

### Cross-panel reconciliation

For a fixed fixture and time range:

- Fleet and Mission Control agent/session values reconcile.
- Fleet and Token & Cost Intel costs reconcile or visibly declare different source coverage.
- Infrastructure ingestion equals the sum of its named collector sources.
- Traffic Monitor totals match the same scoped traffic query.

### Browser QA

Verify desktop and mobile views for all affected panels. Capture screenshots for measured zero, stale, unavailable, partial coverage, and recovery states. Confirm filters and deep links preserve instance and time scope.

### Data-contract verifier

Add a repeatable script that queries affected APIs and fails when:

- required provenance is missing
- identical scoped metrics disagree
- an unsupported metric is represented as zero
- a stale source is labeled live/healthy
- cost is negative or non-finite

## Implementation Order

1. Shared telemetry types, validation, and tests.
2. OpenClaw and Hermes canonical adapters.
3. Cost/traffic and collector freshness corrections.
4. API compatibility fields and reconciliation tests.
5. Dashboard migration and unavailable/stale presentation.
6. Browser QA, operator documentation, and removal of legacy scalar fallbacks.

The first implementation pull request should not combine all six steps. Land the contract and adapters first, then migrate panels in reviewable increments while keeping `dev` deployable.

## Completion Evidence for Issue #12

Issue #12 can close only when:

- implementation is shipped through the normal dev-to-main process;
- the data-contract verifier passes on local and QA environments;
- browser QA evidence covers every affected operational panel;
- operator documentation explains measured, derived, stale, unavailable, and not-applicable states;
- no confirmed P0 discrepancy in this audit remains reproducible.
