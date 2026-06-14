/**
 * verify-litellm-provider-sync.ts
 *
 * the reviewer's launch-blocker verifier for the 2026-05-09 LiteLLM provider-sync
 * fix. Asserts the four-fix bundle behaves correctly across:
 *
 *   1. The shipped litellm/config.template.yaml — no localhost:1234 / no
 *      openai/auto active entries; labeled placeholder is present.
 *   2. syncProvidersToYaml's behavior with 0 / 1 / N providers, including
 *      the placeholder fallback and the Shield Logger callbacks line.
 *   3. The dashboard's checkLiteLLM filter — it actually filters
 *      "no-provider-configured" out of unhealthy_endpoints.
 *   4. Secret hygiene — no api_key value ever leaves the verifier as log
 *      output (we capture stdout/stderr around the unit-under-test calls
 *      and assert the captured text never contains the test secrets).
 *
 * Hermetic: no DB, no fetch, no Next.js runtime. We mock @/lib/db's
 * queryAll/run via require.cache injection so the imported route module
 * sees our fixture providers, then we read the produced YAML from a
 * temp file. assertSafeYamlValue is called via real provider data in
 * fixture #2, so YAML-injection guarding is exercised.
 *
 *   npx tsx scripts/verify-litellm-provider-sync.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import Module from "node:module";

// ---------------------------------------------------------------------------
// Test harness — pass/fail counter + secret-leak guard
// ---------------------------------------------------------------------------
let failed = 0;
function ok(msg: string) { console.log(`  PASS  ${msg}`); }
function fail(msg: string) { console.log(`  FAIL  ${msg}`); failed++; }
function assert(cond: boolean, msg: string) { cond ? ok(msg) : fail(msg); }

// Capture all stdout/stderr through a tap so we can scan for leaked
// secrets at the end. The verifier MUST NEVER print api_key values.
const stdoutTap: string[] = [];
const stderrTap: string[] = [];
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
  if (typeof chunk === "string") stdoutTap.push(chunk);
  else stdoutTap.push(Buffer.from(chunk).toString("utf-8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return origStdoutWrite(chunk as any, ...(args as any[]));
}) as typeof process.stdout.write;
process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
  if (typeof chunk === "string") stderrTap.push(chunk);
  else stderrTap.push(Buffer.from(chunk).toString("utf-8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return origStderrWrite(chunk as any, ...(args as any[]));
}) as typeof process.stderr.write;

// ---------------------------------------------------------------------------
// 2026-05-09: lib extraction. syncProvidersToYaml moved to src/lib/litellm/sync.ts.
// New contract: caller provides a better-sqlite3-shaped Database; lib never
// imports @/lib/db/index. Verifier supplies a tiny stub that mimics the
// db.prepare(sql).all() interface the lib uses.
// ---------------------------------------------------------------------------
type ProviderRow = { id: string; name: string; type: string; base_url: string; api_key: string; is_active: number };
type ModelRow = { model_id: string; provider_id: string };

let mockProviders: ProviderRow[] = [];
let mockModels: ModelRow[] = [];

interface StubDb {
  prepare: (sql: string) => { all: () => unknown[] };
}

function makeStubDb(): StubDb {
  return {
    prepare: (sql: string) => ({
      all: () => {
        if (sql.includes("FROM config_providers")) return mockProviders;
        if (sql.includes("FROM config_models")) return mockModels;
        return [];
      },
    }),
  };
}

const repoRoot = path.resolve(__dirname, "..");

// Load the lib (no DB cache injection needed — the lib doesn't touch
// @/lib/db/index; we pass a stubbed Database directly).
const localRequire = Module.createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const litellmLib = localRequire(path.join(repoRoot, "src", "lib", "litellm", "sync.ts"));
const { syncProvidersToYaml, PLACEHOLDER_MODEL_NAME } = litellmLib as {
  syncProvidersToYaml: (opts: { db: StubDb; configPath: string }) => {
    provider_count: number;
    wrote_config: boolean;
    config_path: string;
    placeholder_only: boolean;
    model_names: string[];
  };
  PLACEHOLDER_MODEL_NAME: string;
};

// ---------------------------------------------------------------------------
// Test secret values — fingerprints we'll later scan logs for. These are
// fake values; if any of them appear in stdoutTap/stderrTap at the end,
// the verifier fails (secret-leak guard).
// ---------------------------------------------------------------------------
const FAKE_OPENROUTER_KEY = "verifier-fake-openrouter-key-do-not-leak-XYZ";
const FAKE_OPENAI_KEY = "verifier-fake-openai-key-do-not-leak-ABC";

// ---------------------------------------------------------------------------
// Test 1: Shipped template — no localhost:1234, no active openai/auto
// ---------------------------------------------------------------------------
console.log("[1] Shipped litellm/config.template.yaml");
{
  const templatePath = path.join(repoRoot, "litellm", "config.template.yaml");
  const tpl = fs.readFileSync(templatePath, "utf-8");

  // Active line check — strip comment lines first so commented-out
  // examples (which are deliberately preserved) don't false-positive.
  const activeLines = tpl
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  assert(
    !activeLines.includes("localhost:1234"),
    "template has no ACTIVE localhost:1234 entry",
  );
  assert(
    !activeLines.includes("openai/auto"),
    "template has no ACTIVE openai/auto entry",
  );
  assert(
    tpl.includes(`model_name: "${PLACEHOLDER_MODEL_NAME}"`),
    `template contains the labeled placeholder model_name "${PLACEHOLDER_MODEL_NAME}"`,
  );
  assert(
    tpl.includes("callbacks: [\"clawnex_logger.ClawNexLogger\"]"),
    "template preserves the Shield Logger callbacks line",
  );
}

// ---------------------------------------------------------------------------
// Test 2: 0 providers → labeled placeholder + callbacks line preserved
// ---------------------------------------------------------------------------
console.log("[2] syncProvidersToYaml with 0 providers");
{
  mockProviders = [];
  mockModels = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-litellm-"));
  const cfg = path.join(tmp, "config.yaml");
  const result = syncProvidersToYaml({ db: makeStubDb(), configPath: cfg });
  const out = fs.readFileSync(cfg, "utf-8");

  assert(result.provider_count === 0, "synced count is 0 when no providers");
  assert(result.model_names.length === 1 && result.model_names[0] === PLACEHOLDER_MODEL_NAME, "models list contains only the placeholder");
  assert(out.includes(`model_name: "${PLACEHOLDER_MODEL_NAME}"`), "output contains labeled placeholder model_name");
  assert(out.includes(`model: "openai/${PLACEHOLDER_MODEL_NAME}"`), "placeholder model field uses no-provider-configured");
  assert(!out.includes("localhost:1234"), "output never references localhost:1234");
  assert(!out.includes('model: "openai/auto"'), "output never emits openai/auto");
  assert(
    out.includes("callbacks: [\"clawnex_logger.ClawNexLogger\"]"),
    "Shield Logger callbacks preserved on empty install",
  );
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 3: 1 OpenRouter provider → real openrouter/auto + wildcard, no placeholder
// ---------------------------------------------------------------------------
console.log("[3] syncProvidersToYaml with 1 OpenRouter provider");
{
  mockProviders = [
    {
      id: "p-openrouter",
      name: "OpenRouter",
      type: "openrouter",
      base_url: "https://openrouter.ai/api/v1",
      api_key: FAKE_OPENROUTER_KEY,
      is_active: 1,
    },
  ];
  mockModels = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-litellm-"));
  const cfg = path.join(tmp, "config.yaml");
  const result = syncProvidersToYaml({ db: makeStubDb(), configPath: cfg });
  const out = fs.readFileSync(cfg, "utf-8");

  assert(result.provider_count === 1, "synced count is 1 when one provider");
  assert(out.includes('model_name: "openrouter/auto"'), "real openrouter/auto entry written");
  assert(out.includes('model_name: "openrouter/*"'), "wildcard openrouter/* entry written");
  assert(out.includes('model: "openrouter/auto"') && out.includes('model: "openrouter/*"'), "openrouter/* model field present");
  assert(!out.includes(PLACEHOLDER_MODEL_NAME), "placeholder model removed when real providers present");
  assert(
    out.includes("callbacks: [\"clawnex_logger.ClawNexLogger\"]"),
    "Shield Logger callbacks preserved with real providers",
  );
  // The api_key SHOULD appear inside the YAML file (that's the point) — but
  // the verifier MUST NOT echo it. fs.readFileSync into `out` is fine; we
  // just must not console.log(out).
  assert(out.includes(FAKE_OPENROUTER_KEY), "openrouter api_key present in YAML (file content, not stdout)");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 4: 2 providers (one OpenAI + a configured model row) → both routes
// produced, no placeholder, callbacks intact
// ---------------------------------------------------------------------------
console.log("[4] syncProvidersToYaml with mixed providers + configured model");
{
  mockProviders = [
    {
      id: "p-openai",
      name: "OpenAI",
      type: "openai",
      base_url: "https://api.openai.com/v1",
      api_key: FAKE_OPENAI_KEY,
      is_active: 1,
    },
  ];
  mockModels = [
    { model_id: "gpt-4o-mini", provider_id: "p-openai" },
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-litellm-"));
  const cfg = path.join(tmp, "config.yaml");
  syncProvidersToYaml({ db: makeStubDb(), configPath: cfg });
  const out = fs.readFileSync(cfg, "utf-8");

  assert(out.includes('model_name: "openai"'), "openai provider produces a top-level openai route");
  assert(out.includes('model_name: "openai/*"'), "openai provider produces wildcard openai/* route");
  assert(out.includes('model_name: "gpt-4o-mini"'), "configured model gpt-4o-mini produces its own route");
  assert(!out.includes(PLACEHOLDER_MODEL_NAME), "placeholder NOT written when real providers exist");
  assert(out.includes("callbacks: [\"clawnex_logger.ClawNexLogger\"]"), "callbacks preserved across mixed sync");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 5: assertSafeYamlValue still gates user-supplied values
// ---------------------------------------------------------------------------
console.log("[5] assertSafeYamlValue still rejects YAML-injection payloads");
{
  // We can't call assertSafeYamlValue directly (it's not exported), so we
  // exercise it via a malicious provider row. The route's per-provider
  // try/catch catches the throw, logs a console.error, and skips the
  // provider — final YAML must NOT contain the injection.
  const evilKey = "evil\nrogue_key: pwned";
  mockProviders = [
    {
      id: "p-evil",
      name: "Evil",
      type: "openai",
      base_url: "https://evil.example/v1",
      api_key: evilKey,
      is_active: 1,
    },
  ];
  mockModels = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-litellm-"));
  const cfg = path.join(tmp, "config.yaml");
  syncProvidersToYaml({ db: makeStubDb(), configPath: cfg });
  const out = fs.readFileSync(cfg, "utf-8");
  assert(
    !out.includes("rogue_key:"),
    "YAML-injection payload rejected by assertSafeYamlValue (no rogue_key in output)",
  );
  // The skip should fall back to the placeholder since no provider survived.
  assert(out.includes(PLACEHOLDER_MODEL_NAME), "rejected provider falls back to placeholder");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 6: Dashboard checkLiteLLM source contains the placeholder filter
// 2026-05-09: extracted from infrastructure/route.ts into
// src/lib/health/litellm-check.ts per the reviewer's launch-final architecture.
// The assertions look in the new module location. The infrastructure
// route now imports + delegates to checkLiteLLMImpl from there.
// ---------------------------------------------------------------------------
console.log("[6] Dashboard checkLiteLLM filters the placeholder model name");
{
  const checkPath = path.join(repoRoot, "src", "lib", "health", "litellm-check.ts");
  const src = fs.readFileSync(checkPath, "utf-8");
  assert(
    src.includes('"no-provider-configured"'),
    "checkLiteLLM source references the no-provider-configured filter token",
  );
  // 2026-05-09: placeholder matching is now suffix-based ("no-provider-configured"
  // bare, OR "<prefix>/no-provider-configured") because LiteLLM emits the
  // placeholder under its litellm_provider prefix in /health responses
  // (e.g. "openai/no-provider-configured"). Live deploy on 45c2a96 caught
  // the prefix-miss as DEGRADED with the placeholder name in the detail line.
  assert(
    src.includes("PLACEHOLDER_SUFFIX") || src.includes("PLACEHOLDER_MODELS"),
    "checkLiteLLM defines a placeholder constant",
  );
  assert(
    src.includes("isPlaceholder") && src.includes('endsWith("/" + PLACEHOLDER_SUFFIX)'),
    "checkLiteLLM uses suffix match (handles 'openai/no-provider-configured' prefix variant)",
  );
  assert(
    src.includes("onlyPlaceholderConfigured"),
    "checkLiteLLM has the onlyPlaceholderConfigured branch that returns not_configured",
  );
  assert(
    src.includes('status: "not_configured"'),
    "checkLiteLLM short-circuits to not_configured when only the placeholder is present",
  );
  // Sanity: the route still wires up to the new module.
  const routePath = path.join(repoRoot, "src", "app", "api", "infrastructure", "route.ts");
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  assert(
    routeSrc.includes('from "@/lib/health/litellm-check"'),
    "Infrastructure route imports checkLiteLLM from the extracted module",
  );
}

// ---------------------------------------------------------------------------
// Test 7: Provider-save handler imports syncProvidersToYaml and triggers it
// ---------------------------------------------------------------------------
console.log("[7] Provider-save route triggers sync");
{
  const savePath = path.join(repoRoot, "src", "app", "api", "config", "providers", "route.ts");
  const src = fs.readFileSync(savePath, "utf-8");
  assert(
    src.includes("syncProvidersToYaml"),
    "POST /api/config/providers imports syncProvidersToYaml",
  );
  assert(
    src.includes("syncLiteLLMConfig"),
    "POST /api/config/providers calls the sync helper after addProvider",
  );
  // 2026-05-09: auto-restart was removed per operator directive after rapid
  // sequential saves caused per-save restart cycles. Sync stays; restart
  // is now manual via the Infrastructure tab Restart button. Verifier
  // explicitly asserts the auto-restart code is NOT present so it can't
  // sneak back in.
  assert(
    !src.includes("systemctl restart clawnex-litellm.service"),
    "POST handler does NOT auto-restart LiteLLM (operator clicks Restart manually)",
  );
  // Best-effort guard: failure must NOT throw out of the helper.
  assert(
    src.includes("non-fatal"),
    "Save sync helper marks failures as non-fatal",
  );
}

// ---------------------------------------------------------------------------
// Test 8: Provider-delete handler also triggers sync
// ---------------------------------------------------------------------------
console.log("[8] Provider-delete route triggers sync");
{
  const delPath = path.join(repoRoot, "src", "app", "api", "config", "providers", "[id]", "route.ts");
  const src = fs.readFileSync(delPath, "utf-8");
  assert(
    src.includes("syncProvidersToYaml"),
    "DELETE /api/config/providers/[id] imports syncProvidersToYaml",
  );
  assert(
    src.includes("syncLiteLLMConfig"),
    "DELETE handler calls sync helper after removeProvider",
  );
  // Same anti-restart guard as the POST handler.
  assert(
    !src.includes("systemctl restart clawnex-litellm.service"),
    "DELETE handler does NOT auto-restart LiteLLM (operator clicks Restart manually)",
  );
}

// ---------------------------------------------------------------------------
// Test 9: assertSafeYamlValue is referenced in the lib (not silently dropped)
// 2026-05-09: extracted from route.ts → src/lib/litellm/sync.ts. Same call
// count expected: 2 in provider loop + 3 in configured-models loop = 5.
// ---------------------------------------------------------------------------
console.log("[9] assertSafeYamlValue still wired into syncProvidersToYaml");
{
  const libPath = path.join(repoRoot, "src", "lib", "litellm", "sync.ts");
  const src = fs.readFileSync(libPath, "utf-8");
  const matches = src.match(/assertSafeYamlValue\(/g) || [];
  assert(matches.length >= 5, `assertSafeYamlValue is still called for user-supplied values (${matches.length} call sites)`);
}

// ---------------------------------------------------------------------------
// Test 10: Secret-leak guard — no fake api_key value ever appeared in logs
// ---------------------------------------------------------------------------
console.log("[10] Secret-leak guard: no api_key values printed");
{
  // We taps stdout + stderr from the start of this script. The fixtures
  // wrote api_keys into YAML files but the verifier itself must never
  // have written them to a stream.
  const allLogs = stdoutTap.join("") + stderrTap.join("");
  assert(
    !allLogs.includes(FAKE_OPENROUTER_KEY),
    "openrouter fake api_key never logged to stdout/stderr",
  );
  assert(
    !allLogs.includes(FAKE_OPENAI_KEY),
    "openai fake api_key never logged to stdout/stderr",
  );
}

// ---------------------------------------------------------------------------
// Test 11: ConfigurationPanel surfaces the manual-Restart contract
//
// internal reviewer 2026-05-09 conditional sign-off: provider save / delete syncs
// litellm/config.yaml but does NOT auto-restart LiteLLM. The dashboard
// MUST surface that contract via a banner with a direct jump to the
// Infrastructure Health panel — operators otherwise won't know LiteLLM
// is still serving the old config.
// ---------------------------------------------------------------------------
console.log("[11] ConfigurationPanel surfaces manual-Restart contract");
{
  const cfgPath = path.join(repoRoot, "src", "components", "dashboard", "panels", "ConfigurationPanel.tsx");
  const src = fs.readFileSync(cfgPath, "utf-8");
  assert(
    src.includes("restartHintVisible"),
    "ConfigurationPanel has restartHintVisible state",
  );
  assert(
    src.includes("Provider saved. LiteLLM config synced."),
    "Banner copy matches the reviewer's required wording",
  );
  assert(
    src.includes('onNavigate("infrastructure")'),
    "Banner button jumps to infrastructure tab",
  );
  assert(
    src.includes("setRestartHintVisible(true)"),
    "Banner is shown after a successful provider add/remove",
  );
}

// ---------------------------------------------------------------------------
// Restore stream taps and report
// ---------------------------------------------------------------------------
process.stdout.write = origStdoutWrite;
process.stderr.write = origStderrWrite;

if (failed > 0) {
  console.log(`\n${failed} assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll assertions passed`);
