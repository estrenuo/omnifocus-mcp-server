/**
 * Task tools: inbox listing, create/complete/update/delete, batch
 * complete/drop, notes, and due/flagged/planned queries.
 */

import { server } from "../server.js";
import { executeAndParseJSON } from "../executor.js";
import type { TaskData } from "../types.js";
import { sanitizeInput, sanitizeArray } from "../sanitization.js";
import { TASK_MAPPER } from "../mappers.js";
import { generateFindTaskScript, generateTagFilter, generateClearRepetitionScript, buildRRule, generateSetRepetitionScript } from "../helpers.js";
import {
  ListInboxInputSchema,
  CreateTaskInputSchema,
  CompleteTaskInputSchema,
  UpdateTaskInputSchema,
  DeleteTaskInputSchema,
  BatchCompleteTaskInputSchema,
  UpdateTaskNoteInputSchema,
  GetDueTasksInputSchema,
  GetFlaggedTasksInputSchema,
  GetPlannedTasksInputSchema
} from "../schemas.js";

// ============================================================================
// Tool: List Inbox Tasks
// ============================================================================

server.registerTool(
  "omnifocus_list_inbox",
  {
    title: "List Inbox Tasks",
    description: `List tasks in the OmniFocus inbox.

Returns tasks that haven't been assigned to a project yet. These are typically newly captured items awaiting processing.

Args:
  - includeCompleted (boolean): Include completed tasks (default: false)
  - limit (number): Maximum tasks to return, 1-500 (default: 50)
  - tags (array, optional): Filter to tasks matching these tag names (max 20)
  - tagMatchMode (string): How to match tags - 'all' (every tag), 'any' (at least one), 'none' (none of them). Default 'all'. Only applied when tags is provided.

Returns:
  Array of task objects with: id, name, note, completed, flagged, dueDate, deferDate, estimatedMinutes, tags

Examples:
  - List all inbox items: {}
  - Include completed: { includeCompleted: true }
  - Only untagged-by-Work items: { tags: ["Work"], tagMatchMode: "none" }`,
    inputSchema: ListInboxInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { includeCompleted, limit, tags, tagMatchMode } = params;

    const tagFilter = tags ? generateTagFilter(sanitizeArray(tags, 200, 20), tagMatchMode) : "";

    const script = `
      ${TASK_MAPPER}
      var tasks = doc.inboxTasks();
      ${!includeCompleted ? 'tasks = tasks.filter(function(t) { return !t.completed(); });' : ''}
      ${tagFilter}
      tasks = tasks.slice(0, ${limit});
      JSON.stringify(tasks.map(mapTask));
    `;
    
    try {
      const tasks = await executeAndParseJSON<TaskData[]>(script);
      
      if (tasks.length === 0) {
        return {
          content: [{ type: "text", text: "No tasks found in inbox." }]
        };
      }
      
      const output = {
        count: tasks.length,
        tasks: tasks
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error listing inbox: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Create Task
// ============================================================================

server.registerTool(
  "omnifocus_create_task",
  {
    title: "Create Task",
    description: `Create a new task in OmniFocus.

Creates a task in the inbox or a specific project. Tags, due dates, planned dates and other properties can be set. Supports repeating/recurring tasks.

Args:
  - name (string): Task name/title (required)
  - note (string): Optional note/description
  - projectName (string): Project to add to (inbox if not specified)
  - parentTaskId (string): ID of a parent task to create this as a subtask of (takes priority over projectName)
  - dueDate (string): Due date in ISO 8601 format - when the task must be completed
  - deferDate (string): Defer/start date in ISO 8601 format
  - plannedDate (string): Planned date in ISO 8601 format - when you intend to work on the task
  - flagged (boolean): Flag the task (default: false)
  - estimatedMinutes (number): Time estimate in minutes
  - tagNames (array): Tag names to apply
  - recurrence (object): Optional recurrence pattern with:
    - frequency: "daily", "weekly", "monthly", or "yearly"
    - interval: Number of periods between repetitions (default: 1)
    - daysOfWeek: Array of days for weekly recurrence (e.g., ["Monday", "Friday"])
    - dayOfMonth: Day number for monthly recurrence (1-31)
    - monthOfYear: Month number for yearly recurrence (1-12)
    - repeatFrom: "due-date" or "completion-date" (default: "due-date")

Returns:
  The created task object with id, name, and other properties

Examples:
  - Simple task: { name: "Buy groceries" }
  - Task with details: { name: "Review report", projectName: "Work", dueDate: "2024-12-31T17:00:00", flagged: true }
  - Daily recurring: { name: "Daily standup", dueDate: "2024-01-01T09:00:00", recurrence: { frequency: "daily", interval: 1 } }
  - Weekly on Mon/Wed/Fri: { name: "Workout", dueDate: "2024-01-01T07:00:00", recurrence: { frequency: "weekly", daysOfWeek: ["Monday", "Wednesday", "Friday"] } }
  - Monthly on 1st and 15th: { name: "Pay bills", dueDate: "2024-01-01T12:00:00", recurrence: { frequency: "monthly", interval: 1, dayOfMonth: 1 } }
  - Repeat from completion: { name: "Review quarterly", recurrence: { frequency: "monthly", interval: 3, repeatFrom: "completion-date" } }
  - Task with planning: { name: "Write article", plannedDate: "2024-12-15T09:00:00", dueDate: "2024-12-31T17:00:00" }
  - Task with tags: { name: "Call John", tagNames: ["Calls", "Urgent"] }`,
    inputSchema: CreateTaskInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { name, note, projectName, parentTaskId, dueDate, deferDate, plannedDate, flagged, estimatedMinutes, tagNames, recurrence } = params;

    // Sanitize user inputs to prevent injection attacks
    const safeName = sanitizeInput(name, 500);
    const safeNote = note ? sanitizeInput(note, 10000) : "";
    const safeProjectName = projectName ? sanitizeInput(projectName, 500) : null;
    const safeParentTaskId = parentTaskId ? sanitizeInput(parentTaskId, 100) : null;
    const safeDueDate = dueDate ? sanitizeInput(dueDate, 100) : null;
    const safeDeferDate = deferDate ? sanitizeInput(deferDate, 100) : null;
    const safePlannedDate = plannedDate ? sanitizeInput(plannedDate, 100) : null;

    let createScript: string;
    if (safeParentTaskId) {
      // Create as a subtask of an existing task
      createScript = `
        var parentTask = doc.flattenedTasks().find(function(t) { return t.id() === "${safeParentTaskId}"; });
        if (!parentTask) { throw new Error("Parent task not found with ID: ${safeParentTaskId}"); }
        var task = app.Task({name: "${safeName}"});
        parentTask.tasks.push(task);
      `;
    } else if (safeProjectName) {
      createScript = `
        var project = doc.flattenedProjects().find(function(p) { return p.name() === "${safeProjectName}"; });
        if (!project) { throw new Error("Project not found: ${safeProjectName}"); }
        var task = app.Task({name: "${safeName}"});
        project.tasks.push(task);
      `;
    } else {
      createScript = `
        var task = app.InboxTask({name: "${safeName}"});
        doc.inboxTasks.push(task);
      `;
    }

    // Generate recurrence rule script if provided. OmniFocus repetition rules
    // cannot be assigned via direct JXA (a -1700 type-conversion error), so
    // buildRRule + generateSetRepetitionScript apply it through the Omni
    // Automation bridge. Same helpers are used by update_task.
    let recurrenceScript = "";
    if (recurrence) {
      const { ruleString, method } = buildRRule(recurrence);
      recurrenceScript = generateSetRepetitionScript("task", ruleString, method);
    }

    // Sanitize tag names if provided
    const safeTagNames = tagNames && tagNames.length > 0
      ? sanitizeArray(tagNames, 200, 50)
      : [];

    const script = `
      ${TASK_MAPPER}
      ${createScript}
      ${note ? `task.note = "${safeNote}";` : ""}
      ${safeDueDate ? `task.dueDate = new Date("${safeDueDate}");` : ""}
      ${safeDeferDate ? `task.deferDate = new Date("${safeDeferDate}");` : ""}
      ${safePlannedDate ? `try { task.plannedDate = new Date("${safePlannedDate}"); } catch(e) {}` : ""}
      ${flagged ? `task.flagged = true;` : ""}
      ${estimatedMinutes ? `task.estimatedMinutes = ${estimatedMinutes};` : ""}
      ${safeTagNames.length > 0 ? `
        var tagNamesToAdd = ${JSON.stringify(safeTagNames)};
        var allTags = doc.flattenedTags();
        tagNamesToAdd.forEach(function(tagName) {
          var tag = allTags.find(function(t) { return t.name() === tagName; });
          if (tag) { app.add(tag, { to: task.tags }); }
        });
      ` : ""}
      ${recurrenceScript}
      JSON.stringify(mapTask(task));
    `;
    
    try {
      const task = await executeAndParseJSON<TaskData>(script);
      
      return {
        content: [{ 
          type: "text", 
          text: `Task created successfully:\n${JSON.stringify(task, null, 2)}` 
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error creating task: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Complete/Drop Task
// ============================================================================

server.registerTool(
  "omnifocus_complete_task",
  {
    title: "Complete or Drop Task",
    description: `Mark a task as complete or dropped in OmniFocus.

Use either the task ID from list/search results, or the task name for natural language interactions.

Args:
  - taskId (string, optional): The task's ID (primaryKey). Takes priority if both taskId and taskName provided.
  - taskName (string, optional): The task's name to search for. At least one of taskId or taskName is required.
  - action (string): 'complete' (default) or 'drop'

Note: Completing a recurring task advances it to the next occurrence (normal repeat
behavior). Dropping a recurring task cancels the whole series - its repetition rule
is removed first so it does not roll forward to a new active instance.

Returns:
  The updated task object

Examples:
  - Complete by ID: { taskId: "abc123" }
  - Complete by name: { taskName: "Write documentation" }
  - Drop by name: { taskName: "Old task", action: "drop" }`,
    inputSchema: CompleteTaskInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { taskId, taskName, action } = params;

    // Sanitize user inputs
    const safeTaskId = taskId ? sanitizeInput(taskId, 100) : null;
    const safeTaskName = taskName ? sanitizeInput(taskName, 500) : null;

    // Dropping a recurring task otherwise rolls it forward to the next instance
    // (leaving an active clone). Clear the repetition rule first so a drop
    // cancels the whole series. Completing still repeats, as expected.
    const actionCode = action === "drop"
      ? `${generateClearRepetitionScript("task")}
      task.markDropped();`
      : "task.markComplete();";

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
      ${actionCode}
      JSON.stringify(mapTask(task));
    `;

    try {
      const task = await executeAndParseJSON<TaskData>(script);
      const actionVerb = action === "drop" ? "dropped" : "completed";

      return {
        content: [{
          type: "text",
          text: `Task ${actionVerb}:\n${JSON.stringify(task, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error updating task: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Update Task
// ============================================================================

server.registerTool(
  "omnifocus_update_task",
  {
    title: "Update Task",
    description: `Update properties of an existing task in OmniFocus.

Only the fields you provide are changed. Use null to clear a date or note field.

Args:
  - taskId (string, optional): The task's ID. Takes priority if both taskId and taskName provided.
  - taskName (string, optional): The task's name to search for. At least one of taskId or taskName is required.
  - name (string, optional): New task name
  - note (string | null, optional): New note text. Pass null to clear.
  - dueDate (string | null, optional): New due date in ISO 8601 format. Pass null to clear.
  - deferDate (string | null, optional): New defer date in ISO 8601 format. Pass null to clear.
  - plannedDate (string | null, optional): New planned date in ISO 8601 format. Pass null to clear.
  - flagged (boolean, optional): Set flagged state
  - estimatedMinutes (number, optional): Time estimate in minutes. Pass 0 to clear.
  - projectId (string, optional): ID of the project to move the task to.
  - projectName (string, optional): Name of the project to move the task to. Ignored if projectId is provided.
  - recurrence (object | null, optional): Repetition pattern to make the task recurring (same shape as create_task: frequency, interval, daysOfWeek, dayOfMonth, monthOfYear, repeatFrom). Pass null to remove recurrence.
  - clearRecurrence (boolean, optional): Set true to remove the task's repetition rule (turn off recurring). Equivalent to recurrence: null.

Returns:
  The updated task object

Examples:
  - Rename: { taskId: "abc123", name: "New name" }
  - Set due date: { taskId: "abc123", dueDate: "2024-12-31T17:00:00" }
  - Clear due date: { taskId: "abc123", dueDate: null }
  - Make it recurring weekly: { taskId: "abc123", recurrence: { frequency: "weekly", daysOfWeek: ["Monday"] } }
  - Turn off recurring: { taskId: "abc123", clearRecurrence: true }
  - Flag and estimate: { taskId: "abc123", flagged: true, estimatedMinutes: 30 }`,
    inputSchema: UpdateTaskInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { taskId, taskName, name, note, dueDate, deferDate, plannedDate, flagged, estimatedMinutes, projectId, projectName, recurrence, clearRecurrence } = params;

    const safeTaskId = taskId ? sanitizeInput(taskId, 100) : null;
    const safeTaskName = taskName ? sanitizeInput(taskName, 500) : null;

    if (!safeTaskId && !safeTaskName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either taskId or taskName must be provided" }]
      };
    }

    const findTaskScript = generateFindTaskScript(safeTaskId, safeTaskName);

    const updateLines: string[] = [];

    if (name !== undefined) {
      const safeName = sanitizeInput(name, 500);
      updateLines.push(`task.name = "${safeName}";`);
    }
    if (note !== undefined) {
      const safeNote = note === null ? "" : sanitizeInput(note, 10000);
      updateLines.push(`task.note = "${safeNote}";`);
    }
    if (dueDate !== undefined) {
      updateLines.push(dueDate === null
        ? `task.dueDate = null;`
        : `task.dueDate = new Date("${sanitizeInput(dueDate, 100)}");`);
    }
    if (deferDate !== undefined) {
      updateLines.push(deferDate === null
        ? `task.deferDate = null;`
        : `task.deferDate = new Date("${sanitizeInput(deferDate, 100)}");`);
    }
    if (plannedDate !== undefined) {
      updateLines.push(plannedDate === null
        ? `try { task.plannedDate = null; } catch(e) {}`
        : `try { task.plannedDate = new Date("${sanitizeInput(plannedDate, 100)}"); } catch(e) {}`);
    }
    if (flagged !== undefined) {
      updateLines.push(`task.flagged = ${flagged};`);
    }
    if (estimatedMinutes !== undefined) {
      updateLines.push(estimatedMinutes === 0
        ? `task.estimatedMinutes = null;`
        : `task.estimatedMinutes = ${estimatedMinutes};`);
    }

    let moveToProjectScript = "";
    if (projectId !== undefined || projectName !== undefined) {
      const safeProjectId = projectId ? sanitizeInput(projectId, 100) : null;
      const safeProjectName = projectName ? sanitizeInput(projectName, 500) : null;
      if (safeProjectId) {
        moveToProjectScript = `
      var targetProject = doc.flattenedProjects().find(function(p) { return p.id() === "${safeProjectId}"; });
      if (!targetProject) { throw new Error("Project not found with ID: ${safeProjectId}"); }
      task.assignedContainer = targetProject;`;
      } else if (safeProjectName) {
        moveToProjectScript = `
      var targetProject = doc.flattenedProjects().find(function(p) { return p.name() === "${safeProjectName}"; });
      if (!targetProject) { throw new Error("Project not found: ${safeProjectName}"); }
      task.assignedContainer = targetProject;`;
      }
    }

    // Setting or clearing recurring requires the Omni Automation bridge (direct
    // JXA cannot assign or unset a repetition rule). A recurrence object sets the
    // rule; recurrence: null or clearRecurrence: true removes it.
    let recurrenceScript = "";
    if (recurrence) {
      const { ruleString, method } = buildRRule(recurrence);
      recurrenceScript = generateSetRepetitionScript("task", ruleString, method);
    } else if (recurrence === null || clearRecurrence) {
      recurrenceScript = generateClearRepetitionScript("task");
    }

    if (updateLines.length === 0 && moveToProjectScript === "" && recurrenceScript === "") {
      return {
        isError: true,
        content: [{ type: "text", text: "No fields to update were provided" }]
      };
    }

    const script = `
      ${TASK_MAPPER}
      ${findTaskScript}
      ${moveToProjectScript}
      ${updateLines.join("\n      ")}
      ${recurrenceScript}
      JSON.stringify(mapTask(task));
    `;

    try {
      const task = await executeAndParseJSON<TaskData>(script);
      return {
        content: [{
          type: "text",
          text: `Task updated:\n${JSON.stringify(task, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error updating task: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Delete Task
// ============================================================================

server.registerTool(
  "omnifocus_delete_task",
  {
    title: "Delete Task",
    description: `Permanently delete a task from OmniFocus. This cannot be undone via MCP.

Use either the task ID from list/search results, or the task name.

Args:
  - taskId (string, optional): The task's ID. Takes priority if both taskId and taskName provided.
  - taskName (string, optional): The task's name to search for. At least one of taskId or taskName is required.

Returns:
  Confirmation message with the deleted task's name

Examples:
  - Delete by ID: { taskId: "abc123" }
  - Delete by name: { taskName: "Old draft" }`,
    inputSchema: DeleteTaskInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { taskId, taskName } = params;

    const safeTaskId = taskId ? sanitizeInput(taskId, 100) : null;
    const safeTaskName = taskName ? sanitizeInput(taskName, 500) : null;

    if (!safeTaskId && !safeTaskName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either taskId or taskName must be provided" }]
      };
    }

    const findTaskScript = generateFindTaskScript(safeTaskId, safeTaskName);

    const script = `
      ${findTaskScript}
      var deletedName = task.name();
      app.delete(task);
      JSON.stringify({ deleted: true, name: deletedName });
    `;

    try {
      const result = await executeAndParseJSON<{ deleted: boolean; name: string }>(script);
      return {
        content: [{
          type: "text",
          text: `Task deleted: "${result.name}"`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error deleting task: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Batch Complete/Drop Tasks
// ============================================================================

server.registerTool(
  "omnifocus_batch_complete_task",
  {
    title: "Batch Complete/Drop Tasks",
    description: `Complete or drop multiple tasks in one operation.

Args:
  - taskIds (array): Array of task IDs to complete or drop (1-100)
  - action (string): 'complete' (default) or 'drop'

Returns:
  Summary with counts and the updated tasks, plus any per-task failures

Examples:
  - Complete several: { taskIds: ["id1", "id2", "id3"] }
  - Drop several: { taskIds: ["id1", "id2"], action: "drop" }`,
    inputSchema: BatchCompleteTaskInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { taskIds, action } = params;

    const safeTaskIds = sanitizeArray(taskIds, 100, 100);
    const taskIdsJson = JSON.stringify(safeTaskIds);
    // See omnifocus_complete_task: clear the repetition rule before dropping so a
    // recurring task's series stops instead of rolling to its next instance.
    const actionCode = action === "drop"
      ? `${generateClearRepetitionScript("task")}
          task.markDropped();`
      : "task.markComplete();";

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
          ${actionCode}
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

      const actionVerb = action === "drop" ? "dropped" : "completed";
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
          text: `${results.successful.length} task(s) ${actionVerb}${results.failed.length > 0 ? ` (${results.failed.length} failed)` : ""}:\n${JSON.stringify(output, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error in batch complete: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Update Task Note
// ============================================================================

server.registerTool(
  "omnifocus_update_task_note",
  {
    title: "Update Task Note",
    description: `Update the note/description on an existing task in OmniFocus.

Use either the task ID or task name to identify the task.

Args:
  - taskId (string, optional): The task's ID. Takes priority if both taskId and taskName provided.
  - taskName (string, optional): The task's name to search for. At least one of taskId or taskName is required.
  - note (string): The new note content. Use empty string to clear the note.
  - append (boolean): If true, append to existing note instead of replacing (default: false)

Returns:
  The updated task object

Examples:
  - Set note by ID: { taskId: "abc123", note: "Remember to include charts" }
  - Set note by name: { taskName: "Write report", note: "Draft due Friday" }
  - Clear note: { taskId: "abc123", note: "" }
  - Append to note: { taskId: "abc123", note: "\\nAdditional info here", append: true }`,
    inputSchema: UpdateTaskNoteInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { taskId, taskName, note, append } = params;

    // Sanitize user inputs
    const safeTaskId = taskId ? sanitizeInput(taskId, 100) : null;
    const safeTaskName = taskName ? sanitizeInput(taskName, 500) : null;
    const safeNote = sanitizeInput(note, 10000);

    if (!safeTaskId && !safeTaskName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either taskId or taskName must be provided" }]
      };
    }

    const findTaskScript = generateFindTaskScript(safeTaskId, safeTaskName);

    const noteAssignment = append
      ? `var existing = task.note() ? String(task.note()) : ""; task.note = existing + "${safeNote}";`
      : `task.note = "${safeNote}";`;

    const script = `
      ${TASK_MAPPER}
      ${findTaskScript}
      ${noteAssignment}
      JSON.stringify(mapTask(task));
    `;

    try {
      const task = await executeAndParseJSON<TaskData>(script);

      return {
        content: [{
          type: "text",
          text: `Task note updated:\n${JSON.stringify(task, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error updating task note: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Get Due Tasks
// ============================================================================

server.registerTool(
  "omnifocus_get_due_tasks",
  {
    title: "Get Due Tasks",
    description: `Get tasks that are due within a specified timeframe.

Args:
  - daysAhead (number): Days to look ahead, 0-365 (default: 7)
  - includeOverdue (boolean): Include overdue tasks (default: true)
  - limit (number): Max tasks, 1-500 (default: 50)
  - tags (array, optional): Filter to tasks matching these tag names (max 20)
  - tagMatchMode (string): How to match tags - 'all', 'any', or 'none' (default 'all'). Only applied when tags is provided.

Returns:
  Array of due tasks sorted by due date

Examples:
  - Due this week: {}
  - Due today: { daysAhead: 0 }
  - Due in 30 days: { daysAhead: 30 }`,
    inputSchema: GetDueTasksInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { daysAhead, includeOverdue, limit, tags, tagMatchMode } = params;

    const tagFilter = tags ? generateTagFilter(sanitizeArray(tags, 200, 20), tagMatchMode) : "";

    const script = `
      ${TASK_MAPPER}
      var now = new Date();
      var futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + ${daysAhead});
      futureDate.setHours(23, 59, 59, 999);

      var tasks = doc.flattenedTasks().filter(function(t) {
        if (t.completed()) return false;
        var due = t.dueDate();
        if (!due) return false;
        ${includeOverdue ? '' : 'if (due < now) return false;'}
        return due <= futureDate;
      }).sort(function(a, b) {
        return a.dueDate() - b.dueDate();
      });
      ${tagFilter}
      tasks = tasks.slice(0, ${limit});

      JSON.stringify(tasks.map(mapTask));
    `;
    
    try {
      const tasks = await executeAndParseJSON<TaskData[]>(script);
      
      if (tasks.length === 0) {
        return {
          content: [{ type: "text", text: `No tasks due within ${daysAhead} days.` }]
        };
      }
      
      const output = {
        count: tasks.length,
        daysAhead,
        tasks
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error getting due tasks: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Get Flagged Tasks
// ============================================================================

server.registerTool(
  "omnifocus_get_flagged_tasks",
  {
    title: "Get Flagged Tasks",
    description: `Get all flagged tasks in OmniFocus.

Args:
  - includeCompleted (boolean): Include completed tasks (default: false)
  - limit (number): Max tasks, 1-500 (default: 50)
  - tags (array, optional): Filter to tasks matching these tag names (max 20)
  - tagMatchMode (string): How to match tags - 'all', 'any', or 'none' (default 'all'). Only applied when tags is provided.

Returns:
  Array of flagged tasks

Examples:
  - Active flagged: {}
  - All flagged: { includeCompleted: true }`,
    inputSchema: GetFlaggedTasksInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { includeCompleted, limit, tags, tagMatchMode } = params;

    const tagFilter = tags ? generateTagFilter(sanitizeArray(tags, 200, 20), tagMatchMode) : "";

    const script = `
      ${TASK_MAPPER}
      var tasks = doc.flattenedTasks().filter(function(t) {
        if (!t.flagged()) return false;
        ${!includeCompleted ? 'if (t.completed()) return false;' : ''}
        return true;
      });
      ${tagFilter}
      tasks = tasks.slice(0, ${limit});
      JSON.stringify(tasks.map(mapTask));
    `;
    
    try {
      const tasks = await executeAndParseJSON<TaskData[]>(script);
      
      if (tasks.length === 0) {
        return {
          content: [{ type: "text", text: "No flagged tasks found." }]
        };
      }
      
      const output = {
        count: tasks.length,
        tasks
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error getting flagged tasks: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Get Planned Tasks
// ============================================================================

server.registerTool(
  "omnifocus_get_planned_tasks",
  {
    title: "Get Planned Tasks",
    description: `Get tasks that are planned within a specified timeframe.

Planned dates represent when you intend to work on a task, separate from the due date.

Args:
  - daysAhead (number): Days to look ahead, 0-365 (default: 7)
  - includeOverdue (boolean): Include overdue planned tasks (default: true)
  - limit (number): Max tasks, 1-500 (default: 50)
  - tags (array, optional): Filter to tasks matching these tag names (max 20)
  - tagMatchMode (string): How to match tags - 'all', 'any', or 'none' (default 'all'). Only applied when tags is provided.

Returns:
  Array of planned tasks sorted by planned date

Examples:
  - Planned this week: {}
  - Planned today: { daysAhead: 0 }
  - Planned in 30 days: { daysAhead: 30 }`,
    inputSchema: GetPlannedTasksInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { daysAhead, includeOverdue, limit, tags, tagMatchMode } = params;

    const tagFilter = tags ? generateTagFilter(sanitizeArray(tags, 200, 20), tagMatchMode) : "";

    const script = `
      ${TASK_MAPPER}
      var now = new Date();
      var futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + ${daysAhead});
      futureDate.setHours(23, 59, 59, 999);

      var tasks = doc.flattenedTasks().filter(function(t) {
        if (t.completed()) return false;
        var planned = null;
        try {
          planned = t.plannedDate ? t.plannedDate() : null;
        } catch(e) {}
        if (!planned) return false;
        ${includeOverdue ? '' : 'if (planned < now) return false;'}
        return planned <= futureDate;
      }).sort(function(a, b) {
        var aPlanned = null;
        var bPlanned = null;
        try {
          aPlanned = a.plannedDate ? a.plannedDate() : null;
          bPlanned = b.plannedDate ? b.plannedDate() : null;
        } catch(e) {}
        if (!aPlanned || !bPlanned) return 0;
        return aPlanned - bPlanned;
      });
      ${tagFilter}
      tasks = tasks.slice(0, ${limit});

      JSON.stringify(tasks.map(mapTask));
    `;

    try {
      const tasks = await executeAndParseJSON<TaskData[]>(script);

      if (tasks.length === 0) {
        return {
          content: [{ type: "text", text: `No tasks planned within ${daysAhead} days.` }]
        };
      }

      const output = {
        count: tasks.length,
        daysAhead,
        tasks
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error getting planned tasks: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);
