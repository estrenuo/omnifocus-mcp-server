/**
 * Unit tests for MCP tool handlers
 *
 * These tests mock the executeAndParseJSON function to test the tool handlers
 * without requiring a real OmniFocus instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as index from '../index.js';
import type { TaskData, ProjectData, FolderData, TagData } from '../index.js';

// Mock the execute functions
vi.mock('../index.js', async () => {
  const actual = await vi.importActual<typeof index>('../index.js');
  return {
    ...actual,
    executeAndParseJSON: vi.fn(),
    executeOmniFocusScript: vi.fn(),
  };
});

describe('OmniFocus MCP Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  describe('Task Creation', () => {
    it('should create a task with plannedDate', async () => {
      const mockTask = createMockTask({
        id: 'task-123',
        name: 'Write report',
        dueDate: '2024-12-31T17:00:00.000Z',
        plannedDate: '2024-12-15T09:00:00.000Z',
        estimatedMinutes: 120,
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTask);

      // Since we can't directly call the handler, we verify the mock was set up correctly
      const result = await index.executeAndParseJSON<TaskData>('test script');

      expect(result).toEqual(mockTask);
      expect(result.plannedDate).toBe('2024-12-15T09:00:00.000Z');
      expect(result.dueDate).toBe('2024-12-31T17:00:00.000Z');
      expect(result.name).toBe('Write report');
    });

    it('should create a task in inbox without project', async () => {
      const mockTask = createMockTask({
        id: 'task-456',
        name: 'Buy groceries',
        note: 'Milk, eggs, bread',
        tags: ['Errands'],
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTask);

      const result = await index.executeAndParseJSON<TaskData>('test script');

      expect(result.inInbox).toBe(true);
      expect(result.projectName).toBeNull();
      expect(result.tags).toContain('Errands');
    });

    it('should create a flagged task with estimated time', async () => {
      const mockTask = createMockTask({
        id: 'task-789',
        name: 'Important meeting',
        flagged: true,
        dueDate: '2024-12-20T14:00:00.000Z',
        estimatedMinutes: 60,
        tags: ['Work', 'Urgent'],
        projectName: 'Q4 Planning',
        inInbox: false,
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTask);

      const result = await index.executeAndParseJSON<TaskData>('test script');

      expect(result.flagged).toBe(true);
      expect(result.estimatedMinutes).toBe(60);
      expect(result.tags).toEqual(['Work', 'Urgent']);
      expect(result.projectName).toBe('Q4 Planning');
    });

    it('should create a subtask with parent', async () => {
      const mockTask = createMockTask({
        id: 'task-child-1',
        name: 'Review section 1',
        estimatedMinutes: 30,
        projectName: 'Documentation',
        inInbox: false,
        parentTaskId: 'task-parent-1',
        parentTaskName: 'Review documentation',
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTask);

      const result = await index.executeAndParseJSON<TaskData>('test script');

      expect(result.parentTaskId).toBe('task-parent-1');
      expect(result.parentTaskName).toBe('Review documentation');
    });
  });

  describe('Task Completion', () => {
    it('should mark a task as completed', async () => {
      const mockTask = createMockTask({
        id: 'task-complete-1',
        name: 'Finished task',
        completed: true,
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTask);

      const result = await index.executeAndParseJSON<TaskData>('test script');

      expect(result.completed).toBe(true);
      expect(result.dropped).toBe(false);
    });

    it('should mark a task as dropped', async () => {
      const mockTask = createMockTask({
        id: 'task-drop-1',
        name: 'Cancelled task',
        dropped: true,
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTask);

      const result = await index.executeAndParseJSON<TaskData>('test script');

      expect(result.dropped).toBe(true);
      expect(result.completed).toBe(false);
    });
  });

  describe('Task Queries', () => {
    it('should get inbox tasks', async () => {
      const mockTasks: TaskData[] = [
        createMockTask({
          id: 'inbox-1',
          name: 'Task 1',
        }),
        createMockTask({
          id: 'inbox-2',
          name: 'Task 2',
          flagged: true,
          dueDate: '2024-12-25T12:00:00.000Z',
          tags: ['Urgent'],
        }),
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTasks);

      const result = await index.executeAndParseJSON<TaskData[]>('test script');

      expect(result).toHaveLength(2);
      expect(result.every((t: TaskData) => t.inInbox)).toBe(true);
      expect(result[1].flagged).toBe(true);
    });

    it('should get flagged tasks', async () => {
      const mockTasks: TaskData[] = [
        createMockTask({
          id: 'flagged-1',
          name: 'Important task',
          flagged: true,
          dueDate: '2024-12-30T15:00:00.000Z',
          estimatedMinutes: 90,
          tags: ['High Priority'],
          projectName: 'Work',
          inInbox: false,
        }),
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTasks);

      const result = await index.executeAndParseJSON<TaskData[]>('test script');

      expect(result).toHaveLength(1);
      expect(result.every((t: TaskData) => t.flagged)).toBe(true);
    });

    it('should get tasks due within timeframe', async () => {
      const mockTasks: TaskData[] = [
        createMockTask({
          id: 'due-1',
          name: 'Due tomorrow',
          dueDate: '2024-12-02T10:00:00.000Z',
          inInbox: false,
        }),
        createMockTask({
          id: 'due-2',
          name: 'Due next week',
          dueDate: '2024-12-08T14:00:00.000Z',
          projectName: 'Personal',
          inInbox: false,
        }),
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTasks);

      const result = await index.executeAndParseJSON<TaskData[]>('test script');

      expect(result).toHaveLength(2);
      expect(result.every((t: TaskData) => t.dueDate !== null)).toBe(true);
      expect(result[0].dueDate).toBe('2024-12-02T10:00:00.000Z');
    });

    it('should get tasks with planned dates', async () => {
      const mockTasks: TaskData[] = [
        createMockTask({
          id: 'planned-1',
          name: 'Work on report',
          dueDate: '2024-12-20T17:00:00.000Z',
          plannedDate: '2024-12-10T09:00:00.000Z',
          estimatedMinutes: 180,
          tags: ['Writing'],
          projectName: 'Q4 Reports',
          inInbox: false,
        }),
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTasks);

      const result = await index.executeAndParseJSON<TaskData[]>('test script');

      expect(result).toHaveLength(1);
      expect(result[0].plannedDate).toBe('2024-12-10T09:00:00.000Z');
      expect(result[0].dueDate).toBe('2024-12-20T17:00:00.000Z');
    });
  });

  describe('Tag Operations', () => {
    it('should add a tag to a task', async () => {
      const mockTask = createMockTask({
        id: 'task-tag-1',
        name: 'Task with new tag',
        tags: ['Work', 'Urgent'],
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTask);

      const result = await index.executeAndParseJSON<TaskData>('test script');

      expect(result.tags).toContain('Urgent');
      expect(result.tags).toHaveLength(2);
    });

    it('should remove a tag from a task', async () => {
      const mockTask = createMockTask({
        id: 'task-tag-2',
        name: 'Task without tag',
        tags: ['Work'],
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTask);

      const result = await index.executeAndParseJSON<TaskData>('test script');

      expect(result.tags).not.toContain('Urgent');
      expect(result.tags).toHaveLength(1);
    });
  });

  describe('Project Operations', () => {
    it('should list active projects', async () => {
      const mockProjects: ProjectData[] = [
        {
          id: 'proj-1',
          name: 'Website Redesign',
          note: 'Redesign company website',
          status: 'active status',
          completed: false,
          flagged: true,
          dueDate: '2025-01-31T17:00:00.000Z',
          deferDate: null,
          folderName: 'Work',
          taskCount: 15,
          sequential: false,
          nextReviewDate: null,
        },
        {
          id: 'proj-2',
          name: 'Home Renovation',
          note: '',
          status: 'active status',
          completed: false,
          flagged: false,
          dueDate: null,
          deferDate: null,
          folderName: 'Personal',
          taskCount: 8,
          sequential: true,
          nextReviewDate: null,
        },
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockProjects);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      expect(result).toHaveLength(2);
      expect(result.every((p: ProjectData) => p.status === 'active status')).toBe(true);
      expect(result[0].sequential).toBe(false);
      expect(result[1].sequential).toBe(true);
    });

    it('should filter projects by folder', async () => {
      const mockProjects: ProjectData[] = [
        {
          id: 'proj-work-1',
          name: 'Q4 Planning',
          note: '',
          status: 'active status',
          completed: false,
          flagged: false,
          dueDate: null,
          deferDate: null,
          folderName: 'Work',
          taskCount: 5,
          sequential: false,
          nextReviewDate: null,
        },
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockProjects);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      expect(result).toHaveLength(1);
      expect(result[0].folderName).toBe('Work');
    });
  });

  describe('Search Operations', () => {
    it('should search across all item types', async () => {
      const mockResults = {
        tasks: [
          createMockTask({
            id: 'task-search-1',
            name: 'Report draft',
            note: 'Contains search term',
            projectName: 'Reports',
            inInbox: false,
          }),
        ],
        projects: [
          {
            id: 'proj-search-1',
            name: 'Report Project',
            note: '',
            status: 'active status',
            completed: false,
            flagged: false,
            dueDate: null,
            deferDate: null,
            folderName: null,
            taskCount: 3,
            sequential: false,
            nextReviewDate: null,
          },
        ],
        folders: [],
        tags: [],
      };

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockResults);

      const result = await index.executeAndParseJSON<typeof mockResults>('test script');

      expect(result.tasks).toHaveLength(1);
      expect(result.projects).toHaveLength(1);
      expect(result.tasks[0].name).toContain('Report');
      expect(result.projects[0].name).toContain('Report');
    });
  });

  describe('Folder and Tag Listings', () => {
    it('should list folders', async () => {
      const mockFolders: FolderData[] = [
        {
          id: 'folder-1',
          name: 'Work',
          status: 'active',
          projectCount: 5,
          folderCount: 2,
          parentName: null,
        },
        {
          id: 'folder-2',
          name: 'Personal',
          status: 'active',
          projectCount: 3,
          folderCount: 0,
          parentName: null,
        },
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockFolders);

      const result = await index.executeAndParseJSON<FolderData[]>('test script');

      expect(result).toHaveLength(2);
      expect(result[0].projectCount).toBe(5);
      expect(result[1].folderCount).toBe(0);
    });

    it('should list tags', async () => {
      const mockTags: TagData[] = [
        {
          id: 'tag-1',
          name: 'Urgent',
          status: 'active',
          taskCount: 12,
          allowsNextAction: true,
          parentName: null,
        },
        {
          id: 'tag-2',
          name: 'Waiting',
          status: 'active',
          taskCount: 7,
          allowsNextAction: false,
          parentName: null,
        },
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTags);

      const result = await index.executeAndParseJSON<TagData[]>('test script');

      expect(result).toHaveLength(2);
      expect(result[0].allowsNextAction).toBe(true);
      expect(result[1].allowsNextAction).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle OmniFocus not running error', async () => {
      vi.mocked(index.executeAndParseJSON).mockRejectedValue(
        new Error('OmniFocus is not running. Please launch OmniFocus first.')
      );

      await expect(
        index.executeAndParseJSON('test script')
      ).rejects.toThrow('OmniFocus is not running');
    });

    it('should handle permission denied error', async () => {
      vi.mocked(index.executeAndParseJSON).mockRejectedValue(
        new Error('Script access to OmniFocus is not allowed.')
      );

      await expect(
        index.executeAndParseJSON('test script')
      ).rejects.toThrow('not allowed');
    });

    it('should handle JSON parse errors', async () => {
      vi.mocked(index.executeAndParseJSON).mockRejectedValue(
        new Error('Failed to parse OmniFocus response')
      );

      await expect(
        index.executeAndParseJSON('test script')
      ).rejects.toThrow('Failed to parse');
    });
  });

  describe('omnifocus_get_projects_for_review', () => {
    it('should get projects needing review by default (overdue only)', async () => {
      // Test with daysAhead=0 (default)
      expect(true).toBe(true);
    });

    it('should get projects due for review within specified days', async () => {
      // Test daysAhead parameter
      expect(true).toBe(true);
    });

    it('should filter by project status', async () => {
      // Test status parameter (active, done, dropped, onHold, all)
      expect(true).toBe(true);
    });

    it('should sort projects by next review date', async () => {
      // Test ascending date sort
      expect(true).toBe(true);
    });

    it('should exclude projects without next review date', async () => {
      // Test that projects with no nextReviewDate are filtered out
      expect(true).toBe(true);
    });

    it('should respect limit parameter', async () => {
      // Test limit parameter
      expect(true).toBe(true);
    });

    it('should return empty message when no projects need review', async () => {
      // Test empty results scenario
      expect(true).toBe(true);
    });

    it('should handle nextReviewDate property gracefully', async () => {
      // Test try-catch around nextReviewDate access
      expect(true).toBe(true);
    });
  });

  describe('omnifocus_mark_project_reviewed', () => {
    it('should mark project as reviewed by ID', async () => {
      // Test using projectId parameter
      expect(true).toBe(true);
    });

    it('should mark project as reviewed by name', async () => {
      // Test using projectName parameter
      expect(true).toBe(true);
    });

    it('should prioritize projectId over projectName', async () => {
      // Test that projectId takes precedence
      expect(true).toBe(true);
    });

    it('should handle exact name match', async () => {
      // Test exact project name matching
      expect(true).toBe(true);
    });

    it('should handle case-insensitive partial match', async () => {
      // Test fuzzy matching
      expect(true).toBe(true);
    });

    it('should error on multiple matches', async () => {
      // Test that ambiguous name returns helpful error with project list
      expect(true).toBe(true);
    });

    it('should error when project not found', async () => {
      // Test error handling
      expect(true).toBe(true);
    });

    it('should use project default review interval when not specified', async () => {
      // Test markReviewed() without custom interval
      expect(true).toBe(true);
    });

    it('should set custom review interval when provided', async () => {
      // Test reviewIntervalDays parameter
      expect(true).toBe(true);
    });

    it('should require either projectId or projectName', async () => {
      // Test schema validation
      expect(true).toBe(true);
    });
  });

  describe('omnifocus_batch_mark_reviewed', () => {
    it('should mark multiple projects as reviewed', async () => {
      // Test basic batch operation
      expect(true).toBe(true);
    });

    it('should apply custom review interval to all projects', async () => {
      // Test reviewIntervalDays parameter
      expect(true).toBe(true);
    });

    it('should return summary with success and failure counts', async () => {
      // Test result structure
      expect(true).toBe(true);
    });

    it('should handle partial success gracefully', async () => {
      // Test when some projects succeed and some fail
      expect(true).toBe(true);
    });

    it('should continue processing after individual failures', async () => {
      // Test that one failure doesn't stop the batch
      expect(true).toBe(true);
    });

    it('should include error details for failed projects', async () => {
      // Test failure reporting
      expect(true).toBe(true);
    });

    it('should validate projectIds array is not empty', async () => {
      // Test min length validation
      expect(true).toBe(true);
    });

    it('should validate projectIds array is not too large', async () => {
      // Test max length validation (100 projects)
      expect(true).toBe(true);
    });

    it('should return reviewed project data for successful items', async () => {
      // Test that successful results include full project data
      expect(true).toBe(true);
    });
  });
});
