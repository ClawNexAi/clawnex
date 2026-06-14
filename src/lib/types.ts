/**
 * ClawNex Core Types
 */

import type { PolicySource, RuleAction } from './shield/types';

// --- Fleet & Instances ---
export interface Instance {
  id: string;
  client: string;
  version: string;
  status: 'healthy' | 'degraded' | 'warning' | 'critical' | 'offline';
  uptime: number;
  cpu: number;
  mem: number;
  disk: number;
  threats: number;
  alerts: number;
  region: string;
  heartbeat: number;
  agents: number;
  sessions: number;
  p95: number;
  cost: number;
  posture: number;
}

// --- Agents ---
export interface Agent {
  id: string;
  instanceId: string;
  name: string;
  status: 'active' | 'idle' | 'paused' | 'error';
  model: string;
  sessions: number;
  denials: number;
  tools: number;
  lastSeen: string;
  risk: 'critical' | 'high' | 'medium' | 'low';
  tokenRate: number;
  tokenBaseline: number;
  tokensTotal: number;
  ctxUsage: number;
  cost24h: number;
  parentId: string | null;
  childIds: string[];
  skills: string[];
  toolPerms: string[];
}

export interface WorkspaceFile {
  name: string;
  content: string;
  modified: string;
  modifiedBy: string;
  baseline: boolean;
}

// --- Shield ---
export interface ShieldScanResult {
  verdict: 'BLOCK' | 'REVIEW' | 'ALLOW';
  score: number;
  elapsed: string;
  detections: ShieldDetection[];
  cleaned: string;
  stats: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    categories: string[];
  };
}

export interface ShieldDetection {
  id: string;
  name: string;
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  confidence: number;
  matchCount: number;
  samples: string[];
  tags: string[];
  source: 'clawnex' | 'defenseclaw' | 'access-list' | 'policy-system' | 'policy-custom';
  // Policy Framework v1 — present when emitted from the policy evaluator
  policy_id?: string;
  policy_name?: string;
  policy_source?: Exclude<PolicySource, 'curated'>;
  policy_rule_id?: string;
  rule_key?: string;
  action?: RuleAction;
}

// --- Alerts ---
export interface Alert {
  id: string;
  title: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  source: string;
  sourceEventId?: string;
  status: 'open' | 'acknowledged' | 'investigating' | 'mitigated' | 'resolved' | 'false_positive';
  assignee?: string;
  sla: number;
  evidence: number;
  correlationId?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Correlations ---
export interface Correlation {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  summary: string;
  events: CorrelationEvent[];
  recommendation: string;
  modules: string[];
}

export interface CorrelationEvent {
  timestamp: string;
  description: string;
  module: string;
}

// --- Token Intelligence ---
export interface TokenAlert {
  id: string;
  agentName: string;
  instanceId: string;
  type: 'RUNAWAY' | 'ELEVATED' | 'NORMAL+';
  rate: number;
  baseline: number;
  ratio: string;
  tokens24h: string;
  cost: string;
  status: 'active' | 'watching' | 'normal';
  detail: string;
}

// --- Models ---
export interface ModelInfo {
  name: string;
  provider: string;
  routing: 'Cloud' | 'Local';
  calls: number;
  p95: number;
  cost: number;
  share: number;
  risk: string;
  source: string;
}

// --- Security ---
export interface HardeningCheck {
  id: string;
  tier: 1 | 2 | 3;
  category: string;
  label: string;
  pass: boolean | null;
  detail: string;
  failingInstances?: string[];
  source: 'clawkeeper' | 'clawnex' | 'manual';
}

export interface SecurityScan {
  id: string;
  scanner: string;
  overallGrade: string;
  overallScore: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  scannedAt: string;
}

// --- Audit ---
export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  result: string;
  evidenceId: string;
  source: string;
}

// --- Maintenance ---
export interface MaintenanceItem {
  id: string;
  frequency: 'weekly' | 'monthly' | 'quarterly';
  label: string;
  tier: 1 | 2 | 3;
  reference: string;
  description: string;
  isAutomated: boolean;
  lastCompletedAt?: string;
  status: 'pending' | 'completed' | 'overdue' | 'skipped';
}

// --- Service Health ---
export interface ServiceHealth {
  name: string;
  url: string;
  status: 'online' | 'degraded' | 'offline';
  latency: number;
  lastChecked: string;
  version?: string;
}
