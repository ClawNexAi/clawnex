// src/lib/adapters/hermes-cost-adapter.ts
/**
 * Hermes Cost Adapter — read-only query of ~/.hermes/state.db sessions table.
 *
 * Emits canonical NormalizedRow per session. Hermes is FinOps-aware
 * (cost_status / cost_source / pricing_version columns), so the adapter
 * passes Hermes's own native flags through where useful (included, estimated)
 * and clamps the unverified 'actual' state to 'unknown' in v1 (orchestrator
 * resolves per trust map).
 *
 * IDENTITY (per spec + the reviewer's review):
 *   Hermes's `source` column carries channel/platform identity (e.g. 'cli',
 *   'telegram'), NOT agent identity. Mapping it onto the canonical `agent`
 *   field would mislead CostByAgent aggregations. v1: agent=null.
 *
 * PRIVACY (load-bearing — Gate B):
 *   - system_prompt IS read by the adapter (it is in the SQL SELECT projection)
 *     SOLELY for in-memory sha-256 hashing via hashSystemPrompt(). Plaintext
 *     never leaves the adapter scope: it is not assigned to any NormalizedRow
 *     field, not propagated to AdapterResult.rows, not logged, not persisted.
 *   - The hash is exposed via the adapter-owned private side-channel
 *     `result.signal_context.systemPromptHashByRowId` (row_id → 16-char hex
 *     digest). This map carries hashes ONLY — never plaintext. The orchestrator
 *     forwards it to detectLoopRisk and strips it before returning the public
 *     CostReport. It is never serialized through /api/tokens.
 *   - hashSystemPrompt() is exported as an in-memory helper (sha-256 → 16
 *     chars). It performs no fs / db writes. The verify script asserts that
 *     JSON.stringify(adapter result) does not contain the plaintext.
 *
 * COST-STATUS MAPPING (v1 alpha — option α, Hermes adapter unverified):
 *   - cost_status='included'                                    → included
 *       actual_cost_usd=0, actual_cost_source='hermes_state'
 *   - cost_status='estimated' AND cost_source LIKE '%provider%'
 *       AND estimated_cost_usd > 0                              → estimated
 *       estimated_cost_usd populated, estimated_cost_source='hermes_state'
 *   - cost_status='actual' (any cost_source, any value)         → unknown
 *       (orchestrator handles eventual upgrade in v1.1)
 *   - everything else                                            → unknown
 *
 * PROVIDER DERIVATION (deterministic only):
 *   billing_provider if present, else `model.split('/')[0]` when model has a
 *   '<prefix>/<rest>' shape, else null. No fuzzy matching.
 *
 * Spec: docs/superpowers/specs/2026-05-04-token-cost-finops-reporting-design.md
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { NormalizedRow, AdapterResult, AdapterWarning } from '@/lib/types/cost-reporting';

interface ReadOpts {
  /** Lower-bound on session started_at (ms epoch). 0 = read all. */
  sinceMs?: number;
  /** Test override; production resolves to ~/.hermes/state.db */
  hermesDbPath?: string;
}

interface HermesSessionRow {
  id: string;
  source: string | null;
  model: string | null;
  started_at: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  tool_call_count: number | null;
  cost_status: string | null;
  cost_source: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  billing_provider: string | null;
  /** Read for in-memory hashing only. NEVER propagates to NormalizedRow. */
  system_prompt: string | null;
}

export const hermesCostAdapter = {
  async read(opts: ReadOpts = {}): Promise<AdapterResult> {
    const startedAt = new Date().toISOString();
    const warnings: AdapterWarning[] = [];
    const dbPath = opts.hermesDbPath ?? join(homedir(), '.hermes', 'state.db');

    // No state.db yet (e.g. fresh install) is a normal "source unavailable"
    // condition — return cleanly so the orchestrator can mark sourceStatus.
    if (!existsSync(dbPath)) {
      return { source: 'hermes', rows: [], warnings, fetched_at: startedAt };
    }

    try {
      const db = new Database(dbPath, { readonly: true });
      // started_at is unix seconds in Hermes; convert ms → s for the bound.
      const sinceSec = (opts.sinceMs ?? 0) / 1000;

      const hermesRows = db.prepare(`
        SELECT id, source, model, started_at,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
               tool_call_count, cost_status, cost_source,
               estimated_cost_usd, actual_cost_usd, billing_provider,
               system_prompt
        FROM sessions
        WHERE started_at >= ?
      `).all(sinceSec) as HermesSessionRow[];
      db.close();

      // Adapter-private side-channel: row_id → sha-256(system_prompt) hash.
      // Populated here, returned via AdapterResult.signal_context, consumed by
      // detectLoopRisk. Plaintext is read into the local `r.system_prompt`
      // closure variable below, hashed, and discarded — never assigned onto a
      // NormalizedRow.
      const systemPromptHashByRowId: Record<string, string> = {};

      const rows: NormalizedRow[] = hermesRows.map((r): NormalizedRow => {
        const row_id = `hermes:${r.id}`;

        // Hash system_prompt for the loop_risk detector side-channel. The
        // plaintext stays in this closure scope; only the digest escapes.
        // Skip null / empty prompts (hashSystemPrompt returns null for them).
        const promptHash = hashSystemPrompt(r.system_prompt);
        if (promptHash) {
          systemPromptHashByRowId[row_id] = promptHash;
        }

        // Provider derivation — deterministic. Anything fuzzier belongs in the
        // pricing waterfall, not the adapter.
        let provider: string | null = r.billing_provider ?? null;
        if (!provider && r.model && r.model.includes('/')) {
          provider = r.model.split('/')[0];
        }

        // cost_status mapping per spec's trust map. Orchestrator may demote
        // further on the recompute pass.
        let cost_status: NormalizedRow['cost_status'] = 'unknown';
        let actual_cost_usd: number | null = null;
        let actual_cost_source: NormalizedRow['actual_cost_source'] = null;
        let estimated_cost_usd: number | null = null;
        let estimated_cost_source: NormalizedRow['estimated_cost_source'] = null;

        if (r.cost_status === 'included') {
          // Source-native subscription marker. No fuzzy matching needed.
          cost_status = 'included';
          actual_cost_usd = 0;
          actual_cost_source = 'hermes_state';
        } else if (
          r.cost_status === 'estimated' &&
          (r.cost_source ?? '').includes('provider') &&
          r.estimated_cost_usd != null && r.estimated_cost_usd > 0
        ) {
          cost_status = 'estimated';
          estimated_cost_usd = r.estimated_cost_usd;
          estimated_cost_source = 'hermes_state';
        } else if (r.cost_status === 'actual') {
          // v1 alpha: Hermes adapter unverified. Clamp to 'unknown' so the
          // orchestrator's trust map can resolve consistently. v1.1 audit
          // will lift this to a verified path.
          cost_status = 'unknown';
        } else {
          cost_status = 'unknown';
        }

        return {
          row_id,
          source: 'hermes',
          provider,
          model: r.model,
          // Hermes 'source' is channel (cli / telegram), not agent. v1: null.
          agent: null,
          session_id: r.id,
          // Hermes has no separate "raw agent id" stream distinct from `source`.
          source_agent_id: null,
          timestamp: new Date(r.started_at * 1000).toISOString(),
          input_tokens: r.input_tokens,
          output_tokens: r.output_tokens,
          cache_read_tokens: r.cache_read_tokens,
          cache_write_tokens: r.cache_write_tokens,
          reasoning_tokens: r.reasoning_tokens,
          // Native column — deterministic; never inferred.
          tool_call_count: r.tool_call_count,
          currency: 'USD',
          estimated_cost_usd,
          actual_cost_usd,
          recomputed_cost_usd: null,
          cost_status,
          estimated_cost_source,
          actual_cost_source,
          recomputed_cost_source: null,
          pricing_version: null,
          row_flags: [],
        };
      });

      const result: AdapterResult = { source: 'hermes', rows, warnings, fetched_at: startedAt };
      // Only attach the side-channel when at least one prompt was hashed —
      // empty maps would still be private but omitting keeps the result clean.
      if (Object.keys(systemPromptHashByRowId).length > 0) {
        result.signal_context = { systemPromptHashByRowId };
      }
      return result;
    } catch (err) {
      return {
        source: 'hermes',
        rows: [],
        warnings,
        error: err instanceof Error ? err.message : String(err),
        fetched_at: startedAt,
      };
    }
  },
};

/**
 * In-memory hash of a system_prompt string. Used by the orchestrator's
 * loop_risk detector (Task 7) to fingerprint repeated prompts WITHOUT
 * persisting plaintext.
 *
 * - sha-256 → 16 hex chars (collision-safe enough for prompt-equality tests
 *   inside a single report window; not a cryptographic identifier).
 * - Pure: no fs, no db, no console output. Plaintext never leaves the call.
 * - Returns null when text is null / undefined / empty.
 */
export function hashSystemPrompt(text: string | null | undefined): string | null {
  if (!text) return null;
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
