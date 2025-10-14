import c from 'chalk';
import * as child from 'child_process';
import { spawn as crossSpawn } from 'cross-spawn';
import * as crypto from 'crypto';
import { stringify as csvStringify } from 'csv-stringify/sync';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

import * as util from 'util';
import which from 'which';
import * as xml2js from 'xml2js';
const exec = util.promisify(child.exec);
import { SfError } from '@salesforce/core';
import ora from 'ora';
import { simpleGit, FileStatusResult, SimpleGit } from 'simple-git';
import { CONSTANTS, getApiVersion, getConfig, getReportDirectory, setConfig } from '../../config/index.js';
import { prompts } from './prompts.js';
import { encryptFile } from '../cryptoUtils.js';
import { deployMetadatas, shortenLogLines } from './deployUtils.js';
import { isProductionOrg, promptProfiles, promptUserEmail } from './orgUtils.js';
import { LogType, WebSocketClient } from '../websocketClient.js';
import moment from 'moment';
import { writeXmlFile } from './xmlUtils.js';
import { SfCommand } from '@salesforce/sf-plugins-core';

let pluginsStdout: string | null = null;

export const isCI = process.env.CI != null;

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
      c.yellow(
        `[dependencies] Installing SF CLI plugin ${c.green(
          pluginName
        )}... \nIf it stays stuck for too long, please run ${c.green(`sf plugins install ${pluginName}`)}`
      )
    );
    const installCommand = `echo y|sf plugins install ${pluginName}`;
    await execCommand(installCommand, this, { fail: true, output: false });
  }
}

const dependenciesInstallLink = {
  git: 'Download installer at https://git-scm.com/downloads',
  openssl: 'Run "choco install openssl" in Windows Powershell, or use Git Bash as command line tool',
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
        c.red(
          `You need ${c.bold(appName)} to be locally installed to run this command.\n${dependenciesInstallLink[appName] || ''
          }`
        )
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
      title: '📝 Custom login URL (Sandbox, DevHub or Production Org)',
      description: `Recommended option 😊 Example: ${customLoginUrlExample}`,
      value: 'custom',
    },
    {
      title: '🧪 Sandbox or Scratch org (test.salesforce.com)',
      description: 'The org I want to connect is a sandbox or a scratch org',
      value: 'https://test.salesforce.com',
    },
    {
      title: '☢️ Other: Dev org, Production org or DevHub org (login.salesforce.com)',
      description: 'The org I want to connect is NOT a sandbox',
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
      description: 'Your current default org',
      value: defaultOrgChoice.instanceUrl,
    });
  }
  const orgTypeResponse = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(`What is the base URL or domain or the org you want to connect to, as ${alias} ?`),
    description: 'Select the Salesforce environment type or specify a custom URL for authentication',
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
    message: c.cyanBright('Please input the base URL of the salesforce org'),
    description: 'Copy paste the full URL of your currently open Salesforce org 😊',
    placeholder: 'Ex: https://myclient.my.salesforce.com , or myclient',
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
          message: c.cyanBright(
            'What is the URL of your git repository ?'
          ),
          description: 'Enter the full URL of the git repository to clone',
          placeholder: 'Ex: https://gitlab.hardis-group.com/busalesforce/monclient/monclient-org-monitoring.git',
        });
        cloneUrl = cloneUrlPrompt.value;
      }
      // Git lcone
      await new Promise((resolve) => {
        crossSpawn('git', ['clone', cloneUrl, '.'], { stdio: 'inherit' }).on('close', () => {
          resolve(null);
        });
      });
      uxLog("other", this, `Git repository cloned. ${c.yellow('Please run the same command again 😊')}`);
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
  const gitBranch = process.env.CI_COMMIT_REF_NAME || (await git().branchLocal()).current;
  if (options.formatted === true) {
    return gitBranch.replace('/', '__');
  }
  return gitBranch;
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
    message: options.message || 'Please select a Git branch',
    description: 'Choose a git branch to work with',
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
  await git().checkout(branchName);
  await gitPull();
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
    uxLog("error", this, c.red(`Git ${operation} failed due to authentication error in CI environment`));
    return false;
  }

  uxLog("warning", this, c.yellow(`Git ${operation} failed due to authentication error.`));
  uxLog("action", this, c.cyan('Please provide your Git credentials to continue.'));

  const usernamePrompt = await prompts({
    type: 'text',
    name: 'username',
    message: c.cyanBright('Enter your Git username'),
    description: 'Your Git service username',
    validate: (value: string) => (value && value.trim().length > 0) || 'Username is required',
  });

  if (!usernamePrompt.username) {
    uxLog("error", this, c.red('Git username is required to continue'));
    return false;
  }

  const passwordPrompt = await prompts({
    type: 'text',
    name: 'password',
    message: c.cyanBright('Enter your Git password or Personal Access Token (PAT)'),
    description: 'Your Git service password or PAT (input will be visible)',
    validate: (value: string) => (value && value.trim().length > 0) || 'Password/PAT is required',
  });

  if (!passwordPrompt.password) {
    uxLog("error", this, c.red('Git password/PAT is required to continue'));
    return false;
  }

  const username = usernamePrompt.username;
  const password = passwordPrompt.password;

  try {
    // Get current remote URL
    const origin = await git().getConfig('remote.origin.url');
    if (!origin || !origin.value) {
      uxLog("error", this, c.red('Could not retrieve remote origin URL'));
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
      uxLog("error", this, c.red('Only HTTP(S) remote URLs are supported for credential injection'));
      return false;
    }

    // Update the remote URL
    await git().remote(['set-url', 'origin', remoteUrl]);
    uxLog("action", this, c.green('Remote URL updated with credentials successfully'));
    return true;
  } catch (e: any) {
    uxLog("error", this, c.red(`Failed to update remote URL: ${e?.message || e}`));
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
        uxLog("action", this, c.cyan('Retrying git fetch with updated credentials.'));
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
        uxLog("action", this, c.cyan('Retrying git pull with updated credentials...'));
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
        uxLog("action", this, c.cyan('Retrying git push with updated credentials...'));
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
export async function ensureGitBranch(branchName: string, options: any = { init: false, parent: 'current' }) {
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
      // Existing branch: checkout & pull
      await git().checkout(branchName);
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
    }
  }
  return true;
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
        uxLog("warning", this, c.yellow(c.bold("You might need to run the following command in Powershell launched as Administrator")));
        uxLog("warning", this, c.yellow(c.bold("git config --system core.longpaths true")));
        throw e;
      }
    } else {
      throw new SfError(
        `[sfdx-hardis] Branch ${c.bold(gitStatus.current)} is not clean. You must ${c.bold(
          'commit or reset'
        )} the following local updates:\n${c.yellow(localUpdates)}`
      );
    }
  }
}

// Interactive git add
export async function interactiveGitAdd(options: any = { filter: [], groups: [] }) {
  if (!isGitRepo()) {
    throw new SfError('[sfdx-hardis] You must be within a git repository');
  }
  // List all files and arrange their format
  const config = await getConfig('project');
  const gitStatus = await git().status();
  let filesFiltered = gitStatus.files
    .filter((fileStatus: FileStatusResult) => {
      return (
        (options.filter || []).filter((filterString: string) => fileStatus.path.includes(filterString)).length === 0
      );
    })
    .map((fileStatus: FileStatusResult) => {
      fileStatus.path = normalizeFileStatusPath(fileStatus.path, config);
      return fileStatus;
    });
  // Create default group if
  let groups = options.groups || [];
  if (groups.length === 0) {
    groups = [
      {
        label: 'All',
        regex: /(.*)/i,
        defaultSelect: false,
        ignore: false,
      },
    ];
  }
  // Ask user what he/she wants to git add/rm
  const result: any = { added: [], removed: [] };
  if (filesFiltered.length > 0) {
    for (const group of groups) {
      // Extract files matching group regex
      const matchingFiles = filesFiltered.filter((fileStatus: FileStatusResult) => {
        return group.regex.test(fileStatus.path);
      });
      if (matchingFiles.length === 0) {
        continue;
      }
      // Remove remaining files list
      filesFiltered = filesFiltered.filter((fileStatus: FileStatusResult) => {
        return !group.regex.test(fileStatus.path);
      });
      // Ask user for input
      const selectFilesStatus = await prompts({
        type: 'multiselect',
        name: 'files',
        message: c.cyanBright(
          `Please select the ${c.bgWhite(
            c.red(c.bold(group.label.toUpperCase()))
          )} files you want to commit (save)}`
        ),
        description: 'Choose files to include in the git commit. Be careful with your selection.',
        choices: matchingFiles.map((fileStatus: FileStatusResult) => {
          return {
            title: `(${getGitWorkingDirLabel(fileStatus.working_dir)}) ${getSfdxFileLabel(fileStatus.path)}`,
            selected: group.defaultSelect || false,
            value: fileStatus,
          };
        }),
        optionsPerPage: 9999,
      });
      // Add to group list of files
      group.files = selectFilesStatus.files;
      // Separate added to removed files
      result.added.push(
        ...selectFilesStatus.files
          .filter((fileStatus: FileStatusResult) => fileStatus.working_dir !== 'D')
          .map((fileStatus: FileStatusResult) => fileStatus.path.replace('"', ''))
      );
      result.removed.push(
        ...selectFilesStatus.files
          .filter((fileStatus: FileStatusResult) => fileStatus.working_dir === 'D')
          .map((fileStatus: FileStatusResult) => fileStatus.path.replace('"', ''))
      );
    }
    if (filesFiltered.length > 0) {
      uxLog(
        "log",
        this,
        c.grey(
          'The following list of files has not been proposed for selection\n' +
          filesFiltered
            .map((fileStatus: FileStatusResult) => {
              return `  - (${getGitWorkingDirLabel(fileStatus.working_dir)}) ${getSfdxFileLabel(fileStatus.path)}`;
            })
            .join('\n')
        )
      );
    }
    // Ask user for confirmation
    const confirmationText = groups
      .filter((group) => group.files != null && group.files.length > 0)
      .map((group) => {
        return (
          c.bgWhite(c.red(c.bold(group.label))) +
          '\n' +
          group.files
            .map((fileStatus: FileStatusResult) => {
              return `  - (${getGitWorkingDirLabel(fileStatus.working_dir)}) ${getSfdxFileLabel(fileStatus.path)}`;
            })
            .join('\n') +
          '\n'
        );
      })
      .join('\n');
    const addFilesResponse = await prompts({
      type: 'select',
      name: 'addFiles',
      message: c.cyanBright(`Do you confirm that you want to add the following list of files ?\n${confirmationText}`),
      description: 'Confirm your file selection for the git commit',
      choices: [
        { title: 'Yes, my selection is complete !', value: 'yes' },
        { title: 'No, I want to select again', value: 'no' },
        { title: 'Let me out of here !', value: 'bye' },
      ],
      initial: 0,
    });
    // Commit if requested
    if (addFilesResponse.addFiles === 'yes') {
      if (result.added.length > 0) {
        await git({ output: true }).add(result.added);
      }
      if (result.removed.length > 0) {
        await git({ output: true }).rm(result.removed);
      }
    }
    // restart selection
    else if (addFilesResponse.addFiles === 'no') {
      return await interactiveGitAdd(options);
    }
    // exit
    else {
      uxLog("other", this, 'Cancelled by user.');
      process.exit(0);
    }
  } else {
    uxLog("action", this, c.cyan('There is no new file to commit'));
  }
  return result;
}

// Shortcut to add, commit and push
export async function gitAddCommitPush(
  options: any = {
    init: false,
    pattern: './*',
    commitMessage: 'Updated by sfdx-hardis',
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
    .commit(options.commitMessage || 'Updated by sfdx-hardis');
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

// Execute salesforce DX command with --json
export async function execSfdxJson(
  command: string,
  commandThis: any,
  options: any = {
    fail: false,
    output: false,
    debug: false,
  }
): Promise<any> {
  if (!command.includes('--json')) {
    command += ' --json';
  }
  return await execCommand(command, commandThis, options);
}

// Execute command
export async function execCommand(
  command: string,
  commandThis: SfCommand<any> | null,
  options: any = {
    fail: false,
    output: false,
    debug: false,
    spinner: true,
  }
): Promise<any> {
  let commandLog = `[sfdx-hardis][command] ${c.bold(c.bgWhite(c.blue(command)))}`;
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
  let commandResult: any = {};
  const output = options.output !== null ? options.output : !commandThis?.argv?.includes('--json');
  let spinner: any;
  if (output && !(options.spinner === false)) {
    spinner = ora({ text: commandLog, spinner: 'moon' }).start();
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
      if (options.retry != null) {
        options.retry.tryCount = (options.retry.tryCount || 0) + 1;
        if (
          options.retry.tryCount <= (options.retry.retryMaxAttempts || 1) &&
          (options.retry.retryStringConstraint == null ||
            ((e as any).stdout + (e as any).stderr).includes(options.retry.retryStringConstraint))
        ) {
          uxLog(
            "warning",
            commandThis,
            c.yellow(`Retry command: ${options.retry.tryCount} on ${options.retry.retryMaxAttempts || 1}`)
          );
          if (options.retry.retryDelay) {
            uxLog("other", this, `Waiting ${options.retry.retryDelay} seconds before retrying command`);
            await new Promise((resolve) => setTimeout(resolve, options.retry.retryDelay * 1000));
          }
          return await execCommand(command, commandThis, options);
        }
      }
      throw e;
    }
    // if --json, we should not have a crash, so return status 1 + output log
    return {
      status: 1,
      errorMessage: `[sfdx-hardis][ERROR] Error processing command\n$${(e as any).stdout}\n${(e as any).stderr}`,
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
  try {
    const parsedResult = JSON.parse(commandResult.stdout);
    if (options.fail && parsedResult.status && parsedResult.status > 0) {
      throw new SfError(c.red(`[sfdx-hardis][ERROR] Command failed: ${commandResult}`));
    }
    if (commandResult.stderr && commandResult.stderr.length > 2) {
      uxLog("other", this, '[sfdx-hardis][WARNING] stderr: ' + c.yellow(commandResult.stderr));
    }
    return parsedResult;
  } catch (e) {
    // Manage case when json is not parseable
    return {
      status: 1,
      errorMessage: c.red(
        `[sfdx-hardis][ERROR] Error parsing JSON in command result: ${(e as Error).message}\n${commandResult.stdout}\n${commandResult.stderr
        })`
      ),
    };
  }
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

function getGitWorkingDirLabel(workingDir) {
  return workingDir === '?' ? 'CREATED' : workingDir === 'D' ? 'DELETED' : workingDir === 'M' ? 'UPDATED' : 'OOOOOPS';
}

const elapseAll = {};
export function elapseStart(text) {
  elapseAll[text] = process.hrtime.bigint();
}
export function elapseEnd(text: string, commandThis: any = this) {
  if (elapseAll[text]) {
    const elapsed = Number(process.hrtime.bigint() - elapseAll[text]);
    const ms = elapsed / 1000000;
    uxLog("log", commandThis, c.grey(c.italic(text + ' ' + moment().startOf('day').milliseconds(ms).format('H:mm:ss.SSS'))));
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
  const manifest = await xml2js.parseStringPromise(initialFileContent);

  // Keep only namespaces
  if ((options.keepOnlyNamespaces || []).length > 0) {
    uxLog("log", this, c.grey(`Keeping items from namespaces ${options.keepOnlyNamespaces.join(',')} ...`));
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
    uxLog("log", this, c.grey(`Removing items from namespaces ${options.removeNamespaces.join(',')} ...`));
    manifest.Package.types = manifest.Package.types.map((type: any) => {
      type.members = type.members.filter((member: string) => {
        const startsWithNamespace = options.removeNamespaces.filter((ns: string) => member.startsWith(ns)).length > 0;
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
    const destructiveManifest = await xml2js.parseStringPromise(destructiveFileContent);
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
          uxLog("log", this, c.grey(`Removed ${type.name[0]} type`));
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
      uxLog("log", this, c.grey('removed ' + type.name[0]));
      return false;
    });
  }

  // Remove metadata types (named, and empty ones)
  manifest.Package.types = manifest.Package.types.filter(
    (type: any) => !(options.removeMetadatas || []).includes(type.name[0]) && (type?.members?.length || 0) > 0
  );
  const builder = new xml2js.Builder({ renderOpts: { pretty: true, indent: '  ', newline: '\n' } });
  const updatedFileContent = builder.buildObject(manifest);
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
  const csv = csvStringify(resultSorted, {
    delimiter: ';',
    header: true,
    columns,
  });
  await fs.writeFile(reportFile, csv, 'utf8');
  // Trigger command to open CSV file in VS Code extension
  try {
    if (!WebSocketClient.isAliveWithLwcUI()) {
      WebSocketClient.requestOpenFile(reportFile);
    }
    WebSocketClient.sendReportFileMessage(reportFile, `${logLabel} (CSV)`, "report");
  } catch (e: any) {
    uxLog("warning", commandThis, c.yellow(`[sfdx-hardis] Error opening file in VS Code: ${e.message}`));
  }
  const excel = csvStringify(resultSorted, {
    delimiter: '\t',
    header: true,
    columns,
  });
  await fs.writeFile(reportFileExcel, excel, 'utf8');
  WebSocketClient.sendReportFileMessage(reportFileExcel, `${logLabel} (CSV)`, "report");
  uxLog("action", commandThis, c.cyan(logLabel));
  uxLog("log", commandThis, c.grey(c.cyan(`- CSV: ${reportFile}`)));
  uxLog("log", commandThis, c.grey(c.cyan(`- XLS: ${reportFileExcel}`)));
  return [
    { type: 'csv', file: reportFile },
    { type: 'xls', file: reportFileExcel },
  ];
}

export function uxLog(logType: LogType, commandThis: any, textInit: string, sensitive = false) {
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
    if (sensitive && !text.includes('SFDX_CLIENT_ID_') && !text.includes('SFDX_CLIENT_KEY_')) {
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
        WebSocketClient.sendCommandLogLineMessage(textToSend, logType, isQuestion);
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
        sfdxHardisTruncatedMessage: `Truncated to the first ${maxLen} lines on ${displayData.length} total lines, see full report for more details.`,
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

// Generate SSL certificate in temporary folder and copy the key in project directory
export async function generateSSLCertificate(
  branchName: string,
  folder: string,
  commandThis: any,
  conn: any,
  options: any
) {
  uxLog("action", commandThis, c.cyan('Generating SSL certificate...'));
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
    uxLog("error", commandThis, c.red(`Error generating SSL certificate, please ensure you have openssl installed
- It is included in Git Bash for Windows
- You can also install it using "choco install openssl" if you have chocolatey installed
- If it is installed, make sure that paths to bash and openssl are available in PATH
- If you still have issues, run sfdx-hardis command in Git Bash terminal
`));
    throw e;
  }
  process.chdir(prevDir);
  // Copy certificate key in local project
  await fs.ensureDir(folder);
  const targetKeyFile = path.join(folder, `${branchName}.key`);
  await fs.copy(path.join(tmpDir, 'server.key'), targetKeyFile);
  const encryptionKey = await encryptFile(targetKeyFile);
  WebSocketClient.sendReportFileMessage(targetKeyFile, `Encrypted SSL certificate key for branch ${branchName}`, 'report');
  // Copy certificate file in user home project
  const crtFile = path.join(os.homedir(), `${branchName}.crt`);
  await fs.copy(path.join(tmpDir, 'server.crt'), crtFile);
  // delete temporary cert folder
  await fs.remove(tmpDir);
  // Generate random consumer key for Connected app
  const consumerKey = crypto.randomBytes(256).toString('base64').substr(0, 119);

  // Ask user if he/she wants to create connected app
  const confirmResponse = await prompts({
    type: 'confirm',
    name: 'value',
    initial: true,
    message: c.cyanBright(
      "Do you want sfdx-hardis to configure the SFDX connected app on your org ?"
    ),
    description: 'Creates a Connected App required for CI/CD authentication. Choose yes if you are unsure.',
  });
  if (confirmResponse.value === true) {
    uxLog("action", commandThis, c.cyan('Please configure both below variables in your CI/CD platform.\n(expand section below to see values)'));
    uxLog(
      "log",
      commandThis,
      c.grey(
        c.cyanBright(
          `${c.green(
            c.bold(`- SFDX_CLIENT_ID_${branchName.toUpperCase()}`)
          )} with value ${c.bold(c.green(consumerKey))}`
        )),
      true
    );
    uxLog(
      "log",
      commandThis,
      c.grey(c.cyanBright(
        `${c.green(
          c.bold(`- SFDX_CLIENT_KEY_${branchName.toUpperCase()}`)
        )} with value ${c.bold(c.green(encryptionKey))}`
      )),
      true
    );
    uxLog(
      "log",
      commandThis,
      c.grey(c.yellow(`Help to configure CI variables is here: ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`))
    );
    WebSocketClient.sendReportFileMessage(`${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`, "Help to configure CI variables", "docUrl");
    await prompts({
      type: 'confirm',
      message: c.cyanBright('Please confirm when variables have been set'),
      description: 'Confirm when you have configured the required CI/CD environment variables in your deployment platform',
    });
    // Build default app name from branch name by replacing all non-alphanumeric characters with empty string
    let appNameDflt = branchName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    if (appNameDflt.length > 20) {
      appNameDflt = appNameDflt.substring(0, 20);
    }
    // Request info for deployment
    const promptResponses = await prompts([
      {
        type: 'text',
        name: 'appName',
        initial: 'sfdxhardis' + appNameDflt,
        message: c.cyanBright('How would you like to name the Connected App ?'),
        description: 'Name for the Connected App that will be created in your Salesforce org',
        placeholder: 'Ex: sfdx_hardis',
      },
    ]);
    const contactEmail = await promptUserEmail(
      'Enter a contact email for the Connect App (ex: nicolas.vuillamy@cloudity.com)'
    );
    const profile = await promptProfiles(conn, {
      multiselect: false,
      message: 'What profile will be used for the connected app ? (ex: System Administrator)',
      initialSelection: ['System Administrator', 'Administrateur Système'],
    });
    const crtContent = await fs.readFile(crtFile, 'utf8');
    // Build ConnectedApp metadata
    const connectedAppMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<ConnectedApp xmlns="http://soap.sforce.com/2006/04/metadata">
  <contactEmail>${contactEmail}</contactEmail>
  <label>${promptResponses.appName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || 'sfdxhardis'}</label>
  <oauthConfig>
      <callbackUrl>http://localhost:1717/OauthRedirect</callbackUrl>
      <certificate>${crtContent}</certificate>
      <consumerKey>${consumerKey}</consumerKey>
      <isAdminApproved>true</isAdminApproved>
      <isConsumerSecretOptional>false</isConsumerSecretOptional>
      <isIntrospectAllTokens>false</isIntrospectAllTokens>
      <isSecretRequiredForRefreshToken>false</isSecretRequiredForRefreshToken>
      <scopes>Api</scopes>
      <scopes>Web</scopes>
      <scopes>RefreshToken</scopes>
  </oauthConfig>
  <oauthPolicy>
      <ipRelaxation>ENFORCE</ipRelaxation>
      <refreshTokenPolicy>specific_lifetime:3:HOURS</refreshTokenPolicy>
  </oauthPolicy>
  <profileName>${profile || 'System Administrator'}</profileName>
</ConnectedApp>
`;
    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${promptResponses.appName}</members>
    <name>ConnectedApp</name>
  </types>
  <version>${getApiVersion()}</version>
</Package>
`;
    // create metadata folder
    const tmpDirMd = await createTempDir();
    const connectedAppDir = path.join(tmpDirMd, 'connectedApps');
    await fs.ensureDir(connectedAppDir);
    await fs.writeFile(path.join(tmpDirMd, 'package.xml'), packageXml);
    await fs.writeFile(path.join(connectedAppDir, `${promptResponses.appName}.connectedApp`), connectedAppMetadata);

    // Deploy metadatas
    try {
      uxLog(
        "action",
        commandThis,
        c.cyan(
          `Deploying Connected App ${c.bold(promptResponses.appName)} into target org ${options.targetUsername || ''
          } ...`
        )
      );
      // Replace sensitive info in connectedAppMetadata for logging
      const connectedAppMetadataForLog = connectedAppMetadata
        .replace(consumerKey, '***CONSUMERKEY_HIDDEN_FROM_LOGS***')
        .replace(crtContent, '***CERTIFICATE_HIDDEN_FROM_LOGS***');

      uxLog("log", commandThis, c.grey(`Connected App metadatas XML:\n${connectedAppMetadataForLog}`));
      uxLog(
        "log",
        commandThis,
        c.grey(c.yellow(
          `If you have an upload error, PLEASE READ THE MESSAGE AFTER, that will explain how to manually create the connected app, and don't forget the CERTIFICATE file 😊`
        ))
      );
      const isProduction = await isProductionOrg(options.targetUsername || null, { conn: conn });
      const deployParams: any = {
        deployDir: tmpDirMd,
        testlevel: isProduction ? 'RunLocalTests' : 'NoTestRun',
        targetUsername: options.targetUsername ? options.targetUsername : null,
      };
      // If is Production org, find the first Apex test class to run
      if (isProduction) {
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
          uxLog("log", commandThis, c.grey(`Production org detected, will run test class found ${uniqueTestClass} on deployment.
If you want to specify a specific test class, set SFDX_HARDIS_TECH_DEPLOY_TEST_CLASS variable`));
        }
      }
      const deployRes = await deployMetadatas(deployParams);
      console.assert(deployRes.status === 0, c.red('[sfdx-hardis] Failed to deploy metadatas'));
      uxLog("action", commandThis, c.cyan(`Successfully deployed ${c.green(promptResponses.appName)} Connected App`));
      await fs.remove(tmpDirMd);
      await fs.remove(crtFile);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      uxLog(
        "error",
        commandThis,
        c.red(
          'Error pushing ConnectedApp metadata. Maybe the app name is already taken ?\nYou may try again with another connected app name'
        )
      );
      uxLog(
        "warning",
        commandThis,
        c.yellow(`
${c.bold('MANUAL INSTRUCTIONS')}
If this is a Test class issue (production env), you may have to create manually connected app ${promptResponses.appName
          }:
- Follow instructions here: https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_connected_app.htm
  - Use certificate ${c.bold(crtFile)} in "Use Digital Signature section" (delete the file from your computer after !)
- Once created, update CI/CD variable ${c.green(
            c.bold(`SFDX_CLIENT_ID_${branchName.toUpperCase()}`)
          )} with the ConsumerKey of the newly created connected app`)
      );
      await prompts({
        type: 'confirm',
        message: c.cyanBright(
          'You need to manually configure the connected app. Follow the MANUAL INSTRUCTIONS above, then continue here'
        ),
        description: 'Confirm when you have completed the manual Connected App configuration steps',
      });
    }
  } else {
    // Tell infos to install manually
    uxLog("action", commandThis, c.cyan('Now you can configure the SF CLI connected app'));
    uxLog(
      "log",
      commandThis,
      c.grey(
        `Follow instructions here: ${c.bold(
          'https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_connected_app.htm'
        )}`
      )
    );
    uxLog(
      "log",
      commandThis,
      c.grey(
        `Use ${c.green(crtFile)} as certificate on Connected App configuration page, ${c.bold(
          `then delete ${crtFile} for security`
        )}`
      )
    );
    uxLog(
      "log",
      commandThis,
      c.grey(
        `- configure CI variable ${c.green(
          `SFDX_CLIENT_ID_${branchName.toUpperCase()}`
        )} with value of ConsumerKey on Connected App configuration page`
      )
    );
    uxLog(
      "log",
      commandThis,
      c.grey(
        `- configure CI variable ${c.green(`SFDX_CLIENT_KEY_${branchName.toUpperCase()}`)} with value ${c.green(
          encryptionKey
        )} key`
      )
    );
  }
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
    uxLog("warning", this, c.yellow('Warning: stripAnsi expects a string'));
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
      uxLog("warning", this, c.yellow('Warning: unable to replace JSON in string:' + err.message));
      return inputString;
    }
  }
  uxLog("warning", this, c.yellow('Warning: unable to find json to replace in string'));
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
