/**
 * cost-signal-resolver.ts
 *
 * WHY: Mission Control's Action Queue surfaces cost-signal alerts (loop_risk,
 * velocity_spike, context_bloat, cache_drop, simple_on_expensive) as one of
 * its four primary row sources. The generic action-row fallback resolver
 * leaves Source Event / Affected Object / Related Activity as visible
 * "pending" because the ActionRow shape drops the rich Signal fields
 * (affected_row_ids, kind enum, detail). This per-source resolver consumes
 * the original Signal directly and produces a fully-populated 5-stage
 * TriageGraph so cost drill-downs feel as complete as alert drill-downs.
 *
 * Pure: no I/O, no fetch, no side effects. Mirrors alert-resolver and
 * trust-audit-resolver shape so future per-source resolvers follow the
 * same template.
 *
 * Resolver version: cost-signal-resolver-v1
 */

import type { Signal } from "../../../lib/types/cost-reporting";
import type {
  TriageGraph,
  TriageStage,
  TriageArtifact,
  TriageNavigationTarget,
  TriageStageId,
  TriageIssueSummary,
} from "./types";
import { TRIAGE_STAGE_ORDER } from "./types";
import { makeLastHoursFilter, makeQueryFilter } from "./navigation";

// ---------------------------------------------------------------------------
// Resolver version stamp
// ---------------------------------------------------------------------------

const RESOLVER_VERSION = "cost-signal-resolver-v1";

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

export interface ResolveCostSignalTriageInput {
  signal: Signal;
  /**
   * Stable id for the signal as rendered in the Action Queue. The resolver
   * uses this as the issue id and as a prefix for derived artifact ids so
   * graph identity stays consistent across re-renders even though Signal
   * itself has no top-level id field.
   */
  rowId: string;
  /** "Now" reference for time-window labels. Defaults to new Date(). */
  now?: Date;
  /** Reserved for future permission-gated artifacts. Not enforced in v1. */
  permissions?: Set<string>;
}

// ---------------------------------------------------------------------------
// Stage metadata — verbatim titles required by the contract verifier
// ---------------------------------------------------------------------------

const STAGE_TITLES: Record<TriageStageId, string> = {
  evidence: "Evidence",
  sourceEvent: "Source Event",
  affectedObject: "Affected Object",
  relatedActivity: "Related Activity",
  fixControl: "Fix / Control",
};

const STAGE_EYEBROW: Record<TriageStageId, string> = {
  evidence: "01",
  sourceEvent: "02",
  affectedObject: "03",
  relatedActivity: "04",
  fixControl: "05",
};

// ---------------------------------------------------------------------------
// Per-kind prescriptive recommendation copy
//
// The Fix / Control stage's primary value is operator-actionable advice
// for each cost-signal kind. Generic "investigate cost" copy reads as
// hand-waving; verb-led per-kind copy gives the operator a concrete next
// step that maps to known remediation patterns from the cost-signals
// detector design (docs/superpowers/specs/2026-05-04-token-cost-finops-...).
// ---------------------------------------------------------------------------

function prescriptiveFixForKind(kind: Signal["kind"]): string {
  switch (kind) {
    case "loop_risk":
      return "Inspect retry/loop pattern. Cap max-retries or shorten the agent's loop timeout; rotate stale sessions if the loop is unrecoverable.";
    case "velocity_spike":
      return "Throttle the spiking agent. Verify the burst rate is intentional (e.g. backfill job) or agent-faulty (runaway prompt).";
    case "context_bloat":
      return "Trim the agent's prompt-context window. Consider summarization or a sliding-window strategy to keep input_tokens bounded.";
    case "cache_drop":
    case "cache_drop_risk":
      return "Re-check prompt-cache config. Verify cache_control headers and that the cache key is stable across the offending requests.";
    case "simple_on_expensive":
      return "Route trivial prompts to a cheaper model tier. The agent issued zero tool calls on a high-cost model — likely misrouted.";
    default:
      return "Open Token Cost; investigate the affected rows and apply a scoped remediation.";
  }
}

function kindLabel(kind: Signal["kind"]): string {
  switch (kind) {
    case "loop_risk":          return "Loop Risk";
    case "velocity_spike":     return "Velocity Spike";
    case "context_bloat":      return "Context Bloat";
    case "cache_drop":         return "Cache Drop";
    case "cache_drop_risk":    return "Cache Drop (risk)";
    case "simple_on_expensive": return "Simple-on-Expensive";
    default:                   return String(kind);
  }
}

function summaryForKind(kind: Signal["kind"]): string {
  switch (kind) {
    case "loop_risk":
      return "Same prompt fired repeatedly within a short window — likely an agent stuck in a retry/loop pattern.";
    case "velocity_spike":
      return "Token rate exceeded the recent moving-average baseline by a wide margin within the detection window.";
    case "context_bloat":
      return "Input-token count is creeping upward without proportional output — context window is filling without payoff.";
    case "cache_drop":
      return "Prompt cache hit-rate dropped sharply — cache_control config or key drift may be the cause.";
    case "cache_drop_risk":
      return "Heuristic suggests prompt cache may be missing on requests that should be cacheable.";
    case "simple_on_expensive":
      return "Trivial prompts (zero tool calls) hit an expensive model — likely a routing misconfiguration.";
    default:
      return "Cost-signal detector flagged this row.";
  }
}

// ---------------------------------------------------------------------------
// Severity normalization
// ---------------------------------------------------------------------------

function normalizeSeverity(sev: Signal["severity"]): TriageIssueSummary["severity"] {
  return sev === "high" ? "HIGH" : "WARN";
}

// ---------------------------------------------------------------------------
// row_id → session/agent fallback
//
// Some Signal kinds carry affected_row_ids that encode the session in their
// suffix (Hermes adapter row_ids are "<session_id>:<model>"). This is a
// best-effort extraction — when the suffix doesn't decode cleanly we just
// expose the row count rather than fabricating an agent reference.
// ---------------------------------------------------------------------------

const UUID_PATTERN = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

function extractSessionIds(rowIds: string[]): string[] {
  // Plain object as a poor-man's Set so we don't depend on
  // downlevelIteration tsconfig settings.
  const seen: Record<string, true> = {};
  for (const rid of rowIds) {
    const m = rid.match(UUID_PATTERN);
    if (m) seen[m[1]] = true;
  }
  return Object.keys(seen);
}

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

function buildEvidenceArtifact(input: ResolveCostSignalTriageInput): TriageArtifact {
  const { signal, rowId } = input;
  const affectedCount = signal.affected_row_ids?.length ?? 0;

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "kind",     value: signal.kind,                                tone: "default" },
    { label: "severity", value: signal.severity.toUpperCase(),              tone: signal.severity === "high" ? "danger" : "warn" },
    { label: "affected_rows", value: String(affectedCount), tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "tokenCost",
    opts: { ...makeQueryFilter(signal.kind), fromMissionControl: true },
    label: "Open in Token Cost ▸",
  };

  return {
    id: `${rowId}-evidence`,
    stageId: "evidence",
    label: `Evidence · ${kindLabel(signal.kind)}`,
    shortLabel: `Evidence · ${kindLabel(signal.kind)}`,
    kind: "evidence",
    state: "resolved",
    confidence: "exact",
    previewTitle: `Cost Signal · ${kindLabel(signal.kind)}`,
    previewSummary: signal.detail || summaryForKind(signal.kind),
    previewFields,
    primaryAction,
  };
}

function buildSourceEventArtifact(input: ResolveCostSignalTriageInput): TriageArtifact {
  const { signal, rowId } = input;
  const affectedCount = signal.affected_row_ids?.length ?? 0;
  const sampleIds = (signal.affected_row_ids ?? []).slice(0, 3);

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "row_count", value: String(affectedCount), tone: "default" },
  ];
  // Surface a small sample of row IDs so the operator can drill back
  // into Token Cost / RecentTokenEvents to find them. Capped at 3 to
  // keep the preview pane scannable.
  sampleIds.forEach((rid, i) => {
    previewFields.push({ label: `row_${i + 1}`, value: rid, tone: "muted" });
  });
  if (affectedCount > sampleIds.length) {
    previewFields.push({
      label: "additional_rows",
      value: `+${affectedCount - sampleIds.length} more`,
      tone: "muted",
    });
  }

  const state = affectedCount > 0 ? "derived" : "missing";

  const primaryAction: TriageNavigationTarget | undefined = affectedCount > 0
    ? {
        tab: "tokenCost",
        opts: { ...makeQueryFilter(signal.kind), fromMissionControl: true },
        label: "Open affected rows ▸",
      }
    : undefined;

  return {
    id: `${rowId}-source-event`,
    stageId: "sourceEvent",
    label: "Source · cost-rows",
    shortLabel: "Source · cost-rows",
    kind: "source",
    state,
    confidence: state === "derived" ? "derived" : undefined,
    previewTitle: "Source · normalized cost-row(s)",
    previewSummary: affectedCount > 0
      ? `${affectedCount} cost-row${affectedCount === 1 ? "" : "s"} flagged by the ${kindLabel(signal.kind)} detector. Drill into Token Cost to inspect them inline.`
      : "No source rows are bound to this signal yet — the detector cannot localize the cost driver.",
    previewFields,
    primaryAction,
    reason: state === "missing"
      ? "No source rows are bound to this signal yet."
      : undefined,
  };
}

function buildAffectedObjectArtifact(input: ResolveCostSignalTriageInput): TriageArtifact {
  const { signal, rowId } = input;
  const sessions = extractSessionIds(signal.affected_row_ids ?? []);
  const hasSessions = sessions.length > 0;

  const previewFields: TriageArtifact["previewFields"] = [];
  if (hasSessions) {
    previewFields.push({
      label: "session_count",
      value: String(sessions.length),
      tone: "default",
    });
    sessions.slice(0, 3).forEach((sid, i) => {
      previewFields.push({ label: `session_${i + 1}`, value: sid, tone: "muted" });
    });
    if (sessions.length > 3) {
      previewFields.push({
        label: "additional_sessions",
        value: `+${sessions.length - 3} more`,
        tone: "muted",
      });
    }
  }

  const state = hasSessions ? "derived" : "missing";

  // When we have exactly one session, prefer a direct agent drill-down.
  // For multi-session signals the agents-panel filter would need a multi-id
  // shape we don't currently model — fall back to Token Cost.
  const primaryAction: TriageNavigationTarget | undefined = hasSessions
    ? sessions.length === 1
      ? {
          tab: "agents",
          opts: { id: sessions[0], highlight: sessions[0], fromMissionControl: true },
          label: "Open agent ▸",
        }
      : {
          tab: "tokenCost",
          opts: { ...makeQueryFilter(signal.kind), fromMissionControl: true },
          label: "Open affected sessions ▸",
        }
    : undefined;

  return {
    id: `${rowId}-object`,
    stageId: "affectedObject",
    label: hasSessions ? `Object · ${sessions.length} session${sessions.length === 1 ? "" : "s"}` : "Object · pending",
    shortLabel: hasSessions ? `Object · ${sessions.length} session${sessions.length === 1 ? "" : "s"}` : "Object · pending",
    kind: "object",
    state,
    confidence: hasSessions ? "medium" : undefined,
    previewTitle: hasSessions
      ? `Affected Object · ${sessions.length} session${sessions.length === 1 ? "" : "s"}`
      : "Affected Object · cannot localize",
    previewSummary: hasSessions
      ? sessions.length === 1
        ? `Session "${sessions[0]}" is the cost driver flagged by this signal.`
        : `${sessions.length} sessions appear in the affected rows. Inspect Token Cost or drill into individual sessions for per-agent context.`
      : "Affected row IDs do not encode session identifiers in a recognizable form. Use the source-event row list to drill in.",
    previewFields,
    primaryAction,
    reason: state === "missing"
      ? "Affected row IDs do not encode session identifiers in a recognizable form."
      : undefined,
  };
}

function buildRelatedActivityArtifact(input: ResolveCostSignalTriageInput): TriageArtifact {
  const { signal, rowId, now = new Date() } = input;

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "scope", value: "same-kind-24h", tone: "default" },
    { label: "kind",  value: signal.kind,     tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "tokenCost",
    opts: {
      ...makeLastHoursFilter(24, now),
      ...makeQueryFilter(signal.kind),
      fromMissionControl: true,
    },
    label: "Open related ▸",
  };

  return {
    id: `${rowId}-related`,
    stageId: "relatedActivity",
    label: "Related · same-kind-24h",
    shortLabel: "Related · same-kind-24h",
    kind: "related",
    state: "derived",
    confidence: "derived",
    previewTitle: `Related · other ${kindLabel(signal.kind)} signals`,
    previewSummary: `Other ${kindLabel(signal.kind)} signals across the fleet in the last 24 hours.`,
    previewFields,
    primaryAction,
  };
}

function buildFixControlArtifact(input: ResolveCostSignalTriageInput): TriageArtifact {
  const { signal, rowId } = input;

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "kind", value: signal.kind, tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "tokenCost",
    opts: { ...makeQueryFilter(signal.kind), fromMissionControl: true },
    label: "Open in Token Cost ▸",
  };

  return {
    id: `${rowId}-fix-control`,
    stageId: "fixControl",
    label: "Fix · Token Cost",
    shortLabel: "Fix · Token Cost",
    kind: "fix",
    state: "resolved",
    confidence: "exact",
    previewTitle: "Fix / Control · recommended remediation",
    previewSummary: prescriptiveFixForKind(signal.kind),
    previewFields,
    primaryAction,
  };
}

// ---------------------------------------------------------------------------
// Stage builder — same lead-selection pattern as alert-resolver / trust-audit
// ---------------------------------------------------------------------------

function buildStage(stageId: TriageStageId, artifacts: TriageArtifact[]): TriageStage {
  const stageArtifacts = artifacts.filter((a) => a.stageId === stageId);
  const lead =
    stageArtifacts.find((a) => a.state === "resolved")
    ?? stageArtifacts.find((a) => a.state === "derived")
    ?? stageArtifacts[0];

  const summary = lead?.previewSummary
    ? trimSafe(lead.previewSummary, 160)
    : lead?.reason
      ? trimSafe(lead.reason, 160)
      : "Not yet resolved.";

  return {
    id: stageId,
    title: STAGE_TITLES[stageId],
    eyebrow: STAGE_EYEBROW[stageId],
    state: lead?.state ?? "missing",
    summary,
    artifactIds: stageArtifacts.map((a) => a.id),
  };
}

function trimSafe(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// ---------------------------------------------------------------------------
// Issue tags — surface kind + severity + row_count as safe header chips
// ---------------------------------------------------------------------------

function buildIssueTags(signal: Signal): TriageIssueSummary["tags"] {
  const tags: TriageIssueSummary["tags"] = [
    { label: "kind",     value: signal.kind,                       safe: true },
    { label: "severity", value: signal.severity.toUpperCase(),     safe: true },
  ];
  const count = signal.affected_row_ids?.length ?? 0;
  if (count > 0) {
    tags.push({ label: "rows", value: String(count), safe: true });
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * resolveCostSignalTriageGraph
 *
 * Converts a Signal (loop_risk / velocity_spike / context_bloat / cache_drop /
 * cache_drop_risk / simple_on_expensive) into a fully-populated TriageGraph.
 * Pure: no I/O, no fetch, no side effects.
 *
 * Stage population:
 *   01 Evidence         — the signal itself (resolved). Primary action: Token Cost.
 *   02 Source Event     — affected cost-rows (derived when count>0; missing otherwise).
 *   03 Affected Object  — sessions extracted from row IDs (derived when sessions are
 *                          decodeable; missing when row IDs don't carry UUID suffix).
 *   04 Related Activity — same-kind signals in last 24h (derived).
 *   05 Fix / Control    — per-kind prescriptive remediation (resolved).
 */
export function resolveCostSignalTriageGraph(
  input: ResolveCostSignalTriageInput,
): TriageGraph {
  const { signal, rowId, now = new Date() } = input;

  // 1. Issue summary from safe Signal fields only
  const issue: TriageIssueSummary = {
    id: rowId,
    kind: "costSignal",
    title: signal.detail || `Cost signal: ${kindLabel(signal.kind)}`,
    severity: normalizeSeverity(signal.severity),
    status: "open",
    source: "litellm-proxy",
    summary: summaryForKind(signal.kind),
    tags: buildIssueTags(signal),
  };

  // 2. Build artifacts in canonical stage order
  const artifacts: TriageArtifact[] = [
    buildEvidenceArtifact(input),
    buildSourceEventArtifact(input),
    buildAffectedObjectArtifact(input),
    buildRelatedActivityArtifact(input),
    buildFixControlArtifact(input),
  ];

  // 3. Build stages
  const stages: TriageStage[] = TRIAGE_STAGE_ORDER.map((id) => buildStage(id, artifacts));

  // 4. Default selection: first resolved → first derived → first artifact
  const defaultArtifactId =
    artifacts.find((a) => a.state === "resolved")?.id
    ?? artifacts.find((a) => a.state === "derived")?.id
    ?? artifacts[0]?.id;

  return {
    issue,
    stages,
    artifacts,
    defaultArtifactId,
    generatedAt: now.toISOString(),
    resolverVersion: RESOLVER_VERSION,
  };
}
