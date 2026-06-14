/**
 * GET  /api/watcher/status — Returns session watcher status.
 * POST /api/watcher/status — Actions: poll_now, set_interval
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getWatcherStatus, ensureWatcherStarted, pollNow, setPollInterval, stopWatcher } from '@/lib/services/session-watcher-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'dashboard:view');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  ensureWatcherStarted();
  const status = getWatcherStatus();
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { action, interval } = body as { action?: string; interval?: number };

    if (action === "poll_now") {
      pollNow();
      return NextResponse.json({ ok: true, message: "Poll triggered" });
    }

    if (action === "set_interval" && interval && interval >= 1000 && interval <= 60000) {
      setPollInterval(interval);
      return NextResponse.json({ ok: true, interval });
    }

    if (action === "enable") {
      ensureWatcherStarted();
      return NextResponse.json({ ok: true, message: "Session watcher enabled" });
    }

    if (action === "disable") {
      stopWatcher();
      return NextResponse.json({ ok: true, message: "Session watcher disabled" });
    }

    return NextResponse.json({ error: "Unknown action. Use 'poll_now', 'set_interval', 'enable', or 'disable'" }, { status: 400 });
  } catch (err) {
    console.error("[Watcher API] POST error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
