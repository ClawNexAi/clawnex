/**
 * ClawNex Model Pricing Service — single source of truth for LLM cost rates.
 *
 * Looks up input/output token rates for any model name a ClawNex component
 * encounters, using a three-tier fallback:
 *
 *   1. OpenClaw config overrides — `openclaw.json models.providers[].models[].cost`
 *      (per-install authoritative source; wins if present)
 *   2. Bundled LiteLLM price table — `data/litellm-model-prices.json`
 *      (version-locked snapshot of https://github.com/BerriAI/litellm's
 *      `model_prices_and_context_window.json` at the LiteLLM version we pin)
 *   3. Curated built-in fallback — a small hand-maintained table for common
 *      model families that LiteLLM doesn't know about (unreleased, private,
 *      and OpenClaw-internal virtual models like `openrouter/auto`)
 *
 * Rates are stored as USD-per-token (e.g. $3/M tokens = `3e-6`). The
 * `computeCost()` helper multiplies token counts by rates and returns a
 * dollar figure. Always returns a finite, non-negative number — never throws.
 *
 * Why this exists: OpenClaw's session JSONL files (as of 2026-04) no longer
 * carry reliable `usage.cost` dollar amounts. On some routes (OpenRouter) the
 * field contains negative token deltas rather than dollars, producing a
 * garbage "-$211,429" total in the Token & Cost Intel panel. Rather than
 * trusting upstream cost data, ClawNex now computes spend itself from token
 * counts × this rate table, giving operators an honest, consistent dollar
 * figure regardless of how the underlying proxy reports cost.
 *
 * @module services/model-pricing
 */

import fs from 'node:fs';
import path from 'node:path';
import { readOpenClawConfig } from '@/lib/openclaw-paths';
import { ensureSeeded, getRateRow } from './model-pricing-store';
import { getSetting } from './config-service';

// Settings key mirror — kept here to avoid exporting an internal constant from
// the store module just for this read. Must match `KEY_BUNDLED_VERSION` in
// model-pricing-store.ts.
const KEY_BUNDLED_VERSION = 'pricing_bundled_version';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-token rates in USD. All fields are small positive numbers (e.g. 3e-6). */
export interface ModelRate {
  /** USD per input token */
  input: number;
  /** USD per output token */
  output: number;
  /** USD per cache read token (optional) */
  cacheRead?: number;
  /** USD per cache creation/write token (optional) */
  cacheWrite?: number;
  /** Human-readable provider hint (from LiteLLM) */
  provider?: string;
  /** Where this rate came from, for debugging and UI explanation */
  source?: 'openclaw' | 'litellm' | 'fallback' | 'default';
  /**
   * Snapshot tag from the underlying source when available. v1: populated for
   * DB-backed and bundled-JSON rows; null for OpenClaw override / curated
   * fallback / default zero-rate.
   */
  version?: string | null;
}

/** Result of a cost computation. */
export interface CostResult {
  /** USD computed from token counts × rate. Always finite, non-negative. */
  cost: number;
  rate: ModelRate | null;
  /** Resolved model key when match succeeded; null when default zero-rate fallback fired. */
  matchedKey: string | null;
  /**
   * Snapshot tag for the rate-card source. Non-null only when:
   *  - DB-backed rate row matched → row's `source_version` column
   *  - Bundled JSON failsafe matched → bundle's `__meta.version` (or
   *    `KEY_BUNDLED_VERSION` setting if `__meta.version` absent)
   * Null for OpenClaw override / curated fallback / default zero-rate (v1).
   */
  pricing_version: string | null;
}

// ---------------------------------------------------------------------------
// LiteLLM bundled price table (loaded once at module init)
// ---------------------------------------------------------------------------

interface LiteLLMBundle {
  __meta?: { source: string; version: string; fetched_at: string };
  prices: Record<string, ModelRate>;
}

let litellmBundle: LiteLLMBundle | null = null;

function loadLiteLLMBundle(): LiteLLMBundle {
  if (litellmBundle) return litellmBundle;
  try {
    const bundlePath = path.resolve(process.cwd(), 'data', 'litellm-model-prices.json');
    const raw = fs.readFileSync(bundlePath, 'utf-8');
    const parsed = JSON.parse(raw) as LiteLLMBundle;
    litellmBundle = parsed;
    return parsed;
  } catch (err) {
    console.warn('[ModelPricing] Could not load litellm-model-prices.json:', err);
    litellmBundle = { prices: {} };
    return litellmBundle;
  }
}

/** Test hook — clear the module cache so a fresh file load happens on next call. */
export function clearModelPricingCache(): void {
  litellmBundle = null;
  openClawOverrideCache = null;
}

// ---------------------------------------------------------------------------
// OpenClaw override table (built from openclaw.json on demand)
// ---------------------------------------------------------------------------

let openClawOverrideCache: Record<string, ModelRate> | null = null;

function loadOpenClawOverrides(): Record<string, ModelRate> {
  if (openClawOverrideCache) return openClawOverrideCache;
  const config = readOpenClawConfig();
  const overrides: Record<string, ModelRate> = {};
  if (!config) {
    openClawOverrideCache = overrides;
    return overrides;
  }
  const providers = (config.models as { providers?: Record<string, unknown> })?.providers || {};
  for (const [, provRaw] of Object.entries(providers)) {
    const prov = provRaw as { models?: Array<{ id?: string; cost?: { input?: number; output?: number } }> };
    for (const m of prov.models || []) {
      if (!m.id || !m.cost) continue;
      overrides[m.id] = {
        input: m.cost.input || 0,
        output: m.cost.output || 0,
        source: 'openclaw',
      };
    }
  }
  openClawOverrideCache = overrides;
  return overrides;
}

// ---------------------------------------------------------------------------
// Curated fallback table
// ---------------------------------------------------------------------------

/**
 * Hand-maintained fallback for models LiteLLM doesn't know about.
 *
 * Keep this small. Only add entries for models that ClawNex operators actually
 * encounter and that are missing from the bundled LiteLLM data. Each entry is
 * a best-effort guess based on the closest published family member — document
 * the reasoning inline.
 */
const FALLBACK_RATES: Record<string, ModelRate> = {
  // OpenClaw's synthetic virtual models — never billed, internal routing markers.
  'openrouter/auto': { input: 3e-6, output: 15e-6, source: 'fallback', provider: 'openrouter' },
  'delivery-mirror': { input: 0, output: 0, source: 'fallback', provider: 'internal' },
  'gateway-injected': { input: 0, output: 0, source: 'fallback', provider: 'internal' },
};

/** Absolute last-resort rate when nothing matches. Zero is honest. */
const DEFAULT_RATE: ModelRate = { input: 0, output: 0, source: 'default' };

// ---------------------------------------------------------------------------
// Model name normalization
// ---------------------------------------------------------------------------

/**
 * Generate an ordered list of candidate lookup keys for a given raw model name.
 *
 * OpenClaw sessions use names like `anthropic/claude-sonnet-4-6`. LiteLLM
 * catalogs them under variants like `claude-sonnet-4-5`, `openrouter/anthropic/claude-sonnet-4.6`,
 * `anthropic.claude-sonnet-4-6`, etc. This helper emits every candidate we
 * should try, from most specific to most generic.
 */
function candidateKeys(raw: string): string[] {
  if (!raw) return [];
  const candidates: string[] = [];
  const push = (k: string) => {
    if (k && !candidates.includes(k)) candidates.push(k);
  };

  const normalized = raw.trim();
  push(normalized);

  // Strip common prefixes one at a time.
  const prefixes = ['openrouter/', 'azure/', 'azure_ai/', 'anthropic/', 'openai/', 'bedrock/', 'vertex_ai/', 'google/', 'groq/'];
  for (const p of prefixes) {
    if (normalized.startsWith(p)) push(normalized.slice(p.length));
  }

  // openrouter/anthropic/claude-X → try openrouter/anthropic/claude-X and the
  // flipped anthropic.claude-X (bedrock-style dot notation).
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash > 0) push(normalized.slice(lastSlash + 1));

  // Swap hyphens between "-4" and "-6"/"-5" suffixes to handle the `-4-5`/`-4-6`/`-4.5`/`-4.6` skew.
  // e.g. `claude-sonnet-4-6` → `claude-sonnet-4.6` and vice versa.
  const hyphenDotVariants: string[] = [];
  for (const base of candidates.slice()) {
    const dotted = base.replace(/-(\d)-(\d)(?=$|[/-])/g, '-$1.$2');
    const hyphened = base.replace(/-(\d)\.(\d)(?=$|[/-])/g, '-$1-$2');
    if (dotted !== base && !hyphenDotVariants.includes(dotted)) hyphenDotVariants.push(dotted);
    if (hyphened !== base && !hyphenDotVariants.includes(hyphened)) hyphenDotVariants.push(hyphened);
  }
  for (const v of hyphenDotVariants) push(v);

  // openrouter/* variants for every candidate so we can try OR pricing when a bare name fails.
  for (const c of [...candidates]) {
    if (!c.startsWith('openrouter/')) push(`openrouter/${c}`);
    if (!c.startsWith('openrouter/anthropic/') && /claude/i.test(c)) {
      push(`openrouter/anthropic/${c.replace(/^anthropic[./]/, '')}`);
    }
  }

  // anthropic.claude-X (bedrock dot-style) for claude models
  for (const c of [...candidates]) {
    if (/^claude/i.test(c)) push(`anthropic.${c}`);
  }

  return candidates;
}

/**
 * Try to match a raw model name against a LiteLLM price table using a
 * broad family prefix. This is the last resort before the fallback table —
 * it catches things like `gpt-5.4` → `gpt-5`, `claude-sonnet-4-6` → `claude-sonnet-4-5`.
 */
function fuzzyFamilyMatch(raw: string, prices: Record<string, ModelRate>): string | null {
  const lower = raw.toLowerCase();
  // Family anchors, ordered from most specific to least.
  const families = [
    'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-sonnet-4',
    'claude-haiku-4-5', 'claude-haiku-4',
    'claude-opus-4-5', 'claude-opus-4',
    'claude-3.7-sonnet', 'claude-3.5-sonnet', 'claude-3.5-haiku',
    'gpt-5.1', 'gpt-5',
    'gpt-4.1', 'gpt-4o-mini', 'gpt-4o',
    'llama-4', 'llama-3.3', 'llama-3.1',
    'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-pro',
    'qwen3', 'qwen2.5',
    'deepseek',
  ];
  for (const fam of families) {
    // normalize model name for comparison: replace dots with hyphens and vice versa
    const flat = lower.replace(/\./g, '-');
    const famFlat = fam.replace(/\./g, '-');
    if (flat.includes(famFlat)) {
      // Find the first price key that matches this family
      for (const key of Object.keys(prices)) {
        const keyLower = key.toLowerCase().replace(/\./g, '-');
        if (keyLower === famFlat || keyLower.endsWith(`/${famFlat}`) || keyLower.endsWith(`.${famFlat}`)) {
          return key;
        }
      }
      // Looser: any key containing the family substring
      for (const key of Object.keys(prices)) {
        if (key.toLowerCase().replace(/\./g, '-').includes(famFlat)) {
          return key;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Convert a DB row from model_prices_store into our internal ModelRate shape. */
function dbRowToRate(row: {
  input_per_token: number;
  output_per_token: number;
  cache_read_per_token: number | null;
  cache_write_per_token: number | null;
  provider: string | null;
  source_version?: string | null;
}): ModelRate {
  const rate: ModelRate = {
    input: row.input_per_token,
    output: row.output_per_token,
    source: 'litellm',
    // Per-tier rule (v1): DB-backed rate exposes its `source_version` column
    // as the snapshot tag; orchestrator surfaces this on each recomputed row.
    version: row.source_version ?? null,
  };
  if (row.cache_read_per_token != null) rate.cacheRead = row.cache_read_per_token;
  if (row.cache_write_per_token != null) rate.cacheWrite = row.cache_write_per_token;
  if (row.provider) rate.provider = row.provider;
  return rate;
}

/**
 * Look up the rate for a model. Returns a {@link ModelRate} with a `source`
 * field indicating which tier won:
 *
 *   1. `openclaw` — per-install override from `openclaw.json`
 *   2. `litellm` — bundled/synced rate from the `model_prices` DB table
 *      (seeded from `data/litellm-model-prices.json` on first boot,
 *      refreshable from LiteLLM's GitHub tag via the Configuration panel)
 *   3. `litellm` via the bundled JSON — only reached if the DB table is
 *      missing or empty (failsafe when the service starts before the
 *      schema migration has run)
 *   4. `fallback` — hand-curated rates for internal/virtual models
 *   5. `default` — zero rate, honest last resort
 */
export function getModelRate(rawModel: string): ModelRate {
  if (!rawModel) return DEFAULT_RATE;

  // Tier 1: OpenClaw overrides
  const overrides = loadOpenClawOverrides();
  if (overrides[rawModel]) return overrides[rawModel];

  // Tier 2: DB-backed pricing store. Auto-seeds from the bundled JSON if
  // empty, so this is the primary path on every install older than 0 seconds.
  try {
    ensureSeeded();
    for (const key of candidateKeys(rawModel)) {
      const row = getRateRow(key);
      if (row) return dbRowToRate(row);
    }
    // Fuzzy family match against DB — only when exact candidates all missed.
    // We query all rows matching known family substrings.
    // Cheap heuristic: walk a short list of family anchors and try each.
    const fuzzy = fuzzyDbLookup(rawModel);
    if (fuzzy) return fuzzy;
  } catch {
    // Fall through to bundled failsafe if the DB is unhappy.
  }

  // Tier 3: Bundled JSON failsafe (same file the store seeds from). Only used
  // when the DB query fails entirely — normally the DB wins because seeding
  // populated it with these exact rows.
  //
  // Per-tier `version` rule (v1): bundled JSON rows carry the bundle's
  // `__meta.version`; if the bundle didn't ship that key, fall back to the
  // `KEY_BUNDLED_VERSION` setting that `seedFromBundle()` writes alongside
  // initial seeding. Either yields a non-null snapshot tag.
  const bundle = loadLiteLLMBundle();
  const bundleVersion: string | null =
    bundle.__meta?.version ?? (getSetting(KEY_BUNDLED_VERSION) || null);
  for (const key of candidateKeys(rawModel)) {
    const hit = bundle.prices[key];
    if (hit) return { ...hit, source: 'litellm', version: bundleVersion };
  }
  const fuzzy = fuzzyFamilyMatch(rawModel, bundle.prices);
  if (fuzzy && bundle.prices[fuzzy]) {
    return { ...bundle.prices[fuzzy], source: 'litellm', version: bundleVersion };
  }

  // Tier 4: Curated fallback for internal/virtual models
  if (FALLBACK_RATES[rawModel]) return FALLBACK_RATES[rawModel];

  // Tier 5: Zero rate
  return DEFAULT_RATE;
}

/**
 * Fuzzy family match against the DB. Walks the same family anchor list as
 * {@link fuzzyFamilyMatch} but queries the DB instead of a bundled object.
 */
function fuzzyDbLookup(rawModel: string): ModelRate | null {
  const lower = rawModel.toLowerCase().replace(/\./g, '-');
  const families = [
    'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-sonnet-4',
    'claude-haiku-4-5', 'claude-haiku-4',
    'claude-opus-4-5', 'claude-opus-4',
    'claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku',
    'gpt-5-1', 'gpt-5',
    'gpt-4-1', 'gpt-4o-mini', 'gpt-4o',
    'llama-4', 'llama-3-3', 'llama-3-1',
    'gemini-2-5-pro', 'gemini-2-5-flash', 'gemini-2-0-flash',
    'qwen3', 'qwen2-5',
    'deepseek',
  ];
  for (const fam of families) {
    if (!lower.includes(fam)) continue;
    // Try a couple of canonical keys for each family.
    const candidates = [fam, `openrouter/anthropic/${fam}`, `anthropic.${fam}`];
    for (const k of candidates) {
      const row = getRateRow(k);
      if (row) return dbRowToRate(row);
    }
  }
  return null;
}

/**
 * Compute the USD cost for a message with the given token counts and model.
 * Cache tokens are billed at the cache rate when present; otherwise folded
 * into input cost. Returns a non-negative number.
 */
export function computeCost(
  rawModel: string,
  tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
): CostResult {
  const rate = getModelRate(rawModel);
  const safe = (n: number | undefined) => (typeof n === 'number' && n > 0 ? n : 0);

  const inputTokens = safe(tokens.input);
  const outputTokens = safe(tokens.output);
  const cacheReadTokens = safe(tokens.cacheRead);
  const cacheWriteTokens = safe(tokens.cacheWrite);

  // Prefer cache-specific rates when available, otherwise fall back to input rate.
  const cacheReadRate = rate.cacheRead ?? rate.input;
  const cacheWriteRate = rate.cacheWrite ?? rate.input;

  const cost =
    inputTokens * rate.input +
    outputTokens * rate.output +
    cacheReadTokens * cacheReadRate +
    cacheWriteTokens * cacheWriteRate;

  return {
    cost: Number.isFinite(cost) && cost > 0 ? cost : 0,
    rate,
    matchedKey: rate.source === 'default' ? null : rawModel,
    // Per-tier rule (v1): pricing_version is non-null only for DB-backed rows
    // (`source_version`) and bundled JSON failsafe (`__meta.version` or
    // `KEY_BUNDLED_VERSION`). OpenClaw override / curated fallback / default
    // zero-rate all leave `rate.version` undefined → coerced to null here.
    pricing_version: rate.version ?? null,
  };
}
