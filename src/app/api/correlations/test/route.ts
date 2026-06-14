/**
 * POST /api/correlations/test — seeds test data to trigger the Attack Chain correlation rule.
 *
 * Sends multiple shield scan BLOCKs with the same session ID, which should
 * trigger the "Attack Chain" correlation rule in the correlation engine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ingestEvent } from '@/lib/services/correlation-engine';
import { run } from '@/lib/db/index';
import { randomUUID } from 'node:crypto';
import { logEvent } from '@/lib/services/audit-logger';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    if (isRbacEnabled()) {
      const auth = requireSession(request);
      if (auth instanceof NextResponse) return auth;
      const perm = requirePermission(auth.operator, 'config:write');
      if (perm) return perm;
    } else {
      const guard = requireLocalhost(request);
      if (guard) return guard;
    }

    const testSessionId = `test-session-${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    // Create 3 shield BLOCK events from the same session to trigger Attack Chain
    const events = [
      {
        source: 'shield' as const,
        eventType: 'block' as const,
        sessionId: testSessionId,
        severity: 'CRITICAL' as const,
        detail: 'Test: Jailbreak attempt detected',
        metadata: { score: 92, detections: 3, categories: ['JAILBREAK'], scanId: randomUUID() },
        timestamp: now - 2000,
      },
      {
        source: 'shield' as const,
        eventType: 'block' as const,
        sessionId: testSessionId,
        severity: 'CRITICAL' as const,
        detail: 'Test: C2 beacon detected in output',
        metadata: { score: 88, detections: 2, categories: ['C2'], scanId: randomUUID() },
        timestamp: now - 1000,
      },
      {
        source: 'shield' as const,
        eventType: 'block' as const,
        sessionId: testSessionId,
        severity: 'HIGH' as const,
        detail: 'Test: Steganography payload blocked',
        metadata: { score: 75, detections: 1, categories: ['STEGO'], scanId: randomUUID() },
        timestamp: now,
      },
    ];

    // Also insert into shield_scans table so the shield history shows them
    for (const evt of events) {
      const scanId = randomUUID();
      try {
        run(
          `INSERT INTO shield_scans (id, direction, source_session_id, source_agent_id, content_hash, layers_triggered, threat_level, detail, scanned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            scanId,
            'inbound',
            testSessionId,
            null,
            `test-${randomUUID().slice(0, 8)}`,
            (evt.metadata.categories || []).join(','),
            'BLOCK',
            JSON.stringify({ score: evt.metadata.score, detections: evt.metadata.detections, test: true }),
            new Date(evt.timestamp).toISOString(),
          ],
        );
      } catch (dbErr) {
        console.error('[Correlations/Test] DB write error:', dbErr);
      }

      // Ingest into correlation engine
      ingestEvent(evt);
    }

    // Log it
    logEvent('operator', 'correlation_test', 'correlation', testSessionId, `Seeded 3 test shield BLOCKs for session ${testSessionId}`, 'dashboard');

    return NextResponse.json({
      success: true,
      testSessionId,
      eventsSeeded: events.length,
      message: `Seeded ${events.length} shield BLOCK events for session ${testSessionId}. The Attack Chain correlation rule should trigger within seconds.`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Correlations/Test] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
