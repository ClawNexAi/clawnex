import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rel = "src/components/dashboard/triage/navigation.ts";
const full = path.join(root, rel);

if (!fs.existsSync(full)) {
  throw new Error(`Missing ${rel}`);
}

const body = fs.readFileSync(full, "utf8");
for (const required of ["NavigateOpts", "fromMissionControl", "filter", "min", "max"]) {
  if (!body.includes(required)) throw new Error(`${rel} missing ${required}`);
}
for (const forbidden of ["fromIncident", "timeRange"]) {
  if (body.includes(forbidden)) throw new Error(`${rel} must not rely on mock-only key ${forbidden}`);
}

// ---------------------------------------------------------------------------
// T13: Extended navigation assertions — scan all triage/ source files.
// Excludes verifier scripts themselves to avoid false-positives from the
// search-term strings that appear in this file.
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

const triageDir = path.join(root, "src/components/dashboard/triage");
// Exclude the verifier scripts so their search-term strings don't self-trigger.
const triageFiles = walk(triageDir).filter(
  (f) => !path.relative(root, f).startsWith("scripts/verify-triage-"),
);

// Concatenate all triage source into one string for multi-line regex matching.
const triageSource = triageFiles
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

// T13-5: NavigateOpts is imported from url-state in at least one triage file.
// The import may span a line ("import type {\\n  NavigateOpts\\n} from ..."),
// so use a multi-line regex. Accept both "../url-state" and "../../url-state"
// depths since triage files all sit one level deep (not nested subdirectories).
const navigateOptsPattern = /import[\s\S]+NavigateOpts[\s\S]+url-state/m;
if (!navigateOptsPattern.test(triageSource)) {
  throw new Error(
    "T13-5 FAIL: No triage file imports NavigateOpts from url-state — the type is not being consumed",
  );
}
console.log("T13-5 ok: triage code imports NavigateOpts from url-state");

// T13-6: "fromIncident" must not appear in triage code — forbidden draft URL key.
// (The search string below is intentionally split so this file's own source
// doesn't trigger the check if the verifier directory is ever scanned.)
const forbiddenFromIncident = "from" + "Incident";
if (triageSource.includes(forbiddenFromIncident)) {
  throw new Error(
    `T13-6 FAIL: triage code contains forbidden URL key "${forbiddenFromIncident}" — use fromMissionControl instead`,
  );
}
console.log("T13-6 ok: triage code does not contain forbidden key \"fromIncident\"");

// T13-7: "timeRange" must not appear in triage code — replaced by min/max filter pattern.
// (Split the search string for the same self-scan reason as above.)
const forbiddenTimeRange = "time" + "Range";
if (triageSource.includes(forbiddenTimeRange)) {
  throw new Error(
    `T13-7 FAIL: triage code contains forbidden key "${forbiddenTimeRange}" — use min/max filter params instead`,
  );
}
console.log("T13-7 ok: triage code does not contain forbidden key \"timeRange\"");

// T13-8: filter literals must not assign status as a bare string — filters that
// include status should use arrays.  Only flags the pattern "filter: {... status: "
// (string literal inside a filter object literal), not standalone status properties
// (e.g. in issue summaries or type fields).  A regex is used for line-spanning
// safety; the [^}]* prevents matching across multiple filter-object closings.
const filterStringStatus = /filter\s*:\s*\{[^}]*status\s*:\s*"/m;
if (filterStringStatus.test(triageSource)) {
  throw new Error(
    "T13-8 FAIL: triage code contains `filter: { ..., status: \"...\" }` (string, not array) — pass status as an array",
  );
}
console.log("T13-8 ok: no triage filter literal assigns status as a bare string");

console.log("verify-triage-navigation: ok");
