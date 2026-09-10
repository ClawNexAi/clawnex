import assert from "node:assert/strict";
import {
  buildLaunchdRestartActions,
  selectLaunchdRestartTargets,
} from "../src/lib/services/hermes-gateway-control";

const plistPath = "/Users/operator/Library/LaunchAgents/ai.hermes.gateway-idle.plist";
const actions = buildLaunchdRestartActions({
  label: "ai.hermes.gateway-idle",
  plistPath,
  loaded: true,
  running: false,
}, 501);

assert.deepEqual(actions, [
  ["bootout", "gui/501", plistPath],
  ["bootstrap", "gui/501", plistPath],
  ["kickstart", "-k", "gui/501/ai.hermes.gateway-idle"],
]);

assert.ok(
  !actions.some((args) => args[0] === "bootout" && args[1]?.endsWith("/ai.hermes.gateway-idle")),
  "a loaded but idle job must be unloaded by plist path, not service target",
);

const selected = selectLaunchdRestartTargets([
  { label: "ai.hermes.gateway", loaded: true, running: true },
  { label: "ai.hermes.gateway-hugo-wynter", loaded: true, running: false },
]);
assert.deepEqual(
  selected.map((target) => target.label),
  ["ai.hermes.gateway"],
  "restart must not activate a dormant Hermes profile when another gateway is running",
);

console.log("Hermes gateway launchd restart contract verified.");
