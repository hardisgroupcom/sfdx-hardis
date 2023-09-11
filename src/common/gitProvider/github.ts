import * as github from "@actions/github";
import * as c from "chalk";
import { GitProviderRoot } from "./gitProviderRoot";
import { uxLog } from "../utils";
import { PullRequestMessageRequest, PullRequestMessageResult } from ".";
import { GitHub } from "@actions/github/lib/utils";

export class GithubProvider extends GitProviderRoot {
  private octokit: InstanceType<typeof GitHub>;

  constructor() {
    super();
    const tokenName = process.env.CI_SFDX_HARDIS_GITHUB_TOKEN ? "CI_SFDX_HARDIS_GITHUB_TOKEN" : process.env.PAT ? "PAT" : "GITHUB_TOKEN";
    const token = process.env[tokenName];
    this.octokit = github.getOctokit(token);
  }

  public getLabel(): string {
    return "sfdx-hardis GitHub connector";
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string> {
    let deploymentCheckId = null;
    const repoOwner = github?.context?.repo?.owner || null;
    const repoName = github?.context?.repo?.repo || null;
    uxLog(this, c.grey("[GitHub integration] Listing previously closed Pull Requests"));
    const latestPullRequestsOnBranch = await this.octokit.rest.pulls.list({
      owner: repoOwner,
      repo: repoName,
      state: "closed",
      direction: "desc",
      per_page: 10,
      base: gitBranch,
    });
    if (latestPullRequestsOnBranch.data.length > 0) {
      const latestPullRequest = latestPullRequestsOnBranch.data[0];
      const latestPullRequestId = latestPullRequest.id;
      uxLog(this, c.grey(`[GitHub integration] Listing comments for PR ${latestPullRequestId}`));
      const existingComments = await this.octokit.rest.issues.listComments({
        owner: repoOwner,
        repo: repoName,
        issue_number: latestPullRequestId,
      });
      for (const existingComment of existingComments.data) {
        if (existingComment.body.includes("<!-- sfdx-hardis deployment-id ")) {
          const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(existingComment.body);
          if (matches) {
            deploymentCheckId = matches[1];
            uxLog(this, c.gray(`Found deployment id ${deploymentCheckId} on PR #${latestPullRequestId} ${latestPullRequest.title}`));
          }
          break;
        }
      }
    }
    return deploymentCheckId;
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    const { pull_request } = github.context.payload;

    // Get CI variables
    const repoOwner = github?.context?.repo?.owner || null;
    const repoName = github?.context?.repo?.repo || null;
    const pullRequestId = pull_request?.number || null;
    if (repoName == null || pullRequestId == null) {
      uxLog(this, c.grey("[GitHub integration] No project and merge request, so no note posted..."));
      return { posted: false, providerResult: { info: "No related pull request" } };
    }
    const githubWorkflowName = github.context.workflow;
    const githubJobUrl = `${github.context.serverUrl}/${repoOwner}/${repoName}/actions/runs/${github.context.runId}`;
    // Build note message
    const messageKey = prMessage.messageKey + "-" + githubWorkflowName + "-" + pullRequestId;
    let messageBody = `**${prMessage.title || ""}**

${prMessage.message}

_Provided by [sfdx-hardis](https://sfdx-hardis.cloudity.com) from job [${githubWorkflowName}](${githubJobUrl})_
<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }
    // Check for existing note from a previous run
    uxLog(this, c.grey("[GitHub integration] Listing comments of Pull Request..."));
    const existingComments = await this.octokit.rest.issues.listComments({
      owner: repoOwner,
      repo: repoName,
      issue_number: pullRequestId,
    });
    let existingCommentId = null;
    for (const existingComment of existingComments.data) {
      if (existingComment?.body?.includes(`<!-- sfdx-hardis message-key ${messageKey} -->`)) {
        existingCommentId = existingComment.id;
      }
    }

    // Create or update MR note
    if (existingCommentId) {
      // Update existing note
      uxLog(this, c.grey("[GitHub integration] Updating Pull Request Comment on GitHub..."));
      const githubCommentEditResult = await this.octokit.rest.issues.updateComment({
        owner: repoOwner,
        repo: repoName,
        issue_number: pullRequestId,
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
      uxLog(this, c.grey("[GitHub integration] Adding Pull Request Comment on GitHub..."));
      const githubCommentCreateResult = await this.octokit.rest.issues.createComment({
        owner: repoOwner,
        repo: repoName,
        issue_number: pullRequestId,
        body: messageBody,
      });
      const prResult: PullRequestMessageResult = {
        posted: githubCommentCreateResult.data.id > 0,
        providerResult: githubCommentCreateResult,
      };
      return prResult;
    }
  }
}
