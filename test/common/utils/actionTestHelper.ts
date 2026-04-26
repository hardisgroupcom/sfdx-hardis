import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

/**
 * Shared test setup: creates a temporary directory, changes cwd into it before
 * each test, and restores + removes it after each test.
 *
 * Usage:
 *   const ctx = setupTmpDir('my-prefix');
 *   // access tmpDir inside tests via ctx.getDir()
 */
export function setupTmpDir(prefix: string): { getDir: () => string } {
  let tmpDir = '';
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
  });

  return { getDir: () => tmpDir };
}
