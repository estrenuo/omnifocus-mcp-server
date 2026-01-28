# OmniFocus MCP Server

A Model Context Protocol (MCP) server that enables AI assistants to interact with OmniFocus on macOS via JXA (JavaScript for Automation).

## Features

This MCP server provides access to OmniFocus functionality:

### Task Management
- **List inbox tasks** - View and filter tasks in your inbox
- **Create tasks** - Add new tasks with full property support (due dates, tags, notes, etc.)
- **Complete/Drop tasks** - Mark tasks as done or dropped
- **Get due tasks** - Find tasks due within a timeframe
- **Get flagged tasks** - List all flagged items
- **Add/remove tags from tasks** - Manage task tags

### Project Management
- **List projects** - View projects with status filtering

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
  "flagged": true,
  "estimatedMinutes": 60,
  "tagNames": ["Review", "Important"]
}
```

### omnifocus_complete_task
Mark a task as complete or dropped. Can use either task ID or task name.
```json
{
  "taskId": "abc123",
  "action": "complete"
}
```
Or by name:
```json
{
  "taskName": "Write documentation",
  "action": "complete"
}
```
Action can be `"complete"` (default) or `"drop"`. If both `taskId` and `taskName` are provided, `taskId` takes priority.

### omnifocus_add_tag_to_task
Add a tag to a task. Can use either task ID or task name.
```json
{
  "taskId": "abc123",
  "tagName": "Urgent"
}
```
Or by name:
```json
{
  "taskName": "Write report",
  "tagName": "Urgent"
}
```
If both `taskId` and `taskName` are provided, `taskId` takes priority.

### omnifocus_remove_tag_from_task
Remove a tag from a task. Can use either task ID or task name.
```json
{
  "taskId": "abc123",
  "tagName": "Urgent"
}
```
Or by name:
```json
{
  "taskName": "Write report",
  "tagName": "Urgent"
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
