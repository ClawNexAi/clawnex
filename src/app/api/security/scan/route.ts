/**
 * Security Scan API
 * GET  /api/security/scan — get last scan results with hardening report
 * POST /api/security/scan — trigger a new Clawkeeper scan
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { runScan, getLastScan, isScanRunning } from '@/lib/services/clawkeeper-runner';
import { buildHardeningReport, getRemediationSuggestions } from '@/lib/services/clawkeeper-mapper';
import { logEvent } from '@/lib/services/audit-logger';
import { createAlert } from '@/lib/services/alert-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const lastScan = getLastScan();

    if (!lastScan) {
      return NextResponse.json({
        scan: null,
        hardening: null,
        message: 'No scan results available. Trigger a scan with POST /api/security/scan.',
      });
    }

    const hardening = buildHardeningReport(lastScan);
    const remediations = getRemediationSuggestions(lastScan);

    return NextResponse.json({
      scan: {
        id: lastScan.id,
        scanner: lastScan.scanner,
        overallGrade: lastScan.overallGrade,
        overallScore: lastScan.overallScore,
        totalChecks: lastScan.totalChecks,
        passedChecks: lastScan.passedChecks,
        failedChecks: lastScan.failedChecks,
        warnedChecks: lastScan.warnedChecks,
        skippedChecks: lastScan.skippedChecks,
        checks: lastScan.checks,
        scannedAt: lastScan.scannedAt,
      },
      hardening,
      remediations,
      scanning: isScanRunning(),
    });
  } catch (err) {
    console.error('[API /security/scan GET] Error:', err);
    return NextResponse.json({ error: 'Failed to retrieve scan results' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'shield:scan');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    if (isScanRunning()) {
      return NextResponse.json({
        status: 'running',
        message: 'A scan is already in progress. Please wait for it to complete.',
      }, { status: 409 });
    }

    // Log the scan initiation
    logEvent('system', 'security.scan.start', 'security', undefined, 'Manual Clawkeeper scan triggered via API', 'clawkeeper');

    // Run scan (may take 30-60 seconds)
    const result = await runScan();

    // Generate alerts for critical/high failures
    const criticalFails = result.checks.filter(
      c => c.status === 'FAIL' && (c.severity === 'CRITICAL' || c.severity === 'HIGH')
    );

    for (const check of criticalFails) {
      try {
        createAlert(
          `Clawkeeper: ${check.checkId} ${check.name}`,
          `Security check failed: ${check.name}. Category: ${check.category}. ${check.remediation || ''}`.trim(),
          check.severity as 'CRITICAL' | 'HIGH',
          'clawkeeper',
          { scanId: result.id, checkId: check.checkId },
        );
      } catch {
        // Don't fail the scan response for alert creation errors
      }
    }

    // Log completion
    logEvent('system', 'security.scan.complete', 'security', result.id, `Scan complete: Grade ${result.overallGrade}, Score ${result.overallScore}, ${result.passedChecks}/${result.totalChecks} passed`, 'clawkeeper');

    const hardening = buildHardeningReport(result);

    return NextResponse.json({
      scan: {
        id: result.id,
        scanner: result.scanner,
        overallGrade: result.overallGrade,
        overallScore: result.overallScore,
        totalChecks: result.totalChecks,
        passedChecks: result.passedChecks,
        failedChecks: result.failedChecks,
        warnedChecks: result.warnedChecks,
        skippedChecks: result.skippedChecks,
        checks: result.checks,
        scannedAt: result.scannedAt,
      },
      hardening,
      scanning: false,
    });
  } catch (err) {
    console.error('[API /security/scan POST] Error:', err);

    logEvent('system', 'security.scan.error', 'security', undefined, `Scan failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'clawkeeper');

    return NextResponse.json({
      error: 'Scan failed',
      detail: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}
