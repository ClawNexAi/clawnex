/**
 * blast-radius-resolver.ts
 *
 * WHY: Mission Control's Action Queue surfaces blast-radius findings — a
 * single root signal that the analyzer determined affects N agents/sessions
 * via some propagation vector (shared credential, shared tool, shared policy,
 * shared session template). The generic action-row fallback resolver leaves
 * Source Event / Affected Object / Related Activity as visible "pending"
 * because the ActionRow shape drops the rich blast-radius fields
 * (rootSignalId, vector, affectedSessionIds). This per-source resolver
 * consumes the original BlastRadiusFinding directly and produces a fully-
 * populated 5-stage TriageGraph.
 *
 * Family invariant: the Fix/Control verb is vector-driven. shared_credential
 * → Rotate credential, shared_tool / shared_policy → Restrict capability,
 * shared_session_template → Contain agent, unknown → Diagnose. This mapping
 * comes from the canonical ActionVerb taxonomy in mission-control/types.ts —
 * verb-led copy stays inside the closed enum so the reviewer's verb verifier passes.
 *
 * Pure: no I/O, no fetch, no side effects.
 *
 * Resolver version: blast-radius-resolver-v1
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

const RESOLVER_VERSION = "blast-radius-resolver-v1";

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

export interface BlastRadiusFinding {
  id: string;
  title: string;
  severity: "CRIT" | "HIGH" | "MED" | "WARN" | "LOW";
  /** The originating signal/alert that triggered the analysis. */
  rootSignalId: string;
  /** Source kind of the root signal: "alert" | "cost-signal" | "audit-finding" | "policy-warning". */
  rootSignalKind: string;
  /** Sessions/agents impacted by the root. */
  affectedSessionIds: string[];
  /** Detected propagation vector if known. */
  vector:
    | "shared_credential"
    | "shared_tool"
    | "shared_policy"
    | "shared_session_template"
    | "unknown";
  /** ms epoch range of the blast window. */
  windowStartMs: number;
  windowEndMs: number;
  evidence?: string[];
}

export interface ResolveBlastRadiusTriageInput {
  finding: BlastRadiusFinding;
  /** "Now" reference for time-window labels. Defaults to new Date(). */
  now?: Date;
  /** Reserved for future permission-gated artifacts. Not enforced in v1. */
  permissions?: Set<string>;
}

// ---------------------------------------------------------------------------
// Stage metadata
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
// Vector → ActionVerb mapping
//
// Drives Fix/Control copy. Each return value uses one of the 11 canonical
// verbs from ACTION_VERBS in mission-control/types.ts. Keep these strings
// exact — the reviewer's verb verifier scans for synonym drift.
// ---------------------------------------------------------------------------

type FixVerb = "Rotate credential" | "Restrict capability" | "Contain agent" | "Diagnose";

function verbForVector(v: BlastRadiusFinding["vector"]): FixVerb {
  switch (v) {
    case "shared_credential":       return "Rotate credential";
    case "shared_tool":             return "Restrict capability";
    case "shared_policy":           return "Restrict capability";
    case "shared_session_template": return "Contain agent";
    case "unknown":
    default:                        return "Diagnose";
  }
}

function vectorLabel(v: BlastRadiusFinding["vector"]): string {
  switch (v) {
    case "shared_credential":       return "shared credential";
    case "shared_tool":             return "shared tool";
    case "shared_policy":           return "shared policy";
    case "shared_session_template": return "shared session template";
    default:                        return "unknown vector";
  }
}

function prescriptiveFixForVector(v: BlastRadiusFinding["vector"], affectedCount: number): string {
  const verb = verbForVector(v);
  switch (v) {
    case "shared_credential":
      return `${verb}: rotate the shared credential bound to all ${affectedCount} affected sessions. Revoke the old credential after rotation propagates.`;
    case "shared_tool":
      return `${verb}: narrow the shared tool grant. ${affectedCount} agents share this capability — scope it down or remove it from the affected agents.`;
    case "shared_policy":
      return `${verb}: reduce the shared policy scope. ${affectedCount} agents inherit this rule — split the policy or carve out the affected agents.`;
    case "shared_session_template":
      return `${verb}: isolate the affected agents. They share a session template that propagated the root signal — quarantine the template and re-template surviving sessions.`;
    case "unknown":
    default:
      return `${verb} the propagation path. The blast vector is undetermined — open the root signal and the affected sessions to find a shared upstream cause.`;
  }
}

// ---------------------------------------------------------------------------
// Source-event tab routing — the root signal's source family decides where
// the operator drills back to.
// ---------------------------------------------------------------------------

function sourceTabForRootKind(kind: string): "alertsIncidents" | "tokenCost" | "trustAudit" | "shield" | "auditEvidence" {
  const k = kind.toLowerCase();
  if (k.includes("cost"))   return "tokenCost";
  if (k.includes("audit") || k.includes("trust")) return "trustAudit";
  if (k.includes("policy") || k.includes("shield")) return "shield";
  if (k.includes("alert")) return "alertsIncidents";
  return "auditEvidence";
}

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

function buildEvidenceArtifact(f: BlastRadiusFinding): TriageArtifact {
  const evidenceCount = f.evidence?.length ?? 0;
  const hasEvidence = evidenceCount > 0;
  const state: TriageLinkState = hasEvidence ? "resolved" : "derived";
  const affectedCount = f.affectedSessionIds.length;

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "root_signal",     value: f.rootSignalId,                 tone: "default" },
    { label: "vector",          value: vectorLabel(f.vector),          tone: f.vector === "unknown" ? "warn" : "default" },
    { label: "affected_count",  value: String(affectedCount),          tone: affectedCount > 5 ? "danger" : "warn" },
  ];
  if (hasEvidence) {
    previewFields.push({ label: "evidence_items", value: String(evidenceCount), tone: "default" });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "blastRadius",
    opts: { id: f.id, fromMissionControl: true },
    label: "Open in Blast Radius ▸",
  };

  return {
    id: `${f.id}-evidence`,
    stageId: "evidence",
    label: `Evidence · ${affectedCount} affected`,
    shortLabel: `Evidence · ${affectedCount} affected`,
    kind: "evidence",
    state,
    confidence: state === "resolved" ? "exact" : "derived",
    previewTitle: `Blast Radius · ${affectedCount} affected via ${vectorLabel(f.vector)}`,
    previewSummary: `Root signal "${f.rootSignalId}" affects ${affectedCount} session${affectedCount === 1 ? "" : "s"} via ${vectorLabel(f.vector)}.`,
    previewFields,
    primaryAction,
    evidenceTrail: hasEvidence ? { items: f.evidence! } : undefined,
  };
}

function buildSourceEventArtifact(f: BlastRadiusFinding): TriageArtifact {
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "root_signal_id",   value: f.rootSignalId,        tone: "default" },
    { label: "root_signal_kind", value: f.rootSignalKind,      tone: "default" },
  ];

  const tab = sourceTabForRootKind(f.rootSignalKind);
  const primaryAction: TriageNavigationTarget = {
    tab,
    opts: {
      ...makeQueryFilter(f.rootSignalId),
      fromMissionControl: true,
    },
    label: "Open root signal ▸",
  };

  return {
    id: `${f.id}-source-event`,
    stageId: "sourceEvent",
    label: `Source · ${f.rootSignalKind}`,
    shortLabel: `Source · ${f.rootSignalKind}`,
    kind: "source",
    state: "derived",
    confidence: "derived",
    previewTitle: `Source · root signal (${f.rootSignalKind})`,
    previewSummary: `Blast radius analysis was triggered by root signal "${f.rootSignalId}" of kind "${f.rootSignalKind}". Drill back into the source family to open the originating event.`,
    previewFields,
    primaryAction,
  };
}

function buildAffectedObjectArtifact(f: BlastRadiusFinding): TriageArtifact {
  const affected = f.affectedSessionIds;
  const count = affected.length;
  const hasAny = count > 0;
  const isSingle = count === 1;

  const state: TriageLinkState = hasAny ? "derived" : "missing";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "affected_count", value: String(count), tone: count > 5 ? "danger" : "warn" },
    { label: "vector",         value: vectorLabel(f.vector), tone: "default" },
  ];
  affected.slice(0, 3).forEach((sid, i) => {
    previewFields.push({ label: `session_${i + 1}`, value: sid, tone: "muted" });
  });
  if (count > 3) {
    previewFields.push({
      label: "additional_sessions",
      value: `+${count - 3} more`,
      tone: "muted",
    });
  }

  // Single-session case → drill straight to the agent. Multi-session case →
  // open the agents tab without an id so the user sees the list and can pick.
  // No clean multi-id filter shape exists yet, so we omit opts when count > 1.
  const primaryAction: TriageNavigationTarget | undefined = hasAny
    ? isSingle
      ? {
          tab: "agents",
          opts: { id: affected[0], highlight: affected[0], fromMissionControl: true },
          label: "Open agent ▸",
        }
      : {
          tab: "agents",
          opts: { fromMissionControl: true },
          label: "Open agents ▸",
        }
    : undefined;

  return {
    id: `${f.id}-object`,
    stageId: "affectedObject",
    label: hasAny ? `Object · ${count} session${isSingle ? "" : "s"}` : "Object · pending",
    shortLabel: hasAny ? `Object · ${count} session${isSingle ? "" : "s"}` : "Object · pending",
    kind: "object",
    state,
    confidence: hasAny ? (isSingle ? "exact" : "medium") : undefined,
    previewTitle: hasAny
      ? `Affected Object · ${count} session${isSingle ? "" : "s"}`
      : "Affected Object · none resolved",
    previewSummary: hasAny
      ? isSingle
        ? `Session "${affected[0]}" is the sole impacted agent.`
        : `${count} sessions impacted via ${vectorLabel(f.vector)}. Open the agents tab to triage individual sessions.`
      : "No sessions are bound to this blast-radius finding yet.",
    previewFields,
    primaryAction,
    reason: hasAny ? undefined : "No sessions are bound to this blast-radius finding yet.",
  };
}

function buildRelatedActivityArtifact(f: BlastRadiusFinding, now: Date): TriageArtifact {
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "scope",  value: "blast-radius-24h", tone: "default" },
    { label: "vector", value: vectorLabel(f.vector), tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "blastRadius",
    opts: {
      ...makeLastHoursFilter(24, now),
      fromMissionControl: true,
    },
    label: "Open related ▸",
  };

  return {
    id: `${f.id}-related`,
    stageId: "relatedActivity",
    label: "Related · blast-radius-24h",
    shortLabel: "Related · blast-radius-24h",
    kind: "related",
    state: "derived",
    confidence: "derived",
    previewTitle: "Related · other blast-radius findings",
    previewSummary: "Other blast-radius findings in the last 24 hours.",
    previewFields,
    primaryAction,
  };
}

function buildFixControlArtifact(f: BlastRadiusFinding): TriageArtifact {
  const verb = verbForVector(f.vector);
  const affected = f.affectedSessionIds;
  const count = affected.length;
  const isSingle = count === 1;

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "vector",         value: vectorLabel(f.vector),  tone: "default" },
    { label: "affected_count", value: String(count),          tone: count > 5 ? "danger" : "warn" },
    { label: "verb",           value: verb,                   tone: "default" },
  ];

  // Drill straight to the offending agent when there's only one; otherwise
  // open the agents list. This matches Affected Object's logic so the
  // operator sees consistent navigation between the two stages.
  const primaryAction: TriageNavigationTarget = isSingle
    ? {
        tab: "agents",
        opts: { id: affected[0], highlight: affected[0], fromMissionControl: true },
        label: `${verb} ▸`,
      }
    : {
        tab: "agents",
        opts: { fromMissionControl: true },
        label: `${verb} ▸`,
      };

  return {
    id: `${f.id}-fix-control`,
    stageId: "fixControl",
    label: `Fix · ${verb}`,
    shortLabel: `Fix · ${verb}`,
    kind: "fix",
    state: "resolved",
    confidence: "exact",
    previewTitle: "Fix / Control · recommended remediation",
    previewSummary: prescriptiveFixForVector(f.vector, count),
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

function buildIssueTags(f: BlastRadiusFinding): TriageIssueSummary["tags"] {
  return [
    { label: "vector",         value: f.vector,                          safe: true },
    { label: "affected",       value: String(f.affectedSessionIds.length), safe: true },
    { label: "root_kind",      value: f.rootSignalKind,                  safe: true },
    { label: "severity",       value: f.severity,                        safe: true },
  ];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * resolveBlastRadiusTriageGraph
 *
 * Converts a BlastRadiusFinding into a fully-populated TriageGraph. Pure: no
 * I/O, no fetch, no side effects.
 *
 * Stage population:
 *   01 Evidence         — root signal + vector + affected count (resolved when evidence present, else derived).
 *   02 Source Event     — root signal of the originating family (derived).
 *   03 Affected Object  — affected sessions (derived; single-id vs multi-id).
 *   04 Related Activity — blast-radius findings in last 24h (derived).
 *   05 Fix / Control    — vector-driven verb (resolved).
 */
export function resolveBlastRadiusTriageGraph(
  input: ResolveBlastRadiusTriageInput,
): TriageGraph {
  const { finding: f, now = new Date() } = input;

  const issue: TriageIssueSummary = {
    id: f.id,
    kind: "blastRadius",
    title: f.title,
    severity: f.severity,
    status: "open",
    source: "blast-radius",
    summary: `Root signal "${f.rootSignalId}" affects ${f.affectedSessionIds.length} session${f.affectedSessionIds.length === 1 ? "" : "s"} via ${vectorLabel(f.vector)}.`,
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
