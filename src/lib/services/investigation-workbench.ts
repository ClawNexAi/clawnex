import { createHash, randomUUID } from 'node:crypto';
import { queryAll, queryOne, run, transaction } from '@/lib/db/index';
import type { AlertRecord } from '@/lib/services/alert-manager';
import type { AuditRecord } from '@/lib/services/audit-logger';
import { logEvent } from '@/lib/services/audit-logger';
import { createReplayCase } from '@/lib/services/shield-workflow';
import { outboundScan, shieldScan } from '@/lib/shield/scanner';
import {
  forensicPayloadStatus,
  getInvestigationCapturePolicy,
  sanitizeDetectionsForCapture,
} from '@/lib/services/investigation-capture';
import { invalidateInvestigationExceptionCache } from '@/lib/services/investigation-exceptions';
import type { ShieldDetection, ShieldScoringLedger } from '@/lib/types';
import {
  parseAlertEvidenceMetadata,
  resolveAlertEvidence,
  type AlertEvidenceMetadata,
} from '@/lib/services/alert-evidence-resolver';

export type InvestigationDisposition =
  | 'true_positive'
  | 'false_positive'
  | 'expected_activity'
  | 'needs_more_evidence'
  | 'escalated';

interface EvidenceDetail {
  evidence_schema_version?: number;
  shield_detections?: Array<ShieldDetection & { risk_context?: Record<string, string> }>;
  scoring_ledger?: ShieldScoringLedger | null;
  prompt_hash?: string | null;
  payload_excerpt?: string;
  payload_excerpt_truncated?: boolean;
  payload_total_length?: number;
  capture_mode?: string;
  capture_complete?: boolean;
  session_id?: string | null;
  agent_id?: string | null;
  model?: string | null;
  provider?: string | null;
  direction?: string;
  verdict?: string;
  score?: number;
  proxy_traffic_id?: string | null;
  shield_scan_id?: string | null;
  source_event_type?: string | null;
  profile_id?: string | null;
}

export interface InvestigationCaseRow {
  id: string;
  alert_id: string;
  status: 'open' | 'decided' | 'escalated';
  disposition: InvestigationDisposition | null;
  rationale: string | null;
  notes: string | null;
  assigned_to: string | null;
  evidence_hash: string | null;
  created_by: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
}

interface DraftRow {
  id: string;
  case_id: string;
  alert_id: string;
  target_rule_key: string;
  target_rule_name: string | null;
  exception_text: string;
  direction: 'inbound' | 'outbound' | 'both';
  rationale: string;
  status: 'draft' | 'replayed' | 'ready' | 'activated' | 'deactivated' | 'discarded';
  replay_case_id: string | null;
  replay_result: string | null;
  created_by: string;
  activated_by: string | null;
  created_at: string;
  replayed_at: string | null;
  activated_at: string | null;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function resolvePrimaryEvidence(alert: AlertRecord): {
  audit: AuditRecord | null;
  detail: EvidenceDetail;
  meta: AlertEvidenceMetadata;
  correlationMethod: 'forward' | 'fallback_nearest' | 'unresolved';
  correlationReason: string;
} {
  const resolved = resolveAlertEvidence(alert);
  return {
    audit: resolved.audit,
    detail: parseJson<EvidenceDetail>(resolved.audit?.detail, {}),
    meta: resolved.metadata,
    correlationMethod: resolved.correlationMethod,
    correlationReason: resolved.correlationReason,
  };
}

function evidenceHash(alert: AlertRecord, audit: AuditRecord | null, detail: EvidenceDetail): string {
  return createHash('sha256').update(JSON.stringify({
    alert_id: alert.id,
    audit_id: audit?.id || null,
    prompt_hash: detail.prompt_hash || null,
    detections: detail.shield_detections || [],
    score: detail.score ?? null,
    verdict: detail.verdict ?? null,
  })).digest('hex');
}

function ensureCase(alert: AlertRecord, actor: string, audit: AuditRecord | null, detail: EvidenceDetail): InvestigationCaseRow {
  const existing = queryOne<InvestigationCaseRow>('SELECT * FROM investigation_cases WHERE alert_id = ?', [alert.id]);
  if (existing) return existing;
  const id = `case_${randomUUID()}`;
  const now = new Date().toISOString();
  run(
    `INSERT INTO investigation_cases
      (id, alert_id, status, evidence_hash, created_by, created_at, updated_at)
     VALUES (?, ?, 'open', ?, ?, ?, ?)`,
    [id, alert.id, evidenceHash(alert, audit, detail), actor, now, now],
  );
  run(
    `INSERT INTO investigation_case_events (id, case_id, event_type, actor, detail, created_at)
     VALUES (?, ?, 'case_opened', ?, ?, ?)`,
    [`caseevt_${randomUUID()}`, id, actor, JSON.stringify({ alert_id: alert.id, audit_event_id: audit?.id || null }), now],
  );
  return queryOne<InvestigationCaseRow>('SELECT * FROM investigation_cases WHERE id = ?', [id])!;
}

function caseEvents(caseId: string): Array<Record<string, unknown>> {
  return queryAll<Record<string, unknown>>(
    'SELECT id, event_type, actor, detail, created_at FROM investigation_case_events WHERE case_id = ? ORDER BY created_at ASC',
    [caseId],
  ).map((row) => ({ ...row, detail: parseJson(String(row.detail || '{}'), {}) }));
}

function listPayloadEvidence(
  alert: AlertRecord,
  primaryAudit: AuditRecord | null,
  primaryDetail: EvidenceDetail,
): Array<Record<string, unknown>> {
  const policy = getInvestigationCapturePolicy();
  const rows: AuditRecord[] = [];
  if (primaryAudit) rows.push(primaryAudit);
  const sessionId = primaryDetail.session_id || parseAlertEvidenceMetadata(alert.metadata).session_id;
  if (sessionId) {
    const center = Date.parse(primaryAudit?.created_at || alert.created_at);
    const windowMs = policy.relatedWindowMinutes * 60_000;
    const nearby = queryAll<AuditRecord>(
      `SELECT * FROM audit_log
       WHERE resource_id = ? AND action LIKE 'shield_%'
         AND julianday(created_at) BETWEEN julianday(?) AND julianday(?)
       ORDER BY created_at ASC LIMIT 50`,
      [sessionId, new Date(center - windowMs).toISOString(), new Date(center + windowMs).toISOString()],
    );
    rows.push(...nearby);
  }
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.id) && seen.add(row.id)).flatMap((row) => {
    const detail = parseJson<EvidenceDetail>(row.detail, {});
    if (!detail.payload_excerpt && !detail.payload_total_length) return [];
    const forensic = forensicPayloadStatus(row.id);
    return [{
      audit_event_id: row.id,
      created_at: row.created_at,
      direction: detail.direction || 'unknown',
      label: detail.direction === 'outbound' ? 'Response / outbound content' : 'Request / inbound content',
      redacted_text: detail.payload_excerpt || '',
      capture_mode: detail.capture_mode || 'redacted',
      capture_complete: detail.capture_complete ?? !detail.payload_excerpt_truncated,
      truncated: detail.payload_excerpt_truncated ?? false,
      total_length: detail.payload_total_length ?? null,
      content_hash: detail.prompt_hash || null,
      forensic,
    }];
  });
}

function relatedActivity(alert: AlertRecord, detail: EvidenceDetail, primaryTrafficId: string | null): Array<Record<string, unknown>> {
  const policy = getInvestigationCapturePolicy();
  const sessionId = detail.session_id || parseAlertEvidenceMetadata(alert.metadata).session_id;
  if (!sessionId) return [];
  const center = Date.parse(alert.created_at);
  const windowMs = policy.relatedWindowMinutes * 60_000;
  return queryAll<Record<string, unknown>>(
    `SELECT id, timestamp, direction, model, provider, upstream_url, prompt_hash,
            messages_count, shield_verdict, shield_score, blocked, block_reason,
            status_code, source
     FROM proxy_traffic
     WHERE session_id = ? AND julianday(timestamp) BETWEEN julianday(?) AND julianday(?)
     ORDER BY timestamp ASC LIMIT 100`,
    [sessionId, new Date(center - windowMs).toISOString(), new Date(center + windowMs).toISOString()],
  ).map((row) => {
    const rawTimestamp = String(row.timestamp || '');
    const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(rawTimestamp);
    const rowTime = Date.parse(hasTimezone ? rawTimestamp : `${rawTimestamp}Z`);
    const isPrimary = row.id === primaryTrafficId;
    return {
      ...row,
      relationship_method: isPrimary ? 'exact_traffic_id' : 'same_session_window',
      relationship_reason: isPrimary
        ? 'Exact proxy traffic record stored with the alert.'
        : 'Same session within the configured investigation window; supporting context, not proof of causation.',
      relationship_confidence: isPrimary ? 'exact' : 'supporting',
      offset_seconds: Number.isFinite(rowTime) ? Math.round((rowTime - center) / 1000) : null,
    };
  });
}

function normalizeDraft(row: DraftRow): Record<string, unknown> {
  return { ...row, replay_result: parseJson(row.replay_result, null) };
}

export function getInvestigationWorkbench(alertId: string): Record<string, unknown> | null {
  const alert = queryOne<AlertRecord>('SELECT * FROM alerts WHERE id = ?', [alertId]);
  if (!alert) return null;
  const { audit, detail, meta, correlationMethod, correlationReason } = resolvePrimaryEvidence(alert);
  const currentCase = queryOne<InvestigationCaseRow>('SELECT * FROM investigation_cases WHERE alert_id = ?', [alert.id]) || null;
  const drafts = queryAll<DraftRow>(
    'SELECT * FROM investigation_exception_drafts WHERE alert_id = ? ORDER BY created_at DESC',
    [alert.id],
  ).map(normalizeDraft);
  const detections = (detail.shield_detections || []).map((detection) => ({
    ...detection,
    stable_rule_id: detection.rule_key || detection.rule_snapshot?.stable_id || detection.id,
    score_contribution: detection.score_contribution ?? null,
  }));
  const capturePolicy = getInvestigationCapturePolicy();
  const payloads = listPayloadEvidence(alert, audit, detail);
  return {
    alert: {
      id: alert.id,
      title: alert.title,
      description: alert.description,
      severity: alert.severity,
      source: alert.source,
      status: alert.status,
      created_at: alert.created_at,
      updated_at: alert.updated_at,
    },
    overview: {
      verdict: detail.verdict ?? meta.verdict ?? null,
      score: detail.score ?? meta.score ?? null,
      direction: detail.direction ?? meta.direction ?? null,
      model: detail.model ?? meta.model ?? null,
      provider: detail.provider ?? meta.provider ?? null,
      agent_id: detail.agent_id ?? meta.agent_id ?? null,
      session_id: detail.session_id ?? meta.session_id ?? null,
      source_event_type: detail.source_event_type ?? null,
      proxy_traffic_id: detail.proxy_traffic_id ?? meta.proxy_traffic_id ?? null,
      shield_scan_id: detail.shield_scan_id ?? meta.shield_scan_id ?? null,
      audit_event_id: audit?.id ?? null,
      prompt_hash: detail.prompt_hash ?? meta.prompt_hash ?? null,
      capture_complete: payloads.length > 0 && payloads.every((payload) => payload.capture_complete === true),
    },
    payloads,
    detections,
    scoring: detail.scoring_ledger ?? null,
    related_activity: relatedActivity(alert, detail, detail.proxy_traffic_id ?? meta.proxy_traffic_id ?? null),
    case: currentCase ? { ...currentCase, events: caseEvents(currentCase.id) } : null,
    drafts,
    capture_policy: capturePolicy,
    evidence_hash: evidenceHash(alert, audit, detail),
    provenance: {
      correlation_method: correlationMethod,
      correlation_reason: correlationReason,
      audit_event_id: audit?.id ?? null,
      audit_created_at: audit?.created_at ?? null,
      deterministic: correlationMethod === 'forward' && Boolean(audit),
    },
  };
}

export function recordInvestigationDecision(input: {
  alertId: string;
  disposition: InvestigationDisposition;
  rationale: string;
  notes?: string;
  actor: string;
}): InvestigationCaseRow {
  const alert = queryOne<AlertRecord>('SELECT * FROM alerts WHERE id = ?', [input.alertId]);
  if (!alert) throw new Error('Alert not found');
  if (!input.rationale.trim()) throw new Error('A decision rationale is required');
  if (input.rationale.trim().length > 4_000) throw new Error('Decision rationale must be 4,000 characters or fewer');
  if ((input.notes?.trim().length || 0) > 8_000) throw new Error('Decision notes must be 8,000 characters or fewer');
  const { audit, detail } = resolvePrimaryEvidence(alert);
  const current = ensureCase(alert, input.actor, audit, detail);
  const now = new Date().toISOString();
  let incidentId: string | null = null;
  transaction(() => {
    run(
      `UPDATE investigation_cases
       SET status = ?, disposition = ?, rationale = ?, notes = ?, decided_by = ?, decided_at = ?, updated_at = ?
       WHERE id = ?`,
      [input.disposition === 'escalated' ? 'escalated' : 'decided', input.disposition, input.rationale.trim(), input.notes?.trim() || null, input.actor, now, now, current.id],
    );
    run(
      `INSERT INTO investigation_case_events (id, case_id, event_type, actor, detail, created_at)
       VALUES (?, ?, 'disposition_recorded', ?, ?, ?)`,
      [`caseevt_${randomUUID()}`, current.id, input.actor, JSON.stringify({ disposition: input.disposition, rationale: input.rationale.trim(), notes: input.notes?.trim() || null }), now],
    );
    if (input.disposition === 'false_positive') {
      run("UPDATE alerts SET status = 'false_positive', updated_at = ? WHERE id = ?", [now, alert.id]);
    } else if (input.disposition === 'expected_activity') {
      run("UPDATE alerts SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ?", [now, now, alert.id]);
    } else if (input.disposition === 'true_positive' || input.disposition === 'needs_more_evidence' || input.disposition === 'escalated') {
      run("UPDATE alerts SET status = 'investigating', updated_at = ? WHERE id = ?", [now, alert.id]);
    }

    if (input.disposition === 'escalated') {
      const prior = queryOne<{ detail: string }>(
        "SELECT detail FROM investigation_case_events WHERE case_id = ? AND event_type = 'incident_escalated' ORDER BY created_at DESC LIMIT 1",
        [current.id],
      );
      incidentId = parseJson<{ incident_id?: string }>(prior?.detail, {}).incident_id || null;
      if (!incidentId) {
        incidentId = `inc_${randomUUID()}`;
        run(
          `INSERT INTO incidents
            (id, title, description, severity, status, alert_ids, timeline, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
          [
            incidentId,
            `Escalated investigation: ${alert.title}`,
            input.rationale.trim(),
            alert.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
            JSON.stringify([alert.id]),
            JSON.stringify([{ at: now, action: 'investigation_escalated', by: input.actor, case_id: current.id }]),
            now,
            now,
          ],
        );
        run(
          `INSERT INTO investigation_case_events (id, case_id, event_type, actor, detail, created_at)
           VALUES (?, ?, 'incident_escalated', ?, ?, ?)`,
          [`caseevt_${randomUUID()}`, current.id, input.actor, JSON.stringify({ incident_id: incidentId, alert_id: alert.id }), now],
        );
      }
    }
  });
  logEvent(input.actor, 'investigation_disposition_recorded', 'investigation_case', current.id, JSON.stringify({ alert_id: alert.id, disposition: input.disposition, rationale: input.rationale.trim(), incident_id: incidentId }), 'dashboard');
  return queryOne<InvestigationCaseRow>('SELECT * FROM investigation_cases WHERE id = ?', [current.id])!;
}

export function createInvestigationExceptionDraft(input: {
  alertId: string;
  targetRuleKey: string;
  targetRuleName?: string;
  exceptionText: string;
  direction: 'inbound' | 'outbound' | 'both';
  rationale: string;
  actor: string;
}): Record<string, unknown> {
  const alert = queryOne<AlertRecord>('SELECT * FROM alerts WHERE id = ?', [input.alertId]);
  if (!alert) throw new Error('Alert not found');
  if (!input.targetRuleKey.trim()) throw new Error('A target rule is required');
  if (input.targetRuleKey.trim().length > 200) throw new Error('Target rule key is too long');
  if (input.exceptionText.trim().length < 3 || input.exceptionText.trim().length > 500) throw new Error('Exception text must be 3 to 500 characters');
  if (!input.rationale.trim()) throw new Error('A draft rationale is required');
  if (input.rationale.trim().length > 4_000) throw new Error('Draft rationale must be 4,000 characters or fewer');
  const { audit, detail } = resolvePrimaryEvidence(alert);
  const targetRuleKey = input.targetRuleKey.trim();
  const targetDetection = (detail.shield_detections || []).find((detection) =>
    (detection.rule_key || detection.rule_snapshot?.stable_id || detection.id) === targetRuleKey,
  );
  if (!targetDetection) throw new Error('The selected rule did not trigger on this alert');
  const evidenceDirection = detail.direction === 'outbound' ? 'outbound' : 'inbound';
  if (input.direction !== 'both' && input.direction !== evidenceDirection) {
    throw new Error(`This evidence is ${evidenceDirection}; choose ${evidenceDirection} or both`);
  }
  const caseRow = ensureCase(alert, input.actor, audit, detail);
  const id = `draft_${randomUUID()}`;
  const now = new Date().toISOString();
  run(
    `INSERT INTO investigation_exception_drafts
      (id, case_id, alert_id, target_rule_key, target_rule_name, exception_text, direction, rationale, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [id, caseRow.id, alert.id, targetRuleKey, targetDetection.name || targetDetection.rule_snapshot?.name || input.targetRuleName?.trim() || null, input.exceptionText.trim(), input.direction, input.rationale.trim(), input.actor, now],
  );
  run(
    `INSERT INTO investigation_case_events (id, case_id, event_type, actor, detail, created_at)
     VALUES (?, ?, 'exception_draft_created', ?, ?, ?)`,
    [`caseevt_${randomUUID()}`, caseRow.id, input.actor, JSON.stringify({ draft_id: id, target_rule_key: targetRuleKey, direction: input.direction }), now],
  );
  logEvent(input.actor, 'investigation_exception_draft_created', 'investigation_exception_draft', id, JSON.stringify({ alert_id: alert.id, target_rule_key: targetRuleKey }), 'dashboard');
  return normalizeDraft(queryOne<DraftRow>('SELECT * FROM investigation_exception_drafts WHERE id = ?', [id])!);
}

export function replayInvestigationExceptionDraft(draftId: string, actor: string, alertId: string): Record<string, unknown> {
  const draft = queryOne<DraftRow>('SELECT * FROM investigation_exception_drafts WHERE id = ?', [draftId]);
  if (!draft) throw new Error('Draft not found');
  if (draft.alert_id !== alertId) throw new Error('Draft does not belong to this alert');
  if (draft.status === 'activated' || draft.status === 'deactivated' || draft.status === 'discarded') throw new Error(`Draft is ${draft.status}`);
  const alert = queryOne<AlertRecord>('SELECT * FROM alerts WHERE id = ?', [draft.alert_id]);
  if (!alert) throw new Error('Alert not found');
  const { detail } = resolvePrimaryEvidence(alert);
  const specimen = detail.payload_excerpt || '';
  if (!specimen) throw new Error('No stored redacted payload is available for replay');
  const direction = draft.direction === 'both'
    ? (detail.direction === 'outbound' ? 'outbound' : 'inbound')
    : draft.direction;
  const baseline = direction === 'outbound'
    ? outboundScan(specimen)
    : shieldScan(specimen, { includeRedacted: true });
  const baselineHasTarget = baseline.detections.some((detection) =>
    (detection.rule_key || detection.rule_snapshot?.stable_id || detection.id) === draft.target_rule_key,
  );
  if (!baselineHasTarget) {
    throw new Error('Stored redacted evidence cannot reproduce the selected rule; collect more evidence before activating an exception');
  }
  const replay = createReplayCase({
    text: specimen,
    sourceType: 'alert',
    sourceId: alert.id,
    original: {
      verdict: (detail.verdict as 'BLOCK' | 'REVIEW' | 'ALLOW') || 'ALLOW',
      score: detail.score || 0,
      detections: detail.shield_detections || [],
    },
    actor,
    direction,
    exceptionOverlays: { [draft.target_rule_key]: [draft.exception_text] },
    originalProfile: detail.profile_id || null,
  }) as { id: string; replay: { verdict: string; score: number; detections: ShieldDetection[] }; comparison: Record<string, unknown> };
  const targetStillPresent = replay.replay.detections.some((detection) =>
    (detection.rule_key || detection.rule_snapshot?.stable_id || detection.id) === draft.target_rule_key,
  );
  const result = {
    ...replay,
    baseline: {
      verdict: baseline.verdict,
      score: baseline.score,
      detections: sanitizeDetectionsForCapture(baseline.detections, getInvestigationCapturePolicy().mode),
    },
    target_rule_removed: !targetStillPresent,
    activation_ready: baselineHasTarget && !targetStillPresent,
  };
  const now = new Date().toISOString();
  run(
    `UPDATE investigation_exception_drafts
     SET status = ?, replay_case_id = ?, replay_result = ?, replayed_at = ?
     WHERE id = ?`,
    [targetStillPresent ? 'replayed' : 'ready', replay.id, JSON.stringify(result), now, draft.id],
  );
  run(
    `INSERT INTO investigation_case_events (id, case_id, event_type, actor, detail, created_at)
     VALUES (?, ?, 'exception_draft_replayed', ?, ?, ?)`,
    [`caseevt_${randomUUID()}`, draft.case_id, actor, JSON.stringify({ draft_id: draft.id, replay_case_id: replay.id, activation_ready: !targetStillPresent }), now],
  );
  logEvent(actor, 'investigation_exception_draft_replayed', 'investigation_exception_draft', draft.id, JSON.stringify({ replay_case_id: replay.id, activation_ready: !targetStillPresent }), 'dashboard');
  return normalizeDraft(queryOne<DraftRow>('SELECT * FROM investigation_exception_drafts WHERE id = ?', [draft.id])!);
}

export function activateInvestigationExceptionDraft(draftId: string, actor: string, alertId: string): Record<string, unknown> {
  const draft = queryOne<DraftRow>('SELECT * FROM investigation_exception_drafts WHERE id = ?', [draftId]);
  if (!draft) throw new Error('Draft not found');
  if (draft.alert_id !== alertId) throw new Error('Draft does not belong to this alert');
  if (draft.status !== 'ready' || !draft.replay_case_id) throw new Error('Draft must pass replay before activation');
  const now = new Date().toISOString();
  run(
    `UPDATE investigation_exception_drafts
     SET status = 'activated', activated_by = ?, activated_at = ? WHERE id = ?`,
    [actor, now, draft.id],
  );
  run(
    `INSERT INTO investigation_case_events (id, case_id, event_type, actor, detail, created_at)
     VALUES (?, ?, 'exception_activated', ?, ?, ?)`,
    [`caseevt_${randomUUID()}`, draft.case_id, actor, JSON.stringify({ draft_id: draft.id, target_rule_key: draft.target_rule_key, replay_case_id: draft.replay_case_id }), now],
  );
  invalidateInvestigationExceptionCache();
  logEvent(actor, 'investigation_exception_activated', 'investigation_exception_draft', draft.id, JSON.stringify({ target_rule_key: draft.target_rule_key, replay_case_id: draft.replay_case_id }), 'dashboard');
  return normalizeDraft(queryOne<DraftRow>('SELECT * FROM investigation_exception_drafts WHERE id = ?', [draft.id])!);
}

export function discardInvestigationExceptionDraft(draftId: string, actor: string, alertId: string): Record<string, unknown> {
  const draft = queryOne<DraftRow>('SELECT * FROM investigation_exception_drafts WHERE id = ?', [draftId]);
  if (!draft) throw new Error('Draft not found');
  if (draft.alert_id !== alertId) throw new Error('Draft does not belong to this alert');
  if (draft.status === 'activated') throw new Error('Deactivate this exception before discarding it');
  const now = new Date().toISOString();
  run("UPDATE investigation_exception_drafts SET status = 'discarded' WHERE id = ?", [draft.id]);
  run(
    `INSERT INTO investigation_case_events (id, case_id, event_type, actor, detail, created_at)
     VALUES (?, ?, 'exception_draft_discarded', ?, ?, ?)`,
    [`caseevt_${randomUUID()}`, draft.case_id, actor, JSON.stringify({ draft_id: draft.id }), now],
  );
  logEvent(actor, 'investigation_exception_draft_discarded', 'investigation_exception_draft', draft.id, '{}', 'dashboard');
  return normalizeDraft(queryOne<DraftRow>('SELECT * FROM investigation_exception_drafts WHERE id = ?', [draft.id])!);
}

export function deactivateInvestigationExceptionDraft(draftId: string, actor: string, alertId: string): Record<string, unknown> {
  const draft = queryOne<DraftRow>('SELECT * FROM investigation_exception_drafts WHERE id = ?', [draftId]);
  if (!draft) throw new Error('Draft not found');
  if (draft.alert_id !== alertId) throw new Error('Draft does not belong to this alert');
  if (draft.status !== 'activated') throw new Error('Only an activated exception can be deactivated');
  const now = new Date().toISOString();
  run("UPDATE investigation_exception_drafts SET status = 'deactivated' WHERE id = ?", [draft.id]);
  run(
    `INSERT INTO investigation_case_events (id, case_id, event_type, actor, detail, created_at)
     VALUES (?, ?, 'exception_deactivated', ?, ?, ?)`,
    [`caseevt_${randomUUID()}`, draft.case_id, actor, JSON.stringify({ draft_id: draft.id, target_rule_key: draft.target_rule_key }), now],
  );
  invalidateInvestigationExceptionCache();
  logEvent(actor, 'investigation_exception_deactivated', 'investigation_exception_draft', draft.id, JSON.stringify({ target_rule_key: draft.target_rule_key }), 'dashboard');
  return normalizeDraft(queryOne<DraftRow>('SELECT * FROM investigation_exception_drafts WHERE id = ?', [draft.id])!);
}

export function buildInvestigationManagementSummary(alertId: string): string | null {
  const workbench = getInvestigationWorkbench(alertId) as Record<string, any> | null;
  if (!workbench) return null;
  const overview = workbench.overview || {};
  const decision = workbench.case;
  const detections = Array.isArray(workbench.detections) ? workbench.detections : [];
  const lines = [
    `# ClawNex Investigation Summary`,
    ``,
    `- Alert: ${workbench.alert.title} (${workbench.alert.id})`,
    `- Outcome: ${overview.verdict || 'Unknown'} at score ${overview.score ?? 'unknown'}`,
    `- Direction: ${overview.direction || 'unknown'}`,
    `- Time: ${workbench.alert.created_at}`,
    `- Model / provider: ${overview.model || 'unknown'} / ${overview.provider || 'unknown'}`,
    `- Evidence hash: ${workbench.evidence_hash}`,
    `- Capture complete: ${overview.capture_complete ? 'Yes' : 'No — review truncation or missing-evidence notices'}`,
    ``,
    `## Basis for the decision`,
    workbench.scoring?.verdict_basis || 'No versioned scoring ledger was captured for this event.',
    ``,
    `## Triggered rules`,
    ...detections.map((detection: any) => `- ${detection.stable_rule_id}: ${detection.name} (${detection.severity}, contribution ${detection.score_contribution ?? 'legacy/unknown'})`),
    ``,
    `## Operator disposition`,
    decision?.disposition
      ? `${decision.disposition}: ${decision.rationale || 'No rationale recorded'}`
      : 'No operator disposition has been recorded.',
    ``,
    `Generated: ${new Date().toISOString()}`,
  ];
  return lines.join('\n');
}
