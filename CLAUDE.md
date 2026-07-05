# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode - recompiles on changes
npm run start      # Run the compiled server
```

Test the server manually:
```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js
```

## Architecture

This is an MCP (Model Context Protocol) server that bridges AI assistants to OmniFocus on macOS. It uses a single-file architecture in `src/index.ts`.

### Core Components

**Script Execution Layer** (`executeOmniFocusScript`, `executeAndParseJSON`): Runs JXA (JavaScript for Automation) scripts via `osascript -l JavaScript`. Scripts are written to a temp file to avoid shell escaping issues.

**Important**: This server uses **direct JXA**, not Omni Automation's `doc.evaluate()`. The evaluate method doesn't work from external JXA scripts due to type conversion errors (-1700).

**Data Mappers** (`TASK_MAPPER`, `PROJECT_MAPPER`, `FOLDER_MAPPER`, `TAG_MAPPER`, `PERSPECTIVE_MAPPER`): JXA code snippets that transform OmniFocus objects into serializable JSON. These are string constants injected into every script that needs them.

**Tool Registrations**: Each MCP tool follows a pattern:
1. Define a Zod schema for input validation
2. Register with `server.registerTool()` including metadata and annotations
3. Build a JXA script string using template literals
4. Execute via `executeAndParseJSON<T>()` and return formatted results

### Communication Pattern

The server uses stdio transport. OmniFocus communication happens through:
```
MCP Client → stdio → this server → osascript -l JavaScript → OmniFocus.app
```

## JXA Syntax Notes

JXA accesses OmniFocus objects differently than Omni Automation:

| Omni Automation | JXA |
|-----------------|-----|
| `task.name` | `task.name()` |
| `flattenedProjects` | `doc.flattenedProjects()` |
| `inbox` | `doc.inboxTasks()` |
| `project.parentFolder` | `project.folder()` |
| `project.status.name` | `String(project.status())` |
| `task.addTag(tag)` | `app.add(tag, { to: task.tags })` |
| `task.removeTag(tag)` | `app.remove(tag, { from: task.tags })` |
| `task.completed = true` | `task.markComplete()` (direct property set not allowed) |
| `task.dropped = true` | `task.markDropped()` (direct property set not allowed) |

Status values in JXA: `"active status"`, `"done status"`, `"dropped status"`, `"on hold status"`

Folders and tags use `hidden()` instead of `status()` for filtering.

### JXA gotchas verified against a live database

- **`project.reviewInterval` is a `{unit, steps}` record, not a number.** Assigning a raw number of seconds (e.g. `days * 24 * 60 * 60`) **segfaults osascript**. Use `project.reviewInterval = {unit: "day", steps: N}`.
- **Projects and folders cannot be moved between containers via direct JXA.** `app.move(project, {to: folder.projects.end})` returns "Replacement not supported currently", and direct assignment (`project.folder = ...`, `folder.container = ...`) is rejected with "access not allowed". Creating a project/folder directly inside a folder (`folder.projects.push(...)` / `parentFolder.folders.push(...)`) does work, so move must be done by recreate-and-delete if ever needed.
- **`app.delete(obj)` works on a single object** (task, project, folder, tag). A "requires a list of (null)" error usually means the object was already removed by a cascade delete.

## Available Tools

- `omnifocus_list_inbox` - List inbox tasks
- `omnifocus_list_projects` - List projects (filterable by status, folder)
- `omnifocus_get_project_tasks` - Get all tasks for a specific project
- `omnifocus_list_folders` - List folders
- `omnifocus_list_tags` - List tags
- `omnifocus_create_task` - Create task (inbox or in project, with tags)
- `omnifocus_create_project` - Create a new project (optionally inside a folder, with status, dates, sequential mode)
- `omnifocus_update_project` - Update project properties (name, note, status, flag, dates, sequential, reviewInterval). Note: cannot move a project between folders (JXA limitation).
- `omnifocus_delete_project` - Delete a project (and its tasks)
- `omnifocus_create_folder` - Create a folder (top-level or nested via parentFolderName)
- `omnifocus_update_folder` - Rename a folder. Note: cannot move a folder into another (JXA limitation).
- `omnifocus_delete_folder` - Delete a folder (and its contents)
- `omnifocus_complete_task` - Complete or drop a task (action: "complete" | "drop")
- `omnifocus_update_task` - Update task properties (name, note, dates, flag, estimate, move to project)
- `omnifocus_delete_task` - Delete a task
- `omnifocus_batch_complete_task` - Complete/drop multiple tasks by ID (action: "complete" | "drop")
- `omnifocus_add_tag_to_task` - Add tag to task
- `omnifocus_remove_tag_from_task` - Remove tag from task
- `omnifocus_batch_add_tag` - Add one tag to multiple tasks by ID
- `omnifocus_batch_remove_tag` - Remove one tag from multiple tasks by ID
- `omnifocus_update_task_note` - Update/clear/append to a task's note
- `omnifocus_update_project_note` - Update/clear/append to a project's note
- `omnifocus_search` - Search tasks, projects, folders, tags
- `omnifocus_get_due_tasks` - Get tasks due within N days (supports tags + tagMatchMode)
- `omnifocus_get_flagged_tasks` - Get flagged tasks (supports tags + tagMatchMode)
- `omnifocus_get_planned_tasks` - Get tasks with a planned date (supports tags + tagMatchMode)
- `omnifocus_get_projects_for_review` - Get projects due for review
- `omnifocus_mark_project_reviewed` - Mark a single project as reviewed
- `omnifocus_batch_mark_reviewed` - Batch mark multiple projects as reviewed
- `omnifocus_list_perspectives` - List perspectives (built-in and custom)
- `omnifocus_get_perspective_tasks` - Get tasks shown in a specific perspective

`omnifocus_list_inbox` also supports `tags` + `tagMatchMode` ("all" | "any" | "none") for multi-tag filtering.

## Testing

```bash
npm test              # Run all unit tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report (output in coverage/)
```

Tests live in `src/__tests__/`: `tools.test.ts` (137 tests), `executor.test.ts` (10 tests, `child_process.exec` mocked), `sanitization.test.ts` (50 tests), `integration.test.ts` (14 tests, skipped by default — requires running OmniFocus and modifies your database).

Coverage target: 80%+ lines, 75%+ branches. These are enforced as thresholds in `vitest.config.ts`, so `npm run test:coverage` fails if coverage drops below them.

## Key Implementation Details

- Date format: ISO 8601 (`YYYY-MM-DDTHH:mm:ss`) for all date parameters
- Task lookups: `doc.flattenedTasks().find(t => t.id() === "...")`
- All tools have `annotations` for hints about behavior (read-only, destructive, idempotent)
- Error messages handle common macOS issues: OmniFocus not running, automation permissions denied
