#!/usr/bin/env tsx
/**
 * Verifies selective connector routing primitives:
 * - OpenClaw provider/model inventory discovery
 * - operator model selection
 * - provider-level OpenClaw apply + revert without storing secrets
 * - Hermes config-backed custom provider apply + revert without storing secrets
 * - Hermes watcher-only read-only capability enforcement
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawnex-routing-"));
const openclawHome = path.join(root, ".openclaw");
const hermesHome = path.join(root, ".hermes");
fs.mkdirSync(openclawHome, { recursive: true });
fs.mkdirSync(hermesHome, { recursive: true });
process.env.OPENCLAW_HOME = openclawHome;
process.env.HERMES_HOME = hermesHome;
process.env.DATABASE_PATH = path.join(root, "clawnex.db");
process.env.CLAWNEX_TEST_SKIP_DB_SEED = "1";
process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR = path.join(root, ".clawnex-selective-routing-managed.json");
process.env.CLAWNEX_HERMES_ROUTING_SIDECAR = path.join(root, ".clawnex-hermes-routing-managed.json");
process.env.LITELLM_PORT = "4001";

const openclawConfigPath = path.join(openclawHome, "openclaw.json");
const originalOpenRouterKey = "sk-or-test-do-not-print";
fs.writeFileSync(openclawConfigPath, JSON.stringify({
  meta: { lastTouchedVersion: "2026.6.11", lastTouchedAt: "2026-07-02T00:00:00.000Z" },
  models: {
    providers: {
      openrouter: {
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: originalOpenRouterKey,
        api: "openai-completions",
        models: [
          { id: "openrouter/auto", name: "OpenRouter Auto" },
          { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
        ],
      },
      google: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        apiKey: "google-test-key",
        models: [{ id: "gemini-3-pro", name: "Gemini 3 Pro" }],
      },
      litellm: {
        baseUrl: "http://127.0.0.1:4001/v1",
        apiKey: "clawnex-routed",
        models: [],
      },
    },
  },
  agents: { defaults: { model: { primary: "openrouter/auto" } }, list: [] },
}, null, 2), { mode: 0o600 });

const hermesConfigPath = path.join(hermesHome, "config.yaml");
fs.writeFileSync(hermesConfigPath, YAML.stringify({
  model: {
    default: "moonshotai/kimi-k2",
    provider: "kimi",
  },
  custom_providers: [
    {
      name: "kimi",
      base_url: "https://integrate.api.nvidia.com/v1",
      api_mode: "chat_completions",
    },
    {
      name: "agent-main",
      base_url: "http://127.0.0.1:4001/v1",
      key_env: "LITELLM_MASTER_KEY",
      api_mode: "chat_completions",
    },
  ],
}), { mode: 0o600 });

async function main(): Promise<void> {
  const svc = await import("../src/lib/services/connector-routing-inventory");
  const db = await import("../src/lib/db/index");
  const scanner = await import("../src/lib/services/permissiveness/scanners/openclaw");

  let inventory = svc.syncConnectorRoutingInventory();
  assert(inventory.openclaw.status === "ok", "OpenClaw inventory sync succeeds");
  assert(inventory.openclaw.items.some((item) => item.providerId === "openrouter" && item.itemType === "provider"), "OpenRouter provider discovered");
  assert(inventory.openclaw.items.some((item) => item.providerId === "openrouter" && item.modelId === "openrouter/auto"), "OpenRouter model discovered");
  const litellmProvider = inventory.openclaw.items.find((item) => item.providerId === "litellm" && item.currentRoute === "routed");
  assert(litellmProvider, "LiteLLM provider classified as routed");
  assert(inventory.openclaw.selected === 0, "LiteLLM proxy bridge is excluded from selectable route counts");
  let litellmRejected = false;
  try {
    svc.setConnectorRoutingSelections("openclaw", [litellmProvider!.id], "direct");
  } catch {
    litellmRejected = true;
  }
  assert(litellmRejected, "LiteLLM proxy bridge selection is rejected");
  assert(svc.classifyConnectorRoute("http://[::1]:4001/v1") === "routed", "IPv6 localhost LiteLLM URLs classify as routed");
  const posture = scanner.scanOpenClaw();
  assert(posture.routingByModelPrefix.openrouter === "direct", "OpenClaw posture scanner supports object-style provider maps");
  assert(posture.routingByModelPrefix.litellm === "routed", "OpenClaw posture scanner classifies routed providers from object maps");

  const autoModel = inventory.openclaw.items.find((item) => item.providerId === "openrouter" && item.modelId === "openrouter/auto");
  assert(autoModel, "OpenRouter auto model available for selection");
  const selectedOpenRouter = svc.setConnectorRoutingSelections("openclaw", [autoModel!.id], "routed");
  assert(selectedOpenRouter.selected === 1, "Selected route count only includes routable upstream choices");

  const applied = svc.applyOpenClawDesiredRouting();
  assert(applied.ok && applied.status === "applied", "OpenClaw selected routing applies");
  assert(applied.routedProviders.includes("openrouter"), "Selecting a model routes its OpenClaw provider");

  let cfg = JSON.parse(fs.readFileSync(openclawConfigPath, "utf8"));
  assert(cfg.models.providers.openrouter.baseUrl === "http://127.0.0.1:4001/v1", "OpenRouter baseUrl routed through LiteLLM");
  assert(cfg.models.providers.openrouter.apiKey === originalOpenRouterKey, "OpenRouter apiKey preserved, not copied into sidecar");
  const sidecarRaw = fs.readFileSync(process.env.CLAWNEX_SELECTIVE_ROUTING_SIDECAR!, "utf8");
  assert(!sidecarRaw.includes(originalOpenRouterKey), "Selective routing sidecar does not store provider API keys");

  inventory = svc.syncConnectorRoutingInventory();
  const routedAutoModel = inventory.openclaw.items.find((item) => item.providerId === "openrouter" && item.modelId === "openrouter/auto");
  assert(routedAutoModel?.currentRoute === "routed", "Selected model reflects routed provider state after apply");
  svc.setConnectorRoutingSelections("openclaw", [routedAutoModel!.id], "direct");
  const restored = svc.applyOpenClawDesiredRouting();
  assert(restored.ok && restored.restoredProviders.includes("openrouter"), "Unselecting restores original OpenClaw provider baseUrl");
  cfg = JSON.parse(fs.readFileSync(openclawConfigPath, "utf8"));
  assert(cfg.models.providers.openrouter.baseUrl === "https://openrouter.ai/api/v1", "OpenRouter baseUrl restored");

  inventory = svc.syncConnectorRoutingInventory();
  assert(inventory.hermes.status === "ok", "Hermes config-backed inventory sync succeeds");
  const kimiProvider = inventory.hermes.items.find((item) => item.connector === "hermes" && item.providerId === "kimi" && item.itemType === "provider");
  assert(kimiProvider?.capability === "provider-routing", "Hermes custom provider is routable");
  assert(kimiProvider?.currentRoute === "direct", "Hermes direct custom provider is classified as direct");
  const kimiModel = inventory.hermes.items.find((item) => item.connector === "hermes" && item.providerId === "kimi" && item.modelId === "moonshotai/kimi-k2");
  assert(kimiModel?.capability === "model-inventory", "Hermes model backed by custom provider is selectable inventory");

  svc.setConnectorRoutingSelections("hermes", [kimiModel!.id], "routed");
  const hermesApplied = svc.applyHermesDesiredRouting();
  assert(hermesApplied.ok && hermesApplied.status === "applied", "Hermes selected routing applies");
  assert(hermesApplied.routedProviders.includes("kimi"), "Selecting a Hermes model routes its custom provider");
  let hermesCfg = YAML.parse(fs.readFileSync(hermesConfigPath, "utf8")) as { custom_providers: Array<Record<string, unknown>> };
  const routedKimi = hermesCfg.custom_providers.find((provider) => provider.name === "kimi");
  assert(routedKimi?.base_url === "http://127.0.0.1:4001/v1", "Hermes custom provider base_url routed through LiteLLM");
  assert(routedKimi?.key_env === "LITELLM_MASTER_KEY", "Hermes routed provider uses LiteLLM master key env reference");
  const hermesSidecarRaw = fs.readFileSync(process.env.CLAWNEX_HERMES_ROUTING_SIDECAR!, "utf8");
  assert(!hermesSidecarRaw.includes("sk-"), "Hermes routing sidecar does not store API key material");

  const hermesExplicitRevert = svc.revertHermesRouting();
  assert(hermesExplicitRevert.ok && hermesExplicitRevert.restoredProviders.includes("kimi"), "Explicit Hermes wire revert restores managed provider");
  hermesCfg = YAML.parse(fs.readFileSync(hermesConfigPath, "utf8")) as { custom_providers: Array<Record<string, unknown>> };
  const explicitlyRevertedKimi = hermesCfg.custom_providers.find((provider) => provider.name === "kimi");
  assert(explicitlyRevertedKimi?.base_url === "https://integrate.api.nvidia.com/v1", "Explicit Hermes revert restores custom provider base_url");
  assert(explicitlyRevertedKimi?.key_env === undefined, "Explicit Hermes revert removes ClawNex-added key_env");
  assert(!fs.existsSync(process.env.CLAWNEX_HERMES_ROUTING_SIDECAR!), "Explicit Hermes revert removes empty sidecar");

  inventory = svc.syncConnectorRoutingInventory();
  const rerouteKimiModel = inventory.hermes.items.find((item) => item.connector === "hermes" && item.providerId === "kimi" && item.modelId === "moonshotai/kimi-k2");
  svc.setConnectorRoutingSelections("hermes", [rerouteKimiModel!.id], "routed");
  const hermesReapplied = svc.applyHermesDesiredRouting();
  assert(hermesReapplied.ok && hermesReapplied.routedProviders.includes("kimi"), "Hermes can be re-saved after explicit revert");

  inventory = svc.syncConnectorRoutingInventory();
  const routedKimiModel = inventory.hermes.items.find((item) => item.connector === "hermes" && item.providerId === "kimi" && item.modelId === "moonshotai/kimi-k2");
  assert(routedKimiModel?.currentRoute === "routed", "Hermes selected model reflects routed provider state after apply");
  svc.setConnectorRoutingSelections("hermes", [routedKimiModel!.id], "direct");
  const hermesRestored = svc.applyHermesDesiredRouting();
  assert(hermesRestored.ok && hermesRestored.restoredProviders.includes("kimi"), "Unselecting restores original Hermes custom provider base_url");
  hermesCfg = YAML.parse(fs.readFileSync(hermesConfigPath, "utf8")) as { custom_providers: Array<Record<string, unknown>> };
  const restoredKimi = hermesCfg.custom_providers.find((provider) => provider.name === "kimi");
  assert(restoredKimi?.base_url === "https://integrate.api.nvidia.com/v1", "Hermes custom provider base_url restored");
  assert(restoredKimi?.key_env === undefined, "Hermes key_env removed when it was not originally present");

  db.run(
    `INSERT INTO hermes_events (id, source_id, message_id, model, content_hash, observed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ["h1", "hermes-local", 1, "openai/gpt-5.4", "hash-only", new Date().toISOString()],
  );
  inventory = svc.syncConnectorRoutingInventory();
  const hermesModel = inventory.hermes.items.find((item) => item.connector === "hermes" && item.modelId === "openai/gpt-5.4");
  assert(hermesModel?.capability === "read-only", "Hermes observed model is read-only");
  let hermesRejected = false;
  try {
    svc.setConnectorRoutingSelections("hermes", [hermesModel!.id], "routed");
  } catch {
    hermesRejected = true;
  }
  assert(hermesRejected, "Hermes watcher-only routed selection is rejected");

  console.log("Connector routing inventory verification complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
