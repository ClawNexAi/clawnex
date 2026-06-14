/**
 * Module-level verification for the multi-auth providers library.
 *
 * Run: npx tsx scripts/verify-auth-units.ts
 *
 * Uses :memory: SQLite + mocked-out env so the WebAuthn / GitHub network
 * paths never run. Covers:
 *   - auth/index helpers (parse/serialize enrolled-providers CSV)
 *   - challenge-store (put/take, TTL, one-shot, sweep)
 *   - credentials-service (passkey + github_link CRUD)
 *   - providers/local (timing-safe failure, success path)
 *   - providers/github (effective-config precedence, default-off)
 *
 * Exits 0 if all assertions PASS, 1 otherwise.
 */

process.env.DATABASE_PATH = ":memory:";
process.env.CLAWNEX_AUDIT_STDOUT = "false";

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getDb } from "../src/lib/db/index";
import {
  parseEnrolledProviders,
  serializeEnrolledProviders,
} from "../src/lib/services/auth";
import {
  putChallenge,
  takeChallenge,
  challengeStoreSize,
  _clearAllChallenges,
} from "../src/lib/services/auth/challenge-store";
import {
  insertPasskey,
  findPasskeyByCredentialId,
  listPasskeysForOperator,
  updatePasskeyCounter,
  deleteCredential,
  insertGithubLink,
  findGithubLinkByUserId,
  touchGithubLink,
  deleteAllCredentialsForOperator,
} from "../src/lib/services/auth/credentials-service";
import { authenticateLocal } from "../src/lib/services/auth/providers/local";
import {
  isEnabled,
  isConfigured,
  getEffectiveConfig,
  GITHUB_SETTINGS,
} from "../src/lib/services/auth/providers/github";
import { createOperator } from "../src/lib/services/operator-service";
import { setSetting } from "../src/lib/services/config-service";
import { queryOne, run } from "../src/lib/db/index";
import * as magicLink from "../src/lib/services/auth/providers/magic-link";
import { hasPermission, ALL_ROLES } from "../src/lib/rbac/permissions";
import type { Role, Permission, AuthenticatedOperator } from "../src/lib/rbac/types";

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
  console.log(`\n${name}`);
}

// Force schema to apply by touching the db once.
getDb();

// ─── auth/index helpers ──────────────────────────────────────────────────────
section("auth/index — parseEnrolledProviders / serializeEnrolledProviders");

assert(parseEnrolledProviders(null).length === 0, "null csv → empty array");
assert(parseEnrolledProviders("").length === 0, "empty csv → empty array");
{
  const got = parseEnrolledProviders("local,passkey");
  assert(got.length === 2 && got.includes("local") && got.includes("passkey"), "two-provider csv parses both");
}
{
  // Whitespace + duplicates + unknown values
  const got = parseEnrolledProviders(" local , passkey , local , bogus ");
  assert(got.length === 2, "duplicates collapsed and unknowns dropped");
}
{
  const ser = serializeEnrolledProviders(["local", "passkey", "local"]);
  assert(ser === "local,passkey", "serialize dedupes");
}

// ─── challenge-store ─────────────────────────────────────────────────────────
section("challenge-store — put/take/expire/sweep");

_clearAllChallenges();
{
  putChallenge("c1", "challenge-bytes", "registration", "op-1");
  const out = takeChallenge("c1");
  assert(out !== null, "putChallenge → takeChallenge returns the entry");
  assert(out?.challenge === "challenge-bytes", "stored challenge bytes round-trip");
  assert(out?.purpose === "registration", "purpose preserved");
  assert(out?.operatorId === "op-1", "operatorId preserved");
}
{
  // One-shot semantics — second take returns null
  putChallenge("c2", "x", "authentication", null);
  takeChallenge("c2");
  assert(takeChallenge("c2") === null, "challenge cannot be replayed (one-shot)");
}
{
  // Missing challenge
  assert(takeChallenge("never-existed") === null, "unknown id returns null");
}
{
  // Manual expiry: put a challenge, monkey-patch its expiry into the past,
  // then verify takeChallenge returns null and the entry is cleared.
  // Easiest path: putChallenge then sweep via another put after rewinding clock.
  const realNow = Date.now;
  putChallenge("c-old", "y", "authentication", null);
  // Rewind by jumping forward 6 minutes (TTL is 5)
  Date.now = () => realNow() + 6 * 60 * 1000;
  try {
    assert(takeChallenge("c-old") === null, "expired challenge returns null");
  } finally {
    Date.now = realNow;
  }
}
{
  // Sweep: expired entry gets evicted on next put
  _clearAllChallenges();
  const realNow = Date.now;
  putChallenge("c-stale", "z", "authentication", null);
  Date.now = () => realNow() + 6 * 60 * 1000;
  try {
    putChallenge("c-fresh", "w", "authentication", null);
    // c-stale should have been swept; size is 1 (just c-fresh)
    assert(challengeStoreSize() === 1, "sweep evicts expired entries on write");
  } finally {
    Date.now = realNow;
  }
}

// ─── credentials-service ────────────────────────────────────────────────────
section("credentials-service — passkey CRUD");

const op = createOperator("test-op", "P@ssw0rd-test-1234", "admin");

{
  const cred = insertPasskey({
    operatorId: op.id,
    credentialId: "cred-id-base64url",
    publicKey: "pubkey-base64url",
    counter: 0,
    transports: ["internal", "hybrid"],
    label: "MacBook fingerprint",
  });
  assert(cred.id.length > 0, "insertPasskey returns row with id");
  assert(cred.transports === "internal,hybrid", "transports stored as csv");
  assert(cred.label === "MacBook fingerprint", "label stored");

  const found = findPasskeyByCredentialId("cred-id-base64url");
  assert(found?.id === cred.id, "findPasskeyByCredentialId locates it");
  assert(found?.credential_type === "passkey", "credential_type discriminator correct");

  const list = listPasskeysForOperator(op.id);
  assert(list.length === 1, "listPasskeysForOperator returns the one passkey");

  updatePasskeyCounter("cred-id-base64url", 5);
  const refound = findPasskeyByCredentialId("cred-id-base64url");
  assert(refound?.counter === 5, "updatePasskeyCounter persists");
  assert(refound?.last_used_at !== null, "updatePasskeyCounter touches last_used_at");

  deleteCredential(cred.id);
  assert(findPasskeyByCredentialId("cred-id-base64url") === null, "deleteCredential removes the row");
}

section("credentials-service — github_link CRUD");

{
  const link = insertGithubLink({
    operatorId: op.id,
    githubUserId: 12345,
    githubUsername: "operator",
  });
  assert(link.credential_type === "github_link", "github link stored with right type");
  assert(link.github_user_id === 12345, "github_user_id stored");
  assert(link.github_username === "operator", "github_username stored");

  const found = findGithubLinkByUserId(12345);
  assert(found?.id === link.id, "findGithubLinkByUserId locates it");
  assert(findGithubLinkByUserId(99999) === null, "wrong github user id returns null");

  touchGithubLink(12345);
  const refound = findGithubLinkByUserId(12345);
  assert(refound?.last_used_at !== null, "touchGithubLink sets last_used_at");

  deleteAllCredentialsForOperator(op.id);
  assert(findGithubLinkByUserId(12345) === null, "deleteAllCredentialsForOperator wipes github link");
  assert(listPasskeysForOperator(op.id).length === 0, "deleteAllCredentialsForOperator wipes passkeys too");
}

// ─── api-key-service — health:read scope (v0.9.1-alpha) ─────────────────────
// Verifies end-to-end that a key issued with the new health:read scope can
// actually authenticate as that scope. Covers the tri-gate feature on
// /api/health/detailed — if this passes, the route layer's
// authenticateRequest(..., 'health:read') will succeed for probes carrying
// such a key. Catches regressions where a future refactor silently drops
// the scope from the catalog or breaks the checkScope matcher.
section("api-key-service — health:read scope");

{
  const { generateApiKey, validateApiKey, checkScope } =
    // Dynamic require so the top-of-file import list stays tight — this
    // block only runs once per verify and doesn't need lazy init.
    require("../src/lib/services/api-key-service") as typeof import("../src/lib/services/api-key-service");

  const gen = generateApiKey("monitoring-probe-test", ["health:read"], 120);
  assert(gen.key.startsWith("cnx_"), "issued key uses the cnx_ prefix");
  assert(gen.scopes.includes("health:read"), "issued scopes include health:read");

  const validation = validateApiKey(gen.key);
  assert(validation.valid, "issued key validates");
  assert(validation.keyRecord?.scopes.includes("health:read"), "validated key carries health:read");

  assert(
    checkScope(validation.keyRecord!, "health:read"),
    "checkScope returns true for health:read on a key that has it",
  );
  assert(
    !checkScope(validation.keyRecord!, "chat:completions"),
    "checkScope returns false for a scope the key doesn't carry",
  );

  // Negative: key without health:read must NOT pass the scope check.
  const other = generateApiKey("chat-only-test", ["chat:completions"], 60);
  const otherValidation = validateApiKey(other.key);
  assert(
    !checkScope(otherValidation.keyRecord!, "health:read"),
    "chat-only key cannot satisfy health:read",
  );
}

// ─── schema integrity — UNIQUE passkey credential_id ────────────────────────
// Added 2026-04-24 (adversarial review finding #A1). Two operators can't
// share the same WebAuthn credential_id. WebAuthn generates credential_ids
// as cryptographically random bytes so collisions are astronomically
// unlikely in practice — but the UNIQUE index catches app-layer bugs that
// would otherwise silently corrupt auth (queryOne returns "some" matching
// row without a tiebreaker).
section("schema — UNIQUE passkey credential_id");

{
  const op1 = createOperator("unique-test-op-1", "P@ssw0rd-test-1234", "admin");
  const op2 = createOperator("unique-test-op-2", "P@ssw0rd-test-5678", "admin");
  const SHARED_ID = "dup-credential-id-base64url";

  insertPasskey({
    operatorId: op1.id,
    credentialId: SHARED_ID,
    publicKey: "pk-a",
    counter: 0,
  });

  let rejected = false;
  try {
    insertPasskey({
      operatorId: op2.id,
      credentialId: SHARED_ID,
      publicKey: "pk-b",
      counter: 0,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "second passkey with duplicate credential_id is rejected by UNIQUE index");

  // The first credential should still be findable and unmodified.
  const found = findPasskeyByCredentialId(SHARED_ID);
  assert(found?.operator_id === op1.id, "original row for SHARED_ID still belongs to op1");

  deleteAllCredentialsForOperator(op1.id);
  deleteAllCredentialsForOperator(op2.id);
}

// ─── providers/local ────────────────────────────────────────────────────────
section("providers/local — authenticateLocal");

{
  // Wrong username → invalid_credentials, no leak that user is missing
  const r = authenticateLocal({ username: "no-such-user", password: "anything" });
  assert(r.ok === false, "missing user returns failure");
  if (!r.ok) {
    assert(r.failure.code === "invalid_credentials", "missing user yields generic invalid_credentials code");
  }
}
{
  // Wrong password → invalid_credentials
  const r = authenticateLocal({ username: "test-op", password: "wrong-password" });
  assert(r.ok === false, "wrong password returns failure");
  if (!r.ok) {
    assert(r.failure.code === "invalid_credentials", "wrong password yields invalid_credentials code");
  }
}
{
  // Correct credentials → success
  const r = authenticateLocal({ username: "test-op", password: "P@ssw0rd-test-1234" });
  assert(r.ok === true, "correct credentials succeed");
  if (r.ok) {
    assert(r.data.username === "test-op", "AuthSuccess carries username");
    assert(r.data.role === "admin", "AuthSuccess carries role");
    assert(r.data.provider === "local", "AuthSuccess marks provider=local");
  }
}

// ─── providers/github ───────────────────────────────────────────────────────
section("providers/github — effective config precedence + default-off");

{
  // Default state: env unset → not configured, not enabled
  const eff = getEffectiveConfig();
  assert(eff.enabled === false, "github disabled by default");
  assert(isEnabled() === false, "isEnabled() returns false by default");
  // isConfigured iff both clientId AND clientSecret are present from env fallback
  const expectConfigured = Boolean(eff.clientId) && Boolean(eff.clientSecret);
  assert(isConfigured() === expectConfigured, "isConfigured matches env presence");
}
{
  // DB toggle wins
  setSetting(GITHUB_SETTINGS.enabled, "true");
  setSetting(GITHUB_SETTINGS.clientId, "db-cid");
  setSetting(GITHUB_SETTINGS.clientSecret, "db-secret");
  const eff = getEffectiveConfig();
  assert(eff.enabled === true, "DB enabled flag flips isEnabled");
  assert(eff.clientId === "db-cid", "DB client_id used");
  assert(eff.clientSecret === "db-secret", "DB client_secret used");
  assert(isConfigured() === true, "isConfigured true when both present");
}
{
  // Disable resets isEnabled but doesn't drop credentials
  setSetting(GITHUB_SETTINGS.enabled, "false");
  assert(isEnabled() === false, "DB disabled flag flips isEnabled back");
  assert(isConfigured() === true, "credentials persist across disable");
}

// ─── Magic Link provider (v0.9.2) ───────────────────────────────────────────
section("providers/magic-link — effective config + token lifecycle");

{
  // We cannot exercise sendMail here (no SMTP in :memory:), so the tests
  // focus on the two properties that aren't tied to the HTTP/mail surface:
  //   1. effective config (enabled + configured gates)
  //   2. token generate → consume → already-consumed → expired paths

  // Dedicated operator for magic-link tests — createOperator takes positional
  // args and doesn't accept email, so we insert an email separately.
  const magicOp = createOperator("magic-op", "P@ssw0rd-magic-1234", "operator");
  run("UPDATE operators SET email = ? WHERE id = ?", ["magic-op@example.test", magicOp.id]);

  // ── getEffectiveConfig — off by default ───────────────────────────────
  {
    const eff = magicLink.getEffectiveConfig();
    assert(eff.enabled === false, "magic-link disabled by default");
    assert(eff.available === false, "magic-link not available when disabled");
    assert(
      typeof eff.note === "string" && eff.note.length > 0,
      "effective config carries an explanatory note",
    );
  }

  // ── isEnabled flips with the setting ─────────────────────────────────
  {
    setSetting("auth_magic_link_enabled", "true");
    assert(magicLink.isEnabled() === true, "enabled setting flips isEnabled");
    setSetting("auth_magic_link_enabled", "false");
    assert(magicLink.isEnabled() === false, "disabled setting flips isEnabled back");
  }

  // ── Token generate + consume (happy path) ────────────────────────────
  {
    const { rawToken, expiresAt } = magicLink.generateAndStoreToken(
      magicOp.id,
      "127.0.0.1",
      "test-ua",
    );
    assert(typeof rawToken === "string" && rawToken.length >= 40, "token is 32+ bytes base64url");
    assert(new Date(expiresAt).getTime() > Date.now(), "token expires in the future");

    const row = queryOne<{ token_hash: string; consumed_at: string | null }>(
      "SELECT token_hash, consumed_at FROM magic_link_tokens WHERE operator_id = ? ORDER BY issued_at DESC LIMIT 1",
      [magicOp.id],
    );
    assert(!!row && row.token_hash !== rawToken, "raw token never stored; only hash");
    assert(!!row && row.consumed_at === null, "fresh token unconsumed");

    const r = magicLink.consumeToken(rawToken);
    assert(r.ok === true, "valid unconsumed token consumes successfully");
    if (r.ok) {
      assert(r.data.operatorId === magicOp.id, "consume returns the linked operator");
      assert(r.data.provider === "magic_link", "AuthResult marks provider=magic_link");
    }
  }

  // ── Already-consumed token rejected ──────────────────────────────────
  {
    const { rawToken } = magicLink.generateAndStoreToken(magicOp.id);
    const first = magicLink.consumeToken(rawToken);
    assert(first.ok === true, "first consume succeeds");
    const second = magicLink.consumeToken(rawToken);
    assert(second.ok === false, "second consume of same token fails");
    if (!second.ok) {
      assert(
        second.failure.code === "invalid_credentials",
        "replayed token yields generic invalid_credentials code",
      );
    }
  }

  // ── Unknown token rejected without leaking existence ─────────────────
  {
    const r = magicLink.consumeToken("definitely-not-a-real-token-abcdefg");
    assert(r.ok === false, "unknown token fails");
    if (!r.ok) {
      assert(
        r.failure.code === "invalid_credentials",
        "unknown token yields generic invalid_credentials code",
      );
    }
  }

  // ── Expired token rejected ───────────────────────────────────────────
  {
    // Back-date expires_at directly so the test doesn't depend on clock
    // manipulation. Target the specific token by its computed hash — do NOT
    // rely on ORDER BY issued_at since multiple tokens generated in the same
    // second have identical timestamps, making the ordering non-deterministic.
    const { rawToken } = magicLink.generateAndStoreToken(magicOp.id);
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    run(
      "UPDATE magic_link_tokens SET expires_at = datetime('now','-1 minute') WHERE token_hash = ?",
      [tokenHash],
    );
    const r = magicLink.consumeToken(rawToken);
    assert(r.ok === false, "expired token rejected");
    if (!r.ok) {
      assert(
        r.failure.code === "invalid_credentials",
        "expired token yields generic invalid_credentials code",
      );
    }
  }

  // ── invalidateOutstandingTokens marks everything consumed ────────────
  {
    magicLink.generateAndStoreToken(magicOp.id);
    magicLink.generateAndStoreToken(magicOp.id);
    const before = queryOne<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM magic_link_tokens WHERE operator_id = ? AND consumed_at IS NULL",
      [magicOp.id],
    );
    assert((before?.cnt ?? 0) >= 2, "two fresh tokens in flight before invalidation");
    magicLink.invalidateOutstandingTokens(magicOp.id);
    const after = queryOne<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM magic_link_tokens WHERE operator_id = ? AND consumed_at IS NULL",
      [magicOp.id],
    );
    assert((after?.cnt ?? -1) === 0, "no outstanding tokens after invalidation");
  }

  // Reset the setting so later static checks aren't affected.
  setSetting("auth_magic_link_enabled", "false");
}

// ─── /api/auth/magic-link/{begin,complete} — route guard wiring ────────────
section("/api/auth/magic-link/* — route shape");

{
  // Behavioral test would require Next.js runtime + network mocking of
  // sendMail; the below static checks mirror the style used for /api/
  // permissiveness above and lock in the three properties that matter
  // for this provider's security posture.
  const beginSrc = readFileSync(
    "src/app/api/auth/magic-link/begin/route.ts",
    "utf8",
  );
  assert(
    /checkRateLimit\s*\(/.test(beginSrc),
    "begin route rate-limits via checkRateLimit",
  );
  assert(
    /SUCCESS_MESSAGE|If an account with that email exists/.test(beginSrc),
    "begin route returns a constant success message (no enumeration)",
  );
  assert(
    /getEffectiveConfig|effective\.available/.test(beginSrc),
    "begin route gates on provider effective config",
  );

  const completeSrc = readFileSync(
    "src/app/api/auth/magic-link/complete/route.ts",
    "utf8",
  );
  assert(
    /\bconsumeToken\s*\(/.test(completeSrc),
    "complete route calls consumeToken(...)",
  );
  assert(
    /\bcreateSession\s*\(/.test(completeSrc),
    "complete route creates a session on success",
  );
  assert(
    /magic_link_invalid/.test(completeSrc),
    "complete route uses a single generic error code on failure",
  );
}

// ─── /api/permissiveness — CX-D1 regression: ensure RBAC guard is wired ────
// Past bug: route file claimed "reuses existing RBAC middleware" in a comment
// but never imported or called it, exposing the full permissiveness report
// (installed agents, gateway topology, posture lints) to anonymous callers.
// These assertions lock in the fix at the source level.
section("/api/permissiveness — CX-D1 guard wiring");

{
  const src = readFileSync("src/app/api/permissiveness/route.ts", "utf8");
  assert(
    /from ["']@\/lib\/rbac\/guard["']/.test(src),
    "imports requireSession/requirePermission from @/lib/rbac/guard",
  );
  assert(
    /\brequireSession\s*\(/.test(src),
    "route handler calls requireSession(...)",
  );
  assert(
    /\brequirePermission\s*\(\s*[^,]+,\s*["']config:read["']\s*\)/.test(src),
    "route handler calls requirePermission with 'config:read'",
  );
}

// ─── RBAC role × permission matrix (v0.9.2 end-to-end enforcement) ─────────
// These tests lock in the authoritative contract between each role and the
// permissions it carries. Regressing any of these would silently grant or
// revoke access to routes that call requirePermission(...). Pair-per-row
// style rather than exhaustive grid — catches the known-sensitive cells.
section("rbac — role × permission enforcement boundary");

{
  // Known role count must stay at 5 — adding a role without updating the
  // permission matrix elsewhere is the most common breakage path.
  assert(ALL_ROLES.length === 5, "5 roles defined");
  assert(ALL_ROLES.includes("admin") && ALL_ROLES.includes("security_manager") && ALL_ROLES.includes("operator") && ALL_ROLES.includes("viewer") && ALL_ROLES.includes("auditor"), "all 5 canonical role names present");

  // ── Admin: full access ─────────────────────────────────────────────
  const adminGrants: Permission[] = [
    "operators:manage", "system:manage", "system:purge",
    "break_glass:activate", "api_keys:manage", "audit:clear",
    "shield:config", "config:write", "risk:accept",
  ];
  for (const p of adminGrants) {
    assert(hasPermission("admin", p), `admin has ${p}`);
  }

  // ── Security Manager: can manage security but NOT operators/system ──
  const smGrants: Permission[] = [
    "shield:config", "alerts:manage", "break_glass:activate",
    "risk:accept", "reports:export",
  ];
  const smDenies: Permission[] = [
    "operators:manage", "system:manage", "system:purge",
    "audit:clear", "api_keys:manage", "config:write",
  ];
  for (const p of smGrants) assert(hasPermission("security_manager", p), `security_manager has ${p}`);
  for (const p of smDenies) assert(!hasPermission("security_manager", p), `security_manager DENIED ${p}`);

  // ── Operator: can run scans but not reconfigure ─────────────────────
  const opGrants: Permission[] = [
    "shield:scan", "alerts:manage", "reports:generate", "chat:use",
  ];
  const opDenies: Permission[] = [
    "shield:config", "operators:manage", "system:manage",
    "break_glass:activate", "risk:accept", "api_keys:manage", "config:write",
  ];
  for (const p of opGrants) assert(hasPermission("operator", p), `operator has ${p}`);
  for (const p of opDenies) assert(!hasPermission("operator", p), `operator DENIED ${p}`);

  // ── Viewer: read-only dashboard ─────────────────────────────────────
  const viewerGrants: Permission[] = [
    "dashboard:view", "fleet:read", "alerts:read", "shield:read", "config:read",
  ];
  const viewerDenies: Permission[] = [
    "shield:scan", "shield:config", "alerts:manage", "reports:generate",
    "operators:manage", "system:manage", "chat:use", "voice:use",
  ];
  for (const p of viewerGrants) assert(hasPermission("viewer", p), `viewer has ${p}`);
  for (const p of viewerDenies) assert(!hasPermission("viewer", p), `viewer DENIED ${p}`);

  // ── Auditor: audit trail + reports ONLY, no operational data ───────
  const auditorGrants: Permission[] = [
    "dashboard:view", "audit:read", "reports:export", "tokens:read",
  ];
  const auditorDenies: Permission[] = [
    "shield:read", "shield:scan", "alerts:read", "config:read",
    "operators:manage", "system:manage", "risk:accept",
  ];
  for (const p of auditorGrants) assert(hasPermission("auditor", p), `auditor has ${p}`);
  for (const p of auditorDenies) assert(!hasPermission("auditor", p), `auditor DENIED ${p}`);
}

// ─── requireSession + requirePermission (end-to-end guard integration) ─────
// The matrix above exercises hasPermission(). This block exercises the real
// guard function path an API route uses — proves the guard layer actually
// enforces, not just that the matrix data is correct.
section("rbac — requireSession + requirePermission end-to-end");

{
  process.env.RBAC_ENABLED = "true";
  const { requirePermission, isRbacEnabled } = require("../src/lib/rbac/guard");
  const { NextResponse } = require("next/server");

  assert(isRbacEnabled() === true, "RBAC_ENABLED=true flips isRbacEnabled");

  const mockOperator = (role: Role): AuthenticatedOperator => (
    { id: `test-${role}`, username: `test-${role}`, displayName: null, role }
  );

  // Viewer should be blocked from operators:manage
  {
    const resp = requirePermission(mockOperator("viewer"), "operators:manage");
    assert(resp instanceof NextResponse, "viewer blocked from operators:manage returns NextResponse");
    assert(resp?.status === 403, "viewer blocked returns 403");
  }
  // Auditor should be blocked from shield:read
  {
    const resp = requirePermission(mockOperator("auditor"), "shield:read");
    assert(resp instanceof NextResponse, "auditor blocked from shield:read returns NextResponse");
    assert(resp?.status === 403, "auditor blocked returns 403");
  }
  // Admin should pass for operators:manage
  {
    const resp = requirePermission(mockOperator("admin"), "operators:manage");
    assert(resp === null, "admin allowed for operators:manage returns null");
  }
  // Security Manager should pass shield:config (their distinguishing perm)
  {
    const resp = requirePermission(mockOperator("security_manager"), "shield:config");
    assert(resp === null, "security_manager allowed for shield:config returns null");
  }
  // Security Manager should FAIL operators:manage (admin-only)
  {
    const resp = requirePermission(mockOperator("security_manager"), "operators:manage");
    assert(resp instanceof NextResponse, "security_manager blocked from operators:manage");
    assert(resp?.status === 403, "security_manager block returns 403");
  }

  // Reset so later tests don't inherit the flag.
  delete process.env.RBAC_ENABLED;
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${status.pass} passed, ${status.fail} failed`);
process.exit(status.fail > 0 ? 1 : 0);
process.exit(status.fail > 0 ? 1 : 0);
