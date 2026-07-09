/**
 * Perspective tools: list perspectives and read a perspective's tasks.
 */

import { server } from "../server.js";
import { executeAndParseJSON } from "../executor.js";
import type { PerspectiveData, TaskData } from "../types.js";
import { sanitizeInput } from "../sanitization.js";
import { PERSPECTIVE_MAPPER, TASK_MAPPER } from "../mappers.js";
import {
  ListPerspectivesInputSchema,
  GetPerspectiveTasksInputSchema
} from "../schemas.js";

// ============================================================================
// Tool: List Perspectives
// ============================================================================

server.registerTool(
  "omnifocus_list_perspectives",
  {
    title: "List Perspectives",
    description: `List perspectives in OmniFocus.

Perspectives are saved views/filters that show specific subsets of tasks. Includes both built-in and custom perspectives.

Args:
  - limit (number): Maximum perspectives to return, 1-200 (default: 50)

Returns:
  Array of perspective objects with: id, name

Examples:
  - List perspectives: {}
  - Limit results: { limit: 10 }`,
    inputSchema: ListPerspectivesInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { limit } = params;

    const script = `
      ${PERSPECTIVE_MAPPER}
      JSON.stringify(mapPerspectives(${limit}));
    `;

    try {
      const perspectives = await executeAndParseJSON<PerspectiveData[]>(script);

      if (perspectives.length === 0) {
        return {
          content: [{ type: "text", text: "No perspectives found." }]
        };
      }

      const output = {
        count: perspectives.length,
        perspectives: perspectives
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error listing perspectives: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Get Perspective Tasks
// ============================================================================

server.registerTool(
  "omnifocus_get_perspective_tasks",
  {
    title: "Get Perspective Tasks",
    description: `Get tasks shown in a specific OmniFocus perspective.

Switches the front OmniFocus window to the named perspective, reads the tasks it displays, then restores the original perspective.

Args:
  - perspectiveName (string): Name of the perspective (use omnifocus_list_perspectives to find names)
  - limit (number): Maximum tasks to return, 1-500 (default: 50)

Returns:
  Array of task objects with: id, name, note, completed, flagged, dueDate, deferDate, projectName, tags, estimatedMinutes

Examples:
  - Get tasks from a perspective: { perspectiveName: "Next" }
  - With limit: { perspectiveName: "Forecast", limit: 10 }`,
    inputSchema: GetPerspectiveTasksInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { perspectiveName, limit } = params;

    const safePerspectiveName = sanitizeInput(perspectiveName, 200);

    const script = `
      ${TASK_MAPPER}
      var win = doc.documentWindows[0];
      if (!win) { throw new Error("No OmniFocus window is open. Please open OmniFocus."); }

      var originalPerspective = win.perspectiveName();
      win.perspectiveName = "${safePerspectiveName}";

      // Verify the perspective was applied
      if (win.perspectiveName() !== "${safePerspectiveName}") {
        throw new Error("Perspective not found: ${safePerspectiveName}");
      }

      var content = win.content();
      var leafIds = content.leaves.id();

      // Restore original perspective
      win.perspectiveName = originalPerspective;

      // Build a lookup set for fast matching
      var idSet = {};
      leafIds.forEach(function(id) { idSet[id] = true; });

      // Find matching tasks and map them
      var matched = doc.flattenedTasks().filter(function(t) {
        return idSet[t.id()] === true;
      }).slice(0, ${limit});

      JSON.stringify(matched.map(mapTask));
    `;

    try {
      const tasks = await executeAndParseJSON<TaskData[]>(script);

      if (tasks.length === 0) {
        return {
          content: [{ type: "text", text: `No tasks found in perspective "${perspectiveName}".` }]
        };
      }

      const output = {
        perspectiveName,
        count: tasks.length,
        tasks
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error getting perspective tasks: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);
