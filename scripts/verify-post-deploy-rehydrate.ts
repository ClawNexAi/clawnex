/**
 * verify-post-deploy-rehydrate.ts
 *
 * Locks the reviewer's 2026-05-09 acceptance contract for the deploy-pipeline
 * rehydration patch:
 *   - lib lives at src/lib/litellm/sync.ts (NOT in any API route)
 *   - script imports from the lib, not from a route
 *   - script accepts explicit --install-dir / --database / --config
 *   - install-prod.sh calls the script BEFORE the final LiteLLM restart
 *   - functional: zero providers → placeholder block + placeholder_only=true
 *   - functional: active OpenRouter provider → real entries + placeholder_only=false
 *   - functional: SyncResult does not leak api_keys
 *   - functional: openclaw-only DB still classifies as no-real-providers
 *
 *   npx tsx scripts/verify-post-deploy-rehydrate.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { syncProvidersToYaml, PLACEHOLDER_MODEL_NAME } from "../src/lib/litellm/sync";

const ROOT = process.cwd();

let assertions = 0;
let failed = 0;

function pass(msg: string) { assertions++; console.log(`PASS: ${msg}`); }
function fail(msg: string) { assertions++; failed++; console.error(`FAIL: ${msg}`); }
function assert(cond: unknown, msg: string): void { if (cond) pass(msg); else fail(msg); }

// ---------------------------------------------------------------------------
// Section 1 — lib module exists with the right exports
// ---------------------------------------------------------------------------

console.log("\n[1] lib/litellm/sync.ts exports");
{
  const libPath = path.join(ROOT, "src/lib/litellm/sync.ts");
  assert(fs.existsSync(libPath), `lib file exists at src/lib/litellm/sync.ts`);
  const libSrc = fs.readFileSync(libPath, "utf-8");
  assert(/export\s+function\s+syncProvidersToYaml\s*\(/.test(libSrc), `lib exports syncProvidersToYaml function`);
  assert(/export\s+const\s+PLACEHOLDER_MODEL_NAME/.test(libSrc), `lib exports PLACEHOLDER_MODEL_NAME constant`);
  assert(libSrc.includes("interface SyncOptions"), `lib defines SyncOptions interface`);
  assert(libSrc.includes("interface SyncResult"), `lib defines SyncResult interface`);
  assert(libSrc.includes("provider_count") && libSrc.includes("placeholder_only") && libSrc.includes("model_names") && libSrc.includes("config_path") && libSrc.includes("wrote_config"),
    `SyncResult has the reviewer's required keys (provider_count, placeholder_only, model_names, config_path, wrote_config)`);
  // Lib must NOT import the global @/lib/db/index — caller provides Database
  assert(!libSrc.includes(`from "@/lib/db/index"`) && !libSrc.includes(`from "@/lib/db"`),
    `lib does NOT import @/lib/db (caller provides Database instance)`);
}

// ---------------------------------------------------------------------------
// Section 2 — script source contract
// ---------------------------------------------------------------------------

console.log("\n[2] scripts/post-deploy-rehydrate.ts contract");
{
  const scriptPath = path.join(ROOT, "scripts/post-deploy-rehydrate.ts");
  assert(fs.existsSync(scriptPath), `script file exists`);
  const scriptSrc = fs.readFileSync(scriptPath, "utf-8");
  assert(scriptSrc.includes(`from "../src/lib/litellm/sync"`),
    `script imports from src/lib/litellm/sync (the lib module, not a route)`);
  assert(!scriptSrc.includes("/app/api/system/litellm/route") && !scriptSrc.includes("/app/api/config/providers"),
    `script does NOT import from any API route module`);
  assert(scriptSrc.includes(`"install-dir"`) && scriptSrc.includes(`"database"`) && scriptSrc.includes(`"config"`),
    `script accepts explicit --install-dir, --database, --config flags`);
  assert(scriptSrc.includes("process.exit(2)"),
    `script exits non-zero on failure (fail-closed deploy)`);
  assert(scriptSrc.includes("placeholder_only") && scriptSrc.includes("provider_count > 0"),
    `script enforces "no placeholder-only when providers exist" guardrail`);
  assert(scriptSrc.includes("better-sqlite3"),
    `script opens the DB explicitly (does not rely on process.cwd-resolved global)`);
}

// ---------------------------------------------------------------------------
// Section 3 — provider routes import from lib, not from system/litellm route
// ---------------------------------------------------------------------------

console.log("\n[3] API routes import from lib (not from each other)");
{
  const sysRoutePath = path.join(ROOT, "src/app/api/system/litellm/route.ts");
  const sysRouteSrc = fs.readFileSync(sysRoutePath, "utf-8");
  assert(sysRouteSrc.includes(`from "@/lib/litellm/sync"`),
    `system/litellm route imports from lib`);

  const provRoutePath = path.join(ROOT, "src/app/api/config/providers/route.ts");
  const provRouteSrc = fs.readFileSync(provRoutePath, "utf-8");
  assert(provRouteSrc.includes(`from '@/lib/litellm/sync'`) || provRouteSrc.includes(`from "@/lib/litellm/sync"`),
    `config/providers route imports from lib`);
  assert(!provRouteSrc.includes("'@/app/api/system/litellm/route'") && !provRouteSrc.includes(`"@/app/api/system/litellm/route"`),
    `config/providers route does NOT import from system/litellm route`);

  const provIdPath = path.join(ROOT, "src/app/api/config/providers/[id]/route.ts");
  const provIdSrc = fs.readFileSync(provIdPath, "utf-8");
  assert(provIdSrc.includes(`from '@/lib/litellm/sync'`) || provIdSrc.includes(`from "@/lib/litellm/sync"`),
    `config/providers/[id] route imports from lib`);
  assert(!provIdSrc.includes("'@/app/api/system/litellm/route'") && !provIdSrc.includes(`"@/app/api/system/litellm/route"`),
    `config/providers/[id] route does NOT import from system/litellm route`);
}

// ---------------------------------------------------------------------------
// Section 4 — internal reviewer 2026-05-10 ordering fix: rehydrate is OWNED by
// scripts/deploy-prod.sh (the deploy wrapper that handles preserved-DB
// tar/restore), NOT by deploy/install-prod.sh.
//
// install-prod.sh runs BEFORE the wrapper restores the preserved DB, so
// a rehydrate hook in install-prod.sh always operates against an empty
// DB (staging host 2026-05-09 caught this: log showed "skipped (no DB)" then
// the next step restored the DB). The wrapper now runs the rehydrate
// AFTER restore + chown, BEFORE standalone symlinks, BEFORE LiteLLM
// restart and dashboard restart.
// ---------------------------------------------------------------------------

console.log("\n[4] rehydrate ownership is in deploy-prod.sh (post DB-restore), NOT install-prod.sh");
{
  const installPath = path.join(ROOT, "deploy/install-prod.sh");
  const installSrc = fs.readFileSync(installPath, "utf-8");
  const deployPath = path.join(ROOT, "scripts/deploy-prod.sh");
  const deploySrc = fs.readFileSync(deployPath, "utf-8");

  // 4a — install-prod.sh must NOT call post-deploy-rehydrate.ts anymore.
  // (Comments/notes referencing "post-deploy-rehydrate" for documentation
  // are fine; the executable invocation must be gone.)
  const installCallMatches = installSrc.match(/(?<!#[^\n]*)\bpost-deploy-rehydrate\.ts\b/g) || [];
  // Also forbid an executable tsx invocation referencing the script.
  const installLines = installSrc.split("\n").filter((l) => !/^\s*#/.test(l));
  const installCodeOnly = installLines.join("\n");
  assert(!/post-deploy-rehydrate\.ts/.test(installCodeOnly),
    `install-prod.sh has no executable post-deploy-rehydrate.ts invocation`);
  assert(!/--install-dir\s+["']?\$INSTALL_DIR/.test(installCodeOnly) ||
         !installCodeOnly.includes("RESOLVED_DB_PATH"),
    `install-prod.sh no longer has the rehydrate flag block (--install-dir + RESOLVED_DB_PATH)`);

  // 4b — deploy-prod.sh DOES call post-deploy-rehydrate.ts.
  const deployCallIdx = deploySrc.indexOf("post-deploy-rehydrate.ts");
  assert(deployCallIdx > 0,
    `deploy-prod.sh calls scripts/post-deploy-rehydrate.ts`);

  // 4c — The call must appear AFTER the "restored operator DB" line.
  const restoreIdx = deploySrc.indexOf("restored operator DB");
  assert(restoreIdx > 0, `deploy-prod.sh has the "restored operator DB" success line`);
  if (deployCallIdx > 0 && restoreIdx > 0) {
    assert(deployCallIdx > restoreIdx,
      `deploy-prod.sh rehydrate call appears AFTER "restored operator DB" (internal reviewer ordering fix)`);
  }

  // 4d — The call must appear BEFORE the first ln -sf ../../clawnex.db symlink.
  const firstDbSymlinkIdx = deploySrc.search(/ln -sf\s+\.\.\/\.\.\/clawnex\.db\b/);
  assert(firstDbSymlinkIdx > 0, `deploy-prod.sh has ln -sf ../../clawnex.db symlink`);
  if (deployCallIdx > 0 && firstDbSymlinkIdx > 0) {
    assert(deployCallIdx < firstDbSymlinkIdx,
      `deploy-prod.sh rehydrate call appears BEFORE first ln -sf ../../clawnex.db (internal reviewer ordering fix)`);
  }

  // 4e — Explicit flags --install-dir, --database, --config.
  if (deployCallIdx > 0) {
    const callBlock = deploySrc.slice(deployCallIdx, deployCallIdx + 1200);
    assert(callBlock.includes("--install-dir") &&
           callBlock.includes("--database") &&
           callBlock.includes("--config"),
      `deploy-prod.sh rehydrate call uses explicit --install-dir / --database / --config flags`);
  }

  // 4f — Pinned local tsx (no bare npx).
  assert(deploySrc.includes("node_modules/.bin/tsx"),
    `deploy-prod.sh uses pinned local tsx`);
  const npxTsxMatchesDeploy = deploySrc.match(/(?<!\w)npx\s+tsx\b/g) || [];
  assert(npxTsxMatchesDeploy.length === 0,
    `deploy-prod.sh has no bare 'npx tsx' invocations`);
  assert(deploySrc.includes(`if [ ! -x "$TSX_BIN" ]`),
    `deploy-prod.sh fails closed when pinned tsx missing`);

  // 4g — DB path resolution from .env.local DATABASE_PATH.
  assert(deploySrc.includes("RESOLVED_DB_PATH"),
    `deploy-prod.sh resolves DB path into RESOLVED_DB_PATH`);
  assert(/grep[^\n]*DATABASE_PATH=/.test(deploySrc),
    `deploy-prod.sh reads DATABASE_PATH from .env.local`);

  // 4h — Fail-closed: rehydrate failure exits 1.
  if (deployCallIdx > 0) {
    const callBlock = deploySrc.slice(deployCallIdx, deployCallIdx + 1200);
    assert(/post-deploy rehydrate failed[\s\S]*?exit 1/i.test(callBlock),
      `deploy-prod.sh exits 1 on rehydrate failure`);
  }

  // 4i — Fail-closed: DB exists but script missing exits 1.
  assert(/post-deploy rehydrate script missing despite DB existing/.test(deploySrc),
    `deploy-prod.sh exits 1 when DB exists but rehydrate script missing`);

  // 4j — After rehydrate, deploy-prod.sh restarts clawnex-litellm with
  // is-active probe + fail-closed (NOT kill-TERM, per internal reviewer §4).
  const litellmRestartIdx = deploySrc.indexOf("systemctl restart clawnex-litellm", deployCallIdx);
  assert(litellmRestartIdx > 0,
    `deploy-prod.sh restarts clawnex-litellm via systemctl AFTER rehydrate`);
  if (litellmRestartIdx > 0) {
    const restartBlock = deploySrc.slice(litellmRestartIdx, litellmRestartIdx + 1000);
    assert(restartBlock.includes("exit 1"),
      `deploy-prod.sh exits 1 on litellm restart failure`);
    assert(/systemctl\s+is-active\s+--quiet\s+clawnex-litellm/.test(restartBlock),
      `deploy-prod.sh probes is-active after litellm restart`);
  }
  // 4k — No kill -TERM in the post-rehydrate restart path (internal reviewer §4: scripted
  // deploy must use systemctl, not kill-TERM, after rehydrate writes the new
  // config). The wipe-phase port-kill earlier in the script is a separate
  // concern — it stops EXISTING services before reinstalling, not restarting.
  const postRehydrateBlock = deployCallIdx > 0 ? deploySrc.slice(deployCallIdx) : "";
  const postRehydrateKillTerm = postRehydrateBlock.match(/kill\s+-TERM\b/g) || [];
  assert(postRehydrateKillTerm.length === 0,
    `deploy-prod.sh has no scripted 'kill -TERM' AFTER the rehydrate call (use systemctl restart)`);
}

// ---------------------------------------------------------------------------
// Section 4b — tsx is pinned in package.json + present in package-lock.json
// ---------------------------------------------------------------------------

console.log("\n[4b] tsx is pinned exactly in package.json + package-lock.json");
{
  const pkgPath = path.join(ROOT, "package.json");
  const pkgRaw = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(pkgRaw);
  const tsxVersion = pkg.devDependencies?.tsx ?? pkg.dependencies?.tsx;
  assert(typeof tsxVersion === "string", `tsx is listed in package.json`);
  if (typeof tsxVersion === "string") {
    assert(/^\d+\.\d+\.\d+$/.test(tsxVersion),
      `tsx version is exact-pinned (no caret/tilde, got "${tsxVersion}")`);
  }
  const lockPath = path.join(ROOT, "package-lock.json");
  const lockRaw = fs.readFileSync(lockPath, "utf-8");
  assert(lockRaw.includes(`"tsx":`),
    `tsx is present in package-lock.json (npm ci will install it)`);
}

// ---------------------------------------------------------------------------
// Section 5 — functional tests against in-memory DB (real lib, not mocks)
// ---------------------------------------------------------------------------

const tmp = path.join("/tmp", `verify-rehydrate-${Date.now()}-${process.pid}.yaml`);
function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE config_providers (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, base_url TEXT,
      api_key TEXT DEFAULT '', is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE config_models (
      model_id TEXT, provider_id TEXT
    );
  `);
  return db;
}

console.log("\n[5a] zero providers → placeholder + placeholder_only=true");
{
  const db = freshDb();
  const result = syncProvidersToYaml({ db, configPath: tmp });
  assert(result.provider_count === 0, `provider_count = 0 (got ${result.provider_count})`);
  assert(result.placeholder_only === true, `placeholder_only = true (got ${result.placeholder_only})`);
  assert(result.model_names.includes(PLACEHOLDER_MODEL_NAME), `model_names contains placeholder`);
  assert(result.wrote_config === true, `wrote_config = true`);
  assert(result.config_path === tmp, `config_path echoed back`);
  const yaml = fs.readFileSync(tmp, "utf-8");
  assert(yaml.includes(PLACEHOLDER_MODEL_NAME), `yaml on disk contains placeholder model_name`);
  db.close();
  fs.unlinkSync(tmp);
}

console.log("\n[5b] active OpenRouter provider → real entries + placeholder_only=false");
{
  const db = freshDb();
  const activeApiKey = "redaction-fixture-api-key";
  db.prepare("INSERT INTO config_providers (id,name,type,base_url,api_key,is_active) VALUES (?,?,?,?,?,?)")
    .run("p-or", "OpenRouter", "openrouter", "https://openrouter.ai/api/v1", activeApiKey, 1);
  const result = syncProvidersToYaml({ db, configPath: tmp });
  assert(result.provider_count === 1, `provider_count = 1 (got ${result.provider_count})`);
  assert(result.placeholder_only === false, `placeholder_only = false (got ${result.placeholder_only})`);
  assert(result.model_names.includes("openrouter/auto"), `model_names contains openrouter/auto`);
  assert(!result.model_names.includes(PLACEHOLDER_MODEL_NAME), `placeholder NOT in model_names`);
  // SyncResult must not leak api_key
  const resultStr = JSON.stringify(result);
  assert(!resultStr.includes(activeApiKey), `SyncResult does NOT leak api_key`);
  // Yaml on disk DOES contain api_key (litellm needs it) — verifies the write happened
  const yaml = fs.readFileSync(tmp, "utf-8");
  assert(yaml.includes("openrouter/auto"), `yaml has openrouter/auto entry`);
  assert(yaml.includes("https://openrouter.ai/api/v1"), `yaml has base_url`);
  db.close();
  fs.unlinkSync(tmp);
}

console.log("\n[5c] OpenClaw-only → still classified as no-real-providers");
{
  const db = freshDb();
  db.prepare("INSERT INTO config_providers (id,name,type,base_url,api_key,is_active) VALUES (?,?,?,?,?,?)")
    .run("openclaw", "OpenClaw Gateway", "openclaw", "ws://127.0.0.1:18789", "", 1);
  const result = syncProvidersToYaml({ db, configPath: tmp });
  assert(result.provider_count === 0, `provider_count excludes OpenClaw gateway (got ${result.provider_count})`);
  assert(result.placeholder_only === true, `placeholder_only = true when only OpenClaw exists`);
  db.close();
  fs.unlinkSync(tmp);
}

console.log("\n[5d] inactive provider → ignored");
{
  const db = freshDb();
  db.prepare("INSERT INTO config_providers (id,name,type,base_url,api_key,is_active) VALUES (?,?,?,?,?,?)")
    .run("p-disabled", "OldOpenRouter", "openrouter", "https://openrouter.ai/api/v1", "sk-disabled", 0);
  const result = syncProvidersToYaml({ db, configPath: tmp });
  assert(result.provider_count === 0, `inactive provider not counted`);
  assert(result.placeholder_only === true, `inactive provider produces placeholder-only`);
  db.close();
  fs.unlinkSync(tmp);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (failed > 0) {
  console.error(`\n${failed} assertion(s) FAILED out of ${assertions}`);
  process.exit(1);
}
console.log(`\n✅ All ${assertions} assertions passed`);
