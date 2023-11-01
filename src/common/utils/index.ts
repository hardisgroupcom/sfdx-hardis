import * as c from "chalk";
import * as child from "child_process";
import * as crossSpawn from "cross-spawn";
import * as crypto from "crypto";
import * as csvStringify from "csv-stringify/lib/sync";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import stripAnsi = require("strip-ansi");
import * as util from "util";
import * as which from "which";
import * as xml2js from "xml2js";
const exec = util.promisify(child.exec);
import { SfdxError } from "@salesforce/core";
import * as ora from "ora";
import simpleGit, { FileStatusResult, SimpleGit } from "simple-git";
import { CONSTANTS, getConfig, getReportDirectory, setConfig } from "../../config";
import { prompts } from "./prompts";
import { encryptFile } from "../cryptoUtils";
import { deployMetadatas, truncateProgressLogLines } from "./deployUtils";
import { promptProfiles, promptUserEmail } from "./orgUtils";
import { WebSocketClient } from "../websocketClient";
import moment = require("moment");
import { writeXmlFile } from "./xmlUtils";

let pluginsStdout = null;

export const isCI = process.env.CI != null;

export function git(options: any = { output: false }): SimpleGit {
  const simpleGitInstance = simpleGit();
  // Hack to be able to display executed git command (and it still doesn't work...)
  // cf: https://github.com/steveukx/git-js/issues/593
  return simpleGitInstance.outputHandler((command, stdout, stderr, gitArgs) => {
    let first = true;
    stdout.on("data", (data) => {
      logCommand();
      if (options.output) {
        uxLog(this, c.italic(c.grey(data)));
      }
    });
    stderr.on("data", (data) => {
      logCommand();
      if (options.output) {
        uxLog(this, c.italic(c.yellow(data)));
      }
    });
    function logCommand() {
      if (first) {
        first = false;
        const gitArgsStr = (gitArgs || []).join(" ");
        if (!(gitArgsStr.includes("branch -v") || gitArgsStr.includes("config --list --show-origin --null"))) {
          uxLog(this, `[command] ${c.bold(c.bgWhite(c.grey(command + " " + gitArgsStr)))}`);
        }
      }
    }
  });
}

export async function createTempDir() {
  const tmpDir = path.join(os.tmpdir(), "sfdx-hardis-" + Math.random().toString(36).substring(7));
  await fs.ensureDir(tmpDir);
  return tmpDir;
}

export function isGitRepo() {
  const isInsideWorkTree = child.spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return isInsideWorkTree.status === 0;
}

export async function getGitRepoName() {
  if (!isGitRepo) {
    return null;
  }
  const origin = await git().getConfig("remote.origin.url");
  if (origin.value && origin.value.includes("/")) {
    return /[^/]*$/.exec(origin.value)[0];
  }
  return null;
}

export async function gitHasLocalUpdates(options = { show: false }) {
  const changes = await git().status();
  if (options.show) {
    uxLog(this, c.cyan(JSON.stringify(changes)));
  }
  return changes.files.length > 0;
}

// Install plugin if not present
export async function checkSfdxPlugin(pluginName: string) {
  // Manage cache of sfdx plugins result
  if (pluginsStdout == null) {
    const config = await getConfig("user");
    if (config.sfdxPluginsStdout) {
      pluginsStdout = config.sfdxPluginsStdout;
    } else {
      const pluginsRes = await exec("sfdx plugins");
      pluginsStdout = pluginsRes.stdout;
      await setConfig("user", { sfdxPluginsStdout: pluginsStdout });
    }
  }
  if (!pluginsStdout.includes(pluginName)) {
    uxLog(
      this,
      c.yellow(
        `[dependencies] Installing sfdx plugin ${c.green(pluginName)}... \nIf is stays stuck for too long, please run ${c.green(
          `sfdx plugins:install ${pluginName}`,
        )})`,
      ),
    );
    const installCommand = `echo y|sfdx plugins:install ${pluginName}`;
    await execCommand(installCommand, this, { fail: true, output: false });
  }
}

const dependenciesInstallLink = {
  git: "Download installer at https://git-scm.com/downloads",
  openssl: 'Run "choco install openssl" in Windows Powershell, or use Git Bash as command line tool',
};

export async function checkAppDependency(appName) {
  const config = await getConfig("user");
  const installedApps = config.installedApps || [];
  if (installedApps.includes(appName)) {
    return true;
  }
  which(appName)
    .then(async () => {
      installedApps.push(appName);
      await setConfig("user", { installedApps: installedApps });
    })
    .catch(() => {
      uxLog(this, c.red(`You need ${c.bold(appName)} to be locally installed to run this command.\n${dependenciesInstallLink[appName] || ""}`));
      process.exit();
    });
}

export async function promptInstanceUrl(orgTypes = ["login", "test"], alias = "default org", defaultOrgChoice: any = null) {
  const allChoices = [
    {
      title: "Sandbox or Scratch org (test.salesforce.com)",
      description: "The org I want to connect is a sandbox",
      value: "https://test.salesforce.com",
    },
    {
      title: "Other: Dev, Enterprise or DevHub org (login.salesforce.com)",
      description: "The org I want to connect is NOT a sandbox",
      value: "https://login.salesforce.com",
    },
    {
      title: "Custom login URL",
      description: "When it's not possible to login via login.salesforce.com or test.salesforce.com",
      value: "custom",
    },
  ];
  const choices = allChoices.filter((choice) => {
    if (choice.value === "https://login.salesforce.com" && !orgTypes.includes("login")) {
      return false;
    }
    if (choice.value === "https://test.salesforce.com" && !orgTypes.includes("test")) {
      return false;
    }
    return true;
  });
  if (defaultOrgChoice != null) {
    choices.push({
      title: defaultOrgChoice.instanceUrl,
      description: "Your current default org",
      value: defaultOrgChoice.instanceUrl,
    });
  }
  const orgTypeResponse = await prompts({
    type: "select",
    name: "value",
    message: c.cyanBright(`What is the base URL or the org you want to connect to, as ${alias} ?`),
    choices: choices,
    initial: 1,
  });
  // login.salesforce.com or test.salesforce.com
  const url = orgTypeResponse.value;
  if (url.startsWith("http")) {
    return url;
  }
  // Custom url to input
  const customUrlResponse = await prompts({
    type: "text",
    name: "value",
    message: c.cyanBright("Please input the base URL of the salesforce org (ex: https://myclient.my.salesforce.com"),
  });
  const urlCustom = (customUrlResponse.value || []).replace(".lightning.force.com", ".my.salesforce.com");
  return urlCustom;
}

// Check if we are in a repo, or create it if missing
export async function ensureGitRepository(options: any = { init: false, clone: false, cloneUrl: null }) {
  if (!isGitRepo()) {
    // Init repo
    if (options.init) {
      await exec("git init -b main");
      console.info(c.yellow(c.bold(`[sfdx-hardis] Initialized git repository in ${process.cwd()}`)));
    } else if (options.clone) {
      // Clone repo
      let cloneUrl = options.cloneUrl;
      if (!cloneUrl) {
        // Request repo url if not provided
        const cloneUrlPrompt = await prompts({
          type: "text",
          name: "value",
          message: c.cyanBright(
            "What is the URL of your git repository ? example: https://gitlab.hardis-group.com/busalesforce/monclient/monclient-org-monitoring.git",
          ),
        });
        cloneUrl = cloneUrlPrompt.value;
      }
      // Git lcone
      await new Promise((resolve) => {
        crossSpawn("git", ["clone", cloneUrl, "."], { stdio: "inherit" }).on("close", () => {
          resolve(null);
        });
      });
      uxLog(this, `Git repository cloned. ${c.yellow("Please run again the same command :)")}`);
      process.exit(0);
    } else {
      throw new SfdxError("You need to be at the root of a git repository to run this command");
    }
  }
  // Check if root
  else if (options.mustBeRoot) {
    const gitRepoRoot = await getGitRepoRoot();
    if (path.resolve(gitRepoRoot) !== path.resolve(process.cwd())) {
      throw new SfdxError(`You must be at the root of the git repository (${path.resolve(gitRepoRoot)})`);
    }
  }
}

export async function getGitRepoRoot() {
  const gitRepoRoot = await git().revparse(["--show-toplevel"]);
  return gitRepoRoot;
}

// Get local git branch name
export async function getCurrentGitBranch(options: any = { formatted: false }) {
  if (git == null) {
    return null;
  }
  const gitBranch = process.env.CI_COMMIT_REF_NAME || (await git().branchLocal()).current;
  if (options.formatted === true) {
    return gitBranch.replace("/", "__");
  }
  return gitBranch;
}

// Select git branch and checkout & pull if requested
export async function selectGitBranch(options: { remote: true; checkOutPull: boolean } = { remote: true, checkOutPull: false }) {
  const gitBranchOptions = ["--list"];
  if (options.remote) {
    gitBranchOptions.push("-r");
  }
  const branches = await git().branch(gitBranchOptions);
  const branchResp = await prompts({
    type: "select",
    name: "value",
    message: "Please select a Git branch",
    choices: branches.all.map((branchName) => {
      return { title: branchName.replace("origin/", ""), value: branchName.replace("origin/", "") };
    }),
  });
  const branch = branchResp.value;
  // Checkout & pull if requested
  if (options.checkOutPull) {
    await gitCheckOutRemote(branch);
    WebSocketClient.sendMessage({ event: "refreshStatus" });
  }
  return branch;
}

export async function gitCheckOutRemote(branchName: string) {
  await git().checkout(branchName);
  await git().pull();
}

// Get local git branch name
export async function ensureGitBranch(branchName: string, options: any = { init: false, parent: "current" }) {
  if (git == null) {
    if (options.init) {
      await ensureGitRepository({ init: true });
    } else {
      return false;
    }
  }
  await git().fetch();
  const branches = await git().branch();
  const localBranches = await git().branchLocal();
  if (localBranches.current !== branchName) {
    if (branches.all.includes(branchName)) {
      // Existing branch: checkout & pull
      await git().checkout(branchName);
      // await git().pull()
    } else {
      if (options?.parent === "main") {
        // Create from main branch
        const mainBranch = branches.all.includes("main") ? "main" : "master";
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
  if (git == null) {
    throw new SfdxError("[sfdx-hardis] You must be within a git repository");
  }
  const gitStatus = await git({ output: true }).status();
  if (gitStatus.files.length > 0) {
    const localUpdates = gitStatus.files
      .map((fileStatus: FileStatusResult) => {
        return `(${fileStatus.working_dir}) ${getSfdxFileLabel(fileStatus.path)}`;
      })
      .join("\n");
    if (options.allowStash) {
      await execCommand("git add --all", this, { output: true, fail: true });
      await execCommand("git stash", this, { output: true, fail: true });
    } else {
      throw new SfdxError(
        `[sfdx-hardis] Branch ${c.bold(gitStatus.current)} is not clean. You must ${c.bold(
          "commit or reset",
        )} the following local updates:\n${c.yellow(localUpdates)}`,
      );
    }
  }
}

// Interactive git add
export async function interactiveGitAdd(options: any = { filter: [], groups: [] }) {
  if (git == null) {
    throw new SfdxError("[sfdx-hardis] You must be within a git repository");
  }
  // List all files and arrange their format
  const config = await getConfig("project");
  const gitStatus = await git().status();
  let filesFiltered = gitStatus.files
    .filter((fileStatus: FileStatusResult) => {
      return (options.filter || []).filter((filterString: string) => fileStatus.path.includes(filterString)).length === 0;
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
        label: "All",
        regex: /(.*)/i,
        defaultSelect: false,
        ignore: false,
      },
    ];
  }
  // Ask user what he/she wants to git add/rm
  const result = { added: [], removed: [] };
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
        type: "multiselect",
        name: "files",
        message: c.cyanBright(
          `Please select ${c.red("carefully")} the ${c.bgWhite(c.red(c.bold(group.label.toUpperCase())))} files you want to commit (save)}`,
        ),
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
          .filter((fileStatus: FileStatusResult) => fileStatus.working_dir !== "D")
          .map((fileStatus: FileStatusResult) => fileStatus.path.replace('"', "")),
      );
      result.removed.push(
        ...selectFilesStatus.files
          .filter((fileStatus: FileStatusResult) => fileStatus.working_dir === "D")
          .map((fileStatus: FileStatusResult) => fileStatus.path.replace('"', "")),
      );
    }
    if (filesFiltered.length > 0) {
      uxLog(
        this,
        c.grey(
          "The following list of files has not been proposed for selection\n" +
            filesFiltered
              .map((fileStatus: FileStatusResult) => {
                return `  - (${getGitWorkingDirLabel(fileStatus.working_dir)}) ${getSfdxFileLabel(fileStatus.path)}`;
              })
              .join("\n"),
        ),
      );
    }
    // Ask user for confirmation
    const confirmationText = groups
      .filter((group) => group.files != null && group.files.length > 0)
      .map((group) => {
        return (
          c.bgWhite(c.red(c.bold(group.label))) +
          "\n" +
          group.files
            .map((fileStatus: FileStatusResult) => {
              return `  - (${getGitWorkingDirLabel(fileStatus.working_dir)}) ${getSfdxFileLabel(fileStatus.path)}`;
            })
            .join("\n") +
          "\n"
        );
      })
      .join("\n");
    const addFilesResponse = await prompts({
      type: "select",
      name: "addFiles",
      message: c.cyanBright(`Do you confirm that you want to add the following list of files ?\n${confirmationText}`),
      choices: [
        { title: "Yes, my selection is complete !", value: "yes" },
        { title: "No, I want to select again", value: "no" },
        { title: "Let me out of here !", value: "bye" },
      ],
      initial: 0,
    });
    // Commit if requested
    if (addFilesResponse.addFiles === "yes") {
      if (result.added.length > 0) {
        await git({ output: true }).add(result.added);
      }
      if (result.removed.length > 0) {
        await git({ output: true }).rm(result.removed);
      }
    }
    // restart selection
    else if (addFilesResponse.addFiles === "no") {
      return await interactiveGitAdd(options);
    }
    // exit
    else {
      uxLog(this, "Cancelled by user");
      process.exit(0);
    }
  } else {
    uxLog(this, c.cyan("There is no new file to commit"));
  }
  return result;
}

// Shortcut to add, commit and push
export async function gitAddCommitPush(
  options: any = {
    init: false,
    pattern: "./*",
    commitMessage: "Updated by sfdx-hardis",
    branch: null,
  },
) {
  if (git == null) {
    if (options.init) {
      // Initialize git repo
      await execCommand("git init -b main", this);
      await git().checkoutBranch(options.branch || "dev", "main");
    }
  }
  // Add, commit & push
  const currentgitBranch = (await git().branchLocal()).current;
  await git()
    .add(options.pattern || "./*")
    .commit(options.commitMessage || "Updated by sfdx-hardis")
    .push(["-u", "origin", currentgitBranch]);
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
    fileStatusPath = fileStatusPath.replace(config.gitRootFolderPrefix, "");
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
  },
): Promise<any> {
  if (!command.includes("--json")) {
    command += " --json";
  }
  return await execCommand(command, commandThis, options);
}

// Execute command
export async function execCommand(
  command: string,
  commandThis: any,
  options: any = {
    fail: false,
    output: false,
    debug: false,
    spinner: true,
  },
): Promise<any> {
  let commandLog = `[sfdx-hardis][command] ${c.bold(c.bgWhite(c.grey(command)))}`;
  const execOptions: any = { maxBuffer: 10000 * 10000 };
  if (options.cwd) {
    execOptions.cwd = options.cwd;
    if (path.resolve(execOptions.cwd) !== path.resolve(process.cwd())) {
      commandLog += c.grey(` ${c.italic("in directory")} ${execOptions.cwd}`);
    }
  }
  let commandResult = null;
  // Call command (disable color before for json parsing)
  const prevForceColor = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "0";
  const output = options.output !== null ? options.output : !process.argv.includes("--json");
  let spinner: any;
  if (output && !(options.spinner === false)) {
    spinner = ora({ text: commandLog, spinner: "moon" }).start();
  } else {
    uxLog(this, commandLog);
  }
  try {
    commandResult = await exec(command, execOptions);
    if (spinner) {
      spinner.succeed(commandLog);
    }
  } catch (e) {
    if (spinner) {
      spinner.fail(commandLog);
    }
    process.env.FORCE_COLOR = prevForceColor;
    // Display error in red if not json
    if (!command.includes("--json") || options.fail) {
      const strErr = truncateProgressLogLines(`${e.stdout}\n${e.stderr}`);
      console.error(c.red(strErr));
      e.message = e.message += "\n" + strErr;
      // Manage retry if requested
      if (options.retry != null) {
        options.retry.tryCount = (options.retry.tryCount || 0) + 1;
        if (
          options.retry.tryCount <= (options.retry.retryMaxAttempts || 1) &&
          (options.retry.retryStringConstraint == null || (e.stdout + e.stderr).includes(options.retry.retryStringConstraint))
        ) {
          uxLog(commandThis, c.yellow(`Retry command: ${options.retry.tryCount} on ${options.retry.retryMaxAttempts || 1}`));
          if (options.retry.retryDelay) {
            uxLog(this, `Waiting ${options.retry.retryDelay} seconds before retrying command`);
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
      errorMessage: `[sfdx-hardis][ERROR] Error processing command\n$${e.stdout}\n${e.stderr}`,
      error: e,
    };
  }
  // Display output if requested, for better user unrstanding of the logs
  if (options.output || options.debug) {
    uxLog(commandThis, c.italic(c.grey(truncateProgressLogLines(commandResult.stdout))));
  }
  // Return status 0 if not --json
  process.env.FORCE_COLOR = prevForceColor;
  if (!command.includes("--json")) {
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
      throw new SfdxError(c.red(`[sfdx-hardis][ERROR] Command failed: ${commandResult}`));
    }
    if (commandResult.stderr && commandResult.stderr.length > 2) {
      uxLog(this, "[sfdx-hardis][WARNING] stderr: " + c.yellow(commandResult.stderr));
    }
    return parsedResult;
  } catch (e) {
    // Manage case when json is not parseable
    return {
      status: 1,
      errorMessage: c.red(
        `[sfdx-hardis][ERROR] Error parsing JSON in command result: ${e.message}\n${commandResult.stdout}\n${commandResult.stderr})`,
      ),
    };
  }
}

/* Ex: force-app/main/default/layouts/Opportunity-Opportunity %28Marketing%29 Layout.layout-meta.xml
   becomes layouts/Opportunity-Opportunity (Marketing Layout).layout-meta.xml */
export function getSfdxFileLabel(filePath: string) {
  const cleanStr = decodeURIComponent(filePath.replace("force-app/main/default/", "").replace("force-app/main/", "").replace('"', ""));
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
  return workingDir === "?" ? "CREATED" : workingDir === "D" ? "DELETED" : workingDir === "M" ? "UPDATED" : "OOOOOPS";
}

const elapseAll = {};
export function elapseStart(text) {
  elapseAll[text] = process.hrtime.bigint();
}
export function elapseEnd(text: string, commandThis: any = this) {
  if (elapseAll[text]) {
    const elapsed = Number(process.hrtime.bigint() - elapseAll[text]);
    const ms = elapsed / 1000000;
    uxLog(commandThis, c.grey(c.italic(text + " " + moment().startOf("day").milliseconds(ms).format("H:mm:ss.SSS"))));
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
    removeNamespaces: [],
    removeMetadatas: [],
    removeStandard: false,
    removeFromPackageXmlFile: null,
    updateApiVersion: null,
  },
): Promise<{ updated: boolean; message: string }> {
  let updated = false;
  let message = `[sfdx-hardis] ${packageXmlFileOut} not updated`;
  const initialFileContent = await fs.readFile(packageXmlFile);
  const manifest = await xml2js.parseStringPromise(initialFileContent);
  // Remove namespaces
  if ((options.removeNamespaces || []).length > 0) {
    uxLog(this, c.grey(`Removing items from namespaces ${options.removeNamespaces.join(",")} ...`));
    manifest.Package.types = manifest.Package.types.map((type: any) => {
      type.members = type.members.filter((member: string) => {
        const startsWithNamespace = options.removeNamespaces.filter((ns: string) => member.startsWith(ns)).length > 0;
        if (startsWithNamespace) {
          const splits = member.split(".");
          if (
            splits.length === 2 &&
            (((splits[1].match(/__/g) || []).length == 1 && splits[1].endsWith("__c")) || (splits[1].match(/__/g) || []).length == 0)
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
            return destructiveTypes[0].members.filter((destructiveMember: string) => destructiveMember === member).length === 0;
          });
        }
        return type;
      })
      .filter((type: any) => {
        // Remove types with wildcard
        const wildcardDestructiveTypes = destructiveManifest.Package.types.filter((destructiveType: any) => {
          return destructiveType.name[0] === type.name[0] && destructiveType.members.length === 1 && destructiveType.members[0] === "*";
        });
        if (wildcardDestructiveTypes.length > 0) {
          uxLog(this, c.grey(`Removed ${type.name[0]} type`));
        }
        return wildcardDestructiveTypes.length === 0;
      });
  }
  // Remove standard objects
  if (options.removeStandard) {
    manifest.Package.types = manifest.Package.types.map((type: any) => {
      if (["CustomObject"].includes(type.name[0])) {
        type.members = type.members.filter((member: string) => {
          return member.endsWith("__c");
        });
      }
      type.members = type.members.filter((member: string) => {
        return !member.startsWith("standard__");
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
        uxLog(this, c.grey("kept " + type.name[0]));
        return true;
      }
      uxLog(this, c.grey("removed " + type.name[0]));
      return false;
    });
  }

  // Remove metadata types (named, and empty ones)
  manifest.Package.types = manifest.Package.types.filter(
    (type: any) => !(options.removeMetadatas || []).includes(type.name[0]) && (type?.members?.length || 0) > 0,
  );
  const builder = new xml2js.Builder({ renderOpts: { pretty: true, indent: "  ", newline: "\n" } });
  const updatedFileContent = builder.buildObject(manifest);
  if (updatedFileContent !== initialFileContent) {
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

// Catch matches in files according to criteria
export async function catchMatches(catcher: any, file: string, fileText: string, commandThis: any) {
  const matchResults = [];
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
      const catcherLabel = catcher.regex ? `regex ${catcher.regex.toString()}` : "ERROR";
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
        uxLog(commandThis, `[${fileName}]: Match [${matches}] occurrences of [${catcher.type}/${catcher.name}] with catcher [${catcherLabel}]`);
      }
    }
  }
  return matchResults;
}

// Count matches of a regex
export async function countRegexMatches(regex: RegExp, text: string): Promise<number> {
  return ((text || "").match(regex) || []).length;
}

// Get all captured groups of a regex in a string
export async function extractRegexGroups(regex: RegExp, text: string): Promise<string[]> {
  const matches = ((text || "").match(regex) || []).map((e) => e.replace(regex, "$1").trim());
  return matches;
  // return ((text || '').matchAll(regex) || []).map(item => item.trim());
}

// Generate output files
export async function generateReports(
  resultSorted: any[],
  columns: any[],
  commandThis: any,
  options: any = { logFileName: null, logLabel: "Generated report files:" },
): Promise<any[]> {
  const logLabel = options.logLabel || "Generated report files:";
  let logFileName = options.logFileName || null;
  if (!logFileName) {
    logFileName = "sfdx-hardis-" + commandThis.id.substr(commandThis.id.lastIndexOf(":") + 1);
  }
  const dateSuffix = new Date().toJSON().slice(0, 10);
  const reportDir = await getReportDirectory();
  const reportFile = path.resolve(`${reportDir}/${logFileName}-${dateSuffix}.csv`);
  const reportFileExcel = path.resolve(`${reportDir}/${logFileName}-${dateSuffix}.xls`);
  await fs.ensureDir(path.dirname(reportFile));
  const csv = csvStringify(resultSorted, {
    delimiter: ";",
    header: true,
    columns,
  });
  await fs.writeFile(reportFile, csv, "utf8");
  // Trigger command to open CSV file in VsCode extension
  WebSocketClient.requestOpenFile(reportFile);
  const excel = csvStringify(resultSorted, {
    delimiter: "\t",
    header: true,
    columns,
  });
  await fs.writeFile(reportFileExcel, excel, "utf8");
  uxLog(commandThis, c.cyan(logLabel));
  uxLog(commandThis, c.cyan(`- CSV: ${reportFile}`));
  uxLog(commandThis, c.cyan(`- XLS: ${reportFileExcel}`));
  return [
    { type: "csv", file: reportFile },
    { type: "xls", file: reportFileExcel },
  ];
}

export function uxLog(commandThis: any, text: string) {
  text = text.includes("[sfdx-hardis]") ? text : "[sfdx-hardis]" + (text.startsWith("[") ? "" : " ") + text;
  if (commandThis?.ux) {
    commandThis.ux.log(text);
  } else if (!process.argv.includes("--json")) {
    console.log(text);
  }
  if (globalThis.hardisLogFileStream) {
    globalThis.hardisLogFileStream.write(stripAnsi(text) + "\n");
  }
}

// Caching methods
const SFDX_LOCAL_FOLDER = "/root/.sfdx";
const TMP_COPY_FOLDER = ".cache/sfdx-hardis/.sfdx";
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
    // uxLog(this, `[cache] Copied sfdx cache in ${TMP_COPY_FOLDER} for later reuse`);
    // const files = fs.readdirSync(TMP_COPY_FOLDER, {withFileTypes: true}).map(item => item.name);
    // uxLog(this, '[cache]' + JSON.stringify(files));
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
    // uxLog(this, '[cache] Restored cache for CI');
    // const files = fs.readdirSync(SFDX_LOCAL_FOLDER, {withFileTypes: true}).map(item => item.name);
    // uxLog(this, '[cache]' + JSON.stringify(files));
    RESTORED = true;
  }
}

// Generate SSL certificate in temporary folder and copy the key in project directory
export async function generateSSLCertificate(branchName: string, folder: string, commandThis: any, conn: any, options: any) {
  uxLog(commandThis, "Generating SSL certificate...");
  const tmpDir = await createTempDir();
  const prevDir = process.cwd();
  process.chdir(tmpDir);
  const sslCommand =
    'openssl req -nodes -newkey rsa:2048 -keyout server.key -out server.csr -subj "/C=GB/ST=Paris/L=Paris/O=Hardis Group/OU=sfdx-hardis/CN=hardis-group.com"';
  await execCommand(sslCommand, this, { output: true, fail: true });
  await execCommand("openssl x509 -req -sha256 -days 3650 -in server.csr -signkey server.key -out server.crt", this, {
    output: true,
    fail: true,
  });
  process.chdir(prevDir);
  // Copy certificate key in local project
  await fs.ensureDir(folder);
  const targetKeyFile = path.join(folder, `${branchName}.key`);
  await fs.copy(path.join(tmpDir, "server.key"), targetKeyFile);
  const encryptionKey = await encryptFile(targetKeyFile);
  // Copy certificate file in user home project
  const crtFile = path.join(os.homedir(), `${branchName}.crt`);
  await fs.copy(path.join(tmpDir, "server.crt"), crtFile);
  // delete temporary cert folder
  await fs.remove(tmpDir);
  // Generate random consumer key for Connected app
  const consumerKey = crypto.randomBytes(256).toString("base64").substr(0, 119);

  // Ask user if he/she wants to create connected app
  const confirmResponse = await prompts({
    type: "confirm",
    name: "value",
    initial: true,
    message: c.cyanBright("Do you want sfdx-hardis to configure the SFDX connected app on your org ? (say yes if you don't know)"),
  });
  if (confirmResponse.value === true) {
    uxLog(
      commandThis,
      c.cyanBright(
        `You must configure CI variable ${c.green(c.bold(`SFDX_CLIENT_ID_${branchName.toUpperCase()}`))} with value ${c.bold(c.green(consumerKey))}`,
      ),
    );
    uxLog(
      commandThis,
      c.cyanBright(
        `You must configure CI variable ${c.green(c.bold(`SFDX_CLIENT_KEY_${branchName.toUpperCase()}`))} with value ${c.bold(
          c.green(encryptionKey),
        )}`,
      ),
    );
    uxLog(commandThis, c.yellow("Help to configure CI variables are here: https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-auth/"));
    await prompts({
      type: "confirm",
      message: c.cyanBright("Hit ENTER when the CI/CD variables are set (check info in the console below)"),
    });
    // Request info for deployment
    const promptResponses = await prompts([
      {
        type: "text",
        name: "appName",
        initial: "sfdxhardis" + Math.floor(Math.random() * 9) + 1,
        message: c.cyanBright("How would you like to name the Connected App (ex: sfdx_hardis) ?"),
      },
    ]);
    const contactEmail = await promptUserEmail("Enter a contact email for the Connect App (ex: nicolas.vuillamy@cloudity.com)");
    const profile = await promptProfiles(conn, {
      multiselect: false,
      message: "What profile will be used for the connected app ? (ex: System Administrator)",
      initialSelection: ["System Administrator", "Administrateur Système"],
    });
    const crtContent = await fs.readFile(crtFile, "utf8");
    // Build ConnectedApp metadata
    const connectedAppMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<ConnectedApp xmlns="http://soap.sforce.com/2006/04/metadata">
  <contactEmail>${contactEmail}</contactEmail>
  <label>${promptResponses.appName.replace(/\s/g, "_") || "sfdx-hardis"}</label>
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
  <profileName>${profile || "System Administrator"}</profileName>
</ConnectedApp>
`;
    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${promptResponses.appName}</members>
    <name>ConnectedApp</name>
  </types>
  <version>${CONSTANTS.API_VERSION}</version>
</Package>
`;
    // create metadata folder
    const tmpDirMd = await createTempDir();
    const connectedAppDir = path.join(tmpDirMd, "connectedApps");
    await fs.ensureDir(connectedAppDir);
    await fs.writeFile(path.join(tmpDirMd, "package.xml"), packageXml);
    await fs.writeFile(path.join(connectedAppDir, `${promptResponses.appName}.connectedApp`), connectedAppMetadata);

    // Deploy metadatas
    try {
      uxLog(commandThis, c.cyan(`Deploying Connected App ${c.bold(promptResponses.appName)} into target org ${options.targetUsername || ""} ...`));
      const deployRes = await deployMetadatas({
        deployDir: tmpDirMd,
        testlevel: branchName.includes("production") ? "RunLocalTests" : "NoTestRun",
        soap: true,
        targetUsername: options.targetUsername ? options.targetUsername : null,
      });
      console.assert(deployRes.status === 0, c.red("[sfdx-hardis] Failed to deploy metadatas"));
      uxLog(commandThis, c.cyan(`Successfully deployed ${c.green(promptResponses.appName)} Connected App`));
      await fs.remove(tmpDirMd);
      await fs.remove(crtFile);
    } catch (e) {
      uxLog(
        commandThis,
        c.red("Error pushing ConnectedApp metadata. Maybe the app name is already taken ?\nYou may try again with another connected app name"),
      );
      uxLog(
        commandThis,
        c.yellow(`If this is a Test class issue (production env), you may have to create manually connected app ${promptResponses.appName}:
- Follow instructions here: https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_connected_app.htm
  - Use certificate ${c.bold(crtFile)}
- Once created, update variable ${c.green(
          c.bold(`SFDX_CLIENT_ID_${branchName.toUpperCase()}`),
        )} with ConsumerKey of the newly created connected app`),
      );
    }
  } else {
    // Tell infos to install manually
    uxLog(commandThis, c.yellow("Now you can configure the sfdx connected app"));
    uxLog(
      commandThis,
      `Follow instructions here: ${c.bold(
        "https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_connected_app.htm",
      )}`,
    );
    uxLog(
      commandThis,
      `Use ${c.green(crtFile)} as certificate on Connected App configuration page, ${c.bold(`then delete ${crtFile} for security`)}`,
    );
    uxLog(
      commandThis,
      `- configure CI variable ${c.green(
        `SFDX_CLIENT_ID_${branchName.toUpperCase()}`,
      )} with value of ConsumerKey on Connected App configuration page`,
    );
    uxLog(commandThis, `- configure CI variable ${c.green(`SFDX_CLIENT_KEY_${branchName.toUpperCase()}`)} with value ${c.green(encryptionKey)} key`);
  }
}

export async function isMonitoringJob() {
  if (process.env.SFDX_HARDIS_MONITORING === "true") {
    return true;
  }
  if (!isCI) {
    return false;
  }
  const repoName = await git().revparse("--show-toplevel");
  if (isCI && repoName.includes("monitoring")) {
    return true;
  }
  return false;
}
