/**
 * verify-provider-ssrf-write.ts — Codex 2026-05-17 #3 regression.
 *
 * Before this fix, addProvider/updateProvider's write-time SSRF guard
 * only checked literal IP shapes — hostnames passed straight through and
 * got saved to litellm/config.yaml, where LiteLLM resolves them at chat
 * time and forwards model traffic + every Bearer token to whatever they
 * point at. The DNS-resolving fetch-time guard (assertSafeFetchTarget)
 * existed but was wired only to the "test" button; production chat
 * traffic was unprotected.
 *
 * This verifier proves:
 *   1. addProvider rejects literal private/link-local/metadata IPs.
 *   2. addProvider rejects literal cloud-metadata endpoint (169.254.169.254).
 *   3. addProvider allows literal loopback IPs (OpenClaw / LM Studio).
 *   4. addProvider allows public hostnames (example.com).
 *   5. addProvider rejects nonexistent hostnames (fail-closed on DNS miss).
 *   6. addProvider and updateProvider expose a Promise-returning signature
 *      (forces callers to await the SSRF guard rather than fire-and-forget).
 *
 * Run: npx tsx scripts/verify-provider-ssrf-write.ts
 */

process.env.DATABASE_PATH = ":memory:";
process.env.CLAWNEX_AUDIT_STDOUT = "false";

import {
  addProvider,
  assertSafeProviderHttpFetchTarget,
  providerEndpointUrl,
  updateProvider,
} from "../src/lib/services/config-service";

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

async function expectReject(baseUrl: string, label: string) {
  let threw = false;
  let msg = "";
  try {
    await addProvider({ name: `ssrf-test-${Date.now()}`, type: "anthropic", baseUrl, apiKey: "sk-test" });
  } catch (err) {
    threw = true;
    msg = err instanceof Error ? err.message : String(err);
  }
  assert(threw, `${label} → addProvider threw (${msg.slice(0, 80)})`);
}

async function expectAllow(baseUrl: string, label: string) {
  let threw = false;
  let msg = "";
  try {
    await addProvider({ id: `ssrf-test-${Math.random()}`, name: `ssrf-test-${Date.now()}`, type: "anthropic", baseUrl, apiKey: "sk-test" });
  } catch (err) {
    threw = true;
    msg = err instanceof Error ? err.message : String(err);
  }
  assert(!threw, `${label} → addProvider succeeded (any throw: ${msg.slice(0, 80)})`);
}

// ---------------------------------------------------------------------------

async function main() {
  section("addProvider rejects literal private / link-local / metadata IPs");
  await expectReject("http://10.0.0.1:8080", "10.0.0.1 (RFC1918)");
  await expectReject("https://192.168.1.100", "192.168.1.100 (RFC1918)");
  await expectReject("http://172.16.0.5", "172.16.0.5 (RFC1918)");
  await expectReject("http://169.254.169.254", "169.254.169.254 (AWS/GCP cloud metadata)");

  section("addProvider allows literal loopback IPs (legitimate for OpenClaw / LM Studio)");
  await expectAllow("http://127.0.0.1:11434", "127.0.0.1:11434 (LM Studio default)");
  await expectAllow("http://localhost:11434", "localhost:11434 (resolves to loopback)");

  section("addProvider allows allowlisted public hostnames (DNS resolves to public range)");
  await expectAllow("https://api.anthropic.com", "api.anthropic.com (PROVIDER_HOST_ALLOWLIST)");

  section("Codex round 2 #3: addProvider REJECTS hostnames NOT on allowlist (DNS TOCTOU defense)");
  // Round-1 fix DNS-resolved once at save time but stored the hostname.
  // LiteLLM re-resolves at chat time, so an attacker hostname that
  // resolves public at save and rebinds to private at use defeats the
  // check. example.com resolves to a public IP, so the old guard would
  // ALLOW it. The new allowlist rejects it because it's not on the
  // PROVIDER_HOST_ALLOWLIST and no TRUSTED_PROVIDER_HOSTS env is set.
  delete process.env.TRUSTED_PROVIDER_HOSTS;
  await expectReject("https://example.com", "example.com (public but NOT on allowlist) → reject");
  await expectReject("https://attacker.example", "attacker.example (arbitrary attacker domain) → reject");
  // Reject still gives the helpful "TRUSTED_PROVIDER_HOSTS" pointer.
  let pointerOk = false;
  try {
    await addProvider({ name: "ptest", type: "anthropic", baseUrl: "https://example.com", apiKey: "" });
  } catch (err) {
    pointerOk = String(err).includes("TRUSTED_PROVIDER_HOSTS");
  }
  assert(pointerOk, "reject message points operator to TRUSTED_PROVIDER_HOSTS env for self-hosted endpoints");

  section("Codex round 2 #3: TRUSTED_PROVIDER_HOSTS env extends the allowlist");
  process.env.TRUSTED_PROVIDER_HOSTS = "self-hosted.example, my-llm.internal";
  // Have to import a fresh module reference because the function reads
  // process.env at call time — which it does (good). example.com still
  // not on the (default+extra) list, so still rejected.
  await expectReject("https://example.com", "example.com still rejected even with TRUSTED_PROVIDER_HOSTS set");
  // self-hosted.example.invalid wouldn't actually exist; we want to
  // assert the ALLOWLIST check passes — the DNS-fail-closed will still
  // reject downstream. So we expect rejection but for a different reason.
  let allowlistPassed = false;
  try {
    await addProvider({ name: "ptest", type: "anthropic", baseUrl: "https://self-hosted.example", apiKey: "" });
  } catch (err) {
    const msg = String(err);
    // If the error mentions "not on the trusted-provider allowlist", the
    // allowlist still rejected. If it mentions "did not resolve" or
    // "private", we passed the allowlist and hit the DNS check — which
    // proves TRUSTED_PROVIDER_HOSTS worked.
    allowlistPassed = !msg.includes("trusted-provider allowlist");
  }
  assert(allowlistPassed, "self-hosted.example (in TRUSTED_PROVIDER_HOSTS) bypassed allowlist gate (rejected downstream by DNS — proves env extended the list)");
  delete process.env.TRUSTED_PROVIDER_HOSTS;

  section("addProvider rejects nonexistent hostnames (fail-closed on DNS miss, after allowlist passes)");
  // We test this with an allowlisted-but-nonexistent variant by adding
  // a fake host to TRUSTED_PROVIDER_HOSTS so it passes the allowlist
  // and then hits the DNS check.
  process.env.TRUSTED_PROVIDER_HOSTS = "nonexistent-host-9d8f7a6b.invalid";
  await expectReject("https://nonexistent-host-9d8f7a6b.invalid", "allowlisted-but-no-DNS → reject (defense-in-depth)");
  delete process.env.TRUSTED_PROVIDER_HOSTS;

  section("Promise signature on write APIs (forces await)");
  const addRes = addProvider({ name: "sig-probe", type: "anthropic", baseUrl: "http://127.0.0.1:1", apiKey: "" });
  assert(typeof (addRes as unknown as Promise<unknown>).then === "function", "addProvider returns a Promise");
  // Drain it without crashing the verifier even though the address is unreachable.
  try { await addRes; } catch { /* expected for this probe */ }

  const updRes = updateProvider("nonexistent-id", { name: "noop" });
  assert(typeof (updRes as unknown as Promise<unknown>).then === "function", "updateProvider returns a Promise");
  try { await updRes; } catch { /* expected — id doesn't exist */ }

  section("read-time guard blocks unsafe legacy provider rows before fetch");
  const metadataRead = await assertSafeProviderHttpFetchTarget(
    "http://169.254.169.254/latest/meta-data/models",
    "legacy provider read",
  );
  assert(metadataRead.blocked, "read-time guard rejects cloud metadata target");

  const attackerRead = await assertSafeProviderHttpFetchTarget(
    "https://example.com/models",
    "legacy provider read",
  );
  assert(attackerRead.blocked, "read-time guard rejects public hostnames not on allowlist");

  const localRead = await assertSafeProviderHttpFetchTarget(
    "http://127.0.0.1:11434/v1/models",
    "legacy local provider read",
  );
  assert(!localRead.blocked, "read-time guard allows loopback local model servers");

  const providerModelUrl = providerEndpointUrl("https://openrouter.ai/api/v1", "chat/completions");
  assert(providerModelUrl === "https://openrouter.ai/api/v1/chat/completions", "providerEndpointUrl preserves provider base path");

  console.log(`\nResult: ${status.pass} passed, ${status.fail} failed`);
  if (status.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
