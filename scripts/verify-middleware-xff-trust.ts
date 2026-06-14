/**
 * verify-middleware-xff-trust.ts — Codex 2026-05-17 #5 regression.
 *
 * Before this fix the rate-limit middleware in src/middleware.ts read
 * X-Forwarded-For / X-Real-IP unconditionally. An attacker rotating those
 * headers on each request got a fresh bucket per spoofed value and
 * bypassed both the 10s burst and 60s sustained limiters. On staging host the
 * Caddyfile ships without the rate-limit plugin (deploy-prod.sh flags it
 * at install time), so this middleware is the SOLE rate-limit defense.
 *
 * This verifier proves two invariants:
 *   1. With TRUST_PROXY_HEADERS unset (default), rotating XFF values
 *      across N requests still share ONE bucket — spoofers cannot
 *      fragment their way out of the burst limit.
 *   2. With TRUST_PROXY_HEADERS=1 (explicitly trusted, used after
 *      deploy/install-prod.sh configures Caddy with
 *      `header_up X-Forwarded-For {remote_host}`), the middleware uses
 *      the XFF value for bucketing, and distinct values do get distinct
 *      buckets (this is the only way Caddy-driven per-client rate-limit
 *      can work).
 *
 * Run: npx tsx scripts/verify-middleware-xff-trust.ts
 */

import { NextRequest } from "next/server";

import { middleware } from "../src/middleware";

type Status = { pass: number; fail: number };
const status: Status = { pass: 0, fail: 0 };

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

function hit(path: string, xff: string): number {
  // Use a unique path per assertion call site so buckets from one
  // section don't interfere with another. Caller passes the path.
  const res = middleware(
    new NextRequest(`http://clawnex.local${path}`, {
      headers: { "x-forwarded-for": xff },
    }),
  );
  return res.status;
}

// ---------------------------------------------------------------------------

section("TRUST_PROXY_HEADERS unset (default) — rotating XFF cannot fragment buckets");
delete process.env.TRUST_PROXY_HEADERS;
// /api/audit burst policy: 10 hits per 10s. With XFF ignored, all 12
// requests share the 'unknown:/api/audit-rotating' bucket; hit 11 must 429.
const rotatingStatuses: number[] = [];
for (let i = 0; i < 12; i += 1) {
  // Unique XFF per request — if middleware were honoring them, each would
  // get its own bucket and all 12 would return 200.
  rotatingStatuses.push(hit("/api/audit-rotating", `198.51.100.${100 + i}`));
}
assert(
  rotatingStatuses.slice(0, 10).every((s) => s === 200),
  `first 10 rotating-XFF requests return 200 (got ${rotatingStatuses.slice(0, 10).join(",")})`,
);
assert(
  rotatingStatuses[10] === 429,
  `hit 11 with rotating XFF returns 429 — bucket NOT fragmented (got ${rotatingStatuses[10]})`,
);

section("TRUST_PROXY_HEADERS=1 — XFF is trusted, distinct values get distinct buckets");
process.env.TRUST_PROXY_HEADERS = "1";
// Use a different path so we start with empty buckets.
// 12 requests with the SAME XFF value should still trip the burst limit
// at hit 11 — proving trust mode keys by XFF.
const sameXffStatuses: number[] = [];
for (let i = 0; i < 12; i += 1) {
  sameXffStatuses.push(hit("/api/audit-sticky", "203.0.113.42"));
}
assert(
  sameXffStatuses.slice(0, 10).every((s) => s === 200) && sameXffStatuses[10] === 429,
  `same-XFF burst trips at hit 11 under TRUST_PROXY_HEADERS=1 (got ${sameXffStatuses.join(",")})`,
);

// Now rotate XFF on a fresh path — under trust mode each value is its own
// bucket, so all 12 should return 200.
const trustedRotating: number[] = [];
for (let i = 0; i < 12; i += 1) {
  trustedRotating.push(hit("/api/audit-trusted-rotate", `203.0.113.${50 + i}`));
}
assert(
  trustedRotating.every((s) => s === 200),
  `under TRUST_PROXY_HEADERS=1, 12 rotating-XFF requests all return 200 (distinct buckets) — got ${trustedRotating.join(",")}`,
);

// Restore for downstream tests if any.
delete process.env.TRUST_PROXY_HEADERS;

console.log(`\nResult: ${status.pass} passed, ${status.fail} failed`);
if (status.fail > 0) process.exit(1);
