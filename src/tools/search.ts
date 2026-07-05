/**
 * Search tool: find tasks, projects, folders, and tags by query.
 */

import { server } from "../server.js";
import { executeAndParseJSON } from "../executor.js";
import type { TaskData, ProjectData, FolderData, TagData } from "../types.js";
import { sanitizeInput } from "../sanitization.js";
import { TASK_MAPPER, PROJECT_MAPPER, FOLDER_MAPPER, TAG_MAPPER } from "../mappers.js";
import { SearchInputSchema } from "../schemas.js";

// ============================================================================
// Tool: Search
// ============================================================================

server.registerTool(
  "omnifocus_search",
  {
    title: "Search OmniFocus",
    description: `Search for tasks, projects, folders, or tags in OmniFocus.

Uses OmniFocus's smart matching to find items.

Args:
  - query (string): Search query
  - searchType (string): 'tasks', 'projects', 'folders', 'tags', or 'all' (default: 'all')
  - limit (number): Max results per type, 1-100 (default: 20)

Returns:
  Matching items organized by type

Examples:
  - Search all: { query: "report" }
  - Search projects only: { query: "work", searchType: "projects" }`,
    inputSchema: SearchInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { query, searchType, limit } = params;

    // Sanitize search query
    const safeQuery = sanitizeInput(query, 200);

    const results: Record<string, unknown[]> = {};

    try {
      if (searchType === "tasks" || searchType === "all") {
        const taskScript = `
          ${TASK_MAPPER}
          var q = "${safeQuery}".toLowerCase();
          var matched = doc.flattenedTasks().filter(function(t) {
            var name = t.name().toLowerCase();
            var note = t.note();
            var noteStr = note ? String(note).toLowerCase() : "";
            return name.indexOf(q) !== -1 || noteStr.indexOf(q) !== -1;
          }).slice(0, ${limit});
          JSON.stringify(matched.map(mapTask));
        `;
        results.tasks = await executeAndParseJSON<TaskData[]>(taskScript);
      }

      if (searchType === "projects" || searchType === "all") {
        const projectScript = `
          ${PROJECT_MAPPER}
          var q = "${safeQuery}".toLowerCase();
          var matched = doc.flattenedProjects().filter(function(p) {
            return p.name().toLowerCase().indexOf(q) !== -1;
          }).slice(0, ${limit});
          JSON.stringify(matched.map(mapProject));
        `;
        results.projects = await executeAndParseJSON<ProjectData[]>(projectScript);
      }

      if (searchType === "folders" || searchType === "all") {
        const folderScript = `
          ${FOLDER_MAPPER}
          var q = "${safeQuery}".toLowerCase();
          var matched = doc.flattenedFolders().filter(function(f) {
            return f.name().toLowerCase().indexOf(q) !== -1;
          }).slice(0, ${limit});
          JSON.stringify(matched.map(mapFolder));
        `;
        results.folders = await executeAndParseJSON<FolderData[]>(folderScript);
      }

      if (searchType === "tags" || searchType === "all") {
        const tagScript = `
          ${TAG_MAPPER}
          var q = "${safeQuery}".toLowerCase();
          var matched = doc.flattenedTags().filter(function(t) {
            return t.name().toLowerCase().indexOf(q) !== -1;
          }).slice(0, ${limit});
          JSON.stringify(matched.map(mapTag));
        `;
        results.tags = await executeAndParseJSON<TagData[]>(tagScript);
      }
      
      const totalCount = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
      
      if (totalCount === 0) {
        return {
          content: [{ type: "text", text: `No results found for "${query}".` }]
        };
      }
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({ query, totalCount, results }, null, 2) 
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error searching: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);
