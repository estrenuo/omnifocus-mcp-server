# Action Items from Code Review

## 🔴 Critical (Must Fix Before Merge)

### 1. Fix TypeScript Build Errors
**Status:** BLOCKING
**Priority:** P0
**Effort:** 5 minutes

**Problem:** Build fails due to missing `nextReviewDate` in ProjectData mocks.

**Fix:**
```bash
# Edit src/__tests__/tools.test.ts
# Add nextReviewDate: null to all ProjectData objects at lines:
# - 299 (mockProjects[0])
# - 312 (mockProjects[1])
# - 339 (mockProject)
```

**Files:**
- `src/__tests__/tools.test.ts` (3 locations)

**Verification:**
```bash
npm run build  # Should succeed
npm test       # Should pass
```

---

## 🟡 High Priority (Should Fix Before Merge)

### 2. Address Placeholder Tests
**Priority:** P1
**Effort:** 2-4 hours (or 10 minutes to remove)

**Problem:** 27 placeholder tests exist that don't test anything:
- `omnifocus_get_projects_for_review` (8 tests)
- `omnifocus_mark_project_reviewed` (10 tests)
- `omnifocus_batch_mark_reviewed` (9 tests)

**Options:**

**Option A - Quick Fix (Recommended):**
Remove placeholder tests and add TODO comments:
```typescript
// TODO: Implement tests for omnifocus_get_projects_for_review
// describe.todo('omnifocus_get_projects_for_review', () => { ... });
```

**Option B - Full Implementation:**
Implement actual tests for these 3 tools (see tools.test.ts lines 497-636).

**Decision Required:** Choose Option A or B

---

### 3. Clean Up Old Test Files
**Priority:** P1
**Effort:** 2 minutes

**Problem:** Old compiled test files in `dist/__tests__/` creating confusion.

**Fix:**
```bash
rm -rf dist/__tests__/mappers.test.js
rm -rf dist/__tests__/schemas.test.js
rm -rf dist/__tests__/script-executor.test.js
npm run build
```

**Or add to `.gitignore`:**
```
dist/__tests__/**/*.js
!dist/__tests__/tools.test.js
!dist/__tests__/integration.test.js
```

---

## 🟡 Medium Priority (Nice to Have)

### 4. Update Documentation
**Priority:** P2
**Effort:** 30 minutes

**Tasks:**
- Update `TESTING.md` with correct test counts
- Remove references to deleted test files
- Update coverage percentages

**Files:**
- `TESTING.md` (lines 26-44)

---

### 5. Add Input Sanitization
**Priority:** P2
**Effort:** 1-2 hours

**Problem:** User input is escaped but not validated.

**Implementation:**
```typescript
// Add to src/index.ts
function sanitizeInput(input: string, maxLength: number = 500): string {
  if (input.length > maxLength) {
    throw new Error(`Input exceeds maximum length of ${maxLength}`);
  }

  const dangerousPatterns = [/\$\{/, /eval\(/i, /require\(/i];
  for (const pattern of dangerousPatterns) {
    if (pattern.test(input)) {
      throw new Error('Input contains potentially unsafe characters');
    }
  }

  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
}

// Use in all user-facing functions:
const escapeName = sanitizeInput(name);
const escapeProject = sanitizeInput(projectName || '');
```

---

## ⚪ Low Priority (Future Improvements)

### 6. Refactor Monolithic index.ts
**Priority:** P3
**Effort:** 4-8 hours

Split 2,062-line file into modules:
```
src/
├── index.ts           (50 lines)
├── types.ts
├── executor.ts
├── mappers.ts
├── schemas.ts
└── tools/
    ├── tasks.ts
    ├── projects.ts
    ├── tags.ts
    └── search.ts
```

---

### 7. Increase Test Coverage
**Priority:** P3
**Effort:** Ongoing

**Current:** 13.87% line coverage
**Target:** 80%+

**Focus Areas:**
1. Tool handler functions (currently not tested)
2. Edge cases and error paths
3. Mapper functions
4. Input validation

---

### 8. Create README.md
**Priority:** P3
**Effort:** 1-2 hours

**Required Sections:**
- Installation
- Configuration
- Usage Examples
- API Documentation
- Troubleshooting

---

## Summary

### Must Fix Before Merge (15 minutes)
1. ✅ Fix TypeScript build errors (5 min)
2. ✅ Address placeholder tests (10 min - Option A)

### Should Fix Before Merge (30 minutes)
3. ✅ Clean up old test files (2 min)
4. ✅ Update documentation (30 min)

### Can Fix After Merge
5. ⏭️ Add input sanitization
6. ⏭️ Refactor monolithic file
7. ⏭️ Increase test coverage
8. ⏭️ Create README.md

---

## Quick Fix Script

Run this to fix critical issues:

```bash
#!/bin/bash
set -e

echo "Fixing TypeScript build errors..."
# Add nextReviewDate to ProjectData mocks
# (Manual edit required - see above)

echo "Cleaning up old test files..."
rm -rf dist/__tests__/mappers.test.js
rm -rf dist/__tests__/schemas.test.js
rm -rf dist/__tests__/script-executor.test.js

echo "Rebuilding..."
npm run build

echo "Running tests..."
npm test

echo "✅ All critical fixes applied!"
```

---

## Decision Log

| Decision | Status | Notes |
|----------|--------|-------|
| Fix build errors | ✅ Required | Blocking merge |
| Placeholder tests | ⏳ Pending | Choose Option A or B |
| Clean dist files | ✅ Required | Simple cleanup |
| Update docs | 📋 Optional | Can be separate PR |
| Add sanitization | 📋 Optional | Security enhancement |

---

**Last Updated:** 2026-01-29
**Review Status:** Conditional Approval - Fix critical items
