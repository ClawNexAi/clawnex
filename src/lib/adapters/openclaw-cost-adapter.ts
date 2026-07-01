// src/lib/adapters/openclaw-cost-adapter.ts
/**
 * OpenClaw Cost Adapter — read-only walk of ~/.openclaw/agents/<agentId>/sessions/*.jsonl
 * emitting canonical NormalizedRow values.
 *
 * PRIVACY GUARANTEE (load-bearing):
 *   This adapter ONLY reads `usage.*`, `model`, `provider`, `timestamp`, `stopReason`,
 *   `responseId`, `parentId`, and message `id` from the JSONL. It does NOT read
 *   conversation content (the forbidden member paths in the verify script). Enforced
 *   by scripts/verify-openclaw-cost-adapter.ts.
 *
 *   The adapter exposes `signal_context.stopReasonByRowId` on the AdapterResult.
 *   `stopReason` is enumerated metadata (e.g. 'stop', 'toolUse'), not conversation
 *   content — safe to expose. The orchestrator forwards it to the loop_risk
 *   detector via DetectOpts and strips it before returning the public CostReport.
 *
 * Spec: docs/superpowers/specs/2026-05-04-token-cost-finops-reporting-design.md
 */

import { closeSync, constants, existsSync, fstatSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOpenClawPaths } from '@/lib/openclaw-paths';
import type { NormalizedRow, AdapterResult, AdapterWarning } from '@/lib/types/cost-reporting';

interface ReadOpts {
  sinceMs?: number;
  /** Test override; production resolves via resolveOpenClawPaths() */
  openclawRoot?: string;
}

export const openClawCostAdapter = {
  async read(opts: ReadOpts = {}): Promise<AdapterResult> {
    const startedAt = new Date().toISOString();
    const warnings: AdapterWarning[] = [];
    let parseErrors = 0;

    try {
      const root = opts.openclawRoot ?? resolveOpenClawPaths().home;
      if (!root) {
        return { source: 'openclaw', rows: [], warnings, fetched_at: startedAt };
      }
      const agentsDir = join(root, 'agents');
      if (!existsSync(agentsDir)) {
        return { source: 'openclaw', rows: [], warnings, fetched_at: startedAt };
      }

      const rows: NormalizedRow[] = [];
      const sinceMs = opts.sinceMs ?? 0;

      // Adapter-private side-channel: row_id → raw msg.stopReason (e.g. 'stop',
      // 'toolUse'). Consumed by the loop_risk detector via DetectOpts. The
      // value is enumerated metadata only — never conversation content. Built
      // here, returned via AdapterResult.signal_context, stripped by the
      // orchestrator before the public CostReport is returned.
      const stopReasonByRowId: Record<string, string | null> = {};

      const agentDirs = readdirSync(agentsDir);
      for (const agentName of agentDirs) {
        const sessionsDir = join(agentsDir, agentName, 'sessions');
        if (!existsSync(sessionsDir)) continue;
        const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
        for (const file of files) {
          const filePath = join(sessionsDir, file);
          let fd: number | null = null;
          let content = '';
          try {
            fd = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            const stat = fstatSync(fd);
            if (!stat.isFile() || stat.mtimeMs < sinceMs) continue;
            content = readFileSync(fd, 'utf8');
          } finally {
            if (fd !== null) closeSync(fd);
          }
          const sessionFileSansJsonl = file.slice(0, -'.jsonl'.length);
          const lines = content.split('\n').filter(Boolean);
          for (let i = 0; i < lines.length; i++) {
            try {
              const entry = JSON.parse(lines[i]);
              if (entry.type !== 'message') continue;
              const msg = entry.message;
              if (!msg || typeof msg !== 'object') continue;
              const usage = msg.usage;
              if (!usage || typeof usage !== 'object') continue;

              const entryKey = entry.id ?? msg.responseId ?? `${entry.timestamp}-${i}`;
              const sessionId = `openclaw:${agentName}:${sessionFileSansJsonl}`;
              const rowId = `openclaw:${agentName}:${sessionFileSansJsonl}:${entryKey}`;

              const safe = (v: unknown): number | null =>
                typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

              const stopReason = typeof msg.stopReason === 'string' ? msg.stopReason : null;
              const tool_call_count =
                stopReason === 'stop' ? 0 : null; // toolUse → null, others → null

              // Record the raw stopReason for the loop_risk detector. We
              // record entries even when the value is null so the detector
              // can distinguish "row exists but has no stopReason" from "row
              // not present in the map". Only entries with a truthy string
              // get used for repeated-stop detection (the detector filters).
              stopReasonByRowId[rowId] = stopReason;

              rows.push({
                row_id: rowId,
                source: 'openclaw',
                provider: typeof msg.provider === 'string' ? msg.provider : null,
                model: typeof msg.model === 'string' ? msg.model : null,
                agent: agentName,
                session_id: sessionId,
                source_agent_id: null,
                timestamp: typeof entry.timestamp === 'string'
                  ? entry.timestamp
                  : new Date(entry.timestamp ?? Date.now()).toISOString(),
                input_tokens: safe(usage.input),
                output_tokens: safe(usage.output),
                cache_read_tokens: safe(usage.cacheRead),
                cache_write_tokens: safe(usage.cacheWrite),
                reasoning_tokens: null, // OpenClaw does not break out reasoning tokens
                tool_call_count,
                currency: 'USD',
                estimated_cost_usd: null, // v1 alpha
                actual_cost_usd: null, // v1 alpha
                recomputed_cost_usd: null, // orchestrator-owned
                cost_status: 'unknown', // orchestrator promotes per trust map after recompute pass
                estimated_cost_source: null,
                actual_cost_source: null,
                recomputed_cost_source: null,
                pricing_version: null,
                row_flags: [],
              });
            } catch (e) {
              parseErrors++;
            }
          }
        }
      }

      if (parseErrors > 0) {
        warnings.push({ kind: 'parse_error', count: parseErrors });
      }

      const result: AdapterResult = { source: 'openclaw', rows, warnings, fetched_at: startedAt };
      // Only attach the side-channel when we actually captured something —
      // matches the Hermes adapter pattern (omit empty maps).
      if (Object.keys(stopReasonByRowId).length > 0) {
        result.signal_context = { stopReasonByRowId };
      }
      return result;
    } catch (err) {
      return {
        source: 'openclaw',
        rows: [],
        warnings,
        error: err instanceof Error ? err.message : String(err),
        fetched_at: startedAt,
      };
    }
  },
};
