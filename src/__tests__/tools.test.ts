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

    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain('Task dropped');
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
