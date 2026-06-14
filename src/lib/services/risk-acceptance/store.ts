// SQLite store for risk_acceptances.
//
// Pure CRUD against the risk_acceptances table. No business logic — the
// orchestrator (./index.ts) layers validation, signature computation, audit
// logging, and timing semantics on top.
//
// Spec: docs/superpowers/specs/2026-04-23-risk-acceptance-design.md §4

import { randomUUID } from "node:crypto";
import { queryAll, queryOne, run } from "../../db/index";
import type {
  AcceptanceFilters,
  RevokeReason,
  RiskAcceptance,
  ScopeLevel,
  SourcePanel,
} from "./types";

interface RawRow {
  id: string;
  finding_signature: string;
  scope_level: ScopeLevel;
  source_panel: SourcePanel;
  rule_id: string;
  agent_id: string | null;
  surface_id: string | null;
  evidence_snapshot: string;
  accepted_by: string;
  accepted_at: string;
  reason: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: RevokeReason | null;
}

function rowToRecord(r: RawRow): RiskAcceptance {
  return { ...r };
}

export interface InsertAcceptanceInput {
  finding_signature: string;
  scope_level: ScopeLevel;
  source_panel: SourcePanel;
  rule_id: string;
  agent_id: string | null;
  surface_id: string | null;
  evidence_snapshot: string;
  accepted_by: string;
  reason: string;
  expires_at: string;
}

export function insertAcceptance(input: InsertAcceptanceInput): RiskAcceptance {
  const id = randomUUID();
  const now = new Date().toISOString();
  run(
    `INSERT INTO risk_acceptances (
       id, finding_signature, scope_level, source_panel, rule_id,
       agent_id, surface_id, evidence_snapshot, accepted_by, accepted_at,
       reason, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.finding_signature, input.scope_level, input.source_panel, input.rule_id,
      input.agent_id, input.surface_id, input.evidence_snapshot, input.accepted_by, now,
      input.reason, input.expires_at,
    ],
  );
  const row = queryOne<RawRow>(
    `SELECT * FROM risk_acceptances WHERE id = ?`,
    [id],
  );
  if (!row) throw new Error(`insertAcceptance: row ${id} not found after insert`);
  return rowToRecord(row);
}

export function getAcceptanceById(id: string): RiskAcceptance | null {
  const row = queryOne<RawRow>(`SELECT * FROM risk_acceptances WHERE id = ?`, [id]);
  return row ? rowToRecord(row) : null;
}

/** Find the strongest-scope active acceptance matching the supplied
 *  signatures. Precedence: finding > agent_rule > rule_global.
 *  Active = revoked_at IS NULL AND expires_at > now. */
export function findActiveBySignatures(sigs: {
  finding: string;
  agent_rule: string;
  rule_global: string;
}): { acceptance: RiskAcceptance; scope_matched: ScopeLevel } | null {
  const now = new Date().toISOString();
  // Try strongest first, in scope-precedence order.
  const order: Array<{ sig: string; scope: ScopeLevel }> = [
    { sig: sigs.finding, scope: "finding" },
    { sig: sigs.agent_rule, scope: "agent_rule" },
    { sig: sigs.rule_global, scope: "rule_global" },
  ];
  for (const { sig, scope } of order) {
    const row = queryOne<RawRow>(
      `SELECT * FROM risk_acceptances
       WHERE finding_signature = ?
         AND scope_level = ?
         AND revoked_at IS NULL
         AND expires_at > ?
       ORDER BY accepted_at DESC
       LIMIT 1`,
      [sig, scope, now],
    );
    if (row) return { acceptance: rowToRecord(row), scope_matched: scope };
  }
  return null;
}

export function markRevoked(id: string, revoked_by: string, revoke_reason: RevokeReason): boolean {
  const now = new Date().toISOString();
  const result = run(
    `UPDATE risk_acceptances
     SET revoked_at = ?, revoked_by = ?, revoke_reason = ?
     WHERE id = ? AND revoked_at IS NULL`,
    [now, revoked_by, revoke_reason, id],
  );
  return result.changes > 0;
}

export function listAcceptances(filters: AcceptanceFilters = {}): RiskAcceptance[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const now = new Date().toISOString();

  switch (filters.status ?? "active") {
    case "active":
      clauses.push("revoked_at IS NULL AND expires_at > ?");
      params.push(now);
      break;
    case "expired":
      clauses.push("(revoked_at IS NOT NULL AND revoke_reason = 'expired') OR (revoked_at IS NULL AND expires_at <= ?)");
      params.push(now);
      break;
    case "revoked":
      clauses.push("revoked_at IS NOT NULL");
      break;
    case "all":
      // no status filter
      break;
  }

  if (filters.source_panel) {
    clauses.push("source_panel = ?");
    params.push(filters.source_panel);
  }

  if (typeof filters.expiring_within_days === "number" && filters.expiring_within_days > 0) {
    const horizon = new Date(Date.now() + filters.expiring_within_days * 24 * 60 * 60 * 1000).toISOString();
    clauses.push("revoked_at IS NULL AND expires_at > ? AND expires_at <= ?");
    params.push(now, horizon);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT * FROM risk_acceptances ${where} ORDER BY accepted_at DESC`;
  const rows = queryAll<RawRow>(sql, params);
  return rows.map(rowToRecord);
}

/** Find every acceptance whose expires_at is in the past and which has
 *  not yet been revoked. Used by autoExpire(). */
export function findExpiredActive(): RiskAcceptance[] {
  const now = new Date().toISOString();
  const rows = queryAll<RawRow>(
    `SELECT * FROM risk_acceptances
     WHERE revoked_at IS NULL AND expires_at <= ?`,
    [now],
  );
  return rows.map(rowToRecord);
}

/** Find every active finding-scope acceptance for a panel. Used by
 *  autoRevokeOnEvidenceChange to compare snapshots against current evidence. */
export function findActiveFindingScopeForPanel(panel: SourcePanel): RiskAcceptance[] {
  const now = new Date().toISOString();
  const rows = queryAll<RawRow>(
    `SELECT * FROM risk_acceptances
     WHERE source_panel = ?
       AND scope_level = 'finding'
       AND revoked_at IS NULL
       AND expires_at > ?`,
    [panel, now],
  );
  return rows.map(rowToRecord);
}
