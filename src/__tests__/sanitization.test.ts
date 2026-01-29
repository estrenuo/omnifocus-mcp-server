/**
 * Unit tests for input sanitization security layer
 */

import { describe, it, expect } from 'vitest';
import { sanitizeInput, sanitizeArray } from '../index.js';

describe('Input Sanitization Security', () => {
  describe('sanitizeInput', () => {
    it('should sanitize valid normal text', () => {
      const result = sanitizeInput('Hello World');
      expect(result).toBe('Hello World');
    });

    it('should escape double quotes', () => {
      const result = sanitizeInput('Task with "quotes"');
      expect(result).toBe('Task with \\"quotes\\"');
    });

    it('should escape single quotes', () => {
      const result = sanitizeInput("Task with 'apostrophes'");
      expect(result).toBe("Task with \\'apostrophes\\'");
    });

    it('should escape backslashes', () => {
      const result = sanitizeInput('Path\\to\\file');
      expect(result).toBe('Path\\\\to\\\\file');
    });

    it('should escape backticks', () => {
      const result = sanitizeInput('Task with `backticks`');
      expect(result).toBe('Task with \\`backticks\\`');
    });

    it('should escape dollar signs', () => {
      const result = sanitizeInput('Price: $100');
      expect(result).toBe('Price: \\$100');
    });

    it('should escape newlines', () => {
      const result = sanitizeInput('Line 1\nLine 2');
      expect(result).toBe('Line 1\\nLine 2');
    });

    it('should escape carriage returns', () => {
      const result = sanitizeInput('Line 1\rLine 2');
      expect(result).toBe('Line 1\\rLine 2');
    });

    it('should escape tabs', () => {
      const result = sanitizeInput('Col1\tCol2');
      expect(result).toBe('Col1\\tCol2');
    });

    it('should escape null bytes', () => {
      const result = sanitizeInput('Text\x00Null');
      expect(result).toBe('Text\\0Null');
    });

    it('should handle unicode characters', () => {
      const result = sanitizeInput('Task with émojis 🎯');
      expect(result).toBe('Task with émojis 🎯');
    });

    it('should reject template literal injection', () => {
      expect(() => sanitizeInput('${malicious}')).toThrow('template literal injection');
    });

    it('should reject eval() calls', () => {
      expect(() => sanitizeInput('eval(code)')).toThrow('eval() function call');
      expect(() => sanitizeInput('EVAL(code)')).toThrow('eval() function call');
    });

    it('should reject Function() constructor', () => {
      expect(() => sanitizeInput('Function("return 1")()')).toThrow('Function() constructor');
      expect(() => sanitizeInput('Function (code)')).toThrow('Function() constructor');
    });

    it('should reject require() calls', () => {
      expect(() => sanitizeInput('require("fs")')).toThrow('require() function call');
      expect(() => sanitizeInput('REQUIRE("fs")')).toThrow('require() function call');
    });

    it('should reject import statements', () => {
      expect(() => sanitizeInput('import fs from "fs"')).toThrow('import statement');
      expect(() => sanitizeInput('IMPORT something')).toThrow('import statement');
    });

    it('should reject constructor access', () => {
      expect(() => sanitizeInput('obj.constructor')).toThrow('constructor access');
      expect(() => sanitizeInput('obj.CONSTRUCTOR')).toThrow('constructor access');
    });

    it('should reject prototype pollution attempts', () => {
      expect(() => sanitizeInput('__proto__')).toThrow('prototype pollution');
    });

    it('should reject exec() calls', () => {
      expect(() => sanitizeInput('exec("ls")')).toThrow('exec() function call');
    });

    it('should reject spawn() calls', () => {
      expect(() => sanitizeInput('spawn("sh")')).toThrow('spawn() function call');
    });

    it('should reject process object access', () => {
      expect(() => sanitizeInput('process.exit()')).toThrow('process object access');
      expect(() => sanitizeInput('PROCESS.env')).toThrow('process object access');
    });

    it('should reject global object access', () => {
      expect(() => sanitizeInput('global.something')).toThrow('global object access');
      expect(() => sanitizeInput('GLOBAL.test')).toThrow('global object access');
    });

    it('should reject input exceeding maximum length', () => {
      const longString = 'a'.repeat(501);
      expect(() => sanitizeInput(longString, 500)).toThrow('exceeds maximum length');
    });

    it('should accept input at maximum length', () => {
      const exactLength = 'a'.repeat(500);
      const result = sanitizeInput(exactLength, 500);
      expect(result).toBe(exactLength);
    });

    it('should use default max length of 500', () => {
      const tooLong = 'a'.repeat(501);
      expect(() => sanitizeInput(tooLong)).toThrow('exceeds maximum length of 500');
    });

    it('should allow custom max length', () => {
      const result = sanitizeInput('a'.repeat(100), 100);
      expect(result).toBe('a'.repeat(100));

      expect(() => sanitizeInput('a'.repeat(101), 100)).toThrow('exceeds maximum length of 100');
    });

    it('should reject excessive control characters', () => {
      // Create string with 11 control characters (threshold is 10)
      const controlString = 'text' + '\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B';
      expect(() => sanitizeInput(controlString)).toThrow('excessive control characters');
    });

    it('should allow reasonable number of control characters', () => {
      // 10 or fewer control characters should be fine
      const controlString = 'text\n\r\t\n\r\t\n\r\t\n';
      const result = sanitizeInput(controlString);
      expect(result).toContain('\\n');
      expect(result).toContain('\\r');
      expect(result).toContain('\\t');
    });

    it('should reject non-string input', () => {
      expect(() => sanitizeInput(123 as any)).toThrow('must be a string');
      expect(() => sanitizeInput(null as any)).toThrow('must be a string');
      expect(() => sanitizeInput(undefined as any)).toThrow('must be a string');
      expect(() => sanitizeInput({} as any)).toThrow('must be a string');
    });

    it('should handle empty string', () => {
      const result = sanitizeInput('');
      expect(result).toBe('');
    });

    it('should handle complex real-world examples', () => {
      const examples = [
        { input: 'Buy groceries', expected: 'Buy groceries' },
        { input: 'Call "John Smith"', expected: 'Call \\"John Smith\\"' },
        { input: 'Review Q4 report\n- Section 1\n- Section 2', expected: 'Review Q4 report\\n- Section 1\\n- Section 2' },
        { input: 'Budget: $1,000', expected: 'Budget: \\$1,000' },
        { input: 'Path: C:\\Users\\Admin', expected: 'Path: C:\\\\Users\\\\Admin' },
      ];

      examples.forEach(({ input, expected }) => {
        expect(sanitizeInput(input)).toBe(expected);
      });
    });
  });

  describe('sanitizeArray', () => {
    it('should sanitize array of strings', () => {
      const result = sanitizeArray(['Task 1', 'Task 2', 'Task 3']);
      expect(result).toEqual(['Task 1', 'Task 2', 'Task 3']);
    });

    it('should sanitize each element', () => {
      const result = sanitizeArray(['Task "one"', 'Task "two"']);
      expect(result).toEqual(['Task \\"one\\"', 'Task \\"two\\"']);
    });

    it('should reject non-array input', () => {
      expect(() => sanitizeArray('not an array' as any)).toThrow('must be an array');
      expect(() => sanitizeArray(123 as any)).toThrow('must be an array');
    });

    it('should reject array exceeding maximum items', () => {
      const tooMany = Array(101).fill('item');
      expect(() => sanitizeArray(tooMany, 500, 100)).toThrow('exceeds maximum length of 100 items');
    });

    it('should accept array at maximum items', () => {
      const exactly = Array(100).fill('item');
      const result = sanitizeArray(exactly, 500, 100);
      expect(result).toHaveLength(100);
    });

    it('should use default max items of 100', () => {
      const tooMany = Array(101).fill('item');
      expect(() => sanitizeArray(tooMany)).toThrow('exceeds maximum length of 100 items');
    });

    it('should apply max length to each item', () => {
      const longItem = 'a'.repeat(51);
      expect(() => sanitizeArray([longItem], 50)).toThrow('exceeds maximum length of 50');
    });

    it('should use default max length of 500 per item', () => {
      const longItem = 'a'.repeat(501);
      expect(() => sanitizeArray([longItem])).toThrow('exceeds maximum length of 500');
    });

    it('should reject dangerous patterns in array items', () => {
      expect(() => sanitizeArray(['${injection}'])).toThrow('template literal injection');
      expect(() => sanitizeArray(['eval(code)'])).toThrow('eval() function call');
      expect(() => sanitizeArray(['normal', '__proto__'])).toThrow('prototype pollution');
    });

    it('should handle empty array', () => {
      const result = sanitizeArray([]);
      expect(result).toEqual([]);
    });

    it('should handle array with empty strings', () => {
      const result = sanitizeArray(['', '', '']);
      expect(result).toEqual(['', '', '']);
    });

    it('should handle mixed content array', () => {
      const input = ['Simple', 'With "quotes"', 'With\nnewline', 'With $dollar'];
      const expected = ['Simple', 'With \\"quotes\\"', 'With\\nnewline', 'With \\$dollar'];
      const result = sanitizeArray(input);
      expect(result).toEqual(expected);
    });

    it('should handle real-world tag examples', () => {
      const tags = ['Urgent', 'Work', 'High Priority', '@Home', '#Project'];
      const result = sanitizeArray(tags, 200, 50);
      expect(result).toEqual(tags);
    });
  });

  describe('Security Edge Cases', () => {
    it('should handle multiple escape sequences', () => {
      const input = 'Text with "quotes" and \\backslash and $dollar';
      const result = sanitizeInput(input);
      expect(result).toBe('Text with \\"quotes\\" and \\\\backslash and \\$dollar');
    });

    it('should handle nested patterns', () => {
      const input = 'Normal text ${not_template}';
      expect(() => sanitizeInput(input)).toThrow('template literal injection');
    });

    it('should be case-insensitive for dangerous patterns', () => {
      expect(() => sanitizeInput('EVAL(code)')).toThrow();
      expect(() => sanitizeInput('Eval(code)')).toThrow();
      expect(() => sanitizeInput('eVaL(code)')).toThrow();
    });

    it('should handle whitespace variations in dangerous patterns', () => {
      expect(() => sanitizeInput('eval (code)')).toThrow('eval() function call');
      expect(() => sanitizeInput('require (module)')).toThrow('require() function call');
    });

    it('should prevent double encoding attacks', () => {
      // Even if someone tries to bypass with already-escaped content
      const input = 'Text with \\"already escaped\\"';
      const result = sanitizeInput(input);
      // Should escape the backslashes again
      expect(result).toBe('Text with \\\\\\"already escaped\\\\\\"');
    });
  });
});
