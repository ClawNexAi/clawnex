/**
 * verify-v1-fleet-origin-filter.ts — veracity audit F4 regression guard.
 *
 * The public /api/v1/fleet alert count used to omit productionOriginSqlClause
 * that the internal /api/fleet applies, so external integrations saw
 * shield-test / demo / qa alerts inflate the number relative to the dashboard.
 * The route's own comment even claimed it mirrored /api/fleet while the code
 * didn't. This verifier pins source-shape parity so the filter can't silently
 * disappear again. (The behavioral 'test alerts excluded' proof runs against
 * the live seeded instance in the veracity evidence pack.)
 *
 * Run: npx tsx scripts/verify-v1-fleet-origin-filter.ts
 */

import * as fs from "fs";
import * as path from "path";

const status = { pass: 0, fail: 0 };
function check(desc: string, cond: boolean) {
  if (cond) status.pass++;
  else status.fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${desc}`);
}

const ROOT = path.resolve(__dirname, "..");
const v1 = fs.readFileSync(path.join(ROOT, "src/app/api/v1/fleet/route.ts"), "utf8");
const internal = fs.readFileSync(path.join(ROOT, "src/app/api/fleet/route.ts"), "utf8");

console.log("\n[v1/fleet imports the production-origin filter]");
check("imports productionOriginSqlClause", /import\s*\{[^}]*productionOriginSqlClause[^}]*\}\s*from\s*['"]@\/lib\/dashboard\/metric-semantics['"]/.test(v1));

console.log("\n[v1/fleet applies the filter to the alert COUNT query]");
check("derives prodClause from productionOriginSqlClause('metadata')", /productionOriginSqlClause\(\s*['"]metadata['"]\s*\)/.test(v1));
{
  // Every alert COUNT query in the route must carry the prod clause alongside
  // the active clause. Extract the alert-count SQL fragments and assert each
  // references prodClause.
  const alertQueries = v1.match(/SELECT COUNT\(\*\)[^`]*FROM alerts[^`]*/g) || [];
  check("at least one alert COUNT query present", alertQueries.length > 0);
  const allFiltered = alertQueries.length > 0 && alertQueries.every(q => q.includes("${prodClause}"));
  check("every alert COUNT query includes ${prodClause}", allFiltered);
}

console.log("\n[parity with internal /api/fleet]");
check("internal /api/fleet also applies productionOriginSqlClause('metadata')", /productionOriginSqlClause\(\s*['"]metadata['"]\s*\)/.test(internal));
{
  const internalAlertQueries = internal.match(/SELECT COUNT\(\*\)[^`]*FROM alerts[^`]*/g) || [];
  const internalFiltered = internalAlertQueries.length > 0 && internalAlertQueries.every(q => q.includes("${prodClause}"));
  check("internal alert COUNT queries are also prod-filtered (parity holds)", internalFiltered);
}

console.log(`\n${status.fail === 0 ? "PASS" : "FAIL"}: ${status.pass} passed, ${status.fail} failed`);
process.exit(status.fail === 0 ? 0 : 1);
