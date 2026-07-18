import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "src/components/dashboard/triage/types.ts",
  "src/components/dashboard/triage/fixtures.ts",
  "src/components/dashboard/triage/TriageGraphCard.tsx",
  "src/components/dashboard/triage/TriageStageCard.tsx",
  "src/components/dashboard/triage/TriageArtifactPreview.tsx",
];

const requiredStageIds = [
  "evidence",
  "sourceEvent",
  "affectedObject",
  "relatedActivity",
  "fixControl",
];

const requiredStageTitles = [
  "Evidence",
  "Source Event",
  "Affected Object",
  "Related Activity",
  "Fix / Control",
];

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const rel of requiredFiles) {
  assert(fs.existsSync(path.join(root, rel)), `Missing required file: ${rel}`);
}

const types = read("src/components/dashboard/triage/types.ts");
for (const id of requiredStageIds) {
  assert(types.includes(`"${id}"`), `TriageStageId missing ${id}`);
}

const fixtures = read("src/components/dashboard/triage/fixtures.ts");
let lastIndex = -1;
for (const title of requiredStageTitles) {
  const index = fixtures.indexOf(title);
  assert(index >= 0, `Fixture missing stage title: ${title}`);
  assert(index > lastIndex, `Stage order is wrong around: ${title}`);
  lastIndex = index;
}

const card = read("src/components/dashboard/triage/TriageGraphCard.tsx");
assert(card.includes("TriageArtifactPreview"), "TriageGraphCard must render inline TriageArtifactPreview");
assert(card.includes("defaultArtifactId") || card.includes("defaultArtifact"), "TriageGraphCard must support a default selected artifact");

// ---------------------------------------------------------------------------
// T13: ActionQueue integration assertions
// ---------------------------------------------------------------------------

// T13-1: ActionQueue.tsx must exist and import TriageGraphCard (T11 wire-up).
const actionQueueRel = "src/components/dashboard/panels/mission-control/ActionQueue.tsx";
assert(
  fs.existsSync(path.join(root, actionQueueRel)),
  `T13-1 FAIL: Missing required file: ${actionQueueRel}`,
);
const actionQueue = read(actionQueueRel);
assert(
  actionQueue.includes("TriageGraphCard"),
  `T13-1 FAIL: ${actionQueueRel} does not import TriageGraphCard — T11 wire-up missing`,
);
console.log("T13-1 ok: ActionQueue.tsx exists and imports TriageGraphCard");

// T13-2: ActionQueue must use the correct button label "Investigate ▸" (T11 spec §12).
assert(
  actionQueue.includes("Investigate ▸"),
  `T13-2 FAIL: ${actionQueueRel} does not contain button label "Investigate ▸" — label may have regressed`,
);
console.log("T13-2 ok: ActionQueue.tsx contains button label \"Investigate ▸\"");

// T13-3: TriageGraphCard must reference the three active child components,
// proving the composition uses every required child.
const triageChildren = [
  "TriageStageCard",
  "TriageArtifactPreview",
  "TriageEmptyState",
];
for (const child of triageChildren) {
  assert(
    card.includes(child),
    `T13-3 FAIL: TriageGraphCard.tsx does not reference child component ${child}`,
  );
}
console.log("T13-3 ok: TriageGraphCard.tsx references the active triage child components");

// T13-3a: Stage cards are the sole artifact selector. The removed persistent
// chip strip must not return because it duplicates the five evidence stages.
assert(
  !card.includes("TriageArtifactStrip") && !card.includes("APPLICABLE ARTIFACTS"),
  "T13-3a FAIL: duplicate artifact-strip navigation returned",
);
const stageCard = read("src/components/dashboard/triage/TriageStageCard.tsx");
assert(
  stageCard.includes('<button') && stageCard.includes("aria-pressed") && stageCard.includes("disabled={!isInteractive}"),
  "T13-3a FAIL: stage cards must remain semantic selectable buttons with disabled states",
);
console.log("T13-3a ok: stage cards are the sole accessible artifact selectors");

// T13-4: No live UI file under src/components/dashboard/ may contain the draft
// phrase "Same pattern across issue types" — this was authoring scaffolding that
// must never ship.
function walkDashboard(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkDashboard(full);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

const dashboardDir = path.join(root, "src/components/dashboard");
const draftPhrase = "Same pattern across issue types";
const draftViolations: string[] = [];
for (const file of walkDashboard(dashboardDir)) {
  const body = fs.readFileSync(file, "utf8");
  if (body.includes(draftPhrase)) {
    draftViolations.push(path.relative(root, file));
  }
}
assert(
  draftViolations.length === 0,
  `T13-4 FAIL: Draft phrase "${draftPhrase}" found in live UI files:\n  ${draftViolations.join("\n  ")}`,
);
console.log("T13-4 ok: No live UI file contains the forbidden draft phrase");

console.log("verify-triage-graph-contract: ok");
