/**
 * Tests for Zod input schemas
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('Input Schema Validation', () => {
  describe('ListInboxInputSchema', () => {
    const schema = z.object({
      includeCompleted: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(50),
    }).strict();

    it('should accept valid input', () => {
      const result = schema.safeParse({ includeCompleted: true, limit: 10 });
      expect(result.success).toBe(true);
    });

    it('should use default values', () => {
      const result = schema.parse({});
      expect(result.includeCompleted).toBe(false);
      expect(result.limit).toBe(50);
    });

    it('should reject limit out of range', () => {
      expect(() => schema.parse({ limit: 0 })).toThrow();
      expect(() => schema.parse({ limit: 501 })).toThrow();
    });

    it('should reject non-integer limit', () => {
      expect(() => schema.parse({ limit: 10.5 })).toThrow();
    });

    it('should reject extra fields', () => {
      expect(() => schema.parse({ extra: 'field' })).toThrow();
    });
  });

  describe('ListProjectsInputSchema', () => {
    const schema = z.object({
      status: z.enum(['all', 'active', 'done', 'dropped', 'onHold']).default('active'),
      folderName: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
    }).strict();

    it('should accept valid status values', () => {
      const statuses = ['all', 'active', 'done', 'dropped', 'onHold'];
      statuses.forEach((status) => {
        const result = schema.safeParse({ status });
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid status', () => {
      expect(() => schema.parse({ status: 'invalid' })).toThrow();
    });

    it('should accept optional folderName', () => {
      const result = schema.parse({ folderName: 'Work' });
      expect(result.folderName).toBe('Work');
    });
  });

  describe('CreateTaskInputSchema', () => {
    const schema = z.object({
      name: z.string().min(1).max(500),
      note: z.string().max(10000).optional(),
      projectName: z.string().optional(),
      parentTaskId: z.string().optional(),
      dueDate: z.string().optional(),
      deferDate: z.string().optional(),
      plannedDate: z.string().optional(),
      flagged: z.boolean().default(false),
      estimatedMinutes: z.number().int().min(1).max(9999).optional(),
      tagNames: z.array(z.string()).optional(),
    }).strict();

    it('should require task name', () => {
      expect(() => schema.parse({})).toThrow();
    });

    it('should accept minimal valid input', () => {
      const result = schema.parse({ name: 'Test Task' });
      expect(result.name).toBe('Test Task');
      expect(result.flagged).toBe(false);
    });

    it('should accept all optional fields', () => {
      const input = {
        name: 'Complete Task',
        note: 'Task description',
        projectName: 'Work',
        dueDate: '2024-12-31T17:00:00',
        deferDate: '2024-12-01T09:00:00',
        plannedDate: '2024-12-15T10:00:00',
        flagged: true,
        estimatedMinutes: 60,
        tagNames: ['Urgent', 'Important'],
      };
      const result = schema.parse(input);
      expect(result).toEqual(input);
    });

    it('should reject name that is too long', () => {
      expect(() => schema.parse({ name: 'a'.repeat(501) })).toThrow();
    });

    it('should reject note that is too long', () => {
      expect(() => schema.parse({ name: 'Test', note: 'a'.repeat(10001) })).toThrow();
    });

    it('should reject estimatedMinutes out of range', () => {
      expect(() => schema.parse({ name: 'Test', estimatedMinutes: 0 })).toThrow();
      expect(() => schema.parse({ name: 'Test', estimatedMinutes: 10000 })).toThrow();
    });
  });

  describe('CompleteTaskInputSchema', () => {
    const schema = z.object({
      taskId: z.string().optional(),
      taskName: z.string().optional(),
      action: z.enum(['complete', 'drop']).default('complete'),
    }).strict().refine(
      (data) => data.taskId || data.taskName,
      { message: 'Either taskId or taskName must be provided' }
    );

    it('should require either taskId or taskName', () => {
      expect(() => schema.parse({})).toThrow();
    });

    it('should accept taskId only', () => {
      const result = schema.parse({ taskId: '123' });
      expect(result.taskId).toBe('123');
    });

    it('should accept taskName only', () => {
      const result = schema.parse({ taskName: 'My Task' });
      expect(result.taskName).toBe('My Task');
    });

    it('should accept both taskId and taskName', () => {
      const result = schema.parse({ taskId: '123', taskName: 'My Task' });
      expect(result.taskId).toBe('123');
      expect(result.taskName).toBe('My Task');
    });

    it('should accept valid actions', () => {
      const complete = schema.parse({ taskId: '123', action: 'complete' });
      expect(complete.action).toBe('complete');

      const drop = schema.parse({ taskId: '123', action: 'drop' });
      expect(drop.action).toBe('drop');
    });

    it('should reject invalid action', () => {
      expect(() => schema.parse({ taskId: '123', action: 'invalid' })).toThrow();
    });
  });

  describe('SearchInputSchema', () => {
    const schema = z.object({
      query: z.string().min(1).max(200),
      searchType: z.enum(['tasks', 'projects', 'folders', 'tags', 'all']).default('all'),
      limit: z.number().int().min(1).max(100).default(20),
    }).strict();

    it('should require non-empty query', () => {
      expect(() => schema.parse({ query: '' })).toThrow();
    });

    it('should reject query that is too long', () => {
      expect(() => schema.parse({ query: 'a'.repeat(201) })).toThrow();
    });

    it('should accept valid search types', () => {
      const types = ['tasks', 'projects', 'folders', 'tags', 'all'];
      types.forEach((searchType) => {
        const result = schema.safeParse({ query: 'test', searchType });
        expect(result.success).toBe(true);
      });
    });

    it('should use default limit', () => {
      const result = schema.parse({ query: 'test' });
      expect(result.limit).toBe(20);
    });
  });

  describe('GetDueTasksInputSchema', () => {
    const schema = z.object({
      daysAhead: z.number().int().min(0).max(365).default(7),
      includeOverdue: z.boolean().default(true),
      limit: z.number().int().min(1).max(500).default(50),
    }).strict();

    it('should accept valid daysAhead values', () => {
      const result = schema.parse({ daysAhead: 30 });
      expect(result.daysAhead).toBe(30);
    });

    it('should reject negative daysAhead', () => {
      expect(() => schema.parse({ daysAhead: -1 })).toThrow();
    });

    it('should reject daysAhead over 365', () => {
      expect(() => schema.parse({ daysAhead: 366 })).toThrow();
    });

    it('should use default values', () => {
      const result = schema.parse({});
      expect(result.daysAhead).toBe(7);
      expect(result.includeOverdue).toBe(true);
      expect(result.limit).toBe(50);
    });
  });

  describe('AddTagInputSchema', () => {
    const schema = z.object({
      taskId: z.string().optional(),
      taskName: z.string().optional(),
      tagName: z.string(),
    }).strict().refine(
      (data) => data.taskId || data.taskName,
      { message: 'Either taskId or taskName must be provided' }
    );

    it('should require tagName', () => {
      expect(() => schema.parse({ taskId: '123' })).toThrow();
    });

    it('should require either taskId or taskName', () => {
      expect(() => schema.parse({ tagName: 'Urgent' })).toThrow();
    });

    it('should accept valid input', () => {
      const result = schema.parse({ taskId: '123', tagName: 'Urgent' });
      expect(result.taskId).toBe('123');
      expect(result.tagName).toBe('Urgent');
    });
  });
});
