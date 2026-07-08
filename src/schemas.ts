/**
 * Zod input schemas for all MCP tools.
 */

import { z } from "zod";

// Shared tag-filter fields, spread into task-returning tool schemas.
export const tagFilterFields = {
  tags: z.array(z.string())
    .max(20)
    .optional()
    .describe("Filter to tasks matching these tag names (combined per tagMatchMode)"),
  tagMatchMode: z.enum(["all", "any", "none"])
    .default("all")
    .describe("How to match tags: 'all' = task has every listed tag, 'any' = at least one, 'none' = none of them. Only applied when tags is provided.")
};

export const ListInboxInputSchema = z.object({
  includeCompleted: z.boolean()
    .default(false)
    .describe("Include completed tasks in results"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum number of tasks to return"),
  ...tagFilterFields
}).strict();

export const ListProjectsInputSchema = z.object({
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

export const GetProjectTasksInputSchema = z.object({
  projectId: z.string()
    .describe("The ID of the project to get tasks for"),
  includeCompleted: z.boolean()
    .default(false)
    .describe("Include completed tasks"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Maximum number of tasks to return")
}).strict();

export const ListFoldersInputSchema = z.object({
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

export const ListTagsInputSchema = z.object({
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

export const CreateTaskInputSchema = z.object({
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
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Must be ISO 8601 format (e.g., '2024-12-31T17:00:00')")
    .optional()
    .describe("Due date in ISO 8601 format (e.g., '2024-12-31T17:00:00')"),
  deferDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Must be ISO 8601 format (e.g., '2024-12-31T17:00:00')")
    .optional()
    .describe("Defer/start date in ISO 8601 format"),
  plannedDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Must be ISO 8601 format (e.g., '2024-12-31T17:00:00')")
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

export const CompleteTaskInputSchema = z.object({
  taskId: z.string()
    .optional()
    .describe("The task ID (primaryKey) to update. Takes priority if both taskId and taskName are provided."),
  taskName: z.string()
    .optional()
    .describe("The task name to search for. Used if taskId is not provided."),
  action: z.enum(["complete", "drop"])
    .default("complete")
    .describe("Action to perform: 'complete' marks the task done, 'drop' marks it as dropped/cancelled")
}).strict();

export const AddTagInputSchema = z.object({
  taskId: z.string()
    .optional()
    .describe("The task ID to add the tag to. Takes priority if both taskId and taskName are provided."),
  taskName: z.string()
    .optional()
    .describe("The task name to search for. Used if taskId is not provided."),
  tagName: z.string()
    .describe("The name of the tag to add")
}).strict();

export const RemoveTagInputSchema = z.object({
  taskId: z.string()
    .optional()
    .describe("The task ID to remove the tag from. Takes priority if both taskId and taskName are provided."),
  taskName: z.string()
    .optional()
    .describe("The task name to search for. Used if taskId is not provided."),
  tagName: z.string()
    .describe("The name of the tag to remove")
}).strict();

export const UpdateTaskNoteInputSchema = z.object({
  taskId: z.string()
    .optional()
    .describe("The task ID to update. Takes priority if both taskId and taskName are provided."),
  taskName: z.string()
    .optional()
    .describe("The task name to search for. Used if taskId is not provided."),
  note: z.string()
    .max(10000)
    .describe("The new note content for the task. Use empty string to clear the note."),
  append: z.boolean()
    .default(false)
    .describe("If true, append to existing note instead of replacing it")
}).strict();

export const UpdateProjectNoteInputSchema = z.object({
  projectId: z.string()
    .optional()
    .describe("The project ID to update. Takes priority if both projectId and projectName are provided."),
  projectName: z.string()
    .optional()
    .describe("The project name to search for. Used if projectId is not provided."),
  note: z.string()
    .max(10000)
    .describe("The new note content for the project. Use empty string to clear the note."),
  append: z.boolean()
    .default(false)
    .describe("If true, append to existing note instead of replacing it")
}).strict();

export const SearchInputSchema = z.object({
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

export const GetDueTasksInputSchema = z.object({
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
    .describe("Maximum tasks to return"),
  ...tagFilterFields
}).strict();

export const GetFlaggedTasksInputSchema = z.object({
  includeCompleted: z.boolean()
    .default(false)
    .describe("Include completed tasks"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum tasks to return"),
  ...tagFilterFields
}).strict();

export const GetPlannedTasksInputSchema = z.object({
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
    .describe("Maximum tasks to return"),
  ...tagFilterFields
}).strict();

export const GetProjectsForReviewInputSchema = z.object({
  daysAhead: z.number()
    .int()
    .min(0)
    .max(365)
    .default(0)
    .describe("Number of days ahead to look (0 = overdue reviews only)"),
  status: z.enum(["all", "active", "done", "dropped", "onHold"])
    .default("active")
    .describe("Filter by project status"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum projects to return")
}).strict();

export const MarkProjectReviewedInputSchema = z.object({
  projectId: z.string()
    .optional()
    .describe("The project ID to mark as reviewed. Takes priority if both projectId and projectName are provided."),
  projectName: z.string()
    .optional()
    .describe("The project name to search for. Used if projectId is not provided."),
  reviewIntervalDays: z.number()
    .int()
    .min(1)
    .max(3650)
    .optional()
    .describe("Number of days until next review (optional - uses project's current interval if not specified)")
}).strict();

export const BatchMarkReviewedInputSchema = z.object({
  projectIds: z.array(z.string())
    .min(1)
    .max(100)
    .describe("Array of project IDs to mark as reviewed"),
  reviewIntervalDays: z.number()
    .int()
    .min(1)
    .max(3650)
    .optional()
    .describe("Optional custom review interval in days to apply to all projects")
}).strict();

export const ListPerspectivesInputSchema = z.object({
  limit: z.number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe("Maximum number of perspectives to return")
}).strict();

export const GetPerspectiveTasksInputSchema = z.object({
  perspectiveName: z.string()
    .min(1)
    .max(200)
    .describe("The name of the perspective to get tasks from"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum number of tasks to return")
}).strict();

export const CreateProjectInputSchema = z.object({
  name: z.string()
    .min(1)
    .max(500)
    .describe("Project name (required)"),
  note: z.string()
    .max(10000)
    .optional()
    .describe("Optional note/description for the project"),
  folderName: z.string()
    .max(500)
    .optional()
    .describe("Name of the folder to place the project in. If omitted, project is created at the top level."),
  dueDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Must be ISO 8601 format (e.g., '2024-12-31T17:00:00')")
    .optional()
    .describe("Due date in ISO 8601 format"),
  deferDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Must be ISO 8601 format (e.g., '2024-12-31T17:00:00')")
    .optional()
    .describe("Defer/start date in ISO 8601 format"),
  flagged: z.boolean()
    .default(false)
    .describe("Whether to flag the project"),
  sequential: z.boolean()
    .default(false)
    .describe("If true, tasks must be completed in order (sequential project). Default is parallel."),
  status: z.enum(["active", "on hold", "done", "dropped"])
    .default("active")
    .describe("Initial project status")
}).strict();

export const UpdateTaskInputSchema = z.object({
  taskId: z.string()
    .optional()
    .describe("The task ID to update. Takes priority if both taskId and taskName are provided."),
  taskName: z.string()
    .optional()
    .describe("The task name to search for. At least one of taskId or taskName is required."),
  name: z.string()
    .min(1)
    .max(500)
    .optional()
    .describe("New task name"),
  note: z.string()
    .max(10000)
    .nullable()
    .optional()
    .describe("New note text. Pass null to clear the note."),
  dueDate: z.string()
    .nullable()
    .optional()
    .describe("New due date in ISO 8601 format. Pass null to clear."),
  deferDate: z.string()
    .nullable()
    .optional()
    .describe("New defer/start date in ISO 8601 format. Pass null to clear."),
  plannedDate: z.string()
    .nullable()
    .optional()
    .describe("New planned date in ISO 8601 format. Pass null to clear."),
  flagged: z.boolean()
    .optional()
    .describe("Set flagged state"),
  estimatedMinutes: z.number()
    .int()
    .min(0)
    .max(9999)
    .optional()
    .describe("Estimated time in minutes. Pass 0 to clear."),
  projectId: z.string()
    .optional()
    .describe("ID of the project to move the task to."),
  projectName: z.string()
    .optional()
    .describe("Name of the project to move the task to. Ignored if projectId is provided."),
  clearRecurrence: z.boolean()
    .optional()
    .describe("Set true to remove the task's repetition rule (turn off recurring).")
}).strict();

export const DeleteTaskInputSchema = z.object({
  taskId: z.string()
    .optional()
    .describe("The task ID to delete. Takes priority if both taskId and taskName are provided."),
  taskName: z.string()
    .optional()
    .describe("The task name to search for. At least one of taskId or taskName is required.")
}).strict();

export const BatchCompleteTaskInputSchema = z.object({
  taskIds: z.array(z.string())
    .min(1)
    .max(100)
    .describe("Array of task IDs to complete or drop (1-100 tasks)"),
  action: z.enum(["complete", "drop"])
    .default("complete")
    .describe("'complete' (default) or 'drop'")
}).strict();

export const BatchAddTagInputSchema = z.object({
  taskIds: z.array(z.string())
    .min(1)
    .max(100)
    .describe("Array of task IDs to add the tag to (1-100 tasks)"),
  tagName: z.string()
    .describe("Name of the tag to add (must already exist)")
}).strict();

export const BatchRemoveTagInputSchema = z.object({
  taskIds: z.array(z.string())
    .min(1)
    .max(100)
    .describe("Array of task IDs to remove the tag from (1-100 tasks)"),
  tagName: z.string()
    .describe("Name of the tag to remove")
}).strict();

export const UpdateProjectInputSchema = z.object({
  projectId: z.string()
    .optional()
    .describe("The project ID to update. Takes priority if both projectId and projectName are provided."),
  projectName: z.string()
    .optional()
    .describe("The project name to search for. At least one of projectId or projectName is required."),
  name: z.string()
    .min(1)
    .max(500)
    .optional()
    .describe("New project name"),
  note: z.string()
    .max(10000)
    .nullable()
    .optional()
    .describe("New note text. Pass null to clear the note."),
  status: z.enum(["active", "on hold", "done", "dropped"])
    .optional()
    .describe("New project status"),
  flagged: z.boolean()
    .optional()
    .describe("Set flagged state"),
  dueDate: z.string()
    .nullable()
    .optional()
    .describe("New due date in ISO 8601 format. Pass null to clear."),
  deferDate: z.string()
    .nullable()
    .optional()
    .describe("New defer/start date in ISO 8601 format. Pass null to clear."),
  sequential: z.boolean()
    .optional()
    .describe("If true, tasks must be completed in order (sequential). If false, parallel."),
  reviewIntervalDays: z.number()
    .int()
    .min(1)
    .max(3650)
    .optional()
    .describe("Review interval in days.")
}).strict();

export const DeleteProjectInputSchema = z.object({
  projectId: z.string()
    .optional()
    .describe("The project ID to delete. Takes priority if both projectId and projectName are provided."),
  projectName: z.string()
    .optional()
    .describe("The project name to search for. At least one of projectId or projectName is required.")
}).strict();

export const CreateFolderInputSchema = z.object({
  name: z.string()
    .min(1)
    .max(500)
    .describe("Folder name (required)"),
  parentFolderName: z.string()
    .max(500)
    .optional()
    .describe("Name of the parent folder to nest inside. If omitted, folder is created at the top level.")
}).strict();

export const UpdateFolderInputSchema = z.object({
  folderId: z.string()
    .optional()
    .describe("The folder ID to update. Takes priority if both folderId and folderName are provided."),
  folderName: z.string()
    .optional()
    .describe("The folder name to search for. At least one of folderId or folderName is required."),
  name: z.string()
    .min(1)
    .max(500)
    .describe("New folder name")
}).strict();

export const DeleteFolderInputSchema = z.object({
  folderId: z.string()
    .optional()
    .describe("The folder ID to delete. Takes priority if both folderId and folderName are provided."),
  folderName: z.string()
    .optional()
    .describe("The folder name to search for. At least one of folderId or folderName is required.")
}).strict();
