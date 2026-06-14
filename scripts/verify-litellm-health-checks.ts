/**
 * verify-litellm-health-checks.ts
 *
 * Hermetic test for the launch-final checkLiteLLM contract internal reviewer locked
 * 2026-05-09. Six scenarios from his sign-off:
 *
 *   1. liveness fail → OFFLINE
 *   2. no providers (Step 0) → NOT_CONFIGURED
 *   3. liveness pass + deep health timeout → ONLINE with slow/unknown detail
 *      (NOT DEGRADED — slow upstream-ping is not a real degradation)
 *   4. liveness pass + deep returns unhealthy_endpoints → DEGRADED with model list
 *   5. placeholder unhealthy endpoint is filtered (no DEGRADED on fresh installs)
 *   6. routine check path proves liveness fast — does not wait full 15s+
 *      before establishing proxy is alive
 *
 * Mocks fetch + provider-count query. No live host required.
 *
 *   npx tsx scripts/verify-litellm-health-checks.ts
 */

import { checkLiteLLM } from "../src/lib/health/litellm-check";

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
// Mock helpers
// ---------------------------------------------------------------------------

function makeFetch(impl: (url: string) => { ok?: boolean; status?: number; json?: () => unknown } | "abort" | "error" | "timeout"): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const r = impl(url);
    if (r === "error") throw new Error("fetch failed");
    if (r === "abort" || r === "timeout") {
      // Simulate AbortController timeout — throw same shape AbortController would
      throw new DOMException("aborted", "AbortError");
    }
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: r.json ?? (() => Promise.resolve({})),
    } as Response;
  }) as typeof fetch;
}

(async () => {

// ---------------------------------------------------------------------------
// Scenario 1 — liveness fail → OFFLINE
// ---------------------------------------------------------------------------

console.log("\n[1] liveness fail → OFFLINE");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch(() => ({ ok: false, status: 503 })),
    livenessTimeoutMs: 100,
    deepTimeoutMs: 100,
  });
  assert(result.status === "offline", `status === offline (got "${result.status}")`);
  assert(result.error === "HTTP 503", `error mentions HTTP 503 (got "${result.error}")`);
}

console.log("\n[1b] liveness fetch error → OFFLINE");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch(() => "error"),
    livenessTimeoutMs: 100,
    deepTimeoutMs: 100,
  });
  assert(result.status === "offline", `status === offline (got "${result.status}")`);
  assert(typeof result.error === "string" && result.error.length > 0, `error message present`);
}

// ---------------------------------------------------------------------------
// Scenario 2 — no providers → NOT_CONFIGURED
// ---------------------------------------------------------------------------

console.log("\n[2] no providers → NOT_CONFIGURED");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 0,
    fetchImpl: makeFetch(() => ({ ok: true })),
  });
  assert(result.status === "not_configured", `status === not_configured (got "${result.status}")`);
  assert(result.detail?.includes("No AI model provider configured"), `detail mentions configuration prompt`);
  assert(result.latency === 0, `latency 0 (no network call needed)`);
}

console.log("\n[2b] only placeholder model in /health response → NOT_CONFIGURED");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1, // DB has providers but health response is placeholder-only
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) return { ok: true };
      if (url.endsWith("/health")) return {
        ok: true,
        json: () => Promise.resolve({
          healthy_endpoints: [],
          unhealthy_endpoints: [{ model: "no-provider-configured" }],
        }),
      };
      return { ok: true };
    }),
  });
  assert(result.status === "not_configured", `placeholder-only is treated as not_configured (got "${result.status}")`);
}

// ---------------------------------------------------------------------------
// Scenario 3 — liveness pass + deep health timeout → ONLINE with slow detail
// ---------------------------------------------------------------------------

console.log("\n[3] liveness pass + deep health timeout → ONLINE with slow/unknown detail");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) return { ok: true };
      if (url.endsWith("/health")) return "timeout";
      return { ok: true };
    }),
    livenessTimeoutMs: 100,
    deepTimeoutMs: 100,
  });
  assert(result.status === "online", `liveness-pass + deep-timeout → ONLINE (got "${result.status}")`);
  assert(
    result.detail !== undefined && result.detail.toLowerCase().includes("slow"),
    `detail surfaces slow/unknown deep check (got "${result.detail}")`,
  );
  assert(
    result.status !== "degraded",
    `status is NOT degraded just because deep health was slow (the reviewer's rule)`,
  );
}

console.log("\n[3b] liveness pass + deep returns non-2xx → ONLINE with caveat detail");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) return { ok: true };
      if (url.endsWith("/health")) return { ok: false, status: 500 };
      return { ok: true };
    }),
  });
  assert(result.status === "online", `non-2xx deep → ONLINE not DEGRADED (got "${result.status}")`);
  assert(result.detail?.includes("500") || result.detail?.toLowerCase().includes("alive"), `detail mentions deep status`);
}

// ---------------------------------------------------------------------------
// Scenario 4 — liveness pass + deep unhealthy → DEGRADED with model list
// ---------------------------------------------------------------------------

console.log("\n[4] liveness pass + deep unhealthy_endpoints → DEGRADED with model list");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) return { ok: true };
      if (url.endsWith("/health")) return {
        ok: true,
        json: () => Promise.resolve({
          healthy_endpoints: [{ model: "openrouter/openai/gpt-4o" }],
          unhealthy_endpoints: [
            { model: "openrouter/google/gemini-2.5-pro-preview" },
            { model: "openrouter/anthropic/claude-sonnet-4" },
          ],
        }),
      };
      return { ok: true };
    }),
  });
  assert(result.status === "degraded", `real unhealthy endpoints → DEGRADED (got "${result.status}")`);
  assert(result.detail?.includes("2 model(s) unhealthy"), `detail names unhealthy count`);
  assert(result.detail?.includes("openrouter/google/gemini-2.5-pro-preview"), `detail names specific unhealthy model`);
  assert(result.detail?.includes("openrouter/anthropic/claude-sonnet-4"), `detail names second unhealthy model`);
}

// ---------------------------------------------------------------------------
// Scenario 5 — placeholder unhealthy endpoint is filtered
// ---------------------------------------------------------------------------

console.log("\n[5] placeholder filter — no DEGRADED on placeholder-only failure");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) return { ok: true };
      if (url.endsWith("/health")) return {
        ok: true,
        json: () => Promise.resolve({
          healthy_endpoints: [{ model: "openrouter/auto" }],
          unhealthy_endpoints: [{ model: "no-provider-configured" }], // placeholder failure
        }),
      };
      return { ok: true };
    }),
  });
  assert(result.status !== "degraded", `placeholder filter prevents DEGRADED (got "${result.status}")`);
  assert(result.status === "online", `status === online when only real model is healthy and placeholder is filtered (got "${result.status}")`);
}

console.log("\n[5b] mixed real-unhealthy + placeholder → DEGRADED (only real ones counted)");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) return { ok: true };
      if (url.endsWith("/health")) return {
        ok: true,
        json: () => Promise.resolve({
          healthy_endpoints: [],
          unhealthy_endpoints: [
            { model: "no-provider-configured" }, // placeholder — filter
            { model: "openrouter/openai/gpt-4o" }, // real — count
          ],
        }),
      };
      return { ok: true };
    }),
  });
  assert(result.status === "degraded", `real unhealthy still triggers DEGRADED (got "${result.status}")`);
  assert(result.detail?.includes("1 model(s) unhealthy"), `count is 1 (placeholder filtered out)`);
  assert(!result.detail?.includes("no-provider-configured"), `placeholder name not surfaced in detail`);
  assert(result.detail?.includes("openrouter/openai/gpt-4o"), `real unhealthy name IS surfaced`);
}

// ---------------------------------------------------------------------------
// Scenario 5c — REAL-WORLD prefixed placeholder caught on staging host 2026-05-09:
// LiteLLM emits the placeholder under the litellm_provider prefix in /health,
// so the model name is "openai/no-provider-configured" not "no-provider-configured".
// Filter must match the prefixed form via endsWith("/no-provider-configured").
// ---------------------------------------------------------------------------

console.log("\n[5c] prefixed placeholder ('openai/no-provider-configured') is filtered");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1, // user added a provider; LiteLLM not yet restarted
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) return { ok: true };
      if (url.endsWith("/health")) return {
        ok: true,
        json: () => Promise.resolve({
          healthy_endpoints: [],
          unhealthy_endpoints: [
            { model: "openai/no-provider-configured" }, // prefixed placeholder
          ],
        }),
      };
      return { ok: true };
    }),
  });
  assert(result.status !== "degraded", `prefixed placeholder is filtered, NOT DEGRADED (got "${result.status}")`);
  assert(result.status === "not_configured", `falls through to not_configured because only-placeholder (got "${result.status}")`);
  assert(!result.detail?.includes("openai/no-provider-configured"), `prefixed placeholder name not surfaced in detail`);
}

console.log("\n[5d] mixed real-unhealthy + prefixed placeholder → DEGRADED, only real counted");
{
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) return { ok: true };
      if (url.endsWith("/health")) return {
        ok: true,
        json: () => Promise.resolve({
          healthy_endpoints: [],
          unhealthy_endpoints: [
            { model: "openai/no-provider-configured" }, // prefixed placeholder — filter
            { model: "openrouter/anthropic/claude-3" }, // real — count
          ],
        }),
      };
      return { ok: true };
    }),
  });
  assert(result.status === "degraded", `real unhealthy still triggers DEGRADED with mixed prefixed placeholder (got "${result.status}")`);
  assert(result.detail?.includes("1 model(s) unhealthy"), `count excludes prefixed placeholder`);
  assert(!result.detail?.includes("no-provider-configured"), `prefixed placeholder name not in detail`);
  assert(result.detail?.includes("openrouter/anthropic/claude-3"), `real unhealthy name IS surfaced`);
}

// ---------------------------------------------------------------------------
// Scenario 6 — liveness budget < deep budget; routine check returns liveness
// fast even when deep is slow
// ---------------------------------------------------------------------------

console.log("\n[6] liveness establishes status before deep health budget would expire");
{
  const startMs = performance.now();
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) return { ok: true }; // fast
      if (url.endsWith("/health")) return "timeout";              // slow
      return { ok: true };
    }),
    livenessTimeoutMs: 50,
    deepTimeoutMs: 200,
  });
  const elapsedMs = performance.now() - startMs;
  assert(result.status === "online", `liveness pass + deep timeout → ONLINE`);
  // Liveness budget is 50ms; deep budget is 200ms. Total elapsed should
  // be roughly liveness + deep timeout. We just assert the function
  // completes within a generous bound (deep budget + slack).
  assert(elapsedMs < 500, `function completes within reasonable bound (got ${Math.round(elapsedMs)}ms)`);
  // Liveness latency should be <100ms (no real network)
  assert(result.latency < 200, `latency reflects fast liveness (got ${result.latency}ms)`);
}

// ---------------------------------------------------------------------------
// Scenario 7 — defense in depth: route /v1/models or other unrelated 200s
// don't accidentally pass as liveness
// ---------------------------------------------------------------------------

console.log("\n[7] liveness specifically uses /health/liveliness, not / or /v1/models");
{
  let livenessUrlCalled = "";
  const result = await checkLiteLLM(4001, {
    queryProviderCountImpl: () => 1,
    fetchImpl: makeFetch((url) => {
      if (url.endsWith("/health/liveliness")) {
        livenessUrlCalled = url;
        return { ok: true };
      }
      if (url.endsWith("/health")) return "timeout";
      return { ok: false, status: 404 }; // any other path is wrong
    }),
    livenessTimeoutMs: 100,
    deepTimeoutMs: 100,
  });
  assert(result.status === "online", `function uses /health/liveliness for status (got "${result.status}")`);
  assert(livenessUrlCalled.endsWith("/health/liveliness"), `liveness URL was /health/liveliness (got "${livenessUrlCalled}")`);
}

  // Report (inside IIFE so it sees final counts)
  if (failedCount > 0) {
    console.error(`\n${failedCount} assertion(s) FAILED out of ${assertionCount}`);
    process.exit(1);
  }
  console.log(`\n✅ All ${assertionCount} assertions passed`);
})();
