/**
 * verify-audit-fix-coverage.ts — regression guard for the current audit loop.
 *
 * This is intentionally source-shape focused. Several affected paths depend on
 * host state, auth, or live dashboard data, so the stable proof here is that the
 * code paths keep the exact contracts we fixed:
 *
 * - passive Correlations refresh is read-only;
 * - correlation scoring excludes non-production and self-generated alerts;
 * - Mission Control active metrics use the canonical active + production API;
 * - OpenClaw version reporting reads the installed CLI/package state;
 * - Trust Audit reads the latest non-fixture host-security scan;
 * - Governance copy reflects the current public posture numbers;
 * - Token cost rows expose invalid/unknown cost quality.
 *
 * Run: npx tsx scripts/verify-audit-fix-coverage.ts
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const status = { pass: 0, fail: 0 };

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function check(desc: string, cond: boolean) {
  if (cond) status.pass++;
  else status.fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${desc}`);
}

function section(name: string) {
  console.log(`\n[${name}]`);
}

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  if (open === -1) return "";

  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

function exportedHandlerBody(source: string, name: "GET" | "POST"): string {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  if (open === -1) return "";

  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

section("1. Correlation evaluation is passive on GET and persistent on POST");
{
  const route = read("src/app/api/correlations/evaluate/route.ts");
  const panel = read("src/components/dashboard/panels/CorrelationsPanel.tsx");
  const getBody = exportedHandlerBody(route, "GET");
  const postBody = exportedHandlerBody(route, "POST");
  const fetchThreatSummary = functionBody(panel, "fetchThreatSummary");
  const evaluateThreatSummary = functionBody(panel, "evaluateThreatSummary");

  check("GET handler exists", getBody.length > 0);
  check("POST handler exists", postBody.length > 0);
  check("panel passive summary fetch uses GET", /method:\s*["']GET["']/.test(fetchThreatSummary));
  check("panel explicit evaluate uses POST", /method:\s*["']POST["']/.test(evaluateThreatSummary));
  check("GET handler does not persist correlation events", !/persistCorrelations\s*\(/.test(getBody));
  check("GET handler does not write metric snapshots", !/metric_snapshots|INSERT\s+INTO/i.test(getBody));
  check("GET handler does not broadcast score changes", !/\bbroadcast\s*\(/.test(getBody));
  check("POST handler persists correlation events", /persistCorrelations\s*\(/.test(postBody));
  check("POST handler writes active score snapshot", /metric_snapshots/.test(postBody));
  check("POST handler broadcasts active score", /\bbroadcast\s*\(/.test(postBody));
}

section("2. Correlation scoring excludes test/demo origins and self-generated alerts");
{
  const route = read("src/app/api/correlations/evaluate/route.ts");
  const gather = functionBody(route, "gatherState");

  check("gatherState applies productionOriginSqlClause('detail') to shield rows", /productionOriginSqlClause\(\s*["']detail["']\s*\)/.test(gather));
  check("gatherState applies productionOriginSqlClause('metadata') to alert rows", /productionOriginSqlClause\(\s*["']metadata["']\s*\)/.test(gather));
  check("gatherState excludes dashboard traffic fixture from proxy rows", /dashboard-traffic-fixture/.test(gather) && /proxyProductionClause/.test(gather));
  check("gatherState excludes dashboard traffic fixtures from shield rows", /shieldFixtureClause/.test(gather) && /FROM shield_scans[\s\S]*AND \$\{shieldFixtureClause\}/.test(gather));
  check("gatherState excludes dashboard traffic fixtures from alert rows", /alertFixtureClause/.test(gather) && /FROM alerts[\s\S]*AND \$\{alertFixtureClause\}/.test(gather));
  check("gatherState excludes correlation-engine alerts from alert pressure", /source\s*!=\s*['"]correlation-engine['"]/.test(gather));
  check("shield total query includes shield production clause", /FROM shield_scans[\s\S]*AND \$\{shieldProductionClause\}/.test(gather));
  check("alert total query includes alert production clause", /FROM alerts[\s\S]*AND \$\{alertProductionClause\}/.test(gather));
  check("alert total query includes non-correlation clause", /FROM alerts[\s\S]*AND \$\{nonCorrelationAlertClause\}/.test(gather));
  check("proxy traffic/token queries include proxy production clause", (gather.match(/\$\{proxyProductionClause\}/g) || []).length >= 4);
}

section("3. Mission Control active metrics use canonical active production alerts");
{
  const hooks = read("src/components/dashboard/panels/mission-control/data-hooks.ts");
  const aging = read("src/components/dashboard/panels/mission-control/IncidentAging.tsx");
  const kpi = read("src/components/dashboard/panels/mission-control/KpiRow.tsx");
  const posture = read("src/components/dashboard/panels/mission-control/OperationalPosture.tsx");
  const alertsPanel = read("src/components/dashboard/panels/AlertsIncidentsPanel.tsx");
  const dashboardRoot = read("src/components/dashboard/index.tsx");
  const dashboardTypes = read("src/components/dashboard/types.ts");
  const missionDrilldowns = `${aging}\n${kpi}\n${posture}`;
  const alertsRoute = read("src/app/api/alerts/route.ts");
  const v1AlertsRoute = read("src/app/api/v1/alerts/route.ts");

  const activeUrl = "/api/alerts?scope=active&productionOnly=true&limit=500";
  check("Mission Control hooks use active production alert URL", hooks.includes(activeUrl));
  check("Incident aging uses active production alert URL", aging.includes(activeUrl));
  check("Mission Control no longer treats suppressed as active client-side", !/status\s*===\s*['"]suppressed['"]/.test(hooks + aging));
  check("KPI breakdown includes acknowledged active state", /Acknowledged/.test(kpi));
  check("KPI breakdown no longer reports suppressed as active", !/Suppressed/.test(kpi));
  check("Mission Control drilldowns use canonical active status filter", (missionDrilldowns.match(/ACTIVE_STATUS_FILTER/g) || []).length >= 6 && !/filter:\s*\{\s*status:\s*\[\s*["']open["']\s*\]/.test(missionDrilldowns));
  check("Mission Control drilldowns preserve productionOnly", (missionDrilldowns.match(/productionOnly:\s*["']true["']/g) || []).length >= 6);
  check("Dashboard root carries productionOnly into panel filters", /productionOnly\?: string/.test(dashboardTypes) && /productionOnly:\s*urlState\.productionOnly/.test(dashboardRoot));
  check("Alerts panel sends productionOnly to /api/alerts", /filters\.productionOnly\s*===\s*["']true["']/.test(alertsPanel) && /scope=active\$\{productionOnly\}/.test(alertsPanel));
  check("/api/alerts aggregate queries honor productionOnly", /productionOriginSqlClause\(\s*['"]metadata['"]\s*\)/.test(alertsRoute) && /aggregateWhere/.test(alertsRoute));
  check("/api/v1/alerts accepts scope", /isAlertScope/.test(v1AlertsRoute) && /scope/.test(v1AlertsRoute));
  check("/api/v1/alerts accepts productionOnly", /productionOnly/.test(v1AlertsRoute) && /listAlerts\(filters as \{[\s\S]*productionOnly\?: boolean/.test(v1AlertsRoute));
}

section("4. OpenClaw freshness reads installed version state");
{
  const helper = read("src/lib/openclaw-version.ts");
  const consumers = [
    "src/app/api/fleet/route.ts",
    "src/app/api/v1/fleet/route.ts",
    "src/app/api/cve/route.ts",
    "src/app/api/system/version/route.ts",
    "src/app/api/config/updates/route.ts",
  ];

  check("installed-version helper shells out to the CLI when available", /spawnSync\([^,]+,\s*\[\s*["']--version["']\s*\]/.test(helper));
  check("installed-version helper falls back to npm-global package.json", /\.npm-global/.test(helper) && /node_modules/.test(helper) && /openclaw/.test(helper) && /package\.json/.test(helper));
  for (const rel of consumers) {
    const src = read(rel);
    check(`${rel} uses getOpenClawInstalledVersion`, /getOpenClawInstalledVersion/.test(src));
  }
  check("updates route uses numeric version comparison", /function compareVersions/.test(read("src/app/api/config/updates/route.ts")));
}

section("5. Trust Audit reads the latest non-fixture host-security scan");
{
  const rules = read("src/lib/services/trust-audit/rules.ts");
  const engine = read("src/lib/services/trust-audit/engine.ts");

  check("trust audit selects the latest security_scans row", /FROM security_scans[\s\S]*ORDER BY scanned_at DESC[\s\S]*LIMIT 1/.test(rules));
  check("trust audit reads check rows by filtered latest scan_id", /WHERE cr\.scan_id = \([\s\S]*SELECT id[\s\S]*FROM security_scans[\s\S]*ORDER BY scanned_at DESC[\s\S]*LIMIT 1[\s\S]*\)/.test(rules));
  check("trust audit excludes dashboard fixture scans", /scanner != ['"]dashboard-traffic-fixture['"]/.test(rules) && /json_extract\(parsed_results, ['"]\$\.simulation['"]\)/.test(rules));
  check("trust audit no longer truncates host-security findings to LIMIT 50", !/security_check_results[\s\S]{0,400}LIMIT 50/.test(rules));
  check("trust audit uses ClawNex Host Security operator-facing copy", /ClawNex Host Security/.test(rules));
  check("trust audit emits preflight findings when discovery scans fail", /preflightFindings/.test(engine) && /permissiveness-scan/.test(engine));
  check("rule execution failures are not downgraded to info", /severity:\s*['"]medium['"][\s\S]*confidence:\s*['"]unknown['"]/.test(engine));
}

section("6. Governance copy reflects current public posture");
{
  const panel = read("src/components/dashboard/panels/GovernancePanel.tsx");
  const constants = read("src/components/dashboard/constants.ts");
  const onePager = read("docs/governance-one-pager.md");
  const index = read("docs/governance-index.md");
  const combined = `${panel}\n${constants}\n${onePager}\n${index}`;

  check("governance copy uses current SOC 2 estimate", /SOC 2\s*~55-60%/.test(combined));
  check("governance copy uses current ISO estimate", /ISO(?: 27001(?::2022)?)?\s*~50-55%/.test(combined));
  check("risk register copy uses current active and closed counts", /P0:? 0 active/.test(combined) && /P1:? 10 active/.test(combined) && /P2:? 10 active/.test(combined) && /Closed:? 16/.test(combined));
  check("stale SOC/ISO percentages are absent from current panel/constants", !/~42|~38/.test(combined));
  check("stale risk priority summary is absent from current panel/constants", !/23 active \+ 2 closed|P0:\s*3|P1:\s*12|P2:\s*5/.test(combined));
  check("public one-pager uses current panel count and public repo", onePager.includes("26 operator panels") && onePager.includes("github.com/ClawNexAi/clawnex"));
  check("public one-pager has no stale QA placeholders or old alpha versions", !/25 operator panels|<qa-host>|github\.com\/operator|v0\.11\.6-alpha/.test(onePager));
}

section("7. Token cost reporting exposes invalid/unknown quality");
{
  const display = read("src/lib/cost-reporting-display.ts");
  const route = read("src/app/api/tokens/route.ts");
  const hermesReader = read("src/lib/services/hermes-token-reader.ts");
  const quality = read("src/lib/services/token-cost-quality.ts");
  const pricing = read("src/lib/services/model-pricing.ts");
  const tokenReader = read("src/lib/services/token-reader.ts");
  const agentCard = read("src/components/dashboard/panels/CostByAgentCard.tsx");
  const sessionCard = read("src/components/dashboard/panels/CostBySessionCard.tsx");

  check("unknown model is not a zero-cost fallback match", !/['"]unknown['"]:\s*\{[^}]*source:\s*['"]fallback['"]/.test(pricing));
  check("token reader carries pricing source through nested aggregates", /costSource\?: string/.test(tokenReader) && /_sourceSet/.test(tokenReader));
  check("tokens route classifies untrusted session price sources as unknown", /costStatusFromSource/.test(route) && /return ['"]unknown['"]/.test(quality) && !/fallback['"]\s*\|\|/.test(quality) && /unknownRowsForStatus/.test(route + quality));
  check("display_cost_usd rejects negative values", /typeof value === ['"]number['"][\s\S]*value >= 0/.test(display));
  check("tokens route counts invalid negative cost rows", /invalidCostRows/.test(route) && /cost_usd < 0/.test(route));
  check("tokens route counts unpriced cost rows", /unpricedRows/.test(route) && /cost_usd IS NULL OR cost_usd = 0/.test(route));
  check("tokens route uses shared mergeCostStatus for proxy/session merges", (route.match(/mergeCostStatus\(/g) || []).length >= 2 && !/existing(?:Agent|Session)Row\.costStatus\s*===/.test(route));
  check("tokens route includes Hermes-only rows in top-level legacy quality summary", /hermesCostQualityRows/.test(route) && /summarizeLegacyCostQuality\(\[\.\.\.costBySession,\s*\.\.\.hermesCostQualityRows\]\)/.test(route));
  check("Hermes reader preserves mixed unpriced row counts", /rowUnpricedRows/.test(hermesReader) && /unpricedRows\?: number/.test(hermesReader) && /modelAgg\.unpricedRows/.test(hermesReader) && /agentModelAgg\.unpricedRows/.test(hermesReader));
  check("tokens route uses Hermes unpricedRows instead of collapsed source only", /modelData\.unpricedRows\s*\?\? unknownRowsForStatus/.test(route));
  check("tokens route returns top-level costQuality", /summarizeLegacyCostQuality/.test(route) && /costQuality:\s*legacyCostQuality/.test(route));
  check("agent cost card distinguishes invalid normalized rows", /normalizedRowCostQuality/.test(agentCard) && /invalidCostRows/.test(agentCard) && /INVALID COST|COST UNKNOWN|MIXED COST/.test(agentCard));
  check("agent cost card keeps unattributed Hermes rows visible", /Unattributed \$\{row\.source\}/.test(agentCard) && !/if \(!row\.agent\) continue/.test(agentCard));
  check("session cost card distinguishes invalid normalized rows", /normalizedRowCostQuality/.test(sessionCard) && /invalidCostRows/.test(sessionCard) && /INVALID COST|COST UNKNOWN|MIXED COST/.test(sessionCard));
}

section("8. Current operator-facing docs do not reference removed Access List/Fleet Deployment surfaces");
{
  const accessListsTraining = [
    read("docs/training-scripts/09-access-lists.md"),
    read("docs/training-scripts/P-09-access-lists.md"),
    read("docs/training-scripts/M-22-access-lists-operator-mastery.md"),
  ].join("\n");
  const enterpriseTraining = read("docs/training-scripts/27-enterprise-preview.md");
  const enterpriseSpec = read("docs/coordination/video-spec-ep27.md");
  const currentDocs = [
    read("docs/02-high-level-architecture.md"),
    read("docs/04-product-requirements.md"),
    read("docs/06-basic-user-manual.md"),
    read("docs/07-advanced-user-manual.md"),
    read("docs/12-deployment-guide.md"),
    read("docs/14-data-dictionary.md"),
    read("docs/17-troubleshooting-guide.md"),
    read("docs/18-developer-manual.md"),
    read("docs/20-product-roadmap.md"),
    read("docs/qa-test-battery.md"),
    read("docs/governance-one-pager.md"),
    read("docs/training-scripts/M-04-blast-radius-operator-mastery.md"),
    accessListsTraining,
    enterpriseTraining,
    enterpriseSpec,
  ].join("\n");
  const accessListsPanel = read("src/components/dashboard/panels/AccessListsPanel.tsx");
  const accessListsRoute = read("src/app/api/access-lists/route.ts");
  const mcpTools = read("src/mcp/tools.ts");
  const shared = read("src/components/dashboard/shared.tsx");
  const executiveReports = read("src/components/dashboard/panels/ExecutiveReportsPanel.tsx");
  const configPanel = read("src/components/dashboard/panels/ConfigurationPanel.tsx");
  const accessControlRoute = read("src/app/api/access-control/route.ts");
  const exposureMatrix = read("src/components/dashboard/panels/blast-radius/ExposureMatrix.tsx");
  const permissiveness = read("src/lib/services/permissiveness/index.ts");
  const demoFixtures = read("src/components/dashboard/panels/mission-control/demo-fixtures.ts");
  const constants = read("src/components/dashboard/constants.ts");
  const blastRadiusHelp = constants.slice(constants.indexOf("blastRadius:"), constants.indexOf("trustAudit:"));
  const alertResolver = read("src/components/dashboard/triage/alert-resolver.ts");
  const triageFixtures = read("src/components/dashboard/triage/fixtures.ts");
  const actionQueue = read("src/components/dashboard/panels/mission-control/ActionQueue.tsx");

  check("Access Lists training does not promise Allow-list UI", !/Allow button|Allow lists|USER tab/.test(accessListsTraining));
  check("Enterprise preview does not request removed fleet deployment card", !/Fleet Deployment card|agent fleet deployment/i.test(enterpriseTraining + enterpriseSpec));
  check("Enterprise preview does not request removed USER + Allow badges", !/USER \+ Allow badges|user-based access control|network allow lists|allow lists/i.test(enterpriseTraining + enterpriseSpec));
  check("Enterprise preview does not overclaim production-ready SOC", !/production-ready SOC|complete,\s*production-ready/i.test(currentDocs));
  check("Access Lists panel exposes only IP/domain deny-list UI", !/EnterpriseCard|USER|ENT|User-Based Access Control|isEnterprise/.test(accessListsPanel));
  check("Access Lists API rejects allow/User modes", /validateListType/.test(accessListsRoute) && /supports deny lists only/.test(accessListsRoute) && /entry_type must be 'IP' or 'DOMAIN'/.test(accessListsRoute));
  check("MCP manage_access advertises deny-only IP/domain schema", /name:\s*["']manage_access["']/.test(mcpTools) && /enum:\s*\[\s*["']deny["']\s*\]/.test(mcpTools) && /enum:\s*\[\s*["']IP["'],\s*["']DOMAIN["']\s*\]/.test(mcpTools) && !/allow\/deny lists/.test(mcpTools));
  check("Current docs describe deny-only Access Lists", !/allowlists\/blocklists|IP\/domain allow|allow\/block|deny and allow list|allow list management surface/i.test(currentDocs));
  check("Live dashboard no longer renders paid-tier enterprise placeholders", !/EnterprisePill|EnterpriseCard|CUSTOM ROLES — ENT|>ENTERPRISE<|paid ClawNex tier/.test(`${shared}\n${executiveReports}\n${configPanel}`));
  check("Break-glass copy matches current one-operator confirmation flow", !/two-person approval/.test(configPanel));
  check("Live connector config has no disabled coming-soon cards", !/COMING SOON|Add Paperclip Instance|Add NemoClaw Instance|NVIDIA NeMo Agent fleet/.test(configPanel));
  check("Current docs do not reference removed Paperclip/Nemo connector placeholders", !/Paperclip card|Paperclip \(COMING SOON\)|NemoClaw \(ALPHA\)|OpenClaw, Hermes, Paperclip, NemoClaw/i.test(currentDocs));
  check("Access Control rule catalog uses deny-list language", /Egress domain deny-list enforcement/.test(accessControlRoute) && !/Egress domain allowlist/.test(accessControlRoute));
  check("Blast Radius does not route weak access posture to Access Lists", !/onDrillTo\(["']accessLists["']\)|label:\s*["']Access Lists["']/.test(exposureMatrix + permissiveness));
  check("Mission Control demo fixtures do not count suppressed as active", !/open\|investigating\|suppressed|label:\s*["']Suppressed["']/.test(demoFixtures));
  check("Configuration help uses ClawNex Shield Rules naming", /ClawNex Shield Rules/.test(constants) && !/DefenseClaw/.test(constants));
  check("Blast Radius help avoids user/network allow-list remediation claims", !/user allowlists|Access Lists|weak allowlist|approval allowlist/.test(blastRadiusHelp));
  check("Triage guidance uses policy exceptions, not allowlist entries", /policy exception/.test(alertResolver + triageFixtures) && /prompt policy/.test(actionQueue) && !/add allowlist entry|prompt allowlist/.test(alertResolver + triageFixtures + actionQueue));
  check("Current docs avoid legacy Clawkeeper helper names in operator steps", !/clawkeeper\.sh|clawkeeper\.dev|Remaining v0\.7\.0/.test(currentDocs));
}

console.log(`\n${status.fail === 0 ? "PASS" : "FAIL"}: ${status.pass} passed, ${status.fail} failed`);
process.exit(status.fail === 0 ? 0 : 1);
