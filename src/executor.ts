/**
 * JXA Script Executor
 *
 * Executes JavaScript for Automation scripts via osascript to interact
 * with OmniFocus. Extracted into its own module to enable test mocking.
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Executes JXA (JavaScript for Automation) to interact with OmniFocus.
 * Note: doc.evaluate() for Omni Automation doesn't work from JXA due to type
 * conversion issues (-1700). We use direct JXA property access instead.
 */
export async function executeOmniFocusScript(script: string): Promise<string> {
  // The script is pure JXA - properties are accessed as methods: obj.name()
  // No escaping needed here: the template literal interpolation is evaluated by
  // Node.js at runtime (not re-parsed), and the script is written to a temp file
  // (not passed as a shell argument). User input is already escaped by sanitizeInput().
  const jxaScript = `
    const app = Application("OmniFocus");
    const doc = app.defaultDocument();
    ${script}
  `;

  // Write to temp file to avoid shell escaping issues
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');

  const tmpFile = path.join(os.tmpdir(), `omnifocus-script-${Date.now()}.js`);
  await fs.writeFile(tmpFile, jxaScript, 'utf8');

  try {
    const { stdout, stderr } = await execAsync(
      `osascript -l JavaScript "${tmpFile}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    await fs.unlink(tmpFile).catch(() => {});

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    return stdout.trim();
  } catch (error: unknown) {
    await fs.unlink(tmpFile).catch(() => {});

    if (error instanceof Error) {
      if (error.message.includes("is not running")) {
        throw new Error("OmniFocus is not running. Please launch OmniFocus first.");
      }
      if (error.message.includes("not allowed") || error.message.includes("niet toegestaan")) {
        throw new Error("Script access to OmniFocus is not allowed. Enable automation permissions in System Preferences > Security & Privacy > Privacy > Automation.");
      }
      throw new Error(`OmniFocus script error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Executes a script and parses the JSON result
 */
export async function executeAndParseJSON<T>(script: string): Promise<T> {
  const result = await executeOmniFocusScript(script);
  try {
    return JSON.parse(result) as T;
  } catch {
    throw new Error(`Failed to parse OmniFocus response: ${result}`);
  }
}
