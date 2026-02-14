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

## Available Tools

- `omnifocus_list_inbox` - List inbox tasks
- `omnifocus_list_projects` - List projects (filterable by status, folder)
- `omnifocus_list_folders` - List folders
- `omnifocus_list_tags` - List tags
- `omnifocus_create_task` - Create task (inbox or in project, with tags)
- `omnifocus_complete_task` - Complete or drop a task (action: "complete" | "drop")
- `omnifocus_add_tag_to_task` - Add tag to task
- `omnifocus_remove_tag_from_task` - Remove tag from task
- `omnifocus_search` - Search tasks, projects, folders, tags
- `omnifocus_get_due_tasks` - Get tasks due within N days
- `omnifocus_get_flagged_tasks` - Get flagged tasks
- `omnifocus_get_planned_tasks` - Get tasks with a planned date
- `omnifocus_get_projects_for_review` - Get projects due for review
- `omnifocus_mark_project_reviewed` - Mark a single project as reviewed
- `omnifocus_batch_mark_reviewed` - Batch mark multiple projects as reviewed
- `omnifocus_list_perspectives` - List perspectives (built-in and custom)
- `omnifocus_get_perspective_tasks` - Get tasks shown in a specific perspective

## Testing

```bash
npm test              # Run all unit tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report (output in coverage/)
```

Tests live in `src/__tests__/`: `tools.test.ts` (54 tests), `sanitization.test.ts` (49 tests), `integration.test.ts` (12 tests, skipped by default — requires running OmniFocus and modifies your database).

Coverage target: 80%+ lines, 75%+ branches.

## Key Implementation Details

- Date format: ISO 8601 (`YYYY-MM-DDTHH:mm:ss`) for all date parameters
- Task lookups: `doc.flattenedTasks().find(t => t.id() === "...")`
- All tools have `annotations` for hints about behavior (read-only, destructive, idempotent)
- Error messages handle common macOS issues: OmniFocus not running, automation permissions denied
