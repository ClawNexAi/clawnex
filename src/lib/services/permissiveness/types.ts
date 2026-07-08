// Blast Radius + Permissiveness — type surface.
//
// Every posture field carries a Provenance. Every numeric score carries a
// confidence drawn from the MIN of its inputs. Missing evidence is `unknown`,
// never zero, never faked.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md

// ---------- Primitive unions ----------

export type EvidenceLevel =
  | "verified_runtime"
  | "verified_config"
  | "verified_filesystem"
  | "heuristic_inference"
  | "unknown";

export type IntegrationStatus =
  | "shipped"
  | "not_integrated"
  | "source_has_no_permission_schema";

export type AudienceType =
  | "private_dm"
  | "group_restricted"
  | "group_open"
  | "guild_restricted"
  | "guild_open"
  | "public"
  | "localhost_only"
  | "workspace_restricted"
  | "unknown";

export type AllowlistState =
  | "enforcing_tight"
  | "enforcing_broad"
  | "partial"
  | "missing"
  | "enterprise_placeholder"
  | "unavailable";

export type EnforcerRuntime =
  | "openclaw"
  | "hermes"
  | "dual"
  | "clawnex"
  | "none"
  | "not_applicable";

export type BotIdentity =
  | "single_bot_hermes_enforces"
  | "single_bot_openclaw_enforces"
  | "dual_bot"
  | "no_openclaw_declaration"
  | "not_applicable";

export type RoutingPath = "routed" | "direct" | "unknown";

export type ContainmentState = "sandboxed" | "unsandboxed" | "unknown";

export type BlastRadiusBand = "minimal" | "low" | "medium" | "high" | "critical";

export type PolicyType = "allowlist" | "open" | "deny" | "not_applicable";

// ---------- Provenance + PostureValue ----------

export interface Provenance {
  level: EvidenceLevel;
  source: string;          // file:line or descriptive anchor, e.g. "~/.openclaw/openclaw.json:channels.discord"
  readAt: string;          // ISO timestamp of when the value was captured
}

export interface PostureValue<T> {
  value: T | null;
  provenance: Provenance;
}

// ---------- Permission posture (9 dimensions) ----------

export interface DmAccessGate {
  allowedUserIds: string[];
  allowAllBypass: boolean;
  policyType: PolicyType;
}

export interface GroupAccessGate {
  requireMention: boolean;
  freeResponseChannels: string[];
  wakeWordRegexes: string[];
  policyType: PolicyType;
}

export interface ChannelFilter {
  allowedChannels: string[];
  ignoredChannels: string[];
  noThreadChannels: string[];
}

export interface ApprovalActionAllowlist {
  userIds: string[];
  allowAllBypass: boolean;
}

export interface PairedUser {
  userId: string;
  userName: string;
  approvedAt: string;       // ISO timestamp
}

export interface TokenIdentity {
  prefix: string;           // first 20 chars of raw token (for operator-visible matching)
  hash: string;             // SHA-256 of raw token (for equality checks)
}

export interface PermissionPosture {
  botToken: PostureValue<TokenIdentity>;
  dmAccessGate: PostureValue<DmAccessGate>;
  groupAccessGate: PostureValue<GroupAccessGate>;
  channelFilter: PostureValue<ChannelFilter>;
  approvalActionAllowlist: PostureValue<ApprovalActionAllowlist>;
  homeChannel: PostureValue<string>;
  allowAllBypass: PostureValue<boolean>;
  pairingApproved: PostureValue<PairedUser[]>;
  execApprovers: PostureValue<string[]>;
}

// ---------- Surfaces + reachability ----------

export interface HermesProfileLayer {
  profileId: string;
  active: boolean;
  activationSource: "active_profile_file" | "default" | "cli_arg" | "unknown";
  posture: PermissionPosture;
}

export interface Surface {
  id: string;                   // "discord" | "telegram" | "slack" | "litellm-proxy" | ...
  name: string;
  kind: "comm-channel" | "runtime-endpoint";
  integrationStatus: IntegrationStatus;

  // Comm-channel-only layers
  openclawLayer?: PermissionPosture | null;
  hermesLayer?: HermesProfileLayer[];
  enforcerRuntime: EnforcerRuntime;
  botIdentity: BotIdentity;

  reachability: SurfaceReachability[];
  effectiveBlastRadius: BlastRadiusScore;
  confidence: EvidenceLevel;
}

export interface SurfaceReachability {
  agentId: string;
  agentName: string;
  profileId?: string;           // only set for Hermes agents
  path: RoutingPath;
  pathDetails: string;          // "via litellm-proxy" | "direct via openrouter"
  toolIds: string[];
  dangerousToolCount: number;
  containmentState: ContainmentState;
  effectiveAudience: AudienceType;
  effectiveAllowlist: AllowlistState;
  edgeBlastRadius: BlastRadiusScore;
  confidence: EvidenceLevel;
}

// ---------- Scoring ----------

export interface BlastRadiusScore {
  numeric: number;              // 0-100, clamped
  band: BlastRadiusBand;
  drivers: { factor: string; contribution: number }[];   // top 3-5 multiplicative contributors
  confidence: EvidenceLevel;    // MIN of all input provenances
  rawFactors: Record<string, number>;                    // audit trail for reproducibility
}

// ---------- Findings ----------

export interface DangerousCombo {
  id: string;
  name: string;
  toolPattern: string[][];      // OR-of-AND: [[a|b|c], [d|e]] means "match any of {a,b,c} AND any of {d,e}"
  rationale: string;
  severity: "medium" | "high" | "critical";
}

export interface DangerousComboFinding {
  comboId: string;
  agentId: string;
  evidence: { tool: string; matchedPattern: string }[];
  evaluable: boolean;
  reason?: string;              // required when evaluable=false
}

export interface PostureLintRule {
  id: string;
  name: string;
  applies: (surface: Surface) => boolean;
  check: (surface: Surface) => PostureLintFinding | null;
}

export interface PostureLintFinding {
  ruleId: string;
  surfaceId: string;
  field: string;
  value: string;                // suspicious literal (not a secret)
  rationale: string;
  severity: "low" | "medium" | "high";
  confidence: EvidenceLevel;
}

// ---------- Rankings ----------

export interface RankedAgent {
  agentId: string;
  agentName: string;
  surfacesReachable: string[];
  worstPath: RoutingPath;
  dangerousToolCount: number;
  worstAllowlist: AllowlistState;
  containmentState: ContainmentState;
  blastRadius: BlastRadiusScore;
  whyRisky: string;             // plain-English, derived from drivers
}

export interface RankedSurface {
  surfaceId: string;
  agentCount: number;
  worstAudience: AudienceType;
  worstAllowlist: AllowlistState;
  blastRadius: BlastRadiusScore;
  drillLinks: { label: string; tabId: string }[];
}

export interface HardeningRecommendation {
  id: string;
  agentId: string;
  agentName: string;
  surfaceId: string;
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  rationale: string;
  draftAction: {
    label: string;
    tabId: string;
    focus?: string;
  };
  confidence: EvidenceLevel;
}

// ---------- Report envelope ----------

export interface ProfileDescriptor {
  id: string;
  active: boolean;
  activationSource: string;
  source: string;               // absolute path, e.g. "<operator-home>/.hermes/profiles/<profile>"
}

export interface SuppressedComboFinding {
  finding: DangerousComboFinding;
  acceptance: SuppressionAcceptanceLite;
}

export interface SuppressedLintFinding {
  finding: PostureLintFinding;
  acceptance: SuppressionAcceptanceLite;
}

/** v0.8.0+: trimmed view of RiskAcceptance — typed locally to avoid a
 *  circular import between permissiveness and risk-acceptance modules. */
export interface SuppressionAcceptanceLite {
  id: string;
  scope_level: "finding" | "agent_rule" | "rule_global";
  accepted_by: string;
  accepted_at: string;
  reason: string;
  expires_at: string;
}

export interface PermissivenessReport {
  generatedAt: string;
  profiles: ProfileDescriptor[];
  surfaces: Surface[];
  /** v0.8.0+: gross dangerous combos (every combo evaluated, before
   *  applying risk acceptances). Retained as `dangerousCombos` for
   *  back-compat. Old clients see all combos. */
  dangerousCombos: DangerousComboFinding[];
  /** v0.8.0+: combos suppressed by accepted risks. */
  dangerousCombosSuppressed: SuppressedComboFinding[];
  /** v0.8.0+: gross posture lints. */
  postureLints: PostureLintFinding[];
  /** v0.8.0+: lints suppressed by accepted risks. */
  postureLintsSuppressed: SuppressedLintFinding[];
  rankings: {
    mostPermissiveAgents: RankedAgent[];
    mostExposedSurfaces: RankedSurface[];
  };
  hardeningRecommendations: HardeningRecommendation[];
  meta: {
    scanDurationMs: number;
    cached: boolean;
    cacheAgeMs: number;
    panelWideConfidence: EvidenceLevel;
  };
}
