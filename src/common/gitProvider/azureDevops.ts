import { GitProviderRoot } from "./gitProviderRoot.js";
import * as azdev from "azure-devops-node-api";
import c from "chalk";
import fs from 'fs-extra';
import { getCurrentGitBranch, getGitRepoUrl, git, isGitRepo, uxLog } from "../utils/index.js";
import * as path from "path";
import { PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
import { CommentThreadStatus, GitPullRequest, GitPullRequestCommentThread, GitPullRequestSearchCriteria, PullRequestAsyncStatus, PullRequestStatus } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { CONSTANTS } from "../../config/index.js";
import { SfError } from "@salesforce/core";
import { prompts } from "../utils/prompts.js";
import { extractImagesFromMarkdown, replaceImagesInMarkdown } from "./utilsMarkdown.js";

export class AzureDevopsProvider extends GitProviderRoot {
  private azureApi: InstanceType<typeof azdev.WebApi>;
  public serverUrl: string;
  public token: string;

  constructor() {
    super();
    // Azure server url must be provided in SYSTEM_COLLECTIONURI. ex: https:/dev.azure.com/mycompany
    this.serverUrl = process.env.SYSTEM_COLLECTIONURI || "";
    // a Personal Access Token must be defined
    this.token = process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.SYSTEM_ACCESSTOKEN || "";
    const authHandler = azdev.getHandlerFromToken(this.token);
    this.azureApi = new azdev.WebApi(this.serverUrl, authHandler);
  }

  public static async handleLocalIdentification() {
    if (!isGitRepo()) {
      uxLog(this, c.yellow("[Azure Integration] You must be in a git repository context"));
      return;
    }
    if (!process.env.SYSTEM_COLLECTIONURI) {
      const repoUrl = await getGitRepoUrl() || "";
      if (!repoUrl) {
        uxLog(this, c.yellow("[Azure Integration] An git origin must be set"));
        return;
      }
      const parseUrlRes = this.parseAzureRepoUrl(repoUrl);
      if (!parseUrlRes) {
        uxLog(this, c.yellow(`[Azure Integration] Unable to parse ${repoUrl} to get SYSTEM_COLLECTIONURI and BUILD_REPOSITORY_ID`));
        return;
      }
      process.env.SYSTEM_COLLECTIONURI = parseUrlRes.collectionUri;
      process.env.SYSTEM_TEAMPROJECT = parseUrlRes.teamProject;
      process.env.BUILD_REPOSITORY_ID = parseUrlRes.repositoryId;
    }
    if (!process.env.SYSTEM_ACCESSTOKEN) {
      uxLog(this, c.yellow("If you need an Azure Personal Access Token, create one following this documentation: https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops&tabs=Windows"));
      uxLog(this, c.yellow("Then please save it in a secured password tracker !"));
      const accessTokenResp = await prompts({
        name: "token",
        message: "Please input an Azure Personal Access Token (it won't be stored)",
        type: "text"
      });
      process.env.SYSTEM_ACCESSTOKEN = accessTokenResp.token;
    }
  }

  public getLabel(): string {
    return "sfdx-hardis Azure Devops connector";
  }

  // Returns current job URL
  public async getCurrentJobUrl(): Promise<string | null> {
    if (process.env.SYSTEM_COLLECTIONURI && process.env.SYSTEM_TEAMPROJECT && process.env.BUILD_BUILDID) {
      const jobUrl = `${process.env.SYSTEM_COLLECTIONURI}${encodeURIComponent(process.env.SYSTEM_TEAMPROJECT)}/_build/results?buildId=${process.env.BUILD_BUILDID
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
  public async getCurrentBranchUrl(): Promise<string | null> {
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

  // Azure does not supports mermaid in PR markdown
  public async supportsMermaidInPrMarkdown(): Promise<boolean> {
    return false;
  }

  // Find pull request info
  public async getPullRequestInfo(): Promise<any> {
    // Case when PR is found in the context
    // Get CI variables
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const pullRequestIdStr = process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || null;
    const azureGitApi = await this.azureApi.getGitApi();
    const currentGitBranch = await getCurrentGitBranch();
    if (
      pullRequestIdStr !== null &&
      !(pullRequestIdStr || "").includes("SYSTEM_PULLREQUEST_PULLREQUESTID") &&
      !(pullRequestIdStr || "").includes("$(")
    ) {
      const pullRequestId = Number(pullRequestIdStr);
      const pullRequest = await azureGitApi.getPullRequestById(pullRequestId);
      if (pullRequest && pullRequest.targetRefName) {
        // Add references to work items in PR result
        const pullRequestWorkItemRefs = await azureGitApi.getPullRequestWorkItemRefs(repositoryId || "", pullRequestId);
        if (!pullRequest.workItemRefs) {
          pullRequest.workItemRefs = pullRequestWorkItemRefs;
        }
        return this.completePullRequestInfo(pullRequest);
      } else {
        uxLog(this, c.yellow(`[Azure Integration] Warning: incomplete PR found (id: ${pullRequestIdStr})`));
        uxLog(this, c.grey(JSON.stringify(pullRequest || {})));
      }
    }
    // Case when we find PR from a commit
    const sha = await git().revparse(["HEAD"]);
    const latestPullRequestsOnBranch = await azureGitApi.getPullRequests(repositoryId || "", {
      targetRefName: `refs/heads/${currentGitBranch}`,
      status: PullRequestStatus.Completed,
    });
    const latestMergedPullRequestOnBranch = latestPullRequestsOnBranch.filter(
      (pr) => pr.mergeStatus === PullRequestAsyncStatus.Succeeded && pr.lastMergeCommit?.commitId === sha,
    );
    if (latestMergedPullRequestOnBranch.length > 0) {
      const pullRequest = latestMergedPullRequestOnBranch[0];
      // Add references to work items in PR result
      const pullRequestWorkItemRefs = await azureGitApi.getPullRequestWorkItemRefs(repositoryId || "", pullRequest.pullRequestId || 0);
      if (!pullRequest.workItemRefs) {
        pullRequest.workItemRefs = pullRequestWorkItemRefs;
      }
      return this.completePullRequestInfo(latestMergedPullRequestOnBranch[0]);
    }
    uxLog(this, c.grey(`[Azure Integration] Unable to find related Pull Request Info`));
    return null;
  }

  public async listPullRequests(filters: {
    pullRequestStatus?: "open" | "merged" | "abandoned",
    targetBranch?: string,
    minDate?: Date
  } = {},
    options: {
      formatted?: boolean
    } = { formatted: false }
  ): Promise<GitPullRequest[] | any[]> {
    // Get Azure Git API
    const azureGitApi = await this.azureApi.getGitApi();
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    if (repositoryId == null) {
      uxLog(this, c.yellow("[Azure Integration] Unable to find BUILD_REPOSITORY_ID"));
      return [];
    }
    const teamProject = process.env.SYSTEM_TEAMPROJECT || null;
    if (teamProject == null) {
      uxLog(this, c.yellow("[Azure Integration] Unable to find SYSTEM_TEAMPROJECT"));
      return [];
    }
    // Build search criteria
    const queryConstraint: GitPullRequestSearchCriteria = {};
    if (filters.pullRequestStatus) {
      const azurePrStatusValue =
        filters.pullRequestStatus === "open" ? PullRequestStatus.Active :
          filters.pullRequestStatus === "abandoned" ? PullRequestStatus.Abandoned :
            filters.pullRequestStatus === "merged" ? PullRequestStatus.Completed :
              null;
      if (azurePrStatusValue == null) {
        throw new SfError(`[Azure Integration] No matching status for ${filters.pullRequestStatus} in ${JSON.stringify(PullRequestStatus)}`);
      }
      queryConstraint.status = azurePrStatusValue
    }
    else {
      queryConstraint.status = PullRequestStatus.All
    }
    if (filters.targetBranch) {
      queryConstraint.targetRefName = `refs/heads/${filters.targetBranch}`
    }
    if (filters.minDate) {
      queryConstraint.minTime = filters.minDate
    }
    // Process request
    uxLog(this, c.cyan("Calling Azure API to list Pull Requests..."));
    uxLog(this, c.grey(`Constraint:\n${JSON.stringify(queryConstraint, null, 2)}`));

    // List pull requests
    const pullRequests = await azureGitApi.getPullRequests(repositoryId, queryConstraint, teamProject);

    // Complete results with PR comments
    const pullRequestsWithComments: any[] = [];
    for (const pullRequest of pullRequests) {
      const pr: any = Object.assign({}, pullRequest);
      uxLog(this, c.grey(`Getting threads for PR ${pullRequest.pullRequestId}...`));
      const existingThreads = await azureGitApi.getThreads(pullRequest.repository?.id || "", pullRequest.pullRequestId || 0, teamProject);
      pr.threads = existingThreads.filter(thread => !thread.isDeleted);
      pullRequestsWithComments.push(pr);
    }

    // Format if requested
    if (options.formatted) {
      uxLog(this, c.cyan(`Formatting ${pullRequestsWithComments.length} results...`));
      const pullRequestsFormatted = pullRequestsWithComments.map(pr => {
        const prFormatted: any = {};
        let tickets = "";
        // Find sfdx-hardis deployment simulation status comment and extract tickets part
        for (const thread of pr.threads) {
          for (const comment of thread?.comments || []) {
            if ((comment?.content || "").includes(`<!-- sfdx-hardis deployment-id `)) {
              const ticketsSplit = comment.content.split("## Tickets");
              if (ticketsSplit.length === 2) {
                tickets = ticketsSplit[1].split("## Commits summary")[0].trim();
              }
              break;
            }
            if (tickets !== "") {
              break;
            }
          }
        }
        prFormatted.pullRequestId = pr.pullRequestId;
        prFormatted.targetRefName = (pr.targetRefName || "").replace("refs/heads/", "");
        prFormatted.sourceRefName = (pr.sourceRefName || "").replace("refs/heads/", "");
        prFormatted.status = PullRequestStatus[pr.status || 0]
        prFormatted.mergeStatus = PullRequestAsyncStatus[pr.mergeStatus || 0];
        prFormatted.title = pr.title;
        prFormatted.description = pr.description;
        prFormatted.tickets = tickets;
        prFormatted.closedBy = pr.closedBy?.uniqueName || pr.closedBy?.displayName;
        prFormatted.closedDate = pr.closedDate;
        prFormatted.createdBy = pr.createdBy?.uniqueName || pr.createdBy?.displayName;
        prFormatted.creationDate = pr.creationDate;
        prFormatted.reviewers = (pr.reviewers || []).map(reviewer => reviewer.uniqueName || reviewer.displayName).join(",");
        return prFormatted;
      });
      return pullRequestsFormatted;
    }
    return pullRequestsWithComments;
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string | null> {
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
      deploymentCheckId = await this.getDeploymentIdFromPullRequest(
        azureGitApi,
        repositoryId,
        latestPullRequestId || 0,
        deploymentCheckId,
        latestPullRequest,
      );
    }
    return deploymentCheckId;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string | null> {
    const pullRequestInfo = await this.getPullRequestInfo();
    if (pullRequestInfo) {
      const azureGitApi = await this.azureApi.getGitApi();
      const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
      if (repositoryId == null) {
        uxLog(this, c.yellow("BUILD_REPOSITORY_ID must be defined"));
        return null;
      }
      return await this.getDeploymentIdFromPullRequest(azureGitApi, repositoryId, pullRequestInfo.pullRequestId, null, pullRequestInfo);
    }
    return null;
  }

  private async getDeploymentIdFromPullRequest(
    azureGitApi,
    repositoryId: string,
    latestPullRequestId: number,
    deploymentCheckId: any,
    latestPullRequest,
  ) {
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
            break;
          }
        }
      }
      if (deploymentCheckId) {
        break;
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
    const SYSTEM_COLLECTIONURI = (process.env.SYSTEM_COLLECTIONURI || "").replace(/ /g, "%20");
    const SYSTEM_TEAMPROJECT = (process.env.SYSTEM_TEAMPROJECT || "").replace(/ /g, "%20");
    const azureBuildUri = `${SYSTEM_COLLECTIONURI}${encodeURIComponent(SYSTEM_TEAMPROJECT)}/_build/results?buildId=${buildId}&view=logs&j=${jobId}`;
    // Build thread message
    const messageKey = prMessage.messageKey + "-" + azureJobName + "-" + pullRequestId;
    let messageBody = `**${prMessage.title || ""}**

${prMessage.message}

<br/>

_Powered by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) from job [${azureJobName}](${azureBuildUri})_
<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }
    // Upload attached images if necessary
    messageBody = await this.uploadAndReplaceImageReferences(messageBody);
    // Get Azure Git API
    const azureGitApi = await this.azureApi.getGitApi();
    // Check for existing threads from a previous run
    uxLog(this, c.grey("[Azure integration] Listing Threads of Pull Request..."));
    const existingThreads = await azureGitApi.getThreads(repositoryId, pullRequestId);
    let existingThreadId: number | null = null;
    let existingThreadComment: GitPullRequestCommentThread | null = null;
    let existingThreadCommentId: number | null | undefined = null;
    for (const existingThread of existingThreads) {
      if (existingThread.isDeleted) {
        continue;
      }
      for (const comment of existingThread?.comments || []) {
        if ((comment?.content || "").includes(`<!-- sfdx-hardis message-key ${messageKey} -->`)) {
          existingThreadComment = existingThread;
          existingThreadCommentId = (existingThread.comments || [])[0].id;
          existingThreadId = existingThread.id || null;
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
      await azureGitApi.deleteComment(repositoryId, pullRequestId, existingThreadId, existingThreadCommentId || 0);
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
      posted: (azureEditThreadResult.id || -1) > 0,
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
    prInfo.web_url = `${process.env.SYSTEM_COLLECTIONURI}${encodeURIComponent(process.env.SYSTEM_TEAMPROJECT || "")}/_git/${encodeURIComponent(
      process.env.BUILD_REPOSITORYNAME || "",
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
    NOTIF_EMAIL_ADDRESS: $(NOTIF_EMAIL_ADDRESS)
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

  // Do not make crash the whole process in case there is an issue with integration
  public async tryPostPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    let prResult: PullRequestMessageResult | null = null;
    try {
      prResult = await this.postPullRequestMessage(prMessage);
    } catch (e) {
      uxLog(this, c.yellow(`[GitProvider] Error while trying to post pull request message.\n${(e as Error).message}\n${(e as Error).stack}`));
      prResult = { posted: false, providerResult: { error: e } };
    }
    return prResult;
  }

  public static parseAzureRepoUrl(remoteUrl: string): {
    collectionUri: string;
    teamProject: string;
    repositoryId: string;
  } | null {
    let collectionUri: string;
    let repositoryId: string;
    let teamProject: string;

    if (remoteUrl.startsWith("https://")) {
      // Handle HTTPS URLs with or without username
      const httpsRegex = /https:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/;
      const match = remoteUrl.match(httpsRegex);
      if (match) {
        const organization = match[1];
        teamProject = decodeURIComponent(match[2]); // Decode URL-encoded project name
        repositoryId = decodeURIComponent(match[3]); // Decode URL-encoded repository name
        collectionUri = `https://dev.azure.com/${organization}/`;
        return { collectionUri, teamProject, repositoryId };
      }
    } else if (remoteUrl.startsWith("git@")) {
      /* jscpd:ignore-start */
      // Handle SSH URLs
      const sshRegex = /git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/;
      const match = remoteUrl.match(sshRegex);
      if (match) {
        const organization = match[1];
        teamProject = decodeURIComponent(match[2]); // Decode URL-encoded project name
        repositoryId = decodeURIComponent(match[3]); // Decode URL-encoded repository name
        collectionUri = `https://dev.azure.com/${organization}/`;
        return { collectionUri, teamProject, repositoryId };
      }
      /* jscpd:ignore-end */
    }

    // Return null if the URL doesn't match expected patterns
    return null;
  }

  private async uploadAndReplaceImageReferences(markdownBody: string) {
    const replacements: any = {};
    const markdownImages = extractImagesFromMarkdown(markdownBody);
    for (const image of markdownImages) {
      const imageUrl = await this.uploadImage(image);
      if (imageUrl) {
        replacements[image] = imageUrl;
      }
    }
    markdownBody = replaceImagesInMarkdown(markdownBody, replacements);
    return markdownBody;
  }

  private async uploadImage(localImagePath: string): Promise<string | null> {
    try {
      // Upload the image to Azure DevOps
      const imageName = path.basename(localImagePath);
      const imageContent = fs.createReadStream(localImagePath);
      const witApi = await this.azureApi.getWorkItemTrackingApi();
      const attachment = await witApi.createAttachment(
        null, // Custom headers (usually null)
        imageContent, // File content
        process.env.SYSTEM_TEAMPROJECT, // Project name
        imageName // File name
      );
      if (attachment && attachment.url) {
        return attachment.url;
      }
    } catch (e) {
      uxLog(this, c.yellow(`[Azure Integration] Error while uploading image ${localImagePath}\n${(e as Error).message}`));
    }
    return null;
  }
}
