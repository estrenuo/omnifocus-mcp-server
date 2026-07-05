#!/usr/bin/env node

/**
 * OmniFocus MCP Server
 *
 * A Model Context Protocol server for interacting with OmniFocus on macOS
 * via Omni Automation (JavaScript for Automation).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";
import { startHttpServer } from "./http.js";

// Tool registrations (side-effect imports)
import "./tools/tasks.js";
import "./tools/projects.js";
import "./tools/folders.js";
import "./tools/tags.js";
import "./tools/reviews.js";
import "./tools/perspectives.js";
import "./tools/search.js";

// Re-exports so existing imports from index (tests, external consumers) keep working
export type { TaskData, ProjectData, FolderData, TagData, PerspectiveData } from "./types.js";
export { sanitizeInput, sanitizeArray } from "./sanitization.js";
export { executeOmniFocusScript, executeAndParseJSON } from "./executor.js";
export { STATUS_MAP, generateFindTaskScript, generateFindProjectScript, generateFindFolderScript, generateTagFilter } from "./helpers.js";
export { TASK_MAPPER, PROJECT_MAPPER, FOLDER_MAPPER, TAG_MAPPER, PERSPECTIVE_MAPPER } from "./mappers.js";
export { server } from "./server.js";
export { startHttpServer } from "./http.js";

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";

  if (transportMode === "http") {
    const port = Number(process.env.MCP_HTTP_PORT ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`Invalid MCP_HTTP_PORT: ${process.env.MCP_HTTP_PORT}`);
    }
    await startHttpServer({
      port,
      host: process.env.MCP_HTTP_HOST ?? "127.0.0.1",
      authToken: process.env.MCP_AUTH_TOKEN ?? ""
    });
  } else if (transportMode === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("OmniFocus MCP Server running on stdio");
  } else {
    throw new Error(`Unknown MCP_TRANSPORT: ${transportMode} (expected "stdio" or "http")`);
  }
}

// Only auto-connect when run directly (not when imported for tests)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/index.js') ||
  process.argv[1].endsWith('/index.ts')
);

if (isDirectRun) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
