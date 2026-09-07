import { CommonPullRequestInfo, GitProvider } from "../gitProvider/index.js";
import { uxLog } from "./index.js";
import c from "chalk";
import path from "path";
import fs from './fsUtils.js';
import yaml from "js-yaml";
import { isRetrofit, listMajorOrgs } from "./orgConfigUtils.js";
import { SfError } from "@salesforce/core";
import { t } from "./i18n.js";
import { getConfig } from "../../config/index.js";
import {
  buildPromotionIndex,
  expandPromotionPullRequests,
  filterDeclaredPullRequests,
  findPromotionsCarryingIndexed,
  getPromotionBranchConfig,
  InheritedCustomBehavior,
  isPromotionPullRequest,
  isPromotionPullRequestForItsTarget,
  mergeInheritedCustomBehaviors,
  parsePromotionPullRequestIds,
  PromotionBranchConfig,
  warnAboutPromotionPullRequestMisuse,
} from "./promotionBranchUtils.js";

let _cachedPullRequests: CommonPullRequestInfo[] | null = null;

/**
 * How the current Pull Request scope was determined.
 * - single-pr: merge from a feature branch, the merged Pull Request is the whole scope
 * - batch: merge from a major or retrofit branch, the scope is the promotion window of the target branch
 * - go-live: merge into the topmost branch, the scope is the batch carried by the merge itself
 * - check: Pull Request validation job, the scope is the content of the checked Pull Request
 * - promotion / promotion-check: deployment / validation of a promotion branch, the scope is the
 *   Pull Requests declared in its description (see promotionBranchUtils.ts)
 */
export type PullRequestScopeKind = 'single-pr' | 'batch' | 'go-live' | 'check' | 'promotion' | 'promotion-check';

let _scopeKind: PullRequestScopeKind | null = null;

/**
 * Stories of a promotion window that were already deployed through a promotion branch, with the
 * promotion Pull Requests that carried them. Informational only: they stay in the scope.
 */
let _alreadyPromoted: Array<{ story: CommonPullRequestInfo; promotions: CommonPullRequestInfo[] }> = [];

// Custom behaviors the promotion Pull Request inherited from the stories it declares
let _inheritedBehaviors: InheritedCustomBehavior[] = [];

/**
 * Returns the resolved Pull Request scope with the way it was determined,
 * so callers (like the Pull Request comment builder) can explain to the end user
 * why actions from other Pull Requests are processed.
 * Returns null when listAllPullRequestsForCurrentScope has not run (or returned nothing).
 */
export function getPullRequestScopeInfo(): { kind: PullRequestScopeKind; pullRequests: CommonPullRequestInfo[] } | null {
  if (_scopeKind == null || _cachedPullRequests == null) {
    return null;
  }
  return { kind: _scopeKind, pullRequests: _cachedPullRequests };
}

/**
 * Promotion branch details of the resolved scope, for the Pull Request comment.
 */
export function getPromotionScopeDetails(): {
  alreadyPromoted: Array<{ story: CommonPullRequestInfo; promotions: CommonPullRequestInfo[] }>;
  inheritedBehaviors: InheritedCustomBehavior[];
} {
  return { alreadyPromoted: _alreadyPromoted, inheritedBehaviors: _inheritedBehaviors };
}

async function getPromotionBranchConfigFromProject(): Promise<PromotionBranchConfig> {
  return getPromotionBranchConfig(await getConfig('branch'));
}

/**
 * Stories declared by a promotion Pull Request, fetched by number: their cherry-picked commits
 * cannot be matched by merge commit SHA like the other scopes do.
 */
async function fetchDeclaredPullRequests(gitProvider: any, promotionPr: CommonPullRequestInfo): Promise<CommonPullRequestInfo[]> {
  const declaredIds = parsePromotionPullRequestIds(promotionPr.description) || [];
  uxLog("log", null, c.grey(`[PromotionBranch] ${t('promotionScopeDeclared', {
    pr: promotionPr.idStr,
    branch: promotionPr.sourceBranch,
    count: declaredIds.length,
    prList: declaredIds.map((id) => `#${id}`).join(', ') || '-',
  })}`));
  const fetched = new Map<number, CommonPullRequestInfo | null>();
  const unreadable: string[] = [];
  for (const id of declaredIds) {
    try {
      fetched.set(id, await gitProvider.getPullRequestById(id));
    } catch (e) {
      // A 403, a rate limit or an expired token must not shrink the scope of a deployment the way
      // a genuinely deleted Pull Request does
      unreadable.push(`#${id} (${(e as Error).message})`);
      fetched.set(id, null);
    }
  }
  if (unreadable.length > 0) {
    throw new SfError(t('promotionDeclaredPrUnreadable', { pr: promotionPr.idStr, details: unreadable.join(', ') }));
  }
  const declared = filterDeclaredPullRequests(declaredIds, fetched, promotionPr);
  // A promotion assembled from a branch that itself received a promotion (ex: preprod -> main
  // carrying the uat -> preprod promotion) declares that promotion Pull Request: expandPromotion
  // PullRequests follows it down to the User Stories, however many levels there are.
  const promotionConfig = await getPromotionBranchConfigFromProject();
  return expandPromotionPullRequests(declared, promotionConfig, (id) => gitProvider.getPullRequestById(id));
}

/**
 * Promotion Pull Requests merged into a branch or any branch downstream of it (following
 * mergeTargets). Used to tell which stories of a window were already shipped through one.
 */
async function listDownstreamPromotionPullRequests(
  gitProvider: any,
  fromBranch: string,
  majorOrgs: any[],
  promotionConfig: PromotionBranchConfig,
  minDate: Date | null,
): Promise<CommonPullRequestInfo[]> {
  // Every branch downstream of this one, following all the merge targets of each: a pipeline may
  // fan out (uat -> preprod and uat -> hotfix-preprod), and a promotion merged into any of them
  // still shipped the story. Branch names are compared without case, like the other classifiers,
  // because they come from the config/branches file names.
  const branches: string[] = [];
  const queue: string[] = [fromBranch];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (!current || branches.some((branch) => branch.toLowerCase() === current.toLowerCase())) {
      continue;
    }
    branches.push(current);
    const org = majorOrgs.find((o) => (o.branchName || '').toLowerCase() === current.toLowerCase());
    for (const mergeTarget of org?.mergeTargets || []) {
      queue.push(mergeTarget);
    }
  }
  const promotions: CommonPullRequestInfo[] = [];
  for (const branch of branches) {
    try {
      const merged = (await gitProvider.listPullRequests({ status: 'merged', targetBranch: branch, ...(minDate ? { minDate } : {}) })) || [];
      promotions.push(...merged.filter((pr: CommonPullRequestInfo) => isPromotionPullRequest(pr, promotionConfig)));
    } catch (e) {
      uxLog("warning", null, c.yellow(`[PromotionBranch] ${t('promotionUnableToListPromotions', { branch, message: (e as Error).message })}`));
    }
  }
  return promotions;
}

/**
 * Complete a promotion window (batch or go-live) when promotion branches are enabled: expand the
 * promotion Pull Requests it contains with the stories they declare, and remember which stories
 * of the window already reached the target through a promotion branch.
 */
async function completeWindowWithPromotions(
  gitProvider: any,
  pullRequests: CommonPullRequestInfo[],
  windowTargetBranch: string,
  majorOrgs: any[],
  promotionConfig: PromotionBranchConfig,
): Promise<CommonPullRequestInfo[]> {
  if (!promotionConfig.enabled) {
    return pullRequests;
  }
  const expanded = await expandPromotionPullRequests(pullRequests, promotionConfig, (id) => gitProvider.getPullRequestById(id));
  // A promotion carrying a story of this window cannot be older than the oldest story of the
  // window: without that bound, every job would page through the whole history of every
  // downstream branch (and, on Azure DevOps, fetch the threads of each Pull Request).
  const downstreamPromotions = await listDownstreamPromotionPullRequests(
    gitProvider,
    windowTargetBranch,
    majorOrgs,
    promotionConfig,
    oldestPullRequestDate(expanded),
  );
  // One pass over the promotion descriptions, then a Map read per story
  const promotionIndex = buildPromotionIndex(downstreamPromotions, promotionConfig);
  _alreadyPromoted = expanded
    .map((story) => ({ story, promotions: findPromotionsCarryingIndexed(story.idNumber, promotionIndex) }))
    .filter((entry) => entry.promotions.length > 0);
  for (const entry of _alreadyPromoted) {
    uxLog("log", null, c.grey(`[PromotionBranch] ${t('promotionStoryAlreadyPromoted', {
      pr: entry.story.idStr,
      promotions: entry.promotions.map((promotion) => `${promotion.sourceBranch} (#${promotion.idStr})`).join(', '),
    })}`));
  }
  return expanded;
}

/**
 * Oldest creation date of a set of Pull Requests, used to bound provider queries.
 */
function oldestPullRequestDate(pullRequests: CommonPullRequestInfo[]): Date | null {
  const times = pullRequests
    .map((pr) => new Date(pr.createdDate || pr.mergedDate || ''))
    .filter((date) => !isNaN(date.getTime()))
    .map((date) => date.getTime());
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

/**
 * On a promotion Pull Request, inherit the custom behaviors (NO_DELTA, PURGE_FLOW_VERSIONS,
 * DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT, FLOW_DELETE_INTERVIEWS) of the stories it declares.
 * Must run before the delta decision, which is why smart deploy calls it right after loading its
 * config rather than waiting for the deployment actions to resolve the scope.
 * No effect (and no provider call) unless enablePromotionBranches is set and the Pull Request
 * is a promotion one.
 */
export async function applyPromotionInheritedBehaviors(checkOnly: boolean): Promise<InheritedCustomBehavior[]> {
  const promotionConfig = await getPromotionBranchConfigFromProject();
  if (!promotionConfig.enabled) {
    return [];
  }
  const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
  if (!isPromotionPullRequestForItsTarget(prInfo, promotionConfig)) {
    return [];
  }
  const scope = await listAllPullRequestsForCurrentScope(checkOnly);
  _inheritedBehaviors = mergeInheritedCustomBehaviors(prInfo!, scope);
  if (_inheritedBehaviors.length > 0) {
    // Re-applied by GitProvider.getPullRequestInfo on every fresh fetch of the Pull Request
    GitProvider.inheritedCustomBehaviors = Object.fromEntries(_inheritedBehaviors.map((item) => [item.behavior, true]));
    GitProvider.inheritedCustomBehaviorsPrId = prInfo!.idNumber;
    for (const item of _inheritedBehaviors) {
      uxLog("action", null, c.cyan(`[PromotionBranch] ${t('promotionInheritedBehavior', {
        keyword: item.keyword,
        prList: item.fromPullRequests.map((idStr) => `#${idStr}`).join(', '),
      })}`));
    }
  }
  return _inheritedBehaviors;
}

/**
 * Log the final scope as a single readable line: the provider internals above it show HOW the
 * scope was computed, this line shows WHAT it contains.
 */
function logResolvedScope(pullRequests: CommonPullRequestInfo[]): void {
  const prList = pullRequests.map((pr) => `#${pr.idStr}`).join(', ');
  uxLog("log", null, c.grey(`[GitProvider] ${t('pullRequestScopeResolved', { count: pullRequests.length, prList: prList || '-' })}`));
}

export async function getPullRequestScopedSfdxHardisConfig(pr: CommonPullRequestInfo): Promise<object | null> {
  const configFromPrDescription = getYamlFromPrDescription(pr);
  let configFromFile: object | null = null;
  const prConfigFileName = path.join("scripts", "actions", `.sfdx-hardis.${pr.idStr}.yml`);
  if (fs.existsSync(prConfigFileName)) {
    try {
      const prConfig = await fs.readFile(prConfigFileName, 'utf8');
      configFromFile = yaml.load(prConfig) as any;
    }
    catch (err) {
      throw new SfError(`[PullRequestUtils] Error reading/parsing PR config file ${prConfigFileName} for PR ${pr.idStr}: ${err}`);
    }
  }
  if (!configFromFile && !configFromPrDescription) {
    return null;
  }
  if (!configFromFile) {
    return configFromPrDescription;
  }
  if (!configFromPrDescription) {
    return configFromFile;
  }
  // Merge config from file and from PR description (PR description has precedence). Log when a property has been overridden
  const mergedConfig: any = { ...configFromFile };
  for (const [key, value] of Object.entries(configFromPrDescription)) {
    if (Object.prototype.hasOwnProperty.call(mergedConfig, key)) {
      uxLog("log", this, c.grey(`[PullRequestUtils] Overriding PR config property '${key}' from PR description for PR ${pr.idStr} ${pr.webUrl}`));
    }
    mergedConfig[key] = value;
  }
  return mergedConfig;
}

/**
 * Merge one more YAML block of a Pull Request description into what the previous blocks gave.
 *
 * A list is added to the list already there, without duplicates: someone appending a block to name
 * one more Apex test class or one more deployment action is adding it, not replacing everything
 * declared above. Anything else is a value, and the last block wins.
 */
export function mergePrDescriptionYamlBlocks(merged: any, parsedYaml: any): any {
  const result: any = Object.assign({}, merged || {});
  for (const [key, value] of Object.entries(parsedYaml || {})) {
    if (Array.isArray(value) && Array.isArray(result[key])) {
      const kept = [...result[key]];
      for (const item of value) {
        const isDuplicate = kept.some((existing) => JSON.stringify(existing) === JSON.stringify(item));
        if (!isDuplicate) {
          kept.push(item);
        }
      }
      result[key] = kept;
      continue;
    }
    result[key] = value;
  }
  return result;
}

function getYamlFromPrDescription(pr: CommonPullRequestInfo): object | null {
  // Every ```yaml block, not only the first: a promotion Pull Request description opens with the
  // promotionPullRequests block, and anything the release manager adds after it (deployment
  // actions, Apex test classes) would otherwise be read by nobody.
  const regex = /```ya?ml\s*\r?\n([\s\S]*?)```/gi;
  let merged: any = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(pr.description || "")) !== null) {
    let parsedYaml: any;
    try {
      parsedYaml = yaml.load(match[1]) as any;
    }
    catch (err) {
      throw new SfError(`[PullRequestUtils] Error parsing YAML from PR description for PR ${pr.idStr} ${pr.webUrl}: ${err}`);
    }
    if (parsedYaml && typeof parsedYaml === "object") {
      merged = mergePrDescriptionYamlBlocks(merged, parsedYaml);
    }
  }
  return merged;
}

/**
 * Tells whether a merge carries only its own Pull Request, or a batch of upstream ones.
 *
 * A merge coming from a feature branch carries only its own Pull Request: collecting the other
 * Pull Requests of the batch would run and report their deployment actions and their Apex test
 * classes under the Pull Request that has just been merged.
 *
 * A merge coming from a major branch (ex: integration -> uat) or from a retrofit branch
 * (ex: retrofit/from-main -> integration) carries every Pull Request merged upstream since the
 * previous merge, and their actions and test classes must be replayed in the target org.
 */
export function isSinglePullRequestScope(sourceBranch: string, majorBranchNames: string[]): boolean {
  const branchName = (sourceBranch || "").toLowerCase();
  // Unknown source branch: keep the previous behavior (whole batch) rather than silently dropping
  // the actions and test classes of every upstream Pull Request.
  if (branchName === "") {
    return false;
  }
  // Compared without case, like the other branch classifiers: major branch names come from the
  // config/branches/.sfdx-hardis.<branch>.yml file names, which may not match the git branch case.
  const isMajorBranch = majorBranchNames.some((majorBranchName) => (majorBranchName || "").toLowerCase() === branchName);
  return !isMajorBranch && !isRetrofit(branchName);
}

/**
 * Resolves the scope kind of a job whose source branch carries a single Pull Request, on both
 * sides of the merge: 'check' on the validation job, 'single-pr' on the deployment job.
 *
 * Returns null when the source is a major or retrofit branch: the job then collects the whole
 * promotion window, and the caller decides how to bound it.
 *
 * The rule is the same on both sides on purpose. When the validation job of a feature branch
 * collected the promotion window, its comment listed the manual actions of every other Pull
 * Request merged upstream, and a user could tick them as done from a Pull Request they did not
 * belong to.
 */
export function getSinglePullRequestScopeKind(
  checkOnly: boolean,
  sourceBranch: string,
  majorBranchNames: string[],
): Extract<PullRequestScopeKind, 'check' | 'single-pr'> | null {
  if (!isSinglePullRequestScope(sourceBranch, majorBranchNames)) {
    return null;
  }
  return checkOnly ? 'check' : 'single-pr';
}

/**
 * Build the list of branches whose merged Pull Requests are candidates for a scope window.
 *
 * On top of the recursive child branches of the window's target branch, every major branch is
 * included: matching is bounded by the window's commit SHAs, so a Pull Request merged into an
 * upstream branch (ex: a hotfix merged into main) is only collected when its merge commit
 * actually arrived in the window - which is exactly what happens when a retrofit branch brings
 * main's commits down to integration. Without the upstream branches in the list, those Pull
 * Requests would never be fetched, and their actions would never be replayed downstream.
 *
 * excludeBranch removes the branch the git provider already adds by itself to the search list,
 * to avoid fetching the same branch's Pull Requests twice.
 */
export function buildPrSearchBranches(targetBranch: string, majorOrgs: any[], excludeBranch: string): string[] {
  const childBranchesNames = recursiveGetChildBranches(targetBranch, majorOrgs);
  const allBranches = new Set<string>([...childBranchesNames, ...majorOrgs.map((o) => o.branchName)]);
  allBranches.delete(excludeBranch);
  return [...allBranches];
}

export async function listAllPullRequestsForCurrentScope(checkOnly: boolean): Promise<CommonPullRequestInfo[]> {
  if (_cachedPullRequests) {
    return _cachedPullRequests;
  }
  const gitProvider = await GitProvider.getInstance();
  if (!gitProvider) {
    uxLog("warning", this, c.yellow('[GitProvider] No git provider configured, skipping retrieval of pull requests'));
    return [];
  }
  // Get either the current PR info (if in checkOnly mode) or the PR info of the last merged PR in the current branch (if in deployment mode)
  const pullRequestInfo = await gitProvider.getPullRequestInfo();
  if (!pullRequestInfo) {
    uxLog("warning", this, c.yellow('[GitProvider] No pull request info available, skipping retrieval of pull requests'));
    return [];
  }
  // List all major orgs and branches whose authentication has been configured with sfdx-hardis
  const majorOrgs = await listMajorOrgs();

  // Promotion branch (enablePromotionBranches): the stories are declared in the Pull Request
  // description, because their cherry-picked commits cannot be matched by merge commit SHA.
  // Same rule on the validation and on the deployment job.
  const promotionConfig = await getPromotionBranchConfigFromProject();
  warnAboutPromotionPullRequestMisuse(pullRequestInfo, promotionConfig);
  if (isPromotionPullRequestForItsTarget(pullRequestInfo, promotionConfig)) {
    const declaredPullRequests = await fetchDeclaredPullRequests(gitProvider, pullRequestInfo);
    _cachedPullRequests = [...declaredPullRequests, pullRequestInfo];
    _scopeKind = checkOnly ? 'promotion-check' : 'promotion';
    logResolvedScope(_cachedPullRequests);
    return _cachedPullRequests;
  }

  // Source & target are not the same if we are in checkOnly mode or deployment mode
  let sourceBranchToUse = '';
  let targetBranchToUse = '';
  if (checkOnly) {
    // Validation of a feature branch: the checked Pull Request is the whole scope, exactly like
    // on its deployment job. The window computed below has no meaning for a feature branch
    // (it was never merged into the target, so "since the last merge" is its whole history,
    // which contains every Pull Request ever merged upstream).
    if (getSinglePullRequestScopeKind(true, pullRequestInfo.sourceBranch, majorOrgs.map(o => o.branchName)) === 'check') {
      uxLog("log", this, c.grey(`[GitProvider] ${t('pullRequestScopeFeatureBranchCheck', {
        sourceBranch: pullRequestInfo.sourceBranch,
        pr: pullRequestInfo.idStr,
      })}`));
      _cachedPullRequests = [pullRequestInfo];
      _scopeKind = 'check';
      logResolvedScope(_cachedPullRequests);
      return _cachedPullRequests;
    }
    // Validation of a major or retrofit branch (ex: integration -> uat): the window is every
    // Pull Request merged into the source since its last merge into the target.
    // ex: integration
    sourceBranchToUse = pullRequestInfo.sourceBranch;
    // ex: uat
    targetBranchToUse = pullRequestInfo.targetBranch;
  }
  else {
    // Find major org config related to the branch of the PR just merged (ex: integration)
    const prTargetOrgDef = majorOrgs.find(o => o.branchName === pullRequestInfo.targetBranch);
    if (!prTargetOrgDef) {
      uxLog("warning", this, c.yellow(`[GitProvider] Target branch ${pullRequestInfo.targetBranch} not found in major orgs list, cannot retrieve pull requests.\nPR: ${JSON.stringify(pullRequestInfo, null, 2)}`));
      return [];
    }
    // Merge from a feature branch: the Pull Request that has just been merged is the whole scope.
    // No merge window is needed here, so this does not depend on mergeTargets being configured.
    if (getSinglePullRequestScopeKind(false, pullRequestInfo.sourceBranch, majorOrgs.map(o => o.branchName)) === 'single-pr') {
      uxLog("log", this, c.grey(`[GitProvider] ${t('pullRequestScopeFeatureBranchMerge', {
        sourceBranch: pullRequestInfo.sourceBranch,
        pr: pullRequestInfo.idStr,
      })}`));
      _cachedPullRequests = [pullRequestInfo];
      _scopeKind = 'single-pr';
      logResolvedScope(_cachedPullRequests);
      return _cachedPullRequests;
    }
    // Topmost branch (ex: production): there is no downstream promotion to anchor a window on,
    // so the scope is the batch of Pull Requests carried by the merge itself (the "go live").
    // Actions and test classes MUST also be processed on the production deployment, in the orgs
    // where they have not been performed yet.
    if (!prTargetOrgDef.mergeTargets || prTargetOrgDef.mergeTargets.length === 0) {
      let goLivePullRequests: CommonPullRequestInfo[] = [];
      if (pullRequestInfo.mergeCommitSha) {
        uxLog("log", this, c.grey(`[GitProvider] ${t('pullRequestScopeGoLiveMerge', {
          sourceBranch: pullRequestInfo.sourceBranch,
          targetBranch: pullRequestInfo.targetBranch,
        })}`));
        const goLiveSearchBranches = buildPrSearchBranches(pullRequestInfo.targetBranch, majorOrgs, pullRequestInfo.targetBranch);
        goLivePullRequests = await gitProvider.listPullRequestsInGoLive(
          pullRequestInfo.targetBranch,
          goLiveSearchBranches,
          pullRequestInfo.mergeCommitSha,
        );
        goLivePullRequests.reverse(); // Oldest PR first
      }
      else {
        uxLog("warning", this, c.yellow(`[GitProvider] ${t('pullRequestScopeGoLiveNoMergeCommit', {
          targetBranch: pullRequestInfo.targetBranch,
          pr: pullRequestInfo.idStr,
        })}`));
      }
      // Always keep at least the merged Pull Request itself in the scope
      if (!goLivePullRequests.some(pr => pr.idStr === pullRequestInfo.idStr)) {
        goLivePullRequests.push(pullRequestInfo);
      }
      goLivePullRequests = await completeWindowWithPromotions(gitProvider, goLivePullRequests, pullRequestInfo.targetBranch, majorOrgs, promotionConfig);
      _cachedPullRequests = goLivePullRequests;
      _scopeKind = 'go-live';
      logResolvedScope(_cachedPullRequests);
      return _cachedPullRequests;
    }
    // ex: integration
    sourceBranchToUse = prTargetOrgDef.branchName;
    // ex: uat (multiple merge targets is not used yet so there should always be only one)
    targetBranchToUse = prTargetOrgDef.mergeTargets[0];
    // The window is not the merge that just happened: it is every Pull Request merged into
    // sourceBranchToUse since it was last promoted to targetBranchToUse.
    uxLog("log", this, c.grey(`[GitProvider] ${t('pullRequestScopeBatchMerge', {
      sourceBranch: pullRequestInfo.sourceBranch,
      windowBranch: sourceBranchToUse,
      nextBranch: targetBranchToUse,
    })}`));
  }
  // Child branches of the window's target branch, plus every major branch so Pull Requests
  // merged upstream (ex: hotfixes in main arriving through a retrofit) are collected too.
  // Ex: if targetBranchToUse is uat and sourceBranchToUse is integration, this returns
  // [uat, preprod, main] - integration is left out because the provider prepends it itself.
  const searchBranches = buildPrSearchBranches(targetBranchToUse, majorOrgs, sourceBranchToUse);
  let pullRequests = await gitProvider.listPullRequestsInBranchSinceLastMerge(
    sourceBranchToUse,
    targetBranchToUse,
    searchBranches
  );
  pullRequests.reverse(); // Oldest PR first
  // Add current PR if not already present
  if (!pullRequests.some(pr => pr.idStr === pullRequestInfo.idStr)) {
    pullRequests.push(pullRequestInfo);
  }
  pullRequests = await completeWindowWithPromotions(gitProvider, pullRequests, targetBranchToUse, majorOrgs, promotionConfig);
  _cachedPullRequests = pullRequests;
  _scopeKind = checkOnly ? 'check' : 'batch';
  logResolvedScope(_cachedPullRequests);
  return pullRequests
}

function recursiveGetChildBranches(
  branchName: string,
  majorOrgs: any[],
  collected: Set<string> = new Set(),
): Set<string> {
  const directChildren = majorOrgs
    .filter((o) => o.mergeTargets.includes(branchName))
    .map((o) => o.branchName);
  for (const child of directChildren) {
    if (!collected.has(child)) {
      collected.add(child);
      recursiveGetChildBranches(child, majorOrgs, collected);
    }
  }
  return collected;
}