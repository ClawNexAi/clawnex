/**
 * Shield Stats API
 * GET /api/shield/stats — returns 24h scan statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { getShieldStats, getShieldHistory, getShieldStatsHourly } from '@/lib/services/prompt-interceptor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hourlyBucketsFromHistory(history: Array<{ scanned_at: string; threat_level: string }>) {
  const buckets = new Map<string, { hour: string; total: number; allowed: number; reviewed: number; blocked: number }>();
  for (const scan of history) {
    const ts = Date.parse(scan.scanned_at);
    if (!Number.isFinite(ts)) continue;
    const hour = new Date(Math.floor(ts / 3_600_000) * 3_600_000).toISOString().replace(/:\d{2}\.\d{3}Z$/, ":00Z");
    const bucket = buckets.get(hour) ?? { hour, total: 0, allowed: 0, reviewed: 0, blocked: 0 };
    bucket.total += 1;
    if (scan.threat_level === "ALLOW") bucket.allowed += 1;
    else if (scan.threat_level === "REVIEW") bucket.reviewed += 1;
    else if (scan.threat_level === "BLOCK") bucket.blocked += 1;
    buckets.set(hour, bucket);
  }
  return Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'shield:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const since = searchParams.get('since') || undefined;
    const instance = searchParams.get('instance') || null;
    // Phase 2a-fix: opt-in to including test-generated scans (origin =
    // shield-test/demo/qa) in the count. Default behavior excludes them so
    // header/sidebar/Fleet active-alert badges don't get polluted by a
    // Shield Tests run. The Welcome Wizard's "Run first shield test" step
    // explicitly opts in via this flag — it's the one place where seeing
    // a test-generated scan is the validation signal we actually want.
    const includeTestGenerated = searchParams.get('includeTestGenerated') === 'true';
    // Item #1 (Mission Control Detection Trend): ?bucket=hour returns an
    // additional hourlyBuckets[] array alongside the existing summary fields.
    // The `since` param drives the window start; until defaults to now.
    // Only supported on the non-instance-filtered path (the summary path).
    const bucketHour = searchParams.get('bucket') === 'hour';

    // When no instance filter, use the optimized DB-level stats
    if (!instance || instance === 'all') {
      const stats = getShieldStats(since, { includeTestGenerated });
      // Hourly buckets: compute only when caller opts in via ?bucket=hour.
      // Window: sinceMs → now.  A missing `since` param defaults to 24h back
      // (same default window getShieldStats uses when since is undefined).
      const HOUR = 3_600_000;
      const sinceMs = since
        ? new Date(since).getTime()
        : Date.now() - 24 * HOUR;
      const hourlyBuckets = bucketHour
        ? getShieldStatsHourly(sinceMs, Date.now(), { includeTestGenerated })
        : undefined;
      return NextResponse.json({
        ...stats,
        ...(bucketHour ? { hourlyBuckets } : {}),
        timestamp: new Date().toISOString(),
      });
    }

    // Instance-filtered: compute stats from filtered history.
    // Phase 2a-fix: pass through includeTestGenerated so the
    // instance-filtered path honors the same provenance contract as the
    // DB-level getShieldStats path above. Without this, instance=hermes-local
    // / instance=openclaw shield badges would leak shield-test/demo/qa
    // origins back into the count.
    let history = getShieldHistory(500, since, { includeTestGenerated });
    if (instance === 'hermes-local') {
      history = history.filter(s => s.source_agent_id && s.source_agent_id.startsWith('hermes:'));
    } else {
      history = history.filter(s => !s.source_agent_id || !s.source_agent_id.startsWith('hermes:'));
    }

    const stats = {
      total: history.length,
      blocked: history.filter(s => s.threat_level === 'BLOCK').length,
      reviewed: history.filter(s => s.threat_level === 'REVIEW').length,
      allowed: history.filter(s => s.threat_level === 'ALLOW').length,
      period: since ? 'custom' : '24h',
    };
    const hourlyBuckets = bucketHour ? hourlyBucketsFromHistory(history) : undefined;

    return NextResponse.json({
      ...stats,
      ...(bucketHour ? { hourlyBuckets } : {}),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/shield/stats] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
