/**
 * Token & Cost Intel — single endpoint that the dashboard's per-agent and
 * per-session cost cards both consume.
 *
 * Two data sources have to be merged here, not in each card, because they
 * disagree about what they can attribute. Session JSONL logs know the agent
 * (parent dir) but only see OpenClaw-routed traffic. proxy_traffic rows from
 * LiteLLM see every routed call but lose the agent for direct-to-provider
 * sessions. Merging once per request keeps the two cards consistent and
 * means "Cost by Agent" and "Cost by Session" never disagree on totals for
 * traffic that overlaps both sources.
 *
 * Cost is always recomputed via the pricing service. The `usage.cost.*`
 * fields in newer OpenClaw / OpenRouter session JSONL are unreliable
 * (sometimes negative token deltas instead of dollar amounts), so trusting
 * them produces wrong dashboard totals; recomputing keeps the figures
 * honest regardless of upstream schema drift.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { queryAll, queryOne } from '@/lib/db/index';
import { getOpenClawConnector } from '@/lib/connectors/openclaw-connector';
import { readTokenUsage } from '@/lib/services/token-reader';
import { readHermesTokenUsage } from '@/lib/services/hermes-token-reader';
import { gatherCostRows } from '@/lib/services/cost-reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MetricRow {
  source: string;
  metric_name: string;
  metric_value: number;
  recorded_at: string;
}

interface AggRow {
  metric_name: string;
  total: number;
  avg_val: number;
  min_val: number;
  max_val: number;
  sample_count: number;
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'tokens:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const sinceParam = searchParams.get('since');
    const since24h = sinceParam || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const instance = searchParams.get('instance') || null;
    const isHermes = instance === 'hermes-local';
    const isOpenClaw = instance === 'openclaw-local' || (instance !== null && instance !== 'hermes-local');

    // Get recent metric snapshots
    const recentMetrics = queryAll<MetricRow>(
      `SELECT source, metric_name, metric_value, recorded_at
       FROM metric_snapshots
       WHERE recorded_at >= ?
       ORDER BY recorded_at DESC
       LIMIT 500`,
      [since24h],
    );

    // Get aggregated stats per metric
    const aggregated = queryAll<AggRow>(
      `SELECT metric_name,
              SUM(metric_value) as total,
              AVG(metric_value) as avg_val,
              MIN(metric_value) as min_val,
              MAX(metric_value) as max_val,
              COUNT(*) as sample_count
       FROM metric_snapshots
       WHERE recorded_at >= ?
       GROUP BY metric_name`,
      [since24h],
    );

    // Get total metric count all time
    const totalCount = queryOne<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM metric_snapshots',
      [],
    );

    // Get OpenClaw status for live session/agent counts
    const connector = getOpenClawConnector();
    const ocStatus = connector.getConnectionStatus();

    // Read real token usage from session logs across ALL agents (not just main).
    // The token-reader also computes cost via our pricing service — don't trust
    // usage.cost.* from the JSONL files because they're unreliable on newer routes.
    let sessionTokenData = null;
    if (!isHermes) {
      try {
        sessionTokenData = readTokenUsage(since24h, 500);
      } catch (err) {
        console.error('[API/tokens] Token reader error:', err);
      }
    }

    // Cost by agent — merge session-log-derived rows (real agent activity) with
    // proxy_traffic-derived rows (LiteLLM live traffic). On most installs the
    // session logs are the dominant source; proxy_traffic only has data when
    // providers are routed through the LiteLLM proxy.
    const costByAgent: Array<{
      agent: string;
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cost: number;
      source?: 'session' | 'proxy' | 'mixed';
    }> = [];

    // Cost by session — same two-source merge as costByAgent but rolled up by
    // sessionId instead of agent. Rows from proxy_traffic whose session_id
    // doesn't match any JSONL file get bucketed under `agent: 'unknown'` —
    // these are calls that bypassed OpenClaw routing (direct-to-Anthropic,
    // direct-to-OpenRouter, etc.). The unknown bucket is the operator's
    // signal that some traffic isn't traceable to an agent yet.
    const costBySession: Array<{
      sessionId: string;
      agent: string;
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cost: number;
      firstSeen?: string;
      lastSeen?: string;
      source: 'session' | 'proxy' | 'mixed';
    }> = [];

    // 1. Session-log-derived rows
    if (sessionTokenData && sessionTokenData.byAgent) {
      for (const agent of sessionTokenData.byAgent) {
        for (const [model, data] of Object.entries(agent.models)) {
          costByAgent.push({
            agent: agent.agentId,
            model,
            requests: data.messageCount,
            inputTokens: data.totalInput,
            outputTokens: data.totalOutput,
            totalTokens: data.totalTokens,
            cost: data.totalCost,
            source: 'session',
          });
        }
      }
    }

    // 1b. Session-log-derived per-session rows
    if (sessionTokenData && sessionTokenData.bySession) {
      for (const s of sessionTokenData.bySession) {
        for (const [model, data] of Object.entries(s.models)) {
          costBySession.push({
            sessionId: s.sessionId,
            agent: s.agentId,
            model,
            requests: data.messageCount,
            inputTokens: data.totalInput,
            outputTokens: data.totalOutput,
            totalTokens: data.totalTokens,
            cost: data.totalCost,
            firstSeen: s.firstSeen,
            lastSeen: s.lastSeen,
            source: 'session',
          });
        }
      }
    }

    // 2. proxy_traffic-derived rows (LiteLLM live) — map session_id → agent
    //    using the same fs walk readTokenUsage already performed (don't
    //    duplicate the per-request readdirSync; agents directory can be
    //    50+ entries on real fleets and walking it twice is wasted work).
    //    Skip when instance is hermes-local (proxy traffic is OpenClaw data).
    if (!isHermes) try {
      const sessionAgentMap: Record<string, string> = {};
      // Prefer-JSONL reconciliation: if a (session, model) pair already came in
      // via the JSONL pass, skip the proxy_traffic row for the same pair so we
      // don't double-count cost on OpenClaw-routed traffic. JSONL is the
      // canonical source (already cost-recomputed via the pricing service);
      // proxy_traffic is the fallback for sessions OpenClaw doesn't know about
      // (direct-to-Anthropic, direct-to-OpenRouter, etc.). Trade-off: proxy
      // rows for failed retries on OpenClaw-routed traffic get dropped. That's
      // a smaller honesty cost than the double-count.
      const jsonlSessionModelKeys = new Set<string>();
      if (sessionTokenData?.bySession) {
        for (const s of sessionTokenData.bySession) {
          sessionAgentMap[s.sessionId] = s.agentId;
          for (const model of Object.keys(s.models)) {
            jsonlSessionModelKeys.add(`${s.sessionId}:${model}`);
          }
        }
      }

      const rows = queryAll<{ session_id: string; model: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number; cost: number }>(
        `SELECT
          session_id,
          COALESCE(model, 'unknown') as model,
          COUNT(*) as requests,
          COALESCE(SUM(input_tokens), 0) as inputTokens,
          COALESCE(SUM(output_tokens), 0) as outputTokens,
          COALESCE(SUM(total_tokens), 0) as totalTokens,
          COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE 0 END), 0) as cost
        FROM proxy_traffic
        WHERE timestamp >= ? AND total_tokens > 0 AND session_id IS NOT NULL
        GROUP BY session_id, model
        ORDER BY cost DESC, totalTokens DESC`,
        [since24h]
      );

      for (const row of rows) {
        // Prefer-JSONL skip — same (session, model) was already accounted for
        // by the JSONL pass above. Skipping prevents the double-count.
        if (jsonlSessionModelKeys.has(`${row.session_id}:${row.model}`)) continue;
        const matchedAgent = sessionAgentMap[row.session_id];
        // For costByAgent we keep the legacy "Direct / API" bucket for unmatched
        // session_ids — that surface has shipped that label for a while and
        // operators are used to it. The per-session view introduces an
        // explicit "unknown" agent label whose tooltip covers the
        // direct-to-provider case in plain English.
        const agentForAgentRow = matchedAgent || "Direct / API";
        const agentForSessionRow = matchedAgent || "unknown";

        // Merge into an existing per-agent bucket from the session-log pass.
        const existingAgentRow = costByAgent.find(r => r.agent === agentForAgentRow && r.model === row.model);
        if (existingAgentRow) {
          existingAgentRow.requests += row.requests;
          existingAgentRow.inputTokens += row.inputTokens;
          existingAgentRow.outputTokens += row.outputTokens;
          existingAgentRow.totalTokens += row.totalTokens;
          existingAgentRow.cost += row.cost;
          existingAgentRow.source = 'mixed';
        } else {
          costByAgent.push({
            agent: agentForAgentRow,
            model: row.model,
            requests: row.requests,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            totalTokens: row.totalTokens,
            cost: row.cost,
            source: 'proxy',
          });
        }

        // Merge into an existing per-session bucket from the JSONL pass.
        const existingSessionRow = costBySession.find(r => r.sessionId === row.session_id && r.model === row.model);
        if (existingSessionRow) {
          existingSessionRow.requests += row.requests;
          existingSessionRow.inputTokens += row.inputTokens;
          existingSessionRow.outputTokens += row.outputTokens;
          existingSessionRow.totalTokens += row.totalTokens;
          existingSessionRow.cost += row.cost;
          existingSessionRow.source = 'mixed';
        } else {
          costBySession.push({
            sessionId: row.session_id,
            agent: agentForSessionRow,
            model: row.model,
            requests: row.requests,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            totalTokens: row.totalTokens,
            cost: row.cost,
            source: 'proxy',
          });
        }
      }
    } catch {}

    // Hermes-derived rows — skip when filtering to OpenClaw instances
    if (!isOpenClaw) try {
      const hermesData = readHermesTokenUsage(since24h);
      if (hermesData?.byAgent) {
        for (const agent of hermesData.byAgent) {
          for (const modelData of agent.models) {
            costByAgent.push({
              agent: agent.agentId,
              model: modelData.model,
              requests: modelData.messageCount,
              inputTokens: modelData.totalInput,
              outputTokens: modelData.totalOutput,
              totalTokens: modelData.totalTokens,
              cost: modelData.totalCost,
              source: 'session',
            });
          }
        }
      }
      if (hermesData && sessionTokenData) {
        for (const hm of hermesData.byModel) {
          const existing = sessionTokenData.byModel.find((m: { model: string }) => m.model === hm.model);
          if (existing) {
            existing.messageCount += hm.messageCount;
            existing.totalInput += hm.totalInput;
            existing.totalOutput += hm.totalOutput;
            existing.totalCacheRead += hm.totalCacheRead;
            existing.totalTokens += hm.totalTokens;
            existing.totalCost += hm.totalCost;
          } else {
            sessionTokenData.byModel.push({
              model: hm.model, messageCount: hm.messageCount, totalInput: hm.totalInput,
              totalOutput: hm.totalOutput, totalCacheRead: hm.totalCacheRead,
              totalCacheWrite: hm.totalCacheWrite || 0, totalTokens: hm.totalTokens, totalCost: hm.totalCost,
            });
          }
        }
        sessionTokenData.totals.totalTokens += hermesData.totals.totalTokens;
        sessionTokenData.totals.totalCost += hermesData.totals.totalCost;
        sessionTokenData.totals.totalMessages += hermesData.totals.totalMessages;
        sessionTokenData.totals.totalSessions += hermesData.totals.totalSessions;
      }
    } catch (err) { console.error('[API/tokens] Hermes token reader error:', err); }

    costByAgent.sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens);
    costBySession.sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens);

    // Get the configured default model for unsanctioned model detection
    let defaultModel = "";
    try {
      const defRow = queryOne<{ value: string }>("SELECT value FROM config_defaults WHERE key = 'default_model'");
      defaultModel = defRow?.value || "";
    } catch {}

    // Token Cost FinOps Reporting v1 — gather the new orchestrator-shaped
    // CostReport (rows + perSource + headline + signals + warnings +
    // sourceStatus). The orchestrator strips the detector side-channel at
    // the trust boundary; the response below MUST NOT introduce it from any
    // other path. Legacy fields above stay — panels migrate in Tasks 15-18.
    const sinceMs = Date.parse(since24h);
    // Forward the instance filter so the orchestrator path enforces the same
    // source/instance provenance the legacy reader path above already honors.
    // Without this, a `hermes-local` selection would still pull OpenClaw rows
    // through the new `rows`/`perSource` fields — the reviewer's Gate C blocker.
    const costReport = await gatherCostRows({
      sinceMs: Number.isFinite(sinceMs) ? sinceMs : Date.now() - 24 * 60 * 60 * 1000,
      instance: instance ?? undefined,
    });

    return NextResponse.json({
      live: {
        sessions: ocStatus.sessions,
        agents: ocStatus.agents,
        openclawConnected: ocStatus.connected,
      },
      aggregated24h: aggregated.map((a) => ({
        metric: a.metric_name,
        total: a.total,
        average: Math.round(a.avg_val * 100) / 100,
        min: a.min_val,
        max: a.max_val,
        samples: a.sample_count,
      })),
      recentSnapshots: recentMetrics.slice(0, 50),
      totalSnapshots: totalCount?.cnt ?? 0,
      sessionLogs: sessionTokenData ? {
        byModel: sessionTokenData.byModel,
        byAgent: sessionTokenData.byAgent,
        totals: sessionTokenData.totals,
        // `recentEntries` keeps both the new `cost` field and legacy `costTotal`
        // alias so the existing RecentTokenEventsFiltered consumer still renders.
        recentEntries: sessionTokenData.entries.slice(0, 20).map(e => ({
          agentId: e.agentId,
          model: e.model,
          totalTokens: e.totalTokens,
          cost: e.cost,
          costTotal: e.cost,
          timestamp: e.timestamp,
          sessionId: e.sessionId,
        })),
        scannedFiles: sessionTokenData.scannedFiles,
        emptyAgents: sessionTokenData.emptyAgents,
      } : null,
      costByAgent,
      costBySession,
      defaultModel,
      period: sinceParam ? 'custom' : '24h',
      timestamp: new Date().toISOString(),
      // Token Cost FinOps Reporting v1 — additive fields. Panels migrate
      // off the legacy fields above in Tasks 15-18; until then both shapes
      // ship side-by-side. The detector side-channel is intentionally not
      // present: CostReport's type does not declare it and the orchestrator
      // strips it at the trust boundary (see cost-reporting.ts).
      rows: costReport.rows,
      perSource: costReport.perSource,
      headline: costReport.headline,
      signals: costReport.signals,
      warnings: costReport.warnings,
      sourceStatus: costReport.sourceStatus,
    });
  } catch (err) {
    console.error('[API/tokens] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
