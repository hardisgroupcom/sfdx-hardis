import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/*
Git credentials kept by git itself.

sfdx-hardis used to write the username and the token a user typed in the remote URL, in clear
text in .git/config. They now go to git's credential helper, the way git stores what it asks
itself: Windows Credential Manager, the macOS Keychain, libsecret or Git Credential Manager on
Linux. They are asked once, and every later git command finds them.

Two rules run through this file:
- Nothing stays unless it worked. Whatever is written on the way (a helper in the git
  configuration, credentials in a helper, a pinned user name) is undone when the credentials
  cannot be stored, and can be undone by the caller when the remote refuses them.
- What works today is left alone. Credentials already stored are put back when the new ones are
  refused, and a helper is only added to a configuration, never replaced.
*/

export interface GitCredentials {
  /** Remote URL, without credentials */
  url: string;
  username: string;
  password: string;
}

export type GitCredentialsStoreError = 'lineBreak' | 'noHelperKept';

export interface GitCredentialsStoreResult {
  stored: boolean;
  /** The helper that keeps the credentials */
  helper: string;
  /** Where a helper was configured to get there, or null when the existing configuration was enough */
  configuredScope: 'global' | 'local' | null;
  /** Why nothing could be stored */
  error?: GitCredentialsStoreError;
  /**
   * Undoes everything the store changed: the credentials (the ones that were stored before come
   * back, or the new ones are removed) and the git configuration. For when the remote refuses them.
   */
  undo: () => Promise<void>;
}

/** The parts of the platform a helper is chosen from, replaceable in unit tests */
export interface GitCredentialHelperProbes {
  platform: NodeJS.Platform;
  /** Whether Git Credential Manager is installed */
  hasManager: () => Promise<boolean>;
  /** Whether git ships the helper git-credential-<name> */
  hasBundledHelper: (name: string) => Promise<boolean>;
}

export interface GitCredentialsStoreOptions {
  /** A helper forced by the user: the only one tried when nothing configured keeps the credentials */
  forcedHelper?: string;
  /** The helpers to try, the most protected first. Computed from the platform when not given. */
  candidates?: string[];
  probes?: GitCredentialHelperProbes;
}

const GIT_CREDENTIAL_TIMEOUT_MS = 30000;

/**
 * Stores credentials in git's credential helper, and checks git will read them back.
 * Adds a helper to the git configuration when the configured ones, if any, keep nothing.
 */
export async function storeGitCredentials(
  credentials: GitCredentials,
  cwd: string,
  options: GitCredentialsStoreOptions = {}
): Promise<GitCredentialsStoreResult> {
  const failure = (error: GitCredentialsStoreError): GitCredentialsStoreResult => ({
    stored: false,
    helper: '',
    configuredScope: null,
    error,
    undo: async () => undefined,
  });
  if ([credentials.url, credentials.username, credentials.password].some((value) => /[\n\r\0]/.test(value))) {
    return failure('lineBreak');
  }
  // What a helper already holds for this user: put back if the new credentials are refused
  const previous = await readStoredGitCredentials(credentials.url, cwd, credentials.username);
  const undoCredentials = async () => {
    if (previous) {
      await runGitCredentialCommand(['credential', 'approve'], cwd, buildGitCredentialInput({ ...credentials, ...previous }));
    } else {
      await forgetGitCredentials(credentials, cwd);
    }
  };
  const success = async (helper: string, configuredScope: 'global' | 'local' | null, undoHelper: () => Promise<void>) => {
    const undoPin = await pinUserNameWhenAnotherAccountAnswers(credentials, cwd);
    return {
      stored: true,
      helper,
      configuredScope,
      undo: async () => {
        await undoCredentials();
        await undoPin();
        await undoHelper();
      },
    };
  };

  const configured = await listGitCredentialHelpers(credentials.url, cwd);
  if (configured.length > 0) {
    if (await approveAndVerify(credentials, cwd)) {
      return success(configured.join(', '), null, async () => undefined);
    }
    // A helper may have taken them without giving them back (it answers with another account)
    await undoCredentials();
  }

  const candidates =
    options.candidates ?? (options.forcedHelper ? [options.forcedHelper] : await listCandidateGitCredentialHelpers(options.probes));
  for (const helper of candidates) {
    if (configured.includes(helper)) {
      continue;
    }
    for (const scope of listScopesForHelper(helper, configured.length > 0)) {
      const added = await runGitCredentialCommand(['config', `--${scope}`, '--add', 'credential.helper', helper], cwd);
      if (added.status !== 0) {
        // A configuration that cannot be written (no home folder, a managed file): next scope
        continue;
      }
      const undoHelper = async () => {
        await runGitCredentialCommand(['config', `--${scope}`, '--unset', 'credential.helper', `^${escapeRegExp(helper)}$`], cwd);
      };
      if (await approveAndVerify(credentials, cwd)) {
        return success(helper, scope, undoHelper);
      }
      await undoCredentials();
      await undoHelper();
    }
  }
  return failure('noHelperKept');
}

/** Removes credentials from git's credential helper */
export async function forgetGitCredentials(credentials: GitCredentials, cwd: string): Promise<void> {
  await runGitCredentialCommand(['credential', 'reject'], cwd, buildGitCredentialInput(credentials));
}

/**
 * The credentials git's helpers hold for a URL, or null. Never asks anything.
 * With a user name, the ones of that user; without, the ones git would send by default.
 */
export async function readStoredGitCredentials(
  url: string,
  cwd: string,
  username?: string
): Promise<{ username: string; password: string } | null> {
  // core.askPass is emptied too: fill would otherwise ask through it when nothing is stored
  const filled = await runGitCredentialCommand(
    ['-c', 'core.askPass=', 'credential', 'fill'],
    cwd,
    buildGitCredentialInput({ url, username })
  );
  if (filled.status !== 0) {
    return null;
  }
  const values = parseGitCredentialOutput(filled.stdout);
  return values.username && values.password ? { username: values.username, password: values.password } : null;
}

/** What git's credential commands read on their standard input */
export function buildGitCredentialInput(credentials: { url: string; username?: string; password?: string }): string {
  const lines = [`url=${credentials.url}`];
  if (credentials.username) {
    lines.push(`username=${credentials.username}`);
  }
  if (credentials.password) {
    lines.push(`password=${credentials.password}`);
  }
  return lines.join('\n') + '\n\n';
}

/** key=value lines, as git credential fill prints them */
export function parseGitCredentialOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      values[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return values;
}

/**
 * The credential helpers git would use for a URL in a folder: the general ones
 * (credential.helper), where an empty entry resets the ones before it, and the one scoped to
 * the URL (credential.<url>.helper, what `gh auth setup-git` writes).
 */
export async function listGitCredentialHelpers(url: string, cwd: string): Promise<string[]> {
  const helpers: string[] = [];
  const general = await runGitCredentialCommand(['config', '--get-all', 'credential.helper'], cwd);
  if (general.status === 0) {
    const entries = general.stdout.split(/\r?\n/).map((helper) => helper.trim());
    // The trailing line break of the output is not an entry
    if (entries[entries.length - 1] === '') {
      entries.pop();
    }
    helpers.push(...entries.slice(entries.lastIndexOf('') + 1));
  }
  const scoped = await runGitCredentialCommand(['config', '--get-urlmatch', 'credential.helper', url], cwd);
  const scopedHelper = scoped.status === 0 ? scoped.stdout.trim() : '';
  if (scopedHelper !== '' && !helpers.includes(scopedHelper)) {
    helpers.push(scopedHelper);
  }
  return helpers;
}

/**
 * The helpers worth configuring on a platform, the most protected first. git's own file comes
 * last everywhere: it is in clear text in the user's home, and it always works.
 */
export async function listCandidateGitCredentialHelpers(
  probes: GitCredentialHelperProbes = defaultGitCredentialHelperProbes()
): Promise<string[]> {
  const candidates: string[] = [];
  if (probes.platform === 'darwin' && (await probes.hasBundledHelper('osxkeychain'))) {
    candidates.push('osxkeychain');
  }
  if (probes.platform === 'linux' && (await probes.hasBundledHelper('libsecret'))) {
    candidates.push('libsecret');
  }
  if (await probes.hasManager()) {
    candidates.push('manager');
  }
  // A Git for Windows installed without Git Credential Manager still ships this one
  if (probes.platform === 'win32' && (await probes.hasBundledHelper('wincred'))) {
    candidates.push('wincred');
  }
  candidates.push('store');
  return candidates;
}

function defaultGitCredentialHelperProbes(): GitCredentialHelperProbes {
  return {
    platform: process.platform,
    hasManager: async () => (await runGitCredentialCommand(['credential-manager', '--version'], process.cwd())).status === 0,
    hasBundledHelper: async (name: string) => {
      const execPath = (await runGitCredentialCommand(['--exec-path'], process.cwd())).stdout.trim();
      const file = `git-credential-${name}${process.platform === 'win32' ? '.exe' : ''}`;
      return execPath !== '' && fs.existsSync(path.join(execPath, file));
    },
  };
}

// Where a helper may be added. A protected store is safe to give to the whole machine when it
// has none, and it is what asks the credentials once for every repository. The clear text file
// of git stays in the repository that needed it, and so does anything added next to helpers the
// user already configured.
function listScopesForHelper(helper: string, helpersAlreadyConfigured: boolean): Array<'global' | 'local'> {
  return helper === 'store' || helpersAlreadyConfigured ? ['local'] : ['global', 'local'];
}

// A helper can accept credentials and keep nothing: only reading them back tells
async function approveAndVerify(credentials: GitCredentials, cwd: string): Promise<boolean> {
  const approved = await runGitCredentialCommand(['credential', 'approve'], cwd, buildGitCredentialInput(credentials));
  if (approved.status !== 0) {
    return false;
  }
  const stored = await readStoredGitCredentials(credentials.url, cwd, credentials.username);
  return stored?.username === credentials.username && stored?.password === credentials.password;
}

// A helper holding several accounts for a host answers with the one it likes when git names no
// user. The user who just typed credentials is then named in the repository configuration
// (credential.<host>.username), so git asks for theirs. Returns how to undo it.
async function pinUserNameWhenAnotherAccountAnswers(credentials: GitCredentials, cwd: string): Promise<() => Promise<void>> {
  const byDefault = await readStoredGitCredentials(credentials.url, cwd);
  if (!byDefault || byDefault.username === credentials.username) {
    return async () => undefined;
  }
  const key = `credential.${new URL(credentials.url).origin}.username`;
  const before = await runGitCredentialCommand(['config', '--local', '--get', key], cwd);
  const pinned = await runGitCredentialCommand(['config', '--local', key, credentials.username], cwd);
  if (pinned.status !== 0) {
    return async () => undefined;
  }
  return async () => {
    if (before.status === 0) {
      await runGitCredentialCommand(['config', '--local', key, before.stdout.trim()], cwd);
    } else {
      await runGitCredentialCommand(['config', '--local', '--unset', key], cwd);
    }
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// git, for the credential commands only. It does not go through git() or execCommand() of
// index.ts, which cannot do what these commands need: feed their standard input (where the
// token goes, never on a command line), display nothing of the command or of its output (git
// credential fill prints the password), and keep git from asking anything by itself (a helper
// left to itself opens a window or waits on a terminal). Never blocks the event loop: a command
// panel waiting on the WebSocket keeps being answered while a helper works.
function runGitCredentialCommand(args: string[], cwd: string, input?: string): Promise<{ status: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  return new Promise((resolve) => {
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
    const child = spawn('git', args, { cwd, env, windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      settle(1);
    }, GIT_CREDENTIAL_TIMEOUT_MS);
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    child.on('error', () => settle(1));
    child.on('close', (code) => settle(code ?? 1));
    // A git that exits before reading its input must not crash the process
    child.stdin.on('error', () => undefined);
    child.stdin.end(input || '');
  });
}
