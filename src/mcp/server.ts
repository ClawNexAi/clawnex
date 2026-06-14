/**
 * ClawNex MCP Server
 *
 * Model Context Protocol server for ClawNex AI Agent Fleet Security SOC.
 * Exposes security tools and resources over stdio (JSON-RPC) for Claude Code
 * integration, and optionally over HTTP SSE when MCP_ENABLED is set.
 *
 * Protocol: JSON-RPC 2.0 over stdio, per the MCP specification.
 * See: https://modelcontextprotocol.io/specification
 */

import * as readline from "node:readline";
import * as http from "node:http";
import * as crypto from "node:crypto";
import type {
  McpServer as McpServerInterface,
  ToolDefinition,
  ResourceDefinition,
} from "./types";
import { registerTools } from "./tools";
import { registerResources } from "./resources";
import { CLAWNEX_VERSION_SHORT } from "../lib/version";

const SERVER_NAME = "clawnex";
const SERVER_VERSION = CLAWNEX_VERSION_SHORT;
const PROTOCOL_VERSION = "2024-11-05";

// ---------------------------------------------------------------------------
// Minimal MCP Server Implementation (JSON-RPC 2.0)
// ---------------------------------------------------------------------------

class ClawNexMcpServer implements McpServerInterface {
  private tools: Map<string, ToolDefinition> = new Map();
  private resources: Map<string, ResourceDefinition> = new Map();

  /** Register a tool with the server. */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /** Register a resource with the server. */
  registerResource(resource: ResourceDefinition): void {
    this.resources.set(resource.uri, resource);
  }

  /**
   * Handle an incoming JSON-RPC request and return the response payload.
   */
  async handleRequest(msg: any): Promise<any> {
    const id = msg.id;

    // JSON-RPC notifications (no id) — no response expected
    if (id === undefined || id === null) {
      // Handle initialized notification silently
      return null;
    }

    switch (msg.method) {
      case "initialize":
        return this.rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
        });

      case "ping":
        return this.rpcResult(id, {});

      case "tools/list":
        return this.rpcResult(id, {
          tools: Array.from(this.tools.values()).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case "tools/call": {
        const toolName = msg.params?.name;
        const tool = this.tools.get(toolName);
        if (!tool) {
          return this.rpcError(id, -32602, `Unknown tool: ${toolName}`);
        }
        try {
          const result = await tool.handler(msg.params?.arguments || {});
          return this.rpcResult(id, result);
        } catch (err: any) {
          return this.rpcResult(id, {
            content: [{ type: "text", text: `Tool error: ${err.message}` }],
            isError: true,
          });
        }
      }

      case "resources/list":
        return this.rpcResult(id, {
          resources: Array.from(this.resources.values()).map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          })),
        });

      case "resources/read": {
        const uri = msg.params?.uri;
        const resource = this.resources.get(uri);
        if (!resource) {
          return this.rpcError(id, -32602, `Unknown resource: ${uri}`);
        }
        try {
          const result = await resource.handler();
          return this.rpcResult(id, result);
        } catch (err: any) {
          return this.rpcError(id, -32603, `Resource error: ${err.message}`);
        }
      }

      default:
        return this.rpcError(id, -32601, `Method not found: ${msg.method}`);
    }
  }

  private rpcResult(id: any, result: any) {
    return { jsonrpc: "2.0", id, result };
  }

  private rpcError(id: any, code: number, message: string) {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}

// ---------------------------------------------------------------------------
// Stdio Transport
// ---------------------------------------------------------------------------

function startStdioTransport(server: ClawNexMcpServer): void {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", async (line: string) => {
    if (!line.trim()) return;

    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      const errResp = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
      process.stdout.write(JSON.stringify(errResp) + "\n");
      return;
    }

    const response = await server.handleRequest(msg);
    if (response !== null) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// HTTP SSE Transport (optional, for non-stdio clients)
// ---------------------------------------------------------------------------

// CRITICAL #2 — MCP HTTP SSE auth gate.
//
// The HTTP transport binds to 127.0.0.1, but every local process on the
// host (including unrelated agents, the user's browser, malicious software
// already inside the perimeter) could POST JSON-RPC to /message and invoke
// any MCP tool. configure_provider with an attacker-controlled base_url,
// shield bypass, settings exfil — full SOC compromise from any second
// process. stdio remains the supported primary transport for MCP clients
// like Claude Code; HTTP is opt-in and now requires an API key.
//
// Policy: MCP_API_KEY must be set when MCP_ENABLED is true. Every request
// to /sse and /message presents the same key via either
//   Authorization: Bearer <key>
// or
//   X-MCP-Key: <key>
// Constant-time compare, no logging of the supplied key. Missing or wrong
// key → 401. /health stays open (status probe, no sensitive output).

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function extractMcpKey(req: http.IncomingMessage): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const headerKey = req.headers["x-mcp-key"];
  if (typeof headerKey === "string" && headerKey.length > 0) return headerKey;
  return null;
}

function startSseTransport(server: ClawNexMcpServer, port: number): void {
  const expectedKey = process.env.MCP_API_KEY || "";
  if (!expectedKey) {
    process.stderr.write(
      "[ClawNex MCP] HTTP SSE transport REFUSING to start: MCP_ENABLED is set but MCP_API_KEY is missing.\n" +
      "             Generate a key with: openssl rand -hex 32   then export MCP_API_KEY=...\n" +
      "             Or unset MCP_ENABLED to use stdio only (the primary transport).\n"
    );
    return;
  }

  const httpServer = http.createServer(async (req, res) => {
    // CORS headers — restricted to local dashboard only
    res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5001");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-MCP-Key");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check — intentionally unauthenticated (status probe only,
    // no tool surface, no sensitive output).
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          server: SERVER_NAME,
          version: SERVER_VERSION,
          protocol: PROTOCOL_VERSION,
          status: "ok",
        })
      );
      return;
    }

    // Everything else requires the MCP API key.
    const presented = extractMcpKey(req);
    if (!presented || !timingSafeEqualString(presented, expectedKey)) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer realm=\"mcp\"" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized — present a valid MCP_API_KEY" } }));
      return;
    }

    // SSE endpoint for streaming
    if (req.method === "GET" && req.url === "/sse") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send endpoint info
      res.write(`data: ${JSON.stringify({ endpoint: "/message" })}\n\n`);

      // Keep connection alive
      const keepAlive = setInterval(() => {
        res.write(": keepalive\n\n");
      }, 30_000);

      req.on("close", () => {
        clearInterval(keepAlive);
      });

      return;
    }

    // JSON-RPC message endpoint
    if (req.method === "POST" && req.url === "/message") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      let msg: any;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          })
        );
        return;
      }

      const response = await server.handleRequest(msg);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(port, "127.0.0.1", () => {
    process.stderr.write(
      `[ClawNex MCP] HTTP SSE transport listening on http://127.0.0.1:${port} (MCP_API_KEY required)\n`
    );
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const server = new ClawNexMcpServer();

  // Register tools and resources
  registerTools(server);
  registerResources(server);

  process.stderr.write(
    `[ClawNex MCP] Server v${SERVER_VERSION} starting...\n`
  );
  process.stderr.write(
    `[ClawNex MCP] Registered ${server["tools"].size} tools, ${server["resources"].size} resources\n`
  );

  // Always start stdio transport (primary, for Claude Code)
  startStdioTransport(server);
  process.stderr.write("[ClawNex MCP] Stdio transport ready\n");

  // Optionally start HTTP SSE transport
  if (process.env.MCP_ENABLED) {
    const port = parseInt(process.env.MCP_PORT || "5002", 10);
    startSseTransport(server, port);
  }

  // Graceful shutdown
  const shutdown = () => {
    process.stderr.write("[ClawNex MCP] Shutting down...\n");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[ClawNex MCP] Uncaught exception: ${err.message}\n`);
    process.exit(1);
  });
  process.on("unhandledRejection", (err: any) => {
    process.stderr.write(
      `[ClawNex MCP] Unhandled rejection: ${err?.message || err}\n`
    );
  });
}

main().catch((err) => {
  process.stderr.write(`[ClawNex MCP] Fatal: ${err.message}\n`);
  process.exit(1);
});
