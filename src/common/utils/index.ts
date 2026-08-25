import c from 'chalk';
import * as child from 'child_process';
import * as crypto from 'crypto';
import { stringifyCsv } from './csvUtils.js';
import fs from './fsUtils.js';
import * as os from 'os';
import * as path from 'path';

import * as util from 'util';
import { which } from './whichUtils.js';
const exec = util.promisify(child.exec);
import { Connection, SfError } from '@salesforce/core';
import { createSpinner } from './spinner.js';
import { tryRunSfCommandInProcess } from './sfCoreCommands.js';
import { simpleGit, FileStatusResult, SimpleGit } from 'simple-git';
import { CONSTANTS, getApiVersion, getApiVersionNumber, getConfig, getReportDirectory, setConfig } from '../../config/index.js';
import { prompts } from './prompts.js';
import { encryptFile } from '../cryptoUtils.js';
import { deployMetadatas, shortenLogLines } from './deployUtils.js';
import { isProductionOrg, promptProfiles, promptUserEmail } from './orgUtils.js';
import { CommandLogLineQuery, LogType, WebSocketClient } from '../websocketClient.js';
import { formatElapsedMs } from './dateHelper.js';
import { buildXmlString, parseXmlString, writeXmlFile } from './xmlUtils.js';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { t } from './i18n.js';

let pluginsStdout: string | null = null;

export { isCI, isAgentMode } from './envUtils.js';
import { isCI, isAgentMode } from './envUtils.js';
import { anonymizeRows, getChannelAnonymizationLevel, getChannelAnonymizationLevelSync } from './anonymizeUtils.js';

export function git(options: any = { output: false, displayCommand: true }): SimpleGit {
  const simpleGitInstance = simpleGit();
  // Hack to be able to display executed git command (and it still doesn't work...)
  // cf: https://github.com/steveukx/git-js/issues/593
  return simpleGitInstance.outputHandler((command, stdout, stderr, gitArgs) => {
    let first = true;
    stdout.on('data', (data) => {
      logCommand();
      if (options.output) {
        uxLog("other", this, c.italic(c.grey(data)));
      }
    });
    stderr.on('data', (data) => {
      logCommand();
      if (options.output) {
        uxLog("other", this, c.italic(c.yellow(data)));
      }
    });
    function logCommand() {
      if (first) {
        first = false;
        const gitArgsStr = (gitArgs || []).join(' ');
        if (!(gitArgsStr.includes('branch -v') || gitArgsStr.includes('config --list --show-origin --null'))) {
          if (options.displayCommand) {
            if (WebSocketClient.isAlive()) {
              WebSocketClient.sendCommandSubCommandStartMessage(
                command + ' ' + gitArgsStr,
                process.cwd(),
                options,
              );
            }
            uxLog("other", this, `[command] ${c.bold(c.bgWhite(c.blue(command + ' ' + gitArgsStr)))}`);
            if (WebSocketClient.isAlive()) {
              WebSocketClient.sendCommandSubCommandEndMessage(
                command + ' ' + gitArgsStr,
                process.cwd(),
                options,
                true,
                '',
              );
            }
          }
        }
      }
    }
  });
}

export async function createTempDir() {
  const tmpDir = path.join(os.tmpdir(), 'sfdx-hardis-' + Math.random().toString(36).substring(7));
  await fs.ensureDir(tmpDir);
  return tmpDir;
}

let isGitRepoCache: boolean | null = null;
export function isGitRepo() {
  if (isGitRepoCache !== null) {
    return isGitRepoCache;
  }
  const isInsideWorkTree = child.spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  isGitRepoCache = isInsideWorkTree.status === 0
  return isGitRepoCache;
}

export async function getGitRepoName() {
  if (!isGitRepo) {
    return null;
  }
  const origin = await git().getConfig('remote.origin.url');
  if (origin.value && origin.value.includes('/')) {
    return (/[^/]*$/.exec(origin.value) || '')[0];
  }
  return null;
}

export async function getGitRepoUrl() {
  if (!isGitRepo) {
    return null;
  }
  const origin = await git().getConfig('remote.origin.url');
  if (origin && origin.value) {
    let url = origin.value;

    // Convert SSH URL to HTTPS URL
    // Handle formats like: git@github.com:owner/repo.git or ssh://git@github.com/owner/repo.git
    if (url.startsWith('git@') || url.startsWith('ssh://')) {
      // Handle git@github.com:owner/repo.git format
      const sshMatch = url.match(/^git@([^:]+):(.+)$/);
      if (sshMatch) {
        url = `https://${sshMatch[1]}/${sshMatch[2]}`;
      } else {
        // Handle ssh://git@github.com/owner/repo.git format
        url = url.replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/');
      }
      // Remove .git suffix if present
      url = url.replace(/\.git$/, '');
    }

    // Remove credentials from HTTPS URLs
    // Handle both formats: https://username:password@domain.com and https://username@domain.com
    url = url.replace(/\/\/([^@/]+@)/gm, `//`);

    return url;
  }
  return null;
}

export async function gitHasLocalUpdates(options = { show: false }) {
  const changes = await git().status();
  if (options.show) {
    uxLog("action", this, c.cyan(JSON.stringify(changes)));
  }
  return changes.files.length > 0;
}

// Install plugin if not present
export async function checkSfdxPlugin(pluginName: string) {
  // Manage cache of SF CLI Plugins result
  if (pluginsStdout == null) {
    const config = await getConfig('user');
    if (config.sfdxPluginsStdout) {
      pluginsStdout = config.sfdxPluginsStdout;
    } else {
      const pluginsRes = await exec('sf plugins');
      pluginsStdout = pluginsRes.stdout;
      await setConfig('user', { sfdxPluginsStdout: pluginsStdout });
    }
  }
  if (!(pluginsStdout || '').includes(pluginName)) {
    uxLog(
      "warning",
      this,
      c.yellow(t('installingsfCliPlugin', { pluginName }))
    );
    const installCommand = `echo y|sf plugins install ${pluginName}`;
    await execCommand(installCommand, this, { fail: true, output: false });
  }
}

const dependenciesInstallLink = {
  git: t('gitDownloadInstaller'),
  openssl: t('opensslInstallInstruction'),
};

export async function checkAppDependency(appName) {
  const config = await getConfig('user');
  const installedApps = config.installedApps || [];
  if (installedApps.includes(appName)) {
    return true;
  }
  which(appName)
    .then(async () => {
      installedApps.push(appName);
      await setConfig('user', { installedApps: installedApps });
    })
    .catch(() => {
      uxLog(
        "error",
        this,
        c.red(t('youNeedAppInstalledLocally', { appName: c.bold(appName) }) + `\n${dependenciesInstallLink[appName] || ''}`)
      );
      process.exit();
    });
}

export async function promptInstanceUrl(
  orgTypes = ['login', 'test'],
  alias = 'default org',
  defaultOrgChoice: any = null
) {
  const customLoginUrlExample =
    orgTypes && orgTypes.length === 1 && orgTypes[0] === 'login'
      ? 'https://myclient.lightning.force.com/'
      : 'https://myclient--preprod.sandbox.lightning.force.com/';
  const allChoices = [
    {
      title: t('titleCustomLoginUrl'),
      description: t('descRecommendedOption', { example: customLoginUrlExample }),
      value: 'custom',
    },
    {
      title: t('titleSandboxScratchOrg'),
      description: t('descConnectSandboxOrScratch'),
      value: 'https://test.salesforce.com',
    },
    {
      title: t('titleOtherOrgType'),
      description: t('descConnectNonSandbox'),
      value: 'https://login.salesforce.com',
    },
  ];
  const choices = allChoices.filter((choice) => {
    if (choice.value === 'https://login.salesforce.com' && !orgTypes.includes('login')) {
      return false;
    }
    if (choice.value === 'https://test.salesforce.com' && !orgTypes.includes('test')) {
      return false;
    }
    return true;
  });
  if (defaultOrgChoice != null) {
    choices.unshift({
      title: `♻️ ${defaultOrgChoice.instanceUrl}`,
      description: t('descYourCurrentDefaultOrg'),
      value: defaultOrgChoice.instanceUrl,
    });
  }
  const orgTypeResponse = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(t('whatIsTheBaseUrlOrDomain', { alias: alias || t('defaultOrg') })),
    description: t('descSelectOrgTypeOrUrl'),
    choices: choices,
    initial: 1,
  });
  // login.salesforce.com or test.salesforce.com
  const url = orgTypeResponse.value;
  if (url.startsWith('http')) {
    return url;
  }
  // Custom url to input
  const customUrlResponse = await prompts({
    type: 'text',
    name: 'value',
    message: c.cyanBright(t('pleaseInputTheBaseUrlOfThe')),
    description: t('copyPasteTheFullUrlOfYourCurrentlyOpenSalesforceOrg'),
    placeholder: t('exSalesforceOrgUrl'),
  });
  let urlCustom = (customUrlResponse?.value || "")
    .replace('.lightning.force.com', '.my.salesforce.com')
    .replace('.my.salesforce-setup.com', '.my.salesforce.com');
  // Remove everything after '.my.salesforce.com' if existing
  if (urlCustom.includes('.my.salesforce.com')) {
    urlCustom = urlCustom.substring(0, urlCustom.indexOf('.my.salesforce.com') + '.my.salesforce.com'.length);
  }
  if (!urlCustom.startsWith('https://')) {
    urlCustom = 'https://' + urlCustom;
  }
  if (!urlCustom.endsWith('.my.salesforce.com')) {
    urlCustom = urlCustom + '.my.salesforce.com';
  }
  return urlCustom;
}

// Check if we are in a repo, or create it if missing
export async function ensureGitRepository(options: any = { init: false, clone: false, cloneUrl: null }) {
  if (!isGitRepo()) {
    // Init repo
    if (options.init) {
      await exec('git init -b main');
      console.info(c.yellow(c.bold(`[sfdx-hardis] Initialized git repository in ${process.cwd()}`)));
      isGitRepoCache = null;
    } else if (options.clone) {
      // Clone repo
      let cloneUrl = options.cloneUrl;
      if (!cloneUrl) {
        // Request repo url if not provided
        const cloneUrlPrompt = await prompts({
          type: 'text',
          name: 'value',
          message: c.cyanBright(t('whatIsTheUrlOfYourGitRepository')),
          description: t('descEnterGitRepoUrl'),
          placeholder: t('exGitlabMonitoringRepoUrl'),
        });
        cloneUrl = cloneUrlPrompt.value;
      }
      // Git clone
      await new Promise((resolve) => {
        child.spawn('git', ['clone', cloneUrl, '.'], { stdio: 'inherit' }).on('close', () => {
          resolve(null);
        });
      });
      uxLog("action", this, c.cyan(`Git repository cloned. ${c.yellow(t('pleaseRunTheSameCommandAgain'))}`));
      process.exit(0);
    } else {
      throw new SfError('You need to be at the root of a git repository to run this command');
    }
  }
  // Check if root
  else if (options.mustBeRoot) {
    const gitRepoRoot = await getGitRepoRoot();
    if (path.resolve(gitRepoRoot) !== path.resolve(process.cwd())) {
      throw new SfError(`You must be at the root of the git repository (${path.resolve(gitRepoRoot)})`);
    }
  }
}

export async function getGitRepoRoot() {
  const gitRepoRoot = await git().revparse(['--show-toplevel']);
  return gitRepoRoot;
}

// Get local git branch name
export async function getCurrentGitBranch(options: any = { formatted: false }) {
  if (!isGitRepo()) {
    return null;
  }
  const gitBranch = process.env.FORCE_SOURCE_BRANCH || process.env.CI_COMMIT_REF_NAME || (await git().branchLocal()).current;
  if (options.formatted === true) {
    return gitBranch.replace('/', '__');
  }
  return gitBranch;
}

// Build a stable slug from an org instance URL (used to name branch/auth configs from an org domain)
export function buildOrgSlugFromInstanceUrl(instanceUrl: string): string {
  return (instanceUrl || '')
    .replace('https://', '')
    .replace('.my.salesforce.com', '')
    .replace(/\./gm, '_')
    .replace(/--/gm, '__')
    .replace(/-/gm, '_');
}

export async function getLatestGitCommit() {
  if (!isGitRepo()) {
    return null;
  }
  const log = await git().log(['-1']);
  return log?.latest ?? null;
}

// Select git branch and checkout & pull if requested
export async function selectGitBranch(
  options: { remote: true; checkOutPull: boolean; message?: string; allowAll?: boolean } = { remote: true, checkOutPull: false }
) {
  const gitBranchOptions = ['--list'];
  if (options.remote) {
    gitBranchOptions.push('-r');
  }
  const branches = await git().branch(gitBranchOptions);
  if (options.allowAll) {
    branches.all.unshift("ALL BRANCHES")
  }
  const branchResp = await prompts({
    type: 'select',
    name: 'value',
    message: options.message || t('pleaseSelectGitBranch'),
    description: t('descChooseGitBranch'),
    choices: branches.all.map((branchName) => {
      return { title: branchName.replace('origin/', ''), value: branchName.replace('origin/', '') };
    }),
  });
  const branch = branchResp.value;
  // Checkout & pull if requested
  if (options.checkOutPull && branch !== "ALL BRANCHES") {
    await gitCheckOutRemote(branch);
    WebSocketClient.sendRefreshStatusMessage();
  }
  return branch;
}

export async function gitCheckOutRemote(branchName: string) {
  uxLog("action", this, c.cyan(t('checkingOutGitBranch', { branchName })));
  // Fail early with a clear message if the branch is checked out in another git worktree
  await assertBranchNotInOtherWorktree(branchName);
  await git().checkout(branchName);
  try {
    await gitPull();
  } catch (error: any) {
    const errorStr = (error?.message || error?.toString() || '');
    // Fallback when the local branch has no upstream tracking: pull explicitly from origin, then set upstream
    if (/no tracking information/i.test(errorStr) || /no upstream/i.test(errorStr)) {
      uxLog("warning", this, c.yellow(t('gitPullNoUpstreamFallback', { branchName })));
      await gitPull(['origin', branchName]);
      try {
        await git().branch([`--set-upstream-to=origin/${branchName}`, branchName]);
      } catch {
        // Best-effort: tracking setup failure should not break the checkout
      }
    } else {
      throw error;
    }
  }
}

// Helper function to detect git authentication errors
function isGitAuthError(error: any): boolean {
  const errorStr = (error?.message || error?.toString() || '').toLowerCase();
  const authErrorPatterns = [
    'authentication failed',
    'authentication error',
    'could not read username',
    'could not read password',
    'invalid username or password',
    'access denied',
    'permission denied',
    'publickey',
    'could not read from remote repository',
    'correct access rights',
    '403',
    '401',
    'unauthorized',
  ];
  return authErrorPatterns.some((pattern) => errorStr.includes(pattern));
}

// Helper function to prompt for git credentials and update remote URL
async function handleGitAuthError(operation: string): Promise<boolean> {
  if (isCI) {
    uxLog("error", this, c.red(t('gitFailedDueToAuthenticationErrorIn', { operation })));
    return false;
  }

  uxLog("warning", this, c.yellow(t('gitFailedDueToAuthenticationError', { operation })));
  uxLog("action", this, c.cyan(t('pleaseProvideYourGitCredentialsToContinue')));

  const usernamePrompt = await prompts({
    type: 'text',
    name: 'username',
    message: c.cyanBright(t('enterYourGitUsername')),
    description: t('descGitUsername'),
    validate: (value: string) => (value && value.trim().length > 0) || 'Username is required',
  });

  if (!usernamePrompt.username) {
    uxLog("action", this, c.cyan(t('gitUsernameIsRequiredToContinue')));
    return false;
  }

  const passwordPrompt = await prompts({
    type: 'text',
    name: 'password',
    message: c.cyanBright(t('enterYourGitPasswordOrPersonalAccess')),
    description: t('descGitPassword'),
    validate: (value: string) => (value && value.trim().length > 0) || 'Password/PAT is required',
  });

  if (!passwordPrompt.password) {
    uxLog("action", this, c.cyan(t('gitPasswordPatIsRequiredToContinue')));
    return false;
  }

  const username = usernamePrompt.username;
  const password = passwordPrompt.password;

  uxLog("action", this, c.cyan(t('updatingGitRemoteUrlWithCredentials')));
  try {
    // Get current remote URL
    const origin = await git().getConfig('remote.origin.url');
    if (!origin || !origin.value) {
      uxLog("error", this, c.red(t('couldNotRetrieveRemoteOriginUrl')));
      return false;
    }

    let remoteUrl = origin.value;
    const encodedUsername = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);

    // Update remote URL to include credentials
    if (remoteUrl.startsWith('https://')) {
      // Remove existing credentials if present
      remoteUrl = remoteUrl.replace(/\/\/(.*:.*@)/gm, '//');
      // Add new credentials
      remoteUrl = remoteUrl.replace('https://', `https://${encodedUsername}:${encodedPassword}@`);
    } else if (remoteUrl.startsWith('http://')) {
      // Remove existing credentials if present
      remoteUrl = remoteUrl.replace(/\/\/(.*:.*@)/gm, '//');
      // Add new credentials
      remoteUrl = remoteUrl.replace('http://', `http://${encodedUsername}:${encodedPassword}@`);
    } else {
      uxLog("error", this, c.red(t('onlyHttpRemoteUrlsAreSupportedFor')));
      return false;
    }

    // Update the remote URL
    await git().remote(['set-url', 'origin', remoteUrl]);
    uxLog("action", this, c.green(t('remoteUrlUpdatedWithCredentialsSuccessfully')));
    return true;
  } catch (e: any) {
    uxLog("error", this, c.red(t('failedToUpdateRemoteUrl', { message: e?.message || e })));
    return false;
  }
}

// Wrapper for git fetch with authentication error handling
export async function gitFetch(argsOrOptions?: string[] | any, argsIfOptionsFirst?: string[]): Promise<any> {
  // Handle both signatures: gitFetch(args) and gitFetch(options, args)
  let args: string[] = [];
  let options: any = {};

  if (Array.isArray(argsOrOptions)) {
    args = argsOrOptions;
  } else if (argsOrOptions && typeof argsOrOptions === 'object' && !Array.isArray(argsOrOptions)) {
    options = argsOrOptions;
    args = argsIfOptionsFirst || [];
  }

  try {
    if (options.output !== undefined || options.displayCommand !== undefined) {
      return await git(options).fetch(args);
    }
    return await git().fetch(args);
  } catch (error) {
    if (isGitAuthError(error)) {
      const credentialsUpdated = await handleGitAuthError('fetch');
      if (credentialsUpdated) {
        // Retry the operation
        uxLog("action", this, c.cyan(t('retryingGitFetchWithUpdatedCredentials')));
        if (options.output !== undefined || options.displayCommand !== undefined) {
          return await git(options).fetch(args);
        }
        return await git().fetch(args);
      }
    }
    throw error;
  }
}

// Wrapper for git pull with authentication error handling
export async function gitPull(argsOrOptions?: string[] | any, argsIfOptionsFirst?: string[]): Promise<any> {
  // Handle both signatures: gitPull(args) and gitPull(options, args)
  let args: string[] = [];
  let options: any = {};

  if (Array.isArray(argsOrOptions)) {
    args = argsOrOptions;
  } else if (argsOrOptions && typeof argsOrOptions === 'object' && !Array.isArray(argsOrOptions)) {
    options = argsOrOptions;
    args = argsIfOptionsFirst || [];
  }

  try {
    if (options.output !== undefined || options.displayCommand !== undefined) {
      return await git(options).pull(args);
    }
    return await git().pull(args);
  } catch (error) {
    if (isGitAuthError(error)) {
      const credentialsUpdated = await handleGitAuthError('pull');
      if (credentialsUpdated) {
        // Retry the operation
        uxLog("action", this, c.cyan(t('retryingGitPullWithUpdatedCredentials')));
        if (options.output !== undefined || options.displayCommand !== undefined) {
          return await git(options).pull(args);
        }
        return await git().pull(args);
      }
    }
    throw error;
  }
}

// Wrapper for git push with authentication error handling
export async function gitPush(argsOrOptions?: string[] | any, argsIfOptionsFirst?: string[]): Promise<any> {
  // Handle both signatures: gitPush(args) and gitPush(options, args)
  let args: string[] = [];
  let options: any = {};

  if (Array.isArray(argsOrOptions)) {
    args = argsOrOptions;
  } else if (argsOrOptions && typeof argsOrOptions === 'object' && !Array.isArray(argsOrOptions)) {
    options = argsOrOptions;
    args = argsIfOptionsFirst || [];
  }

  try {
    if (options.output !== undefined || options.displayCommand !== undefined) {
      return await git(options).push(args);
    }
    return await git().push(args);
  } catch (error) {
    if (isGitAuthError(error)) {
      const credentialsUpdated = await handleGitAuthError('push');
      if (credentialsUpdated) {
        // Retry the operation
        uxLog("action", this, c.cyan(t('retryingGitPushWithUpdatedCredentials')));
        if (options.output !== undefined || options.displayCommand !== undefined) {
          return await git(options).push(args);
        }
        return await git().push(args);
      }
    }
    throw error;
  }
}

// Get local git branch name
export async function ensureGitBranch(branchName: string, options: any = { init: false, parent: 'current', logAsAction: false }) {
  if (!isGitRepo()) {
    if (options.init) {
      await ensureGitRepository({ init: true });
      isGitRepoCache = null;
    } else {
      return false;
    }
  }
  await gitFetch();
  const branches = await git().branch();
  const localBranches = await git().branchLocal();
  if (localBranches.current !== branchName) {
    if (branches.all.includes(branchName)) {
      // Existing branch: checkout & pull (fail early if it is checked out in another worktree)
      await assertBranchNotInOtherWorktree(branchName);
      await git().checkout(branchName);
      if (options.logAsAction) {
        uxLog("action", this, c.green(t('checkedOutGitBranch', { branchName: c.bold(branchName) })));
      }
      // await git().pull()
    } else {
      if (options?.parent === 'main') {
        // Create from main branch
        const mainBranch = branches.all.includes('main')
          ? 'main'
          : branches.all.includes('origin/main')
            ? 'main'
            : branches.all.includes('remotes/origin/main')
              ? 'main'
              : 'master';
        await git().checkout(mainBranch);
        await git().checkoutBranch(branchName, mainBranch);
      } else {
        // Not existing branch: create it from current branch
        await git().checkoutBranch(branchName, localBranches.current);
      }
      if (options.logAsAction) {
        uxLog("action", this, c.green(t('createdAndCheckedOutGitBranch', { branchName: c.bold(branchName) })));
      }
    }
  }
  return true;
}

export interface GitWorktreeInfo {
  path: string; // Absolute path of the worktree
  head?: string; // Commit hash currently checked out
  branch?: string; // Short branch name checked out (undefined when detached)
}

// List all git worktrees attached to the current repository
export async function listGitWorktrees(): Promise<GitWorktreeInfo[]> {
  let raw = '';
  try {
    raw = await git().raw(['worktree', 'list', '--porcelain']);
  } catch {
    // git worktree may be unavailable on very old git versions: assume a single worktree
    return [];
  }
  const blocks = raw
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return blocks
    .map((block) => {
      const info: GitWorktreeInfo = { path: '' };
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
          info.path = line.substring('worktree '.length).trim();
        } else if (line.startsWith('HEAD ')) {
          info.head = line.substring('HEAD '.length).trim();
        } else if (line.startsWith('branch ')) {
          info.branch = line.substring('branch '.length).trim().replace(/^refs\/heads\//, '');
        }
      }
      return info;
    })
    .filter((info) => info.path !== '');
}

// Returns the path of another worktree where branchName is checked out, or null if free
export async function getBranchWorktreePath(branchName: string): Promise<string | null> {
  const worktrees = await listGitWorktrees();
  if (worktrees.length === 0) {
    return null;
  }
  let currentRoot: string | null = null;
  try {
    currentRoot = path.resolve(await getGitRepoRoot());
  } catch {
    currentRoot = null;
  }
  for (const worktree of worktrees) {
    if (worktree.branch === branchName && (currentRoot === null || path.resolve(worktree.path) !== currentRoot)) {
      return worktree.path;
    }
  }
  return null;
}

// Throws a clear error when branchName is checked out in another git worktree, so callers fail with
// an actionable message instead of a cryptic "'<branch>' is already used by worktree at <path>" git error.
export async function assertBranchNotInOtherWorktree(branchName: string): Promise<void> {
  const branchWorktree = await getBranchWorktreePath(branchName);
  if (branchWorktree) {
    throw new SfError(t('branchAlreadyCheckedOutInWorktree', { branch: branchName, worktreePath: branchWorktree }));
  }
}

/**
 * Create (or check out) a work branch based on the latest state of a target branch, in a way that
 * is safe when the target branch is checked out in another git worktree.
 *
 * - Never checks out the target branch in the current worktree (so it cannot fail with
 *   "<target> is already checked out at <path>").
 * - Fetches origin/<target> and creates the new branch from it, falling back to the local <target> ref.
 * - If the branch already exists and is free, checks it out (resume work).
 * - If the branch is checked out in another worktree, throws a clear error.
 */
export async function createWorkBranchFromTarget(branchName: string, targetBranch: string): Promise<void> {
  if (!isGitRepo()) {
    throw new SfError('[sfdx-hardis] You must be within a git repository');
  }

  // Refuse if the work branch is already checked out in another worktree
  await assertBranchNotInOtherWorktree(branchName);

  // Fetch the latest state of the target branch into its remote-tracking ref origin/<target>
  try {
    await gitFetch(['origin', targetBranch]);
  } catch (e) {
    uxLog("warning", this, c.yellow(t('unableToFetchTargetBranch', { branch: targetBranch, message: (e as Error).message })));
  }

  const localBranches = await git().branchLocal();
  // Resume an existing local branch
  if (localBranches.all.includes(branchName)) {
    await git().checkout(branchName);
    uxLog("action", this, c.green(t('checkedOutGitBranch', { branchName: c.bold(branchName) })));
    return;
  }

  // Resume a branch that exists only on origin (git creates the local tracking branch)
  const remoteBranches = await git().branch(['-r']);
  if (remoteBranches.all.includes(`origin/${branchName}`)) {
    await git().checkout(branchName);
    uxLog("action", this, c.green(t('checkedOutGitBranch', { branchName: c.bold(branchName) })));
    return;
  }

  // Determine the start point: prefer origin/<target>, fall back to the local <target> ref
  let startPoint: string | null = null;
  if (remoteBranches.all.includes(`origin/${targetBranch}`)) {
    startPoint = `origin/${targetBranch}`;
  } else if (localBranches.all.includes(targetBranch)) {
    startPoint = targetBranch;
  }
  if (startPoint === null) {
    throw new SfError(t('unableToFindTargetBranchToBranchFrom', { branch: targetBranch }));
  }

  // Create the work branch from the start point. --no-track keeps it upstream-less until
  // hardis:work:save pushes it with -u (matching the behavior of branching from a local ref).
  await git().checkout(['-b', branchName, '--no-track', startPoint]);
  uxLog("action", this, c.green(t('createdAndCheckedOutGitBranch', { branchName: c.bold(branchName) })));
}

// Checks that current git status is clean.
export async function checkGitClean(options: any) {
  if (!isGitRepo()) {
    throw new SfError('[sfdx-hardis] You must be within a git repository');
  }
  const gitStatus = await git({ output: true }).status();
  if (gitStatus.files.length > 0) {
    const localUpdates = gitStatus.files
      .map((fileStatus: FileStatusResult) => {
        return `(${fileStatus.working_dir}) ${getSfdxFileLabel(fileStatus.path)}`;
      })
      .join('\n');
    if (options.allowStash) {
      try {
        await execCommand('git add --all', this, { output: true, fail: true });
        await execCommand('git stash', this, { output: true, fail: true });
      } catch (e) {
        uxLog("warning", this, c.yellow(c.bold(t('youMightNeedToRunTheFollowing'))));
        uxLog("warning", this, c.yellow(c.bold(t('gitConfigSystemCoreLongpathsTrue'))));
        throw e;
      }
    } else {
      const warningMessage = t('branchIsNotCleanCommitOrResetLocalUpdates', {
        branch: c.bold(gitStatus.current),
        localUpdates: c.yellow(localUpdates),
      });
      uxLog("warning", this, c.yellow(warningMessage));
      throw new SfError(
        `[sfdx-hardis] ${warningMessage}`
      );
    }
  }
}

// Shortcut to add, commit and push
export async function gitAddCommitPush(
  options: any = {
    init: false,
    pattern: './*',
    commitMessage: 'chore(sfdx-hardis): automated update',
    branch: null,
  }
) {
  if (!isGitRepo()) {
    if (options.init) {
      // Initialize git repo
      await execCommand('git init -b main', this);
      isGitRepoCache = null;
      await git().checkoutBranch(options.branch || 'dev', 'main');
    }
  }
  // Add, commit & push
  const currentgitBranch = (await git().branchLocal()).current;
  await git()
    .add(options.pattern || './*')
    .commit(options.commitMessage || 'chore(sfdx-hardis): automated update');
  await gitPush(['-u', 'origin', currentgitBranch]);
}

// Normalize git FileStatus path
export function normalizeFileStatusPath(fileStatusPath: string, config): string {
  if (fileStatusPath.startsWith('"')) {
    fileStatusPath = fileStatusPath.substring(1);
  }
  if (fileStatusPath.endsWith('"')) {
    fileStatusPath = fileStatusPath.slice(0, -1);
  }
  if (config.gitRootFolderPrefix) {
    fileStatusPath = fileStatusPath.replace(config.gitRootFolderPrefix, '');
  }
  return fileStatusPath;
}

// Retry policy for execCommand. tryCount is set by execCommand on retry — callers do not provide it.
export interface ExecCommandRetryOptions {
  tryCount?: number;
  retryMaxAttempts?: number;
  retryStringConstraint?: string;
  retryDelay?: number;
}

// Environment variables that skip sf CLI startup work sfdx-hardis does not need when it spawns sf under the hood:
// telemetry upload process, pino log file worker thread, new version check, autoupdate check.
// Measured gain: 400 to 750 ms per sf call (10 to 17 percent). Disabled with SFDX_HARDIS_ENHANCE_PERFORMANCE=false.
// User-defined values are never overridden.
const SF_PERFORMANCE_ENV: Record<string, string> = {
  SF_DISABLE_TELEMETRY: 'true',
  SF_DISABLE_LOG_FILE: 'true',
  SF_SKIP_NEW_VERSION_CHECK: 'true',
  SF_DISABLE_AUTOUPDATE: 'true',
  SF_AUTOUPDATE_DISABLE: 'true',
};

export function isSfPerformanceEnhanced(): boolean {
  return process.env.SFDX_HARDIS_ENHANCE_PERFORMANCE !== 'false';
}

export function applySfPerformanceEnv(command: string, env: Record<string, any>): void {
  if (!isSfPerformanceEnhanced()) {
    return;
  }
  if (!(command.startsWith('sf ') || command.startsWith('sfdx ') || /(^|[\s"'])sf(\.cmd)?\s/.test(command))) {
    return;
  }
  for (const [key, value] of Object.entries(SF_PERFORMANCE_ENV)) {
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
    }
  }
}

// Options accepted by execCommand and execSfdxJson.
export interface ExecCommandOptions {
  // Throw on non-zero command exit (or on --json status > 0). Default false.
  fail?: boolean;
  // Print command output to the user. null/undefined means "auto" based on --json. Default false.
  output?: boolean | null;
  // Log the stdout for debugging. Default false.
  debug?: boolean;
  // Show an ora spinner during execution. Default true.
  spinner?: boolean;
  // Working directory for the child process.
  cwd?: string;
  // Extra environment variables to merge on top of the inherited process env.
  env?: NodeJS.ProcessEnv;
  // Retry policy on failure.
  retry?: ExecCommandRetryOptions;
}

// Execute salesforce DX command with --json
export async function execSfdxJson(
  command: string,
  commandThis: any,
  options: ExecCommandOptions = {
    fail: false,
    output: false,
    debug: false,
  }
): Promise<any> {
  if (!command.includes('--json')) {
    command += ' --json';
  }
  // Read-only org display / config get / config set are run in-process when possible (saves 2 to 4 seconds each)
  const inProcessResult = await tryRunSfCommandInProcess(command, commandThis);
  if (inProcessResult != null) {
    return inProcessResult;
  }
  return await execCommand(command, commandThis, options);
}

// Execute command
export async function execCommand(
  command: string,
  commandThis: SfCommand<any> | null,
  options: ExecCommandOptions = {
    fail: false,
    output: false,
    debug: false,
    spinner: true,
  }
): Promise<any> {
  let commandLog = isCI && process.env.GITHUB_ACTIONS ?
    `[sfdx-hardis][command] ${c.bold(c.bgBlue(c.yellow(command)))}` :
    `[sfdx-hardis][command] ${c.bold(c.bgWhite(c.blue(command)))}`;
  const execOptions: any = { maxBuffer: 10000 * 10000 };
  if (options.cwd) {
    execOptions.cwd = options.cwd;
    if (path.resolve(execOptions.cwd) !== path.resolve(process.cwd())) {
      commandLog += c.grey(` ${c.italic('in directory')} ${execOptions.cwd}`);
    }
  }

  const env = Object.assign({}, process.env);
  // Disable colors for json parsing
  // Remove NODE_OPTIONS in case it contains --inspect-brk to avoid to trigger again the debugger
  env.FORCE_COLOR = '0';
  if (env?.NODE_OPTIONS && env.NODE_OPTIONS.includes("--inspect-brk")) {
    env.NODE_OPTIONS = "";
  }
  if (env?.JSFORCE_LOG_LEVEL) {
    env.JSFORCE_LOG_LEVEL = "";
  }
  execOptions.env = env;
  if (command.startsWith('sf hardis')) {
    execOptions.env.NO_NEW_COMMAND_TAB = 'true';
  }
  applySfPerformanceEnv(command, execOptions.env);
  if (options.env && typeof options.env === 'object') {
    Object.assign(execOptions.env, options.env);
  }
  let commandResult: any = {};
  const output = options.output !== null ? options.output : !commandThis?.argv?.includes('--json');
  let spinner: any;
  if (output && !(options.spinner === false)) {
    spinner = createSpinner({ text: commandLog }).start();
    if (globalThis.hardisLogFileStream) {
      globalThis.hardisLogFileStream.write(stripAnsi(commandLog) + '\n');
    }
  } else {
    uxLog("other", this, commandLog);
  }
  if (WebSocketClient.isAlive()) {
    WebSocketClient.sendCommandSubCommandStartMessage(
      command,
      execOptions.cwd || process.cwd(),
      options,
    );
  }
  try {
    commandResult = await exec(command, execOptions);
    if (spinner) {
      spinner.succeed(commandLog);
    }
    if (WebSocketClient.isAlive()) {
      WebSocketClient.sendCommandSubCommandEndMessage(
        command,
        execOptions.cwd || process.cwd(),
        options,
        true,
        commandResult,
      );
    }
  } catch (e) {
    if (spinner) {
      spinner.fail(commandLog);
    }
    WebSocketClient.sendCommandSubCommandEndMessage(
      command,
      execOptions.cwd || process.cwd(),
      options,
      false,
      e,
    );
    // Display error in red if not json
    if (!command.includes('--json') || options.fail) {
      const strErr = shortenLogLines(`${(e as any).stdout}\n${(e as any).stderr}`);
      if (output) {
        console.error(c.red(strErr));
      }
      (e as Error).message = (e as Error).message += '\n' + strErr;
      // Manage retry if requested
      const retry = options.retry;
      if (retry != null) {
        retry.tryCount = (retry.tryCount || 0) + 1;
        if (
          retry.tryCount <= (retry.retryMaxAttempts || 1) &&
          (retry.retryStringConstraint == null ||
            ((e as any).stdout + (e as any).stderr).includes(retry.retryStringConstraint))
        ) {
          uxLog(
            "warning",
            commandThis,
            c.yellow(`Retry command: ${retry.tryCount} on ${retry.retryMaxAttempts || 1}`)
          );
          if (retry.retryDelay) {
            uxLog("other", this, `Waiting ${retry.retryDelay} seconds before retrying command`);
            await new Promise((resolve) => setTimeout(resolve, retry.retryDelay! * 1000));
          }
          return await execCommand(command, commandThis, options);
        }
      }
      throw e;
    }
    // if --json, we should not have a crash, so return status 1 + output log
    return {
      status: 1,
      errorMessage: `[sfdx-hardis][ERROR] Error processing command\n${(e as any).stdout}\n${(e as any).stderr}`,
      error: e,
    };
  }
  // Display output if requested, for better user understanding of the logs
  if (options.output || options.debug) {
    uxLog("other", commandThis, c.italic(c.grey(shortenLogLines(commandResult.stdout))));
  }
  // Return status 0 if not --json
  if (!command.includes('--json')) {
    return {
      status: 0,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
    };
  }
  // Parse command result if --json
  let parsedResult: any = null;
  try {
    parsedResult = JSON.parse(commandResult.stdout);
  } catch (e) {
    // The command succeeded (its exit code was 0) but its output is not a single JSON document,
    // for example two --json commands chained with && : the exit code stays the source of truth,
    // so no failure is fabricated out of the parsing error.
    uxLog("warning", commandThis, c.yellow(t('commandOutputJsonNotParseable', { message: (e as Error).message })));
    return {
      status: 0,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      jsonParseError: (e as Error).message,
    };
  }
  if (options.fail && parsedResult.status && parsedResult.status > 0) {
    throw new SfError(c.red(`[sfdx-hardis][ERROR] Command failed: ${commandResult}`));
  }
  if (commandResult.stderr && commandResult.stderr.length > 2) {
    uxLog("other", this, '[sfdx-hardis][WARNING] stderr: ' + c.yellow(commandResult.stderr));
  }
  return parsedResult;
}

/* Ex: force-app/main/default/layouts/Opportunity-Opportunity %28Marketing%29 Layout.layout-meta.xml
   becomes layouts/Opportunity-Opportunity (Marketing Layout).layout-meta.xml */
export function getSfdxFileLabel(filePath: string) {
  const cleanStr = decodeURIComponent(
    filePath.replace('force-app/main/default/', '').replace('force-app/main/', '').replace('"', '')
  );
  const dotNumbers = (filePath.match(/\./g) || []).length;
  if (dotNumbers > 1) {
    const m = /(.*)\/(.*)\..*\..*/.exec(cleanStr);
    if (m && m.length >= 2) {
      return cleanStr.replace(m[1], c.cyan(m[1])).replace(m[2], c.bold(c.yellow(m[2])));
    }
  } else {
    const m = /(.*)\/(.*)\..*/.exec(cleanStr);
    if (m && m.length >= 2) {
      return cleanStr.replace(m[2], c.yellow(m[2]));
    }
  }
  return cleanStr;
}

const elapseAll = {};
export function elapseStart(text) {
  elapseAll[text] = process.hrtime.bigint();
}
export function elapseEnd(text: string, commandThis: any = this) {
  if (elapseAll[text]) {
    const elapsed = Number(process.hrtime.bigint() - elapseAll[text]);
    const ms = elapsed / 1000000;
    uxLog("log", commandThis, c.grey(c.italic(text + ' ' + formatElapsedMs(ms))));
    delete elapseAll[text];
  }
}

// Can be used to merge 2 package.xml content
export function mergeObjectPropertyLists(obj1: any, obj2: any, options: { sort: true }) {
  for (const key of Object.keys(obj2)) {
    if (obj1[key]) {
      obj1[key].push(...obj2[key]);
    } else {
      obj1[key] = obj2[key];
    }
    obj1[key] = [...new Set(obj1[key])]; // Make list unique
    if (options.sort) {
      obj1[key].sort();
    }
  }
  return obj1;
}

// Can be used to merge 2 package.xml content
export function removeObjectPropertyLists(obj1: any, objToRemove: any) {
  for (const key of Object.keys(objToRemove)) {
    if (obj1[key]) {
      const itemsToRemove = objToRemove[key];
      obj1[key] = obj1[key].filter((item) => !itemsToRemove.includes(item));
    }
  }
  return obj1;
}

// Filter package XML
export async function filterPackageXml(
  packageXmlFile: string,
  packageXmlFileOut: string,
  options: any = {
    keepOnlyNamespaces: [],
    removeNamespaces: [],
    removeMetadatas: [],
    removeStandard: false,
    removeFromPackageXmlFile: null,
    updateApiVersion: null,
  }
): Promise<{ updated: boolean; message: string }> {
  let updated = false;
  let message = `[sfdx-hardis] ${packageXmlFileOut} not updated`;
  const initialFileContent = await fs.readFile(packageXmlFile);
  const manifest = parseXmlString(initialFileContent.toString());

  // Keep only namespaces
  if ((options.keepOnlyNamespaces || []).length > 0) {
    uxLog("log", this, c.grey(t('keepingItemsFromNamespaces', { options: options.keepOnlyNamespaces.join(',') })));
    manifest.Package.types = manifest.Package.types.map((type: any) => {
      type.members = type.members.filter((member: string) => {
        const containsNamespace = options.keepOnlyNamespaces.filter((ns: string) => member.startsWith(ns) || member.includes(`${ns}__`)).length > 0;
        if (containsNamespace) {
          return true;
        }
        return false;
      });
      return type;
    });
  }

  // Remove namespaces
  if ((options.removeNamespaces || []).length > 0) {
    uxLog("log", this, c.grey(t('removingItemsFromNamespaces', { options: options.removeNamespaces.join(',') })));
    manifest.Package.types = manifest.Package.types.map((type: any) => {
      type.members = type.members.filter((member: string) => {
        const startsWithNamespace = options.removeNamespaces.filter((ns: string) => member.startsWith(ns + '__')).length > 0;
        if (startsWithNamespace) {
          const splits = member.split('.');
          if (
            splits.length === 2 &&
            (((splits[1].match(/__/g) || []).length == 1 && splits[1].endsWith('__c')) ||
              (splits[1].match(/__/g) || []).length == 0)
          ) {
            // Keep ns__object__c.field__c and ns__object.stuff
            return true;
          }
          // Do not keep ns__object__c.ns__field__c or ns__object__c.ns__stuff
          return false;
        }
        return true;
      });
      return type;
    });
  }
  // Remove from other packageXml file
  if (options.removeFromPackageXmlFile) {
    const destructiveFileContent = await fs.readFile(options.removeFromPackageXmlFile);
    const destructiveManifest = parseXmlString(destructiveFileContent.toString());
    manifest.Package.types = manifest.Package.types
      .map((type: any) => {
        const destructiveTypes = destructiveManifest.Package.types.filter((destructiveType: any) => {
          return destructiveType.name[0] === type.name[0];
        });
        if (destructiveTypes.length > 0) {
          type.members = type.members.filter((member: string) => {
            return shouldRetainMember(destructiveTypes[0].members, member);
          });
        }
        return type;
      })
      .filter((type: any) => {
        // Remove types with wildcard
        const wildcardDestructiveTypes = destructiveManifest.Package.types.filter((destructiveType: any) => {
          return (
            destructiveType.name[0] === type.name[0] &&
            destructiveType.members.length === 1 &&
            destructiveType.members[0] === '*'
          );
        });
        if (wildcardDestructiveTypes.length > 0) {
          uxLog("log", this, c.grey(t('removedType', { type: type.name[0] })));
        }
        return wildcardDestructiveTypes.length === 0;
      });
  }
  // Remove standard objects
  if (options.removeStandard) {
    const customFields: Array<string> = manifest.Package.types.filter((t: any) => t.name[0] === 'CustomField')?.[0]?.members || [];
    manifest.Package.types = manifest.Package.types.map((type: any) => {
      if (['CustomObject'].includes(type.name[0])) {
        type.members = type.members.filter((customObjectName: string) => {
          // If a custom field is defined on the standard object, keep the standard object
          if (customFields.some((field: string) => field.startsWith(customObjectName + '.'))) {
            return true;
          }
          return customObjectName.endsWith('__c');
        });
      }
      type.members = type.members.filter((member: string) => {
        return !member.startsWith('standard__');
      });
      return type;
    });
  }
  // Update API version
  if (options.updateApiVersion) {
    manifest.Package.version[0] = options.updateApiVersion;
  }

  if (options.keepMetadataTypes && options.keepMetadataTypes.length > 0) {
    // Remove metadata types (named, and empty ones)
    manifest.Package.types = manifest.Package.types.filter((type: any) => {
      if (options.keepMetadataTypes.includes(type.name[0])) {
        uxLog("log", this, c.grey('kept ' + type.name[0]));
        return true;
      }
      uxLog("log", this, c.grey(t('removed') + type.name[0]));
      return false;
    });
  }

  // Remove metadata types (named, and empty ones)
  manifest.Package.types = manifest.Package.types.filter(
    (type: any) => !(options.removeMetadatas || []).includes(type.name[0]) && (type?.members?.length || 0) > 0
  );
  const updatedFileContent = buildXmlString(manifest, '  ');
  if (updatedFileContent !== initialFileContent.toString()) {
    await writeXmlFile(packageXmlFileOut, manifest);
    updated = true;
    if (packageXmlFile !== packageXmlFileOut) {
      message = `[sfdx-hardis] ${packageXmlFile} has been filtered to ${packageXmlFileOut}`;
    } else {
      message = `[sfdx-hardis] ${packageXmlFile} has been updated`;
    }
  }
  return {
    updated,
    message,
  };
}

function shouldRetainMember(destructiveMembers: string[], member: string) {
  if (destructiveMembers.length === 1 && destructiveMembers[0] === '*') {
    // Whole type will be filtered later in the code
    return true;
  }
  const matchesWithItemsToExclude = destructiveMembers.filter((destructiveMember: string) => {
    if (destructiveMember === member) {
      return true;
    }
    // Handle cases wild wildcards, like pi__* , *__dlm , or begin*end
    if (destructiveMember.includes('*')) {
      const regex = new RegExp(destructiveMember.replace(/\*/g, '.*'));
      if (regex.test(member)) {
        return true;
      }
    }
    return false;
  });
  return matchesWithItemsToExclude.length === 0;
}

// Catch matches in files according to criteria
export async function catchMatches(catcher: any, file: string, fileText: string, commandThis: any) {
  const matchResults: any[] = [];
  if (catcher.regex) {
    // Check if there are matches
    const matches = await countRegexMatches(catcher.regex, fileText);
    if (matches > 0) {
      // If match, extract match details
      const fileName = path.basename(file);
      const detail: any = {};
      for (const detailCrit of catcher.detail) {
        const detailCritVal = await extractRegexGroups(detailCrit.regex, fileText);
        if (detailCritVal.length > 0) {
          detail[detailCrit.name] = detailCritVal;
        }
      }
      const catcherLabel = catcher.regex ? `regex ${catcher.regex.toString()}` : 'ERROR';
      matchResults.push({
        fileName,
        fileText,
        matches,
        type: catcher.type,
        subType: catcher.subType,
        detail,
        catcherLabel,
      });
      if (commandThis.debug) {
        uxLog(
          "other",
          commandThis,
          `[${fileName}]: Match [${matches}] occurrences of [${catcher.type}/${catcher.name}] with catcher [${catcherLabel}]`
        );
      }
    }
  }
  return matchResults;
}

// Count matches of a regex
export async function countRegexMatches(regex: RegExp, text: string): Promise<number> {
  return ((text || '').match(regex) || []).length;
}

// Get all captured groups of a regex in a string
export async function extractRegexGroups(regex: RegExp, text: string): Promise<string[]> {
  const matches = ((text || '').match(regex) || []).map((e) => e.replace(regex, '$1').trim());
  return matches;
  // return ((text || '').matchAll(regex) || []).map(item => item.trim());
}

export async function extractRegexMatches(regex: RegExp, text: string): Promise<string[]> {
  let m;
  const matchStrings: any[] = [];
  while ((m = regex.exec(text)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === regex.lastIndex) {
      regex.lastIndex++;
    }
    // Iterate thru the regex matches
    m.forEach((match, group) => {
      if (group === 1) {
        matchStrings.push(match);
      }
    });
  }
  return matchStrings;
}

export async function extractRegexMatchesMultipleGroups(regex: RegExp, text: string): Promise<any[]> {
  let m;
  const matchResults: any[] = [];
  while ((m = regex.exec(text)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === regex.lastIndex) {
      regex.lastIndex++;
    }
    // Iterate thru the regex matches
    const matchGroups: any[] = [];
    m.forEach((match) => {
      matchGroups.push(match);
    });
    matchResults.push(matchGroups);
  }
  return matchResults;
}

export function arrayUniqueByKey(array, key: string) {
  const keys = new Set();
  return array.filter((el) => !keys.has(el[key]) && keys.add(el[key]));
}

export function arrayUniqueByKeys(array, keysIn: string[]) {
  const keys = new Set();
  const buildKey = (el) => {
    return keysIn.map((key) => el[key]).join(';');
  };
  return array.filter((el) => !keys.has(buildKey(el)) && keys.add(buildKey(el)));
}

// Generate output files
export async function generateReports(
  resultSorted: any[],
  columns: any[],
  commandThis: any,
  options: any = { logFileName: null, logLabel: 'Report' }
): Promise<any[]> {
  const logLabel = options.logLabel || 'Report';
  let logFileName = options.logFileName || null;
  if (!logFileName) {
    logFileName = 'sfdx-hardis-' + commandThis.id.substr(commandThis.id.lastIndexOf(':') + 1);
  }
  const dateSuffix = new Date().toJSON().slice(0, 10);
  const reportDir = await getReportDirectory();
  const reportFile = path.resolve(`${reportDir}/${logFileName}-${dateSuffix}.csv`);
  const reportFileExcel = path.resolve(`${reportDir}/${logFileName}-${dateSuffix}.xls`);
  await fs.ensureDir(path.dirname(reportFile));
  // Anonymize sensitive data in the written files (CI artifacts, email attachments)
  resultSorted = anonymizeRows(resultSorted, await getChannelAnonymizationLevel('files'));
  const csv = stringifyCsv(resultSorted, {
    delimiter: ';',
    columns,
  });
  await fs.writeFile(reportFile, csv, 'utf8');
  // Trigger command to open CSV file in VS Code extension
  try {
    if (!WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.requestOpenFile(reportFile);
    }
    WebSocketClient.sendReportFileMessage(reportFile, t('labelCsvReport', { label: logLabel }), "report");
  } catch (e: any) {
    uxLog("warning", commandThis, c.yellow(`[sfdx-hardis] Error opening file in VS Code: ${e.message}`));
  }
  const excel = stringifyCsv(resultSorted, {
    delimiter: '\t',
    columns,
  });
  await fs.writeFile(reportFileExcel, excel, 'utf8');
  WebSocketClient.sendReportFileMessage(reportFileExcel, t('labelCsvReport', { label: logLabel }), "report");
  uxLog("action", commandThis, c.cyan(logLabel));
  uxLog("log", commandThis, c.grey(c.cyan(`- CSV: ${reportFile}`)));
  uxLog("log", commandThis, c.grey(c.cyan(`- XLS: ${reportFileExcel}`)));
  return [
    { type: 'csv', file: reportFile },
    { type: 'xls', file: reportFileExcel },
  ];
}

// Options for uxLog. `sensitive` obfuscates the value in log files; `alwaysVisible` keeps the
// enclosing VS Code UI section expanded by default; `query` describes the query this line is
// about (start, completion with its record count, or failure) so the VS Code extension can show
// its state next to the query text.
export interface UxLogOptions {
  sensitive?: boolean;
  alwaysVisible?: boolean;
  query?: CommandLogLineQuery;
}

export function uxLog(logType: LogType, commandThis: any, textInit: string, optionsOrSensitive: boolean | UxLogOptions = {}): void {
  // Backward compatibility: the 4th argument used to be a boolean "sensitive" flag.
  // uxLog can be called by external plugins, so keep accepting that legacy form.
  const options: UxLogOptions =
    typeof optionsOrSensitive === 'boolean' ? { sensitive: optionsOrSensitive } : (optionsOrSensitive || {});
  const sensitive = options.sensitive === true;
  const alwaysVisible = options.alwaysVisible === true;
  const text = textInit.includes('[sfdx-hardis]') ? textInit : '[sfdx-hardis]' + (textInit.startsWith('[') ? '' : ' ') + textInit;
  // Console log
  if (commandThis?.ux) {
    commandThis.ux.log(text);
  } else if (!(globalThis?.processArgv || process?.argv || "").includes('--json')) {
    console.log(text);
  }
  // File log
  if (globalThis.hardisLogFileStream) {
    if (sensitive) {
      globalThis.hardisLogFileStream.write('OBFUSCATED LOG LINE\n');
    }
    else {
      globalThis.hardisLogFileStream.write(stripAnsi(text) + '\n');
    }
  }
  // VS Code sfdx-hardis log
  if (WebSocketClient.isAlive() && !text.includes('[command]') && !text.includes('[NotifProvider]')) {
    // <copy> marks a value the user must copy from the VS Code UI: show it there but keep it obfuscated in the log file (handled above)
    if (sensitive && !text.includes('<copy>') && !text.includes('SFDX_CLIENT_ID_') && !text.includes('SFDX_CLIENT_KEY_') && !text.includes('SFDX_CLIENT_CERT_')) {
      WebSocketClient.sendCommandLogLineMessage('OBFUSCATED LOG LINE');
    }
    else {
      let isQuestion = false;
      let textToSend = textInit;
      if (textInit.includes("Look up in VS Code")) {
        // Remove "Look up in VS Code" and everything after
        textToSend = textInit.split("Look up in VS Code")[0].trim();
        isQuestion = true;
      }

      // Send message to WebSocket client
      if (logType !== "other") {
        WebSocketClient.sendCommandLogLineMessage(textToSend, logType, isQuestion, alwaysVisible, options.query);
      }
    }
  }
}

export function uxLogTable(commandThis: any, tableData: any[], columnsOrder: string[] = []) {
  // Build a table string as tableData is an array of objects compliant with console.table
  // This string will be used to display the table in the console
  if (!tableData || tableData.length === 0) {
    return;
  }
  // Anonymize sensitive data in CI console logs (retained artifacts) and strip row markers.
  // Sync best-effort level resolution: the async chokepoints (files, notifications) are exact.
  tableData = anonymizeRows(tableData, getChannelAnonymizationLevelSync('files'));
  let columns: string[];
  let displayData = tableData;
  if (columnsOrder && columnsOrder.length > 0) {
    columns = columnsOrder;
    // Rebuild each row to contain only the columns in columnsOrder, in order
    displayData = tableData.map(row => {
      const newRow: any = {};
      for (const col of columnsOrder) {
        newRow[col] = row[col] ?? '';
      }
      return newRow;
    });
  } else {
    columns = Object.keys(tableData[0]);
    displayData = tableData;
  }
  // Compute column widths based on the longest value in each column
  const colWidths = columns.map(col =>
    Math.max(
      col.length,
      ...displayData.map(row => String(row[col] ?? '').replace(/\n/g, ' ').length)
    )
  );
  // Build header
  const header = columns
    .map((col, i) => c.bold(col.padEnd(colWidths[i])))
    .join(' | ');
  // Build separator
  const separator = colWidths.map(w => '-'.repeat(w)).join('-|-');
  // Build rows
  const rows = displayData.map(row =>
    columns
      .map((col, i) => {
        let val = row[col] ?? '';
        if (typeof val === 'boolean') {
          val = bool2emoji(val);
        }
        return String(val).replace(/\n/g, ' ').padEnd(colWidths[i]);
      })
      .join(' | ')
  );
  const tableString = [header, separator, ...rows].join('\n');
  uxLog("other", commandThis, c.italic("\n" + tableString));
  // Send table to WebSocket client
  if (WebSocketClient.isAliveWithLwcUI()) {
    const maxLen = 20;
    let sendRows = displayData;
    if (displayData.length > maxLen) {
      sendRows = displayData.slice(0, maxLen);
      sendRows.push({
        sfdxHardisTruncatedMessage: t('sfdxHardisTruncatedMessage', { maxLen, total: displayData.length }),
        returnedNumber: maxLen,
        totalNumber: displayData.length
      });
    }
    WebSocketClient.sendCommandLogLineMessage(JSON.stringify(sendRows), 'table');
  }

}

export function humanizeObjectKeys(obj: object) {
  const objWithHumanizedKeys = Object.keys(obj || {}).map(key => {
    const keyTitle = key
      .replace(/([A-Z])/g, ' $1') // Add space before capital letters
      .replace(/^./, str => str.toUpperCase()); // Capitalize the first letter
    return { Key: keyTitle, Value: obj[key] };
  });
  return objWithHumanizedKeys;
}

export function bool2emoji(bool: boolean): string {
  return bool ? "✅" : "⬜"
}

// Caching methods
const SFDX_LOCAL_FOLDER = '/root/.sfdx';
const TMP_COPY_FOLDER = '.cache/sfdx-hardis/.sfdx';
let RESTORED = false;

// Put local sfdx folder in tmp/sfdx-hardis-local for CI tools needing cache/artifacts to be within repo dir
export async function copyLocalSfdxInfo() {
  if (!isCI) {
    return;
  }
  if (fs.existsSync(SFDX_LOCAL_FOLDER)) {
    await fs.ensureDir(path.dirname(TMP_COPY_FOLDER));
    await fs.copy(SFDX_LOCAL_FOLDER, TMP_COPY_FOLDER, {
      dereference: true,
      overwrite: true,
    });
    // uxLog("other", this, `[cache] Copied SF CLI cache in ${TMP_COPY_FOLDER} for later reuse`);
    // const files = fs.readdirSync(TMP_COPY_FOLDER, {withFileTypes: true}).map(item => item.name);
    // uxLog("other", this, '[cache]' + JSON.stringify(files));
  }
}

// Restore only once local Sfdx folder
export async function restoreLocalSfdxInfo() {
  if (!isCI || RESTORED === true) {
    return;
  }
  if (fs.existsSync(TMP_COPY_FOLDER)) {
    await fs.copy(TMP_COPY_FOLDER, SFDX_LOCAL_FOLDER, {
      dereference: true,
      overwrite: false,
    });
    // uxLog("other", this, '[cache] Restored cache for CI');
    // const files = fs.readdirSync(SFDX_LOCAL_FOLDER, {withFileTypes: true}).map(item => item.name);
    // uxLog("other", this, '[cache]' + JSON.stringify(files));
    RESTORED = true;
  }
}

// Generate External Client App metadata files in a temporary directory
// Heuristic detection of a deploy failure caused by an auth app (External Client App) that already exists,
// including the common case where the org refuses the provided credentials/consumer key of an existing app.
function isAuthAppAlreadyExistsError(error: any): boolean {
  const haystack = (typeof error === 'string' ? error : (error?.message || '') + ' ' + JSON.stringify(error || {})).toLowerCase();
  return [
    'already exists',
    'duplicate value found',
    'duplicate_developer_name',
    'duplicate developer name',
    'consumer key',
    'already in use',
    'name is already',
    'value already exists',
  ].some((needle) => haystack.includes(needle));
}

// Escape the few characters that are not valid as-is inside an XML text node
function escapeXml(value: string): string {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function generateExternalClientAppMetadata(
  appName: string,
  profileName: string,
  contactEmail: string,
  crtContent: string,
  consumerKey: string,
  tmpDir: string,
  conn: Connection,
  description: string = 'External Client App for sfdx-hardis CI/CD authentication'
): Promise<void> {
  // 1. ExternalClientApplication (.eca-meta.xml)
  const ecaMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<ExternalClientApplication xmlns="http://soap.sforce.com/2006/04/metadata">
    <contactEmail>${contactEmail}</contactEmail>
    <description>${escapeXml(description)}</description>
    <distributionState>Local</distributionState>
    <isProtected>false</isProtected>
    <label>${appName}</label>
</ExternalClientApplication>`;

  // 2. ExtlClntAppOauthSettings (.ecaOauth-meta.xml)
  const ecaOauthSettings = `<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppOauthSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <commaSeparatedOauthScopes>Api, Web, RefreshToken</commaSeparatedOauthScopes>
    <externalClientApplication>${appName}</externalClientApplication>
    <label>${appName} OAuth Settings</label>
</ExtlClntAppOauthSettings>`;

  // 3. ExtlClntAppGlobalOauthSettings (.ecaGlblOauth-meta.xml)
  const ecaGlobalOauthSettings = `<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppGlobalOauthSettings xmlns="http://soap.sforce.com/2006/04/metadata">
    <callbackUrl>http://localhost:1717/OauthRedirect</callbackUrl>
    <certificate>${crtContent}</certificate>
    <consumerKey>${consumerKey}</consumerKey>
    <externalClientApplication>${appName}</externalClientApplication>
    <isClientCredentialsFlowEnabled>false</isClientCredentialsFlowEnabled>
    <isCodeCredFlowEnabled>false</isCodeCredFlowEnabled>
    <isCodeCredPostOnly>false</isCodeCredPostOnly>
    <isConsumerSecretOptional>true</isConsumerSecretOptional>
    <isDeviceFlowEnabled>false</isDeviceFlowEnabled>
    <isIntrospectAllTokens>false</isIntrospectAllTokens>
    <isNamedUserJwtEnabled>false</isNamedUserJwtEnabled>
    <isPkceRequired>false</isPkceRequired>
    <isRefreshTokenRotationEnabled>false</isRefreshTokenRotationEnabled>
    <isSecretRequiredForRefreshToken>false</isSecretRequiredForRefreshToken>
    <isSecretRequiredForTokenExchange>false</isSecretRequiredForTokenExchange>
    <isTokenExchangeEnabled>false</isTokenExchangeEnabled>
    <label>${appName} Global OAuth</label>
    <shouldRotateConsumerKey>false</shouldRotateConsumerKey>
    <shouldRotateConsumerSecret>false</shouldRotateConsumerSecret>
</ExtlClntAppGlobalOauthSettings>`;

  // 4. ExtlClntAppOauthConfigurablePolicies (.ecaOauthPlcy-meta.xml)
  // - 4 hours refresh token validity
  // - Admin approved / pre-authorized for selected profile
  const ecaOauthPolicies = `<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppOauthConfigurablePolicies xmlns="http://soap.sforce.com/2006/04/metadata">
    <commaSeparatedProfile>${profileName}</commaSeparatedProfile>
    <externalClientApplication>${appName}</externalClientApplication>
    <ipRelaxationPolicyType>Enforce</ipRelaxationPolicyType>
    <isClientCredentialsFlowEnabled>false</isClientCredentialsFlowEnabled>
    <isGuestCodeCredFlowEnabled>false</isGuestCodeCredFlowEnabled>
    ${getApiVersionNumber(conn) >= 61 && getApiVersionNumber(conn) <= 63 ? '<isNamedUserJwtEnabled>true</isNamedUserJwtEnabled>' : ''}
    <isTokenExchangeFlowEnabled>false</isTokenExchangeFlowEnabled>
    <label>${appName}OAuthSettings_defaultPolicy</label>
    <permittedUsersPolicyType>AdminApprovedPreAuthorized</permittedUsersPolicyType>
    <refreshTokenPolicyType>SpecificLifetime</refreshTokenPolicyType>
    <refreshTokenValidityPeriod>4</refreshTokenValidityPeriod>
    <refreshTokenValidityUnit>Hours</refreshTokenValidityUnit>
    <requiredSessionLevel>STANDARD</requiredSessionLevel>
</ExtlClntAppOauthConfigurablePolicies>`;

  // 5. ExtlClntAppConfigurablePolicies (.ecaPlcy-meta.xml)
  const extlClntAppPolicies = `<?xml version="1.0" encoding="UTF-8"?>
<ExtlClntAppConfigurablePolicies xmlns="http://soap.sforce.com/2006/04/metadata">
    <externalClientApplication>${appName}</externalClientApplication>
    <isEnabled>true</isEnabled>
    <isOauthPluginEnabled>true</isOauthPluginEnabled>
    <label>${appName}_defaultPolicy</label>
</ExtlClntAppConfigurablePolicies>`;

  // 6. Package.xml
  const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>${appName}</members>
        <name>ExternalClientApplication</name>
    </types>
    <types>
        <members>${appName}OAuthSettings</members>
        <name>ExtlClntAppOauthSettings</name>
    </types>
    <types>
        <members>${appName}GlblOAuth</members>
        <name>ExtlClntAppGlobalOauthSettings</name>
    </types>
    <types>
        <members>${appName}OAuthSettings_defaultPolicy</members>
        <name>ExtlClntAppOauthConfigurablePolicies</name>
    </types>
    <types>
        <members>${appName}_defaultPolicy</members>
        <name>ExtlClntAppConfigurablePolicies</name>
    </types>
    <version>${getApiVersion()}</version>
</Package>`;

  // Create directories
  const externalClientAppsDir = path.join(tmpDir, 'externalClientApps');
  const extlClntAppOauthSettingsDir = path.join(tmpDir, 'extlClntAppOauthSettings');
  const extlClntAppGlobalOauthSetsDir = path.join(tmpDir, 'extlClntAppGlobalOauthSets');
  const extlClntAppOauthPoliciesDir = path.join(tmpDir, 'extlClntAppOauthPolicies');
  const extlClntAppPoliciesDir = path.join(tmpDir, 'extlClntAppPolicies');

  await fs.ensureDir(externalClientAppsDir);
  await fs.ensureDir(extlClntAppOauthSettingsDir);
  await fs.ensureDir(extlClntAppGlobalOauthSetsDir);
  await fs.ensureDir(extlClntAppOauthPoliciesDir);
  await fs.ensureDir(extlClntAppPoliciesDir);

  // Write files
  await fs.writeFile(path.join(tmpDir, 'package.xml'), packageXml);
  await fs.writeFile(
    path.join(externalClientAppsDir, `${appName}.eca-meta.xml`),
    ecaMetadata
  );
  await fs.writeFile(
    path.join(extlClntAppOauthSettingsDir, `${appName}OAuthSettings.ecaOauth-meta.xml`),
    ecaOauthSettings
  );
  await fs.writeFile(
    path.join(extlClntAppGlobalOauthSetsDir, `${appName}GlblOAuth.ecaGlblOauth-meta.xml`),
    ecaGlobalOauthSettings
  );
  await fs.writeFile(
    path.join(extlClntAppOauthPoliciesDir, `${appName}OAuthSettings_defaultPolicy.ecaOauthPlcy-meta.xml`),
    ecaOauthPolicies
  );
  await fs.writeFile(
    path.join(extlClntAppPoliciesDir, `${appName}_defaultPolicy.ecaPlcy-meta.xml`),
    extlClntAppPolicies
  );
}

// Generate SSL certificate in temporary folder and copy the key in project directory
export async function generateSSLCertificate(
  branchName: string,
  folder: string,
  commandThis: any,
  conn: any,
  options: any
) {
  // Ask the user whether sfdx-hardis should generate a self-signed certificate, or whether they want
  // to use their own CA-signed certificate (in that case, the External Client App must be created manually).
  if (!isCI && !isAgentMode()) {
    const certSourceResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright(t('howDoYouWantToProvideCertificate')),
      description: t('descHowDoYouWantToProvideCertificate'),
      choices: [
        {
          title: t('titleSelfSignedCertificate'),
          value: 'selfSigned',
          description: t('descSelfSignedCertificate'),
        },
        {
          title: t('titleCaSignedCertificate'),
          value: 'caSigned',
          description: t('descCaSignedCertificate'),
        },
      ],
      initial: 0,
    });
    if (certSourceResponse.value === 'caSigned') {
      await configureCaSignedCertificate(branchName, commandThis);
      return { mode: 'caSigned' as const };
    }
  }
  uxLog("action", commandThis, c.cyan(t('generatingSslCertificate')));
  const tmpDir = await createTempDir();
  const prevDir = process.cwd();
  process.chdir(tmpDir);
  try {
    const sslCommand =
      'openssl req -nodes -newkey rsa:2048 -keyout server.key -out server.csr -subj "/C=GB/ST=Paris/L=Paris/O=Hardis Group/OU=sfdx-hardis/CN=hardis-group.com"';
    await execCommand(sslCommand, this, { output: true, fail: true });
    await execCommand('openssl x509 -req -sha256 -days 3650 -in server.csr -signkey server.key -out server.crt', this, {
      output: true,
      fail: true,
    });
  } catch (e) {
    uxLog("error", commandThis, c.red(t('errorGeneratingSslCertificate')));
    throw e;
  }
  process.chdir(prevDir);
  // Copy certificate key in local project
  await fs.ensureDir(folder);
  const targetKeyFile = path.join(folder, `${branchName}.key`);
  await fs.copy(path.join(tmpDir, 'server.key'), targetKeyFile);
  const encryptionKey = await encryptFile(targetKeyFile);
  WebSocketClient.sendReportFileMessage(targetKeyFile, t('encryptedSslCertificateKeyForBranch', { branchName }), 'report');
  const encryptedCertificateValue = await fs.readFile(targetKeyFile, 'utf8');
  // Copy certificate file in user home project
  const crtFile = path.join(os.homedir(), `${branchName}.crt`);
  await fs.copy(path.join(tmpDir, 'server.crt'), crtFile);
  // delete temporary cert folder
  await fs.remove(tmpDir);
  // Generate random consumer key for the External Client App
  const consumerKey = crypto.randomBytes(256).toString('base64').substr(0, 119);

  // Ask user if he/she wants to create the External Client App
  const confirmResponse = await prompts({
    type: 'confirm',
    name: 'value',
    initial: true,
    message: c.cyanBright(t('doYouWantSfdxHardisToConfigureApp')),
    description: t('descCreateConnectedApp'),
  });
  if (confirmResponse.value === true) {
    const clientIdStringRaw = `SFDX_CLIENT_ID_${branchName.toUpperCase()}`;
    const clientKeyStringRaw = `SFDX_CLIENT_KEY_${branchName.toUpperCase()}`;
    const clientCertStringRaw = `SFDX_CLIENT_CERT_${branchName.toUpperCase()}`;

    // With external storage, only the encrypted certificate goes to a password manager;
    // the other secrets (client id, decryption key) still go to CI/CD variables.
    const externalStorage = options.externalStorage === true;
    const certStorageResponse = externalStorage
      ? { value: 'file' }
      : await prompts({
        type: 'select',
        name: 'value',
        message: c.cyanBright(t('whichJwtCertificateStorageModeDoYouWant')),
        description: t('descSelectJwtCertificateStorageMode'),
        choices: [
          {
            title: t('titleJwtCertificateAsEncryptedFile'),
            value: 'file',
            description: t('descJwtCertificateAsEncryptedFile')
          },
          {
            title: t('titleJwtCertificateAsCiVariable'),
            value: 'variable',
            description: t('descJwtCertificateAsCiVariable')
          },
        ],
        initial: 0,
      });
    // True when the encrypted certificate is stored as a CI/CD variable (SFDX_CLIENT_CERT)
    const storeCertificateInVariable = !externalStorage && certStorageResponse.value === 'variable';
    // True when the committed encrypted certificate file must be removed from the repo
    const removeCertFileFromRepo = externalStorage || storeCertificateInVariable;

    const idKeyValues = {
      clientIdString: clientIdStringRaw,
      clientIdValueString: consumerKey,
      clientKeyString: clientKeyStringRaw,
      clientKeyValueString: encryptionKey,
      clientCertString: clientCertStringRaw,
      clientCertValueString: encryptedCertificateValue,
    };
    // Add <copy></copy> around values if we have VsCode UI to allow to display copy icon
    if (WebSocketClient.isAliveWithLwcUI()) {
      for (const key of Object.keys(idKeyValues)) {
        idKeyValues[key] = `<copy>${idKeyValues[key]}</copy>`;
      }
    }

    uxLog(
      "action",
      commandThis,
      c.cyan(t(storeCertificateInVariable ? 'pleaseConfigureThreeBelowVariablesInYour' : 'pleaseConfigureBothBelowVariablesInYour'))
    );
    uxLog(
      "log",
      commandThis,
      c.grey(
        c.cyanBright(
          `- Variable: ${c.green(
            c.bold(idKeyValues.clientIdString)
          )}
          - Value: ${c.bold(c.green(idKeyValues.clientIdValueString))}`
        )),
      { sensitive: true }
    );
    uxLog(
      "log",
      commandThis,
      c.grey(c.cyanBright(
        `- Variable: ${c.green(
          c.bold(idKeyValues.clientKeyString)
        )}
        - Value: ${c.bold(c.green(idKeyValues.clientKeyValueString))}`
      )),
      { sensitive: true }
    );
    if (storeCertificateInVariable) {
      uxLog(
        "log",
        commandThis,
        c.grey(c.cyanBright(
          `- Variable: ${c.green(
            c.bold(idKeyValues.clientCertString)
          )}
          - Value: ${c.bold(c.green(idKeyValues.clientCertValueString))}`
        )),
        { sensitive: true }
      );
    }
    uxLog(
      "log",
      commandThis,
      c.grey(c.yellow(t('helpToConfigureCiCdVariablesUrl', { url: `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/` })))
    );
    uxLog(
      "warning",
      commandThis,
      c.yellow(
        t(
          storeCertificateInVariable ? 'ifYouAreUsingGithubOrAzureWithClientCert' : 'ifYouAreUsingGithubOrAzure',
          { clientIdStringRaw, clientKeyStringRaw, clientCertStringRaw }
        )
      )
    );
    // External storage: the encrypted certificate must be kept in a password manager, not in the repo nor a CI/CD variable
    if (externalStorage) {
      uxLog("action", commandThis, c.cyan(t('pleaseStoreEncryptedCertInPasswordManager')));
      uxLog(
        "log",
        commandThis,
        c.grey(c.cyanBright(`- ${c.bold(c.green(idKeyValues.clientCertString))}\n- Value: ${c.bold(c.green(idKeyValues.clientCertValueString))}`)),
        { sensitive: true }
      );
      uxLog("warning", commandThis, c.yellow(t('externalStorageCertNotCommitted')));
    }

    if (removeCertFileFromRepo) {
      await fs.remove(targetKeyFile);
      uxLog("log", commandThis, c.cyan(t('encryptedCertificateKeyFileDeletedLocally', { targetKeyFile })));
    }

    WebSocketClient.sendReportFileMessage(`${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`, t('helpToConfigureCiVariables'), "docUrl");
    await prompts({
      type: 'confirm',
      message: c.cyanBright(externalStorage ? t('pleaseConfirmWhenSecretsStoredInPasswordManager') : t('pleaseConfirmWhenVariablesHaveBeenSet')),
      description: t('descConfirmCiCdVariables'),
    });

    // Build default app name from branch name by replacing all non-alphanumeric characters with empty string
    let appNameDflt = branchName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    // Replace "monitoring" by "mon"
    appNameDflt = appNameDflt.replace(/monitoring/g, 'mon');
    // Remove multiple "_" in the name
    appNameDflt = appNameDflt.replace(/_+/g, '_');
    // Truncate to 20 characters max
    if (appNameDflt.length > 20) {
      appNameDflt = appNameDflt.substring(0, 20);
    }
    // Use the app name provided by the caller (CLI flag) if available, else the computed default
    const appNameInitial = options.appName ? options.appName : 'sfdxhardis' + appNameDflt;

    // Read certificate content (shared by both flows)
    const crtContent = await fs.readFile(crtFile, 'utf8');

    const buildDeployParamsForAuthMetadata = async (deployDir: string): Promise<any> => {
      const isProduction = await isProductionOrg(options.targetUsername || null, { conn: conn });
      const deployParams: any = {
        deployDir,
        testlevel: isProduction ? 'RunLocalTests' : 'NoTestRun',
        targetUsername: options.targetUsername ? options.targetUsername : null,
      };

      if (!isProduction) {
        return deployParams;
      }

      let uniqueTestClass = process.env.SFDX_HARDIS_TECH_DEPLOY_TEST_CLASS || null;
      if (!uniqueTestClass) {
        const testClasses = await conn.tooling.query(
          "SELECT Id, Name FROM ApexClass WHERE Name LIKE '%Test%' OR Name LIKE '%test%' OR Name LIKE '%TEST%' ORDER BY Name LIMIT 1"
        );
        if (testClasses.totalSize > 0) {
          uniqueTestClass = testClasses.records[0].Name;
        }
      }
      if (uniqueTestClass) {
        deployParams.testlevel = 'RunSpecifiedTests';
        deployParams.runTests = [uniqueTestClass];
        uxLog(
          "log",
          commandThis,
          c.grey(t('productionOrgDetectedWillRunTestClass', { testClass: uniqueTestClass }))
        );
      }

      return deployParams;
    };

    type AuthMetadataType = 'ExternalClientApplication' | 'ConnectedApp';

    const metadataTypeLabels: Record<AuthMetadataType, string> = {
      ExternalClientApplication: 'External Client App',
      ConnectedApp: 'Connected App',
    };

    const metadataItemExists = async (metadataType: AuthMetadataType, fullName: string): Promise<boolean> => {
      try {
        const readResult = await conn.metadata.read(metadataType, fullName);
        const candidates = Array.isArray(readResult) ? readResult : [readResult];
        return candidates.some((item: any) => {
          if (!item || item.statusCode) {
            return false;
          }
          const candidateName = (item.fullName || item.fullname || '').toString().toLowerCase();
          return candidateName === fullName.toLowerCase();
        });
      } catch (error: any) {
        const statusCode = error?.result?.statusCode || error?.statusCode;
        if (statusCode === 'INVALID_CROSS_REFERENCE_KEY' || statusCode === 'INVALID_TYPE') {
          return false;
        }
        uxLog(
          "warning",
          commandThis,
          c.yellow(t('unableToVerifyExistingMetadata', { metadataType: metadataTypeLabels[metadataType] || metadataType, message: error.message }))
        );
        return false;
      }
    };

    const ensureAuthMetadataSlotIsFree = async (metadataInfo: {
      type: AuthMetadataType;
      fullName: string;
      friendlyLabel?: string;
    }): Promise<void> => {
      const label = metadataInfo.friendlyLabel || metadataTypeLabels[metadataInfo.type] || metadataInfo.type;
      let alreadyExists = await metadataItemExists(metadataInfo.type, metadataInfo.fullName);
      if (!alreadyExists) {
        return;
      }
      const orgLabel = options.targetUsername || 'target org';
      const setupLocation = metadataInfo.type === "ExternalClientApplication" ? "External Client App Manager" : "App Manager";
      let promptMessage = t('metadataAlreadyExistsHaveYouDeleted', { label, fullName: metadataInfo.fullName, orgLabel, setupLocation });
      while (alreadyExists) {
        const confirmation = await prompts({
          type: 'confirm',
          name: 'value',
          initial: true,
          message: c.cyanBright(promptMessage),
          description: t('descSelectAfterDeletion'),
        });
        if (!confirmation.value) {
          throw new SfError(`[sfdx-hardis] Deployment canceled: ${label} ${metadataInfo.fullName} still exists.`);
        }
        alreadyExists = await metadataItemExists(metadataInfo.type, metadataInfo.fullName);
        if (alreadyExists) {
          promptMessage = t('metadataStillDetectedInOrg', { label, fullName: metadataInfo.fullName, orgLabel });
        }
      }
    };

    const deployAuthMetadataAndCleanup = async (
      deployDir: string,
      successLabel: string,
      metadataInfo?: { type: AuthMetadataType; fullName: string; friendlyLabel?: string }
    ): Promise<void> => {
      if (metadataInfo) {
        await ensureAuthMetadataSlotIsFree(metadataInfo);
      }
      const deployParams = await buildDeployParamsForAuthMetadata(deployDir);
      const deployRes = await deployMetadatas(deployParams);
      if (deployRes?.status !== 0) {
        throw new Error('[sfdx-hardis] Failed to deploy metadatas');
      }
      uxLog("action", commandThis, c.cyan(t('successfullyDeployed', { successLabel: c.green(successLabel) })));
      // Cleanup temporary metadata directory and local certificate after successful deployment
      await fs.remove(deployDir);
      await fs.remove(crtFile);
    };

    // ========== EXTERNAL CLIENT APP FLOW ==========
    // Connected Apps can no longer be created in Salesforce orgs, so always create an External Client App
    const promptResponses = await prompts([
      {
        type: 'text',
        name: 'appName',
        initial: appNameInitial,
        message: c.cyanBright(t('howWouldYouLikeToNameThe2')),
        description: t('descExternalClientAppName'),
        placeholder: t('exSfdxHardis'),
      },
    ]);
    const contactEmail = await promptUserEmail(
      t('enterContactEmailExternalClientApp')
    );

    const profileSelection = await promptProfiles(conn, {
      multiselect: false,
      message: t('whatProfileWillBePreAuthorizedFor'),
      initialSelection: ['System Administrator', 'Administrateur Système'],
    });

    const selectedProfile = Array.isArray(profileSelection)
      ? (profileSelection[0] as string)
      : (profileSelection as string);

    // Resolve the External Client App description according to its usage.
    // CI/CD and monitoring descriptions are stored in the org metadata, so they are always in English (not localized).
    const usageType = options.usageType === 'monitoring' || options.usageType === 'other' ? options.usageType : 'cicd';
    let appDescription: string;
    if (usageType === 'monitoring') {
      appDescription = `External Client App used by sfdx-hardis for org monitoring authentication. Documentation: ${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-config-home/`;
    } else if (usageType === 'other') {
      appDescription = options.appDescription
        ? options.appDescription
        : (await prompts({
          type: 'text',
          name: 'value',
          message: c.cyanBright(t('whatIsExternalClientAppDescription')),
          description: t('descExternalClientAppDescription'),
          placeholder: t('placeholderExternalClientAppDescription'),
        })).value;
    } else {
      appDescription = `External Client App used by sfdx-hardis for CI/CD authentication. Documentation: ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`;
    }

    // Sanitize app name for metadata
    const sanitizedAppName = promptResponses.appName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || 'sfdxhardis';

    // Create metadata folder and generate ECA metadata files
    const tmpDirMd = await createTempDir();
    await generateExternalClientAppMetadata(
      sanitizedAppName,
      selectedProfile || 'System Administrator',
      contactEmail,
      crtContent,
      consumerKey,
      tmpDirMd,
      conn,
      appDescription
    );

    // Deploy metadatas (retry loop to handle the "External Client App already exists" case)
    let deployed = false;
    while (!deployed) {
      try {
        uxLog(
          "action",
          commandThis,
          c.cyan(t('deployingExternalClientApp', { appName: c.bold(sanitizedAppName), targetUsername: options.targetUsername || '' }))
        );

        // Log metadata info (hide sensitive data)
        uxLog("log", commandThis, c.grey(t('externalClientAppMetadataFiles', { appName: sanitizedAppName })));

        uxLog(
          "log",
          commandThis,
          c.grey(c.yellow(t('ifUploadErrorReadMessageAfterExternal')))
        );

        await deployAuthMetadataAndCleanup(tmpDirMd, `${sanitizedAppName} External Client App`, {
          type: 'ExternalClientApplication',
          fullName: sanitizedAppName,
          friendlyLabel: 'External Client App',
        });
        deployed = true;
      } catch (e) {
        if (isAuthAppAlreadyExistsError(e)) {
          // The app (or its consumer key) already exists: ask the user to delete it in Setup, then retry or give up
          const setupUrl = `${conn.instanceUrl}/lightning/setup/ExternalClientAppsManager/home`;
          uxLog("error", commandThis, c.red(t('externalClientAppAlreadyExists', { appName: sanitizedAppName })));
          uxLog("warning", commandThis, c.yellow(t('deleteExternalClientAppInSetup', { setupUrl })));
          WebSocketClient.sendReportFileMessage(setupUrl, t('openExternalClientAppManager'), "actionUrl");
          const existsResponse = await prompts({
            type: 'select',
            name: 'value',
            message: c.cyanBright(t('externalClientAppExistsWhatToDo')),
            description: t('descExternalClientAppExistsWhatToDo'),
            choices: [
              { title: t('retryDeployExternalClientApp'), value: 'retry' },
              { title: t('giveUpExternalClientApp'), value: 'giveUp' },
            ],
            initial: 0,
          });
          if (existsResponse.value === 'giveUp') {
            throw new SfError(t('externalClientAppDeploymentCancelled', { appName: sanitizedAppName }));
          }
          // else: loop again and retry the deployment
        } else {
          // Any other error: fall back to manual instructions and stop retrying
          uxLog(
            "error",
            commandThis,
            c.red(t('errorPushingExternalClientAppMetadata'))
          );
          uxLog(
            "warning",
            commandThis,
            c.yellow(t('manualInstructionsExternalClientApp', { appName: sanitizedAppName, contactEmail, crtFile: c.bold(crtFile), branchNameUpper: branchName.toUpperCase() })));
          await prompts({
            type: 'confirm',
            message: c.cyanBright(
              t('youNeedToManuallyConfigureTheExternalClientApp')
            ),
            description: t('descConfirmExternalClientApp'),
          });
          break;
        }
      }
    }
  } else {
    // Tell infos to install manually
    uxLog("action", commandThis, c.cyan(t('nowYouCanConfigureTheSfCli')));
    uxLog(
      "log",
      commandThis,
      c.grey(t('followInstructionsConnectedApp'))
    );
    uxLog(
      "log",
      commandThis,
      c.grey(t('useCertificateOnConnectedApp', { crtFile: c.green(crtFile) }))
    );
    uxLog(
      "log",
      commandThis,
      c.grey(t('configureCiVariableClientId', { branchNameUpper: branchName.toUpperCase() }))
    );
    uxLog(
      "log",
      commandThis,
      c.grey(t('configureCiVariableClientKey', { branchNameUpper: branchName.toUpperCase(), encryptionKey: c.green(encryptionKey) }))
    );
  }
  return { mode: 'selfSigned' as const };
}

// Bring-your-own CA-signed certificate flow.
// sfdx-hardis does NOT generate the cert, does NOT create the External Client App, and does NOT
// touch the repo or CI variables. The user is fully in charge of:
//   1) creating the External Client App manually in Setup (with their CA-signed certificate
//      uploaded as Digital Signature, and the CI user's profile pre-authorized),
//   2) setting SFDX_CLIENT_ID_<ALIAS> and SFDX_CLIENT_CERT_<ALIAS> CI/CD variables
//      (raw PEM key, no encryption, no SFDX_CLIENT_KEY_<ALIAS> needed).
// We just show the instructions and point at the documentation.
async function configureCaSignedCertificate(branchName: string, commandThis: any) {
  const aliasUpper = branchName.toUpperCase();
  const clientIdVar = `SFDX_CLIENT_ID_${aliasUpper}`;
  const clientCertVar = `SFDX_CLIENT_CERT_${aliasUpper}`;
  const docUrl = `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/#use-a-ca-signed-certificate`;

  uxLog("action", commandThis, c.cyan(t('caSignedConfigureForBranch', { branchName: c.bold(branchName) })));
  uxLog("log", commandThis, c.grey(t('caSignedManualEcaInstructions')));
  uxLog("action", commandThis, c.cyan(t('caSignedSetCiVariables')));
  uxLog(
    "log",
    commandThis,
    c.grey(
      `- ${c.green(c.bold(clientIdVar))}: Consumer Key of the External Client App\n- ${c.green(c.bold(clientCertVar))}: full PEM content of your private key (including BEGIN/END lines)`
    )
  );
  uxLog("log", commandThis, c.grey(c.yellow(t('helpToConfigureCiCdVariablesUrl', { url: docUrl }))));

  WebSocketClient.sendReportFileMessage(docUrl, t('helpToConfigureCiVariables'), 'docUrl');

  uxLog("action", commandThis, c.green(t('caSignedConfigurationComplete', { branchName })));
}

export async function isMonitoringJob() {
  if (process.env.SFDX_HARDIS_MONITORING === 'true') {
    return true;
  }
  if (!isCI) {
    return false;
  }
  const repoName = await git().revparse('--show-toplevel');
  if (isCI && repoName.includes('monitoring')) {
    return true;
  }
  return false;
}

export function getNested(nestedObj, pathArr) {
  return pathArr.reduce((obj, key) => (obj && obj[key] !== 'undefined' ? obj[key] : undefined), nestedObj);
}

const ansiPattern = [
  '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
  '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
].join('|');
const ansiRegex = new RegExp(ansiPattern, 'g');

export function stripAnsi(str: string) {
  if (typeof str !== 'string') {
    uxLog("warning", this, c.yellow(t('warningStripansiExpectsString')));
    return '';
  }
  return str.replace(ansiRegex, '');
}

export function findJsonInString(inputString: string) {
  // Regular expression to match a JSON object
  const jsonMatch = stripAnsi(inputString).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const jsonObject = JSON.parse(jsonMatch[0]); // Extract and parse JSON
      return jsonObject;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      return null;
    }
  }
  return null;
}

export function replaceJsonInString(inputString: string, jsonObject: any): string {
  // Regular expression to match a JSON object
  const jsonMatch = stripAnsi(inputString).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const jsonString = JSON.stringify(jsonObject, null, 2);
      return stripAnsi(inputString).replace(jsonMatch[0], jsonString);
    } catch (err: any) {
      uxLog("warning", this, c.yellow(t('warningUnableToReplaceJsonInString') + err.message));
      return inputString;
    }
  }
  uxLog("warning", this, c.yellow(t('warningUnableToFindJsonToReplace')));
  return inputString;
}

// Ugly hack but no choice
// It happens that in case of huge logs, process.exit triggers a blocking error.
// Remove them, as anyway we want to stop the process.
export function killBoringExitHandlers() {
  const listeners = process.listeners('exit');
  for (const listener of listeners) {
    if (listener.toString().includes("function onExit ()")) {
      process.removeListener('exit', listener);
    }
  }
}

export async function isDockerRunning(): Promise<boolean> {
  try {
    await exec("docker info");
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  catch (e) {
    return false;
  }
  return true;
}

export function sortCrossPlatform(arr: any[]) {
  return arr.sort((a, b) => {
    // Normalize to string in case elements are not strings
    const strA = String(a).normalize('NFD');
    const strB = String(b).normalize('NFD');

    // 1. Base comparison: case-insensitive, accent-insensitive
    const baseCompare = strA.localeCompare(strB, 'en', { sensitivity: 'base' });
    if (baseCompare !== 0) return baseCompare;

    // 2. Tie-breaker: uppercase before lowercase
    const isAUpper = strA[0] === strA[0].toUpperCase();
    const isBUpper = strB[0] === strB[0].toUpperCase();

    if (isAUpper && !isBUpper) return -1;
    if (!isAUpper && isBUpper) return 1;

    return 0;
  });
}

export function getExecutionContext(): "web" | "local" {
  const env = process.env;
  // GitHub Codespaces / github.dev
  if (env.CODESPACES || env.GITHUB_CODESPACE_TOKEN) {
    return "web";
  }
  // Salesforce Code Builder (commonly sets Salesforce-specific vars)
  if (env.CODE_BUILDER_URI) {
    return "web";
  }
  // Check for containerized/cloud workspaces
  if (env.CLOUD_SHELL || env.CLOUD_ENV) {
    return "web";
  }
  // Default: assume local
  return "local";
}
