# Code Review: OmniFocus MCP Server

**Date:** 2026-01-29
**Reviewer:** Claude Sonnet 4.5
**Branch:** feature/implement-unit-tests
**Lines of Code:** ~2,800 (2,062 main + 637 tests + 120 integration)

---

## Executive Summary

**Overall Rating: B+ (Good with room for improvement)**

The OmniFocus MCP Server is a well-structured project that provides a functional bridge between AI assistants and OmniFocus via JXA (JavaScript for Automation). The codebase demonstrates good understanding of the problem domain and includes a solid testing foundation.

### Strengths
- ✅ Clear architecture with single-responsibility functions
- ✅ Comprehensive error handling for common macOS issues
- ✅ Good TypeScript type safety
- ✅ Solid test coverage foundation (20 actual unit tests)
- ✅ Well-documented with inline comments

### Areas for Improvement
- ⚠️ **CRITICAL:** Build is currently broken (TypeScript errors)
- ⚠️ Test coverage at 13.87% (target: 80%+)
- ⚠️ Placeholder tests present that don't test implementation
- ⚠️ Missing tests for 3 new tools
- ⚠️ No input sanitization for user-provided strings
- ⚠️ Large monolithic file (2,062 lines)

---

## Critical Issues

### 1. **Build is Broken** 🔴 HIGH PRIORITY

**Issue:** TypeScript compilation fails due to missing `nextReviewDate` property in test mocks.

```
src/__tests__/tools.test.ts(299,9): error TS2741:
Property 'nextReviewDate' is missing in type 'ProjectData'
```

**Impact:** Cannot build or deploy the application.

**Fix Required:**
```typescript
// In tools.test.ts, add nextReviewDate to all ProjectData mocks:
const mockProject: ProjectData = {
  // ... existing fields
  nextReviewDate: null,  // Add this
};
```

**Files Affected:**
- `src/__tests__/tools.test.ts` (lines 299, 312, 339)

---

### 2. **Incomplete Test Coverage** 🟡 MEDIUM PRIORITY

**Current State:**
- 15 tools registered in implementation
- Only 12 tools have actual tests
- 3 tools have placeholder tests only:
  - `omnifocus_get_projects_for_review` (8 placeholder tests)
  - `omnifocus_mark_project_reviewed` (10 placeholder tests)
  - `omnifocus_batch_mark_reviewed` (9 placeholder tests)

**Evidence:**
```typescript
// From tools.test.ts line 498-537
describe('omnifocus_get_projects_for_review', () => {
  it('should get projects needing review by default (overdue only)', async () => {
    // Test with daysAhead=0 (default)
    expect(true).toBe(true);  // ❌ Placeholder - doesn't test anything
  });
  // ... 7 more placeholder tests
});
```

**Impact:**
- False sense of test coverage
- New features are untested
- Tests will pass even if features are broken

**Recommendation:** Implement actual tests for these 3 tools or remove placeholder tests.

---

### 3. **Security Concern: Input Sanitization** 🟡 MEDIUM PRIORITY

**Issue:** User-provided strings are escaped but not validated before JXA execution.

**Current Implementation:**
```typescript
// src/index.ts lines 763-765
const escapeName = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
```

**Concerns:**
1. Escaping only covers quotes and newlines
2. No validation of string length or content
3. Could potentially inject malicious JXA code through edge cases
4. No sanitization of project names, tag names, etc.

**Recommendation:**
```typescript
// Add input validation
function sanitizeInput(input: string, maxLength: number = 500): string {
  // 1. Length validation
  if (input.length > maxLength) {
    throw new Error(`Input exceeds maximum length of ${maxLength}`);
  }

  // 2. Check for potentially dangerous patterns
  const dangerousPatterns = [
    /\$\{/,  // Template literal injection
    /eval\(/i,  // Eval injection
    /require\(/i,  // Module loading
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(input)) {
      throw new Error('Input contains potentially unsafe characters');
    }
  }

  // 3. Then escape
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
```

---

## Architecture Review

### File Structure

```
omnifocus-mcp-server/
├── src/
│   ├── index.ts              (2,062 lines) ⚠️ TOO LARGE
│   └── __tests__/
│       ├── tools.test.ts     (637 lines)
│       └── integration.test.ts (120 lines)
├── TESTING.md                (outdated)
├── CODE_REVIEW.md            (this file)
└── package.json
```

**Concerns:**

1. **Monolithic `index.ts`** (2,062 lines)
   - Contains all types, mappers, tools, server setup
   - Hard to navigate and maintain
   - Should be split into modules

**Recommended Structure:**
```
src/
├── index.ts                  (main entry, ~50 lines)
├── types.ts                  (interfaces)
├── executor.ts               (JXA execution)
├── mappers.ts                (data mappers)
├── schemas.ts                (Zod schemas)
└── tools/
    ├── tasks.ts
    ├── projects.ts
    ├── tags.ts
    └── search.ts
```

---

## Code Quality Analysis

### Positive Patterns

#### 1. Good Error Handling
```typescript
// src/index.ts lines 122-131
if (error instanceof Error) {
  if (error.message.includes("is not running")) {
    throw new Error("OmniFocus is not running...");
  }
  if (error.message.includes("not allowed")) {
    throw new Error("Script access to OmniFocus is not allowed...");
  }
}
```
✅ Catches specific error cases
✅ Provides helpful error messages
✅ Handles both English and localized errors

#### 2. Type Safety
```typescript
// All interfaces are properly exported
export interface TaskData { ... }
export interface ProjectData { ... }
```
✅ Strong typing throughout
✅ Proper use of nullable types
✅ Interfaces exported for reuse

#### 3. Clear Mapper Functions
```typescript
// Mapper functions are string constants for JXA injection
export const TASK_MAPPER = `
function mapTask(t) {
  return {
    id: t.id(),
    name: t.name(),
    // ...
  };
}
`;
```
✅ Reusable across tools
✅ Centralized data transformation
✅ Easy to test (though not currently tested)

### Problem Patterns

#### 1. Repetitive Code
```typescript
// Pattern repeated in multiple tools (lines 829-860, 944-975, 1068-1099)
let findTaskScript: string;
if (taskId) {
  findTaskScript = `
    var task = doc.flattenedTasks().find(...);
    if (!task) { throw new Error("Task not found..."); }
  `;
} else if (taskName) {
  // Duplicate logic for name-based search
}
```

**Solution:** Extract to a reusable function:
```typescript
function generateTaskLookupScript(taskId?: string, taskName?: string): string {
  // Centralize this logic
}
```

#### 2. Magic Numbers
```typescript
// Line 108
{ maxBuffer: 10 * 1024 * 1024 }  // What is this?

// Line 104
`omnifocus-script-${Date.now()}.js`  // Collision risk?
```

**Solution:**
```typescript
const MAX_SCRIPT_OUTPUT = 10 * 1024 * 1024;  // 10 MB
const TEMP_FILE_PREFIX = 'omnifocus-script';
const TEMP_FILE_SUFFIX = `${Date.now()}-${process.pid}`;  // Add PID for uniqueness
```

#### 3. Inconsistent Error Responses
```typescript
// Some tools return detailed errors:
throw new Error("Multiple tasks found matching '${escapedName}'. Please use taskId or be more specific:\\n" + matchList);

// Others are generic:
throw new Error("Task not found with ID: ${taskId}");
```

**Solution:** Standardize error response format.

---

## Test Quality Review

### Current Test State

**Test Files:**
- `tools.test.ts`: 47 tests (20 actual + 27 placeholders)
- `integration.test.ts`: 12 tests (all skipped)
- Old test files in `dist/`: 56 tests (should be deleted)

**Coverage:** 13.87%

### Test Quality Issues

#### 1. **Placeholder Tests Don't Test Anything**
```typescript
it('should get projects needing review by default (overdue only)', async () => {
  // Test with daysAhead=0 (default)
  expect(true).toBe(true);  // ❌ Meaningless assertion
});
```

**27 tests** like this exist. They:
- ✅ Pass every time
- ❌ Don't test any code
- ❌ Don't catch bugs
- ❌ Give false confidence

#### 2. **Tests Don't Actually Call Code Under Test**
```typescript
it('should create a task with plannedDate', async () => {
  const mockTask = createMockTask({ ... });
  vi.mocked(index.executeAndParseJSON).mockResolvedValue(mockTask);

  const result = await index.executeAndParseJSON<TaskData>('test script');

  expect(result).toEqual(mockTask);  // Just testing the mock!
});
```

**Issue:** Tests only verify mocks work, not actual tool handlers.

#### 3. **Missing Test Scenarios**

Not tested:
- ❌ Task creation with `recurrence` parameter
- ❌ Edge cases (empty strings, very long names)
- ❌ Unicode/emoji in task names
- ❌ Concurrent script execution
- ❌ Script timeout scenarios
- ❌ Large result sets (>1000 items)

---

## Documentation Review

### What Exists
- ✅ `CLAUDE.md`: Good architecture documentation
- ✅ `TESTING.md`: Comprehensive testing guide
- ✅ Inline comments in code
- ✅ Tool descriptions in MCP registration

### What's Missing
- ❌ `README.md`: No user-facing documentation
- ❌ API documentation
- ❌ Setup/installation guide
- ❌ Contributing guidelines
- ❌ Changelog

### Documentation Issues

#### 1. **Outdated TESTING.md**
Claims "114 unit tests" but we have 147 total tests.
Claims files exist that were deleted (schemas.test.ts, mappers.test.ts).

#### 2. **Missing Examples**
No examples of:
- How to use the MCP server
- How to configure Claude Desktop
- Sample queries/prompts

---

## Performance Considerations

### Potential Issues

1. **Temp File Creation**
   ```typescript
   // Line 104: Creates a new temp file for every script
   const tmpFile = path.join(os.tmpdir(), `omnifocus-script-${Date.now()}.js`);
   ```
   - Creates many temp files
   - Cleanup only happens after execution
   - Could accumulate if cleanup fails

2. **No Caching**
   - Every request hits OmniFocus
   - No caching of frequently accessed data
   - Could implement short-lived cache for read operations

3. **No Rate Limiting**
   - Multiple concurrent requests could overwhelm OmniFocus
   - No throttling or queue management

---

## Security Review

### Concerns

1. **Script Injection** (Medium Risk)
   - User input is escaped but not validated
   - Complex escaping logic is error-prone
   - Recommend using parameterized queries or safer API

2. **Temp File Security** (Low Risk)
   - Temp files use predictable names
   - Could be read by other processes
   - Recommend using secure temp file creation

3. **No Input Length Limits** (Low Risk)
   - Zod schemas have `.max()` but large values
   - Could cause memory issues with very large inputs

---

## Recommendations Summary

### Immediate (Before Merge)

1. 🔴 **Fix TypeScript Build Errors**
   - Add `nextReviewDate: null` to ProjectData mocks
   - Ensure `npm run build` succeeds

2. 🟡 **Address Placeholder Tests**
   - Either implement the 27 placeholder tests
   - Or remove them and mark as TODO

3. 🟡 **Clean Up Dist Files**
   - Remove old test files from `dist/__tests__/`
   - Update `.gitignore` if needed

### Short Term (Next Sprint)

4. 🟡 **Improve Test Coverage**
   - Target: 40%+ (from 13.87%)
   - Focus on tool handlers
   - Add edge case tests

5. 🟡 **Add Input Sanitization**
   - Implement `sanitizeInput()` function
   - Add validation before escaping

6. 🟡 **Create README.md**
   - Installation instructions
   - Usage examples
   - Configuration guide

### Long Term (Future)

7. ⚪ **Refactor Monolithic File**
   - Split `index.ts` into modules
   - Improve maintainability

8. ⚪ **Add Integration Tests**
   - Create test OmniFocus database
   - Run integration tests in CI

9. ⚪ **Performance Optimizations**
   - Implement caching layer
   - Add rate limiting
   - Optimize temp file handling

---

## Test Coverage Goals

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Line Coverage | 13.87% | 80% | -66.13% |
| Branch Coverage | 0% | 75% | -75% |
| Function Coverage | 4.34% | 80% | -75.66% |
| Test Quality | Mixed | High | Needs improvement |

---

## Code Metrics

| Metric | Value | Status |
|--------|-------|--------|
| Total Lines | 2,819 | ⚠️ High |
| Largest File | 2,062 | 🔴 Too Large |
| Cyclomatic Complexity | Medium | ✅ OK |
| Test Files | 2 | ⚠️ Low |
| Documentation | Good | ✅ OK |
| Type Safety | Strong | ✅ Excellent |

---

## Conclusion

The OmniFocus MCP Server is a **solid foundation** with good architecture and clear code. However, it requires immediate attention to:

1. Fix the broken build
2. Address test quality issues
3. Improve actual test coverage

Once these issues are resolved, the project will be in excellent shape for production use.

**Recommended Action:** Address critical issues before merging, then create follow-up tickets for improvements.

---

## Approval Status

- ✅ **Architecture**: Approved
- ✅ **Code Quality**: Approved with minor comments
- 🔴 **Build Status**: **BLOCKED** - Build must pass
- ⚠️ **Test Coverage**: Approved with improvements needed
- ✅ **Documentation**: Approved

**Overall Verdict:** **CONDITIONAL APPROVAL**
*Fix build errors and address placeholder tests before merging.*
