/**
 * ClawNex posture-service — canonical reads for posture/readiness scores.
 *
 * Why this module exists:
 *   Dogfood QA found the dashboard showing two posture numbers on Fleet
 *   Command at the same time: 52% from the Readiness Banner (latest
 *   Clawkeeper hardening scan) and 25% from the Fleet table (composite
 *   threat-score postureScore = 100 - threatScore). Both surfaces called
 *   them "Posture." Operators couldn't tell which was authoritative, and
 *   the two scores measure entirely different things.
 *
 * Taxonomy (per the reviewer's QA fix plan §P0):
 *   - `clawkeeper_hardening_score`: the latest Clawkeeper scan score from
 *     `security_scans`. A point-in-time host-hardening grade. Surfaced by
 *     Security Posture panel, Fleet table (relabeled "Hardening"), and the
 *     Readiness Banner posture signal.
 *   - `threat_pressure_score`: the composite from `threat-score.ts`,
 *     combining shield activity, alerts, infra load, and break-glass usage.
 *     A dynamic operational-pressure indicator. Will be relabeled "Threat
 *     Pressure" wherever it surfaces (separate from posture entirely).
 *   - `deployment_readiness_state`: pass/partial/fail summary across
 *     auth/shield/providers/trust/posture in the Readiness Banner. Not a
 *     numeric score on its own — it consumes the above two as inputs.
 *
 * Consumers must call into this module rather than reading
 * `security_scans` or `calculateThreatScore` directly so the definitions
 * stay coherent.
 */

import { queryOne } from '../db/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClawkeeperPosture {
  /** 0-100, higher is better. */
  score: number;
  /** A-F grade derived during the scan. */
  grade: string | null;
  scanId: string;
  scannedAt: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  /** Always 'clawkeeper' for now; could include other scanners later. */
  source: string;
}

export type ReadinessPostureLevel = 'pass' | 'partial' | 'fail' | 'unscanned';

export interface ReadinessPostureSignal {
  level: ReadinessPostureLevel;
  /** The underlying clawkeeper posture, if any scan has run. */
  posture: ClawkeeperPosture | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Read the most recent Clawkeeper hardening posture from `security_scans`.
 * Returns null if no scan has ever run on this host. The Fleet table,
 * Readiness Banner, and Security Posture panel all consume this single
 * function so they show the same score for the same scan.
 */
export function getLatestClawkeeperPosture(): ClawkeeperPosture | null {
  try {
    const row = queryOne<{
      id: string;
      scanner: string;
      overall_grade: string | null;
      overall_score: number | null;
      total_checks: number | null;
      passed_checks: number | null;
      failed_checks: number | null;
      scanned_at: string;
    }>(
      `SELECT id, scanner, overall_grade, overall_score, total_checks, passed_checks, failed_checks, scanned_at
       FROM security_scans ORDER BY scanned_at DESC LIMIT 1`
    );
    if (!row || row.overall_score == null) return null;
    return {
      score: row.overall_score,
      grade: row.overall_grade,
      scanId: row.id,
      scannedAt: row.scanned_at,
      totalChecks: row.total_checks ?? 0,
      passedChecks: row.passed_checks ?? 0,
      failedChecks: row.failed_checks ?? 0,
      source: row.scanner || 'clawkeeper',
    };
  } catch (err) {
    console.error('[posture-service] getLatestClawkeeperPosture error:', err);
    return null;
  }
}

// Thresholds for the readiness pass/partial/fail mapping. These match the
// Readiness Banner's prior implementation so existing UI behavior is
// preserved; only the source-of-truth has been centralized.
const READINESS_PASS_MIN = 80;
const READINESS_PARTIAL_MIN = 50;

/**
 * Map the latest Clawkeeper score to a readiness pass/partial/fail/unscanned
 * signal. The Readiness Banner consumes this so its threshold logic lives
 * here, not in UI code.
 */
export function getReadinessPostureSignal(): ReadinessPostureSignal {
  const posture = getLatestClawkeeperPosture();
  if (!posture) return { level: 'unscanned', posture: null };
  if (posture.score >= READINESS_PASS_MIN) return { level: 'pass', posture };
  if (posture.score >= READINESS_PARTIAL_MIN) return { level: 'partial', posture };
  return { level: 'fail', posture };
}
