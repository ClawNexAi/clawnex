/**
 * ClawNex MCP Resources
 *
 * Defines read-only MCP resources that expose ClawNex security data.
 * Each resource performs HTTP calls to the local ClawNex dashboard.
 */

import type { McpServer, ResourceDefinition } from "./types";

const API_BASE = process.env.CLAWNEX_API_URL || "http://127.0.0.1:5001";

/**
 * Helper to make GET API calls to the ClawNex dashboard.
 */
async function apiGet(path: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      return { error: `API returned ${res.status}: ${res.statusText}` };
    }
    return await res.json();
  } catch (err: any) {
    return { error: `Failed to reach ClawNex API: ${err.message}` };
  }
}

/** Resource definitions for the MCP server. */
const resources: ResourceDefinition[] = [
  {
    uri: "clawnex://security-status",
    name: "Security Status",
    description:
      "Current ClawNex security status including system health and prompt shield statistics.",
    mimeType: "application/json",
    handler: async () => {
      const [health, shieldStats] = await Promise.all([
        // /api/health/detailed — authenticated endpoint carrying the
        // operational fields (OpenClaw state, watcher stats, break-glass
        // reason) this resource exposes. MCP co-locates with the Next.js
        // process and hits via 127.0.0.1, so it passes requireLocalhost
        // naturally. Public /api/health returns only minimal identity.
        apiGet("/api/health/detailed"),
        apiGet("/api/shield/stats"),
      ]);

      const combined = {
        health: health.error ? { error: health.error } : health,
        shield: shieldStats.error ? { error: shieldStats.error } : shieldStats,
      };

      return {
        contents: [
          {
            uri: "clawnex://security-status",
            mimeType: "application/json",
            text: JSON.stringify(combined, null, 2),
          },
        ],
      };
    },
  },
  {
    uri: "clawnex://agents",
    name: "Agent Fleet",
    description:
      "List of all AI agents in the ClawNex fleet with their current status.",
    mimeType: "application/json",
    handler: async () => {
      const data = await apiGet("/api/agents");

      const agents = Array.isArray(data)
        ? data
        : data?.agents || data;

      return {
        contents: [
          {
            uri: "clawnex://agents",
            mimeType: "application/json",
            text: JSON.stringify(agents, null, 2),
          },
        ],
      };
    },
  },
  {
    uri: "clawnex://recent-alerts",
    name: "Recent Alerts",
    description: "The 10 most recent open security alerts from ClawNex.",
    mimeType: "application/json",
    handler: async () => {
      const data = await apiGet("/api/alerts?status=open&limit=10");

      const alerts = Array.isArray(data)
        ? data
        : data?.alerts || data;

      return {
        contents: [
          {
            uri: "clawnex://recent-alerts",
            mimeType: "application/json",
            text: JSON.stringify(alerts, null, 2),
          },
        ],
      };
    },
  },
];

/**
 * Register all ClawNex resources with the MCP server.
 */
export function registerResources(server: McpServer): void {
  for (const resource of resources) {
    server.registerResource(resource);
  }
}

export { resources };
