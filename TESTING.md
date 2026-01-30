# Testing Guide for OmniFocus MCP Server

This document provides an overview of the testing infrastructure for the OmniFocus MCP Server project.

## Quick Start

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Visual test interface
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## Test Suite Overview

The project includes **96 unit tests** covering:

- **Tool Handlers** (47 tests): All MCP tool endpoints including task, project, tag, folder, and search operations plus project review tools
- **Input Sanitization** (49 tests): Security-focused input validation, injection prevention, array sanitization, and edge cases

Additionally, **12 integration tests** are available but skipped by default (they require a running OmniFocus instance).

## Test Files

```
src/__tests__/
├── README.md              # Detailed testing documentation
├── tools.test.ts          # MCP tool handler tests (47 tests)
├── sanitization.test.ts   # Input sanitization & security tests (49 tests)
└── integration.test.ts    # End-to-end tests (12 tests, skipped by default)
```

## Testing Philosophy

### Unit Tests (Default)

Unit tests are designed to run quickly without external dependencies. They:
- Mock OmniFocus interactions
- Validate business logic
- Test error handling
- Verify input validation
- Check data transformations

These tests can run in CI/CD pipelines without requiring macOS or OmniFocus.

### Integration Tests (Manual)

Integration tests interact with a real OmniFocus instance. They:
- Test the complete request-response cycle
- Verify JXA script generation and execution
- Validate data consistency
- Test real-world scenarios

**⚠️ Warning:** Integration tests modify your OmniFocus database. Use a test database or backup before running.

## Test Coverage Goals

Current test structure aims for:
- **Line coverage**: ≥ 80%
- **Branch coverage**: ≥ 75%
- **Function coverage**: ≥ 80%

Generate coverage reports with:
```bash
npm run test:coverage
```

Coverage reports are generated in the `coverage/` directory.

## Running Specific Tests

```bash
# Run tests matching a pattern
npx vitest run sanitization

# Run tests in a specific file
npx vitest run src/__tests__/tools.test.ts

# Run a single test by name
npx vitest run -t "should create task in inbox"

# Run integration tests (requires OmniFocus)
# First, remove .skip from describe blocks in integration.test.ts
npm run test:integration
```

## Development Workflow

### TDD (Test-Driven Development)

1. Write a failing test for new functionality
2. Implement the minimal code to make it pass
3. Refactor while keeping tests green

```bash
# Keep tests running in watch mode
npm run test:watch
```

### Adding New Tests

When adding a new MCP tool or feature:

1. **Create handler tests** in `tools.test.ts`:
   - Test successful execution
   - Test error cases
   - Test data transformation
   - Test business logic

2. **Create sanitization tests** in `sanitization.test.ts`:
   - Test input escaping and validation
   - Test injection prevention
   - Test array sanitization
   - Test security edge cases

3. **Update integration tests** in `integration.test.ts`:
   - Add end-to-end scenarios
   - Test with real OmniFocus data

### Example Test Structure

```typescript
describe('New Feature', () => {
  it('should handle valid input', () => {
    // Arrange
    const input = { /* test data */ };

    // Act
    const result = featureFunction(input);

    // Assert
    expect(result).toEqual(expectedOutput);
  });

  it('should reject invalid input', () => {
    // Arrange
    const invalidInput = { /* invalid data */ };

    // Act & Assert
    expect(() => featureFunction(invalidInput)).toThrow();
  });
});
```

## Continuous Integration

Tests should be integrated into your CI/CD pipeline:

```yaml
# Example GitHub Actions workflow
- name: Install dependencies
  run: npm ci

- name: Run tests
  run: npm test

- name: Generate coverage
  run: npm run test:coverage

- name: Upload coverage
  uses: codecov/codecov-action@v3
```

## Troubleshooting

### Tests Won't Run

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Build the project first
npm run build
```

### Mocking Issues

If mocks aren't working:
- Ensure `vi.mock()` is called before imports
- Clear mocks with `vi.clearAllMocks()` in `beforeEach()`
- Check mock implementation matches expected signature

### Coverage Discrepancies

If coverage seems incorrect:
- Run `npm run build` to ensure latest code is compiled
- Check `vitest.config.ts` for coverage exclusions
- Verify test files are in `src/__tests__/` directory

### Integration Tests Fail

Common issues:
- OmniFocus is not running → Launch OmniFocus
- Permission denied → Grant automation permissions in System Settings
- Tests modify data → Use a test OmniFocus database

## Best Practices

1. **Keep tests fast**: Unit tests should run in milliseconds
2. **Test behavior, not implementation**: Test what the code does, not how
3. **Use descriptive names**: Test names should explain what is being tested
4. **One assertion per test**: Focus each test on a single behavior
5. **Avoid test interdependence**: Each test should be independent
6. **Mock external dependencies**: Don't rely on OmniFocus for unit tests
7. **Test edge cases**: Empty inputs, boundaries, special characters, errors

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Zod Testing Guide](https://zod.dev/?id=testing)
- [OmniFocus Automation](https://omnigroup.com/automation)

## Contributing

When submitting pull requests:

1. ✅ All existing tests pass
2. ✅ New features have test coverage
3. ✅ Code coverage meets thresholds (≥80%)
4. ✅ Integration tests updated (if applicable)
5. ✅ Test documentation updated

Run the full test suite before committing:
```bash
npm run build
npm test
npm run test:coverage
```

---

For more detailed information about the test suite structure and specific test categories, see [src/__tests__/README.md](src/__tests__/README.md).
