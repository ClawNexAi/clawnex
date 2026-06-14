// OpenClaw scanner — reads ~/.openclaw/openclaw.json channels.* blocks and
// returns a PermissionPosture per comm surface. All paths come from the
// existing resolveOpenClawPaths() helper so provenance anchors match the
// file the gateway actually reads.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §8

import {
  readOpenClawConfig,
  resolveOpenClawPaths,
} from "@/lib/openclaw-paths";
import { hashToken } from "../token-matching";
import type {
  PermissionPosture,
  PostureValue,
  Provenance,
  TokenIdentity,
} from "../types";

type ConfidenceLevel = "verified_config" | "unknown";

function nowIso(): string {
  return new Date().toISOString();
}

function prov(source: string, level: ConfidenceLevel = "verified_config"): Provenance {
  return { level, source, readAt: nowIso() };
}

function pv<T>(value: T | null, provenance: Provenance): PostureValue<T> {
  return { value, provenance };
}

export interface OpenClawAgent {
  id: string;
  name: string;
  model: string;
  toolIds: string[];
  toolsDeclared: boolean;          // true iff tools.allow existed in config; false = "no per-agent tool declaration" (may inherit globals)
}

export interface OpenClawBinding {
  agentId: string;
  channel: "discord" | "slack" | "telegram";
  peerKind: string;                 // "group" | "channel" | "user" | ...
  peerId: string;
}

export interface OpenClawLayer {
  discord: PermissionPosture | null;
  slack: PermissionPosture | null;
  telegram: PermissionPosture | null;
  agents: OpenClawAgent[];
  bindings: OpenClawBinding[];
  /** Map of model-id-prefix → routed|direct. `routed` = provider baseUrl routes through LiteLLM proxy. */
  routingByModelPrefix: Record<string, "routed" | "direct">;
  configPath: string | null;
  readAt: string;
}

const LITELLM_HOSTS = ["127.0.0.1", "localhost"];
const LITELLM_PORT_DEFAULT = "4001";

function classifyRouting(baseUrl: string | undefined): "routed" | "direct" {
  if (!baseUrl) return "direct";
  for (const host of LITELLM_HOSTS) {
    if (baseUrl.includes(`${host}:${LITELLM_PORT_DEFAULT}`)) return "routed";
  }
  // Accept any localhost port as routed (LiteLLM can be configured on non-default ports).
  if (baseUrl.includes("127.0.0.1:") || baseUrl.includes("localhost:")) return "routed";
  return "direct";
}

function buildRoutingMap(cfg: any): Record<string, "routed" | "direct"> {
  const out: Record<string, "routed" | "direct"> = {};
  const providers = cfg?.models?.providers;
  if (!Array.isArray(providers)) return out;
  for (const p of providers) {
    if (!p?.name) continue;
    out[p.name] = classifyRouting(p.base_url ?? p.baseUrl);
  }
  return out;
}

function buildAgents(cfg: any): OpenClawAgent[] {
  const list = cfg?.agents?.list;
  if (!Array.isArray(list)) return [];
  return list
    .map((a: any) => {
      if (!a?.id) return null;
      const rawTools = a.tools?.allow;
      const toolIds = Array.isArray(rawTools) ? rawTools.map((t: any) => String(t)) : [];
      return {
        id: String(a.id),
        name: typeof a.name === "string" && a.name.length > 0 ? a.name : String(a.id),
        model: typeof a.model === "string" ? a.model : "",
        toolIds,
        toolsDeclared: Array.isArray(rawTools),
      } satisfies OpenClawAgent;
    })
    .filter((a): a is OpenClawAgent => a !== null);
}

function buildBindings(cfg: any): OpenClawBinding[] {
  const list = cfg?.bindings;
  if (!Array.isArray(list)) return [];
  const out: OpenClawBinding[] = [];
  for (const b of list) {
    const agentId = b?.agentId;
    const channel = b?.match?.channel;
    const peerKind = b?.match?.peer?.kind;
    const peerId = b?.match?.peer?.id;
    if (
      typeof agentId === "string" &&
      (channel === "discord" || channel === "slack" || channel === "telegram") &&
      typeof peerId === "string"
    ) {
      out.push({ agentId, channel, peerKind: String(peerKind ?? "unknown"), peerId });
    }
  }
  return out;
}

export function scanOpenClaw(): OpenClawLayer {
  const { configPath } = resolveOpenClawPaths();
  const cfg = readOpenClawConfig();
  const readAt = nowIso();

  if (!cfg || !configPath) {
    return {
      discord: null,
      slack: null,
      telegram: null,
      agents: [],
      bindings: [],
      routingByModelPrefix: {},
      configPath: null,
      readAt,
    };
  }

  const channels = (cfg as any).channels ?? {};
  return {
    discord: channels.discord ? buildDiscord(channels.discord, configPath) : null,
    slack: channels.slack ? buildSlack(channels.slack, configPath) : null,
    telegram: channels.telegram ? buildTelegram(channels.telegram, configPath) : null,
    agents: buildAgents(cfg),
    bindings: buildBindings(cfg),
    routingByModelPrefix: buildRoutingMap(cfg),
    configPath,
    readAt,
  };
}

/** Given an agent's model-id (e.g. "agent-fleet/qwen/..." or "openai-codex/gpt-5.4"),
 *  determine whether its provider routes through LiteLLM. Unknown prefixes → "unknown". */
export function classifyAgentPath(
  modelId: string | undefined,
  routingByModelPrefix: Record<string, "routed" | "direct">,
): "routed" | "direct" | "unknown" {
  if (!modelId) return "unknown";
  const prefix = modelId.split("/")[0];
  if (!prefix) return "unknown";
  const entry = routingByModelPrefix[prefix];
  if (entry === "routed" || entry === "direct") return entry;
  return "unknown";
}

// ---------- Discord ----------

function buildDiscord(raw: any, path: string): PermissionPosture {
  const guilds = raw.guilds ?? {};
  const perGuildUsers = new Set<string>();
  const perGuildChannels: string[] = [];
  const approvers: string[] = raw.execApprovals?.approvers ?? [];

  for (const [gid, guild] of Object.entries<any>(guilds)) {
    for (const u of guild.users ?? []) perGuildUsers.add(String(u));
    for (const [cid, ch] of Object.entries<any>(guild.channels ?? {})) {
      if (ch?.allow) perGuildChannels.push(`${gid}/${cid}`);
    }
  }

  return {
    botToken: pv<TokenIdentity>(hashToken(raw.token), prov(`${path}:channels.discord.token`)),
    dmAccessGate: pv(
      {
        allowedUserIds: asStringArr(raw.allowFrom),
        allowAllBypass: (raw.dmPolicy ?? "") === "open",
        policyType: normalizePolicy(raw.dmPolicy),
      },
      prov(`${path}:channels.discord.allowFrom`),
    ),
    groupAccessGate: pv(
      {
        requireMention: true,
        freeResponseChannels: perGuildChannels,
        wakeWordRegexes: [],
        policyType: normalizePolicy(raw.groupPolicy),
      },
      prov(`${path}:channels.discord.guilds (per-guild requireMention + per-channel allow flags)`),
    ),
    channelFilter: pv(
      {
        allowedChannels: perGuildChannels,
        ignoredChannels: [],
        noThreadChannels: [],
      },
      prov(`${path}:channels.discord.guilds.*.channels`),
    ),
    approvalActionAllowlist: pv(
      {
        userIds: Array.from(perGuildUsers),
        allowAllBypass: false,
      },
      prov(`${path}:channels.discord.guilds.*.users`),
    ),
    homeChannel: pv<string>(null, prov(`${path} has no discord home channel`, "unknown")),
    allowAllBypass: pv(
      (raw.dmPolicy ?? "") === "open",
      prov(`${path}:channels.discord.dmPolicy`),
    ),
    pairingApproved: pv([], prov("openclaw has no runtime pairing store", "unknown")),
    execApprovers: pv(
      asStringArr(approvers),
      prov(`${path}:channels.discord.execApprovals.approvers`),
    ),
  };
}

// ---------- Slack ----------

function buildSlack(raw: any, path: string): PermissionPosture {
  return {
    botToken: pv<TokenIdentity>(hashToken(raw.botToken), prov(`${path}:channels.slack.botToken`)),
    dmAccessGate: pv(
      {
        allowedUserIds: asStringArr(raw.allowFrom),
        allowAllBypass: false,
        policyType: normalizePolicy(raw.dmPolicy),
      },
      prov(`${path}:channels.slack.allowFrom`),
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
      prov(`${path}:channels.slack (no channel filter fields)`, "unknown"),
    ),
    approvalActionAllowlist: pv(
      { userIds: asStringArr(raw.allowFrom), allowAllBypass: false },
      prov(`${path}:channels.slack.allowFrom`),
    ),
    homeChannel: pv<string>(null, prov(`${path} has no slack home channel`, "unknown")),
    allowAllBypass: pv(false, prov(`${path}:channels.slack (no allow-all flag)`)),
    pairingApproved: pv([], prov("openclaw has no runtime pairing store", "unknown")),
    execApprovers: pv([], prov(`${path} has no slack execApprovers`, "unknown")),
  };
}

// ---------- Telegram ----------

function buildTelegram(raw: any, path: string): PermissionPosture {
  const groups = raw.groups ?? {};
  const perGroupUsers = new Set<string>();
  for (const g of Object.values<any>(groups)) {
    for (const u of g?.allowFrom ?? []) perGroupUsers.add(String(u));
  }
  for (const u of raw.allowFrom ?? []) perGroupUsers.add(String(u));

  return {
    botToken: pv<TokenIdentity>(hashToken(raw.botToken), prov(`${path}:channels.telegram.botToken`)),
    dmAccessGate: pv(
      {
        allowedUserIds: asStringArr(raw.allowFrom),
        allowAllBypass: false,
        policyType: normalizePolicy(raw.dmPolicy),
      },
      prov(`${path}:channels.telegram.allowFrom`),
    ),
    groupAccessGate: pv(
      {
        requireMention: true,
        freeResponseChannels: [],
        wakeWordRegexes: [],
        policyType: normalizePolicy(raw.groupPolicy),
      },
      prov(`${path}:channels.telegram.groupPolicy`),
    ),
    channelFilter: pv(
      {
        allowedChannels: asStringArr(raw.groupAllowFrom),
        ignoredChannels: [],
        noThreadChannels: [],
      },
      prov(`${path}:channels.telegram.groupAllowFrom`),
    ),
    approvalActionAllowlist: pv(
      { userIds: Array.from(perGroupUsers), allowAllBypass: false },
      prov(`${path}:channels.telegram.groups.*.allowFrom + top-level allowFrom`),
    ),
    homeChannel: pv<string>(
      null,
      prov(
        `${path} has no telegram home channel (hermes profile config.yaml carries TELEGRAM_HOME_CHANNEL)`,
        "unknown",
      ),
    ),
    allowAllBypass: pv(false, prov(`${path}:channels.telegram (no allow-all flag)`)),
    pairingApproved: pv([], prov("openclaw has no runtime pairing store", "unknown")),
    execApprovers: pv([], prov(`${path} has no telegram execApprovers`, "unknown")),
  };
}

// ---------- helpers ----------

function asStringArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

function normalizePolicy(p: unknown): "allowlist" | "open" | "deny" | "not_applicable" {
  if (typeof p !== "string") return "not_applicable";
  const lower = p.toLowerCase();
  if (lower === "allowlist" || lower === "open" || lower === "deny") return lower;
  return "not_applicable";
}
