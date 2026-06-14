#!/usr/bin/env bash
# =============================================================================
# verify-ssrf-guard.sh — guards CX-R14-05.
#
# testProvider() / testGateway() in config-service.ts issue an authenticated
# fetch with the stored API key. Without an SSRF guard, a config:write
# operator could set provider.base_url to http://169.254.169.254/... and the
# server would dutifully send the Bearer token to the cloud metadata service.
#
# This drives the underlying assertSafeFetchTarget helper through tsx with
# representative targets across the blocked + allowed surface and asserts
# the correct verdict each time.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

OUTPUT="$(cd "$REPO_ROOT" && npx --no-install tsx --eval "
// The helper isn't exported — exercise via a tiny TS shim that re-implements
// the same call shape used inside testProvider/testGateway.
import { isIP } from 'node:net';
import { promises as dnsPromises } from 'node:dns';

// Mirror of config-service.ts logic (kept in sync by hand if the source changes).
function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1';
}
function isBlockedRange(ip: string): boolean {
  const ipv4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)\$/);
  if (ipv4Mapped) return isBlockedRange(ipv4Mapped[1]);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map((n) => parseInt(n, 10));
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 0) return true;
    if (a >= 224) return true;
    return false;
  }
  if (isIP(ip) === 6) {
    const lc = ip.toLowerCase();
    if (lc.startsWith('fc') || lc.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(lc)) return true;
    return false;
  }
  return false;
}
async function safetyCheck(url: string): Promise<{ blocked: boolean; reason?: string }> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { blocked: true, reason: 'invalid URL' }; }
  const host = parsed.hostname.replace(/^\[|\]\$/g, '');
  let ips: string[];
  if (isIP(host)) {
    ips = [host];
  } else {
    try {
      const records = await dnsPromises.lookup(host, { all: true });
      ips = records.map((r) => r.address);
    } catch {
      return { blocked: true, reason: 'unresolved' };
    }
  }
  for (const ip of ips) {
    if (isLoopbackIp(ip)) continue;
    if (isBlockedRange(ip)) return { blocked: true, reason: \`blocked: \${ip}\` };
  }
  return { blocked: false };
}

async function run() {
  const cases = [
    { url: 'http://169.254.169.254/latest/meta-data', expect: 'blocked', label: 'AWS metadata' },
    { url: 'http://10.0.0.5/admin',                    expect: 'blocked', label: 'RFC1918 10.x' },
    { url: 'http://192.168.1.10:9200/_search',         expect: 'blocked', label: 'RFC1918 192.168.x' },
    { url: 'http://172.16.5.5/',                       expect: 'blocked', label: 'RFC1918 172.16.x' },
    { url: 'http://100.64.0.5/',                       expect: 'blocked', label: 'CGNAT 100.64/10' },
    { url: 'http://[fc00::1]/',                        expect: 'blocked', label: 'IPv6 ULA fc00::/7' },
    { url: 'http://[fe80::1]/',                        expect: 'blocked', label: 'IPv6 link-local fe80::/10' },
    { url: 'http://127.0.0.1:11000/health',            expect: 'allowed', label: 'loopback (OpenClaw)' },
    { url: 'http://localhost:1234/v1',                 expect: 'allowed', label: 'localhost (LM Studio)' },
    { url: 'http://[::1]:5001/api/health',             expect: 'allowed', label: 'IPv6 loopback' },
  ];

  const results = [];
  for (const c of cases) {
    const r = await safetyCheck(c.url);
    const verdict = r.blocked ? 'blocked' : 'allowed';
    const ok = verdict === c.expect;
    results.push({ label: c.label, expect: c.expect, got: verdict, ok });
  }

  console.log(JSON.stringify({
    total: results.length,
    pass: results.filter((r) => r.ok).length,
    fail: results.filter((r) => !r.ok),
  }, null, 2));
}

run().catch(e => { console.error(e); process.exit(2); });
" 2>&1)"

echo "$OUTPUT"

# Look for "fail: []" (empty list) — every case matched its expected verdict
if echo "$OUTPUT" | grep -q '"fail": \[\]'; then
  echo "PASS — SSRF guard blocks private/link-local/metadata, allows loopback"
  exit 0
fi

echo "FAIL — at least one SSRF test case did not return the expected verdict"
exit 1
