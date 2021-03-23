import * as c from 'chalk';
import * as child from 'child_process';
import * as crossSpawn from 'cross-spawn';
import * as crypto from 'crypto';
import * as csvStringify from 'csv-stringify/lib/sync';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as xml2js from 'xml2js';
const exec = util.promisify(child.exec);
import { SfdxError } from '@salesforce/core';
import * as ora from 'ora';
import simpleGit, { FileStatusResult, SimpleGit } from 'simple-git';
import { CONSTANTS } from '../../config';
import { MetadataUtils } from '../metadata-utils';
import { prompts } from './prompts';
import { encryptFile } from '../cryptoUtils';

let pluginsStdout = null;

export const isCI = process.env.CI != null;

export function git(options: any = { output: false }): SimpleGit {
  const simpleGitInstance = simpleGit();
  // Hack to be able to display executed git command (and it still doesn't work...)
  // cf: https://github.com/steveukx/git-js/issues/593
  return simpleGitInstance.outputHandler((command, stdout, stderr, gitArgs) => {
    let first = true;
    stdout.on('data', data => {
      logCommand();
      if (options.output) {
        uxLog(this, c.italic(c.grey(data)));
      }
    });
    stderr.on('data', data => {
      logCommand();
      if (options.output) {
        uxLog(this, c.italic(c.yellow(data)));
      }
    });
    function logCommand() {
      if (first) {
        first = false;
        uxLog(this, `[command] ${c.grey(command)} ${c.grey(gitArgs.join(' '))}`);
      }
    }
  });
}

export function isGitRepo() {
  const isInsideWorkTree = child.spawnSync(
    'git',
    ['rev-parse', '--is-inside-work-tree'],
    { encoding: 'utf8', windowsHide: true }
  );
  return isInsideWorkTree.status === 0;
}

// Install plugin if not present
export async function checkSfdxPlugin(pluginName: string) {
  // Manage cache of sfdx plugins result
  if (pluginsStdout == null) {
    const pluginsRes = await exec('sfdx plugins');
    pluginsStdout = pluginsRes.stdout;
  }
  if (!pluginsStdout.includes(pluginName)) {
    uxLog(this, c.yellow(`[dependencies] Installing sfdx plugin ${c.green(pluginName)}...`));
    const installCommand = `echo y|sfdx plugins:install ${pluginName}`;
    await execCommand(installCommand, this, { fail: true, output: false });
  }
}

export async function promptInstanceUrl() {
  const orgTypeResponse = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright('Is the org you need to connect a sandbox or another type of org (dev org, enterprise org...)'),
    choices: [
      { title: 'Sandbox', description: 'The org I want to connect is a sandbox', value: 'https://test.salesforce.com' },
      { title: 'Other', description: 'The org I want to connect is not a sandbox', value: 'https://login.salesforce.com' }
    ],
    initial: 1
  });
  return orgTypeResponse.value;
}

// Check if we are in a repo, or create it if missing
export async function ensureGitRepository(options: any = { init: false, clone: false, cloneUrl: null }) {
  if (!isGitRepo()) {
    // Init repo
    if (options.init) {
      await exec('git init -b main');
      console.info(c.yellow(c.bold(`[sfdx-hardis] Initialized git repository in ${process.cwd()}`)));
    } else if (options.clone) {
      // Clone repo
      let cloneUrl = options.cloneUrl;
      if (!cloneUrl) {
        // Request repo url if not provided
        const cloneUrlPrompt = await prompts({
          type: 'text',
          name: 'value',
          message: c.cyanBright('What is the URL of your git repository ? example: https://gitlab.hardis-group.com/busalesforce/monclient/monclient-org-monitoring.git')
        });
        cloneUrl = cloneUrlPrompt.value;
      }
      // Git lcone
      await new Promise((resolve) => {
        crossSpawn('git', ['clone', cloneUrl, '.'], { stdio: 'inherit' }).on('close', () => {
          resolve(null);
        });
      });
      uxLog(this, `Git repository cloned. ${c.yellow('Please run again the same command :)')}`);
      process.exit(0);
    } else {
      throw new SfdxError('Developer: please send init or clone as option');
    }
  }
}

// Get local git branch name
export async function getCurrentGitBranch(options: any = { formatted: false }) {
  if (git == null) {
    return null;
  }
  const gitBranch =
    process.env.CI_COMMIT_REF_NAME || (await git().branchLocal()).current;
  if (options.formatted === true) {
    return gitBranch.replace('/', '__');
  }
  return gitBranch;
}

export async function gitCheckOutRemote(branchName: string) {
  await git().checkout(branchName);
  await git().pull();
}

// Get local git branch name
export async function ensureGitBranch(branchName: string, options: any = { init: false }) {
  if (git == null) {
    if (options.init) {
      await ensureGitRepository({ init: true });
    } else {
      return false;
    }
  }
  const branches = await git().branch();
  const localBranches = await git().branchLocal();
  if (localBranches.current !== branchName) {
    if (branches.all.includes(branchName)) {
      // Existing branch: checkout & pull
      await git().checkout(branchName);
      // await git().pull()
    } else {
      // Not existing branch: create it
      await git().checkoutBranch(branchName, localBranches.current);
    }
  }
  return true;
}

// Checks that current git status is clean.
export async function checkGitClean(options: any) {
  if (git == null) {
    throw new SfdxError('[sfdx-hardis] You must be within a git repository');
  }
  const gitStatus = await git().status();
  if (gitStatus.files.length > 0) {
    const localUpdates = gitStatus.files.map((fileStatus: FileStatusResult) => {
      return `(${fileStatus.working_dir}) ${getSfdxFileLabel(fileStatus.path)}`;
    }).join('\n');
    if (options.allowStash) {
      await git({output:true}).stash();
    } else {
      throw new SfdxError(`[sfdx-hardis] Branch ${c.bold(gitStatus.current)} is not clean. You must ${c.bold('commit or reset')} the following local updates:\n${c.yellow(localUpdates)}`);
    }
  }
}

// Interactive git add
export async function interactiveGitAdd(options: any = { filter: [], groups: []}) {
  if (git == null) {
    throw new SfdxError('[sfdx-hardis] You must be within a git repository');
  }
  // List all files and arrange their format
  const gitStatus = await git().status();
  let filesFiltered = gitStatus.files.filter((fileStatus: FileStatusResult) => {
    return (options.filter || []).filter((filterString: string) => fileStatus.path.includes(filterString)).length === 0;
  }).map((fileStatus: FileStatusResult) => {
    if (fileStatus.path.startsWith('"')) {
      fileStatus.path = fileStatus.path.substring(1);
    }
    if (fileStatus.path.endsWith('"')) {
      fileStatus.path = fileStatus.path.slice(0, -1);
    }
    return fileStatus;
  });
  // Create default group if 
  let groups = options.groups || [];
  if (groups.length === 0){
    groups = [
      {
        label: "All",
        regex: /(.*)/i,
        defaultSelect: false,
        ignore: false
      }
    ]
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
        continue ;
      }
      // Remove remaining files list
      filesFiltered = filesFiltered.filter((fileStatus: FileStatusResult) => {
        return !group.regex.test(fileStatus.path);
      });    
      // Ask user for input  
      const selectFilesStatus = await prompts({
        type: "multiselect",
        name: "files",
        message: c.cyanBright( `Please select ${c.red("carefully")} the ${c.bgWhiteBright(c.red(c.bold(group.label)))} files you want to commit (save)\n${c.italic(c.grey("They will be deployed to production someday !"))}`),
        choices: matchingFiles.map((fileStatus: FileStatusResult) => {
        return {
            title: `(${getGitWorkingDirLabel(fileStatus.working_dir)}) ${getSfdxFileLabel(fileStatus.path)}`, 
            selected: group.defaultSelect || false,
            value: fileStatus 
        }
        }),
        optionsPerPage: 9999,
      });
      // Add to group list of files
      group.files = selectFilesStatus.files;
      // Separate added to removed files
      result.added.push(...(selectFilesStatus.files
        .filter((fileStatus: FileStatusResult) => fileStatus.working_dir !== 'D')
        .map((fileStatus: FileStatusResult) => fileStatus.path.replace('"', ''))));
      result.removed.push(...(selectFilesStatus.files
        .filter((fileStatus: FileStatusResult) => fileStatus.working_dir === 'D')
        .map((fileStatus: FileStatusResult) => fileStatus.path.replace('"', ''))));
    }
    if (filesFiltered.length > 0) {
      uxLog(this,c.grey("The following list of files has not been proposed for selection\n" +
        filesFiltered.map((fileStatus:FileStatusResult) => {
          return `  - (${getGitWorkingDirLabel(fileStatus.working_dir)}) ${getSfdxFileLabel(fileStatus.path)}`;
        }).join('\n')))
    }
    // Ask user for confirmation
    const confirmationText = groups
      .filter(group => group.files != null && group.files.length > 0)
      .map(group => {
        return c.bgWhiteBright(c.red(c.bold(group.label)))+'\n'+
          group.files.map((fileStatus:FileStatusResult) => {
            return `  - (${getGitWorkingDirLabel(fileStatus.working_dir)}) ${getSfdxFileLabel(fileStatus.path)}`;
          }).join('\n')+"\n";
      }).join('\n');
    const addFilesResponse = await prompts({
      type: 'select',
      name: 'addFiles',
      message: c.cyanBright(`Do you confirm that you want to add the following list of files ?\n${confirmationText}`),
      choices : [
        { title: 'Yes, my selection is complete !', value: "yes" },
        { title: 'No, I want to select again', value: "no" },
        { title: 'Let me out of here !', value: "bye" }
      ],
      initial: 0
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
      uxLog(this,"Cancelled by user");
      process.exit(0);
    }
  } else {
    uxLog(this, c.cyan('There is no new file to commit'));
  }
  return result;
}

// Shortcut to add, commit and push
export async function gitAddCommitPush(options: any = {
  init: false,
  pattern: './*',
  commitMessage: 'Updated by sfdx-hardis',
  branch: null
}) {
  if (git == null) {
    if (options.init) {
      // Initialize git repo
      await execCommand('git init -b main', this);
      await git().checkoutBranch(options.branch || 'dev', 'main');
    }
  }
  // Add, commit & push
  const currentgitBranch = (await git().branchLocal()).current;
  await git().add(options.pattern || './*')
    .commit(options.commitMessage || 'Updated by sfdx-hardis')
    .push(['-u', 'origin', currentgitBranch]);
}

// Execute salesforce DX command with --json
export async function execSfdxJson(
  command: string,
  commandThis: any,
  options: any = {
    fail: false,
    output: false,
    debug: false
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
  commandThis: any,
  options: any = {
    fail: false,
    output: false,
    debug: false,
    spinner: true
  }
): Promise<any> {
  const commandLog = `[sfdx-hardis][command] ${c.bold(c.grey(command))}`;
  let commandResult = null;
  // Call command (disable color before for json parsing)
  const prevForceColor = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = '0';
  const spinner = ora({ text: commandLog, spinner: 'moon' }).start();
  if (options.spinner === false) {
    spinner.stop();
  }
  try {
    commandResult = await exec(command, { maxBuffer: 10000 * 10000 });
    spinner.succeed();
  } catch (e) {
    spinner.fail();
    process.env.FORCE_COLOR = prevForceColor;
    // Display error in red if not json
    if (!command.includes('--json') || options.fail) {
      console.error(c.red(`${e.stdout}\n${e.stderr}`));
      throw e;
    }
    // if --json, we should not have a crash, so return status 1 + output log
    return {
      status: 1,
      errorMessage: `[sfdx-hardis][ERROR] Error processing command\n$${e.stdout}\n${e.stderr}`
    };
  }
  // Display output if requested, for better user unrstanding of the logs
  if (options.output || options.debug) {
    uxLog(commandThis, c.italic(c.grey(commandResult.stdout)));
  }
  // Return status 0 if not --json
  process.env.FORCE_COLOR = prevForceColor;
  if (!command.includes('--json')) {
    return {
      status: 0,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr
    };
  }
  // Parse command result if --json
  try {
    const parsedResult = JSON.parse(commandResult.stdout);
    if (options.fail && parsedResult.status && parsedResult.status > 0) {
      throw new SfdxError(
        c.red(`[sfdx-hardis][ERROR] Command failed: ${commandResult}`)
      );
    }
    if (commandResult.stderr && commandResult.stderr.length > 2) {
      uxLog(this, '[sfdx-hardis][WARNING] stderr: ' + c.yellow(commandResult.stderr));
    }
    return parsedResult;
  } catch (e) {
    // Manage case when json is not parseable
    return {
      status: 1,
      errorMessage: c.red(`[sfdx-hardis][ERROR] Error parsing JSON in command result: ${e.message}\n${commandResult.stdout}\n${commandResult.stderr})`)
    };
  }
}

/* Ex: force-app/main/default/layouts/Opportunity-Opportunity %28Marketing%29 Layout.layout-meta.xml
   becomes layouts/Opportunity-Opportunity (Marketing Layout).layout-meta.xml */
export function getSfdxFileLabel(filePath: string) {
  const cleanStr = decodeURIComponent(filePath.replace('force-app/main/default/', '')
    .replace('force-app/main/', '')
    .replace('"', '')
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
  return workingDir === "?"
    ? "CREATED"
    : workingDir === "D"
    ? "DELETED"
    : workingDir === "M"
    ? "UPDATED"
    : "OOOOOPS";
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
    updateApiVersion: null
  }
): Promise<{ updated: boolean; message: string }> {
  let updated = false;
  let message = `[sfdx-hardis] ${packageXmlFileOut} not updated`;
  const initialFileContent = await fs.readFile(packageXmlFile);
  const manifest = await xml2js.parseStringPromise(initialFileContent);
  // Remove namespaces
  if ((options.removeNamespaces || []).length > 0) {
    manifest.Package.types = manifest.Package.types.map((type: any) => {
      type.members = type.members.filter((member: string) => {
        return (
          options.removeNamespaces.filter((ns: string) => member.startsWith(ns))
            .length === 0
        );
      });
      return type;
    });
  }
  // Remove from other packageXml file
  if (options.removeFromPackageXmlFile) {
    const destructiveFileContent = await fs.readFile(
      options.removeFromPackageXmlFile
    );
    const destructiveManifest = await xml2js.parseStringPromise(
      destructiveFileContent
    );
    manifest.Package.types = manifest.Package.types.map((type: any) => {
      const destructiveTypes = destructiveManifest.Package.types.filter(
        (destructiveType: any) => {
          return destructiveType.name[0] === type.name[0];
        }
      );
      if (destructiveTypes.length > 0) {
        type.members = type.members.filter((member: string) => {
          return (
            destructiveTypes[0].members.filter(
              (destructiveMember: string) => destructiveMember === member
            ).length === 0
          );
        });
      }
      return type;
    });
  }
  // Remove standard objects
  if (options.removeStandard) {
    manifest.Package.types = manifest.Package.types.map((type: any) => {
      if (['CustomObject'].includes(type.name[0])) {
        type.members = type.members.filter((member: string) => {
          return member.endsWith('__c');
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
  // Remove metadata types (named, and empty ones)
  manifest.Package.types = manifest.Package.types.filter(
    (type: any) =>
      !(options.removeMetadatas || []).includes(type.name[0]) &&
      (type?.members?.length || 0) > 0
  );
  const builder = new xml2js.Builder();
  const updatedFileContent = builder.buildObject(manifest);
  if (updatedFileContent !== initialFileContent) {
    fs.writeFileSync(packageXmlFileOut, updatedFileContent);
    updated = true;
    if (packageXmlFile !== packageXmlFileOut) {
      message = `[sfdx-hardis] ${packageXmlFile} has been filtered to ${packageXmlFileOut}`;
    } else {
      message = `[sfdx-hardis] ${packageXmlFile} has been updated`;
    }
  }
  return {
    updated,
    message
  };
}

// Catch matches in files according to criteria
export async function catchMatches(
  catcher: any,
  file: string,
  fileText: string,
  commandThis: any
) {
  const matchResults = [];
  if (catcher.regex) {
    // Check if there are matches
    const matches = await countRegexMatches(catcher.regex, fileText);
    if (matches > 0) {
      // If match, extract match details
      const fileName = path.basename(file);
      const detail: any = {};
      for (const detailCrit of catcher.detail) {
        const detailCritVal = await extractRegexGroups(
          detailCrit.regex,
          fileText
        );
        if (detailCritVal.length > 0) {
          detail[detailCrit.name] = detailCritVal;
        }
      }
      const catcherLabel = catcher.regex
        ? `regex ${catcher.regex.toString()}`
        : 'ERROR';
      matchResults.push({
        fileName,
        fileText,
        matches,
        type: catcher.type,
        subType: catcher.subType,
        detail,
        catcherLabel
      });
      if (commandThis.debug) {
        uxLog(commandThis,
          `[${fileName}]: Match [${matches}] occurences of [${catcher.type}/${catcher.name}] with catcher [${catcherLabel}]`
        );
      }
    }
  }
  return matchResults;
}

// Count matches of a regex
export async function countRegexMatches(
  regex: RegExp,
  text: string
): Promise<number> {
  return ((text || '').match(regex) || []).length;
}

// Get all captured groups of a regex in a string
export async function extractRegexGroups(
  regex: RegExp,
  text: string
): Promise<string[]> {
  const matches = ((text || '').match(regex) || []).map(e =>
    e.replace(regex, '$1').trim()
  );
  return matches;
  // return ((text || '').matchAll(regex) || []).map(item => item.trim());
}

// Generate output files
export async function generateReports(
  resultSorted: any[],
  columns: any[],
  commandThis: any
): Promise<any[]> {
  const logFileName =
    'sfdx-hardis-' + commandThis.id.substr(commandThis.id.lastIndexOf(':') + 1);
  const reportFile = path.resolve(`./hardis-report/${logFileName}.csv`);
  const reportFileExcel = path.resolve(`./hardis-report/${logFileName}.xls`);
  await fs.ensureDir(path.dirname(reportFile));
  const csv = csvStringify(resultSorted, {
    delimiter: ';',
    header: true,
    columns
  });
  await fs.writeFile(reportFile, csv, 'utf8');
  const excel = csvStringify(resultSorted, {
    delimiter: '\t',
    header: true,
    columns
  });
  await fs.writeFile(reportFileExcel, excel, 'utf8');
  uxLog(commandThis, 'Generated report files:');
  uxLog(commandThis, `- CSV: ${reportFile}`);
  uxLog(commandThis, `- XLS: ${reportFileExcel}`);
  return [
    { type: 'csv', file: reportFile },
    { type: 'xls', file: reportFileExcel }
  ];
}

export function uxLog(commandThis: any, text: string) {
  text = (text.includes('[sfdx-hardis]')) ? text : '[sfdx-hardis]' + (text.startsWith('[') ? '' : ' ') + text;
  if (commandThis?.ux) {
    commandThis.ux.log(text);
  } else {
    console.log(text);
  }
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
    await fs.copy(SFDX_LOCAL_FOLDER, TMP_COPY_FOLDER, { dereference: true, overwrite: true });
    // uxLog(this, `[cache] Copied sfdx cache in ${TMP_COPY_FOLDER} for later reuse`);
    // const files = fs.readdirSync(TMP_COPY_FOLDER, {withFileTypes: true}).map(item => item.name);
    // uxLog(this, '[cache]' + JSON.stringify(files));
  }
}

// Restore only once local Sfdx folder
export async function restoreLocalSfdxInfo() {
  if ((!isCI) || RESTORED === true) {
    return;
  }
  if (fs.existsSync(TMP_COPY_FOLDER)) {
    await fs.copy(TMP_COPY_FOLDER, SFDX_LOCAL_FOLDER, { dereference: true, overwrite: false });
    // uxLog(this, '[cache] Restored cache for CI');
    // const files = fs.readdirSync(SFDX_LOCAL_FOLDER, {withFileTypes: true}).map(item => item.name);
    // uxLog(this, '[cache]' + JSON.stringify(files));
    RESTORED = true;
  }
}

// Generate SSL certificate in temporary folder and copy the key in project directory
export async function generateSSLCertificate(branchName: string, folder: string, commandThis: any) {
  uxLog(commandThis, 'Generating SSL certificate...');
  const tmpDir = path.join(os.tmpdir(), 'sslTmp-') + Math.random().toString(36).slice(-5);
  await fs.ensureDir(tmpDir);
  const prevDir = process.cwd();
  process.chdir(tmpDir);
  const pwd = Math.random().toString(36).slice(-20);
  await execCommand(`openssl genrsa -des3 -passout "pass:${pwd}" -out server.pass.key 2048`, this, { output: true, fail: true });
  await execCommand(`openssl rsa -passin "pass:${pwd}" -in server.pass.key -out server.key`, this, { output: true, fail: true });
  await fs.remove('server.pass.key');
  await prompts({ type: 'confirm', message: c.cyanBright('Now answer the following questions. The answers are not really important :)\nHit ENTER when ready') });
  await new Promise((resolve) => {
    const opensslCommand = 'openssl req -new -key server.key -out server.csr';
    crossSpawn(opensslCommand, [], { stdio: 'inherit' }).on('close', () => {
      resolve(null);
    });
  });
  await execCommand('openssl x509 -req -sha256 -days 3650 -in server.csr -signkey server.key -out server.crt', this, { output: true, fail: true });
  process.chdir(prevDir);
  // Copy certificate key in local project
  await fs.ensureDir(folder);
  const targetKeyFile = path.join(folder, `${branchName}.key`);
  await fs.copy(path.join(tmpDir, 'server.key'), targetKeyFile);
  const encryptionKey = await encryptFile(targetKeyFile);
  // Copy certificate file in user home project
  const crtFile = path.join(os.homedir(), `${branchName}.crt`);
  await fs.copy(path.join(tmpDir, 'server.crt'), crtFile);
  // delete temporary cert folder
  await fs.remove(tmpDir);
  // Generate random consumer key for Connected app
  const consumerKey = crypto.randomBytes(256).toString('base64').substr(0, 119);

  // Ask user if he/she wants to create connected app
  let deployError = false;
  const confirmResponse = await prompts({
    type: 'confirm',
    name: 'value',
    initial: true,
    message: c.cyanBright('Do you want sfdx-hardis to configure the SFDX connected app on your org ? (say yes if you don\'t now)')
  });
  if (confirmResponse.value === true) {
    uxLog(commandThis, c.cyanBright(`You must configure CI variable ${c.green(c.bold(`SFDX_CLIENT_ID_${branchName.toUpperCase()}`))} with value ${c.bold(c.green(consumerKey))}`));
    uxLog(commandThis, c.cyanBright(`You must configure CI variable ${c.green(c.bold(`SFDX_CLIENT_KEY_${branchName.toUpperCase()}`))} with value ${c.bold(c.green(encryptionKey))}`));
    await prompts({ type: 'confirm', message: c.cyanBright('In GitLab it is in Project -> Settings -> CI/CD -> Variables. Hit ENTER when it is done') });
    // Request info for deployment
    const promptResponses = await prompts([
      {
        type: 'text',
        name: 'appName',
        initial: 'sfdx_hardis',
        message: c.cyanBright('How would you like to name the Connected App (ex: sfdx) ?')
      },
      {
        type: 'text',
        name: 'contactEmail',
        message: c.cyanBright('Enter a contact email (ex: nicolas.vuillamy@hardis-group.com)')
      },
      {
        type: 'text',
        name: 'profile',
        initial: 'System Administrator',
        message: c.cyanBright('What profile will be used for the connected app ? (ex: System Administrator)')
      }
    ]);
    const crtContent = await fs.readFile(crtFile, 'utf8');
    // Build ConnectedApp metadata
    const connectedAppMetadata =
      `<?xml version="1.0" encoding="UTF-8"?>
<ConnectedApp xmlns="http://soap.sforce.com/2006/04/metadata">
  <contactEmail>${promptResponses.contactEmail}</contactEmail>
  <label>${promptResponses.appName.replace(/\s/g, '_') || 'sfdx-hardis'}</label>
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
      <refreshTokenPolicy>infinite</refreshTokenPolicy>
  </oauthPolicy>
  <profileName>${promptResponses.profile || 'System Administrator'}</profileName>
</ConnectedApp>
`;
    const packageXml =
      `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${promptResponses.appName}</members>
    <name>ConnectedApp</name>
  </types>
  <version>${CONSTANTS.API_VERSION}</version>
</Package>
`;
    // create metadata folder
    const tmpDirMd = path.join(os.tmpdir(), 'sfdx-hardis-deploy' + Math.random().toString(36).slice(-8));
    const connectedAppDir = path.join(tmpDirMd, 'connectedApps');
    await fs.ensureDir(connectedAppDir);
    await fs.writeFile(path.join(tmpDirMd, 'package.xml'), packageXml);
    await fs.writeFile(path.join(connectedAppDir, `${promptResponses.appName}.connectedApp`), connectedAppMetadata);

    // Deploy metadatas
    try {
      const deployRes = await MetadataUtils.deployMetadatas({
        deployDir: tmpDirMd,
        testlevel: (branchName.includes('production'))?'RunLocalTests':'NoTestRun',
        soap: true
      });
      console.assert(deployRes.status === 0, c.red('[sfdx-hardis] Failed to deploy metadatas'));
      uxLog(commandThis, `Successfully deployed ${c.green(promptResponses.appName)} Connected App`);
      await fs.remove(tmpDirMd);
      await fs.remove(crtFile);
    } catch (e) {
      deployError = true;
      uxLog(commandThis, c.red('Error pushing ConnectedApp metadata. Maybe the app name is already taken ?\nYou may try again with another connected app name'));
    }
    // Last manual step
    if (deployError === false) {
      await prompts({
        type: 'confirm', message: c.cyanBright(
          `You need to give rights to profile ${c.green('System Administrator')} (or related Permission Set) on Connected App ${c.green(promptResponses.appName)}
On the page that will open, ${c.green(`find app ${promptResponses.appName}, then click Manage`)}
On the app managing page, ${c.green('click Manage profiles, then add profile System Administrator')} (or related Permission set)
Hit ENTER when you are ready`)
      });
      await execCommand('sfdx force:org:open -p lightning/setup/NavigationMenus/home', this);
      await prompts({
        type: 'confirm', message: c.cyanBright(`Hit ENTER when the profile right has been manually granted on connected app ${promptResponses.appName}`)
      });
    }
  } else {
    // Tell infos to install manually
    uxLog(commandThis, c.yellow('Now you can configure the sfdx connected app'));
    uxLog(commandThis, `Follow instructions here: ${c.bold('https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_connected_app.htm')}`);
    uxLog(commandThis, `Use ${c.green(crtFile)} as certificate on Connected App configuration page, ${c.bold(`then delete ${crtFile} for security`)}`);
    uxLog(commandThis, `- configure CI variable ${c.green(`SFDX_CLIENT_ID_${branchName.toUpperCase()}`)} with value of ConsumerKey on Connected App configuration page`);
    uxLog(commandThis, `- configure CI variable ${c.green(`SFDX_CLIENT_KEY_${branchName.toUpperCase()}`)} with value ${c.green(encryptionKey)} key`);
  }
}
