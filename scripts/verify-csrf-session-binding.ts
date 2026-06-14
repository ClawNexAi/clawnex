/**
 * verify-csrf-session-binding.ts
 *
 * DAST 2026-05-15 C1 follow-up: verifies the CSRF token is bound to
 * the session via HMAC-SHA256(SESSION_SECRET, session.id), not via
 * a cookie/header equality compare.
 *
 * Drives `csrfTokenFor` and `verifyCsrfToken` from
 * `src/lib/auth/csrf-hmac.ts` directly and asserts the four
 * properties operator called out in the original brief:
 *
 *   1. Attacker-chosen pair (e.g. "x"/"x") on a fresh session → reject.
 *      A matching cookie/header pair that wasn't derived from
 *      SESSION_SECRET cannot pass verification.
 *
 *   2. Valid token for session A presented against session B → reject.
 *      The HMAC binding is per-session-id; tokens don't cross sessions.
 *
 *   3. Valid session-bound pair on the right session → accept.
 *
 *   4. Empty / missing token → reject (covers post-logout when the
 *      session no longer exists in the DB and the route layer's
 *      validateSession() short-circuits before the HMAC compare).
 *
 * Bonus: with no SESSION_SECRET and no SETUP_SECRET, every mint
 * returns '' and every verify returns false (fail-closed).
 *
 *   npx tsx scripts/verify-csrf-session-binding.ts
 */

import { csrfTokenFor, verifyCsrfToken } from '../src/lib/auth/csrf-hmac';

// Pin a known secret for the assertions. Restore the original value at
// the end so this can be sourced in a dev shell without leaking state.
const originalSessionSecret = process.env.SESSION_SECRET;
const originalSetupSecret = process.env.SETUP_SECRET;
process.env.SESSION_SECRET = 'verify-csrf-session-binding-test-secret-fixed-value-0123456789abcdef';
delete process.env.SETUP_SECRET;

interface Case { name: string; ok: boolean; detail?: string }
const results: Case[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

const SESSION_A = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const SESSION_B = '00000000-0000-0000-0000-bbbbbbbbbbbb';

const tokenA = csrfTokenFor(SESSION_A);
const tokenB = csrfTokenFor(SESSION_B);

// Sanity: tokens are well-formed 64-hex-char HMAC outputs and distinct
// across sessions. If this fails, every downstream assertion is moot.
check(
  'sanity: HMAC outputs are 64-char hex',
  /^[0-9a-f]{64}$/.test(tokenA) && /^[0-9a-f]{64}$/.test(tokenB),
  `tokenA.len=${tokenA.length} tokenB.len=${tokenB.length}`,
);
check(
  'sanity: different sessions yield different tokens',
  tokenA !== tokenB,
);

// Case 1: attacker-chosen pair is rejected.
check(
  'C1: attacker "x" against session A is rejected',
  verifyCsrfToken(SESSION_A, 'x') === false,
);
check(
  'C1: attacker "0000...0000" against session A is rejected',
  verifyCsrfToken(SESSION_A, '0'.repeat(64)) === false,
);

// Case 2: token for session A doesn't validate for session B.
check(
  'C2: token for session A fails against session B',
  verifyCsrfToken(SESSION_B, tokenA) === false,
);

// Case 3: matched pair on the right session passes.
check(
  'C3: token for session A passes against session A',
  verifyCsrfToken(SESSION_A, tokenA) === true,
);
check(
  'C3: token for session B passes against session B',
  verifyCsrfToken(SESSION_B, tokenB) === true,
);

// Case 4: missing inputs are rejected (post-logout maps to this when
// validateSession returns null and the route layer 403s before the
// HMAC compare; the helper itself also fails closed).
check(
  'C4: empty token against any session → reject',
  verifyCsrfToken(SESSION_A, '') === false,
);
check(
  'C4: null token against any session → reject',
  verifyCsrfToken(SESSION_A, null) === false,
);
check(
  'C4: empty sessionId rejects even a real-looking token',
  verifyCsrfToken('', tokenA) === false,
);

// Bonus: with no SESSION_SECRET or SETUP_SECRET, mint + verify both
// fail closed. Module-level cached warning flags don't matter for the
// truth of the assertion — the helper recomputes secret resolution on
// each call.
delete process.env.SESSION_SECRET;
delete process.env.SETUP_SECRET;
const noSecretToken = csrfTokenFor(SESSION_A);
const noSecretVerify = verifyCsrfToken(SESSION_A, tokenA);
check(
  'BONUS: no secret → csrfTokenFor returns "" (no cookie minted)',
  noSecretToken === '',
);
check(
  'BONUS: no secret → verifyCsrfToken returns false (fail closed)',
  noSecretVerify === false,
);

// Restore env so the script can be sourced in a dev shell.
if (originalSessionSecret !== undefined) process.env.SESSION_SECRET = originalSessionSecret;
if (originalSetupSecret !== undefined) process.env.SETUP_SECRET = originalSetupSecret;

// Report.
const failures = results.filter((r) => !r.ok);
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));

for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  const line = `  ${tag}  ${pad(r.name, 60)}`;
  if (r.ok) console.log(line + (r.detail ? `  (${r.detail})` : ''));
  else console.log(line + (r.detail ? `  (${r.detail})` : '') + '   ←—');
}

console.log('');
if (failures.length === 0) {
  console.log(`PASS — ${results.length}/${results.length} CSRF session-binding assertions hold`);
  process.exit(0);
}
console.log(`FAIL — ${failures.length}/${results.length} assertion(s) failed`);
process.exit(1);
