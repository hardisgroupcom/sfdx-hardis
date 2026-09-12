/*
 * Org side of hardis:work:backpromote: what the target org is, the retrieve of the ticked items into
 * the cache, their comparison with the parent branch versions, and the deployments.
 */
import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import * as path from 'path';
import fs from './fsUtils.js';
import { execCommand, execSfdxJson, getGitRepoRoot, uxLog } from './index.js';
import { soqlQuery } from './apiUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { generateReportPath } from './filesUtils.js';
import { analyzeDeployErrorLogs } from './deployTips.js';
import { getEnvVar } from '../../config/index.js';
import { writePackageXmlFile } from './xmlUtils.js';
import { WebSocketClient } from '../websocketClient.js';
import { t } from './i18n.js';
import {
  BackpromoteTargetOrgRefusal,
  countDifferingLines,
  deriveSandboxName,
  findBackpromoteTargetOrgRefusal,
  isBinaryMetadataFile,
  metadataKeysToPackageContent,
  normalizeRepoPath,
  sameFileContent,
  sourcePathTail,
} from './backpromoteRules.js';
import { fileAtRef } from './backpromoteGitUtils.js';
import { createBlankSfdxProject } from './projectUtils.js';
import { BackpromotePlanComparison, backpromoteCacheRoot } from './backpromotePlanUtils.js';

// ---- Target org ----

export interface BackpromoteTargetOrgInfo {
  alias: string | null;
  username: string;
  instanceUrl: string;
  orgType: 'sandbox' | 'scratch' | 'production';
  orgId: string;
  sandboxName: string;
  tracksSource: boolean;
  refusal: BackpromoteTargetOrgRefusal | null;
  message: string;
}

/**
 * Only developer sandboxes and scratch orgs receive a backpromote. A production org, or the org of a
 * major branch, is deployed by the CI/CD pipeline.
 */
export async function getBackpromoteTargetOrgInfo(options: {
  conn: Connection;
  username: string;
  alias: string | null;
  tracksSource: boolean;
  sandboxNameOverride: string | null;
}): Promise<BackpromoteTargetOrgInfo> {
  const orgResult = await soqlQuery('SELECT Id, IsSandbox, TrialExpirationDate FROM Organization LIMIT 1', options.conn);
  const organization = orgResult?.records?.[0] || {};
  const isSandboxOrg = organization.IsSandbox === true;
  const orgType: BackpromoteTargetOrgInfo['orgType'] = !isSandboxOrg ? 'production' : organization.TrialExpirationDate ? 'scratch' : 'sandbox';
  const instanceUrl = options.conn.instanceUrl || '';
  const orgId = String(organization.Id || options.conn.getAuthInfoFields()?.orgId || '');
  const refusal = findBackpromoteTargetOrgRefusal({ isSandbox: isSandboxOrg, username: options.username, instanceUrl, majorOrgs: await listMajorOrgs() });
  const sandboxName = deriveSandboxName({ instanceUrl, username: options.username, orgId, override: options.sandboxNameOverride });
  let message = t('backpromoteCheckTargetOrgOk', { sandboxName });
  if (refusal?.reason === 'production') {
    message = t('backpromoteTargetOrgIsProduction', { username: options.username });
  } else if (refusal?.reason === 'majorOrg') {
    message = t('backpromoteTargetOrgIsMajorOrg', { username: options.username, branch: refusal.branchName });
  }
  return { alias: options.alias, username: options.username, instanceUrl, orgType, orgId, sandboxName, tracksSource: options.tracksSource, refusal, message };
}

// ---- Comparison ----

async function readPackageDirectories(gitRoot: string): Promise<string[]> {
  try {
    const project = JSON.parse(await fs.readFile(path.join(gitRoot, 'sfdx-project.json'), 'utf8'));
    return (project.packageDirectories || []).map((directory: any) => normalizeRepoPath(String(directory.path || ''))).filter((directory: string) => directory !== '');
  } catch {
    return ['force-app'];
  }
}

/** The pending changes of a source-tracked org, as repository paths (empty when the org is not tracked) */
export async function listOrgPendingChanges(username: string, commandThis: any): Promise<string[]> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim());
  const preview = await execSfdxJson(`sf project retrieve preview -o ${username} --json`, commandThis, { fail: false, output: false });
  const entries = [...(preview?.result?.toRetrieve || []), ...(preview?.result?.conflicts || []), ...(preview?.result?.toDelete || [])];
  const files = new Set<string>();
  for (const entry of entries) {
    const file = entry?.projectRelativePath || entry?.path || '';
    if (!file) {
      continue;
    }
    files.add(normalizeRepoPath(path.isAbsolute(file) ? path.relative(gitRoot, file) : file));
  }
  return [...files].sort();
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const files: string[] = [];
  const walk = async (folder: string) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.push(full);
      }
    }
  };
  await walk(directory);
  return files;
}

/** Folder and name of a source path without its last extension: staticresources/E2E_S2.resource -> staticresources/E2E_S2 */
function pathStem(tail: string): string {
  const value = normalizeRepoPath(tail);
  const slash = value.lastIndexOf('/');
  const folder = slash >= 0 ? value.substring(0, slash + 1) : '';
  const name = slash >= 0 ? value.substring(slash + 1) : value;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${folder}${name.substring(0, dot)}` : `${folder}${name}`;
}

export interface BackpromoteRetrieveResult {
  /** Absolute folder holding the org versions (source format) */
  orgDir: string;
  /** Retrieved absolute file by source path tail (classes/A.cls) */
  filesByTail: Map<string, string>;
  /**
   * Retrieved absolute file by folder and name without the extension. The source format names the
   * content file of a StaticResource after its contentType (E2E_S2.resource retrieved from the org
   * comes back as E2E_S2.txt), so the tail of the repository file finds nothing and the item
   * would be reported as absent from the org and overwritten without a question. Only kept when one
   * file of the folder has that name, so an LWC bundle (card.js, card.html) is never matched by it.
   */
  filesByStem: Map<string, string>;
}

/**
 * Retrieve the ticked items from the sandbox into the run cache, once per run: a second call for the
 * same run id finds the folder and reads it again. The retrieve never touches the project sources:
 * `sf project retrieve start --output-dir` refuses a folder outside the project (and drops what
 * .forceignore excludes), so the items are retrieved in source format into a blank sfdx project
 * created in the temporary folder. A retrieve that fails stops the run: with no sandbox version to
 * compare, every file would look absent from the org and be deployed over it without a question.
 */
export async function retrieveItemsForComparison(options: {
  username: string;
  keys: string[];
  orgId: string;
  runId: string;
  commandThis: any;
  force?: boolean;
}): Promise<BackpromoteRetrieveResult> {
  const runDir = path.join(backpromoteCacheRoot(), 'retrieve', options.orgId || 'org', options.runId);
  const blankProject = path.join(runDir, 'sfdx-hardis-blank-project');
  const orgDir = path.join(blankProject, 'force-app');
  const doneMarker = path.join(runDir, 'retrieved.json');
  const wanted = [...options.keys].sort();
  let reuse = false;
  if (!options.force && fs.existsSync(doneMarker)) {
    try {
      // Unticking an item in the panel must not cost a new retrieve: a superset is as good
      const done = JSON.parse(await fs.readFile(doneMarker, 'utf8'));
      reuse = Array.isArray(done?.keys) && wanted.every((key) => done.keys.includes(key));
    } catch {
      reuse = false;
    }
  }
  if (!reuse && wanted.length > 0) {
    await fs.remove(blankProject);
    await fs.remove(doneMarker);
    await fs.ensureDir(runDir);
    await createBlankSfdxProject(runDir);
    const manifest = path.join(runDir, 'retrieve-package.xml');
    await writePackageXmlFile(manifest, metadataKeysToPackageContent(wanted));
    const retrieveCommand = `sf project retrieve start --manifest "${manifest}" -o ${options.username} --wait ${getEnvVar('SFDX_RETRIEVE_WAIT_MINUTES') || '60'} --json`;
    const retrieved = await execSfdxJson(retrieveCommand, options.commandThis, { fail: false, output: false, cwd: blankProject });
    const retrievedFiles = (await listFilesRecursively(orgDir)).filter((file) => path.basename(file) !== 'package.xml');
    if (retrieved?.status !== 0 && retrievedFiles.length === 0) {
      throw new SfError(t('backpromoteRetrieveFailed', { message: retrieved?.message || retrieved?.name || JSON.stringify(retrieved || {}).substring(0, 500) }));
    }
    if (retrieved?.status !== 0) {
      uxLog('warning', options.commandThis, c.yellow(t('backpromoteRetrieveWarning', { message: retrieved?.message || '' })));
    }
    await fs.writeFile(doneMarker, JSON.stringify({ keys: wanted, date: new Date().toISOString() }), 'utf8');
  }
  const filesByTail = new Map<string, string>();
  const stemCandidates = new Map<string, string[]>();
  for (const file of await listFilesRecursively(orgDir)) {
    const relative = normalizeRepoPath(path.relative(orgDir, file));
    if (relative === 'package.xml') {
      continue;
    }
    const tail = sourcePathTail(relative);
    filesByTail.set(tail, file);
    if (tail.endsWith('-meta.xml')) {
      continue;
    }
    const stem = pathStem(tail);
    stemCandidates.set(stem, [...(stemCandidates.get(stem) || []), file]);
  }
  const filesByStem = new Map<string, string>();
  for (const [stem, candidates] of stemCandidates) {
    if (candidates.length === 1) {
      filesByStem.set(stem, candidates[0]);
    }
  }
  return { orgDir, filesByTail, filesByStem };
}

/**
 * Compare the files of the ticked items with the sandbox: the org version (retrieved), the parent
 * head version and, when the sandbox already received a backpromote, the version at the start of
 * the window are copied in the cache so that the VS Code merge editor and the coding agent can read
 * them. Files with no difference, or absent from the sandbox, need no decision.
 */
export async function compareItemsWithOrg(options: {
  itemFiles: Map<string, string[]>;
  pullRequestsOfFile: (file: string) => number[];
  retrieve: BackpromoteRetrieveResult;
  parentRef: string;
  baseRef: string | null;
  pendingInOrg: Set<string>;
  orgId: string;
  runId: string;
  excludedItems: Set<string>;
}): Promise<BackpromotePlanComparison[]> {
  const gitRoot = path.resolve((await getGitRepoRoot()).trim());
  const packageDirectories = await readPackageDirectories(gitRoot);
  const runDir = path.join(backpromoteCacheRoot(), 'retrieve', options.orgId || 'org', options.runId);
  const comparison: BackpromotePlanComparison[] = [];
  for (const [item, files] of options.itemFiles) {
    if (options.excludedItems.has(item)) {
      continue;
    }
    for (const file of files) {
      const entry: BackpromotePlanComparison = {
        file,
        item,
        status: 'notCompared',
        versions: { base: null, sandbox: null, parentHead: null },
        diffLines: 0,
        pullRequests: options.pullRequestsOfFile(file),
        decision: null,
        prepared: false,
        markersRemaining: 0,
        conflictPending: false,
        threeWay: false,
      };
      comparison.push(entry);
      if (isBinaryMetadataFile(file)) {
        continue;
      }
      const tail = sourcePathTail(file, packageDirectories);
      const orgFile = options.retrieve.filesByTail.get(tail) || options.retrieve.filesByStem.get(pathStem(tail)) || null;
      const parentContent = fileAtRef(options.parentRef, file);
      if (parentContent === null) {
        continue;
      }
      const gitCopy = path.join(runDir, 'git', tail);
      await fs.ensureDir(path.dirname(gitCopy));
      await fs.writeFile(gitCopy, parentContent, 'utf8');
      entry.versions.parentHead = gitCopy;
      if (!orgFile) {
        entry.status = 'missingInOrg';
        continue;
      }
      entry.versions.sandbox = orgFile;
      const orgContent = await fs.readFile(orgFile, 'utf8');
      if (sameFileContent(orgContent, parentContent)) {
        entry.status = 'same';
        continue;
      }
      entry.status = options.pendingInOrg.has(file) ? 'pendingInOrg' : 'different';
      entry.diffLines = countDifferingLines(orgContent, parentContent);
      const baseContent = options.baseRef ? fileAtRef(options.baseRef, file) : null;
      if (baseContent !== null) {
        const baseCopy = path.join(runDir, 'base', tail);
        await fs.ensureDir(path.dirname(baseCopy));
        await fs.writeFile(baseCopy, baseContent, 'utf8');
        entry.versions.base = baseCopy;
        entry.threeWay = true;
      }
    }
  }
  return comparison.sort((a, b) => a.item.localeCompare(b.item) || a.file.localeCompare(b.file));
}

// ---- Deployments ----

export interface BackpromoteDeployOutcome {
  success: boolean;
  reportPath: string | null;
}

async function runDeploy(command: string, label: string, commandThis: any, debugMode: boolean): Promise<{ success: boolean; output: string }> {
  try {
    const result = await execCommand(command, commandThis, { fail: true, output: true, debug: debugMode });
    return { success: true, output: result.stdout || '' };
  } catch (e) {
    const output = ((e as any).stdout || '') + ((e as any).stderr || '');
    const { errLog } = await analyzeDeployErrorLogs(output, true, { label });
    uxLog('error', commandThis, c.red(t('backpromoteDeployFailed')));
    uxLog('error', commandThis, c.red('\n' + errLog));
    return { success: false, output };
  }
}

async function writeDeployReport(options: { success: boolean; output: string; username: string; itemCount: number; packageXml: string; destructiveXml: string | null; commandThis: any }): Promise<string> {
  const reportPath = await generateReportPath('backpromote-deploy', '', { withDate: true, withBranchName: true, fileExtension: 'log' });
  const content = [
    'Backpromote Deployment Report',
    `Date: ${new Date().toISOString()}`,
    `Target org: ${options.username}`,
    `Status: ${options.success ? 'SUCCESS' : 'FAILED'}`,
    `Items: ${options.itemCount}`,
    'Test level: NoTestRun',
    `Package XML: ${options.packageXml}`,
    options.destructiveXml ? `Destructive changes: ${options.destructiveXml}` : '',
    '',
    '--- Deployment output ---',
    options.output,
  ].filter(Boolean).join('\n');
  await fs.writeFile(reportPath, content, 'utf-8');
  uxLog('log', options.commandThis, c.grey(t('backpromoteDeployReportSaved', { reportPath })));
  WebSocketClient.sendReportFileMessage(reportPath, t('backpromoteDeployReportLabel'), 'report');
  return reportPath;
}

/**
 * Deploy the ticked items from the checkout (the backpromote branch), NoTestRun: Apex test classes
 * travel like any other metadata and never run in a sandbox. A source-tracked org gets
 * --ignore-conflicts: the comparison step already asked about the files that differ.
 */
export async function deployBackpromotePackage(options: {
  keys: string[];
  username: string;
  workDir: string;
  commandThis: any;
  debugMode: boolean;
}): Promise<BackpromoteDeployOutcome> {
  if (options.keys.length === 0) {
    return { success: true, reportPath: null };
  }
  const packageXml = path.join(options.workDir, 'package', 'package.xml');
  await writePackageXmlFile(packageXml, metadataKeysToPackageContent(options.keys));
  uxLog('action', options.commandThis, c.cyan(t('backpromoteDeploying', { count: options.keys.length })));
  const command =
    'sf project deploy start' +
    ` --manifest "${packageXml}"` +
    ' --ignore-warnings --ignore-conflicts --test-level NoTestRun' +
    ` -o ${options.username}` +
    ` --wait ${getEnvVar('SFDX_DEPLOY_WAIT_MINUTES') || '120'}` +
    ' --json';
  const result = await runDeploy(command, 'backpromote', options.commandThis, options.debugMode);
  const reportPath = await writeDeployReport({ ...result, username: options.username, itemCount: options.keys.length, packageXml, destructiveXml: null, commandThis: options.commandThis });
  if (result.success) {
    uxLog('action', options.commandThis, c.green(t('backpromoteDeploySuccess', { count: options.keys.length })));
  }
  return { success: result.success, reportPath };
}

/** Delete the ticked deletions in their own deployment, after the metadata went in */
export async function deployBackpromoteDeletions(options: {
  keys: string[];
  username: string;
  workDir: string;
  commandThis: any;
  debugMode: boolean;
}): Promise<BackpromoteDeployOutcome> {
  if (options.keys.length === 0) {
    return { success: true, reportPath: null };
  }
  const packageXml = path.join(options.workDir, 'destructive', 'package.xml');
  const destructiveXml = path.join(options.workDir, 'destructive', 'destructiveChanges.xml');
  await writePackageXmlFile(packageXml, {});
  await writePackageXmlFile(destructiveXml, metadataKeysToPackageContent(options.keys));
  uxLog('action', options.commandThis, c.cyan(t('backpromoteDeleting', { count: options.keys.length })));
  const command =
    'sf project deploy start' +
    ` --manifest "${packageXml}"` +
    ` --post-destructive-changes "${destructiveXml}"` +
    ' --ignore-warnings --ignore-conflicts --test-level NoTestRun' +
    ` -o ${options.username}` +
    ` --wait ${getEnvVar('SFDX_DEPLOY_WAIT_MINUTES') || '120'}` +
    ' --json';
  const result = await runDeploy(command, 'backpromote-destructive', options.commandThis, options.debugMode);
  const reportPath = await writeDeployReport({ ...result, username: options.username, itemCount: options.keys.length, packageXml, destructiveXml, commandThis: options.commandThis });
  if (result.success) {
    uxLog('action', options.commandThis, c.green(t('backpromoteDeleteSuccess', { count: options.keys.length })));
  }
  return { success: result.success, reportPath };
}
