/**
 * LM Studio Connector — READ-ONLY poller for local model inventory.
 *
 * Polls GET /v1/models on configured LM Studio instances (Fleet and Main).
 * Returns model count, names, status, and latency for the Infrastructure panel.
 *
 * On-demand polling (not continuous) — called when the infrastructure API
 * endpoint is hit, not on a timer. 5-second timeout if unreachable.
 *
 * LM Studio instances are optional. If not configured or unreachable,
 * the connector returns { status: "offline" } gracefully.
 *
 * @module connectors/lmstudio-connector
 */

import { config } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
  created?: number;
}

export interface LMStudioInstance {
  name: string;
  url: string;
  status: "online" | "offline" | "error";
  latency: number;
  models: LMStudioModel[];
  modelCount: number;
  error?: string;
  checkedAt: string;
}

export interface LMStudioInventory {
  fleet: LMStudioInstance;
  main: LMStudioInstance;
  totalModels: number;
  onlineCount: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 5000;

async function pollInstance(name: string, baseUrl: string): Promise<LMStudioInstance> {
  const checkedAt = new Date().toISOString();
  const modelsUrl = `${baseUrl}/models`;
  const start = performance.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(modelsUrl, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    const latency = Math.round(performance.now() - start);

    if (!res.ok) {
      return {
        name,
        url: baseUrl,
        status: "error",
        latency,
        models: [],
        modelCount: 0,
        error: `HTTP ${res.status}: ${res.statusText}`,
        checkedAt,
      };
    }

    const data = await res.json();
    const models: LMStudioModel[] = data.data || [];

    return {
      name,
      url: baseUrl,
      status: "online",
      latency,
      models,
      modelCount: models.length,
      checkedAt,
    };
  } catch (err: unknown) {
    const latency = Math.round(performance.now() - start);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    return {
      name,
      url: baseUrl,
      status: "offline",
      latency,
      models: [],
      modelCount: 0,
      error: isAbort ? `Timeout after ${TIMEOUT_MS}ms` : (err instanceof Error ? err.message : "Unknown error"),
      checkedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Polls both LM Studio instances and returns a combined inventory.
 */
export async function getLMStudioInventory(): Promise<LMStudioInventory> {
  const [fleet, main] = await Promise.all([
    pollInstance(config.lmstudio.fleet.name, config.lmstudio.fleet.url),
    pollInstance(config.lmstudio.main.name, config.lmstudio.main.url),
  ]);

  const onlineCount = [fleet, main].filter((i) => i.status === "online").length;
  const totalModels = fleet.modelCount + main.modelCount;

  return {
    fleet,
    main,
    totalModels,
    onlineCount,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Quick liveness check — returns true if at least one instance is reachable.
 */
export async function isLMStudioAvailable(): Promise<boolean> {
  const inventory = await getLMStudioInventory();
  return inventory.onlineCount > 0;
}
