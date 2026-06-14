/**
 * collector-health-resolver.ts
 *
 * WHY: Mission Control's Action Queue surfaces stale-collector alerts as one
 * of its four primary row sources. The generic action-row fallback resolver
 * leaves Source Event / Affected Object / Related Activity as visible
 * "pending" because the ActionRow shape drops the rich Collector fields
 * (lastSeenMsAgo, staleThresholdMs, status, version, ingestion_summary).
 * This per-source resolver consumes the original Collector record directly
 * and produces a fully-populated 5-stage TriageGraph so infrastructure
 * drill-downs feel as complete as alert and trust-audit drill-downs.
 *
 * Pure: no I/O, no fetch, no side effects. Mirrors the alert / trust-audit /
 * cost-signal resolver shape so future per-source resolvers follow the
 * same template.
 *
 * Resolver version: collector-health-resolver-v1
 */

import type {
  TriageGraph,
  TriageStage,
  TriageArtifact,
  TriageNavigationTarget,
  TriageStageId,
  TriageIssueSummary,
  TriageLinkState,
} from "./types";
import { TRIAGE_STAGE_ORDER } from "./types";
import { makeLastHoursFilter, makeQueryFilter } from "./navigation";

// ---------------------------------------------------------------------------
// Resolver version stamp
// ---------------------------------------------------------------------------

const RESOLVER_VERSION = "collector-health-resolver-v1";

// ---------------------------------------------------------------------------
// Public input contract
//
// Loose shape — matches CollectorHealthData.collectors[] entries from
// data-hooks.ts. Defined inline rather than imported so this resolver
// doesn't take a dependency on the dashboard data-hooks module (which
// owns its own types and is panel-scoped).
// ---------------------------------------------------------------------------

export interface CollectorRecord {
  name: string;
  status: string;
  lastSeenMsAgo: number;
  staleThresholdMs: number;
  version?: string;
  ingestion_summary?: string;
}

export interface ResolveCollectorHealthTriageInput {
  collector: CollectorRecord;
  /**
   * Stable id for this collector row in the Action Queue. Used as the
   * issue id and as a prefix for derived artifact ids so graph identity
   * stays consistent across re-renders.
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
// Severity / state helpers
// ---------------------------------------------------------------------------

/**
 * Severity escalation rule:
 *   HIGH when collector is more than 4× over its staleness threshold
 *        (matches staleCollectorToRow in ActionQueue.tsx)
 *   WARN otherwise
 */
function deriveSeverity(c: CollectorRecord): TriageIssueSummary["severity"] {
  if (c.lastSeenMsAgo > 4 * c.staleThresholdMs) return "HIGH";
  return "WARN";
}

function formatAgo(ms: number): string {
  if (ms <= 0) return "unknown";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

// ---------------------------------------------------------------------------
// Per-collector remediation copy
//
// The Fix / Control stage is per-collector when we recognize the name. For
// unknown collectors we fall back to a generic "restart and verify" message.
// Names matched here come from staleThresholdFor() in data-hooks.ts and the
// /api/infrastructure ServiceCheck list — keep this in sync if new collectors
// are added.
// ---------------------------------------------------------------------------

function prescriptiveFixForCollector(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("clawnex"))   return "Restart the ClawNex dashboard service: `sudo systemctl restart clawnex-dashboard`. Check journalctl for crash signatures before restart.";
  if (n.includes("litellm"))   return "Restart the LiteLLM proxy: `sudo systemctl restart clawnex-litellm`. Verify port 4001 is bound and PROVIDER routes are healthy.";
  if (n.includes("openclaw"))  return "Check the OpenClaw gateway: `systemctl --user status openclaw-gateway`. Restart with `systemctl --user restart openclaw-gateway` if needed.";
  if (n.includes("hermes"))    return "Hermes adapter is stale. Verify `~/.hermes/state.db` is being written and the Hermes runtime is alive.";
  if (n.includes("paperclip")) return "Paperclip finance-events endpoint not responding. Verify upstream Paperclip service health and that ClawNex has network reach.";
  return "Restart the offending collector and verify ingestion resumes. Check journalctl for upstream errors before restart.";
}

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

function buildEvidenceArtifact(input: ResolveCollectorHealthTriageInput): TriageArtifact {
  const { collector, rowId } = input;
  const overFactor = collector.staleThresholdMs > 0
    ? collector.lastSeenMsAgo / collector.staleThresholdMs
    : 0;

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "collector",        value: collector.name,                          tone: "default" },
    { label: "status",           value: collector.status || "unknown",            tone: collector.status === "online" ? "good" : "danger" },
    { label: "last_seen",        value: formatAgo(collector.lastSeenMsAgo),       tone: "default" },
    { label: "stale_threshold",  value: formatAgo(collector.staleThresholdMs),    tone: "default" },
    { label: "over_factor",      value: overFactor > 0 ? `${overFactor.toFixed(1)}×` : "n/a", tone: overFactor > 4 ? "danger" : "warn" },
  ];
  if (collector.version) {
    previewFields.push({ label: "version", value: collector.version, tone: "muted" });
  }

  // Evidence here is the live health-check probe itself — always resolved
  // because the Action Queue only surfaces this row when we observed
  // staleness (not pending state).
  const primaryAction: TriageNavigationTarget = {
    tab: "infrastructure",
    opts: { ...makeQueryFilter(collector.name), fromMissionControl: true },
    label: "Open in Infrastructure ▸",
  };

  return {
    id: `${rowId}-evidence`,
    stageId: "evidence",
    label: `Evidence · ${collector.name}`,
    shortLabel: `Evidence · ${collector.name}`,
    kind: "evidence",
    state: "resolved",
    confidence: "exact",
    previewTitle: `Health probe · ${collector.name}`,
    previewSummary: `${collector.name} has not reported in ${formatAgo(collector.lastSeenMsAgo)} (threshold: ${formatAgo(collector.staleThresholdMs)}). Probe data lives in the Infrastructure panel.`,
    previewFields,
    primaryAction,
  };
}

function buildSourceEventArtifact(input: ResolveCollectorHealthTriageInput): TriageArtifact {
  const { collector, rowId } = input;

  // The "source event" for a stale collector is the last successful probe
  // before staleness. We don't have that timestamp directly on the
  // CollectorRecord — only the time-since-last-seen. Mark this stage as
  // "derived" and route operators at journalctl / logs in Infrastructure
  // where the actual probe history lives.
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "collector",     value: collector.name,                          tone: "default" },
    { label: "last_seen_ago", value: formatAgo(collector.lastSeenMsAgo),       tone: "warn" },
  ];
  if (collector.ingestion_summary) {
    previewFields.push({
      label: "ingestion_summary",
      value: collector.ingestion_summary,
      tone: "muted",
    });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "infrastructure",
    opts: {
      focus: "logs",
      ...makeQueryFilter(collector.name),
      fromMissionControl: true,
    },
    label: "Open service logs ▸",
  };

  return {
    id: `${rowId}-source-event`,
    stageId: "sourceEvent",
    label: `Source · ${collector.name} probe`,
    shortLabel: `Source · ${collector.name} probe`,
    kind: "source",
    state: "derived",
    confidence: "derived",
    previewTitle: `Source · last probe of ${collector.name}`,
    previewSummary: `The dashboard probes ${collector.name} on a schedule. Last successful probe was ${formatAgo(collector.lastSeenMsAgo)} ago. Drill into Infrastructure to inspect probe history and recent service logs.`,
    previewFields,
    primaryAction,
  };
}

function buildAffectedObjectArtifact(input: ResolveCollectorHealthTriageInput): TriageArtifact {
  const { collector, rowId } = input;

  // The "affected object" for a stale collector is the service itself —
  // resolved because we know exactly which service is the subject. This
  // stage is essentially redundant with Evidence for collector health
  // (no separate agent / session entity), but it exists in the canonical
  // 5-stage workflow for consistency.
  const state: TriageLinkState = "resolved";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "service_name",    value: collector.name,           tone: "default" },
    { label: "current_status",  value: collector.status,         tone: collector.status === "online" ? "good" : "danger" },
  ];
  if (collector.version) {
    previewFields.push({ label: "version", value: collector.version, tone: "muted" });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "infrastructure",
    opts: {
      ...makeQueryFilter(collector.name),
      highlight: collector.name,
      fromMissionControl: true,
    },
    label: "Open service ▸",
  };

  return {
    id: `${rowId}-object`,
    stageId: "affectedObject",
    label: `Object · ${collector.name}`,
    shortLabel: `Object · ${collector.name}`,
    kind: "object",
    state,
    confidence: "exact",
    previewTitle: `Service · ${collector.name}`,
    previewSummary: `The stale collector itself is the subject of this finding. Health probes flow through Infrastructure; service-specific config is in Configuration.`,
    previewFields,
    primaryAction,
  };
}

function buildRelatedActivityArtifact(input: ResolveCollectorHealthTriageInput): TriageArtifact {
  const { collector, rowId, now = new Date() } = input;

  // "Related" for collector health = recent staleness events for the same
  // service across the last 24h. This is a derived query (Infrastructure
  // doesn't carry a separate alerts feed; the operator triages by reading
  // the probe history pre-filtered to this service).
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "scope", value: "same-service-24h", tone: "default" },
    { label: "service", value: collector.name,    tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "infrastructure",
    opts: {
      ...makeLastHoursFilter(24, now),
      ...makeQueryFilter(collector.name),
      fromMissionControl: true,
    },
    label: "Open related ▸",
  };

  return {
    id: `${rowId}-related`,
    stageId: "relatedActivity",
    label: "Related · same-service-24h",
    shortLabel: "Related · same-service-24h",
    kind: "related",
    state: "derived",
    confidence: "derived",
    previewTitle: `Related · ${collector.name} probe history`,
    previewSummary: `Recent probe events for ${collector.name} in the last 24 hours. Useful for spotting whether this is a new outage or a recurring flake.`,
    previewFields,
    primaryAction,
  };
}

function buildFixControlArtifact(input: ResolveCollectorHealthTriageInput): TriageArtifact {
  const { collector, rowId } = input;

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "service_name",   value: collector.name,                tone: "default" },
    { label: "current_status", value: collector.status,              tone: collector.status === "online" ? "good" : "danger" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "infrastructure",
    opts: { ...makeQueryFilter(collector.name), fromMissionControl: true },
    label: "Open in Infrastructure ▸",
  };

  return {
    id: `${rowId}-fix-control`,
    stageId: "fixControl",
    label: "Fix · Infrastructure",
    shortLabel: "Fix · Infrastructure",
    kind: "fix",
    state: "resolved",
    confidence: "exact",
    previewTitle: "Fix / Control · recommended remediation",
    previewSummary: prescriptiveFixForCollector(collector.name),
    previewFields,
    primaryAction,
  };
}

// ---------------------------------------------------------------------------
// Stage builder — same lead-selection pattern as sibling resolvers
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
// Issue tags — surface name + status as safe header chips
// ---------------------------------------------------------------------------

function buildIssueTags(c: CollectorRecord): TriageIssueSummary["tags"] {
  const tags: TriageIssueSummary["tags"] = [
    { label: "service", value: c.name,   safe: true },
    { label: "status",  value: c.status, safe: true },
  ];
  if (c.version) {
    tags.push({ label: "version", value: c.version, safe: true });
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * resolveCollectorHealthTriageGraph
 *
 * Converts a stale-collector record into a fully-populated TriageGraph for
 * display in <TriageGraphCard>. Pure: no I/O, no fetch, no side effects.
 *
 * Stage population:
 *   01 Evidence         — current probe state + staleness over-factor (resolved).
 *   02 Source Event     — last successful probe context (derived; routes to logs).
 *   03 Affected Object  — the service itself (resolved; routes to Infrastructure).
 *   04 Related Activity — same-service probe history in last 24h (derived).
 *   05 Fix / Control    — per-service prescriptive remediation (resolved).
 */
export function resolveCollectorHealthTriageGraph(
  input: ResolveCollectorHealthTriageInput,
): TriageGraph {
  const { collector, rowId, now = new Date() } = input;

  // 1. Issue summary from safe Collector fields only
  const issue: TriageIssueSummary = {
    id: rowId,
    kind: "infrastructure",
    title: `Stale collector: ${collector.name}`,
    severity: deriveSeverity(collector),
    status: "open",
    source: "infrastructure",
    summary: `${collector.name} has not reported in ${formatAgo(collector.lastSeenMsAgo)} (threshold: ${formatAgo(collector.staleThresholdMs)}). The dashboard's view of this collector's data may be stale until ingestion resumes.`,
    tags: buildIssueTags(collector),
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
