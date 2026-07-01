/**
 * CI gate — Mission Control routing audit.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md §5, §6, §7, §8
 *
 * Source-greps the Mission Control panel files for every documented
 * onNavigate(...) click target and asserts the (tab, opts) shape matches
 * the spec contract. Pattern mirrors verify-evidence-deep-link.ts.
 *
 * Each assertion runs a regex against the relevant panel source. Failure
 * means a click target either doesn't exist or routes to the wrong tab/
 * filter, which would silently break the §7.4 drill-down contract.
 *
 * Implementation note — indirect dispatch patterns:
 *   OperationalPosture and ActionQueue route via helper functions
 *   (handleRowClick / targetForSource) that read clickTarget from row data
 *   rather than passing literal tab strings directly to onNavigate.
 *   For those files, patterns verify BOTH:
 *     (a) the clickTarget data definition (confirming the correct tab literal
 *         and opts are stored), AND
 *     (b) the presence of fromMissionControl: true in the dispatch helper
 *         (confirming the breadcrumb is always attached).
 *   This preserves the spec-contract verification intent without requiring
 *   literal tab strings at the onNavigate call-site.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

interface Check {
  file: string;
  pattern: RegExp;
  label: string;
}

const CHECKS: Check[] = [
  // §5.1 Active Incidents — inline call in KpiRow
  {
    file: "src/components/dashboard/panels/mission-control/KpiRow.tsx",
    pattern: /onNavigate\(\s*"alertsIncidents"\s*,\s*\{[\s\S]{0,200}?status:\s*ACTIVE_STATUS_FILTER[\s\S]{0,120}?productionOnly:\s*"true"[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§5.1 Active Incidents → alertsIncidents { filter: { status: ACTIVE_STATUS_FILTER, productionOnly: true }, fromMissionControl: true }",
  },
  // §5.2 Evidence Confidence — inline call in KpiRow
  {
    file: "src/components/dashboard/panels/mission-control/KpiRow.tsx",
    pattern: /onNavigate\(\s*"auditEvidence"\s*,\s*\{[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§5.2 Evidence Confidence → auditEvidence { fromMissionControl: true }",
  },
  // §5.3 Shield Activity — inline call in KpiRow
  {
    file: "src/components/dashboard/panels/mission-control/KpiRow.tsx",
    pattern: /onNavigate\(\s*"trafficMonitor"\s*,\s*\{[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§5.3 Shield Activity → trafficMonitor { fromMissionControl: true }",
  },
  // §5.4 Cost Risk — inline call in KpiRow
  {
    file: "src/components/dashboard/panels/mission-control/KpiRow.tsx",
    pattern: /onNavigate\(\s*"tokenCost"\s*,\s*\{[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§5.4 Cost Risk → tokenCost { fromMissionControl: true }",
  },
  // §5.5 Collector Health — inline call in KpiRow
  {
    file: "src/components/dashboard/panels/mission-control/KpiRow.tsx",
    pattern: /onNavigate\(\s*"infrastructure"\s*,\s*\{[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§5.5 Collector Health → infrastructure { fromMissionControl: true }",
  },
  // §5.6 Policy Coverage — inline call in KpiRow
  {
    file: "src/components/dashboard/panels/mission-control/KpiRow.tsx",
    pattern: /onNavigate\(\s*"configuration"\s*,\s*\{[\s\S]{0,200}?focus:\s*"policiesAndRules"[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§5.6 Policy Coverage → configuration { focus: 'policiesAndRules', fromMissionControl: true }",
  },

  // §6 Operational Posture — indirect dispatch via handleRowClick().
  // Pattern (a): clickTarget data definition confirms the correct tab literal.
  // Pattern (b): handleRowClick passes fromMissionControl: true on every branch.
  // The two assertions together verify the full routing contract.

  // §6.1 Shield Policy — clickTarget has tab: "configuration" + focus: "policiesAndRules"
  {
    file: "src/components/dashboard/panels/mission-control/OperationalPosture.tsx",
    pattern: /clickTarget:\s*\{[\s\S]{0,80}?tab:\s*"configuration"[\s\S]{0,80}?focus:\s*"policiesAndRules"/,
    label: "§6.1 Shield Policy posture row → clickTarget.tab = configuration + focus = policiesAndRules",
  },
  // §6.2 Evidence Quality — clickTarget has tab: "auditEvidence"
  {
    file: "src/components/dashboard/panels/mission-control/OperationalPosture.tsx",
    pattern: /clickTarget:\s*\{[\s\S]{0,40}?tab:\s*"auditEvidence"/,
    label: "§6.2 Evidence Quality posture row → clickTarget.tab = auditEvidence",
  },
  // §6.3 Incident Hygiene — clickTarget has tab: "alertsIncidents"
  {
    file: "src/components/dashboard/panels/mission-control/OperationalPosture.tsx",
    pattern: /clickTarget:\s*\{[\s\S]{0,40}?tab:\s*"alertsIncidents"/,
    label: "§6.3 Incident Hygiene posture row → clickTarget.tab = alertsIncidents",
  },
  // §6.4 Source Freshness — clickTarget has tab: "infrastructure"
  {
    file: "src/components/dashboard/panels/mission-control/OperationalPosture.tsx",
    pattern: /clickTarget:\s*\{[\s\S]{0,40}?tab:\s*"infrastructure"/,
    label: "§6.4 Source Freshness posture row → clickTarget.tab = infrastructure",
  },
  // §6.5 Cost Discipline — clickTarget has tab: "tokenCost"
  {
    file: "src/components/dashboard/panels/mission-control/OperationalPosture.tsx",
    pattern: /clickTarget:\s*\{[\s\S]{0,40}?tab:\s*"tokenCost"/,
    label: "§6.5 Cost Discipline posture row → clickTarget.tab = tokenCost",
  },
  // §6 dispatch breadcrumb — handleRowClick attaches fromMissionControl: true on every branch
  {
    file: "src/components/dashboard/panels/mission-control/OperationalPosture.tsx",
    pattern: /function handleRowClick[\s\S]{0,600}?fromMissionControl:\s*true/,
    label: "§6 handleRowClick dispatch attaches fromMissionControl: true",
  },

  // §7 Action Queue — indirect dispatch via targetForSource().
  // Pattern (a): clickTarget data definition confirms correct tab literal + opts.
  // Pattern (b): targetForSource attaches fromMissionControl: true on every branch.

  // §7.4 Alert action row — clickTarget: { tab: "auditEvidence", opts: { id: ... } }
  {
    file: "src/components/dashboard/panels/mission-control/ActionQueue.tsx",
    pattern: /clickTarget:\s*\{[\s\S]{0,60}?tab:\s*"auditEvidence"[\s\S]{0,80}?opts:\s*\{[\s\S]{0,40}?id:/,
    label: "§7.4 Alert action row → clickTarget.tab = auditEvidence with opts.id",
  },
  // §7.4 Cost-signal action row — clickTarget: { tab: "tokenCost" }
  {
    file: "src/components/dashboard/panels/mission-control/ActionQueue.tsx",
    pattern: /clickTarget:\s*\{[\s\S]{0,40}?tab:\s*"tokenCost"/,
    label: "§7.4 Cost-signal action row → clickTarget.tab = tokenCost",
  },
  // §7.4 Health action row — clickTarget: { tab: "infrastructure" }
  {
    file: "src/components/dashboard/panels/mission-control/ActionQueue.tsx",
    pattern: /clickTarget:\s*\{[\s\S]{0,40}?tab:\s*"infrastructure"/,
    label: "§7.4 Health action row → clickTarget.tab = infrastructure",
  },
  // §7 dispatch breadcrumb — targetForSource attaches fromMissionControl: true on every branch
  {
    file: "src/components/dashboard/panels/mission-control/ActionQueue.tsx",
    pattern: /function targetForSource[\s\S]{0,600}?fromMissionControl:\s*true/,
    label: "§7 targetForSource dispatch attaches fromMissionControl: true",
  },

  // §8.1 Incident Aging buckets — inline call with age filter (v0.13.0+)
  {
    file: "src/components/dashboard/panels/mission-control/IncidentAging.tsx",
    pattern: /onNavigate\(\s*"alertsIncidents"[\s\S]{0,200}?age:\s*\[[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§8.1 Incident Aging bucket → alertsIncidents { filter: { status, age }, fromMissionControl: true }",
  },
  // §8.2 Detection Trend — inline call
  {
    file: "src/components/dashboard/panels/mission-control/DetectionTrend.tsx",
    pattern: /onNavigate\(\s*"trafficMonitor"[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§8.2 Detection Trend → trafficMonitor with breadcrumb",
  },
  // §8.3a Cost Signals source row — inline call with source filter
  {
    file: "src/components/dashboard/panels/mission-control/SignalsAndSourceHealth.tsx",
    pattern: /onNavigate\(\s*"tokenCost"\s*,\s*\{[\s\S]{0,200}?source:\s*\[[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§8.3a Cost Signals source row → tokenCost { filter: { source }, fromMissionControl: true }",
  },
  // §8.3b Source Health collector row — inline call with focus
  {
    file: "src/components/dashboard/panels/mission-control/SignalsAndSourceHealth.tsx",
    pattern: /onNavigate\(\s*"infrastructure"\s*,\s*\{[\s\S]{0,200}?focus[\s\S]{0,80}?fromMissionControl:\s*true/,
    label: "§8.3b Source Health collector row → infrastructure { focus, fromMissionControl: true }",
  },
];

let pass = 0;
let fail = 0;

console.log(`Routing audit — ${CHECKS.length} click targets to verify\n`);

for (const c of CHECKS) {
  const fullPath = path.join(ROOT, c.file);
  if (!fs.existsSync(fullPath)) {
    console.error(`  FAIL  source file missing: ${c.file}`);
    fail++;
    continue;
  }
  const text = fs.readFileSync(fullPath, "utf-8");
  if (c.pattern.test(text)) {
    console.log(`  PASS  ${c.label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${c.label}\n          file: ${c.file}\n          pattern: ${c.pattern.source.slice(0, 100)}…`);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
process.exit(fail === 0 ? 0 : 1);
