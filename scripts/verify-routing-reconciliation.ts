import assert from "node:assert/strict";
import {
  normalizeRoutingItem,
  stableRoutingFingerprint,
} from "@/lib/services/routing-reconciliation";
import { splitObservedHermesModel } from "@/lib/services/connector-routing-inventory";
import type { ConnectorRoutingItem } from "@/lib/services/connector-routing-inventory";

const item: ConnectorRoutingItem = {
  id: "test-item",
  connector: "hermes",
  sourceId: "hermes-local",
  itemType: "model",
  providerId: "openrouter",
  modelId: "deepseek/deepseek-v4-flash-0731",
  displayName: "DeepSeek V4 Flash",
  baseUrl: "https://user:secret@example.test/v1?api_key=do-not-store",
  capability: "model-inventory",
  currentRoute: "routed",
  desiredRoute: "routed",
  present: true,
  fingerprint: "source-fingerprint",
  metadata: { keyEnvConfigured: "OPENROUTER_API_KEY", apiKey: "must-not-escape", profileName: "default" },
  firstSeenAt: "2026-08-04T00:00:00.000Z",
  lastSeenAt: "2026-08-04T00:00:00.000Z",
  lastChangedAt: null,
  updatedAt: "2026-08-04T00:00:00.000Z",
};

const normalized = normalizeRoutingItem(item);
assert.equal(normalized.endpoint, "https://example.test/v1");
assert.equal(normalized.credentialReferenceType, "environment-reference");
assert.equal(normalized.profileName, "default");
assert.equal(JSON.stringify(normalized).includes("secret"), false);
assert.equal(JSON.stringify(normalized).includes("api_key"), false);
assert.equal(stableRoutingFingerprint(normalized), stableRoutingFingerprint({ ...normalized }));
assert.notEqual(stableRoutingFingerprint(normalized), stableRoutingFingerprint({ ...normalized, effectiveRoute: "direct" }));
assert.notEqual(stableRoutingFingerprint(normalized), stableRoutingFingerprint({ ...normalized, profileName: "hugo-wynter" }));

const observed = splitObservedHermesModel("openrouter/deepseek/deepseek-v4-flash-0731");
assert.deepEqual(observed, { providerId: "openrouter", modelId: "deepseek/deepseek-v4-flash-0731" });
assert.deepEqual(splitObservedHermesModel("deepseek/deepseek-v4-flash-0731"), { providerId: "deepseek", modelId: "deepseek-v4-flash-0731" });

console.log("routing reconciliation contract: PASS");
