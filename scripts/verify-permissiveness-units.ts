/**
 * Module-level verification for the permissiveness library.
 *
 * Run: npx tsx scripts/verify-permissiveness-units.ts
 *
 * Exits 0 if all assertions PASS, 1 if any FAIL. Prints one line per assertion
 * with a ✓/✗ prefix and a description. Accumulates failures and reports at end.
 *
 * Purpose: this repo has no Jest/Vitest. This script is the module-level
 * regression surface until that changes.
 */

import {
  computeEdgeScore,
  aggregateMax,
  extractDrivers,
  MIN_CONFIDENCE,
  reduceConfidence,
  AUDIENCE_FACTOR,
  ALLOWLIST_FACTOR,
  MAX_RAW,
} from "../src/lib/services/permissiveness/scoring";
import {
  hashToken,
  classifyBotIdentity,
} from "../src/lib/services/permissiveness/token-matching";
import {
  evaluateAllCombos,
  evaluateCombo,
  DANGEROUS_COMBOS,
  findCombo,
} from "../src/lib/services/permissiveness/dangerous-combos";
import {
  evaluateLints,
  POSTURE_LINT_RULES,
} from "../src/lib/services/permissiveness/posture-lints";
import { scanOpenClaw } from "../src/lib/services/permissiveness/scanners/openclaw";
import {
  scanHermes,
  scanProfileSkills,
  extractToolsFromSkillBody,
  KNOWN_TOOL_NEEDLES,
} from "../src/lib/services/permissiveness/scanners/hermes";
import { scanRuntimeSurfaces, runtimeSurfaceSeed } from "../src/lib/services/permissiveness/scanners/runtime-surfaces";
import { getCached, setCached, clearCache, DEFAULT_TTL_MS } from "../src/lib/services/permissiveness/cache";
import { scan } from "../src/lib/services/permissiveness";
import type { PermissivenessReport } from "../src/lib/services/permissiveness/types";
import type {
  PermissionPosture,
  PostureValue,
  Provenance,
  Surface,
  TokenIdentity,
} from "../src/lib/services/permissiveness/types";

type Status = { pass: number; fail: number };
const status: Status = { pass: 0, fail: 0 };

function assert(cond: unknown, desc: string) {
  if (cond) {
    status.pass++;
    console.log(`  ✓ ${desc}`);
  } else {
    status.fail++;
    console.log(`  ✗ ${desc}`);
  }
}

function section(name: string) {
  console.log(`\n[${name}]`);
}

// ---------- Scoring ----------

section("scoring: factor tables are complete");
const audienceKeys = Object.keys(AUDIENCE_FACTOR);
assert(audienceKeys.length === 9, `AUDIENCE_FACTOR has 9 keys (got ${audienceKeys.length})`);
const allowlistKeys = Object.keys(ALLOWLIST_FACTOR);
assert(allowlistKeys.length === 6, `ALLOWLIST_FACTOR has 6 keys (got ${allowlistKeys.length})`);

section("scoring: MAX_RAW is the documented worst case (1433.25)");
assert(MAX_RAW === 5 * 3.5 * 1.5 * 1.3 * 42, `MAX_RAW === 1433.25 (got ${MAX_RAW})`);

section("scoring: lowest-risk edge renders 'minimal' band");
const low = computeEdgeScore({
  audience: "private_dm",
  allowlist: "enforcing_tight",
  containment: "sandboxed",
  routing: "routed",
  toolRisks: [],
  triggeredCombos: 0,
  triggeredLints: 0,
  confidences: {
    audience: "verified_config",
    allowlist: "verified_config",
    containment: "verified_config",
    routing: "verified_config",
    tools: "verified_config",
    combos: "verified_config",
    lints: "verified_config",
  },
});
assert(low.numeric === 0, `zero-tool edge numeric=0 (got ${low.numeric})`);
assert(low.band === "minimal", `zero-tool edge band='minimal' (got '${low.band}')`);
assert(low.confidence === "verified_config", `all-verified_config → confidence='verified_config' (got '${low.confidence}')`);

section("scoring: worst-case edge renders 'critical' band");
const high = computeEdgeScore({
  audience: "public",
  allowlist: "missing",
  containment: "unsandboxed",
  routing: "direct",
  toolRisks: ["HIGH", "HIGH", "HIGH", "HIGH", "HIGH"],
  triggeredCombos: 2,
  triggeredLints: 1,
  confidences: {
    audience: "verified_config",
    allowlist: "verified_config",
    containment: "verified_config",
    routing: "verified_config",
    tools: "verified_config",
    combos: "verified_config",
    lints: "verified_config",
  },
});
assert(high.numeric === 100, `worst-case edge numeric=100 (got ${high.numeric})`);
assert(high.band === "critical", `worst-case edge band='critical' (got '${high.band}')`);

section("scoring: confidence collapses to unknown on any unknown input");
const withUnknown = computeEdgeScore({
  audience: "group_open",
  allowlist: "missing",
  containment: "unknown",
  routing: "routed",
  toolRisks: ["HIGH"],
  triggeredCombos: 0,
  triggeredLints: 0,
  confidences: {
    audience: "verified_config",
    allowlist: "verified_config",
    containment: "unknown",
    routing: "verified_config",
    tools: "verified_config",
    combos: "verified_config",
    lints: "verified_config",
  },
});
assert(withUnknown.confidence === "unknown", `one unknown input → confidence='unknown' (got '${withUnknown.confidence}')`);

section("scoring: one heuristic input drops confidence to heuristic");
const withHeuristic = computeEdgeScore({
  audience: "public",
  allowlist: "missing",
  containment: "unsandboxed",
  routing: "direct",
  toolRisks: ["HIGH"],
  triggeredCombos: 0,
  triggeredLints: 0,
  confidences: {
    audience: "verified_config",
    allowlist: "verified_config",
    containment: "verified_config",
    routing: "heuristic_inference",
    tools: "verified_config",
    combos: "verified_config",
    lints: "verified_config",
  },
});
assert(withHeuristic.confidence === "heuristic_inference", `one heuristic → confidence='heuristic_inference' (got '${withHeuristic.confidence}')`);

section("scoring: drivers sorted by contribution, no zero/neutral entries");
assert(high.drivers.length >= 3, `worst-case edge has >=3 drivers (got ${high.drivers.length})`);
for (let i = 1; i < high.drivers.length; i++) {
  assert(high.drivers[i - 1].contribution >= high.drivers[i].contribution, `drivers sorted desc at index ${i}`);
}
assert(high.drivers.every((d) => d.contribution > 0), "no zero-contribution drivers");

section("scoring: aggregateMax returns the edge with highest numeric");
const agg = aggregateMax([low, high, withHeuristic]);
assert(agg.numeric === high.numeric, `aggregateMax picks highest numeric (got ${agg.numeric})`);

section("scoring: MIN_CONFIDENCE walks the ladder correctly");
assert(MIN_CONFIDENCE("verified_runtime", "verified_config") === "verified_config", "runtime,config → config");
assert(MIN_CONFIDENCE("unknown", "verified_runtime") === "unknown", "unknown,runtime → unknown");
assert(MIN_CONFIDENCE("heuristic_inference", "verified_filesystem") === "heuristic_inference", "heuristic,filesystem → heuristic");
assert(reduceConfidence([]) === "unknown", "empty reducer → unknown");
assert(reduceConfidence(["verified_runtime", "verified_config", "heuristic_inference"]) === "heuristic_inference", "mixed ladder → weakest");

// ---------- Token matching ----------

section("token-matching: hashToken handles short/invalid tokens");
assert(hashToken(null) === null, "null → null");
assert(hashToken(undefined) === null, "undefined → null");
assert(hashToken("") === null, "empty → null");
assert(hashToken("short") === null, "7-char token → null");
const t = hashToken("valid-long-token-abc123def");
assert(t !== null, "valid token → non-null");
assert(t?.prefix.length === 20, "prefix is 20 chars");
assert(t?.hash.length === 64, "hash is 64 hex chars (sha256)");

section("token-matching: classifyBotIdentity covers all 5 cases");
assert(classifyBotIdentity({ openclawToken: null, hermesToken: null }) === "not_applicable", "no tokens → not_applicable");
assert(classifyBotIdentity({ openclawToken: null, hermesToken: "abc" }) === "no_openclaw_declaration", "hermes-only → no_openclaw_declaration");
assert(classifyBotIdentity({ openclawToken: "abc", hermesToken: null }) === "single_bot_openclaw_enforces", "openclaw-only → openclaw_enforces");
assert(classifyBotIdentity({ openclawToken: "same", hermesToken: "same" }) === "single_bot_hermes_enforces", "same token → hermes_enforces");
assert(classifyBotIdentity({ openclawToken: "oc", hermesToken: "hm" }) === "dual_bot", "diff tokens → dual_bot");

// ---------- Dangerous combos ----------

section("dangerous-combos: registry has 5 seeded combos");
assert(DANGEROUS_COMBOS.length === 5, `5 seeded combos (got ${DANGEROUS_COMBOS.length})`);
for (const combo of DANGEROUS_COMBOS) {
  assert(combo.toolPattern.length >= 2, `combo '${combo.id}' has >=2 AND groups`);
  assert(combo.rationale.length > 30, `combo '${combo.id}' has meaningful rationale`);
}

section("dangerous-combos: empty toolset → all evaluable:false with reason");
const emptyFindings = evaluateAllCombos("agent-0", []);
assert(emptyFindings.length === 5, "5 findings per agent");
assert(emptyFindings.every((f) => !f.evaluable), "every finding evaluable:false");
assert(emptyFindings.every((f) => typeof f.reason === "string" && f.reason.length > 0), "every non-evaluable has reason");

section("dangerous-combos: missing toolset (null/undefined) → same");
const nullFindings = evaluateAllCombos("agent-0", null);
assert(nullFindings.every((f) => !f.evaluable), "null toolset → all evaluable:false");

section("dangerous-combos: browser+read fires on matching tools");
const brFindings = evaluateAllCombos("agent-1", ["browser", "file_read", "curl"]);
const brHit = brFindings.find((f) => f.comboId === "browser_plus_read");
assert(brHit !== undefined && brHit.evaluable === true, "browser_plus_read evaluable:true");
assert((brHit?.evidence ?? []).length >= 2, "evidence lists both matched tools");

section("dangerous-combos: exec+write fires on bash+file_write");
const ewFindings = evaluateAllCombos("agent-2", ["bash", "file_write"]);
const ewHit = ewFindings.find((f) => f.comboId === "exec_plus_write");
assert(ewHit?.evaluable === true, "exec_plus_write evaluable:true on bash+file_write");

section("dangerous-combos: partial match reports which group was missing");
const partial = evaluateCombo(
  DANGEROUS_COMBOS.find((c) => c.id === "read_plus_send")!,
  "agent-3",
  ["file_read"],  // has read, no send
);
assert(partial.evaluable === false, "read only → evaluable:false");
assert(typeof partial.reason === "string" && partial.reason.includes("AND-group"), "reason names missing AND-group");

section("dangerous-combos: findCombo lookup by id");
assert(findCombo("browser_plus_read")?.name === "Browser + Read", "findCombo returns matching combo");
assert(findCombo("nonexistent") === undefined, "findCombo returns undefined for missing id");

// ---------- Posture lints ----------

function prov(source: string, level: Provenance["level"] = "verified_config"): Provenance {
  return { level, source, readAt: new Date().toISOString() };
}
function pv<T>(value: T | null, p: Provenance): PostureValue<T> {
  return { value, provenance: p };
}

function fakePosture(dmAllowedUsers: string[]): PermissionPosture {
  const p = prov("test");
  return {
    botToken: pv<TokenIdentity>(null, p),
    dmAccessGate: pv(
      { allowedUserIds: dmAllowedUsers, allowAllBypass: false, policyType: "allowlist" as const },
      p,
    ),
    groupAccessGate: pv(
      { requireMention: true, freeResponseChannels: [], wakeWordRegexes: [], policyType: "allowlist" as const },
      p,
    ),
    channelFilter: pv({ allowedChannels: [], ignoredChannels: [], noThreadChannels: [] }, p),
    approvalActionAllowlist: pv({ userIds: [], allowAllBypass: false }, p),
    homeChannel: pv<string>(null, p),
    allowAllBypass: pv(false, p),
    pairingApproved: pv([], p),
    execApprovers: pv([], p),
  };
}

function fakeSurface(id: string, dmAllowedUsers: string[]): Surface {
  return {
    id,
    name: id,
    kind: "comm-channel",
    integrationStatus: "shipped",
    hermesLayer: [
      {
        profileId: "example-profile",
        active: true,
        activationSource: "default",
        posture: fakePosture(dmAllowedUsers),
      },
    ],
    enforcerRuntime: "hermes",
    botIdentity: "not_applicable",
    reachability: [],
    effectiveBlastRadius: { numeric: 0, band: "minimal", drivers: [], confidence: "verified_config", rawFactors: {} },
    confidence: "verified_config",
  };
}

section("posture-lints: 2 seeded rules");
assert(POSTURE_LINT_RULES.length === 2, `2 rules (got ${POSTURE_LINT_RULES.length})`);

section("posture-lints: telegram lint fires on channel ID in user allowlist");
const fakeTelegramUserId = "12345678";
const fakeTelegramChatId = "-1001234567890";
const tgBad = fakeSurface("telegram", [fakeTelegramUserId, fakeTelegramChatId]);
const tgFindings = evaluateLints([tgBad]);
assert(tgFindings.length === 1, `1 finding (got ${tgFindings.length})`);
assert(tgFindings[0].ruleId === "telegram_channel_in_user_allowlist", "correct ruleId");
assert(tgFindings[0].value.includes(fakeTelegramChatId), "suspicious value surfaced");
assert(tgFindings[0].severity === "medium", "severity medium");

section("posture-lints: telegram lint does NOT fire on clean user-only list");
const tgGood = fakeSurface("telegram", [fakeTelegramUserId, "87654321"]);
assert(evaluateLints([tgGood]).length === 0, "clean list → no findings");

section("posture-lints: discord lint fires on non-snowflake");
const dcBad = fakeSurface("discord", ["111111111111111111", "abc123"]);
const dcFindings = evaluateLints([dcBad]);
assert(dcFindings.length === 1, "1 finding on non-snowflake");
assert(dcFindings[0].value.includes("abc123"), "non-snowflake surfaced");

section("posture-lints: discord lint does NOT fire on clean snowflake list");
const dcGood = fakeSurface("discord", ["111111111111111111", "222222222222222222"]);
assert(evaluateLints([dcGood]).length === 0, "clean snowflakes → no findings");

section("posture-lints: rule applies() pre-filters unrelated surfaces");
const slackSurface = fakeSurface("slack", ["-1001234567890"]);
assert(evaluateLints([slackSurface]).length === 0, "slack surface → no tg/discord lint fires");

// ---------- OpenClaw scanner (live data) ----------

section("openclaw-scanner: reads live openclaw.json");
const oc = scanOpenClaw();
assert(oc.configPath !== null, `configPath non-null (got ${oc.configPath})`);
assert(oc.discord !== null, "discord layer present");
assert(oc.slack !== null, "slack layer present");
assert(oc.telegram !== null, "telegram layer present");

section("openclaw-scanner: discord posture has token + allowlist");
assert(oc.discord?.botToken.value !== null, "discord token hashed");
assert(oc.discord?.botToken.value?.prefix.length === 20, "discord prefix is 20 chars");
assert(oc.discord?.dmAccessGate.value?.policyType === "allowlist", "discord dmPolicy = allowlist");

section("openclaw-scanner: telegram posture surfaces per-group + allowlist");
assert(oc.telegram?.dmAccessGate.value?.policyType === "allowlist", "telegram dmPolicy = allowlist");
assert(oc.telegram?.groupAccessGate.value?.policyType === "allowlist", "telegram groupPolicy = allowlist");

section("openclaw-scanner: slack posture marks group as not_applicable");
assert(oc.slack?.groupAccessGate.value?.policyType === "not_applicable", "slack groupAccessGate = not_applicable");

section("openclaw-scanner: every provenance has a source anchored in the config path");
for (const layer of [oc.discord, oc.slack, oc.telegram]) {
  if (!layer) continue;
  for (const [key, val] of Object.entries(layer)) {
    const src = (val as any).provenance?.source;
    if (typeof src === "string" && src.length > 0) {
      // every source mentions either the path or 'openclaw has no' or similar — must be non-empty and specific
      assert(src.includes(oc.configPath!) || src.includes("openclaw") || src.includes("slack"), `'${key}' provenance source specific (got '${src.slice(0, 80)}')`);
    }
  }
}

// ---------- Hermes scanner (live data) ----------

section("hermes-scanner: enumerates live profiles tree");
const hm = scanHermes();
assert(hm.profiles.length >= 1, `at least 1 profile (got ${hm.profiles.length})`);

const activeProfile = hm.profiles.find((p) => p.active) ?? hm.profiles[0];
assert(activeProfile !== undefined, "active profile present");
assert(activeProfile?.active === true, "active profile is active");
assert(activeProfile?.source.includes("profiles/"), `source path includes profiles/ (got ${activeProfile?.source})`);

section("hermes-scanner: active profile telegram posture reflects permissive reality");
assert(activeProfile?.telegram !== null, "telegram posture present");
assert(activeProfile?.telegram?.groupAccessGate.value?.requireMention === false, "require_mention=false (group is permissive)");
const freeResponseChannels = activeProfile?.telegram?.groupAccessGate.value?.freeResponseChannels ?? [];
assert(freeResponseChannels.length >= 1, `free-response chat surfaced (got ${freeResponseChannels.length})`);

section("hermes-scanner: active profile telegram homeChannel comes from config.yaml");
const homeChannel = activeProfile?.telegram?.homeChannel.value;
assert(typeof homeChannel === "string" && homeChannel.length > 0, "TELEGRAM_HOME_CHANNEL surfaced");

section("hermes-scanner: active profile discord posture has large flat allowlist");
assert(activeProfile?.discord !== null, "discord posture present");
const dcUsers = activeProfile?.discord?.dmAccessGate.value?.allowedUserIds ?? [];
assert(dcUsers.length >= 10, `discord allowlist has >=10 users (got ${dcUsers.length})`);

section("hermes-scanner: active profile telegram pairing reveals approved user");
const paired = activeProfile?.telegram?.pairingApproved.value ?? [];
assert(paired.length >= 1 && paired.some((p) => typeof p.userName === "string" && p.userName.length > 0), "approved user is in telegram-approved pairing store");

section("hermes-scanner (v0.7.1): KNOWN_TOOL_NEEDLES covers dangerous-combo synonyms");
assert(KNOWN_TOOL_NEEDLES.includes("browser"), "needles include 'browser'");
assert(KNOWN_TOOL_NEEDLES.includes("read"), "needles include 'read'");
assert(KNOWN_TOOL_NEEDLES.includes("exec"), "needles include 'exec'");
assert(KNOWN_TOOL_NEEDLES.includes("delegate"), "needles include 'delegate'");

section("hermes-scanner (v0.7.1): extractToolsFromSkillBody picks backtick-quoted tools");
const sampleBody = "Use `browser_navigate` and `file_read` and `bash` here. Also `unrelated_function`.";
const extracted = extractToolsFromSkillBody(sampleBody);
assert(extracted.includes("browser_navigate"), `'browser_navigate' extracted (got ${JSON.stringify(extracted)})`);
assert(extracted.includes("file_read"), "'file_read' extracted");
assert(extracted.includes("bash"), "'bash' extracted");
assert(!extracted.includes("unrelated_function"), "non-needle tokens skipped");

section("hermes-scanner (v0.7.1): scanProfileSkills walks active profile and returns toolUnion");
if (activeProfile) {
  const skillScan = scanProfileSkills(activeProfile.source);
  assert(skillScan.scannedDir !== null, `skills/ dir found (got ${skillScan.scannedDir})`);
  assert(skillScan.skills.length >= 1, `at least 1 skill with extracted tools (got ${skillScan.skills.length})`);
  assert(skillScan.toolUnion.length >= 1, `toolUnion non-empty (got ${skillScan.toolUnion.length})`);
  // The dogfood skill explicitly mentions browser_navigate, browser_snapshot, etc.
  assert(
    skillScan.toolUnion.some((t) => t.startsWith("browser")),
    `toolUnion includes a 'browser*' tool (got ${JSON.stringify(skillScan.toolUnion.slice(0, 5))})`,
  );
}

section("hermes-scanner (v0.7.1): active profile carries skills + toolUnion populated by buildProfile");
assert(activeProfile?.skills !== undefined && Array.isArray(activeProfile?.skills), "activeProfile.skills array present");
assert((activeProfile?.skills.length ?? 0) >= 1, `activeProfile.skills.length >=1 (got ${activeProfile?.skills.length})`);
assert((activeProfile?.toolUnion?.length ?? 0) >= 1, `activeProfile.toolUnion non-empty (got ${activeProfile?.toolUnion?.length})`);
assert(activeProfile?.skillsScannedDir?.endsWith("skills") === true, `activeProfile.skillsScannedDir ends with 'skills' (got ${activeProfile?.skillsScannedDir})`);

section("hermes-scanner: every provenance source contains the profile path or explicit 'no X'");
if (activeProfile) {
  const platforms = ["discord", "slack", "telegram"] as const;
  for (const plat of platforms) {
    const posture = activeProfile[plat];
    if (!posture) continue;
    for (const [key, val] of Object.entries(posture)) {
      const src = (val as any).provenance?.source;
      const specific =
        typeof src === "string" &&
        (src.includes(activeProfile.source) || src.includes("hermes") || src.includes("slack") || src.includes("gateway/"));
      assert(specific, `activeProfile.${plat}.${key} provenance anchor specific (got '${String(src).slice(0, 80)}')`);
    }
  }
}

// ---------- Runtime-surfaces adapter ----------

section("runtime-surfaces: produces >=3 surfaces from trust-audit discovery");
const rt = scanRuntimeSurfaces();
assert(rt.length >= 3, `runtime surfaces >=3 (got ${rt.length})`);
assert(rt.every((s) => s.kind === "runtime-endpoint"), "all have kind=runtime-endpoint");
assert(rt.every((s) => s.integrationStatus === "shipped"), "all integrationStatus=shipped");

section("runtime-surfaces: litellm-proxy enforcer=openclaw, dashboard enforcer=clawnex");
const litellm = rt.find((s) => s.id === "litellm-proxy");
assert(litellm?.enforcerRuntime === "openclaw", "litellm-proxy enforcer=openclaw");
const dash = rt.find((s) => s.id === "dashboard");
assert(dash?.enforcerRuntime === "clawnex", "dashboard enforcer=clawnex");

section("runtime-surfaces: seed function provides audience + allowlist");
const seed = runtimeSurfaceSeed("litellm-proxy");
assert(seed !== null, "litellm-proxy seed present");
assert(seed?.audience === "localhost_only", `litellm-proxy audience=localhost_only (got ${seed?.audience})`);

// ---------- Cache ----------

section("cache: set/get roundtrip");
clearCache();
assert(getCached() === null, "empty cache → null");
const fakeReport = {
  generatedAt: new Date().toISOString(),
  profiles: [], surfaces: [], dangerousCombos: [], postureLints: [],
  rankings: { mostPermissiveAgents: [], mostExposedSurfaces: [] },
  meta: { scanDurationMs: 0, cached: false, cacheAgeMs: 0, panelWideConfidence: "verified_runtime" },
} as unknown as PermissivenessReport;
setCached(fakeReport);
assert(getCached() !== null, "after setCached, getCached returns the report");
assert(getCached()?.generatedAt === fakeReport.generatedAt, "cached report is the same object");

section("cache: TTL expiry (past-tense via immediate TTL)");
clearCache();
setCached(fakeReport, 1);   // 1ms TTL
// Date.now is monotonically increasing — by the time getCached runs the TTL is already past.
// Note: Node's V8 timing resolution is nanosecond-level; even a tight loop crosses 1ms.
const busyUntil = Date.now() + 3;
while (Date.now() < busyUntil) {/* noop */}
assert(getCached() === null, "after TTL expiry, getCached returns null");

section("cache: clearCache wipes");
setCached(fakeReport);
assert(getCached() !== null, "before clear");
clearCache();
assert(getCached() === null, "after clear");

section("cache: default TTL is 60 seconds");
assert(DEFAULT_TTL_MS === 60_000, `DEFAULT_TTL_MS=60000 (got ${DEFAULT_TTL_MS})`);

// ---------- Scan orchestrator (live) ----------

async function runOrchestratorTests() {
  clearCache();
  const report = await scan({ refresh: true });

  section("scan: meta + profiles");
  assert(report.profiles.length >= 1, `>=1 profile (got ${report.profiles.length})`);
  assert(report.profiles.some((p) => p.active), "at least one profile is active");
  assert(report.meta.cached === false, "fresh scan → cached:false");
  assert(report.meta.scanDurationMs >= 0, "scanDurationMs >=0");

  section("scan: surfaces include 3 comm + runtime surfaces + 2 not_integrated");
  assert(report.surfaces.length >= 6, `surfaces >=6 (got ${report.surfaces.length})`);
  const ids = report.surfaces.map((s) => s.id);
  for (const required of ["discord", "telegram", "slack", "webhook", "nemoclaw"]) {
    assert(ids.includes(required), `surfaces include '${required}'`);
  }

  section("scan: not_integrated surfaces have explicit status");
  const webhook = report.surfaces.find((s) => s.id === "webhook");
  assert(webhook?.integrationStatus === "not_integrated", "webhook → not_integrated");

  section("scan: telegram botIdentity = dual_bot on this machine");
  const tg = report.surfaces.find((s) => s.id === "telegram");
  assert(tg?.botIdentity === "dual_bot", `telegram botIdentity=dual_bot (got ${tg?.botIdentity})`);

  section("scan: discord botIdentity = dual_bot on this machine");
  const dc = report.surfaces.find((s) => s.id === "discord");
  assert(dc?.botIdentity === "dual_bot", `discord botIdentity=dual_bot (got ${dc?.botIdentity})`);

  section("scan: lints fire on live data (telegram channel-in-user-allowlist)");
  const tgLint = report.postureLints.find((l) => l.ruleId === "telegram_channel_in_user_allowlist");
  assert(tgLint !== undefined, "telegram_channel_in_user_allowlist finding present");
  assert(typeof tgLint?.value === "string" && tgLint.value.length > 0, "lint surfaces the suspicious value");

  section("scan: reachability populated for comm surfaces");
  assert((tg?.reachability.length ?? 0) >= 1, "telegram has >=1 reachability edge");
  assert((dc?.reachability.length ?? 0) >= 1, "discord has >=1 reachability edge");

  section("scan: edge classifications reflect live posture (not fake zeros)");
  const tgEdge = tg?.reachability[0];
  assert(tgEdge !== undefined, "telegram has a reachability edge");
  assert(tgEdge?.effectiveAudience === "group_open", `telegram edge audience=group_open (got '${tgEdge?.effectiveAudience}')`);
  assert(tgEdge?.effectiveAllowlist === "enforcing_tight", `telegram edge allowlist=enforcing_tight (got '${tgEdge?.effectiveAllowlist}')`);
  const dcEdge = dc?.reachability[0];
  assert(dcEdge !== undefined, "discord has a reachability edge");
  // discord has 56 users in allowlist → enforcing_broad
  assert(dcEdge?.effectiveAllowlist === "enforcing_broad", `discord edge allowlist=enforcing_broad (got '${dcEdge?.effectiveAllowlist}')`);

  section("scan: combos honor evaluable contract (v0.7.1: live data fires real combos)");
  assert(
    report.dangerousCombos.every(
      (c) => typeof c.evaluable === "boolean" && (
        c.evaluable === true
          ? Array.isArray(c.evidence) && c.evidence.length >= 2
          : typeof c.reason === "string" && c.reason.length > 0
      ),
    ),
    "every combo: evaluable:true → evidence with >=2 hits, evaluable:false → non-empty reason",
  );
  assert(
    report.dangerousCombos.some((c) => c.evaluable === true),
    "at least one combo fires evaluable:true on live data (v0.7.0+ deeper reachability)",
  );

  section("scan (v0.7.1): hermes comm-agent edges carry skill-derived tools");
  const tgHermesEdge = tg?.reachability.find((r) => r.agentId.startsWith("hermes-telegram@"));
  assert(tgHermesEdge !== undefined, "telegram has a hermes-* edge");
  assert(
    (tgHermesEdge?.toolIds.length ?? 0) >= 1,
    `hermes-telegram edge has toolIds populated by skill scan (got ${tgHermesEdge?.toolIds.length ?? 0})`,
  );

  section("scan (v0.7.1): at least one hermes-side combo evaluable:true");
  const hermesEvaluableCombo = report.dangerousCombos.find(
    (c) => c.agentId.startsWith("hermes-") && c.evaluable === true,
  );
  assert(
    hermesEvaluableCombo !== undefined,
    "at least one hermes-* combo evaluable:true (skill-extracted tools fed dangerous-combo eval)",
  );

  section("scan: rankings populated");
  assert(report.rankings.mostExposedSurfaces.length >= 1, "mostExposedSurfaces >=1");
  assert(report.rankings.mostPermissiveAgents.length >= 1, "mostPermissiveAgents >=1");

  section("scan: cache hit on second call");
  const t1 = Date.now();
  const report2 = await scan({ refresh: false });
  const elapsed = Date.now() - t1;
  assert(report2.meta.cached === true, "second call → cached:true");
  assert(elapsed < 50, `cache hit is fast (got ${elapsed}ms)`);

  // Summary
  console.log(`\n${status.fail === 0 ? "PASS" : "FAIL"}: ${status.pass} passed, ${status.fail} failed`);
  process.exit(status.fail === 0 ? 0 : 1);
}

runOrchestratorTests().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
