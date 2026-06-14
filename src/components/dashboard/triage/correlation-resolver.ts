/**
 * correlation-resolver.ts
 *
 * WHY: Mission Control's Action Queue surfaces correlation findings — alerts
 * that the correlator linked across two or more source signals (e.g. an alert
 * + a cost-signal that fired in the same window for the same session). The
 * generic action-row fallback resolver leaves Source Event / Affected Object /
 * Related Activity as visible "pending" because the ActionRow shape drops the
 * rich correlation fields (correlatedSignalIds, correlatedSources, window,
 * sharedSessionId, evidence). This per-source resolver consumes the original
 * CorrelationFinding directly and produces a fully-populated 5-stage
 * TriageGraph so correlation drill-downs feel as complete as alert drill-downs.
 *
 * Family invariant: a correlation finding spans 2+ signals by construction.
 * The Affected Object stage is therefore "derived" only when sharedSessionId
 * is present — multi-session correlations route the operator to the
 * constituent signals instead of fabricating a single agent reference.
 *
 * Pure: no I/O, no fetch, no side effects. Mirrors cost-signal-resolver and
 * trust-audit-resolver shape.
 *
 * Resolver version: correlation-resolver-v1
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

const RESOLVER_VERSION = "correlation-resolver-v1";

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

export interface CorrelationFinding {
  id: string;
  title: string;
  severity: "CRIT" | "HIGH" | "MED" | "WARN" | "LOW";
  /** Two or more source signal IDs that the correlator linked. */
  correlatedSignalIds: string[];
  /** Human-readable list of the source families (e.g. "alert + cost-signal"). */
  correlatedSources: string[];
  /** Shared timeframe of the correlation in ms epoch. */
  windowStartMs: number;
  windowEndMs: number;
  /** Optional shared session/agent ID if all signals point at one. */
  sharedSessionId?: string;
  /** Short rule-emitted observations (rendered as evidenceTrail). */
  evidence?: string[];
  /** Confidence the correlator emits. */
  confidence?: "high" | "medium" | "low";
}

export interface ResolveCorrelationTriageInput {
  finding: CorrelationFinding;
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
// Helpers
// ---------------------------------------------------------------------------

function severityTone(sev: CorrelationFinding["severity"]): "danger" | "warn" | "default" {
  if (sev === "CRIT" || sev === "HIGH") return "danger";
  if (sev === "MED" || sev === "WARN") return "warn";
  return "default";
}

function confidenceLabel(c: CorrelationFinding["confidence"]): string {
  return c ?? "unknown";
}

/**
 * The "query" for navigating to constituent signals. Single id → use that id;
 * multiple → use the finding id as a stable label since the URL filter takes a
 * single string. The downstream Audit & Evidence panel can render a multi-id
 * search via its own UI; we just provide a stable handle here.
 */
function navigationQueryForSignals(f: CorrelationFinding): string {
  if (f.correlatedSignalIds.length === 1) return f.correlatedSignalIds[0];
  return f.id;
}

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

function buildEvidenceArtifact(f: CorrelationFinding): TriageArtifact {
  const evidenceCount = f.evidence?.length ?? 0;
  const hasEvidence = evidenceCount > 0;
  const state: TriageLinkState = hasEvidence ? "resolved" : "derived";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "signal_count",   value: String(f.correlatedSignalIds.length),     tone: "default" },
    { label: "sources",        value: f.correlatedSources.join(" + ") || "n/a", tone: "default" },
    { label: "confidence",     value: confidenceLabel(f.confidence),            tone: hasEvidence ? "good" : "warn" },
  ];
  if (hasEvidence) {
    previewFields.push({
      label: "evidence_items",
      value: String(evidenceCount),
      tone: "default",
    });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "auditEvidence",
    opts: {
      ...makeQueryFilter(navigationQueryForSignals(f)),
      fromMissionControl: true,
    },
    label: "Open constituent signals ▸",
  };

  return {
    id: `${f.id}-evidence`,
    stageId: "evidence",
    label: `Evidence · ${f.correlatedSignalIds.length} signals`,
    shortLabel: `Evidence · ${f.correlatedSignalIds.length} signals`,
    kind: "evidence",
    state,
    confidence: state === "resolved" ? "exact" : "derived",
    previewTitle: `Correlation · ${f.correlatedSignalIds.length} signals across ${f.correlatedSources.length} sources`,
    previewSummary: `${f.correlatedSignalIds.length} signals correlated across ${f.correlatedSources.length} source${f.correlatedSources.length === 1 ? "" : "s"} (${f.correlatedSources.join(" + ") || "n/a"}).`,
    previewFields,
    primaryAction,
    // Surface the rule-emitted evidence trail (CorrelationFinding.evidence)
    // behind the same default-collapsed toggle pattern as trust-audit /
    // alert resolvers. Each entry is a short server-emitted observation —
    // operator-summary-grade, no raw payload.
    evidenceTrail: hasEvidence ? { items: f.evidence! } : undefined,
  };
}

function buildSourceEventArtifact(f: CorrelationFinding): TriageArtifact {
  const sampleIds = f.correlatedSignalIds.slice(0, 3);

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "signal_count", value: String(f.correlatedSignalIds.length),  tone: "default" },
    { label: "sources",      value: f.correlatedSources.join(" + ") || "n/a", tone: "default" },
  ];
  // Surface up to 3 constituent signal IDs so the operator can drill back
  // into Audit & Evidence to inspect them. Capped to keep the preview pane
  // scannable.
  sampleIds.forEach((sid, i) => {
    previewFields.push({ label: `signal_${i + 1}`, value: sid, tone: "muted" });
  });
  if (f.correlatedSignalIds.length > sampleIds.length) {
    previewFields.push({
      label: "additional_signals",
      value: `+${f.correlatedSignalIds.length - sampleIds.length} more`,
      tone: "muted",
    });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "auditEvidence",
    opts: {
      ...makeQueryFilter(navigationQueryForSignals(f)),
      fromMissionControl: true,
    },
    label: "Open constituent signals ▸",
  };

  return {
    id: `${f.id}-source-event`,
    stageId: "sourceEvent",
    label: "Source · constituent signals",
    shortLabel: "Source · constituent signals",
    kind: "source",
    state: "derived",
    confidence: "derived",
    previewTitle: "Source · constituent signals",
    previewSummary: `The correlator linked ${f.correlatedSignalIds.length} signals from ${f.correlatedSources.join(" + ") || "n/a"} within a shared time window. Drill into Audit & Evidence to open each signal.`,
    previewFields,
    primaryAction,
  };
}

function buildAffectedObjectArtifact(f: CorrelationFinding): TriageArtifact {
  const hasShared = typeof f.sharedSessionId === "string" && f.sharedSessionId.length > 0;
  const state: TriageLinkState = hasShared ? "derived" : "missing";

  const shortLabel = hasShared ? `Object · ${f.sharedSessionId}` : "Object · multi-session";

  const previewFields: TriageArtifact["previewFields"] = [];
  if (hasShared) {
    previewFields.push({ label: "shared_session", value: f.sharedSessionId!, tone: "default" });
  }
  previewFields.push({ label: "signal_count", value: String(f.correlatedSignalIds.length), tone: "default" });

  const primaryAction: TriageNavigationTarget | undefined = hasShared
    ? {
        tab: "agents",
        opts: { id: f.sharedSessionId!, highlight: f.sharedSessionId!, fromMissionControl: true },
        label: "Open agent ▸",
      }
    : undefined;

  return {
    id: `${f.id}-object`,
    stageId: "affectedObject",
    label: shortLabel,
    shortLabel,
    kind: "object",
    state,
    confidence: hasShared ? "medium" : undefined,
    previewTitle: hasShared
      ? `Affected Object · session "${f.sharedSessionId}"`
      : "Affected Object · spans multiple sessions",
    previewSummary: hasShared
      ? `All correlated signals point at session "${f.sharedSessionId}". Drill into the agent for per-session context.`
      : "Correlated signals span multiple sessions — open the constituent signals to drill in.",
    previewFields,
    primaryAction,
    reason: hasShared
      ? undefined
      : "Correlated signals span multiple sessions — open the constituent signals to drill in.",
  };
}

function buildRelatedActivityArtifact(f: CorrelationFinding, now: Date): TriageArtifact {
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "scope",     value: "correlation-24h",       tone: "default" },
    { label: "sources",   value: f.correlatedSources.join(" + ") || "n/a", tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "auditEvidence",
    opts: {
      ...makeLastHoursFilter(24, now),
      fromMissionControl: true,
    },
    label: "Open related ▸",
  };

  return {
    id: `${f.id}-related`,
    stageId: "relatedActivity",
    label: "Related · correlation-24h",
    shortLabel: "Related · correlation-24h",
    kind: "related",
    state: "derived",
    confidence: "derived",
    previewTitle: "Related · other correlation findings",
    previewSummary: "Other correlation findings in the last 24 hours.",
    previewFields,
    primaryAction,
  };
}

function buildFixControlArtifact(f: CorrelationFinding): TriageArtifact {
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "signal_count", value: String(f.correlatedSignalIds.length),     tone: "default" },
    { label: "sources",      value: f.correlatedSources.join(" + ") || "n/a", tone: "default" },
    { label: "severity",     value: f.severity,                                tone: severityTone(f.severity) },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "auditEvidence",
    opts: {
      ...makeQueryFilter(navigationQueryForSignals(f)),
      fromMissionControl: true,
    },
    // Verb taxonomy: "Diagnose" — the operator's first job is determining
    // the operational cause that links the correlated signals.
    label: "Diagnose · open constituent signals ▸",
  };

  return {
    id: `${f.id}-fix-control`,
    stageId: "fixControl",
    label: "Fix · Diagnose constituents",
    shortLabel: "Fix · Diagnose constituents",
    kind: "fix",
    state: "resolved",
    confidence: "exact",
    previewTitle: "Fix / Control · recommended remediation",
    // "Diagnose" is in the canonical ActionVerb taxonomy.
    previewSummary: "Diagnose the constituent signals together — correlation suggests a single root cause across sources. Open each signal in Audit & Evidence and look for a shared upstream trigger.",
    previewFields,
    primaryAction,
  };
}

// ---------------------------------------------------------------------------
// Stage builder
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
// Issue tags
// ---------------------------------------------------------------------------

function buildIssueTags(f: CorrelationFinding): TriageIssueSummary["tags"] {
  const tags: TriageIssueSummary["tags"] = [
    { label: "signals", value: String(f.correlatedSignalIds.length), safe: true },
    { label: "sources", value: f.correlatedSources.join(" + ") || "n/a", safe: true },
    { label: "severity", value: f.severity, safe: true },
  ];
  if (f.confidence) tags.push({ label: "confidence", value: f.confidence, safe: true });
  return tags;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * resolveCorrelationTriageGraph
 *
 * Converts a CorrelationFinding into a fully-populated TriageGraph. Pure: no
 * I/O, no fetch, no side effects.
 *
 * Stage population:
 *   01 Evidence         — finding + evidence trail (resolved when evidence present, else derived).
 *   02 Source Event     — constituent signal IDs (derived).
 *   03 Affected Object  — sharedSessionId (derived) or multi-session (missing).
 *   04 Related Activity — correlation findings in last 24h (derived).
 *   05 Fix / Control    — Diagnose constituent signals together (resolved).
 */
export function resolveCorrelationTriageGraph(
  input: ResolveCorrelationTriageInput,
): TriageGraph {
  const { finding: f, now = new Date() } = input;

  const issue: TriageIssueSummary = {
    id: f.id,
    kind: "correlation",
    title: f.title,
    severity: f.severity,
    status: "open",
    source: "correlation-engine",
    summary: `${f.correlatedSignalIds.length} signals correlated across ${f.correlatedSources.length} source${f.correlatedSources.length === 1 ? "" : "s"} (${f.correlatedSources.join(" + ") || "n/a"}).`,
    tags: buildIssueTags(f),
  };

  const artifacts: TriageArtifact[] = [
    buildEvidenceArtifact(f),
    buildSourceEventArtifact(f),
    buildAffectedObjectArtifact(f),
    buildRelatedActivityArtifact(f, now),
    buildFixControlArtifact(f),
  ];

  const stages: TriageStage[] = TRIAGE_STAGE_ORDER.map((id) => buildStage(id, artifacts));

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
