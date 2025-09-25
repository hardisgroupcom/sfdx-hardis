import * as github from "@actions/github";
import c from "chalk";
import { GitProviderRoot } from "./gitProviderRoot.js";
import { getCurrentGitBranch, git, uxLog } from "../utils/index.js";
import { PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
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
    let deploymentCheckId = null;
    uxLog(this, c.grey("[GitHub Integration] Listing previously closed Pull Requests"));
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
      return await this.getDeploymentIdFromPullRequest(pullRequestInfo.number, this.repoOwner || "", this.repoName || "", null, pullRequestInfo);
    }
    return null;
  }

  private async getDeploymentIdFromPullRequest(
    latestPullRequestId: number,
    repoOwner: string,
    repoName: string,
    deploymentCheckId: any,
    latestPullRequest: any,
  ) {
    uxLog(this, c.grey(`[GitHub Integration] Listing comments for PR ${latestPullRequestId}`));
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
          uxLog(this, c.gray(`Found deployment id ${deploymentCheckId} on PR #${latestPullRequestId} ${latestPullRequest.title}`));
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
      uxLog(this, c.yellow("[GitHub Integration]" + err.message));
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
      uxLog(this, c.yellow("[GitHub Integration]" + err.message));
    }
    return null;
  }

  // GitHub supports mermaid in PR markdown
  public async supportsMermaidInPrMarkdown(): Promise<boolean> {
    return true;
  }

  // Find pull request info
  public async getPullRequestInfo(): Promise<any> {
    // Case when PR is found in the context
    if (this.prNumber !== null && this.repoOwner !== null && this.prNumber !== null) {
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
      uxLog(this, c.yellow(`[GitHub Integration] Error while calling GraphQL Api to list PR on commit ${sha}\n${(error as any).message}`));
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
    uxLog(this, c.grey(`[GitHub Integration] Unable to find related Pull Request Info`));
    return null;
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    if (this.repoName == null || this.prNumber == null) {
      uxLog(this, c.grey("[GitHub Integration] No project and merge request, so no note posted..."));
      return { posted: false, providerResult: { info: "No related pull request" } };
    }
    const githubJobUrl = `${this.serverUrl}/${this.repoOwner}/${this.repoName}/actions/runs/${this.runId}`;
    // Build note message
    const messageKey = prMessage.messageKey + "-" + this.workflow + "-" + this.prNumber;
    let messageBody = `**${prMessage.title || ""}**

${prMessage.message}

_Powered by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) from job [${this.workflow}](${githubJobUrl})_
<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }

    // Check for existing note from a previous run
    uxLog(this, c.grey("[GitHub Integration] Listing comments of Pull Request..."));
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
      uxLog(this, c.grey("[GitHub Integration] Updating Pull Request Comment on GitHub..."));
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
      uxLog(this, c.grey("[GitHub Integration] Adding Pull Request Comment on GitHub..."));
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

  private completePullRequestInfo(prData: any) {
    const prInfo: any = Object.assign({}, prData);
    prInfo.sourceBranch = (prData?.head?.ref || "").replace("refs/heads/", "");
    prInfo.targetBranch = (prData?.base?.ref || "").replace("refs/heads/", "");
    prInfo.description = prData?.body || "";
    return prInfo;
  }
}
