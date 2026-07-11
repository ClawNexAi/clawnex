import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ShieldScanResult } from '../src/lib/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`PASS: ${message}`);
}

async function main(): Promise<void> {
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawnex-shield-evidence-'));
process.env.DATABASE_PATH = path.join(tempDir, 'evidence.db');
process.env.CLAWNEX_TEST_SKIP_DB_SEED = '1';
process.env.CLAWNEX_AUDIT_STDOUT = 'false';
const { getDb } = await import('../src/lib/db/index');
const { updateInvestigationCapturePolicy } = await import('../src/lib/services/investigation-capture');
const { buildShieldEvidence } = await import('../src/lib/services/shield-evidence');
getDb();
updateInvestigationCapturePolicy({ mode: 'redacted', redactedLimit: 16_384, forensicRetentionHours: 24, relatedWindowMinutes: 15 });

const scanResult: ShieldScanResult = {
  verdict: 'BLOCK',
  score: 80,
  elapsed: '2ms',
  cleaned: '',
  stats: { total: 1, critical: 1, high: 0, medium: 0, low: 0, categories: ['jailbreak'] },
  detections: [{
    id: 'JAIL-TEST',
    rule_key: 'JAIL-TEST',
    name: 'Test jailbreak',
    category: 'jailbreak',
    severity: 'CRITICAL',
    confidence: 1,
    matchCount: 1,
    samples: ['GODMODE'],
    tags: ['test'],
    source: 'clawnex',
  }],
};

const built = buildShieldEvidence({
  actor: 'test',
  action: 'shield_scan_block',
  auditSource: 'test',
  resourceType: 'shield',
  resourceId: 'scan-1',
  content: 'Contact operator@example.com and enable GODMODE.',
  scanResult,
  direction: 'inbound',
  promptHash: 'hash-1',
  shieldScanId: 'scan-1',
});

const excerpt = String(built.detail.payload_excerpt);
assert(!excerpt.includes('operator@example.com'), 'evidence excerpt removes raw email addresses');
assert(excerpt.includes('[EMAIL_REDACTED]'), 'evidence excerpt retains a useful redaction marker');
assert(Array.isArray(built.detail.shield_detections), 'structured detections are persisted');
const detection = (built.detail.shield_detections as Array<{ risk_context?: { why_risky?: string; escalation_guidance?: string } }>)[0];
assert(Boolean(detection.risk_context?.why_risky), 'evidence explains why the matched category is risky');
assert(Boolean(detection.risk_context?.escalation_guidance), 'evidence includes an escalation threshold');
assert(built.alertMetadata.source_event_id === 'scan-1', 'alert metadata links to the source scan');
assert(built.alertMetadata.source_event_type === 'shield_scan', 'source event type distinguishes scans from proxy traffic');
assert(!('payload_excerpt' in built.alertMetadata), 'alert metadata never contains payload text');

const longBuilt = buildShieldEvidence({
  actor: 'test',
  action: 'shield_scan_block',
  auditSource: 'test',
  resourceType: 'shield',
  resourceId: 'scan-2',
  content: `GODMODE ${'x'.repeat(20_000)}`,
  scanResult,
  direction: 'inbound',
  promptHash: 'hash-2',
  shieldScanId: 'scan-2',
});
assert(longBuilt.detail.payload_excerpt_truncated === true, 'long payloads are marked truncated');
assert(String(longBuilt.detail.payload_excerpt).length < 16_500, 'persisted evidence excerpt is bounded by capture policy');

console.log('\nShield evidence contract verified.');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
