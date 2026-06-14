// Deterministic finding-signature computation.
//
// Each finding produces three candidate signatures (one per scope level).
// The orchestrator picks the strongest match (finding > agent_rule >
// rule_global) when checking acceptances.
//
// Signatures are SHA-256 hex digests. Missing fields default to "-" so the
// hash domain stays well-defined. Evidence is sorted before hashing so
// caller order doesn't affect the hash.
//
// Spec: docs/superpowers/specs/2026-04-23-risk-acceptance-design.md §3.4

import { createHash } from "node:crypto";
import type { AcceptanceQuery } from "./types";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable hash of evidence: sort, JSON-stringify, hash. */
export function evidenceHash(evidence: string[] | undefined | null): string {
  if (!evidence || evidence.length === 0) return sha256("-");
  return sha256(JSON.stringify([...evidence].sort()));
}

function nullable(v: string | null | undefined): string {
  return v && v.length > 0 ? v : "-";
}

export function computeSignatures(q: AcceptanceQuery): {
  finding: string;
  agent_rule: string;
  rule_global: string;
} {
  const panel = q.source_panel;
  const rule = q.rule_id;
  const agent = nullable(q.agent_id);
  const surface = nullable(q.surface_id);
  const evHash = evidenceHash(q.evidence);

  return {
    finding: sha256(`${panel}|${rule}|${agent}|${surface}|${evHash}`),
    agent_rule: sha256(`${panel}|${rule}|${agent}|${surface}`),
    rule_global: sha256(`${panel}|${rule}`),
  };
}
