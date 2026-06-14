/**
 * verify-correlation-rules.ts — behavioral veracity: the 10 correlation rules.
 *
 * ClawNex advertises a "correlation engine — 10 rules detecting coordinated
 * attack patterns across multiple data sources." This proves each of the 10
 * rules actually fires on its documented condition, stays quiet otherwise,
 * carries the right severity, and that multiple rules co-trigger on a genuinely
 * coordinated state (the whole point of correlation).
 *
 * Logic is tested directly against the real engine (evaluateRules); the live
 * gatherState→persist→alert pipeline is proven separately against the running
 * instance (see the veracity evidence pack).
 *
 * Run: npx tsx scripts/verify-correlation-rules.ts
 */

import { evaluateRules, type PlatformState } from "../src/lib/services/correlation-rules";

const status = { pass: 0, fail: 0 };
function assert(cond: unknown, desc: string) {
  if (cond) status.pass++;
  else status.fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${desc}`);
}
function section(n: string) { console.log(`\n[${n}]`); }

function base(): PlatformState {
  return {
    shield: { blocked24h: 0, reviewed24h: 0, total24h: 0, categoriesHit: [] },
    traffic: { total24h: 0, blocked24h: 0, avgTokens: 0, topModel: "" },
    infra: { cpuPercent: 0, memPercent: 0, servicesDown: 0 },
    alerts: { openCritical: 0, openHigh: 0, openTotal: 0, newLast10min: 0 },
    accessList: { denyHits24h: 0 },
    breakGlass: { active: false, reason: null },
    tokens: { total24h: 0, anomaly: false },
    audit: { configChanges10min: 0, whitelistChanges10min: 0 },
  };
}
const names = (s: PlatformState) => evaluateRules(s).filter(r => r.triggered).map(r => r.rule);
const sev = (s: PlatformState, rule: string) => evaluateRules(s).find(r => r.rule === rule)?.severity;

section("0. quiet baseline fires nothing (no false positives)");
assert(names(base()).length === 0, "all-zero state → 0 rules triggered");

section("1. each rule fires in isolation with correct severity");
{
  const s = base(); s.shield.blocked24h = 3; s.shield.categoriesHit = ["secret", "command"];
  assert(names(s).join() === "Coordinated Attack Chain", "Coordinated Attack Chain fires alone");
  assert(sev(s, "Coordinated Attack Chain") === "CRITICAL", "  …severity CRITICAL");
}
{
  const s = base(); s.shield.reviewed24h = 5; s.shield.categoriesHit = ["secret", "command", "jailbreak"];
  assert(names(s).join() === "Reconnaissance Probe", "Reconnaissance Probe fires alone");
  assert(sev(s, "Reconnaissance Probe") === "HIGH", "  …severity HIGH");
}
{
  const s = base(); s.tokens.anomaly = true;
  assert(names(s).join() === "Denial-of-Wallet", "Denial-of-Wallet fires alone");
}
{
  const s = base(); s.infra.cpuPercent = 95; s.infra.memPercent = 95;
  assert(names(s).join() === "Infrastructure Under Stress", "Infrastructure Under Stress fires alone");
}
{
  const s = base(); s.shield.blocked24h = 1; s.shield.categoriesHit = ["c2"];
  assert(names(s).join() === "Data Exfiltration Attempt", "Data Exfiltration Attempt fires alone");
  assert(sev(s, "Data Exfiltration Attempt") === "CRITICAL", "  …severity CRITICAL");
}
{
  const s = base(); s.audit.configChanges10min = 1; s.shield.blocked24h = 1; s.shield.categoriesHit = ["secret"];
  assert(names(s).join() === "Insider Threat Signal", "Insider Threat Signal fires alone");
}
{
  const s = base(); s.breakGlass.active = true; s.alerts.openCritical = 1;
  assert(names(s).join() === "Break-Glass During Active Threat", "Break-Glass During Active Threat fires alone");
}
{
  const s = base(); s.alerts.newLast10min = 5;
  assert(names(s).join() === "Alert Cascade", "Alert Cascade fires alone");
}
{
  const s = base(); s.alerts.openTotal = 21;
  assert(names(s).join() === "Elevated Alert Volume", "Elevated Alert Volume fires alone");
  assert(sev(s, "Elevated Alert Volume") === "MEDIUM", "  …severity MEDIUM");
}
{
  const s = base(); s.shield.total24h = 600; s.shield.blocked24h = 61;
  assert(names(s).join() === "Shield Under Heavy Load", "Shield Under Heavy Load fires alone");
}

section("2. just-below-threshold does NOT fire (boundary honesty)");
{
  const s = base(); s.shield.blocked24h = 2; s.shield.categoriesHit = ["a", "b"];
  assert(!names(s).includes("Coordinated Attack Chain"), "blocked24h=2 (<3) → Coordinated Attack does not fire");
}
{
  const s = base(); s.alerts.newLast10min = 4;
  assert(!names(s).includes("Alert Cascade"), "newLast10min=4 (<5) → Alert Cascade does not fire");
}
{
  const s = base(); s.alerts.openTotal = 20;
  assert(!names(s).includes("Elevated Alert Volume"), "openTotal=20 (not >20) → Elevated Alert Volume does not fire");
}
{
  const s = base(); s.infra.cpuPercent = 95; s.infra.memPercent = 80;
  assert(!names(s).includes("Infrastructure Under Stress"), "mem=80 (<=90) → Infra Under Stress does not fire");
}

section("3. coordinated state co-triggers multiple rules (correlation works)");
{
  const s = base();
  s.shield.blocked24h = 5; s.shield.categoriesHit = ["secret", "c2", "command"]; s.audit.configChanges10min = 2;
  const fired = names(s);
  assert(fired.includes("Coordinated Attack Chain"), "coordinated: Coordinated Attack Chain fires");
  assert(fired.includes("Data Exfiltration Attempt"), "coordinated: Data Exfiltration Attempt fires (c2 category)");
  assert(fired.includes("Insider Threat Signal"), "coordinated: Insider Threat Signal fires (config + blocks)");
  assert(fired.length === 3, `coordinated: exactly 3 rules co-trigger (got ${fired.length})`);
}

console.log(`\n${status.fail === 0 ? "PASS" : "FAIL"}: ${status.pass} passed, ${status.fail} failed`);
process.exit(status.fail === 0 ? 0 : 1);
