#!/usr/bin/env tsx
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { findHermesModelCredential } from "../src/lib/services/hermes-routing-credentials";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawnex-hermes-credentials-"));
const home = path.join(root, ".hermes");
const configPath = path.join(home, "config.yaml");
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(home, ".env"), "OPENROUTER_API_KEY=sk-test-hermes-key\n", { mode: 0o600 });
fs.writeFileSync(configPath, YAML.stringify({
  model: { default: "deepseek/deepseek-v4", provider: "openrouter", key_env: "OPENROUTER_API_KEY" },
  custom_providers: [{ name: "oauth-provider", base_url: "https://example.invalid/v1", oauth_provider: "example" }],
}), { mode: 0o600 });

const environment = findHermesModelCredential({ configPath, providerId: "openrouter", primaryModel: true });
assert(environment.preview.source === "environment", "environment-backed Hermes credential is classified correctly");
assert(environment.value === "sk-test-hermes-key", "server-side credential resolution reads the local Hermes environment");
assert(environment.preview.masked !== "sk-test-hermes-key", "credential preview is masked");
assert(environment.preview.last4 === "-key", "credential preview exposes only the last four characters");
assert(!JSON.stringify(environment.preview).includes("sk-test-hermes-key"), "credential preview never contains plaintext");

const oauth = findHermesModelCredential({ configPath, providerId: "oauth-provider" });
assert(oauth.preview.source === "oauth", "OAuth-backed Hermes credential is identified");
assert(oauth.value === null, "OAuth credentials are not copied into ClawNex automatically");

console.log("Hermes credential discovery contract: PASS");
