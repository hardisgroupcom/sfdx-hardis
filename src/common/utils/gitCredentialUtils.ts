import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/*
Git credentials kept by git itself.

sfdx-hardis used to write the username and the token a user typed in the remote URL, in clear
text in .git/config. They now go to git's credential helper, the way git stores what it asks
itself: Windows Credential Manager, the macOS Keychain, libsecret or Git Credential Manager on
Linux. They are asked once, and every git command of the machine finds them afterwards.

When no helper is configured, one is: without it nothing would be kept, and the same questions
would come back at every command.
*/

export interface GitCredentials {
  /** Remote URL, without credentials */
  url: string;
  username: string;
  password: string;
}

export interface GitCredentialsStoreResult {
  stored: boolean;
  /** The helper that keeps the credentials */
  helper: string;
  /** Where a helper was configured to get there, or null when the existing configuration was enough */
  configuredScope: 'global' | 'local' | null;
  /** Why nothing could be stored */
  error?: string;
}

/** The parts of the platform a helper is chosen from, replaceable in unit tests */
export interface GitCredentialHelperProbes {
  platform: NodeJS.Platform;
  /** A helper forced by the user (SFDX_HARDIS_GIT_CREDENTIAL_HELPER) */
  forcedHelper?: string;
  /** Whether Git Credential Manager is installed */
  hasManager: () => boolean;
  /** Whether git ships the helper git-credential-<name> */
  hasBundledHelper: (name: string) => boolean;
}

const GIT_CREDENTIAL_TIMEOUT_MS = 30000;

/**
 * Stores credentials in git's credential helper, and checks they can be read back.
 * Configures a helper when none is, or when the configured ones keep nothing.
 */
export function storeGitCredentials(
  credentials: GitCredentials,
  cwd: string,
  probes: GitCredentialHelperProbes = defaultGitCredentialHelperProbes()
): GitCredentialsStoreResult {
  if ([credentials.url, credentials.username, credentials.password].some((value) => /[\n\r\0]/.test(value))) {
    return { stored: false, helper: '', configuredScope: null, error: 'A line break is not allowed in git credentials' };
  }
  const configured = listGitCredentialHelpers(cwd);
  if (configured.length > 0 && approveAndVerify(credentials, cwd)) {
    return { stored: true, helper: configured.join(', '), configuredScope: null };
  }
  let lastError = '';
  if (configured.length > 0) {
    // Helpers are configured and none of them kept the credentials (a Git Credential Manager
    // without a store on Linux, a cache that is not running): git's own file is added for
    // this repository, the existing configuration is left as it is
    const added = runGit(['config', '--local', '--add', 'credential.helper', 'store'], cwd);
    if (added.status === 0 && approveAndVerify(credentials, cwd)) {
      return { stored: true, helper: 'store', configuredScope: 'local' };
    }
    lastError = added.stderr;
  } else {
    // No helper at all: the user's git gets one, so every repository of the machine has it
    for (const helper of listCandidateGitCredentialHelpers(probes)) {
      const set = runGit(['config', '--global', 'credential.helper', helper], cwd);
      if (set.status === 0 && approveAndVerify(credentials, cwd)) {
        return { stored: true, helper, configuredScope: 'global' };
      }
      lastError = set.stderr;
    }
  }
  return {
    stored: false,
    helper: '',
    configuredScope: null,
    error: lastError.trim() || 'No git credential helper could keep the credentials',
  };
}

/** Removes credentials from git's credential helper: the remote refused them. */
export function forgetGitCredentials(credentials: GitCredentials, cwd: string): void {
  runGit(['credential', 'reject'], cwd, buildGitCredentialInput(credentials));
}

/** The credentials git's helper holds for a URL, or null. Never asks anything. */
export function readStoredGitCredentials(url: string, cwd: string): { username: string; password: string } | null {
  // core.askPass is emptied too: fill would otherwise ask through it when nothing is stored
  const filled = runGit(['-c', 'core.askPass=', 'credential', 'fill'], cwd, buildGitCredentialInput({ url }));
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

/** The credential helpers git would use in a folder. An empty entry resets the ones before it. */
export function listGitCredentialHelpers(cwd: string): string[] {
  const configured = runGit(['config', '--get-all', 'credential.helper'], cwd);
  if (configured.status !== 0) {
    return [];
  }
  const helpers = configured.stdout.split(/\r?\n/).map((helper) => helper.trim());
  // The trailing line break of the output is not an entry
  if (helpers[helpers.length - 1] === '') {
    helpers.pop();
  }
  return helpers.slice(helpers.lastIndexOf('') + 1);
}

/**
 * The helpers worth configuring on a platform, the most protected first. git's own file comes
 * last everywhere: it is in clear text in the user's home, and it always works.
 */
export function listCandidateGitCredentialHelpers(probes: GitCredentialHelperProbes): string[] {
  if (probes.forcedHelper) {
    return [probes.forcedHelper];
  }
  const candidates: string[] = [];
  if (probes.platform === 'darwin' && probes.hasBundledHelper('osxkeychain')) {
    candidates.push('osxkeychain');
  }
  if (probes.platform === 'linux' && probes.hasBundledHelper('libsecret')) {
    candidates.push('libsecret');
  }
  if (probes.hasManager()) {
    candidates.push('manager');
  }
  candidates.push('store');
  return candidates;
}

function defaultGitCredentialHelperProbes(): GitCredentialHelperProbes {
  return {
    platform: process.platform,
    forcedHelper: process.env.SFDX_HARDIS_GIT_CREDENTIAL_HELPER || undefined,
    hasManager: () => runGit(['credential-manager', '--version'], process.cwd()).status === 0,
    hasBundledHelper: (name: string) => {
      const execPath = runGit(['--exec-path'], process.cwd()).stdout.trim();
      const file = `git-credential-${name}${process.platform === 'win32' ? '.exe' : ''}`;
      return execPath !== '' && fs.existsSync(path.join(execPath, file));
    },
  };
}

// A helper can accept credentials and keep nothing: only reading them back tells
function approveAndVerify(credentials: GitCredentials, cwd: string): boolean {
  const approved = runGit(['credential', 'approve'], cwd, buildGitCredentialInput(credentials));
  if (approved.status !== 0) {
    return false;
  }
  const stored = readStoredGitCredentials(credentials.url, cwd);
  return stored?.username === credentials.username && stored?.password === credentials.password;
}

// git, without anything of it displayed and without it asking anything: its input and its output
// hold credentials, and a helper left to itself would open a window or wait on a terminal
function runGit(args: string[], cwd: string, input?: string): { status: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  const result = spawnSync('git', args, {
    cwd,
    env,
    input,
    encoding: 'utf8',
    timeout: GIT_CREDENTIAL_TIMEOUT_MS,
    windowsHide: true,
  });
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}
