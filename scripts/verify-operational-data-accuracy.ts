#!/usr/bin/env tsx
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { derived, measured, nonNegative, notApplicable, unavailable } from "../src/lib/telemetry/value";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const fresh = measured(4, "collector", { observedAt: new Date().toISOString(), staleAfterMs: 60_000 });
assert.equal(fresh.state, "measured");
assert.equal(fresh.value, 4);

const oldTimestamp = new Date(Date.now() - 120_000).toISOString();
const stale = measured(4, "collector", { observedAt: oldTimestamp, staleAfterMs: 60_000 });
assert.equal(stale.state, "stale");
assert.equal(stale.value, 4);

const staleDerived = derived(9, "database", { observedAt: oldTimestamp, staleAfterMs: 60_000 });
assert.equal(staleDerived.state, "stale");

assert.deepEqual(unavailable<number>("latency", "No samples"), {
  value: null,
  state: "unavailable",
  source: "latency",
  observedAt: null,
  staleAfterMs: null,
  reason: "No samples",
});
assert.equal(notApplicable<number>("hermes", "Not collected").state, "not_applicable");
assert.equal(nonNegative(-1), null);
assert.equal(nonNegative(Number.NaN), null);
assert.equal(nonNegative("2.5"), 2.5);

const missionData = read("src/components/dashboard/panels/mission-control/data-hooks.ts");
assert.doesNotMatch(missionData, /coreRules:\s*163\b/, "policy coverage must come from the actual rule set");
assert.doesNotMatch(missionData, /last_seen_ms_ago\s*\?\?\s*0/, "missing collector timestamps must not become fresh zeroes");

const infrastructure = read("src/app/api/infrastructure/route.ts");
assert.doesNotMatch(infrastructure, /return\s+["'](?:WS|HTTP|state\.db)["']/, "transport labels must not be reported as versions");
assert.match(infrastructure, /proxy_traffic[\s\S]*session-watcher/, "OpenClaw ingestion must use the traffic stream");

const infrastructurePanel = read("src/components/dashboard/panels/InfrastructurePanel.tsx");
assert.match(infrastructurePanel, /Transport:\s*\{s\.transport\}/, "Infrastructure must render transport metadata");
assert.match(infrastructurePanel, /s\.ingestion_summary/, "Infrastructure must render ingestion evidence");

const tokenPanel = read("src/components/dashboard/panels/TokenCostPanel.tsx");
assert.doesNotMatch(tokenPanel, /const total = t\?\.totalUsd \?\? 0/, "missing cost totals must not become measured zeroes");
assert.match(tokenPanel, /No cost observations/, "Token Intel must explain unavailable cost totals");

const fleet = read("src/app/api/fleet/route.ts");
assert.match(fleet, /telemetry:/, "fleet responses must expose telemetry provenance");
assert.match(fleet, /storedSessions/, "stored and active sessions must remain distinct");

console.log("verify-operational-data-accuracy: PASS");
