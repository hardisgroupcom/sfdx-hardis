import { GitProviderRoot } from "./gitProviderRoot";
import * as azdev from "azure-devops-node-api";
import * as c from "chalk";
import { uxLog } from "../utils";
import { PullRequestMessageRequest, PullRequestMessageResult } from ".";
import {
  CommentThreadStatus,
  GitPullRequestCommentThread,
  PullRequestAsyncStatus,
  PullRequestStatus,
} from "azure-devops-node-api/interfaces/GitInterfaces";

export class AzureDevopsProvider extends GitProviderRoot {
  private azureApi: InstanceType<typeof azdev.WebApi>;

  constructor() {
    super();
    // Azure server url must be provided in AZURE_SERVER_URL. ex: https:/dev.azure.com/mycompany
    this.serverUrl = process.env.SYSTEM_COLLECTIONURI;
    // a Personal Access Token must be defined
    this.token = process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.SYSTEM_ACCESSTOKEN;
    const authHandler = azdev.getHandlerFromToken(this.token);
    this.azureApi = new azdev.WebApi(this.serverUrl, authHandler);
  }

  public getLabel(): string {
    return "sfdx-hardis Azure Devops connector";
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string> {
    let deploymentCheckId = null;
    // Get Azure Git API
    const azureGitApi = await this.azureApi.getGitApi();
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    if (repositoryId == null) {
      uxLog(this, c.yellow("BUILD_REPOSITORY_ID must be defined"));
      return null;
    }
    const latestPullRequestsOnBranch = await azureGitApi.getPullRequests(repositoryId, {
      targetRefName: `refs/heads/${gitBranch}`,
      status: PullRequestStatus.Completed,
    });
    const latestMergedPullRequestOnBranch = latestPullRequestsOnBranch.filter((pr) => pr.mergeStatus === PullRequestAsyncStatus.Succeeded);
    if (latestMergedPullRequestOnBranch.length > 0) {
      const latestPullRequest = latestMergedPullRequestOnBranch[0];
      const latestPullRequestId = latestPullRequest.pullRequestId;
      const existingThreads = await azureGitApi.getThreads(repositoryId, latestPullRequestId);
      for (const existingThread of existingThreads) {
        if (existingThread.isDeleted) {
          continue;
        }
        for (const comment of existingThread?.comments || []) {
          if ((comment?.content || "").includes(`<!-- sfdx-hardis deployment-id `)) {
            const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(comment.content);
            if (matches) {
              deploymentCheckId = matches[1];
              uxLog(this, c.gray(`Found deployment id ${deploymentCheckId} on PR #${latestPullRequestId} ${latestPullRequest.title}`));
            }
            break;
          }
        }
        if (deploymentCheckId) {
          break;
        }
      }
    }
    return deploymentCheckId;
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    // Get CI variables
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const buildId = process.env.BUILD_BUILD_ID || null;
    const jobId = process.env.SYSTEM_JOB_ID || null;
    const pullRequestIdStr = process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || null;
    if (repositoryId == null || pullRequestIdStr == null) {
      uxLog(this, c.grey("[Azure integration] No project and pull request, so no note thread..."));
      uxLog(
        this,
        c.yellow(`Following variables must be defined when available:
- BUILD_REPOSITORY_ID
- BUILD_BUILD_ID
- SYSTEM_JOB_ID
- SYSTEM_PULLREQUEST_PULLREQUESTID
- SYSTEM_JOB_DISPLAY_NAME
- SYSTEM_COLLECTIONURI
- SYSTEM_TEAMPROJECT
      `),
      );
      return { posted: false, providerResult: { info: "No related pull request" } };
    }
    const pullRequestId = Number(pullRequestIdStr);
    const azureJobName = process.env.SYSTEM_JOB_DISPLAY_NAME;
    const SYSTEM_COLLECTIONURI = process.env.SYSTEM_COLLECTIONURI.replace(/ /g, "%20");
    const SYSTEM_TEAMPROJECT = process.env.SYSTEM_TEAMPROJECT.replace(/ /g, "%20");
    const azureBuildUri = `${SYSTEM_COLLECTIONURI}${SYSTEM_TEAMPROJECT}/_build/results?buildId=${buildId}&view=logs&j=${jobId}`;
    // Build thread message
    const messageKey = prMessage.messageKey + "-" + azureJobName + "-" + pullRequestId;
    let messageBody = `**${prMessage.title || ""}**

${prMessage.message}

<br/>

_Provided by [sfdx-hardis](https://sfdx-hardis.cloudity.com) from job [${azureJobName}](${azureBuildUri})_
<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }
    // Get Azure Git API
    const azureGitApi = await this.azureApi.getGitApi();
    // Check for existing threads from a previous run
    uxLog(this, c.grey("[Azure integration] Listing Threads of Pull Request..."));
    const existingThreads = await azureGitApi.getThreads(repositoryId, pullRequestId);
    let existingThreadId: number = null;
    let existingThreadComment: GitPullRequestCommentThread = null;
    let existingThreadCommentId: number = null;
    for (const existingThread of existingThreads) {
      if (existingThread.isDeleted) {
        continue;
      }
      for (const comment of existingThread?.comments || []) {
        if ((comment?.content || "").includes(`<!-- sfdx-hardis message-key ${messageKey} -->`)) {
          existingThreadComment = existingThread;
          existingThreadCommentId = existingThread.comments[0].id;
          existingThreadId = existingThread.id;
          break;
        }
      }
      if (existingThreadId) {
        break;
      }
    }

    // Create or update MR note
    if (existingThreadId) {
      // Delete previous comment
      uxLog(this, c.grey("[Azure integration] Deleting previous comment and closing previous thread..."));
      await azureGitApi.deleteComment(repositoryId, pullRequestId, existingThreadId, existingThreadCommentId);
      existingThreadComment = await azureGitApi.getPullRequestThread(repositoryId, pullRequestId, existingThreadId);
      // Update existing thread
      existingThreadComment = {
        id: existingThreadComment.id,
        status: CommentThreadStatus.Closed,
      };
      await azureGitApi.updateThread(existingThreadComment, repositoryId, pullRequestId, existingThreadId);
    }

    // Create new thread
    uxLog(this, c.grey("[Azure integration] Adding Pull Request Thread on Azure..."));
    const newThreadComment: GitPullRequestCommentThread = {
      comments: [{ content: messageBody }],
      status: this.pullRequestStatusToAzureThreadStatus(prMessage),
    };
    const azureEditThreadResult = await azureGitApi.createThread(newThreadComment, repositoryId, pullRequestId);
    const prResult: PullRequestMessageResult = {
      posted: azureEditThreadResult.id > 0,
      providerResult: azureEditThreadResult,
    };
    return prResult;
  }

  // Convert sfdx-hardis PR status to Azure Thread status value
  private pullRequestStatusToAzureThreadStatus(prMessage: PullRequestMessageRequest) {
    return prMessage.status === "valid"
      ? CommentThreadStatus.Fixed
      : prMessage.status === "invalid"
      ? CommentThreadStatus.Active
      : CommentThreadStatus.Unknown;
  }
}
