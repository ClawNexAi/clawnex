/**
 * ClawNex MCP Type Definitions
 *
 * Shared types for the minimal MCP server implementation.
 */

/** Content item returned by a tool. */
export interface TextContent {
  type: "text";
  text: string;
}

/** Result returned from a tool handler. */
export interface ToolResult {
  content: TextContent[];
  isError?: boolean;
}

/** JSON Schema for tool input parameters. */
export interface InputSchema {
  type: "object";
  properties: Record<string, any>;
  required?: string[];
}

/** Definition of an MCP tool. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: InputSchema;
  handler: (params: any) => Promise<ToolResult>;
}

/** Content item returned by a resource. */
export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

/** Result returned from a resource handler. */
export interface ResourceResult {
  contents: ResourceContent[];
}

/** Definition of an MCP resource. */
export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: () => Promise<ResourceResult>;
}

/** Interface for the MCP server that tools/resources register with. */
export interface McpServer {
  registerTool(tool: ToolDefinition): void;
  registerResource(resource: ResourceDefinition): void;
}
