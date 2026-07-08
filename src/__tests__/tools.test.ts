/**
 * Unit tests for MCP tool handlers
 *
 * These tests call tool handlers through a real MCP client-server connection,
 * mocking only executeAndParseJSON (the OmniFocus boundary). This verifies:
 * - JXA script construction
 * - Input sanitization
 * - Response formatting
 * - Error handling
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { TaskData, ProjectData, FolderData, TagData, PerspectiveData } from '../index.js';

// Mock the executor module - this intercepts calls from tool handlers
vi.mock('../executor.js', () => ({
  executeAndParseJSON: vi.fn(),
  executeOmniFocusScript: vi.fn(),
}));

import { server } from '../index.js';
import { executeAndParseJSON, executeOmniFocusScript } from '../executor.js';

// Helper to parse the JSON response text from an MCP tool result
function parseResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Helper function to create mock task with all required fields
const createMockTask = (overrides: Partial<TaskData> = {}): TaskData => ({
  id: 'task-default',
  name: 'Default Task',
  note: '',
  completed: false,
  dropped: false,
  flagged: false,
  dueDate: null,
  deferDate: null,
  plannedDate: null,
  estimatedMinutes: null,
  tags: [],
  projectName: null,
  inInbox: true,
  repetitionRule: null,
  repetitionMethod: null,
  parentTaskId: null,
  parentTaskName: null,
  hasChildren: false,
  childTaskCount: 0,
  ...overrides,
});

const createMockProject = (overrides: Partial<ProjectData> = {}): ProjectData => ({
  id: 'project-default',
  name: 'Default Project',
  note: '',
  status: 'active',
  completed: false,
  flagged: false,
  dueDate: null,
  deferDate: null,
  folderName: null,
  taskCount: 0,
  sequential: false,
  nextReviewDate: null,
  ...overrides,
});

let client: Client;
let clientTransport: InMemoryTransport;
let serverTransport: InMemoryTransport;

beforeAll(async () => {
  [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
});

afterAll(async () => {
  await clientTransport.close();
  await serverTransport.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper to get the script passed to executeAndParseJSON
function getCapturedScript(): string {
  const calls = vi.mocked(executeAndParseJSON).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][0];
}

// Helper to get ALL scripts passed to executeAndParseJSON (for multi-call tools like search)
function getAllCapturedScripts(): string[] {
  const calls = vi.mocked(executeAndParseJSON).mock.calls;
  return calls.map(c => c[0]);
}

describe('omnifocus_list_inbox', () => {
  it('should build correct JXA script with defaults', async () => {
    const mockTasks = [createMockTask({ id: 'inbox-1', name: 'Task 1' })];
    vi.mocked(executeAndParseJSON).mockResolvedValue(mockTasks);

    const result = await client.callTool({ name: 'omnifocus_list_inbox', arguments: {} });
    const script = getCapturedScript();

    expect(script).toContain('doc.inboxTasks()');
    expect(script).toContain('.slice(0, 50)');
    expect(script).toContain('filter(function(t) { return !t.completed(); }');
    expect(script).toContain('mapTask');

    const parsed = parseResult(result as { content: Array<{ type: string; text?: string }> }) as { count: number; tasks: TaskData[] };
    expect(parsed.count).toBe(1);
    expect(parsed.tasks[0].name).toBe('Task 1');
  });

  it('should include completed tasks when requested', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask()]);

    await client.callTool({ name: 'omnifocus_list_inbox', arguments: { includeCompleted: true } });
    const script = getCapturedScript();

    expect(script).not.toContain('filter(function(t) { return !t.completed()');
  });

  it('should respect custom limit', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    await client.callTool({ name: 'omnifocus_list_inbox', arguments: { limit: 10 } });
    const script = getCapturedScript();

    expect(script).toContain('.slice(0, 10)');
  });

  it('should return empty message when no tasks found', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    const result = await client.callTool({ name: 'omnifocus_list_inbox', arguments: {} });
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;

    expect(text).toBe('No tasks found in inbox.');
  });

  it('should return error when executeAndParseJSON fails', async () => {
    vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('OmniFocus is not running'));

    const result = await client.callTool({ name: 'omnifocus_list_inbox', arguments: {} });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('OmniFocus is not running');
  });
});

describe('omnifocus_list_projects', () => {
  it('should filter by active status by default', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockProject()]);

    await client.callTool({ name: 'omnifocus_list_projects', arguments: {} });
    const script = getCapturedScript();

    expect(script).toContain('active status');
    expect(script).toContain('doc.flattenedProjects()');
    expect(script).toContain('mapProject');
  });

  it('should skip status filter when status is "all"', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockProject()]);

    await client.callTool({ name: 'omnifocus_list_projects', arguments: { status: 'all' } });
    const script = getCapturedScript();

    expect(script).not.toContain('active status');
    expect(script).not.toContain('done status');
  });

  it('should add folder filter when folderName provided', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockProject({ folderName: 'Work' })]);

    await client.callTool({ name: 'omnifocus_list_projects', arguments: { folderName: 'Work' } });
    const script = getCapturedScript();

    expect(script).toContain('pf.name().toLowerCase().indexOf(');
    expect(script).toContain('work');
  });

  it('should sanitize folderName in JXA script', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    await client.callTool({ name: 'omnifocus_list_projects', arguments: { folderName: '"); doEvil("' } });
    const script = getCapturedScript();

    // sanitizeInput should have blocked or escaped the dangerous input
    expect(script).not.toContain('doEvil');
  });

  it('should return empty message when no projects found', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    const result = await client.callTool({ name: 'omnifocus_list_projects', arguments: {} });
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;

    expect(text).toBe('No projects found matching criteria.');
  });
});

describe('omnifocus_get_project_tasks', () => {
  it('should get tasks for a project by ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ projectName: 'My Project' })]);

    await client.callTool({ name: 'omnifocus_get_project_tasks', arguments: { projectId: 'proj-123' } });
    const script = getCapturedScript();

    expect(script).toContain('doc.flattenedProjects()');
    expect(script).toContain('proj-123');
    expect(script).toContain('flattenedTasks');
    expect(script).toContain('mapTask');
  });

  it('should exclude completed tasks by default', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask()]);

    await client.callTool({ name: 'omnifocus_get_project_tasks', arguments: { projectId: 'proj-123' } });
    const script = getCapturedScript();

    expect(script).toContain('!t.completed()');
  });

  it('should include completed tasks when requested', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ completed: true })]);

    await client.callTool({ name: 'omnifocus_get_project_tasks', arguments: { projectId: 'proj-123', includeCompleted: true } });
    const script = getCapturedScript();

    expect(script).not.toContain('!t.completed()');
  });

  it('should sanitize projectId in JXA script', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    await client.callTool({ name: 'omnifocus_get_project_tasks', arguments: { projectId: '"); doEvil("' } });
    const script = getCapturedScript();

    // The quotes should be escaped so the injection is neutralized
    expect(script).toContain('\\"');
    expect(script).not.toContain('"; doEvil("');
  });

  it('should return empty message when no tasks found', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    const result = await client.callTool({ name: 'omnifocus_get_project_tasks', arguments: { projectId: 'proj-123' } });
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;

    expect(text).toBe('No tasks found in this project.');
  });

  it('should return task count and tasks array', async () => {
    const mockTasks = [createMockTask({ id: 't1', name: 'Task 1' }), createMockTask({ id: 't2', name: 'Task 2' })];
    vi.mocked(executeAndParseJSON).mockResolvedValue(mockTasks);

    const result = await client.callTool({ name: 'omnifocus_get_project_tasks', arguments: { projectId: 'proj-123' } });
    const parsed = parseResult(result as { content: Array<{ type: string; text: string }> }) as { count: number; tasks: TaskData[] };

    expect(parsed.count).toBe(2);
    expect(parsed.tasks).toHaveLength(2);
  });
});

describe('omnifocus_list_folders', () => {
  it('should filter active folders by default', async () => {
    const mockFolders: FolderData[] = [{ id: 'f1', name: 'Work', status: 'active', projectCount: 5, folderCount: 2, parentName: null }];
    vi.mocked(executeAndParseJSON).mockResolvedValue(mockFolders);

    await client.callTool({ name: 'omnifocus_list_folders', arguments: {} });
    const script = getCapturedScript();

    expect(script).toContain('!f.hidden()');
    expect(script).toContain('mapFolder');

    expect(vi.mocked(executeAndParseJSON)).toHaveBeenCalledOnce();
  });

  it('should filter dropped folders', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    await client.callTool({ name: 'omnifocus_list_folders', arguments: { status: 'dropped' } });
    const script = getCapturedScript();

    expect(script).toContain('f.hidden()');
    expect(script).not.toContain('!f.hidden()');
  });

  it('should skip filter for status "all"', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    await client.callTool({ name: 'omnifocus_list_folders', arguments: { status: 'all' } });
    const script = getCapturedScript();

    // FOLDER_MAPPER always contains hidden() for status mapping,
    // but the filter function should NOT be applied for "all"
    expect(script).not.toContain('.filter(function(f) { return !f.hidden()');
    expect(script).not.toContain('.filter(function(f) { return f.hidden()');
  });
});

describe('omnifocus_list_tags', () => {
  it('should filter active tags by default', async () => {
    const mockTags: TagData[] = [{ id: 't1', name: 'Urgent', status: 'active', taskCount: 5, allowsNextAction: true, parentName: null }];
    vi.mocked(executeAndParseJSON).mockResolvedValue(mockTags);

    const result = await client.callTool({ name: 'omnifocus_list_tags', arguments: {} });
    const script = getCapturedScript();

    expect(script).toContain('!t.hidden()');
    expect(script).toContain('mapTag');

    const parsed = parseResult(result as { content: Array<{ type: string; text?: string }> }) as { count: number; tags: TagData[] };
    expect(parsed.count).toBe(1);
    expect(parsed.tags[0].name).toBe('Urgent');
  });
});

describe('omnifocus_create_task', () => {
  it('should create task in inbox by default', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'new-1', name: 'Buy milk' }));

    const result = await client.callTool({ name: 'omnifocus_create_task', arguments: { name: 'Buy milk' } });
    const script = getCapturedScript();

    expect(script).toContain('app.InboxTask');
    expect(script).toContain('Buy milk');
    expect(script).toContain('doc.inboxTasks.push(task)');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Task created successfully');
  });

  it('should create task in a project when projectName provided', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'new-2', name: 'Review PR', projectName: 'Work' }));

    await client.callTool({ name: 'omnifocus_create_task', arguments: { name: 'Review PR', projectName: 'Work' } });
    const script = getCapturedScript();

    expect(script).toContain('doc.flattenedProjects().find');
    expect(script).toContain('Work');
    expect(script).toContain('project.tasks.push(task)');
    expect(script).not.toContain('app.InboxTask');
  });

  it('should create subtask when parentTaskId provided', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'child-1', parentTaskId: 'parent-1' }));

    await client.callTool({ name: 'omnifocus_create_task', arguments: { name: 'Sub item', parentTaskId: 'parent-1' } });
    const script = getCapturedScript();

    expect(script).toContain('doc.flattenedTasks().find');
    expect(script).toContain('parent-1');
    expect(script).toContain('parentTask.tasks.push(task)');
  });

  it('should set dates in JXA script', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask());

    await client.callTool({
      name: 'omnifocus_create_task',
      arguments: {
        name: 'Dated task',
        dueDate: '2024-12-31T17:00:00',
        deferDate: '2024-12-01T09:00:00',
        plannedDate: '2024-12-15T09:00:00',
      },
    });
    const script = getCapturedScript();

    expect(script).toContain('task.dueDate = new Date("2024-12-31T17:00:00")');
    expect(script).toContain('task.deferDate = new Date("2024-12-01T09:00:00")');
    expect(script).toContain('task.plannedDate = new Date("2024-12-15T09:00:00")');
  });

  it('should set flagged and estimatedMinutes', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ flagged: true, estimatedMinutes: 60 }));

    await client.callTool({
      name: 'omnifocus_create_task',
      arguments: { name: 'Important', flagged: true, estimatedMinutes: 60 },
    });
    const script = getCapturedScript();

    expect(script).toContain('task.flagged = true');
    expect(script).toContain('task.estimatedMinutes = 60');
  });

  it('should add tags to created task', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ tags: ['Work', 'Urgent'] }));

    await client.callTool({
      name: 'omnifocus_create_task',
      arguments: { name: 'Tagged task', tagNames: ['Work', 'Urgent'] },
    });
    const script = getCapturedScript();

    expect(script).toContain('tagNamesToAdd');
    expect(script).toContain('"Work"');
    expect(script).toContain('"Urgent"');
    expect(script).toContain('doc.flattenedTags()');
    expect(script).toContain('app.add(tag, { to: task.tags })');
  });

  it('should build a daily recurrence via the Omni Automation bridge', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask());

    await client.callTool({
      name: 'omnifocus_create_task',
      arguments: { name: 'Standup', recurrence: { frequency: 'daily', interval: 1 } },
    });
    const script = getCapturedScript();

    expect(script).toContain('app.evaluateJavascript');
    expect(script).toContain('"FREQ=DAILY;INTERVAL=1"');
    expect(script).toContain('Task.RepetitionMethod.Fixed');
    // The broken Omni-Automation-in-JXA API must be gone.
    expect(script).not.toContain('app.RecurrenceRule');
  });

  it('should encode weekly days and completion-based method', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask());

    await client.callTool({
      name: 'omnifocus_create_task',
      arguments: {
        name: 'Workout',
        recurrence: {
          frequency: 'weekly',
          interval: 2,
          daysOfWeek: ['Monday', 'Wednesday', 'Friday'],
          repeatFrom: 'completion-date',
        },
      },
    });
    const script = getCapturedScript();

    expect(script).toContain('"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR"');
    expect(script).toContain('Task.RepetitionMethod.DueDate');
  });

  it('should reject invalid date format', async () => {
    const result = await client.callTool({
      name: 'omnifocus_create_task',
      arguments: { name: 'Bad date', dueDate: 'not-a-date' },
    });

    // Zod regex validation should reject this
    expect(result.isError).toBe(true);
  });

  it('should reject task name with dangerous patterns', async () => {
    const result = await client.callTool({
      name: 'omnifocus_create_task',
      arguments: { name: 'Test ${evil}' },
    });

    // sanitizeInput rejects ${ as template literal injection
    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('template literal injection');
  });
});

describe('omnifocus_complete_task', () => {
  it('should complete task by ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'task-1', completed: true }));

    const result = await client.callTool({
      name: 'omnifocus_complete_task',
      arguments: { taskId: 'task-1' },
    });
    const script = getCapturedScript();

    expect(script).toContain('t.id() === "task-1"');
    expect(script).toContain('task.markComplete()');
    expect(script).not.toContain('task.markDropped()');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Task completed');
  });

  it('should drop task when action is "drop"', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'task-1', dropped: true }));

    const result = await client.callTool({
      name: 'omnifocus_complete_task',
      arguments: { taskId: 'task-1', action: 'drop' },
    });
    const script = getCapturedScript();

    expect(script).toContain('task.markDropped()');
    expect(script).not.toContain('task.markComplete()');
    // Dropping must cancel a recurring series, not roll it forward: the rule is
    // cleared via the bridge before markDropped.
    expect(script).toContain('_t.repetitionRule=null');
    expect(script).toContain('app.evaluateJavascript');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Task dropped');
  });

  it('should not clear the repetition rule when completing (repeat is expected)', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'task-1', completed: true }));

    await client.callTool({
      name: 'omnifocus_complete_task',
      arguments: { taskId: 'task-1', action: 'complete' },
    });
    const script = getCapturedScript();

    expect(script).toContain('task.markComplete()');
    expect(script).not.toContain('_t.repetitionRule=null');
  });

  it('should search by name with exact then partial match', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ name: 'Write docs' }));

    await client.callTool({
      name: 'omnifocus_complete_task',
      arguments: { taskName: 'Write docs' },
    });
    const script = getCapturedScript();

    // Should have exact match first
    expect(script).toContain('t.name() === "Write docs"');
    // Then case-insensitive partial
    expect(script).toContain('write docs');
    expect(script).toContain('.toLowerCase().indexOf(');
  });

  it('should return error when task not found', async () => {
    vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('Task not found with ID: bad-id'));

    const result = await client.callTool({
      name: 'omnifocus_complete_task',
      arguments: { taskId: 'bad-id' },
    });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('Task not found');
  });
});

describe('omnifocus_add_tag_to_task', () => {
  it('should build correct tag addition script', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ tags: ['Work', 'Urgent'] }));

    await client.callTool({
      name: 'omnifocus_add_tag_to_task',
      arguments: { taskId: 'task-1', tagName: 'Urgent' },
    });
    const script = getCapturedScript();

    expect(script).toContain('t.id() === "task-1"');
    expect(script).toContain('Urgent');
    expect(script).toContain('app.add(tag, { to: task.tags })');
  });
});

describe('omnifocus_remove_tag_from_task', () => {
  it('should build correct tag removal script', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ tags: ['Work'] }));

    await client.callTool({
      name: 'omnifocus_remove_tag_from_task',
      arguments: { taskId: 'task-1', tagName: 'Urgent' },
    });
    const script = getCapturedScript();

    expect(script).toContain('t.id() === "task-1"');
    expect(script).toContain('Urgent');
    expect(script).toContain('app.remove(tagOnTask, { from: task.tags })');
  });
});

describe('omnifocus_update_task_note', () => {
  it('should set note by task ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'task-1', note: 'New note' }));

    const result = await client.callTool({
      name: 'omnifocus_update_task_note',
      arguments: { taskId: 'task-1', note: 'New note' },
    });
    const script = getCapturedScript();

    expect(script).toContain('t.id() === "task-1"');
    expect(script).toContain('task.note = "New note"');
    expect(script).toContain('mapTask');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Task note updated');
  });

  it('should search by task name', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ name: 'Write docs', note: 'Updated' }));

    await client.callTool({
      name: 'omnifocus_update_task_note',
      arguments: { taskName: 'Write docs', note: 'Updated' },
    });
    const script = getCapturedScript();

    expect(script).toContain('t.name() === "Write docs"');
    expect(script).toContain('task.note = "Updated"');
  });

  it('should clear note with empty string', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'task-1', note: '' }));

    await client.callTool({
      name: 'omnifocus_update_task_note',
      arguments: { taskId: 'task-1', note: '' },
    });
    const script = getCapturedScript();

    expect(script).toContain('task.note = ""');
  });

  it('should append to existing note when append is true', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'task-1', note: 'Old\nNew' }));

    await client.callTool({
      name: 'omnifocus_update_task_note',
      arguments: { taskId: 'task-1', note: '\nNew', append: true },
    });
    const script = getCapturedScript();

    expect(script).toContain('var existing = task.note()');
    expect(script).toContain('existing +');
  });

  it('should return error when task not found', async () => {
    vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('Task not found with ID: bad-id'));

    const result = await client.callTool({
      name: 'omnifocus_update_task_note',
      arguments: { taskId: 'bad-id', note: 'test' },
    });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('Task not found');
  });
});

describe('omnifocus_update_project_note', () => {
  it('should set note by project ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ id: 'proj-1', note: 'Project info' }));

    const result = await client.callTool({
      name: 'omnifocus_update_project_note',
      arguments: { projectId: 'proj-1', note: 'Project info' },
    });
    const script = getCapturedScript();

    expect(script).toContain('p.id() === "proj-1"');
    expect(script).toContain('project.note = "Project info"');
    expect(script).toContain('mapProject');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Project note updated');
  });

  it('should search by project name', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ name: 'Work Project', note: 'Updated' }));

    await client.callTool({
      name: 'omnifocus_update_project_note',
      arguments: { projectName: 'Work Project', note: 'Updated' },
    });
    const script = getCapturedScript();

    expect(script).toContain('p.name() === "Work Project"');
    expect(script).toContain('project.note = "Updated"');
  });

  it('should clear note with empty string', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ id: 'proj-1', note: '' }));

    await client.callTool({
      name: 'omnifocus_update_project_note',
      arguments: { projectId: 'proj-1', note: '' },
    });
    const script = getCapturedScript();

    expect(script).toContain('project.note = ""');
  });

  it('should append to existing note when append is true', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ id: 'proj-1', note: 'Old\nNew' }));

    await client.callTool({
      name: 'omnifocus_update_project_note',
      arguments: { projectId: 'proj-1', note: '\nNew', append: true },
    });
    const script = getCapturedScript();

    expect(script).toContain('var existing = project.note()');
    expect(script).toContain('existing +');
  });

  it('should return error when project not found', async () => {
    vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('Project not found with ID: bad-id'));

    const result = await client.callTool({
      name: 'omnifocus_update_project_note',
      arguments: { projectId: 'bad-id', note: 'test' },
    });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('Project not found');
  });
});

describe('omnifocus_search', () => {
  it('should search across all types by default', async () => {
    // Search calls executeAndParseJSON once per type (4 times for "all")
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    await client.callTool({ name: 'omnifocus_search', arguments: { query: 'report' } });
    const scripts = getAllCapturedScripts();

    // Should have called executeAndParseJSON 4 times (tasks, projects, folders, tags)
    expect(scripts.length).toBe(4);

    const combined = scripts.join('\n');
    expect(combined).toContain('report');
    expect(combined).toContain('mapTask');
    expect(combined).toContain('mapProject');
    expect(combined).toContain('mapFolder');
    expect(combined).toContain('mapTag');
  });

  it('should filter by specific type', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask()]);

    await client.callTool({ name: 'omnifocus_search', arguments: { query: 'test', searchType: 'tasks' } });
    const scripts = getAllCapturedScripts();

    // Only one call for a single type
    expect(scripts.length).toBe(1);
    expect(scripts[0]).toContain('mapTask');
  });

  it('should reject search query with dangerous patterns', async () => {
    const result = await client.callTool({ name: 'omnifocus_search', arguments: { query: '${inject}' } });

    // sanitizeInput rejects ${ as template literal injection
    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('template literal injection');
  });
});

describe('omnifocus_get_due_tasks', () => {
  it('should default to 7 days', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ dueDate: '2024-12-31T00:00:00.000Z' })]);

    await client.callTool({ name: 'omnifocus_get_due_tasks', arguments: {} });
    const script = getCapturedScript();

    expect(script).toContain('dueDate');
    expect(script).toContain('mapTask');
  });
});

describe('omnifocus_get_flagged_tasks', () => {
  it('should filter for flagged tasks', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ flagged: true })]);

    await client.callTool({ name: 'omnifocus_get_flagged_tasks', arguments: {} });
    const script = getCapturedScript();

    expect(script).toContain('flagged');
    expect(script).toContain('mapTask');
  });
});

describe('omnifocus_get_planned_tasks', () => {
  it('should filter for tasks with planned date', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ plannedDate: '2024-12-15T09:00:00.000Z' })]);

    await client.callTool({ name: 'omnifocus_get_planned_tasks', arguments: {} });
    const script = getCapturedScript();

    expect(script).toContain('plannedDate');
    expect(script).toContain('mapTask');
  });
});

describe('omnifocus_list_perspectives', () => {
  it('should list perspectives', async () => {
    const mockPerspectives: PerspectiveData[] = [
      { id: 'p1', name: 'Inbox' },
      { id: 'p2', name: 'Forecast' },
    ];
    vi.mocked(executeAndParseJSON).mockResolvedValue(mockPerspectives);

    const result = await client.callTool({ name: 'omnifocus_list_perspectives', arguments: {} });
    const parsed = parseResult(result as { content: Array<{ type: string; text?: string }> }) as { count: number; perspectives: PerspectiveData[] };

    expect(parsed.count).toBe(2);
    expect(parsed.perspectives[0].name).toBe('Inbox');
  });

  it('should return empty message when no perspectives found', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);

    const result = await client.callTool({ name: 'omnifocus_list_perspectives', arguments: {} });
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;

    expect(text).toBe('No perspectives found.');
  });
});

describe('omnifocus_get_perspective_tasks', () => {
  it('should get tasks from a named perspective', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ id: 't1', name: 'From perspective' })]);

    await client.callTool({ name: 'omnifocus_get_perspective_tasks', arguments: { perspectiveName: 'Next' } });
    const script = getCapturedScript();

    expect(script).toContain('Next');
    expect(script).toContain('mapTask');
  });

  it('should handle perspective not found error', async () => {
    vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('Perspective not found'));

    const result = await client.callTool({ name: 'omnifocus_get_perspective_tasks', arguments: { perspectiveName: 'Nonexistent' } });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('Perspective not found');
  });
});

describe('omnifocus_get_projects_for_review', () => {
  it('should build review query script', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockProject({ nextReviewDate: '2024-01-01T00:00:00.000Z' })]);

    await client.callTool({ name: 'omnifocus_get_projects_for_review', arguments: {} });
    const script = getCapturedScript();

    expect(script).toContain('nextReviewDate');
    expect(script).toContain('mapProject');
  });
});

describe('omnifocus_mark_project_reviewed', () => {
  it('should mark project reviewed by ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ id: 'proj-1' }));

    const result = await client.callTool({
      name: 'omnifocus_mark_project_reviewed',
      arguments: { projectId: 'proj-1' },
    });
    const script = getCapturedScript();

    expect(script).toContain('p.id() === "proj-1"');
    expect(script).toContain('markReviewed');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('marked as reviewed');
  });

  it('should mark project reviewed by name', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ name: 'Work Project' }));

    await client.callTool({
      name: 'omnifocus_mark_project_reviewed',
      arguments: { projectName: 'Work Project' },
    });
    const script = getCapturedScript();

    expect(script).toContain('Work Project');
  });
});

describe('omnifocus_batch_mark_reviewed', () => {
  it('should process multiple project IDs', async () => {
    const batchResult = {
      successful: [createMockProject({ id: 'p1' }), createMockProject({ id: 'p2' })],
      failed: [],
    };
    vi.mocked(executeAndParseJSON).mockResolvedValue(batchResult);

    const result = await client.callTool({
      name: 'omnifocus_batch_mark_reviewed',
      arguments: { projectIds: ['p1', 'p2'] },
    });
    const script = getCapturedScript();

    expect(script).toContain('p1');
    expect(script).toContain('p2');
    expect(script).toContain('markReviewed');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Successfully marked');
  });
});

const createMockFolder = (overrides: Partial<FolderData> = {}): FolderData => ({
  id: 'folder-default',
  name: 'Default Folder',
  status: 'active',
  projectCount: 0,
  folderCount: 0,
  parentName: null,
  ...overrides,
});

describe('omnifocus_update_project', () => {
  it('should rename a project by ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ id: 'proj-1', name: 'Renamed' }));

    const result = await client.callTool({
      name: 'omnifocus_update_project',
      arguments: { projectId: 'proj-1', name: 'Renamed' },
    });
    const script = getCapturedScript();

    expect(script).toContain('p.id() === "proj-1"');
    expect(script).toContain('project.name = "Renamed"');
    expect(script).toContain('mapProject');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Project updated');
  });

  it('should set status via the JXA status map', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ status: 'on hold' }));

    await client.callTool({
      name: 'omnifocus_update_project',
      arguments: { projectId: 'proj-1', status: 'on hold' },
    });
    const script = getCapturedScript();

    expect(script).toContain('project.status = "on hold status"');
  });

  it('should clear due date when null', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject());

    await client.callTool({
      name: 'omnifocus_update_project',
      arguments: { projectId: 'proj-1', dueDate: null },
    });
    const script = getCapturedScript();

    expect(script).toContain('project.dueDate = null');
  });

  it('should set reviewInterval as a {unit, steps} record (not raw seconds)', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject());

    await client.callTool({
      name: 'omnifocus_update_project',
      arguments: { projectId: 'proj-1', reviewIntervalDays: 14 },
    });
    const script = getCapturedScript();

    expect(script).toContain('project.reviewInterval = {unit: "day", steps: 14}');
  });

  it('should error when neither id nor name provided', async () => {
    const result = await client.callTool({ name: 'omnifocus_update_project', arguments: { name: 'X' } });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('Either projectId or projectName');
  });

  it('should error when no fields to update', async () => {
    const result = await client.callTool({ name: 'omnifocus_update_project', arguments: { projectId: 'proj-1' } });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('No fields to update');
  });
});

describe('omnifocus_delete_project', () => {
  it('should delete a project by ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({ deleted: true, name: 'Doomed Project' });

    const result = await client.callTool({
      name: 'omnifocus_delete_project',
      arguments: { projectId: 'proj-1' },
    });
    const script = getCapturedScript();

    expect(script).toContain('p.id() === "proj-1"');
    expect(script).toContain('app.delete(project)');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Project deleted: "Doomed Project"');
  });

  it('should error when neither id nor name provided', async () => {
    const result = await client.callTool({ name: 'omnifocus_delete_project', arguments: {} });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('Either projectId or projectName');
  });
});

describe('omnifocus_create_folder', () => {
  it('should create a top-level folder', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockFolder({ id: 'f-new', name: 'Work' }));

    const result = await client.callTool({
      name: 'omnifocus_create_folder',
      arguments: { name: 'Work' },
    });
    const script = getCapturedScript();

    expect(script).toContain('app.Folder({name: "Work"})');
    expect(script).toContain('doc.folders.push(folder)');
    expect(script).toContain('mapFolder');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Folder created successfully');
  });

  it('should nest under a parent folder', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockFolder({ name: 'Q1', parentName: 'Work' }));

    await client.callTool({
      name: 'omnifocus_create_folder',
      arguments: { name: 'Q1', parentFolderName: 'Work' },
    });
    const script = getCapturedScript();

    expect(script).toContain('doc.flattenedFolders().find');
    expect(script).toContain('Work');
    expect(script).toContain('parentFolder.folders.push(folder)');
    expect(script).not.toContain('doc.folders.push(folder)');
  });

  it('should reject folder name with dangerous patterns', async () => {
    const result = await client.callTool({
      name: 'omnifocus_create_folder',
      arguments: { name: 'Bad ${evil}' },
    });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('template literal injection');
  });
});

describe('omnifocus_update_folder', () => {
  it('should rename a folder by ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockFolder({ id: 'f-1', name: 'Archive' }));

    const result = await client.callTool({
      name: 'omnifocus_update_folder',
      arguments: { folderId: 'f-1', name: 'Archive' },
    });
    const script = getCapturedScript();

    expect(script).toContain('f.id() === "f-1"');
    expect(script).toContain('folder.name = "Archive"');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Folder updated');
  });

  it('should rename a folder by name', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockFolder({ name: 'Q1 2027' }));

    await client.callTool({
      name: 'omnifocus_update_folder',
      arguments: { folderName: 'Q1', name: 'Q1 2027' },
    });
    const script = getCapturedScript();

    expect(script).toContain('f.name() === "Q1"');
    expect(script).toContain('folder.name = "Q1 2027"');
  });

  it('should error when neither id nor name provided', async () => {
    const result = await client.callTool({ name: 'omnifocus_update_folder', arguments: { name: 'X' } });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('Either folderId or folderName');
  });
});

describe('omnifocus_delete_folder', () => {
  it('should delete a folder by ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({ deleted: true, name: 'Doomed Folder' });

    const result = await client.callTool({
      name: 'omnifocus_delete_folder',
      arguments: { folderId: 'f-1' },
    });
    const script = getCapturedScript();

    expect(script).toContain('f.id() === "f-1"');
    expect(script).toContain('app.delete(folder)');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Folder deleted: "Doomed Folder"');
  });

  it('should error when neither id nor name provided', async () => {
    const result = await client.callTool({ name: 'omnifocus_delete_folder', arguments: {} });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('Either folderId or folderName');
  });
});

describe('omnifocus_batch_complete_task', () => {
  it('should complete multiple tasks by ID', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({
      successful: [createMockTask({ id: 't1', completed: true }), createMockTask({ id: 't2', completed: true })],
      failed: [],
    });

    const result = await client.callTool({
      name: 'omnifocus_batch_complete_task',
      arguments: { taskIds: ['t1', 't2'] },
    });
    const script = getCapturedScript();

    expect(script).toContain('["t1","t2"]');
    expect(script).toContain('task.markComplete()');
    expect(script).not.toContain('task.markDropped()');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('2 task(s) completed');
  });

  it('should drop tasks when action is drop', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({ successful: [createMockTask({ dropped: true })], failed: [] });

    await client.callTool({
      name: 'omnifocus_batch_complete_task',
      arguments: { taskIds: ['t1'], action: 'drop' },
    });
    const script = getCapturedScript();

    expect(script).toContain('task.markDropped()');
    expect(script).not.toContain('task.markComplete()');
    // Batch drop must also cancel recurring series rather than roll them forward.
    expect(script).toContain('_t.repetitionRule=null');
  });

  it('should report per-task failures', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({
      successful: [createMockTask({ id: 't1', completed: true })],
      failed: [{ taskId: 'bad', error: 'Task not found' }],
    });

    const result = await client.callTool({
      name: 'omnifocus_batch_complete_task',
      arguments: { taskIds: ['t1', 'bad'] },
    });
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;

    expect(text).toContain('"successCount": 1');
    expect(text).toContain('"failureCount": 1');
    expect(text).toContain('1 task(s) completed (1 failed)');
  });

  it('should reject an empty taskIds array', async () => {
    const result = await client.callTool({ name: 'omnifocus_batch_complete_task', arguments: { taskIds: [] } });

    expect(result.isError).toBe(true);
  });
});

describe('omnifocus_batch_add_tag', () => {
  it('should add a tag to multiple tasks', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({
      successful: [createMockTask({ id: 't1', tags: ['Urgent'] }), createMockTask({ id: 't2', tags: ['Urgent'] })],
      failed: [],
    });

    const result = await client.callTool({
      name: 'omnifocus_batch_add_tag',
      arguments: { taskIds: ['t1', 't2'], tagName: 'Urgent' },
    });
    const script = getCapturedScript();

    expect(script).toContain('["t1","t2"]');
    expect(script).toContain('doc.flattenedTags().find');
    expect(script).toContain('Urgent');
    expect(script).toContain('app.add(tag, { to: task.tags })');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Tag "Urgent" added to 2 task(s)');
  });

  it('should error when the tag does not exist', async () => {
    vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('Tag not found: Ghost'));

    const result = await client.callTool({
      name: 'omnifocus_batch_add_tag',
      arguments: { taskIds: ['t1'], tagName: 'Ghost' },
    });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('Tag not found');
  });
});

describe('omnifocus_batch_remove_tag', () => {
  it('should remove a tag from multiple tasks', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({
      successful: [createMockTask({ id: 't1', tags: [] }), createMockTask({ id: 't2', tags: [] })],
      failed: [],
    });

    const result = await client.callTool({
      name: 'omnifocus_batch_remove_tag',
      arguments: { taskIds: ['t1', 't2'], tagName: 'Waiting' },
    });
    const script = getCapturedScript();

    expect(script).toContain('["t1","t2"]');
    expect(script).toContain('app.remove(tagOnTask, { from: task.tags })');

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Tag "Waiting" removed from 2 task(s)');
  });
});

describe('multi-tag filtering (tags + tagMatchMode)', () => {
  it('should not add a tag filter when tags is omitted', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask()]);

    await client.callTool({ name: 'omnifocus_list_inbox', arguments: {} });
    const script = getCapturedScript();

    expect(script).not.toContain('var wanted =');
  });

  it('should filter with ALL mode by default (every tag)', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ tags: ['Work', 'Urgent'] })]);

    await client.callTool({ name: 'omnifocus_list_inbox', arguments: { tags: ['Work', 'Urgent'] } });
    const script = getCapturedScript();

    expect(script).toContain('var wanted = ["Work","Urgent"]');
    expect(script).toContain('matched.length === wanted.length');
  });

  it('should filter with ANY mode (at least one tag)', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ tags: ['Work'] })]);

    await client.callTool({ name: 'omnifocus_get_flagged_tasks', arguments: { tags: ['Work', 'Home'], tagMatchMode: 'any' } });
    const script = getCapturedScript();

    expect(script).toContain('var wanted = ["Work","Home"]');
    expect(script).toContain('matched.length > 0');
  });

  it('should filter with NONE mode (excludes tags)', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask()]);

    await client.callTool({ name: 'omnifocus_get_due_tasks', arguments: { tags: ['Someday'], tagMatchMode: 'none' } });
    const script = getCapturedScript();

    expect(script).toContain('var wanted = ["Someday"]');
    expect(script).toContain('matched.length === 0');
  });

  it('should apply the tag filter on planned tasks too', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ plannedDate: '2027-01-01T09:00:00.000Z' })]);

    await client.callTool({ name: 'omnifocus_get_planned_tasks', arguments: { tags: ['Focus'] } });
    const script = getCapturedScript();

    expect(script).toContain('var wanted = ["Focus"]');
  });

  it('should sanitize tag names in the filter', async () => {
    const result = await client.callTool({ name: 'omnifocus_list_inbox', arguments: { tags: ['${evil}'] } });

    expect(result.isError).toBe(true);
    expect((result as { content: Array<{ type: string; text: string }> }).content[0].text).toContain('template literal injection');
  });

  it('should apply the tag filter BEFORE slicing to limit (not after)', async () => {
    // Otherwise a limit-truncated pool would be filtered, silently dropping matches.
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask()]);

    await client.callTool({ name: 'omnifocus_get_flagged_tasks', arguments: { tags: ['Urgent'], limit: 50 } });
    const script = getCapturedScript();

    const filterPos = script.indexOf('var wanted =');
    const slicePos = script.indexOf('tasks.slice(0, 50)');
    expect(filterPos).toBeGreaterThan(-1);
    expect(slicePos).toBeGreaterThan(-1);
    expect(filterPos).toBeLessThan(slicePos);
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: optional-field branches and error paths
// ---------------------------------------------------------------------------

const textOf = (r: unknown) => (r as { content: Array<{ type: string; text: string }> }).content[0].text;

describe('omnifocus_update_task (field branches)', () => {
  beforeEach(() => vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask({ id: 'task-1' })));

  it('renames the task', async () => {
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', name: 'New' } });
    expect(getCapturedScript()).toContain('task.name = "New"');
  });

  it('sets and clears the note', async () => {
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', note: 'hello' } });
    expect(getCapturedScript()).toContain('task.note = "hello"');
    vi.clearAllMocks();
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask());
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', note: null } });
    expect(getCapturedScript()).toContain('task.note = ""');
  });

  it('sets and clears due, defer and planned dates', async () => {
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', dueDate: '2027-01-01T09:00:00', deferDate: '2027-01-01T08:00:00', plannedDate: '2027-01-02T08:00:00' } });
    let s = getCapturedScript();
    expect(s).toContain('task.dueDate = new Date("2027-01-01T09:00:00")');
    expect(s).toContain('task.deferDate = new Date("2027-01-01T08:00:00")');
    expect(s).toContain('task.plannedDate = new Date("2027-01-02T08:00:00")');
    vi.clearAllMocks();
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask());
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', dueDate: null, deferDate: null, plannedDate: null } });
    s = getCapturedScript();
    expect(s).toContain('task.dueDate = null');
    expect(s).toContain('task.deferDate = null');
    expect(s).toContain('task.plannedDate = null');
  });

  it('sets flagged and estimatedMinutes (value and clear)', async () => {
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', flagged: true, estimatedMinutes: 45 } });
    let s = getCapturedScript();
    expect(s).toContain('task.flagged = true');
    expect(s).toContain('task.estimatedMinutes = 45');
    vi.clearAllMocks();
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask());
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', estimatedMinutes: 0 } });
    expect(getCapturedScript()).toContain('task.estimatedMinutes = null');
  });

  it('moves the task by projectId', async () => {
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', projectId: 'proj-9' } });
    const s = getCapturedScript();
    expect(s).toContain('p.id() === "proj-9"');
    expect(s).toContain('task.assignedContainer = targetProject');
  });

  it('moves the task by projectName', async () => {
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', projectName: 'Work' } });
    const s = getCapturedScript();
    expect(s).toContain('p.name() === "Work"');
    expect(s).toContain('task.assignedContainer = targetProject');
  });

  it('finds the task by name when no id given', async () => {
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskName: 'Some task', flagged: true } });
    expect(getCapturedScript()).toContain('t.name() === "Some task"');
  });

  it('clears the repetition rule when clearRecurrence is true', async () => {
    await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', clearRecurrence: true } });
    const s = getCapturedScript();
    expect(s).toContain('app.evaluateJavascript');
    expect(s).toContain('_t.repetitionRule=null');
  });

  it('accepts clearRecurrence as the only field (no "no fields" error)', async () => {
    const r = await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1', clearRecurrence: true } });
    expect(r.isError).toBeFalsy();
  });

  it('errors when neither id nor name provided', async () => {
    const r = await client.callTool({ name: 'omnifocus_update_task', arguments: { name: 'X' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Either taskId or taskName');
  });

  it('errors when no fields to update', async () => {
    const r = await client.callTool({ name: 'omnifocus_update_task', arguments: { taskId: 'task-1' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('No fields to update');
  });
});

describe('omnifocus_delete_task', () => {
  it('deletes by id', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({ deleted: true, name: 'Gone' });
    const r = await client.callTool({ name: 'omnifocus_delete_task', arguments: { taskId: 'task-1' } });
    expect(getCapturedScript()).toContain('app.delete(task)');
    expect(textOf(r)).toContain('Task deleted: "Gone"');
  });

  it('deletes by name', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({ deleted: true, name: 'Gone' });
    await client.callTool({ name: 'omnifocus_delete_task', arguments: { taskName: 'Old' } });
    expect(getCapturedScript()).toContain('t.name() === "Old"');
  });

  it('errors when neither id nor name provided', async () => {
    const r = await client.callTool({ name: 'omnifocus_delete_task', arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Either taskId or taskName');
  });

  it('returns an error when execution fails', async () => {
    vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('nope'));
    const r = await client.callTool({ name: 'omnifocus_delete_task', arguments: { taskId: 'task-1' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Error deleting task');
  });
});

describe('omnifocus_create_project (option branches)', () => {
  it('creates inside a folder with dates, flag, sequential and status', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ name: 'P' }));
    await client.callTool({
      name: 'omnifocus_create_project',
      arguments: { name: 'P', folderName: 'Work', note: 'n', dueDate: '2027-01-01T09:00:00', deferDate: '2027-01-01T08:00:00', flagged: true, sequential: true, status: 'on hold' },
    });
    const s = getCapturedScript();
    expect(s).toContain('doc.flattenedFolders().find');
    expect(s).toContain('folder.projects.push(project)');
    expect(s).toContain('project.note = "n"');
    expect(s).toContain('project.dueDate = new Date("2027-01-01T09:00:00")');
    expect(s).toContain('project.deferDate = new Date("2027-01-01T08:00:00")');
    expect(s).toContain('project.flagged = true');
    expect(s).toContain('project.sequential = true');
    expect(s).toContain('project.status = "on hold status"');
  });

  it('creates at top level when no folder given', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject());
    await client.callTool({ name: 'omnifocus_create_project', arguments: { name: 'Top' } });
    const s = getCapturedScript();
    expect(s).toContain('doc.projects.push(project)');
    expect(s).not.toContain('doc.flattenedFolders().find');
  });

  it('explicitly sets sequential=false for a parallel project (JXA defaults new projects to sequential)', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject());
    await client.callTool({ name: 'omnifocus_create_project', arguments: { name: 'Parallel', sequential: false } });
    const s = getCapturedScript();
    expect(s).toContain('project.sequential = false');
  });

  it('returns an error when execution fails', async () => {
    vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('bad'));
    const r = await client.callTool({ name: 'omnifocus_create_project', arguments: { name: 'P' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Error creating project');
  });
});

describe('omnifocus_update_project (more branches)', () => {
  beforeEach(() => vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject({ id: 'proj-1' })));

  it('clears the note with null', async () => {
    await client.callTool({ name: 'omnifocus_update_project', arguments: { projectId: 'proj-1', note: null } });
    expect(getCapturedScript()).toContain('project.note = ""');
  });

  it('sets note, flagged, deferDate and sequential', async () => {
    await client.callTool({ name: 'omnifocus_update_project', arguments: { projectId: 'proj-1', note: 'x', flagged: false, deferDate: '2027-02-01T09:00:00', sequential: false } });
    const s = getCapturedScript();
    expect(s).toContain('project.note = "x"');
    expect(s).toContain('project.flagged = false');
    expect(s).toContain('project.deferDate = new Date("2027-02-01T09:00:00")');
    expect(s).toContain('project.sequential = false');
  });

  it('finds the project by name', async () => {
    await client.callTool({ name: 'omnifocus_update_project', arguments: { projectName: 'Proj', name: 'Renamed' } });
    expect(getCapturedScript()).toContain('p.name() === "Proj"');
  });
});

describe('omnifocus_create_task (more branches)', () => {
  it('creates a task in a project by name with defer date', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockTask());
    await client.callTool({ name: 'omnifocus_create_task', arguments: { name: 'T', projectName: 'Work', deferDate: '2027-01-01T08:00:00' } });
    const s = getCapturedScript();
    expect(s).toContain('Work');
    expect(s).toContain('task.deferDate = new Date("2027-01-01T08:00:00")');
  });

  it('returns an error when execution fails', async () => {
    vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('bad'));
    const r = await client.callTool({ name: 'omnifocus_create_task', arguments: { name: 'T' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Error creating task');
  });
});

describe('branch coverage: list/query filter variants', () => {
  it('list_projects filters onHold, done and dropped statuses', async () => {
    for (const [status, jxa] of [['onHold', 'on hold status'], ['done', 'done status'], ['dropped', 'dropped status']] as const) {
      vi.clearAllMocks();
      vi.mocked(executeAndParseJSON).mockResolvedValue([createMockProject()]);
      await client.callTool({ name: 'omnifocus_list_projects', arguments: { status } });
      expect(getCapturedScript()).toContain(jxa);
    }
  });

  it('list_folders includes all when status is all', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([]);
    await client.callTool({ name: 'omnifocus_list_folders', arguments: { status: 'all' } });
    expect(getCapturedScript()).toContain('mapFolder');
  });

  it('get_due_tasks excludes overdue when includeOverdue is false', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask()]);
    await client.callTool({ name: 'omnifocus_get_due_tasks', arguments: { includeOverdue: false } });
    expect(getCapturedScript()).toContain('if (due < now) return false;');
  });

  it('get_planned_tasks excludes overdue when includeOverdue is false', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask()]);
    await client.callTool({ name: 'omnifocus_get_planned_tasks', arguments: { includeOverdue: false } });
    expect(getCapturedScript()).toContain('if (planned < now) return false;');
  });

  it('get_flagged_tasks includes completed when requested', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue([createMockTask({ completed: true, flagged: true })]);
    await client.callTool({ name: 'omnifocus_get_flagged_tasks', arguments: { includeCompleted: true } });
    expect(getCapturedScript()).not.toContain('if (t.completed()) return false;');
  });

  it('mark_project_reviewed applies a custom interval as a record', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue(createMockProject());
    await client.callTool({ name: 'omnifocus_mark_project_reviewed', arguments: { projectId: 'proj-1', reviewIntervalDays: 30 } });
    expect(getCapturedScript()).toContain('project.reviewInterval = {unit: "day", steps: 30}');
  });

  it('batch_mark_reviewed applies a custom interval as a record', async () => {
    vi.mocked(executeAndParseJSON).mockResolvedValue({ successful: [createMockProject()], failed: [] });
    await client.callTool({ name: 'omnifocus_batch_mark_reviewed', arguments: { projectIds: ['p1'], reviewIntervalDays: 7 } });
    expect(getCapturedScript()).toContain('project.reviewInterval = {unit: "day", steps: 7}');
  });
});

describe('error paths for remaining handlers', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['omnifocus_list_projects', {}, 'Error listing projects'],
    ['omnifocus_get_project_tasks', { projectId: 'p' }, 'Error getting project tasks'],
    ['omnifocus_list_folders', {}, 'Error listing folders'],
    ['omnifocus_list_tags', {}, 'Error listing tags'],
    ['omnifocus_add_tag_to_task', { taskId: 't', tagName: 'x' }, 'Error adding tag'],
    ['omnifocus_remove_tag_from_task', { taskId: 't', tagName: 'x' }, 'Error removing tag'],
    ['omnifocus_get_due_tasks', {}, 'Error getting due tasks'],
    ['omnifocus_get_flagged_tasks', {}, 'Error getting flagged tasks'],
    ['omnifocus_get_planned_tasks', {}, 'Error getting planned tasks'],
    ['omnifocus_get_projects_for_review', {}, 'Error'],
    ['omnifocus_mark_project_reviewed', { projectId: 'p' }, 'Error'],
    ['omnifocus_batch_mark_reviewed', { projectIds: ['p'] }, 'Error in batch mark reviewed'],
    ['omnifocus_list_perspectives', {}, 'Error'],
    ['omnifocus_create_folder', { name: 'F' }, 'Error creating folder'],
    ['omnifocus_update_folder', { folderId: 'f', name: 'X' }, 'Error updating folder'],
    ['omnifocus_delete_folder', { folderId: 'f' }, 'Error deleting folder'],
    ['omnifocus_delete_project', { projectId: 'p' }, 'Error deleting project'],
    ['omnifocus_batch_complete_task', { taskIds: ['t'] }, 'Error in batch complete'],
    ['omnifocus_batch_remove_tag', { taskIds: ['t'], tagName: 'x' }, 'Error in batch remove tag'],
    ['omnifocus_update_task', { taskId: 't', flagged: true }, 'Error updating task'],
    ['omnifocus_update_project', { projectId: 'p', name: 'X' }, 'Error updating project'],
  ];

  for (const [name, args, expected] of cases) {
    it(`${name} returns an error when execution fails`, async () => {
      vi.mocked(executeAndParseJSON).mockRejectedValue(new Error('exec failed'));
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain(expected);
    });
  }
});
