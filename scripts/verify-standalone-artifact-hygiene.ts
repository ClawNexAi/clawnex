#!/usr/bin/env tsx
/**
 * Verifies Next standalone output does not carry local runtime state or secrets.
 *
 * Run after `npm run build`. This intentionally skips node_modules so the
 * check stays focused on files traced from this repository/runtime workspace.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

let passed = 0;
let failed = 0;

function t(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(standalone, rel));
}

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(standalone, full);
    out.push(rel);
    if (entry.isDirectory()) walk(full, out);
  }
}

console.log("[standalone artifact hygiene]");
t(".next/standalone exists", fs.existsSync(standalone));

const all: string[] = [];
if (fs.existsSync(standalone)) walk(standalone, all);

const leakedEnv = all.filter((rel) => path.basename(rel).startsWith(".env"));
const leakedGit = all.filter((rel) => rel.split(path.sep).includes(".git"));
const leakedLogs = all.filter((rel) => rel === "logs" || rel.startsWith(`logs${path.sep}`));
const leakedDb = all.filter((rel) => /(?:^|[/\\])(?:clawnex|sentinel)\.db(?:-(?:wal|shm|journal))?$/.test(rel));
const leakedLiteLlmConfig = all.filter((rel) => /^litellm[/\\]config.*\.ya?ml$/.test(rel));
const leakedAgentState = all.filter((rel) =>
  rel === "AGENTS.md" ||
  rel === "CLAUDE.md" ||
  rel === ".agents" ||
  rel.startsWith(`.agents${path.sep}`) ||
  rel === ".claude" ||
  rel.startsWith(`.claude${path.sep}`) ||
  rel === ".codex" ||
  rel.startsWith(`.codex${path.sep}`) ||
  rel === ".cursor" ||
  rel.startsWith(`.cursor${path.sep}`) ||
  rel === ".gstack" ||
  rel.startsWith(`.gstack${path.sep}`) ||
  rel === ".vscode" ||
  rel.startsWith(`.vscode${path.sep}`) ||
  rel === "skills" ||
  rel.startsWith(`skills${path.sep}`),
);
const leakedScripts = all.filter((rel) => rel === "scripts" || rel.startsWith(`scripts${path.sep}`));
const leakedInternalDocs = all.filter((rel) => {
  const parts = rel.split(path.sep);
  const base = path.basename(rel).toLowerCase();
  return (
    (parts[0] === "docs" && parts[1] === "AGENTS.md") ||
    (parts[0] === "docs" && parts[1] === "CLAUDE.md") ||
    (parts[0] === "docs" && parts[1] === ".claude") ||
    (parts[0] === "docs" && parts[1] === "coordination") ||
    (parts[0] === "docs" && parts[1] === "internal") ||
    (parts[0] === "docs" && parts[1] === "proposals") ||
    (parts[0] === "docs" && parts[1] === "qa") ||
    (parts[0] === "docs" && parts[1] === "out") ||
    (parts[0] === "docs" && parts[1] === "social-campaigns") ||
    (parts[0] === "docs" && parts[1] === "superpowers") ||
    (parts[0] === "docs" && parts[1] === "tracking") ||
    (parts[0] === "docs" && parts[1] === "training-workbooks") ||
    (parts[0] === "docs" && /(?:handoff|adversarial-review|overnight)/.test(base))
  );
});

const allowedStandaloneDocs = new Set([
  "docs/06-basic-user-manual.md",
  "docs/07-advanced-user-manual.md",
  "docs/10-api-reference.md",
  "docs/13-release-notes.md",
  "docs/14-data-dictionary.md",
  "docs/17-troubleshooting-guide.md",
  "docs/19-api-mcp-integration-guide.md",
  "docs/governance-index.md",
  "docs/governance-one-pager.md",
  "docs/policy-evidence-checklist.md",
  "docs/policies/README.md",
  "docs/policies/01-information-security-policy.md",
  "docs/policies/02-access-control-policy.md",
  "docs/policies/03-incident-response-policy.md",
  "docs/policies/04-change-management-policy.md",
  "docs/policies/05-vendor-third-party-risk-policy.md",
  "docs/policies/06-risk-management-policy.md",
  "docs/policies/07-secure-sdlc-policy.md",
  "docs/policies/08-data-classification-policy.md",
  "docs/policies/09-data-retention-and-disposal-policy.md",
  "docs/policies/10-bcp-dr-policy.md",
  "docs/policies/11-cryptographic-controls-policy.md",
  "docs/policies/12-asset-management-policy.md",
  "docs/policies/13-vulnerability-management-policy.md",
  "docs/policies/14-acceptable-use-policy.md",
  "docs/registers/risk-register.md",
  "docs/registers/vendor-inventory-register.md",
]);
const unexpectedDocs = all.filter((rel) => {
  if (!rel.startsWith(`docs${path.sep}`)) return false;
  const full = path.join(standalone, rel);
  if (!fs.statSync(full).isFile()) return false;
  return !allowedStandaloneDocs.has(rel.split(path.sep).join("/"));
});
const requiredRootDocs = [
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
];
const missingRootDocs = requiredRootDocs.filter((rel) => !exists(rel));

t("no .env files copied into standalone", leakedEnv.length === 0, leakedEnv.join(", "));
t("no .git metadata copied into standalone", leakedGit.length === 0, leakedGit.join(", "));
t("no logs copied into standalone", leakedLogs.length === 0, leakedLogs.join(", "));
t("no local SQLite DB files copied into standalone", leakedDb.length === 0, leakedDb.join(", "));
t("no generated LiteLLM config copied into standalone", leakedLiteLlmConfig.length === 0, leakedLiteLlmConfig.join(", "));
t("no local agent skills copied into standalone", leakedAgentState.length === 0, leakedAgentState.slice(0, 20).join(", "));
t("no source/helper scripts copied into standalone", leakedScripts.length === 0, leakedScripts.slice(0, 20).join(", "));
t("no internal docs, planning archives, QA evidence, agent settings, tracking notes, or docs-site build output copied into standalone", leakedInternalDocs.length === 0, leakedInternalDocs.slice(0, 20).join(", "));
t("standalone docs are limited to /api/docs whitelist", unexpectedDocs.length === 0, unexpectedDocs.slice(0, 20).join(", "));
t("root /api/docs files are present", missingRootDocs.length === 0, missingRootDocs.join(", "));

t("known env paths absent", !exists(".env") && !exists(".env.local"));
t("known runtime paths absent", !exists("logs") && !exists("litellm/config.yaml") && !exists("AGENTS.md") && !exists("CLAUDE.md") && !exists(".agents") && !exists(".claude") && !exists(".codex") && !exists(".cursor") && !exists(".gstack") && !exists(".vscode") && !exists("skills") && !exists("scripts") && !exists("docs/.git") && !exists("docs/AGENTS.md") && !exists("docs/CLAUDE.md") && !exists("docs/.claude") && !exists("docs/coordination") && !exists("docs/internal") && !exists("docs/proposals") && !exists("docs/qa") && !exists("docs/out") && !exists("docs/social-campaigns") && !exists("docs/superpowers") && !exists("docs/tracking") && !exists("docs/training-workbooks"));

if (failed) {
  console.error(`\nFAIL: ${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\nPASS: ${passed} passed, 0 failed`);
