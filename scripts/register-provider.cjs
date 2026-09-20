#!/usr/bin/env node
/**
 * register-provider.cjs — insert a model provider into clawnex.db
 *
 * Called by setup.sh after the dashboard has come up and initialized the
 * schema. Closes the gap where step 6 of setup.sh would write the API key
 * into litellm/config.yaml (so the proxy uses it) but never register the
 * provider in the dashboard's config_providers table — leaving the
 * Configuration → Model Providers UI looking empty until the operator
 * manually re-entered the same key.
 *
 * Usage (via env vars to avoid arg-parsing complexity in shell):
 *   PROVIDER_NAME=OpenRouter \
 *   PROVIDER_TYPE=openrouter \
 *   PROVIDER_BASE_URL=https://openrouter.ai/api/v1 \
 *   PROVIDER_API_KEY=sk-or-... \
 *   PROVIDER_MODEL_ID=openrouter/auto \
 *   node scripts/register-provider.cjs
 *
 * Mirrors src/lib/services/config-service.ts addProvider():
 *   - same INSERT shape (id, name, type, base_url, api_key, is_default=0, is_active=1)
 *   - no automatic models; PROVIDER_MODEL_ID is an explicit operator selection
 * If the provider already exists (by type+name), this is a no-op so the
 * script is idempotent across re-runs.
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const projectRoot = path.join(__dirname, "..");

// DB resolution mirrors src/lib/db/index.ts: prefer existing sentinel.db for
// backward-compat with pre-rebrand installs, otherwise default to clawnex.db.
let dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
    const legacy = path.join(projectRoot, "sentinel.db");
    const current = path.join(projectRoot, "clawnex.db");
    dbPath = fs.existsSync(legacy) ? legacy : current;
}

const name = process.env.PROVIDER_NAME;
const type = process.env.PROVIDER_TYPE;
const baseUrl = process.env.PROVIDER_BASE_URL;
const apiKey = process.env.PROVIDER_API_KEY || "";
const modelId = (process.env.PROVIDER_MODEL_ID || "").trim();

if (!name || !type || !baseUrl) {
    console.error("register-provider: missing required env (PROVIDER_NAME, PROVIDER_TYPE, PROVIDER_BASE_URL)");
    process.exit(1);
}

if (!fs.existsSync(dbPath)) {
    console.error(`register-provider: database not found at ${dbPath}`);
    console.error("  The dashboard must start at least once to initialize the schema.");
    process.exit(1);
}

const db = new Database(dbPath);
try {
    db.pragma("journal_mode = WAL");

    // Idempotent: skip if a provider with the same type+name already exists.
    // Different name or different type → distinct provider; we won't dedupe
    // across those.
    const existing = db.prepare(
        "SELECT id FROM config_providers WHERE type = ? AND name = ?",
    ).get(type, name);
    if (existing) {
        console.log(`  → ${name} already registered (id ${existing.id}) — skipping`);
        process.exit(0);
    }

    // ID format matches addProvider() in config-service.ts
    const id = `provider-${Date.now()}`;

    db.prepare(
        `INSERT INTO config_providers (id, name, type, base_url, api_key, is_default, is_active)
         VALUES (?, ?, ?, ?, ?, 0, 1)`,
    ).run(id, name, type, baseUrl, apiKey);

    if (modelId) {
        db.prepare(
            `INSERT OR IGNORE INTO config_models (id, provider_id, model_id, name, is_default, context_window)
             VALUES (?, ?, ?, ?, 1, 128000)`,
        ).run(`${id}::${modelId}`, id, modelId, modelId);
    }

    console.log(`  ✓ Registered ${name} (${type}) — id ${id}`);
} finally {
    db.close();
}
