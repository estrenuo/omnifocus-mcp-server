#!/usr/bin/env node

/**
 * OmniFocus MCP Server
 * 
 * A Model Context Protocol server for interacting with OmniFocus on macOS
 * via Omni Automation (JavaScript for Automation).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface TaskData {
  id: string;
  name: string;
  note: string;
  completed: boolean;
  dropped: boolean;
  flagged: boolean;
  dueDate: string | null;
  deferDate: string | null;
  plannedDate: string | null;
  estimatedMinutes: number | null;
  tags: string[];
  projectName: string | null;
  inInbox: boolean;
  repetitionRule: string | null;
  repetitionMethod: string | null;
  parentTaskId: string | null;
  parentTaskName: string | null;
  hasChildren: boolean;
  childTaskCount: number;
}

export interface ProjectData {
  id: string;
  name: string;
  note: string;
  status: string;
  completed: boolean;
  flagged: boolean;
  dueDate: string | null;
  deferDate: string | null;
  folderName: string | null;
  taskCount: number;
  sequential: boolean;
}

export interface FolderData {
  id: string;
  name: string;
  status: string;
  projectCount: number;
  folderCount: number;
  parentName: string | null;
}

export interface TagData {
  id: string;
  name: string;
  status: string;
  taskCount: number;
  allowsNextAction: boolean;
  parentName: string | null;
}

// ============================================================================
// OmniFocus Executor - JXA VERSION
// ============================================================================

/**
 * Executes JXA (JavaScript for Automation) to interact with OmniFocus.
 * Note: doc.evaluate() for Omni Automation doesn't work from JXA due to type
 * conversion issues (-1700). We use direct JXA property access instead.
 */
export async function executeOmniFocusScript(script: string): Promise<string> {
  // Escape for JXA string literal (backticks)
  const escapedScript = script
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  // The script is pure JXA - properties are accessed as methods: obj.name()
  const jxaScript = `
    const app = Application("OmniFocus");
    const doc = app.defaultDocument();
    ${escapedScript}
  `;

  // Write to temp file to avoid shell escaping issues
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');

  const tmpFile = path.join(os.tmpdir(), `omnifocus-script-${Date.now()}.js`);
  await fs.writeFile(tmpFile, jxaScript, 'utf8');

  try {
    const { stdout, stderr } = await execAsync(
      `osascript -l JavaScript "${tmpFile}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    await fs.unlink(tmpFile).catch(() => {});

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    return stdout.trim();
  } catch (error: unknown) {
    await fs.unlink(tmpFile).catch(() => {});

    if (error instanceof Error) {
      if (error.message.includes("is not running")) {
        throw new Error("OmniFocus is not running. Please launch OmniFocus first.");
      }
      if (error.message.includes("not allowed") || error.message.includes("niet toegestaan")) {
        throw new Error("Script access to OmniFocus is not allowed. Enable automation permissions in System Preferences > Security & Privacy > Privacy > Automation.");
      }
      throw new Error(`OmniFocus script error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Executes a script and parses the JSON result
 */
export async function executeAndParseJSON<T>(script: string): Promise<T> {
  const result = await executeOmniFocusScript(script);
  try {
    return JSON.parse(result) as T;
  } catch {
    throw new Error(`Failed to parse OmniFocus response: ${result}`);
  }
}

// ============================================================================
// Helper Scripts (JXA syntax - properties are accessed as methods)
// ============================================================================

export const TASK_MAPPER = `
function mapTask(t) {
  var noteVal = t.note();
  var noteStr = noteVal ? String(noteVal) : "";

  var dueDate = t.dueDate();
  var deferDate = t.deferDate();
  var plannedDate = null;
  try {
    plannedDate = t.plannedDate ? t.plannedDate() : null;
  } catch(e) {}
  var containingProj = t.containingProject();
  var tagsList = t.tags();

  var repetitionRule = null;
  var repetitionMethod = null;
  try {
    var repRule = t.repetitionRule();
    if (repRule) {
      repetitionRule = String(repRule);
    }
    var repMethod = t.repetitionMethod();
    if (repMethod) {
      repetitionMethod = String(repMethod);
    }
  } catch(e) {}

  // Get parent task information
  var parentTask = null;
  var parentTaskId = null;
  var parentTaskName = null;
  try {
    parentTask = t.parentTask();
    if (parentTask) {
      parentTaskId = parentTask.id();
      parentTaskName = parentTask.name();
    }
  } catch(e) {}

  // Get child task information
  var childTasks = [];
  var childTaskCount = 0;
  try {
    childTasks = t.tasks();
    childTaskCount = childTasks.length;
  } catch(e) {}

  return {
    id: t.id(),
    name: t.name(),
    note: noteStr,
    completed: t.completed(),
    dropped: t.dropped(),
    flagged: t.flagged(),
    dueDate: dueDate ? dueDate.toISOString() : null,
    deferDate: deferDate ? deferDate.toISOString() : null,
    plannedDate: plannedDate ? plannedDate.toISOString() : null,
    estimatedMinutes: t.estimatedMinutes(),
    tags: tagsList.map(function(tag) { return tag.name(); }),
    projectName: containingProj ? containingProj.name() : null,
    inInbox: t.inInbox(),
    repetitionRule: repetitionRule,
    repetitionMethod: repetitionMethod
    parentTaskId: parentTaskId,
    parentTaskName: parentTaskName,
    hasChildren: childTaskCount > 0,
    childTaskCount: childTaskCount
  };
}
`;

export const PROJECT_MAPPER = `
function mapProject(p) {
  var noteVal = p.note();
  var noteStr = noteVal ? String(noteVal) : "";

  var statusVal = p.status();
  var statusStr = statusVal ? String(statusVal) : "Unknown";

  var dueDate = p.dueDate();
  var deferDate = p.deferDate();
  var folder = p.folder();

  return {
    id: p.id(),
    name: p.name(),
    note: noteStr,
    status: statusStr,
    completed: p.completed(),
    flagged: p.flagged(),
    dueDate: dueDate ? dueDate.toISOString() : null,
    deferDate: deferDate ? deferDate.toISOString() : null,
    folderName: folder ? folder.name() : null,
    taskCount: p.flattenedTasks().length,
    sequential: p.sequential()
  };
}
`;

export const FOLDER_MAPPER = `
function mapFolder(f) {
  var parentName = null;
  try {
    var pf = f.folder();
    if (pf && typeof pf.name === "function") {
      parentName = pf.name();
    }
  } catch(e) {}

  return {
    id: f.id(),
    name: f.name(),
    status: f.hidden() ? "dropped" : "active",
    projectCount: f.projects().length,
    folderCount: f.folders().length,
    parentName: parentName
  };
}
`;

export const TAG_MAPPER = `
function mapTag(t) {
  return {
    id: t.id(),
    name: t.name(),
    status: t.hidden() ? "dropped" : "active",
    taskCount: t.tasks().length,
    allowsNextAction: t.allowsNextAction(),
    parentName: null
  };
}
`;

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new McpServer({
  name: "omnifocus-mcp-server",
  version: "1.0.0"
});

// ============================================================================
// Tool: List Inbox Tasks
// ============================================================================

const ListInboxInputSchema = z.object({
  includeCompleted: z.boolean()
    .default(false)
    .describe("Include completed tasks in results"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum number of tasks to return")
}).strict();

server.registerTool(
  "omnifocus_list_inbox",
  {
    title: "List Inbox Tasks",
    description: `List tasks in the OmniFocus inbox.

Returns tasks that haven't been assigned to a project yet. These are typically newly captured items awaiting processing.

Args:
  - includeCompleted (boolean): Include completed tasks (default: false)
  - limit (number): Maximum tasks to return, 1-500 (default: 50)

Returns:
  Array of task objects with: id, name, note, completed, flagged, dueDate, deferDate, estimatedMinutes, tags

Examples:
  - List all inbox items: {}
  - Include completed: { includeCompleted: true }`,
    inputSchema: ListInboxInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    const { includeCompleted, limit } = params;
    
    const script = `
      ${TASK_MAPPER}
      var tasks = doc.inboxTasks().slice(0, ${limit});
      ${!includeCompleted ? 'tasks = tasks.filter(function(t) { return !t.completed(); });' : ''}
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
// Tool: List Projects
// ============================================================================

const ListProjectsInputSchema = z.object({
  status: z.enum(["all", "active", "done", "dropped", "onHold"])
    .default("active")
    .describe("Filter by project status"),
  folderName: z.string()
    .optional()
    .describe("Filter by folder name (case-insensitive partial match)"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum number of projects to return")
}).strict();

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
      const statusMap: Record<string, string> = {
        "active": "active status",
        "done": "done status",
        "dropped": "dropped status",
        "onHold": "on hold status"
      };
      statusFilter = `.filter(function(p) { return String(p.status()) === "${statusMap[status]}"; })`;
    }

    let folderFilter = "";
    if (folderName) {
      folderFilter = `.filter(function(p) {
        var pf = p.folder();
        return pf && pf.name().toLowerCase().indexOf("${folderName.toLowerCase()}") !== -1;
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
// Tool: List Folders
// ============================================================================

const ListFoldersInputSchema = z.object({
  status: z.enum(["all", "active", "dropped"])
    .default("active")
    .describe("Filter by folder status"),
  limit: z.number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe("Maximum number of folders to return")
}).strict();

server.registerTool(
  "omnifocus_list_folders",
  {
    title: "List Folders",
    description: `List folders in OmniFocus.

Folders are used to organize projects hierarchically.

Args:
  - status (string): Filter by status - 'all', 'active', 'dropped' (default: 'active')
  - limit (number): Maximum folders to return, 1-200 (default: 50)

Returns:
  Array of folder objects with: id, name, status, projectCount, folderCount, parentName

Examples:
  - List active folders: {}
  - List all folders: { status: "all" }`,
    inputSchema: ListFoldersInputSchema,
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
    if (status === "active") {
      statusFilter = `.filter(function(f) { return !f.hidden(); })`;
    } else if (status === "dropped") {
      statusFilter = `.filter(function(f) { return f.hidden(); })`;
    }

    const script = `
      ${FOLDER_MAPPER}
      var folders = doc.flattenedFolders()${statusFilter}.slice(0, ${limit});
      JSON.stringify(folders.map(mapFolder));
    `;
    
    try {
      const folders = await executeAndParseJSON<FolderData[]>(script);
      
      if (folders.length === 0) {
        return {
          content: [{ type: "text", text: "No folders found." }]
        };
      }
      
      const output = {
        count: folders.length,
        folders: folders
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error listing folders: ${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
);

// ============================================================================
// Tool: List Tags
// ============================================================================

const ListTagsInputSchema = z.object({
  status: z.enum(["all", "active", "onHold", "dropped"])
    .default("active")
    .describe("Filter by tag status"),
  limit: z.number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe("Maximum number of tags to return")
}).strict();

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
// Tool: Create Task
// ============================================================================

const CreateTaskInputSchema = z.object({
  name: z.string()
    .min(1)
    .max(500)
    .describe("The task name/title"),
  note: z.string()
    .max(10000)
    .optional()
    .describe("Optional note/description for the task"),
  projectName: z.string()
    .optional()
    .describe("Name of project to add task to (creates in inbox if not specified)"),
  parentTaskId: z.string()
    .optional()
    .describe("ID of parent task to create this as a subtask (makes this task a child of the parent)"),
  dueDate: z.string()
    .optional()
    .describe("Due date in ISO 8601 format (e.g., '2024-12-31T17:00:00')"),
  deferDate: z.string()
    .optional()
    .describe("Defer/start date in ISO 8601 format"),
  plannedDate: z.string()
    .optional()
    .describe("Planned date in ISO 8601 format - when you intend to work on the task"),
  flagged: z.boolean()
    .default(false)
    .describe("Whether to flag the task"),
  estimatedMinutes: z.number()
    .int()
    .min(1)
    .max(9999)
    .optional()
    .describe("Estimated time in minutes"),
  tagNames: z.array(z.string())
    .optional()
    .describe("Array of tag names to apply"),
  recurrence: z.object({
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"])
      .describe("Recurrence frequency"),
    interval: z.number()
      .int()
      .min(1)
      .default(1)
      .describe("Interval between repetitions (e.g., every 2 weeks)"),
    daysOfWeek: z.array(z.enum(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]))
      .optional()
      .describe("Days of week for weekly recurrence (e.g., ['Monday', 'Wednesday', 'Friday'])"),
    dayOfMonth: z.number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe("Day of month for monthly recurrence (1-31)"),
    monthOfYear: z.number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe("Month of year for yearly recurrence (1-12)"),
    repeatFrom: z.enum(["due-date", "completion-date"])
      .default("due-date")
      .describe("Whether to repeat from due date or completion date")
  }).strict()
    .optional()
    .describe("Recurrence pattern for repeating tasks")
}).strict();

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
    
    // Escape for JavaScript string
    const escapeName = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const escapeNote = note ? note.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") : "";

    let createScript: string;
    if (parentTaskId) {
      // Create as a subtask of an existing task
      createScript = `
        var parentTask = doc.flattenedTasks().find(function(t) { return t.id() === "${parentTaskId}"; });
        if (!parentTask) { throw new Error("Parent task not found with ID: ${parentTaskId}"); }
        var task = app.Task({name: "${escapeName}"});
        parentTask.tasks.push(task);
      `;
    } else if (projectName) {
      const escapeProject = projectName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      createScript = `
        var project = doc.flattenedProjects().find(function(p) { return p.name() === "${escapeProject}"; });
        if (!project) { throw new Error("Project not found: ${escapeProject}"); }
        var task = app.Task({name: "${escapeName}"});
        project.tasks.push(task);
      `;
    } else {
      createScript = `
        var task = app.InboxTask({name: "${escapeName}"});
        doc.inboxTasks.push(task);
      `;
    }

    // Generate recurrence rule script if provided
    let recurrenceScript = "";
    if (recurrence) {
      const { frequency, interval = 1, daysOfWeek, dayOfMonth, monthOfYear, repeatFrom = "due-date" } = recurrence;

      // Set repetition method
      const repetitionMethod = repeatFrom === "completion-date" ? "start-after-completion" : "fixed";
      recurrenceScript += `task.repetitionMethod = app.RepetitionMethod.${repetitionMethod};\n`;

      // Build the recurrence rule based on frequency
      if (frequency === "daily") {
        recurrenceScript += `task.repetitionRule = app.RecurrenceRule({ recurrence: app.RecurrenceType.daily, interval: ${interval} });\n`;
      } else if (frequency === "weekly") {
        if (daysOfWeek && daysOfWeek.length > 0) {
          // Map day names to RecurrenceDay enum values
          const dayMapping: Record<string, string> = {
            "Sunday": "sunday",
            "Monday": "monday",
            "Tuesday": "tuesday",
            "Wednesday": "wednesday",
            "Thursday": "thursday",
            "Friday": "friday",
            "Saturday": "saturday"
          };
          const days = daysOfWeek.map(d => `app.RecurrenceDay.${dayMapping[d]}`).join(", ");
          recurrenceScript += `task.repetitionRule = app.RecurrenceRule({ recurrence: app.RecurrenceType.weekly, interval: ${interval}, daysOfWeek: [${days}] });\n`;
        } else {
          recurrenceScript += `task.repetitionRule = app.RecurrenceRule({ recurrence: app.RecurrenceType.weekly, interval: ${interval} });\n`;
        }
      } else if (frequency === "monthly") {
        if (dayOfMonth) {
          recurrenceScript += `task.repetitionRule = app.RecurrenceRule({ recurrence: app.RecurrenceType.monthly, interval: ${interval}, dayOfMonth: ${dayOfMonth} });\n`;
        } else {
          recurrenceScript += `task.repetitionRule = app.RecurrenceRule({ recurrence: app.RecurrenceType.monthly, interval: ${interval} });\n`;
        }
      } else if (frequency === "yearly") {
        if (monthOfYear && dayOfMonth) {
          recurrenceScript += `task.repetitionRule = app.RecurrenceRule({ recurrence: app.RecurrenceType.yearly, interval: ${interval}, monthOfYear: ${monthOfYear}, dayOfMonth: ${dayOfMonth} });\n`;
        } else if (monthOfYear) {
          recurrenceScript += `task.repetitionRule = app.RecurrenceRule({ recurrence: app.RecurrenceType.yearly, interval: ${interval}, monthOfYear: ${monthOfYear} });\n`;
        } else {
          recurrenceScript += `task.repetitionRule = app.RecurrenceRule({ recurrence: app.RecurrenceType.yearly, interval: ${interval} });\n`;
        }
      }
    }

    const script = `
      ${TASK_MAPPER}
      ${createScript}
      ${note ? `task.note = "${escapeNote}";` : ""}
      ${dueDate ? `task.dueDate = new Date("${dueDate}");` : ""}
      ${deferDate ? `task.deferDate = new Date("${deferDate}");` : ""}
      ${plannedDate ? `try { task.plannedDate = new Date("${plannedDate}"); } catch(e) {}` : ""}
      ${flagged ? `task.flagged = true;` : ""}
      ${estimatedMinutes ? `task.estimatedMinutes = ${estimatedMinutes};` : ""}
      ${tagNames && tagNames.length > 0 ? `
        var tagNamesToAdd = ${JSON.stringify(tagNames)};
        var allTags = doc.flattenedTags();
        tagNamesToAdd.forEach(function(tagName) {
          var tag = allTags.find(function(t) { return t.name() === tagName; });
          if (tag) { task.tags.push(tag); }
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

const CompleteTaskInputSchema = z.object({
  taskId: z.string()
    .optional()
    .describe("The task ID (primaryKey) to update. Takes priority if both taskId and taskName are provided."),
  taskName: z.string()
    .optional()
    .describe("The task name to search for. Used if taskId is not provided."),
  action: z.enum(["complete", "drop"])
    .default("complete")
    .describe("Action to perform: 'complete' marks the task done, 'drop' marks it as dropped/cancelled")
}).strict().refine(
  (data) => data.taskId || data.taskName,
  { message: "Either taskId or taskName must be provided" }
);

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

    const actionCode = action === "drop"
      ? "task.markDropped();"
      : "task.markComplete();";

    let findTaskScript: string;
    if (taskId) {
      // Use ID if provided (takes priority)
      findTaskScript = `
        var task = doc.flattenedTasks().find(function(t) { return t.id() === "${taskId}"; });
        if (!task) { throw new Error("Task not found with ID: ${taskId}"); }
      `;
    } else if (taskName) {
      // Search by name
      const escapedName = taskName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      findTaskScript = `
        var allTasks = doc.flattenedTasks();

        // Try exact match first
        var task = allTasks.find(function(t) { return t.name() === "${escapedName}"; });

        // If no exact match, try case-insensitive partial match
        if (!task) {
          var searchLower = "${escapedName.toLowerCase()}";
          var matches = allTasks.filter(function(t) {
            return t.name().toLowerCase().indexOf(searchLower) !== -1;
          });

          if (matches.length === 0) {
            throw new Error("No task found matching name: ${escapedName}");
          } else if (matches.length > 1) {
            var matchList = matches.map(function(t) {
              var proj = t.containingProject();
              return "- " + t.name() + " (ID: " + t.id() + (proj ? ", Project: " + proj.name() : "") + ")";
            }).join("\\n");
            throw new Error("Multiple tasks found matching '${escapedName}'. Please use taskId or be more specific:\\n" + matchList);
          }
          task = matches[0];
        }
      `;
    } else {
      return {
        isError: true,
        content: [{ type: "text", text: "Either taskId or taskName must be provided" }]
      };
    }

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
// Tool: Add Tag to Task
// ============================================================================

const AddTagInputSchema = z.object({
  taskId: z.string()
    .optional()
    .describe("The task ID to add the tag to. Takes priority if both taskId and taskName are provided."),
  taskName: z.string()
    .optional()
    .describe("The task name to search for. Used if taskId is not provided."),
  tagName: z.string()
    .describe("The name of the tag to add")
}).strict().refine(
  (data) => data.taskId || data.taskName,
  { message: "Either taskId or taskName must be provided" }
);

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
    const escapeTagName = tagName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    let findTaskScript: string;
    if (taskId) {
      // Use ID if provided (takes priority)
      findTaskScript = `
        var task = doc.flattenedTasks().find(function(t) { return t.id() === "${taskId}"; });
        if (!task) { throw new Error("Task not found with ID: ${taskId}"); }
      `;
    } else if (taskName) {
      // Search by name
      const escapedName = taskName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      findTaskScript = `
        var allTasks = doc.flattenedTasks();

        // Try exact match first
        var task = allTasks.find(function(t) { return t.name() === "${escapedName}"; });

        // If no exact match, try case-insensitive partial match
        if (!task) {
          var searchLower = "${escapedName.toLowerCase()}";
          var matches = allTasks.filter(function(t) {
            return t.name().toLowerCase().indexOf(searchLower) !== -1;
          });

          if (matches.length === 0) {
            throw new Error("No task found matching name: ${escapedName}");
          } else if (matches.length > 1) {
            var matchList = matches.map(function(t) {
              var proj = t.containingProject();
              return "- " + t.name() + " (ID: " + t.id() + (proj ? ", Project: " + proj.name() : "") + ")";
            }).join("\\n");
            throw new Error("Multiple tasks found matching '${escapedName}'. Please use taskId or be more specific:\\n" + matchList);
          }
          task = matches[0];
        }
      `;
    } else {
      return {
        isError: true,
        content: [{ type: "text", text: "Either taskId or taskName must be provided" }]
      };
    }

    const script = `
      ${TASK_MAPPER}
      ${findTaskScript}

      var tag = doc.flattenedTags().find(function(t) { return t.name() === "${escapeTagName}"; });
      if (!tag) { throw new Error("Tag not found: ${escapeTagName}"); }

      // Check if tag is already on task
      var existingTag = task.tags().find(function(t) { return t.name() === "${escapeTagName}"; });
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

const RemoveTagInputSchema = z.object({
  taskId: z.string()
    .optional()
    .describe("The task ID to remove the tag from. Takes priority if both taskId and taskName are provided."),
  taskName: z.string()
    .optional()
    .describe("The task name to search for. Used if taskId is not provided."),
  tagName: z.string()
    .describe("The name of the tag to remove")
}).strict().refine(
  (data) => data.taskId || data.taskName,
  { message: "Either taskId or taskName must be provided" }
);

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
    const escapeTagName = tagName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    let findTaskScript: string;
    if (taskId) {
      // Use ID if provided (takes priority)
      findTaskScript = `
        var task = doc.flattenedTasks().find(function(t) { return t.id() === "${taskId}"; });
        if (!task) { throw new Error("Task not found with ID: ${taskId}"); }
      `;
    } else if (taskName) {
      // Search by name
      const escapedName = taskName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      findTaskScript = `
        var allTasks = doc.flattenedTasks();

        // Try exact match first
        var task = allTasks.find(function(t) { return t.name() === "${escapedName}"; });

        // If no exact match, try case-insensitive partial match
        if (!task) {
          var searchLower = "${escapedName.toLowerCase()}";
          var matches = allTasks.filter(function(t) {
            return t.name().toLowerCase().indexOf(searchLower) !== -1;
          });

          if (matches.length === 0) {
            throw new Error("No task found matching name: ${escapedName}");
          } else if (matches.length > 1) {
            var matchList = matches.map(function(t) {
              var proj = t.containingProject();
              return "- " + t.name() + " (ID: " + t.id() + (proj ? ", Project: " + proj.name() : "") + ")";
            }).join("\\n");
            throw new Error("Multiple tasks found matching '${escapedName}'. Please use taskId or be more specific:\\n" + matchList);
          }
          task = matches[0];
        }
      `;
    } else {
      return {
        isError: true,
        content: [{ type: "text", text: "Either taskId or taskName must be provided" }]
      };
    }

    const script = `
      ${TASK_MAPPER}
      ${findTaskScript}

      var tagOnTask = task.tags().find(function(t) { return t.name() === "${escapeTagName}"; });
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
// Tool: Search
// ============================================================================

const SearchInputSchema = z.object({
  query: z.string()
    .min(1)
    .max(200)
    .describe("Search query string"),
  searchType: z.enum(["tasks", "projects", "folders", "tags", "all"])
    .default("all")
    .describe("Type of items to search"),
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum results per type")
}).strict();

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
    const escapeQuery = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    
    const results: Record<string, unknown[]> = {};
    
    try {
      if (searchType === "tasks" || searchType === "all") {
        const taskScript = `
          ${TASK_MAPPER}
          var q = "${escapeQuery}".toLowerCase();
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
          var q = "${escapeQuery}".toLowerCase();
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
          var q = "${escapeQuery}".toLowerCase();
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
          var q = "${escapeQuery}".toLowerCase();
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

// ============================================================================
// Tool: Get Due Tasks
// ============================================================================

const GetDueTasksInputSchema = z.object({
  daysAhead: z.number()
    .int()
    .min(0)
    .max(365)
    .default(7)
    .describe("Number of days ahead to look (0 = today only)"),
  includeOverdue: z.boolean()
    .default(true)
    .describe("Include overdue tasks"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum tasks to return")
}).strict();

server.registerTool(
  "omnifocus_get_due_tasks",
  {
    title: "Get Due Tasks",
    description: `Get tasks that are due within a specified timeframe.

Args:
  - daysAhead (number): Days to look ahead, 0-365 (default: 7)
  - includeOverdue (boolean): Include overdue tasks (default: true)
  - limit (number): Max tasks, 1-500 (default: 50)

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
    const { daysAhead, includeOverdue, limit } = params;
    
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
      }).slice(0, ${limit});

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

const GetFlaggedTasksInputSchema = z.object({
  includeCompleted: z.boolean()
    .default(false)
    .describe("Include completed tasks"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum tasks to return")
}).strict();

server.registerTool(
  "omnifocus_get_flagged_tasks",
  {
    title: "Get Flagged Tasks",
    description: `Get all flagged tasks in OmniFocus.

Args:
  - includeCompleted (boolean): Include completed tasks (default: false)
  - limit (number): Max tasks, 1-500 (default: 50)

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
    const { includeCompleted, limit } = params;
    
    const script = `
      ${TASK_MAPPER}
      var tasks = doc.flattenedTasks().filter(function(t) {
        if (!t.flagged()) return false;
        ${!includeCompleted ? 'if (t.completed()) return false;' : ''}
        return true;
      }).slice(0, ${limit});
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

const GetPlannedTasksInputSchema = z.object({
  daysAhead: z.number()
    .int()
    .min(0)
    .max(365)
    .default(7)
    .describe("Number of days ahead to look (0 = today only)"),
  includeOverdue: z.boolean()
    .default(true)
    .describe("Include overdue planned tasks"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum tasks to return")
}).strict();

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
    const { daysAhead, includeOverdue, limit } = params;

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
      }).slice(0, ${limit});

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

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OmniFocus MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
