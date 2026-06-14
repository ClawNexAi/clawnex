/**
 * trust-audit-resolver.ts
 *
 * WHY: Mission Control's Action Queue surfaces trust-audit findings as one of
 * its four primary row sources. The generic action-row fallback resolver leaves
 * 3 of 5 stages as visible "pending" because the ActionRow shape drops the rich
 * fields a TrustAuditFinding actually carries (agentId, recommendedFix,
 * confidence, capabilityPath, containmentState, surfaceId). This per-source
 * resolver consumes the original Finding directly and produces a fully-populated
 * 5-stage TriageGraph so trust-audit drill-downs feel as complete as alert
 * drill-downs.
 *
 * Pure: no I/O, no fetch, no side effects. Mirrors alert-resolver.ts in shape so
 * future per-source resolvers can follow the same template.
 *
 * Resolver version: trust-audit-resolver-v1
 */

import type { TabId } from "../types";
import type { TrustAuditFinding } from "../panels/mission-control/data-hooks";
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

const RESOLVER_VERSION = "trust-audit-resolver-v1";

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

export interface ResolveTrustAuditTriageInput {
  finding: TrustAuditFinding;
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
// Severity normalization
// ---------------------------------------------------------------------------

function normalizeSeverity(sev: TrustAuditFinding["severity"]): TriageIssueSummary["severity"] {
  switch (sev) {
    case "critical": return "CRIT";
    case "high":     return "HIGH";
    case "medium":   return "MED";
    case "low":      return "LOW";
    default:         return "WARN";
  }
}

// ---------------------------------------------------------------------------
// Confidence → evidence-state mapping
//
// verified_* levels mean the rule observed concrete state (runtime, config,
// filesystem). heuristic_inference means the rule fired on a pattern guess.
// undefined or "unknown" defaults to derived (we have evidence but its
// provenance is not declared).
// ---------------------------------------------------------------------------

function evidenceStateFromConfidence(c: TrustAuditFinding["confidence"]): TriageLinkState {
  switch (c) {
    case "verified_runtime":
    case "verified_config":
    case "verified_filesystem":
      return "resolved";
    case "heuristic_inference":
      return "derived";
    case "unknown":
    case undefined:
    default:
      return "derived";
  }
}

function confidenceLabel(c: TrustAuditFinding["confidence"]): string {
  switch (c) {
    case "verified_runtime":    return "verified_runtime";
    case "verified_config":     return "verified_config";
    case "verified_filesystem": return "verified_filesystem";
    case "heuristic_inference": return "heuristic_inference";
    case "unknown":             return "unknown";
    default:                    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

/**
 * Evidence stage — the trust-audit finding itself + its evidence trail.
 */
function buildEvidenceArtifact(f: TrustAuditFinding): TriageArtifact {
  const state = evidenceStateFromConfidence(f.confidence);
  const evidenceCount = f.evidence?.length ?? 0;

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "rule_id",        value: f.ruleId,                                 tone: "default" },
    { label: "evidence_level", value: confidenceLabel(f.confidence),            tone: state === "resolved" ? "good" : "warn" },
  ];
  if (evidenceCount > 0) {
    previewFields.push({
      label: "evidence_items",
      value: String(evidenceCount),
      tone: "default",
    });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "trustAudit",
    opts: { id: f.id, fromMissionControl: true },
    label: "Open in Trust Audit ▸",
  };

  return {
    id: `${f.id}-evidence`,
    stageId: "evidence",
    label: `Evidence · ${f.id}`,
    shortLabel: `Evidence · ${f.id}`,
    kind: "evidence",
    state,
    confidence: state === "resolved" ? "exact" : state === "derived" ? "medium" : undefined,
    previewTitle: `Evidence · ${f.id}`,
    previewSummary: f.whyItMatters
      || `Trust audit finding from rule "${f.ruleId}".`,
    previewFields,
    primaryAction,
    // Spec §10 amendment 2026-05-07: surface the rule-emitted evidence trail
    // (Finding.evidence: string[]) behind the same default-collapsed
    // toggle pattern as alert-resolver's snippet. Each entry is a short
    // server-emitted fact like "agent has tool 'exec'" — operator-summary-
    // grade, no raw payload.
    evidenceTrail:
      f.evidence && f.evidence.length > 0
        ? { items: f.evidence }
        : undefined,
  };
}

/**
 * Source Event stage — the rule evaluation context.
 *
 * Trust-audit findings don't have a single audit-event source like alerts do;
 * the "source" is the rule eval over the live trust posture. We mark this as
 * `derived` and point the operator at the rule itself in Policies & Rules.
 */
function buildSourceEventArtifact(f: TrustAuditFinding): TriageArtifact {
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "rule_id",  value: f.ruleId,                       tone: "default" },
    { label: "severity", value: f.severity.toUpperCase(),       tone: f.severity === "critical" || f.severity === "high" ? "danger" : "warn" },
  ];
  if (f.containmentState && f.containmentState !== "unknown") {
    previewFields.push({
      label: "containment",
      value: f.containmentState,
      tone: f.containmentState === "sandboxed" ? "good" : "warn",
    });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "configuration",
    opts: {
      focus: "policiesAndRules",
      ...makeQueryFilter(f.ruleId),
      fromMissionControl: true,
    },
    label: "Open rule ▸",
  };

  return {
    id: `${f.id}-source-event`,
    stageId: "sourceEvent",
    label: `Source · ${f.ruleId}`,
    shortLabel: `Source · ${f.ruleId}`,
    kind: "source",
    state: "derived",
    confidence: "derived",
    previewTitle: `Source · rule "${f.ruleId}"`,
    previewSummary: `This finding fires when the "${f.ruleId}" rule evaluates the trust posture. Open the rule in Policies & Rules to see its evaluation logic.`,
    previewFields,
    primaryAction,
  };
}

/**
 * Affected Object stage — the agent the finding is bound to.
 *
 * Most trust-audit rules are agent-scoped (agentId set). Posture-level rules
 * that flag configuration risk without targeting a specific agent leave it
 * undefined; we render those as `missing` with a clear reason.
 */
function buildAffectedObjectArtifact(f: TrustAuditFinding): TriageArtifact {
  const hasAgent = typeof f.agentId === "string" && f.agentId.length > 0;
  const state: TriageLinkState = hasAgent ? "resolved" : "missing";

  const shortLabel = hasAgent ? `Object · ${f.agentId}` : "Object · pending";

  const previewFields: TriageArtifact["previewFields"] = hasAgent
    ? [
        { label: "agent_id", value: f.agentId!, tone: "default" },
      ]
    : [];

  if (hasAgent && f.surfaceId) {
    previewFields.push({ label: "surface_id", value: f.surfaceId, tone: "default" });
  }
  if (hasAgent && f.capabilityPath && f.capabilityPath.length > 0) {
    previewFields.push({
      label: "capability_path",
      value: f.capabilityPath.join(" + "),
      tone: "warn",
    });
  }

  const primaryAction: TriageNavigationTarget | undefined = hasAgent
    ? {
        tab: "agents",
        opts: { id: f.agentId!, highlight: f.agentId!, fromMissionControl: true },
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
    confidence: hasAgent ? "exact" : undefined,
    previewTitle: hasAgent ? `Affected Object · agent "${f.agentId}"` : "Affected Object · posture-level",
    previewSummary: hasAgent
      ? `Agent "${f.agentId}" is the subject of this finding.${f.surfaceId ? ` Reachable via "${f.surfaceId}".` : ""}`
      : "This finding flags a configuration-level posture risk and is not bound to a specific agent.",
    previewFields,
    primaryAction,
    reason: hasAgent
      ? undefined
      : "This finding flags a configuration-level posture risk and is not bound to a specific agent.",
  };
}

/**
 * Related Activity stage — other findings from the same rule across the fleet.
 *
 * When the finding is agent-scoped we prefer "other findings on this agent";
 * otherwise we fall back to "other findings from this rule." Both are derived
 * queries — `derived` state — pointing back to the Trust Audit panel pre-filtered.
 */
function buildRelatedActivityArtifact(f: TrustAuditFinding, now: Date): TriageArtifact {
  const hasAgent = typeof f.agentId === "string" && f.agentId.length > 0;
  const queryStr = hasAgent ? f.agentId! : f.ruleId;
  const scopeLabel = hasAgent ? "same-agent" : "same-rule";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "scope", value: scopeLabel, tone: "default" },
    { label: "query", value: queryStr,   tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "trustAudit",
    opts: {
      ...makeLastHoursFilter(24, now),
      ...makeQueryFilter(queryStr),
      fromMissionControl: true,
    },
    label: "Open related ▸",
  };

  return {
    id: `${f.id}-related`,
    stageId: "relatedActivity",
    label: `Related · ${scopeLabel}`,
    shortLabel: `Related · ${scopeLabel}`,
    kind: "related",
    state: "derived",
    confidence: "derived",
    previewTitle: hasAgent ? `Related · other findings on agent "${f.agentId}"` : `Related · other "${f.ruleId}" findings`,
    previewSummary: hasAgent
      ? `Other Trust Audit findings flagged on agent "${f.agentId}" in the last 24 hours.`
      : `Other findings from the "${f.ruleId}" rule across the fleet in the last 24 hours.`,
    previewFields,
    primaryAction,
  };
}

/**
 * Fix / Control stage — the rule's recommended remediation.
 *
 * Trust-audit rules emit a `recommendedFix` narrative. We surface it as the
 * Fix/Control preview summary and route the primary action to Policies & Rules
 * pre-filtered to the rule that fired.
 */
function buildFixControlArtifact(f: TrustAuditFinding): TriageArtifact {
  const hasFix = typeof f.recommendedFix === "string" && f.recommendedFix.length > 0;

  const shortLabel = hasFix ? "Fix · Policies & Rules" : "Fix · review controls";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "rule_id", value: f.ruleId, tone: "default" },
  ];
  if (f.containmentState && f.containmentState !== "unknown") {
    previewFields.push({
      label: "containment_state",
      value: f.containmentState,
      tone: f.containmentState === "sandboxed" ? "good" : "warn",
    });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "configuration",
    opts: {
      focus: "policiesAndRules",
      ...makeQueryFilter(f.ruleId),
      fromMissionControl: true,
    },
    label: "Open in Policies & Rules ▸",
  };

  return {
    id: `${f.id}-fix-control`,
    stageId: "fixControl",
    label: shortLabel,
    shortLabel,
    kind: "fix",
    state: hasFix ? "resolved" : "derived",
    confidence: hasFix ? "exact" : "derived",
    previewTitle: "Fix / Control · recommended remediation",
    previewSummary: hasFix
      ? f.recommendedFix!
      : `Open the "${f.ruleId}" rule in Policies & Rules to review controls and apply a scoped remediation.`,
    previewFields,
    primaryAction,
  };
}

// ---------------------------------------------------------------------------
// Stage builder — mirrors alert-resolver / action-row-resolver pattern
// ---------------------------------------------------------------------------

function buildStage(stageId: TriageStageId, artifacts: TriageArtifact[]): TriageStage {
  const stageArtifacts = artifacts.filter((a) => a.stageId === stageId);
  // Lead = first resolved, then first derived, then unconditional first.
  const lead =
    stageArtifacts.find((a) => a.state === "resolved") ??
    stageArtifacts.find((a) => a.state === "derived") ??
    stageArtifacts[0];

  // Stage summary copy: keep it short — operators see this in the 5-card stepper
  // where vertical density matters. Use the lead's previewSummary truncated, or
  // fall back to its reason.
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
// Issue-summary tag derivation
//
// Tags are operator-visible chips on the triage card header. For trust-audit
// we surface 3 tags max: rule id, agent id (when scoped), surface (when set).
// All values come from the Finding directly — no payload exposure risk.
// ---------------------------------------------------------------------------

function buildIssueTags(f: TrustAuditFinding): TriageIssueSummary["tags"] {
  const tags: TriageIssueSummary["tags"] = [
    { label: "rule",  value: f.ruleId, safe: true },
  ];
  if (f.agentId)   tags.push({ label: "agent",   value: f.agentId,   safe: true });
  if (f.surfaceId) tags.push({ label: "surface", value: f.surfaceId, safe: true });
  return tags;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * resolveTrustAuditTriageGraph
 *
 * Converts a TrustAuditFinding into a fully-populated TriageGraph for display
 * in <TriageGraphCard>. Pure: no I/O, no fetch, no side effects.
 *
 * Stage population:
 *   01 Evidence         — the finding itself, evidence trail count, confidence level
 *   02 Source Event     — the rule eval (derived, points at the rule in Policies)
 *   03 Affected Object  — the agent (resolved when agentId set; missing for posture rules)
 *   04 Related Activity — same-agent or same-rule query (derived)
 *   05 Fix / Control    — the rule's recommendedFix (resolved when set)
 */
export function resolveTrustAuditTriageGraph(
  input: ResolveTrustAuditTriageInput,
): TriageGraph {
  const { finding: f, now = new Date() } = input;

  // 1. Issue summary from safe Finding fields only
  const issue: TriageIssueSummary = {
    id: f.id,
    kind: "trustAudit",
    title: f.title,
    severity: normalizeSeverity(f.severity),
    status: "open",
    source: "trust-audit",
    summary: f.whyItMatters || `Trust audit finding from rule "${f.ruleId}".`,
    tags: buildIssueTags(f),
  };

  // 2. Build artifacts in canonical stage order
  const artifacts: TriageArtifact[] = [
    buildEvidenceArtifact(f),
    buildSourceEventArtifact(f),
    buildAffectedObjectArtifact(f),
    buildRelatedActivityArtifact(f, now),
    buildFixControlArtifact(f),
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
