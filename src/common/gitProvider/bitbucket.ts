import { GitProviderRoot } from "./gitProviderRoot";
import * as c from "chalk";
import { PullRequestMessageRequest, PullRequestMessageResult } from ".";
import { git, uxLog } from "../utils";
import { Bitbucket, Schema } from "bitbucket";

export class BitbucketProvider extends GitProviderRoot {
  private bitbucket: InstanceType<typeof Bitbucket>;

  constructor() {
    super();
    const token = process.env.CI_SFDX_HARDIS_BITBUCKET_TOKEN;
    const clientOptions = { auth: { token: token } };
    this.bitbucket = new Bitbucket(clientOptions);
  }

  public getLabel(): string {
    return "sfdx-hardis Bitbucket connector";
  }

  public async getCurrentJobUrl(): Promise<string> {
    if (process.env.BITBUCKET_WORKSPACE && process.env.BITBUCKET_REPO_SLUG && process.env.BITBUCKET_BUILD_NUMBER) {
      const jobUrl = `https://bitbucket.org/${process.env.BITBUCKET_WORKSPACE}/${process.env.BITBUCKET_REPO_SLUG}/pipelines/results/${process.env.BITBUCKET_BUILD_NUMBER}`;
      return jobUrl;
    }
    uxLog(
      this,
      c.yellow(`[Bitbucket Integration] You need the following variables to be accessible to sfdx-hardis to build current job url:
        - BITBUCKET_WORKSPACE
        - BITBUCKET_REPO_SLUG
        - BITBUCKET_BUILD_NUMBER`),
    );

    return null;
  }

  public async getCurrentBranchUrl(): Promise<string> {
    if (process.env.BITBUCKET_WORKSPACE && process.env.BITBUCKET_REPO_SLUG && process.env.BITBUCKET_BRANCH) {
      const currentBranchUrl = `https://bitbucket.org/${process.env.BITBUCKET_WORKSPACE}/${process.env.BITBUCKET_REPO_SLUG}/branch/${process.env.BITBUCKET_BRANCH}`;
      return currentBranchUrl;
    }
    uxLog(
      this,
      c.yellow(`[Bitbucket Integration] You need the following variables to be accessible to sfdx-hardis to build current job url:
        - BITBUCKET_WORKSPACE
        - BITBUCKET_REPO_SLUG
        - BITBUCKET_BRANCH`),
    );

    return null;
  }

  // Find pull request info
  public async getPullRequestInfo(): Promise<any> {
    const pullRequestIdStr = process.env.BITBUCKET_PR_ID || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;

    // Case when PR is found in the context
    if (pullRequestIdStr !== null) {
      const pullRequestId = Number(pullRequestIdStr);
      const pullRequest = await this.bitbucket.repositories.getPullRequest({
        pull_request_id: pullRequestId,
        repo_slug: repoSlug,
        workspace: workspace,
      });

      if (pullRequest?.data.destination) {
        // Add cross git provider properties used by sfdx-hardis
        return this.completePullRequestInfo(pullRequest.data);
      } else {
        uxLog(this, c.yellow(`[Bitbucket Integration] Warning: incomplete PR found (id: ${pullRequestIdStr})`));
        uxLog(this, c.grey(JSON.stringify(pullRequest || {})));
      }
    }

    // Case when we find PR from a commit
    const sha = await git().revparse(["HEAD"]);
    const latestPullRequestsOnBranch = await this.bitbucket.repositories.listPullrequestsForCommit({
      // cspell:disable-line
      commit: sha,
      repo_slug: repoSlug,
      workspace: workspace,
    });
    const latestMergedPullRequestOnBranch = latestPullRequestsOnBranch?.data?.values?.filter(
      (pr) => pr.state === "MERGED" && pr.merge_commit?.hash === sha,
    );
    if (latestMergedPullRequestOnBranch?.length > 0) {
      const pullRequest = latestMergedPullRequestOnBranch[0];
      // Add cross git provider properties used by sfdx-hardis
      return this.completePullRequestInfo(pullRequest);
    }

    uxLog(this, c.grey(`[Bitbucket Integration] Unable to find related Pull Request Info`));
    return null;
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string> {
    let deploymentCheckId = null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const latestMergedPullRequestsOnBranch = await this.bitbucket.repositories.listPullRequests({
      repo_slug: repoSlug,
      workspace: workspace,
      state: "MERGED",
      q: `destination.branch.name = "${gitBranch}"`,
      sort: "-updated_on",
    });
    if (latestMergedPullRequestsOnBranch?.data?.values?.length > 0) {
      const latestPullRequest = latestMergedPullRequestsOnBranch?.data?.values[0];
      const latestPullRequestId = latestPullRequest.id;
      deploymentCheckId = await this.getDeploymentIdFromPullRequest(latestPullRequestId, repoSlug, workspace, deploymentCheckId, latestPullRequest);
    }

    return deploymentCheckId;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string> {
    const pullRequestInfo = await this.getPullRequestInfo();
    if (pullRequestInfo) {
      const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
      const workspace = process.env.BITBUCKET_WORKSPACE || null;
      return await this.getDeploymentIdFromPullRequest(pullRequestInfo.id, repoSlug, workspace, null, pullRequestInfo);
    }
    return null;
  }

  private async getDeploymentIdFromPullRequest(
    latestPullRequestId: number,
    repoSlug: string,
    workspace: string,
    deploymentCheckId: any,
    latestPullRequest: Schema.Pullrequest,
  ) {
    const comments = await this.bitbucket.repositories.listPullRequestComments({
      pull_request_id: latestPullRequestId,
      repo_slug: repoSlug,
      workspace: workspace,
    });

    for (const comment of comments?.data?.values || []) {
      if ((comment?.content?.raw || "").includes(`<!-- sfdx-hardis deployment-id `)) {
        const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(comment?.content?.raw);
        if (matches) {
          deploymentCheckId = matches[1];
          uxLog(
            this,
            c.gray(`[Bitbucket Integration] Found deployment id ${deploymentCheckId} on PR #${latestPullRequestId} ${latestPullRequest.title}`),
          );
          break;
        }
      }
    }
    return deploymentCheckId;
  }

  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    const pullRequestIdStr = process.env.BITBUCKET_PR_ID || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;

    if (repoSlug == null || pullRequestIdStr == null) {
      uxLog(this, c.grey("[Bitbucket integration] No repo and pull request, so no note posted..."));
      return { posted: false, providerResult: { info: "No related pull request" } };
    }
    const pullRequestId = Number(pullRequestIdStr);
    const bitbucketBuildNumber = process.env.BITBUCKET_BUILD_NUMBER || null;
    const bitbucketJobUrl = await this.getCurrentJobUrl();

    const messageKey = `${prMessage.messageKey}-${bitbucketBuildNumber}-${pullRequestId}`;
    let messageBody = `**${prMessage.title || ""}**

        ${prMessage.message}
        
        \n_Powered by [sfdx-hardis](https://sfdx-hardis.cloudity.com) from job [${bitbucketBuildNumber}](${bitbucketJobUrl})_
        \n<!-- sfdx-hardis message-key ${messageKey} -->
        `;

    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }

    const commentBody: any = {
      content: {
        raw: messageBody,
      },
    };

    // Check for existing comment from a previous run
    uxLog(this, c.grey("[Bitbucket integration] Listing comments of Pull Request..."));
    const existingComments = await this.bitbucket.repositories.listPullRequestComments({
      pull_request_id: pullRequestId,
      repo_slug: repoSlug,
      workspace: workspace,
    });
    let existingCommentId = null;
    for (const existingComment of existingComments?.data?.values || []) {
      if (existingComment?.content.raw?.includes(`<!-- sfdx-hardis message-key ${messageKey} -->`)) {
        existingCommentId = existingComment.id;
      }
    }

    // Create or update MR comment
    if (existingCommentId) {
      // Update existing comment
      uxLog(this, c.grey("[Bitbucket integration] Updating Pull Request Comment on Bitbucket..."));
      const pullRequestComment = await this.bitbucket.repositories.updatePullRequestComment({
        workspace: workspace,
        repo_slug: repoSlug,
        pull_request_id: pullRequestId,
        comment_id: existingCommentId,
        _body: commentBody,
      });

      const prResult: PullRequestMessageResult = {
        posted: pullRequestComment?.data?.id > 0,
        providerResult: pullRequestComment,
      };
      return prResult;
    } else {
      // Create new comment if no existing comment was found
      uxLog(this, c.grey("[Bitbucket integration] Adding Pull Request Comment on Bitbucket..."));

      const pullRequestComment = await this.bitbucket.repositories.createPullRequestComment({
        workspace: workspace,
        repo_slug: repoSlug,
        pull_request_id: pullRequestId,
        _body: commentBody,
      });

      const prResult: PullRequestMessageResult = {
        posted: pullRequestComment?.data?.id > 0,
        providerResult: pullRequestComment,
      };
      return prResult;
    }
  }

  private completePullRequestInfo(prData: Schema.Pullrequest) {
    const prInfo: any = Object.assign({}, prData);
    prInfo.sourceBranch = prData?.source?.branch?.name || "";
    prInfo.targetBranch = prData?.destination?.branch?.name || "";
    return prInfo;
  }
}
