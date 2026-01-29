# OmniFocus MCP Server

A Model Context Protocol (MCP) server that enables AI assistants to interact with OmniFocus on macOS via JXA (JavaScript for Automation).

## Features

This MCP server provides access to OmniFocus functionality:

### Task Management
- **List inbox tasks** - View and filter tasks in your inbox
- **Create tasks** - Add new tasks with full property support (due dates, planned dates, tags, notes, etc.)
- **Complete/Drop tasks** - Mark tasks as done or dropped
- **Get due tasks** - Find tasks due within a timeframe
- **Get planned tasks** - Find tasks planned within a timeframe
- **Get flagged tasks** - List all flagged items
- **Add/remove tags from tasks** - Manage task tags

### Project Management
- **List projects** - View projects with status filtering
- **Get projects for review** - Find projects needing review based on next review date
- **Mark project reviewed** - Update a project's review status and next review date
- **Batch mark reviewed** - Efficiently review multiple projects at once

### Organization
- **List folders** - View folder hierarchy
- **List tags** - View all tags

### Search
- **Universal search** - Search across tasks, projects, folders, and tags

## Requirements

- **macOS** (OmniFocus is macOS/iOS only, and this server uses JXA)
- **OmniFocus 3+** installed
- **Node.js 18+**
- **Automation permissions** enabled for your terminal/client app

## Installation

1. Clone or download this repository:
   ```bash
   cd omnifocus-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the TypeScript:
   ```bash
   npm run build
   ```

4. Configure your MCP client to use the server (see Configuration below)

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "node",
      "args": ["/path/to/omnifocus-mcp-server/dist/index.js"]
    }
  }
}
```

### Other MCP Clients

The server uses stdio transport, so configure your client to spawn:
```
node /path/to/omnifocus-mcp-server/dist/index.js
```

## Permissions

On first use, macOS will prompt you to allow automation access:

1. Go to **System Preferences** → **Security & Privacy** → **Privacy** → **Automation**
2. Enable permission for your terminal or Claude Desktop to control OmniFocus

## Tool Reference

### omnifocus_list_inbox
List tasks in the inbox.
```json
{
  "includeCompleted": false,
  "limit": 50
}
```

### omnifocus_list_projects
List projects with filtering.
```json
{
  "status": "active",
  "folderName": "Work",
  "limit": 50
}
```

### omnifocus_list_folders
List all folders.
```json
{
  "status": "active",
  "limit": 50
}
```

### omnifocus_list_tags
List all tags.
```json
{
  "status": "active",
  "limit": 50
}
```

### omnifocus_create_task
Create a new task.
```json
{
  "name": "Review quarterly report",
  "note": "Check all sections",
  "projectName": "Work",
  "dueDate": "2024-12-31T17:00:00",
  "deferDate": "2024-12-01T09:00:00",
  "plannedDate": "2024-12-15T09:00:00",
  "flagged": true,
  "estimatedMinutes": 60,
  "tagNames": ["Review", "Important"]
}
```

**Planned Date vs Due Date:**
- `dueDate`: When the task must be completed (deadline)
- `plannedDate`: When you intend to work on the task (planning)
- This distinction is crucial for separating deadlines from scheduled work time

### omnifocus_complete_task
Mark a task as complete or dropped. You can identify the task by either ID or name.
```json
{
  "taskId": "abc123",
  "action": "complete"
}
```
Or using task name:
```json
{
  "taskName": "Write documentation",
  "action": "complete"
}
```
Action can be `"complete"` (default) or `"drop"`. If both `taskId` and `taskName` are provided, `taskId` takes priority.

### omnifocus_add_tag_to_task
Add a tag to a task. You can identify the task by either ID or name.
```json
{
  "taskId": "abc123",
  "tagName": "Urgent"
}
```
Or using task name:
```json
{
  "taskName": "Write report",
  "tagName": "Urgent"
}
```
If both `taskId` and `taskName` are provided, `taskId` takes priority.

### omnifocus_remove_tag_from_task
Remove a tag from a task. You can identify the task by either ID or name.
```json
{
  "taskId": "abc123",
  "tagName": "Urgent"
}
```
Or using task name:
```json
{
  "taskName": "Old task",
  "tagName": "Done"
}
```
If both `taskId` and `taskName` are provided, `taskId` takes priority.

### omnifocus_search
Search across OmniFocus.
```json
{
  "query": "report",
  "searchType": "all",
  "limit": 20
}
```

### omnifocus_get_due_tasks
Get tasks due within a timeframe.
```json
{
  "daysAhead": 7,
  "includeOverdue": true,
  "limit": 50
}
```

### omnifocus_get_flagged_tasks
Get flagged tasks.
```json
{
  "includeCompleted": false,
  "limit": 50
}
```

### omnifocus_get_planned_tasks
Get tasks planned within a timeframe.
```json
{
  "daysAhead": 7,
  "includeOverdue": true,
  "limit": 50
}
```

### omnifocus_get_projects_for_review
Get projects that need review based on their next review date. Perfect for GTD practitioners following the review workflow.
```json
{
  "daysAhead": 0,
  "status": "active",
  "limit": 50
}
```
Parameters:
- `daysAhead`: How many days ahead to look (0 = overdue reviews only)
- `status`: Filter by project status ("active", "done", "dropped", "onHold", "all")
- `limit`: Maximum number of projects to return (1-500)

### omnifocus_mark_project_reviewed
Mark a project as reviewed and update its next review date. You can identify the project by either ID or name.
```json
{
  "projectId": "abc123"
}
```
Or using project name:
```json
{
  "projectName": "Weekly Review"
}
```
With custom review interval:
```json
{
  "projectName": "Work Project",
  "reviewIntervalDays": 14
}
```
Parameters:
- `projectId` or `projectName`: Identifies the project (ID takes priority)
- `reviewIntervalDays` (optional): Custom review interval in days. If not provided, uses the project's existing review interval.

### omnifocus_batch_mark_reviewed
Mark multiple projects as reviewed in one efficient operation.
```json
{
  "projectIds": ["id1", "id2", "id3"]
}
```
With custom review interval for all:
```json
{
  "projectIds": ["id1", "id2", "id3"],
  "reviewIntervalDays": 7
}
```
Parameters:
- `projectIds`: Array of project IDs to mark as reviewed (1-100 projects)
- `reviewIntervalDays` (optional): Custom review interval to apply to all projects

Returns a summary with:
- Count of successful reviews
- Count of failures
- Full project data for successful reviews
- Error details for any failures

## Date Formats

All dates use ISO 8601 format: `YYYY-MM-DDTHH:mm:ss`

Examples:
- `2024-12-31T17:00:00` - December 31, 2024 at 5:00 PM
- `2024-06-15T09:00:00` - June 15, 2024 at 9:00 AM

## Error Handling

The server provides clear error messages for common issues:

- **OmniFocus not running**: Launch OmniFocus first
- **Permission denied**: Enable automation permissions in System Preferences
- **Item not found**: The specified ID doesn't exist
- **Invalid parameters**: Check parameter format and values

## Development

### Build
```bash
npm run build
```

### Watch mode
```bash
npm run dev
```

### Test manually
After building, you can test with:
```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js
```

## License

MIT

## Credits

Built using:
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [OmniFocus JXA API](https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/)
