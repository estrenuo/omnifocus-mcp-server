/**
 * Tag tools: list, add/remove on a single task, and batch add/remove.
 */

import { server } from "../server.js";
import { executeAndParseJSON } from "../executor.js";
import type { TagData, TaskData } from "../types.js";
import { sanitizeInput, sanitizeArray } from "../sanitization.js";
import { TAG_MAPPER, TASK_MAPPER } from "../mappers.js";
import { generateFindTaskScript } from "../helpers.js";
import {
  ListTagsInputSchema,
  AddTagInputSchema,
  RemoveTagInputSchema,
  BatchAddTagInputSchema,
  BatchRemoveTagInputSchema
} from "../schemas.js";

// ============================================================================
// Tool: List Tags
// ============================================================================

server.registerTool(
  "omnifocus_list_tags",
  {
    title: "List Tags",
    description: `List tags in OmniFocus.

Tags (formerly contexts) are used to categorize tasks by context, person, tool, etc.

Args:
  - status (string): Filter by status - 'all', 'active', 'onHold', 'dropped' (default: 'active')
  - limit (number): Maximum tags to return, 1-200 (default: 50)

Returns:
  Array of tag objects with: id, name, status, taskCount, allowsNextAction, parentName

Examples:
  - List active tags: {}
  - List all tags: { status: "all" }`,
    inputSchema: ListTagsInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { status, limit } = params;
    
    let statusFilter = "";
    if (status !== "all") {
      if (status === "active") {
        statusFilter = `.filter(function(t) { return !t.hidden(); })`;
      } else if (status === "dropped" || status === "onHold") {
        statusFilter = `.filter(function(t) { return t.hidden(); })`;
      }
    }

    const script = `
      ${TAG_MAPPER}
      var allTags = doc.flattenedTags()${statusFilter}.slice(0, ${limit});
      JSON.stringify(allTags.map(mapTag));
    `;
    
    try {
      const tags = await executeAndParseJSON<TagData[]>(script);
      
      if (tags.length === 0) {
        return {
          content: [{ type: "text", text: "No tags found." }]
        };
      }
      
      const output = {
        count: tags.length,
        tags: tags
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error listing tags: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Add Tag to Task
// ============================================================================

server.registerTool(
  "omnifocus_add_tag_to_task",
  {
    title: "Add Tag to Task",
    description: `Add a tag to a task in OmniFocus.

Use either the task ID or task name to identify the task.

Args:
  - taskId (string, optional): The task's ID. Takes priority if both taskId and taskName provided.
  - taskName (string, optional): The task's name to search for. At least one of taskId or taskName is required.
  - tagName (string): Name of the tag to add

Returns:
  The updated task object

Examples:
  - By ID: { taskId: "abc123", tagName: "Urgent" }
  - By name: { taskName: "Write report", tagName: "Urgent" }`,
    inputSchema: AddTagInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { taskId, taskName, tagName } = params;

    // Sanitize user inputs
    const safeTaskId = taskId ? sanitizeInput(taskId, 100) : null;
    const safeTaskName = taskName ? sanitizeInput(taskName, 500) : null;
    const safeTagName = sanitizeInput(tagName, 200);

    if (!safeTaskId && !safeTaskName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either taskId or taskName must be provided" }]
      };
    }

    const findTaskScript = generateFindTaskScript(safeTaskId, safeTaskName);

    const script = `
      ${TASK_MAPPER}
      ${findTaskScript}

      var tag = doc.flattenedTags().find(function(t) { return t.name() === "${safeTagName}"; });
      if (!tag) { throw new Error("Tag not found: ${safeTagName}"); }

      // Check if tag is already on task
      var existingTag = task.tags().find(function(t) { return t.name() === "${safeTagName}"; });
      if (!existingTag) {
        app.add(tag, { to: task.tags });
      }

      JSON.stringify(mapTask(task));
    `;

    try {
      const task = await executeAndParseJSON<TaskData>(script);

      return {
        content: [{
          type: "text",
          text: `Tag added:\n${JSON.stringify(task, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error adding tag: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Remove Tag from Task
// ============================================================================

server.registerTool(
  "omnifocus_remove_tag_from_task",
  {
    title: "Remove Tag from Task",
    description: `Remove a tag from a task in OmniFocus.

Use either the task ID or task name to identify the task.

Args:
  - taskId (string, optional): The task's ID. Takes priority if both taskId and taskName provided.
  - taskName (string, optional): The task's name to search for. At least one of taskId or taskName is required.
  - tagName (string): Name of the tag to remove

Returns:
  The updated task object

Examples:
  - By ID: { taskId: "abc123", tagName: "Urgent" }
  - By name: { taskName: "Old task", tagName: "Done" }`,
    inputSchema: RemoveTagInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { taskId, taskName, tagName } = params;

    // Sanitize user inputs
    const safeTaskId = taskId ? sanitizeInput(taskId, 100) : null;
    const safeTaskName = taskName ? sanitizeInput(taskName, 500) : null;
    const safeTagName = sanitizeInput(tagName, 200);

    if (!safeTaskId && !safeTaskName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either taskId or taskName must be provided" }]
      };
    }

    const findTaskScript = generateFindTaskScript(safeTaskId, safeTaskName);

    const script = `
      ${TASK_MAPPER}
      ${findTaskScript}

      var tagOnTask = task.tags().find(function(t) { return t.name() === "${safeTagName}"; });
      if (tagOnTask) {
        app.remove(tagOnTask, { from: task.tags });
      }

      JSON.stringify(mapTask(task));
    `;

    try {
      const task = await executeAndParseJSON<TaskData>(script);

      return {
        content: [{
          type: "text",
          text: `Tag removed:\n${JSON.stringify(task, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error removing tag: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Batch Add Tag to Tasks
// ============================================================================

server.registerTool(
  "omnifocus_batch_add_tag",
  {
    title: "Batch Add Tag to Tasks",
    description: `Add the same tag to multiple tasks in one operation.

The tag must already exist. Tasks that already have the tag are left unchanged.

Args:
  - taskIds (array): Array of task IDs to tag (1-100)
  - tagName (string): Name of the tag to add

Returns:
  Summary with counts and the updated tasks, plus any per-task failures

Examples:
  - Tag several tasks: { taskIds: ["id1", "id2"], tagName: "Urgent" }`,
    inputSchema: BatchAddTagInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { taskIds, tagName } = params;

    const safeTaskIds = sanitizeArray(taskIds, 100, 100);
    const taskIdsJson = JSON.stringify(safeTaskIds);
    const safeTagName = sanitizeInput(tagName, 200);

    const script = `
      ${TASK_MAPPER}
      var tag = doc.flattenedTags().find(function(t) { return t.name() === "${safeTagName}"; });
      if (!tag) { throw new Error("Tag not found: ${safeTagName}"); }

      var targetIds = ${taskIdsJson};
      var allTasks = doc.flattenedTasks();
      var results = { successful: [], failed: [] };

      targetIds.forEach(function(taskId) {
        try {
          var task = allTasks.find(function(t) { return t.id() === taskId; });
          if (!task) {
            results.failed.push({ taskId: taskId, error: "Task not found" });
            return;
          }
          var existingTag = task.tags().find(function(t) { return t.name() === "${safeTagName}"; });
          if (!existingTag) {
            app.add(tag, { to: task.tags });
          }
          results.successful.push(mapTask(task));
        } catch (e) {
          results.failed.push({ taskId: taskId, error: String(e) });
        }
      });

      JSON.stringify(results);
    `;

    try {
      const results = await executeAndParseJSON<{
        successful: TaskData[];
        failed: Array<{ taskId: string; error: string }>;
      }>(script);

      const output = {
        totalRequested: taskIds.length,
        successCount: results.successful.length,
        failureCount: results.failed.length,
        tasks: results.successful,
        failures: results.failed
      };

      return {
        content: [{
          type: "text",
          text: `Tag "${tagName}" added to ${results.successful.length} task(s)${results.failed.length > 0 ? ` (${results.failed.length} failed)` : ""}:\n${JSON.stringify(output, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error in batch add tag: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Batch Remove Tag from Tasks
// ============================================================================

server.registerTool(
  "omnifocus_batch_remove_tag",
  {
    title: "Batch Remove Tag from Tasks",
    description: `Remove the same tag from multiple tasks in one operation.

Tasks that do not have the tag are left unchanged.

Args:
  - taskIds (array): Array of task IDs to untag (1-100)
  - tagName (string): Name of the tag to remove

Returns:
  Summary with counts and the updated tasks, plus any per-task failures

Examples:
  - Untag several tasks: { taskIds: ["id1", "id2"], tagName: "Waiting" }`,
    inputSchema: BatchRemoveTagInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { taskIds, tagName } = params;

    const safeTaskIds = sanitizeArray(taskIds, 100, 100);
    const taskIdsJson = JSON.stringify(safeTaskIds);
    const safeTagName = sanitizeInput(tagName, 200);

    const script = `
      ${TASK_MAPPER}
      var targetIds = ${taskIdsJson};
      var allTasks = doc.flattenedTasks();
      var results = { successful: [], failed: [] };

      targetIds.forEach(function(taskId) {
        try {
          var task = allTasks.find(function(t) { return t.id() === taskId; });
          if (!task) {
            results.failed.push({ taskId: taskId, error: "Task not found" });
            return;
          }
          var tagOnTask = task.tags().find(function(t) { return t.name() === "${safeTagName}"; });
          if (tagOnTask) {
            app.remove(tagOnTask, { from: task.tags });
          }
          results.successful.push(mapTask(task));
        } catch (e) {
          results.failed.push({ taskId: taskId, error: String(e) });
        }
      });

      JSON.stringify(results);
    `;

    try {
      const results = await executeAndParseJSON<{
        successful: TaskData[];
        failed: Array<{ taskId: string; error: string }>;
      }>(script);

      const output = {
        totalRequested: taskIds.length,
        successCount: results.successful.length,
        failureCount: results.failed.length,
        tasks: results.successful,
        failures: results.failed
      };

      return {
        content: [{
          type: "text",
          text: `Tag "${tagName}" removed from ${results.successful.length} task(s)${results.failed.length > 0 ? ` (${results.failed.length} failed)` : ""}:\n${JSON.stringify(output, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error in batch remove tag: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);
