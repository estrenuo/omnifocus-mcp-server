/**
 * Unit tests for the JXA executor.
 *
 * child_process.exec is mocked so no osascript / OmniFocus is ever invoked.
 * These cover the success path, the stderr-only path, the friendly error
 * translations, non-Error rejections, and JSON parsing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'child_process';
import { executeOmniFocusScript, executeAndParseJSON } from '../executor.js';

// promisify(exec) without exec[promisify.custom] resolves with the single value
// passed after the error arg, so we hand it a { stdout, stderr } object.
function onExec(cb: (callback: (err: unknown, value?: unknown) => void) => void) {
  vi.mocked(exec).mockImplementation(((...args: unknown[]) => {
    const callback = args[args.length - 1] as (err: unknown, value?: unknown) => void;
    cb(callback);
    return {} as never;
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeOmniFocusScript', () => {
  it('returns trimmed stdout on success', async () => {
    onExec(cb => cb(null, { stdout: '  {"ok":true}  \n', stderr: '' }));

    const result = await executeOmniFocusScript('return 1;');
    expect(result).toBe('{"ok":true}');
  });

  it('wraps the JXA script with the OmniFocus app/doc preamble', async () => {
    onExec(cb => cb(null, { stdout: 'x', stderr: '' }));

    await executeOmniFocusScript('MY_UNIQUE_MARKER');

    // The temp file path is passed to osascript; we can only assert exec was
    // invoked with an osascript command referencing a temp script file.
    const call = vi.mocked(exec).mock.calls[0];
    expect(String(call[0])).toContain('osascript -l JavaScript');
    expect(String(call[0])).toContain('omnifocus-script-');
  });

  it('throws stderr content when there is no stdout', async () => {
    onExec(cb => cb(null, { stdout: '', stderr: 'boom from stderr' }));

    await expect(executeOmniFocusScript('x')).rejects.toThrow('OmniFocus script error: boom from stderr');
  });

  it('translates "is not running" into a friendly message', async () => {
    onExec(cb => cb(new Error('The application is not running.')));

    await expect(executeOmniFocusScript('x')).rejects.toThrow('OmniFocus is not running. Please launch OmniFocus first.');
  });

  it('translates "not allowed" into an automation-permissions message', async () => {
    onExec(cb => cb(new Error('execution error: not allowed')));

    await expect(executeOmniFocusScript('x')).rejects.toThrow('automation permissions');
  });

  it('translates the Dutch "niet toegestaan" into the permissions message', async () => {
    onExec(cb => cb(new Error('Toegang niet toegestaan')));

    await expect(executeOmniFocusScript('x')).rejects.toThrow('automation permissions');
  });

  it('wraps a generic error message', async () => {
    onExec(cb => cb(new Error('something odd')));

    await expect(executeOmniFocusScript('x')).rejects.toThrow('OmniFocus script error: something odd');
  });

  it('re-throws a non-Error rejection unchanged', async () => {
    onExec(cb => cb('plain string failure'));

    await expect(executeOmniFocusScript('x')).rejects.toBe('plain string failure');
  });
});

describe('executeAndParseJSON', () => {
  it('parses valid JSON output', async () => {
    onExec(cb => cb(null, { stdout: '{"a":1,"b":[2,3]}', stderr: '' }));

    const result = await executeAndParseJSON<{ a: number; b: number[] }>('x');
    expect(result).toEqual({ a: 1, b: [2, 3] });
  });

  it('throws a descriptive error when output is not JSON', async () => {
    onExec(cb => cb(null, { stdout: 'not json at all', stderr: '' }));

    await expect(executeAndParseJSON('x')).rejects.toThrow('Failed to parse OmniFocus response: not json at all');
  });
});
