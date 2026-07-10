/**
 * verify-phase6-producers.ts
 *
 * Hermetic test for the 5 Phase 6 row producers in
 *   src/components/dashboard/panels/mission-control/phase6-producers.ts.
 *
 * No DB, no API, no React — pure construction of synthetic findings + the
 * 5 producer functions. For each family asserts:
 *   1. Mapper returns ActionRow[] with the expected length cap.
 *   2. Each ActionRow has the right rawSource.kind.
 *   3. Each ActionRow's suggestedAction.verb is in the canonical
 *      ACTION_VERBS taxonomy.
 *   4. The restricted gate respects operator perm.
 *   5. The first row's rawSource.finding routes through the family-
 *      specific resolver and stamps the family resolverVersion (proves
 *      end-to-end producer → resolver wiring).
 *
 *   npx tsx scripts/verify-phase6-producers.ts
 */

import {
  cveToRows,
  authRbacScan,
  blastRadiusFromAlerts,
  policyWarningScan,
  correlationDetect,
  deriveBlastVector,
  compareCveVersions,
  isVersionAffected,
  type Operator,
} from "../src/components/dashboard/panels/mission-control/phase6-producers";
import { ACTION_VERBS } from "../src/components/dashboard/panels/mission-control/types";
import type { ActiveAlert } from "../src/components/dashboard/panels/mission-control/data-hooks";
import {
  resolveCorrelationTriageGraph,
  type CorrelationFinding,
} from "../src/components/dashboard/triage/correlation-resolver";
import {
  resolveBlastRadiusTriageGraph,
  type BlastRadiusFinding,
} from "../src/components/dashboard/triage/blast-radius-resolver";
import {
  resolveAuthRbacTriageGraph,
  type AuthRbacFinding,
} from "../src/components/dashboard/triage/auth-rbac-resolver";
import {
  resolveUpdateCveTriageGraph,
  type UpdateCveFinding,
} from "../src/components/dashboard/triage/update-cve-resolver";
import {
  resolvePolicyWarningTriageGraph,
  type PolicyWarningFinding,
} from "../src/components/dashboard/triage/policy-warning-resolver";

let assertionCount = 0;
function pass(msg: string) {
  assertionCount++;
  console.log(`PASS: ${msg}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  pass(msg);
}

const VERB_SET = new Set<string>(ACTION_VERBS as readonly string[]);

// Two operator fixtures for the restriction gate tests.
const ADMIN: Operator = { username: "admin", role: "admin" };
const VIEWER: Operator = { username: "viewer", role: "viewer" };

// ---------------------------------------------------------------------------
// Family 1 — update-cve
// ---------------------------------------------------------------------------

console.log("\n[1] Family update-cve — cveToRows");
{
  // 12 applicable OpenClaw CVEs → cap to 10. Advisory records that do not
  // match the installed version must not become action items.
  const installed = { clawnex: "0.15.5-alpha", openclaw: "2026.4.10" };
  const cves = Array.from({ length: 12 }, (_, i) => ({
    cve_id: `CVE-2025-${String(i + 1).padStart(5, "0")}`,
    severity: ["CRITICAL", "HIGH", "MEDIUM", "LOW"][i % 4],
    cvss: 9.8 - i * 0.3,
    title: `OpenClaw < 2026.5.${i + 1} - Test CVE ${i}`,
    fixed_version: `2026.5.${i + 1}`,
    affected_versions: JSON.stringify([`< 2026.5.${i + 1}`]),
    packages: JSON.stringify(["npm/openclaw"]),
  }));
  const rows = cveToRows(cves, installed, undefined, ADMIN);
  assert(rows.length === 10, `cveToRows caps to 10 (got ${rows.length})`);
  assert(rows[0].rawSource?.kind === "update-cve", `first row rawSource.kind === "update-cve"`);
  assert(VERB_SET.has(rows[0].suggestedAction.verb), `update-cve verb is canonical (got "${rows[0].suggestedAction.verb}")`);
  // viewer has alerts:read so update-cve is NOT restricted; auditor doesn't.
  const viewerRows = cveToRows(cves.slice(0, 1), installed, undefined, VIEWER);
  assert(viewerRows[0].restricted === false, `update-cve viewer (has alerts:read) is unrestricted`);
  const auditor: Operator = { username: "a", role: "auditor" };
  const auditorRows = cveToRows(cves.slice(0, 1), installed, undefined, auditor);
  assert(auditorRows[0].restricted === true, `update-cve auditor (no alerts:read) is restricted`);
  // Empty input → empty output.
  assert(cveToRows([], null, undefined, ADMIN).length === 0, `cveToRows([]) returns []`);
  assert(
    cveToRows(cves.slice(0, 1), { ...installed, openclaw: "2026.6.1" }, undefined, ADMIN).length === 0,
    "fixed OpenClaw version does not emit a CVE action",
  );
  assert(cveToRows(cves.slice(0, 1), null, undefined, ADMIN).length === 0, "unknown installed version does not emit a CVE action");
  assert(compareCveVersions("2026.5.10", "2026.5.2") > 0, "calendar versions compare numerically, not lexically");
  assert(compareCveVersions("2026.5.10-beta.1", "2026.5.10") < 0, "prerelease sorts before stable release");
  assert(isVersionAffected("2026.1.24", JSON.stringify([">= 2026.1.20, < 2026.2.1"])), "compound affected range matches");
  assert(!isVersionAffected("2026.6.11", JSON.stringify(["<= 2026.1.24"])), "newer version is outside affected range");
  // End-to-end resolver: feeding the row's rawSource.finding into the family
  // resolver stamps the version-v1 marker (proves dispatch wiring).
  const finding = rows[0].rawSource && "finding" in rows[0].rawSource ? rows[0].rawSource.finding as UpdateCveFinding : null;
  assert(finding !== null, `update-cve rawSource.finding is present`);
  const graph = resolveUpdateCveTriageGraph({ finding: finding as UpdateCveFinding, now: new Date() });
  assert(graph.resolverVersion === "update-cve-resolver-v1", `update-cve resolver stamps v1 (got "${graph.resolverVersion}")`);
}

// ---------------------------------------------------------------------------
// [1b] CVE shape coverage — internal reviewer 2026-05-08 blocker fix
//
// Three real-world CVE input shapes; row copy must read sanely on all three.
// Specifically: the original blocker was that bare-version fixed_version
// (staging host's GHSA/OpenClaw feed) rendered as "Update policy · 2026.4.10"
// because the version got mis-parsed as the package name. Lock against
// regression with shape-specific assertions.
// ---------------------------------------------------------------------------

console.log("\n[1b] Family update-cve — three input shape coverage");
{
  const installed = { clawnex: "0.15.5-alpha", openclaw: "2026.1.20" };
  // Shape #1 — staging-style CVE: title carries package context with " < "
  // pattern, fixed_version is bare version.
  const stagingShape = [{
    cve_id: "CVE-2026-32917",
    severity: "CRITICAL",
    cvss: 9.2,
    title: "OpenClaw < 2026.3.13 - Remote Command Injection via Unsanitized SCP Paths",
    fixed_version: "2026.3.13",
    affected_versions: JSON.stringify(["< 2026.3.13"]),
    packages: JSON.stringify(["npm/openclaw"]),
  }];
  const cRows = cveToRows(stagingShape, installed, undefined, ADMIN);
  assert(
    cRows[0].suggestedAction.target === "OpenClaw → 2026.3.13",
    `shape #1 (title has package < version): target = "OpenClaw → 2026.3.13" (got "${cRows[0].suggestedAction.target}")`,
  );

  // Shape #2 — legacy demo data: fixed_version contains "<package> <version>".
  const legacyShape = [{
    cve_id: "CVE-2024-1067",
    severity: "CRITICAL",
    cvss: 9.8,
    title: "API Gateway authentication bypass",
    fixed_version: "api-gateway 4.2.1",
  }];
  const lRows = cveToRows(legacyShape, installed, undefined, ADMIN);
  assert(
    lRows.length === 0,
    "shape #2 unknown package remains catalogue-only without installed-version evidence",
  );

  // Shape #3 — the internal reviewer blocker: bare version, no `<` in title, no embedded
  // package. Must fall back to title's first word, NOT render the version
  // as the package name.
  const bareShape = [{
    cve_id: "CVE-2026-99999",
    severity: "HIGH",
    cvss: 7.5,
    title: "Random vulnerability description",
    fixed_version: "2026.4.10",
  }];
  const bRows = cveToRows(bareShape, installed, undefined, ADMIN);
  assert(
    bRows.length === 0,
    "shape #3 unbound advisory remains catalogue-only",
  );

  // Polish #4 — internal reviewer 2026-05-08 non-blocking note: when the title is
  // "OpenClaw: subsys < 2026.4.14 - desc", the regex captured "OpenClaw:"
  // (with trailing colon) as the package token. extractCveCopy now strips
  // trailing non-word punctuation from the captured package — slashes /
  // dashes / dots inside the package name remain intact (so the multi-
  // package "OpenClaw/Clawdbot" form is preserved).
  const colonShape = [{
    cve_id: "CVE-2026-44444",
    severity: "HIGH",
    cvss: 8.0,
    title: "OpenClaw: subsystem < 2026.4.14 - description",
    fixed_version: "2026.4.14",
    affected_versions: JSON.stringify(["< 2026.4.14"]),
    packages: JSON.stringify(["npm/openclaw"]),
  }];
  const colonRows = cveToRows(colonShape, installed, undefined, ADMIN);
  assert(
    colonRows[0].suggestedAction.target === "OpenClaw → 2026.4.14",
    `polish #4 (trailing colon stripped): target = "OpenClaw → 2026.4.14" (got "${colonRows[0].suggestedAction.target}")`,
  );

  // Multi-package preservation guard — embedded slash MUST stay in place.
  const slashShape = [{
    cve_id: "CVE-2026-55555",
    severity: "HIGH",
    cvss: 7.8,
    title: "OpenClaw/Clawdbot < 2026.1.29 - shared vuln",
    fixed_version: "2026.1.29",
    affected_versions: JSON.stringify(["<= 2026.1.24"]),
    packages: JSON.stringify(["npm/clawdbot"]),
  }];
  const slashRows = cveToRows(slashShape, installed, undefined, ADMIN);
  assert(
    slashRows[0].suggestedAction.target === "OpenClaw/Clawdbot → 2026.1.29",
    `polish #4 (embedded slash preserved): target = "OpenClaw/Clawdbot → 2026.1.29" (got "${slashRows[0].suggestedAction.target}")`,
  );
}

// ---------------------------------------------------------------------------
// Family 2 — auth-rbac
// ---------------------------------------------------------------------------

console.log("\n[2] Family auth-rbac — authRbacScan");
{
  // RBAC off → 1 row (rbac_off).
  const rbacOff = { rbacEnabled: false, operators: [] };
  const offRows = authRbacScan(rbacOff, ADMIN);
  assert(offRows.length === 1, `RBAC-off scan emits 1 row (got ${offRows.length})`);
  assert(offRows[0].rawSource?.kind === "auth-rbac", `auth-rbac rawSource.kind is "auth-rbac"`);
  assert(VERB_SET.has(offRows[0].suggestedAction.verb), `auth-rbac verb is canonical`);
  // RBAC on + 1 active admin → 1 row (overprovisioned_role).
  const overprov = {
    rbacEnabled: true,
    operators: [
      { id: "op1", username: "admin", role: "admin", last_login_at: null, is_active: 1 },
      { id: "op2", username: "v", role: "viewer", last_login_at: null, is_active: 1 },
    ],
  };
  const opRows = authRbacScan(overprov, ADMIN);
  assert(opRows.length === 1, `single-admin scan emits 1 row (got ${opRows.length})`);
  assert(opRows[0].incidentType === "rbac-overprovisioned_role", `single-admin row incidentType is "rbac-overprovisioned_role"`);
  // Restriction gate: viewer lacks system:manage → restricted=true.
  assert(opRows[0].restricted === false || opRows[0].restricted === true, `restricted flag set`);
  const viewerRows = authRbacScan(overprov, VIEWER);
  assert(viewerRows[0].restricted === true, `auth-rbac viewer (no system:manage) is restricted`);
  // Null input → empty output.
  assert(authRbacScan(null, ADMIN).length === 0, `authRbacScan(null) returns []`);
  // Resolver wiring.
  const finding = opRows[0].rawSource && "finding" in opRows[0].rawSource ? opRows[0].rawSource.finding as AuthRbacFinding : null;
  assert(finding !== null, `auth-rbac rawSource.finding is present`);
  const graph = resolveAuthRbacTriageGraph({ finding: finding as AuthRbacFinding, now: new Date() });
  assert(graph.resolverVersion === "auth-rbac-resolver-v1", `auth-rbac resolver stamps v1 (got "${graph.resolverVersion}")`);
}

// ---------------------------------------------------------------------------
// Family 3 — blast-radius
// ---------------------------------------------------------------------------

console.log("\n[3] Family blast-radius — blastRadiusFromAlerts");
{
  const now = Date.now();
  const alerts = [
    { id: "a1", title: "CRIT alert 1", severity: "CRITICAL", created_at: new Date(now - 60_000).toISOString() },
    { id: "a2", title: "CRIT alert 2", severity: "CRITICAL", created_at: new Date(now - 120_000).toISOString() },
    { id: "a3", title: "CRIT alert 3", severity: "CRITICAL", created_at: new Date(now - 180_000).toISOString() },
    { id: "a4", title: "CRIT alert 4", severity: "CRITICAL", created_at: new Date(now - 240_000).toISOString() },
    { id: "a5", title: "HIGH alert",   severity: "HIGH",     created_at: new Date(now - 60_000).toISOString() },
  ];
  const rows = blastRadiusFromAlerts(alerts, ADMIN);
  assert(rows.length === 3, `blastRadius caps to 3 CRIT alerts (got ${rows.length})`);
  assert(rows[0].rawSource?.kind === "blast-radius", `blast-radius rawSource.kind`);
  assert(VERB_SET.has(rows[0].suggestedAction.verb), `blast-radius verb is canonical`);
  // No CRIT alerts → empty.
  const noCrit = blastRadiusFromAlerts([{ id: "a", severity: "HIGH", created_at: new Date(now).toISOString() }], ADMIN);
  assert(noCrit.length === 0, `no CRIT alerts → 0 rows`);
  // Restriction gate: auditor has no alerts:read.
  const auditor: Operator = { username: "a", role: "auditor" };
  const auditorRows = blastRadiusFromAlerts(alerts, auditor);
  assert(auditorRows[0].restricted === true, `blast-radius auditor (no alerts:read) restricted`);
  // Resolver wiring.
  const finding = rows[0].rawSource && "finding" in rows[0].rawSource ? rows[0].rawSource.finding as BlastRadiusFinding : null;
  assert(finding !== null, `blast-radius rawSource.finding is present`);
  const graph = resolveBlastRadiusTriageGraph({ finding: finding as BlastRadiusFinding, now: new Date() });
  assert(graph.resolverVersion === "blast-radius-resolver-v1", `blast-radius resolver stamps v1`);
}

// ---------------------------------------------------------------------------
// Family 4 — policy-warning
// ---------------------------------------------------------------------------

console.log("\n[4] Family policy-warning — policyWarningScan");
{
  const now = Date.now();
  const STALE_AGE_MS = 31 * 86400_000;
  const rules = [
    // low-confidence: ≥3 firings AND avgConfidence in (0, 0.4)
    { ruleKey: "RULE-LOW", firingCount: 5, avgConfidence: 0.25, lastFiredMs: now - 60_000 },
    // stale: lastFiredMs > 30d ago
    { ruleKey: "RULE-STALE", firingCount: 100, avgConfidence: 0.9, lastFiredMs: now - STALE_AGE_MS },
    // healthy: high confidence, recent firing
    { ruleKey: "RULE-OK", firingCount: 50, avgConfidence: 0.95, lastFiredMs: now - 60_000 },
    // sub-threshold firings (low confidence detector requires ≥3)
    { ruleKey: "RULE-FEW", firingCount: 1, avgConfidence: 0.1, lastFiredMs: now - 60_000 },
  ];
  const rows = policyWarningScan(rules, undefined, ADMIN);
  assert(rows.length === 2, `policyWarning emits 2 rows for 1 low-conf + 1 stale (got ${rows.length})`);
  assert(rows[0].rawSource?.kind === "policy-warning", `policy-warning rawSource.kind`);
  assert(VERB_SET.has(rows[0].suggestedAction.verb), `policy-warning verb is canonical`);
  // Empty / null inputs → empty.
  assert(policyWarningScan(null, undefined, ADMIN).length === 0, `policyWarningScan(null) → []`);
  assert(policyWarningScan([], undefined, ADMIN).length === 0, `policyWarningScan([]) → []`);
  // Restriction gate: auditor has no policies:read.
  const auditor: Operator = { username: "a", role: "auditor" };
  const auditorRows = policyWarningScan(rules, undefined, auditor);
  assert(auditorRows[0].restricted === true, `policy-warning auditor (no policies:read) restricted`);
  // Resolver wiring.
  const finding = rows[0].rawSource && "finding" in rows[0].rawSource ? rows[0].rawSource.finding as PolicyWarningFinding : null;
  assert(finding !== null, `policy-warning rawSource.finding is present`);
  const graph = resolvePolicyWarningTriageGraph({ finding: finding as PolicyWarningFinding, now: new Date() });
  assert(graph.resolverVersion === "policy-warning-resolver-v1", `policy-warning resolver stamps v1`);
}

// ---------------------------------------------------------------------------
// Family 5 — correlation
// ---------------------------------------------------------------------------

console.log("\n[5] Family correlation — correlationDetect");
{
  const NOW_MS = new Date("2026-05-08T12:00:00Z").getTime();
  // Two alerts on the same session_id within 10m, plus a trust-audit
  // finding bound to the same agent. Different kinds → cluster of 3.
  const alerts = [
    { id: "alert-1", title: "alert one", severity: "HIGH", created_at: new Date(NOW_MS).toISOString(), session_id: "abc-123" } as unknown as Parameters<typeof correlationDetect>[0][number],
    { id: "alert-2", title: "alert two", severity: "MEDIUM", created_at: new Date(NOW_MS - 60_000).toISOString(), session_id: "abc-123" } as unknown as Parameters<typeof correlationDetect>[0][number],
    // Different session, alone → no cluster.
    { id: "alert-3", title: "alert three", severity: "LOW", created_at: new Date(NOW_MS).toISOString(), session_id: "xyz-999" } as unknown as Parameters<typeof correlationDetect>[0][number],
  ];
  const signals = [{ kind: "loop_risk", severity: "warn" as const, detail: "agent abc-123 loop spike" }];
  const trustAudit = [{ id: "ta-1", ruleId: "tool-freedom", severity: "high" as const, title: "ta", whyItMatters: "x", agentId: "abc-123" }];
  const rows = correlationDetect(alerts, signals, trustAudit, ADMIN, NOW_MS);
  assert(rows.length === 1, `correlation finds 1 cluster (got ${rows.length})`);
  assert(rows[0].rawSource?.kind === "correlation", `correlation rawSource.kind`);
  assert(VERB_SET.has(rows[0].suggestedAction.verb), `correlation verb is canonical`);
  assert(rows[0].incidentType === "correlation", `correlation incidentType`);
  // No alerts → empty.
  assert(correlationDetect([], [], [], ADMIN, NOW_MS).length === 0, `correlation with no alerts → []`);
  // Restriction gate: auditor lacks alerts:read.
  const auditor: Operator = { username: "a", role: "auditor" };
  const auditorRows = correlationDetect(alerts, signals, trustAudit, auditor, NOW_MS);
  assert(auditorRows[0].restricted === true, `correlation auditor (no alerts:read) restricted`);
  // Resolver wiring.
  const finding = rows[0].rawSource && "finding" in rows[0].rawSource ? rows[0].rawSource.finding as CorrelationFinding : null;
  assert(finding !== null, `correlation rawSource.finding is present`);
  const graph = resolveCorrelationTriageGraph({ finding: finding as CorrelationFinding, now: new Date(NOW_MS) });
  assert(graph.resolverVersion === "correlation-resolver-v1", `correlation resolver stamps v1`);
}

// ---------------------------------------------------------------------------
// [6] v1.1 polish — Item 1 (currentVersion population)
//
// When packageName matches a known component (OpenClaw / ClawNex), the row's
// rawSource.finding.currentVersion should carry the real installed version
// instead of the placeholder "installed". When the package is unknown, or
// installedVersions is null, currentVersion stays undefined and the
// resolver renders package-only copy without a "→ fixedVersion" arrow.
// ---------------------------------------------------------------------------

console.log("\n[6] v1.1 polish — Item 1: currentVersion population");
{
  const installed = { clawnex: "0.14.5-alpha", openclaw: "2026.4.10" };

  // 6.1 — Known component (OpenClaw): currentVersion populated from
  // installed-versions data.
  const openclawCve = [{
    cve_id: "CVE-2026-77777",
    severity: "HIGH",
    cvss: 8.0,
    title: "OpenClaw < 2026.5.0 - test",
    fixed_version: "2026.5.0",
    affected_versions: JSON.stringify(["< 2026.5.0"]),
    packages: JSON.stringify(["npm/openclaw"]),
  }];
  const ocRows = cveToRows(openclawCve, installed, undefined, ADMIN);
  const ocFinding = ocRows[0].rawSource && "finding" in ocRows[0].rawSource
    ? ocRows[0].rawSource.finding as UpdateCveFinding
    : null;
  assert(
    ocFinding?.currentVersion === "2026.4.10",
    `Item 1: OpenClaw currentVersion populated from installedVersions (got "${ocFinding?.currentVersion}")`,
  );

  // 6.2 — Unknown component: currentVersion is undefined.
  const unknownCve = [{
    cve_id: "CVE-2026-88888",
    severity: "HIGH",
    cvss: 7.0,
    title: "lodash < 4.17.21 - prototype pollution",
    fixed_version: "4.17.21",
  }];
  const unkRows = cveToRows(unknownCve, installed, undefined, ADMIN);
  assert(unkRows.length === 0, "Item 1: unknown package is not emitted without installed-version evidence");

  // 6.3 — Case-insensitive match: lowercase "openclaw" packageName resolves.
  const lowerCve = [{
    cve_id: "CVE-2026-99001",
    severity: "MEDIUM",
    cvss: 5.0,
    title: "openclaw < 2026.5.1 - lowercase",
    fixed_version: "2026.5.1",
    affected_versions: JSON.stringify(["< 2026.5.1"]),
    packages: JSON.stringify(["npm/openclaw"]),
  }];
  const lowerRows = cveToRows(lowerCve, installed, undefined, ADMIN);
  const lowerFinding = lowerRows[0].rawSource && "finding" in lowerRows[0].rawSource
    ? lowerRows[0].rawSource.finding as UpdateCveFinding
    : null;
  assert(
    lowerFinding?.currentVersion === "2026.4.10",
    `Item 1: case-insensitive packageName match resolves currentVersion (got "${lowerFinding?.currentVersion}")`,
  );
}

// ---------------------------------------------------------------------------
// [7] v1.1 polish — Item 2 (richer blast-radius vector derivation)
//
// deriveBlastVector runs four detectors in priority order. Five tests
// cover one trigger per vector type plus the unknown fallback.
// ---------------------------------------------------------------------------

console.log("\n[7] v1.1 polish — Item 2: blast vector derivation");
{
  const ts = new Date("2026-05-08T12:00:00Z").toISOString();

  // 7.1 — shared_credential: alert title contains "credential" keyword.
  const credAlerts: ActiveAlert[] = [
    { id: "a1", title: "Credential leaked in audit", severity: "CRITICAL", created_at: ts },
    { id: "a2", title: "Audit log shows secret pattern",         severity: "CRITICAL", created_at: ts },
  ];
  assert(
    deriveBlastVector(credAlerts) === "shared_credential",
    `Item 2: credential keyword → shared_credential (got "${deriveBlastVector(credAlerts)}")`,
  );

  // 7.2 — shared_tool: ≥2 alerts mention same tool token (discord).
  // No credential keywords, so detector falls through to tool.
  const toolAlerts: ActiveAlert[] = [
    { id: "b1", title: "discord webhook posted", severity: "CRITICAL", created_at: ts },
    { id: "b2", title: "discord channel exfil",  severity: "CRITICAL", created_at: ts },
  ];
  assert(
    deriveBlastVector(toolAlerts) === "shared_tool",
    `Item 2: shared tool token → shared_tool (got "${deriveBlastVector(toolAlerts)}")`,
  );

  // 7.3 — shared_policy: ≥2 shield-source alerts share rule-key prefix.
  // Source field "shield" + title carries CMD-* prefix on both rows.
  // Avoid credential / tool keywords so the detector cleanly hits.
  const policyAlerts: ActiveAlert[] = [
    { id: "c1", title: "CMD-EVAL fired on inbound",  severity: "CRITICAL", source: "shield", created_at: ts },
    { id: "c2", title: "CMD-PIPE-CURL fired again",  severity: "CRITICAL", source: "shield", created_at: ts },
  ];
  assert(
    deriveBlastVector(policyAlerts) === "shared_policy",
    `Item 2: shield rule-prefix cluster → shared_policy (got "${deriveBlastVector(policyAlerts)}")`,
  );

  // 7.4 — shared_session_template: 2+ alerts, no credential/tool/policy
  // markers. Catches the original behaviour as the lowest-priority match.
  const sessionAlerts: ActiveAlert[] = [
    { id: "d1", title: "Generic incident one", severity: "CRITICAL", created_at: ts },
    { id: "d2", title: "Generic incident two", severity: "CRITICAL", created_at: ts },
  ];
  assert(
    deriveBlastVector(sessionAlerts) === "shared_session_template",
    `Item 2: 2+ generic alerts → shared_session_template (got "${deriveBlastVector(sessionAlerts)}")`,
  );

  // 7.5 — unknown: empty cluster.
  assert(
    deriveBlastVector([]) === "unknown",
    `Item 2: empty cluster → unknown (got "${deriveBlastVector([])}")`,
  );
}

// ---------------------------------------------------------------------------
// [8] v1.1 polish — Item 3 (degraded-source banners)
//
// When a Phase 6 producer's data source is unreachable, the producer emits
// ONE banner row (severity WARN, verb Diagnose, family infrastructure,
// rawSource undefined) instead of silently emitting zero. Three assertions
// cover the auth-degraded path, the banner shape, and the no-degraded
// passthrough.
// ---------------------------------------------------------------------------

console.log("\n[8] v1.1 polish — Item 3: degraded-source banners");
{
  // 8.1 — cveToRows with degraded auth emits a single banner.
  const degAuth = { reason: "auth" as const };
  const banners = cveToRows([], null, degAuth, ADMIN);
  assert(
    banners.length === 1,
    `Item 3: degraded cveToRows emits exactly 1 banner row (got ${banners.length})`,
  );

  // 8.2 — banner row shape: WARN severity, Diagnose verb, infrastructure
  // family, no rawSource (falls through to generic resolver).
  const banner = banners[0];
  assert(
    banner.severity === "WARN" &&
    banner.suggestedAction.verb === "Diagnose" &&
    banner.family === "infrastructure" &&
    banner.rawSource === undefined,
    `Item 3: banner has WARN + Diagnose + infrastructure family + no rawSource (got severity=${banner.severity}, verb=${banner.suggestedAction.verb}, family=${banner.family}, rawSource=${banner.rawSource})`,
  );

  // 8.3 — undefined degraded → normal emit path. Hand cveToRows real CVE
  // input plus undefined degraded; expect normal CVE rows (no banners).
  const normalCves = [{
    cve_id: "CVE-2025-00001",
    severity: "HIGH",
    cvss: 7.5,
    title: "OpenClaw < 2026.5.0 - Some CVE",
    fixed_version: "2026.5.0",
    affected_versions: JSON.stringify(["< 2026.5.0"]),
    packages: JSON.stringify(["npm/openclaw"]),
  }];
  const normal = cveToRows(normalCves, { clawnex: "0.15.5-alpha", openclaw: "2026.4.10" }, undefined, ADMIN);
  assert(
    normal.length === 1 && normal[0].rawSource?.kind === "update-cve",
    `Item 3: undefined degraded → normal CVE emit (got length=${normal.length}, kind=${normal[0]?.rawSource?.kind})`,
  );
}

console.log(`\n✅ All ${assertionCount} assertions passed`);
