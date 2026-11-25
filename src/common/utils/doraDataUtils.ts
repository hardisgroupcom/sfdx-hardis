import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import c from 'chalk';
import { SfError } from '@salesforce/core';
import fs from './fsUtils.js';
import { getCurrentGitBranch, getGitRepoUrl, isCI, uxLog } from './index.js';
import { t } from './i18n.js';
import { httpStatusOf } from './adaptiveBatch.js';
import { isProduction, listMajorOrgs } from './orgConfigUtils.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { CommonCiRun, GitProviderRoot } from '../gitProvider/gitProviderRoot.js';
import { keepNamedDeployments } from '../gitProvider/utils/jobKindUtils.js';
import { MONITORING_CONFIG_FILE, readDeploymentRepository } from '../monitoring/monitoringDeploymentRepository.js';
import { DoraBranchInput, DoraPeriod } from './doraMetricsUtils.js';
import { parsePromotionBranchName, parsePromotionPullRequestIds } from './promotionBranchUtils.js';

const DAY_MS = 86400000;
// Variable holding a token that can read the deployment repository, when the command runs elsewhere
export const DORA_DEPLOYMENT_REPO_TOKEN_VARIABLE = 'SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN';
// A Pull Request merged in the period can have been created long before it
const PULL_REQUEST_CREATION_MARGIN_DAYS = 90;
// Azure DevOps cuts the description of a listed Pull Request at 400 characters. A shorter one is
// whole: reading it again would not bring a list it does not have
const POSSIBLY_CUT_DESCRIPTION_LENGTH = 400;
// A project that wrote hundreds of promotions without their list must not cost a call for each
const MAX_PROMOTION_DESCRIPTIONS_READ = 30;
// Jobs listed again at each run: a job running during the last listing has finished since, and a
// job run again replaces its result
const CACHE_OVERLAP_DAYS = 2;
const CACHE_VERSION = 2;
// Runs older than the longest period that can be compared with the one before it are forgotten
const CACHE_RETENTION_DAYS = 800;

// Where DORA data is read: the repository of the current folder, or the deployment repository
// when the current folder is a monitoring repository
export interface DoraSource {
  gitProvider: GitProviderRoot;
  repository: string;
  // mergeTargets: undefined when the configuration of the pipeline is not readable from here
  branches: { name: string; level: number; isProduction: boolean; mergeTargets?: string[] }[];
  // Every major branch of the project, the ones that are not computed included. Empty when the
  // configuration of the pipeline is not readable from here
  majorBranches: string[];
}

interface DoraRunsCache {
  version: number;
  // Runs created since this date are in the cache, for the branches listed
  coveredFrom: string;
  fetchedUntil: string;
  branches: string[];
  runs: CommonCiRun[];
}

/**
 * Finds the repository, the git provider and the branches to compute.
 *
 * - In a monitoring repository (deploymentRepository in its .sfdx-hardis.yml), the provider is the
 *   one of the deployment repository and the branch is deploymentBranch.
 * - Elsewhere, the provider of the current repository. Branches: the one of the CI job, or every
 *   major branch when run by a user.
 * - branchesFlag (--branches) always wins.
 *
 * Throws when no authenticated git provider can be built: DORA metrics have no other source.
 */
export async function resolveDoraSource(branchesFlag: string | null): Promise<DoraSource> {
  const asked = (branchesFlag || '')
    .split(',')
    .map((branch) => branch.trim())
    .filter(Boolean);
  const deploymentRepository = await readDeploymentRepository();
  if (deploymentRepository) {
    const deploymentBranch = await readMonitoringDeploymentBranch();
    const branchNames = asked.length > 0 ? asked : deploymentBranch ? [deploymentBranch] : [];
    if (branchNames.length === 0) {
      throw new SfError(t('doraReportDeploymentBranchMissing'));
    }
    const gitProvider = GitProvider.getInstanceForRepository(deploymentRepository, {
      token: process.env[DORA_DEPLOYMENT_REPO_TOKEN_VARIABLE] || null,
      tokenVariableName: DORA_DEPLOYMENT_REPO_TOKEN_VARIABLE,
    });
    return {
      gitProvider,
      repository: deploymentRepository,
      branches: branchNames.map((name, index) => ({ name, level: index, isProduction: isProduction(name) })),
      majorBranches: [],
    };
  }

  const gitProvider = await GitProvider.getInstance();
  if (!gitProvider) {
    throw new SfError(t('doraReportNoGitProviderToken'));
  }
  const majorOrgs = await listMajorOrgs();
  const levelOf = (name: string) => Number(majorOrgs.find((majorOrg) => majorOrg.branchName === name)?.level) || 0;
  const mergeTargetsOf = (name: string): string[] => {
    const mergeTargets = majorOrgs.find((majorOrg) => majorOrg.branchName === name)?.mergeTargets;
    return Array.isArray(mergeTargets) ? mergeTargets.filter((target) => typeof target === 'string') : [];
  };
  let branchNames = asked;
  if (branchNames.length === 0 && isCI) {
    const currentBranch = await getCurrentGitBranch();
    branchNames = currentBranch ? [currentBranch] : [];
  }
  if (branchNames.length === 0) {
    branchNames = majorOrgs.map((majorOrg) => majorOrg.branchName).filter(Boolean);
  }
  if (branchNames.length === 0) {
    throw new SfError(t('doraReportNoMajorBranch'));
  }
  return {
    gitProvider,
    repository: (await getGitRepoUrl()) || '',
    branches: branchNames
      .map((name) => ({ name, level: levelOf(name), isProduction: isProduction(name), mergeTargets: mergeTargetsOf(name) }))
      // The pipeline order: from the first org a change reaches to production
      .sort((a, b) => a.level - b.level),
    majorBranches: majorOrgs.map((majorOrg) => majorOrg.branchName).filter(Boolean),
  };
}

/** The window of the report, and the one of the same length before it when a comparison is asked for */
export function buildDoraPeriod(periodDays: number, compare: boolean, now: Date = new Date()): DoraPeriod {
  const from = new Date(now.getTime() - periodDays * DAY_MS);
  return { from, to: now, previousFrom: compare ? new Date(from.getTime() - periodDays * DAY_MS) : null };
}

/** Pull Requests merged since this date are all read: a change merged before it cannot be followed through the pipeline */
export function pipelineTracedFrom(period: DoraPeriod): Date {
  return new Date((period.previousFrom || period.from).getTime() - PULL_REQUEST_CREATION_MARGIN_DAYS * DAY_MS);
}

/**
 * Reads the deployment jobs, the deployment checks and the Pull Requests of the branches.
 *
 * Finished jobs do not change: they are kept in a file per repository, and only the jobs newer
 * than the last reading are asked to the provider (refresh reads everything again).
 */
export async function collectDoraBranchInputs(
  source: DoraSource,
  period: DoraPeriod,
  options: { refresh: boolean; cacheDir?: string; now?: Date; commandThis?: any },
): Promise<DoraBranchInput[]> {
  const now = options.now || new Date();
  const fetchFrom = period.previousFrom || period.from;
  const branchNames = source.branches.map((branch) => branch.name);

  uxLog("action", options.commandThis, c.cyan(t('doraReportFetchingCiRuns', { branches: branchNames.join(', ') })));
  const runs = await collectRuns(source, branchNames, fetchFrom, now, options);

  uxLog("action", options.commandThis, c.cyan(t('doraReportFetchingPullRequests')));
  const inputs: DoraBranchInput[] = [];
  for (const branch of source.branches) {
    const pullRequestsFrom = new Date(fetchFrom.getTime() - PULL_REQUEST_CREATION_MARGIN_DAYS * DAY_MS);
    const [allPullRequests, openPullRequests] = await Promise.all([
      listPullRequestsOrThrow(source.gitProvider, { targetBranch: branch.name, minDate: pullRequestsFrom, withoutComments: true }),
      listPullRequestsOrThrow(source.gitProvider, { status: 'open', targetBranch: branch.name, withoutComments: true }),
    ]);
    const mergedPullRequests = allPullRequests.filter((pullRequest) => Date.parse(pullRequest.mergedDate || '') >= fetchFrom.getTime());
    const pipelinePullRequests = await completePromotionDescriptions(
      source.gitProvider,
      allPullRequests.filter((pullRequest) => !Number.isNaN(Date.parse(pullRequest.mergedDate || ''))),
    );
    // A provider that does not say which branch a deployment check is for names its Pull Request,
    // or at least the branch the Pull Request comes from
    const knownPullRequests = [...allPullRequests, ...openPullRequests];
    const pullRequestIds = new Set(knownPullRequests.map((pullRequest) => pullRequest.idStr || String(pullRequest.idNumber)));
    const sourceBranches = new Set(knownPullRequests.map((pullRequest) => pullRequest.sourceBranch).filter(Boolean));
    const isValidationOfBranch = (run: CommonCiRun) => {
      if (run.branch) {
        return run.branch === branch.name;
      }
      return run.pullRequestId ? pullRequestIds.has(run.pullRequestId) : !!run.sourceBranch && sourceBranches.has(run.sourceBranch);
    };
    inputs.push({
      ...branch,
      deploymentRuns: runs.filter((run) => run.kind === 'deployment' && run.branch === branch.name),
      validationRuns: runs.filter((run) => run.kind === 'validation' && isValidationOfBranch(run)),
      mergedPullRequests,
      openPullRequests,
      pipelinePullRequests,
    });
  }
  return inputs;
}

async function readMonitoringDeploymentBranch(): Promise<string | null> {
  try {
    const config: any = yaml.load(await fs.readFile(MONITORING_CONFIG_FILE, 'utf8'));
    const value = config?.deploymentBranch;
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  } catch {
    return null;
  }
}

async function collectRuns(
  source: DoraSource,
  branchNames: string[],
  fetchFrom: Date,
  now: Date,
  options: { refresh: boolean; cacheDir?: string },
): Promise<CommonCiRun[]> {
  // Without the address of the repository nothing says whose runs a cache file holds: no cache then
  const cacheFile = source.repository
    ? path.join(options.cacheDir || getDoraCacheRoot(), `${crypto.createHash('sha1').update(source.repository.toLowerCase()).digest('hex')}.json`)
    : null;
  const cache = options.refresh || !cacheFile ? null : await readRunsCache(cacheFile);
  // The cache answers when it goes back far enough and knows every branch asked for
  const usable = cache != null && Date.parse(cache.coveredFrom) <= fetchFrom.getTime() && branchNames.every((branch) => cache.branches.includes(branch));
  const minDate = usable ? new Date(Math.max(fetchFrom.getTime(), Date.parse(cache.fetchedUntil) - CACHE_OVERLAP_DAYS * DAY_MS)) : fetchFrom;

  // Every branch of the cache is read again, not only the ones asked for: the cache says one date
  // up to which it is complete, for all of its branches
  const fetchedBranches = usable ? cache.branches : branchNames;
  let fresh: CommonCiRun[];
  try {
    fresh = await source.gitProvider.listCiRuns({ branches: fetchedBranches, minDate, kinds: ['deployment', 'validation'] });
  } catch (e) {
    const status = httpStatusOf(e);
    if (status === 401 || status === 403 || status === 404) {
      throw new SfError(t('doraReportCiRunsNotReadable', { repository: source.repository, status, tokenVariable: DORA_DEPLOYMENT_REPO_TOKEN_VARIABLE }));
    }
    throw e;
  }

  const runsByKey = new Map<string, CommonCiRun>();
  // The cached runs of the overlap are dropped first: a job the provider no longer lists as it was
  // (run again, still running) must not survive from the cache
  for (const run of usable ? cache.runs.filter((cached) => Date.parse(cached.queuedAt) < minDate.getTime()) : []) {
    runsByKey.set(`${run.kind}:${run.id}`, run);
  }
  for (const run of fresh) {
    runsByKey.set(`${run.kind}:${run.id}`, run);
  }
  const retainedFrom = now.getTime() - CACHE_RETENTION_DAYS * DAY_MS;
  const runs = [...runsByKey.values()].filter((run) => !(Date.parse(run.queuedAt) < retainedFrom));
  if (cacheFile) {
    await writeRunsCache(cacheFile, {
      version: CACHE_VERSION,
      coveredFrom: new Date(Math.max(retainedFrom, Date.parse(usable ? cache.coveredFrom : fetchFrom.toISOString()))).toISOString(),
      fetchedUntil: now.toISOString(),
      branches: fetchedBranches,
      runs,
    });
  }
  // Whether an unnamed run is a deployment is decided on everything known about its branch
  return keepNamedDeployments(runs).filter((run) => Date.parse(run.queuedAt) >= fetchFrom.getTime() || Date.parse(run.finishedAt) >= fetchFrom.getTime());
}

// What a promotion Pull Request carries is the list in its description, and a listing can cut a
// description short (Azure DevOps): the promotions whose list is not there are read one by one
async function completePromotionDescriptions(gitProvider: GitProviderRoot, pullRequests: CommonPullRequestInfo[]): Promise<CommonPullRequestInfo[]> {
  const completed: CommonPullRequestInfo[] = [];
  let read = 0;
  // One at a time: a burst of calls is what a provider throttles
  for (const pullRequest of pullRequests) {
    const mayBeCut =
      parsePromotionBranchName(pullRequest.sourceBranch || '') != null &&
      parsePromotionPullRequestIds(pullRequest.description) == null &&
      (pullRequest.description || '').length >= POSSIBLY_CUT_DESCRIPTION_LENGTH;
    if (!mayBeCut || read >= MAX_PROMOTION_DESCRIPTIONS_READ) {
      completed.push(pullRequest);
      continue;
    }
    read++;
    try {
      const full = await gitProvider.getPullRequestById(pullRequest.idNumber);
      completed.push(full?.description ? { ...pullRequest, description: full.description } : pullRequest);
    } catch {
      // The pipeline flow then counts it among what it could not follow
      completed.push(pullRequest);
    }
  }
  return completed;
}

// Next to the other sfdx-hardis caches of the user. The folder can be moved for tests
function getDoraCacheRoot(): string {
  return process.env.SFDX_HARDIS_DORA_CACHE_DIR || path.join(os.homedir(), '.sfdx', 'sfdx-hardis-cache', 'dora');
}

async function readRunsCache(cacheFile: string): Promise<DoraRunsCache | null> {
  try {
    const cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as DoraRunsCache;
    return cache?.version === CACHE_VERSION && Array.isArray(cache.runs) && Array.isArray(cache.branches) ? cache : null;
  } catch {
    return null;
  }
}

// The cache only saves time: a disk that refuses the file must not fail the report
async function writeRunsCache(cacheFile: string, cache: DoraRunsCache): Promise<void> {
  try {
    await fs.ensureDir(path.dirname(cacheFile));
    await fs.writeFile(cacheFile, JSON.stringify(cache), 'utf8');
  } catch {
    // Nothing to do: the next run reads everything again
  }
}

// The providers answer null when a listing failed, after a warning: a report would then show
// "no Pull Request" for a branch that has many
async function listPullRequestsOrThrow(
  gitProvider: GitProviderRoot,
  filters: { status?: string; targetBranch?: string; minDate?: Date; withoutComments?: boolean },
): Promise<CommonPullRequestInfo[]> {
  const pullRequests = await gitProvider.listPullRequests(filters);
  if (pullRequests == null) {
    throw new SfError(t('doraReportPullRequestsNotReadable', { branch: filters.targetBranch || '' }));
  }
  return pullRequests;
}
