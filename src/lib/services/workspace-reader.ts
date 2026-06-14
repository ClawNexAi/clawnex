/**
 * ClawNex Workspace Reader — READ-ONLY access to OpenClaw workspace files.
 *
 * Reads agent workspace files (SOUL.md, AGENTS.md, RULES.md, TOOLS.md, etc.)
 * from the local OpenClaw installation. Used by the Agent Workspace panel.
 *
 * Layouts supported:
 * - **Legacy (pre-2026-04):** one shared `~/.openclaw/workspace/` directory with
 *   soul files at `workspace/agents/<name>.md` and a registry at
 *   `workspace/agents-registry.json`.
 * - **Hyphenated per-agent (2026-04 → 2026-04-22):** each non-default agent has
 *   its own workspace at `~/.openclaw/workspace-<agentId>/`.
 * - **Plural per-agent (OpenClaw 2026.4.x onward):** each non-default agent has
 *   its own workspace at `~/.openclaw/workspaces/<agentId>/`. This is what
 *   `openclaw agents add` creates today. The default agent's workspace stays at
 *   `~/.openclaw/workspace/` (singular, no name suffix) regardless of layout.
 *   The registry is synthesized from `openclaw.json` `agents.list` since the
 *   flat registry JSON no longer exists.
 *
 * Security:
 * - Strict path traversal protection: blocks ../, .env, credentials, .git, node_modules
 * - All paths resolved relative to the OpenClaw home and validated
 * - Resolved path must remain under OpenClaw home (prevents symlink escape)
 * - File content is served as-is (no execution, no template rendering)
 *
 * Workspace roots:
 * - OPENCLAW_HOME env var, or ~/.openclaw — the outer parent, used for safe-root
 * - OPENCLAW_WORKSPACE_PATH env var, or ~/.openclaw/workspace — the shared workspace
 *
 * @module services/workspace-reader
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readOpenClawConfig, normalizeOpenClawModel } from '@/lib/openclaw-paths';
import { getAgentRole } from './agent-roles';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getOpenClawHome(): string {
  const envPath = process.env.OPENCLAW_HOME;
  if (envPath) return path.resolve(envPath);
  return path.join(os.homedir(), '.openclaw');
}

/**
 * Resolve the workspace directory for an agent.
 *
 * The default agent (id="main", or no id) lives at `~/.openclaw/workspace/`
 * regardless of layout era. Other agents live at one of two per-agent paths.
 * We probe the newer `workspaces/<id>/` first (OpenClaw 2026.4.x canonical
 * layout) and fall back to the older hyphenated `workspace-<id>/`. If neither
 * exists, the new convention is returned so writes/probes still target the
 * canonical place.
 */
function getWorkspacePath(agentId?: string): string {
  const ocHome = getOpenClawHome();

  // Default agent: shared singular workspace.
  if (!agentId || agentId === 'main') {
    const envPath = process.env.OPENCLAW_WORKSPACE_PATH;
    if (envPath) return path.resolve(envPath);
    return path.join(ocHome, 'workspace');
  }

  // Per-agent: prefer the 4.12+ plural layout, fall back to legacy hyphenated.
  const pluralPath = path.join(ocHome, 'workspaces', agentId);
  if (fs.existsSync(pluralPath)) return pluralPath;
  const hyphenatedPath = path.join(ocHome, `workspace-${agentId}`);
  if (fs.existsSync(hyphenatedPath)) return hyphenatedPath;
  return pluralPath; // canonical default for missing dirs
}

// Paths that must never be exposed
const DENIED_PATHS = [
  '.env',
  '.env.local',
  '.env.production',
  'credentials',
  'credentials.json',
  'secrets',
  '.git',
  'node_modules',
  '.DS_Store',
];

// Key workspace files (top-level docs)
const KEY_FILES = [
  'SOUL.md',
  'AGENTS.md',
  'RULES.md',
  'TOOLS.md',
  'MEMORY.md',
  'IDENTITY.md',
  'SECURITY.md',
  'TEAM.md',
  'USER.md',
  'WORKFLOWS.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
  'agents-registry.json',
  'openclaw.json',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceFileInfo {
  name: string;
  relativePath: string;
  size: number;
  modified: string;
  isDirectory: boolean;
}

export interface AgentRegistryEntry {
  name: string;
  codename: string;
  emoji: string;
  role: string;
  model: string;
  agentId: string;
  soul_path: string;
  notes: string;
}

export interface AgentRegistry {
  agents: AgentRegistryEntry[];
}

export interface AgentFileInfo extends WorkspaceFileInfo {
  registry?: AgentRegistryEntry;
}

export interface WorkspaceSummary {
  workspacePath: string;
  exists: boolean;
  keyFileCount: number;
  agentFileCount: number;
  totalSize: number;
  lastModified: string;
  files: WorkspaceFileInfo[];
}

// ---------------------------------------------------------------------------
// Security: Secret Redaction
// ---------------------------------------------------------------------------
//
// `workspace:read` is granted to the `operator` role (see permissions.ts).
// Operators can therefore call this API for any allowed workspace file,
// including config files that legitimately contain provider API keys, gateway
// tokens, and similar secrets (openclaw.json, hermes config.yaml, .env-ish
// content). Path traversal is guarded — but the contents of allowed files
// were returned verbatim, which is a privilege escalation: an operator-tier
// account could read openclaw.json and pull every provider's API key.
//
// Closes CX-R14-02 by mask-redacting any value whose key matches the list
// below before content leaves the reader. The masking pattern preserves the
// shape of the file (operators can still see which keys are configured) but
// hides the actual secret value. Pattern is regex-based and works against
// JSON, YAML, and TOML-style key/value lines without needing format-specific
// parsers.

const SECRET_KEY_NAMES = [
  'api_key', 'apiKey', 'apikey',
  'secret', 'secret_key', 'secretKey',
  'token', 'bearer', 'access_token', 'accessToken',
  'password', 'passwd',
  'private_key', 'privateKey',
  'client_secret', 'clientSecret',
  'auth_token', 'authToken',
  'webhook_secret', 'webhookSecret',
];

// Build one global regex that matches `<key>: <value>` and `"<key>": <value>`
// across JSON/YAML/TOML. The value group is intentionally permissive — it
// matches any non-newline, non-quote-close character so we replace the whole
// thing with `<redacted>`. Tested against:
//   "apiKey": "sk-or-v1-abcd"   (JSON)
//   apiKey: sk-or-v1-abcd        (YAML, unquoted)
//   apiKey: "sk-or-v1-abcd"      (YAML, quoted)
//   api_key = "sk-..."           (TOML)
const REDACT_PATTERN = new RegExp(
  '(["\']?(?:' + SECRET_KEY_NAMES.join('|') + ')["\']?\\s*[:=]\\s*)' +  // key:
  '(["\']?)' +                                                          // optional opening quote
  '([^"\'\\n,}\\]]+)' +                                                 // value
  '(["\']?)',                                                           // optional closing quote
  'gi',
);

function redactSecrets(content: string): string {
  return content.replace(REDACT_PATTERN, (_match, prefix, openQuote, _value, closeQuote) => {
    return `${prefix}${openQuote}<redacted>${closeQuote}`;
  });
}

// ---------------------------------------------------------------------------
// Security: Path Validation
// ---------------------------------------------------------------------------

/**
 * Lexical `path.resolve()` + string-prefix is *not* sufficient when readFileSync
 * follows symlinks. An attacker who can write a symlink inside the allowed root
 * can point it at /etc/passwd and the prefix check passes — but readFileSync
 * happily serves the contents. After the lexical check passes, canonicalize
 * both sides through any symlinks and re-compare.
 *
 * Returns false on any failure (target missing, broken symlink, root gone) —
 * the read-side callers fail naturally on the subsequent stat/read.
 */
function realpathContainsSync(root: string, target: string): boolean {
  try {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    return realTarget === realRoot || realTarget.startsWith(realRoot + path.sep);
  } catch {
    return false;
  }
}

function isPathSafe(workspaceRoot: string, requestedPath: string): boolean {
  const resolved = path.resolve(workspaceRoot, requestedPath);
  // Must be within workspace root (lexical)
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    return false;
  }
  // Check denied paths
  const segments = requestedPath.split(path.sep);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (DENIED_PATHS.some(d => lower === d.toLowerCase() || lower.startsWith(d.toLowerCase()))) {
      return false;
    }
  }
  // Symlink-escape guard: if the target exists, follow symlinks and confirm
  // the canonical target still lives under the canonical root.
  if (fs.existsSync(resolved) && !realpathContainsSync(workspaceRoot, resolved)) {
    return false;
  }
  return true;
}

/**
 * Resolve a workspace-reader relative path to an absolute file path.
 * Supports both the legacy shared layout and the new per-agent layout.
 *
 * Accepted shapes:
 *   "SOUL.md"                  → resolved against the main workspace (legacy)
 *   "agents/hubspot-soul.md"   → resolved against the main workspace (legacy)
 *   "workspace-hubspot/SOUL.md" → resolved against ~/.openclaw (new per-agent layout)
 *
 * Returns null if the path is unsafe or escapes the OpenClaw home.
 */
function resolveWorkspaceReadPath(requestedPath: string, agentId?: string): string | null {
  const ocHome = getOpenClawHome();
  const mainRoot = getWorkspacePath(agentId);

  // Denied segment check applies regardless of root.
  const segments = requestedPath.split(/[/\\]/);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (DENIED_PATHS.some(d => lower === d.toLowerCase() || lower.startsWith(d.toLowerCase()))) {
      return null;
    }
  }

  // Paths that explicitly reference a per-agent workspace or the raw agents
  // directory are resolved against the OpenClaw home (new layout). Three
  // shapes route here: legacy hyphenated (`workspace-<id>/...`), the 4.12+
  // plural (`workspaces/<id>/...`), and the raw agents tree (`agents/...`).
  const useOpenClawHome =
    /^workspace-[^/\\]+[/\\]/.test(requestedPath) ||
    /^workspaces[/\\][^/\\]+[/\\]/.test(requestedPath) ||
    /^agents[/\\]/.test(requestedPath);
  const root = useOpenClawHome ? ocHome : mainRoot;
  const resolved = path.resolve(root, requestedPath);

  // Must remain under the chosen root (lexical)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  // Belt-and-braces: must also remain under the OpenClaw home (lexical)
  if (resolved !== ocHome && !resolved.startsWith(ocHome + path.sep)) return null;

  // Symlink-escape guard: if the target exists, the canonical form (with all
  // symlinks resolved) must still live under the OpenClaw home. Without this
  // a symlink at $OPENCLAW_HOME/agents/foo → /etc/passwd would slip through
  // because readFileSync follows the link.
  if (fs.existsSync(resolved) && !realpathContainsSync(ocHome, resolved)) return null;

  return resolved;
}

// ---------------------------------------------------------------------------
// Service Methods
// ---------------------------------------------------------------------------

/**
 * List key workspace files with metadata.
 */
export function listWorkspaceFiles(agentId?: string): WorkspaceFileInfo[] {
  const root = getWorkspacePath(agentId);
  if (!fs.existsSync(root)) return [];

  const results: WorkspaceFileInfo[] = [];

  for (const fileName of KEY_FILES) {
    const fullPath = path.join(root, fileName);
    try {
      const stat = fs.statSync(fullPath);
      results.push({
        name: fileName,
        relativePath: fileName,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        isDirectory: stat.isDirectory(),
      });
    } catch {
      // File doesn't exist — skip
    }
  }

  // Also include agents/ directory entry
  const agentsDir = path.join(root, 'agents');
  try {
    const stat = fs.statSync(agentsDir);
    results.push({
      name: 'agents/',
      relativePath: 'agents',
      size: 0,
      modified: stat.mtime.toISOString(),
      isDirectory: true,
    });
  } catch {
    // no agents dir
  }

  return results;
}

/**
 * Read a specific workspace file by relative path (READ-ONLY).
 *
 * Path may reference either the main shared workspace (legacy) or a per-agent
 * workspace at `workspace-<agentId>/...` (new layout). Path traversal protections
 * are enforced via `resolveWorkspaceReadPath()`.
 */
export function readWorkspaceFile(relativePath: string, agentId?: string): { content: string; info: WorkspaceFileInfo } | null {
  const fullPath = resolveWorkspaceReadPath(relativePath, agentId);
  if (!fullPath) {
    console.warn(`[WORKSPACE] Blocked path traversal attempt: ${relativePath}`);
    return null;
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) return null;

    const raw = fs.readFileSync(fullPath, 'utf-8');
    // Mask provider/gateway/token secrets before returning to the caller.
    // `workspace:read` is granted broadly; operators must not see plaintext
    // credentials embedded in openclaw.json or similar config files.
    const content = redactSecrets(raw);
    return {
      content,
      info: {
        name: path.basename(fullPath),
        relativePath,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        isDirectory: false,
      },
    };
  } catch {
    return null;
  }
}

/**
 * List one file entry per discovered agent.
 *
 * Tries the legacy shared-workspace layout first:
 *   `~/.openclaw/workspace/agents/<name>.md`
 *
 * If the legacy dir is missing or empty, falls back to the per-agent layout:
 *   scan `~/.openclaw/agents/<agentId>/` directories and point each entry at
 *   `workspace-<agentId>/SOUL.md`. Agents without a SOUL.md are still listed
 *   (size/modified empty) so the operator sees them in the tab bar.
 */
export function getAgentFiles(): WorkspaceFileInfo[] {
  // 1. Legacy layout: workspace/agents/*.md
  const legacyDir = path.join(getWorkspacePath(), 'agents');
  if (fs.existsSync(legacyDir)) {
    try {
      const entries = fs.readdirSync(legacyDir);
      const legacyFiles = entries
        .filter(name => name.endsWith('.md'))
        .map(name => {
          const fullPath = path.join(legacyDir, name);
          const stat = fs.statSync(fullPath);
          return {
            name,
            relativePath: path.join('agents', name),
            size: stat.size,
            modified: stat.mtime.toISOString(),
            isDirectory: false,
          };
        });
      if (legacyFiles.length > 0) return legacyFiles;
    } catch { /* fall through */ }
  }

  // 2. Per-agent layout: walk `~/.openclaw/agents/<id>/` and resolve each
  //    agent's SOUL.md via getWorkspacePath, which auto-picks between the
  //    plural (4.12+) and hyphenated (older) layouts. Main is included so
  //    the operator gets a tab for the default agent too — its files come
  //    from `~/.openclaw/workspace/` and the relativePath stays "workspace/".
  const ocHome = getOpenClawHome();
  const agentsParent = path.join(ocHome, 'agents');
  if (!fs.existsSync(agentsParent)) return [];

  const results: WorkspaceFileInfo[] = [];
  try {
    const agentDirs = fs.readdirSync(agentsParent, { withFileTypes: true });
    for (const dir of agentDirs) {
      if (!dir.isDirectory()) continue;
      const agentId = dir.name;

      // Resolve the agent's workspace dir (plural-first, hyphenated fallback,
      // singular for main). Then construct a relativePath that is rooted at
      // the OpenClaw home so the panel's file fetch can re-resolve it.
      const wsDir = getWorkspacePath(agentId);
      const wsRelDir = path.relative(ocHome, wsDir); // "workspace" | "workspaces/<id>" | "workspace-<id>"
      const soulPath = path.join(wsDir, 'SOUL.md');
      const relativePath = path.join(wsRelDir, 'SOUL.md');

      try {
        const stat = fs.statSync(soulPath);
        results.push({
          name: `${agentId}-soul.md`,
          relativePath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          isDirectory: false,
        });
      } catch {
        // Agent dir exists but no SOUL.md — still surface the agent so the operator sees the tab.
        results.push({
          name: `${agentId}-soul.md`,
          relativePath,
          size: 0,
          modified: '',
          isDirectory: false,
        });
      }
    }
  } catch { /* ignore */ }

  // Pin the default `main` agent to position 0, alphabetize the rest. main
  // is OpenClaw's persistent operator workspace and should anchor the tab
  // bar regardless of any custom-named agents the operator has added.
  results.sort((a, b) => {
    const aIsMain = a.name === "main-soul.md" || a.relativePath.startsWith("workspace/");
    const bIsMain = b.name === "main-soul.md" || b.relativePath.startsWith("workspace/");
    if (aIsMain && !bIsMain) return -1;
    if (bIsMain && !aIsMain) return 1;
    return a.name.localeCompare(b.name);
  });
  return results;
}

/**
 * Parse agents-registry.json if present, otherwise synthesize a registry from
 * openclaw.json's `agents.list` so newer installs (without a standalone
 * registry file) still show agent metadata in the Agent Workspace panel.
 */
export function getAgentRegistry(): AgentRegistry | null {
  // 1. Legacy: workspace/agents-registry.json
  const registryPath = path.join(getWorkspacePath(), 'agents-registry.json');
  try {
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as AgentRegistry;
    if (parsed?.agents && parsed.agents.length > 0) return parsed;
  } catch { /* fall through */ }

  // 2. Synthesize from openclaw.json agents.list. Main is included so the
  //    operator sees a tab for the default agent alongside any others.
  const config = readOpenClawConfig();
  if (!config) return null;
  const ocHome = getOpenClawHome();
  const agentsList = ((config.agents as { list?: unknown })?.list || []) as Array<Record<string, unknown>>;
  const synthesized: AgentRegistryEntry[] = [];
  for (const a of agentsList) {
    const id = a.id as string | undefined;
    if (!id) continue;
    const identity = (a.identity as Record<string, unknown> | undefined) || {};

    // Resolve the per-agent workspace dir using the same layout-detection logic
    // the panel uses, so soul_path matches what's actually on disk regardless
    // of which layout era this install is on.
    const wsDir = getWorkspacePath(id);
    const wsRelDir = path.relative(ocHome, wsDir); // "workspace" | "workspaces/<id>" | "workspace-<id>"

    // Role comes from ClawNex's known-agents map (agent-roles.ts) since
    // OpenClaw 4.12's openclaw.json schema rejects `role` as a field. We
    // still try a.role / identity.role first in case a future OpenClaw
    // schema version adds it back, but the canonical source today is the
    // KNOWN_AGENT_ROLES constant.
    const roleFromOpenclaw = (a.role as string) || (identity.role as string) || '';
    const role = roleFromOpenclaw || getAgentRole(id);

    synthesized.push({
      name: (a.name as string) || (identity.name as string) || id,
      codename: id,
      emoji: (identity.emoji as string) || '\u{1F916}',
      role,
      model: normalizeOpenClawModel(a.model, 'default'),
      agentId: id,
      soul_path: path.join(wsRelDir, 'SOUL.md'),
      notes: (a.notes as string) || '',
    });
  }
  if (synthesized.length === 0) return null;
  return { agents: synthesized };
}

/**
 * List agent files enriched with registry metadata.
 *
 * Matches registry entries to files by:
 *   1. Exact soul_path match (works for any layout if both sides agree)
 *   2. agentId extracted from path prefix:
 *      - `workspaces/<id>/...` (4.12+ plural)
 *      - `workspace-<id>/...` (legacy hyphenated)
 *      - `workspace/...` → main (singular default)
 */
export function getAgentFilesWithRegistry(): AgentFileInfo[] {
  const files = getAgentFiles();
  const registry = getAgentRegistry();

  if (!registry) return files;

  return files.map(file => {
    let registryEntry = registry.agents.find(a => a.soul_path === file.relativePath);
    if (!registryEntry) {
      // Try plural layout first: workspaces/<id>/...
      let match = file.relativePath.match(/^workspaces[/\\]([^/\\]+)[/\\]/);
      if (match) {
        registryEntry = registry.agents.find(a => a.agentId === match![1]);
      }
      // Then legacy hyphenated: workspace-<id>/...
      if (!registryEntry) {
        match = file.relativePath.match(/^workspace-([^/\\]+)[/\\]/);
        if (match) {
          registryEntry = registry.agents.find(a => a.agentId === match![1]);
        }
      }
      // Then main: workspace/... (singular, no name suffix)
      if (!registryEntry && /^workspace[/\\]/.test(file.relativePath)) {
        registryEntry = registry.agents.find(a => a.agentId === 'main');
      }
    }
    return { ...file, registry: registryEntry };
  });
}

// ---------------------------------------------------------------------------
// Hermes Workspace Support
// ---------------------------------------------------------------------------

function getHermesHome(): string {
  return path.join(os.homedir(), '.hermes');
}

const HERMES_FILES = [
  'config.yaml',
  'memories/MEMORY.md',
  'memories/USER.md',
];

const HERMES_DIRS = ['skills', 'logs'];

/**
 * List files from the Hermes workspace (~/.hermes/).
 */
export function listHermesFiles(): WorkspaceFileInfo[] {
  const root = getHermesHome();
  if (!fs.existsSync(root)) return [];

  const results: WorkspaceFileInfo[] = [];

  // Known files
  for (const relPath of HERMES_FILES) {
    const fullPath = path.join(root, relPath);
    try {
      const stat = fs.statSync(fullPath);
      results.push({
        name: path.basename(relPath),
        relativePath: relPath,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        isDirectory: false,
      });
    } catch { /* skip missing */ }
  }

  // Scan known directories
  for (const dir of HERMES_DIRS) {
    const dirPath = path.join(root, dir);
    try {
      if (!fs.existsSync(dirPath)) continue;
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            results.push({
              name: entry,
              relativePath: path.join(dir, entry),
              size: stat.size,
              modified: stat.mtime.toISOString(),
              isDirectory: false,
            });
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return results;
}

/**
 * Return Hermes "agents" — platform entries (cli, telegram, etc.) shown as agent tabs.
 */
export function getHermesAgents(): WorkspaceFileInfo[] {
  const root = getHermesHome();
  if (!fs.existsSync(root)) return [];

  // Check for platform subdirectories or just return the config as single entry
  const configPath = path.join(root, 'config.yaml');
  try {
    const stat = fs.statSync(configPath);
    return [{
      name: 'hermes-cli',
      relativePath: 'config.yaml',
      size: stat.size,
      modified: stat.mtime.toISOString(),
      isDirectory: false,
    }];
  } catch {
    return [];
  }
}

/**
 * Read a specific file from the Hermes workspace (~/.hermes/) with path traversal guard.
 */
export function readHermesFile(relativePath: string): { content: string; info: WorkspaceFileInfo } | null {
  const root = getHermesHome();

  // Denied segment check
  const segments = relativePath.split(/[/\\]/);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (DENIED_PATHS.some(d => lower === d.toLowerCase() || lower.startsWith(d.toLowerCase()))) {
      console.warn(`[WORKSPACE] Blocked Hermes path traversal attempt: ${relativePath}`);
      return null;
    }
    if (lower === '..') return null;
  }

  const resolved = path.resolve(root, relativePath);
  // Must remain under Hermes home (lexical)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

  // Symlink-escape guard: canonical target must still live under Hermes home.
  if (fs.existsSync(resolved) && !realpathContainsSync(root, resolved)) return null;

  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return null;
    const raw = fs.readFileSync(resolved, 'utf-8');
    // See workspace-side rationale: mask secrets before return.
    const content = redactSecrets(raw);
    return {
      content,
      info: {
        name: path.basename(resolved),
        relativePath,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        isDirectory: false,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Return a summary for the Hermes workspace.
 */
export function getHermesSummary(): WorkspaceSummary {
  const root = getHermesHome();
  const exists = fs.existsSync(root);

  if (!exists) {
    return { workspacePath: root, exists: false, keyFileCount: 0, agentFileCount: 0, totalSize: 0, lastModified: '', files: [] };
  }

  const files = listHermesFiles();
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const lastModified = files.length > 0
    ? files.reduce((latest, f) => f.modified > latest ? f.modified : latest, files[0].modified)
    : '';

  return { workspacePath: root, exists: true, keyFileCount: files.length, agentFileCount: 1, totalSize, lastModified, files };
}

/**
 * Return an overview of the workspace.
 */
export function getWorkspaceSummary(agentId?: string): WorkspaceSummary {
  const root = getWorkspacePath(agentId);
  const exists = fs.existsSync(root);

  if (!exists) {
    return {
      workspacePath: root,
      exists: false,
      keyFileCount: 0,
      agentFileCount: 0,
      totalSize: 0,
      lastModified: '',
      files: [],
    };
  }

  const files = listWorkspaceFiles();
  const agentFiles = getAgentFiles();
  const allFiles = [...files, ...agentFiles];

  const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
  const lastModified = allFiles.length > 0
    ? allFiles.reduce((latest, f) => f.modified > latest ? f.modified : latest, allFiles[0].modified)
    : '';

  return {
    workspacePath: root,
    exists: true,
    keyFileCount: files.filter(f => !f.isDirectory).length,
    agentFileCount: agentFiles.length,
    totalSize,
    lastModified,
    files: allFiles,
  };
}
