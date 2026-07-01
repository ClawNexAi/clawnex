/**
 * Public API — Alerts
 * GET /api/v1/alerts
 *
 * Scope: "alerts:read"
 * Delegates to the internal alert-manager service.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authenticateRequest } from '@/lib/middleware/api-auth';
import { listAlerts } from '@/lib/services/alert-manager';
import { isAlertScope } from '@/lib/dashboard/metric-semantics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();

  // Authenticate
  const auth = authenticateRequest(request, 'alerts:read');
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

    const filters: Record<string, unknown> = {};
    const status = searchParams.get('status');
    const scopeParam = searchParams.get('scope');
    const severity = searchParams.get('severity');
    const source = searchParams.get('source');
    const since = searchParams.get('since');
    const limitParam = searchParams.get('limit');

    if (status) filters.status = status;
    else if (scopeParam) {
      if (!isAlertScope(scopeParam)) {
        return NextResponse.json(
          { ok: false, error: 'Invalid scope. Must be one of: active, terminal, all', meta: { requestId, timestamp } },
          { status: 400 },
        );
      }
      filters.scope = scopeParam;
    }
    if (severity) filters.severity = severity;
    if (source) filters.source = source;
    if (since) filters.since = since;
    if (limitParam) filters.limit = Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500);
    if (searchParams.get('include_suppressed') === 'true') filters.include_suppressed = true;
    if (searchParams.get('productionOnly') === 'true') filters.productionOnly = true;

    const alerts = listAlerts(filters as { status?: string; scope?: 'active' | 'terminal' | 'all'; severity?: string; source?: string; since?: string; limit?: number; include_suppressed?: boolean; productionOnly?: boolean });

    const res = NextResponse.json({
      ok: true,
      data: {
        alerts,
        total: alerts.length,
        filters: { status, scope: scopeParam, severity, source, since, productionOnly: Boolean(filters.productionOnly) },
      },
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
