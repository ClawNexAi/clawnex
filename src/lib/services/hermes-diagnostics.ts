/**
 * Hermes diagnostics
 *
 * Builds a secret-safe, path-aware connection summary for Hermes Agent.
 * ClawNex reads Hermes data in read-only mode and never returns raw tokens,
 * prompts, message bodies, or config secrets from this module.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "@/lib/config";
import { scanProfileSkills } from "@/lib/services/permissiveness/scanners/hermes";

export type HermesDiagnosticState =
  | "not_installed"
  | "state_db_missing"
  | "state_db_unreadable"
  | "schema_mismatch"
  | "idle"
  | "stale"
  | "live";

export interface HermesDiagnostics {
  home: string;
  stateDbPath: string;
  installed: boolean;
  stateDbExists: boolean;
  stateDbReadable: boolean;
  schemaOk: boolean;
  available: boolean;
  status: HermesDiagnosticState;
  statusDetail: string | null;
  activeProfile: string | null;
  activeProfileSource: "active_profile" | "single_profile" | "none";
  profiles: {
    count: number;
    names: string[];
  };
  channels: {
    configured: string[];
    observed: string[];
  };
  skills: {
    count: number;
    profilesWithSkills: number;
  };
  tools: {
    count: number;
    names: string[];
    profilesWithTools: number;
  };
  sessions: {
    total: number;
    last24h: number;
  };
  messages: {
    total: number;
    last24h: number;
    lastId: number;
  };
  lastActivity: string | null;
  lastActivityAgeSeconds: number | null;
  watcher: {
    enabled: boolean;
    pollIntervalMs: number;
  };
  shieldVisibility: {
    enabled: boolean;
    mode: "watcher-retroscan" | "not-visible";
  };
}

function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

export function resolveHermesDiagnosticsPath(homePath?: string): string {
  return path.resolve(expandHome(homePath || config.hermes.home));
}

function isoFromHermesValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && /^\d+(\.\d+)?$/.test(trimmed)) {
      return isoFromHermesValue(asNumber);
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function ageSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function listProfileNames(home: string): string[] {
  const profilesDir = path.join(home, "profiles");
  try {
    return fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function readActiveProfile(home: string, profiles: string[]): { name: string | null; source: HermesDiagnostics["activeProfileSource"] } {
  try {
    const value = fs.readFileSync(path.join(home, "active_profile"), "utf8").trim();
    if (value) return { name: value, source: "active_profile" };
  } catch {}
  if (profiles.length === 1) return { name: profiles[0], source: "single_profile" };
  return { name: null, source: "none" };
}

function readJsonKeys(filePath: string): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.keys(parsed).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function configuredChannels(home: string, activeProfile: string | null): string[] {
  const keys = new Set<string>();
  for (const key of readJsonKeys(path.join(home, "channel_directory.json"))) keys.add(key);
  if (activeProfile) {
    for (const key of readJsonKeys(path.join(home, "profiles", activeProfile, "channel_directory.json"))) keys.add(key);
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function skillStats(home: string, profiles: string[]): { count: number; profilesWithSkills: number; tools: HermesDiagnostics["tools"] } {
  let count = 0;
  let profilesWithSkills = 0;
  let profilesWithTools = 0;
  const tools = new Set<string>();
  for (const profile of profiles) {
    const skillsRoot = path.join(home, "profiles", profile, "skills");
    let profileCount = 0;
    try {
      const scanned = scanProfileSkills(path.join(home, "profiles", profile));
      for (const tool of scanned.toolUnion) tools.add(tool);
      if (scanned.toolUnion.length > 0) profilesWithTools++;

      const stack = [skillsRoot];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") profileCount++;
        }
      }
    } catch {}
    if (profileCount > 0) profilesWithSkills++;
    count += profileCount;
  }
  const names = [...tools].sort((a, b) => a.localeCompare(b));
  return {
    count,
    profilesWithSkills,
    tools: {
      count: names.length,
      names: names.slice(0, 25),
      profilesWithTools,
    },
  };
}

function countRecentSql(column: string): string {
  return `SUM(CASE
    WHEN typeof(${column}) IN ('integer','real') AND ${column} > strftime('%s','now','-24 hours') THEN 1
    WHEN typeof(${column}) = 'text' AND datetime(${column}) >= datetime('now','-24 hours') THEN 1
    ELSE 0
  END)`;
}

export function diagnoseHermes(homePath?: string): HermesDiagnostics {
  const home = resolveHermesDiagnosticsPath(homePath);
  const stateDbPath = path.join(home, "state.db");
  const installed = fs.existsSync(home);
  const stateDbExists = fs.existsSync(stateDbPath);
  const profiles = listProfileNames(home);
  const active = readActiveProfile(home, profiles);
  const channelsConfigured = configuredChannels(home, active.name);
  const skills = skillStats(home, profiles);

  const base: HermesDiagnostics = {
    home,
    stateDbPath,
    installed,
    stateDbExists,
    stateDbReadable: false,
    schemaOk: false,
    available: false,
    status: installed ? "state_db_missing" : "not_installed",
    statusDetail: installed ? "Hermes home exists but state.db was not found" : "Hermes home directory was not found",
    activeProfile: active.name,
    activeProfileSource: active.source,
    profiles: { count: profiles.length, names: profiles.slice(0, 20) },
    channels: { configured: channelsConfigured, observed: [] },
    skills: { count: skills.count, profilesWithSkills: skills.profilesWithSkills },
    tools: skills.tools,
    sessions: { total: 0, last24h: 0 },
    messages: { total: 0, last24h: 0, lastId: 0 },
    lastActivity: null,
    lastActivityAgeSeconds: null,
    watcher: {
      enabled: config.hermes.enabled,
      pollIntervalMs: config.hermes.pollIntervalMs,
    },
    shieldVisibility: {
      enabled: false,
      mode: "not-visible",
    },
  };

  if (!installed || !stateDbExists) return base;

  let db: Database.Database | null = null;
  try {
    db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 3000");
    base.stateDbReadable = true;

    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = new Set(tableRows.map((row) => row.name));
    base.schemaOk = tableNames.has("sessions") && tableNames.has("messages");
    if (!base.schemaOk) {
      base.status = "schema_mismatch";
      base.statusDetail = "state.db is readable but missing sessions/messages tables";
      return base;
    }

    const sessionRow = db.prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(${countRecentSql("started_at")}, 0) AS last24h,
         MAX(started_at) AS lastStartedAt
       FROM sessions`,
    ).get() as { total: number; last24h: number; lastStartedAt: unknown } | undefined;

    const messageRow = db.prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(${countRecentSql("timestamp")}, 0) AS last24h,
         COALESCE(MAX(id), 0) AS lastId,
         MAX(timestamp) AS lastTimestamp
       FROM messages`,
    ).get() as { total: number; last24h: number; lastId: number; lastTimestamp: unknown } | undefined;

    const sourceRows = db.prepare(
      "SELECT DISTINCT source FROM sessions WHERE source IS NOT NULL AND TRIM(source) != '' ORDER BY source ASC LIMIT 20",
    ).all() as Array<{ source: string }>;

    const sessionActivity = isoFromHermesValue(sessionRow?.lastStartedAt);
    const messageActivity = isoFromHermesValue(messageRow?.lastTimestamp);
    const lastActivity = [sessionActivity, messageActivity]
      .filter((value): value is string => !!value)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    base.sessions = {
      total: Number(sessionRow?.total ?? 0),
      last24h: Number(sessionRow?.last24h ?? 0),
    };
    base.messages = {
      total: Number(messageRow?.total ?? 0),
      last24h: Number(messageRow?.last24h ?? 0),
      lastId: Number(messageRow?.lastId ?? 0),
    };
    base.channels.observed = sourceRows.map((row) => row.source);
    base.lastActivity = lastActivity;
    base.lastActivityAgeSeconds = ageSeconds(lastActivity);
    base.available = true;
    base.shieldVisibility = {
      enabled: config.hermes.enabled,
      mode: config.hermes.enabled ? "watcher-retroscan" : "not-visible",
    };

    if (!lastActivity) {
      base.status = "idle";
      base.statusDetail = "Hermes is connected, but no session or message activity was found";
    } else if ((base.lastActivityAgeSeconds ?? Number.POSITIVE_INFINITY) > 7 * 24 * 3600) {
      base.status = "stale";
      base.statusDetail = `Hermes is connected, but last activity is older than 7 days`;
    } else {
      base.status = "live";
      base.statusDetail = "Hermes state.db is readable and recent activity is visible";
    }

    return base;
  } catch (err) {
    base.status = "state_db_unreadable";
    base.statusDetail = err instanceof Error ? err.message : "Unable to open Hermes state.db";
    return base;
  } finally {
    try { db?.close(); } catch {}
  }
}
