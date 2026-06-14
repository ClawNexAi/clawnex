// Risk Acceptance — type surface.
//
// Operator-explicit, time-bound, audit-trailed suppression of findings
// across the four risk-bearing panels. Each acceptance records WHO accepted
// WHAT, WHY, UNTIL WHEN, and the evidence snapshot used for delta detection.
//
// Spec: docs/superpowers/specs/2026-04-23-risk-acceptance-design.md

export type SourcePanel =
  | "trust_audit"
  | "blast_radius_combo"
  | "blast_radius_lint"
  | "correlations"
  | "alerts";

export type ScopeLevel = "finding" | "agent_rule" | "rule_global";

export type RevokeReason =
  | "operator-revoked"
  | "expired"
  | "evidence-changed"
  | "scope-superseded";

/** Default expiry per panel. Correlations defaults to 30 days because
 *  correlation rules describe recurring patterns — what's acceptable today
 *  may not be next month. The other panels default to the industry-standard
 *  90-day risk-acceptance review cadence. */
export const DEFAULT_EXPIRY_DAYS: Record<SourcePanel, number> = {
  trust_audit: 90,
  blast_radius_combo: 90,
  blast_radius_lint: 90,
  correlations: 30,
  alerts: 90,
};

export interface RiskAcceptance {
  id: string;
  finding_signature: string;
  scope_level: ScopeLevel;
  source_panel: SourcePanel;
  rule_id: string;
  agent_id: string | null;
  surface_id: string | null;
  evidence_snapshot: string;     // JSON-serialized evidence array (sorted)
  accepted_by: string;
  accepted_at: string;           // ISO timestamp
  reason: string;
  expires_at: string;            // ISO timestamp
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: RevokeReason | null;
}

/** Inputs that uniquely identify a finding for matching against acceptances.
 *  Optional `evidence` is only used for `finding`-scope signature; the other
 *  two scopes ignore it. */
export interface AcceptanceQuery {
  source_panel: SourcePanel;
  rule_id: string;
  agent_id?: string | null;
  surface_id?: string | null;
  evidence?: string[];
}

export interface AcceptanceCheckResult {
  accepted: boolean;
  acceptance?: RiskAcceptance;
  scope_matched?: ScopeLevel;
}

export interface AcceptOpts {
  scope_level: ScopeLevel;
  reason: string;
  accepted_by: string;
  expires_at?: string;           // ISO timestamp; defaults to now + DEFAULT_EXPIRY_DAYS[panel]
}

export interface RevokeOpts {
  revoked_by: string;
  reason: string;                // operator-supplied free text
}

export interface AcceptanceFilters {
  status?: "active" | "expired" | "revoked" | "all";
  source_panel?: SourcePanel;
  expiring_within_days?: number;
}
