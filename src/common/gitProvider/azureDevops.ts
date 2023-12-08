import { GitProviderRoot } from "./gitProviderRoot";
import * as azdev from "azure-devops-node-api";
import * as c from "chalk";
import { getCurrentGitBranch, git, uxLog } from "../utils";
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

  // Returns current job URL
  public async getCurrentJobUrl(): Promise<string> {
    if (process.env.SYSTEM_COLLECTIONURI && process.env.SYSTEM_TEAMPROJECT && process.env.BUILD_BUILDID) {
      const jobUrl = `${process.env.SYSTEM_COLLECTIONURI}${encodeURIComponent(process.env.SYSTEM_TEAMPROJECT)}/_build/results?buildId=${
        process.env.BUILD_BUILDID
      }`;
      return jobUrl;
    }
    uxLog(
      this,
      c.yellow(`[Azure DevOps] You need the following variables to be accessible to sfdx-hardis to build current job url:
  - SYSTEM_COLLECTIONURI
  - SYSTEM_TEAMPROJECT
  - BUILD_BUILDID`),
    );
    return null;
  }

  // Returns current job URL
  public async getCurrentBranchUrl(): Promise<string> {
    if (
      process.env.SYSTEM_COLLECTIONURI &&
      process.env.SYSTEM_TEAMPROJECT &&
      process.env.BUILD_REPOSITORYNAME &&
      process.env.BUILD_SOURCEBRANCHNAME
    ) {
      const currentBranchUrl = `${process.env.SYSTEM_COLLECTIONURI}${encodeURIComponent(process.env.SYSTEM_TEAMPROJECT)}/_git/${encodeURIComponent(
        process.env.BUILD_REPOSITORYNAME,
      )}?version=GB${process.env.BUILD_SOURCEBRANCHNAME}`;
      return currentBranchUrl;
    }
    uxLog(
      this,
      c.yellow(`[Azure DevOps] You need the following variables to be defined in azure devops pipeline step:
${this.getPipelineVariablesConfig()}
`),
    );
    return null;
  }

  // Find pull request info
  public async getPullRequestInfo(): Promise<any> {
    // Case when PR is found in the context
    // Get CI variables
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const pullRequestIdStr = process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || null;
    const azureGitApi = await this.azureApi.getGitApi();
    const currentGitBranch = await getCurrentGitBranch();
    if (pullRequestIdStr !== null && !(pullRequestIdStr || "").includes("SYSTEM_PULLREQUEST_PULLREQUESTID")) {
      const pullRequestId = Number(pullRequestIdStr);
      const pullRequest = await azureGitApi.getPullRequestById(pullRequestId);
      if (pullRequest && pullRequest.targetRefName) {
        return this.completePullRequestInfo(pullRequest);
      } else {
        uxLog(this, c.yellow("[Azure Integration] Warning: incomplete PR found"));
        uxLog(this, c.yellow(JSON.stringify(pullRequest || {})));
      }
    }
    // Case when we find PR from a commit
    const sha = await git().revparse(["HEAD"]);
    const latestPullRequestsOnBranch = await azureGitApi.getPullRequests(repositoryId, {
      targetRefName: `refs/heads/${currentGitBranch}`,
      status: PullRequestStatus.Completed,
    });
    const latestMergedPullRequestOnBranch = latestPullRequestsOnBranch.filter(
      (pr) => pr.mergeStatus === PullRequestAsyncStatus.Succeeded && pr.lastMergeCommit?.commitId === sha,
    );
    if (latestMergedPullRequestOnBranch.length > 0) {
      return this.completePullRequestInfo(latestMergedPullRequestOnBranch[0]);
    }
    uxLog(this, c.grey(`[Azure Integration] Unable to find related Pull Request Info`));
    return null;
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
        c.yellow(`Following variables should be defined when available:
${this.getPipelineVariablesConfig()}
      `),
      );
      return { posted: false, providerResult: { info: "No related pull request" } };
    }
    const pullRequestId = Number(pullRequestIdStr);
    const azureJobName = process.env.SYSTEM_JOB_DISPLAY_NAME;
    const SYSTEM_COLLECTIONURI = process.env.SYSTEM_COLLECTIONURI.replace(/ /g, "%20");
    const SYSTEM_TEAMPROJECT = process.env.SYSTEM_TEAMPROJECT.replace(/ /g, "%20");
    const azureBuildUri = `${SYSTEM_COLLECTIONURI}${encodeURIComponent(SYSTEM_TEAMPROJECT)}/_build/results?buildId=${buildId}&view=logs&j=${jobId}`;
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
    uxLog(this, c.grey(`[Azure integration] Posted Pull Request Thread ${azureEditThreadResult.id}`));
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

  private completePullRequestInfo(prData: any) {
    const prInfo: any = Object.assign({}, prData);
    prInfo.sourceBranch = (prData.sourceRefName || "").replace("refs/heads/", "");
    prInfo.targetBranch = (prData.targetRefName || "").replace("refs/heads/", "");
    prInfo.web_url = `${process.env.SYSTEM_COLLECTIONURI}${encodeURIComponent(process.env.SYSTEM_TEAMPROJECT)}/_git/${encodeURIComponent(
      process.env.BUILD_REPOSITORYNAME,
    )}/pullrequest/${prData.pullRequestId}`;
    prInfo.authorName = prData?.createdBy?.displayName || "";
    return prInfo;
  }

  private getPipelineVariablesConfig() {
    return `
    SFDX_DEPLOY_WAIT_MINUTES: 150
    CI_COMMIT_REF_NAME: $(BRANCH_NAME)
    CONFIG_BRANCH: $(BRANCH_NAME)
    ORG_ALIAS: $(BRANCH_NAME)
    SLACK_TOKEN: $(SLACK_TOKEN)
    SLACK_CHANNEL_ID: $(SLACK_CHANNEL_ID)
    MS_TEAMS_WEBHOOK_URL: $(MS_TEAMS_WEBHOOK_URL)
    CI: "true"
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)
    CI_SFDX_HARDIS_AZURE_TOKEN: $(System.AccessToken)
    SYSTEM_COLLECTIONURI: $(System.CollectionUri)
    SYSTEM_TEAMPROJECT: $(System.TeamProject)
    SYSTEM_JOB_DISPLAY_NAME: $(System.JobDisplayName)
    SYSTEM_JOB_ID: $(System.JobId)
    SYSTEM_PULLREQUEST_PULLREQUESTID: $(System.PullRequest.PullRequestId)
    BUILD_REPOSITORY_ID: $(Build.Repository.ID)
    BUILD_REPOSITORYNAME: $(Build.Repository.Name)
    BUILD_SOURCEBRANCHNAME: $(Build.SourceBranchName)
    BUILD_BUILD_ID: $(Build.BuildId)`;
  }
}
