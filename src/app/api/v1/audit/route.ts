/**
 * Public API — Audit Log
 * GET /api/v1/audit
 *
 * Scope: "audit:read"
 * Delegates to the internal audit-logger service.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authenticateRequest } from '@/lib/middleware/api-auth';
import { listEvents, parseAuditLimitOrReject, parseAuditDateOrReject } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();

  // Authenticate
  const auth = authenticateRequest(request, 'audit:read');
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
    const source = searchParams.get('source');
    const action = searchParams.get('action');
    const actor = searchParams.get('actor');
    const resource_type = searchParams.get('resource_type');
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const limitParam = searchParams.get('limit');
    const exclude = searchParams.get('exclude_actions');
    const search = searchParams.get('search');

    if (source) filters.source = source;
    if (action) filters.action = action;
    if (actor) filters.actor = actor;
    if (resource_type) filters.resource_type = resource_type;
    // DAST 2026-05-16 Finding 2: since/until must be strict ISO 8601 or
    // we 400. Same shape as the internal /api/audit reject path.
    const sinceParse = parseAuditDateOrReject(since, 'since');
    if (!sinceParse.ok) {
      const res = NextResponse.json(
        { ok: false, error: sinceParse.error, meta: { requestId, timestamp } },
        { status: 400 },
      );
      if (auth.rateLimit) {
        res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
        res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
        res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
      }
      return res;
    }
    if (sinceParse.value) filters.since = sinceParse.value;
    const untilParse = parseAuditDateOrReject(until, 'until');
    if (!untilParse.ok) {
      const res = NextResponse.json(
        { ok: false, error: untilParse.error, meta: { requestId, timestamp } },
        { status: 400 },
      );
      if (auth.rateLimit) {
        res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
        res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
        res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
      }
      return res;
    }
    if (untilParse.value) filters.until = untilParse.value;
    // DAST 2026-05-15 Run 2 #M4: reject invalid/out-of-range limit at
    // the route boundary with 400. Internal callers continue to use
    // clampAuditLimit (defense-in-depth in listEvents).
    const limitParse = parseAuditLimitOrReject(limitParam);
    if (!limitParse.ok) {
      const res = NextResponse.json(
        { ok: false, error: limitParse.error, meta: { requestId, timestamp } },
        { status: 400 },
      );
      if (auth.rateLimit) {
        res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
        res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
        res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
      }
      return res;
    }
    filters.limit = limitParse.limit;
    if (exclude) filters.exclude_actions = exclude.split(',').map(s => s.trim());
    if (search) filters.search = search;

    const events = listEvents(filters as {
      source?: string;
      action?: string;
      actor?: string;
      resource_type?: string;
      since?: string;
      until?: string;
      limit?: number;
      exclude_actions?: string[];
      search?: string;
    });

    const res = NextResponse.json({
      ok: true,
      data: { events, total: events.length, filters: { source, action, actor, resource_type, since, until } },
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
