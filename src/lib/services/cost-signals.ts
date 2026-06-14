// src/lib/services/cost-signals.ts
/**
 * Drain-signal detectors. Each detector returns Signal records bound to
 * specific row_ids. Signals are computed in memory per request; never persisted.
 *
 * Task 7 lands `loop_risk`. Task 8 lands `velocity_spike`. Task 9 lands
 * `context_bloat`. Task 10 lands `cache_drop` / `cache_drop_risk`. Task 11
 * lands `simple_on_expensive` — completing the Gate B detector set.
 *
 * `DetectOpts` is intentionally imported from the orchestrator (`cost-reporting`)
 * — that module owns the shape because it's also the trust boundary that strips
 * `signal_context` before the public CostReport is returned. Detectors are
 * read-only consumers of the merged maps.
 *
 * Spec: docs/superpowers/specs/2026-05-04-token-cost-finops-reporting-design.md
 *       §"Drain detectors → 1. loop_risk"
 */

import type { NormalizedRow, Signal, Source } from '@/lib/types/cost-reporting';
import type { DetectOpts } from '@/lib/services/cost-reporting';
import { computeCost } from '@/lib/services/model-pricing';

const TEN_MIN_MS = 10 * 60 * 1000;
const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TRIMMED_PCT = 0.10; // top + bottom 10%

/**
 * VelocityOpts adds an optional `now` override so tests can pin the
 * current-hour anchor; production always falls back to `Date.now()`.
 */
interface VelocityOpts extends DetectOpts {
  /** Override "now" for tests; defaults to Date.now() */
  now?: number;
}

/**
 * `loop_risk` — repeated-call risk per source.
 *
 * Conservative thresholds + intentionally hedged badge text ("Possible
 * repeated-call loop"). Never declares a confirmed loop — that framing is
 * reserved for surfaces we are not building in v1.
 *
 * Per spec §"Drain detectors → 1. loop_risk":
 *   - OpenClaw (structural-only — privacy guarantee blocks prompt access):
 *       ≥5 rows in same session_id + same model, input_tokens within ±5%
 *       (sliding 5-row window), within 10 minutes, AND a single repeated
 *       stopReason across all 5 windowed rows. Skip windows where any row
 *       has a missing stopReason.
 *   - Hermes (hash-based — system_prompt is session metadata, hashed by the
 *     adapter, plaintext never crosses the trust boundary):
 *       hash(system_prompt) repeated across ≥3 Hermes sessions within 24h with
 *       rising input_tokens. Per Gate A, Hermes adapter emits agent=null in
 *       v1 — cohort identity is the system_prompt hash alone, never agent.
 *   - Paperclip (structural-only — finance_events are billing emissions):
 *       ≥5 events for same source_agent_id + model within 10 min (first-5
 *       window).
 *
 * Severity is always `'warn'`. The spec reserves `'high'` for confirmed
 * problems; `loop_risk` only ever surfaces a possibility.
 */
export function detectLoopRisk(rows: NormalizedRow[], opts: DetectOpts = {}): Signal[] {
  const signals: Signal[] = [];

  // ── OpenClaw ──────────────────────────────────────────────────────────────
  // Group by (session_id, model). Filtered upstream to rows that actually
  // carry the keys we group on — null session/model/tokens can't participate.
  const ocBySession = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (r.source !== 'openclaw' || !r.session_id || !r.model || r.input_tokens == null) continue;
    const key = `${r.session_id}::${r.model}`;
    if (!ocBySession.has(key)) ocBySession.set(key, []);
    ocBySession.get(key)!.push(r);
  }
  for (const group of Array.from(ocBySession.values())) {
    if (group.length < 5) continue;
    group.sort((a: NormalizedRow, b: NormalizedRow) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    // Sliding 5-row window — emit only the first match per (session, model)
    // cohort to avoid spamming the same cohort with overlapping windows.
    for (let i = 0; i + 4 < group.length; i++) {
      const window = group.slice(i, i + 5);
      const dt = Date.parse(window[4].timestamp) - Date.parse(window[0].timestamp);
      if (dt > TEN_MIN_MS) continue;
      const tokens = window.map((r: NormalizedRow) => r.input_tokens!);
      const min = Math.min(...tokens);
      const max = Math.max(...tokens);
      // Guard against divide-by-zero. A 0-input-token row is unusual on its
      // own; 5 of them in a row would be flagged by other detectors anyway.
      if (min === 0) continue;
      if ((max - min) / min > 0.05) continue;
      // stopReason gate: every windowed row needs a non-null stopReason and
      // they must all match. Missing data → skip (defensive; we never infer).
      const stopReasons = window.map((r: NormalizedRow) => opts.stopReasonByRowId?.[r.row_id] ?? null);
      if (stopReasons.some((s: string | null) => s == null)) continue;
      const distinct = new Set(stopReasons);
      if (distinct.size > 1) continue;
      signals.push({
        kind: 'loop_risk',
        severity: 'warn',
        affected_row_ids: window.map((r: NormalizedRow) => r.row_id),
        detail: `OpenClaw: 5 same-shape calls in ${Math.round(dt / 60000)}min`,
      });
      break;
    }
  }

  // ── Hermes ────────────────────────────────────────────────────────────────
  // Group by system_prompt_hash alone — Gate A pins Hermes agent=null in v1,
  // so cohort identity is the hash from `opts.systemPromptHashByRowId` (the
  // adapter side-channel; plaintext never crosses the trust boundary). The
  // detector fires on the same system_prompt hash repeating across Hermes
  // sessions, regardless of whether `agent` is populated.
  const hsByHash = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (r.source !== 'hermes') continue;
    const hash = opts.systemPromptHashByRowId?.[r.row_id];
    if (!hash) continue;
    const key = `hermes::${hash}`;
    if (!hsByHash.has(key)) hsByHash.set(key, []);
    hsByHash.get(key)!.push(r);
  }
  for (const group of Array.from(hsByHash.values())) {
    if (group.length < 3) continue;
    group.sort((a: NormalizedRow, b: NormalizedRow) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const dt = Date.parse(group[group.length - 1].timestamp) - Date.parse(group[0].timestamp);
    if (dt > TWENTY_FOUR_H_MS) continue;
    // Rising-tokens trend: each subsequent row's input_tokens ≥ previous.
    // Treat null as 0 for monotonicity check (defensive — adapter normally
    // populates it).
    const tokens = group.map((r: NormalizedRow) => r.input_tokens ?? 0);
    let rising = true;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i] < tokens[i - 1]) { rising = false; break; }
    }
    if (!rising) continue;
    signals.push({
      kind: 'loop_risk',
      severity: 'warn',
      affected_row_ids: group.map((r: NormalizedRow) => r.row_id),
      detail: `Hermes: same system_prompt across ${group.length} sessions with rising tokens`,
    });
  }

  // ── Paperclip ─────────────────────────────────────────────────────────────
  // Group by (source_agent_id, model). source_agent_id is the raw upstream
  // Paperclip UUID; using the normalized `agent` here would conflate distinct
  // physical agents with shared display names.
  const pcByAgentModel = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (r.source !== 'paperclip' || !r.source_agent_id || !r.model) continue;
    const key = `${r.source_agent_id}::${r.model}`;
    if (!pcByAgentModel.has(key)) pcByAgentModel.set(key, []);
    pcByAgentModel.get(key)!.push(r);
  }
  for (const group of Array.from(pcByAgentModel.values())) {
    if (group.length < 5) continue;
    group.sort((a: NormalizedRow, b: NormalizedRow) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const dt = Date.parse(group[4].timestamp) - Date.parse(group[0].timestamp);
    if (dt > TEN_MIN_MS) continue;
    signals.push({
      kind: 'loop_risk',
      severity: 'warn',
      affected_row_ids: group.slice(0, 5).map((r: NormalizedRow) => r.row_id),
      detail: `Paperclip: 5 same-agent same-model events in ${Math.round(dt / 60000)}min`,
    });
  }

  return signals;
}

/**
 * `velocity_spike` — per-source rolling-window spend velocity.
 *
 * Catches sudden cost surges (e.g. runaway agent, mis-priced model) by
 * comparing the current hour's spend against a trimmed-mean baseline of the
 * preceding 7d of hourly spend.
 *
 * Per spec §"Drain detectors → 2. velocity_spike", ALL guards must pass before
 * a signal fires:
 *   1. ≥24 historical hourly buckets exist for that source — too little data
 *      and any "baseline" is noise.
 *   2. Trimmed-mean baseline (drop top + bottom 10% of hourly buckets) > $0 —
 *      a zero baseline makes any current spend "infinite ×" and would always
 *      fire; we suppress to avoid false positives during onboarding/idle.
 *   3. Current-hour spend > 4× baseline — conservative threshold; tighter
 *      multiples would alert on routine variance.
 *
 * Output attaches to the per-source-total tile, not individual rows, so
 * `affected_row_ids` is intentionally empty. Each source gets its own
 * independent velocity profile (loop iterates ['openclaw','hermes','paperclip']).
 *
 * Severity is always `'warn'` — a spike is a possibility flag, not a confirmed
 * incident; `'high'` is reserved for confirmed problems we don't compute in v1.
 *
 * Cost values come from `displayCostInternal` (see helper below) which
 * duplicates `display_cost_usd` to avoid a circular import with the
 * `cost-reporting` orchestrator.
 */
export function detectVelocitySpike(rows: NormalizedRow[], opts: VelocityOpts = {}): Signal[] {
  const now = opts.now ?? Date.now();
  const signals: Signal[] = [];
  const sources: Source[] = ['openclaw', 'hermes', 'paperclip'];

  for (const source of sources) {
    // Bucket hourly: hourEpoch → totalUsd. Current hour is tracked separately
    // so it never contaminates its own baseline.
    const hourBuckets = new Map<number, number>();
    let currentHourTotal = 0;
    const currentHourEpoch = Math.floor(now / ONE_HOUR_MS);
    const oldestAcceptedEpoch = currentHourEpoch - 7 * 24; // 7d window

    for (const row of rows) {
      if (row.source !== source) continue;
      const display = displayCostInternal(row);
      if (display === null) continue;
      const tEpoch = Math.floor(Date.parse(row.timestamp) / ONE_HOUR_MS);
      if (tEpoch === currentHourEpoch) {
        currentHourTotal += display;
      } else if (tEpoch >= oldestAcceptedEpoch && tEpoch < currentHourEpoch) {
        hourBuckets.set(tEpoch, (hourBuckets.get(tEpoch) ?? 0) + display);
      }
    }

    // Guard 1: ≥24 historical hourly buckets — protects against noisy
    // baselines on fresh installs.
    if (hourBuckets.size < 24) continue;

    // Trimmed-mean baseline: drop top + bottom 10% to dampen outliers (e.g.
    // a single bursty hour from yesterday shouldn't anchor today's threshold).
    const values = Array.from(hourBuckets.values()).sort((a, b) => a - b);
    const trim = Math.floor(values.length * TRIMMED_PCT);
    const trimmed = values.slice(trim, values.length - trim);
    const baseline = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;

    // Guard 2: positive baseline — see header comment for rationale.
    if (baseline <= 0) continue;

    // Guard 3: 4× threshold.
    if (currentHourTotal <= 4 * baseline) continue;

    signals.push({
      kind: 'velocity_spike',
      severity: 'warn',
      affected_row_ids: [], // attaches to per-source tile, not rows
      detail: `${source}: current hour $${currentHourTotal.toFixed(2)} vs baseline $${baseline.toFixed(2)} (${(currentHourTotal / baseline).toFixed(1)}×)`,
    });
  }

  return signals;
}

/**
 * Internal duplicate of `display_cost_usd` from cost-reporting.ts.
 *
 * Why duplicate? cost-reporting.ts imports from this module
 * (`detectSignals`); having this module import display_cost_usd back from
 * cost-reporting.ts would create a circular import. The logic is small and
 * stable — keep both copies aligned if either changes.
 */
function displayCostInternal(row: NormalizedRow): number | null {
  if (row.row_flags.includes('unsupported_currency')) return null;
  switch (row.cost_status) {
    case 'included':   return 0;
    case 'actual':     return row.actual_cost_usd;
    case 'estimated':  return row.estimated_cost_usd;
    case 'recomputed': return row.recomputed_cost_usd;
    default: return null;
  }
}

/**
 * `context_bloat` — per-session input-token growth.
 *
 * Catches sessions whose input footprint balloons over time (e.g. unpruned
 * conversation history, accumulating tool-call traces). Compares the first-5
 * vs last-5 input_tokens averages within a single session.
 *
 * Per spec §"Drain detectors → 3. context_bloat", ALL guards must pass:
 *   1. Same `source` AND same `session_id` — ensures we only compare rows
 *      from the same conversational thread. Paperclip rows have
 *      `session_id === null` and so are NEVER eligible (finance_events are
 *      billing emissions, not conversation turns).
 *   2. Every row in the cohort has a non-null `input_tokens` — we never
 *      synthesize tokens for missing data; null rows are filtered at intake
 *      so they can't poison the average.
 *   3. ≥10 rows in the session — small sessions don't have enough surface
 *      area to distinguish bloat from normal warm-up.
 *   4. First-5 average > 0 — guards against divide-by-zero and avoids
 *      labeling a 0→N transition as "bloat" (that's just a session warming
 *      up from cache hits).
 *   5. Last-5 average > 2× first-5 average — conservative multiplier; below
 *      this we'd alert on routine context growth.
 *
 * One signal per (source, session_id) pair max — `affected_row_ids` carries
 * the full ordered group so the UI can highlight the entire thread.
 *
 * Severity is always `'warn'` — bloat is a hint, not a confirmed problem;
 * `'high'` remains reserved for confirmed incidents we don't compute in v1.
 */
export function detectContextBloat(rows: NormalizedRow[]): Signal[] {
  const signals: Signal[] = [];
  // Group by (source, session_id). Filter at intake: any row missing
  // session_id (Paperclip) or input_tokens drops here so it can never
  // contaminate the cohort average downstream.
  const bySession = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (!r.session_id) continue; // Paperclip excluded (session_id always null)
    if (r.input_tokens == null) continue; // Need explicit tokens for fair comparison
    const key = `${r.source}::${r.session_id}`;
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key)!.push(r);
  }
  for (const group of Array.from(bySession.values())) {
    if (group.length < 10) continue;
    group.sort((a: NormalizedRow, b: NormalizedRow) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const first5 = group.slice(0, 5);
    const last5 = group.slice(-5);
    const avgFirst = first5.reduce((s: number, r: NormalizedRow) => s + r.input_tokens!, 0) / 5;
    const avgLast = last5.reduce((s: number, r: NormalizedRow) => s + r.input_tokens!, 0) / 5;
    // Guard against zero-baseline (divide-by-zero + meaningless multiplier).
    if (avgFirst <= 0) continue;
    // Conservative 2× threshold — see header comment.
    if (avgLast <= 2 * avgFirst) continue;
    signals.push({
      kind: 'context_bloat',
      severity: 'warn',
      affected_row_ids: group.map((r: NormalizedRow) => r.row_id),
      detail: `Session ${group[0].session_id}: input grew ${avgFirst.toFixed(0)} → ${avgLast.toFixed(0)} tokens (${(avgLast / avgFirst).toFixed(1)}×)`,
    });
    // Implicit: only one signal per (source, session_id) pair — the loop
    // body always pushes exactly once per qualifying group.
  }
  return signals;
}

/**
 * CacheDropOpts adds an optional `now` override so tests can pin the
 * "today" day-bucket; production always falls back to `Date.now()`.
 */
interface CacheDropOpts extends DetectOpts {
  /** Override "now" for tests; defaults to Date.now() */
  now?: number;
}

/**
 * `cache_drop` (Hermes) / `cache_drop_risk` (OpenClaw) — prompt-cache regression
 * within a stable cohort.
 *
 * Catches sudden cache-hit-rate collapse — typical causes include a system
 * prompt edit (cache invalidated server-side), prompt-prefix drift, or a
 * provider-side cache eviction. The hit lands as recoverable spend
 * (re-priming a once-stable prefix), so we want operators to see it fast.
 *
 * Per spec §"Drain detectors → 4. cache_drop":
 *   - Hermes: cohort key = `hermes::<system_prompt_hash>` from
 *     `opts.systemPromptHashByRowId` (precise — adapter side-channels the
 *     hash; plaintext never crosses the trust boundary). Emits `cache_drop`.
 *   - OpenClaw: cohort key = `openclaw::<agent>::<model>` (noisy fallback —
 *     OpenClaw's privacy guarantee blocks system_prompt access, so the cohort
 *     is structural-only). Emits `cache_drop_risk` to flag the looser
 *     identity guarantees.
 *   - Paperclip: cannot emit (finance_events carry no cache token data).
 *
 * ALL guards must pass:
 *   1. Both `cache_read_tokens` AND `input_tokens` non-null on every row in
 *      the cohort — null cells can't participate in a ratio.
 *   2. ≥3 comparable trailing days (where "comparable" means the day passes
 *      the volume floor). Below this, the trailing average is dominated by
 *      one-off variance.
 *   3. Volume floor: ≥10 calls/day OR ≥50k input+cache tokens/day per
 *      cohort. Either path qualifies a day — short-but-busy and
 *      long-but-quiet cohorts both deserve coverage.
 *   4. Today's cache ratio < 70% of the trailing average (i.e. >30% drop).
 *      Conservative threshold; tighter would alert on routine cache warm-up
 *      variance.
 *
 * Day bucketing uses `Math.floor(timestamp / ONE_DAY_MS)`, matching the
 * spec. The verify-script time anchor sits mid-day UTC so today's rows and
 * the trailing-day buckets sit cleanly inside their respective epoch
 * windows (same lesson as Task 8's hour-anchor — boundary fixtures are
 * brittle if anchored to midnight).
 *
 * Severity is always `'warn'` — a cache regression is recoverable spend, not
 * a confirmed incident; `'high'` remains reserved for confirmed problems
 * we don't compute in v1.
 */
export function detectCacheDrop(rows: NormalizedRow[], opts: CacheDropOpts = {}): Signal[] {
  const now = opts.now ?? Date.now();
  const signals: Signal[] = [];

  // Cohort key: Hermes by system_prompt_hash (precise); OpenClaw by
  // (agent, model) (structural fallback). Paperclip filtered upstream
  // because no cache_read_tokens are emitted.
  const cohorts = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (r.source === 'paperclip') continue; // no cache token data
    if (r.cache_read_tokens == null || r.input_tokens == null) continue;
    let key: string | null = null;
    if (r.source === 'hermes') {
      const hash = opts.systemPromptHashByRowId?.[r.row_id];
      if (!hash) continue;
      key = `hermes::${hash}`;
    } else if (r.source === 'openclaw') {
      if (!r.agent || !r.model) continue;
      key = `openclaw::${r.agent}::${r.model}`;
    }
    if (!key) continue;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key)!.push(r);
  }

  for (const [key, group] of Array.from(cohorts.entries())) {
    // Bucket each cohort by day (UTC epoch / ONE_DAY_MS).
    const byDay = new Map<number, NormalizedRow[]>();
    for (const r of group) {
      const dayEpoch = Math.floor(Date.parse(r.timestamp) / ONE_DAY_MS);
      if (!byDay.has(dayEpoch)) byDay.set(dayEpoch, []);
      byDay.get(dayEpoch)!.push(r);
    }

    const todayEpoch = Math.floor(now / ONE_DAY_MS);
    const todayRows = byDay.get(todayEpoch) ?? [];
    const trailingDays: NormalizedRow[][] = [];
    for (let d = 1; d <= 7; d++) {
      const rs = byDay.get(todayEpoch - d);
      if (rs) trailingDays.push(rs);
    }

    // Guard 1: ≥3 comparable trailing days (pre-volume-filter cheap check).
    if (trailingDays.length < 3) continue;

    // Guard 2: volume floor — ≥10 calls/day OR ≥50k input+cache tokens/day.
    // Either path qualifies; both today AND ≥3 trailing days must pass.
    const dayPasses = (rs: NormalizedRow[]): boolean => {
      if (rs.length >= 10) return true;
      const tokens = rs.reduce((s, r) => s + (r.input_tokens ?? 0) + (r.cache_read_tokens ?? 0), 0);
      return tokens >= 50000;
    };
    if (!dayPasses(todayRows)) continue;
    const trailingFiltered = trailingDays.filter(dayPasses);
    if (trailingFiltered.length < 3) continue;

    // Compute today's cache-read ratio + trailing-day average.
    // ratio = cache_read / (cache_read + input). denom>0 already implied by
    // non-null guard at intake, but defensive against an all-zero day.
    const ratio = (rs: NormalizedRow[]): number => {
      const cache = rs.reduce((s, r) => s + (r.cache_read_tokens ?? 0), 0);
      const input = rs.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
      const denom = cache + input;
      return denom > 0 ? cache / denom : 0;
    };
    const todayRatio = ratio(todayRows);
    const trailingAvg = trailingFiltered.reduce((s, rs) => s + ratio(rs), 0) / trailingFiltered.length;

    // Guard 3: positive trailing baseline. A 0 trailing avg means the cohort
    // never used cache to begin with — there's nothing to "drop".
    if (trailingAvg === 0) continue;
    // Guard 4: >30% drop ≡ today < 70% of trailing.
    if (todayRatio >= trailingAvg * 0.7) continue;

    const isHermes = key.startsWith('hermes::');
    const kind: Signal['kind'] = isHermes ? 'cache_drop' : 'cache_drop_risk';
    signals.push({
      kind,
      severity: 'warn',
      affected_row_ids: todayRows.map((r: NormalizedRow) => r.row_id),
      detail: `${kind}: ${(todayRatio * 100).toFixed(0)}% vs ${(trailingAvg * 100).toFixed(0)}% trailing avg (${((1 - todayRatio / trailingAvg) * 100).toFixed(0)}% drop)`,
    });
  }

  return signals;
}

/**
 * `simple_on_expensive` — per-row simple-call-on-expensive-model signal.
 *
 * Catches the obvious FinOps regression: a tiny request (small input, small
 * output, no tools) routed to a flagship-tier model. Most operators want a
 * cheaper tier here unless the call is actually exercising flagship reasoning.
 *
 * Per spec §"Drain detectors → 5. simple_on_expensive", the reviewer's STRICT gate —
 * every condition must be EXPLICITLY satisfied; null tokens / null
 * tool_call_count / unknown rate all suppress firing (we never infer):
 *   1. `input_tokens < 500` AND non-null
 *   2. `output_tokens < 200` AND non-null
 *   3. `tool_call_count === 0` (explicitly known — `null` does NOT count)
 *   4. `model` non-null
 *   5. Pricing tier match must succeed (`computeCost.matchedKey !== null`) —
 *      we don't fire on unknown models because the rate would be 0 (default
 *      tier) and the threshold check would silently pass without any
 *      meaningful comparison.
 *   6. Input rate > $5/Mtok input. We compute this by calling
 *      `computeCost(model, {input: 1_000_000, output: 0})` and reading
 *      `result.cost`: with output tokens = 0 the output rate doesn't
 *      contribute, so the returned cost equals USD per million input tokens.
 *
 * Output is per-row — `affected_row_ids: [r.row_id]` — so the UI can decorate
 * exactly the offending row in the call list. One signal per qualifying row;
 * no cohort grouping (each row stands on its own merits).
 *
 * Severity is always `'warn'` — a simple-on-expensive call is a hint to
 * downgrade the tier, not a confirmed incident; `'high'` remains reserved for
 * confirmed problems we don't compute in v1.
 */
const EXPENSIVE_THRESHOLD_PER_MTOK = 5; // $5/Mtok input
const SIMPLE_INPUT_MAX = 500;
const SIMPLE_OUTPUT_MAX = 200;

export function detectSimpleOnExpensive(rows: NormalizedRow[]): Signal[] {
  const signals: Signal[] = [];
  for (const r of rows) {
    // Strict gate: every condition must be explicitly satisfied. null → no fire.
    if (r.input_tokens == null || r.input_tokens >= SIMPLE_INPUT_MAX) continue;
    if (r.output_tokens == null || r.output_tokens >= SIMPLE_OUTPUT_MAX) continue;
    if (r.tool_call_count !== 0) continue; // null does NOT count — the reviewer's strict rule
    if (!r.model) continue;
    // Look up rate for the model. computeCost(1M input, 0 output) returns
    // USD/Mtok input directly (output rate doesn't contribute when output=0).
    const result = computeCost(r.model, { input: 1_000_000, output: 0 });
    if (result.matchedKey === null) continue; // unknown rate → don't fire
    const inputRatePerMtok = result.cost;
    if (inputRatePerMtok <= EXPENSIVE_THRESHOLD_PER_MTOK) continue;
    signals.push({
      kind: 'simple_on_expensive',
      severity: 'warn',
      affected_row_ids: [r.row_id],
      detail: `Simple call (${r.input_tokens} in / ${r.output_tokens} out, no tools) on ${r.model} ($${inputRatePerMtok.toFixed(2)}/Mtok)`,
    });
  }
  return signals;
}

/**
 * Aggregator — concatenates every detector's output and forwards it verbatim
 * to the orchestrator. Order is not load-bearing.
 */
export function detectSignals(rows: NormalizedRow[], opts: DetectOpts = {}): Signal[] {
  return [
    ...detectLoopRisk(rows, opts),
    ...detectVelocitySpike(rows, opts as VelocityOpts),
    ...detectContextBloat(rows),
    ...detectCacheDrop(rows, opts as CacheDropOpts),
    ...detectSimpleOnExpensive(rows),
  ];
}
