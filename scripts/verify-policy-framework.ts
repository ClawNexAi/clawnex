#!/usr/bin/env tsx
/**
 * Policy framework QA harness — runs the reviewer's 2026-05-01 probe set
 * + a few expansion probes against the post-cutover scanner. Used
 * during Stage 4 verification and as a regression fence in CI.
 */

import { outboundScan, shieldScan } from '../src/lib/shield/scanner';

interface Probe {
  label: string;
  text: string;
  direction: 'inbound' | 'outbound';
  expect: 'BLOCK' | 'REVIEW' | 'ALLOW';
  expectRuleKeys?: string[]; // rule_key substrings the result MUST contain
}

const PROBES: Probe[] = [
  // Outbound DLP — the reviewer's 2026-05-01 retest
  { label: 'fake SSN',            text: 'Patient SSN: 999-99-9999.',           direction: 'outbound', expect: 'BLOCK',  expectRuleKeys: ['OUT-PII-SSN'] },
  { label: 'fake CC',             text: 'Card: 1111-2222-3333-4444',           direction: 'outbound', expect: 'BLOCK',  expectRuleKeys: ['OUT-PII-CREDIT_CARD'] },
  { label: 'fake email',          text: 'Forward to alice@example.com',         direction: 'outbound', expect: 'REVIEW', expectRuleKeys: ['OUT-PII-EMAIL'] },
  { label: 'fake phone',          text: 'Call 555-123-4567',                   direction: 'outbound', expect: 'REVIEW', expectRuleKeys: ['OUT-PII-PHONE_US'] },
  { label: 'fake DOB',            text: 'DOB: 03/14/1985',                     direction: 'outbound', expect: 'REVIEW', expectRuleKeys: ['OUT-PII-DATE_OF_BIRTH'] },
  { label: 'password assignment', text: 'password="hunter2"',                  direction: 'outbound', expect: 'BLOCK',  expectRuleKeys: ['OUT-PASSWORD_ASSIGNMENT'] },
  { label: 'env var leak',        text: 'process.env["SECRET_KEY"]',           direction: 'outbound', expect: 'REVIEW', expectRuleKeys: ['OUT-ENV_VARIABLE_LEAK'] },
  { label: 'private key',         text: '-----BEGIN RSA PRIVATE KEY-----\nMII', direction: 'outbound', expect: 'BLOCK',  expectRuleKeys: ['SEC-PRIVKEY'] },

  // Negative controls
  { label: 'benign outbound',     text: 'The weather is fine today.',          direction: 'outbound', expect: 'ALLOW' },
  { label: 'benign inbound',      text: 'How do I rotate my API key?',         direction: 'inbound',  expect: 'ALLOW' },
];

let pass = 0, fail = 0;
for (const p of PROBES) {
  const r = p.direction === 'outbound' ? outboundScan(p.text) : shieldScan(p.text);
  const verdictOk = r.verdict === p.expect;
  const keysOk = !p.expectRuleKeys || p.expectRuleKeys.every(k => r.detections.some(d => ((d as any).rule_key || d.id || '').includes(k)));
  const ok = verdictOk && keysOk;
  if (ok) pass++; else fail++;
  const detectionSummary = r.detections.map(d => (d as any).rule_key || d.id).slice(0, 3).join(',');
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), p.label.padEnd(22), `expect=${p.expect}/${(p.expectRuleKeys || []).join('|')}`.padEnd(40), `got=${r.verdict}/${detectionSummary}`);
}

console.log(`\nResult: ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
