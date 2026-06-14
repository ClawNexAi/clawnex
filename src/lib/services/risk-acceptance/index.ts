// Risk Acceptance — public orchestrator.
//
// Exposes the operations panels and routes call: accept / revoke /
// checkAcceptance / applySuppressions / autoExpire / autoRevokeOnEvidenceChange
// / listAcceptances. Layers validation, signature computation, and audit
// logging on top of the pure SQLite store.
//
// Spec: docs/superpowers/specs/2026-04-23-risk-acceptance-design.md §5 + §6

import { logEvent } from "../audit-logger";
import { computeSignatures, evidenceHash } from "./signatures";
import {
  findActiveBySignatures,
  findActiveFindingScopeForPanel,
  findExpiredActive,
  getAcceptanceById,
  insertAcceptance,
  listAcceptances as storeListAcceptances,
  markRevoked,
} from "./store";
import {
  DEFAULT_EXPIRY_DAYS,
  type AcceptanceCheckResult,
  type AcceptanceFilters,
  type AcceptanceQuery,
  type AcceptOpts,
  type RevokeOpts,
  type RiskAcceptance,
  type ScopeLevel,
  type SourcePanel,
} from "./types";

export * from "./types";
export { computeSignatures, evidenceHash } from "./signatures";

const MIN_REASON_LEN = 3;

function defaultExpiryISO(panel: SourcePanel, override?: string): string {
  if (override) return override;
  const days = DEFAULT_EXPIRY_DAYS[panel];
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Check whether a query matches an active acceptance. Returns the strongest
 *  scope match, or {accepted:false} if nothing matches. */
export function checkAcceptance(q: AcceptanceQuery): AcceptanceCheckResult {
  const sigs = computeSignatures(q);
  const hit = findActiveBySignatures(sigs);
  if (!hit) return { accepted: false };
  return { accepted: true, acceptance: hit.acceptance, scope_matched: hit.scope_matched };
}

/** Partition a findings array into active + suppressed. Preserves order
 *  within each partition. */
export function applySuppressions<T>(
  findings: T[],
  extractor: (f: T) => AcceptanceQuery,
): {
  active: T[];
  suppressed: Array<{ finding: T; acceptance: RiskAcceptance; scope_matched: ScopeLevel }>;
} {
  const active: T[] = [];
  const suppressed: Array<{ finding: T; acceptance: RiskAcceptance; scope_matched: ScopeLevel }> = [];
  for (const f of findings) {
    const q = extractor(f);
    const result = checkAcceptance(q);
    if (result.accepted && result.acceptance && result.scope_matched) {
      suppressed.push({
        finding: f,
        acceptance: result.acceptance,
        scope_matched: result.scope_matched,
      });
    } else {
      active.push(f);
    }
  }
  return { active, suppressed };
}

export function listAcceptances(filters?: AcceptanceFilters): RiskAcceptance[] {
  return storeListAcceptances(filters);
}

export function getAcceptance(id: string): RiskAcceptance | null {
  return getAcceptanceById(id);
}

/** Create a new acceptance. Validates reason + scope before insert and writes
 *  an audit-log entry on success. */
export function accept(q: AcceptanceQuery, opts: AcceptOpts): RiskAcceptance {
  if (!opts.reason || opts.reason.trim().length < MIN_REASON_LEN) {
    throw new Error(`accept: reason must be at least ${MIN_REASON_LEN} characters`);
  }
  if (opts.scope_level !== "finding" && opts.scope_level !== "agent_rule" && opts.scope_level !== "rule_global") {
    throw new Error(`accept: invalid scope_level '${opts.scope_level}'`);
  }
  if (!opts.accepted_by || opts.accepted_by.trim().length === 0) {
    throw new Error("accept: accepted_by required");
  }

  const sigs = computeSignatures(q);
  const signature = sigs[opts.scope_level];
  const expires_at = defaultExpiryISO(q.source_panel, opts.expires_at);
  const evidence_snapshot = JSON.stringify((q.evidence ?? []).slice().sort());

  const record = insertAcceptance({
    finding_signature: signature,
    scope_level: opts.scope_level,
    source_panel: q.source_panel,
    rule_id: q.rule_id,
    agent_id: q.agent_id ?? null,
    surface_id: q.surface_id ?? null,
    evidence_snapshot,
    accepted_by: opts.accepted_by,
    reason: opts.reason.trim(),
    expires_at,
  });

  logEvent(
    opts.accepted_by,
    "risk_acceptance.created",
    "risk_acceptance",
    record.id,
    JSON.stringify({
      source_panel: q.source_panel,
      rule_id: q.rule_id,
      agent_id: q.agent_id ?? null,
      surface_id: q.surface_id ?? null,
      scope_level: opts.scope_level,
      expires_at,
      reason: record.reason,
    }),
    "clawnex",
  );

  return record;
}

/** Revoke an acceptance. Idempotent — re-revoking returns the existing record
 *  without re-logging. */
export function revoke(id: string, opts: RevokeOpts): RiskAcceptance {
  if (!opts.reason || opts.reason.trim().length === 0) {
    throw new Error("revoke: reason required");
  }
  const existing = getAcceptanceById(id);
  if (!existing) throw new Error(`revoke: acceptance '${id}' not found`);
  if (existing.revoked_at) {
    return existing; // idempotent
  }

  const changed = markRevoked(id, opts.revoked_by, "operator-revoked");
  if (!changed) {
    // race — re-fetch and return whatever we got
    return getAcceptanceById(id) ?? existing;
  }

  logEvent(
    opts.revoked_by,
    "risk_acceptance.revoked",
    "risk_acceptance",
    id,
    JSON.stringify({
      source_panel: existing.source_panel,
      rule_id: existing.rule_id,
      reason: opts.reason.trim(),
    }),
    "clawnex",
  );

  const refreshed = getAcceptanceById(id);
  return refreshed ?? existing;
}

/** Mark every past-expiry acceptance as revoked with reason='expired'. Writes
 *  one audit-log entry per acceptance. Returns the affected count + ids. */
export function autoExpire(): { expired_count: number; ids: string[] } {
  const candidates = findExpiredActive();
  const ids: string[] = [];
  for (const a of candidates) {
    const changed = markRevoked(a.id, "system", "expired");
    if (changed) {
      ids.push(a.id);
      logEvent(
        "system",
        "risk_acceptance.expired",
        "risk_acceptance",
        a.id,
        JSON.stringify({
          source_panel: a.source_panel,
          rule_id: a.rule_id,
          accepted_by: a.accepted_by,
          accepted_at: a.accepted_at,
          expires_at: a.expires_at,
        }),
        "clawnex",
      );
    }
  }
  return { expired_count: ids.length, ids };
}

/** For each finding-scope active acceptance on this panel, recompute the
 *  evidence hash from current findings. If a stored snapshot's hash no longer
 *  matches the current evidence for that (rule, agent, surface) tuple,
 *  auto-revoke with reason='evidence-changed'.
 *
 *  Returns the affected count + ids so caller can log/banner. */
export function autoRevokeOnEvidenceChange(
  panel: SourcePanel,
  findings: Array<{ rule_id: string; agent_id?: string | null; surface_id?: string | null; evidence: string[] }>,
): { revoked_count: number; ids: string[] } {
  const acceptances = findActiveFindingScopeForPanel(panel);
  if (acceptances.length === 0) return { revoked_count: 0, ids: [] };

  // Index current findings by (rule_id, agent_id, surface_id) → evidence
  const currentByKey = new Map<string, string[]>();
  for (const f of findings) {
    const key = `${f.rule_id}|${f.agent_id ?? "-"}|${f.surface_id ?? "-"}`;
    currentByKey.set(key, f.evidence);
  }

  const ids: string[] = [];
  for (const a of acceptances) {
    const key = `${a.rule_id}|${a.agent_id ?? "-"}|${a.surface_id ?? "-"}`;
    const current = currentByKey.get(key);
    if (!current) {
      // Finding no longer present at all. We do NOT revoke — the acceptance
      // continues to apply if the finding pops back later. Operator can
      // manually revoke via the management panel.
      continue;
    }
    const currentHash = evidenceHash(current);
    let storedSnapshot: string[] = [];
    try {
      const parsed = JSON.parse(a.evidence_snapshot);
      if (Array.isArray(parsed)) storedSnapshot = parsed.map((x) => String(x));
    } catch {
      // malformed snapshot — be conservative, don't revoke on parse failure
      continue;
    }
    const storedHash = evidenceHash(storedSnapshot);
    if (currentHash !== storedHash) {
      const changed = markRevoked(a.id, "system", "evidence-changed");
      if (changed) {
        ids.push(a.id);
        logEvent(
          "system",
          "risk_acceptance.evidence_changed",
          "risk_acceptance",
          a.id,
          JSON.stringify({
            source_panel: a.source_panel,
            rule_id: a.rule_id,
            agent_id: a.agent_id,
            surface_id: a.surface_id,
            stored_evidence: storedSnapshot,
            current_evidence: current,
          }),
          "clawnex",
        );
      }
    }
  }
  return { revoked_count: ids.length, ids };
}
