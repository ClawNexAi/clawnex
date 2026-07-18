import { queryOne } from '@/lib/db/index';
import type { AlertRecord } from '@/lib/services/alert-manager';
import type { AuditRecord } from '@/lib/services/audit-logger';

export interface AlertEvidenceMetadata {
  audit_event_id?: string | null;
  source_event_id?: string | null;
  source_event_type?: string | null;
  shield_scan_id?: string | null;
  proxy_traffic_id?: string | null;
  session_id?: string | null;
  direction?: string | null;
  model?: string | null;
  provider?: string | null;
  agent_id?: string | null;
  prompt_hash?: string | null;
  verdict?: string | null;
  score?: number | null;
  [key: string]: unknown;
}

export interface ResolvedAlertEvidence {
  audit: AuditRecord | null;
  metadata: AlertEvidenceMetadata;
  correlationMethod: 'forward' | 'fallback_nearest' | 'unresolved';
  correlationReason: string;
}

export function parseAlertEvidenceMetadata(value: string | null | undefined): AlertEvidenceMetadata {
  if (!value) return {};
  try { return JSON.parse(value) as AlertEvidenceMetadata; } catch { return {}; }
}

function extractSessionId(description: string | null): string | null {
  if (!description) return null;
  return description.match(/Session:\s*([0-9a-f-]{36})/i)?.[1] ?? null;
}

export function resolveAlertEvidence(alert: AlertRecord): ResolvedAlertEvidence {
  const metadata = parseAlertEvidenceMetadata(alert.metadata);
  if (metadata.audit_event_id) {
    const audit = queryOne<AuditRecord>('SELECT * FROM audit_log WHERE id = ?', [metadata.audit_event_id]) ?? null;
    return {
      audit,
      metadata,
      correlationMethod: 'forward',
      correlationReason: audit
        ? 'Exact audit event ID stored with the alert.'
        : 'The alert stores an audit event ID, but that audit row is no longer available.',
    };
  }

  if (alert.source !== 'session-watcher') {
    return {
      audit: null,
      metadata,
      correlationMethod: 'unresolved',
      correlationReason: 'This legacy alert has no stored audit event ID and no supported fallback correlation.',
    };
  }

  const sessionId = metadata.session_id || extractSessionId(alert.description);
  const alertTimestamp = Date.parse(alert.created_at);
  if (!sessionId || !Number.isFinite(alertTimestamp)) {
    return {
      audit: null,
      metadata,
      correlationMethod: 'unresolved',
      correlationReason: 'This legacy alert does not contain enough session and timestamp data for fallback correlation.',
    };
  }

  const lower = new Date(alertTimestamp - 60_000).toISOString();
  const upper = new Date(alertTimestamp + 60_000).toISOString();
  const audit = queryOne<AuditRecord>(
    `SELECT * FROM audit_log
     WHERE source = 'session-watcher'
       AND action IN ('shield_detected', 'shield_review')
       AND resource_id = ?
       AND created_at >= ? AND created_at <= ?
     ORDER BY ABS(julianday(created_at) - julianday(?)) ASC
     LIMIT 1`,
    [sessionId, lower, upper, alert.created_at],
  ) ?? null;

  return {
    audit,
    metadata,
    correlationMethod: audit ? 'fallback_nearest' : 'unresolved',
    correlationReason: audit
      ? 'Nearest Shield audit event in the same session within 60 seconds; verify before relying on it.'
      : 'No Shield audit event was found in the same session within 60 seconds.',
  };
}
