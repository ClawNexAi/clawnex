/**
 * auth-rbac-resolver.ts
 *
 * WHY: Mission Control's Action Queue surfaces auth/RBAC findings — RBAC-off
 * defenses, overprovisioned roles, missing permission checks, stale sessions,
 * shared admin accounts. The generic action-row fallback resolver leaves
 * Source Event / Affected Object / Related Activity as visible "pending"
 * because the ActionRow shape drops the rich auth fields (kind, principal,
 * resource). This per-source resolver consumes the original AuthRbacFinding
 * directly and produces a fully-populated 5-stage TriageGraph.
 *
 * Family invariant: the Fix/Control verb is kind-driven. rbac_off /
 * overprovisioned_role → Restrict capability, missing_permission_check →
 * Update policy, stale_session / shared_admin_account → Rotate credential.
 * Each return value uses one of the 11 canonical verbs from ACTION_VERBS so
 * the reviewer's verb verifier passes without synonym drift.
 *
 * Pure: no I/O, no fetch, no side effects.
 *
 * Resolver version: auth-rbac-resolver-v1
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

const RESOLVER_VERSION = "auth-rbac-resolver-v1";

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

export type AuthRbacKind =
  | "rbac_off"
  | "overprovisioned_role"
  | "missing_permission_check"
  | "stale_session"
  | "shared_admin_account";

export interface AuthRbacFinding {
  id: string;
  title: string;
  severity: "CRIT" | "HIGH" | "MED" | "WARN" | "LOW";
  kind: AuthRbacKind;
  /** Principal: user_id or role label. */
  principal?: string;
  /** Resource: route or capability. */
  resource?: string;
  evidence?: string[];
}

export interface ResolveAuthRbacTriageInput {
  finding: AuthRbacFinding;
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
// Kind → ActionVerb mapping
//
// Each return value uses one of the 11 canonical verbs from ACTION_VERBS in
// mission-control/types.ts. Keep these strings exact — the reviewer's verb verifier
// scans for synonym drift.
// ---------------------------------------------------------------------------

type FixVerb = "Restrict capability" | "Update policy" | "Rotate credential";

function verbForKind(kind: AuthRbacKind): FixVerb {
  switch (kind) {
    case "rbac_off":                 return "Restrict capability";
    case "overprovisioned_role":     return "Restrict capability";
    case "missing_permission_check": return "Update policy";
    case "stale_session":            return "Rotate credential";
    case "shared_admin_account":     return "Rotate credential";
  }
}

function kindLabel(kind: AuthRbacKind): string {
  switch (kind) {
    case "rbac_off":                 return "RBAC disabled";
    case "overprovisioned_role":     return "Overprovisioned role";
    case "missing_permission_check": return "Missing permission check";
    case "stale_session":            return "Stale session";
    case "shared_admin_account":     return "Shared admin account";
  }
}

function prescriptiveFixForKind(kind: AuthRbacKind, principal?: string, resource?: string): string {
  const verb = verbForKind(kind);
  const who = principal ? `for principal "${principal}"` : "";
  const what = resource ? `on resource "${resource}"` : "";
  switch (kind) {
    case "rbac_off":
      return `${verb}: re-enable RBAC enforcement. The defense is currently off ${what} — turn it on and verify the localhost-fallback gate still authorises legitimate operators.`;
    case "overprovisioned_role":
      return `${verb}: narrow the role's grants. The role ${who} carries permissions beyond its job-to-be-done — split the role or remove unused capabilities.`;
    case "missing_permission_check":
      return `${verb}: add a permission check ${what}. The route lacks an enforcement call — wire requireSession + requirePermission and add a localhost-fallback for break-glass.`;
    case "stale_session":
      return `${verb}: invalidate the stale session ${who}. Force re-authentication and verify the session lifetime policy matches the operator's risk profile.`;
    case "shared_admin_account":
      return `${verb}: replace the shared admin account ${who}. Issue per-operator credentials and revoke the shared one — shared admin accounts defeat audit trails.`;
  }
}

// ---------------------------------------------------------------------------
// Tab routing
//
// Auth/RBAC findings drill into the Access Control tab when present in
// TabId; we default there since the brief specifies it. The tab is
// confirmed valid in the dashboard's TabId enum (verified in types.ts).
// ---------------------------------------------------------------------------

const FIX_TAB = "accessControl" as const;

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

function buildEvidenceArtifact(f: AuthRbacFinding): TriageArtifact {
  const evidenceCount = f.evidence?.length ?? 0;
  const hasEvidence = evidenceCount > 0;
  const state: TriageLinkState = hasEvidence ? "resolved" : "derived";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "kind",      value: kindLabel(f.kind),         tone: "default" },
    { label: "severity",  value: f.severity,                tone: f.severity === "CRIT" || f.severity === "HIGH" ? "danger" : "warn" },
  ];
  if (f.principal) previewFields.push({ label: "principal", value: f.principal, tone: "default" });
  if (f.resource)  previewFields.push({ label: "resource",  value: f.resource,  tone: "default" });
  if (hasEvidence) previewFields.push({ label: "evidence_items", value: String(evidenceCount), tone: "default" });

  const primaryAction: TriageNavigationTarget = {
    tab: FIX_TAB,
    opts: { ...makeQueryFilter(f.id), fromMissionControl: true },
    label: "Open in Access Control ▸",
  };

  return {
    id: `${f.id}-evidence`,
    stageId: "evidence",
    label: `Evidence · ${kindLabel(f.kind)}`,
    shortLabel: `Evidence · ${kindLabel(f.kind)}`,
    kind: "evidence",
    state,
    confidence: state === "resolved" ? "exact" : "derived",
    previewTitle: `Auth/RBAC · ${kindLabel(f.kind)}`,
    previewSummary: f.title || `Auth/RBAC finding: ${kindLabel(f.kind)}.`,
    previewFields,
    primaryAction,
    evidenceTrail: hasEvidence ? { items: f.evidence! } : undefined,
  };
}

function buildSourceEventArtifact(f: AuthRbacFinding): TriageArtifact {
  const previewFields: TriageArtifact["previewFields"] = [
    { label: "kind", value: kindLabel(f.kind), tone: "default" },
  ];
  if (f.principal) previewFields.push({ label: "principal", value: f.principal, tone: "default" });
  if (f.resource)  previewFields.push({ label: "resource",  value: f.resource,  tone: "default" });

  const primaryAction: TriageNavigationTarget = {
    tab: FIX_TAB,
    opts: {
      ...makeQueryFilter(f.principal || f.resource || f.id),
      fromMissionControl: true,
    },
    label: "Open access record ▸",
  };

  return {
    id: `${f.id}-source-event`,
    stageId: "sourceEvent",
    label: `Source · ${kindLabel(f.kind)}`,
    shortLabel: `Source · ${kindLabel(f.kind)}`,
    kind: "source",
    state: "derived",
    confidence: "derived",
    previewTitle: `Source · ${kindLabel(f.kind)} record`,
    previewSummary: `This finding was emitted by the auth/RBAC analyzer evaluating ${f.principal ? `principal "${f.principal}"` : "the access posture"}${f.resource ? ` against resource "${f.resource}"` : ""}.`,
    previewFields,
    primaryAction,
  };
}

function buildAffectedObjectArtifact(f: AuthRbacFinding): TriageArtifact {
  const hasPrincipal = typeof f.principal === "string" && f.principal.length > 0;
  const state: TriageLinkState = hasPrincipal ? "resolved" : "missing";

  const previewFields: TriageArtifact["previewFields"] = [];
  if (hasPrincipal) previewFields.push({ label: "principal", value: f.principal!, tone: "default" });
  if (f.resource)   previewFields.push({ label: "resource",  value: f.resource,   tone: "default" });

  const primaryAction: TriageNavigationTarget | undefined = hasPrincipal
    ? {
        tab: FIX_TAB,
        opts: {
          ...makeQueryFilter(f.principal!),
          highlight: f.principal!,
          fromMissionControl: true,
        },
        label: "Open principal ▸",
      }
    : undefined;

  return {
    id: `${f.id}-object`,
    stageId: "affectedObject",
    label: hasPrincipal ? `Object · ${f.principal}` : "Object · pending",
    shortLabel: hasPrincipal ? `Object · ${f.principal}` : "Object · pending",
    kind: "object",
    state,
    confidence: hasPrincipal ? "exact" : undefined,
    previewTitle: hasPrincipal
      ? `Affected Object · principal "${f.principal}"`
      : "Affected Object · posture-level",
    previewSummary: hasPrincipal
      ? `Principal "${f.principal}" is the subject of this finding${f.resource ? ` on resource "${f.resource}"` : ""}.`
      : "This finding flags a posture-level RBAC risk and is not bound to a specific principal.",
    previewFields,
    primaryAction,
    reason: hasPrincipal
      ? undefined
      : "This finding flags a posture-level RBAC risk and is not bound to a specific principal.",
  };
}

function buildRelatedActivityArtifact(f: AuthRbacFinding, now: Date): TriageArtifact {
  const queryStr = f.principal || f.kind;
  const scopeLabel = f.principal ? "same-principal" : "same-kind";

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "scope", value: `${scopeLabel}-24h`, tone: "default" },
    { label: "query", value: queryStr,            tone: "default" },
  ];

  const primaryAction: TriageNavigationTarget = {
    tab: FIX_TAB,
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
    label: `Related · ${scopeLabel}-24h`,
    shortLabel: `Related · ${scopeLabel}-24h`,
    kind: "related",
    state: "derived",
    confidence: "derived",
    previewTitle: f.principal
      ? `Related · other findings on principal "${f.principal}"`
      : `Related · other "${kindLabel(f.kind)}" findings`,
    previewSummary: f.principal
      ? `Other Auth/RBAC findings on principal "${f.principal}" in the last 24 hours.`
      : `Other "${kindLabel(f.kind)}" findings across the fleet in the last 24 hours.`,
    previewFields,
    primaryAction,
  };
}

function buildFixControlArtifact(f: AuthRbacFinding): TriageArtifact {
  const verb = verbForKind(f.kind);

  const previewFields: TriageArtifact["previewFields"] = [
    { label: "kind", value: kindLabel(f.kind), tone: "default" },
    { label: "verb", value: verb,              tone: "default" },
  ];
  if (f.principal) previewFields.push({ label: "principal", value: f.principal, tone: "default" });
  if (f.resource)  previewFields.push({ label: "resource",  value: f.resource,  tone: "default" });

  const primaryAction: TriageNavigationTarget = {
    tab: FIX_TAB,
    opts: {
      ...makeQueryFilter(f.principal || f.resource || f.id),
      fromMissionControl: true,
    },
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
    previewSummary: prescriptiveFixForKind(f.kind, f.principal, f.resource),
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

function buildIssueTags(f: AuthRbacFinding): TriageIssueSummary["tags"] {
  const tags: TriageIssueSummary["tags"] = [
    { label: "kind",     value: f.kind,     safe: true },
    { label: "severity", value: f.severity, safe: true },
  ];
  if (f.principal) tags.push({ label: "principal", value: f.principal, safe: true });
  if (f.resource)  tags.push({ label: "resource",  value: f.resource,  safe: true });
  return tags;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * resolveAuthRbacTriageGraph
 *
 * Converts an AuthRbacFinding into a fully-populated TriageGraph. Pure: no
 * I/O, no fetch, no side effects.
 *
 * Stage population:
 *   01 Evidence         — kind + principal + resource (resolved when evidence present, else derived).
 *   02 Source Event     — analyzer record (derived).
 *   03 Affected Object  — principal (resolved when set; missing for posture-level findings).
 *   04 Related Activity — same-principal or same-kind in last 24h (derived).
 *   05 Fix / Control    — kind-driven verb (resolved).
 */
export function resolveAuthRbacTriageGraph(
  input: ResolveAuthRbacTriageInput,
): TriageGraph {
  const { finding: f, now = new Date() } = input;

  const issue: TriageIssueSummary = {
    id: f.id,
    kind: "authRbac",
    title: f.title,
    severity: f.severity,
    status: "open",
    source: "auth-rbac",
    summary: f.title || `Auth/RBAC finding: ${kindLabel(f.kind)}.`,
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
