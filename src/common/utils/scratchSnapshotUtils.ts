import c from 'chalk';
import * as path from 'path';
import { spawnSync } from 'child_process';
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

export function getSnapshotDescriptionPrefix(branch: string): string {
  return `sfdx-hardis branch=${branch} sha=`;
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

export async function listActiveSnapshots(devHubConn: any, branch: string): Promise<any[]> {
  // The LIKE only narrows the query: pickScratchSnapshot matches the exact prefix
  const likePrefix = getSnapshotDescriptionPrefix(branch).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const res = await soqlQuery(
    `SELECT Id, SnapshotName, Description, CreatedDate FROM OrgSnapshot WHERE Status = 'Active' AND Description LIKE '${likePrefix}%' ORDER BY CreatedDate DESC`,
    devHubConn
  );
  return res.records || [];
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

function isAncestorOfHead(sha: string): boolean {
  // Exit code 1: not an ancestor. 128: the commit is not in this clone (shallow history)
  return spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD']).status === 0;
}
