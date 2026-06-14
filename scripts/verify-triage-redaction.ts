import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const triageDir = path.join(root, "src/components/dashboard/triage");
const forbidden = [
  "payload_excerpt",
  "matched_snippets",
  "snippet_before",
  "snippet_match",
  "snippet_after",
  "request_body",
  "response_body",
  "authorization",
  "api_key",
  "password",
  "secret",
  "connection_string",
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

// 2026-05-07 spec §10 amendment: alert-resolver.ts and types.ts may reference
// the snippet family (matched_snippets, snippet_before, snippet_match,
// snippet_after) AND the EvidencePayload-level matched_snippets array name —
// because the alert resolver intentionally surfaces server-side-redacted
// match-span snippets behind the default-collapsed "Show match span" toggle
// in TriageArtifactPreview. Same justification as the AlertsIncidentsPanel
// allowlist: rendering pre-redacted typed-API field names is not a raw-
// payload leak. payload_excerpt / request_body / response_body / api_key /
// password / connection_string / authorization / secret remain forbidden in
// every triage file.
const SNIPPET_FAMILY_TERMS = new Set([
  "matched_snippets",
  "snippet_before",
  "snippet_match",
  "snippet_after",
]);
const SNIPPET_ALLOWLIST_FILES = new Set([
  "src/components/dashboard/triage/alert-resolver.ts",
  "src/components/dashboard/triage/types.ts",
  "src/components/dashboard/triage/TriageArtifactPreview.tsx",
]);

const files = walk(triageDir).filter((file) => !file.endsWith("redaction.ts"));
const violations: string[] = [];
for (const file of files) {
  const body = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  for (const term of forbidden) {
    if (body.includes(term)) {
      // Allow the snippet family in the documented files only.
      if (SNIPPET_FAMILY_TERMS.has(term) && SNIPPET_ALLOWLIST_FILES.has(rel)) {
        continue;
      }
      violations.push(`${rel} contains forbidden raw field term: ${term}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(violations.join("\n"));
}

const helper = path.join(triageDir, "redaction.ts");
if (!fs.existsSync(helper)) {
  throw new Error("Missing src/components/dashboard/triage/redaction.ts");
}

// ---------------------------------------------------------------------------
// T13: Panel file redaction scan — second pass (separate from the triage/ walk).
//
// ActionQueue.tsx and AlertsIncidentsPanel.tsx are new consumers of triage
// code introduced in T11 and T12. They must not leak raw payload field names
// into the UI layer.
//
// Forbidden terms for PANEL files — a strict subset of the triage list:
//   - "authorization" is excluded: panels may legitimately contain auth-related
//     code (e.g. RBAC permission strings) that references "authorization".
//   - "secret" is excluded: RBAC/policy code may reference "secret" in type
//     annotations or comments.
//   - The snippet family (matched_snippets, snippet_before, snippet_match,
//     snippet_after) is excluded for AlertsIncidentsPanel.tsx: that file's
//     EvidenceInline component intentionally renders pre-redacted evidence
//     payloads returned by /api/alerts/:id/evidence.  Rendering those field
//     names from a typed API response is not a raw-payload leak — redaction
//     happened server-side before persistence.  ActionQueue.tsx has no
//     EvidenceInline and is held to the full list below.
// ---------------------------------------------------------------------------

const panelForbidden = [
  "payload_excerpt",
  "request_body",
  "response_body",
  "connection_string",
  "api_key",
  "password",
];

// ActionQueue.tsx — full panelForbidden list applies (no EvidenceInline).
const actionQueueRel = "src/components/dashboard/panels/mission-control/ActionQueue.tsx";
const actionQueueFull = path.join(root, actionQueueRel);
console.log("scanning ActionQueue.tsx for raw payload terms…");
if (!fs.existsSync(actionQueueFull)) {
  throw new Error(`T13 FAIL: ${actionQueueRel} not found — cannot run redaction scan`);
}
const actionQueueBody = fs.readFileSync(actionQueueFull, "utf8");
const aqViolations: string[] = [];
for (const term of panelForbidden) {
  if (actionQueueBody.includes(term)) {
    aqViolations.push(`${actionQueueRel} contains forbidden raw field term: ${term}`);
  }
}
if (aqViolations.length > 0) {
  throw new Error(aqViolations.join("\n"));
}
console.log("ActionQueue.tsx: clean");

// AlertsIncidentsPanel.tsx — panelForbidden list applies (snippet family
// excluded as documented above; "authorization" and "secret" also excluded
// per the panel scan policy).
const alertsPanelRel = "src/components/dashboard/panels/AlertsIncidentsPanel.tsx";
const alertsPanelFull = path.join(root, alertsPanelRel);
console.log("scanning AlertsIncidentsPanel.tsx for raw payload terms…");
if (!fs.existsSync(alertsPanelFull)) {
  throw new Error(`T13 FAIL: ${alertsPanelRel} not found — cannot run redaction scan`);
}
const alertsPanelBody = fs.readFileSync(alertsPanelFull, "utf8");
const apViolations: string[] = [];
for (const term of panelForbidden) {
  if (alertsPanelBody.includes(term)) {
    apViolations.push(`${alertsPanelRel} contains forbidden raw field term: ${term}`);
  }
}
if (apViolations.length > 0) {
  throw new Error(apViolations.join("\n"));
}
console.log("AlertsIncidentsPanel.tsx: clean");

console.log("verify-triage-redaction: ok");
