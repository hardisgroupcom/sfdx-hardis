import * as c from 'chalk';
import * as child from 'child_process';
import * as csvStringify from 'csv-stringify/lib/sync';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as util from 'util';
import * as xml2js from 'xml2js';
const exec = util.promisify(child.exec);
import { SfdxError } from '@salesforce/core';
import simpleGit, { SimpleGit } from 'simple-git';

let git: SimpleGit = null;

if (isGitRepo()) {
  git = simpleGit();
}

let pluginsStdout = null;

export function isGitRepo() {
  const isInsideWorkTree = child.spawnSync(
    'git',
    ['rev-parse', '--is-inside-work-tree'],
    { encoding: 'utf8', windowsHide: true }
  );
  return isInsideWorkTree.status === 0;
}

// Install plugin if not present
export async function checkSfdxPlugin(
  pluginName: string
): Promise<{ installed: boolean; message: string }> {
  let installed = false;
  if (pluginsStdout == null) {
    const pluginsRes = await exec('sfdx plugins');
    pluginsStdout = pluginsRes.stdout;
  }
  if (!pluginsStdout.includes(pluginName)) {
    await exec(`echo y|sfdx plugins:install ${pluginName}`);
    installed = true;
  }
  return {
    installed,
    message: installed
      ? `[sfdx-hardis] Installed sfdx plugin ${pluginName}`
      : `[sfdx-hardis] sfdx plugin ${pluginName} is already installed`
  };
}

// Check if we are in a repo, or create it if missing
export async function checkGitRepository() {
  if (!isGitRepo()) {
    await exec('git init');
    console.info(
      c.yellow(
        c.bold(`[sfdx-hardis] Initialized git repository in ${process.cwd()}`)
      )
    );
  }
}

// Get local git branch name
export async function getCurrentGitBranch(options: any = { formatted: false }) {
  if (git == null) {
    return null;
  }
  const gitBranch =
    process.env.CI_COMMIT_REF_NAME || (await git.branchLocal()).current;
  if (options.formatted === true) {
    return gitBranch.replace('/', '__');
  }
  return gitBranch;
}

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

// Execute command and parse result as json
export async function execCommand(
  command: string,
  commandThis: any,
  options: any = {
    fail: false,
    output: false,
    debug: false
  }
): Promise<any> {
  commandThis.ux.log(`[sfdx-hardis][command] ${c.bold(c.grey(command))}`);
  let commandResult = null;
  // Call command (disable color before for json parsing)
  const prevForceColor = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = '0';
  try {
    commandResult = await exec(command, { maxBuffer: 10000 * 10000 });
  } catch (e) {
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
    commandThis.ux.log(`[sfdx-hardis][commandresult] ${commandResult.stdout}`);
  }
  // Return status 0 if not --json
  process.env.FORCE_COLOR = prevForceColor;
  if (!command.includes('--json')) {
    return {
      status: 0,
      stdout: commandResult
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
    return parsedResult;
  } catch (e) {
    // Manage case when json is not parseable
    return {
      status: 1,
      errorMessage: `[sfdx-hardis][ERROR] Error parsing JSON in command result: ${e.message}\n${commandResult.stdout}`
    };
  }
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
        commandThis.ux.log(
          `[sfdx-hardis] [${fileName}]: Match [${matches}] occurences of [${catcher.type}/${catcher.name}] with catcher [${catcherLabel}]`
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
  commandThis.ux.log('[sfdx-hardis] Generated report files:');
  commandThis.ux.log(`[sfdx-hardis] - CSV: ${reportFile}`);
  commandThis.ux.log(`[sfdx-hardis] - XLS: ${reportFileExcel}`);
  return [
    { type: 'csv', file: reportFile },
    { type: 'xls', file: reportFileExcel }
  ];
}
