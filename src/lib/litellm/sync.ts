/**
 * LiteLLM provider → config.yaml sync — canonical library implementation.
 *
 * internal reviewer 2026-05-09 architecture: deploy scripts and API routes both import
 * from this module. Logic does NOT live in the route file (route is just
 * an HTTP wrapper). The post-deploy rehydrate script (scripts/post-deploy-
 * rehydrate.ts) and the in-process provider-save handler use the same
 * function with explicit, testable inputs.
 *
 * Design rules:
 *   - Caller provides the Database instance — module never imports the
 *     global @/lib/db/index. This lets the deploy-time script open the
 *     DB at any path and the route pass its singleton.
 *   - Caller provides the config path — module never resolves it from
 *     process.cwd(). Path-truth ambiguity caused a full day of debug on
 *     2026-05-09; never repeat that.
 *   - Result shape is machine-readable: provider_count + wrote_config +
 *     placeholder_only + redacted model_names. No api_keys leak through
 *     the return value (they ARE written into the YAML on disk because
 *     LiteLLM needs them, but never surfaced to logs/stdout).
 */

import * as fs from "node:fs";
import type Database from "better-sqlite3";

/**
 * Canonical placeholder model name. Matches litellm/config.template.yaml
 * verbatim. The dashboard's checkLiteLLM filter (src/lib/health/litellm-
 * check.ts) matches both the bare form and the prefixed form
 * "openai/no-provider-configured" via endsWith.
 */
export const PLACEHOLDER_MODEL_NAME = "no-provider-configured";

export interface SyncOptions {
  /** Open better-sqlite3 Database instance. Caller owns lifecycle (open + close). */
  db: Database.Database;
  /** Absolute path to the LiteLLM config.yaml the caller wants written. */
  configPath: string;
}

export interface SyncResult {
  /** Active providers excluding OpenClaw gateway and ws:// targets. */
  provider_count: number;
  /** True when config.yaml was successfully written to disk. */
  wrote_config: boolean;
  /** Resolved config path actually written. Same value as opts.configPath. */
  config_path: string;
  /** True when the resulting model_list is the placeholder block only. */
  placeholder_only: boolean;
  /**
   * Redacted list of model_name strings written to the YAML. Never
   * contains api_keys, base_urls, or any secret material. Safe to log.
   */
  model_names: string[];
}

interface DbProvider {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  is_active: number;
}

interface DbModel {
  model_id: string;
  provider_id: string;
}

/**
 * Strict YAML-value validator. Rejects characters that could break out
 * of a quoted YAML string (quote, newline, CR, backslash) and caps length.
 * Caught a real injection vector during pre-OSS hardening.
 */
function assertSafeYamlValue(s: unknown, field: string): string {
  if (typeof s !== "string") throw new Error(`${field} must be a string`);
  if (/["\n\r\\]/.test(s)) throw new Error(`${field} contains invalid characters`);
  if (s.length > 512) throw new Error(`${field} too long`);
  return s;
}

function modelPrefixForProviderType(providerType: string): string {
  const t = providerType.toLowerCase();
  if (t.includes("openrouter")) return "openrouter";
  if (t.includes("anthropic") || t.includes("claude")) return "anthropic";
  if (t.includes("nvidia") || t === "nim") return "nvidia_nim";
  if (t.includes("openai") || t.includes("gpt")) return "openai";
  if (t.includes("lmstudio") || t.includes("lm-studio") || t.includes("ollama") || t.includes("local")) return "openai";
  return "openai";
}

function litellmModelForConfiguredModel(providerType: string, modelId: string): string {
  const prefix = modelPrefixForProviderType(providerType);
  if (modelId.startsWith(`${prefix}/`)) return modelId;
  return `${prefix}/${modelId}`;
}

/**
 * Render the labeled "no provider configured" placeholder block. Matches
 * litellm/config.template.yaml verbatim so the file shape is identical
 * whether produced by the template ship-step or this auto-sync.
 */
function placeholderModelEntry(): string {
  return [
    `  - model_name: "${PLACEHOLDER_MODEL_NAME}"`,
    `    litellm_params:`,
    `      model: "openai/${PLACEHOLDER_MODEL_NAME}"`,
    `      api_key: "placeholder-no-key"`,
  ].join("\n");
}

export function syncProvidersToYaml(opts: SyncOptions): SyncResult {
  const { db, configPath } = opts;

  const providers = db
    .prepare(
      "SELECT id, name, type, base_url, api_key, is_active FROM config_providers WHERE is_active = 1",
    )
    .all() as DbProvider[];

  // provider_count is the count of active NON-OpenClaw providers — the reviewer's
  // semantic so the deploy-step's "no placeholder-only config when DB has
  // active non-OpenClaw providers" assertion has a number to compare against.
  let realProviderCount = 0;
  for (const p of providers) {
    const t = (p.type || "").toLowerCase();
    if (t === "openclaw") continue;
    if (p.base_url.startsWith("ws://") || p.base_url.startsWith("wss://")) continue;
    if (!p.base_url && !p.api_key) continue;
    realProviderCount++;
  }

  const modelEntries: string[] = [];
  const modelNames: string[] = [];

  for (const p of providers) {
    if (!p.base_url && !p.api_key) continue;

    const t = (p.type || "").toLowerCase();
    if (t === "openclaw" || p.base_url.startsWith("ws://") || p.base_url.startsWith("wss://")) continue;

    try {
      if (p.base_url) assertSafeYamlValue(p.base_url, `provider[${p.id}].base_url`);
      if (p.api_key) assertSafeYamlValue(p.api_key, `provider[${p.id}].api_key`);
    } catch (err) {
      console.error(`[LiteLLM Sync] Skipping provider ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const modelPrefix = modelPrefixForProviderType(t);

    const safeName = p.name.toLowerCase().replace(/[^a-z0-9_/-]/g, "-");
    const modelName = t.includes("openrouter") ? "openrouter/auto" : safeName;
    const wildcardName = t.includes("openrouter") ? "openrouter/*" : `${safeName}/*`;

    const entry = [
      `  - model_name: "${modelName}"`,
      `    litellm_params:`,
      `      model: "${modelPrefix}/${t.includes("openrouter") ? "auto" : "*"}"`,
    ];
    if (p.base_url) entry.push(`      api_base: "${p.base_url}"`);
    if (p.api_key) entry.push(`      api_key: "${p.api_key}"`);

    modelEntries.push(entry.join("\n"));
    modelNames.push(modelName);

    if (!t.includes("openrouter") && modelName !== wildcardName) {
      const wcEntry = [
        `  - model_name: "${wildcardName}"`,
        `    litellm_params:`,
        `      model: "${modelPrefix}/*"`,
      ];
      if (p.base_url) wcEntry.push(`      api_base: "${p.base_url}"`);
      if (p.api_key) wcEntry.push(`      api_key: "${p.api_key}"`);
      modelEntries.push(wcEntry.join("\n"));
      modelNames.push(wildcardName);
    } else if (t.includes("openrouter")) {
      const wcEntry = [
        `  - model_name: "${wildcardName}"`,
        `    litellm_params:`,
        `      model: "openrouter/*"`,
      ];
      if (p.api_key) wcEntry.push(`      api_key: "${p.api_key}"`);
      modelEntries.push(wcEntry.join("\n"));
      modelNames.push(wildcardName);
    }
  }

  const configuredModels = db
    .prepare(
      "SELECT m.model_id, m.provider_id FROM config_models m JOIN config_providers p ON m.provider_id = p.id WHERE p.is_active = 1",
    )
    .all() as DbModel[];

  for (const m of configuredModels) {
    const provider = providers.find((p) => p.id === m.provider_id);
    if (!provider) continue;
    const t = (provider.type || "").toLowerCase();
    if (t === "openclaw" || provider.base_url.startsWith("ws://") || provider.base_url.startsWith("wss://")) continue;

    try {
      assertSafeYamlValue(m.model_id, `model[${m.model_id}].model_id`);
      if (provider.base_url) assertSafeYamlValue(provider.base_url, `provider[${provider.id}].base_url`);
      if (provider.api_key) assertSafeYamlValue(provider.api_key, `provider[${provider.id}].api_key`);
    } catch (err) {
      console.error(`[LiteLLM Sync] Skipping model ${m.model_id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const safeName = provider.name.toLowerCase().replace(/[^a-z0-9_/-]/g, "-");
    if (m.model_id.startsWith(safeName + "/") || m.model_id === safeName) continue;

    const entry = [
      `  - model_name: "${m.model_id}"`,
      `    litellm_params:`,
      `      model: "${litellmModelForConfiguredModel(t, m.model_id)}"`,
    ];
    if (provider.base_url) entry.push(`      api_base: "${provider.base_url}"`);
    if (provider.api_key) entry.push(`      api_key: "${provider.api_key}"`);
    else entry.push(`      api_key: "not-needed"`);

    modelEntries.push(entry.join("\n"));
    modelNames.push(m.model_id);
  }

  // Emit the labeled placeholder when no real model entries exist. LiteLLM
  // requires at least one model_list entry; the placeholder satisfies that
  // and the dashboard's checkLiteLLM filter recognizes it as not_configured.
  let placeholder_only = false;
  if (modelEntries.length === 0) {
    modelEntries.push(placeholderModelEntry());
    modelNames.push(PLACEHOLDER_MODEL_NAME);
    placeholder_only = true;
  }

  const yamlContent = [
    "# ClawNex LiteLLM Proxy Configuration",
    "# Auto-generated from Configuration panel providers + models",
    `# Updated: ${new Date().toISOString()}`,
    "# Version: litellm==1.83.0 (PINNED)",
    "",
    "model_list:",
    modelEntries.join("\n\n"),
    "",
    "# ClawNex Shield Logger — scans all traffic",
    "litellm_settings:",
    "  callbacks: [\"clawnex_logger.ClawNexLogger\"]",
    "  drop_params: true",
    "  request_timeout: 120",
    "",
    "general_settings:",
    "  master_key: null",
    "",
  ].join("\n");

  fs.writeFileSync(configPath, yamlContent, "utf-8");

  return {
    provider_count: realProviderCount,
    wrote_config: true,
    config_path: configPath,
    placeholder_only,
    model_names: modelNames,
  };
}
