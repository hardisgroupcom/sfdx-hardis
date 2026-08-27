// Opens a URL or a file with the default application of the operating system.
// Replaces the `open` package with a direct call to the platform launcher.
import { spawn } from 'child_process';
import * as os from 'os';

export interface OpenOptions {
  /** Wait for the launched process to exit before resolving. Best effort: browsers usually
   * hand the URL to an already running instance and exit immediately. */
  wait?: boolean;
}

export interface Launcher {
  command: string;
  args: string[];
}

function isWsl(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    return /microsoft/i.test(os.release());
  } catch {
    return false;
  }
}

/** Builds the launcher command for a target on the given platform. Exported for unit tests. */
export function buildLauncher(target: string, platform: NodeJS.Platform = process.platform, wsl: boolean = isWsl()): Launcher {
  if (platform === 'win32') {
    // "start" is a cmd.exe builtin: the first quoted argument is the window title.
    // The target is passed inside double quotes, where cmd.exe already treats & as a
    // literal: escaping it as ^& would put the caret itself in the opened URL.
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', `start "" "${target}"`] };
  }
  if (platform === 'darwin') {
    return { command: 'open', args: [target] };
  }
  if (wsl) {
    // Uses the Windows host browser: wslview (wslu) when available, else powershell
    const script = 'if command -v wslview >/dev/null 2>&1; then wslview "$0"; else powershell.exe -NoProfile -Command "Start-Process \'$0\'"; fi';
    return { command: 'sh', args: ['-c', script, target] };
  }
  return { command: 'xdg-open', args: [target] };
}

/**
 * Opens a URL or a file path with the default application.
 * Rejects only when the launcher itself cannot be spawned.
 */
export async function open(target: string, options: OpenOptions = {}): Promise<void> {
  const { command, args } = buildLauncher(target);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: !options.wait,
      stdio: 'ignore',
      windowsHide: true,
      // cmd.exe must receive the "start" command line untouched
      windowsVerbatimArguments: process.platform === 'win32',
    });
    child.once('error', reject);
    if (options.wait) {
      child.once('exit', () => resolve());
    } else {
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    }
  });
}
