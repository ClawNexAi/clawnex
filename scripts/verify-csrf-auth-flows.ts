/**
 * verify-csrf-auth-flows.ts
 *
 * internal reviewer 2026-05-09 required follow-up: lock the contract that every auth
 * flow that mints a session cookie ALSO mints the CSRF cookie atomically.
 * Catches the regression class where a new auth flow ships without
 * setCsrfCookie() — the dashboard's window.fetch monkey-patch then can't
 * read clawnex_csrf via document.cookie, mutation requests go out without
 * X-CSRF-Token header, server returns 403, client's silent catch swallows
 * the error, and the operator sees "click does nothing."
 *
 * Static-source verifier — no live host. For each known auth-flow route,
 * asserts:
 *   1. imports `setCsrfCookie` from `@/lib/auth/csrf-cookie`
 *   2. invokes `setCsrfCookie(...)` somewhere in the file
 *   3. sets the `clawnex_session` cookie (so the route is genuinely an
 *      auth flow that should also set CSRF)
 *
 * Plus shared-helper integrity checks on the helper module itself.
 *
 *   npx tsx scripts/verify-csrf-auth-flows.ts
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

interface AuthFlow {
  label: string;
  routePath: string;
}

const AUTH_FLOWS: AuthFlow[] = [
  { label: "POST /api/auth/setup",                              routePath: "src/app/api/auth/setup/route.ts" },
  { label: "POST /api/auth/login",                              routePath: "src/app/api/auth/login/route.ts" },
  { label: "GET  /api/auth/magic-link/complete",                routePath: "src/app/api/auth/magic-link/complete/route.ts" },
  { label: "POST /api/auth/passkey/authenticate/complete",      routePath: "src/app/api/auth/passkey/authenticate/complete/route.ts" },
  { label: "GET  /api/auth/github/callback",                    routePath: "src/app/api/auth/github/callback/route.ts" },
];

const HELPER_PATH = "src/lib/auth/csrf-cookie.ts";

let assertionCount = 0;
let failedCount = 0;

function pass(msg: string) {
  assertionCount++;
  console.log(`PASS: ${msg}`);
}

function fail(msg: string) {
  assertionCount++;
  failedCount++;
  console.error(`FAIL: ${msg}`);
}

function assert(cond: unknown, msg: string): void {
  if (cond) pass(msg);
  else fail(msg);
}

// ---------------------------------------------------------------------------
// Section 1 — shared helper exists and exports setCsrfCookie
// ---------------------------------------------------------------------------

console.log("\n[1] Shared CSRF cookie helper");
{
  const fullPath = path.join(ROOT, HELPER_PATH);
  assert(fs.existsSync(fullPath), `Helper file exists at ${HELPER_PATH}`);
  if (fs.existsSync(fullPath)) {
    const src = fs.readFileSync(fullPath, "utf8");
    assert(/export\s+function\s+setCsrfCookie\s*\(/.test(src), `Helper exports setCsrfCookie function`);
    // DAST 2026-05-15 C1: token is session-bound HMAC (csrf-hmac.ts), not raw randomBytes.
    // The HMAC derivation itself is covered by verify-csrf-session-binding (12 assertions).
    assert(/csrfTokenFor\s*\(\s*sessionId\s*\)/.test(src), `Helper derives session-bound token via csrfTokenFor(sessionId)`);
    assert(/clawnex_csrf/.test(src), `Helper sets clawnex_csrf cookie name`);
    assert(/httpOnly:\s*false/.test(src), `Helper sets httpOnly: false (so document.cookie can read it)`);
    assert(/sameSite:\s*['"]strict['"]/.test(src), `Helper sets sameSite: strict`);
  }
}

// ---------------------------------------------------------------------------
// Section 2 — every auth-flow route imports + invokes setCsrfCookie
// ---------------------------------------------------------------------------

console.log("\n[2] Auth-flow routes wire setCsrfCookie");
for (const flow of AUTH_FLOWS) {
  const fullPath = path.join(ROOT, flow.routePath);
  console.log(`\n  ${flow.label} (${flow.routePath})`);
  if (!fs.existsSync(fullPath)) {
    fail(`Route file exists`);
    continue;
  }
  const src = fs.readFileSync(fullPath, "utf8");

  // 1. Imports setCsrfCookie from the shared helper
  const importRe = /import\s+\{[^}]*\bsetCsrfCookie\b[^}]*\}\s+from\s+["']@\/lib\/auth\/csrf-cookie["']/;
  assert(importRe.test(src), `${flow.label} imports setCsrfCookie from @/lib/auth/csrf-cookie`);

  // 2. Invokes setCsrfCookie(...) at least once
  const callRe = /\bsetCsrfCookie\s*\(/;
  assert(callRe.test(src), `${flow.label} invokes setCsrfCookie(...)`);

  // 3. Genuinely an auth-session-minting route — mints clawnex_session
  const sessionRe = /clawnex_session/;
  assert(sessionRe.test(src), `${flow.label} mints clawnex_session (sanity — confirms this IS an auth flow)`);

  // 4. setCsrfCookie call comes AFTER the clawnex_session cookie set
  //    (so both land in the same response object). We don't enforce strict
  //    ordering, but assert both literal patterns appear in the same file.
  const sessionIdx = src.search(/clawnex_session/);
  const csrfCallIdx = src.search(/setCsrfCookie\s*\(/);
  assert(
    sessionIdx >= 0 && csrfCallIdx >= 0,
    `${flow.label} has both clawnex_session set + setCsrfCookie call`,
  );
}

// ---------------------------------------------------------------------------
// Section 3 — regression guard for the dashboard's monkey-patch contract
// ---------------------------------------------------------------------------
//
// The window.fetch monkey-patch in src/components/dashboard/index.tsx reads
// clawnex_csrf from document.cookie via a regex match. If that regex breaks
// or the cookie name diverges from the helper, every mutation 403s. Lock
// the cookie name + the regex shape together.

console.log("\n[3] Dashboard monkey-patch reads the same cookie the helper sets");
{
  const idxPath = path.join(ROOT, "src/components/dashboard/index.tsx");
  assert(fs.existsSync(idxPath), `index.tsx exists`);
  if (fs.existsSync(idxPath)) {
    const src = fs.readFileSync(idxPath, "utf8");
    assert(/document\.cookie\.match\(\/clawnex_csrf=/.test(src), `Monkey-patch regex matches /clawnex_csrf=/ (matches helper cookie name)`);
    assert(/x-csrf-token/i.test(src), `Monkey-patch attaches x-csrf-token header on mutations`);
    assert(/POST.*PUT.*DELETE.*PATCH|PUT.*DELETE.*PATCH.*POST|DELETE.*PATCH.*POST.*PUT|PATCH.*POST.*PUT.*DELETE/.test(src.replace(/\s/g, "")), `Monkey-patch covers POST/PUT/DELETE/PATCH (mutation methods)`);
  }
}

// ---------------------------------------------------------------------------
// Restore stream taps and report
// ---------------------------------------------------------------------------

if (failedCount > 0) {
  console.error(`\n${failedCount} assertion(s) FAILED out of ${assertionCount}`);
  process.exit(1);
}
console.log(`\n✅ All ${assertionCount} assertions passed`);
