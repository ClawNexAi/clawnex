/**
 * action-row-resolver.ts
 *
 * WHY: Converts an ActionRow from Mission Control's Action Queue into a safe
 * TriageGraph when the row's source family does not yet have a dedicated deep
 * resolver. This is the Phase 5 fallback — every row can open a triage card,
 * even when the source-specific resolver has not been implemented yet.
 *
 * The function is intentionally pure — no I/O, no fetches, no side effects.
 * Evidence, Source Event, Affected Object, and Related Activity stages are all
 * marked "missing" with explicit "resolver not implemented yet" reasons because
 * the backing data is only available through the row's clickTarget, not through
 * a correlated evidence record. Fix / Control is "derived" when the clickTarget
 * points at a known control-surface tab, mirroring what navigateForRow would do
 * but as a TriageNavigationTarget rather than a live navigation call.
 *
 * Resolver version: action-row-resolver-v1
 */

import type { ActionRow } from "../panels/mission-control/types";
import { formatSuggestedAction } from "../panels/mission-control/types";

/**
 * Helper for legacy callers that took a free-form suggestedAction string.
 * v0.14.x uses structured SuggestedAction; format on read.
 */
function formatSuggestedActionFromRow(row: ActionRow): string {
  return formatSuggestedAction(row.suggestedAction);
}
import type { TabId } from "../types";
import type {
  TriageGraph,
  TriageStage,
  TriageArtifact,
  TriageNavigationTarget,
  TriageStageId,
  TriageIssueSummary,
} from "./types";
import { TRIAGE_STAGE_ORDER } from "./types";

// ---------------------------------------------------------------------------
// Resolver version stamp — bumped when output shape changes materially
// ---------------------------------------------------------------------------

const RESOLVER_VERSION = "action-row-resolver-v1";

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

export interface ResolveActionRowTriageInput {
  row: ActionRow;
  /**
   * "Now" reference for time-window labels. Defaults to new Date() so callers
   * do not need to pass it; tests can inject a fixed value for determinism.
   */
  now?: Date;
  /**
   * Caller's permission set. Reserved for future permission-gated artifacts.
   * Not enforced in v1 — included for interface stability.
   */
  permissions?: Set<string>;
}

// ---------------------------------------------------------------------------
// Control-surface tabs — used to decide whether Fix/Control is "derived"
//
// WHY these four: configuration is the canonical policy/settings surface;
// agents is the session/agent management surface; shield and shieldTests are
// the detection-rule surfaces. All four represent meaningful operator control
// points rather than read-only drill-down destinations.
// ---------------------------------------------------------------------------

const CONTROL_TABS: Set<TabId> = new Set<TabId>([
  "configuration",
  "agents",
  "shield",
  "shieldTests",
]);

// ---------------------------------------------------------------------------
// Stage metadata — mirrors alert-resolver.ts exactly
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
// Severity tone helper
// ---------------------------------------------------------------------------

function severityTone(
  sev: ActionRow["severity"],
): "danger" | "warn" | "default" | "muted" {
  if (sev === "CRIT" || sev === "HIGH") return "danger";
  if (sev === "MED" || sev === "WARN") return "warn";
  return "default";
}

// ---------------------------------------------------------------------------
// clickTarget → TriageNavigationTarget conversion
//
// WHY: We must not call navigateForRow() from within an artifact builder —
// that function performs a live navigation side effect. Instead we mirror its
// mapping logic here as a pure conversion, producing a TriageNavigationTarget
// that TriageArtifactPreview can invoke via navigateToTriageTarget only when
// the operator explicitly clicks an action button.
// ---------------------------------------------------------------------------

function rowClickTargetToTriageTarget(row: ActionRow): TriageNavigationTarget | undefined {
  const ct = row.clickTarget;
  if (!ct) return undefined;

  // Mirror navigateForRow's mapping: id > focus > bare tab — plus
  // always set fromMissionControl: true to match the live navigation behaviour.
  const opts = ct.opts;
  let resolvedOpts: TriageNavigationTarget["opts"];
  if (opts?.id) {
    resolvedOpts = { id: opts.id, fromMissionControl: true };
  } else if (opts?.focus) {
    resolvedOpts = { focus: opts.focus, fromMissionControl: true };
  } else {
    resolvedOpts = { fromMissionControl: true };
  }

  return {
    tab: ct.tab,
    opts: resolvedOpts,
    label: row.buttonLabel ?? `Open ${ct.tab} ▸`,
  };
}

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

/**
 * Evidence artifact (stage: evidence)
 *
 * State rules for action-row context:
 *   resolved  — row has a clickTarget AND has an evidence label (exact kind)
 *   derived   — row has a clickTarget but evidence is only signal/health/audit
 *   missing   — no usable navigation target
 */
function buildEvidenceArtifact(row: ActionRow): TriageArtifact {
  const ct = row.clickTarget;
  const evLabel = row.evidence?.label ?? null;

  // "exact" evidence means the row pinpoints a specific audit event
  const isExact = row.evidence?.kind === "exact";
  const state: TriageArtifact["state"] = ct
    ? isExact
      ? "resolved"
      : "derived"
    : "missing";

  const shortLabel = evLabel ? `Evidence · ${evLabel}` : "Evidence";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "Source", value: row.source, tone: "default" },
    { label: "Severity", value: row.severity, tone: severityTone(row.severity) },
  ];
  if (evLabel) {
    // Confidence kind is safe metadata — it describes how the link was made,
    // not the content of the evidence itself.
    previewFields.push({ label: "evidence_kind", value: row.evidence.kind, tone: "muted" });
  }

  const primaryAction = rowClickTargetToTriageTarget(row);

  return {
    id: `${row.id}-evidence`,
    stageId: "evidence",
    label: shortLabel,
    shortLabel,
    kind: "evidence",
    state,
    confidence: state === "resolved" ? "exact" : state === "derived" ? "medium" : undefined,
    previewTitle: shortLabel,
    previewSummary: ct
      ? `Action queue row with ${evLabel ?? "evidence"} — drill into ${ct.tab} for detail.`
      : "No navigation target is available for this action row.",
    previewFields,
    primaryAction,
    reason:
      state === "missing"
        ? "No audit event or navigation target is linked to this action row."
        : undefined,
  };
}

/**
 * Source Event artifact (stage: sourceEvent)
 *
 * Always "missing" — action rows carry only a surface-level NavTarget, not a
 * correlated proxy traffic ID. A source-specific resolver must be implemented
 * to correlate the raw source event for this issue family.
 */
function buildSourceEventArtifact(row: ActionRow): TriageArtifact {
  return {
    id: `${row.id}-source-event`,
    stageId: "sourceEvent",
    label: "Source · pending",
    shortLabel: "Source · pending",
    kind: "source",
    state: "missing",
    previewTitle: `Source Event · ${row.source}`,
    previewSummary:
      "No source event resolver is available for this issue type yet.",
    previewFields: [
      { label: "Source", value: row.source, tone: "default" },
    ],
    reason: "No source event resolver is available for this issue type yet.",
  };
}

/**
 * Affected Object artifact (stage: affectedObject)
 *
 * Always "missing" — action rows do not carry a session ID or object reference
 * that can be resolved without a family-specific resolver.
 */
function buildAffectedObjectArtifact(row: ActionRow): TriageArtifact {
  return {
    id: `${row.id}-object`,
    stageId: "affectedObject",
    label: "Object · pending",
    shortLabel: "Object · pending",
    kind: "object",
    state: "missing",
    previewTitle: `Affected Object · ${row.source}`,
    previewSummary:
      "No affected object is linked for this issue type yet.",
    previewFields: [
      { label: "Source", value: row.source, tone: "default" },
    ],
    reason: "No affected object is linked for this issue type yet.",
  };
}

/**
 * Related Activity artifact (stage: relatedActivity)
 *
 * Always "missing" — without a correlated alert ID or rule key we cannot build
 * a meaningful pre-filtered query. Family-specific resolvers will supply this.
 */
function buildRelatedActivityArtifact(row: ActionRow): TriageArtifact {
  return {
    id: `${row.id}-related`,
    stageId: "relatedActivity",
    label: "Related · pending",
    shortLabel: "Related · pending",
    kind: "related",
    state: "missing",
    previewTitle: `Related Activity · ${row.source}`,
    previewSummary:
      "No related activity has been resolved for this issue yet.",
    previewFields: [
      { label: "Source", value: row.source, tone: "default" },
    ],
    reason: "No related activity has been resolved for this issue yet.",
  };
}

/**
 * Fix / Control artifact (stage: fixControl)
 *
 * State rules:
 *   derived — row's clickTarget.tab is a known control-surface tab (CONTROL_TABS).
 *             This means the row already points at an actionable remediation
 *             surface, so we can derive a useful navigation target.
 *   missing — clickTarget.tab is a read-only drill-down destination, or there
 *             is no clickTarget at all. A family-specific resolver is needed.
 */
function buildFixControlArtifact(row: ActionRow): TriageArtifact {
  const ct = row.clickTarget;
  const isControlTab = ct ? CONTROL_TABS.has(ct.tab) : false;
  const state: TriageArtifact["state"] = isControlTab ? "derived" : "missing";

  const shortLabel = isControlTab
    ? `Fix · ${ct!.tab}`
    : "Fix · pending";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "Source", value: row.source, tone: "default" },
  ];
  if (isControlTab) {
    previewFields.push({ label: "target", value: ct!.tab, tone: "default" });
    previewFields.push({
      label: "suggested_action",
      value: formatSuggestedActionFromRow(row),
      tone: "default",
    });
  }

  const primaryAction = isControlTab ? rowClickTargetToTriageTarget(row) : undefined;

  return {
    id: `${row.id}-fix-control`,
    stageId: "fixControl",
    label: shortLabel,
    shortLabel,
    kind: "fix",
    state,
    confidence: isControlTab ? "derived" : undefined,
    previewTitle: isControlTab
      ? `Fix / Control · ${ct!.tab}`
      : "Fix / Control",
    previewSummary: isControlTab
      ? `Action row points to ${ct!.tab} — a known control surface. Use this to apply a remediation or adjustment.`
      : "No fix or control recommendation is available for this issue type yet.",
    previewFields,
    primaryAction,
    reason: state === "missing"
      ? "No fix or control recommendation is available for this issue type yet."
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Stage builder
// ---------------------------------------------------------------------------

/**
 * buildStage
 *
 * Summarises a stage from the artifacts that belong to it. Lead selection
 * prefers resolved > derived > first artifact in order — matching alert-resolver
 * for consistent stage-header rendering across resolver types.
 */
function buildStage(stageId: TriageStageId, artifacts: TriageArtifact[]): TriageStage {
  const stageArtifacts = artifacts.filter((a) => a.stageId === stageId);
  // Lead = first resolved, then first derived, then unconditional first
  const lead =
    stageArtifacts.find((a) => a.state === "resolved") ??
    stageArtifacts.find((a) => a.state === "derived") ??
    stageArtifacts[0];

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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * resolveActionRowTriageGraph
 *
 * Converts a Mission Control ActionRow into a safe TriageGraph for display in
 * <TriageGraphCard>. Pure: no I/O, no fetch, no side effects.
 *
 * This is the fallback resolver — it produces a TriageGraph that surfaces the
 * row's clickTarget as a navigation action and marks all deeper stages as
 * "missing" with explicit deferred-resolver reasons. Family-specific resolvers
 * (Phase 5) will supersede this for their own row kinds.
 */
export function resolveActionRowTriageGraph(
  input: ResolveActionRowTriageInput,
): TriageGraph {
  const { row, now = new Date() } = input;

  // 1. Map issue summary from safe ActionRow metadata only
  const issue: TriageIssueSummary = {
    id: row.id,
    // Action rows do not carry a distinct issue kind — map from source heuristic.
    // Default to "alert" since most action rows represent alert-grade signals;
    // family-specific resolvers will override this with a more precise kind.
    kind: deriveIssueKind(row.source),
    title: row.title,
    severity: row.severity,
    status: "open",
    source: row.source,
    summary: `${formatSuggestedActionFromRow(row)} — ${row.source}, ${row.severity} severity.`,
    tags: [
      { label: "source", value: row.source, safe: true },
      { label: "evidence_kind", value: row.evidence.kind, safe: true },
      { label: "suggested_action", value: formatSuggestedActionFromRow(row), safe: true },
    ],
    // ActionRow does not carry a creation timestamp; leave createdAt undefined.
  };

  // 2. Build all artifacts in canonical stage order
  const artifacts: TriageArtifact[] = [
    buildEvidenceArtifact(row),
    buildSourceEventArtifact(row),
    buildAffectedObjectArtifact(row),
    buildRelatedActivityArtifact(row),
    buildFixControlArtifact(row),
  ];

  // 3. Build one stage per canonical stage ID, summarised from its artifacts
  const stages: TriageStage[] = TRIAGE_STAGE_ORDER.map((stageId) =>
    buildStage(stageId, artifacts),
  );

  // 4. Default artifact: first resolved, then first derived, then first overall.
  const defaultArtifactId =
    artifacts.find((a) => a.state === "resolved")?.id ??
    artifacts.find((a) => a.state === "derived")?.id ??
    artifacts[0]?.id;

  return {
    issue,
    stages,
    artifacts,
    defaultArtifactId,
    generatedAt: now.toISOString(),
    resolverVersion: RESOLVER_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * deriveIssueKind
 *
 * Heuristic mapping from ActionRow.source to TriageIssueKind.
 * Action rows do not carry a typed issue kind, so we infer from the source
 * string. The fallback is "alert" — accurate for the majority of rows.
 */
function deriveIssueKind(
  source: string,
): TriageIssueSummary["kind"] {
  const s = source.toLowerCase();
  if (s.includes("cost") || s.includes("token")) return "costSignal";
  if (s.includes("trust") || s.includes("audit")) return "trustAudit";
  if (s.includes("infra") || s.includes("connector") || s.includes("health"))
    return "infrastructure";
  if (s.includes("auth") || s.includes("rbac") || s.includes("access"))
    return "authRbac";
  if (s.includes("policy") || s.includes("shield")) return "policyWarning";
  return "alert";
}

/**
 * trimSafe — truncate a string to maxLen chars without cutting mid-word,
 * appending "…" when truncation occurs. Safe for operator-grade UI labels.
 * Mirrors the implementation in alert-resolver.ts.
 */
function trimSafe(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "…";
}
