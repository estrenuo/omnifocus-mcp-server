#!/usr/bin/env node

/**
 * OmniFocus MCP Server
 *
 * A Model Context Protocol server for interacting with OmniFocus on macOS
 * via Omni Automation (JavaScript for Automation).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";

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

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OmniFocus MCP Server running on stdio");
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
