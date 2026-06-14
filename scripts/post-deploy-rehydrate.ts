/**
 * post-deploy-rehydrate — runs as the last step of install-prod.sh after
 * the dashboard service is up and the DB has been initialized + migrated.
 * Reads providers from the preserved DB and writes a fresh config.yaml so
 * LiteLLM's next restart picks up real entries instead of the install-time
 * placeholder template.
 *
 * internal reviewer 2026-05-09 contract:
 *   - takes EXPLICIT --install-dir, --database, --config flags
 *   - never relies on process.cwd() (path-truth ambiguity caused a full
 *     day of debug 2026-05-09; never repeat that)
 *   - imports from src/lib/litellm/sync, NOT from any API route
 *   - exits 0 on success, non-zero on any failure (deploy fails closed)
 *   - prints a single machine-readable JSON object to stdout for deploy
 *     logs (no api_keys, no base_urls — only model_name list + counts)
 *
 * Run from the install dir AFTER the dashboard is active and migrations
 * have completed:
 *
 *   cd "$INSTALL_DIR"
 *   npx tsx scripts/post-deploy-rehydrate.ts \
 *     --install-dir "$INSTALL_DIR" \
 *     --database   "$INSTALL_DIR/clawnex.db" \
 *     --config     "$INSTALL_DIR/litellm/config.yaml"
 *
 * Then restart LiteLLM so it consumes the hydrated config.
 */

import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { syncProvidersToYaml, PLACEHOLDER_MODEL_NAME } from "../src/lib/litellm/sync";

interface CliArgs {
  installDir: string;
  databasePath: string;
  configPath: string;
}

function emit(obj: unknown, stream: "stdout" | "stderr" = "stdout"): void {
  const fn = stream === "stdout" ? console.log : console.error;
  fn(JSON.stringify(obj, null, 2));
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      "install-dir": { type: "string" },
      "database":    { type: "string" },
      "config":      { type: "string" },
    },
    strict: true,
  });
  const installDir = values["install-dir"];
  const databasePath = values["database"];
  const configPath = values["config"];
  if (!installDir || !databasePath || !configPath) {
    emit({
      error: "missing required flags",
      required: ["--install-dir", "--database", "--config"],
      received: { "install-dir": installDir, "database": databasePath, "config": configPath },
    }, "stderr");
    process.exit(2);
  }
  return { installDir, databasePath, configPath };
}

async function main(): Promise<void> {
  const args = parseCliArgs();

  if (!existsSync(args.databasePath)) {
    emit({ error: "database not found", database: args.databasePath }, "stderr");
    process.exit(2);
  }

  // better-sqlite3 is bundled with the dashboard; we open it directly so
  // we never rely on the dashboard's @/lib/db/index global state.
  // Dynamic import lets us run this script under tsx without the type
  // dependency forcing a transitive type-only resolution at compile.
  const { default: Database } = await import("better-sqlite3");
  let db: InstanceType<typeof Database>;
  try {
    db = new Database(args.databasePath, { readonly: false });
  } catch (e) {
    emit({ error: "database open failed", message: e instanceof Error ? e.message : String(e), database: args.databasePath }, "stderr");
    process.exit(2);
  }

  let result;
  try {
    result = syncProvidersToYaml({ db, configPath: args.configPath });
  } catch (e) {
    emit({ error: "sync failed", message: e instanceof Error ? e.message : String(e), config: args.configPath }, "stderr");
    db.close();
    process.exit(2);
  } finally {
    try { db.close(); } catch { /* swallow close errors after sync threw */ }
  }

  // Fail-closed validation: deploy should not silently produce a placeholder-
  // only config when the DB has real (non-OpenClaw) providers. the reviewer's
  // acceptance: "no placeholder-only config when real providers exist".
  if (result.provider_count > 0 && result.placeholder_only) {
    emit({
      error: "rehydration produced placeholder-only config despite providers in DB",
      provider_count: result.provider_count,
      placeholder_only: result.placeholder_only,
      config_path: result.config_path,
      model_names: result.model_names,
    }, "stderr");
    process.exit(2);
  }

  emit({
    ok: true,
    provider_count: result.provider_count,
    wrote_config: result.wrote_config,
    config_path: result.config_path,
    placeholder_only: result.placeholder_only,
    model_names: result.model_names,
    placeholder_token: PLACEHOLDER_MODEL_NAME,
  });
}

main().catch((e) => {
  emit({ error: "unexpected failure", message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined }, "stderr");
  process.exit(2);
});
