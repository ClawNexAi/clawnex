/**
 * Developer Tools status probe.
 * GET /api/dev/status -- reports gate state + active simulation runs
 *                       so the dashboard can decide what to render.
 * No mutation. Read gate only (env kill switch + auth).
 *
 * Active runs are enumerated by `simulation: true` metadata (not by
 * origin) so both Mode A (origin='simulation') and Mode B
 * (origin='production', visibleToDefaultCounters) runs are included.
 * Per-run mode is reported via `visibility` field so the dashboard
 * ribbon can escalate visual treatment when Mode B runs are active.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  checkDevToolsReadGate,
  isDevToolsEnvAllowed,
  isDevToolsDbEnabled,
} from '@/lib/services/dev-tools-gate';
import { queryAll } from '@/lib/db/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RunSummary {
  runId: string;
  alerts: number;
  shieldScans: number;
  earliest: string | null;
  latest: string | null;
  /**
   * Mode A = 'simulation-only' (origin='simulation', excluded from default counters).
   * Mode B = 'default-counters' (origin='production', INCLUDED in default counters).
   * Read from metadata.simulation_visibility on the alerts; falls back to
   * deriving from origin when the field is missing (legacy rows).
   */
  visibility: 'simulation-only' | 'default-counters' | 'mixed' | 'unknown';
}

// Match all rows the fixture inserted (Mode A or Mode B) by the
// simulation flag. SQLite stores booleans as 1/0; we accept both forms.
const SIMULATION_PREDICATE = (col: string) =>
  `(json_extract(${col}, '$.simulation') = 1 OR json_extract(${col}, '$.simulation') = true OR json_extract(${col}, '$.origin') = 'simulation')`;

export async function GET(request: NextRequest) {
  const blocked = checkDevToolsReadGate(request);
  if (blocked) return blocked;

  const envAllowed = isDevToolsEnvAllowed();
  const dbEnabled = isDevToolsDbEnabled();
  const available = envAllowed && dbEnabled;

  let activeRuns: RunSummary[] = [];
  if (available) {
    try {
      const alertRows = queryAll<{ run_id: string; cnt: number; earliest: string; latest: string; visibility: string | null }>(
        `SELECT
            json_extract(metadata, '$.simulation_run_id') as run_id,
            COUNT(*) as cnt,
            MIN(created_at) as earliest,
            MAX(created_at) as latest,
            json_extract(metadata, '$.simulation_visibility') as visibility
          FROM alerts
          WHERE ${SIMULATION_PREDICATE('metadata')}
            AND json_extract(metadata, '$.simulation_run_id') IS NOT NULL
          GROUP BY run_id, visibility`,
      );
      const shieldRows = queryAll<{ run_id: string; cnt: number; earliest: string; latest: string; visibility: string | null }>(
        `SELECT
            json_extract(detail, '$.simulation_run_id') as run_id,
            COUNT(*) as cnt,
            MIN(scanned_at) as earliest,
            MAX(scanned_at) as latest,
            json_extract(detail, '$.simulation_visibility') as visibility
          FROM shield_scans
          WHERE ${SIMULATION_PREDICATE('detail')}
            AND json_extract(detail, '$.simulation_run_id') IS NOT NULL
          GROUP BY run_id, visibility`,
      );

      const merged = new Map<string, RunSummary & { visibilities: Set<string> }>();
      const upsert = (
        runId: string,
        alerts: number,
        shieldScans: number,
        earliest: string,
        latest: string,
        visibility: string | null,
      ) => {
        const existing = merged.get(runId);
        const v = visibility || 'unknown';
        if (existing) {
          existing.alerts += alerts;
          existing.shieldScans += shieldScans;
          if (!existing.earliest || (earliest && earliest < existing.earliest)) existing.earliest = earliest;
          if (!existing.latest || (latest && latest > existing.latest)) existing.latest = latest;
          existing.visibilities.add(v);
        } else {
          merged.set(runId, {
            runId,
            alerts,
            shieldScans,
            earliest,
            latest,
            visibility: 'unknown',
            visibilities: new Set([v]),
          });
        }
      };
      for (const r of alertRows) upsert(r.run_id, r.cnt, 0, r.earliest, r.latest, r.visibility);
      for (const r of shieldRows) upsert(r.run_id, 0, r.cnt, r.earliest, r.latest, r.visibility);

      // Resolve per-run visibility from the collected set. A run with
      // mixed visibilities (shouldn't normally happen but we report
      // honestly if it does) shows 'mixed' in the ribbon.
      activeRuns = Array.from(merged.values()).map(({ visibilities, ...rest }) => {
        const known = Array.from(visibilities).filter(v => v === 'simulation-only' || v === 'default-counters');
        let visibility: RunSummary['visibility'] = 'unknown';
        if (known.length === 1) visibility = known[0] as 'simulation-only' | 'default-counters';
        else if (known.length > 1) visibility = 'mixed';
        return { ...rest, visibility };
      }).sort((a, b) => (b.latest || '').localeCompare(a.latest || ''));
    } catch (err) {
      console.error('[API/dev/status] active-runs query error:', err);
      activeRuns = [];
    }
  }

  // Top-level breakdown so the dashboard ribbon can escalate visual
  // treatment when any Mode B run is active (Mode B rows light up
  // default production counters; that's a louder warning state than
  // Mode A's quiet "this is excluded from counters" tag).
  const modeBRunCount = activeRuns.filter(r => r.visibility === 'default-counters' || r.visibility === 'mixed').length;
  const modeARunCount = activeRuns.filter(r => r.visibility === 'simulation-only' || r.visibility === 'unknown').length;

  return NextResponse.json({
    envAllowed,
    dbEnabled,
    available,
    activeRuns,
    activeRunCount: activeRuns.length,
    modeARunCount,
    modeBRunCount,
  });
}
