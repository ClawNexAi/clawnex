// scripts/verify-correlation-route-behavior.ts
//
// Hermetic route-level proof for /api/correlations/evaluate:
// - GET evaluates the current state but does not persist correlation_events or
//   metric_snapshots.
// - POST evaluates the same state and persists both correlation evidence and
//   the active threat-score snapshot.

process.env.DATABASE_PATH = ':memory:';
process.env.CLAWNEX_LOG_DIR = `/tmp/clawnex-verify-logs-${process.pid}`;
process.env.CLAWNEX_AUDIT_STDOUT = 'false';
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.RBAC_ENABLED = 'false';
process.env.NEXT_PUBLIC_RBAC_ENABLED = 'false';
process.env.HOSTNAME = '127.0.0.1';

import { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';

type CorrelationEvaluateRoute = {
  GET: (request: NextRequest) => Promise<NextResponse>;
  POST: (request: NextRequest) => Promise<NextResponse>;
};

let pass = 0;
let fail = 0;
type DbModule = typeof import('../src/lib/db/index');
let queryOne: DbModule['queryOne'];
let run: DbModule['run'];

function check(name: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function scalar(sql: string): number {
  return queryOne<{ cnt: number }>(sql)?.cnt ?? 0;
}

function req(method: 'GET' | 'POST'): NextRequest {
  return new NextRequest('http://127.0.0.1:5001/api/correlations/evaluate', { method });
}

async function main(): Promise<void> {
  const db = await import('../src/lib/db/index');
  queryOne = db.queryOne;
  run = db.run;

  const routeModule = await import('../src/app/api/correlations/evaluate/route') as unknown as CorrelationEvaluateRoute & {
    default?: CorrelationEvaluateRoute;
    "module.exports"?: CorrelationEvaluateRoute;
  };
  const route = routeModule.default ?? routeModule["module.exports"] ?? routeModule;

  for (let i = 0; i < 21; i++) {
    run(
      `INSERT INTO alerts (id, title, description, severity, source, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, 'HIGH', 'shield', 'open', ?, datetime('now'), datetime('now'))`,
      [
        `verify-alert-${i}`,
        `Verify active alert ${i}`,
        'route behavior fixture',
        JSON.stringify({ origin: 'production', verifier: 'verify-correlation-route-behavior' }),
      ],
    );
  }
  run(
    `INSERT INTO alerts (id, title, description, severity, source, status, metadata, created_at, updated_at)
     VALUES ('verify-demo-alert', 'Verify dashboard demo fixture', 'must be ignored despite production origin', 'CRITICAL', 'shield', 'open', ?, datetime('now'), datetime('now'))`,
    [
      JSON.stringify({
        origin: 'production',
        simulation: true,
        simulation_source: 'dashboard-traffic-fixture',
        verifier: 'verify-correlation-route-behavior',
      }),
    ],
  );

  const beforeEvents = scalar('SELECT COUNT(*) as cnt FROM correlation_events');
  const beforeSnapshots = scalar("SELECT COUNT(*) as cnt FROM metric_snapshots WHERE source = 'correlation-engine'");

  const getResponse = await route.GET(req('GET'));
  const getPayload = await getResponse.json() as Record<string, unknown>;
  check('GET returns 200', getResponse.status === 200);
  check('GET returns active score fields', typeof getPayload.threat_score === 'number' && Array.isArray(getPayload.rules));
  check('GET includes gross/suppression/state payload fields', 'threat_score_gross' in getPayload && 'suppressedRules' in getPayload && 'state_summary' in getPayload);
  const getState = getPayload.state_summary as { active_alerts?: number; open_alerts?: number } | undefined;
  check('GET sees seeded active alerts and excludes dashboard demo fixtures', getState?.active_alerts === 21);
  check('GET keeps open_alerts compatibility alias equal to active alerts', getState?.open_alerts === 21);
  check('GET does not persist correlation_events', scalar('SELECT COUNT(*) as cnt FROM correlation_events') === beforeEvents);
  check("GET does not write correlation-engine metric_snapshots", scalar("SELECT COUNT(*) as cnt FROM metric_snapshots WHERE source = 'correlation-engine'") === beforeSnapshots);

  const postResponse = await route.POST(req('POST'));
  const postPayload = await postResponse.json() as Record<string, unknown>;
  check('POST returns 200', postResponse.status === 200);
  check('POST returns same payload shape', 'threat_score_gross' in postPayload && 'suppressedRules' in postPayload && 'state_summary' in postPayload);
  check('POST triggered at least one correlation rule', (postPayload.triggered_count_gross as number) > 0);
  check('POST persists correlation_events', scalar('SELECT COUNT(*) as cnt FROM correlation_events') > beforeEvents);
  check("POST writes correlation-engine metric_snapshots", scalar("SELECT COUNT(*) as cnt FROM metric_snapshots WHERE source = 'correlation-engine'") > beforeSnapshots);
  check('POST-created alert source remains correlation-engine', scalar("SELECT COUNT(*) as cnt FROM alerts WHERE source = 'correlation-engine'") > 0);

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
