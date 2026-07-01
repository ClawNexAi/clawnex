/**
 * Hermes Token Reader — on-demand query of Hermes sessions for token/cost aggregation.
 *
 * Reads from Hermes state.db sessions table to aggregate token usage and costs.
 * Cost resolution follows a waterfall:
 *   1. If cost_status === 'actual' and actual_cost_usd > 0 → use directly
 *   2. If estimated_cost_usd > 0 and cost_source includes 'provider' or 'official' → use estimated
 *   3. Fallback: computeCost(model, { input, output, cacheRead })
 *
 * Agent IDs use format 'hermes:<platform>' (e.g., 'hermes:cli', 'hermes:telegram').
 *
 * READ-ONLY access to ~/.hermes/state.db.
 *
 * @module services/hermes-token-reader
 */

import { getHermesDb, isHermesAvailable } from './hermes-db';
import { computeCost } from './model-pricing';
import { costStatusFromSource, unknownRowsForStatus } from './token-cost-quality';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HermesModelAggregation {
  model: string;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  costSource?: string;
  unpricedRows?: number;
}

export interface HermesAgentAggregation {
  agentId: string;
  models: HermesModelAggregation[];
  totalTokens: number;
  totalCost: number;
  messageCount: number;
}

export interface HermesTokenResult {
  byModel: HermesModelAggregation[];
  byAgent: HermesAgentAggregation[];
  totals: {
    totalTokens: number;
    totalCost: number;
    totalMessages: number;
    totalSessions: number;
  };
  scannedSessions: number;
}

// ---------------------------------------------------------------------------
// Session row from Hermes state.db
// ---------------------------------------------------------------------------

interface HermesSessionRow {
  id: string;
  source: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_status: string | null;
  actual_cost_usd: number | null;
  estimated_cost_usd: number | null;
  cost_source: string | null;
  message_count: number | null;
}

// ---------------------------------------------------------------------------
// Core reader
// ---------------------------------------------------------------------------

/**
 * Read Hermes token usage since a given ISO timestamp or unix seconds.
 * Returns null if Hermes is unavailable.
 */
export function readHermesTokenUsage(since: string | number): HermesTokenResult | null {
  if (!isHermesAvailable()) return null;
  const db = getHermesDb();
  if (!db) return null;

  // Convert ISO string to unix seconds for Hermes (started_at is unix epoch seconds)
  let sinceUnix: number;
  if (typeof since === 'string') {
    sinceUnix = Math.floor(new Date(since).getTime() / 1000);
  } else {
    sinceUnix = since;
  }

  let rows: HermesSessionRow[];
  try {
    rows = db.prepare(
      `SELECT id, source, model,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
              cost_status, actual_cost_usd, estimated_cost_usd, cost_source,
              message_count
       FROM sessions
       WHERE started_at >= ?`
    ).all(sinceUnix) as HermesSessionRow[];
  } catch (err) {
    console.error('[HermesTokenReader] Query error:', err);
    return null;
  }

  // Aggregation maps
  const modelMap = new Map<string, HermesModelAggregation>();
  const agentModelMap = new Map<string, Map<string, HermesModelAggregation>>();

  let totalTokens = 0;
  let totalCost = 0;
  let totalMessages = 0;

  for (const row of rows) {
    const model = row.model || 'unknown';
    const platform = row.source || 'unknown';
    const agentId = `hermes:${platform}`;

    const input = row.input_tokens ?? 0;
    const output = row.output_tokens ?? 0;
    const cacheRead = row.cache_read_tokens ?? 0;
    const cacheWrite = row.cache_write_tokens ?? 0;
    const tokens = input + output + cacheRead;
    const msgCount = row.message_count ?? 1;

    // Resolve cost via waterfall
    let cost = 0;
    let costSource = 'computed';

    if (row.cost_status === 'actual' && row.actual_cost_usd != null && row.actual_cost_usd > 0) {
      cost = row.actual_cost_usd;
      costSource = 'actual';
    } else if (
      row.estimated_cost_usd != null && row.estimated_cost_usd > 0 &&
      row.cost_source && (row.cost_source.includes('provider') || row.cost_source.includes('official'))
    ) {
      cost = row.estimated_cost_usd;
      costSource = 'estimated';
    } else {
      const result = computeCost(model, { input, output, cacheRead });
      cost = result.cost;
      costSource = result.rate?.source || 'default';
    }
    const rowUnpricedRows = unknownRowsForStatus(costStatusFromSource(costSource), msgCount);

    totalTokens += tokens;
    totalCost += cost;
    totalMessages += msgCount;

    // Aggregate by model
    let modelAgg = modelMap.get(model);
    if (!modelAgg) {
      modelAgg = { model, totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheWrite: 0, totalTokens: 0, totalCost: 0, messageCount: 0, costSource, unpricedRows: 0 };
      modelMap.set(model, modelAgg);
    }
    modelAgg.totalInput += input;
    modelAgg.totalOutput += output;
    modelAgg.totalCacheRead += cacheRead;
    modelAgg.totalCacheWrite += cacheWrite;
    modelAgg.totalTokens += tokens;
    modelAgg.totalCost += cost;
    modelAgg.messageCount += msgCount;
    modelAgg.unpricedRows = (modelAgg.unpricedRows ?? 0) + rowUnpricedRows;
    modelAgg.costSource = pickPrimarySource(modelAgg.costSource, costSource);

    // Aggregate by agent + model
    let agentModels = agentModelMap.get(agentId);
    if (!agentModels) {
      agentModels = new Map();
      agentModelMap.set(agentId, agentModels);
    }
    let agentModelAgg = agentModels.get(model);
    if (!agentModelAgg) {
      agentModelAgg = { model, totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheWrite: 0, totalTokens: 0, totalCost: 0, messageCount: 0, costSource, unpricedRows: 0 };
      agentModels.set(model, agentModelAgg);
    }
    agentModelAgg.totalInput += input;
    agentModelAgg.totalOutput += output;
    agentModelAgg.totalCacheRead += cacheRead;
    agentModelAgg.totalCacheWrite += cacheWrite;
    agentModelAgg.totalTokens += tokens;
    agentModelAgg.totalCost += cost;
    agentModelAgg.messageCount += msgCount;
    agentModelAgg.unpricedRows = (agentModelAgg.unpricedRows ?? 0) + rowUnpricedRows;
    agentModelAgg.costSource = pickPrimarySource(agentModelAgg.costSource, costSource);
  }

  // Build byAgent array
  const byAgent: HermesAgentAggregation[] = [];
  const agentKeys = Array.from(agentModelMap.keys());
  for (const agentId of agentKeys) {
    const models = agentModelMap.get(agentId)!;
    const modelList: HermesModelAggregation[] = Array.from(models.values());
    byAgent.push({
      agentId,
      models: modelList,
      totalTokens: modelList.reduce((s: number, m: HermesModelAggregation) => s + m.totalTokens, 0),
      totalCost: modelList.reduce((s: number, m: HermesModelAggregation) => s + m.totalCost, 0),
      messageCount: modelList.reduce((s: number, m: HermesModelAggregation) => s + m.messageCount, 0),
    });
  }

  return {
    byModel: Array.from(modelMap.values()),
    byAgent,
    totals: {
      totalTokens,
      totalCost,
      totalMessages,
      totalSessions: rows.length,
    },
    scannedSessions: rows.length,
  };
}

function pickPrimarySource(left: string | undefined, right: string | undefined): string | undefined {
  const rank = (source: string | undefined) => {
    if (source === 'actual') return 5;
    if (source === 'estimated') return 4;
    if (source === 'openclaw') return 3;
    if (source === 'litellm') return 2;
    if (source === 'fallback') return 1;
    if (source === 'default') return 0;
    return -1;
  };
  return rank(right) > rank(left) ? right : left;
}
