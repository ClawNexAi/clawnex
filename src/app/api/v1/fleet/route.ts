/**
 * Public API — Fleet
 * GET /api/v1/fleet
 *
 * Scope: "fleet:read"
 * Delegates to the internal fleet logic (re-uses the same data assembly).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authenticateRequest } from '@/lib/middleware/api-auth';
import { getOpenClawConnector } from '@/lib/connectors/openclaw-connector';
import { getFullSystemReport } from '@/lib/services/system-metrics';
import { queryOne, queryAll } from '@/lib/db/index';
import { activeAlertSqlClause, productionOriginSqlClause } from '@/lib/dashboard/metric-semantics';
import { getLatestClawkeeperPosture } from '@/lib/services/posture-service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GatewayRow {
  id: string;
  name: string;
  url: string;
  client_name: string;
  is_active: number;
  is_primary: number;
  status: string;
  last_connected_at: string | null;
  last_error: string | null;
}

function readOpenClawConfig(): Record<string, unknown> | null {
  try {
    const ocPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    return JSON.parse(fs.readFileSync(ocPath, 'utf-8'));
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();

  // Authenticate
  const auth = authenticateRequest(request, 'fleet:read');
  if (!auth.authenticated) {
    const res = NextResponse.json(
      { ok: false, error: auth.error, meta: { requestId, timestamp } },
      { status: auth.status || 401 },
    );
    if (auth.rateLimit) {
      res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
      res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
      res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
    }
    return res;
  }

  try {
    const { searchParams } = new URL(request.url);
    const since = searchParams.get('since');

    const connector = getOpenClawConnector();
    const ocStatus = connector.getConnectionStatus();
    const sysReport = getFullSystemReport();
    const ocConfig = readOpenClawConfig();

    // Count active alerts (canonical: open + acknowledged + investigating).
    // See `lib/dashboard/metric-semantics.ts`. The public v1 fleet API mirrors
    // the internal /api/fleet definition so external integrations and the
    // dashboard see the same number for the same scope.
    let openAlerts = 0;
    try {
      const activeClause = activeAlertSqlClause();
      // Mirror /api/fleet exactly: exclude shield-test / demo / qa-origin alerts
      // so the public API and the dashboard report the same active-alert count.
      // Without this filter, external integrations saw test-generated alerts
      // inflate the number relative to what the operator sees in the UI.
      const prodClause = productionOriginSqlClause('metadata');
      const alertCount = queryOne<{ cnt: number }>(
        since
          ? `SELECT COUNT(*) as cnt FROM alerts WHERE ${activeClause} AND ${prodClause} AND created_at >= ?`
          : `SELECT COUNT(*) as cnt FROM alerts WHERE ${activeClause} AND ${prodClause} AND created_at >= datetime('now', '-24 hours')`,
        since ? [since] : []
      );
      openAlerts = alertCount?.cnt || 0;
    } catch { /* ignore */ }

    // Count shield blocks
    let shieldBlocks = 0;
    try {
      const blockCount = queryOne<{ cnt: number }>(
        since
          ? "SELECT COUNT(*) as cnt FROM proxy_traffic WHERE (shield_verdict = 'BLOCK' OR blocked = 1) AND source != 'session-watcher' AND timestamp >= ?"
          : "SELECT COUNT(*) as cnt FROM proxy_traffic WHERE (shield_verdict = 'BLOCK' OR blocked = 1) AND source != 'session-watcher' AND timestamp >= datetime('now', '-24 hours')",
        since ? [since] : []
      );
      shieldBlocks = blockCount?.cnt || 0;
    } catch { /* ignore */ }

    // Agent count
    let agentCount = 0;
    if (ocConfig) {
      const agentsList = (ocConfig?.agents as { list?: Array<{ id: string }> })?.list || [];
      agentCount = agentsList.filter(a => a.id !== 'main').length;
    }

    // Session count
    let sessionCount = 0;
    try {
      const sessDir = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions');
      sessionCount = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl')).length;
    } catch { /* ignore */ }

    const ocVersion = (ocConfig?.meta as { lastTouchedVersion?: string })?.lastTouchedVersion || 'unknown';

    // Posture score (Phase 3): canonical Host Security hardening score.
    // Returns null when no scan has been run yet — public API consumers
    // get an explicit `null` instead of a fake placeholder so they can
    // render "unscanned" rather than "50%".
    let postureScore: number | null = null;
    try {
      const latest = getLatestClawkeeperPosture();
      postureScore = latest ? latest.score : null;
    } catch { /* ignore */ }

    const localInstance = {
      id: 'openclaw-local',
      version: ocVersion,
      status: ocStatus.connected ? 'healthy' : ocStatus.lastError ? 'critical' : 'degraded',
      uptime: process.uptime(),
      cpu: sysReport.system?.cpuUsage ?? 0,
      mem: sysReport.system?.memUsage ?? 0,
      threats: shieldBlocks,
      alerts: openAlerts,
      agents: agentCount || ocStatus.agents || 0,
      sessions: sessionCount || ocStatus.sessions || 0,
      posture: postureScore,
    };

    const instances = [localInstance];

    // Gateway instances
    try {
      const gateways = queryAll<GatewayRow>(
        'SELECT * FROM config_gateways WHERE is_active = 1 ORDER BY is_primary DESC, name ASC',
      );
      for (const gw of gateways) {
        if (gw.is_primary) continue;
        instances.push({
          id: gw.id,
          version: '--',
          status: gw.status === 'connected' ? 'healthy' : gw.status === 'error' ? 'critical' : 'degraded',
          uptime: 0, cpu: 0, mem: 0, threats: 0, alerts: 0,
          agents: 0, sessions: 0, posture: gw.status === 'connected' ? 80 : 30,
        });
      }
    } catch { /* ignore */ }

    const res = NextResponse.json({
      ok: true,
      data: { instances, total: instances.length, healthy: instances.filter(i => i.status === 'healthy').length },
      meta: { requestId, timestamp },
    });
    if (auth.rateLimit) {
      res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
      res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
      res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
    }
    return res;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error', meta: { requestId, timestamp } },
      { status: 500 },
    );
  }
}
