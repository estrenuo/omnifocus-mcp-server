/**
 * Schema-drift guard.
 *
 * Makes silent drift loud: for every tool, each field declared in its Zod input
 * schema must (a) be read from `params` by the handler and (b) be documented in
 * the tool's description. If a schema gains a field that the handler ignores, or
 * that the description never mentions, this test fails.
 *
 * The check is source-based on purpose: it compares the compiled Zod shapes
 * against the exact text of each registerTool() block.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as schemas from '../schemas.js';

const TOOL_FILES = ['tasks', 'projects', 'folders', 'tags', 'reviews', 'perspectives', 'search'];

interface ToolBlock {
  schemaName: string;
  schemaKeys: string[];
  documented: string[];
  destructured: string[];
}

function collectToolBlocks(): ToolBlock[] {
  const blocks: ToolBlock[] = [];
  for (const file of TOOL_FILES) {
    const src = readFileSync(new URL(`../tools/${file}.ts`, import.meta.url), 'utf8');
    for (const raw of src.split('server.registerTool(').slice(1)) {
      const schemaMatch = raw.match(/inputSchema:\s*(\w+InputSchema)/);
      if (!schemaMatch) continue;
      const schemaName = schemaMatch[1];
      const schema = (schemas as Record<string, { shape?: Record<string, unknown> }>)[schemaName];
      const shape = schema?.shape;
      if (!shape) continue;

      const idx = raw.indexOf('inputSchema:');
      const descPart = raw.slice(0, idx); // description lives before inputSchema
      const handlerPart = raw.slice(idx); // handler + its destructure live after

      // Documented params: "- name (" or "- name:" bullets in the description.
      const documented = [...descPart.matchAll(/^\s*-\s+([a-zA-Z][a-zA-Z0-9]*)\s*[(:]/gm)].map((m) => m[1]);

      // Handler destructure: the single `const { ... } = params;` in this block.
      const destr = handlerPart.match(/const\s*\{([^}]*)\}\s*=\s*params;/);
      const destructured = destr
        ? destr[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean)
        : [];

      blocks.push({ schemaName, schemaKeys: Object.keys(shape), documented, destructured });
    }
  }
  return blocks;
}

const blocks = collectToolBlocks();

describe('schema/handler/description parity (no silent drift)', () => {
  it('discovers every registered tool schema', () => {
    // Guard against the parser silently matching nothing.
    expect(blocks.length).toBeGreaterThanOrEqual(25);
  });

  for (const b of blocks) {
    it(`${b.schemaName}: every schema field is read by the handler`, () => {
      const ignored = b.schemaKeys.filter((k) => !b.destructured.includes(k));
      expect(ignored, `handler ignores declared field(s): ${ignored.join(', ')}`).toEqual([]);
    });

    it(`${b.schemaName}: every schema field is documented in the description`, () => {
      const undocumented = b.schemaKeys.filter((k) => !b.documented.includes(k));
      expect(undocumented, `undocumented field(s): ${undocumented.join(', ')}`).toEqual([]);
    });
  }
});
