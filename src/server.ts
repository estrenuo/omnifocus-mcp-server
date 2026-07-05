import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ============================================================================
// MCP Server Setup
// ============================================================================

export const server = new McpServer({
  name: "omnifocus-mcp-server",
  version: "1.0.0"
});
