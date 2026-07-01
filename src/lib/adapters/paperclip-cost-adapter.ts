// src/lib/adapters/paperclip-cost-adapter.ts
/**
 * Paperclip Cost Adapter — HTTP read-only of /api/companies/:id/costs/finance-events.
 *
 * Curtailed ingestion per spec: only provider/model/tokens/cost/agent/timestamp/
 * estimated/subscription. Paperclip's project/issue/goal/budget/invoice fields
 * are NOT pulled (treated as a third cost-telemetry stream, not a separate
 * FinOps system).
 *
 * Identity: agent display = "<paperclipAgentName> (Paperclip)" (or UUID with
 * suffix if name unresolved). source_agent_id carries raw UUID. NEVER merge
 * Paperclip identities with OpenClaw/Hermes — the "(Paperclip)" suffix is
 * mandatory on every emitted row's `agent` field.
 *
 * COST-STATUS MAPPING (per spec §"Per-source cost-status mapping"):
 *   - metadataJson.subscriptionRun === true               → included
 *       actual_cost_usd=0, actual_cost_source='paperclip_finance_event'
 *       (overrides the estimated branch — subscription wins)
 *   - estimated=true (USD, no subscription marker)        → estimated
 *       estimated_cost_usd = amountCents/100,
 *       estimated_cost_source='paperclip_finance_event'
 *   - estimated=false, adapter unverified (default v1)    → unknown
 *       (orchestrator may demote to token_only via recompute path)
 *   - non-USD                                              → unknown +
 *       row_flags=['unsupported_currency'] + adapter warning
 *       (NEVER silently drop)
 *
 * SESSION: null. Paperclip finance events do not expose session.
 *
 * AUTH: Authorization: Bearer <apiKey>. If apiKey or companyId missing →
 * empty rows + no warnings (matches existing connector posture for
 * unconfigured Paperclip).
 *
 * FAILURE MODE: any throw or !ok response → return rows=[] with
 * source_unavailable warning + error string. Never throws to caller.
 *
 * Test injection: optional `fetcher` so verify scripts can mock without
 * touching globalThis.fetch.
 *
 * Spec: docs/superpowers/specs/2026-05-04-token-cost-finops-reporting-design.md
 */

import { config } from '@/lib/config';
import type { NormalizedRow, AdapterResult, AdapterWarning } from '@/lib/types/cost-reporting';

interface ReadOpts {
  baseUrl?: string;
  apiKey?: string;
  companyId?: string;
  sinceMs?: number;
  /** Test-only injection */
  fetcher?: typeof fetch;
}

interface FinanceEvent {
  id: string;
  companyId: string;
  agentId?: string | null;
  provider?: string | null;
  model?: string | null;
  quantity?: number | null;
  unit?: string | null;
  amountCents: number;
  currency?: string | null;
  estimated?: boolean;
  occurredAt: string;
  metadataJson?: Record<string, unknown> | null;
}

interface PaperclipAgent {
  id: string;
  name?: string | null;
}

export const paperclipCostAdapter = {
  async read(opts: ReadOpts = {}): Promise<AdapterResult> {
    const startedAt = new Date().toISOString();
    const warnings: AdapterWarning[] = [];

    const baseUrl = opts.baseUrl ?? `${config.paperclip.url}/api`;
    const apiKey = opts.apiKey ?? config.paperclip.apiKey;
    const companyId = opts.companyId ?? config.paperclip.companyId;
    const fetcher = opts.fetcher ?? fetch;

    if (!apiKey || !companyId) {
      // Not configured — empty, no error (matches existing connector posture).
      return { source: 'paperclip', rows: [], warnings, fetched_at: startedAt };
    }

    try {
      const headers = { Authorization: `Bearer ${apiKey}` };

      // Fetch agents map for display labels FIRST so finance-events can be
      // resolved to "<name> (Paperclip)" labels in one pass.
      const agentRes = await fetcher(`${baseUrl}/companies/${companyId}/agents`, { headers });
      if (!agentRes.ok) throw new Error(`agents endpoint returned ${agentRes.status}`);
      const agentList = (await agentRes.json()) as PaperclipAgent[];
      const agentNameMap = new Map<string, string>();
      for (const a of agentList) {
        if (a.id && a.name) agentNameMap.set(a.id, a.name);
      }

      // Fetch finance events
      const evRes = await fetcher(`${baseUrl}/companies/${companyId}/costs/finance-events`, { headers });
      if (!evRes.ok) throw new Error(`finance-events returned ${evRes.status}`);
      const events = (await evRes.json()) as FinanceEvent[];

      let unsupportedCurrencyCount = 0;
      const rows: NormalizedRow[] = [];

      for (const e of events) {
        const isUSD = (e.currency ?? 'USD').toUpperCase() === 'USD';
        const meta = (e.metadataJson ?? {}) as Record<string, unknown>;
        const subscriptionMarker = meta.subscriptionRun === true;

        // Pull only the metadataJson fields the spec curtailed list allows.
        const inputTokens = typeof meta.inputTokens === 'number' ? meta.inputTokens : null;
        const outputTokens = typeof meta.outputTokens === 'number' ? meta.outputTokens : null;
        const toolCallCount = typeof meta.toolCallCount === 'number' ? meta.toolCallCount : null;

        // Display label per Paperclip agent display mapping rule.
        // Always carries the "(Paperclip)" suffix — NEVER identity-merge with
        // OpenClaw/Hermes. source_agent_id carries the raw UUID separately for
        // detail-panel cross-reference.
        const rawAgentId = e.agentId ?? null;
        const displayName = rawAgentId
          ? `${agentNameMap.get(rawAgentId) ?? rawAgentId} (Paperclip)`
          : null;

        // Determine cost_status + cost columns. Order matters: subscription
        // marker overrides the estimated branch.
        let cost_status: NormalizedRow['cost_status'] = 'unknown';
        let estimated_cost_usd: number | null = null;
        let actual_cost_usd: number | null = null;
        let estimated_cost_source: NormalizedRow['estimated_cost_source'] = null;
        let actual_cost_source: NormalizedRow['actual_cost_source'] = null;
        const row_flags: NormalizedRow['row_flags'] = [];

        if (!isUSD) {
          // Non-USD: emit row, all costs null, badge + warning. NEVER drop.
          row_flags.push('unsupported_currency');
          unsupportedCurrencyCount++;
          // cost_status stays 'unknown'
        } else if (subscriptionMarker) {
          // Subscription run wins over the estimated branch — Paperclip
          // emits a $0 included row even when estimated=false (or true).
          cost_status = 'included';
          actual_cost_usd = 0;
          actual_cost_source = 'paperclip_finance_event';
        } else if (e.estimated === true) {
          const estimatedUsd = e.amountCents / 100;
          if (Number.isFinite(estimatedUsd) && estimatedUsd >= 0) {
            cost_status = 'estimated';
            estimated_cost_usd = estimatedUsd;
            estimated_cost_source = 'paperclip_finance_event';
          } else {
            row_flags.push('invalid_cost');
            cost_status = 'unknown';
          }
        } else {
          // estimated=false, adapter unverified → unknown.
          // Orchestrator's enrichWithRecompute may promote to recomputed or
          // demote to token_only based on tokens + pricing match.
          cost_status = 'unknown';
        }

        rows.push({
          row_id: `paperclip:${e.id}`,
          source: 'paperclip',
          provider: e.provider ?? null,
          model: e.model ?? null,
          agent: displayName,
          session_id: null, // Paperclip finance events don't expose session
          source_agent_id: rawAgentId,
          timestamp: e.occurredAt,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: null,
          cache_write_tokens: null,
          reasoning_tokens: null,
          tool_call_count: toolCallCount,
          currency: e.currency ?? null,
          estimated_cost_usd,
          actual_cost_usd,
          recomputed_cost_usd: null,
          cost_status,
          estimated_cost_source,
          actual_cost_source,
          recomputed_cost_source: null,
          pricing_version: null,
          row_flags,
        });
      }

      if (unsupportedCurrencyCount > 0) {
        warnings.push({ kind: 'unsupported_currency', count: unsupportedCurrencyCount });
      }

      return { source: 'paperclip', rows, warnings, fetched_at: startedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        source: 'paperclip',
        rows: [],
        warnings: [{ kind: 'source_unavailable', count: 1, detail: message }],
        error: message,
        fetched_at: startedAt,
      };
    }
  },
};
