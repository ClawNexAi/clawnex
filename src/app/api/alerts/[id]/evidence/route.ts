/**
 * Alert → Evidence Backlink API
 *
 * GET /api/alerts/:id/evidence
 *
 * Resolves an alert to its corresponding audit_log evidence record and surfaces
 * the exact detection samples plus a match-centered payload snippet.
 *
 * Resolution strategy:
 *
 *   1. Forward link (preferred):
 *      alert.metadata.audit_event_id → direct row lookup. This path is hit by
 *      Current Shield producers persist audit_event_id in alert metadata before
 *      alert creation through the shared shield-evidence writer.
 *
 *   2. Fallback correlation (legacy alerts only):
 *      Read session_id from alert metadata, or parse it from the legacy alert
 *      description (regex `Session: <uuid>`),
 *      and find the closest audit_log row matching:
 *        - source = 'session-watcher'
 *        - action IN ('shield_detected', 'shield_review')
 *        - resource_id = <session_id>
 *        - |created_at - alert.created_at| <= 60 seconds
 *      Pick the nearest by absolute timestamp distance.
 *
 *   3. No match → 404 with reason.
 *
 * Response shape (success):
 *   {
 *     audit_event_id, audit_action, audit_created_at,
 *     session_id, direction, model, provider, verdict, score,
 *     detections: ShieldDetection[],            // verbatim from audit detail
 *     matched_snippets: Array<{                 // match-centered windows
 *       rule_key, name, severity, sample,
 *       snippet_before, snippet_match, snippet_after,
 *     }>,
 *     prompt_hash, proxy_traffic_id,
 *     correlation_method: 'forward' | 'fallback_nearest',
 *     payload_excerpt_truncated, payload_total_length,
 *   }
 *
 * RBAC:
 *   - Requires session + 'audit:read' permission when RBAC is enabled.
 *   - Falls back to localhost-only when RBAC is disabled (matches existing
 *     mutation-route guard pattern).
 *
 * Privacy:
 *   - The audit detail's payload_excerpt was passed through redact() at write
 *     time (shield-evidence.ts), stripping non-matched PII before persistence.
 *   - Detection samples come from the scanner with rule-specific partial
 *     redaction already applied (e.g. CC = first6+last4, phone = last 4).
 *   - This route does not redact further — the data was already cleaned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { queryOne } from '@/lib/db/index';
import type { AlertRecord } from '@/lib/services/alert-manager';
import type { ShieldDetection } from '@/lib/types';
import { resolveAlertEvidence } from '@/lib/services/alert-evidence-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AuditDetailJson {
  summary?: string;
  shield_detections?: ShieldDetection[];
  prompt_hash?: string;
  payload_excerpt?: string;
  payload_excerpt_truncated?: boolean;
  payload_total_length?: number;
  proxy_traffic_id?: string | null;
  shield_scan_id?: string | null;
  source_event_type?: string | null;
  agent_id?: string | null;
  session_id?: string;
  model?: string | null;
  provider?: string | null;
  direction?: string;
  verdict?: string;
  score?: number;
}

function safeParseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Build a match-centered snippet by locating the (already-redacted) detection
 * sample inside the (already-redacted) payload excerpt. ±200 chars on each
 * side. If the sample isn't found in the excerpt (e.g. truncation lost it),
 * fall back to returning the sample alone with empty before/after.
 */
function centerSnippet(payload: string, sample: string, window = 200): {
  snippet_before: string;
  snippet_match: string;
  snippet_after: string;
  found: boolean;
} {
  if (!payload || !sample) {
    return { snippet_before: '', snippet_match: sample || '', snippet_after: '', found: false };
  }
  const idx = payload.indexOf(sample);
  if (idx < 0) {
    return { snippet_before: '', snippet_match: sample, snippet_after: '', found: false };
  }
  const start = Math.max(0, idx - window);
  const end = Math.min(payload.length, idx + sample.length + window);
  return {
    snippet_before: (start > 0 ? '…' : '') + payload.slice(start, idx),
    snippet_match: payload.slice(idx, idx + sample.length),
    snippet_after: payload.slice(idx + sample.length, end) + (end < payload.length ? '…' : ''),
    found: true,
  };
}

function buildMatchedSnippets(
  detections: ShieldDetection[] | undefined,
  payloadExcerpt: string,
): Array<{
  rule_key: string;
  name: string;
  severity: string;
  sample: string;
  snippet_before: string;
  snippet_match: string;
  snippet_after: string;
  match_found_in_excerpt: boolean;
}> {
  if (!Array.isArray(detections)) return [];
  const out: Array<{
    rule_key: string;
    name: string;
    severity: string;
    sample: string;
    snippet_before: string;
    snippet_match: string;
    snippet_after: string;
    match_found_in_excerpt: boolean;
  }> = [];

  for (const det of detections) {
    // Each detection can contribute multiple samples — surface the first
    // (already-truncated to 80 chars by the scanner). Subsequent samples can
    // be inferred from the verbatim detections array; one snippet per detection
    // keeps the response readable.
    const sample = (det.samples && det.samples[0]) || '';
    const centered = centerSnippet(payloadExcerpt, sample);
    out.push({
      rule_key: det.rule_key ?? det.id,
      name: det.name,
      severity: det.severity,
      sample,
      snippet_before: centered.snippet_before,
      snippet_match: centered.snippet_match,
      snippet_after: centered.snippet_after,
      match_found_in_excerpt: centered.found,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    // Evidence is read-only audit-trail surface — gated by audit:read so the
    // viewer permission lines up with AuditEvidencePanel.
    const perm = requirePermission(auth.operator, 'audit:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { id } = await params;

    const alert = queryOne<AlertRecord>('SELECT * FROM alerts WHERE id = ?', [id]);
    if (!alert) {
      return NextResponse.json(
        { error: 'Alert not found', alert_id: id },
        { status: 404 },
      );
    }

    const resolved = resolveAlertEvidence(alert);
    const meta = resolved.metadata;
    const auditRow = resolved.audit;
    const correlationMethod = resolved.correlationMethod;

    if (!auditRow) {
      return NextResponse.json(
        {
          error: 'No evidence backlink available',
          reason: resolved.correlationReason,
          alert_id: id,
          correlation_method: correlationMethod,
        },
        { status: 404 },
      );
    }

    const detailJson = safeParseJson<AuditDetailJson>(auditRow.detail) ?? {};
    const detections = detailJson.shield_detections ?? [];
    const payloadExcerpt = detailJson.payload_excerpt ?? '';

    // Item #5 (Mission Control Evidence Quality): outside_window_fetchable boolean.
    //
    // Semantic: even if the snippet wasn't found within the standard ±60s
    // correlation window, is the underlying audit record retrievable?
    //
    // Resolution:
    //   - If we reached this point, auditRow IS resolved — the forward-link
    //     path found it by ID, or the fallback path found it within ±60s.
    //   - So the real question is: was retrieval deterministic?
    //     • "forward" correlation = audit_event_id was present → the record is
    //       always fetchable by its primary key → true.
    //     • "fallback_nearest" = we used a time-window search, not a direct ID
    //       → the record happened to be in the window, but a re-fetch might not
    //       find it if the window shifts → false.
    //
    // Proxy rationale (INLINE DOCUMENTED): there is no cold-storage backend
    // beyond the local SQLite audit_log. "Fetchable from cold storage" therefore
    // reduces to: "was the record found via a stable, deterministic key lookup?"
    // That is exactly `correlation_method !== 'fallback_nearest'`.
    const outsideWindowFetchable: boolean = correlationMethod === 'forward';

    const proxyTrafficId = detailJson.proxy_traffic_id
      ?? meta?.proxy_traffic_id
      ?? (meta?.source_event_type === 'proxy_traffic' ? meta.source_event_id : null);
    const shieldScanId = detailJson.shield_scan_id
      ?? meta?.shield_scan_id
      ?? (meta?.source_event_type === 'shield_scan' ? meta.source_event_id : null);

    return NextResponse.json({
      audit_event_id: auditRow.id,
      audit_action: auditRow.action,
      audit_created_at: auditRow.created_at,
      session_id: detailJson.session_id
        ?? meta?.session_id
        ?? (auditRow.resource_type === 'session' ? auditRow.resource_id : null),
      agent_id: detailJson.agent_id ?? meta?.agent_id ?? null,
      direction: detailJson.direction ?? meta?.direction ?? null,
      model: detailJson.model ?? meta?.model ?? null,
      provider: detailJson.provider ?? meta?.provider ?? null,
      verdict: detailJson.verdict ?? meta?.verdict ?? null,
      score: detailJson.score ?? meta?.score ?? null,
      detections,
      matched_snippets: buildMatchedSnippets(detections, payloadExcerpt),
      payload_excerpt: payloadExcerpt,
      payload_excerpt_truncated: detailJson.payload_excerpt_truncated ?? false,
      payload_total_length: detailJson.payload_total_length ?? null,
      prompt_hash: detailJson.prompt_hash ?? null,
      proxy_traffic_id: proxyTrafficId,
      shield_scan_id: shieldScanId,
      source_event_type: proxyTrafficId ? 'proxy_traffic' : shieldScanId ? 'shield_scan' : null,
      correlation_method: correlationMethod,
      outside_window_fetchable: outsideWindowFetchable,
      alert: {
        id: alert.id,
        title: alert.title,
        severity: alert.severity,
        source: alert.source,
        status: alert.status,
        created_at: alert.created_at,
      },
    });
  } catch (err) {
    console.error('[API/alerts/:id/evidence] GET Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
