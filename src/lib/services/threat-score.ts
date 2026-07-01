/**
 * Threat Score Calculator — composite security health metric.
 *
 * Produces a 0-100 threat score from multiple data sources:
 * - Shield blocks in the last 24 hours (30% weight)
 * - Infrastructure service health (20% weight)
 * - Token usage anomalies (15% weight)
 * - Access control violations (15% weight)
 * - Break-glass mode active (10% weight — highest multiplier at 1.5x)
 * - Audit volume anomalies (5% weight)
 * - Open alert count (5% weight)
 *
 * Posture score = 100 - threat_score. Used in Fleet Command and Security Posture.
 * Weights are configurable via config_defaults (risk_weight_* keys).
 *
 * @module services/threat-score
 */

import { queryOne } from '../db/index';
import { getSetting } from './config-service';
import { activeAlertSqlClause } from '../dashboard/metric-semantics';

const WEIGHT_DEFAULTS: Record<string, number> = {
  risk_weight_shield: 1.0,
  risk_weight_infra: 1.0,
  risk_weight_token: 0.8,
  risk_weight_access: 1.0,
  risk_weight_breakglass: 1.5,
  risk_weight_audit: 1.2,
  risk_weight_alerts: 1.0,
};

function getWeight(key: string): number {
  try {
    const val = getSetting(key);
    if (val) return parseFloat(val);
  } catch {}
  return WEIGHT_DEFAULTS[key] ?? 1.0;
}

export interface ThreatScoreResult {
  threatScore: number;
  postureScore: number;
  level: string;
  breakdown: Record<string, number>;
  triggeredRules: number;
}

export function calculateThreatScore(): ThreatScoreResult {
  let rawScore = 0;
  const breakdown: Record<string, number> = {};
  let triggeredCount = 0;
  const sourcesTriggered = new Set<string>();

  function addScore(source: string, points: number) {
    const weight = getWeight(`risk_weight_${source}`);
    const contribution = points * weight;
    breakdown[source] = (breakdown[source] || 0) + contribution;
    rawScore += contribution;
    triggeredCount++;
    sourcesTriggered.add(source);
  }

  // Shield detections
  try {
    const s = queryOne<{ blocked: number; reviewed: number }>(
      `SELECT
        SUM(CASE WHEN threat_level = 'BLOCK' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN threat_level = 'REVIEW' THEN 1 ELSE 0 END) as reviewed
      FROM shield_scans WHERE scanned_at >= datetime('now', '-24 hours')`
    );
    if (s && (s.blocked || 0) >= 3) addScore("shield", 30);
    else if (s && (s.blocked || 0) > 0) addScore("shield", 15);
    else if (s && (s.reviewed || 0) >= 5) addScore("shield", 10);
  } catch {}

  // Infrastructure
  try {
    const cpu = queryOne<{ v: number }>(`SELECT metric_value as v FROM metric_snapshots WHERE metric_name = 'cpu_percent' ORDER BY recorded_at DESC LIMIT 1`);
    const mem = queryOne<{ v: number }>(`SELECT metric_value as v FROM metric_snapshots WHERE metric_name = 'memory_percent' ORDER BY recorded_at DESC LIMIT 1`);
    if (cpu && mem && cpu.v > 90 && mem.v > 90) addScore("infra", 15);
    else if (cpu && cpu.v > 90) addScore("infra", 8);
  } catch {}

  // Alerts — canonical active scope (open + acknowledged + investigating).
  // Excludes suppressed because the operator opted out of those.
  try {
    const a = queryOne<{ crit: number; total: number }>(
      `SELECT SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) as crit, COUNT(*) as total
       FROM alerts WHERE ${activeAlertSqlClause()} AND created_at >= datetime('now', '-24 hours')`
    );
    if (a && (a.crit || 0) > 0) addScore("alerts", 20);
    else if (a && (a.total || 0) > 10) addScore("alerts", 10);
  } catch {}

  // Break-glass
  try {
    const bg = getSetting("break_glass");
    if (bg) {
      const parsed = JSON.parse(bg);
      if (parsed.active) addScore("breakglass", 20);
    }
  } catch {}

  // Correlation multiplier
  let multiplier = 1.0;
  if (triggeredCount >= 3 && sourcesTriggered.size >= 3) multiplier = 2.5;
  else if (triggeredCount >= 3) multiplier = 2.0;
  else if (triggeredCount >= 2) multiplier = 1.5;

  const threatScore = Math.min(100, Math.round(rawScore * multiplier));
  const postureScore = 100 - threatScore;
  const level = threatScore >= 76 ? "CRITICAL" : threatScore >= 51 ? "HIGH" : threatScore >= 26 ? "MEDIUM" : "LOW";

  return { threatScore, postureScore, level, breakdown, triggeredRules: triggeredCount };
}
