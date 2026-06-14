/**
 * Audit API
 * GET /api/audit — list audit events with optional filters
 *
 * Query params: ?source=shield&action=shield_block&actor=clawnex&limit=50
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { listEvents, deleteEvents, countEvents, logEvent, parseAuditLimitOrReject, parseAuditDateOrReject } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'audit:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
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
    const instance = searchParams.get('instance');

    if (source) filters.source = source;
    // Map instance to source filter when no explicit source is set
    if (!source && instance === 'hermes-local') filters.source = 'hermes-watcher';
    if (action) filters.action = action;
    if (actor) filters.actor = actor;
    if (resource_type) filters.resource_type = resource_type;
    // DAST 2026-05-16 Finding 2: since/until must be strict ISO 8601 or
    // we 400. Previously a string like "notadate" passed through to SQL
    // TEXT comparison, silently filtered nothing, returned 200 with the
    // full result set.
    const sinceParse = parseAuditDateOrReject(since, 'since');
    if (!sinceParse.ok) {
      return NextResponse.json({ error: sinceParse.error }, { status: 400 });
    }
    if (sinceParse.value) filters.since = sinceParse.value;
    const untilParse = parseAuditDateOrReject(until, 'until');
    if (!untilParse.ok) {
      return NextResponse.json({ error: untilParse.error }, { status: 400 });
    }
    if (untilParse.value) filters.until = untilParse.value;
    // DAST 2026-05-15 Run 2 #M4: reject invalid/out-of-range limit at
    // the route boundary with 400. Internal callers continue to use
    // clampAuditLimit (defense-in-depth in listEvents).
    const limitParse = parseAuditLimitOrReject(limitParam);
    if (!limitParse.ok) {
      return NextResponse.json({ error: limitParse.error }, { status: 400 });
    }
    filters.limit = limitParse.limit;
    if (exclude) filters.exclude_actions = exclude.split(',').map(s => s.trim());
    if (search) filters.search = search;

    let events = listEvents(filters as {
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

    // Instance-level filtering: exclude hermes-watcher events for openclaw instances
    if (!source && instance && instance !== 'all' && instance !== 'hermes-local') {
      events = events.filter(e => e.source !== 'hermes-watcher');
    }

    return NextResponse.json({
      events,
      total: events.length,
      filters: { source, action, actor, resource_type, since, until },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/audit] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/audit — clear audit events older than a given date.
 * Query params: ?olderThan=ISO8601
 */
export async function DELETE(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'audit:clear');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const olderThan = searchParams.get('olderThan');

    if (!olderThan) {
      return NextResponse.json(
        { error: "Missing 'olderThan' query parameter (ISO 8601 date)" },
        { status: 400 },
      );
    }

    const count = countEvents(olderThan);
    if (count === 0) {
      return NextResponse.json({
        deleted: 0,
        message: 'No audit events found in the specified range.',
        timestamp: new Date().toISOString(),
      });
    }

    const deleted = deleteEvents(olderThan);

    // Log the clear action itself
    const operator = getOperatorFromRequest(request);
    const actor = operator?.username || 'operator';
    logEvent(actor, 'audit_clear', 'audit_log', undefined, `Cleared ${deleted} audit events older than ${olderThan}`, 'dashboard');

    return NextResponse.json({
      deleted,
      olderThan,
      message: `Successfully cleared ${deleted} audit events.`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/audit DELETE] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
