/**
 * Synthetic-but-backed demo fixtures for Mission Control.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md §11
 *
 * Rules:
 *   1. Counts here MUST match the demo rows in the deep-work tabs we drill
 *      into. If we say "Active Incidents: 5", AlertsIncidentsPanel demo
 *      mode must surface 5 demo alerts in open|investigating|acknowledged.
 *   2. NO real payloads, NO secrets, NO live incident content.
 *   3. NO PII, even synthetic-looking ones (avoid plausible-real names/
 *      emails/phone-numbers; use the obvious "demo-" prefix).
 *   4. Empty fixtures are explicit, not silent — empty arrays here surface
 *      as "No demo data for X" empty states downstream.
 *
 * Existing demo data we cross-reference (in src/components/dashboard/mock-data.ts):
 *   - ALERTS_D          — 6 rows; 5 in active scope (ALT-004 is MITIGATED).
 *                         Active-scope severity: 2 CRIT + 2 HIGH + 1 MED.
 *                         Cross-fixture-consistency assertion enforced by
 *                         scripts/verify-dashboard-traffic-fixture.ts.
 *
 * 2026-05-16 (B4): extended from 4 → 11 fixtures so all 5 Mission Control
 * child cards render meaningful, internally-consistent demo state when
 * the dashboard demoMode toggle is on. Previously cards silently fell
 * through to "all clear" / "no data" empty states in demo, which made
 * walkthroughs misleading.
 */

import type { KpiData } from "./types";
import type {
  ActiveIncidentsData,
  CollectorHealthData,
  CostRiskData,
  EvidenceConfidenceData,
  PolicyCoverageData,
  ShieldActivityData,
  ShieldHourBucket,
} from "./data-hooks";

// ---------------------------------------------------------------------------
// Synthetic infrastructure fixture (NEW — no existing demo for this)
// ---------------------------------------------------------------------------

export const COLLECTOR_HEALTH_DEMO = [
  { name: "openclaw-watcher", status: "online", lastSeenSecondsAgo: 3, staleThresholdSeconds: 30, version: "v4.12", note: "demo · 2,733 events ingested · 0 errors" },
  { name: "hermes-watcher", status: "online", lastSeenSecondsAgo: 8, staleThresholdSeconds: 300, version: "state.db", note: "demo · 224 events · 1 loop_risk signal" },
  { name: "paperclip-adapter", status: "stale", lastSeenSecondsAgo: 18 * 3600, staleThresholdSeconds: 1800, version: "HTTP", note: "demo · no events 18h · last poll 503" },
  { name: "session-watcher", status: "online", lastSeenSecondsAgo: 1, staleThresholdSeconds: 10, version: "FS poll", note: "demo · scanning agent dirs · 18 sessions live" },
  { name: "audit-logger", status: "online", lastSeenSecondsAgo: 1, staleThresholdSeconds: 60, version: "SQLite + stdout", note: "demo · stdout mirror engaged · 58-event catalog" },
];

// ---------------------------------------------------------------------------
// Synthetic FinOps signals fixture
// ---------------------------------------------------------------------------

export const FINOPS_SIGNALS_DEMO = [
  { kind: "loop_risk" as const, source: "hermes", agent: "demo-research-agent", count: 1 },
  { kind: "velocity_spike" as const, source: "openclaw", agent: "demo-coding-agent", count: 1 },
  { kind: "context_bloat" as const, source: "openclaw", agent: "demo-research-agent", count: 1 },
];

// ---------------------------------------------------------------------------
// Synthetic detection-trend hourly buckets (24h)
// ---------------------------------------------------------------------------

export const DETECTION_TREND_DEMO = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  block: Math.max(0, Math.round(2 + Math.sin(hour / 4) * 2)),
  review: Math.max(0, Math.round(8 + Math.sin(hour / 3) * 4)),
  allow: Math.round(80 + Math.cos(hour / 6) * 30),
}));

// ---------------------------------------------------------------------------
// B4 (2026-05-16) — fixtures shaped to data-hooks.ts contracts so each
// child card can swap in a fixture when demoMode=true without re-mapping.
// ---------------------------------------------------------------------------

/**
 * Active Incidents aggregate — shape matches useActiveIncidents() return.
 *
 * Counts must match ALERTS_D active-scope subset (status IN
 * 'open'|'acknowledged'|'investigating'). ALERTS_D has 6 rows; ALT-004 is
 * MITIGATED so 5 fall into active scope.
 *   - 3 open: ALT-001 (CRIT), ALT-002 (CRIT), ALT-005 (MED)
 *   - 2 investigating: ALT-003 (HIGH), ALT-006 (HIGH)
 *   - 0 acknowledged
 *
 * Cross-fixture invariant enforced by verify-dashboard-traffic-fixture.ts.
 */
export const ACTIVE_INCIDENTS_DEMO: ActiveIncidentsData = {
  total: 5,
  open: 3,
  acknowledged: 0,
  investigating: 2,
  suppressed: 0,
  critical: 2,
  high: 2,
  medium: 1,
  low: 0,
  oldestOpenAgeMs: 26 * 3600_000,   // 26h — drops one row into the 1-3d aging bucket
  ackButNotResolvedCount: 0,
};

/**
 * Evidence Confidence — shape matches useEvidenceConfidence() return.
 *
 * 5 incidents total. Tuned for a "MIXED" pill (≥50% but <80% exact) so
 * operators see what the evidence-quality color flips look like — a
 * uniformly-exact demo would falsely imply the evidence-stage is always
 * green in production.
 */
export const EVIDENCE_CONFIDENCE_DEMO: EvidenceConfidenceData = {
  total: 5,
  exact: 3,
  fallback: 1,
  missingSnippet: 1,
  percentage: 60,
  outsideWindowFetchable: 1,
};

/**
 * Shield Activity — shape matches useShieldActivity() return, including
 * hourlyBuckets for the DetectionTrend chart.
 *
 * Bucket totals approximately track sin/cos curves (smooth-ish demo
 * waveform). Aggregate values are the sum across all 24 buckets so a
 * verifier can cross-check.
 */
const SHIELD_HOURLY_BUCKETS_DEMO: ShieldHourBucket[] = Array.from({ length: 24 }, (_, i) => {
  const h = new Date(Date.now() - (23 - i) * 3600_000);
  const iso = `${h.getUTCFullYear()}-${String(h.getUTCMonth() + 1).padStart(2, "0")}-${String(h.getUTCDate()).padStart(2, "0")}T${String(h.getUTCHours()).padStart(2, "0")}:00:00Z`;
  const blocked = Math.max(0, Math.round(2 + Math.sin(i / 4) * 2));
  const reviewed = Math.max(0, Math.round(8 + Math.sin(i / 3) * 4));
  const allowed = Math.round(80 + Math.cos(i / 6) * 30);
  return { hour: iso, total: blocked + reviewed + allowed, allowed, reviewed, blocked };
});

export const SHIELD_ACTIVITY_DEMO: ShieldActivityData = {
  total: SHIELD_HOURLY_BUCKETS_DEMO.reduce((s, b) => s + b.total, 0),
  allow: SHIELD_HOURLY_BUCKETS_DEMO.reduce((s, b) => s + b.allowed, 0),
  review: SHIELD_HOURLY_BUCKETS_DEMO.reduce((s, b) => s + b.reviewed, 0),
  block: SHIELD_HOURLY_BUCKETS_DEMO.reduce((s, b) => s + b.blocked, 0),
  topFamily: "JAIL",
  topFamilyPct: 34,
  hourlyBuckets: SHIELD_HOURLY_BUCKETS_DEMO,
};

/**
 * Policy Coverage — shape matches usePolicyCoverage() return.
 *
 * coreRules tracks the live 163 baseline (same constant the live hook
 * hardcodes per spec §5.6 required-copy). 12 enabled egress starter
 * rules + 2 lab-held drafts mirrors the wire-active Generic Egress
 * Starter posture documented in project_oss_direction.md.
 */
export const POLICY_COVERAGE_DEMO: PolicyCoverageData = {
  coreRules: 163,
  activeEgressStarter: 12,
  labHeldDrafts: 2,
  unsafeRegexCount: 0,
};

/**
 * Cost Risk — shape matches useCostRisk() return.
 *
 * Three demo sources spread across openclaw / hermes / litellm with
 * recognisable USD ratios so the per-source bar chart is visually
 * informative. Signals reuse FINOPS_SIGNALS_DEMO kinds so the bottom-
 * card chips line up with the top-card signal counts.
 */
export const COST_RISK_DEMO: CostRiskData = {
  headlineUsd: 4287.45,
  headlineSource: "openclaw",
  perSource: [
    { source: "openclaw", usd: 4287.45, count: 1840 },
    { source: "hermes",   usd: 1924.10, count:  612 },
    { source: "litellm",  usd:  582.33, count:  204 },
  ],
  signals: [
    { kind: "loop_risk",      severity: "warn", detail: "demo · hermes · demo-research-agent" },
    { kind: "velocity_spike", severity: "warn", detail: "demo · openclaw · demo-coding-agent" },
    { kind: "context_bloat",  severity: "warn", detail: "demo · openclaw · demo-research-agent" },
  ],
  sourceStatus: { openclaw: "ok", hermes: "ok", paperclip: "ok" },
  unavailableSources: [],
};

/**
 * Collector Health — shape matches useCollectorHealth() return.
 *
 * One stale collector (paperclip-adapter) so operators see the
 * degraded-row visual in demo. 5 collectors total / 4 healthy.
 *
 * NB: this is a wire-shape mirror of COLLECTOR_HEALTH_DEMO above; the
 * card-level fixture renders directly from CollectorHealthData, so we
 * derive once here rather than rebuilding in the card.
 */
export const COLLECTOR_HEALTH_FIXTURE_DEMO: CollectorHealthData = {
  total: COLLECTOR_HEALTH_DEMO.length,
  healthy: COLLECTOR_HEALTH_DEMO.filter((c) => c.status === "online").length,
  collectors: COLLECTOR_HEALTH_DEMO.map((c) => ({
    name: c.name,
    status: c.status,
    lastSeenMsAgo: c.lastSeenSecondsAgo * 1000,
    staleThresholdMs: c.staleThresholdSeconds * 1000,
    activityState: c.status === "stale" ? "stale" as const : "measured" as const,
    version: c.version,
    ingestion_summary: c.note,
  })),
};

/**
 * Posture Scores — 5-row score-list for OperationalPosture demo.
 *
 * Deliberately mixed accents: at least one warn and one danger so the
 * demo shows operators what a non-trivial posture surface looks like.
 * Verifier asserts at least one non-green row exists.
 */
export interface PostureScoreDemoRow {
  id: "shieldPolicyCoverage" | "evidenceQuality" | "incidentHygiene" | "sourceFreshness" | "costDiscipline";
  label: string;
  current: number;
  weekAvg: number;
  target: number;
  accent: "green" | "warn" | "danger";
}

export const POSTURE_SCORES_DEMO: PostureScoreDemoRow[] = [
  { id: "shieldPolicyCoverage", label: "Shield + Policy Coverage", current: 88, weekAvg: 84, target: 85, accent: "green"  },
  { id: "evidenceQuality",      label: "Evidence Quality",         current: 72, weekAvg: 79, target: 80, accent: "warn"   },
  { id: "incidentHygiene",      label: "Incident Hygiene",         current: 48, weekAvg: 65, target: 75, accent: "danger" },
  { id: "sourceFreshness",      label: "Source Freshness",         current: 92, weekAvg: 90, target: 90, accent: "green"  },
  { id: "costDiscipline",       label: "Cost Discipline",          current: 56, weekAvg: 58, target: 70, accent: "warn"   },
];

/**
 * Incident Aging — 5 buckets × severity for IncidentAging demo.
 *
 * Distribution shaped so the totals sum to ACTIVE_INCIDENTS_DEMO.total
 * (5) with one row in the 3d+ bucket — this exercises the alert
 * graveyard WARNING footer instead of the PASS footer.
 */
export interface IncidentAgingDemoBucket {
  label: "Current" | "1–4h" | "4–24h" | "1–3d" | "3d+";
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export const INCIDENT_AGING_DEMO: IncidentAgingDemoBucket[] = [
  { label: "Current", critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  { label: "1–4h",    critical: 1, high: 0, medium: 0, low: 0, total: 1 },
  { label: "4–24h",   critical: 1, high: 1, medium: 0, low: 0, total: 2 },
  { label: "1–3d",    critical: 0, high: 1, medium: 0, low: 0, total: 1 },
  { label: "3d+",     critical: 0, high: 0, medium: 1, low: 0, total: 1 },
];

/**
 * Action Queue — 6-item mixed demo backlog for ActionQueue demo.
 *
 * Spec §7 expects items composed from multiple sources (alerts, cost,
 * trust-audit, CVE, auth, collector). Demo path is the skeleton render
 * (operator-approved 2026-05-16 over the full priority-pipeline path) — so
 * each row is self-describing and rendered directly without going
 * through ActionQueue's row-builder pipeline.
 *
 * Suggested-action verbs are drawn from the reviewer's canonical 11-verb taxonomy
 * (reference_action_verb_taxonomy.md) so demo doesn't drift into
 * synonyms the live verifier would reject.
 */
export interface ActionQueueDemoItem {
  id: string;
  source: "alert" | "cost" | "cve" | "trust-audit" | "auth" | "collector";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  detail: string;
  suggestedAction: string;
}

export const ACTION_QUEUE_DEMO: ActionQueueDemoItem[] = [
  { id: "ALT-001", source: "alert",       severity: "CRITICAL", title: "Actively Exploitable CVE",     detail: "CVE-2024-1067 in api-gateway. CVSS 9.8 with public exploits.",         suggestedAction: "Diagnose"           },
  { id: "ALT-002", source: "alert",       severity: "CRITICAL", title: "Brute Force Attack",           detail: "47 failed auth attempts in 5 min from 3 IPs. Rate limiting engaged.",  suggestedAction: "Contain agent"      },
  { id: "ALT-006", source: "alert",       severity: "HIGH",     title: "Outbound PII — OUT-PII-EMAIL", detail: "Generic Egress Starter scored an outbound email leak. Sample redacted.", suggestedAction: "Review exposure"  },
  { id: "COST-1",  source: "cost",        severity: "HIGH",     title: "Runaway agent: pentest-agent", detail: "Token consumption $2,847/hr · 10× baseline · 3 sub-agents active.",    suggestedAction: "Restrict capability" },
  { id: "CVE-1",   source: "cve",         severity: "HIGH",     title: "Update OpenClaw → 2026.4.20",  detail: "Installed 2026.4.10 lacks scheduler hardening shipped 2026-04-15.",     suggestedAction: "Update policy"      },
  { id: "AUTH-1",  source: "auth",        severity: "MEDIUM",   title: "RBAC disabled on local install", detail: "All routes default-allow on localhost; consider enabling for multi-operator.", suggestedAction: "Update policy" },
];

// ---------------------------------------------------------------------------
// Helper: demo-mode KPI assembler (called from KpiRow demo branch)
// ---------------------------------------------------------------------------

export function buildDemoKpis(now: number): KpiData[] {
  // NOTE: counts here are deliberately small + obvious-demo to avoid
  // operators ever confusing demo state with real state.
  // Task 9 update: deliberately deferred extending this fixture for the remaining
  // 5 KPIs. demoMode is a passthrough today (KpiRow does not branch on it),
  // because the demo-mode toggle is not yet user-visible on the cockpit. When
  // the toggle ships, this function should grow 5 more cards mirroring the
  // shapes used by useActiveIncidents/useEvidenceConfidence/useShieldActivity/
  // useCostRisk/useCollectorHealth/usePolicyCoverage. For now, returning a
  // single Active Incidents card preserves the function's signature.
  return [
    {
      id: "activeIncidents",
      state: "live",
      value: ACTIVE_INCIDENTS_DEMO.total,
      pill: `${ACTIVE_INCIDENTS_DEMO.open} OPEN`,
      pillAccent: "danger",
      breakdown: [
        { label: "Open", value: String(ACTIVE_INCIDENTS_DEMO.open) },
        { label: "Investigating", value: String(ACTIVE_INCIDENTS_DEMO.investigating) },
        { label: "Acknowledged", value: String(ACTIVE_INCIDENTS_DEMO.acknowledged) },
      ],
      footer: `demo · ${ACTIVE_INCIDENTS_DEMO.critical}C ${ACTIVE_INCIDENTS_DEMO.high}H ${ACTIVE_INCIDENTS_DEMO.medium}M ${ACTIVE_INCIDENTS_DEMO.low}L`,
      stack: [
        { ratio: ACTIVE_INCIDENTS_DEMO.critical / ACTIVE_INCIDENTS_DEMO.total, accent: "danger" },
        { ratio: ACTIVE_INCIDENTS_DEMO.high     / ACTIVE_INCIDENTS_DEMO.total, accent: "warn"   },
        { ratio: ACTIVE_INCIDENTS_DEMO.medium   / ACTIVE_INCIDENTS_DEMO.total, accent: "cyan"   },
        { ratio: ACTIVE_INCIDENTS_DEMO.low      / ACTIVE_INCIDENTS_DEMO.total, accent: "purp"   },
      ],
      lastRefreshedAt: now,
      clickTarget: { tab: "alertsIncidents", opts: { status: "open" } },
      timeBehavior: "point_in_time",
      refreshStrategy: "poll_30s",
    },
  ];
}
