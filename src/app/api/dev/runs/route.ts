/**
 * Developer Tools runs listing.
 * GET /api/dev/runs -- alias for /api/dev/status's `activeRuns` field
 *                     so callers that only need the run list don't have
 *                     to read other gate state. Same read gate.
 *
 * Enumerates by simulation flag (not origin) so Mode A and Mode B runs
 * are both included. Each run reports its visibility mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkDevToolsReadGate } from '@/lib/services/dev-tools-gate';
import { queryAll } from '@/lib/db/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIMULATION_PREDICATE = (col: string) =>
  `(json_extract(${col}, '$.simulation') = 1 OR json_extract(${col}, '$.simulation') = true OR json_extract(${col}, '$.origin') = 'simulation')`;

export async function GET(request: NextRequest) {
  const blocked = checkDevToolsReadGate(request);
  if (blocked) return blocked;

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
    const merged = new Map<string, { runId: string; alerts: number; shieldScans: number; earliest: string | null; latest: string | null; visibilities: Set<string> }>();
    const upsert = (runId: string, alerts: number, shieldScans: number, earliest: string, latest: string, visibility: string | null) => {
      const existing = merged.get(runId);
      const v = visibility || 'unknown';
      if (existing) {
        existing.alerts += alerts;
        existing.shieldScans += shieldScans;
        if (!existing.earliest || (earliest && earliest < existing.earliest)) existing.earliest = earliest;
        if (!existing.latest || (latest && latest > existing.latest)) existing.latest = latest;
        existing.visibilities.add(v);
      } else {
        merged.set(runId, { runId, alerts, shieldScans, earliest, latest, visibilities: new Set([v]) });
      }
    };
    for (const r of alertRows) upsert(r.run_id, r.cnt, 0, r.earliest, r.latest, r.visibility);
    for (const r of shieldRows) upsert(r.run_id, 0, r.cnt, r.earliest, r.latest, r.visibility);

    const runs = Array.from(merged.values()).map(({ visibilities, ...rest }) => {
      const known = Array.from(visibilities).filter(v => v === 'simulation-only' || v === 'default-counters');
      let visibility: 'simulation-only' | 'default-counters' | 'mixed' | 'unknown' = 'unknown';
      if (known.length === 1) visibility = known[0] as 'simulation-only' | 'default-counters';
      else if (known.length > 1) visibility = 'mixed';
      return { ...rest, visibility };
    }).sort((a, b) => (b.latest || '').localeCompare(a.latest || ''));
    return NextResponse.json({ ok: true, runs, count: runs.length });
  } catch (err) {
    console.error('[API/dev/runs] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
