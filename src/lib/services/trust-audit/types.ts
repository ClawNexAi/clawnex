/**
 * Trust Boundary + Blast Radius Audit — Type Definitions
 *
 * Normalized entity model for representing surfaces, agents, capabilities,
 * sensitive assets, and audit findings. Based on the the operator/internal reviewer spec at
 * docs/proposals/trust-boundary-audit.md
 */

// ── Rule count (client-safe mirror of the canonical AUDIT_RULES array) ──

/**
 * Number of trust-boundary audit rules. The canonical source is the
 * `AUDIT_RULES` array in `./rules.ts`, but that module imports server-only
 * deps (`fs`, the DB) and cannot cross into client components. This constant
 * is the client-safe mirror used by UI copy (e.g. the Trust Audit panel
 * tooltip). `scripts/verify-count-claims.ts` asserts this equals
 * `AUDIT_RULES.length`, so drift is caught at verify time rather than shipping
 * a wrong number to operators.
 */
export const TRUST_AUDIT_RULE_COUNT = 15;

// ── Severity Levels ──

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

// ── Evidence Level (provenance / confidence classification) ──

/**
 * EvidenceLevel — how confident the audit is in a given entity or finding.
 *
 * Ordered from strongest to weakest provenance:
 * - `verified_runtime`    — observed in live runtime (e.g., proxy_traffic rows, live config)
 * - `verified_config`     — present in persisted config that is actively read
 * - `verified_filesystem` — file exists and is readable now
 * - `heuristic_inference` — derived by pattern, naming, or convention
 * - `unknown`             — cannot be determined from available data
 */
export type EvidenceLevel =
  | 'verified_runtime'
  | 'verified_config'
  | 'verified_filesystem'
  | 'heuristic_inference'
  | 'unknown';

// ── Normalized Entities ──

export interface Surface {
  id: string;
  kind: 'litellm-proxy' | 'session-watcher' | 'mcp-http' | 'mcp-stdio' | 'api-v1' | 'dashboard' | 'webhook';
  name: string;
  policy: 'open' | 'localhost' | 'rbac' | 'api-key' | 'unknown';
  publicExposure: boolean;
  notes?: string;
}

export interface Agent {
  id: string;
  name: string;
  source: 'openclaw' | 'hermes' | 'paperclip' | 'nemoclaw' | 'unknown';
  model: string;
  fallbackModels: string[];
  routingMode: 'routed' | 'direct' | 'mixed';
  tools: string[];
  workspacePath?: string;
  /**
   * Live sandbox state. `null` means we couldn't determine the sandbox state
   * from available data (no live tool-registry introspection hook yet).
   * `true`/`false` are only set when we have verifiable evidence. Older
   * callers that relied on boolean `sandboxed` should treat `null` as
   * "unknown" — NOT as "unsandboxed". The UI surfaces the unknown state
   * explicitly to avoid a false sense of safety or of danger.
   */
  sandboxed: boolean | null;
  /** Confidence that this agent actually exists and is reachable. */
  confidence?: EvidenceLevel;
}

export interface Capability {
  id: string;
  class: 'runtime' | 'filesystem' | 'browser' | 'web' | 'messaging' | 'config' | 'orchestration' | 'plugin';
  name: string;
  riskWeight: number; // 1-10
  destructive: boolean;
  externalReach: boolean;
  /** Confidence that this capability is actually held by the referring agent. */
  confidence?: EvidenceLevel;
}

export interface SensitiveAssetHint {
  id: string;
  kind: 'credential' | 'api-key' | 'config-file' | 'workspace-secret' | 'database';
  location: string;
  confidence: number; // 0-100
  notes?: string;
  /** Provenance classification for the asset (how we discovered it). */
  evidenceLevel?: EvidenceLevel;
}

// ── Audit Finding ──

export interface Finding {
  id: string;
  ruleId: string;
  severity: Severity;
  title: string;
  surfaceId?: string;
  agentId?: string;
  modelRef?: string;
  capabilityPath: string[];
  containmentState: 'sandboxed' | 'unsandboxed' | 'partial' | 'unknown';
  assetHints: string[];
  whyItMatters: string;
  blastRadius: string;
  recommendedFix: string;
  evidence: string[];
  /**
   * Provenance of the evidence the rule relied on. A rule that evaluates
   * configuration values directly is `verified_config`; one that fires
   * purely on filesystem/naming heuristics is `heuristic_inference`, etc.
   * Rules should set this to the WEAKEST evidence level they depended on.
   */
  confidence?: EvidenceLevel;
}

// ── Audit Rule ──

export interface AuditRule {
  id: string;
  name: string;
  description: string;
  category: string;
  severityBase: Severity;
  evaluate: (context: AuditContext) => Finding[];
}

// ── Audit Context (input to rule engine) ──

export interface AuditContext {
  surfaces: Surface[];
  agents: Agent[];
  capabilities: Capability[];
  sensitiveAssets: SensitiveAssetHint[];
  config: {
    rbacEnabled: boolean;
    shieldMode: 'block' | 'observe' | 'off';
    breakGlassActive: boolean;
    breakGlassReason?: string;
    breakGlassExpiry?: string;
    sessionBindIp: boolean;
    providerCount: number;
    routedProviderCount: number;
    directProviderCount: number;
    totalShieldRules: number;
  };
  recentChanges: ConfigChange[];
  /**
   * v0.7.1: Permissiveness scan report attached by the engine before rule
   * evaluation. Optional — rules that don't consume it ignore the field;
   * rules that consume it (e.g. comm-surface-permissiveness) skip silently
   * if the scan failed and the field is absent.
   *
   * Typed as `unknown` here to avoid a circular import between trust-audit
   * and permissiveness modules. Consumers should narrow via type-guard.
   */
  permissivenessReport?: unknown;
}

export interface ConfigChange {
  action: string;
  actor: string;
  timestamp: string;
  detail: string;
}

// ── Audit Report (output) ──

export interface AuditReport {
  timestamp: string;
  duration_ms: number;
  summary: {
    overallSeverity: Severity;
    surfaceCount: number;
    agentCount: number;
    /** v0.8.0+: gross — count of every finding the rule engine produced.
     *  Retained as `findingCounts` for back-compat with v0.7.x clients. */
    findingCounts: Record<Severity, number>;
    /** v0.8.0+: active — gross MINUS findings suppressed by accepted risks.
     *  Headlines and badges should use this. */
    findingCountsActive: Record<Severity, number>;
    totalFindings: number;
    totalActiveFindings: number;
    totalSuppressedFindings: number;
  };
  surfaces: Surface[];
  agents: Agent[];
  /** v0.8.0+: active findings only (suppressed findings excluded).
   *  Existing field name retained — old clients see fewer findings, which
   *  is the correct headline behavior under risk acceptance. */
  findings: Finding[];
  /** v0.8.0+: findings suppressed by accepted risks, with the matched
   *  acceptance attached for rendering in the Accepted Risks section. */
  suppressedFindings: Array<{ finding: Finding; acceptance: SuppressionAcceptance }>;
  matrix: MatrixEntry[];
  remediationPlan: RemediationItem[];
}

/** Trimmed view of RiskAcceptance — typed `unknown`-narrowed to avoid a
 *  circular import between trust-audit and risk-acceptance modules. The
 *  engine populates this with the full RiskAcceptance shape. */
export interface SuppressionAcceptance {
  id: string;
  scope_level: 'finding' | 'agent_rule' | 'rule_global';
  accepted_by: string;
  accepted_at: string;
  reason: string;
  expires_at: string;
}

export interface MatrixEntry {
  surface: string;
  agent: string;
  model: string;
  tools: string[];
  containment: string;
  blastRadius: string;
  severity: Severity;
}

export interface RemediationItem {
  priority: number;
  findingId: string;
  title: string;
  severity: Severity;
  fix: string;
  effort: 'low' | 'medium' | 'high';
}
