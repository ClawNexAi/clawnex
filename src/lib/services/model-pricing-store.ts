/**
 * ClawNex Model Pricing Store — DB-backed storage for LLM model cost rates.
 *
 * This is the authoritative runtime source for model pricing data. On cold DB,
 * it auto-seeds from the bundled LiteLLM snapshot at `data/litellm-model-prices.json`
 * so the Token & Cost Intel panel works immediately on a fresh install. Operators
 * then explicitly refresh from LiteLLM's GitHub via the Welcome Wizard step or the
 * Configuration → Updates → Model Pricing card. Scheduled auto-sync is optional.
 *
 * Lookup priority (honored by `model-pricing.ts::getModelRate`):
 *   1. openclaw.json provider-level cost overrides
 *   2. This store (DB-backed, refreshable)
 *   3. Bundled JSON failsafe (only if DB read fails)
 *   4. Curated in-code fallback
 *   5. Zero rate (honest last resort)
 *
 * Why a DB table instead of a static file: pricing changes constantly. CVEs get
 * the same treatment for the same reason. An operator should be able to refresh
 * pricing data without rebuilding the ClawNex package.
 *
 * Safety: the sync endpoint pulls from the GitHub tag matching the currently
 * pinned LITELLM_VERSION (default 1.84.10), NOT `main`. This keeps the supply
 * chain story identical to the pinned LiteLLM binary itself — only what the
 * ClawNex team has approved.
 *
 * @module services/model-pricing-store
 */

import fs from 'node:fs';
import path from 'node:path';
import { run, queryAll, queryOne } from '../db/index';
import { getSetting, setSetting } from './config-service';
import { logInfo, logWarn } from './logger';
import { CLAWNEX_VERSION } from '../version';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PricingSource = 'bundled' | 'synced' | 'manual';

export interface PriceRow {
  model_id: string;
  input_per_token: number;
  output_per_token: number;
  cache_read_per_token: number | null;
  cache_write_per_token: number | null;
  provider: string | null;
  source: PricingSource;
  source_version: string | null;
  updated_at: string;
}

export interface PricingStatus {
  /** Total rows in the model_prices table. */
  totalModels: number;
  /** Row count grouped by source. */
  bySource: Record<PricingSource, number>;
  /** ISO timestamp of the most recent explicit sync (null if never). */
  lastSync: string | null;
  /** LiteLLM tag used for the last sync. */
  lastSyncTag: string | null;
  /** Row count from the last sync. */
  lastSyncCount: number | null;
  /** Operator-configured stale threshold in days. */
  staleDays: number;
  /** True when (now - lastSync) > staleDays. */
  isStale: boolean;
  /** Auto-sync enabled flag. */
  autoSyncEnabled: boolean;
  /** Auto-sync interval in hours. */
  autoSyncIntervalHours: number;
  /** Currently pinned LiteLLM version (from env LITELLM_VERSION). */
  pinnedLiteLLMVersion: string;
  /** True once the operator has explicitly synced at least once. */
  everSynced: boolean;
}

// ---------------------------------------------------------------------------
// Config keys (stored in config_defaults)
// ---------------------------------------------------------------------------

const KEY_LAST_SYNC = 'pricing_last_sync';
const KEY_LAST_SYNC_TAG = 'pricing_last_sync_tag';
const KEY_LAST_SYNC_COUNT = 'pricing_last_sync_count';
const KEY_STALE_DAYS = 'pricing_stale_days';
const KEY_AUTO_SYNC_ENABLED = 'pricing_auto_sync_enabled';
const KEY_AUTO_SYNC_INTERVAL_HOURS = 'pricing_auto_sync_interval_hours';
const KEY_EVER_SYNCED = 'pricing_ever_synced';
const KEY_BUNDLED_VERSION = 'pricing_bundled_version';

const DEFAULT_STALE_DAYS = 30;
const DEFAULT_AUTO_SYNC_INTERVAL_HOURS = 24;

// ---------------------------------------------------------------------------
// Bundled JSON loader (for seeding + failsafe)
// ---------------------------------------------------------------------------

interface BundledFile {
  __meta?: { source?: string; version?: string; fetched_at?: string };
  prices: Record<string, {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    provider?: string;
  }>;
}

function getBundlePath(): string {
  return path.resolve(process.cwd(), 'data', 'litellm-model-prices.json');
}

function loadBundledJSON(): BundledFile | null {
  try {
    const raw = fs.readFileSync(getBundlePath(), 'utf-8');
    return JSON.parse(raw) as BundledFile;
  } catch (err) {
    console.warn('[ModelPricingStore] Could not load bundled JSON:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core DB operations
// ---------------------------------------------------------------------------

/** Return the total row count, or 0 if the table is missing/empty. */
export function countRows(): number {
  try {
    const row = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM model_prices');
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/** Look up a single model's rate. Returns null when the DB query fails or no row matches. */
export function getRateRow(modelId: string): PriceRow | null {
  try {
    return queryOne<PriceRow>('SELECT * FROM model_prices WHERE model_id = ?', [modelId]) || null;
  } catch {
    return null;
  }
}

/** Bulk upsert. Wrapped in a transaction — partial failures don't leave stale rows behind. */
export function upsertPrices(
  rows: Array<{
    model_id: string;
    input_per_token: number;
    output_per_token: number;
    cache_read_per_token?: number | null;
    cache_write_per_token?: number | null;
    provider?: string | null;
  }>,
  source: PricingSource,
  sourceVersion: string | null,
): { inserted: number; updated: number } {
  if (rows.length === 0) return { inserted: 0, updated: 0 };
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  try {
    // Determine which rows already exist so we can count inserted vs updated.
    const existingIds = new Set<string>(
      queryAll<{ model_id: string }>('SELECT model_id FROM model_prices').map(r => r.model_id),
    );
    run('BEGIN TRANSACTION');
    for (const r of rows) {
      const wasExisting = existingIds.has(r.model_id);
      run(
        `INSERT INTO model_prices
           (model_id, input_per_token, output_per_token, cache_read_per_token,
            cache_write_per_token, provider, source, source_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(model_id) DO UPDATE SET
           input_per_token = excluded.input_per_token,
           output_per_token = excluded.output_per_token,
           cache_read_per_token = excluded.cache_read_per_token,
           cache_write_per_token = excluded.cache_write_per_token,
           provider = excluded.provider,
           source = excluded.source,
           source_version = excluded.source_version,
           updated_at = excluded.updated_at`,
        [
          r.model_id,
          r.input_per_token,
          r.output_per_token,
          r.cache_read_per_token ?? null,
          r.cache_write_per_token ?? null,
          r.provider ?? null,
          source,
          sourceVersion,
          now,
        ],
      );
      if (wasExisting) updated++; else inserted++;
    }
    run('COMMIT');
  } catch (err) {
    try { run('ROLLBACK'); } catch { /* ignore */ }
    console.error('[ModelPricingStore] upsertPrices error:', err);
    throw err;
  }
  return { inserted, updated };
}

/** Convert bundled JSON entries into the DB row shape. */
function bundleEntriesToRows(bundle: BundledFile) {
  return Object.entries(bundle.prices).map(([model_id, v]) => ({
    model_id,
    input_per_token: v.input || 0,
    output_per_token: v.output || 0,
    cache_read_per_token: v.cacheRead ?? null,
    cache_write_per_token: v.cacheWrite ?? null,
    provider: v.provider ?? null,
  }));
}

/**
 * Seed the table from the bundled JSON — safe to call repeatedly because it
 * only does work when the table is empty. Returns the number of rows seeded,
 * or 0 if the table already had rows or the bundle couldn't be loaded.
 */
export function seedFromBundle(): number {
  if (countRows() > 0) return 0;
  const bundle = loadBundledJSON();
  if (!bundle || !bundle.prices) return 0;
  const rows = bundleEntriesToRows(bundle);
  const version = bundle.__meta?.version || 'bundled';
  const { inserted } = upsertPrices(rows, 'bundled', version);
  setSetting(KEY_BUNDLED_VERSION, version);
  try {
    logInfo('system', `Model pricing store seeded from bundled LiteLLM snapshot`, {
      version,
      rows: inserted,
    });
  } catch { /* silent */ }
  return inserted;
}

/** Make sure the table is seeded before any lookup. Idempotent. Safe to call on every dashboard boot. */
let seedChecked = false;
export function ensureSeeded(): void {
  if (seedChecked) return;
  seedChecked = true;
  try {
    if (countRows() === 0) {
      seedFromBundle();
    }
  } catch { /* never throw from init */ }
}

// ---------------------------------------------------------------------------
// GitHub sync
// ---------------------------------------------------------------------------

/** Resolve the GitHub tag to fetch. Prefers LITELLM_VERSION env, falls back to 1.84.10. */
function getLiteLLMTag(): string {
  const pinned = process.env.LITELLM_VERSION?.trim() || '1.84.10';
  // LiteLLM publishes pricing files on `v<version>-nightly` tags for every
  // release (including patch versions like 1.82.6). The plain `v<version>` tag
  // frequently doesn't carry the pricing JSON and returns 404. Always prefer
  // the `-nightly` suffix; the caller falls back to plain if that 404s.
  return `v${pinned}-nightly`;
}

function getSyncUrl(tag: string): string {
  return `https://raw.githubusercontent.com/BerriAI/litellm/${tag}/model_prices_and_context_window.json`;
}

interface LiteLLMRawEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  litellm_provider?: string;
}

/**
 * Fetch the LiteLLM pricing JSON from GitHub at the pinned tag and upsert every
 * model row with source='synced'. Returns a summary with row counts and tag.
 *
 * Throws on network error, HTTP error, or malformed JSON — the caller (route
 * handler) converts to a user-friendly error response.
 */
export async function syncFromGitHub(): Promise<{
  tag: string;
  url: string;
  totalModels: number;
  inserted: number;
  updated: number;
  durationMs: number;
}> {
  const start = Date.now();
  const tag = getLiteLLMTag();
  const url = getSyncUrl(tag);

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': `ClawNex/${CLAWNEX_VERSION}` },
  });
  if (!res.ok) {
    throw new Error(`GitHub fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  const raw = (await res.json()) as Record<string, LiteLLMRawEntry>;

  const rows: Array<{
    model_id: string;
    input_per_token: number;
    output_per_token: number;
    cache_read_per_token: number | null;
    cache_write_per_token: number | null;
    provider: string | null;
  }> = [];
  for (const [modelId, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const inp = v.input_cost_per_token;
    const out = v.output_cost_per_token;
    if (inp == null && out == null) continue;
    rows.push({
      model_id: modelId,
      input_per_token: inp || 0,
      output_per_token: out || 0,
      cache_read_per_token: v.cache_read_input_token_cost ?? null,
      cache_write_per_token: v.cache_creation_input_token_cost ?? null,
      provider: v.litellm_provider ?? null,
    });
  }

  const { inserted, updated } = upsertPrices(rows, 'synced', tag);

  // Update metadata
  const now = new Date().toISOString();
  setSetting(KEY_LAST_SYNC, now);
  setSetting(KEY_LAST_SYNC_TAG, tag);
  setSetting(KEY_LAST_SYNC_COUNT, String(rows.length));
  setSetting(KEY_EVER_SYNCED, '1');

  const durationMs = Date.now() - start;
  try {
    logInfo('system', 'Model pricing synced from LiteLLM GitHub', {
      tag,
      url,
      rows: rows.length,
      inserted,
      updated,
      durationMs,
    });
  } catch { /* silent */ }

  return { tag, url, totalModels: rows.length, inserted, updated, durationMs };
}

// ---------------------------------------------------------------------------
// Status + settings
// ---------------------------------------------------------------------------

export function getStatus(): PricingStatus {
  ensureSeeded();

  const totalModels = countRows();
  const bySourceRows = queryAll<{ source: string; cnt: number }>(
    'SELECT source, COUNT(*) as cnt FROM model_prices GROUP BY source',
  );
  const bySource: Record<PricingSource, number> = { bundled: 0, synced: 0, manual: 0 };
  for (const r of bySourceRows) {
    if (r.source in bySource) bySource[r.source as PricingSource] = r.cnt;
  }

  const lastSync = getSetting(KEY_LAST_SYNC) || null;
  const lastSyncTag = getSetting(KEY_LAST_SYNC_TAG) || null;
  const lastSyncCountRaw = getSetting(KEY_LAST_SYNC_COUNT);
  const lastSyncCount = lastSyncCountRaw ? parseInt(lastSyncCountRaw, 10) : null;

  const staleDays = parseInt(getSetting(KEY_STALE_DAYS) || String(DEFAULT_STALE_DAYS), 10) || DEFAULT_STALE_DAYS;
  const autoSyncEnabled = getSetting(KEY_AUTO_SYNC_ENABLED) === '1';
  const autoSyncIntervalHours = parseInt(
    getSetting(KEY_AUTO_SYNC_INTERVAL_HOURS) || String(DEFAULT_AUTO_SYNC_INTERVAL_HOURS),
    10,
  ) || DEFAULT_AUTO_SYNC_INTERVAL_HOURS;

  const everSynced = getSetting(KEY_EVER_SYNCED) === '1';

  // Staleness: if never synced, we consider the data stale as soon as bundled
  // age > staleDays (but we don't actually know the bundled age precisely;
  // fall back to "not stale when never synced so the operator isn't nagged
  // pre-wizard"). Once synced, compare lastSync against staleDays.
  let isStale = false;
  if (lastSync) {
    const ageMs = Date.now() - new Date(lastSync).getTime();
    isStale = ageMs > staleDays * 24 * 60 * 60 * 1000;
  }

  return {
    totalModels,
    bySource,
    lastSync,
    lastSyncTag,
    lastSyncCount,
    staleDays,
    isStale,
    autoSyncEnabled,
    autoSyncIntervalHours,
    pinnedLiteLLMVersion: process.env.LITELLM_VERSION?.trim() || '1.84.10',
    everSynced,
  };
}

/** Update operator-configurable settings. Validated + persisted via config_defaults. */
export function updateSettings(patch: {
  staleDays?: number;
  autoSyncEnabled?: boolean;
  autoSyncIntervalHours?: number;
}): PricingStatus {
  if (patch.staleDays !== undefined) {
    const clamped = Math.max(1, Math.min(365, Math.round(patch.staleDays)));
    setSetting(KEY_STALE_DAYS, String(clamped));
  }
  if (patch.autoSyncEnabled !== undefined) {
    setSetting(KEY_AUTO_SYNC_ENABLED, patch.autoSyncEnabled ? '1' : '0');
  }
  if (patch.autoSyncIntervalHours !== undefined) {
    const clamped = Math.max(1, Math.min(30 * 24, Math.round(patch.autoSyncIntervalHours)));
    setSetting(KEY_AUTO_SYNC_INTERVAL_HOURS, String(clamped));
  }
  return getStatus();
}

/**
 * Cron hook — called from the daily retention cron. If auto-sync is enabled
 * and the current delta exceeds the configured interval, trigger a sync.
 * Never throws — logs and returns a result object.
 */
export async function maybeAutoSync(): Promise<{ ran: boolean; reason?: string; error?: string }> {
  try {
    const status = getStatus();
    if (!status.autoSyncEnabled) return { ran: false, reason: 'auto-sync disabled' };
    const nowMs = Date.now();
    const lastMs = status.lastSync ? new Date(status.lastSync).getTime() : 0;
    const ageHours = (nowMs - lastMs) / (60 * 60 * 1000);
    if (ageHours < status.autoSyncIntervalHours) {
      return { ran: false, reason: `next sync in ${(status.autoSyncIntervalHours - ageHours).toFixed(1)}h` };
    }
    await syncFromGitHub();
    return { ran: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { logWarn('system', 'Model pricing auto-sync failed', { error: msg }); } catch {}
    return { ran: false, error: msg };
  }
}
