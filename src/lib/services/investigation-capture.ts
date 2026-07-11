import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { queryOne, run } from '@/lib/db/index';
import { getSetting, setSetting } from '@/lib/services/config-service';
import { logEvent, logEventStrict } from '@/lib/services/audit-logger';
import { redact } from '@/lib/shield/scanner';
import type { ShieldDetection } from '@/lib/types';

export type InvestigationCaptureMode = 'metadata' | 'redacted' | 'forensic';

export interface InvestigationCapturePolicy {
  mode: InvestigationCaptureMode;
  redactedLimit: number;
  forensicRetentionHours: number;
  relatedWindowMinutes: number;
  forensicAvailable: boolean;
}

interface ForensicRow {
  id: string;
  audit_event_id: string;
  direction: string;
  algorithm: 'aes-256-gcm';
  key_id: string;
  aad_version: 1;
  nonce: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
  content_sha256: string;
  original_bytes: number;
  created_at: string;
  expires_at: string;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function encryptionKey(): Buffer | null {
  const raw = process.env.EVIDENCE_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (!/^[0-9a-f]{64}$/i.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function aadFor(row: {
  id: string;
  auditEventId: string;
  direction: string;
  algorithm: string;
  keyId: string;
  contentSha256: string;
  originalBytes: number;
  createdAt: string;
  expiresAt: string;
}): Buffer {
  return Buffer.from(JSON.stringify([
    1, row.id, row.auditEventId, row.direction, row.algorithm, row.keyId,
    row.contentSha256, row.originalBytes, row.createdAt, row.expiresAt,
  ]), 'utf8');
}

export function redactInvestigationEvidence(content: string, detections: ShieldDetection[]): string {
  let output = redact(content)
    .replace(/\b([A-Z][A-Z0-9_]{2,})=([^\s'"]{4,})/g, '$1=[SECRET_REDACTED]')
    .replace(/\b(sk-[a-zA-Z0-9-]+-|ghp_|gho_|ghu_|ghr_|github_pat_|nvapi-|AIza)[A-Za-z0-9_\-]{12,}/g, '$1[SECRET_REDACTED]');
  for (const detection of detections) {
    if (!['secret', 'outbound-leak', 'financial'].includes(detection.category)) continue;
    for (const sample of detection.samples || []) {
      if (sample.length >= 4) output = output.split(sample).join(`[MATCH_REDACTED:${detection.rule_key || detection.id}]`);
    }
  }
  return output;
}

export function sanitizeDetectionsForCapture(detections: ShieldDetection[], mode: InvestigationCaptureMode): ShieldDetection[] {
  return detections.map((detection) => ({
    ...detection,
    samples: mode === 'metadata'
      ? []
      : (detection.samples || []).map((sample) =>
          ['secret', 'outbound-leak', 'financial'].includes(detection.category)
            ? `[MATCH_REDACTED:${detection.rule_key || detection.id}]`
            : redact(sample)),
  }));
}

export function getInvestigationCapturePolicy(): InvestigationCapturePolicy {
  const rawMode = getSetting('investigation_capture_mode');
  const mode: InvestigationCaptureMode = rawMode === 'metadata' || rawMode === 'forensic' ? rawMode : 'redacted';
  return {
    mode,
    redactedLimit: boundedInt(getSetting('investigation_redacted_limit'), 16_384, 1_024, 131_072),
    forensicRetentionHours: boundedInt(getSetting('investigation_forensic_retention_hours'), 24, 1, 72),
    relatedWindowMinutes: boundedInt(getSetting('investigation_related_window_minutes'), 15, 1, 1_440),
    forensicAvailable: encryptionKey() !== null,
  };
}

export function updateInvestigationCapturePolicy(input: {
  mode: InvestigationCaptureMode;
  redactedLimit: number;
  forensicRetentionHours: number;
  relatedWindowMinutes: number;
}): InvestigationCapturePolicy {
  if (!['metadata', 'redacted', 'forensic'].includes(input.mode)) throw new Error('Invalid capture mode');
  if (input.mode === 'forensic' && !encryptionKey()) {
    throw new Error('Forensic capture requires EVIDENCE_ENCRYPTION_KEY');
  }
  setSetting('investigation_capture_mode', input.mode);
  setSetting('investigation_redacted_limit', String(Math.floor(Math.min(131_072, Math.max(1_024, input.redactedLimit)))));
  setSetting('investigation_forensic_retention_hours', String(Math.floor(Math.min(72, Math.max(1, input.forensicRetentionHours)))));
  setSetting('investigation_related_window_minutes', String(Math.floor(Math.min(1_440, Math.max(1, input.relatedWindowMinutes)))));
  return getInvestigationCapturePolicy();
}

export function storeForensicPayload(input: {
  auditEventId: string;
  direction: string;
  content: string;
}): { id: string; expiresAt: string } | null {
  const policy = getInvestigationCapturePolicy();
  if (policy.mode !== 'forensic') return null;
  const key = encryptionKey();
  if (!key) return null;

  const nonce = randomBytes(12);
  const id = `forensic_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + policy.forensicRetentionHours * 60 * 60 * 1000).toISOString();
  const contentSha256 = createHash('sha256').update(input.content).digest('hex');
  const originalBytes = Buffer.byteLength(input.content, 'utf8');
  const currentKeyId = keyId(key);
  const algorithm = 'aes-256-gcm';
  const cipher = createCipheriv(algorithm, key, nonce);
  cipher.setAAD(aadFor({ id, auditEventId: input.auditEventId, direction: input.direction, algorithm, keyId: currentKeyId, contentSha256, originalBytes, createdAt, expiresAt }));
  const encrypted = Buffer.concat([cipher.update(input.content, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  run(
    `INSERT INTO investigation_forensic_payloads
      (id, audit_event_id, direction, algorithm, key_id, aad_version, nonce, ciphertext,
       auth_tag, content_sha256, original_bytes, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.auditEventId, input.direction, algorithm, currentKeyId,
      nonce, encrypted, authTag, contentSha256, originalBytes, createdAt, expiresAt,
    ],
  );
  return { id, expiresAt };
}

export function forensicPayloadStatus(auditEventId: string): {
  available: boolean;
  expiresAt: string | null;
  originalLength: number | null;
} {
  const row = queryOne<Pick<ForensicRow, 'expires_at' | 'original_bytes'>>(
    'SELECT expires_at, original_bytes FROM investigation_forensic_payloads WHERE audit_event_id = ?',
    [auditEventId],
  );
  return {
    available: Boolean(row && Date.parse(row.expires_at) > Date.now()),
    expiresAt: row?.expires_at ?? null,
    originalLength: row?.original_bytes ?? null,
  };
}

export function revealForensicPayload(auditEventId: string, actor: string, reason: string): {
  content: string;
  direction: string;
  contentHash: string;
  originalLength: number;
  expiresAt: string;
} | null {
  const row = queryOne<ForensicRow>(
    'SELECT * FROM investigation_forensic_payloads WHERE audit_event_id = ?',
    [auditEventId],
  );
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  const key = encryptionKey();
  if (!key) throw new Error('Forensic evidence key is unavailable');
  if (keyId(key) !== row.key_id) throw new Error('Forensic evidence key does not match this record');
  if (!reason.trim()) throw new Error('A reason is required to reveal forensic evidence');
  if (reason.trim().length > 500) throw new Error('Forensic reveal reason must be 500 characters or fewer');
  // Fail closed: plaintext is not decrypted unless the authorization event is
  // durably written first.
  try {
    logEventStrict(actor, 'investigation_forensic_reveal_authorized', 'audit_event', auditEventId, JSON.stringify({ reason: reason.trim(), content_sha256: row.content_sha256, expires_at: row.expires_at }), 'dashboard');
  } catch {
    throw new Error('Forensic reveal audit is unavailable; no evidence was decrypted');
  }
  let content: string;
  try {
    const decipher = createDecipheriv(row.algorithm, key, row.nonce);
    decipher.setAAD(aadFor({
      id: row.id,
      auditEventId: row.audit_event_id,
      direction: row.direction,
      algorithm: row.algorithm,
      keyId: row.key_id,
      contentSha256: row.content_sha256,
      originalBytes: row.original_bytes,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
    decipher.setAuthTag(row.auth_tag);
    content = Buffer.concat([
      decipher.update(row.ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    logEvent(actor, 'investigation_forensic_reveal_failed_integrity', 'audit_event', auditEventId, JSON.stringify({ content_sha256: row.content_sha256 }), 'dashboard');
    throw new Error('Forensic evidence failed its integrity check');
  }
  logEvent(
    actor,
    'investigation_forensic_evidence_revealed',
    'audit_event',
    auditEventId,
    JSON.stringify({ content_sha256: row.content_sha256, original_bytes: row.original_bytes, expires_at: row.expires_at }),
    'dashboard',
  );
  return {
    content,
    direction: row.direction,
    contentHash: row.content_sha256,
    originalLength: row.original_bytes,
    expiresAt: row.expires_at,
  };
}
