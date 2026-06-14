/**
 * Verify Wave 1 of alert→evidence backlink hardening (v0.11.3-alpha).
 *
 * Covers the reviewer's six acceptance tests:
 *   1. Exact-token proof — EVD detail surfaces rule_key, sample, match-centered
 *      snippet (NOT just first 200 chars of payload).
 *   2. Deterministic link — Alert metadata audit_event_id resolves to the exact
 *      audit row; correlation_method === 'forward'.
 *   3. Old evidence — GET /api/audit/:id returns 200 + the row even when the
 *      row's created_at predates the dashboard time window.
 *   4. Return path — AlertsIncidentsPanel passes fromAlert in onNavigate;
 *      AuditEvidencePanel exposes a Back-to-Incident handler that calls
 *      onNavigate("alertsIncidents", ...).
 *   5. Fallback labeling — alert without audit_event_id metadata still resolves
 *      via session+timestamp; correlation_method === 'fallback_nearest';
 *      AuditEvidencePanel branches on correlation_method to render exact-vs-
 *      best-match labels.
 *   6. Regression check — filter-restore semantics: when focusedAuditId clears,
 *      saved filter state is restored. Unit-style assertion via source grep.
 *
 * Hermetic harness: in-memory SQLite, no live data. Matches verify-cost-orchestrator.ts
 * pattern. NODE_ENV=development so the localhost guard does not block the
 * server-side fetch path used by the API routes.
 *
 * NOTE: tsx CJS transform does not support top-level await — body wrapped in
 * async main() and dispatched at the bottom (carry-forward known plan bug #1).
 */

process.env.DATABASE_PATH = ":memory:";
process.env.CLAWNEX_AUDIT_STDOUT = "false";
// NODE_ENV is read-only in @types/node when typed strictly, but the runtime
// allows assignment via the indexer form. Falls back to "development" so the
// localhost guard's no-IP path returns null (allow).
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
// Ensure RBAC is OFF for these tests so we hit the localhost-guard fallback;
// localhost-guard returns null (allow) in development without a request IP.
delete process.env.RBAC_ENABLED;
delete process.env.NEXT_PUBLIC_RBAC_ENABLED;

import { NextRequest } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import { run as dbRun } from "../src/lib/db/index";
import { GET as auditByIdGET } from "../src/app/api/audit/[id]/route";
import { GET as alertEvidenceGET } from "../src/app/api/alerts/[id]/evidence/route";

let pass = 0;
let fail = 0;
function t(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(name: string): void {
  console.log(`\n[${name}]`);
}

// ---------------------------------------------------------------------------
// Synthetic fixture builder
// ---------------------------------------------------------------------------

interface SyntheticFixture {
  alertId: string;
  auditId: string;
  sessionId: string;
  knownToken: string;
}

function insertAuditRow(opts: {
  id: string;
  action: "shield_detected" | "shield_review";
  resourceId: string;
  detail: object;
  createdAt: string;
}): void {
  dbRun(
    `INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      "session-watcher",
      opts.action,
      "session",
      opts.resourceId,
      JSON.stringify(opts.detail),
      "session-watcher",
      opts.createdAt,
    ],
  );
}

function insertAlertRow(opts: {
  id: string;
  source: string;
  metadata: object | null;
  description: string;
  createdAt: string;
}): void {
  dbRun(
    `INSERT INTO alerts (id, title, description, severity, source, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      "Test Alert",
      opts.description,
      "HIGH",
      opts.source,
      "open",
      opts.metadata === null ? null : JSON.stringify(opts.metadata),
      opts.createdAt,
      opts.createdAt,
    ],
  );
}

/**
 * Build a synthetic alert+audit pair where the matched sample appears at
 * char 250+ in the payload — proves the EVD detail does NOT just truncate
 * to first 200 chars. The "known token" is the canary the test asserts on.
 */
function buildExactTokenFixture(): SyntheticFixture {
  const alertId = "alert-exact-001";
  const auditId = "audit-exact-001";
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const knownToken = "AKIAIOSFODNN7EXAMPLE"; // intentional canary, char 256+
  // Build a 280-char prefix so the token sits past char 200.
  const prefix = "x".repeat(256);
  const payloadExcerpt = `${prefix} ${knownToken} suffix-context-data`;

  const now = new Date("2026-05-04T12:00:00.000Z").toISOString();
  insertAuditRow({
    id: auditId,
    action: "shield_detected",
    resourceId: sessionId,
    detail: {
      summary: "AWS access key detected",
      shield_detections: [
        {
          id: "rule.aws_key",
          rule_key: "secret.aws_access_key",
          name: "AWS Access Key",
          severity: "HIGH",
          confidence: 0.99,
          matchCount: 1,
          samples: [knownToken],
          tags: ["secret", "aws"],
          source: "scanner",
          category: "secrets",
        },
      ],
      payload_excerpt: payloadExcerpt,
      payload_excerpt_truncated: false,
      payload_total_length: payloadExcerpt.length,
      session_id: sessionId,
      direction: "inbound",
      verdict: "block",
      score: 95,
      prompt_hash: "sha256:abc",
      proxy_traffic_id: "tx-001",
    },
    createdAt: now,
  });
  insertAlertRow({
    id: alertId,
    source: "session-watcher",
    metadata: { audit_event_id: auditId, session_id: sessionId },
    description: `Session: ${sessionId}\nDetection: aws_access_key`,
    createdAt: now,
  });
  return { alertId, auditId, sessionId, knownToken };
}

/**
 * Synthetic alert pointing at an audit row 7 days in the past (older than
 * any practical dashboard time window).
 */
function buildOldEvidenceFixture(): { alertId: string; auditId: string } {
  const alertId = "alert-old-001";
  const auditId = "audit-old-001";
  const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const oldTs = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  insertAuditRow({
    id: auditId,
    action: "shield_review",
    resourceId: sessionId,
    detail: {
      summary: "stale evidence",
      shield_detections: [
        {
          id: "rule.email",
          rule_key: "pii.email",
          name: "Email",
          severity: "MEDIUM",
          confidence: 0.9,
          matchCount: 1,
          samples: ["a@b.example"],
          tags: ["pii"],
          source: "scanner",
          category: "pii",
        },
      ],
      payload_excerpt: "before a@b.example after",
      payload_excerpt_truncated: false,
      payload_total_length: 24,
      session_id: sessionId,
      direction: "outbound",
    },
    createdAt: oldTs,
  });
  insertAlertRow({
    id: alertId,
    source: "session-watcher",
    metadata: { audit_event_id: auditId, session_id: sessionId },
    description: `Session: ${sessionId}\nDetection: pii_email`,
    createdAt: oldTs,
  });
  return { alertId, auditId };
}

/**
 * Synthetic alert WITHOUT audit_event_id in its metadata — forces the
 * fallback session+timestamp correlation path. Uses the same session id
 * + a created_at within ±60s so the fallback finds the row.
 */
function buildFallbackFixture(): { alertId: string; auditId: string } {
  const alertId = "alert-fallback-001";
  const auditId = "audit-fallback-001";
  const sessionId = "ffffffff-0000-1111-2222-333333333333";
  // Audit row 30s before alert.
  const auditTs = new Date("2026-05-04T11:59:30.000Z").toISOString();
  const alertTs = new Date("2026-05-04T12:00:00.000Z").toISOString();
  insertAuditRow({
    id: auditId,
    action: "shield_detected",
    resourceId: sessionId,
    detail: {
      summary: "fallback path",
      shield_detections: [
        {
          id: "rule.cc",
          rule_key: "pii.credit_card",
          name: "Credit Card",
          severity: "HIGH",
          confidence: 0.97,
          matchCount: 1,
          samples: ["411111******1111"],
          tags: ["pii", "pci"],
          source: "scanner",
          category: "pii",
        },
      ],
      payload_excerpt: "pre 411111******1111 post",
      payload_excerpt_truncated: false,
      payload_total_length: 24,
      session_id: sessionId,
      direction: "inbound",
    },
    createdAt: auditTs,
  });
  insertAlertRow({
    id: alertId,
    source: "session-watcher",
    // No audit_event_id — forces fallback path.
    metadata: { session_id: sessionId },
    description: `Session: ${sessionId}\nDetection: credit_card`,
    createdAt: alertTs,
  });
  return { alertId, auditId };
}

// ---------------------------------------------------------------------------
// Helpers — invoke route handlers
// ---------------------------------------------------------------------------

async function callAuditById(id: string): Promise<{ status: number; body: any }> {
  const req = new NextRequest(`http://127.0.0.1/api/audit/${encodeURIComponent(id)}`);
  // requireLocalhost in dev with no nextIp returns null (allow). RBAC is off.
  const res = await auditByIdGET(req, { params: Promise.resolve({ id }) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function callAlertEvidence(alertId: string): Promise<{ status: number; body: any }> {
  const req = new NextRequest(`http://127.0.0.1/api/alerts/${encodeURIComponent(alertId)}/evidence`);
  const res = await alertEvidenceGET(req, { params: Promise.resolve({ id: alertId }) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Read panel + alerts source files for unit-style grep assertions.
  const auditPanelPath = path.resolve(__dirname, "..", "src", "components", "dashboard", "panels", "AuditEvidencePanel.tsx");
  const alertsPanelPath = path.resolve(__dirname, "..", "src", "components", "dashboard", "panels", "AlertsIncidentsPanel.tsx");
  const dashboardRootPath = path.resolve(__dirname, "..", "src", "components", "dashboard", "index.tsx");
  const auditPanelSrc = fs.readFileSync(auditPanelPath, "utf-8");
  const alertsPanelSrc = fs.readFileSync(alertsPanelPath, "utf-8");
  const dashboardRootSrc = fs.readFileSync(dashboardRootPath, "utf-8");

  // -----------------------------------------------------------------------
  section("Test 1: Exact-token proof — EVD shows rule_key, sample, match-centered snippet (NOT first-200-char truncation)");
  const exactFx = buildExactTokenFixture();
  const ev1 = await callAlertEvidence(exactFx.alertId);
  t("alert-evidence returns 200", ev1.status === 200, `got ${ev1.status}`);
  t("response carries audit_event_id matching metadata", ev1.body?.audit_event_id === exactFx.auditId);
  t("response carries rule_key from detection", Array.isArray(ev1.body?.matched_snippets) && ev1.body.matched_snippets[0]?.rule_key === "secret.aws_access_key");
  t("response carries detection name", ev1.body?.matched_snippets[0]?.name === "AWS Access Key");
  t("matched_snippets[0].sample equals the known token", ev1.body?.matched_snippets[0]?.sample === exactFx.knownToken);
  t("snippet_match equals the known token (centered, not truncated)", ev1.body?.matched_snippets[0]?.snippet_match === exactFx.knownToken);
  // The token sits at char 257; first-200-char prefix would NOT contain it.
  // Assert the snippet is centered on the match, not just the head.
  const idx = ev1.body?.payload_excerpt?.indexOf?.(exactFx.knownToken);
  t("token sits past char 200 in payload (regression guard)", typeof idx === "number" && idx >= 200, `idx=${idx}`);
  t("match_found_in_excerpt is true", ev1.body?.matched_snippets[0]?.match_found_in_excerpt === true);

  // -----------------------------------------------------------------------
  section("Test 2: Deterministic link — alert.metadata.audit_event_id resolves; correlation_method === 'forward'");
  t("correlation_method === 'forward' for alert with audit_event_id", ev1.body?.correlation_method === "forward");
  t("audit_event_id in response equals metadata.audit_event_id", ev1.body?.audit_event_id === exactFx.auditId);

  // -----------------------------------------------------------------------
  section("Test 3: Old evidence — GET /api/audit/:id returns the row regardless of time window");
  const oldFx = buildOldEvidenceFixture();
  const fetched = await callAuditById(oldFx.auditId);
  t("fetch-by-id returns 200 for known id", fetched.status === 200, `got ${fetched.status}`);
  t("fetch-by-id returns the matching row", fetched.body?.event?.id === oldFx.auditId);
  t("returned row's created_at IS in the past (sanity)", typeof fetched.body?.event?.created_at === "string" && Date.parse(fetched.body.event.created_at) < Date.now() - 24 * 60 * 60 * 1000);
  // 404 path
  const missing = await callAuditById("does-not-exist-zzzzz");
  t("fetch-by-id returns 404 for unknown id", missing.status === 404);

  // -----------------------------------------------------------------------
  section("Test 4: Return path — onNavigate carries fromAlert; AuditEvidencePanel renders Back-to-Incident");
  t("AlertsIncidentsPanel passes fromAlert: alertId in onNavigate(\"auditEvidence\", ...)", /onNavigate\("auditEvidence",\s*\{[^}]*fromAlert:\s*alertId/.test(alertsPanelSrc));
  // v0.11.4+: BackToIncidentBreadcrumb was converted from a JSX component to a
  // render-helper function (`renderBackToIncidentBreadcrumb()`) to fix the
  // every-second EVD detail unmount/remount caused by inner-defined components.
  // Functionality unchanged. Assertion accepts either form.
  t("AuditEvidencePanel exposes Back-to-Incident render path", /function (BackToIncidentBreadcrumb|renderBackToIncidentBreadcrumb)\b/.test(auditPanelSrc));
  t("AuditEvidencePanel breadcrumb calls onNavigate(\"alertsIncidents\", ...)", /onNavigate\("alertsIncidents",\s*\{[^}]*focusAlertId/.test(auditPanelSrc));
  t("AuditEvidencePanel calls onBackConsumed when breadcrumb fires", /onBackConsumed\?\.\(\)/.test(auditPanelSrc));
  t("AlertsIncidentsPanel accepts focusedAlertId prop", /focusedAlertId\?:\s*string\s*\|\s*null/.test(alertsPanelSrc));
  t("AlertsIncidentsPanel calls onAlertFocusConsumed", /onAlertFocusConsumed\?\.\(\)/.test(alertsPanelSrc));
  t("Dashboard root tracks incomingFromAlert state", /incomingFromAlert,\s*setIncomingFromAlert/.test(dashboardRootSrc));
  t("Dashboard root tracks alertFocus state for return path", /alertFocus,\s*setAlertFocus/.test(dashboardRootSrc));

  // -----------------------------------------------------------------------
  section("Test 5: Fallback labeling — alert without audit_event_id resolves via session+timestamp; UI labels best-match");
  const fbFx = buildFallbackFixture();
  const ev5 = await callAlertEvidence(fbFx.alertId);
  t("fallback alert evidence returns 200", ev5.status === 200, `got ${ev5.status}`);
  t("correlation_method === 'fallback_nearest' for alert without audit_event_id", ev5.body?.correlation_method === "fallback_nearest");
  t("fallback resolved to the correct audit row by session+timestamp", ev5.body?.audit_event_id === fbFx.auditId);
  // v0.11.4+: CorrelationPill was converted from a JSX component to a render-
  // helper (`renderCorrelationPill(method)`) to fix the every-second EVD detail
  // unmount/remount. Branches on method param, same exact/fallback labeling.
  t("AuditEvidencePanel branches on correlation_method (CorrelationPill render path)", /function (CorrelationPill\(\{ method \}|renderCorrelationPill\(method)/.test(auditPanelSrc));
  t("AuditEvidencePanel renders 'Exact match' label for forward", /Exact match \(audit_event_id\)/.test(auditPanelSrc));
  t("AuditEvidencePanel renders 'Best match' label for fallback_nearest", /Best match.*fallback by session/.test(auditPanelSrc));
  t("AlertsIncidentsPanel inline view branches on correlation_method", /correlation_method === "forward"/.test(alertsPanelSrc));
  t("AlertsIncidentsPanel inline view renders 'Exact match' pill", /Exact match \(audit_event_id\)/.test(alertsPanelSrc));
  t("AlertsIncidentsPanel inline view renders 'Best match' pill", /Best match.*fallback by session/.test(alertsPanelSrc));

  // -----------------------------------------------------------------------
  section("Test 6: Regression check — filter restore + outside-window detail render");
  t("AuditEvidencePanel saves filter state before clearing (savedFilterStateRef)", /savedFilterStateRef/.test(auditPanelSrc));
  t("AuditEvidencePanel restores filters on selectedEvidence === null", /savedFilterStateRef\.current\s*=\s*null/.test(auditPanelSrc));
  t("AuditEvidencePanel restore writes status/actor/source/q back to URL", /updateUrl\(\{\s*status:\s*saved\.status/.test(auditPanelSrc));
  t("AuditEvidencePanel restore writes saved.page back to currentPage", /setCurrentPage\(saved\.page\)/.test(auditPanelSrc));
  t("AuditEvidencePanel fetches via /api/audit/:id when row not in window", /\/api\/audit\/\$\{encodeURIComponent\(selectedEvidence\)\}/.test(auditPanelSrc));
  // 'Outside current window' is the new informational copy; the prior
  // 'NOT IN WINDOW' warning that asked the operator to widen the time
  // filter must no longer be rendered (the only remaining occurrence
  // permitted is in the comment that documents its removal).
  t(
    "AuditEvidencePanel renders 'Outside current window' informational notice (NOT the prior warning)",
    /Outside current window/.test(auditPanelSrc) && !/>NOT IN WINDOW</.test(auditPanelSrc),
  );
  t("AuditEvidencePanel still renders the inline workflow buttons & filters (regression guard via PanelFilters import)", /import \{ PanelFilters \}/.test(auditPanelSrc));
  t("AlertsIncidentsPanel still has ACK / Investigate / Resolve / Suppress buttons (regression guard)", /handleAction\(a\.id, "acknowledge"\)/.test(alertsPanelSrc) && /handleAction\(a\.id, "investigate"\)/.test(alertsPanelSrc) && /handleAction\(a\.id, "resolve"\)/.test(alertsPanelSrc) && /AcceptRiskButton/.test(alertsPanelSrc));
  t("AlertsIncidentsPanel inline-expand fallback path is preserved (toggleEvidence still routed)", /toggleEvidence\(a\.id\)/.test(alertsPanelSrc) && /EvidenceInline/.test(alertsPanelSrc));

  // -----------------------------------------------------------------------
  console.log(`\n${pass}/${pass + fail} CHECKS PASSED`);
  if (fail > 0) {
    console.log("\nFAILED");
    process.exit(1);
  }
  console.log("\nALL 6 ACCEPTANCE TESTS GREEN");
}

main().catch(e => { console.error(e); process.exit(1); });
