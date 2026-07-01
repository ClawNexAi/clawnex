/**
 * ClawNex MCP Tools
 *
 * Defines MCP tools that wrap ClawNex API endpoints.
 * Each tool performs HTTP calls to the local ClawNex dashboard
 * running at http://127.0.0.1:5001.
 *
 * Every tool invocation is audited via `logEvent` with `source: 'mcp'` so that
 * AI-assistant-driven actions are distinguishable from human-session actions in
 * the audit trail. Three events are emitted per call: `mcp:<tool>:invoked`
 * (before execution with redacted args), then either `mcp:<tool>:completed`
 * (with duration) or `mcp:<tool>:failed` (with error message).
 */

import { logEvent } from "@/lib/services/audit-logger";
import { ALL_RULES } from "@/lib/shield/rules";
import type { McpServer, ToolDefinition, ToolResult } from "./types";

const API_BASE = process.env.CLAWNEX_API_URL || "http://127.0.0.1:5001";

/**
 * Redact argument values whose keys match sensitive-token patterns before
 * writing them to the audit detail field.
 */
function redactArgs(args: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] = /password|api_key|token|secret/i.test(k) ? "***" : v;
  }
  return out;
}

/**
 * Wrap an MCP tool handler body with audit logging. Emits an `invoked` event
 * before execution, then `completed` (with duration) or `failed` (with error)
 * after. All three events use `source: 'mcp'` so they can be filtered out of
 * operator-session queries.
 */
async function auditedInvoke<T>(
  toolName: string,
  args: Record<string, any> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    logEvent(
      "mcp",
      `mcp:${toolName}:invoked`,
      "mcp_tool",
      toolName,
      JSON.stringify(redactArgs(args)).slice(0, 2000),
      "mcp",
    );
  } catch {
    // Never let audit bookkeeping break tool dispatch.
  }
  try {
    const result = await fn();
    try {
      logEvent(
        "mcp",
        `mcp:${toolName}:completed`,
        "mcp_tool",
        toolName,
        `duration_ms=${Date.now() - start}`,
        "mcp",
      );
    } catch {
      // ignore audit-side errors
    }
    return result;
  } catch (err: any) {
    try {
      logEvent(
        "mcp",
        `mcp:${toolName}:failed`,
        "mcp_tool",
        toolName,
        `error=${String(err?.message ?? err).slice(0, 500)}`,
        "mcp",
      );
    } catch {
      // ignore audit-side errors
    }
    throw err;
  }
}

/**
 * Helper to make API calls to the ClawNex dashboard.
 * Returns parsed JSON or an error message.
 */
async function apiCall(
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        error: `API returned ${res.status}: ${data?.error || res.statusText}`,
      };
    }
    return { ok: true, data };
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to reach ClawNex API at ${API_BASE}${path}: ${err.message}`,
    };
  }
}

/** Tool definitions for the MCP server. */
const tools: ToolDefinition[] = [
  {
    name: "shield_scan",
    description:
      // v0.11.6+ — rule count is derived from ALL_RULES.length at module
      // load to prevent doc drift. MCP clients see the live count, not a
      // hardcoded number that goes stale. internal reviewer audit 2026-05-05.
      `Scan text through ClawNex's ${ALL_RULES.length}-rule prompt shield to detect prompt injection, jailbreaks, and other adversarial attacks.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The text to scan for adversarial content",
        },
        direction: {
          type: "string",
          enum: ["inbound", "outbound"],
          description:
            'Whether this is an inbound prompt or outbound response. Defaults to "inbound".',
        },
      },
      required: ["text"],
    },
    handler: async (params: {
      text: string;
      direction?: "inbound" | "outbound";
    }): Promise<ToolResult> => {
      return auditedInvoke("shield_scan", params as any, async () => {
        const result = await apiCall("/api/shield/scan", {
          method: "POST",
          body: JSON.stringify({
            text: params.text,
            direction: params.direction || "inbound",
          }),
        });

        if (!result.ok) {
          return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
        }

        const d = result.data;
        const summary = [
          `Verdict: ${d.verdict || d.result || "unknown"}`,
          `Score: ${d.score ?? d.threat_score ?? "N/A"}`,
          `Detections: ${
            d.detections
              ? Array.isArray(d.detections)
                ? d.detections.map((det: any) => det.rule || det.name || det).join(", ")
                : JSON.stringify(d.detections)
              : "none"
          }`,
        ].join("\n");

        return { content: [{ type: "text", text: summary }] };
      });
    },
  },
  {
    name: "check_posture",
    description:
      "Get the current ClawNex security posture including threat score, posture score, and service health.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    handler: async (): Promise<ToolResult> => {
      return auditedInvoke("check_posture", {}, async () => {
        const result = await apiCall("/api/fleet");

        if (!result.ok) {
          return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
        }

        const d = result.data;
        const summary = [
          `Threat Score: ${d.threatScore ?? d.threat_score ?? "N/A"}`,
          `Posture Score: ${d.postureScore ?? d.posture_score ?? "N/A"}`,
          `Services: ${
            d.services
              ? Object.entries(d.services)
                  .map(([k, v]: [string, any]) => `${k}: ${v.status || v}`)
                  .join(", ")
              : JSON.stringify(d)
          }`,
        ].join("\n");

        return { content: [{ type: "text", text: summary }] };
      });
    },
  },
  {
    name: "query_threats",
    description: "Get active security alerts and threats from ClawNex.",
    inputSchema: {
      type: "object" as const,
      properties: {
        severity: {
          type: "string",
          description: 'Filter by severity level (e.g. "critical", "high", "medium", "low")',
        },
        limit: {
          type: "number",
          description: "Maximum number of alerts to return. Defaults to 20.",
        },
      },
    },
    handler: async (params: {
      severity?: string;
      limit?: number;
    }): Promise<ToolResult> => {
      return auditedInvoke("query_threats", params as any, async () => {
        const qs = new URLSearchParams({ status: "open" });
        if (params.severity) qs.set("severity", params.severity);
        if (params.limit) qs.set("limit", String(params.limit));

        const result = await apiCall(`/api/alerts?${qs.toString()}`);

        if (!result.ok) {
          return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
        }

        const alerts = Array.isArray(result.data)
          ? result.data
          : result.data?.alerts || [];

        if (alerts.length === 0) {
          return { content: [{ type: "text", text: "No open alerts found." }] };
        }

        const lines = alerts.map(
          (a: any, i: number) =>
            `${i + 1}. [${(a.severity || "unknown").toUpperCase()}] ${a.title || a.message || a.description || "Untitled"} (source: ${a.source || "unknown"})`
        );

        return {
          content: [
            { type: "text", text: `Active Alerts (${alerts.length}):\n${lines.join("\n")}` },
          ],
        };
      });
    },
  },
  {
    name: "review_audit",
    description: "Query the ClawNex audit trail for recent security events.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Filter by action type",
        },
        since: {
          type: "string",
          description: "ISO 8601 timestamp to filter events after (e.g. 2026-04-01T00:00:00Z)",
        },
        limit: {
          type: "number",
          description: "Maximum number of events to return. Defaults to 20.",
        },
      },
    },
    handler: async (params: {
      action?: string;
      since?: string;
      limit?: number;
    }): Promise<ToolResult> => {
      return auditedInvoke("review_audit", params as any, async () => {
        const qs = new URLSearchParams();
        if (params.action) qs.set("action", params.action);
        if (params.since) qs.set("since", params.since);
        if (params.limit) qs.set("limit", String(params.limit));

        const qsStr = qs.toString();
        const result = await apiCall(`/api/audit${qsStr ? `?${qsStr}` : ""}`);

        if (!result.ok) {
          return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
        }

        const events = Array.isArray(result.data)
          ? result.data
          : result.data?.events || [];

        if (events.length === 0) {
          return { content: [{ type: "text", text: "No audit events found." }] };
        }

        const lines = events.map(
          (e: any, i: number) =>
            `${i + 1}. [${e.timestamp || "?"}] ${e.action || e.type || "unknown"}: ${e.details || e.description || e.message || JSON.stringify(e)}`
        );

        return {
          content: [
            { type: "text", text: `Audit Events (${events.length}):\n${lines.join("\n")}` },
          ],
        };
      });
    },
  },
  {
    name: "manage_access",
    description:
      "Add or remove entries in ClawNex IP/domain deny lists.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["add", "remove"],
          description: "Whether to add or remove the entry",
        },
        list_type: {
          type: "string",
          enum: ["deny"],
          description: "Which list to modify. ClawNex currently supports deny lists only.",
        },
        entry_type: {
          type: "string",
          enum: ["IP", "DOMAIN"],
          description: "Type of entry (IP address or domain)",
        },
        value: {
          type: "string",
          description: "The IP address or domain to add/remove",
        },
        reason: {
          type: "string",
          description: "Optional reason for the change (for audit trail)",
        },
      },
      required: ["action", "list_type", "entry_type", "value"],
    },
    handler: async (params: {
      action: "add" | "remove";
      list_type: "deny";
      entry_type: "IP" | "DOMAIN";
      value: string;
      reason?: string;
    }): Promise<ToolResult> => {
      return auditedInvoke("manage_access", params as any, async () => {
        const method = params.action === "add" ? "POST" : "DELETE";
        const body = {
          list_type: params.list_type,
          entry_type: params.entry_type,
          value: params.value,
          reason: params.reason || `MCP ${params.action} via AI assistant`,
        };

        const result = await apiCall("/api/access-lists", {
          method,
          body: JSON.stringify(body),
        });

        if (!result.ok) {
          return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully ${params.action === "add" ? "added" : "removed"} ${params.entry_type} "${params.value}" ${params.action === "add" ? "to" : "from"} ${params.list_type} list.`,
            },
          ],
        };
      });
    },
  },
  // ── Enhanced MCP Tools (v0.7.0) ──

  {
    name: "configure_provider",
    description:
      "Add, test, or remove an AI model provider in ClawNex. Providers connect to LLM backends (OpenAI, Anthropic, LM Studio, etc.).",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["add", "test", "remove", "list"],
          description: "Action to perform",
        },
        name: { type: "string", description: "Provider name (for add/remove)" },
        type: { type: "string", description: "Provider type: openai, anthropic, lmstudio, openrouter, etc. (for add)" },
        base_url: { type: "string", description: "Provider API base URL (for add)" },
        api_key: { type: "string", description: "Provider API key (for add)" },
        provider_id: { type: "string", description: "Provider ID (for remove/test)" },
      },
      required: ["action"],
    },
    async handler(params: Record<string, any>): Promise<ToolResult> {
      return auditedInvoke("configure_provider", params, async () => {
        if (params.action === "list") {
          const result = await apiCall("/api/config/providers");
          if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
          const providers = result.data?.map((p: any) => `${p.name} (${p.type}) — ${p.status || 'unknown'}`).join("\n") || "No providers configured";
          return { content: [{ type: "text", text: `Configured providers:\n${providers}` }] };
        }

        if (params.action === "add") {
          const result = await apiCall("/api/config/providers", {
            method: "POST",
            body: JSON.stringify({ name: params.name, type: params.type, base_url: params.base_url, api_key: params.api_key }),
          });
          if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
          return { content: [{ type: "text", text: `Provider "${params.name}" added successfully.` }] };
        }

        if (params.action === "test") {
          const result = await apiCall(`/api/config/providers/${params.provider_id}/test`, { method: "POST" });
          if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
          return { content: [{ type: "text", text: `Provider test: ${result.data?.status || 'completed'}` }] };
        }

        if (params.action === "remove") {
          const result = await apiCall(`/api/config/providers/${params.provider_id}`, { method: "DELETE" });
          if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
          return { content: [{ type: "text", text: `Provider removed.` }] };
        }

        return { content: [{ type: "text", text: `Unknown action: ${params.action}` }], isError: true };
      });
    },
  },

  {
    name: "generate_report",
    description:
      "Generate an executive report from ClawNex. Available types: executive_summary, security_posture, cost_analysis, compliance_evidence, incident_report.",
    inputSchema: {
      type: "object" as const,
      properties: {
        report_type: {
          type: "string",
          enum: ["executive_summary", "security_posture", "cost_analysis", "compliance_evidence", "incident_report"],
          description: "Type of report to generate",
        },
        format: {
          type: "string",
          enum: ["markdown", "json"],
          description: "Output format (default: markdown)",
        },
        time_range: {
          type: "string",
          enum: ["24h", "7d", "30d"],
          description: "Time range for the report (default: 24h)",
        },
      },
      required: ["report_type"],
    },
    async handler(params: Record<string, any>): Promise<ToolResult> {
      return auditedInvoke("generate_report", params, async () => {
        const result = await apiCall("/api/reports/generate", {
          method: "POST",
          body: JSON.stringify({
            type: params.report_type,
            format: params.format || "markdown",
            timeRange: params.time_range || "24h",
          }),
        });
        if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };

        const report = typeof result.data?.content === "string"
          ? result.data.content
          : JSON.stringify(result.data, null, 2);

        return { content: [{ type: "text", text: report.slice(0, 4000) }] };
      });
    },
  },

  {
    name: "run_shield_tests",
    description:
      "Run the 27-payload adversarial test suite against the Prompt Shield. Returns pass/fail results for each test payload.",
    inputSchema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description: "Optional: filter tests by category (jailbreak, injection, exfiltration, encoding, social_engineering)",
        },
      },
    },
    async handler(params: Record<string, any>): Promise<ToolResult> {
      return auditedInvoke("run_shield_tests", params, async () => {
        const url = params.category
          ? `/api/shield/scan?test=true&category=${params.category}`
          : "/api/shield/scan?test=true";

        const result = await apiCall(url, { method: "POST", body: JSON.stringify({ runTests: true }) });
        if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };

        const tests = result.data;
        const summary = Array.isArray(tests)
          ? `${tests.filter((t: any) => t.passed).length}/${tests.length} passed`
          : "Test completed";

        return { content: [{ type: "text", text: `Shield test results: ${summary}\n\n${JSON.stringify(tests, null, 2).slice(0, 3000)}` }] };
      });
    },
  },

  {
    name: "run_trust_audit",
    description:
      "Run a Trust Boundary & Blast Radius audit. Analyzes surfaces, agents, tools, and configuration to identify permission-to-impact risk.",
    inputSchema: {
      type: "object" as const,
      properties: {
        severity_filter: {
          type: "string",
          enum: ["all", "critical", "high", "medium", "low"],
          description: "Filter findings by minimum severity (default: all)",
        },
      },
    },
    async handler(params: Record<string, any>): Promise<ToolResult> {
      return auditedInvoke("run_trust_audit", params, async () => {
        const result = await apiCall("/api/trust-audit");
        if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };

        const report = result.data;
        let findings = report.findings || [];

        if (params.severity_filter && params.severity_filter !== "all") {
          const sevOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
          const minSev = sevOrder[params.severity_filter] || 0;
          findings = findings.filter((f: any) => (sevOrder[f.severity] || 0) >= minSev);
        }

        const summary = `Trust Audit — ${report.summary.overallSeverity.toUpperCase()}\n` +
          `Surfaces: ${report.summary.surfaceCount} | Agents: ${report.summary.agentCount} | Findings: ${findings.length}\n` +
          `Critical: ${report.summary.findingCounts.critical} | High: ${report.summary.findingCounts.high} | ` +
          `Medium: ${report.summary.findingCounts.medium} | Low: ${report.summary.findingCounts.low}\n\n` +
          findings.map((f: any) => `[${f.severity.toUpperCase()}] ${f.title}\n  Why: ${f.whyItMatters.slice(0, 120)}\n  Fix: ${f.recommendedFix.slice(0, 120)}`).join("\n\n");

        return { content: [{ type: "text", text: summary.slice(0, 4000) }] };
      });
    },
  },

  {
    name: "manage_budget",
    description:
      "View or set cost budget thresholds for AI spending. Alerts when spending approaches or exceeds the budget.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["get", "set"],
          description: "Get current budget or set a new one",
        },
        daily_limit_usd: {
          type: "number",
          description: "Daily spending limit in USD (for set action)",
        },
        alert_threshold_pct: {
          type: "number",
          description: "Alert when spending reaches this percentage of the limit (default: 80)",
        },
      },
      required: ["action"],
    },
    async handler(params: Record<string, any>): Promise<ToolResult> {
      return auditedInvoke("manage_budget", params, async () => {
        if (params.action === "get") {
          const result = await apiCall("/api/config/defaults");
          if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };

          const settings = result.data || {};
          const budget = settings.cost_budget_daily_usd || "not set";
          const threshold = settings.cost_alert_threshold_pct || "80";

          return { content: [{ type: "text", text: `Daily budget: $${budget}\nAlert threshold: ${threshold}%` }] };
        }

        if (params.action === "set") {
          const updates: Record<string, string> = {};
          if (params.daily_limit_usd !== undefined) updates.cost_budget_daily_usd = String(params.daily_limit_usd);
          if (params.alert_threshold_pct !== undefined) updates.cost_alert_threshold_pct = String(params.alert_threshold_pct);

          const result = await apiCall("/api/config/defaults", {
            method: "PUT",
            body: JSON.stringify(updates),
          });
          if (!result.ok) return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };

          return { content: [{ type: "text", text: `Budget updated. Daily limit: $${params.daily_limit_usd || 'unchanged'}, Alert threshold: ${params.alert_threshold_pct || 80}%` }] };
        }

        return { content: [{ type: "text", text: `Unknown action: ${params.action}` }], isError: true };
      });
    },
  },
];

/**
 * Register all ClawNex tools with the MCP server.
 */
export function registerTools(server: McpServer): void {
  for (const tool of tools) {
    server.registerTool(tool);
  }
}

export { tools };
