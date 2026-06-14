import type { TabId } from "../types";
import type { NavigateOpts } from "../url-state";

export type TriageIssueKind =
  | "alert"
  | "costSignal"
  | "correlation"
  | "trustAudit"
  | "blastRadius"
  | "infrastructure"
  | "authRbac"
  | "updateCve"
  | "policyWarning";

export type TriageStageId =
  | "evidence"
  | "sourceEvent"
  | "affectedObject"
  | "relatedActivity"
  | "fixControl";

export type TriageLinkState =
  | "resolved"
  | "missing"
  | "restricted"
  | "stale"
  | "derived"
  | "loading";

export type TriageArtifactKind =
  | "evidence"
  | "source"
  | "rule"
  | "object"
  | "related"
  | "fix"
  | "custom";

export type TriageTone = "default" | "good" | "warn" | "danger" | "muted";

export interface TriageNavigationTarget {
  tab: TabId;
  opts?: NavigateOpts;
  label?: string;
}

export interface TriagePreviewField {
  label: string;
  value: string;
  tone?: TriageTone;
}

/**
 * Optional snippet payload for the Evidence stage of an alert-derived
 * artifact. The Shield server-side-redacts these fields before storage
 * (matched-span context with PII masked); the triage card surfaces them
 * behind a default-collapsed "Show match span" toggle so operators can make
 * a fast allow/block decision without drilling into Audit & Evidence.
 *
 * Spec §10 amendment 2026-05-07: pre-redacted snippet_before / snippet_match
 * / snippet_after MAY be surfaced in the Evidence stage. Raw bulk-payload
 * fields and request/response bodies remain forbidden.
 */
export interface TriageEvidenceSnippet {
  before?: string;
  match: string;
  after?: string;
  /** Optional rule id for the matched span — when set, rendered as a chip. */
  ruleKey?: string;
}

/**
 * Optional evidence-trail payload for the Evidence stage of a trust-audit-
 * derived artifact. Trust-audit Findings carry an `evidence: string[]`
 * array — short rule-emitted facts like "agent has tool 'exec'". The card
 * surfaces them behind the same "Show evidence trail" toggle pattern as
 * the alert snippet, so operators can read the rule's observations inline
 * instead of drilling into Trust Audit.
 */
export interface TriageEvidenceTrail {
  /** One short observation per array entry. Server-emitted; no raw payload. */
  items: string[];
}

export interface TriageArtifact {
  id: string;
  stageId: TriageStageId;
  label: string;
  shortLabel: string;
  kind: TriageArtifactKind;
  state: TriageLinkState;
  confidence?: "exact" | "high" | "medium" | "low" | "derived";
  previewTitle: string;
  previewSummary: string;
  previewFields: TriagePreviewField[];
  primaryAction?: TriageNavigationTarget;
  secondaryActions?: TriageNavigationTarget[];
  reason?: string;
  permission?: string;
  lastResolvedAt?: string;
  /**
   * Optional pre-redacted match-span snippet (alert resolver only). Default-
   * collapsed in TriageArtifactPreview; operator opts in via "Show match
   * span" toggle. Spec §10 amendment 2026-05-07.
   */
  evidenceSnippet?: TriageEvidenceSnippet;
  /**
   * Optional evidence-trail strings (trust-audit resolver only). Default-
   * collapsed via "Show evidence trail" toggle. Same UX shape as
   * evidenceSnippet but renders as a list of short facts, not a
   * before/match/after span.
   */
  evidenceTrail?: TriageEvidenceTrail;
}

export interface TriageStage {
  id: TriageStageId;
  title: string;
  eyebrow: string;
  state: TriageLinkState;
  summary: string;
  artifactIds: string[];
  reason?: string;
}

export interface TriageIssueSummary {
  id: string;
  kind: TriageIssueKind;
  title: string;
  severity?: "CRIT" | "HIGH" | "MED" | "WARN" | "LOW";
  status?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  summary: string;
  tags: Array<{ label: string; value: string; safe: true }>;
}

export interface TriageGraph {
  issue: TriageIssueSummary;
  stages: TriageStage[];
  artifacts: TriageArtifact[];
  defaultArtifactId?: string;
  generatedAt: string;
  resolverVersion: string;
}

export const TRIAGE_STAGE_ORDER: TriageStageId[] = [
  "evidence",
  "sourceEvent",
  "affectedObject",
  "relatedActivity",
  "fixControl",
];
