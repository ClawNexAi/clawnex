/**
 * ClawNex Token Reader — extracts real token usage from OpenClaw session logs.
 *
 * Scans every agent's session directory under `~/.openclaw/agents/<agentId>/sessions/*.jsonl`
 * (formerly only the `main` agent, which missed 95%+ of activity on multi-agent
 * installs like security reviewer's VC box on 2026-04-11). Each JSONL entry is attributed
 * to its owning agent by the parent directory name, so per-agent spend rolls up
 * correctly for the "Cost by Agent" card.
 *
 * READ-ONLY access. Only reads `usage` and `model` fields — never conversation content.
 * This is a privacy guarantee: the token reader does not access or store the actual
 * text of agent conversations.
 *
 * Dollar costs are computed by ClawNex itself via {@link computeCost} using the
 * bundled LiteLLM price table and any OpenClaw overrides — NOT by trusting
 * `usage.cost.*` fields from the JSONL files, which are unreliable on newer
 * OpenClaw/OpenRouter routes (they sometimes contain negative token deltas
 * rather than dollar amounts). This guarantees the Token & Cost Intel panel
 * shows honest, consistent dollar figures regardless of upstream schema drift.
 *
 * Used by the Token & Cost Intel panel to show real token consumption per
 * model, per agent, with explainable cost attribution.
 *
 * @module services/token-reader
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOpenClawPaths } from '@/lib/openclaw-paths';
import { computeCost } from './model-pricing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsageEntry {
  /** Agent whose session this entry came from (e.g. "hubspot", "otter-search"). */
  agentId: string;
  /** Model name as written in the session file. */
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  /** ClawNex-computed cost in USD for this entry (from model-pricing service). */
  cost: number;
  /** Where the rate came from — `openclaw` | `litellm` | `fallback` | `default`. */
  costSource?: string;
  timestamp: string;
  sessionId: string;
}

export interface ModelAggregation {
  model: string;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  /** Which pricing tier supplied the rate (for the panel to show provenance). */
  costSource?: string;
}

export interface AgentAggregation {
  agentId: string;
  models: Record<string, {
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    totalCacheWrite: number;
    totalTokens: number;
    totalCost: number;
    messageCount: number;
    costSource?: string;
  }>;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  sessionCount: number;
}

/**
 * Per-session rollup. The sessionId is the JSONL filename (sans extension),
 * agentId is the parent directory under `agents/` so attribution is implicit
 * and reliable for OpenClaw-routed traffic. Direct-to-provider calls that
 * never hit OpenClaw will not appear here — they live only in proxy_traffic
 * and are merged in by /api/tokens with `agentId === 'unknown'`.
 */
export interface SessionAggregation {
  sessionId: string;
  agentId: string;
  models: Record<string, {
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    totalCacheWrite: number;
    totalTokens: number;
    totalCost: number;
    messageCount: number;
    costSource?: string;
  }>;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface TokenReaderResult {
  entries: TokenUsageEntry[];
  byModel: ModelAggregation[];
  byAgent: AgentAggregation[];
  bySession: SessionAggregation[];
  totals: {
    totalTokens: number;
    totalCost: number;
    totalMessages: number;
    totalSessions: number;
    modelsUsed: number;
    agentsUsed: number;
  };
  scannedFiles: number;
  scannedAt: string;
  /** Agents that were discovered but had no usage data in range (for debugging). */
  emptyAgents: string[];
}

// ---------------------------------------------------------------------------
// Core reader
// ---------------------------------------------------------------------------

/** Agent IDs we never want to surface (synthetic / internal). */
const IGNORED_AGENT_IDS = new Set<string>();

interface SessionFile {
  agentId: string;
  sessionId: string;
  path: string;
  mtime: number;
}

/**
 * List every session JSONL file across every agent directory, sorted by
 * mtime descending. Skips deleted/reset variants.
 */
function enumerateSessionFiles(agentsRoot: string): SessionFile[] {
  const out: SessionFile[] = [];
  if (!existsSync(agentsRoot)) return out;

  let agentDirs: string[] = [];
  try {
    agentDirs = readdirSync(agentsRoot);
  } catch {
    return out;
  }

  for (const agentId of agentDirs) {
    if (IGNORED_AGENT_IDS.has(agentId)) continue;
    const sessionsDir = join(agentsRoot, agentId, 'sessions');
    if (!existsSync(sessionsDir)) continue;
    try {
      const files = readdirSync(sessionsDir);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        if (f.includes('.deleted.') || f.includes('.reset.')) continue;
        const fullPath = join(sessionsDir, f);
        try {
          const stat = statSync(fullPath);
          if (!stat.isFile()) continue;
          out.push({
            agentId,
            sessionId: f.replace('.jsonl', ''),
            path: fullPath,
            mtime: stat.mtimeMs,
          });
        } catch { /* ignore individual file errors */ }
      }
    } catch { /* ignore directories we can't read */ }
  }

  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * Read token usage across every agent's session directory.
 *
 * @param since - Only include entries newer than this ISO date
 * @param maxFiles - Maximum number of session files to scan (most recent first across ALL agents)
 */
export function readTokenUsage(since?: string, maxFiles = 500): TokenReaderResult {
  const entries: TokenUsageEntry[] = [];
  let scannedFiles = 0;

  // Resolve the OpenClaw home and build the agents/ path.
  const { home: ocHome } = resolveOpenClawPaths();
  const agentsRoot = join(ocHome || '', 'agents');

  const allFiles = enumerateSessionFiles(agentsRoot).slice(0, maxFiles);
  const sinceMs = since ? new Date(since).getTime() : 0;

  // Track which agents have session files at all (even if they end up empty of in-range entries).
  const agentsWithFiles = new Set<string>();
  const agentsWithUsage = new Set<string>();

  for (const file of allFiles) {
    agentsWithFiles.add(file.agentId);
    try {
      const content = readFileSync(file.path, 'utf-8');
      const lines = content.split('\n');
      let fileHasUsage = false;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type !== 'message') continue;
          const msg = parsed.message;
          if (!msg || !msg.usage) continue;

          const usage = msg.usage;
          const model = msg.model || 'unknown';
          const timestamp = parsed.timestamp || '';

          if (sinceMs > 0 && timestamp) {
            const entryTime = new Date(timestamp).getTime();
            if (!Number.isFinite(entryTime) || entryTime < sinceMs) continue;
          }

          // Clamp negative token counts defensively — same reason we don't trust
          // `usage.cost.*` anymore.
          const safeN = (v: unknown): number => {
            const n = typeof v === 'number' ? v : 0;
            return n > 0 ? n : 0;
          };
          const input = safeN(usage.input);
          const output = safeN(usage.output);
          const cacheRead = safeN(usage.cacheRead);
          const cacheWrite = safeN(usage.cacheWrite);
          const totalTokens = safeN(usage.totalTokens) || (input + output + cacheRead + cacheWrite);

          // Compute cost ourselves via the pricing service — ignore usage.cost.*.
          const { cost, rate } = computeCost(model, { input, output, cacheRead, cacheWrite });

          entries.push({
            agentId: file.agentId,
            model,
            input,
            output,
            cacheRead,
            cacheWrite,
            totalTokens,
            cost,
            costSource: rate?.source ?? 'default',
            timestamp,
            sessionId: file.sessionId,
          });

          fileHasUsage = true;
        } catch {
          // Skip unparseable lines
        }
      }

      if (fileHasUsage) {
        scannedFiles++;
        agentsWithUsage.add(file.agentId);
      }
    } catch {
      // Skip unreadable files
    }
  }

  // ---- Aggregate by model ----
  const modelMap = new Map<string, ModelAggregation & { _sourceSet: Set<string> }>();
  for (const e of entries) {
    const existing = modelMap.get(e.model) || {
      model: e.model,
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      messageCount: 0,
      _sourceSet: new Set<string>(),
    };
    existing.totalInput += e.input;
    existing.totalOutput += e.output;
    existing.totalCacheRead += e.cacheRead;
    existing.totalCacheWrite += e.cacheWrite;
    existing.totalTokens += e.totalTokens;
    existing.totalCost += e.cost;
    existing.messageCount += 1;
    if (e.costSource) existing._sourceSet.add(e.costSource);
    modelMap.set(e.model, existing);
  }
  const byModel: ModelAggregation[] = Array.from(modelMap.values())
    .map(({ _sourceSet, ...rest }) => ({
      ...rest,
      totalCost: round6(rest.totalCost),
      costSource: pickPrimarySource(_sourceSet),
    }))
    .sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens);

  // ---- Aggregate by agent ----
  type AgentModelBucket = AgentAggregation['models'][string] & { _sourceSet: Set<string> };
  const agentMap = new Map<string, Omit<AgentAggregation, 'models'> & { models: Record<string, AgentModelBucket>; _sessions: Set<string> }>();
  for (const e of entries) {
    let bucket = agentMap.get(e.agentId);
    if (!bucket) {
      bucket = {
        agentId: e.agentId,
        models: {},
        totalTokens: 0,
        totalCost: 0,
        messageCount: 0,
        sessionCount: 0,
        _sessions: new Set<string>(),
      };
      agentMap.set(e.agentId, bucket);
    }
    let mBucket = bucket.models[e.model];
    if (!mBucket) {
      mBucket = {
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        totalCacheWrite: 0,
        totalTokens: 0,
        totalCost: 0,
        messageCount: 0,
        _sourceSet: new Set<string>(),
      };
      bucket.models[e.model] = mBucket;
    }
    mBucket.totalInput += e.input;
    mBucket.totalOutput += e.output;
    mBucket.totalCacheRead += e.cacheRead;
    mBucket.totalCacheWrite += e.cacheWrite;
    mBucket.totalTokens += e.totalTokens;
    mBucket.totalCost += e.cost;
    mBucket.messageCount += 1;
    if (e.costSource) mBucket._sourceSet.add(e.costSource);

    bucket.totalTokens += e.totalTokens;
    bucket.totalCost += e.cost;
    bucket.messageCount += 1;
    bucket._sessions.add(e.sessionId);
  }
  const byAgent: AgentAggregation[] = Array.from(agentMap.values())
    .map(({ _sessions, ...rest }) => {
      // Round cost fields for clean JSON.
      const models: AgentAggregation['models'] = {};
      for (const [m, v] of Object.entries(rest.models)) {
        const { _sourceSet, ...modelRest } = v;
        models[m] = { ...modelRest, totalCost: round6(modelRest.totalCost), costSource: pickPrimarySource(_sourceSet) };
      }
      return {
        ...rest,
        models,
        totalCost: round6(rest.totalCost),
        sessionCount: _sessions.size,
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens);

  // ---- Aggregate by session ----
  // Group every entry by (sessionId, agentId) — sessionId is the JSONL filename
  // and agentId is its parent dir, so the attribution is implicit. Used by the
  // Cost by Session card; /api/tokens merges this with proxy_traffic rows
  // whose session_id doesn't map to any JSONL file (those become "unknown").
  // Compound key `${agentId}:${sessionId}` — sessionId alone (the JSONL
  // filename) isn't globally unique. Two agents under separate
  // `agents/<id>/sessions/` directories can legitimately share filenames,
  // and merging them by filename alone would attribute the second agent's
  // cost into the first agent's bucket. Compounding with agentId enforces
  // the per-agent-dir uniqueness guarantee that exists at the filesystem
  // layer.
  type SessionModelBucket = SessionAggregation['models'][string] & { _sourceSet: Set<string> };
  const sessionMap = new Map<string, Omit<SessionAggregation, 'models'> & { models: Record<string, SessionModelBucket> }>();
  for (const e of entries) {
    const sessionKey = `${e.agentId}:${e.sessionId}`;
    let bucket = sessionMap.get(sessionKey);
    if (!bucket) {
      bucket = {
        sessionId: e.sessionId,
        agentId: e.agentId,
        models: {},
        totalTokens: 0,
        totalCost: 0,
        messageCount: 0,
        firstSeen: '',
        lastSeen: '',
      };
      sessionMap.set(sessionKey, bucket);
    }
    let mBucket = bucket.models[e.model];
    if (!mBucket) {
      mBucket = {
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        totalCacheWrite: 0,
        totalTokens: 0,
        totalCost: 0,
        messageCount: 0,
        _sourceSet: new Set<string>(),
      };
      bucket.models[e.model] = mBucket;
    }
    mBucket.totalInput += e.input;
    mBucket.totalOutput += e.output;
    mBucket.totalCacheRead += e.cacheRead;
    mBucket.totalCacheWrite += e.cacheWrite;
    mBucket.totalTokens += e.totalTokens;
    mBucket.totalCost += e.cost;
    mBucket.messageCount += 1;
    if (e.costSource) mBucket._sourceSet.add(e.costSource);

    bucket.totalTokens += e.totalTokens;
    bucket.totalCost += e.cost;
    bucket.messageCount += 1;
    if (e.timestamp) {
      if (!bucket.firstSeen || e.timestamp < bucket.firstSeen) bucket.firstSeen = e.timestamp;
      if (!bucket.lastSeen || e.timestamp > bucket.lastSeen) bucket.lastSeen = e.timestamp;
    }
  }
  const bySession: SessionAggregation[] = Array.from(sessionMap.values())
    .map(s => {
      const models: SessionAggregation['models'] = {};
      for (const [m, v] of Object.entries(s.models)) {
        const { _sourceSet, ...modelRest } = v;
        models[m] = { ...modelRest, totalCost: round6(modelRest.totalCost), costSource: pickPrimarySource(_sourceSet) };
      }
      return { ...s, models, totalCost: round6(s.totalCost) };
    })
    .sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens);

  // ---- Totals ----
  const uniqueSessions = new Set(entries.map(e => e.sessionId));
  const totalCost = entries.reduce((s, e) => s + e.cost, 0);
  const totalTokens = entries.reduce((s, e) => s + e.totalTokens, 0);

  // Sort entries by timestamp desc and cap at 500 for the panel's recent view.
  const sortedEntries = entries
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 500);

  const emptyAgents = Array.from(agentsWithFiles).filter(id => !agentsWithUsage.has(id)).sort();

  return {
    entries: sortedEntries,
    byModel,
    byAgent,
    bySession,
    totals: {
      totalTokens,
      totalCost: round6(totalCost),
      totalMessages: entries.length,
      totalSessions: uniqueSessions.size,
      modelsUsed: modelMap.size,
      agentsUsed: agentMap.size,
    },
    scannedFiles,
    scannedAt: new Date().toISOString(),
    emptyAgents,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * When multiple rate sources contributed to a model's total, prefer the most
 * authoritative one for display. Priority: openclaw → litellm → fallback → default.
 */
function pickPrimarySource(set: Set<string>): string | undefined {
  if (set.has('openclaw')) return 'openclaw';
  if (set.has('litellm')) return 'litellm';
  if (set.has('fallback')) return 'fallback';
  if (set.has('default')) return 'default';
  return undefined;
}
