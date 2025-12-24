import { CommonPullRequestInfo, GitProvider } from "../gitProvider/index.js";
import { uxLog } from "./index.js";
import c from "chalk";
import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { listMajorOrgs } from "./orgConfigUtils.js";

let _cachedPullRequests: CommonPullRequestInfo[] | null = null;

export async function getPullRequestScopedSfdxHardisConfig(pr: CommonPullRequestInfo): Promise<object | null> {
  const prConfigFileName = path.join("scripts", "actions", `.sfdx-hardis.${pr.idStr}.yml`);
  if (fs.existsSync(prConfigFileName)) {
    try {
      const prConfig = await fs.readFile(prConfigFileName, 'utf8');
      const prConfigParsed = yaml.load(prConfig) as any;
      return prConfigParsed;
    }
    catch (err) {
      uxLog("warning", this, c.yellow(`[PullRequestUtils] Error reading PR config file ${prConfigFileName}: ${err}`));
      return null;
    }
  }
  return null;
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
  const pullRequestInfo = await gitProvider.getPullRequestInfo();
  if (!pullRequestInfo) {
    uxLog("warning", this, c.yellow('[GitProvider] No pull request info available, skipping retrieval of pull requests'));
    return [];
  }
  const majorOrgs = await listMajorOrgs();

  // Source & target are not the same if we are in checkOnly mode or deployment mode
  let sourceBranchToUse = '';
  let targetBranchToUse = '';
  if (checkOnly) {
    sourceBranchToUse = pullRequestInfo.sourceBranch;
    targetBranchToUse = pullRequestInfo.targetBranch;
  }
  else {
    const prTargetOrgDef = majorOrgs.find(o => o.branchName === pullRequestInfo.targetBranch);
    if (prTargetOrgDef) {
      if (!prTargetOrgDef.mergeTargets || prTargetOrgDef.mergeTargets.length === 0) {
        uxLog("warning", this, c.yellow(`[GitProvider] No merge targets defined for target branch ${prTargetOrgDef.branchName}, cannot retrieve pull requests.`));
        return [];
      }
      sourceBranchToUse = prTargetOrgDef.branchName;
      targetBranchToUse = prTargetOrgDef.mergeTargets[0]; // Use first merge target as target branch
    }
    else {
      uxLog("warning", this, c.yellow(`[GitProvider] Target branch ${pullRequestInfo.targetBranch} not found in major orgs list, cannot retrieve pull requests.\nPR: ${JSON.stringify(pullRequestInfo, null, 2)}`));
      return [];
    }
  }

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