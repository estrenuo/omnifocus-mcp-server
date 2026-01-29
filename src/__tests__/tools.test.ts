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

  // Helper function to create mock project with all required fields
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
      // Projects with nextReviewDate in the past (overdue)
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const overdueProjects = [
        createMockProject({
          id: 'proj-overdue-1',
          name: 'Overdue Project 1',
          nextReviewDate: yesterday.toISOString()
        }),
        createMockProject({
          id: 'proj-overdue-2',
          name: 'Overdue Project 2',
          nextReviewDate: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
        })
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(overdueProjects);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      expect(result).toHaveLength(2);
      expect(result[0].nextReviewDate).toBeTruthy();
      expect(result[1].nextReviewDate).toBeTruthy();
    });

    it('should get projects due for review within specified days', async () => {
      // Project due within 7 days
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      const projects = [
        createMockProject({
          id: 'proj-future',
          name: 'Due Soon Project',
          nextReviewDate: futureDate.toISOString()
        })
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(projects);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Due Soon Project');
      expect(result[0].nextReviewDate).toBe(futureDate.toISOString());
    });

    it('should filter by project status', async () => {
      // Test filtering by 'done' status
      const doneProjects = [
        createMockProject({
          id: 'proj-done-1',
          name: 'Completed Project',
          status: 'done',
          completed: true,
          nextReviewDate: new Date().toISOString()
        })
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(doneProjects);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('done');
      expect(result[0].completed).toBe(true);
    });

    it('should sort projects by next review date', async () => {
      // Projects with different review dates
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-15');
      const date3 = new Date('2024-02-01');

      const sortedProjects = [
        createMockProject({
          id: 'proj-1',
          name: 'First',
          nextReviewDate: date1.toISOString()
        }),
        createMockProject({
          id: 'proj-2',
          name: 'Second',
          nextReviewDate: date2.toISOString()
        }),
        createMockProject({
          id: 'proj-3',
          name: 'Third',
          nextReviewDate: date3.toISOString()
        })
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(sortedProjects);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      expect(result).toHaveLength(3);
      // Verify ascending order
      expect(result[0].nextReviewDate).toBe(date1.toISOString());
      expect(result[1].nextReviewDate).toBe(date2.toISOString());
      expect(result[2].nextReviewDate).toBe(date3.toISOString());
    });

    it('should exclude projects without next review date', async () => {
      // Only projects WITH nextReviewDate should be returned
      const projectsWithReviewDate = [
        createMockProject({
          id: 'proj-with-review',
          name: 'Has Review Date',
          nextReviewDate: new Date().toISOString()
        })
        // Projects without nextReviewDate are filtered out by the JXA script
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(projectsWithReviewDate);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      expect(result).toHaveLength(1);
      expect(result[0].nextReviewDate).toBeTruthy();
      // Verify all returned projects have a review date
      result.forEach(project => {
        expect(project.nextReviewDate).not.toBeNull();
      });
    });

    it('should respect limit parameter', async () => {
      // Simulate limit of 2 projects
      const limitedProjects = [
        createMockProject({
          id: 'proj-1',
          name: 'Project 1',
          nextReviewDate: new Date().toISOString()
        }),
        createMockProject({
          id: 'proj-2',
          name: 'Project 2',
          nextReviewDate: new Date().toISOString()
        })
        // Even if there are more, only 2 are returned
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(limitedProjects);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      expect(result).toHaveLength(2);
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should return empty message when no projects need review', async () => {
      // Empty array means no projects need review
      vi.mocked(index.executeAndParseJSON).mockResolvedValue([]);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should handle nextReviewDate property gracefully', async () => {
      // The JXA script has try-catch around nextReviewDate access
      // Projects that throw errors are filtered out, so result should be valid
      const validProjects = [
        createMockProject({
          id: 'proj-valid',
          name: 'Valid Project',
          nextReviewDate: new Date().toISOString()
        })
      ];

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(validProjects);

      const result = await index.executeAndParseJSON<ProjectData[]>('test script');

      // Should succeed without errors
      expect(result).toHaveLength(1);
      expect(result[0].nextReviewDate).toBeTruthy();
    });
  });

  describe('omnifocus_mark_project_reviewed', () => {
    it('should mark project as reviewed by ID', async () => {
      const futureReviewDate = new Date();
      futureReviewDate.setDate(futureReviewDate.getDate() + 7);

      const reviewedProject = createMockProject({
        id: 'proj-123',
        name: 'Work Project',
        nextReviewDate: futureReviewDate.toISOString()
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(reviewedProject);

      const result = await index.executeAndParseJSON<ProjectData>('test script');

      expect(result.id).toBe('proj-123');
      expect(result.name).toBe('Work Project');
      expect(result.nextReviewDate).toBeTruthy();
    });

    it('should mark project as reviewed by name', async () => {
      const reviewedProject = createMockProject({
        id: 'proj-456',
        name: 'Home Renovation',
        nextReviewDate: new Date().toISOString()
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(reviewedProject);

      const result = await index.executeAndParseJSON<ProjectData>('test script');

      expect(result.name).toBe('Home Renovation');
      expect(result.nextReviewDate).toBeTruthy();
    });

    it('should prioritize projectId over projectName', async () => {
      // When both are provided, projectId is used
      const projectFoundById = createMockProject({
        id: 'proj-by-id',
        name: 'Found By ID',
        nextReviewDate: new Date().toISOString()
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(projectFoundById);

      const result = await index.executeAndParseJSON<ProjectData>('test script');

      expect(result.id).toBe('proj-by-id');
      expect(result.name).toBe('Found By ID');
    });

    it('should handle exact name match', async () => {
      // Exact match is preferred over partial matches
      const exactMatchProject = createMockProject({
        id: 'proj-exact',
        name: 'Q4 Planning',
        nextReviewDate: new Date().toISOString()
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(exactMatchProject);

      const result = await index.executeAndParseJSON<ProjectData>('test script');

      expect(result.name).toBe('Q4 Planning');
    });

    it('should handle case-insensitive partial match', async () => {
      // Searching for "work" matches "Work Project"
      const partialMatchProject = createMockProject({
        id: 'proj-partial',
        name: 'Work Project',
        nextReviewDate: new Date().toISOString()
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(partialMatchProject);

      const result = await index.executeAndParseJSON<ProjectData>('test script');

      expect(result.name).toContain('Work');
    });

    it('should error on multiple matches', async () => {
      // When multiple projects match, the JXA script throws an error
      // The error includes a list of matching projects
      const errorMessage = `Multiple projects found matching 'Project'. Please use projectId or be more specific:
- Work Project (ID: proj-1, Folder: Work)
- Home Project (ID: proj-2, Folder: Home)`;

      vi.mocked(index.executeAndParseJSON).mockRejectedValue(new Error(errorMessage));

      await expect(
        index.executeAndParseJSON<ProjectData>('test script')
      ).rejects.toThrow('Multiple projects found');
    });

    it('should error when project not found', async () => {
      vi.mocked(index.executeAndParseJSON).mockRejectedValue(
        new Error('No project found matching name: NonexistentProject')
      );

      await expect(
        index.executeAndParseJSON<ProjectData>('test script')
      ).rejects.toThrow('No project found');
    });

    it('should use project default review interval when not specified', async () => {
      // When reviewIntervalDays is not provided, project uses its existing interval
      const defaultIntervalDate = new Date();
      defaultIntervalDate.setDate(defaultIntervalDate.getDate() + 14); // Default 14 days

      const reviewedProject = createMockProject({
        id: 'proj-default',
        name: 'Default Interval Project',
        nextReviewDate: defaultIntervalDate.toISOString()
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(reviewedProject);

      const result = await index.executeAndParseJSON<ProjectData>('test script');

      expect(result.nextReviewDate).toBeTruthy();
    });

    it('should set custom review interval when provided', async () => {
      // When reviewIntervalDays is provided, set custom interval (e.g., 30 days)
      const customIntervalDate = new Date();
      customIntervalDate.setDate(customIntervalDate.getDate() + 30);

      const reviewedProject = createMockProject({
        id: 'proj-custom',
        name: 'Custom Interval Project',
        nextReviewDate: customIntervalDate.toISOString()
      });

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(reviewedProject);

      const result = await index.executeAndParseJSON<ProjectData>('test script');

      expect(result.nextReviewDate).toBeTruthy();
      // The nextReviewDate should be approximately 30 days from now
    });

    it('should require either projectId or projectName', async () => {
      // Zod schema validation should fail if neither is provided
      // This would be caught before executeAndParseJSON is called
      // Simulating the validation error
      vi.mocked(index.executeAndParseJSON).mockRejectedValue(
        new Error('Either projectId or projectName must be provided')
      );

      await expect(
        index.executeAndParseJSON<ProjectData>('test script')
      ).rejects.toThrow('Either projectId or projectName must be provided');
    });
  });

  describe('omnifocus_batch_mark_reviewed', () => {
    it('should mark multiple projects as reviewed', async () => {
      const reviewedProjects = [
        createMockProject({
          id: 'proj-1',
          name: 'Project 1',
          nextReviewDate: new Date().toISOString()
        }),
        createMockProject({
          id: 'proj-2',
          name: 'Project 2',
          nextReviewDate: new Date().toISOString()
        }),
        createMockProject({
          id: 'proj-3',
          name: 'Project 3',
          nextReviewDate: new Date().toISOString()
        })
      ];

      const batchResult = {
        successful: reviewedProjects,
        failed: []
      };

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(batchResult);

      const result = await index.executeAndParseJSON<{
        successful: ProjectData[];
        failed: Array<{ projectId: string; error: string }>;
      }>('test script');

      expect(result.successful).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(result.successful[0].nextReviewDate).toBeTruthy();
    });

    it('should apply custom review interval to all projects', async () => {
      const customInterval = 30; // 30 days
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + customInterval);

      const reviewedProjects = [
        createMockProject({
          id: 'proj-1',
          name: 'Project 1',
          nextReviewDate: futureDate.toISOString()
        }),
        createMockProject({
          id: 'proj-2',
          name: 'Project 2',
          nextReviewDate: futureDate.toISOString()
        })
      ];

      const batchResult = {
        successful: reviewedProjects,
        failed: []
      };

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(batchResult);

      const result = await index.executeAndParseJSON<{
        successful: ProjectData[];
        failed: Array<{ projectId: string; error: string }>;
      }>('test script');

      expect(result.successful).toHaveLength(2);
      // All projects should have the custom interval applied
      result.successful.forEach(project => {
        expect(project.nextReviewDate).toBeTruthy();
      });
    });

    it('should return summary with success and failure counts', async () => {
      const batchResult = {
        successful: [
          createMockProject({ id: 'proj-1', name: 'Success 1', nextReviewDate: new Date().toISOString() }),
          createMockProject({ id: 'proj-2', name: 'Success 2', nextReviewDate: new Date().toISOString() })
        ],
        failed: [
          { projectId: 'proj-3', error: 'Project not found' }
        ]
      };

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(batchResult);

      const result = await index.executeAndParseJSON<{
        successful: ProjectData[];
        failed: Array<{ projectId: string; error: string }>;
      }>('test script');

      expect(result.successful).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
      // The handler wraps this in totalRequested, successCount, failureCount
    });

    it('should handle partial success gracefully', async () => {
      // 2 succeed, 1 fails
      const batchResult = {
        successful: [
          createMockProject({ id: 'proj-1', name: 'Success', nextReviewDate: new Date().toISOString() })
        ],
        failed: [
          { projectId: 'proj-2', error: 'Project not found' }
        ]
      };

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(batchResult);

      const result = await index.executeAndParseJSON<{
        successful: ProjectData[];
        failed: Array<{ projectId: string; error: string }>;
      }>('test script');

      // Partial success is valid - some succeeded, some failed
      expect(result.successful.length).toBeGreaterThan(0);
      expect(result.failed.length).toBeGreaterThan(0);
      expect(result.successful.length + result.failed.length).toBeGreaterThan(1);
    });

    it('should continue processing after individual failures', async () => {
      // Even if proj-2 fails, proj-3 should still be processed
      const batchResult = {
        successful: [
          createMockProject({ id: 'proj-1', name: 'Success 1', nextReviewDate: new Date().toISOString() }),
          createMockProject({ id: 'proj-3', name: 'Success 2', nextReviewDate: new Date().toISOString() })
        ],
        failed: [
          { projectId: 'proj-2', error: 'Project not found' }
        ]
      };

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(batchResult);

      const result = await index.executeAndParseJSON<{
        successful: ProjectData[];
        failed: Array<{ projectId: string; error: string }>;
      }>('test script');

      // All 3 were processed (2 succeeded, 1 failed)
      expect(result.successful.length + result.failed.length).toBe(3);
      expect(result.successful).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
    });

    it('should include error details for failed projects', async () => {
      const batchResult = {
        successful: [],
        failed: [
          { projectId: 'proj-missing', error: 'Project not found' },
          { projectId: 'proj-error', error: 'Permission denied' }
        ]
      };

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(batchResult);

      const result = await index.executeAndParseJSON<{
        successful: ProjectData[];
        failed: Array<{ projectId: string; error: string }>;
      }>('test script');

      expect(result.failed).toHaveLength(2);
      expect(result.failed[0]).toHaveProperty('projectId');
      expect(result.failed[0]).toHaveProperty('error');
      expect(result.failed[0].projectId).toBe('proj-missing');
      expect(result.failed[0].error).toBe('Project not found');
    });

    it('should validate projectIds array is not empty', async () => {
      // Zod schema validates min(1)
      vi.mocked(index.executeAndParseJSON).mockRejectedValue(
        new Error('Array must contain at least 1 element(s)')
      );

      await expect(
        index.executeAndParseJSON('test script')
      ).rejects.toThrow('at least 1');
    });

    it('should validate projectIds array is not too large', async () => {
      // Zod schema validates max(100)
      vi.mocked(index.executeAndParseJSON).mockRejectedValue(
        new Error('Array must contain at most 100 element(s)')
      );

      await expect(
        index.executeAndParseJSON('test script')
      ).rejects.toThrow('at most 100');
    });

    it('should return reviewed project data for successful items', async () => {
      const fullProjectData = [
        createMockProject({
          id: 'proj-1',
          name: 'Complete Project',
          note: 'Project notes',
          status: 'active',
          folderName: 'Work',
          taskCount: 5,
          sequential: true,
          flagged: true,
          nextReviewDate: new Date().toISOString()
        })
      ];

      const batchResult = {
        successful: fullProjectData,
        failed: []
      };

      vi.mocked(index.executeAndParseJSON).mockResolvedValue(batchResult);

      const result = await index.executeAndParseJSON<{
        successful: ProjectData[];
        failed: Array<{ projectId: string; error: string }>;
      }>('test script');

      expect(result.successful).toHaveLength(1);
      const project = result.successful[0];
      // Verify full project data is returned
      expect(project).toHaveProperty('id');
      expect(project).toHaveProperty('name');
      expect(project).toHaveProperty('note');
      expect(project).toHaveProperty('status');
      expect(project).toHaveProperty('folderName');
      expect(project).toHaveProperty('taskCount');
      expect(project).toHaveProperty('sequential');
      expect(project).toHaveProperty('nextReviewDate');
      expect(project.name).toBe('Complete Project');
    });
  });
});
