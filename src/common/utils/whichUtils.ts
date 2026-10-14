// Locates an executable in PATH. Replaces the `which` package.
import fs from './fsUtils.js';
import * as path from 'path';

export interface WhichOptions {
  /** Return null instead of throwing when the executable is not found. */
  nothrow?: boolean;
  /** Override PATH (mainly for tests). */
  path?: string;
  /** Override PATHEXT on Windows (mainly for tests). */
  pathExt?: string;
  /** Override the platform check (mainly for tests). */
  windows?: boolean;
}

function candidateNames(command: string, pathExt: string, windows: boolean): string[] {
  if (!windows) {
    return [command];
  }
  const extensions = pathExt
    .split(';')
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0);
  const lower = command.toLowerCase();
  // A command given with an executable extension is tried as-is first
  const names = extensions.some((ext) => lower.endsWith(ext.toLowerCase())) ? [command] : [];
  for (const ext of extensions) {
    names.push(command + ext);
  }
  return names;
}

function isExecutableFile(filePath: string, windows: boolean): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    if (windows) {
      return true;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Synchronous lookup of an executable in PATH. */
export function whichSync(command: string, options: WhichOptions = {}): string | null {
  const windows = options.windows ?? process.platform === 'win32';
  const pathEnv = options.path ?? process.env.PATH ?? process.env.Path ?? '';
  const pathExt = options.pathExt ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM';
  const names = candidateNames(command, pathExt, windows);
  const hasSeparator = /[\\/]/.test(command);
  // An explicit path (containing a separator) is only checked as given
  const directories = hasSeparator ? [''] : pathEnv.split(path.delimiter).filter((dir) => dir.length > 0);
  if (windows && !hasSeparator) {
    directories.unshift(process.cwd());
  }
  for (const directory of directories) {
    for (const name of names) {
      const candidate = directory === '' ? name : path.join(directory.replace(/^"|"$/g, ''), name);
      if (isExecutableFile(candidate, windows)) {
        return candidate;
      }
    }
  }
  if (options.nothrow) {
    return null;
  }
  throw new Error(`not found: ${command}`);
}

/** Asynchronous lookup of an executable in PATH (same contract as the `which` package). */
export async function which(command: string, options: WhichOptions = {}): Promise<string | null> {
  return whichSync(command, options);
}
