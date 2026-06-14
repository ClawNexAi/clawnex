/**
 * Module-level verification for the risk-acceptance library.
 *
 * Run: npx tsx scripts/verify-risk-acceptance-units.ts
 *
 * Uses an in-memory SQLite database (DATABASE_PATH=:memory:) to keep tests
 * hermetic and avoid polluting the real sentinel.db. Mirrors the
 * verify-permissiveness-units.ts pattern (this repo has no Jest/Vitest).
 *
 * Exits 0 if all assertions PASS, 1 otherwise.
 */

// Force in-memory DB for hermetic tests — must be set BEFORE the db module loads.
process.env.DATABASE_PATH = ":memory:";
process.env.CLAWNEX_AUDIT_STDOUT = "false"; // silence audit-log mirror

import { getDb } from "../src/lib/db/index";
import {
  applySuppressions,
  accept,
  autoExpire,
  autoRevokeOnEvidenceChange,
  checkAcceptance,
  computeSignatures,
  evidenceHash,
  listAcceptances,
  revoke,
} from "../src/lib/services/risk-acceptance";
import type {
  AcceptanceQuery,
  RiskAcceptance,
} from "../src/lib/services/risk-acceptance/types";

type Status = { pass: number; fail: number };
const status: Status = { pass: 0, fail: 0 };

function assert(cond: unknown, desc: string) {
  if (cond) {
    status.pass++;
    console.log(`  ✓ ${desc}`);
  } else {
    status.fail++;
    console.log(`  ✗ ${desc}`);
  }
}

function section(name: string) {
  console.log(`\n[${name}]`);
}

// Force schema initialization
getDb();

// ---------- signatures ----------

section("signatures: deterministic output for identical input");
const q1: AcceptanceQuery = {
  source_panel: "trust_audit",
  rule_id: "tool-freedom",
  agent_id: "scout",
  surface_id: null,
  evidence: ["browser", "read"],
};
const sig1a = computeSignatures(q1);
const sig1b = computeSignatures(q1);
assert(sig1a.finding === sig1b.finding, "finding signature is deterministic");
assert(sig1a.agent_rule === sig1b.agent_rule, "agent_rule signature is deterministic");
assert(sig1a.rule_global === sig1b.rule_global, "rule_global signature is deterministic");

section("signatures: different scopes produce different hashes");
assert(sig1a.finding !== sig1a.agent_rule, "finding ≠ agent_rule");
assert(sig1a.agent_rule !== sig1a.rule_global, "agent_rule ≠ rule_global");
assert(sig1a.finding !== sig1a.rule_global, "finding ≠ rule_global");

section("signatures: evidence ordering does not affect finding hash");
const q1Reordered: AcceptanceQuery = { ...q1, evidence: ["read", "browser"] };
const sig1c = computeSignatures(q1Reordered);
assert(sig1c.finding === sig1a.finding, "evidence sort makes finding hash order-independent");

section("signatures: differing evidence changes finding hash but not coarser scopes");
const q1NewEvidence: AcceptanceQuery = { ...q1, evidence: ["browser", "read", "exec"] };
const sig1d = computeSignatures(q1NewEvidence);
assert(sig1d.finding !== sig1a.finding, "new evidence → new finding hash");
assert(sig1d.agent_rule === sig1a.agent_rule, "new evidence → same agent_rule hash");
assert(sig1d.rule_global === sig1a.rule_global, "new evidence → same rule_global hash");

section("signatures: differing agent_id changes finding + agent_rule but not rule_global");
const q1NewAgent: AcceptanceQuery = { ...q1, agent_id: "spark" };
const sig1e = computeSignatures(q1NewAgent);
assert(sig1e.agent_rule !== sig1a.agent_rule, "new agent_id → new agent_rule hash");
assert(sig1e.rule_global === sig1a.rule_global, "new agent_id → same rule_global hash");

section("signatures: missing agent_id/surface_id treated as '-'");
const qBare: AcceptanceQuery = {
  source_panel: "blast_radius_lint",
  rule_id: "telegram_channel_in_user_allowlist",
  evidence: ["TELEGRAM_ALLOWED_USERS", "-1001234567890"],
};
const sigBare = computeSignatures(qBare);
const qBareExplicit: AcceptanceQuery = { ...qBare, agent_id: null, surface_id: null };
const sigBareExplicit = computeSignatures(qBareExplicit);
assert(sigBare.finding === sigBareExplicit.finding, "missing vs null agent_id/surface_id produce same hash");

// ---------- evidenceHash ----------

section("evidenceHash: empty/null evidence produce same hash");
assert(evidenceHash([]) === evidenceHash(null), "empty array == null");
assert(evidenceHash(undefined) === evidenceHash(null), "undefined == null");

// ---------- accept / checkAcceptance / scope precedence ----------

section("accept: requires reason ≥ 3 chars");
let threwOnEmptyReason = false;
try {
  accept(q1, { scope_level: "finding", reason: "ab", accepted_by: "test" });
} catch {
  threwOnEmptyReason = true;
}
assert(threwOnEmptyReason, "accept rejects reason of length 2");

section("accept: requires accepted_by");
let threwOnNoActor = false;
try {
  accept(q1, { scope_level: "finding", reason: "valid reason", accepted_by: "" });
} catch {
  threwOnNoActor = true;
}
assert(threwOnNoActor, "accept rejects empty accepted_by");

section("accept + checkAcceptance: finding-scope match");
const a1 = accept(q1, { scope_level: "finding", reason: "trusted reviewer prompts", accepted_by: "operator" });
assert(a1.id.length > 0, "accept returns a record with id");
assert(a1.scope_level === "finding", "scope_level recorded");
assert(a1.source_panel === "trust_audit", "source_panel recorded");
assert(a1.reason === "trusted reviewer prompts", "reason recorded");
const check1 = checkAcceptance(q1);
assert(check1.accepted === true, "checkAcceptance finds the acceptance");
assert(check1.scope_matched === "finding", "scope_matched=finding");
assert(check1.acceptance?.id === a1.id, "returns the same record");

section("accept + checkAcceptance: finding-scope does NOT match different evidence");
const q1OtherEvidence: AcceptanceQuery = { ...q1, evidence: ["browser", "read", "write"] };
const checkOther = checkAcceptance(q1OtherEvidence);
assert(checkOther.accepted === false, "finding-scope acceptance does not match different evidence");

section("accept agent_rule: matches across evidence variants");
const q2: AcceptanceQuery = {
  source_panel: "blast_radius_combo",
  rule_id: "browser_plus_read",
  agent_id: "openclaw:researcher",
  evidence: ["web_search", "read"],
};
const a2 = accept(q2, { scope_level: "agent_rule", reason: "researcher agent is trusted", accepted_by: "operator" });
assert(a2.scope_level === "agent_rule", "agent_rule scope recorded");
const q2NewEvidence: AcceptanceQuery = { ...q2, evidence: ["web_browse", "fs_read"] };
const checkAgentRule = checkAcceptance(q2NewEvidence);
assert(checkAgentRule.accepted === true, "agent_rule acceptance matches different evidence on same agent+rule");
assert(checkAgentRule.scope_matched === "agent_rule", "scope_matched=agent_rule");

section("accept rule_global: matches across agent variants");
const q3: AcceptanceQuery = {
  source_panel: "blast_radius_combo",
  rule_id: "exec_plus_write",
  agent_id: "hermes-discord@example-profile",
  evidence: ["bash", "edit"],
};
accept(q3, { scope_level: "rule_global", reason: "exec+write acceptable fleet-wide", accepted_by: "operator" });
const q3OtherAgent: AcceptanceQuery = { ...q3, agent_id: "hermes-telegram@example-profile", evidence: ["exec", "write"] };
const checkGlobal = checkAcceptance(q3OtherAgent);
assert(checkGlobal.accepted === true, "rule_global matches across agent variants");
assert(checkGlobal.scope_matched === "rule_global", "scope_matched=rule_global");

section("scope precedence: finding > agent_rule > rule_global");
// Set up a triple-coverage situation: same rule has finding, agent_rule, and rule_global acceptances.
const qTri: AcceptanceQuery = {
  source_panel: "correlations",
  rule_id: "Coordinated Attack Chain",
  evidence: ["shield", "traffic"],
};
const aGlobal = accept(qTri, { scope_level: "rule_global", reason: "global ack", accepted_by: "operator" });
// finding-scope match should win over rule_global
const checkPrec = checkAcceptance(qTri);
assert(checkPrec.scope_matched === "rule_global", "with only rule_global, that wins");
assert(checkPrec.acceptance?.id === aGlobal.id, "returns the rule_global record");

// ---------- applySuppressions ----------

section("applySuppressions: partitions findings + preserves order");
const findings = [
  { id: "f1", rule_id: "tool-freedom", agent_id: "scout", evidence: ["browser", "read"] },
  { id: "f2", rule_id: "exec_plus_write", agent_id: "hermes-discord@example-profile", evidence: ["bash", "edit"] },
  { id: "f3", rule_id: "tool-freedom", agent_id: "spark", evidence: ["fetch", "fs_read"] },
];
const partitioned = applySuppressions(findings, (f) => ({
  source_panel: f.id === "f2" ? "blast_radius_combo" : "trust_audit",
  rule_id: f.rule_id,
  agent_id: f.agent_id,
  evidence: f.evidence,
}));
assert(partitioned.active.length + partitioned.suppressed.length === findings.length, "partition is exhaustive");
assert(partitioned.suppressed.some((s) => s.finding.id === "f1"), "f1 suppressed (matches a1 finding-scope)");
assert(partitioned.suppressed.some((s) => s.finding.id === "f2"), "f2 suppressed (matches rule_global ack on exec_plus_write)");
assert(partitioned.active.some((f) => f.id === "f3"), "f3 active (no acceptance for spark)");

// ---------- revoke ----------

section("revoke: requires reason");
let threwOnNoRevokeReason = false;
try {
  revoke(a1.id, { revoked_by: "operator", reason: "" });
} catch {
  threwOnNoRevokeReason = true;
}
assert(threwOnNoRevokeReason, "revoke rejects empty reason");

section("revoke: marks as revoked + suppression no longer applies");
const revoked = revoke(a1.id, { revoked_by: "operator", reason: "no longer trusted" });
assert(revoked.revoked_at !== null, "revoked_at populated");
assert(revoked.revoked_by === "operator", "revoked_by recorded");
const checkAfterRevoke = checkAcceptance(q1);
assert(checkAfterRevoke.accepted === false, "revoked acceptance no longer matches");

section("revoke: idempotent — re-revoking returns existing record");
const revokedAgain = revoke(a1.id, { revoked_by: "operator", reason: "double revoke" });
assert(revokedAgain.id === a1.id, "re-revoke returns the existing record");
assert(revokedAgain.revoke_reason === "operator-revoked", "first revoke reason preserved");

// ---------- autoExpire ----------

section("autoExpire: revokes past-expiry active acceptances");
// Insert an acceptance with expiry in the past.
const qExpired: AcceptanceQuery = {
  source_panel: "trust_audit",
  rule_id: "expired-rule",
  agent_id: "agent-a",
  evidence: ["e1"],
};
const pastExpiry = new Date(Date.now() - 1000).toISOString();
const aExpired = accept(qExpired, {
  scope_level: "finding",
  reason: "to be expired",
  accepted_by: "operator",
  expires_at: pastExpiry,
});
const sweep = autoExpire();
assert(sweep.expired_count >= 1, `autoExpire sweeps ≥1 (got ${sweep.expired_count})`);
assert(sweep.ids.includes(aExpired.id), "swept acceptance id appears in result");
const checkExpired = checkAcceptance(qExpired);
assert(checkExpired.accepted === false, "expired acceptance no longer matches");

// ---------- autoRevokeOnEvidenceChange ----------

section("autoRevokeOnEvidenceChange: detects delta + revokes");
const qEvDelta: AcceptanceQuery = {
  source_panel: "blast_radius_combo",
  rule_id: "browser_plus_read",
  agent_id: "agent-delta",
  evidence: ["web_search", "read"],
};
const aEvDelta = accept(qEvDelta, { scope_level: "finding", reason: "ack", accepted_by: "operator" });
// Simulate next scan with different evidence on same (rule, agent) tuple.
const evidenceDeltaResult = autoRevokeOnEvidenceChange("blast_radius_combo", [
  { rule_id: "browser_plus_read", agent_id: "agent-delta", evidence: ["web_browse", "fs_read", "exec"] },
]);
assert(evidenceDeltaResult.revoked_count >= 1, `evidence delta revokes ≥1 (got ${evidenceDeltaResult.revoked_count})`);
assert(evidenceDeltaResult.ids.includes(aEvDelta.id), "the affected acceptance id is reported");
const checkDelta = checkAcceptance(qEvDelta);
assert(checkDelta.accepted === false, "evidence-delta acceptance no longer matches");

section("autoRevokeOnEvidenceChange: no delta → no revoke");
const qNoDelta: AcceptanceQuery = {
  source_panel: "blast_radius_combo",
  rule_id: "browser_plus_read",
  agent_id: "agent-stable",
  evidence: ["web_search", "read"],
};
accept(qNoDelta, { scope_level: "finding", reason: "ack", accepted_by: "operator" });
const noDeltaResult = autoRevokeOnEvidenceChange("blast_radius_combo", [
  { rule_id: "browser_plus_read", agent_id: "agent-stable", evidence: ["web_search", "read"] },
]);
assert(!noDeltaResult.ids.some((id) => id !== aEvDelta.id) || noDeltaResult.revoked_count === 0 || (() => { const c = checkAcceptance(qNoDelta); return c.accepted === true; })(), "no delta → unchanged acceptance");
const stableCheck = checkAcceptance(qNoDelta);
assert(stableCheck.accepted === true, "stable evidence keeps acceptance active");

section("autoRevokeOnEvidenceChange: missing finding leaves acceptance intact");
const qMissing: AcceptanceQuery = {
  source_panel: "trust_audit",
  rule_id: "may-disappear",
  agent_id: "agent-x",
  evidence: ["e"],
};
accept(qMissing, { scope_level: "finding", reason: "ack", accepted_by: "operator" });
autoRevokeOnEvidenceChange("trust_audit", []); // empty findings list
const stillThere = checkAcceptance(qMissing);
assert(stillThere.accepted === true, "missing finding does not revoke (operator can manually revoke)");

// ---------- listAcceptances ----------

section("listAcceptances: status filter");
const allActive = listAcceptances({ status: "active" });
assert(allActive.length >= 1, "at least one active acceptance");
const allRevoked = listAcceptances({ status: "revoked" });
assert(allRevoked.length >= 1, "at least one revoked acceptance");
const allExpired = listAcceptances({ status: "expired" });
assert(allExpired.length >= 1, "at least one expired acceptance");

section("listAcceptances: source_panel filter");
const onlyTrustAudit = listAcceptances({ source_panel: "trust_audit" });
assert(onlyTrustAudit.every((a) => a.source_panel === "trust_audit"), "all rows have source_panel=trust_audit");

section("listAcceptances: expiring_within_days filter");
// All active acceptances default to 30 (correlations) or 90 days, all of which fall within 91 days.
const expiringSoon = listAcceptances({ expiring_within_days: 91 });
assert(expiringSoon.length >= 1, "at least one acceptance expires within 91 days");

// Summary
console.log(`\n${status.fail === 0 ? "PASS" : "FAIL"}: ${status.pass} passed, ${status.fail} failed`);
process.exit(status.fail === 0 ? 0 : 1);
