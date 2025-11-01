import * as github from "@actions/github";
import c from "chalk";
import { GitProviderRoot } from "./gitProviderRoot.js";
import { getCurrentGitBranch, git, uxLog } from "../utils/index.js";
import { CommonPullRequestInfo, PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
import { GitHub } from "@actions/github/lib/utils.js";
import { CONSTANTS } from "../../config/index.js";

export class GithubProvider extends GitProviderRoot {
  private octokit: InstanceType<typeof GitHub>;
  private repoOwner: string | null;
  private repoName: string | null;
  public serverUrl: string | null;
  public workflow: string | null;
  public branch: string | null;
  public prNumber: number | null;
  public runId: string | number | null;

  constructor() {
    super();
    const tokenName = process.env.CI_SFDX_HARDIS_GITHUB_TOKEN ? "CI_SFDX_HARDIS_GITHUB_TOKEN" : process.env.PAT ? "PAT" : "GITHUB_TOKEN";
    const token = process.env[tokenName];
    this.octokit = github.getOctokit(token || "");
    this.repoOwner = github?.context?.repo?.owner || process.env.GITHUB_REPOSITORY_OWNER || null;
    this.repoName = github?.context?.repo?.repo || process.env?.GITHUB_REPOSITORY?.split("/")[1] || null
    this.serverUrl = github?.context?.serverUrl || process.env.GITHUB_SERVER_URL || null;
    this.workflow = github?.context?.workflow || process.env.GITHUB_WORKFLOW || null;
    this.branch = github?.context?.ref || process.env.GITHUB_REF || null;
    this.prNumber = github?.context?.payload?.pull_request?.number || (process.env.GITHUB_REF_NAME ? parseInt(process.env.GITHUB_REF_NAME.split("/")?.[0] || "0") : null);
    this.runId = github?.context?.runId || process.env.GITHUB_RUN_ID || null;
  }

  public getLabel(): string {
    return "sfdx-hardis GitHub connector";
  }
  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string | null> {
    let deploymentCheckId: string | null = null;
    uxLog("log", this, c.grey("[GitHub Integration] Listing previously closed Pull Requests"));
    const latestPullRequestsOnBranch = await this.octokit.rest.pulls.list({
      owner: this.repoOwner || "",
      repo: this.repoName || "",
      state: "closed",
      direction: "desc",
      per_page: 10,
      base: gitBranch,
    });
    if (latestPullRequestsOnBranch.data.length > 0) {
      const latestPullRequest = latestPullRequestsOnBranch.data[0];
      const latestPullRequestId = latestPullRequest.number;
      deploymentCheckId = await this.getDeploymentIdFromPullRequest(latestPullRequestId, this.repoOwner || "", this.repoName || "", deploymentCheckId, latestPullRequest);
    }
    return deploymentCheckId;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string | null> {
    const pullRequestInfo = await this.getPullRequestInfo();
    if (pullRequestInfo) {
      return await this.getDeploymentIdFromPullRequest(pullRequestInfo.idNumber, this.repoOwner || "", this.repoName || "", null, pullRequestInfo);
    }
    return null;
  }
  private async getDeploymentIdFromPullRequest(
    latestPullRequestId: number,
    repoOwner: string,
    repoName: string,
    deploymentCheckId: string | null,
    latestPullRequest: any,
  ): Promise<string | null> {
    uxLog("log", this, c.grey(`[GitHub Integration] Listing comments for PR ${latestPullRequestId}`));
    const existingComments = await this.octokit.rest.issues.listComments({
      owner: repoOwner,
      repo: repoName,
      issue_number: latestPullRequestId,
    });
    for (const existingComment of existingComments.data) {
      if ((existingComment.body || "").includes("<!-- sfdx-hardis deployment-id ")) {
        const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(existingComment.body || "");
        if (matches) {
          deploymentCheckId = matches[1];
          uxLog("error", this, c.grey(`Found deployment id ${deploymentCheckId} on PR #${latestPullRequestId} ${latestPullRequest.title}`));
          break;
        }
      }
    }
    return deploymentCheckId;
  }

  // Returns current job URL
  public async getCurrentJobUrl(): Promise<string | null> {
    if (process.env.PIPELINE_JOB_URL) {
      return process.env.PIPELINE_JOB_URL;
    }
    try {
      if (this.repoOwner && this.repoName && this.serverUrl && this.runId) {
        return `${this.serverUrl}/${this.repoOwner}/${this.repoName}/actions/runs/${this.runId}`;
      }
    } catch (err: any) {
      uxLog("warning", this, c.yellow("[GitHub Integration]" + err.message));
    }
    if (process.env.GITHUB_JOB_URL) {
      return process.env.GITHUB_JOB_URL;
    }
    return null;
  }

  // Returns current job URL
  public async getCurrentBranchUrl(): Promise<string | null> {
    try {
      if (this.repoOwner && this.repoName && this.serverUrl && this.branch) {
        return `${this.serverUrl}/${this.repoOwner}/${this.repoName}/tree/${this.branch}`;
      }
    } catch (err: any) {
      uxLog("warning", this, c.yellow("[GitHub Integration]" + err.message));
    }
    return null;
  }

  // GitHub supports mermaid in PR markdown
  public async supportsMermaidInPrMarkdown(): Promise<boolean> {
    return true;
  }

  // Find pull request info
  public async getPullRequestInfo(): Promise<CommonPullRequestInfo | null> {
    // Case when PR is found in the context
    if (this.prNumber !== null && this.repoOwner !== null) {
      const pullRequest = await this.octokit.rest.pulls.get({
        owner: this.repoOwner,
        repo: this.repoName || "",
        pull_number: this.prNumber,
      });
      // Add cross git provider properties used by sfdx-hardis
      if (pullRequest) {
        return this.completePullRequestInfo(pullRequest.data);
      }
    }
    // Case when we find PRs from a commit
    const sha = await git().revparse(["HEAD"]);
    let graphQlRes: any = null;
    try {
      graphQlRes = await this.octokit.graphql(
        `
      query associatedPRs($sha: String, $repo: String!, $owner: String!){
        repository(name: $repo, owner: $owner) {
          commit: object(expression: $sha) {
            ... on Commit {
              associatedPullRequests(first:10){
                edges{
                  node{
                    title
                    number
                    body
                    url
                    merged,
                    baseRef {
                      id
                      name
                    }
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
        {
          sha: sha,
          repo: this.repoName,
          owner: this.repoOwner,
        },
      );
    } catch (error) {
      uxLog("warning", this, c.yellow(`[GitHub Integration] Error while calling GraphQL Api to list PR on commit ${sha}\n${(error as any).message}`));
    }
    if (graphQlRes?.repository?.commit?.associatedPullRequests?.edges?.length > 0) {
      const currentGitBranch = await getCurrentGitBranch();
      const candidatePullRequests = graphQlRes.repository.commit.associatedPullRequests.edges.filter(
        (pr: any) => pr.node.merged === true && pr.node.baseRef.name === currentGitBranch,
      );
      if (candidatePullRequests.length > 0) {
        return this.completePullRequestInfo(candidatePullRequests[0].node);
      }
    }
    uxLog("log", this, c.grey(`[GitHub Integration] Unable to find related Pull Request Info`));
    return null;
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    const prInfo = await this.getPullRequestInfo();
    this.prNumber = this.prNumber || prInfo?.idNumber || null;
    if (this.repoName == null || this.prNumber == null) {
      uxLog("log", this, c.grey("[GitHub Integration] No project and merge request, so no note posted..."));
      return { posted: false, providerResult: { info: "No related pull request" } };
    }
    const githubJobUrl = await this.getCurrentJobUrl();
    // Build note message
    const messageKey = prMessage.messageKey + "-" + this.workflow + "-" + this.prNumber;
    let messageBody = `## ${prMessage.title || ""}

${prMessage.message}

_Powered by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) from job [${this.workflow}](${githubJobUrl})_
<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }

    // Check for existing note from a previous run
    uxLog("log", this, c.grey("[GitHub Integration] Listing comments of Pull Request..."));
    const existingComments = await this.octokit.rest.issues.listComments({
      owner: this.repoOwner || "",
      repo: this.repoName,
      issue_number: this.prNumber,
    });
    let existingCommentId: number | null = null;
    for (const existingComment of existingComments.data) {
      if (existingComment?.body?.includes(`<!-- sfdx-hardis message-key ${messageKey} -->`)) {
        existingCommentId = existingComment.id;
      }
    }

    // Create or update MR note
    if (existingCommentId) {
      // Update existing note
      uxLog("log", this, c.grey("[GitHub Integration] Updating Pull Request Comment on GitHub..."));
      const githubCommentEditResult = await this.octokit.rest.issues.updateComment({
        owner: this.repoOwner || "",
        repo: this.repoName,
        issue_number: this.prNumber,
        comment_id: existingCommentId,
        body: messageBody,
      });
      const prResult: PullRequestMessageResult = {
        posted: githubCommentEditResult.data.id > 0,
        providerResult: githubCommentEditResult,
      };
      return prResult;
    } else {
      // Create new note if no existing not was found
      uxLog("log", this, c.grey("[GitHub Integration] Adding Pull Request Comment on GitHub..."));
      const githubCommentCreateResult = await this.octokit.rest.issues.createComment({
        owner: this.repoOwner || "",
        repo: this.repoName,
        issue_number: this.prNumber,
        body: messageBody,
      });
      const prResult: PullRequestMessageResult = {
        posted: githubCommentCreateResult.data.id > 0,
        providerResult: githubCommentCreateResult,
      };
      return prResult;
    }
  }

  public async listPullRequestsInBranchSinceLastMerge(
    currentBranchName: string,
    targetBranchName: string,
    childBranchesNames: string[],
  ): Promise<CommonPullRequestInfo[]> {
    if (!this.octokit || !this.repoOwner || !this.repoName) {
      return [];
    }

    try {
      // Step 1: Find the last merged PR from currentBranch to targetBranch
      const { data: mergedPRs } = await this.octokit.rest.pulls.list({
        owner: this.repoOwner,
        repo: this.repoName,
        state: "closed",
        head: `${this.repoOwner}:${currentBranchName}`,
        base: targetBranchName,
        sort: "updated",
        direction: "desc",
        per_page: 1,
      });

      const lastMergeToTarget = mergedPRs.find((pr) => pr.merged_at);

      // Step 2: Get commits since last merge
      const compareOptions: any = {
        owner: this.repoOwner,
        repo: this.repoName,
        base: lastMergeToTarget
          ? lastMergeToTarget.merge_commit_sha!
          : targetBranchName,
        head: currentBranchName,
        per_page: 100,
      };

      const { data: comparison } =
        await this.octokit.rest.repos.compareCommits(compareOptions);

      if (!comparison.commits || comparison.commits.length === 0) {
        return [];
      }

      const commitSHAs = new Set(comparison.commits.map((c) => c.sha));

      // Step 3: Get all merged PRs targeting currentBranch and child branches (parallelized)
      const allBranches = [currentBranchName, ...childBranchesNames];

      const prPromises = allBranches.map(async (branchName) => {
        try {
          const { data: prs } = await this.octokit!.rest.pulls.list({
            owner: this.repoOwner!,
            repo: this.repoName!,
            state: "closed",
            base: branchName,
            per_page: 100,
          });
          return prs.filter((pr) => pr.merged_at);
        } catch (err) {
          uxLog(
            "warning",
            this,
            c.yellow(`Error fetching merged PRs for branch ${branchName}: ${String(err)}`),
          );
          return [];
        }
      });

      const prResults = await Promise.all(prPromises);
      const allMergedPRs: any[] = prResults.flat();

      // Step 4: Filter PRs whose merge commit is in our commit list
      const relevantPRs = allMergedPRs.filter((pr) => {
        return pr.merge_commit_sha && commitSHAs.has(pr.merge_commit_sha);
      });

      // Step 5: Remove duplicates
      const uniquePRsMap = new Map();
      for (const pr of relevantPRs) {
        if (!uniquePRsMap.has(pr.number)) {
          uniquePRsMap.set(pr.number, pr);
        }
      }

      // Step 6: Convert to CommonPullRequestInfo
      return Array.from(uniquePRsMap.values()).map((pr) =>
        this.completePullRequestInfo(pr)
      );
    } catch (err) {
      uxLog(
        "warning",
        this,
        c.yellow(`Error in listPullRequestsInBranchSinceLastMerge: ${String(err)}`),
      );
      return [];
    }
  }

  private completePullRequestInfo(prData: any): CommonPullRequestInfo {
    const prInfo: CommonPullRequestInfo = {
      idNumber: prData?.number || 0,
      idStr: String(prData.number || ""),
      sourceBranch: (prData?.head?.ref || "").replace("refs/heads/", ""),
      targetBranch: (prData?.base?.ref || "").replace("refs/heads/", ""),
      title: prData?.title || "",
      description: prData?.body || "",
      authorName: prData?.user?.login || "",
      webUrl: prData?.html_url || "",
      providerInfo: prData,
      customBehaviors: {}
    }
    return this.completeWithCustomBehaviors(prInfo);
  }
}
