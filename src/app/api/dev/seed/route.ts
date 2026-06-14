/**
 * Developer Tools seed endpoint.
 * POST /api/dev/seed -- runs scripts/dashboard-traffic-fixture.ts via
 *                      the seedDashboardTraffic() export. Three-layer
 *                      gate (env + DB toggle + RBAC system:manage).
 *                      Audit-logged.
 *
 * Body: {
 *   runId?: string,
 *   profile?: 'standard' | 'intense' | 'quiet',
 *   visibleToDefaultCounters?: boolean   // Mode B (internal reviewer follow-up 2026-04-29)
 * }
 *
 * Mode B requires `confirm_phrase: 'light up default counters'` for an
 * explicit second-gate confirmation (the dashboard UI types it for the
 * operator; CLI callers must include it explicitly). This is the
 * production-visible mode -- rows write origin='production' so Fleet /
 * header / Shield default counters include them. Reset still scopes
 * by simulation metadata regardless of mode, so removal is precise.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkDevToolsGate } from '@/lib/services/dev-tools-gate';
import { seedDashboardTraffic } from '../../../../../scripts/dashboard-traffic-fixture';
import { logEvent } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_PROFILES = new Set(['standard', 'intense', 'quiet']);
const MODE_B_CONFIRM_PHRASE = 'light up default counters';

export async function POST(request: NextRequest) {
  const blocked = checkDevToolsGate(request);
  if (blocked) return blocked;

  let body: { runId?: string; profile?: string; visibleToDefaultCounters?: boolean; confirm_phrase?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const profile = body.profile && VALID_PROFILES.has(body.profile) ? body.profile : 'standard';
  const visibleToDefaultCounters = Boolean(body.visibleToDefaultCounters);
  // Auto-generate a run-id when the operator hasn't supplied one. Format
  // is human-readable + sortable so it's obvious in the active-runs list.
  // Mode B runs get a `mode-b-` prefix so the active-runs list and audit
  // trail can distinguish at a glance.
  const defaultRunId = visibleToDefaultCounters
    ? `mode-b-qa-${new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '-').slice(0, 19)}`
    : `qa-${new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '-').slice(0, 19)}`;
  const runId = (body.runId || '').trim() || defaultRunId;

  // Mode B is the more dangerous mode (rows pollute default counters).
  // Require an explicit second-gate confirmation phrase so a bored click
  // or replayed CLI invocation doesn't accidentally enable it.
  if (visibleToDefaultCounters && body.confirm_phrase !== MODE_B_CONFIRM_PHRASE) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Mode B (visibleToDefaultCounters) requires confirm_phrase to match the second-gate phrase exactly.',
        hint: `Send confirm_phrase: '${MODE_B_CONFIRM_PHRASE}' alongside visibleToDefaultCounters: true. The dashboard UI handles this automatically once the operator types the phrase.`,
      },
      { status: 400 },
    );
  }

  try {
    const result = seedDashboardTraffic({
      runId,
      profile: profile as 'standard' | 'intense' | 'quiet',
      visibleToDefaultCounters,
    });
    logEvent(
      'config',
      'dev_tools_seed',
      'simulation',
      runId,
      `Seeded simulation run ${runId} (profile=${profile}, mode=${visibleToDefaultCounters ? 'B-visible-to-default-counters' : 'A-simulation-only'}): ${result.inserted.alerts} alerts, ${result.inserted.shieldScans} shield scans, ${result.inserted.proxyTraffic} proxy rows.`,
      'api',
    );
    const modeNote = visibleToDefaultCounters
      ? `Mode B: rows tagged origin='production' so Fleet / header / Shield default counters include them. Reset by run-id removes them precisely.`
      : `Mode A: rows tagged origin='simulation', excluded from production-grade counters by default. Use ?includeTestGenerated=true on shield routes or Mode B if you need the default counters to light up.`;
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      profile,
      visibleToDefaultCounters,
      inserted: result.inserted,
      message: `Seeded ${result.inserted.alerts} alerts + ${result.inserted.shieldScans} shield scans + ${result.inserted.proxyTraffic} proxy rows under run-id ${runId}. ${modeNote}`,
    });
  } catch (err) {
    console.error('[API/dev/seed] error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        hint: 'Check server logs and verify DATABASE_PATH is writable.',
      },
      { status: 500 },
    );
  }
}
