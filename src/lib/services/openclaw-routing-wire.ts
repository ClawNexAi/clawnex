/**
 * OpenClaw routing wire — adds (and reverts) a `models.providers.litellm`
 * entry in `~/.openclaw/openclaw.json` so OpenClaw routes LLM traffic
 * through ClawNex's LiteLLM proxy at 127.0.0.1:4001/v1.
 *
 * Why this module exists:
 *   ClawNex's deploy installs LiteLLM and writes `litellm/config.yaml`,
 *   but never edits `openclaw.json` to make OpenClaw use it. Without
 *   this bridge, OpenClaw bypasses both LiteLLM and the ClawNex shield
 *   and talks directly to providers (e.g. openrouter.ai). the reviewer's QA
 *   surfaced this on staging 2026-04-29.
 *
 * Why a sidecar instead of JSON comments:
 *   OpenClaw uses `JSON.parse` — comments would break it. The sidecar
 *   at `~/.clawnex-routing-managed.json` records every key path we
 *   wrote, a non-secret SHA-256 fingerprint of each value at write time,
 *   ClawNex version, OpenClaw version, and timestamp. Revert reads the
 *   sidecar and
 *   removes only the paths whose current values still match the
 *   recorded SHAs — operator edits made after the wire are preserved.
 *
 * Why direct JSON edit (not `openclaw onboard` shell-out):
 *   Schema is identical for our use case across 2026.3.x and 2026.4.x
 *   (see docs.openclaw.ai/concepts/model-providers — `models.providers`
 *   is canonical on both). Direct edit gives us tighter revert
 *   fidelity and no PATH/sudo brittleness from spawning a child
 *   process out of Next.js. Version is recorded in the sidecar for
 *   future audit / migration if OpenClaw ever does break the shape.
 *
 * Atomicity:
 *   All writes go through a temp-file + rename so openclaw.json never
 *   exists on disk in a partial state. Sidecar writes use the same
 *   pattern. Both files use 0600 perms.
 *
 * Idempotency:
 *   Wire is a no-op if the sidecar shows our values are already on
 *   disk and unchanged. Revert is a no-op if the sidecar is missing
 *   or no managed paths still match their recorded SHAs.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { resolveOpenClawPaths } from '../openclaw-paths';
import { CLAWNEX_VERSION_SHORT } from '../version';
import { commitRoutingFile, publishRoutingFile, removeRoutingJournal } from './routing-file-transaction';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The provider id we own in `models.providers.<id>`. Canonical "litellm"
 *  per OpenClaw docs — picking a different name would break the
 *  `agents.defaults.model.primary = "litellm/<model>"` alias convention
 *  and operator muscle memory. Ownership is tracked via the sidecar,
 *  not the id. */
const PROVIDER_ID = 'litellm';

/** Sidecar path. Outside ~/.openclaw (per "leave OpenClaw alone" rule)
 *  AND outside the ClawNex install dir (which gets wiped on clean
 *  redeploys). Stable across both. Single flat file at $HOME for easy
 *  inspection (`cat ~/.clawnex-routing-managed.json`). */
const SIDECAR_PATH = process.env.CLAWNEX_LEGACY_ROUTING_SIDECAR || path.join(os.homedir(), '.clawnex-routing-managed.json');

/** Schema version for the sidecar. Bump when sidecar shape changes so
 *  older sidecars can be detected and migrated. */
const SIDECAR_VERSION = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ManagedOp = 'set' | 'set-if-missing';

interface ManagedPathRecord {
  /** Dotted path expressed as an array of keys. e.g. ['models', 'providers', 'litellm'] */
  path: string[];
  /** SHA256 of JSON.stringify(value) at write time. Revert checks against this. */
  valueSha256: string;
  /** `set` paths are always removed on revert. `set-if-missing` paths
   *  are only removed if the current value still matches the SHA — if
   *  operator changed the value after wire, revert leaves it alone. */
  operation: ManagedOp;
}

interface SidecarV1 {
  version: 1;
  managedAt: string;
  clawnexVersion: string;
  openclawVersion: string | null;
  providerId: string;
  paths: ManagedPathRecord[];
}

export interface WireResult {
  ok: boolean;
  status: 'wired' | 'already-wired' | 'conflict' | 'no-openclaw' | 'error';
  detail: string;
  /** Whether OpenClaw needs a restart for the change to take effect. */
  restartRequired?: boolean;
  /** Sidecar contents after the operation, if a sidecar now exists. */
  sidecar?: SidecarV1;
}

export interface RevertResult {
  ok: boolean;
  status: 'reverted' | 'nothing-to-revert' | 'conflict' | 'no-openclaw' | 'error';
  detail: string;
  /** Paths that were left in place because their current value diverged
   *  from the recorded SHA AND the operation policy was `set-if-missing`
   *  (operator edited after wire; we respect their value). */
  preservedPaths?: string[][];
  /** Paths that were removed even though the operator had edited them
   *  after wire, because the operation policy was `set` (ClawNex
   *  exclusively owns these slots, so we always reclaim). Surfaced
   *  separately so the UI can be honest about what just happened.
   *  internal reviewer M-01 followup item D, 2026-04-29. */
  reclaimedDespiteEditPaths?: string[][];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function sha256(value: unknown): string {
  // Non-secret integrity fingerprint for app-managed OpenClaw routing slots.
  // This is intentionally stable across ClawNex upgrades so existing sidecars
  // remain readable and reversible.
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function getAtPath(obj: Record<string, unknown>, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

function setAtPath(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

function deleteAtPath(obj: Record<string, unknown>, keys: string[]): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) return;
    cur = cur[k] as Record<string, unknown>;
  }
  delete cur[keys[keys.length - 1]];
}

function atomicWriteJson(targetPath: string, data: unknown): void {
  publishRoutingFile(targetPath, JSON.stringify(data, null, 2), 0o600);
}

function readSidecar(): SidecarV1 | null {
  try {
    if (!fs.existsSync(SIDECAR_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(SIDECAR_PATH, 'utf-8'));
    if (raw && typeof raw === 'object' && raw.version === SIDECAR_VERSION) {
      return raw as SidecarV1;
    }
    throw new Error('Unsupported legacy routing ownership version.');
  } catch {
    throw new Error('Legacy routing ownership is unreadable or corrupt. Preserve the sidecar for recovery review.');
  }
}

// ---------------------------------------------------------------------------
// Wire / revert
// ---------------------------------------------------------------------------

export interface WireOptions {
  /** LiteLLM port. Defaults to `process.env.LITELLM_PORT || "4001"`. */
  litellmPort?: string;
  /** apiKey value. LiteLLM doesn't enforce master_key on default
   *  installs so any non-empty string works. We use a recognizable
   *  marker so it's obvious in logs that ClawNex wrote it. */
  apiKey?: string;
  /** When true, overwrite a pre-existing entry that wasn't written by
   *  us (or whose SHA diverged). Default false → conflict guards win. */
  force?: boolean;
}

/**
 * Wire OpenClaw → LiteLLM. Writes `models.providers.litellm` (always
 * `set`) and optionally `agents.defaults.model.primary` (only if unset
 * — `set-if-missing`). Records ownership in the sidecar.
 */
export function wireLitellmRouting(opts: WireOptions = {}): WireResult {
  const { configPath } = resolveOpenClawPaths();
  if (!configPath) {
    return { ok: false, status: 'no-openclaw', detail: 'openclaw.json not found' };
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    return { ok: false, status: 'error', detail: `Failed to read openclaw.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  const port = opts.litellmPort || process.env.LITELLM_PORT || '4001';
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const apiKey = opts.apiKey || 'clawnex-routed';
  const force = Boolean(opts.force);

  const providerValue = {
    baseUrl,
    apiKey,
    api: 'openai-completions',
    // Empty models array — operator can `openclaw models scan` to
    // populate, or it gets filled by future ClawNex provider mgmt.
    models: [] as unknown[],
  };

  const sidecar = readSidecar();
  const providerPath = ['models', 'providers', PROVIDER_ID];
  const existing = getAtPath(config, providerPath);

  // Conflict guard: if there's already a litellm provider entry that
  // ClawNex didn't write (no sidecar) OR that diverges from what we
  // last wrote (sidecar SHA mismatch), refuse without --force.
  if (existing !== undefined && !force) {
    const existingSha = sha256(existing);
    const recordedSha = sidecar?.paths.find(p => p.path.join('.') === providerPath.join('.'))?.valueSha256;

    if (!recordedSha) {
      return {
        ok: false,
        status: 'conflict',
        detail: `models.providers.${PROVIDER_ID} already exists but is not managed by ClawNex. Use force=true to overwrite, or remove it manually first.`,
      };
    }
    if (existingSha === sha256(providerValue)) {
      // Already wired with our exact value — true no-op.
      return {
        ok: true,
        status: 'already-wired',
        detail: `models.providers.${PROVIDER_ID} is already wired with the expected values.`,
        sidecar: sidecar ?? undefined,
      };
    }
    if (existingSha !== recordedSha) {
      return {
        ok: false,
        status: 'conflict',
        detail: `models.providers.${PROVIDER_ID} was edited externally after ClawNex wired it. Use force=true to overwrite the operator's changes.`,
      };
    }
  }

  // Build the managed-paths list. Each entry records what we wrote and
  // the policy revert should apply.
  const managedPaths: ManagedPathRecord[] = [];

  // Path 1: the provider definition. Always `set` — we own this.
  setAtPath(config, providerPath, providerValue);
  managedPaths.push({
    path: providerPath,
    valueSha256: sha256(providerValue),
    operation: 'set',
  });

  // Path 2: agents.defaults.model.primary — only if unset, so we don't
  // clobber an operator's pinned default. `set-if-missing` means
  // revert preserves the value unless it's still our SHA.
  const primaryPath = ['agents', 'defaults', 'model', 'primary'];
  const primaryExisting = getAtPath(config, primaryPath);
  if (primaryExisting === undefined || primaryExisting === null || primaryExisting === '') {
    const primaryValue = `${PROVIDER_ID}/auto`;
    setAtPath(config, primaryPath, primaryValue);
    managedPaths.push({
      path: primaryPath,
      valueSha256: sha256(primaryValue),
      operation: 'set-if-missing',
    });
  }

  // Atomic write of the modified config.
  try {
    atomicWriteJson(configPath, config);
  } catch (err) {
    return { ok: false, status: 'error', detail: `Failed to write openclaw.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Sidecar.
  const openclawVersion = (config.meta as { lastTouchedVersion?: string } | undefined)?.lastTouchedVersion ?? null;
  const newSidecar: SidecarV1 = {
    version: SIDECAR_VERSION,
    managedAt: new Date().toISOString(),
    clawnexVersion: CLAWNEX_VERSION_SHORT,
    openclawVersion,
    providerId: PROVIDER_ID,
    paths: managedPaths,
  };
  try {
    atomicWriteJson(SIDECAR_PATH, newSidecar);
  } catch (err) {
    // Edge case: openclaw.json got our edits but sidecar write failed.
    // We've polluted operator state without leaving a revert trail.
    // Surface this as a hard error so operator can intervene.
    return {
      ok: false,
      status: 'error',
      detail: `openclaw.json was written but the sidecar at ${SIDECAR_PATH} failed: ${err instanceof Error ? err.message : String(err)}. Manual cleanup may be needed: remove models.providers.${PROVIDER_ID} from ${configPath}.`,
    };
  }

  return {
    ok: true,
    status: 'wired',
    detail: `Wired ${managedPaths.length} path(s). LiteLLM at ${baseUrl}. Restart openclaw-gateway for changes to take effect.`,
    restartRequired: true,
    sidecar: newSidecar,
  };
}

/**
 * Revert the wire. Reads the sidecar, removes only paths whose current
 * value still matches the recorded SHA. Operator edits made after the
 * wire are preserved (returned in `preservedPaths`).
 */
export function revertLitellmRouting(): RevertResult {
  const { configPath } = resolveOpenClawPaths();
  if (!configPath) {
    return { ok: false, status: 'no-openclaw', detail: 'openclaw.json not found' };
  }

  const sidecar = readSidecar();
  if (!sidecar) {
    return {
      ok: true,
      status: 'nothing-to-revert',
      detail: 'No sidecar found. Either ClawNex never wired this fleet or the sidecar was already removed.',
    };
  }

  let config: Record<string, unknown>;
  let expectedRaw: string;
  try {
    expectedRaw = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(expectedRaw);
  } catch (err) {
    return { ok: false, status: 'error', detail: `Failed to read openclaw.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  const preservedPaths: string[][] = [];
  const reclaimedDespiteEditPaths: string[][] = [];
  let anyDeleted = false;

  // Remove matching defaults first; never remove a bridge still referenced by
  // an operator-owned agent/default/fallback selection elsewhere in the file.
  const isBridge = (keys: string[]) => keys.join('.') === 'models.providers.litellm';
  const referencesBridge = (value: unknown): boolean => typeof value === 'string' ? value.startsWith('litellm/')
    : Array.isArray(value) ? value.some(referencesBridge)
    : Boolean(value && typeof value === 'object' && Object.values(value).some(referencesBridge));
  for (const record of [...sidecar.paths].sort((a, b) => Number(isBridge(a.path)) - Number(isBridge(b.path)))) {
    const current = getAtPath(config, record.path);
    if (current === undefined) {
      // Already absent — nothing to do; not a conflict.
      continue;
    }
    const currentSha = sha256(current);
    const operatorEdited = currentSha !== record.valueSha256;
    if (operatorEdited || (isBridge(record.path) && referencesBridge(config.agents))) {
      preservedPaths.push(record.path);
      continue;
    }
    deleteAtPath(config, record.path);
    anyDeleted = true;
  }

  // Clean up empty parent objects we may have created. e.g. if we
  // wrote models.providers.litellm into a previously-empty
  // `models.providers`, deleting the leaf leaves `models.providers: {}`
  // which is benign but ugly. Remove `models.providers` if it's empty
  // after the delete; same for `models`. Only walk paths we owned.
  for (const record of sidecar.paths) {
    for (let i = record.path.length - 1; i > 0; i--) {
      const parent = record.path.slice(0, i);
      const parentVal = getAtPath(config, parent);
      if (parentVal && typeof parentVal === 'object' && Object.keys(parentVal).length === 0) {
        deleteAtPath(config, parent);
      } else {
        break;
      }
    }
  }

  if (anyDeleted) {
    try {
      commitRoutingFile({ configPath, expectedRaw, updatedRaw: JSON.stringify(config, null, 2),
        journalPath: SIDECAR_PATH, expectedJournal: sidecar, recoveryJournal: sidecar });
    } catch (err) {
      return { ok: false, status: 'error', detail: `Failed to write openclaw.json during revert: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Remove sidecar last — once openclaw.json is clean, the sidecar's
  // job is done.
  try {
    if (preservedPaths.length) {
      atomicWriteJson(SIDECAR_PATH, { ...sidecar, paths: sidecar.paths.filter(record =>
        preservedPaths.some(keys => JSON.stringify(keys) === JSON.stringify(record.path))) });
    } else removeRoutingJournal(SIDECAR_PATH);
  } catch (err) {
    return { ok: false, status: 'error', detail: `openclaw.json reverted but sidecar removal failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const detailParts: string[] = ['Reverted.'];
  if (preservedPaths.length > 0) {
    detailParts.push(`${preservedPaths.length} path(s) and their recovery ownership preserved due to operator edits after wire.`);
  }
  if (reclaimedDespiteEditPaths.length > 0) {
    detailParts.push(`${reclaimedDespiteEditPaths.length} ClawNex-owned slot(s) reclaimed despite operator edits (set policy).`);
  }
  if (preservedPaths.length === 0 && reclaimedDespiteEditPaths.length === 0) {
    detailParts.push('No operator edits detected; full clean revert.');
  }
  detailParts.push('Restart openclaw-gateway for changes to take effect.');
  return {
    ok: preservedPaths.length === 0,
    status: preservedPaths.length ? 'conflict' : 'reverted',
    detail: detailParts.join(' '),
    preservedPaths: preservedPaths.length > 0 ? preservedPaths : undefined,
    reclaimedDespiteEditPaths: reclaimedDespiteEditPaths.length > 0 ? reclaimedDespiteEditPaths : undefined,
  };
}

/**
 * Inspect current wire state without modifying anything. Returns the
 * sidecar (if any) plus a report of whether each managed path is
 * present, modified, or removed.
 */
export function inspectLitellmRouting(): {
  sidecar: SidecarV1 | null;
  configFound: boolean;
  status: Array<{ path: string[]; present: boolean; matches: boolean | null }>;
} {
  const { configPath } = resolveOpenClawPaths();
  const sidecar = readSidecar();
  if (!configPath) {
    return { sidecar, configFound: false, status: [] };
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { sidecar, configFound: false, status: [] };
  }

  const status: Array<{ path: string[]; present: boolean; matches: boolean | null }> = [];
  if (sidecar) {
    for (const record of sidecar.paths) {
      const current = getAtPath(config, record.path);
      if (current === undefined) {
        status.push({ path: record.path, present: false, matches: null });
      } else {
        status.push({ path: record.path, present: true, matches: sha256(current) === record.valueSha256 });
      }
    }
  }
  return { sidecar, configFound: true, status };
}
