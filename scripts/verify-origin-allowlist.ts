/**
 * verify-origin-allowlist.ts — Codex 2026-05-17 #2 regression.
 *
 * Before this fix, validateOriginMatch only checked Host === Origin.
 * An attacker who points attacker.example at 127.0.0.1 (a domain they
 * control via DNS) makes the victim's browser send Host: attacker.example
 * + Origin: http://attacker.example — they match, the check passes, and
 * requireLocalhost's bind-layer trust (HOSTNAME=127.0.0.1 → loopback
 * socket) accepts the request. Every RBAC-off mutation route opened up
 * to a remote attacker's webpage running in the victim's browser.
 *
 * This verifier proves:
 *   1. Cross-host requests still rejected (regression on existing check).
 *   2. Host=Origin match plus loopback hostname → allowed (dev path).
 *   3. Host=Origin match plus configured AUTH_EXPECTED_ORIGIN → allowed
 *      (production behind Caddy).
 *   4. Host=Origin match plus attacker.example (the DNS rebinding shape)
 *      → REJECTED with 403 'host not on allowlist'.
 *   5. Comma-separated TRUSTED_HOSTS env adds additional allowed hosts.
 *   6. Non-browser requests (no Origin/Referer) still allowed (CLI/MCP).
 *   7. Safe methods (GET/HEAD/OPTIONS) bypass the check entirely.
 *
 * Run: npx tsx scripts/verify-origin-allowlist.ts
 */

import { NextRequest } from "next/server";
import { validateOriginMatch } from "../src/lib/auth/origin-match";

type Status = { pass: number; fail: number };
const status: Status = { pass: 0, fail: 0 };
const TEST_PUBLIC_HOST = process.env.CLAWNEX_TEST_PUBLIC_HOST || "qa.example.invalid";
const TEST_PUBLIC_ORIGIN = `https://${TEST_PUBLIC_HOST}`;

function assert(cond: unknown, desc: string) {
  if (cond) {
    status.pass++;
    console.log(`  ✓ ${desc}`);
  } else {
    status.fail++;
    console.log(`  ✗ ${desc}`);
  }
}

function section(name: string) {
  console.log(`\n[${name}]`);
}

function probe(opts: { method?: string; host: string; origin?: string; referer?: string }): { status: number; body: string | null } {
  const headers: Record<string, string> = { host: opts.host };
  if (opts.origin) headers.origin = opts.origin;
  if (opts.referer) headers.referer = opts.referer;
  const req = new NextRequest(`http://${opts.host}/api/system/purge`, {
    method: opts.method || "POST",
    headers,
  });
  const res = validateOriginMatch(req);
  if (!res) return { status: 200, body: null };
  return { status: res.status, body: null };
}

// ---------------------------------------------------------------------------

// Clear env baseline so each section sets what it needs.
delete process.env.AUTH_EXPECTED_ORIGIN;
delete process.env.TRUSTED_HOSTS;

section("regression: existing Host !== Origin still rejected");
const crossHost = probe({ host: "localhost:5001", origin: "http://evil.com" });
assert(crossHost.status === 403, `evil.com origin vs localhost:5001 host → 403 (got ${crossHost.status})`);

section("dev path: Host=Origin on loopback → allowed (default allowlist)");
const dev = probe({ host: "localhost:5001", origin: "http://localhost:5001" });
assert(dev.status === 200, `localhost:5001 Host+Origin match → allowed (got ${dev.status})`);
const dev127 = probe({ host: "127.0.0.1:5001", origin: "http://127.0.0.1:5001" });
assert(dev127.status === 200, `127.0.0.1:5001 Host+Origin match → allowed (got ${dev127.status})`);

section("DNS rebinding (Codex #2 attack shape): attacker.example with matching Origin → REJECTED");
const dnsRebind = probe({ host: "attacker.example", origin: "http://attacker.example" });
assert(dnsRebind.status === 403, `attacker.example Host+Origin match still REJECTED by allowlist (got ${dnsRebind.status})`);
const dnsRebindWithPort = probe({ host: "attacker.example:8080", origin: "http://attacker.example:8080" });
assert(dnsRebindWithPort.status === 403, `attacker.example:8080 same shape → REJECTED (got ${dnsRebindWithPort.status})`);

section("production path: AUTH_EXPECTED_ORIGIN adds public domain to allowlist");
process.env.AUTH_EXPECTED_ORIGIN = TEST_PUBLIC_ORIGIN;
const prod = probe({ host: TEST_PUBLIC_HOST, origin: TEST_PUBLIC_ORIGIN });
assert(prod.status === 200, `${TEST_PUBLIC_HOST} Host+Origin under AUTH_EXPECTED_ORIGIN → allowed (got ${prod.status})`);
// Attacker.example still rejected even with AUTH_EXPECTED_ORIGIN set
const prodAttack = probe({ host: "attacker.example", origin: "http://attacker.example" });
assert(prodAttack.status === 403, `attacker.example still REJECTED under prod env (got ${prodAttack.status})`);

section("TRUSTED_HOSTS env extends allowlist for multi-domain / Tailscale setups");
process.env.TRUSTED_HOSTS = "host-a.example.invalid, host-b.example.invalid";
const ts1 = probe({ host: "host-a.example.invalid", origin: "https://host-a.example.invalid" });
const ts2 = probe({ host: "host-b.example.invalid", origin: "https://host-b.example.invalid" });
assert(ts1.status === 200, `host-a.example.invalid (from TRUSTED_HOSTS) → allowed (got ${ts1.status})`);
assert(ts2.status === 200, `host-b.example.invalid (from TRUSTED_HOSTS) → allowed (got ${ts2.status})`);
delete process.env.TRUSTED_HOSTS;
delete process.env.AUTH_EXPECTED_ORIGIN;

section("non-browser requests (no Origin AND no Referer) still allowed (CLI/MCP path)");
const cli = probe({ host: "localhost:5001" });
assert(cli.status === 200, `no Origin + no Referer → allowed for non-browser callers (got ${cli.status})`);

section("Codex round 2 #2: GET requests also enforce host allowlist (DNS-rebinding read protection)");
// Round-1 fix exited early on safe methods so attacker.example GETs
// passed through, leaving RBAC-off read routes exposed to DNS-rebinding
// pages reading response bodies. Now: GET to attacker.example also
// gets rejected by the allowlist.
const rebindGet = probe({ method: "GET", host: "attacker.example", origin: "http://attacker.example" });
assert(rebindGet.status === 403, `GET attacker.example Host → REJECTED by allowlist (got ${rebindGet.status})`);
const rebindHead = probe({ method: "HEAD", host: "attacker.example" });
assert(rebindHead.status === 403, `HEAD attacker.example Host (no Origin) → REJECTED by allowlist (got ${rebindHead.status})`);
const rebindOptions = probe({ method: "OPTIONS", host: "attacker.example", origin: "http://attacker.example" });
assert(rebindOptions.status === 403, `OPTIONS attacker.example → REJECTED by allowlist (got ${rebindOptions.status})`);

section("legitimate GETs to allowed hosts still pass through");
const getLocal = probe({ method: "GET", host: "localhost:5001" });
assert(getLocal.status === 200, `GET to localhost:5001 (default allowlist) → allowed (got ${getLocal.status})`);
process.env.AUTH_EXPECTED_ORIGIN = TEST_PUBLIC_ORIGIN;
const getProd = probe({ method: "GET", host: TEST_PUBLIC_HOST });
assert(getProd.status === 200, `GET to ${TEST_PUBLIC_HOST} (AUTH_EXPECTED_ORIGIN) → allowed (got ${getProd.status})`);
delete process.env.AUTH_EXPECTED_ORIGIN;
const getLoopbackIp = probe({ method: "GET", host: "127.0.0.1:5001" });
assert(getLoopbackIp.status === 200, `GET to 127.0.0.1:5001 → allowed (got ${getLoopbackIp.status})`);

console.log(`\nResult: ${status.pass} passed, ${status.fail} failed`);
if (status.fail > 0) process.exit(1);
