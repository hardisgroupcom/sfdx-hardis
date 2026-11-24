import { spawn } from 'child_process';

// Runs a command that handles secrets: git credential fill, gh auth token, glab auth status
// --show-token, az account get-access-token. It does not go through execCommand() of index.ts,
// which cannot do what these commands need: display nothing of the command or of its output
// (they print a token), feed their standard input instead of a command line, and keep the
// command from asking anything by itself (closed standard input, no terminal). Never blocks the
// event loop: a command panel waiting on the WebSocket keeps being answered while it runs.

export interface SilentCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Written to the standard input, which is then closed */
  input?: string;
  timeoutMs?: number;
}

export interface SilentCommandResult {
  /** Exit code, 1 when the command could not start or timed out */
  status: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 30000;
// The arguments of a .cmd or .bat file go through cmd.exe: only plain words are let through
const SAFE_SHELL_ARGUMENT = /^[\w.:/@=-]+$/;

export function runSilentCommand(executable: string, args: string[], options: SilentCommandOptions = {}): Promise<SilentCommandResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnSilent(executable, args, options);
    } catch {
      resolve({ status: 1, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (status: number) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      settle(1);
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout?.on('data', (data) => (stdout += data));
    child.stderr?.on('data', (data) => (stderr += data));
    child.on('error', () => settle(1));
    child.on('close', (code) => settle(code ?? 1));
    // A command that exits before reading its input must not crash the process
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(options.input || '');
  });
}

// Node refuses to start a .cmd or .bat file without a shell (CVE-2024-27980): the Azure CLI is
// az.cmd on Windows. The path is quoted and the arguments are checked, so cmd.exe reads nothing
// else than what is written here.
function spawnSilent(executable: string, args: string[], options: SilentCommandOptions): ReturnType<typeof spawn> {
  const spawnOptions = { cwd: options.cwd, env: options.env || process.env, windowsHide: true };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const unsafe = args.find((arg) => !SAFE_SHELL_ARGUMENT.test(arg));
    if (unsafe !== undefined || executable.includes('"')) {
      throw new Error('Refused argument for a command run through cmd.exe');
    }
    return spawn(`"${executable}" ${args.join(' ')}`, [], { ...spawnOptions, shell: true });
  }
  return spawn(executable, args, spawnOptions);
}
