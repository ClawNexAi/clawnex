// src/lib/types/cost-reporting.ts
/**
 * Canonical types for the Token Cost FinOps Reporting v1 surface.
 *
 * Every cost-reporting adapter (OpenClaw, Hermes, Paperclip) emits NormalizedRow
 * values conforming to this shape. The orchestrator (`cost-reporting.ts`) enriches
 * rows with derived recompute and aggregates them. Five detectors emit Signal
 * records referencing rows by `row_id`.
 *
 * Spec: docs/superpowers/specs/2026-05-04-token-cost-finops-reporting-design.md
 */

// Source enum — three telemetry streams. recompute is a derived column, not a source.
export type Source = 'openclaw' | 'hermes' | 'paperclip';

// Cost-status enum — six values. The trust map in the spec drives assignment.
export type CostStatus = 'actual' | 'estimated' | 'recomputed' | 'included' | 'token_only' | 'unknown';

// Per-cost-column source labels. Each is null unless the corresponding cost is non-null.
export type EstimatedCostSource = 'hermes_state' | 'paperclip_finance_event';
export type ActualCostSource = 'hermes_state' | 'paperclip_finance_event' | 'openclaw_jsonl'; // openclaw_jsonl reserved for v1.1
export type RecomputedCostSource = 'clawnex_recompute';

// Closed enum for AdapterWarning.kind. Free text goes in `detail`, never `kind`.
export type AdapterWarningKind =
  | 'parse_error'
  | 'unsupported_currency'
  | 'partial_field'
  | 'rate_limit'
  | 'source_unavailable'
  | 'unknown_warning';

// Per-row flags. Ordered set; small, predefined values only.
export type RowFlag = 'unsupported_currency';

export type SourceStatus = 'ok' | 'unavailable';

export interface NormalizedRow {
  /** Stable, deterministic, unique-across-sources row identifier. See spec §"row_id semantics". */
  row_id: string;
  source: Source;
  provider: string | null;
  model: string | null;
  agent: string | null;
  session_id: string | null;
  /** Raw upstream agent identifier (Paperclip UUID); null when source has no separate raw id. */
  source_agent_id: string | null;
  timestamp: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  /** Deterministic only — null means unknown, do not infer. */
  tool_call_count: number | null;
  /** ISO 4217 (e.g. 'USD', 'EUR'). Null when source doesn't expose. */
  currency: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  /** Populated by orchestrator after adapter pass when math + non-default rate match. */
  recomputed_cost_usd: number | null;
  cost_status: CostStatus;
  estimated_cost_source: EstimatedCostSource | null;
  actual_cost_source: ActualCostSource | null;
  recomputed_cost_source: RecomputedCostSource | null;
  /** Snapshot tag; non-null only when recomputed_cost_usd is non-null AND a versioned source matched. */
  pricing_version: string | null;
  row_flags: RowFlag[];
}

export interface Signal {
  kind:
    | 'loop_risk'
    | 'velocity_spike'
    | 'context_bloat'
    | 'cache_drop'
    | 'cache_drop_risk'
    | 'simple_on_expensive';
  severity: 'warn' | 'high';
  affected_row_ids: string[];
  detail: string;
}

export interface AdapterWarning {
  kind: AdapterWarningKind;
  count: number;
  /** Free text only here; never in kind. */
  detail?: string;
}

export interface AdapterResult {
  source: Source;
  rows: NormalizedRow[];
  warnings: AdapterWarning[];
  error?: string;
  fetched_at: string;
  /**
   * ADAPTER-OWNED PRIVATE SIDE-CHANNEL for detector inputs that must NOT cross
   * the public API surface. The orchestrator forwards this to detectSignals
   * via DetectOpts and strips it before returning the public CostReport.
   * Never persisted. Never logged. Never serialized to API responses.
   */
  signal_context?: {
    /** Map of row_id → in-memory sha-256 hash of system_prompt. Populated only
     *  by the Hermes adapter. Hashes only — plaintext never leaves the adapter. */
    systemPromptHashByRowId?: Record<string, string>;
    /** Map of row_id → raw upstream stopReason enum (e.g. 'stop', 'toolUse').
     *  Populated only by the OpenClaw adapter and consumed by the loop_risk
     *  detector. Enumerated metadata only — never conversation content. */
    stopReasonByRowId?: Record<string, string | null>;
  };
}

export interface PerSourceTotal {
  count: number;
  totalUsd: number;
}

export interface CostReport {
  rows: NormalizedRow[];
  perSource: Record<Source, PerSourceTotal>;
  headline: { source: Source; total: number } | null;
  signals: Signal[];
  warnings: AdapterWarning[];
  sourceStatus: Record<Source, SourceStatus>;
}
