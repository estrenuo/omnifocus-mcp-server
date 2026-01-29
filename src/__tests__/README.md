# OmniFocus MCP Server - Test Suite

This directory contains comprehensive unit and integration tests for the OmniFocus MCP Server.

## Test Structure

```
src/__tests__/
├── README.md              # This file
├── script-executor.test.ts # Tests for JXA script execution
├── mappers.test.ts        # Tests for data mapping functions
├── tools.test.ts          # Tests for MCP tool handlers
├── schemas.test.ts        # Tests for Zod input validation schemas
└── integration.test.ts    # End-to-end integration tests (requires OmniFocus)
```

## Running Tests

### Run all unit tests (default)
```bash
npm test
```

### Watch mode (auto-rerun on file changes)
```bash
npm run test:watch
```

### Visual test UI
```bash
npm run test:ui
```
Then open http://localhost:51204/__vitest__/ in your browser.

### Coverage report
```bash
npm run test:coverage
```
Coverage report will be generated in `coverage/` directory.

### Integration tests
```bash
npm run test:integration
```
**Note:** Integration tests require:
- OmniFocus to be running
- Automation permissions granted to the terminal/test runner
- These tests are skipped by default (use `.skip` in describe blocks)

## Test Categories

### Unit Tests

#### script-executor.test.ts
Tests the core JXA script execution engine:
- Script execution via osascript
- Error handling (OmniFocus not running, permissions denied)
- Special character escaping
- Temporary file management
- JSON parsing

#### mappers.test.ts
Tests data transformation functions:
- TASK_MAPPER: Task object → TaskData
- PROJECT_MAPPER: Project object → ProjectData
- FOLDER_MAPPER: Folder object → FolderData
- TAG_MAPPER: Tag object → TagData

#### tools.test.ts
Tests all MCP tool handlers:
- `omnifocus_list_inbox` - List inbox tasks
- `omnifocus_list_projects` - List and filter projects
- `omnifocus_list_folders` - List folders
- `omnifocus_list_tags` - List tags
- `omnifocus_create_task` - Create tasks with various properties
- `omnifocus_complete_task` - Complete/drop tasks by ID or name
- `omnifocus_add_tag_to_task` - Add tags to tasks
- `omnifocus_remove_tag_from_task` - Remove tags from tasks
- `omnifocus_search` - Search across all OmniFocus items
- `omnifocus_get_due_tasks` - Get tasks due within timeframe
- `omnifocus_get_flagged_tasks` - Get flagged tasks
- `omnifocus_get_planned_tasks` - Get planned tasks

#### schemas.test.ts
Tests Zod schema validation:
- Input parameter validation
- Default value handling
- Range checking (limits, dates, etc.)
- Required vs optional fields
- Custom refinements (e.g., taskId OR taskName required)

### Integration Tests

#### integration.test.ts
End-to-end tests with real OmniFocus instance:
- Full task lifecycle (create → tag → search → complete)
- Parent-child task relationships
- Data consistency across operations
- Idempotent operations
- Error handling with real data
- Special character handling
- Performance testing

**These tests are skipped by default** to prevent accidental modification of your OmniFocus database. To run them:
1. Remove `.skip` from the describe block in `integration.test.ts`
2. Ensure OmniFocus is running
3. Run `npm run test:integration`

## Test Development Guidelines

### Writing New Tests

1. **Follow the AAA pattern**: Arrange, Act, Assert
   ```typescript
   it('should do something', () => {
     // Arrange: Set up test data and mocks
     const input = { name: 'Test' };

     // Act: Execute the code under test
     const result = someFunction(input);

     // Assert: Verify the outcome
     expect(result).toEqual(expectedOutput);
   });
   ```

2. **Use descriptive test names**: Test names should describe what is being tested and the expected outcome
   - ✅ `should create task in inbox by default`
   - ❌ `test create task`

3. **Test edge cases**: Don't just test the happy path
   - Empty inputs
   - Boundary values (min/max limits)
   - Special characters
   - Error conditions

4. **Mock external dependencies**: Use `vi.mock()` for file system, child_process, etc.

5. **Keep tests isolated**: Each test should be independent and not rely on other tests

### Mocking OmniFocus Responses

Since we can't easily mock OmniFocus itself, unit tests should mock the `executeOmniFocusScript` and `executeAndParseJSON` functions:

```typescript
vi.mock('../index', () => ({
  executeAndParseJSON: vi.fn().mockResolvedValue({
    id: '123',
    name: 'Test Task',
    // ... other properties
  }),
}));
```

### Coverage Goals

- **Line coverage**: > 80%
- **Branch coverage**: > 75%
- **Function coverage**: > 80%

Areas that may have lower coverage:
- Error paths requiring specific macOS permissions
- Integration with actual OmniFocus (tested manually)

## Continuous Integration

Tests should run automatically on:
- Every push to feature branches
- Pull requests to main
- Before deployment/release

Configure your CI/CD pipeline to run:
```bash
npm run build
npm test
npm run test:coverage
```

## Troubleshooting

### Tests fail with "OmniFocus is not running"
- This is expected for integration tests
- Unit tests should mock the execution layer
- Check that mocks are set up correctly

### Coverage reports missing files
- Ensure TypeScript has compiled to `dist/`
- Run `npm run build` before coverage
- Check `vitest.config.ts` coverage excludes

### Tests timeout
- Integration tests may be slow with large OmniFocus databases
- Increase timeout in test config if needed
- Consider limiting test data scope

## Contributing

When adding new features:
1. Write tests first (TDD) or alongside the implementation
2. Ensure all tests pass: `npm test`
3. Check coverage: `npm run test:coverage`
4. Update this README if adding new test categories

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Zod Documentation](https://zod.dev/)
- [OmniFocus Automation Documentation](https://omnigroup.com/automation)
- [JXA Guide](https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/)
