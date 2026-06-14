/**
 * Correlation rule engine — pure evaluation logic.
 *
 * Extracted from src/app/api/correlations/evaluate/route.ts so the 10 rule
 * predicates are independently testable (verify-correlation-rules.ts) and so
 * Next's route file stays free of non-handler exports. The route assembles a
 * PlatformState from the DB + live signals (gatherState) and calls
 * evaluateRules() exactly as before — behavior is unchanged.
 *
 * Each rule is a predicate over PlatformState. A triggered rule carries its
 * severity, a fixed score contribution, the contributing sources, and the
 * evidence events that get persisted to correlation_events + surfaced as an
 * incident alert.
 */

export interface PlatformState {
  shield: { blocked24h: number; reviewed24h: number; total24h: number; categoriesHit: string[] };
  traffic: { total24h: number; blocked24h: number; avgTokens: number; topModel: string };
  infra: { cpuPercent: number; memPercent: number; servicesDown: number };
  alerts: { openCritical: number; openHigh: number; openTotal: number; newLast10min: number };
  accessList: { denyHits24h: number };
  breakGlass: { active: boolean; reason: string | null };
  tokens: { total24h: number; anomaly: boolean };
  audit: { configChanges10min: number; whitelistChanges10min: number };
}

export interface RuleResult {
  rule: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  triggered: boolean;
  score: number;
  description: string;
  sources: string[];
  events: Array<{ type: string; source: string; time?: string }>;
}

export function evaluateRules(state: PlatformState): RuleResult[] {
  const results: RuleResult[] = [];

  // Rule 1: Coordinated Attack Chain
  if (state.shield.blocked24h >= 3 && state.shield.categoriesHit.length >= 2) {
    results.push({
      rule: "Coordinated Attack Chain",
      severity: "CRITICAL",
      triggered: true,
      score: 30,
      description: `${state.shield.blocked24h} blocks across ${state.shield.categoriesHit.length} categories in 24h. Multiple attack vectors detected.`,
      sources: ["shield", "traffic"],
      events: state.shield.categoriesHit.slice(0, 5).map(cat => ({ type: `Shield BLOCK: ${cat}`, source: "shield" })),
    });
  }

  // Rule 2: Reconnaissance Probe
  if (state.shield.reviewed24h >= 5 && state.shield.categoriesHit.length >= 3) {
    results.push({
      rule: "Reconnaissance Probe",
      severity: "HIGH",
      triggered: true,
      score: 20,
      description: `${state.shield.reviewed24h} REVIEW verdicts across ${state.shield.categoriesHit.length} categories. Possible reconnaissance activity.`,
      sources: ["shield"],
      events: [{ type: `${state.shield.reviewed24h} REVIEW verdicts`, source: "shield" }],
    });
  }

  // Rule 3: Denial-of-Wallet
  if (state.tokens.anomaly) {
    results.push({
      rule: "Denial-of-Wallet",
      severity: "HIGH",
      triggered: true,
      score: 20,
      description: `Token consumption in current hour is 5x above 24h average. Possible denial-of-wallet attack or runaway agent.`,
      sources: ["token", "traffic"],
      events: [{ type: `Token burn: ${state.tokens.total24h.toLocaleString()} tokens (24h)`, source: "token" }],
    });
  }

  // Rule 4: Infrastructure Under Stress
  if (state.infra.cpuPercent > 90 && state.infra.memPercent > 90) {
    results.push({
      rule: "Infrastructure Under Stress",
      severity: "HIGH",
      triggered: true,
      score: 15,
      description: `CPU at ${state.infra.cpuPercent}% and memory at ${state.infra.memPercent}%. System resources critically low.`,
      sources: ["infra"],
      events: [
        { type: `CPU: ${state.infra.cpuPercent}%`, source: "infra" },
        { type: `Memory: ${state.infra.memPercent}%`, source: "infra" },
      ],
    });
  }

  // Rule 5: Data Exfiltration Attempt
  if (state.shield.blocked24h > 0 && state.shield.categoriesHit.some(c => c.includes("c2"))) {
    results.push({
      rule: "Data Exfiltration Attempt",
      severity: "CRITICAL",
      triggered: true,
      score: 30,
      description: `C2/exfiltration patterns detected in shield scans. ${state.traffic.blocked24h} requests blocked.`,
      sources: ["shield", "access"],
      events: [{ type: "C2 pattern detected in traffic", source: "shield" }],
    });
  }

  // Rule 6: Insider Threat Signal
  if (state.audit.configChanges10min > 0 && state.shield.blocked24h > 0) {
    results.push({
      rule: "Insider Threat Signal",
      severity: "CRITICAL",
      triggered: true,
      score: 25,
      description: `${state.audit.configChanges10min} config changes in last 10 minutes coinciding with ${state.shield.blocked24h} shield blocks. Investigate for unauthorized modifications.`,
      sources: ["audit", "shield"],
      events: [
        { type: `${state.audit.configChanges10min} config changes (10min)`, source: "audit" },
        { type: `${state.shield.blocked24h} shield blocks (24h)`, source: "shield" },
      ],
    });
  }

  // Rule 7: Break-Glass During Threat
  if (state.breakGlass.active && state.alerts.openCritical > 0) {
    results.push({
      rule: "Break-Glass During Active Threat",
      severity: "CRITICAL",
      triggered: true,
      score: 25,
      description: `Break-glass bypass active while ${state.alerts.openCritical} CRITICAL alerts are open. Shield protection is disabled during a threat.`,
      sources: ["breakglass", "alerts"],
      events: [
        { type: `Break-glass: ${state.breakGlass.reason || "active"}`, source: "breakglass" },
        { type: `${state.alerts.openCritical} CRITICAL alerts open`, source: "alerts" },
      ],
    });
  }

  // Rule 8: Alert Cascade
  if (state.alerts.newLast10min >= 5) {
    results.push({
      rule: "Alert Cascade",
      severity: "HIGH",
      triggered: true,
      score: 15,
      description: `${state.alerts.newLast10min} new alerts in last 10 minutes. Possible coordinated attack or system issue.`,
      sources: ["alerts"],
      events: [{ type: `${state.alerts.newLast10min} alerts (10min)`, source: "alerts" }],
    });
  }

  // Rule 9: High Alert Volume
  if (state.alerts.openTotal > 20) {
    results.push({
      rule: "Elevated Alert Volume",
      severity: "MEDIUM",
      triggered: true,
      score: 10,
      description: `${state.alerts.openTotal} open alerts. Consider triaging and resolving stale alerts.`,
      sources: ["alerts"],
      events: [{ type: `${state.alerts.openTotal} open alerts`, source: "alerts" }],
    });
  }

  // Rule 10: Shield Under Heavy Load
  if (state.shield.total24h > 500 && state.shield.blocked24h > state.shield.total24h * 0.1) {
    results.push({
      rule: "Shield Under Heavy Load",
      severity: "HIGH",
      triggered: true,
      score: 15,
      description: `${state.shield.total24h} scans with ${((state.shield.blocked24h / state.shield.total24h) * 100).toFixed(1)}% block rate. Above normal threshold.`,
      sources: ["shield"],
      events: [{ type: `Block rate: ${((state.shield.blocked24h / state.shield.total24h) * 100).toFixed(1)}%`, source: "shield" }],
    });
  }

  return results;
}
