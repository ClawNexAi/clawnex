/**
 * Pure scoring functions for Mission Control posture and action queue.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md §6, §7.2
 *
 * Every function here is:
 *   - Pure (no I/O, no side effects, no `Date.now()` reads)
 *   - Deterministic (same input → same output)
 *   - Bounded (0-100 for posture scores; integer for priority)
 *   - Documented inline with the formula from the spec
 *
 * The "no magic score" rule (spec §6) means every formula here is also
 * surfaced to operators via the row tooltip in OperationalPosture.tsx.
 */

import type { Severity } from "./types";

// ---------------------------------------------------------------------------
// §6.1 Shield + Policy Coverage
// ---------------------------------------------------------------------------

export interface ShieldPolicyCoverageInputs {
  activeCoreRules: number;
  totalCoreRules: number;
  activeEgressStarter: number;
  totalEgressStarter: number;
  unsafeRegexCount: number;
  totalPolicyRules: number;
}

/**
 * Composite: 70% weight on core-rule coverage, 20% on egress-starter coverage,
 * 10% on absence of unsafe regex. All weights inline-documented per spec.
 *
 * Edge case: when all three totals are zero (no rules loaded at all), the
 * "no unsafe regex" component still contributes 10 — so the score is 10,
 * not 0. ClawNex always boots with rules loaded, so this is a sentinel
 * distinct from "rules loaded but disabled" (which yields 0 + 0 + 10 = 10
 * by the same arithmetic — also intentional).
 */
export function scoreShieldPolicyCoverage(i: ShieldPolicyCoverageInputs): number {
  const coreRatio = i.totalCoreRules === 0 ? 0 : i.activeCoreRules / i.totalCoreRules;
  const egressRatio = i.totalEgressStarter === 0 ? 0 : i.activeEgressStarter / i.totalEgressStarter;
  const safeRatio = i.totalPolicyRules === 0 ? 1 : 1 - i.unsafeRegexCount / i.totalPolicyRules;
  const score = coreRatio * 70 + egressRatio * 20 + safeRatio * 10;
  // Use floor so any nonzero unsafe-regex penalty is never rounded away —
  // spec requires the score to be visibly < 100 whenever unsafe rules exist.
  return clamp(Math.floor(score), 0, 100);
}

// ---------------------------------------------------------------------------
// §6.2 Evidence Quality
// ---------------------------------------------------------------------------

export interface EvidenceQualityInputs {
  forwardCount: number;
  snippetPresentCount: number;
  outsideWindowFetchableCount: number;
  totalResolvable: number;
}

/**
 * 70% on forward correlation (deterministic), 20% on snippet presence,
 * 10% on outside-window-fetchability. Empty input yields 0 — distinct from
 * scoreSourceFreshness which returns 100 on empty. Rationale: "no evidence
 * to score" is a coverage failure, not a target state.
 */
export function scoreEvidenceQuality(i: EvidenceQualityInputs): number {
  if (i.totalResolvable === 0) return 0;
  const forwardRatio = i.forwardCount / i.totalResolvable;
  const snippetRatio = i.snippetPresentCount / i.totalResolvable;
  const fetchableRatio = i.outsideWindowFetchableCount / i.totalResolvable;
  const score = forwardRatio * 70 + snippetRatio * 20 + fetchableRatio * 10;
  return clamp(Math.round(score), 0, 100);
}

// ---------------------------------------------------------------------------
// §6.3 Incident Hygiene
// ---------------------------------------------------------------------------

export interface IncidentHygieneInputs {
  openCount: number;
  criticalCount: number;
  highCount: number;
  /** Age of the oldest open incident in milliseconds. */
  oldestAgeMs: number;
  /** Acknowledged but not resolved within 2 hours. */
  ackButNotResolvedCount: number;
}

/**
 * Penalize from 100. Per spec §6.3:
 *   - 5 per open incident (capped contribution)
 *   - 15 per critical (no cap — intentional: a few criticals already collapse the score, which is the desired hygiene signal)
 *   - 5 per high
 *   - age penalty: >1h cuts a little, >24h cuts more, >3d cuts hardest
 *   - 5 per ack-but-not-resolved over 2h
 * Score floors at 0.
 */
export function scoreIncidentHygiene(i: IncidentHygieneInputs): number {
  let score = 100;
  score -= Math.min(i.openCount * 5, 30);
  score -= i.criticalCount * 15;
  score -= i.highCount * 5;
  score -= ageBucketPenalty(i.oldestAgeMs);
  score -= Math.min(i.ackButNotResolvedCount * 5, 20);
  return clamp(score, 0, 100);
}

function ageBucketPenalty(ageMs: number): number {
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  if (ageMs >= 3 * DAY) return 30;
  if (ageMs >= DAY) return 20;
  if (ageMs >= HOUR) return 10;
  return 0;
}

// ---------------------------------------------------------------------------
// §6.4 Source Freshness — weakest-link
// ---------------------------------------------------------------------------

export interface CollectorFreshness {
  name: string;
  lastSeenMsAgo: number;
  staleThresholdMs: number;
}

/**
 * Per-collector: 100 if last_seen ≤ stale threshold, then linearly degrade to
 * 0 at 2× threshold. Composite = min(per-collector scores) — weakest link
 * dominates so a single dead collector pulls the whole posture down.
 *
 * Empty input → 100 (no collectors registered = target state, not failure).
 */
export function scoreSourceFreshness(collectors: CollectorFreshness[]): number {
  if (collectors.length === 0) return 100;
  const perCollectorScores = collectors.map((c) => {
    if (c.lastSeenMsAgo <= c.staleThresholdMs) return 100;
    if (c.lastSeenMsAgo >= 2 * c.staleThresholdMs) return 0;
    const ratio = (c.lastSeenMsAgo - c.staleThresholdMs) / c.staleThresholdMs;
    return Math.round((1 - ratio) * 100);
  });
  return Math.min(...perCollectorScores);
}

// ---------------------------------------------------------------------------
// §6.5 Cost Discipline
// ---------------------------------------------------------------------------

export interface CostDisciplineInputs {
  activeSignalCount: number;
  unknownOrTokenOnlyCount: number;
  totalCostRows: number;
  anyStaleSource: boolean;
}

/**
 * Start at 100. Subtract:
 *   - 15 per active drain signal
 *   - data-quality % (unknown/token-only ratio × 50)
 *   - 20 if any cost source is stale beyond its threshold
 * Score floors at 0.
 */
export function scoreCostDiscipline(i: CostDisciplineInputs): number {
  let score = 100;
  score -= i.activeSignalCount * 15;
  if (i.totalCostRows > 0) {
    score -= Math.round((i.unknownOrTokenOnlyCount / i.totalCostRows) * 50);
  }
  if (i.anyStaleSource) score -= 20;
  return clamp(score, 0, 100);
}

// ---------------------------------------------------------------------------
// §7.2 Action Queue priority
// ---------------------------------------------------------------------------

export type ActionEvidenceKind = "exact" | "fallback" | "signal" | "health" | "audit";

export interface ActionPriorityInputs {
  severity: Severity;
  ageMs: number;
  evidenceKind: ActionEvidenceKind;
}

/**
 * priority_score = severity_weight + age_bonus + evidence_confidence_bonus
 *
 * Higher = more urgent. ORDER BY this score DESC for the Action Queue.
 */
export function computeActionPriority(i: ActionPriorityInputs): number {
  return severityWeight(i.severity) + ageBonus(i.ageMs) + evidenceBonus(i.evidenceKind);
}

/**
 * Operator-readable explanation of the priority score using the SAME weights
 * computeActionPriority uses. vNext spec §7.2: "Score 125 = CRIT 100 + recent
 * 10 + exact 15". Surfaced via a hover title on each Action Queue row so the
 * operator can understand the rank without leaving the queue.
 *
 * No separate UI-only formula — if computeActionPriority changes, this
 * function changes alongside it. Always pure.
 */
export function explainActionPriority(i: ActionPriorityInputs): string {
  const sev = severityWeight(i.severity);
  const age = ageBonus(i.ageMs);
  const ev  = evidenceBonus(i.evidenceKind);
  const total = sev + age + ev;
  // Age label maps to the same bucket boundaries as ageBonus.
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  const ageLabel =
    i.ageMs < HOUR        ? "recent"
    : i.ageMs < 4 * HOUR  ? "<4h"
    : i.ageMs < DAY       ? "<1d"
    : i.ageMs < 3 * DAY   ? "<3d"
    : "old";
  return `Score ${total} = ${i.severity} ${sev} + ${ageLabel} ${age} + ${i.evidenceKind} ${ev}`;
}

function severityWeight(s: Severity): number {
  // Fallback to LOW (10) keeps unknown severities at the bottom of the queue rather than NaN.
  return { CRIT: 100, HIGH: 70, MED: 40, WARN: 25, LOW: 10 }[s] ?? 10;
}

function ageBonus(ageMs: number): number {
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  if (ageMs < HOUR) return 20;
  if (ageMs < 4 * HOUR) return 15;
  if (ageMs < DAY) return 10;
  if (ageMs < 3 * DAY) return 5;
  return 0;
}

function evidenceBonus(kind: ActionEvidenceKind): number {
  // Bonus weights by confidence tier (spec §7.2 + audit variant added in v1.0):
  //   exact  = 15 (deterministic forward correlation — highest confidence)
  //   audit  = 12 (trust audit finding — structured, rule-derived evidence)
  //   fallback = 10 (nearest-session heuristic — still highly reliable)
  //   signal = 8  (cost anomaly signal — indirect, no direct event linkage)
  //   health = 5  (collector health — lowest confidence, infra-level only)
  // Fallback to "health" tier (5) — least confident — for unknown kinds.
  return { exact: 15, audit: 12, fallback: 10, signal: 8, health: 5 }[kind] ?? 5;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
