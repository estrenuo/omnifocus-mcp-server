/**
 * Project tools: list, project tasks, create/update/delete, and notes.
 */

import { server } from "../server.js";
import { executeAndParseJSON } from "../executor.js";
import type { ProjectData, TaskData } from "../types.js";
import { sanitizeInput } from "../sanitization.js";
import { PROJECT_MAPPER, TASK_MAPPER } from "../mappers.js";
import { STATUS_MAP, generateFindProjectScript, generateSetProjectStatusScript } from "../helpers.js";
import {
  ListProjectsInputSchema,
  GetProjectTasksInputSchema,
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  DeleteProjectInputSchema,
  UpdateProjectNoteInputSchema
} from "../schemas.js";

// ============================================================================
// Tool: List Projects
// ============================================================================

server.registerTool(
  "omnifocus_list_projects",
  {
    title: "List Projects",
    description: `List projects in OmniFocus.

Returns projects with their status, dates, and folder information.

Args:
  - status (string): Filter by status - 'all', 'active', 'done', 'dropped', 'onHold' (default: 'active')
  - folderName (string): Optional folder name filter (partial match)
  - limit (number): Maximum projects to return, 1-500 (default: 50)

Returns:
  Array of project objects with: id, name, note, status, completed, flagged, dueDate, deferDate, folderName, taskCount, sequential

Examples:
  - List active projects: {}
  - List all projects: { status: "all" }
  - Projects in a folder: { folderName: "Work" }`,
    inputSchema: ListProjectsInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { status, folderName, limit } = params;

    let statusFilter = "";
    if (status !== "all") {
      statusFilter = `.filter(function(p) { return String(p.status()) === "${STATUS_MAP[status]}"; })`;
    }

    let folderFilter = "";
    if (folderName) {
      const safeFolderName = sanitizeInput(folderName, 500);
      folderFilter = `.filter(function(p) {
        var pf = p.folder();
        return pf && pf.name().toLowerCase().indexOf("${safeFolderName.toLowerCase()}") !== -1;
      })`;
    }

    const script = `
      ${PROJECT_MAPPER}
      var projects = doc.flattenedProjects()${statusFilter}${folderFilter}.slice(0, ${limit});
      JSON.stringify(projects.map(mapProject));
    `;
    
    try {
      const projects = await executeAndParseJSON<ProjectData[]>(script);
      
      if (projects.length === 0) {
        return {
          content: [{ type: "text", text: "No projects found matching criteria." }]
        };
      }
      
      const output = {
        count: projects.length,
        projects: projects
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error listing projects: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Get Project Tasks
// ============================================================================

server.registerTool(
  "omnifocus_get_project_tasks",
  {
    title: "Get Project Tasks",
    description: `Get all tasks belonging to a specific project in OmniFocus.

Returns the tasks within a project, including subtasks. Use omnifocus_list_projects to find project IDs first.

Args:
  - projectId (string): The ID of the project
  - includeCompleted (boolean): Include completed tasks (default: false)
  - limit (number): Maximum tasks to return, 1-500 (default: 100)

Returns:
  Array of task objects with: id, name, note, completed, flagged, dueDate, deferDate, estimatedMinutes, tags, parentTaskId, parentTaskName, hasChildren, childTaskCount

Examples:
  - Get tasks for a project: { projectId: "abc123" }
  - Include completed: { projectId: "abc123", includeCompleted: true }`,
    inputSchema: GetProjectTasksInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { projectId, includeCompleted, limit } = params;
    const safeProjectId = sanitizeInput(projectId, 500);

    const script = `
      ${TASK_MAPPER}
      var project = doc.flattenedProjects().find(function(p) { return p.id() === "${safeProjectId}"; });
      if (!project) {
        throw new Error("Project not found with ID: ${safeProjectId}");
      }
      var tasks = project.flattenedTasks();
      ${!includeCompleted ? 'tasks = tasks.filter(function(t) { return !t.completed(); });' : ''}
      tasks = tasks.slice(0, ${limit});
      JSON.stringify(tasks.map(mapTask));
    `;

    try {
      const tasks = await executeAndParseJSON<TaskData[]>(script);

      if (tasks.length === 0) {
        return {
          content: [{ type: "text", text: "No tasks found in this project." }]
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
        content: [{ type: "text", text: `Error getting project tasks: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Create Project
// ============================================================================

server.registerTool(
  "omnifocus_create_project",
  {
    title: "Create Project",
    description: `Create a new project in OmniFocus.

Creates a project at the top level or inside a specific folder. Optional properties like due date, defer date, flags, and sequential ordering can be set.

Args:
  - name (string): Project name (required)
  - note (string): Optional note/description
  - folderName (string): Folder to place the project in (top level if omitted)
  - dueDate (string): Due date in ISO 8601 format
  - deferDate (string): Defer/start date in ISO 8601 format
  - flagged (boolean): Flag the project (default: false)
  - sequential (boolean): Tasks must be done in order (default: false = parallel)
  - status (string): "active", "on hold", "done", or "dropped" (default: "active")

Returns:
  The created project object with id, name, and other properties

Examples:
  - Simple project: { name: "Launch website" }
  - In a folder: { name: "Q1 Planning", folderName: "Work" }
  - With details: { name: "Write book", dueDate: "2024-12-31T17:00:00", sequential: true, flagged: true }`,
    inputSchema: CreateProjectInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { name, note, folderName, dueDate, deferDate, flagged, sequential, status } = params;

    const safeName = sanitizeInput(name, 500);
    const safeNote = note ? sanitizeInput(note, 10000) : "";
    const safeFolderName = folderName ? sanitizeInput(folderName, 500) : null;
    const safeDueDate = dueDate ? sanitizeInput(dueDate, 100) : null;
    const safeDeferDate = deferDate ? sanitizeInput(deferDate, 100) : null;

    const createScript = safeFolderName
      ? `
        var folder = doc.flattenedFolders().find(function(f) { return f.name() === "${safeFolderName}"; });
        if (!folder) { throw new Error("Folder not found: ${safeFolderName}"); }
        var project = app.Project({name: "${safeName}"});
        folder.projects.push(project);
      `
      : `
        var project = app.Project({name: "${safeName}"});
        doc.projects.push(project);
      `;

    const script = `
      ${PROJECT_MAPPER}
      ${createScript}
      ${safeNote ? `project.note = "${safeNote}";` : ""}
      ${safeDueDate ? `project.dueDate = new Date("${safeDueDate}");` : ""}
      ${safeDeferDate ? `project.deferDate = new Date("${safeDeferDate}");` : ""}
      ${flagged ? `project.flagged = true;` : ""}
      project.sequential = ${sequential};
      ${generateSetProjectStatusScript(status)}
      JSON.stringify(mapProject(project));
    `;

    try {
      const project = await executeAndParseJSON<ProjectData>(script);
      return {
        content: [{
          type: "text",
          text: `Project created successfully:\n${JSON.stringify(project, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error creating project: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Update Project
// ============================================================================

server.registerTool(
  "omnifocus_update_project",
  {
    title: "Update Project",
    description: `Update properties of an existing project in OmniFocus.

Only the fields you provide are changed. Use null to clear a date or note field.

Args:
  - projectId (string, optional): The project's ID. Takes priority if both projectId and projectName provided.
  - projectName (string, optional): The project's name to search for. At least one of projectId or projectName is required.
  - name (string, optional): New project name
  - note (string | null, optional): New note text. Pass null to clear.
  - status (string, optional): "active", "on hold", "done", or "dropped". Setting "done" completes the project and "dropped" drops it (setting "active" reactivates a completed/dropped project).
  - flagged (boolean, optional): Set flagged state
  - dueDate (string | null, optional): New due date in ISO 8601 format. Pass null to clear.
  - deferDate (string | null, optional): New defer date in ISO 8601 format. Pass null to clear.
  - sequential (boolean, optional): Tasks must be done in order (true) or parallel (false)
  - reviewIntervalDays (number, optional): Review interval in days (1-3650)

Note: moving a project between folders is not supported by OmniFocus's JXA layer (the move operation returns "Replacement not supported"). Recreate the project in the target folder if you need to move it.

Returns:
  The updated project object

Examples:
  - Rename: { projectId: "abc123", name: "New name" }
  - Put on hold: { projectId: "abc123", status: "on hold" }
  - Complete the project: { projectId: "abc123", status: "done" }
  - Drop the project: { projectId: "abc123", status: "dropped" }
  - Set review interval: { projectId: "abc123", reviewIntervalDays: 14 }
  - Clear due date: { projectId: "abc123", dueDate: null }`,
    inputSchema: UpdateProjectInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { projectId, projectName, name, note, status, flagged, dueDate, deferDate, sequential, reviewIntervalDays } = params;

    const safeProjectId = projectId ? sanitizeInput(projectId, 100) : null;
    const safeProjectName = projectName ? sanitizeInput(projectName, 500) : null;

    if (!safeProjectId && !safeProjectName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either projectId or projectName must be provided" }]
      };
    }

    const findProjectScript = generateFindProjectScript(safeProjectId, safeProjectName);

    const updateLines: string[] = [];

    if (name !== undefined) {
      updateLines.push(`project.name = "${sanitizeInput(name, 500)}";`);
    }
    if (note !== undefined) {
      const safeNote = note === null ? "" : sanitizeInput(note, 10000);
      updateLines.push(`project.note = "${safeNote}";`);
    }
    if (status !== undefined) {
      updateLines.push(generateSetProjectStatusScript(status));
    }
    if (flagged !== undefined) {
      updateLines.push(`project.flagged = ${flagged};`);
    }
    if (dueDate !== undefined) {
      updateLines.push(dueDate === null
        ? `project.dueDate = null;`
        : `project.dueDate = new Date("${sanitizeInput(dueDate, 100)}");`);
    }
    if (deferDate !== undefined) {
      updateLines.push(deferDate === null
        ? `project.deferDate = null;`
        : `project.deferDate = new Date("${sanitizeInput(deferDate, 100)}");`);
    }
    if (sequential !== undefined) {
      updateLines.push(`project.sequential = ${sequential};`);
    }
    if (reviewIntervalDays !== undefined) {
      // reviewInterval is a record {unit, steps} in OmniFocus JXA; assigning a
      // raw number of seconds segfaults osascript.
      updateLines.push(`project.reviewInterval = {unit: "day", steps: ${reviewIntervalDays}};`);
    }

    if (updateLines.length === 0) {
      return {
        isError: true,
        content: [{ type: "text", text: "No fields to update were provided" }]
      };
    }

    const script = `
      ${PROJECT_MAPPER}
      ${findProjectScript}
      ${updateLines.join("\n      ")}
      JSON.stringify(mapProject(project));
    `;

    try {
      const project = await executeAndParseJSON<ProjectData>(script);
      return {
        content: [{
          type: "text",
          text: `Project updated:\n${JSON.stringify(project, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error updating project: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Delete Project
// ============================================================================

server.registerTool(
  "omnifocus_delete_project",
  {
    title: "Delete Project",
    description: `Permanently delete a project from OmniFocus, including its tasks. This cannot be undone via MCP.

Use either the project ID from list/search results, or the project name.

Args:
  - projectId (string, optional): The project's ID. Takes priority if both projectId and projectName provided.
  - projectName (string, optional): The project's name to search for. At least one of projectId or projectName is required.

Returns:
  Confirmation message with the deleted project's name

Examples:
  - Delete by ID: { projectId: "abc123" }
  - Delete by name: { projectName: "Old project" }`,
    inputSchema: DeleteProjectInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  async (params) => {
    const { projectId, projectName } = params;

    const safeProjectId = projectId ? sanitizeInput(projectId, 100) : null;
    const safeProjectName = projectName ? sanitizeInput(projectName, 500) : null;

    if (!safeProjectId && !safeProjectName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either projectId or projectName must be provided" }]
      };
    }

    const findProjectScript = generateFindProjectScript(safeProjectId, safeProjectName);

    const script = `
      ${findProjectScript}
      var deletedName = project.name();
      app.delete(project);
      JSON.stringify({ deleted: true, name: deletedName });
    `;

    try {
      const result = await executeAndParseJSON<{ deleted: boolean; name: string }>(script);
      return {
        content: [{
          type: "text",
          text: `Project deleted: "${result.name}"`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error deleting project: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: Update Project Note
// ============================================================================

server.registerTool(
  "omnifocus_update_project_note",
  {
    title: "Update Project Note",
    description: `Update the note/description on an existing project in OmniFocus.

Use either the project ID or project name to identify the project.

Args:
  - projectId (string, optional): The project's ID. Takes priority if both projectId and projectName provided.
  - projectName (string, optional): The project's name to search for. At least one of projectId or projectName is required.
  - note (string): The new note content. Use empty string to clear the note.
  - append (boolean): If true, append to existing note instead of replacing (default: false)

Returns:
  The updated project object

Examples:
  - Set note by ID: { projectId: "abc123", note: "Q1 deliverables" }
  - Set note by name: { projectName: "Work Project", note: "Started Jan 2024" }
  - Clear note: { projectId: "abc123", note: "" }
  - Append to note: { projectId: "abc123", note: "\\nNew update", append: true }`,
    inputSchema: UpdateProjectNoteInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { projectId, projectName, note, append } = params;

    // Sanitize user inputs
    const safeProjectId = projectId ? sanitizeInput(projectId, 100) : null;
    const safeProjectName = projectName ? sanitizeInput(projectName, 500) : null;
    const safeNote = sanitizeInput(note, 10000);

    if (!safeProjectId && !safeProjectName) {
      return {
        isError: true,
        content: [{ type: "text", text: "Either projectId or projectName must be provided" }]
      };
    }

    let findProjectScript: string;
    if (safeProjectId) {
      findProjectScript = `
        var project = doc.flattenedProjects().find(function(p) { return p.id() === "${safeProjectId}"; });
        if (!project) { throw new Error("Project not found with ID: ${safeProjectId}"); }
      `;
    } else {
      findProjectScript = `
        var allProjects = doc.flattenedProjects();
        var project = allProjects.find(function(p) { return p.name() === "${safeProjectName}"; });
        if (!project) {
          var searchLower = "${safeProjectName!.toLowerCase()}";
          var matches = allProjects.filter(function(p) {
            return p.name().toLowerCase().indexOf(searchLower) !== -1;
          });
          if (matches.length === 0) {
            throw new Error("No project found matching name: ${safeProjectName}");
          } else if (matches.length > 1) {
            var matchList = matches.map(function(p) {
              var folder = p.folder();
              return "- " + p.name() + " (ID: " + p.id() + (folder ? ", Folder: " + folder.name() : "") + ")";
            }).join("\\n");
            throw new Error("Multiple projects found matching '${safeProjectName}'. Please use projectId or be more specific:\\n" + matchList);
          }
          project = matches[0];
        }
      `;
    }

    const noteAssignment = append
      ? `var existing = project.note() ? String(project.note()) : ""; project.note = existing + "${safeNote}";`
      : `project.note = "${safeNote}";`;

    const script = `
      ${PROJECT_MAPPER}
      ${findProjectScript}
      ${noteAssignment}
      JSON.stringify(mapProject(project));
    `;

    try {
      const project = await executeAndParseJSON<ProjectData>(script);

      return {
        content: [{
          type: "text",
          text: `Project note updated:\n${JSON.stringify(project, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error updating project note: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);
