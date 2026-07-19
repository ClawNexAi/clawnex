/**
 * Shared type definitions for the ClawNex / Sentinel dashboard.
 *
 * These types are used by the main orchestrator (SentinelDashboard) and
 * shared across multiple panel components. Panel-specific types that are
 * only consumed within a single panel should remain co-located with that
 * panel's source file.
 */

import type {
  NormalizedRow,
  Signal,
  AdapterWarning,
  Source,
  PerSourceTotal,
  SourceStatus,
} from '@/lib/types/cost-reporting';
import type { TelemetryValue } from '@/lib/telemetry/value';

// ---------------------------------------------------------------------------
// Tab / Navigation
// ---------------------------------------------------------------------------

export type TabId =
  | "missionControl"
  | "fleet"
  | "instance"
  | "correlations"
  | "blastRadius"
  | "securityPosture"
  | "trustAudit"
  | "shield"
  | "shieldTests"
  | "accessControl"
  | "agents"
  | "workspace"
  | "tokenCost"
  | "toolsAccess"
  | "modelsCost"
  | "infrastructure"
  | "alertsIncidents"
  | "auditEvidence"
  | "executiveReports"
  | "accessLists"
  | "trafficMonitor"
  | "governance"
  | "riskAcceptance"
  | "configuration"
  | "help"
  | "about";

export interface NavItem {
  id: TabId;
  label: string;
  icon: string;
  group: string;
}

// ---------------------------------------------------------------------------
// Dashboard Filters
// ---------------------------------------------------------------------------

export interface DashboardFilters {
  timeRange: string;
  since: string;
  selectedInstance: string;
  selectedClient: string;
  selectedSeverity: string;
  productionOnly?: string;
}

// ---------------------------------------------------------------------------
// Health & Infrastructure
// ---------------------------------------------------------------------------

export interface HealthData {
  status: string;
  version: string;
  name: string;
  uptime: number;
  sseClients: number;
  timestamp: string;
}

export interface InfraData {
  system: {
    hostname: string;
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCores: number;
    cpuUsage: number;
    memTotal: string;
    memUsed: string;
    memUsage: number;
    uptime: string;
  };
  disk: Array<{
    filesystem: string;
    size: string;
    used: string;
    available: string;
    usePct: string;
    mount: string;
  }>;
  services: Array<{
    name: string;
    url: string;
    status: string;
    latency: number;
  }>;
}

// ---------------------------------------------------------------------------
// Shield
// ---------------------------------------------------------------------------

export interface ShieldResult {
  verdict: string;
  score: number;
  elapsed: string;
  cleaned?: string;
  profile?: { id: string; name: string };
  standards?: Array<{ framework: string; id: string; name: string; url: string }>;
  detections: Array<{
    id: string;
    name: string;
    category: string;
    severity: string;
    confidence: number;
    matchCount: number;
    standards?: Array<{ framework: string; id: string; name: string; url: string }>;
  }>;
  stats: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    categories: string[];
  };
}

export interface ShieldStats {
  total: number;
  blocked: number;
  reviewed: number;
  allowed: number;
  period: string;
}

export interface ShieldHistoryItem {
  id: string;
  direction: string;
  source_session_id: string | null;
  source_agent_id: string | null;
  content_hash: string;
  layers_triggered: string;
  threat_level: string;
  detail: string | null;
  scanned_at: string;
  score?: number;
}

// ---------------------------------------------------------------------------
// Alerts & Correlations
// ---------------------------------------------------------------------------

export interface AlertData {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  source: string;
  status: string;
  acknowledged_by: string | null;
  resolved_at: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Evidence backlink — alert → audit_log row → match-centered shield evidence.
// Returned by GET /api/alerts/:id/evidence. Surfaced inline under the alert
// card by AlertsIncidentsPanel and (in detail view) by AuditEvidencePanel.
// ---------------------------------------------------------------------------

export interface EvidenceMatchedSnippet {
  rule_key: string;
  name: string;
  severity: string;
  sample: string;
  snippet_before: string;
  snippet_match: string;
  snippet_after: string;
  match_found_in_excerpt: boolean;
}

export interface EvidenceShieldDetection {
  id: string;
  name: string;
  category: string;
  severity: string;
  confidence: number;
  matchCount: number;
  samples: string[];
  tags: string[];
  source: string;
  rule_key?: string;
  risk_context?: {
    why_risky: string;
    severity_basis: string;
    escalation_guidance: string;
    verification_step: string;
  };
}

export interface EvidencePayload {
  audit_event_id: string;
  audit_action: string;
  audit_created_at: string;
  session_id: string | null;
  agent_id?: string | null;
  direction: string | null;
  model: string | null;
  provider: string | null;
  verdict: string | null;
  score: number | null;
  detections: EvidenceShieldDetection[];
  matched_snippets: EvidenceMatchedSnippet[];
  payload_excerpt: string;
  payload_excerpt_truncated: boolean;
  payload_total_length: number | null;
  prompt_hash: string | null;
  proxy_traffic_id: string | null;
  shield_scan_id?: string | null;
  source_event_type?: "proxy_traffic" | "shield_scan" | null;
  correlation_method: "forward" | "fallback_nearest";
  alert: {
    id: string;
    title: string;
    severity: string;
    source: string;
    status: string;
    created_at: string;
  };
}

export interface CorrelationData {
  id: string;
  correlation_rule: string;
  source_events: string;
  source_events_parsed: Array<{
    id: string;
    source: string;
    type: string;
    session?: string;
    agent?: string;
    time: string;
  }>;
  event_count: number;
  description: string;
  severity: string;
  alert_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditData {
  id: string;
  actor: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: string | null;
  source: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Token & Cost
// ---------------------------------------------------------------------------

export interface TokenData {
  live: { sessions: number; agents: number; openclawConnected: boolean };
  aggregated24h: Array<{
    metric: string;
    total: number;
    average: number;
    min: number;
    max: number;
    samples: number;
  }>;
  recentSnapshots: Array<{
    source: string;
    metric_name: string;
    metric_value: number;
    recorded_at: string;
  }>;
  totalSnapshots: number;
  period: string;
  costByAgent?: Array<{
    agent: string;
    model: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  }>;
  defaultModel?: string;
  sessionLogs?: {
    byModel: Array<{
      model: string;
      totalInput: number;
      totalOutput: number;
      totalCacheRead: number;
      totalCacheWrite: number;
      totalTokens: number;
      totalCost: number;
      messageCount: number;
      costSource?: string;
    }>;
    byAgent?: Array<{
      agentId: string;
      totalTokens: number;
      totalCost: number;
      messageCount: number;
      sessionCount: number;
      models: Record<string, {
        totalInput: number;
        totalOutput: number;
        totalCacheRead: number;
        totalCacheWrite: number;
        totalTokens: number;
        totalCost: number;
        messageCount: number;
      }>;
    }>;
    totals: {
      totalTokens: number;
      totalCost: number;
      totalMessages: number;
      totalSessions: number;
      modelsUsed: number;
      agentsUsed?: number;
    };
    recentEntries: Array<{
      agentId?: string;
      model: string;
      totalTokens: number;
      costTotal: number;
      cost?: number;
      timestamp: string;
      sessionId: string;
    }>;
    scannedFiles: number;
    emptyAgents?: string[];
  } | null;

  // v1 FinOps reporting fields (additive — all optional during the migration window):
  rows?: NormalizedRow[];
  perSource?: Record<Source, PerSourceTotal>;
  headline?: { source: Source; total: number } | null;
  signals?: Signal[];
  warnings?: AdapterWarning[];
  sourceStatus?: Record<Source, SourceStatus>;
}

// ---------------------------------------------------------------------------
// Models & Agents
// ---------------------------------------------------------------------------

export interface ModelData {
  id: string;
  name: string;
  provider: string;
  source: string;
  routing: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface AgentData {
  id: string;
  name?: string;
  status?: string;
  model?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

export interface FleetInstance {
  id: string;
  client: string;
  version?: string;
  status: string;
  cpu: number | null;
  mem: number | null;
  disk?: number | null;
  threats: number | null;
  alerts?: number | null;
  agents: number | null;
  sessions?: number | null;
  storedSessions?: number | null;
  region: string;
  p95?: number | null;
  cost?: number | null;
  /** Posture score 0-100. `null` means "unscanned / no real data yet" — do NOT treat as 0 or 100. */
  posture?: number | null;
  uptime?: number;
  isLive?: boolean;
  telemetry?: {
    configuredAgents: TelemetryValue<number>;
    activeSessions: TelemetryValue<number>;
    storedSessions: TelemetryValue<number>;
    cpu: TelemetryValue<number>;
    memory: TelemetryValue<number>;
    disk: TelemetryValue<number>;
    threats: TelemetryValue<number>;
    alerts: TelemetryValue<number>;
    p95LatencyMs: TelemetryValue<number>;
    costUsd: TelemetryValue<number>;
  };
}
