import c from 'chalk';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { SfError } from '@salesforce/core';
import { createTempDir, execSfdxJson, uxLog } from './index.js';
import { soqlQuery } from './apiUtils.js';
import { callSfdxGitDelta } from './gitUtils.js';
import { countPackageXmlItems } from './xmlUtils.js';
import { removePackageXmlContent } from './deployUtils.js';
import { appendPackageModifications, extendPackageFileWithDependencies } from './deltaUtils.js';
import { getScratchDeployManifest } from './orgUtils.js';
import { getOrgInitSteps, selectOrgInitSteps } from './orgInitUtils.js';
import fs from './fsUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { getConfig, getEnvVar, projectConfigFiles } from '../../config/index.js';
import { resolveDataWorkspacePath } from './dataUtils.js';
import * as yaml from 'js-yaml';
import { isAncestor } from './backpromoteGitUtils.js';
import { GitProvider } from '../gitProvider/index.js';
import { t } from './i18n.js';

// Set by hardis:scratch:snapshot:refresh on its own scratch org, which must be built from empty
export const SCRATCH_SNAPSHOT_DISABLED_ENV = 'SFDX_HARDIS_SCRATCH_SNAPSHOT_DISABLED';

export type ScratchSnapshot = { name: string; sha: string };

// The newest Active snapshot of the target branch (the given branch for a pool fill) whose commit is in the history
// of HEAD, or the reason why the scratch org must be created empty. No reason when no branch uses snapshots
export async function resolveScratchSnapshot(devHubConn: any, branch?: string): Promise<{ snapshot?: ScratchSnapshot; reason?: string }> {
  if (!(await listMajorOrgs()).some((majorOrg) => majorOrg.useScratchOrgSnapshot === true)) {
    return {};
  }
  const targetBranch = branch ?? pickSnapshotTargetBranch((await GitProvider.getPullRequestInfo({ useCache: true }))?.targetBranch);
  if (!targetBranch) {
    return { reason: t('scratchSnapshotNoTargetBranch') };
  }
  if (!(await getScratchSnapshotBranchConfig(targetBranch)).enabled) {
    return { reason: t('scratchSnapshotNotEnabled', { branch: targetBranch }) };
  }
  const scope = await getSnapshotScope(targetBranch);
  const snapshotRecords = await listActiveSnapshots(devHubConn, scope);
  if (snapshotRecords.length > 0) {
    fetchFullHistoryIfShallow();
  }
  const snapshot = pickScratchSnapshot(snapshotRecords, scope, (sha) => isAncestor(sha, 'HEAD'));
  if (!snapshot) {
    return { reason: t('scratchSnapshotNoneUsable', { branch: targetBranch, count: snapshotRecords.length }) };
  }
  if (scratchDefChangedSince(snapshot.sha)) {
    return { reason: t('scratchSnapshotScratchDefChanged', { sha: snapshot.sha.slice(0, 8) }) };
  }
  const changedStep = await orgInitStepChangedSince(snapshot.sha, targetBranch);
  if (changedStep) {
    return { reason: t('scratchSnapshotOrgInitStepChanged', { step: changedStep, sha: snapshot.sha.slice(0, 8) }) };
  }
  return { snapshot };
}

// The Pull Request of the git provider first, as deploy:smart and the PR comments use it. FORCE_TARGET_BRANCH, then
// the CI tool's own variable, when the provider gives none (no token, local run). Azure Repos gives refs/heads/<name>
export function pickSnapshotTargetBranch(prTargetBranch?: string | null): string | undefined {
  const targetBranch =
    prTargetBranch ||
    ['FORCE_TARGET_BRANCH', 'GITHUB_BASE_REF', 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', 'SYSTEM_PULLREQUEST_TARGETBRANCH', 'BITBUCKET_PR_DESTINATION_BRANCH', 'CHANGE_TARGET']
      .map((name) => getEnvVar(name))
      .find(Boolean);
  return targetBranch ? targetBranch.replace(/^refs\/heads\//, '') : undefined;
}

// useScratchOrgSnapshot and scratchOrgSnapshotKeep are read from the branch's own config file:
// a Pull Request job loads the config of its source branch, not of its target branch
export async function getScratchSnapshotBranchConfig(branch: string): Promise<{ enabled: boolean; keep: number }> {
  const branchConfig = (await listMajorOrgs()).find((majorOrg) => majorOrg.branchName === branch.replace('/', '__'));
  return {
    enabled: branchConfig?.useScratchOrgSnapshot === true,
    keep: parsePositiveSetting(branchConfig?.scratchOrgSnapshotKeep, 2),
  };
}

// The project and the branch a snapshot belongs to: projects sharing a Dev Hub must not see each other's snapshots
export async function getSnapshotScope(branch: string): Promise<string> {
  const projectName = getEnvVar('PROJECT_NAME') || (await getConfig('project')).projectName || '';
  return `project=${projectName} branch=${branch}`;
}

export async function listActiveSnapshots(devHubConn: any, scope: string): Promise<any[]> {
  // LIKE treats _ as a wildcard, so the exact prefix is checked again on the records
  const prefix = getSnapshotDescriptionPrefix(scope);
  const likePrefix = prefix.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const res = await soqlQuery(
    `SELECT Id, SnapshotName, Description, CreatedDate FROM OrgSnapshot WHERE Status = 'Active' AND Description LIKE '${likePrefix}%' ORDER BY CreatedDate DESC`,
    devHubConn
  );
  return (res.records || []).filter((record) => (record.Description || '').startsWith(prefix));
}

// A shallow clone lacks the snapshot commits. The full history is fetched only when a snapshot may be used, so the
// jobs of projects without snapshots keep their shallow clone. A full clone is left alone (--unshallow fails on it)
export function fetchFullHistoryIfShallow(cwd = process.cwd()): boolean {
  const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd, encoding: 'utf8' });
  if (shallow.stdout?.trim() !== 'true') {
    return false;
  }
  const fetch = spawnSync('git', ['fetch', '--unshallow', '--quiet'], { cwd, encoding: 'utf8' });
  if (fetch.status !== 0) {
    throw new SfError(`git fetch --unshallow: ${(fetch.stderr || fetch.error?.message || '').trim()}`);
  }
  return true;
}

// Records must be sorted newest first
export function pickScratchSnapshot(
  snapshotRecords: any[],
  scope: string,
  isAncestor: (sha: string) => boolean
): ScratchSnapshot | null {
  const prefix = getSnapshotDescriptionPrefix(scope);
  for (const record of snapshotRecords) {
    const description: string = record.Description || '';
    const sha = description.startsWith(prefix) ? description.slice(prefix.length) : '';
    // 40 characters, or 64 in a repository using the SHA-256 object format
    if (/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) && isAncestor(sha)) {
      return { name: record.SnapshotName, sha };
    }
  }
  return null;
}

// A snapshot child keeps the features and settings of the snapshot commit: a change to them needs an empty org
export function scratchDefChangedSince(sha: string, cwd = process.cwd()): boolean {
  const scratchDefFile = 'config/project-scratch-def.json';
  const paths = [scratchDefFile];
  try {
    const settingsPath = JSON.parse(fs.readFileSync(path.join(cwd, scratchDefFile), 'utf-8')).settingsPath;
    if (typeof settingsPath === 'string' && settingsPath) {
      paths.push(settingsPath);
    }
  } catch {
    // No readable definition: the diff of its path alone still decides
  }
  // Exit code 0: no change. 1: changed. Anything else is treated as changed, as an empty org is always correct
  return spawnSync('git', ['diff', '--quiet', sha, 'HEAD', '--', ...paths], { cwd }).status !== 0;
}

// A snapshot holds the result of the steps run at pool fill, which a child does not run again: a step added, removed
// or changed since the snapshot commit, or a change to the Apex script or data workspace it names, needs an empty org.
// Read from git at both commits, project and branch config files, so a step coming from extends is not compared
export async function orgInitStepChangedSince(sha: string, branch: string, cwd = process.cwd()): Promise<string | null> {
  const before = snapshotHeldSteps(readConfigAtCommit(sha, branch, cwd));
  const after = snapshotHeldSteps(readConfigAtCommit('HEAD', branch, cwd));
  for (const step of before) {
    if (!after.some((afterStep) => afterStep.id === step.id)) {
      return step.id;
    }
  }
  for (const step of after) {
    if (!isDeepStrictEqual(step, before.find((beforeStep) => beforeStep.id === step.id))) {
      return step.id;
    }
    const files = [step.parameters?.apexScript, step.type === 'data' ? await resolveDataWorkspacePath(step.parameters?.sfdmuProject) : null].filter(Boolean);
    if (files.length > 0 && spawnSync('git', ['diff', '--quiet', sha, 'HEAD', '--', ...files], { cwd }).status !== 0) {
      return step.id;
    }
  }
  return null;
}

// The org init steps of a snapshot route, as a pool: the source runs what a pool fill runs, always with the
// packages and the deployment of the sources; a child installs the packages before its delta (only those it lacks
// are installed), then runs the rest, plus the permission set assignments. A pool org filled from a snapshot gets
// only the permission set assignments: the snapshot holds the rest of the fill, the fetch runs what is left
export function selectSnapshotOrgInitStepIds(config: any, role: 'source' | 'child-packages' | 'child' | 'pool-fill'): string[] {
  const steps = selectOrgInitSteps(getOrgInitSteps(config).steps, { orgType: 'scratch', phase: role === 'pool-fill' ? 'pool-fill' : 'all' });
  const selected =
    role === 'pool-fill'
      ? steps.filter((step) => step.type === 'assign-permission-sets')
      : role === 'source'
        ? steps.filter((step) => step.runAtPoolFill !== false || ['deploy-sources', 'install-packages'].includes(step.type))
        : role === 'child-packages'
          ? steps.filter((step) => step.type === 'install-packages')
          : steps.filter(
            (step) => !['deploy-sources', 'install-packages'].includes(step.type) && (step.runAtPoolFill === false || step.type === 'assign-permission-sets')
          );
  return selected.map((step) => step.id);
}

// Deploys what changed between the commit of the snapshot and HEAD, deletions included
export async function deploySnapshotDelta(snapshot: ScratchSnapshot, configInfo: any, targetUsername: string, commandThis: any, debugMode = false) {
  const deltaDir = await createTempDir();
  await callSfdxGitDelta(snapshot.sha, 'HEAD', deltaDir, { debugMode });
  const deltaPackageXml = path.join(deltaDir, 'package', 'package.xml');
  const destructiveChangesXml = path.join(deltaDir, 'destructiveChanges', 'destructiveChanges.xml');
  await extendSnapshotDeltaWithDependencies(snapshot.sha, deltaPackageXml, destructiveChangesXml, configInfo);
  const packageXml = await scopeDeltaToDeployManifest(deltaPackageXml, configInfo, debugMode);
  const toDeploy = await countPackageXmlItems(packageXml);
  const toDelete = await countPackageXmlItems(destructiveChangesXml);
  uxLog("action", commandThis, c.cyan(t('scratchSnapshotDelta', { sha: snapshot.sha.slice(0, 8), toDeploy, toDelete })));
  if (toDeploy === 0 && toDelete === 0) {
    return;
  }
  let deployCommand = `sf project deploy start --manifest "${packageXml}" --ignore-warnings --ignore-conflicts --target-org ${targetUsername} --wait ${getEnvVar('SFDX_DEPLOY_WAIT_MINUTES') || '120'}`;
  if (toDelete > 0) {
    deployCommand += ` --post-destructive-changes "${destructiveChangesXml}"`;
  }
  const deploy = () => execSfdxJson(deployCommand, commandThis, { fail: true, output: true, debug: debugMode });
  // As the full deployment of an empty scratch org: replacement rules with their default values in deploy mode,
  // none when the sources are pushed
  if (!getScratchDeployManifest(configInfo)) {
    await deploy();
    return;
  }
  const { runWithReplacementRules } = await import('../replacementRules/engine/ruleEngine.js');
  await runWithReplacementRules({ targetBranch: null, targetUsername, packageXmlFiles: [packageXml] }, deploy);
}

// Same switch as deploy:smart: adds what depends on the changed items, as the record types of a changed field.
// It needs the full manifest, so it applies in deploy mode only
export async function extendSnapshotDeltaWithDependencies(snapshotSha: string, deltaPackageXml: string, destructiveChangesXml: string, configInfo: any) {
  const manifest = getScratchDeployManifest(configInfo);
  if (!manifest || !(process.env.USE_DELTA_DEPLOYMENT_WITH_DEPENDENCIES === 'true' || configInfo.useDeltaDeploymentWithDependencies === true)) {
    return;
  }
  uxLog("action", this, c.cyan('[DeltaDeployment] ' + t('deltaDeploymentExtendingPackageXml')));
  await extendPackageFileWithDependencies(deltaPackageXml, manifest, destructiveChangesXml);
  await appendPackageModifications(snapshotSha, 'HEAD', manifest, deltaPackageXml);
}

// In deploy mode an empty scratch org gets only the configured manifest: the delta keeps that scope, as
// deploy:smart does (manifest filtered by the delta, so a wildcard in the manifest works)
export async function scopeDeltaToDeployManifest(deltaPackageXml: string, configInfo: any, debugMode = false): Promise<string> {
  const manifest = getScratchDeployManifest(configInfo);
  if (!manifest) {
    return deltaPackageXml;
  }
  const scopedPackageXml = path.join(path.dirname(deltaPackageXml), 'packageDelta.xml');
  await fs.copy(manifest, scopedPackageXml);
  await removePackageXmlContent(scopedPackageXml, deltaPackageXml, true, { debugMode, keepEmptyTypes: false, context: 'delta' });
  return scopedPackageXml;
}

// Snapshot names are 15 alphanumeric characters at most. The scope is part of the name, as two major branches, or
// two projects sharing history, can have the same head commit and each needs its own snapshot
export function getSnapshotName(scope: string, sha: string): string {
  return 'SH' + sha.slice(0, 7) + createHash('sha1').update(scope).digest('hex').slice(0, 6);
}

export async function getSnapshotRecord(devHubConn: any, name: string): Promise<any | null> {
  const res = await soqlQuery(`SELECT Id, SnapshotName, Status, Error FROM OrgSnapshot WHERE SnapshotName = '${name}'`, devHubConn);
  return res.records?.[0] || null;
}

export function getSnapshotDescription(scope: string, sha: string): string {
  return `${getSnapshotDescriptionPrefix(scope)}${sha}`;
}

// A failed snapshot signup is retried without the snapshot, except when the retry would fail the same way or sign up
// a second org: a timeout (the first org may still be created), a scratch org limit, or exit code 68, which
// sf org create scratch gives to any failure once the org exists (settings deployment, alias, My Domain)
export function isSnapshotSignupRetryable(createResult: any): boolean {
  if (createResult?.error?.code === 68) {
    return false;
  }
  const message = String(createResult?.errorMessage || createResult?.message || '');
  // AuthCodeExchangeError: the org was created and only its login failed. NamedOrgNotFoundError: no Dev Hub login
  return !/ScratchOrgInfoTimeoutError|MyDomainResolverTimeoutError|Socket timeout occurred|LIMIT_EXCEEDED|AuthCodeExchangeError|NamedOrgNotFoundError/.test(message);
}

// The snapshot limit that has nothing left, read before the refresh builds its source org. Null when both have room
// or the Dev Hub does not report them.
export function getExhaustedSnapshotLimit(limits: any): string | null {
  for (const name of ['DailyOrgSnapshots', 'ActiveOrgSnapshots']) {
    const limit = limits?.[name];
    if (limit && Number(limit.Remaining) <= 0) {
      return `${name} (${limit.Remaining} of ${limit.Max} left)`;
    }
  }
  return null;
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
export async function pruneScratchSnapshots(devHubConn: any, devHubUsername: string, scope: string, keep: number, commandThis: any): Promise<string[]> {
  const branchSnapshots = await listActiveSnapshots(devHubConn, scope);
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

// A whole number of at least 1. Unset or not a number (Azure passes an undefined variable as its literal
// "$(NAME)") gives the default; a number below 1 gives 1
export function parsePositiveSetting(value: unknown, defaultValue: number): number {
  const parsed = Math.floor(Number(value));
  if (value == null || value === '' || !Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.max(1, parsed);
}

export function getSnapshotDescriptionPrefix(scope: string): string {
  return `sfdx-hardis ${scope} sha=`;
}

// The steps whose result is in the snapshot and that a child does not run again
function snapshotHeldSteps(config: any): any[] {
  return selectOrgInitSteps(getOrgInitSteps(config).steps, { orgType: 'scratch', phase: 'pool-fill' }).filter(
    (step) => !['deploy-sources', 'install-packages', 'assign-permission-sets'].includes(step.type)
  );
}

// The project config, then the branch config, as git holds them at a commit (no user config, no extends)
function readConfigAtCommit(ref: string, branch: string, cwd: string): any {
  const read = (files: string[]) => {
    for (const file of files) {
      const res = spawnSync('git', ['show', `${ref}:${file}`], { cwd, encoding: 'utf8' });
      if (res.status === 0) {
        return (yaml.load(res.stdout) || {}) as any;
      }
    }
    return {};
  };
  const branchName = branch.replace('/', '__');
  return Object.assign(
    read(projectConfigFiles.filter((file) => !file.endsWith('.json'))),
    read([`config/branches/.sfdx-hardis.${branchName}.yaml`, `config/branches/.sfdx-hardis.${branchName}.yml`])
  );
}
