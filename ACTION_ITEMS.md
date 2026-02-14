# Action Items

## Future Improvements

### 1. Refactor Monolithic index.ts
**Priority:** P3
**Effort:** 4-8 hours

Split 2,176-line `src/index.ts` into modules:
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

### 2. Increase Test Coverage
**Priority:** P3
**Effort:** Ongoing

**Current:** 192 tests passing, but line coverage is well below 80%
**Target:** 80%+

**Focus Areas:**
1. Tool handler functions
2. Edge cases and error paths
3. Mapper functions
4. Input validation

