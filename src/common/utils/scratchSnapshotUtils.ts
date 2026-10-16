import c from 'chalk';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { SfError } from '@salesforce/core';
import { createTempDir, execSfdxJson, uxLog } from './index.js';
import { soqlQuery } from './apiUtils.js';
import { callSfdxGitDelta } from './gitUtils.js';
import { countPackageXmlItems } from './xmlUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { GitProvider } from '../gitProvider/index.js';
import { t } from './i18n.js';

// Set by hardis:scratch:snapshot:refresh on its own scratch org, which must be built from empty
export const SCRATCH_SNAPSHOT_DISABLED_ENV = 'SFDX_HARDIS_SCRATCH_SNAPSHOT_DISABLED';

export type ScratchSnapshot = { name: string; sha: string };

// The newest Active snapshot of the target branch whose commit is in the history of HEAD,
// or the reason why the scratch org must be created empty
export async function resolveScratchSnapshot(devHubConn: any): Promise<{ snapshot?: ScratchSnapshot; reason?: string }> {
  const targetBranch = process.env.FORCE_TARGET_BRANCH || (await GitProvider.getPullRequestInfo({ useCache: true }))?.targetBranch;
  if (!targetBranch) {
    return { reason: t('scratchSnapshotNoTargetBranch') };
  }
  if (!(await getScratchSnapshotBranchConfig(targetBranch)).enabled) {
    return { reason: t('scratchSnapshotNotEnabled', { branch: targetBranch }) };
  }
  const snapshotRecords = await listActiveSnapshots(devHubConn, targetBranch);
  const snapshot = pickScratchSnapshot(snapshotRecords, targetBranch, isAncestorOfHead);
  if (!snapshot) {
    return { reason: t('scratchSnapshotNoneUsable', { branch: targetBranch, count: snapshotRecords.length }) };
  }
  return { snapshot };
}

// useScratchOrgSnapshot and scratchOrgSnapshotKeep are read from the branch's own config file:
// a Pull Request job loads the config of its source branch, not of its target branch
export async function getScratchSnapshotBranchConfig(branch: string): Promise<{ enabled: boolean; keep: number }> {
  const branchConfig = (await listMajorOrgs()).find((majorOrg) => majorOrg.branchName === branch.replace('/', '__'));
  return {
    enabled: branchConfig?.useScratchOrgSnapshot === true,
    keep: Math.max(1, Math.floor(Number(branchConfig?.scratchOrgSnapshotKeep)) || 2),
  };
}

export async function listActiveSnapshots(devHubConn: any, branch: string): Promise<any[]> {
  // The LIKE only narrows the query: pickScratchSnapshot matches the exact prefix
  const likePrefix = getSnapshotDescriptionPrefix(branch).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const res = await soqlQuery(
    `SELECT Id, SnapshotName, Description, CreatedDate FROM OrgSnapshot WHERE Status = 'Active' AND Description LIKE '${likePrefix}%' ORDER BY CreatedDate DESC`,
    devHubConn
  );
  return res.records || [];
}

// Records must be sorted newest first
export function pickScratchSnapshot(
  snapshotRecords: any[],
  branch: string,
  isAncestor: (sha: string) => boolean
): ScratchSnapshot | null {
  const prefix = getSnapshotDescriptionPrefix(branch);
  for (const record of snapshotRecords) {
    const description: string = record.Description || '';
    const sha = description.startsWith(prefix) ? description.slice(prefix.length) : '';
    if (/^[0-9a-f]{40}$/.test(sha) && isAncestor(sha)) {
      return { name: record.SnapshotName, sha };
    }
  }
  return null;
}

// Deploys what changed between the commit of the snapshot and HEAD, deletions included
export async function deploySnapshotDelta(snapshot: ScratchSnapshot, targetUsername: string, commandThis: any, debugMode = false) {
  const deltaDir = await createTempDir();
  await callSfdxGitDelta(snapshot.sha, 'HEAD', deltaDir, { debugMode });
  const packageXml = path.join(deltaDir, 'package', 'package.xml');
  const destructiveChangesXml = path.join(deltaDir, 'destructiveChanges', 'destructiveChanges.xml');
  const toDeploy = await countPackageXmlItems(packageXml);
  const toDelete = await countPackageXmlItems(destructiveChangesXml);
  uxLog("action", commandThis, c.cyan(t('scratchSnapshotDelta', { sha: snapshot.sha.slice(0, 8), toDeploy, toDelete })));
  if (toDeploy === 0 && toDelete === 0) {
    return;
  }
  let deployCommand = `sf project deploy start --manifest "${packageXml}" --ignore-warnings --ignore-conflicts --target-org ${targetUsername} --wait 60`;
  if (toDelete > 0) {
    deployCommand += ` --post-destructive-changes "${destructiveChangesXml}"`;
  }
  await execSfdxJson(deployCommand, commandThis, { fail: true, output: true, debug: debugMode });
}

// Snapshot names are 15 alphanumeric characters at most. The branch is part of the name, as two major branches
// can have the same head commit and each needs its own snapshot
export function getSnapshotName(branch: string, sha: string): string {
  return 'SH' + sha.slice(0, 7) + createHash('sha1').update(branch).digest('hex').slice(0, 6);
}

export async function getSnapshotRecord(devHubConn: any, name: string): Promise<any | null> {
  const res = await soqlQuery(`SELECT Id, SnapshotName, Status, Error FROM OrgSnapshot WHERE SnapshotName = '${name}'`, devHubConn);
  return res.records?.[0] || null;
}

export function getSnapshotDescription(branch: string, sha: string): string {
  return `${getSnapshotDescriptionPrefix(branch)}${sha}`;
}

// sf org create snapshot has no --wait
export async function waitSnapshotActive(devHubConn: any, name: string, timeoutMinutes: number, commandThis: any) {
  const deadline = Date.now() + timeoutMinutes * 60000;
  for (; ;) {
    const record = await getSnapshotRecord(devHubConn, name);
    if (record?.Status === 'Active') {
      return record;
    }
    if (record?.Status === 'Error') {
      throw new SfError(t('scratchSnapshotFailed', { name, error: record.Error || '' }));
    }
    if (Date.now() > deadline) {
      throw new SfError(t('scratchSnapshotTimeout', { name, minutes: timeoutMinutes }));
    }
    uxLog("log", commandThis, c.grey(t('scratchSnapshotWaiting', { name, status: record?.Status || '?' })));
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

// Keeps the newest Active snapshots of the branch: a Pull Request behind its target branch uses an older one
export async function pruneScratchSnapshots(devHubConn: any, devHubUsername: string, branch: string, keep: number, commandThis: any): Promise<string[]> {
  const prefix = getSnapshotDescriptionPrefix(branch);
  const branchSnapshots = (await listActiveSnapshots(devHubConn, branch)).filter((record) => (record.Description || '').startsWith(prefix));
  const deleted: string[] = [];
  for (const record of branchSnapshots.slice(keep)) {
    uxLog("action", commandThis, c.cyan(t('scratchSnapshotDeleting', { name: record.SnapshotName })));
    const deleteRes = await execSfdxJson(
      `sf org delete snapshot --snapshot ${record.SnapshotName} --target-dev-hub ${devHubUsername} --no-prompt`,
      commandThis,
      { fail: false, output: true }
    );
    if (deleteRes?.status === 0) {
      deleted.push(record.SnapshotName);
    } else {
      uxLog("warning", commandThis, c.yellow(t('scratchSnapshotDeleteFailed', { name: record.SnapshotName, message: deleteRes?.errorMessage || deleteRes?.message || '' })));
    }
  }
  return deleted;
}

export function getSnapshotDescriptionPrefix(branch: string): string {
  return `sfdx-hardis branch=${branch} sha=`;
}

function isAncestorOfHead(sha: string): boolean {
  // Exit code 1: not an ancestor. 128: the commit is not in this clone (shallow history)
  return spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD']).status === 0;
}
