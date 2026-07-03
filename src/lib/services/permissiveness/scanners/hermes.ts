// Hermes scanner — enumerates ~/.hermes/profiles/*/ and returns a
// PermissionPosture per profile × comm surface. Data sources per profile:
//   - <profile>/.env           → DISCORD_/TELEGRAM_/SLACK_/GATEWAY_* env vars
//   - <profile>/config.yaml    → discord.*, TELEGRAM_HOME_CHANNEL, platform_toolsets
//   - <profile>/platforms/pairing/{platform}-approved.json  → runtime-paired users
//   - <profile>/channel_directory.json (top level)          → reachability registry
//   - <profile>/skills/**/SKILL.md                          → tool-union per profile
//                                                             (heuristic_inference)
//
// Top-level ~/.hermes/.env is also read but explicitly marked lower-precedence:
// profile .env always wins when both declare the same key.
//
// Active-profile detection (3-step fallback):
//   1. ~/.hermes/active_profile file content (matches a profile name)
//   2. If exactly one profile exists, it's active
//   3. Else `unknown`, all profiles rendered with active:false
//
// Skill tool extraction (v0.7.1+): we walk SKILL.md files under the profile's
// skills/ tree, parse frontmatter (name, metadata.hermes.tags), and extract
// backtick-quoted identifiers from the body that match a known tool needle
// (drawn from dangerous-combos synonyms + the toolRiskFor() rubric in
// permissiveness/index.ts). The per-profile tool union feeds the Hermes
// comm-agent edges so dangerous-combo evaluation can fire evaluable:true
// against the Hermes side. Confidence is `heuristic_inference` because
// regex-over-prose is structurally weaker than reading a tool registry.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §8

import type { Dirent } from "node:fs";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import {
  hermesPathExists,
  isPathInside,
  isSafeHermesProfileId,
  readHermesDirectory,
  readHermesTextFile,
  resolveHermesChildPath,
  resolveHermesHomePath,
  resolveHermesProfilePath,
} from "@/lib/hermes-paths";
import { hashToken } from "../token-matching";
import type {
  HermesProfileLayer,
  PermissionPosture,
  PostureValue,
  Provenance,
  TokenIdentity,
} from "../types";

const HOME = os.homedir();
const HERMES_ROOT_RESULT = resolveHermesHomePath(process.env.HERMES_HOME ?? path.join(HOME, ".hermes"));
const HERMES_ROOT = HERMES_ROOT_RESULT.ok ? HERMES_ROOT_RESULT.path : null;

type ConfidenceLevel =
  | "verified_config"
  | "verified_filesystem"
  | "heuristic_inference"
  | "unknown";

function nowIso(): string {
  return new Date().toISOString();
}

function prov(source: string, level: ConfidenceLevel = "verified_config"): Provenance {
  return { level, source, readAt: nowIso() };
}

function pv<T>(value: T | null, provenance: Provenance): PostureValue<T> {
  return { value, provenance };
}

function emptyScan(scannedAt: string): HermesScanResult {
  return { profiles: [], rootEnv: null, channelDirectory: null, scannedAt };
}

function resolveProfilesRoot(): string | null {
  if (!HERMES_ROOT) return null;
  const profilesRoot = resolveHermesChildPath(HERMES_ROOT, "profiles");
  return profilesRoot.ok ? profilesRoot.path : null;
}

function resolveRootChild(...segments: string[]): string | null {
  if (!HERMES_ROOT) return null;
  const resolved = resolveHermesChildPath(HERMES_ROOT, ...segments);
  return resolved.ok ? resolved.path : null;
}

// ---------- dotenv + yaml parsing ----------

function parseDotEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function csvList(v: string | undefined | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// ---------- public entry ----------

export interface HermesSkillScan {
  id: string;                 // path slug from skills/, e.g. "research/arxiv"
  source: string;             // absolute SKILL.md path
  toolsExtracted: string[];   // normalized tokens that matched a known needle
}

export interface HermesProfileScan {
  id: string;
  active: boolean;
  activationSource: "active_profile_file" | "default" | "unknown";
  source: string;
  discord: PermissionPosture | null;
  slack: PermissionPosture | null;
  telegram: PermissionPosture | null;
  /** Per-profile skill scan; v0.7.1+. Empty array means no SKILL.md files
   *  matched a known tool needle (or the skills/ dir is absent). */
  skills: HermesSkillScan[];
  /** Deduped, sorted union of every skill's `toolsExtracted`. Feeds Hermes
   *  comm-agent edges via deriveCommReachability(). */
  toolUnion: string[];
  /** Absolute path to skills/ root if it exists; null if scanner saw no dir. */
  skillsScannedDir: string | null;
}

export interface HermesScanResult {
  profiles: HermesProfileScan[];
  rootEnv: Record<string, string> | null;
  channelDirectory: unknown | null;
  scannedAt: string;
}

export function scanHermes(): HermesScanResult {
  const scannedAt = nowIso();
  const profilesRoot = resolveProfilesRoot();

  if (!HERMES_ROOT || !profilesRoot || !hermesPathExists(profilesRoot)) {
    return emptyScan(scannedAt);
  }

  const profileIds = readHermesDirectory(profilesRoot)
    .filter((d) => d.isDirectory() && isSafeHermesProfileId(d.name) && resolveHermesProfilePath(HERMES_ROOT, d.name).ok)
    .map((d) => d.name);

  const { active: activeId, source: activationSource } = detectActiveProfile(profileIds);

  const rootEnv = tryReadDotEnv(resolveRootChild(".env"));

  const profiles = profileIds
    .map((id) => buildProfile(id, id === activeId, activationSource))
    .filter((profile): profile is HermesProfileScan => profile !== null);

  // Channel directory — read the active profile's first; fall back to the HERMES_ROOT-level file if present.
  let channelDirectory: unknown = null;
  const activeProfileDir = activeId ? resolveHermesProfilePath(HERMES_ROOT, activeId) : null;
  const activeChannelDirectory = activeProfileDir?.ok ? resolveHermesChildPath(activeProfileDir.path, "channel_directory.json") : null;
  const cdCandidates = [
    activeChannelDirectory?.ok ? activeChannelDirectory.path : null,
    resolveRootChild("channel_directory.json"),
  ].filter(Boolean) as string[];
  for (const cdPath of cdCandidates) {
    if (hermesPathExists(cdPath)) {
      try {
        channelDirectory = JSON.parse(readHermesTextFile(cdPath));
        break;
      } catch {
        /* keep trying */
      }
    }
  }

  return { profiles, rootEnv, channelDirectory, scannedAt };
}

// ---------- active profile detection ----------

function detectActiveProfile(profileIds: string[]): {
  active: string | null;
  source: "active_profile_file" | "default" | "unknown";
} {
  const activeProfileFile = resolveRootChild("active_profile");
  try {
    if (activeProfileFile && hermesPathExists(activeProfileFile)) {
      const name = readHermesTextFile(activeProfileFile).trim();
      if (isSafeHermesProfileId(name) && profileIds.includes(name)) return { active: name, source: "active_profile_file" };
    }
  } catch {
    /* ignore */
  }
  if (profileIds.length === 1) return { active: profileIds[0], source: "default" };
  return { active: null, source: "unknown" };
}

// ---------- per-profile builder ----------

function buildProfile(
  id: string,
  active: boolean,
  activationSource: "active_profile_file" | "default" | "unknown",
): HermesProfileScan | null {
  if (!HERMES_ROOT) return null;
  const profileDir = resolveHermesProfilePath(HERMES_ROOT, id);
  if (!profileDir.ok) return null;
  const envPath = resolveHermesChildPath(profileDir.path, ".env");
  const yamlPath = resolveHermesChildPath(profileDir.path, "config.yaml");
  const pairingDir = resolveHermesChildPath(profileDir.path, "platforms", "pairing");

  const env = tryReadDotEnv(envPath.ok ? envPath.path : null) ?? {};
  const yamlDoc = tryReadYaml(yamlPath.ok ? yamlPath.path : null) ?? {};

  const discordPaired = readPairing(pairingDir.ok ? pairingDir.path : null, "discord");
  const telegramPaired = readPairing(pairingDir.ok ? pairingDir.path : null, "telegram");
  const slackPaired = readPairing(pairingDir.ok ? pairingDir.path : null, "slack");

  const skillScan = scanProfileSkills(profileDir.path);

  return {
    id,
    active,
    activationSource: active ? activationSource : "unknown",
    source: profileDir.path,
    discord: buildHermesDiscord(env, yamlDoc, profileDir.path, discordPaired),
    slack: buildHermesSlack(env, yamlDoc, profileDir.path, slackPaired),
    telegram: buildHermesTelegram(env, yamlDoc, profileDir.path, telegramPaired),
    skills: skillScan.skills,
    toolUnion: skillScan.toolUnion,
    skillsScannedDir: skillScan.scannedDir,
  };
}

function tryReadDotEnv(p: string | null): Record<string, string> | null {
  try {
    if (!p) return null;
    if (!hermesPathExists(p)) return null;
    return parseDotEnv(readHermesTextFile(p));
  } catch {
    return null;
  }
}

function tryReadYaml(p: string | null): Record<string, any> | null {
  try {
    if (!p) return null;
    if (!hermesPathExists(p)) return null;
    return YAML.parse(readHermesTextFile(p)) ?? {};
  } catch {
    return null;
  }
}

function readPairing(dir: string | null, platform: string): {
  userId: string;
  userName: string;
  approvedAt: string;
}[] {
  if (!dir) return [];
  const file = resolveHermesChildPath(dir, `${platform}-approved.json`);
  if (!file.ok) return [];
  if (!hermesPathExists(file.path)) return [];
  try {
    const doc = JSON.parse(readHermesTextFile(file.path));
    return Object.entries(doc).map(([userId, meta]: [string, any]) => ({
      userId,
      userName: typeof meta?.user_name === "string" ? meta.user_name : "",
      approvedAt: new Date((meta?.approved_at ?? 0) * 1000).toISOString(),
    }));
  } catch {
    return [];
  }
}

// ---------- per-platform builders ----------

function buildHermesDiscord(
  env: Record<string, string>,
  yamlDoc: any,
  profileDir: string,
  paired: { userId: string; userName: string; approvedAt: string }[],
): PermissionPosture | null {
  const hasToken = Boolean(env.DISCORD_BOT_TOKEN);
  const hasYamlBlock = Boolean(yamlDoc?.discord);
  if (!hasToken && !hasYamlBlock) return null;

  const yd = yamlDoc?.discord ?? {};
  const requireMention =
    yd.require_mention !== undefined
      ? Boolean(yd.require_mention)
      : env.DISCORD_REQUIRE_MENTION === "false"
        ? false
        : true;

  const frYaml = yd.free_response_channels;
  const freeResponse = [
    ...(frYaml !== undefined && frYaml !== null ? [String(frYaml)] : []),
    ...csvList(env.DISCORD_FREE_RESPONSE_CHANNELS),
  ];

  const allowedYaml = yd.allowed_channels;
  const allowedChannels = [
    ...(allowedYaml !== undefined && allowedYaml !== null ? [String(allowedYaml)] : []),
    ...csvList(env.DISCORD_ALLOWED_CHANNELS),
  ];

  return {
    botToken: pv<TokenIdentity>(
      hashToken(env.DISCORD_BOT_TOKEN),
      prov(`${profileDir}/.env:DISCORD_BOT_TOKEN`),
    ),
    dmAccessGate: pv(
      {
        allowedUserIds: csvList(env.DISCORD_ALLOWED_USERS),
        allowAllBypass: env.DISCORD_ALLOW_ALL_USERS === "true",
        policyType: "allowlist",
      },
      prov(`${profileDir}/.env:DISCORD_ALLOWED_USERS`),
    ),
    groupAccessGate: pv(
      {
        requireMention,
        freeResponseChannels: freeResponse,
        wakeWordRegexes: [],
        policyType: "allowlist",
      },
      prov(`${profileDir}/config.yaml:discord + env:DISCORD_*`),
    ),
    channelFilter: pv(
      {
        allowedChannels,
        ignoredChannels: csvList(env.DISCORD_IGNORED_CHANNELS),
        noThreadChannels: csvList(env.DISCORD_NO_THREAD_CHANNELS),
      },
      prov(`${profileDir}/config.yaml:discord.* + env:DISCORD_*_CHANNELS`),
    ),
    approvalActionAllowlist: pv(
      {
        userIds: csvList(env.DISCORD_ALLOWED_USERS),
        allowAllBypass: env.DISCORD_ALLOW_ALL_USERS === "true",
      },
      prov(
        `gateway/platforms/discord.py:2589-2593 reads DISCORD_ALLOWED_USERS (profile: ${profileDir}/.env)`,
      ),
    ),
    homeChannel: pv<string>(
      null,
      prov(`${profileDir}/config.yaml has no discord home channel`, "unknown"),
    ),
    allowAllBypass: pv(
      env.DISCORD_ALLOW_ALL_USERS === "true" || env.GATEWAY_ALLOW_ALL_USERS === "true",
      prov(`${profileDir}/.env:*_ALLOW_ALL_USERS`),
    ),
    pairingApproved: pv(
      paired,
      prov(
        `${profileDir}/platforms/pairing/discord-approved.json`,
        "verified_filesystem",
      ),
    ),
    execApprovers: pv([], prov("hermes has no exec-approvers concept for discord", "unknown")),
  };
}

function buildHermesSlack(
  env: Record<string, string>,
  _yamlDoc: any,
  profileDir: string,
  paired: { userId: string; userName: string; approvedAt: string }[],
): PermissionPosture | null {
  if (!env.SLACK_BOT_TOKEN) return null;
  return {
    botToken: pv<TokenIdentity>(
      hashToken(env.SLACK_BOT_TOKEN),
      prov(`${profileDir}/.env:SLACK_BOT_TOKEN`),
    ),
    dmAccessGate: pv(
      {
        allowedUserIds: csvList(env.SLACK_ALLOWED_USERS),
        allowAllBypass: env.SLACK_ALLOW_ALL_USERS === "true",
        policyType: "allowlist",
      },
      prov(`${profileDir}/.env:SLACK_ALLOWED_USERS`),
    ),
    groupAccessGate: pv(
      {
        requireMention: false,
        freeResponseChannels: [],
        wakeWordRegexes: [],
        policyType: "not_applicable",
      },
      prov("slack has no group/guild concept; workspace is the scope", "unknown"),
    ),
    channelFilter: pv(
      { allowedChannels: [], ignoredChannels: [], noThreadChannels: [] },
      prov(`${profileDir}/.env slack has no channel filter vars`, "unknown"),
    ),
    approvalActionAllowlist: pv(
      {
        userIds: csvList(env.SLACK_ALLOWED_USERS),
        allowAllBypass: env.SLACK_ALLOW_ALL_USERS === "true",
      },
      prov(`${profileDir}/.env:SLACK_ALLOWED_USERS`),
    ),
    homeChannel: pv<string>(null, prov(`${profileDir}/config.yaml has no slack home channel`, "unknown")),
    allowAllBypass: pv(
      env.SLACK_ALLOW_ALL_USERS === "true" || env.GATEWAY_ALLOW_ALL_USERS === "true",
      prov(`${profileDir}/.env:*_ALLOW_ALL_USERS`),
    ),
    pairingApproved: pv(
      paired,
      prov(`${profileDir}/platforms/pairing/slack-approved.json`, "verified_filesystem"),
    ),
    execApprovers: pv([], prov("hermes has no exec-approvers concept for slack", "unknown")),
  };
}

function buildHermesTelegram(
  env: Record<string, string>,
  yamlDoc: any,
  profileDir: string,
  paired: { userId: string; userName: string; approvedAt: string }[],
): PermissionPosture | null {
  if (!env.TELEGRAM_BOT_TOKEN) return null;

  const homeChannelRaw = yamlDoc?.TELEGRAM_HOME_CHANNEL ?? env.TELEGRAM_HOME_CHANNEL ?? null;
  const homeChannel = homeChannelRaw !== null && homeChannelRaw !== undefined ? String(homeChannelRaw) : null;

  return {
    botToken: pv<TokenIdentity>(
      hashToken(env.TELEGRAM_BOT_TOKEN),
      prov(`${profileDir}/.env:TELEGRAM_BOT_TOKEN`),
    ),
    dmAccessGate: pv(
      {
        allowedUserIds: csvList(env.TELEGRAM_ALLOWED_USERS),
        allowAllBypass: env.TELEGRAM_ALLOW_ALL_USERS === "true",
        policyType: "allowlist",
      },
      prov(`${profileDir}/.env:TELEGRAM_ALLOWED_USERS`),
    ),
    groupAccessGate: pv(
      {
        requireMention: env.TELEGRAM_REQUIRE_MENTION !== "false",
        freeResponseChannels: csvList(env.TELEGRAM_FREE_RESPONSE_CHATS),
        wakeWordRegexes: csvList(env.TELEGRAM_MENTION_PATTERNS),
        policyType: "allowlist",
      },
      prov(
        `${profileDir}/.env:TELEGRAM_REQUIRE_MENTION + TELEGRAM_FREE_RESPONSE_CHATS (+ TELEGRAM_MENTION_PATTERNS if set)`,
      ),
    ),
    channelFilter: pv(
      { allowedChannels: [], ignoredChannels: [], noThreadChannels: [] },
      prov(`${profileDir}/.env telegram has no channel filter vars`, "unknown"),
    ),
    approvalActionAllowlist: pv(
      {
        userIds: csvList(env.TELEGRAM_ALLOWED_USERS),
        allowAllBypass: env.TELEGRAM_ALLOW_ALL_USERS === "true",
      },
      prov(
        `gateway/platforms/telegram.py:1440-1445 reads TELEGRAM_ALLOWED_USERS (profile: ${profileDir}/.env)`,
      ),
    ),
    homeChannel: pv(
      homeChannel,
      prov(
        homeChannel
          ? `${profileDir}/config.yaml:TELEGRAM_HOME_CHANNEL (or env fallback)`
          : `${profileDir} has no TELEGRAM_HOME_CHANNEL`,
        homeChannel ? "verified_config" : "unknown",
      ),
    ),
    allowAllBypass: pv(
      env.TELEGRAM_ALLOW_ALL_USERS === "true" || env.GATEWAY_ALLOW_ALL_USERS === "true",
      prov(`${profileDir}/.env:*_ALLOW_ALL_USERS`),
    ),
    pairingApproved: pv(
      paired,
      prov(`${profileDir}/platforms/pairing/telegram-approved.json`, "verified_filesystem"),
    ),
    execApprovers: pv([], prov("hermes has no exec-approvers concept for telegram", "unknown")),
  };
}

// ---------- utility: export profile layer adaptor ----------

export function profileScanToLayer(
  scan: HermesProfileScan,
  platform: "discord" | "slack" | "telegram",
): HermesProfileLayer | null {
  const posture = scan[platform];
  if (!posture) return null;
  return {
    profileId: scan.id,
    active: scan.active,
    activationSource: scan.activationSource,
    posture,
  };
}

// ---------- skill scan (v0.7.1+) ----------
//
// Drawn from dangerous-combos synonyms + the toolRiskFor() rubric in
// permissiveness/index.ts. A backtick-quoted token is recognized as a tool
// when its lowercased form equals one of these needles or starts with
// `<needle>_` (so `browser_navigate` matches the `browser` needle and
// preserves the discovered token as evidence).
export const KNOWN_TOOL_NEEDLES: string[] = [
  // browser / web
  "browser", "fetch", "web_fetch", "web_search", "web_browse", "web",
  // read
  "read", "file_read", "fs_read",
  // write / edit
  "write", "file_write", "edit", "fs_write",
  // exec
  "bash", "exec", "shell", "run_command", "execute",
  // send / post
  "send", "email", "slack_post", "discord_post", "telegram_post",
  "http_post", "webhook", "post",
  // config mutation
  "config_write", "edit_config", "settings_set", "env_write",
  // service control
  "restart", "reload", "systemctl", "service_control", "kill_process",
  // delegation
  "delegate", "dispatch_agent", "call_agent", "invoke_agent", "agent_to_agent",
];

/** Pull tools out of a SKILL.md body. Conservative: only extracts identifiers
 *  that appear inside backticks and match a known needle. Returns the actual
 *  discovered tokens (not the needles) so the dangerous-combo evidence trail
 *  shows the real surface name, e.g. `browser_navigate`. */
export function extractToolsFromSkillBody(body: string): string[] {
  const out = new Set<string>();
  const re = /`([a-zA-Z][a-zA-Z0-9_.:-]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tok = m[1].toLowerCase();
    for (const needle of KNOWN_TOOL_NEEDLES) {
      if (tok === needle || tok.startsWith(needle + "_")) {
        out.add(tok);
        break;
      }
    }
  }
  return Array.from(out).sort();
}

function parseSkillFile(filePath: string): string[] {
  let raw: string;
  try {
    raw = readHermesTextFile(filePath);
  } catch {
    return [];
  }
  // Skip YAML frontmatter delimited by --- markers when present; otherwise
  // scan the whole file. Frontmatter rarely contains backticks, so the
  // distinction mostly affects performance, not correctness.
  let body = raw;
  if (raw.startsWith("---")) {
    const close = raw.indexOf("\n---", 3);
    if (close > 0) body = raw.slice(close + 4);
  }
  return extractToolsFromSkillBody(body);
}

function resolveSkillScanProfileDir(profileDir: string): string | null {
  if (!HERMES_ROOT) return null;
  const profilesRoot = resolveProfilesRoot();
  if (!profilesRoot) return null;
  const candidate = path.resolve(profileDir);
  if (!isPathInside(profilesRoot, candidate)) return null;
  const relative = path.relative(profilesRoot, candidate);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length !== 1 || !isSafeHermesProfileId(parts[0])) return null;
  const resolved = resolveHermesProfilePath(HERMES_ROOT, parts[0]);
  return resolved.ok ? resolved.path : null;
}

/** Walk every SKILL.md under <profileDir>/skills/ and return aggregated tool union. */
export function scanProfileSkills(profileDir: string): {
  skills: HermesSkillScan[];
  toolUnion: string[];
  scannedDir: string | null;
} {
  const safeProfileDir = resolveSkillScanProfileDir(profileDir);
  if (!safeProfileDir) {
    return { skills: [], toolUnion: [], scannedDir: null };
  }
  const skillsRoot = resolveHermesChildPath(safeProfileDir, "skills");
  if (!skillsRoot.ok || !hermesPathExists(skillsRoot.path)) {
    return { skills: [], toolUnion: [], scannedDir: null };
  }
  const skills: HermesSkillScan[] = [];
  const unionSet = new Set<string>();

  function walk(dir: string) {
    let entries: Dirent[];
    try {
      entries = readHermesDirectory(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const child = resolveHermesChildPath(dir, e.name);
      if (!child.ok) continue;
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        walk(child.path);
      } else if (e.isFile() && e.name === "SKILL.md") {
        const tools = parseSkillFile(child.path);
        if (tools.length > 0) {
          skills.push({
            id: path.relative(skillsRoot.path, path.dirname(child.path)) || path.basename(path.dirname(child.path)),
            source: child.path,
            toolsExtracted: tools,
          });
          for (const t of tools) unionSet.add(t);
        }
      }
    }
  }

  walk(skillsRoot.path);
  return {
    skills: skills.sort((a, b) => a.id.localeCompare(b.id)),
    toolUnion: Array.from(unionSet).sort(),
    scannedDir: skillsRoot.path,
  };
}
