/**
 * policy-warning-resolver.ts
 *
 * WHY: Mission Control's Action Queue surfaces policy/rule warnings — Shield
 * rule misfires, low-confidence rules, policy defaults that need tuning,
 * config-drift findings. The generic action-row fallback resolver leaves
 * Source Event / Affected Object / Related Activity as visible "pending"
 * because the ActionRow shape drops the rich policy fields (ruleKey, scope,
 * suggestedChange, recentFiringCount). This per-source resolver consumes the
 * original PolicyWarningFinding directly and produces a fully-populated
 * 5-stage TriageGraph.
 *
 * Family invariant: the Fix/Control verb is always "Update policy" — that's
 * the canonical taxonomy verb for changing a routing/shield/cost policy.
 * Verb-led copy stays inside the closed enum so the reviewer's verb verifier passes.
 *
 * Pure: no I/O, no fetch, no side effects.
 *
 * Resolver version: policy-warning-resolver-v1
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

const RESOLVER_VERSION = "policy-warning-resolver-v1";

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

export type PolicyWarningScope = "shield_rule" | "policy_default" | "config_drift";

export interface PolicyWarningFinding {
  id: string;
  title: string;
  severity: "CRIT" | "HIGH" | "MED" | "WARN" | "LOW";
  ruleKey: string;
  scope: PolicyWarningScope;
  /** Suggested rule change in human terms. */
  suggestedChange?: string;
  /** Recent firing count to give the operator scale. */
  recentFiringCount?: number;
  evidence?: string[];
}

export interface ResolvePolicyWarningTriageInput {
  finding: PolicyWarningFinding;
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
// Helpers
// ---------------------------------------------------------------------------

function scopeLabel(s: PolicyWarningScope): string {
  switch (s) {
    case "shield_rule":      return "Shield rule";
    case "policy_default":   return "Policy default";
    case "config_drift":     return "Config drift";
  }
}

function scopeExplanation(s: PolicyWarningScope, ruleKey: string): string {
  switch (s) {
    case "shield_rule":
      return `The "${ruleKey}" rule lives in the Shield detector pipeline and is the subject of this warning.`;
    case "policy_default":
      return `The "${ruleKey}" policy default governs out-of-the-box behavior for affected scopes — verify whether the default still matches the operator's intent.`;
    case "config_drift":
      return `The "${ruleKey}" config has drifted from its declared policy baseline. Reconcile the live state with the declared baseline.`;
  }
}

function severityTone(sev: PolicyWarningFinding["severity"]): "danger" | "warn" | "default" {
  if (sev === "CRIT" || sev === "HIGH") return "danger";
  if (sev === "MED" || sev === "WARN") return "warn";
  return "default";
}

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

function buildEvidenceArtifact(f: PolicyWarningFinding): TriageArtifact {
  const evidenceCount = f.evidence?.length ?? 0;
  const hasEvidence = evidenceCount > 0;
  const state: TriageLinkState = hasEvidence ? "resolved" : "derived";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "rule_key", value: f.ruleKey,        tone: "default" },
    { label: "scope",    value: scopeLabel(f.scope), tone: "default" },
    { label: "severity", value: f.severity,        tone: severityTone(f.severity) },
  ];
  if (typeof f.recentFiringCount === "number") {
    previewFields.push({
      label: "recent_firings",
      value: String(f.recentFiringCount),
      tone: f.recentFiringCount > 100 ? "danger" : f.recentFiringCount > 10 ? "warn" : "default",
    });
  }
  if (hasEvidence) previewFields.push({ label: "evidence_items", value: String(evidenceCount), tone: "default" });

  const primaryAction: TriageNavigationTarget = {
    tab: "shield",
    opts: {
      focus: f.ruleKey,
      ...makeQueryFilter(f.ruleKey),
      fromMissionControl: true,
    },
    label: "Open in Shield ▸",
  };

  return {
    id: `${f.id}-evidence`,
    stageId: "evidence",
    label: `Evidence · ${f.ruleKey}`,
    shortLabel: `Evidence · ${f.ruleKey}`,
    kind: "evidence",
    state,
    confidence: state === "resolved" ? "exact" : "derived",
    previewTitle: `Policy Warning · ${f.ruleKey}`,
    previewSummary: f.title || `Policy warning: rule "${f.ruleKey}" needs operator attention.`,
    previewFields,
    primaryAction,
    evidenceTrail: hasEvidence ? { items: f.evidence! } : undefined,
  };
}

function buildSourceEventArtifact(f: PolicyWarningFinding): TriageArtifact {
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "rule_key", value: f.ruleKey,        tone: "default" },
    { label: "scope",    value: scopeLabel(f.scope), tone: "default" },
  ];
  if (typeof f.recentFiringCount === "number") {
    previewFields.push({
      label: "recent_firings",
      value: String(f.recentFiringCount),
      tone: f.recentFiringCount > 100 ? "danger" : "default",
    });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "shield",
    opts: {
      focus: f.ruleKey,
      ...makeQueryFilter(f.ruleKey),
      fromMissionControl: true,
    },
    label: "Open rule ▸",
  };

  return {
    id: `${f.id}-source-event`,
    stageId: "sourceEvent",
    label: `Source · ${f.ruleKey}`,
    shortLabel: `Source · ${f.ruleKey}`,
    kind: "source",
    state: "derived",
    confidence: "derived",
    previewTitle: `Source · rule "${f.ruleKey}"`,
    previewSummary: `This warning was emitted by the policy analyzer evaluating "${f.ruleKey}". Open the rule in Shield to read its evaluation logic and recent firings.`,
    previewFields,
    primaryAction,
  };
}

function buildAffectedObjectArtifact(f: PolicyWarningFinding): TriageArtifact {
  // The "affected object" is the rule itself — resolved because we know
  // exactly which rule + scope is the subject. The scope explains the blast
  // radius (a single Shield rule, a fleet-wide policy default, or a drift
  // between declared and live config).
  const state: TriageLinkState = "resolved";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "rule_key", value: f.ruleKey,           tone: "default" },
    { label: "scope",    value: scopeLabel(f.scope), tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "shield",
    opts: {
      focus: f.ruleKey,
      ...makeQueryFilter(f.ruleKey),
      highlight: f.ruleKey,
      fromMissionControl: true,
    },
    label: "Open rule ▸",
  };

  return {
    id: `${f.id}-object`,
    stageId: "affectedObject",
    label: `Object · ${f.ruleKey}`,
    shortLabel: `Object · ${f.ruleKey}`,
    kind: "object",
    state,
    confidence: "exact",
    previewTitle: `Affected Object · ${scopeLabel(f.scope)}`,
    previewSummary: scopeExplanation(f.scope, f.ruleKey),
    previewFields,
    primaryAction,
  };
}

function buildRelatedActivityArtifact(f: PolicyWarningFinding, now: Date): TriageArtifact {
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "scope",    value: "same-rule-24h", tone: "default" },
    { label: "rule_key", value: f.ruleKey,       tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: "shield",
    opts: {
      focus: f.ruleKey,
      ...makeLastHoursFilter(24, now),
      ...makeQueryFilter(f.ruleKey),
      fromMissionControl: true,
    },
    label: "Open related ▸",
  };

  return {
    id: `${f.id}-related`,
    stageId: "relatedActivity",
    label: "Related · same-rule-24h",
    shortLabel: "Related · same-rule-24h",
    kind: "related",
    state: "derived",
    confidence: "derived",
    previewTitle: `Related · other warnings on rule "${f.ruleKey}"`,
    previewSummary: `Other warnings against the "${f.ruleKey}" rule in the last 24 hours.`,
    previewFields,
    primaryAction,
  };
}

function buildFixControlArtifact(f: PolicyWarningFinding): TriageArtifact {
  // Verb taxonomy: "Update policy" — the canonical verb for changing a
  // routing/shield/cost policy. Locked at the const so synonym drift is
  // mechanically impossible inside this resolver.
  const verb = "Update policy";
  const hasSuggested = typeof f.suggestedChange === "string" && f.suggestedChange.length > 0;

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "rule_key", value: f.ruleKey,           tone: "default" },
    { label: "scope",    value: scopeLabel(f.scope), tone: "default" },
    { label: "verb",     value: verb,                tone: "default" },
  ];
  if (typeof f.recentFiringCount === "number") {
    previewFields.push({
      label: "recent_firings",
      value: String(f.recentFiringCount),
      tone: f.recentFiringCount > 100 ? "danger" : "default",
    });
  }

  const primaryAction: TriageNavigationTarget = {
    tab: "shield",
    opts: {
      focus: f.ruleKey,
      ...makeQueryFilter(f.ruleKey),
      fromMissionControl: true,
    },
    label: `${verb} ▸`,
  };

  // Prescriptive copy — the suggested-change narrative when the analyzer
  // emitted one, otherwise a generic-but-actionable fallback. Verb appears
  // verbatim in the leading sentence.
  const summary = hasSuggested
    ? `${verb}: ${f.suggestedChange}`
    : `${verb}: tune the "${f.ruleKey}" rule in Shield. Adjust its match criteria or scope based on the recent firings — no specific change was emitted by the analyzer.`;

  return {
    id: `${f.id}-fix-control`,
    stageId: "fixControl",
    label: `Fix · ${verb}`,
    shortLabel: `Fix · ${verb}`,
    kind: "fix",
    state: "resolved",
    confidence: "exact",
    previewTitle: "Fix / Control · recommended remediation",
    previewSummary: summary,
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

function buildIssueTags(f: PolicyWarningFinding): TriageIssueSummary["tags"] {
  const tags: TriageIssueSummary["tags"] = [
    { label: "rule_key", value: f.ruleKey,    safe: true },
    { label: "scope",    value: f.scope,      safe: true },
    { label: "severity", value: f.severity,   safe: true },
  ];
  if (typeof f.recentFiringCount === "number") {
    tags.push({ label: "recent_firings", value: String(f.recentFiringCount), safe: true });
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * resolvePolicyWarningTriageGraph
 *
 * Converts a PolicyWarningFinding into a fully-populated TriageGraph. Pure:
 * no I/O, no fetch, no side effects.
 *
 * Stage population:
 *   01 Evidence         — rule + scope + recent firings (resolved when evidence present, else derived).
 *   02 Source Event     — the rule itself (derived).
 *   03 Affected Object  — rule + scope explanation (resolved).
 *   04 Related Activity — same-rule warnings in last 24h (derived).
 *   05 Fix / Control    — Update policy verb with suggested change (resolved).
 */
export function resolvePolicyWarningTriageGraph(
  input: ResolvePolicyWarningTriageInput,
): TriageGraph {
  const { finding: f, now = new Date() } = input;

  const issue: TriageIssueSummary = {
    id: f.id,
    kind: "policyWarning",
    title: f.title,
    severity: f.severity,
    status: "open",
    source: "policy-analyzer",
    summary: f.title || `Policy warning on rule "${f.ruleKey}" (${scopeLabel(f.scope)}).`,
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
