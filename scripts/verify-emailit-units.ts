/**
 * Emailit mail-provider verification.
 *
 * Run: npx tsx scripts/verify-emailit-units.ts
 *
 * Covers the parts of the Emailit integration that don't require a real
 * working API key:
 *   - getMailConfig() resolves emailit settings DB-first with env fallback
 *   - isMailConfigured() recognizes emailit when key is present
 *   - sendMail() routes provider=emailit through the Emailit code path
 *
 * For the live happy-path test (real API key required), use the Send Test
 * button in Configuration → Mail Configuration, which exercises the same
 * code path end-to-end.
 *
 * Hermetic via :memory: SQLite. Stubs global.fetch so we don't actually
 * hit Emailit during the test.
 */

process.env.DATABASE_PATH = ":memory:";
process.env.CLAWNEX_AUDIT_STDOUT = "false";

import { getDb } from "../src/lib/db/index";
import { setSetting } from "../src/lib/services/config-service";
import {
  getMailConfig,
  isMailConfigured,
  sendMail,
} from "../src/lib/services/mail-service";

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

getDb();

async function main() {

// ─── getMailConfig — emailit branch ─────────────────────────────────────────
section("mail-service — getMailConfig()");

{
  setSetting("mail_provider", "emailit");
  setSetting("mail_emailit_api_key", "em_test_db_key");
  setSetting("mail_from_email", "Test <test@example.com>");
  const cfg = getMailConfig();
  assert(cfg.provider === "emailit", "provider=emailit picked up from DB");
  assert(cfg.emailitApiKey === "em_test_db_key", "DB key wins over env");
  assert(cfg.fromEmail === "Test <test@example.com>", "fromEmail resolved from DB");
}

// ─── isMailConfigured — emailit ─────────────────────────────────────────────
section("mail-service — isMailConfigured() for emailit");

{
  // Key present → configured
  assert(isMailConfigured() === true, "configured when emailit key is set");
}

// ─── sendMail routes through Emailit + maps errors ──────────────────────────
section("mail-service — sendMail() routes emailit through fetch");

{
  // Stub global.fetch to capture the request and return a controlled response.
  type FetchInput = Parameters<typeof fetch>[0];
  type FetchInit = Parameters<typeof fetch>[1];
  type Captured = { url: string; init: FetchInit };
  let captured: Captured | null = null;
  const realFetch = global.fetch;

  // Success-path stub
  global.fetch = (async (input: FetchInput, init: FetchInit) => {
    captured = { url: String(input), init };
    return new Response(
      JSON.stringify({
        object: "email",
        id: "em_abc123",
        message_id: "<abc@example.com>",
        status: "pending",
        created_at: "2026-04-24T00:00:00Z",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const ok = await sendMail({
    to: "operator@example.com",
    subject: "hello",
    html: "<b>hi</b>",
  });

  assert(ok.ok === true, "200 response → ok=true");
  assert(captured !== null, "fetch was called");
  // Narrow captured for the rest of the block — assert() isn't a TS type guard.
  const cap = captured as Captured | null;
  assert(cap?.url === "https://api.emailit.com/v2/emails", "POST endpoint matches");
  const headers = cap?.init?.headers as Record<string, string> | undefined;
  assert(headers?.["Authorization"] === "Bearer em_test_db_key", "Authorization header carries DB key");
  const body = JSON.parse(cap?.init?.body as string);
  assert(body.from === "Test <test@example.com>", "from field populated from config");
  assert(body.to === "operator@example.com", "to field populated from options");
  assert(body.subject === "hello", "subject populated from options");
  assert(body.html === "<b>hi</b>", "html populated from options");

  // 401 path
  global.fetch = (async () => {
    return new Response(
      JSON.stringify({ error: "unauthorized", message: "Invalid API key" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const unauth = await sendMail({ to: "x@y.z", subject: "s", html: "h" });
  assert(unauth.ok === false, "401 response → ok=false");
  if (!unauth.ok) {
    assert(/invalid API key/i.test(unauth.error || ""), "401 error mapped to 'invalid API key'");
  }

  // 429 path
  global.fetch = (async () => {
    return new Response(
      JSON.stringify({ error: "rate_limit", message: "Too many" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const rl = await sendMail({ to: "x@y.z", subject: "s", html: "h" });
  assert(rl.ok === false, "429 response → ok=false");
  if (!rl.ok) {
    assert(/rate limited/i.test(rl.error || ""), "429 error mapped to 'rate limited'");
  }

  // 400 with validation_errors
  global.fetch = (async () => {
    return new Response(
      JSON.stringify({
        error: "validation_failed",
        message: "Invalid params",
        validation_errors: ["from is required"],
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const bad = await sendMail({ to: "x@y.z", subject: "s", html: "h" });
  assert(bad.ok === false, "400 response → ok=false");
  if (!bad.ok) {
    assert(bad.error?.includes("from is required") ?? false, "400 surfaces validation_errors");
  }

  // Restore real fetch
  global.fetch = realFetch;
}

console.log(`\n${status.pass} passed, ${status.fail} failed`);
process.exit(status.fail > 0 ? 1 : 0);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
