import { GitProviderRoot } from "./gitProviderRoot";
import * as azdev from "azure-devops-node-api";
import * as c from "chalk";
import { uxLog } from "../utils";
import { PullRequestMessageRequest, PullRequestMessageResult } from ".";
import { CommentThreadStatus, GitPullRequestCommentThread } from "azure-devops-node-api/interfaces/GitInterfaces";

export class AzureDevopsProvider extends GitProviderRoot {
  private azureApi: InstanceType<typeof azdev.WebApi>;

  constructor() {
    super();
    // Azure server url must be provided in AZURE_SERVER_URL. ex: https:/dev.azure.com/mycompany
    this.serverUrl = process.env.SYSTEM_COLLECTION_URI;
    // a Personal Access Token must be defined
    this.token = process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.SYSTEM_ACCESSTOKEN;
    const authHandler = azdev.getHandlerFromToken(this.token);
    this.azureApi = new azdev.WebApi(this.serverUrl, authHandler);
  }

  public getLabel(): string {
    return "sfdx-hardis Azure Devops connector";
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    // Get CI variables
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const buildId = process.env.BUILD_BUILD_ID || null ;
    const pullRequestIdStr = process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || null;
    if (repositoryId == null || pullRequestIdStr == null) {
      uxLog(this, c.grey("[Azure integration] No project and pull request, so no note thread..."));
      return;
    }
    const pullRequestId = Number(pullRequestIdStr);
    const azureJobName = process.env.SYSTEM_JOB_DISPLAY_NAME;
    const azureBuildUri = `${process.env.SYSTEM_COLLECTION_URI}${process.env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${buildId}`
    // Build thread message
    const messageKey = prMessage.messageKey + "-" + azureJobName + "-" + pullRequestId;
    let messageBody = `**${prMessage.title || ""}**

${prMessage.message}


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
    for (const existingThread of existingThreads) {
      if (existingThread?.comments[0]?.content.includes(`<!-- sfdx-hardis message-key ${messageKey} -->`)) {
        existingThreadComment = existingThread;
        existingThreadId = existingThread.id;
      }
    }

    // Create or update MR note
    if (existingThreadId) {
      // Update existing note
      uxLog(this, c.grey("[Azure integration] Updating Pull Request Thread on Azure..."));
      existingThreadComment.comments[0] = { content: messageBody };
      existingThreadComment.status = this.pullRequestStatusToAzureThreadStatus(prMessage);
      const azureEditThreadResult = await azureGitApi.updateThread(existingThreadComment, repositoryId, pullRequestId, existingThreadId);
      const prResult: PullRequestMessageResult = {
        posted: azureEditThreadResult.id > 0,
        providerResult: azureEditThreadResult,
      };
      return prResult;
    } else {
      // Create new note if no existing not was found
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
