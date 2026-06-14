/**
 * Trust Boundary + Blast Radius Audit API
 *
 * GET /api/trust-audit — Return the last-run trust audit report (cached) or run fresh.
 *
 * Query params:
 *   ?refresh=true  — force a fresh run and persist the result.
 *
 * Caching:
 *   The latest report + metadata is persisted in config_defaults under:
 *     - trust_audit_last_report       (JSON report, only if under size cap)
 *     - trust_audit_last_run_at       (ISO 8601 timestamp)
 *     - trust_audit_last_duration_ms  (integer ms)
 *     - trust_audit_last_summary      (always stored — cheap fallback)
 *
 * Response shape:
 *   {
 *     "report": AuditReport,
 *     "meta": {
 *       "last_run": "2026-04-22T17:38:12.345Z",
 *       "duration_ms": 850,
 *       "cached": boolean
 *     }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { runTrustAudit } from '@/lib/services/trust-audit/engine';
import { getSetting, setSetting } from '@/lib/services/config-service';
import type { AuditReport } from '@/lib/services/trust-audit/types';

// 1 MB cap on the cached report blob (SQLite TEXT is fine with this size, but
// beyond ~1 MB per row the JSON parse/serialize cost starts eating the savings).
const MAX_REPORT_CACHE_BYTES = 1_048_576;

const KEY_REPORT = 'trust_audit_last_report';
const KEY_LAST_RUN = 'trust_audit_last_run_at';
const KEY_DURATION = 'trust_audit_last_duration_ms';
const KEY_SUMMARY = 'trust_audit_last_summary';

async function runAndPersist(): Promise<{ report: AuditReport; duration_ms: number; last_run: string }> {
  const start = Date.now();
  try {
    const report = await runTrustAudit();
    const duration = Date.now() - start;
    const last_run = new Date().toISOString();
    console.log(`[trust-audit] completed in ${duration}ms — ${report.summary.totalFindings} finding(s), severity=${report.summary.overallSeverity}`);

    // Persist metadata unconditionally (cheap).
    try {
      setSetting(KEY_LAST_RUN, last_run);
      setSetting(KEY_DURATION, String(duration));
      // Summary is tiny — always cache for the UI's "last run" badge.
      setSetting(KEY_SUMMARY, JSON.stringify({
        overallSeverity: report.summary.overallSeverity,
        surfaceCount: report.summary.surfaceCount,
        agentCount: report.summary.agentCount,
        totalFindings: report.summary.totalFindings,
        findingCounts: report.summary.findingCounts,
      }));

      // Only persist the full report if it fits under the size cap.
      const serialized = JSON.stringify(report);
      if (serialized.length <= MAX_REPORT_CACHE_BYTES) {
        setSetting(KEY_REPORT, serialized);
      } else {
        // Too big — clear any stale cached blob so readers fall back to a fresh run.
        console.warn(`[trust-audit] report size ${serialized.length}B exceeds ${MAX_REPORT_CACHE_BYTES}B cap; skipping full-report cache`);
        setSetting(KEY_REPORT, '');
      }
    } catch (cacheErr) {
      console.warn('[trust-audit] failed to persist cache:', cacheErr);
    }

    return { report, duration_ms: duration, last_run };
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`[trust-audit] failed after ${duration}ms:`, err);
    throw err;
  }
}

function readCachedReport(): { report: AuditReport; duration_ms: number; last_run: string } | null {
  const raw = getSetting(KEY_REPORT);
  const last_run = getSetting(KEY_LAST_RUN);
  const durationStr = getSetting(KEY_DURATION);

  if (!raw || !last_run) return null;

  try {
    const report = JSON.parse(raw) as AuditReport;
    const duration_ms = durationStr ? parseInt(durationStr, 10) : 0;
    return { report, duration_ms, last_run };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  // Auth: requires shield:read permission (viewing security posture)
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'shield:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === 'true';

  try {
    if (!forceRefresh) {
      const cached = readCachedReport();
      if (cached) {
        return NextResponse.json({
          report: cached.report,
          meta: {
            last_run: cached.last_run,
            duration_ms: cached.duration_ms,
            cached: true,
          },
        });
      }
    }

    const fresh = await runAndPersist();
    return NextResponse.json({
      report: fresh.report,
      meta: {
        last_run: fresh.last_run,
        duration_ms: fresh.duration_ms,
        cached: false,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Trust audit failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
