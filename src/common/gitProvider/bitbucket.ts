import { GitProviderRoot, PullRequestCommentRef } from './gitProviderRoot.js';
import c from 'chalk';
import fs from '../utils/fsUtils.js';
import * as path from "path";
import { CommonPullRequestInfo, CreatePullRequestRequest, CreatePullRequestResult, PullRequestMessageRequest, PullRequestMessageResult } from './index.js';
import { getCurrentGitBranch, git, uxLog } from '../utils/index.js';
import bbPkg, { Schema } from 'bitbucket';
import { CONSTANTS, getBannerMarkdownAndLink } from '../../config/index.js';
import { t } from '../utils/i18n.js';
import { httpPost } from '../utils/httpUtils.js';
import { isJenkins, getJenkinsBranchName, getJenkinsPrNumber, getJenkinsBuildNumber, getJenkinsJobUrl } from "./jenkinsUtils.js";
const { Bitbucket } = bbPkg;

// Oldest commit date of a window, minus one day of margin, used to bound the merged PRs
// listing: a PR is always updated when it is merged, so its updated_on cannot be older than
// the commits its merge brought. Returns null when no commit carries a date.
function getOldestBitbucketCommitDate(commits: any[]): string | null {
  const timestamps = commits
    .map((commit) => Date.parse(commit?.date || ''))
    .filter((time) => !isNaN(time));
  if (timestamps.length === 0) {
    return null;
  }
  return new Date(Math.min(...timestamps) - 24 * 60 * 60 * 1000).toISOString();
}

export class BitbucketProvider extends GitProviderRoot {
  private bitbucket: InstanceType<typeof Bitbucket>;
  public serverUrl: string = 'https://bitbucket.org';
  public token: string;
  private email: string;

  constructor() {
    super();
    this.token = process.env.CI_SFDX_HARDIS_BITBUCKET_TOKEN || '';
    // A Bitbucket repository/workspace Access Token authenticates as a Bearer
    // token (token only). An Atlassian account API token must instead be used as
    // Basic auth, with the account email as the username. Pick the scheme based
    // on whether CI_SFDX_HARDIS_BITBUCKET_EMAIL is provided.
    this.email = process.env.CI_SFDX_HARDIS_BITBUCKET_EMAIL || '';
    const clientOptions = this.email
      ? { auth: { username: this.email, password: this.token } }
      : { auth: { token: this.token } };
    this.bitbucket = new Bitbucket(clientOptions as any);
  }

  // Same credentials as the bitbucket client, for direct REST calls
  private getAuthorizationHeader(): string {
    if (this.email) {
      return 'Basic ' + Buffer.from(`${this.email}:${this.token}`).toString('base64');
    }
    return `Bearer ${this.token}`;
  }

  // Auto-detect Bitbucket CI variables from token + local git remote URL
  public static async autoDetectSettings(): Promise<void> {
    try {
      const remoteUrl = (await git().getConfig("remote.origin.url"))?.value || "";
      if (!remoteUrl) {
        uxLog("log", BitbucketProvider, c.grey("[Bitbucket] " + t("autoDetectProviderNoGitRemote", { provider: "Bitbucket" })));
        return;
      }
      const parsed = BitbucketProvider.parseBitbucketRepoUrl(remoteUrl);
      if (!parsed) {
        uxLog("log", BitbucketProvider, c.grey("[Bitbucket] " + t("autoDetectProviderParseUrlFailed", { provider: "Bitbucket" })));
        return;
      }
      if (!process.env.BITBUCKET_WORKSPACE) {
        process.env.BITBUCKET_WORKSPACE = parsed.workspace;
      }
      if (!process.env.BITBUCKET_REPO_SLUG) {
        process.env.BITBUCKET_REPO_SLUG = parsed.repoSlug;
      }
      // When running on Jenkins, map Jenkins-specific variables to Bitbucket equivalents
      if (isJenkins()) {
        if (!process.env.BITBUCKET_BUILD_NUMBER) {
          const buildNumber = getJenkinsBuildNumber();
          if (buildNumber) {
            process.env.BITBUCKET_BUILD_NUMBER = buildNumber;
          }
        }
        if (!process.env.BITBUCKET_BRANCH) {
          const branch = getJenkinsBranchName();
          if (branch) {
            process.env.BITBUCKET_BRANCH = branch;
          }
        }
        if (!process.env.BITBUCKET_PR_ID) {
          const prNumber = getJenkinsPrNumber();
          if (prNumber) {
            process.env.BITBUCKET_PR_ID = prNumber;
          }
        }
        uxLog("log", BitbucketProvider, c.grey("[Bitbucket] " + t("autoDetectProviderJenkinsMapping", { provider: "Bitbucket" })));
      }
      /* Only log the success summary when Jenkins is involved - on native CI providers this is just noise */
      if (isJenkins()) {
        uxLog("log", BitbucketProvider, c.grey("[Bitbucket] " + t("autoDetectProviderSuccess", {
          provider: "Bitbucket",
          details: `workspace=${process.env.BITBUCKET_WORKSPACE}, repo=${process.env.BITBUCKET_REPO_SLUG}`,
        })));
      }
    } catch (e) {
      uxLog("warning", BitbucketProvider, c.yellow("[Bitbucket] " + t("autoDetectProviderFailed", { provider: "Bitbucket", message: (e as Error).message })));
    }
  }

  public static parseBitbucketRepoUrl(remoteUrl: string): { serverUrl: string; workspace: string; repoSlug: string } | null {
    // HTTPS: https://bitbucket.org/workspace/repo.git
    if (remoteUrl.startsWith("https://") || remoteUrl.startsWith("http://")) {
      const url = remoteUrl.replace(/\.git$/, "").replace(/\/$/, "");
      const cleanUrl = url.replace(/\/\/([^@/]+@)/gm, "//");
      const match = cleanUrl.match(/^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+)$/);
      if (match) {
        return { serverUrl: match[1], workspace: match[2], repoSlug: match[3] };
      }
    }
    // SSH: git@bitbucket.org:workspace/repo.git
    if (remoteUrl.startsWith("git@")) {
      const match = remoteUrl.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (match) {
        return { serverUrl: `https://${match[1]}`, workspace: match[2], repoSlug: match[3] };
      }
    }
    // SSH: ssh://git@bitbucket.org/workspace/repo.git
    if (remoteUrl.startsWith("ssh://")) {
      const match = remoteUrl.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (match) {
        return { serverUrl: `https://${match[1]}`, workspace: match[2], repoSlug: match[3] };
      }
    }
    return null;
  }

  public getLabel(): string {
    return 'sfdx-hardis Bitbucket connector';
  }

  public logAutoFixRemediation(step: "push" | "pr-create"): void {
    const stepLabel = step === "push" ? "git push" : "pull request creation";
    uxLog("log", this, `\n[sfdx-hardis] Auto-fix ${stepLabel} remediation guide (bitbucket)`);
    uxLog("log", this, "1) Update workflow: set git remote with token credentials before auto-fix push.");
    uxLog("log", this, "   Example: git remote set-url origin https://x-token-auth:${CI_SFDX_HARDIS_BITBUCKET_TOKEN}@bitbucket.org/<workspace>/<repo>.git");
    uxLog("log", this, "2) Set variable: CI_SFDX_HARDIS_BITBUCKET_TOKEN");
    uxLog("log", this, "3) How to get value: Bitbucket Repository Settings -> Access Tokens -> create token with pullrequest:read, pullrequest:write, repository:read, repository:write; store it as a secured pipeline variable.");
  }

  public async getCurrentJobUrl(): Promise<string | null> {
    if (process.env.PIPELINE_JOB_URL) {
      return process.env.PIPELINE_JOB_URL;
    }
    // On Jenkins, always return the Jenkins BUILD_URL so PR comments link to the Jenkins build,
    // not a Bitbucket Pipelines URL constructed from the mapped variables
    const jenkinsUrl = getJenkinsJobUrl();
    if (isJenkins() && jenkinsUrl) {
      return jenkinsUrl;
    }
    if (process.env.BITBUCKET_WORKSPACE && process.env.BITBUCKET_REPO_SLUG && process.env.BITBUCKET_BUILD_NUMBER) {
      const jobUrl = `${this.serverUrl}/${process.env.BITBUCKET_WORKSPACE}/${process.env.BITBUCKET_REPO_SLUG}/pipelines/results/${process.env.BITBUCKET_BUILD_NUMBER}`;
      return jobUrl;
    }
    // Jenkins fallback (when BUILD_URL exists but isJenkins() returned false)
    if (jenkinsUrl) {
      return jenkinsUrl;
    }
    uxLog(
      "warning",
      this,
      c.yellow(`[Bitbucket Integration] You need the following variables to be accessible to sfdx-hardis to build current job url:
        - BITBUCKET_WORKSPACE
        - BITBUCKET_REPO_SLUG
        - BITBUCKET_BUILD_NUMBER`)
    );

    return null;
  }

  public async getCurrentBranchUrl(): Promise<string | null> {
    if (process.env.BITBUCKET_WORKSPACE && process.env.BITBUCKET_REPO_SLUG && process.env.BITBUCKET_BRANCH) {
      const currentBranchUrl = `${this.serverUrl}/${process.env.BITBUCKET_WORKSPACE}/${process.env.BITBUCKET_REPO_SLUG}/branch/${process.env.BITBUCKET_BRANCH}`;
      return currentBranchUrl;
    }
    uxLog(
      "warning",
      this,
      c.yellow(`[Bitbucket Integration] You need the following variables to be accessible to sfdx-hardis to build current job url:
        - BITBUCKET_WORKSPACE
        - BITBUCKET_REPO_SLUG
        - BITBUCKET_BRANCH`)
    );

    return null;
  }

  // Bitbucket does not supports mermaid in PR markdown
  public async supportsMermaidInPrMarkdown(): Promise<boolean> {
    return false;
  }

  // Find pull request info
  public async getPullRequestInfo(): Promise<CommonPullRequestInfo | null> {
    const pullRequestIdStr = process.env.BITBUCKET_PR_ID || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;

    // Case when PR is found in the context
    if (pullRequestIdStr !== null) {
      const pullRequestId = Number(pullRequestIdStr);
      const pullRequest = await this.bitbucket.repositories.getPullRequest({
        pull_request_id: pullRequestId,
        repo_slug: repoSlug || '',
        workspace: workspace || '',
      });

      if (pullRequest?.data.destination) {
        // Add cross git provider properties used by sfdx-hardis
        return this.completePullRequestInfo(pullRequest.data);
      } else {
        uxLog("warning", this, c.yellow('[Bitbucket Integration] ' + t('bitbucketIncompletePr', { prId: pullRequestIdStr })));
        uxLog("log", this, c.grey(JSON.stringify(pullRequest || {})));
      }
    }

    // Case when we find PR from a commit
    const sha = await git().revparse(['HEAD']);
    try {
      // Note: listPullrequestsForCommit API can be unreliable - it requires the "Pull Request Commit Links" app to be installed
      // See: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/#api-repositories-workspace-repo-slug-commit-commit-pullrequests-get
      const latestPullRequestsOnBranch = await this.bitbucket.repositories.listPullrequestsForCommit({
        workspace: workspace || '',
        repo_slug: repoSlug || '',
        commit: sha,
      });
      const latestMergedPullRequestOnBranch = latestPullRequestsOnBranch?.data?.values?.filter(
        (pr) => pr.state === 'MERGED' && this.hashesMatch(sha, pr.merge_commit?.hash)
      );
      if (latestMergedPullRequestOnBranch?.length && latestMergedPullRequestOnBranch?.length > 0) {
        const pullRequest = latestMergedPullRequestOnBranch[0];
        // Add cross git provider properties used by sfdx-hardis
        return this.completePullRequestInfo(pullRequest);
      }
    } catch (e) {
      uxLog("warning", this, c.yellow('[Bitbucket Integration] ' + t('bitbucketUnableToRetrievePrForCommit', { sha, message: (e as Error).message })));
      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketPrCommitLinksAppRequired')));
    }

    // Fallback that does not require the "Pull Request Commit Links" Bitbucket app:
    // on a post-merge branch build (BITBUCKET_PR_ID unset), find the merged PR targeting the current branch.
    const branchName = process.env.BITBUCKET_BRANCH || (await getCurrentGitBranch()) || '';
    if (branchName) {
      const prFromBranch = await this.getMergedPullRequestForBranch(sha, branchName);
      if (prFromBranch) {
        return prFromBranch;
      }
    }

    uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketUnableToFindPrInfo')));
    return null;
  }

  // Find the merged PR targeting a branch, without relying on the "Pull Request Commit Links" app.
  // Matches the PR whose merge commit equals HEAD, or (fallback) whose merge commit is an ancestor of HEAD.
  private async getMergedPullRequestForBranch(sha: string, branchName: string): Promise<CommonPullRequestInfo | null> {
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    if (!repoSlug || !workspace) {
      return null;
    }
    uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketSearchingPrByBranch', { branch: branchName, sha })));
    try {
      const mergedPullRequests = await this.bitbucket.repositories.listPullRequests({
        repo_slug: repoSlug,
        workspace: workspace,
        state: 'MERGED',
        q: `destination.branch.name = "${branchName}"`,
        sort: '-updated_on',
      });
      const values = mergedPullRequests?.data?.values || [];

      // Exact match: the PR whose merge commit is the current HEAD
      // (Bitbucket abbreviates merge_commit.hash to 12 chars, so match by prefix)
      const exactMatch = values.find((pr) => this.hashesMatch(sha, (pr as any)?.merge_commit?.hash));
      if (exactMatch) {
        const prInfo = this.completePullRequestInfo(exactMatch);
        uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketFoundPrViaBranchFallback', { prId: prInfo.idNumber, prTitle: prInfo.title, branch: branchName })));
        return prInfo;
      }

      // Ancestry fallback: HEAD may have advanced past the merge commit (several merges in one build window)
      for (const pr of values) {
        const mergeCommitHash = (pr as any)?.merge_commit?.hash;
        if (!mergeCommitHash) {
          continue;
        }
        try {
          await git().raw(['merge-base', '--is-ancestor', mergeCommitHash, 'HEAD']);
        } catch {
          // Non-zero exit means the merge commit is not an ancestor of HEAD: skip it
          continue;
        }
        const prInfo = this.completePullRequestInfo(pr);
        uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketFoundPrViaBranchFallback', { prId: prInfo.idNumber, prTitle: prInfo.title, branch: branchName })));
        return prInfo;
      }
    } catch (e) {
      uxLog("warning", this, c.yellow('[Bitbucket Integration] ' + t('bitbucketErrorListingPullRequests', { message: (e as Error).message })));
    }
    return null;
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string | null> {
    let deploymentCheckId: string | null = null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const latestMergedPullRequestsOnBranch = await this.bitbucket.repositories.listPullRequests({
      repo_slug: repoSlug || '',
      workspace: workspace || '',
      state: 'MERGED',
      q: `destination.branch.name = "${gitBranch}"`,
      sort: '-updated_on',
    });
    const values = latestMergedPullRequestsOnBranch?.data?.values || [];
    if (values.length > 0) {
      // Select the PR whose merge commit matches the commit currently being deployed (HEAD).
      // When several PRs are merged around the same time, the most recently updated PR is not
      // necessarily the one that produced this build's commit. Using its validation id would make
      // QuickDeploy reuse an unrelated PR's deployment and deploy the wrong metadata.
      const sha = await git().revparse(['HEAD']);
      const matchingPullRequest = values.find((pr) => this.hashesMatch(sha, (pr as any)?.merge_commit?.hash)) || null;
      if (matchingPullRequest == null) {
        uxLog("warning", this, c.yellow('[Bitbucket Integration] ' + t('noPrMatchingDeployedCommit', { sha })));
        return null;
      }
      deploymentCheckId = await this.getDeploymentIdFromPullRequest(
        matchingPullRequest.id || 0,
        repoSlug || '',
        workspace || '',
        deploymentCheckId,
        this.completePullRequestInfo(matchingPullRequest)
      );
    }

    return deploymentCheckId;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string | null> {
    const pullRequestInfo = await this.getPullRequestInfo();
    if (pullRequestInfo) {
      const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
      const workspace = process.env.BITBUCKET_WORKSPACE || null;
      return await this.getDeploymentIdFromPullRequest(
        pullRequestInfo.idNumber || 0,
        repoSlug || '',
        workspace || '',
        null,
        pullRequestInfo
      );
    }
    return null;
  }

  private async getDeploymentIdFromPullRequest(
    latestPullRequestId: number,
    repoSlug: string,
    workspace: string,
    deploymentCheckId: string | null,
    latestPullRequest: CommonPullRequestInfo
  ): Promise<string | null> {
    const comments = await this.bitbucket.repositories.listPullRequestComments({
      pull_request_id: latestPullRequestId,
      repo_slug: repoSlug,
      workspace: workspace,
    });

    // A PR can hold several deployment-id comments, one per pipeline run. Scan every comment and
    // select the most recent one by date, otherwise QuickDeploy would reuse an outdated validation id.
    let latestDeploymentTime = -1;
    for (const comment of comments?.data?.values || []) {
      if (comment?.deleted) {
        continue;
      }
      if ((comment?.content?.raw || '').includes(`<!-- sfdx-hardis deployment-id `)) {
        const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(comment?.content?.raw || '');
        if (matches) {
          const commentTime = this.getCommentTimestamp(comment);
          if (commentTime >= latestDeploymentTime) {
            latestDeploymentTime = commentTime;
            deploymentCheckId = matches[1];
          }
        }
      }
    }
    if (deploymentCheckId) {
      uxLog(
        "log",
        this,
        c.grey(
          `[Bitbucket Integration] Found deployment id ${deploymentCheckId} on PR #${latestPullRequestId} ${latestPullRequest.title}`
        )
      );
    }
    return deploymentCheckId;
  }

  // Returns a comparable timestamp (ms) for a PR comment.
  private getCommentTimestamp(comment: any): number {
    const dateValue = comment?.created_on || comment?.updated_on;
    if (!dateValue) {
      return 0;
    }
    const time = new Date(dateValue).getTime();
    return isNaN(time) ? 0 : time;
  }

  public async listPullRequests(
    filters: { status?: string; targetBranch?: string; minDate?: Date } = {},
  ): Promise<CommonPullRequestInfo[] | null> {
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    if (!workspace || !repoSlug) return null;

    try {
      const state = filters.status === "merged" ? "MERGED" : filters.status === "open" ? "OPEN" : undefined;
      const params: any = {
        workspace,
        repo_slug: repoSlug,
        sort: "-updated_on",
      };
      if (state) {
        params.state = state;
      }

      const result = await this.bitbucket.repositories.listPullRequests(params);
      let prs = result?.data?.values || [];

      // Filter by minDate
      if (filters.minDate) {
        prs = prs.filter((pr: any) => {
          const createdOn = pr.created_on ? new Date(pr.created_on) : null;
          return createdOn && createdOn >= filters.minDate!;
        });
      }

      return prs.map((pr: any) => this.completePullRequestInfo(pr));
    } catch (e: any) {
      uxLog("warning", this, c.yellow('[Bitbucket Integration] ' + t('bitbucketErrorListingPullRequests', { message: e?.message || e })));
      return null;
    }
  }

  // Bitbucket Cloud returns merge_commit.hash ABBREVIATED to 12 chars in pull
  // request payloads, while commits.list (and local `git`) use FULL 40-char
  // hashes. An exact-string comparison therefore never matches, so compare with
  // prefix awareness (either hash being a prefix of the other).
  private hashesMatch(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) {
      return false;
    }
    return a === b || a.startsWith(b) || b.startsWith(a);
  }

  // Bitbucket Cloud paginates list responses (pull requests, commits...). Each
  // response only carries one page of `values` plus a `next` link when more
  // pages exist. This helper follows `next` (via the `page` param) and returns
  // every item across all pages, so callers never silently miss results.
  // `pagelen` maxes out at 50 for pull requests and 100 for commits.
  private async fetchAllPages(
    listFn: (params: any) => Promise<any>,
    params: any,
    maxPages: number = 50,
  ): Promise<any[]> {
    const all: any[] = [];
    let page = 1;
    while (page <= maxPages) {
      const response = await listFn({ ...params, page });
      const values =
        response && response.data && response.data.values
          ? response.data.values
          : [];
      all.push(...values);
      if (!response?.data?.next || values.length === 0) {
        break;
      }
      page++;
    }
    return all;
  }

  public async listPullRequestsInBranchSinceLastMerge(
    currentBranchName: string,
    targetBranchName: string,
    childBranchesNames: string[],
  ): Promise<CommonPullRequestInfo[]> {
    if (!this.bitbucket || !process.env.BITBUCKET_WORKSPACE || !process.env.BITBUCKET_REPO_SLUG) {
      return [];
    }

    try {
      const workspace = process.env.BITBUCKET_WORKSPACE;
      const repoSlug = process.env.BITBUCKET_REPO_SLUG;

      // Step 1: Find the last merged PR from currentBranch to targetBranch
      const lastMergeQuery = `source.branch.name = "${currentBranchName}" AND destination.branch.name = "${targetBranchName}" AND state = "MERGED"`;
      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketFindingLastMergedPr', { query: lastMergeQuery })));

      const lastMergeResponse = await this.bitbucket.pullrequests.list({
        workspace,
        repo_slug: repoSlug,
        q: lastMergeQuery,
        sort: '-updated_on',
      } as any);

      const lastMergePRs =
        lastMergeResponse &&
          lastMergeResponse.data &&
          lastMergeResponse.data.values
          ? lastMergeResponse.data.values
          : [];
      const lastMergeToTarget =
        lastMergePRs.length > 0 ? lastMergePRs[0] : null;

      if (lastMergeToTarget) {
        uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketLastMergedPr', { prId: lastMergeToTarget.id, prTitle: lastMergeToTarget.title })));
      } else {
        uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketNoPreviousMerge', { sourceBranch: currentBranchName, targetBranch: targetBranchName })));
      }

      // Step 2: Get commits between branches
      const excludeRef = lastMergeToTarget
        ? lastMergeToTarget.merge_commit?.hash
        : targetBranchName;

      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketGettingCommits', { include: currentBranchName, exclude: excludeRef })));

      // Paginated: a busy branch can have far more than one page of commits since the last merge
      const commits = await this.fetchAllPages(
        (params) => this.bitbucket.commits.list(params),
        {
          workspace,
          repo_slug: repoSlug,
          include: currentBranchName,
          exclude: excludeRef,
          pagelen: 100,
        },
      );

      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketFoundCommits', { count: commits.length })));

      if (commits.length === 0) {
        return [];
      }

      const commitHashes: string[] = commits.map((c: any) => c.hash);

      // Step 3-6: Match merged PRs targeting currentBranch and child branches against those commits
      const allBranches = [currentBranchName, ...childBranchesNames];
      return await this.collectMergedPrsForCommits(workspace, repoSlug, allBranches, commitHashes, getOldestBitbucketCommitDate(commits));
    } catch (err) {
      uxLog("warning", this, c.yellow(t('errorInListpullrequestsinbranchsincelastmerge', { String: String(err) })));
      return [];
    }
  }

  // List the Pull Requests included in a specific "go live" merge commit (e.g. the
  // merge of preprod into main). Resolves the merge commit's first parent to bound
  // the range, lists the commits the merge introduced, then matches merged PRs on
  // the target branch and its children against those commits. Unlike a plain "list
  // recent merged PRs", this excludes hotfixes merged to the target at other times.
  public async listPullRequestsInGoLive(
    branchName: string,
    childBranchesNames: string[],
    mergeCommitId: string,
  ): Promise<CommonPullRequestInfo[]> {
    if (!this.bitbucket || !process.env.BITBUCKET_WORKSPACE || !process.env.BITBUCKET_REPO_SLUG || !mergeCommitId) {
      return [];
    }
    try {
      const workspace = process.env.BITBUCKET_WORKSPACE;
      const repoSlug = process.env.BITBUCKET_REPO_SLUG;

      // Step 1: Resolve the merge commit's first parent (the mainline before the go live).
      // Without it we cannot bound the go live and would over-report every merged PR.
      let firstParent: string | undefined;
      try {
        const commitResponse = await this.bitbucket.repositories.getCommit({
          workspace,
          repo_slug: repoSlug,
          commit: mergeCommitId,
        } as any);
        firstParent = (commitResponse?.data?.parents ?? [])[0]?.hash;
      } catch (err) {
        uxLog("warning", this, c.yellow('[Bitbucket Integration] ' + t('bitbucketErrorFetchingCommit', { commit: mergeCommitId, message: String(err) })));
      }
      if (!firstParent) {
        return [];
      }

      // Step 2: Commits introduced by the go live (paginated)
      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketGettingCommits', { include: mergeCommitId, exclude: firstParent })));
      const commits = await this.fetchAllPages(
        (params) => this.bitbucket.commits.list(params),
        {
          workspace,
          repo_slug: repoSlug,
          include: mergeCommitId,
          exclude: firstParent,
          pagelen: 100,
        },
      );
      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketFoundCommits', { count: commits.length })));
      if (commits.length === 0) {
        return [];
      }
      const commitHashes: string[] = commits.map((c: any) => c.hash);

      // Step 3-6: same matching as listPullRequestsInBranchSinceLastMerge
      const allBranches = [branchName, ...childBranchesNames];
      return await this.collectMergedPrsForCommits(workspace, repoSlug, allBranches, commitHashes, getOldestBitbucketCommitDate(commits));
    } catch (err) {
      uxLog("warning", this, c.yellow(t('errorInListpullrequestsinbranchsincelastmerge', { String: String(err) })));
      return [];
    }
  }

  // Shared tail of the "PRs in branch / go live" queries: fetch all merged PRs
  // targeting each branch in allBranches, keep those whose merge commit is part of
  // commitHashes, dedupe by PR id and convert to the common shape. Bitbucket's
  // commits.list returns FULL 40-char hashes while pullrequests.list returns
  // merge_commit.hash ABBREVIATED to 12 chars, so we compare with prefix awareness.
  // updatedAfter bounds the pagination: a PR merged before the oldest commit of the window
  // cannot have its merge commit in it, so fetching the whole merged PR history of each branch
  // (thousands of PRs on an old repository) is useless and slow.
  private async collectMergedPrsForCommits(
    workspace: string,
    repoSlug: string,
    allBranches: string[],
    commitHashes: string[],
    updatedAfter: string | null = null,
  ): Promise<CommonPullRequestInfo[]> {
    uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketFetchingMergedPrs', { branches: allBranches.join(', ') })));
    const prPromises = allBranches.map(async (branchName) => {
      try {
        const branchQuery = `destination.branch.name = "${branchName}" AND state = "MERGED"`
          + (updatedAfter ? ` AND updated_on >= "${updatedAfter}"` : '');
        // Paginated: a branch can have more merged PRs than fit on one page
        const values = await this.fetchAllPages(
          (params) => this.bitbucket.pullrequests.list(params),
          {
            workspace,
            repo_slug: repoSlug,
            q: branchQuery,
            pagelen: 50,
          },
        );
        uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketFoundMergedPrs', { count: values.length, branchName })));
        return values;
      } catch (err) {
        uxLog("warning", this, c.yellow('[Bitbucket Integration] ' + t('bitbucketErrorFetchingMergedPrs', { branchName, message: String(err) })));
        return [];
      }
    });

    const prResults = await Promise.all(prPromises);
    const allMergedPRs: any[] = prResults.flat();
    uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketTotalMergedPrs', { count: allMergedPRs.length })));

    // Keep PRs whose merge commit is in our commit list (prefix-aware match)
    const relevantPRs = allMergedPRs.filter((pr) => {
      const mergeCommitHash = pr.merge_commit?.hash;
      return commitHashes.some((hash) => this.hashesMatch(hash, mergeCommitHash));
    });
    uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketRelevantPrs', { count: relevantPRs.length })));

    // Remove duplicates by PR id
    const uniquePRsMap = new Map();
    for (const pr of relevantPRs) {
      if (!uniquePRsMap.has(pr.id)) {
        uniquePRsMap.set(pr.id, pr);
      }
    }
    const uniquePRs = Array.from(uniquePRsMap.values());
    uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketUniquePrs', { count: uniquePRs.length })));

    return uniquePRs.map((pr) => this.completePullRequestInfo(pr));
  }

  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    const prInfo = await this.getPullRequestInfo();
    const pullRequestIdStr = process.env.BITBUCKET_PR_ID || prInfo?.idStr || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;

    if (repoSlug == null || pullRequestIdStr == null) {
      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketNoRepoNoPrNote')));
      return { posted: false, providerResult: { info: 'No related pull request' } };
    }
    const pullRequestId = Number(pullRequestIdStr);
    const bitbucketBuildNumber = process.env.BITBUCKET_BUILD_NUMBER || null;
    const bitbucketJobUrl = await this.getCurrentJobUrl();

    const messageKey = `${prMessage.messageKey}-${pullRequestId}`;
    let messageBody = `${this.buildPrCommentBodyHeader(prMessage)}${prMessage.message}

_Powered by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) from job [${bitbucketBuildNumber}](${bitbucketJobUrl})_

${getBannerMarkdownAndLink()}

<!-- sfdx-hardis message-key ${messageKey} -->
`;

    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }

    messageBody = await this.uploadAndReplaceImageReferences(messageBody, prMessage.sourceFile || "");

    const commentBody: any = {
      content: {
        raw: messageBody,
      },
    };

    // Check for existing comment from a previous run
    uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketListingPrComments')));
    const existingComments = await this.bitbucket.repositories.listPullRequestComments({
      pull_request_id: pullRequestId,
      repo_slug: repoSlug,
      workspace: workspace || '',
    });
    let existingCommentId: number | null = null;
    for (const existingComment of existingComments?.data?.values || []) {
      if (
        existingComment?.content?.raw &&
        existingComment?.content.raw?.includes(`<!-- sfdx-hardis message-key ${messageKey} -->`)
      ) {
        existingCommentId = existingComment.id || null;
      }
    }

    // Create or update MR comment
    if (existingCommentId) {
      // Update existing comment
      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketUpdatingPrComment')));
      const pullRequestComment = await this.bitbucket.repositories.updatePullRequestComment({
        workspace: workspace || '',
        repo_slug: repoSlug,
        pull_request_id: pullRequestId,
        comment_id: existingCommentId,
        _body: commentBody,
      });

      const prResult: PullRequestMessageResult = {
        posted: (pullRequestComment?.data?.id || -1) > 0,
        providerResult: pullRequestComment,
      };
      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketUpdatedPrComment', { commentId: existingCommentId })));
      return prResult;
    } else {
      // Create new comment if no existing comment was found
      uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketAddingPrComment')));

      const pullRequestComment = await this.bitbucket.repositories.createPullRequestComment({
        workspace: workspace || '',
        repo_slug: repoSlug,
        pull_request_id: pullRequestId,
        _body: commentBody,
      });

      const prResult: PullRequestMessageResult = {
        posted: (pullRequestComment?.data?.id || -1) > 0,
        providerResult: pullRequestComment,
      };
      if (prResult.posted) {
        uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketPostedPrComment', { prId: pullRequestId })));
      } else {
        uxLog("warning", this, c.yellow('[Bitbucket Integration] ' + t('bitbucketUnableToPostPrComment', { prId: pullRequestId, comment: JSON.stringify(pullRequestComment, null, 2) })));
      }
      return prResult;
    }
  }

  // Bitbucket Pipelines only exposes the triggering account as an opaque UUID
  // (BITBUCKET_STEP_TRIGGERER_UUID), so a lookup is the only way to show a readable name in
  // notifications. The API never returns another account's email, hence email is always null.
  public async resolveUserIdentity(uuid: string): Promise<{ name: string | null; email: string | null } | null> {
    const { data } = await this.bitbucket.users.get({ selected_user: uuid });
    return { name: data?.display_name || (data as any)?.nickname || null, email: null };
  }

  private completePullRequestInfo(prData: Schema.Pullrequest): CommonPullRequestInfo {
    const prInfo: CommonPullRequestInfo = {
      idNumber: prData?.id || 0,
      idStr: prData.id ? prData?.id?.toString() : '',
      sourceBranch: prData?.source?.branch?.name || '',
      targetBranch: prData?.destination?.branch?.name || '',
      // Note: rendered.*.markup holds the format name ("markdown"), not content, so only raw/html are used as fallbacks
      title: prData?.rendered?.title?.raw || prData?.rendered?.title?.html || prData?.title || '',
      description: prData?.rendered?.description?.raw || prData?.rendered?.description?.html || (prData as any)?.description || '',
      webUrl: prData?.links?.html?.href || '',
      authorName: prData?.author?.display_name || '',
      createdDate: (prData as any)?.created_on || undefined,
      // Bitbucket has no dedicated merge date: updated_on of a MERGED PR is its merge time
      mergedDate: prData?.state === 'MERGED' ? ((prData as any)?.updated_on || undefined) : undefined,
      mergeCommitSha: (prData as any)?.merge_commit?.hash || undefined,
      providerInfo: prData,
      customBehaviors: {}
    };
    return this.completeWithCustomBehaviors(prInfo);
  }

  // Upload the image to Bitbucket
  public async uploadImage(localImagePath: string): Promise<string | null> {
    try {
      const imageName = path.basename(localImagePath);
      // The bitbucket client relies on node-fetch v2, which cannot serialize a native FormData:
      // the upload calls the Downloads REST endpoint directly with the same credentials
      const filesForm = new FormData();
      filesForm.append("files", new Blob([await fs.readFile(localImagePath)]), imageName);
      const workspace = process.env.BITBUCKET_WORKSPACE || "";
      const repoSlug = process.env.BITBUCKET_REPO_SLUG || "";
      const attachmentResponse = await httpPost(
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/downloads`,
        filesForm,
        { headers: { Authorization: this.getAuthorizationHeader() } }
      );
      if (attachmentResponse) {
        const imageRef = `${this.serverUrl}/${process.env.BITBUCKET_WORKSPACE}/${process.env.BITBUCKET_REPO_SLUG}/downloads/${imageName}`;
        uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketImageUploaded', { imageRef })));
        return imageRef;
      }
      else {
        uxLog("warning", this, c.yellow(`[Bitbucket Integration] Image uploaded but unable to get URL from response\n${JSON.stringify(attachmentResponse, null, 2)}`));
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(`[Bitbucket Integration] Error while uploading image in downloads section ${localImagePath}\n${(e as Error).message}`));
    }
    return null;
  }

  public async createPullRequest(request: CreatePullRequestRequest): Promise<CreatePullRequestResult> {
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    if (!workspace || !repoSlug) {
      uxLog("warning", this, c.yellow('[Bitbucket Integration] ' + t('bitbucketCannotCreatePrMissingRepoInfo')));
      return { created: false, pullRequestUrl: null, providerResult: { error: "Missing BITBUCKET_WORKSPACE or BITBUCKET_REPO_SLUG" } };
    }
    uxLog("log", this, c.grey('[Bitbucket Integration] ' + t('bitbucketCreatingPullRequest', { source: request.sourceBranch, target: request.targetBranch })));
    const result = await this.bitbucket.repositories.createPullRequest({
      workspace,
      repo_slug: repoSlug,
      _body: {
        title: request.title,
        description: request.body,
        source: { branch: { name: request.sourceBranch } },
        destination: { branch: { name: request.targetBranch } },
      } as any,
    });
    const prData = result?.data as any;
    return {
      created: !!(prData?.id),
      pullRequestUrl: prData?.links?.html?.href || null,
      providerResult: result,
    };
  }

  public async findOpenPullRequest(sourceBranch: string, targetBranch: string): Promise<{ pullRequestUrl: string; id: any } | null> {
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    if (!workspace || !repoSlug) return null;
    const result = await this.bitbucket.repositories.listPullRequests({
      workspace,
      repo_slug: repoSlug,
      state: "OPEN" as any,
      q: `source.branch.name="${sourceBranch}" AND destination.branch.name="${targetBranch}"`,
    });
    const pr = (result?.data as any)?.values?.[0];
    if (!pr) return null;
    return { pullRequestUrl: pr.links?.html?.href, id: pr.id };
  }

  public async updatePullRequestDescription(id: any, title: string, body: string): Promise<void> {
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    if (!workspace || !repoSlug) return;
    await this.bitbucket.repositories.updatePullRequest({
      workspace,
      repo_slug: repoSlug,
      pull_request_id: id,
      _body: { title, description: body } as any,
    });
  }

  public async getPullRequestCommentByMarker(marker: string, prNumber?: number): Promise<string | null> {
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const pullRequestId = prNumber || Number(process.env.BITBUCKET_PR_ID || '');
    if (!pullRequestId || !repoSlug || !workspace) return null;
    const comments = await this.bitbucket.repositories.listPullRequestComments({
      pull_request_id: pullRequestId,
      repo_slug: repoSlug,
      workspace,
    });
    for (const comment of comments?.data?.values || []) {
      if ((comment?.content?.raw || '').includes(marker)) {
        return comment.content?.raw || null;
      }
    }
    return null;
  }

  public async upsertPullRequestCommentByMarker(marker: string, body: string, prNumber?: number): Promise<void> {
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const pullRequestId = prNumber || Number(process.env.BITBUCKET_PR_ID || '');
    if (!pullRequestId || !repoSlug || !workspace) return;
    const comments = await this.bitbucket.repositories.listPullRequestComments({
      pull_request_id: pullRequestId,
      repo_slug: repoSlug,
      workspace,
    });
    let existingCommentId: number | null = null;
    for (const comment of comments?.data?.values || []) {
      if ((comment?.content?.raw || '').includes(marker)) {
        existingCommentId = comment.id || null;
        break;
      }
    }
    const commentBody: any = { content: { raw: body } };
    if (existingCommentId) {
      await this.bitbucket.repositories.updatePullRequestComment({
        workspace,
        repo_slug: repoSlug,
        pull_request_id: pullRequestId,
        comment_id: existingCommentId,
        _body: commentBody,
      });
      uxLog("log", this, c.grey(`[Bitbucket] Updated Deployment Actions comment on PR #${pullRequestId}`));
    } else {
      await this.bitbucket.repositories.createPullRequestComment({
        workspace,
        repo_slug: repoSlug,
        pull_request_id: pullRequestId,
        _body: commentBody,
      });
      uxLog("log", this, c.grey(`[Bitbucket] Created Deployment Actions comment on PR #${pullRequestId}`));
    }
  }

  public async listPullRequestCommentsByMarker(marker: string, prNumber?: number): Promise<PullRequestCommentRef[]> {
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const pullRequestId = prNumber || Number(process.env.BITBUCKET_PR_ID || '');
    if (!pullRequestId || !repoSlug || !workspace) return [];
    // Paginate: a long-lived PR can carry more comments than a single page,
    // and a ticked checkbox in a later comment must not be missed
    const comments = await this.fetchAllPages(
      (params) => this.bitbucket.repositories.listPullRequestComments(params),
      {
        pull_request_id: pullRequestId,
        repo_slug: repoSlug,
        workspace,
        pagelen: 50,
      },
    );
    const results: PullRequestCommentRef[] = [];
    for (const comment of comments) {
      // The API returns deleted comments with deleted=true: a checkbox ticked in a deleted
      // comment must not be honored, and updating such a comment id later would error
      if (comment?.deleted) continue;
      if ((comment?.content?.raw || '').includes(marker)) {
        results.push({
          prNumber: pullRequestId,
          ref: comment.id,
          body: comment.content?.raw || '',
          url: comment?.links?.html?.href || '',
        });
      }
    }
    return results;
  }

  public async updatePullRequestCommentByRef(commentRef: PullRequestCommentRef, body: string): Promise<void> {
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    if (!repoSlug || !workspace || !commentRef?.ref) return;
    await this.bitbucket.repositories.updatePullRequestComment({
      workspace,
      repo_slug: repoSlug,
      pull_request_id: commentRef.prNumber,
      comment_id: commentRef.ref,
      _body: { content: { raw: body } } as any,
    });
    uxLog("log", this, c.grey('[Bitbucket] ' + t('updatedPullRequestComment', { pr: commentRef.prNumber })));
  }

}
