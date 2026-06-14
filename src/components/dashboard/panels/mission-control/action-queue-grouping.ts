/**
 * action-queue-grouping.ts
 *
 * vNext spec §8: collapse repeat-action pressure into single grouped rows
 * so operators don't see five rows that all require the same immediate move.
 *
 * Pure: no I/O, no fetch, no side effects. Deterministic — same input
 * produces the same output regardless of polling order.
 *
 * Group key (vNext spec §8.1, simplified for v1):
 *   1. Same family (closed source-family enum on the row).
 *   2. Same incidentType (free-form sub-key set by each row mapper).
 *   3. Same permission/restriction state.
 *   4. Same primary destination tab.
 *
 * Two rows that share all four collapse into one ActionGroup. Per-affected-
 * object grouping (per-session, per-agent) is deferred to v1.1 — incidentType
 * already captures most of the operator-visible "this is the same problem"
 * signal (e.g., "dangerous-combo:exec-write" matches across 3 different
 * agents with the same combo).
 *
 * Lead-member selection (rendered as the group's row):
 *   1. Highest priorityScore wins.
 *   2. Tie → highest severity.
 *   3. Tie → row.id ascending (stable, deterministic).
 *
 * Aggregates surfaced on the group:
 *   - count (≥1; singletons pass through with isCluster=false)
 *   - maxSeverity across members
 *   - strongestEvidenceKind across members (exact > audit > fallback > signal > health)
 *   - age range (newestAgeMs / oldestAgeMs)
 */

import type { ActionRow, IncidentFamily } from "./types";

export interface ActionGroup {
  /** Stable group id derived from the group key. */
  id: string;
  /** All rows that share this group key. Always ≥1. */
  members: ActionRow[];
  /** The single row whose fields render in the queue UI for this group. */
  lead: ActionRow;
  /** members.length. Singletons = 1; clusters = 2+. */
  count: number;
  /** Family taken from lead (all members share it by definition). */
  family?: IncidentFamily;
  /** Incident type taken from lead (all members share it). */
  incidentType?: string;
  /** Highest severity rank across members. */
  maxSeverity: ActionRow["severity"];
  /** Strongest evidence-confidence kind across members. */
  strongestEvidenceKind: string;
  /** Smallest ageMs across members (newest event). */
  newestAgeMs: number;
  /** Largest ageMs across members (oldest event). */
  oldestAgeMs: number;
  /** True when count ≥ 2 (a real cluster, not a singleton). */
  isCluster: boolean;
}

// ---------------------------------------------------------------------------
// Ranking tables — exported so the verifier + UI can reuse them
// ---------------------------------------------------------------------------

export const SEVERITY_RANK: Record<ActionRow["severity"], number> = {
  CRIT: 5,
  HIGH: 4,
  MED:  3,
  WARN: 2,
  LOW:  1,
};

export const EVIDENCE_RANK: Record<string, number> = {
  exact:    5,
  audit:    4,
  fallback: 3,
  signal:   2,
  health:   1,
};

// ---------------------------------------------------------------------------
// Group key — single source of truth for which rows collapse together
// ---------------------------------------------------------------------------

/**
 * Build the group key for a row. Two rows that produce the same string here
 * collapse into one ActionGroup; otherwise they stay separate.
 *
 * Pipe `|` is used as a field separator — it's not legal in TabId and the
 * upstream incidentType helpers already lowercase + slug their inputs, so
 * collisions across different tuples are not possible.
 */
function groupKey(row: ActionRow): string {
  const family = row.family ?? "unknown";
  // Fall back through incidentType → source so legacy rows without the
  // taxonomy still produce SOMETHING stable. Pure pass-through grouping
  // (every row in its own group) is the worst case — never wrong.
  const incidentType =
    row.incidentType ?? row.source ?? "unknown";
  const restricted = row.restricted ? "1" : "0";
  const dest = row.clickTarget?.tab ?? "none";
  return `${family}|${incidentType}|${restricted}|${dest}`;
}

// ---------------------------------------------------------------------------
// Lead-member selection
// ---------------------------------------------------------------------------

function pickLead(members: ActionRow[]): ActionRow {
  return members.reduce((best, candidate) => {
    // 1. Priority score
    if (candidate.priorityScore !== best.priorityScore) {
      return candidate.priorityScore > best.priorityScore ? candidate : best;
    }
    // 2. Severity rank
    const sevA = SEVERITY_RANK[candidate.severity];
    const sevB = SEVERITY_RANK[best.severity];
    if (sevA !== sevB) return sevA > sevB ? candidate : best;
    // 3. Row id ascending — deterministic stable order
    return candidate.id < best.id ? candidate : best;
  }, members[0]);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Group an array of ActionRow into ActionGroup. Output preserves the order in
 * which group keys first appeared in the input — so callers that want
 * priority-ranked output should sort `rows` BEFORE calling, then sort the
 * resulting groups by `lead.priorityScore` afterward if needed.
 *
 * Pure. Idempotent. Safe to call on every render.
 */
export function groupActionRows(rows: ActionRow[]): ActionGroup[] {
  const groups: Record<string, ActionRow[]> = {};
  const order: string[] = [];
  for (const row of rows) {
    const key = groupKey(row);
    if (!(key in groups)) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(row);
  }

  const out: ActionGroup[] = [];
  for (const key of order) {
    const members = groups[key];
    const lead = pickLead(members);

    // maxSeverity — highest rank
    let maxSeverity: ActionRow["severity"] = members[0].severity;
    for (const r of members) {
      if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[maxSeverity]) {
        maxSeverity = r.severity;
      }
    }

    // strongestEvidenceKind — highest rank in the EVIDENCE_RANK table
    let strongestEvidenceKind: string = members[0].evidence.kind;
    for (const r of members) {
      const a = EVIDENCE_RANK[r.evidence.kind] ?? 0;
      const b = EVIDENCE_RANK[strongestEvidenceKind] ?? 0;
      if (a > b) strongestEvidenceKind = r.evidence.kind;
    }

    // age range
    let newestAgeMs = members[0].ageMs;
    let oldestAgeMs = members[0].ageMs;
    for (const r of members) {
      if (r.ageMs < newestAgeMs) newestAgeMs = r.ageMs;
      if (r.ageMs > oldestAgeMs) oldestAgeMs = r.ageMs;
    }

    out.push({
      id: `group-${key}`,
      members,
      lead,
      count: members.length,
      family: lead.family,
      incidentType: lead.incidentType,
      maxSeverity,
      strongestEvidenceKind,
      newestAgeMs,
      oldestAgeMs,
      isCluster: members.length >= 2,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sort comparator — stable tie-breakers per vNext spec §7.1
// ---------------------------------------------------------------------------

/**
 * Compare two groups for queue ordering. vNext spec §7.1:
 *   1. priorityScore DESC (lead's score)
 *   2. severity weight DESC
 *   3. evidence confidence weight DESC
 *   4. age bonus (newer first)
 *   5. stable group id ascending
 *
 * Use this with `groups.sort(compareActionGroups)` — never rely on the
 * polling/fetch order to determine queue rank.
 */
export function compareActionGroups(a: ActionGroup, b: ActionGroup): number {
  if (a.lead.priorityScore !== b.lead.priorityScore) {
    return b.lead.priorityScore - a.lead.priorityScore;
  }
  const sevDelta = SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity];
  if (sevDelta !== 0) return sevDelta;
  const evDelta =
    (EVIDENCE_RANK[b.strongestEvidenceKind] ?? 0)
    - (EVIDENCE_RANK[a.strongestEvidenceKind] ?? 0);
  if (evDelta !== 0) return evDelta;
  if (a.newestAgeMs !== b.newestAgeMs) return a.newestAgeMs - b.newestAgeMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
