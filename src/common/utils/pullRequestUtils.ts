import { CommonPullRequestInfo, GitProvider } from "../gitProvider/index.js";
import { uxLog } from "./index.js";
import c from "chalk";
import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { isRetrofit, listMajorOrgs } from "./orgConfigUtils.js";
import { SfError } from "@salesforce/core";
import { t } from "./i18n.js";

let _cachedPullRequests: CommonPullRequestInfo[] | null = null;

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

function getYamlFromPrDescription(pr: CommonPullRequestInfo): object | null {
  const yamlStart = pr.description.indexOf("```yaml");
  const yamlEnd = pr.description.indexOf("```", yamlStart + 1);
  if (yamlStart !== -1 && yamlEnd !== -1) {
    const yamlContent = pr.description.substring(yamlStart + 7, yamlEnd).trim();
    try {
      const parsedYaml = yaml.load(yamlContent) as any;
      return parsedYaml;
    }
    catch (err) {
      throw new SfError(`[PullRequestUtils] Error parsing YAML from PR description for PR ${pr.idStr} ${pr.webUrl}: ${err}`);
    }
  }
  return null;
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

  // Source & target are not the same if we are in checkOnly mode or deployment mode
  let sourceBranchToUse = '';
  let targetBranchToUse = '';
  if (checkOnly) {
    // ex: feature/my-feature
    sourceBranchToUse = pullRequestInfo.sourceBranch;
    // ex: integration
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
    if (isSinglePullRequestScope(pullRequestInfo.sourceBranch, majorOrgs.map(o => o.branchName))) {
      uxLog("log", this, c.grey(`[GitProvider] ${t('pullRequestScopeFeatureBranchMerge', {
        sourceBranch: pullRequestInfo.sourceBranch,
        pr: pullRequestInfo.idStr,
      })}`));
      _cachedPullRequests = [pullRequestInfo];
      return _cachedPullRequests;
    }
    if (!prTargetOrgDef.mergeTargets || prTargetOrgDef.mergeTargets.length === 0) {
      uxLog("warning", this, c.yellow(`[GitProvider] No merge targets defined for target branch ${prTargetOrgDef.branchName}, cannot retrieve pull requests.`));
      return [];
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
  // Recursively find all child branches of the target branch
  // Ex: if targetbranchToUse is uat, we'll retrieve [integration]
  const childBranchesNames = recursiveGetChildBranches(
    targetBranchToUse,
    majorOrgs,
  );
  const pullRequests = await gitProvider.listPullRequestsInBranchSinceLastMerge(
    sourceBranchToUse,
    targetBranchToUse,
    [...childBranchesNames]
  );
  pullRequests.reverse(); // Oldest PR first
  // Add current PR if not already present
  if (!pullRequests.some(pr => pr.idStr === pullRequestInfo.idStr)) {
    pullRequests.push(pullRequestInfo);
  }
  _cachedPullRequests = pullRequests;
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