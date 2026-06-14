/**
 * POST /api/correlations/evaluate — Run all correlation rules against current platform state.
 * GET  /api/correlations/evaluate — Get latest threat score without triggering new evaluation.
 *
 * Evaluates 10 correlation rules across all platform sources.
 * Returns: threat_score (0-100), level, active correlations, source breakdown.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { queryOne, queryAll, run } from "@/lib/db/index";
import { getSetting } from "@/lib/services/config-service";
import { createAlert } from "@/lib/services/alert-manager";
import { broadcast } from "@/lib/events";
import { v4 as uuid } from "uuid";
import { activeAlertSqlClause } from "@/lib/dashboard/metric-semantics";
import {
  applySuppressions as applyRiskSuppressions,
  autoExpire as autoExpireRiskAcceptances,
} from "@/lib/services/risk-acceptance";
import { evaluateRules, type PlatformState, type RuleResult } from "@/lib/services/correlation-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Risk weight defaults
// ---------------------------------------------------------------------------

const WEIGHT_KEYS: Record<string, number> = {
  risk_weight_shield: 1.0,
  risk_weight_infra: 1.0,
  risk_weight_token: 0.8,
  risk_weight_access: 1.0,
  risk_weight_breakglass: 1.5,
  risk_weight_audit: 1.2,
  risk_weight_alerts: 1.0,
};

// 2026-04-22 (Task 9 — perf): load all weights once per request into a local map
// rather than hitting config_defaults per-rule-per-source (previously ~7+ SELECTs).
function loadWeights(): Record<string, number> {
  const weights: Record<string, number> = { ...WEIGHT_KEYS };
  for (const key of Object.keys(WEIGHT_KEYS)) {
    try {
      const val = getSetting(key);
      if (val) {
        const parsed = parseFloat(val);
        if (!Number.isNaN(parsed)) weights[key] = parsed;
      }
    } catch {}
  }
  return weights;
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

function gatherState(): PlatformState {
  const state: PlatformState = {
    shield: { blocked24h: 0, reviewed24h: 0, total24h: 0, categoriesHit: [] },
    traffic: { total24h: 0, blocked24h: 0, avgTokens: 0, topModel: "" },
    infra: { cpuPercent: 0, memPercent: 0, servicesDown: 0 },
    alerts: { openCritical: 0, openHigh: 0, openTotal: 0, newLast10min: 0 },
    accessList: { denyHits24h: 0 },
    breakGlass: { active: false, reason: null },
    tokens: { total24h: 0, anomaly: false },
    audit: { configChanges10min: 0, whitelistChanges10min: 0 },
  };

  try {
    const s = queryOne<{ blocked: number; reviewed: number; total: number }>(
      `SELECT
        SUM(CASE WHEN threat_level = 'BLOCK' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN threat_level = 'REVIEW' THEN 1 ELSE 0 END) as reviewed,
        COUNT(*) as total
      FROM shield_scans WHERE scanned_at >= datetime('now', '-24 hours')`
    );
    if (s) { state.shield.blocked24h = s.blocked || 0; state.shield.reviewed24h = s.reviewed || 0; state.shield.total24h = s.total || 0; }

    const cats = queryAll<{ layers_triggered: string }>(
      `SELECT DISTINCT layers_triggered FROM shield_scans WHERE threat_level IN ('BLOCK','REVIEW') AND scanned_at >= datetime('now', '-24 hours') AND layers_triggered != 'none'`
    );
    state.shield.categoriesHit = cats.map(c => c.layers_triggered).filter(Boolean);
  } catch {}

  try {
    const t = queryOne<{ cnt: number; blocked: number; avg_tok: number }>(
      `SELECT COUNT(*) as cnt, SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked, COALESCE(AVG(total_tokens), 0) as avg_tok FROM proxy_traffic WHERE timestamp >= datetime('now', '-24 hours') AND source != 'session-watcher'`
    );
    if (t) { state.traffic.total24h = t.cnt; state.traffic.blocked24h = t.blocked || 0; state.traffic.avgTokens = Math.round(t.avg_tok); }
  } catch {}

  try {
    const cpu = queryOne<{ v: number }>(`SELECT metric_value as v FROM metric_snapshots WHERE metric_name = 'cpu_percent' ORDER BY recorded_at DESC LIMIT 1`);
    const mem = queryOne<{ v: number }>(`SELECT metric_value as v FROM metric_snapshots WHERE metric_name = 'memory_percent' ORDER BY recorded_at DESC LIMIT 1`);
    if (cpu) state.infra.cpuPercent = cpu.v;
    if (mem) state.infra.memPercent = mem.v;
  } catch {}

  try {
    const a = queryOne<{ crit: number; high: number; total: number }>(
      `SELECT
        SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) as crit,
        SUM(CASE WHEN severity = 'HIGH' THEN 1 ELSE 0 END) as high,
        COUNT(*) as total
      FROM alerts WHERE ${activeAlertSqlClause()}`
    );
    if (a) { state.alerts.openCritical = a.crit || 0; state.alerts.openHigh = a.high || 0; state.alerts.openTotal = a.total || 0; }

    const recent = queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM alerts WHERE created_at >= datetime('now', '-10 minutes')`);
    if (recent) state.alerts.newLast10min = recent.cnt;
  } catch {}

  try {
    const bg = getSetting("break_glass");
    if (bg) {
      const parsed = JSON.parse(bg);
      state.breakGlass.active = parsed.active || false;
      state.breakGlass.reason = parsed.reason || null;
    }
  } catch {}

  try {
    const ac = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM audit_log WHERE (action LIKE '%config%' OR action LIKE '%whitelist%' OR action LIKE '%block_mode%') AND created_at >= datetime('now', '-10 minutes')`
    );
    if (ac) state.audit.configChanges10min = ac.cnt;
  } catch {}

  try {
    const tok = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(total_tokens), 0) as total FROM proxy_traffic WHERE timestamp >= datetime('now', '-24 hours')`
    );
    if (tok) state.tokens.total24h = tok.total;

    // Check for token anomaly (current hour vs average)
    const currentHour = queryOne<{ cnt: number }>(`SELECT COALESCE(SUM(total_tokens), 0) as cnt FROM proxy_traffic WHERE timestamp >= datetime('now', '-1 hour')`);
    const avgHour = queryOne<{ avg: number }>(`SELECT COALESCE(AVG(hourly_tokens), 0) as avg FROM (SELECT SUM(total_tokens) as hourly_tokens FROM proxy_traffic WHERE timestamp >= datetime('now', '-24 hours') GROUP BY strftime('%H', timestamp))`);
    if (currentHour && avgHour && avgHour.avg > 0 && currentHour.cnt > avgHour.avg * 5) {
      state.tokens.anomaly = true;
    }
  } catch {}

  return state;
}


// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

function calculateScore(
  rules: RuleResult[],
  weights: Record<string, number>,
): {
  score: number;
  level: string;
  breakdown: Record<string, number>;
  weights_applied: Record<string, number>;
  correlation_multiplier: number;
  raw_score: number;
  triggered_count: number;
  unique_sources: number;
} {
  const breakdown: Record<string, number> = {};
  const weights_applied: Record<string, number> = {};
  let rawScore = 0;

  for (const rule of rules) {
    if (!rule.triggered) continue;

    // Apply category weights (weights pre-loaded — no per-source DB hits)
    for (const source of rule.sources) {
      const weightKey = `risk_weight_${source}`;
      const weight = weights[weightKey] ?? WEIGHT_KEYS[weightKey] ?? 1.0;
      weights_applied[source] = weight;
      const contribution = rule.score * weight / rule.sources.length;
      breakdown[source] = (breakdown[source] || 0) + contribution;
      rawScore += contribution;
    }
  }

  // Correlation multiplier
  const triggeredCount = rules.filter(r => r.triggered).length;
  const uniqueSources = new Set(rules.filter(r => r.triggered).flatMap(r => r.sources));
  let multiplier = 1.0;
  if (triggeredCount >= 3 && uniqueSources.size >= 3) multiplier = 2.5;
  else if (triggeredCount >= 3) multiplier = 2.0;
  else if (triggeredCount >= 2) multiplier = 1.5;

  const score = Math.min(100, Math.round(rawScore * multiplier));
  const level = score >= 76 ? "CRITICAL" : score >= 51 ? "HIGH" : score >= 26 ? "MEDIUM" : "LOW";

  return {
    score,
    level,
    breakdown,
    weights_applied,
    correlation_multiplier: multiplier,
    raw_score: Math.round(rawScore * 100) / 100,
    triggered_count: triggeredCount,
    unique_sources: uniqueSources.size,
  };
}

// ---------------------------------------------------------------------------
// Persist correlations
// ---------------------------------------------------------------------------

function persistCorrelations(rules: RuleResult[]): void {
  const triggered = rules.filter(r => r.triggered);
  for (const rule of triggered) {
    // Check if same rule was already created in last 30 minutes (dedup)
    const existing = queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM correlation_events WHERE correlation_rule = ? AND created_at >= datetime('now', '-30 minutes')`,
      [rule.rule]
    );
    if (existing && existing.cnt > 0) continue;

    const id = uuid();
    run(
      `INSERT INTO correlation_events (id, correlation_rule, source_events, description, severity, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [id, rule.rule, JSON.stringify(rule.events), rule.description, rule.severity]
    );

    // Create alert for triggered correlations — severity matches the rule
    createAlert(
      `Correlation: ${rule.rule}`,
      rule.description,
      rule.severity,
      "correlation-engine"
    );
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'alerts:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const __t0 = Date.now();
  try {
    // v0.8.0: sweep expired risk acceptances first.
    try { autoExpireRiskAcceptances(); } catch (err) { console.warn("[correlations/evaluate] autoExpire failed:", err); }

    const weights = loadWeights();
    const state = gatherState();
    const rules = evaluateRules(state);

    // v0.8.0: partition triggered rules into active + suppressed via risk
    // acceptance. Non-triggered rules are unaffected (no risk to suppress).
    // Score is recomputed from the active set; gross score retained alongside.
    const triggeredRules = rules.filter((r) => r.triggered);
    const partition = applyRiskSuppressions(triggeredRules, (r) => ({
      source_panel: "correlations" as const,
      rule_id: r.rule,
      agent_id: null,
      surface_id: null,
      evidence: [...r.sources].sort(),
    }));
    const activeRules = [...partition.active, ...rules.filter((r) => !r.triggered)];
    const suppressedTriggered = partition.suppressed;

    const grossScore = calculateScore(rules, weights);
    const activeScore = calculateScore(activeRules, weights);

    // Persist new correlations (gross — every triggered rule is recorded
    // even when suppressed; suppression is a UI/score concept, not a
    // detection-reality concept).
    persistCorrelations(rules);

    // Store threat score as metric snapshot for trend tracking. Use ACTIVE
    // score so the trend reflects what's actually in the headline.
    try {
      run(
        `INSERT INTO metric_snapshots (source, metric_name, metric_value, recorded_at) VALUES ('correlation-engine', 'threat_score', ?, datetime('now'))`,
        [activeScore.score]
      );
    } catch {}

    // Broadcast score update (active)
    try {
      broadcast("threat_score", { score: activeScore.score, level: activeScore.level });
    } catch {}

    // Fresh evaluation — stale GET cache no longer valid
    invalidateScoreCache();

    console.log(`[api/correlations/evaluate:POST] ${Date.now() - __t0}ms triggered=${triggeredRules.length} active=${partition.active.length} suppressed=${suppressedTriggered.length}`);
    return NextResponse.json({
      // Active is the headline (back-compat-friendly: clients reading
      // `threat_score` see the active number). Gross + suppressed
      // exposed as separate fields.
      threat_score: activeScore.score,
      threat_score_gross: grossScore.score,
      threat_score_active: activeScore.score,
      level: activeScore.level,
      breakdown: activeScore.breakdown,
      breakdown_gross: grossScore.breakdown,
      weights_applied: activeScore.weights_applied,
      correlation_multiplier: activeScore.correlation_multiplier,
      raw_score: activeScore.raw_score,
      raw_score_gross: grossScore.raw_score,
      triggered_count: partition.active.length,
      triggered_count_gross: grossScore.triggered_count,
      suppressed_count: suppressedTriggered.length,
      unique_sources: activeScore.unique_sources,
      triggered_rules: partition.active.length,
      total_rules: rules.length,
      rules: activeRules.map(r => ({
        rule: r.rule,
        severity: r.severity,
        triggered: r.triggered,
        score: r.score,
        description: r.description,
        sources: r.sources,
        events: r.events,
      })),
      suppressedRules: suppressedTriggered.map((s) => ({
        rule: s.finding.rule,
        severity: s.finding.severity,
        score: s.finding.score,
        description: s.finding.description,
        sources: s.finding.sources,
        acceptance: {
          id: s.acceptance.id,
          scope_level: s.acceptance.scope_level,
          accepted_by: s.acceptance.accepted_by,
          accepted_at: s.acceptance.accepted_at,
          reason: s.acceptance.reason,
          expires_at: s.acceptance.expires_at,
        },
      })),
      state_summary: {
        shield_blocks_24h: state.shield.blocked24h,
        shield_reviews_24h: state.shield.reviewed24h,
        open_alerts: state.alerts.openTotal,
        critical_alerts: state.alerts.openCritical,
        cpu: state.infra.cpuPercent,
        memory: state.infra.memPercent,
        break_glass_active: state.breakGlass.active,
        token_anomaly: state.tokens.anomaly,
      },
      evaluated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[api/correlations/evaluate:POST] failed after ${Date.now() - __t0}ms:`, err);
    return NextResponse.json({ error: "Evaluation failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'alerts:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  // Return cached/latest score without re-evaluating.
  // 2026-04-22 (Task 9 — perf): short TTL cache so repeated GETs during
  // dashboard refresh don't re-query the full platform state every time.
  const __t0 = Date.now();
  try {
    const cached = getCachedScore();
    if (cached) {
      console.log(`[api/correlations/evaluate:GET] ${Date.now() - __t0}ms cache=hit`);
      return NextResponse.json(cached);
    }
    const weights = loadWeights();
    const state = gatherState();
    const rules = evaluateRules(state);
    const { score, level, breakdown, weights_applied, correlation_multiplier, raw_score, triggered_count, unique_sources } = calculateScore(rules, weights);

    const payload = {
      threat_score: score,
      level,
      breakdown,
      weights_applied,
      correlation_multiplier,
      raw_score,
      triggered_count,
      unique_sources,
      triggered_rules: rules.filter(r => r.triggered).length,
      evaluated_at: new Date().toISOString(),
    };
    setCachedScore(payload);
    console.log(`[api/correlations/evaluate:GET] ${Date.now() - __t0}ms cache=miss`);
    return NextResponse.json(payload);
  } catch (err) {
    console.error(`[api/correlations/evaluate:GET] failed after ${Date.now() - __t0}ms:`, err);
    return NextResponse.json({ error: "Failed to get score" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET score cache (5-second TTL — dashboard polls at ~5s, so this collapses
// the common burst of repeated requests into one re-evaluation).
// POST always re-evaluates and invalidates the cache below.
// ---------------------------------------------------------------------------

type CachedScorePayload = {
  threat_score: number;
  level: string;
  breakdown: Record<string, number>;
  weights_applied?: Record<string, number>;
  correlation_multiplier?: number;
  raw_score?: number;
  triggered_count?: number;
  unique_sources?: number;
  triggered_rules: number;
  evaluated_at: string;
};

const SCORE_CACHE_TTL_MS = 5_000;
let scoreCache: { at: number; payload: CachedScorePayload } | null = null;

function getCachedScore(): CachedScorePayload | null {
  if (!scoreCache) return null;
  if (Date.now() - scoreCache.at > SCORE_CACHE_TTL_MS) return null;
  return scoreCache.payload;
}

function setCachedScore(payload: CachedScorePayload): void {
  scoreCache = { at: Date.now(), payload };
}

function invalidateScoreCache(): void {
  scoreCache = null;
}
