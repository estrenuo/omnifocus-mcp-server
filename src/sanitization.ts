// ============================================================================
// Input Sanitization - Security Layer
// ============================================================================

/**
 * Sanitizes user input to prevent JXA injection attacks.
 *
 * Security measures:
 * 1. Length validation to prevent DoS
 * 2. Pattern detection for dangerous code constructs
 * 3. Proper escaping of special characters
 *
 * @param input - The user-provided string to sanitize
 * @param maxLength - Maximum allowed length (default: 500)
 * @returns Sanitized and escaped string safe for JXA execution
 * @throws Error if input is invalid or contains dangerous patterns
 */
export function sanitizeInput(input: string, maxLength: number = 500): string {
  // 1. Type validation
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }

  // 2. Length validation (prevent DoS attacks)
  if (input.length > maxLength) {
    throw new Error(`Input exceeds maximum length of ${maxLength} characters`);
  }

  // 3. Check for potentially dangerous patterns that could lead to code injection
  const dangerousPatterns: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /\$\{/, description: 'template literal injection' },
    { pattern: /eval\s*\(/i, description: 'eval() function call' },
    { pattern: /Function\s*\(/i, description: 'Function() constructor' },
    { pattern: /require\s*\(/i, description: 'require() function call' },
    { pattern: /import\s+/i, description: 'import statement' },
    { pattern: /\.constructor/i, description: 'constructor access' },
    { pattern: /__proto__/, description: 'prototype pollution' },
    { pattern: /\bexec\s*\(/i, description: 'exec() function call' },
    { pattern: /\bspawn\s*\(/i, description: 'spawn() function call' },
    { pattern: /process\./i, description: 'process object access' },
    { pattern: /global\./i, description: 'global object access' },
  ];

  for (const { pattern, description } of dangerousPatterns) {
    if (pattern.test(input)) {
      throw new Error(`Input contains potentially unsafe pattern: ${description}`);
    }
  }

  // 4. Check for excessive control characters that could cause issues.
  // Excludes tab (0x09), newline (0x0A) and carriage return (0x0D) — these are
  // legitimate text-formatting characters in notes and should be allowed.
  const controlCharCount = (input.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g) || []).length;
  if (controlCharCount > 10) {
    throw new Error('Input contains excessive control characters');
  }

  // 5. Escape special characters for safe JXA string interpolation
  // Order matters: backslash must be first!
  return input
    .replace(/\\/g, '\\\\')    // Backslash
    .replace(/"/g, '\\"')       // Double quotes
    .replace(/'/g, "\\'")       // Single quotes
    .replace(/`/g, '\\`')       // Backticks
    .replace(/\$/g, '\\$')      // Dollar signs
    .replace(/\n/g, '\\n')      // Newlines
    .replace(/\r/g, '\\r')      // Carriage returns
    .replace(/\t/g, '\\t')      // Tabs
    .replace(/\0/g, '\\0');     // Null bytes
}

/**
 * Validates and sanitizes an array of strings.
 *
 * @param items - Array of strings to sanitize
 * @param maxLength - Maximum allowed length per item
 * @param maxItems - Maximum number of items allowed
 * @returns Array of sanitized strings
 * @throws Error if validation fails
 */
export function sanitizeArray(
  items: string[],
  maxLength: number = 500,
  maxItems: number = 100
): string[] {
  if (!Array.isArray(items)) {
    throw new Error('Input must be an array');
  }

  if (items.length > maxItems) {
    throw new Error(`Array exceeds maximum length of ${maxItems} items`);
  }

  return items.map(item => sanitizeInput(item, maxLength));
}
