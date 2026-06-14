/**
 * Developer Tools reset endpoint.
 * POST /api/dev/reset -- removes simulation rows from the DB.
 *
 * Body:
 *   { runId: string }     -- removes rows tagged with that simulation_run_id
 *   { all: true }         -- removes ALL simulation rows regardless of run-id
 *
 * Three-layer gate (env + DB toggle + RBAC). Audit-logged with the
 * removed-row counts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkDevToolsGate } from '@/lib/services/dev-tools-gate';
import {
  resetDashboardTraffic,
  resetAllDashboardTraffic,
} from '../../../../../scripts/dashboard-traffic-fixture';
import { logEvent } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const blocked = checkDevToolsGate(request);
  if (blocked) return blocked;

  let body: { runId?: string; all?: boolean };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.all === true) {
    try {
      const result = resetAllDashboardTraffic();
      logEvent(
        'config',
        'dev_tools_reset_all',
        'simulation',
        '*',
        `Reset ALL simulation runs (${result.runsRemoved} runs, ${result.removed.alerts} alerts, ${result.removed.shieldScans} shield scans).`,
        'api',
      );
      return NextResponse.json({
        ok: true,
        scope: 'all',
        runsRemoved: result.runsRemoved,
        removed: result.removed,
        message: `Reset complete: ${result.runsRemoved} runs cleared, ${result.removed.alerts} alerts + ${result.removed.shieldScans} shield scans + ${result.removed.proxyTraffic} proxy rows removed.`,
      });
    } catch (err) {
      console.error('[API/dev/reset] all error:', err);
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
        { status: 500 },
      );
    }
  }

  const runId = (body.runId || '').trim();
  if (!runId) {
    return NextResponse.json(
      { ok: false, error: 'Missing runId. Pass { runId: "..." } to remove a specific run, or { all: true } to remove every simulation run.' },
      { status: 400 },
    );
  }

  try {
    const removed = resetDashboardTraffic(runId);
    logEvent(
      'config',
      'dev_tools_reset',
      'simulation',
      runId,
      `Reset simulation run ${runId}: ${removed.alerts} alerts, ${removed.shieldScans} shield scans, ${removed.proxyTraffic} proxy rows.`,
      'api',
    );
    return NextResponse.json({
      ok: true,
      scope: 'run',
      runId,
      removed,
      message: `Reset run-id ${runId}: ${removed.alerts} alerts + ${removed.shieldScans} shield scans + ${removed.proxyTraffic} proxy rows removed.`,
    });
  } catch (err) {
    console.error('[API/dev/reset] run error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
