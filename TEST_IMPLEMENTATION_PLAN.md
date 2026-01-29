# Test Implementation Plan for Project Review Tools

## Overview
Implement 27 placeholder tests for 3 project review tools with full test coverage.

---

## Tool 1: omnifocus_get_projects_for_review (8 tests)

**What it does:**
- Retrieves projects needing review based on nextReviewDate
- Filters by status (active/done/dropped/onHold/all)
- Looks ahead N days (0 = overdue only)
- Returns sorted list, limited by max count

**Parameters:**
- `daysAhead`: 0-365 (default: 0)
- `status`: 'active'|'done'|'dropped'|'onHold'|'all' (default: 'active')
- `limit`: 1-500 (default: 50)

**Tests to implement:**
1. ✅ Get overdue projects (daysAhead=0, default behavior)
2. ✅ Get projects due within N days (daysAhead=7)
3. ✅ Filter by project status (test 'done', 'active', 'all')
4. ✅ Sort by nextReviewDate ascending
5. ✅ Exclude projects without nextReviewDate
6. ✅ Respect limit parameter (return max N projects)
7. ✅ Return empty message when no projects need review
8. ✅ Handle nextReviewDate property access errors gracefully

---

## Tool 2: omnifocus_mark_project_reviewed (10 tests)

**What it does:**
- Marks a single project as reviewed
- Finds project by ID or name
- Updates nextReviewDate based on interval
- Can set custom review interval

**Parameters:**
- `projectId`: string (optional, takes priority)
- `projectName`: string (optional, used if no ID)
- `reviewIntervalDays`: 1-3650 (optional)
- At least one of projectId/projectName required

**Tests to implement:**
1. ✅ Mark by projectId - find and mark specific project
2. ✅ Mark by projectName - find and mark by name
3. ✅ ProjectId priority - use ID when both provided
4. ✅ Exact name match - prefer exact match over partial
5. ✅ Partial case-insensitive match - fuzzy search
6. ✅ Multiple matches error - show list of matches
7. ✅ Not found error - project doesn't exist
8. ✅ Default interval - use project's existing interval
9. ✅ Custom interval - set new reviewIntervalDays
10. ✅ Require ID or name - validation error

---

## Tool 3: omnifocus_batch_mark_reviewed (9 tests)

**What it does:**
- Marks multiple projects as reviewed in one operation
- Processes all projects, continues on failures
- Returns detailed success/failure report

**Parameters:**
- `projectIds`: string[] (1-100 items required)
- `reviewIntervalDays`: 1-3650 (optional)

**Returns:**
- `totalRequested`: number
- `successCount`: number
- `failureCount`: number
- `reviewedProjects`: ProjectData[]
- `failures`: Array<{projectId, error}>

**Tests to implement:**
1. ✅ Basic batch - mark multiple projects successfully
2. ✅ Custom interval - apply to all projects
3. ✅ Result structure - verify output format
4. ✅ Partial success - some succeed, some fail
5. ✅ Continue after failure - don't stop on error
6. ✅ Error details - include failure information
7. ✅ Min length validation - require at least 1 ID
8. ✅ Max length validation - reject > 100 IDs
9. ✅ Success data - return full project objects

---

## Test Implementation Strategy

### 1. Create Helper Function
```typescript
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
  nextReviewDate: null, // Key for review tests!
  ...overrides,
});
```

### 2. Mock Pattern
Each test will:
1. Create mock data with `createMockProject()`
2. Mock `executeAndParseJSON` to return the mock data
3. Call the mocked function and verify results
4. Assert expected behavior

### 3. Test Organization
- Group by tool (3 describe blocks)
- Use descriptive test names
- Test happy path and error cases
- Verify data structure and content

---

## Implementation Order

### Phase 1: Foundation (5 min)
- Create `createMockProject` helper
- Add imports if needed
- Test helper works

### Phase 2: get_projects_for_review (15 min)
- Implement 8 tests
- Focus on filtering, sorting, limiting
- Test empty results

### Phase 3: mark_project_reviewed (20 min)
- Implement 10 tests
- Focus on ID vs name lookup
- Test error cases (multiple matches, not found)
- Test interval handling

### Phase 4: batch_mark_reviewed (15 min)
- Implement 9 tests
- Focus on batch operations
- Test partial failures
- Test validation

### Phase 5: Verification (5 min)
- Run all tests
- Check coverage increase
- Verify no regressions

**Total Time: ~60 minutes**

---

## Success Criteria

✅ All 27 placeholder tests replaced with real implementations
✅ All tests pass
✅ Coverage increases significantly
✅ No test.skip or expect(true).toBe(true)
✅ Each test verifies actual behavior
✅ Mock data is realistic
✅ Error cases are covered
