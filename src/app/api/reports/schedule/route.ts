/**
 * Scheduled Reports API
 *
 * GET  /api/reports/schedule — List all scheduled jobs
 * POST /api/reports/schedule — Create a new scheduled job
 * PUT  /api/reports/schedule — Toggle or update a job
 * DELETE /api/reports/schedule — Delete a job
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import {
  getScheduledJobs,
  createJob,
  toggleJob,
  deleteJob,
} from '@/lib/services/report-scheduler';

function checkAuth(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'reports:generate');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const jobs = getScheduledJobs();
  return NextResponse.json({ jobs });
}

export async function POST(request: NextRequest) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { report_type, schedule, format, email_to } = body;

    if (!report_type || !schedule) {
      return NextResponse.json({ error: 'report_type and schedule are required' }, { status: 400 });
    }

    if (!['daily', 'weekly', 'monthly'].includes(schedule)) {
      return NextResponse.json({ error: 'schedule must be daily, weekly, or monthly' }, { status: 400 });
    }

    const job = createJob({ report_type, schedule, format, email_to });
    return NextResponse.json({ job });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { id, enabled } = body;

    if (!id || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'id and enabled (boolean) are required' }, { status: 400 });
    }

    const job = toggleJob(id, enabled);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id query parameter required' }, { status: 400 });
  }

  const deleted = deleteJob(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
