#!/bin/bash
# ClawNex MCP Server Startup Script
# Runs the MCP server using npx tsx (TypeScript execution)
#
# Usage:
#   ./scripts/start-mcp.sh              # stdio only (for Claude Code)
#   MCP_ENABLED=1 ./scripts/start-mcp.sh  # stdio + HTTP SSE on port 5002
#   MCP_PORT=5003 MCP_ENABLED=1 ./scripts/start-mcp.sh  # custom SSE port

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec npx tsx src/mcp/server.ts
