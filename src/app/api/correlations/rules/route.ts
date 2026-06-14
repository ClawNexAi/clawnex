/**
 * Custom Correlation Rules API
 *
 * GET    /api/correlations/rules — List all rules + available fields
 * POST   /api/correlations/rules — Create a new rule
 * PUT    /api/correlations/rules — Update a rule
 * DELETE /api/correlations/rules — Delete a rule
 * POST   /api/correlations/rules?evaluate=true — Evaluate all rules against recent traffic
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import {
  getRules,
  createRule,
  updateRule,
  deleteRule,
  evaluateRules,
  getAvailableFields,
} from '@/lib/services/custom-correlation';

function checkAuth(request: NextRequest, permission: string) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, permission as any);
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authErr = checkAuth(request, 'config:read');
  if (authErr) return authErr;

  const rules = getRules();
  const fields = getAvailableFields();

  return NextResponse.json({ rules, fields });
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const isEvaluate = url.searchParams.get('evaluate') === 'true';

  if (isEvaluate) {
    const authErr = checkAuth(request, 'alerts:manage');
    if (authErr) return authErr;

    const results = evaluateRules();
    return NextResponse.json({
      triggered: results.length,
      results: results.map(r => ({
        rule: { id: r.rule.id, name: r.rule.name, severity: r.rule.severity },
        matchCount: r.matchCount,
        weightedScore: r.weightedScore,
        topEvents: r.matchedEvents.slice(0, 5),
      })),
    });
  }

  const authErr = checkAuth(request, 'config:write');
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { name, description, severity, conditions, threshold, time_window_minutes, min_event_count, action } = body;

    if (!name || !conditions || !Array.isArray(conditions) || conditions.length === 0) {
      return NextResponse.json({ error: 'name and conditions (non-empty array) are required' }, { status: 400 });
    }

    // Validate conditions
    for (const c of conditions) {
      if (!c.field || !c.operator || c.value === undefined || !c.weight) {
        return NextResponse.json({ error: 'Each condition needs field, operator, value, and weight' }, { status: 400 });
      }
    }

    // Validate time_window_minutes: integer 1..10080 (1 week cap) — prevents SQL injection downstream
    if (time_window_minutes !== undefined) {
      const n = Number(time_window_minutes);
      if (!Number.isInteger(n) || n < 1 || n > 10080) {
        return NextResponse.json({ error: 'time_window_minutes must be an integer between 1 and 10080' }, { status: 400 });
      }
    }

    const rule = createRule({ name, description, severity, conditions, threshold, time_window_minutes, min_event_count, action });
    return NextResponse.json({ rule }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const authErr = checkAuth(request, 'config:write');
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Validate time_window_minutes on update if provided
    if (updates.time_window_minutes !== undefined) {
      const n = Number(updates.time_window_minutes);
      if (!Number.isInteger(n) || n < 1 || n > 10080) {
        return NextResponse.json({ error: 'time_window_minutes must be an integer between 1 and 10080' }, { status: 400 });
      }
    }

    const rule = updateRule(id, updates);
    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ rule });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const authErr = checkAuth(request, 'config:write');
  if (authErr) return authErr;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id query parameter required' }, { status: 400 });
  }

  const deleted = deleteRule(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
