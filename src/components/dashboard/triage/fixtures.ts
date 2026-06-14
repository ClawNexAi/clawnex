import type { TriageGraph } from "./types";

// Fixed timestamp used throughout the fixture. Must not depend on Date.now() so
// that snapshot tests, verifier scripts, and Storybook stories all see the same
// values on every run.
const FIXED_TIMESTAMP = "2026-05-06T10:00:00.000Z";

/**
 * Approved-mockup TriageGraph fixture. Used by:
 *  - TriageGraphCard component dev / Storybook-style testing
 *  - verify-triage-graph-contract.ts (asserts stage order + titles + structure)
 *  - any future visual-regression spec
 *
 * Source of truth for the issue narrative, tags, and artifact set:
 *   docs/superpowers/mockups/2026-05-05-triage-graph-inline-artifact-preview.html
 *
 * Safe-content rule (spec §10): no raw payload excerpts, no snippet samples,
 * no credentials, no tokens, no API keys, no connection strings, no PII. Every
 * value here is deliberately operator-summary-grade.
 */
export const approvedMockTriageGraph: TriageGraph = {
  issue: {
    id: "demo-incident-82f",
    kind: "alert",
    title: "Session Shield REVIEW: outbound OUT-PII-PHONE_US match",
    severity: "MED",
    status: "open",
    source: "session-watcher",
    createdAt: FIXED_TIMESTAMP,
    summary:
      "Outbound message matched the OUT-PII-PHONE_US pattern. Raw payload available in Audit & Evidence under RBAC redaction.",
    tags: [
      { label: "source",      value: "session-watcher",  safe: true },
      { label: "rule_key",    value: "OUT-PII-PHONE_US",      safe: true },
      { label: "session",     value: "demo-session-82f",  safe: true },
      { label: "model",       value: "gpt-demo-5",        safe: true },
      { label: "prompt_hash", value: "ph_demo_9a31",      safe: true },
    ],
  },

  // ------------------------------------------------------------------
  // Stages — 5 in canonical order: evidence → sourceEvent →
  // affectedObject → relatedActivity → fixControl.
  // The contract verifier checks for the literal title strings in this
  // exact order; do not reorder.
  // ------------------------------------------------------------------
  stages: [
    {
      id: "evidence",
      title: "Evidence",
      eyebrow: "01",
      state: "resolved",
      summary:
        "Exact Audit & Evidence row. Sample/token/metadata under RBAC redaction.",
      artifactIds: ["evidence-EVD-042"],
    },
    {
      id: "sourceEvent",
      title: "Source Event",
      eyebrow: "02",
      state: "resolved",
      summary:
        "Raw source row that generated the issue: proxy traffic, shield scan, token row, or infra log.",
      artifactIds: ["source-traffic_demo_042"],
    },
    {
      id: "affectedObject",
      title: "Affected Object",
      eyebrow: "03",
      state: "resolved",
      summary:
        "The thing impacted: agent, session, model, provider, rule, tool, service, operator, or API key.",
      artifactIds: ["object-demo-session-82f"],
    },
    {
      id: "relatedActivity",
      title: "Related Activity",
      eyebrow: "04",
      state: "resolved",
      summary:
        "Show everything like this by same rule, source, token, model, session, and time window.",
      artifactIds: ["related-same-rule-24h"],
    },
    {
      id: "fixControl",
      title: "Fix / Control",
      eyebrow: "05",
      state: "resolved",
      summary:
        "Where the operator can act: suppress similar, rule config, routing, RBAC, pricing, or tools.",
      artifactIds: ["fix-policies-and-rules", "rule-dlp-phone-us"],
    },
  ],

  // ------------------------------------------------------------------
  // Artifacts — 6 total, each linked to exactly one stage via stageId.
  // ------------------------------------------------------------------
  artifacts: [
    // ----------------------------------------------------------------
    // 1. Evidence row (Audit & Evidence)
    // ----------------------------------------------------------------
    {
      id: "evidence-EVD-042",
      stageId: "evidence",
      label: "Evidence · EVD-042",
      shortLabel: "EVD-042",
      kind: "evidence",
      state: "resolved",
      confidence: "exact",
      previewTitle: "Audit & Evidence · EVD-042",
      previewSummary:
        "Exact match by audit_event_id. Sample/snippet/raw redacted in this card; full content available in Audit & Evidence under RBAC.",
      previewFields: [
        { label: "audit_event_id",    value: "EVD-042" },
        { label: "rule_key",          value: "OUT-PII-PHONE_US" },
        { label: "verdict",           value: "REVIEW",                     tone: "warn" },
        { label: "score",             value: "9 / 10" },
        { label: "correlation_method",value: "forward",                    tone: "good" },
        { label: "match",             value: "1 detection · sample redacted", tone: "muted" },
      ],
      primaryAction: {
        tab: "auditEvidence",
        opts: { id: "EVD-042", highlight: "EVD-042" },
        label: "Open in Audit & Evidence",
      },
      lastResolvedAt: FIXED_TIMESTAMP,
    },

    // ----------------------------------------------------------------
    // 2. Source event (Traffic Monitor)
    // ----------------------------------------------------------------
    {
      id: "source-traffic_demo_042",
      stageId: "sourceEvent",
      label: "Source · traffic_demo_042",
      shortLabel: "traffic_demo_042",
      kind: "source",
      state: "resolved",
      confidence: "exact",
      previewTitle: "Traffic Monitor · traffic_demo_042",
      previewSummary:
        "Proxy-traffic row that generated the alert. Raw request/response bodies remain in Traffic Monitor under RBAC.",
      previewFields: [
        { label: "proxy_traffic_id", value: "traffic_demo_042" },
        { label: "model",            value: "gpt-demo-5" },
        { label: "provider",         value: "openrouter" },
        { label: "prompt_hash",      value: "ph_demo_9a31" },
        { label: "direction",        value: "outbound" },
        { label: "session_id",       value: "demo-session-82f" },
      ],
      primaryAction: {
        tab: "trafficMonitor",
        opts: { filter: { q: "ph_demo_9a31" }, highlight: "traffic_demo_042" },
        label: "Open in Traffic Monitor",
      },
    },

    // ----------------------------------------------------------------
    // 3. Affected object (Agents & Sessions)
    // ----------------------------------------------------------------
    {
      id: "object-demo-session-82f",
      stageId: "affectedObject",
      label: "Object · demo-session-82f",
      shortLabel: "session-82f",
      kind: "object",
      state: "resolved",
      confidence: "exact",
      previewTitle: "Agents & Sessions · demo-session-82f",
      previewSummary:
        "Session impacted by the issue. Operator can drill in to inspect agent, model, and recent activity.",
      previewFields: [
        { label: "session_id", value: "demo-session-82f" },
        { label: "agent",      value: "demo-research-agent" },
        { label: "model",      value: "gpt-demo-5" },
        { label: "status",     value: "active", tone: "good" },
      ],
      primaryAction: {
        tab: "agents",
        opts: { id: "demo-session-82f" },
        label: "Open in Agents & Sessions",
      },
    },

    // ----------------------------------------------------------------
    // 4. Related activity (Alerts · same rule · 24h)
    // ----------------------------------------------------------------
    {
      id: "related-same-rule-24h",
      stageId: "relatedActivity",
      label: "Related · same rule · 24h",
      shortLabel: "same rule · 24h",
      kind: "related",
      state: "derived",
      confidence: "high",
      previewTitle: "Alerts · same rule · last 24h",
      previewSummary:
        "Other alerts matching OUT-PII-PHONE_US in the last 24 hours. Use this to gauge pattern prevalence and blast radius.",
      previewFields: [
        { label: "rule_key",    value: "OUT-PII-PHONE_US" },
        { label: "window",      value: "last 24h" },
        { label: "count (demo)", value: "12" },
        { label: "confidence",  value: "high (rule_key match)", tone: "good" },
      ],
      primaryAction: {
        tab: "alertsIncidents",
        opts: { filter: { q: "OUT-PII-PHONE_US" } },
        label: "Open Alerts · 24h",
      },
    },

    // ----------------------------------------------------------------
    // 5. Fix surface (Policies & Rules — canonical control point)
    // ----------------------------------------------------------------
    {
      id: "fix-policies-and-rules",
      stageId: "fixControl",
      label: "Fix · Policies & Rules",
      shortLabel: "Policies & Rules",
      kind: "fix",
      state: "resolved",
      confidence: "exact",
      previewTitle: "Configuration · Policies & Rules",
      previewSummary:
        "Suppress similar matches, tune the rule, or escalate. The Policies & Rules surface is the canonical control point for OUT-PII-PHONE_US.",
      previewFields: [
        { label: "target",           value: "Configuration → Policies & Rules" },
        { label: "control",          value: "OUT-PII-PHONE_US" },
        { label: "suggested_action", value: "Tune detection threshold or add allowlist entry" },
        { label: "permission",       value: "policies:write" },
      ],
      primaryAction: {
        tab: "configuration",
        opts: { focus: "policiesAndRules", filter: { q: "OUT-PII-PHONE_US" } },
        label: "Open Policies & Rules",
      },
      permission: "policies:write",
    },

    // ----------------------------------------------------------------
    // 6. Rule definition (OUT-PII-PHONE_US — also on fixControl stage)
    // ----------------------------------------------------------------
    {
      id: "rule-dlp-phone-us",
      stageId: "fixControl",
      label: "Rule · OUT-PII-PHONE_US",
      shortLabel: "OUT-PII-PHONE_US",
      kind: "rule",
      state: "resolved",
      confidence: "exact",
      previewTitle: "Rule · OUT-PII-PHONE_US",
      previewSummary:
        "Policy-framework PII pattern detector for US phone numbers. Triggers REVIEW verdicts. Tunable via clone-then-customize in Policies & Rules.",
      previewFields: [
        { label: "rule_key",       value: "OUT-PII-PHONE_US" },
        { label: "policy_name",    value: "Generic Egress Starter" },
        { label: "policy_source",  value: "system" },
        { label: "action",         value: "score" },
        { label: "category",       value: "outbound-leak" },
        { label: "verdict_on_match", value: "REVIEW", tone: "warn" },
        { label: "shipped_in",     value: "Generic Egress Starter (system policy; wire-active outbound DLP starter)" },
      ],
      primaryAction: {
        tab: "configuration",
        opts: { focus: "policiesAndRules", filter: { q: "OUT-PII-PHONE_US" } },
        label: "Open in Policies & Rules",
      },
    },
  ],

  defaultArtifactId: "evidence-EVD-042",
  generatedAt: FIXED_TIMESTAMP,
  resolverVersion: "fixture-v1",
};
