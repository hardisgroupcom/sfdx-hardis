import { buildPrCreateUrl, CiRunFilters, CiRunStatus, CommonCiRun, DashboardComment, DashboardFormat, DashboardRef, GitProviderRepositorySettings, GitProviderRoot, JobArtifact, JobArtifactsListing, PullRequestCommentRef, PullRequestCreateUrlResult } from "./gitProviderRoot.js";
import { POOL_DASHBOARD_TITLE } from "../utils/poolDashboardUtils.js";
import { CiRunCandidate, classifyJobKind, selectCiRuns } from "./utils/jobKindUtils.js";
import { Build, BuildQueryOrder, BuildReason, BuildResult, BuildStatus, TaskResult } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { toAzureDevopsWording } from "./utils/utilsAzureDevopsWording.js";
import * as azdev from "azure-devops-node-api";
import c from "chalk";
import fs from '../utils/fsUtils.js';
import { getCurrentGitBranch, getGitRepoUrl, git, isGitRepo, uxLog } from "../utils/index.js";
import * as path from "path";
import { CommonPullRequestInfo, CreatePullRequestRequest, CreatePullRequestResult, PullRequestCommitInfo, PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
import { CommentThreadStatus, GitCommitRef, GitPullRequest, GitPullRequestCommentThread, GitPullRequestSearchCriteria, PullRequestAsyncStatus, PullRequestStatus, PullRequestTimeRangeType } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { getBannerMarkdownAndLink, getEnvVar } from "../../config/index.js";
import { getPrCommentKind, getPrCommentKindFromMessageKey } from "./utils/prCommentNav.js";
import { SfError } from "@salesforce/core";
import { HttpError, httpDelete } from "../utils/httpUtils.js";
import { prompts } from "../utils/prompts.js";
import { t } from '../utils/i18n.js';
import { PROVIDER_BATCH_PROFILES, mapInAdaptiveBatches, mapInAdaptiveBatchesSettled } from '../utils/adaptiveBatch.js';

import { parseAzureBuildUrl } from "./utils/jobUrlUtils.js";
import { pipeline } from "stream/promises";
import { isJenkins, getJenkinsBranchName, getJenkinsPrNumber, getJenkinsBuildNumber, getJenkinsJobName, getJenkinsJobUrl } from "./utils/jenkinsUtils.js";
import { getCachedPullRequestDescription, repositoryKeyFromRemoteUrl, setCachedPullRequestDescription } from "../cache/pullRequestDescriptionCache.js";

// A dashboard work item is replaced above this number of revisions (the limit of Azure DevOps is 10,000)
const DASHBOARD_MAX_REVISIONS = 8000;
const DASHBOARD_COMMENT_ATTEMPTS = 4;

export class AzureDevopsProvider extends GitProviderRoot {
  private azureApi: InstanceType<typeof azdev.WebApi>;
  public serverUrl: string;
  public token: string;
  public attachmentsWorkItemId: number;
  // Download address of the artifacts listed by listJobArtifacts, by "<build id>/<artifact name>"
  private artifactDownloadUrls = new Map<string, string>();
  public attachmentsWorkItemTitle: string = process.env.AZURE_ATTACHMENTS_WORK_ITEM_TITLE || 'sfdx-hardis tech attachments'
  // Set when the provider is built for another repository than the one of the current folder
  private otherRepository: { remoteUrl: string; teamProject: string; repositoryName: string } | null = null;
  // GUID of the repository, asked once to the Git API when only its name is known
  private resolvedRepositoryGuid: string | null = null;

  constructor(repository?: GitProviderRepositorySettings) {
    super();
    if (repository) {
      // Another repository than the one of the current folder: nothing is read from the CI context
      const parsed = AzureDevopsProvider.parseAzureRepoUrl(repository.remoteUrl);
      if (!parsed) {
        throw new SfError(t('gitProviderRepositoryUrlNotRecognized', { url: repository.remoteUrl, provider: "Azure DevOps" }));
      }
      this.otherRepository = { remoteUrl: repository.remoteUrl, teamProject: parsed.teamProject, repositoryName: parsed.repositoryId };
      this.serverUrl = parsed.collectionUri;
      this.token = repository.token;
      this.azureApi = new azdev.WebApi(this.serverUrl, azdev.getHandlerFromToken(this.token));
      return;
    }
    // Azure server url must be provided in SYSTEM_COLLECTIONURI. ex: https:/dev.azure.com/mycompany
    this.serverUrl = process.env.SYSTEM_COLLECTIONURI || "";
    // a Personal Access Token must be defined. AZURE_DEVOPS_EXT_PAT comes last: it is the variable
    // the Azure CLI uses, so a developer machine usually already has it.
    this.token = process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.SYSTEM_ACCESSTOKEN || process.env.AZURE_DEVOPS_EXT_PAT || "";
    const authHandler = azdev.getHandlerFromToken(this.token);
    this.azureApi = new azdev.WebApi(this.serverUrl, authHandler);
  }

  // Auto-detect Azure DevOps CI variables from token + local git remote URL (non-interactive)
  public static async autoDetectSettings(): Promise<void> {
    try {
      if (!isGitRepo()) {
        uxLog("log", AzureDevopsProvider, c.grey("[Azure DevOps] " + t("autoDetectProviderNoGitRemote", { provider: "Azure DevOps" })));
        return;
      }
      // Map CI_SFDX_HARDIS_AZURE_TOKEN or AZURE_DEVOPS_EXT_PAT to SYSTEM_ACCESSTOKEN if needed
      if (!process.env.SYSTEM_ACCESSTOKEN && (process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.AZURE_DEVOPS_EXT_PAT)) {
        process.env.SYSTEM_ACCESSTOKEN = process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.AZURE_DEVOPS_EXT_PAT;
      }
      // Parse git remote URL to extract collection URI, team project, and repository ID
      if (!process.env.SYSTEM_COLLECTIONURI) {
        const remoteUrl = (await git().getConfig("remote.origin.url"))?.value || "";
        if (!remoteUrl) {
          uxLog("log", AzureDevopsProvider, c.grey("[Azure DevOps] " + t("autoDetectProviderNoGitRemote", { provider: "Azure DevOps" })));
          return;
        }
        const parseUrlRes = AzureDevopsProvider.parseAzureRepoUrl(remoteUrl);
        if (!parseUrlRes) {
          uxLog("log", AzureDevopsProvider, c.grey("[Azure DevOps] " + t("autoDetectProviderParseUrlFailed", { provider: "Azure DevOps" })));
          return;
        }
        process.env.SYSTEM_COLLECTIONURI = parseUrlRes.collectionUri;
        if (!process.env.SYSTEM_TEAMPROJECT) {
          process.env.SYSTEM_TEAMPROJECT = parseUrlRes.teamProject;
        }
        if (!process.env.BUILD_REPOSITORY_ID) {
          process.env.BUILD_REPOSITORY_ID = parseUrlRes.repositoryId;
        }
      }
      // When running on Jenkins, map Jenkins-specific variables to Azure DevOps equivalents
      if (isJenkins()) {
        if (!process.env.BUILD_BUILDID) {
          const buildNumber = getJenkinsBuildNumber();
          if (buildNumber) {
            process.env.BUILD_BUILDID = buildNumber;
          }
        }
        if (!process.env.BUILD_BUILD_ID) {
          const buildNumber = getJenkinsBuildNumber();
          if (buildNumber) {
            process.env.BUILD_BUILD_ID = buildNumber;
          }
        }
        if (!process.env.BUILD_SOURCEBRANCHNAME) {
          const branch = getJenkinsBranchName();
          if (branch) {
            process.env.BUILD_SOURCEBRANCHNAME = branch;
          }
        }
        if (!process.env.BUILD_REPOSITORYNAME && process.env.BUILD_REPOSITORY_ID) {
          process.env.BUILD_REPOSITORYNAME = process.env.BUILD_REPOSITORY_ID;
        }
        if (!process.env.SYSTEM_PULLREQUEST_PULLREQUESTID) {
          const prNumber = getJenkinsPrNumber();
          if (prNumber) {
            process.env.SYSTEM_PULLREQUEST_PULLREQUESTID = prNumber;
          }
        }
        if (!process.env.SYSTEM_JOB_DISPLAY_NAME) {
          const jobName = getJenkinsJobName();
          if (jobName) {
            process.env.SYSTEM_JOB_DISPLAY_NAME = jobName;
          }
        }
        if (!process.env.SYSTEM_JOB_ID) {
          const buildNumber = getJenkinsBuildNumber();
          if (buildNumber) {
            process.env.SYSTEM_JOB_ID = buildNumber;
          }
        }
        uxLog("log", AzureDevopsProvider, c.grey("[Azure DevOps] " + t("autoDetectProviderJenkinsMapping", { provider: "Azure DevOps" })));
      }
      /* Only log the success summary when Jenkins is involved - on native CI providers this is just noise */
      if (isJenkins()) {
        uxLog("log", AzureDevopsProvider, c.grey("[Azure DevOps] " + t("autoDetectProviderSuccess", {
          provider: "Azure DevOps",
          details: `server=${process.env.SYSTEM_COLLECTIONURI}, project=${process.env.SYSTEM_TEAMPROJECT || "unknown"}`,
        })));
      }
    } catch (e) {
      uxLog("warning", AzureDevopsProvider, c.yellow("[Azure DevOps] " + t("autoDetectProviderFailed", { provider: "Azure DevOps", message: (e as Error).message })));
    }
  }

  public static async handleLocalIdentification() {
    if (!isGitRepo()) {
      uxLog("warning", this, c.yellow('[Azure Integration] ' + t('azureIntegrationNotGitRepo')));
      return;
    }
    if (!process.env.SYSTEM_COLLECTIONURI) {
      const repoUrl = await getGitRepoUrl() || "";
      if (!repoUrl) {
        uxLog("warning", this, c.yellow('[Azure Integration] ' + t('azureIntegrationNoGitOrigin')));
        return;
      }
      const parseUrlRes = this.parseAzureRepoUrl(repoUrl);
      if (!parseUrlRes) {
        uxLog("warning", this, c.yellow('[Azure Integration] ' + t('azureIntegrationUnableToParseRepoUrl', { repoUrl })));
        return;
      }
      process.env.SYSTEM_COLLECTIONURI = parseUrlRes.collectionUri;
      process.env.SYSTEM_TEAMPROJECT = parseUrlRes.teamProject;
      process.env.BUILD_REPOSITORY_ID = parseUrlRes.repositoryId;
    }
    if (!process.env.SYSTEM_ACCESSTOKEN) {
      uxLog("warning", this, c.yellow(t('ifYouNeedAzurePersonalAccessToken') + ': https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops&tabs=Windows'));
      uxLog("warning", this, c.yellow(t('thenPleaseSaveItInSecuredPassword')));
      const accessTokenResp = await prompts({
        name: "token",
        message: t('pleaseInputAnAzurePersonalAccessToken'),
        description: t('enterYourAzureDevopsPersonalAccessToken'),
        type: "text"
      });
      process.env.SYSTEM_ACCESSTOKEN = accessTokenResp.token;
    }
  }

  /**
   * https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequestcreate?sourceRef=&targetRef=
   */
  public static getPullRequestCreateUrl(remoteUrl: string, request: CreatePullRequestRequest): PullRequestCreateUrlResult | null {
    const parsed = AzureDevopsProvider.parseAzureRepoUrl(remoteUrl);
    if (!parsed) {
      return null;
    }
    const collectionUri = parsed.collectionUri.replace(/\/$/, "");
    const repoPath = `${collectionUri}/${encodeURIComponent(parsed.teamProject)}/_git/${encodeURIComponent(parsed.repositoryId)}`;
    return buildPrCreateUrl((body) => {
      const params = new URLSearchParams({
        sourceRef: request.sourceBranch,
        targetRef: request.targetBranch,
        title: request.title,
      });
      if (body) {
        params.set("description", body);
      }
      return `${repoPath}/pullrequestcreate?${params.toString()}`;
    }, request.body || "");
  }

  public getLabel(): string {
    return "sfdx-hardis Azure Devops connector";
  }

  public getSafeDirectoryCommand(): string {
    return 'git config --global --add safe.directory "$(Build.SourcesDirectory)"';
  }

  public logAutoFixRemediation(step: "push" | "pr-create"): void {
    const stepLabel = step === "push" ? "git push" : "pull request creation";
    uxLog("log", this, `\n[sfdx-hardis] Auto-fix ${stepLabel} remediation guide (azure)`);
    uxLog("log", this, "1) Update workflow: enable OAuth token for scripts and persist git credentials in checkout.");
    uxLog("log", this, "   Example: checkout with persistCredentials: true and expose SYSTEM_ACCESSTOKEN in job env.");
    uxLog("log", this, "2) Set variable: SYSTEM_ACCESSTOKEN (or CI_SFDX_HARDIS_AZURE_TOKEN).");
    uxLog("log", this, "3) How to get value: enable \"Allow scripts to access OAuth token\" in pipeline settings; or create a PAT with Code Read & Write + Pull Request Threads Read & Write and store it as a secret variable.");
  }

  // Returns current job URL
  public async getCurrentJobUrl(): Promise<string | null> {
    if (process.env.PIPELINE_JOB_URL) {
      return process.env.PIPELINE_JOB_URL;
    }
    // On Jenkins, always return the Jenkins BUILD_URL so PR comments link to the Jenkins build,
    // not an Azure DevOps URL constructed from the mapped variables
    const jenkinsUrl = getJenkinsJobUrl();
    if (isJenkins() && jenkinsUrl) {
      return jenkinsUrl;
    }
    if (process.env.SYSTEM_COLLECTIONURI && process.env.SYSTEM_TEAMPROJECT && process.env.BUILD_BUILDID) {
      const jobUrl = `${process.env.SYSTEM_COLLECTIONURI}${encodeURIComponent(process.env.SYSTEM_TEAMPROJECT)}/_build/results?buildId=${process.env.BUILD_BUILDID
        }`;
      return jobUrl;
    }
    // Jenkins fallback (when BUILD_URL exists but isJenkins() returned false)
    if (jenkinsUrl) {
      return jenkinsUrl;
    }
    uxLog(
      "warning",
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
      "warning",
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

  // Extract PR ID from commit message (fallback when SYSTEM_PULLREQUEST_PULLREQUESTID is null after merge)
  private async extractPullRequestIdFromCommitMessage(): Promise<number | null> {
    try {
      const log = await git().log(['-1']); // Get the latest commit message
      const commitMessage = log?.latest?.message || '';
      if (!commitMessage) {
        return null;
      }
      // Azure DevOps merge commit patterns:
      // - "Merge pull request #123 from branch-name"
      // - "Merged PR #123: Title"
      // - "Merge PR #123"
      // - "Merged pull request #123"
      // - "Merge pull request 123 from branch-name"
      // - "Merged PR 123: Title"
      // - "Merge PR 123"
      // - "Merged pull request 123"
      const prIdPatterns = [
        /(?:Merge|Merged)\s+(?:pull\s+request|PR)\s+#?(\d+)/i,
        /(?:Merge|Merged)\s+PR\s+#?(\d+)/i,
        /pull\s+request\s+#?(\d+)/i,
        /PR\s+#?(\d+)/i,
      ];
      for (const pattern of prIdPatterns) {
        const match = commitMessage.match(pattern);
        if (match && match[1]) {
          const prId = Number(match[1]);
          if (!isNaN(prId) && prId > 0) {
            uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationExtractedPrId', { prId })));
            return prId;
          }
        }
      }
    } catch (error) {
      uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationUnableToExtractPrId', { message: (error as Error).message })));
    }
    return null;
  }

  // Find pull request info
  public async getPullRequestInfo(): Promise<CommonPullRequestInfo | null> {
    // Case when PR is found in the context
    // Get CI variables
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    let pullRequestIdStr = process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || null;
    const azureGitApi = await this.azureApi.getGitApi();
    const currentGitBranch = await getCurrentGitBranch();

    // If SYSTEM_PULLREQUEST_PULLREQUESTID is null or invalid, try to extract from commit message
    if (pullRequestIdStr === null) {
      const extractedPrId = await this.extractPullRequestIdFromCommitMessage();
      if (extractedPrId !== null) {
        pullRequestIdStr = String(extractedPrId);
      }
    }

    if (
      pullRequestIdStr !== null &&
      !(pullRequestIdStr || "").includes("SYSTEM_PULLREQUEST_PULLREQUESTID") &&
      !(pullRequestIdStr || "").includes("$(")
    ) {
      const pullRequestId = Number(pullRequestIdStr);
      const pullRequest = await azureGitApi.getPullRequestById(pullRequestId);
      if (pullRequest && pullRequest.targetRefName) {
        // Add references to work items in PR result
        const pullRequestWorkItemRefs = await azureGitApi.getPullRequestWorkItemRefs(repositoryId || "", pullRequestId, azureTeamProject());
        if (!pullRequest.workItemRefs) {
          pullRequest.workItemRefs = pullRequestWorkItemRefs;
        }
        return this.completePullRequestInfo(pullRequest);
      } else {
        uxLog("warning", this, c.yellow('[Azure Integration] ' + t('azureIntegrationIncompletePr', { prId: pullRequestIdStr })));
        uxLog("log", this, c.grey(JSON.stringify(pullRequest || {})));
      }
    }
    // Case when we find PR from a commit
    const sha = await git().revparse(["HEAD"]);
    const latestPullRequestsOnBranch = await azureGitApi.getPullRequests(repositoryId || "", {
      targetRefName: `refs/heads/${currentGitBranch}`,
      status: PullRequestStatus.Completed,
    }, azureTeamProject());
    const latestMergedPullRequestOnBranch = latestPullRequestsOnBranch.filter(
      (pr) => pr.mergeStatus === PullRequestAsyncStatus.Succeeded && this.isPullRequestMatchingCommit(pr, sha),
    );
    if (latestMergedPullRequestOnBranch.length > 0) {
      const pullRequest = latestMergedPullRequestOnBranch[0];
      // Add references to work items in PR result
      const pullRequestWorkItemRefs = await azureGitApi.getPullRequestWorkItemRefs(repositoryId || "", pullRequest.pullRequestId || 0, azureTeamProject());
      if (!pullRequest.workItemRefs) {
        pullRequest.workItemRefs = pullRequestWorkItemRefs;
      }
      return this.completePullRequestInfo(await this.completeTruncatedDescription(azureGitApi, pullRequest));
    }
    uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationUnableToFindPrInfo')));
    return null;
  }

  public supportsDashboard(): boolean {
    return true;
  }

  // Work items belong to the project, not to the repository: two repositories of one project
  // must not share a dashboard
  public getDashboardTitle(title: string): string {
    // In a pipeline the name is in BUILD_REPOSITORY_NAME (BUILD_REPOSITORYNAME in the templates).
    // On a workstation only BUILD_REPOSITORY_ID is set, read from the git remote: it is then the name.
    const repositoryId = process.env.BUILD_REPOSITORY_ID || "";
    const repositoryName =
      this.otherRepository?.repositoryName ||
      process.env.BUILD_REPOSITORY_NAME ||
      process.env.BUILD_REPOSITORYNAME ||
      (AZURE_GUID_REGEX.test(repositoryId) ? "" : repositoryId);
    return repositoryName ? `${title} (${decodeURIComponent(repositoryName)})` : title;
  }

  // Work item descriptions and comments are HTML
  public getDashboardFormat(): DashboardFormat {
    return 'html';
  }

  // The dashboard is a Task work item, found by its title like the attachments work item
  public async findDashboard(title: string): Promise<DashboardRef | null> {
    // The forced work item is the one of the scratch org pool: other dashboards are found by title
    const forcedId = process.env.AZURE_SCRATCH_POOL_WORK_ITEM_ID;
    if (forcedId && title.startsWith(POOL_DASHBOARD_TITLE)) {
      return { id: Number(forcedId), url: this.buildWorkItemWebUrl(Number(forcedId)) };
    }
    const witApi = await this.azureApi.getWorkItemTrackingApi();
    const queryResult = await witApi.queryByWiql({
      query: `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.Title] = '${title.replace(/'/g, "''")}'
          AND [System.TeamProject] = '${this.dashboardTeamProject().replace(/'/g, "''")}'
        ORDER BY [System.Id]
      `,
    });
    const workItemId = (queryResult.workItems || [])[0]?.id;
    return workItemId ? { id: Number(workItemId), url: this.buildWorkItemWebUrl(Number(workItemId)) } : null;
  }

  public async createDashboard(title: string, body: string): Promise<DashboardRef> {
    const witApi = await this.azureApi.getWorkItemTrackingApi();
    const workItem = await witApi.createWorkItem(
      [],
      [
        { op: "add", path: "/fields/System.Title", value: title },
        { op: "add", path: "/fields/System.Description", value: body },
      ],
      this.dashboardTeamProject(),
      "Task",
    );
    return { id: Number(workItem.id), url: this.buildWorkItemWebUrl(Number(workItem.id)) };
  }

  public async getDashboardBody(dashboard: DashboardRef): Promise<string> {
    const witApi = await this.azureApi.getWorkItemTrackingApi();
    const workItem = await witApi.getWorkItem(dashboard.id, ['System.Description'], undefined, undefined, this.dashboardTeamProject());
    return (workItem?.fields || {})['System.Description'] || '';
  }

  public async updateDashboardBody(dashboard: DashboardRef, title: string, body: string): Promise<void> {
    const witApi = await this.azureApi.getWorkItemTrackingApi();
    await witApi.updateWorkItem(
      [],
      [
        { op: "add", path: "/fields/System.Title", value: title },
        { op: "add", path: "/fields/System.Description", value: body },
      ],
      dashboard.id,
      this.dashboardTeamProject(),
    );
  }

  public async listDashboardComments(dashboard: DashboardRef): Promise<DashboardComment[]> {
    const witApi = await this.azureApi.getWorkItemTrackingApi();
    const comments: DashboardComment[] = [];
    let continuationToken: string | undefined = undefined;
    do {
      const page = await witApi.getComments(this.dashboardTeamProject(), dashboard.id, 200, continuationToken);
      for (const comment of page.comments || []) {
        if (comment.isDeleted) {
          continue;
        }
        comments.push({
          id: Number(comment.id),
          body: comment.text || '',
          createdDate: comment.createdDate ? new Date(comment.createdDate).toISOString() : '',
        });
      }
      continuationToken = page.continuationToken || undefined;
    } while (continuationToken);
    return comments.sort((a, b) => a.id - b.id);
  }

  public async createDashboardComment(dashboard: DashboardRef, body: string): Promise<number> {
    const witApi = await this.azureApi.getWorkItemTrackingApi();
    // Comments posted at the same time on one work item sometimes fail (TF54000, TF401349):
    // the same call succeeds a moment later
    let lastError: any = null;
    for (let attempt = 0; attempt < DASHBOARD_COMMENT_ATTEMPTS; attempt++) {
      try {
        const comment = await witApi.addComment({ text: body }, this.dashboardTeamProject(), dashboard.id);
        if (comment?.id) {
          return Number(comment.id);
        }
        lastError = new SfError("[Azure Integration] The work item comment was not created");
      } catch (e) {
        lastError = e;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 700));
      // A call that failed can have created the comment: posting it again would put a scratch
      // org twice in the pool
      const marker = body.match(/\[sfdx-hardis-pool-data:[A-Za-z0-9_-]+\]/)?.[0];
      if (marker) {
        const existing = (await this.listDashboardComments(dashboard)).find((comment) => comment.body.replace(/\s+/g, '').includes(marker));
        if (existing) {
          return existing.id;
        }
      }
    }
    throw lastError;
  }

  public async deleteDashboardComment(dashboard: DashboardRef, commentId: number): Promise<boolean> {
    // Direct REST call: the client of azure-devops-node-api resolves the same way for a 404, and
    // the 404 is the answer that tells another job deleted the comment first
    const url = `${this.serverUrl.replace(/\/$/, "")}/${encodeURIComponent(this.dashboardTeamProject())}/_apis/wit/workItems/${dashboard.id}/comments/${commentId}?api-version=7.1-preview.4`;
    try {
      await httpDelete(url, { headers: { Authorization: this.getAuthorizationHeader() } });
      return true;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        return false;
      }
      throw e;
    }
  }

  // A work item refuses updates past 10,000 revisions, and every comment and every body update
  // is one: it is replaced well before
  public async isDashboardWornOut(dashboard: DashboardRef): Promise<boolean> {
    const witApi = await this.azureApi.getWorkItemTrackingApi();
    const workItem = await witApi.getWorkItem(dashboard.id, ["System.Rev"], undefined, undefined, this.dashboardTeamProject());
    return Number(workItem?.rev || 0) > DASHBOARD_MAX_REVISIONS;
  }

  // Renamed like the attachments work item when it is full: findDashboard looks for the exact title
  public async closeDashboard(dashboard: DashboardRef): Promise<void> {
    const witApi = await this.azureApi.getWorkItemTrackingApi();
    const workItem = await witApi.getWorkItem(dashboard.id, ["System.Title"], undefined, undefined, this.dashboardTeamProject());
    const title = workItem?.fields?.["System.Title"] || "";
    await witApi.updateWorkItem(
      [],
      [{ op: "add", path: "/fields/System.Title", value: `${title} (closed ${new Date().toISOString().slice(0, 10)})` }],
      dashboard.id,
      this.dashboardTeamProject(),
    );
  }

  // Same scheme as azdev.getHandlerFromToken: a Personal Access Token (52 or 84 characters) is
  // sent as Basic auth, the token of a pipeline as a Bearer
  private getAuthorizationHeader(): string {
    if (this.token.length === 52 || this.token.length === 84) {
      return "Basic " + Buffer.from(`:${this.token}`).toString("base64");
    }
    return `Bearer ${this.token}`;
  }

  private dashboardTeamProject(): string {
    const teamProject = this.otherRepository?.teamProject || process.env.SYSTEM_TEAMPROJECT || "";
    if (!teamProject) {
      throw new SfError("[Azure Integration] SYSTEM_TEAMPROJECT must be defined to use a work item as dashboard");
    }
    return teamProject;
  }

  private buildWorkItemWebUrl(workItemId: number): string {
    return `${this.serverUrl.replace(/\/$/, "")}/${encodeURIComponent(this.dashboardTeamProject())}/_workitems/edit/${workItemId}`;
  }

  public async closePullRequest(pullRequestNumber: number): Promise<boolean> {
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const teamProject = process.env.SYSTEM_TEAMPROJECT || null;
    if (!repositoryId || !teamProject) {
      return false;
    }
    try {
      const azureGitApi = await this.azureApi.getGitApi();
      await azureGitApi.updatePullRequest({ status: PullRequestStatus.Abandoned }, repositoryId, pullRequestNumber, teamProject);
      return true;
    } catch (e: any) {
      uxLog("warning", this, c.yellow('[Azure Integration] ' + t('gitProviderClosePullRequestFailed', { number: pullRequestNumber, message: e?.message || e })));
      return false;
    }
  }

  public async listPullRequests(filters: {
    status?: string,
    pullRequestStatus?: "open" | "merged" | "abandoned",
    targetBranch?: string,
    minDate?: Date,
    minDateOn?: 'created' | 'merged',
    withoutComments?: boolean
  } = {}): Promise<CommonPullRequestInfo[] | null> {
    // Get Azure Git API
    const azureGitApi = await this.azureApi.getGitApi();
    const repositoryId = this.repositoryIdOrName;
    if (repositoryId == null) {
      uxLog("warning", this, c.yellow('[Azure Integration] ' + t('azureIntegrationNoBuildRepositoryId')));
      return [];
    }
    const teamProject = this.teamProjectName;
    if (teamProject == null) {
      uxLog("warning", this, c.yellow("[Azure Integration] Unable to find SYSTEM_TEAMPROJECT"));
      return [];
    }
    // Build search criteria
    const queryConstraint: GitPullRequestSearchCriteria = {};
    const statusInput = filters.pullRequestStatus || filters.status;
    if (statusInput) {
      const azurePrStatusValue =
        statusInput === "open" ? PullRequestStatus.Active :
          statusInput === "abandoned" ? PullRequestStatus.Abandoned :
            statusInput === "merged" ? PullRequestStatus.Completed :
              null;
      if (azurePrStatusValue == null) {
        throw new SfError(`[Azure Integration] No matching status for ${statusInput} in ${JSON.stringify(PullRequestStatus)}`);
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
      // minTime applies to the creation date unless told otherwise: a completed Pull Request is
      // closed when it is merged
      if (filters.minDateOn === 'merged') {
        queryConstraint.queryTimeRangeType = PullRequestTimeRangeType.Closed
      }
    }
    // Process request
    uxLog("action", this, c.cyan(t('callingAzureApiToListPullRequests')));
    uxLog("log", this, c.grey(t('constraint', { JSON: JSON.stringify(queryConstraint, null, 2) })));

    if (filters.withoutComments) {
      // The API serves the listing by pages: all of them, or the oldest Pull Requests of the period are lost
      const listed: GitPullRequest[] = [];
      for (let skip = 0; ; skip += AzureDevopsProvider.PULL_REQUESTS_PAGE_SIZE) {
        const page = (await azureGitApi.getPullRequests(repositoryId, queryConstraint, teamProject, undefined, skip, AzureDevopsProvider.PULL_REQUESTS_PAGE_SIZE)) || [];
        listed.push(...page);
        if (page.length < AzureDevopsProvider.PULL_REQUESTS_PAGE_SIZE) {
          break;
        }
      }
      return listed.map((pullRequest) => this.completePullRequestInfo(pullRequest));
    }

    // List pull requests
    const pullRequests = await azureGitApi.getPullRequests(repositoryId, queryConstraint, teamProject);
    // Complete results with PR comments (stored in providerInfo)
    const results: CommonPullRequestInfo[] = [];
    for (const pullRequest of pullRequests) {
      const pr: GitPullRequest & { threads?: any[] } = Object.assign({}, await this.completeTruncatedDescription(azureGitApi, pullRequest));
      uxLog("log", this, c.grey(t('gettingThreadsForPr', { pullRequest: pullRequest.pullRequestId })));
      const existingThreads = await azureGitApi.getThreads(pullRequest.repository?.id || "", pullRequest.pullRequestId || 0, teamProject);
      pr.threads = existingThreads.filter(thread => !thread.isDeleted);
      results.push(this.completePullRequestInfo(pr));
    }

    return results;
  }
  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string | null> {
    let deploymentCheckId: string | null = null;
    // Get Azure Git API
    /* jscpd:ignore-start */
    const azureGitApi = await this.azureApi.getGitApi();
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    if (repositoryId == null) {
      uxLog("warning", this, c.yellow(t('buildrepositoryidMustBeDefined')));
      return null;
    }
    /* jscpd:ignore-end */
    const latestPullRequestsOnBranch = await azureGitApi.getPullRequests(repositoryId, {
      targetRefName: `refs/heads/${gitBranch}`,
      status: PullRequestStatus.Completed,
    }, azureTeamProject());
    const latestMergedPullRequestOnBranch = latestPullRequestsOnBranch.filter((pr) => pr.mergeStatus === PullRequestAsyncStatus.Succeeded);
    if (latestMergedPullRequestOnBranch.length > 0) {
      // Select the PR whose merge commit matches the commit currently being deployed (HEAD).
      // When several PRs are merged around the same time, the most recently completed PR is not
      // necessarily the one that produced this build's commit. Using its validation id would make
      // QuickDeploy reuse an unrelated PR's deployment and deploy the wrong metadata.
      const sha = await git().revparse(["HEAD"]);
      const matchingPullRequest = latestMergedPullRequestOnBranch.find((pr) => this.isPullRequestMatchingCommit(pr, sha)) || null;
      if (matchingPullRequest == null) {
        uxLog("warning", this, c.yellow('[Azure Integration] ' + t('azureNoPrMatchingDeployedCommit', { sha })));
        return null;
      }
      deploymentCheckId = await this.getDeploymentIdFromPullRequest(
        azureGitApi,
        repositoryId,
        matchingPullRequest.pullRequestId || 0,
        deploymentCheckId,
        matchingPullRequest,
      );
    }
    return deploymentCheckId;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string | null> {
    const pullRequestInfo = await this.getPullRequestInfo();
    if (pullRequestInfo) {
      /* jscpd:ignore-start */
      const azureGitApi = await this.azureApi.getGitApi();
      const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
      if (repositoryId == null) {
        uxLog("warning", this, c.yellow(t('buildrepositoryidMustBeDefined')));
        return null;
      }
      /* jscpd:ignore-end */
      return await this.getDeploymentIdFromPullRequest(azureGitApi, repositoryId, pullRequestInfo.idNumber || 0, null, pullRequestInfo);
    }
    return null;
  }

  private isPullRequestMatchingCommit(pr: GitPullRequest, sha: string): boolean {
    // Azure can put the deployed target-branch HEAD in lastMergeCommit for merge/squash
    // completions, or in lastMergeSourceCommit for rebase/fast-forward completions.
    return pr.lastMergeCommit?.commitId === sha || pr.lastMergeSourceCommit?.commitId === sha;
  }

  private async getDeploymentIdFromPullRequest(
    azureGitApi: any,
    repositoryId: string,
    latestPullRequestId: number,
    deploymentCheckId: string | null,
    latestPullRequest: any,
  ): Promise<string | null> {
    const existingThreads = await azureGitApi.getThreads(repositoryId, latestPullRequestId, azureTeamProject());
    // A PR can hold several deployment-id comments, one per pipeline run. The getThreads API has no
    // sort parameter, so we cannot rely on ordering: scan every comment and select the most recent
    // one by date, otherwise QuickDeploy would reuse an outdated validation id.
    let latestDeploymentTime = -1;
    for (const existingThread of existingThreads) {
      if (existingThread.isDeleted) {
        continue;
      }
      for (const comment of existingThread?.comments || []) {
        if (comment?.isDeleted) {
          continue;
        }
        if ((comment?.content || "").includes(`<!-- sfdx-hardis deployment-id `)) {
          const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(comment.content);
          if (matches) {
            const commentTime = this.getCommentTimestamp(comment, existingThread);
            if (commentTime >= latestDeploymentTime) {
              latestDeploymentTime = commentTime;
              deploymentCheckId = matches[1];
            }
          }
        }
      }
    }
    if (deploymentCheckId) {
      uxLog("log", this, c.grey(t('foundDeploymentIdOnPr', { deploymentCheckId, latestPullRequestId, latestPullRequest: latestPullRequest.title })));
    }
    return deploymentCheckId;
  }

  // Returns a comparable timestamp (ms) for a PR comment, falling back to its parent thread.
  // Comments are updated in place from one run to the next, so the last update is what tells when
  // the content (and the deployment id it carries) was written, not the creation date.
  private getCommentTimestamp(comment: any, thread: any): number {
    const dateValues = [
      comment?.lastUpdatedDate,
      comment?.publishedDate,
      thread?.lastUpdatedDate,
      thread?.publishedDate,
    ];
    let latest = 0;
    for (const dateValue of dateValues) {
      if (!dateValue) {
        continue;
      }
      const time = new Date(dateValue).getTime();
      if (!isNaN(time) && time > latest) {
        latest = time;
      }
    }
    return latest;
  }

  public async listPullRequestCommits(pullRequestId: number): Promise<PullRequestCommitInfo[] | null> {
    if (!this.azureApi || !process.env.BUILD_REPOSITORY_ID) {
      return null;
    }
    try {
      const azureGitApi = await this.azureApi.getGitApi();
      const repositoryId = process.env.BUILD_REPOSITORY_ID;
      const project = process.env.SYSTEM_TEAMPROJECT;
      // Azure DevOps keeps the commits of a squashed Pull Request, served by pages
      const commits = await this.listAllPullRequestCommitRefs(azureGitApi, repositoryId, pullRequestId, project);
      // The listing shortens long messages (commentTruncated), which only cuts the body: a
      // cherry-pick trailer would then be lost, so those commits are read again in full
      const results = await mapInAdaptiveBatches(commits, async (commit) => {
        let message = commit.comment || '';
        let parentShas = commit.parents || [];
        if (commit.commentTruncated && commit.commitId) {
          const full = await azureGitApi.getCommit(commit.commitId, repositoryId, project);
          message = full?.comment || message;
          parentShas = full?.parents || parentShas;
        }
        return { sha: commit.commitId || '', message, parentShas };
        // A few at a time: the Pull Requests themselves are already read in parallel
      }, { sizes: [8, 4, 1] });
      return results.filter((commit): commit is PullRequestCommitInfo => !!commit && !!commit.sha);
    } catch (err) {
      uxLog("warning", this, c.yellow('[Azure Integration] ' + t('gitProviderPullRequestCommitsNotListed', { number: pullRequestId, message: String(err) })));
      return null;
    }
  }

  /**
   * Every commit of a Pull Request. getPullRequestCommits of azure-devops-node-api only returns
   * the first page (about 100 commits) and exposes neither $top nor the continuation token, so
   * the same REST resource is called with them. Falls back to the first page if that call fails.
   */
  private async listAllPullRequestCommitRefs(azureGitApi: any, repositoryId: string, pullRequestId: number, project: string | undefined): Promise<GitCommitRef[]> {
    const pages: GitCommitRef[] = [];
    try {
      let continuationToken: string | undefined = undefined;
      for (let page = 0; page < AzureDevopsProvider.PULL_REQUEST_COMMITS_MAX_PAGES; page++) {
        const queryParameters: Record<string, any> = { '$top': AzureDevopsProvider.PULL_REQUEST_COMMITS_PAGE_SIZE };
        if (continuationToken) {
          queryParameters.continuationToken = continuationToken;
        }
        const versioning = await azureGitApi.vsoClient.getVersioningData(
          "7.1",
          "git",
          AzureDevopsProvider.PULL_REQUEST_COMMITS_LOCATION_ID,
          { project, repositoryId, pullRequestId },
          queryParameters,
        );
        const response = await azureGitApi.rest.get(versioning.requestUrl, azureGitApi.createRequestOptions('application/json', versioning.apiVersion));
        const raw = response?.result;
        const items: GitCommitRef[] = Array.isArray(raw) ? raw : Array.isArray(raw?.value) ? raw.value : [];
        pages.push(...items);
        const headers = response?.headers || {};
        continuationToken = headers['x-ms-continuationtoken'] || headers['X-MS-ContinuationToken'] || undefined;
        if (!continuationToken || items.length === 0) {
          return pages;
        }
      }
      uxLog("warning", this, c.yellow('[Azure Integration] ' + t('gitProviderPullRequestCommitsTruncated', { number: pullRequestId, count: pages.length })));
      return pages;
    } catch (err) {
      uxLog("other", this, `[Azure Integration] Paged listing of the commits of Pull Request ${pullRequestId} failed, first page only: ${String(err)}`);
      return (await azureGitApi.getPullRequestCommits(repositoryId, pullRequestId, project)) || [];
    }
  }

  public async getPullRequestById(pullRequestId: number): Promise<CommonPullRequestInfo | null> {
    try {
      const azureGitApi = await this.azureApi.getGitApi();
      const pullRequest = await azureGitApi.getPullRequestById(pullRequestId);
      if (!pullRequest || !pullRequest.targetRefName) {
        return null;
      }
      // Azure Pull Request ids are unique per organization, not per repository: without this check
      // a number copied from another repository of the same organization would resolve, and its
      // deployment actions and Apex test classes would be run against this project's org.
      // BUILD_REPOSITORY_ID is a GUID in a pipeline, and the repository name read from the git
      // remote everywhere else (VS Code, a terminal): the Pull Request is of this repository when
      // either matches.
      const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
      // A name alone is not enough: two team projects of an organization can each hold a repository
      // of that name, so the project of the Pull Request has to be the one of the git remote too.
      const pullRequestProject = (pullRequest.repository?.project?.name || "").toLowerCase();
      const thisProject = (process.env.SYSTEM_TEAMPROJECT || "").toLowerCase();
      const sameProject = !pullRequestProject || !thisProject || pullRequestProject === thisProject;
      const sameRepository =
        pullRequest.repository?.id === repositoryId ||
        ((pullRequest.repository?.name || "").toLowerCase() === (repositoryId || "").toLowerCase() && sameProject);
      if (repositoryId && pullRequest.repository?.id && !sameRepository) {
        uxLog("warning", this, c.yellow('[Azure Integration] ' + t('gitProviderPrOtherRepository', { id: pullRequestId })));
        return null;
      }
      // status 3 is "completed" (merged). An abandoned Pull Request also carries a closedDate, and
      // completePullRequestInfo derives mergedDate from it, so it would look merged to the callers.
      if (pullRequest.status !== undefined && pullRequest.status !== 3) {
        return this.completePullRequestInfo({ ...pullRequest, closedDate: undefined });
      }
      return this.completePullRequestInfo(pullRequest);
    } catch (err) {
      uxLog("warning", this, c.yellow('[Azure Integration] ' + t('gitProviderPrByIdNotFound', { id: pullRequestId, message: String(err) })));
      return null;
    }
  }

  public async listPullRequestsInBranchSinceLastMerge(
    currentBranchName: string,
    targetBranchName: string,
    childBranchesNames: string[],
  ): Promise<CommonPullRequestInfo[]> {
    if (!this.azureApi || !process.env.SYSTEM_TEAMPROJECT || !process.env.BUILD_REPOSITORY_ID) {
      return [];
    }

    try {
      const gitApi = await this.azureApi.getGitApi();

      // Step 1: Find the last completed PR from currentBranch to targetBranch
      const lastMergePRs = await gitApi.getPullRequests(
        process.env.BUILD_REPOSITORY_ID,
        {
          sourceRefName: `refs/heads/${currentBranchName}`,
          targetRefName: `refs/heads/${targetBranchName}`,
          status: PullRequestStatus.Completed,
        },
        process.env.SYSTEM_TEAMPROJECT,
        undefined,
        undefined,
        1, // top: only need the latest one
      );
      uxLog("log", this, c.grey(`[Azure Integration][listPullRequestsInBranchSinceLastMerge] Last merge PR query: ${currentBranchName} -> ${targetBranchName}`));

      const lastMergedPrToTarget = lastMergePRs && lastMergePRs.length > 0 ? lastMergePRs[0] : null;

      // Step 2: Get commits since last merge
      const commitsCriteria: any = {
        compareVersion: {
          version: currentBranchName,
          versionType: 0, // GitVersionType.Branch
        },
      };

      // If there was a previous merge, use the merge commit (from target branch) as the base comparison point
      if (lastMergedPrToTarget?.lastMergeSourceCommit?.commitId) {
        commitsCriteria.itemVersion = {
          version: lastMergedPrToTarget?.lastMergeSourceCommit?.commitId,
          versionType: 2, // GitVersionType.Commit
        };
      } else {
        // No previous merge, compare against target branch to get all commits
        // Just list all commits in currentBranch
        commitsCriteria.itemVersion = {
          version: targetBranchName,
          versionType: 0, // GitVersionType.Branch
        };
      }

      const commits = await gitApi.getCommitsBatch(
        commitsCriteria,
        process.env.BUILD_REPOSITORY_ID,
        process.env.SYSTEM_TEAMPROJECT,
      );
      uxLog("log", this, c.grey(`[Azure Integration][listPullRequestsInBranchSinceLastMerge] Found ${commits?.length || 0} commits since last merge`));

      if (!commits || commits.length === 0) {
        return [];
      }

      // Create a Set of commit IDs for fast lookup
      const commitIds = new Set(
        commits.map((c) => c.commitId).filter((id) => id) as string[],
      );

      // Step 3-6: Match completed PRs targeting currentBranch and child branches against those commits
      const allBranches = [currentBranchName, ...childBranchesNames];
      return await this.collectMergedPrsForCommits(gitApi, allBranches, commitIds);
    } catch (err) {
      uxLog(
        "warning",
        this,
        c.yellow(`Error in listPullRequestsInBranchSinceLastMerge: ${String(err)}`),
      );
      return [];
    }
  }

  // List the Pull Requests included in a specific "go live" merge commit (e.g. the merge
  // of preprod into main). Bounds the range by the merge commit's first parent so hotfixes
  // merged to the target branch at other times are excluded.
  public async listPullRequestsInGoLive(
    branchName: string,
    childBranchesNames: string[],
    mergeCommitId: string,
  ): Promise<CommonPullRequestInfo[]> {
    if (!this.azureApi || !process.env.SYSTEM_TEAMPROJECT || !process.env.BUILD_REPOSITORY_ID || !mergeCommitId) {
      return [];
    }
    try {
      const gitApi = await this.azureApi.getGitApi();

      // Step 1: Resolve the merge commit's first parent (the mainline before the go live)
      const mergeCommit = await gitApi.getCommit(mergeCommitId, process.env.BUILD_REPOSITORY_ID, process.env.SYSTEM_TEAMPROJECT);
      const firstParent = mergeCommit?.parents?.[0];
      if (!firstParent) {
        return [];
      }

      // Step 2: Commits introduced by the go live (firstParent..mergeCommit)
      const commits = await gitApi.getCommitsBatch(
        {
          itemVersion: { version: firstParent, versionType: 2 }, // GitVersionType.Commit
          compareVersion: { version: mergeCommitId, versionType: 2 }, // GitVersionType.Commit
        } as any,
        process.env.BUILD_REPOSITORY_ID,
        process.env.SYSTEM_TEAMPROJECT,
      );
      const commitIds = new Set((commits || []).map((c) => c.commitId).filter((id) => id) as string[]);
      commitIds.add(mergeCommitId);

      // Step 3-6: Match completed PRs targeting branchName and child branches against those commits
      const allBranches = [branchName, ...childBranchesNames];
      return await this.collectMergedPrsForCommits(gitApi, allBranches, commitIds);
    } catch (err) {
      uxLog(
        "warning",
        this,
        c.yellow(`Error in listPullRequestsInGoLive: ${String(err)}`),
      );
      return [];
    }
  }

  // Shared tail: fetch completed PRs targeting each branch, keep those whose merge commit
  // (or source commit) is part of commitIds, dedupe by PR id and convert to the common shape.
  private async collectMergedPrsForCommits(
    gitApi: any,
    allBranches: string[],
    commitIds: Set<string>,
  ): Promise<CommonPullRequestInfo[]> {
    // Adaptive batches of the Azure ladder, shrunk only when the provider throttles
    const prResults = await mapInAdaptiveBatchesSettled(allBranches, async (branchName) => {
      {
        const prs = await gitApi.getPullRequests(
          process.env.BUILD_REPOSITORY_ID!,
          {
            targetRefName: `refs/heads/${branchName}`,
            status: PullRequestStatus.Completed,
          },
          process.env.SYSTEM_TEAMPROJECT,
        );
        // Internal fetch detail: the recently merged PRs of each branch are only CANDIDATES,
        // matched below against the window commits. Logged at "other" level so the console
        // does not suggest that all these PRs are part of the scope.
        uxLog("other", this, c.grey(`[Azure Integration] Fetched ${prs?.length || 0} recently completed PRs targeting branch ${branchName}, as candidates to match against the commits window`));
        return prs || [];
      }
    }, {
      sizes: PROVIDER_BATCH_PROFILES.azure,
      onError: (err, branchName) => uxLog("warning", this, c.yellow(`Error fetching completed PRs for branch ${branchName}: ${String(err)}`)),
    });
    const allMergedPRs: any[] = prResults.flatMap((prs) => prs || []);

    // Keep PRs whose merge commit (or source commit) is in our commit list
    const relevantPRs = allMergedPRs.filter((pr) => {
      const mergeCommitId = pr.lastMergeCommit?.commitId;
      if (mergeCommitId && commitIds.has(mergeCommitId)) {
        return true;
      }
      const sourceCommitId = pr.lastMergeSourceCommit?.commitId;
      if (sourceCommitId && commitIds.has(sourceCommitId)) {
        return true;
      }
      return false;
    });

    // Remove duplicates by PR id
    const uniquePRsMap = new Map();
    for (const pr of relevantPRs) {
      if (!uniquePRsMap.has(pr.pullRequestId)) {
        uniquePRsMap.set(pr.pullRequestId, pr);
      }
    }
    const completed: CommonPullRequestInfo[] = [];
    for (const pr of uniquePRsMap.values()) {
      completed.push(this.completePullRequestInfo(await this.completeTruncatedDescription(gitApi, pr)));
    }
    return completed;
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    // Get CI variables
    const prInfo = await this.getPullRequestInfo();
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const buildId = process.env.BUILD_BUILD_ID || null;
    const jobId = process.env.SYSTEM_JOB_ID || null;
    const pullRequestIdStr = getEnvVar("SYSTEM_PULLREQUEST_PULLREQUESTID") || prInfo?.idStr || null;

    if (repositoryId == null || pullRequestIdStr == null) {
      uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationNoProjectNoPrThread')));
      uxLog(
        "warning",
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
    const messageKey = prMessage.messageKey + "-" + this.jobMessageKeySegment(azureJobName) + "-" + pullRequestId;
    let messageBody = `${this.buildPrCommentBodyHeader(prMessage)}${prMessage.message}

<br/>

${this.buildPoweredByFooter(azureJobName, azureBuildUri)}

${getBannerMarkdownAndLink()}

<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId && prMessage.skipDeploymentIdMarker !== true) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }
    // Reworded for Azure DevOps before the cap, so the size guard bounds what is sent
    messageBody = this.enforceHardCommentLimit(toAzureDevopsWording(messageBody));
    // Upload attached images if necessary
    messageBody = await this.uploadAndReplaceImageReferences(messageBody, prMessage.sourceFile || "");
    // Get Azure Git API
    const azureGitApi = await this.azureApi.getGitApi();
    // Check for existing threads from a previous run. A comment of the same kind (validation or
    // deployment) matches even when its message key carries another job name: the merge job this
    // way updates the pending deployment comment created by the validation job instead of adding a
    // second deployment comment.
    uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationListingPrThreads', { pullRequestId })));
    const currentCommentKind = getPrCommentKindFromMessageKey(prMessage.messageKey);
    const existingThreads = await azureGitApi.getThreads(repositoryId, pullRequestId, azureTeamProject());
    let existingThreadId: number | null = null;
    let existingThreadCommentId: number | null | undefined = null;
    for (const existingThread of existingThreads) {
      if (existingThread.isDeleted) {
        continue;
      }
      for (const comment of existingThread?.comments || []) {
        if (comment?.isDeleted) {
          continue;
        }
        const commentContent = comment?.content || "";
        if (commentContent.includes(`<!-- sfdx-hardis message-key ${messageKey} -->`) ||
          (currentCommentKind !== null && getPrCommentKind(commentContent) === currentCommentKind)) {
          existingThreadCommentId = comment.id;
          existingThreadId = existingThread.id || null;
          break;
        }
      }
      if (existingThreadId) {
        break;
      }
    }

    // Update the existing comment in place: the thread id must stay stable, because the navigation
    // links of the other sfdx-hardis comments and of the Pull Request description point to it, and
    // the description cannot be fixed after the merge (see isPrDescriptionEditableAfterMerge)
    if (existingThreadId && existingThreadCommentId) {
      uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationUpdatingPrThread', { threadId: existingThreadId })));
      await azureGitApi.updateComment({ content: messageBody }, repositoryId, pullRequestId, existingThreadId, existingThreadCommentId, azureTeamProject());
      await azureGitApi.updateThread(
        { status: this.pullRequestStatusToAzureThreadStatus(prMessage) },
        repositoryId,
        pullRequestId,
        existingThreadId,
        azureTeamProject(),
      );
      uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationPostedPrThread', { threadId: existingThreadId })));
      return {
        posted: true,
        providerResult: { threadId: existingThreadId, commentId: existingThreadCommentId },
      };
    }

    // Create new thread
    uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationAddingPrThread')));
    const newThreadComment: GitPullRequestCommentThread = {
      comments: [{ content: messageBody }],
      status: this.pullRequestStatusToAzureThreadStatus(prMessage),
    };
    const azureEditThreadResult = await azureGitApi.createThread(newThreadComment, repositoryId, pullRequestId, azureTeamProject());
    const prResult: PullRequestMessageResult = {
      posted: (azureEditThreadResult.id || -1) > 0,
      providerResult: azureEditThreadResult,
    };
    uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationPostedPrThread', { threadId: azureEditThreadResult.id })));
    return prResult;
  }

  // Azure DevOps returns TF401181 when editing the description of a completed Pull Request
  public isPrDescriptionEditableAfterMerge(): boolean {
    return false;
  }

  // "A description for a pull request must not be longer than 4000 characters."
  public getMaxPullRequestDescriptionLength(): number | null {
    return 4000;
  }

  // Convert sfdx-hardis PR status to Azure Thread status value
  private pullRequestStatusToAzureThreadStatus(prMessage: PullRequestMessageRequest) {
    return prMessage.status === "valid"
      ? CommentThreadStatus.Fixed
      : prMessage.status === "invalid"
        ? CommentThreadStatus.Active
        : CommentThreadStatus.Unknown;
  }

  // Web URL of a Pull Request. The repository name variable is exposed as BUILD_REPOSITORY_NAME by
  // Azure Pipelines: the BUILD_REPOSITORYNAME spelling is kept as a fallback for older agents.
  private buildPullRequestWebUrl(pullRequestId: number | undefined): string {
    if (this.otherRepository) {
      return `${this.serverUrl}${encodeURIComponent(this.otherRepository.teamProject)}/_git/${encodeURIComponent(
        this.otherRepository.repositoryName,
      )}/pullrequest/${pullRequestId}`;
    }
    const repositoryName = process.env.BUILD_REPOSITORY_NAME || process.env.BUILD_REPOSITORYNAME || "";
    return `${process.env.SYSTEM_COLLECTIONURI}${encodeURIComponent(
      process.env.SYSTEM_TEAMPROJECT || "",
    )}/_git/${encodeURIComponent(repositoryName)}/pullrequest/${pullRequestId}`;
  }

  // Azure DevOps truncates the description of a Pull Request returned by the list API, with no
  // marker saying so. Everything sfdx-hardis reads from a description is then silently lost: the
  // promotionPullRequests declaration of a promotion branch, the deploymentApexTestClasses blocks,
  // the custom behavior keywords. The single Pull Request API returns the whole description, so it
  // is read again for every listed Pull Request whose description is long enough to have been cut.
  private static readonly LIST_DESCRIPTION_TRUNCATION_LENGTH = 400;

  private async completeTruncatedDescription(azureGitApi: any, pullRequest: GitPullRequest): Promise<GitPullRequest> {
    const listedDescription = pullRequest.description || "";
    if (listedDescription.length < AzureDevopsProvider.LIST_DESCRIPTION_TRUNCATION_LENGTH) {
      return pullRequest;
    }
    // One API call per Pull Request whose description was cut adds up fast on a repository with a
    // long history, and the description of a merged or abandoned Pull Request no longer moves. The
    // cache is keyed on the state seen right now, so a reopened Pull Request is read again.
    const repositoryKey = await this.pullRequestCacheRepositoryKey();
    const cached = await getCachedPullRequestDescription(
      "azure",
      repositoryKey,
      pullRequest.pullRequestId || 0,
      pullRequest.status,
    );
    if (cached !== null) {
      return Object.assign({}, pullRequest, { description: cached });
    }
    try {
      const fullPullRequest = await azureGitApi.getPullRequestById(pullRequest.pullRequestId);
      const fullDescription = fullPullRequest?.description || "";
      if (fullDescription.length > listedDescription.length) {
        await setCachedPullRequestDescription(
          "azure",
          repositoryKey,
          pullRequest.pullRequestId || 0,
          pullRequest.status,
          fullDescription,
        );
        return Object.assign({}, pullRequest, { description: fullDescription });
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(`[Azure Integration] Unable to read the full description of Pull Request ${pullRequest.pullRequestId}: ${(e as Error).message}`));
    }
    return pullRequest;
  }

  // Identifies the repository the cached descriptions belong to, from the git remote of the working
  // copy: that is the identifier vscode-sfdx-hardis agrees on, so the two share one cache. Read
  // once per process, since it costs a git call.
  private cachedRepositoryKey: string | null = null;

  private async pullRequestCacheRepositoryKey(): Promise<string> {
    if (this.cachedRepositoryKey === null) {
      this.cachedRepositoryKey = repositoryKeyFromRemoteUrl(this.otherRepository ? this.otherRepository.remoteUrl : (await getGitRepoUrl()) || "");
    }
    return this.cachedRepositoryKey;
  }

  private completePullRequestInfo(prData: GitPullRequest): CommonPullRequestInfo {
    const prInfo: CommonPullRequestInfo = {
      idNumber: prData.pullRequestId || 0,
      idStr: String(prData.pullRequestId || 0),
      sourceBranch: (prData.sourceRefName || "").replace("refs/heads/", ""),
      targetBranch: (prData.targetRefName || "").replace("refs/heads/", ""),
      title: prData.title || "",
      description: prData.description || "",
      webUrl: this.buildPullRequestWebUrl(prData.pullRequestId),
      authorName: prData?.createdBy?.displayName || "",
      createdDate: prData?.creationDate ? new Date(prData.creationDate).toISOString() : undefined,
      // Azure has no dedicated merge date: closedDate of a completed PR is its merge time
      mergedDate: prData?.closedDate ? new Date(prData.closedDate).toISOString() : undefined,
      mergeCommitSha: prData?.lastMergeCommit?.commitId || undefined,
      isDraft: prData?.isDraft === true,
      providerInfo: prData,
      customBehaviors: {}
    };
    return this.completeWithCustomBehaviors(prInfo);
  }

  private getPipelineVariablesConfig() {
    return `
    SFDX_DEPLOY_WAIT_MINUTES: $(SFDX_DEPLOY_WAIT_MINUTES)
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
      uxLog("warning", this, c.yellow(`[GitProvider] Error while trying to post pull request message.\n${(e as Error).message}\n${(e as Error).stack}`));
      prResult = { posted: false, providerResult: { error: e } };
    }
    return prResult;
  }

  /**
   * Extracts the organization, project and repository from an Azure DevOps remote URL.
   *
   * Handles the three shapes a clone can produce - modern `dev.azure.com` (with or without the
   * `user@` prefix), legacy `*.visualstudio.com`, and SSH - and URL-decodes the project and
   * repository names, which are percent-encoded whenever they contain a space.
   *
   * Returns null when the URL belongs to another provider.
   */
  public static parseAzureRepoUrl(remoteUrl: string): {
    collectionUri: string;
    teamProject: string;
    repositoryId: string;
  } | null {
    if (remoteUrl.startsWith("https://")) {
      // https://dev.azure.com/{org}/{project}/_git/{repo}, optionally prefixed with {user}@
      const devAzureMatch = remoteUrl.match(/https:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?]+)/);
      if (devAzureMatch) {
        return {
          collectionUri: `https://dev.azure.com/${devAzureMatch[1]}/`,
          teamProject: decodeURIComponent(devAzureMatch[2]),
          repositoryId: decodeURIComponent(devAzureMatch[3]),
        };
      }

      // https://{org}.visualstudio.com/{project}/_git/{repo}
      const vsMatch = remoteUrl.match(/https:\/\/(?:[^@]+@)?([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/?]+)/);
      if (vsMatch) {
        return {
          collectionUri: `https://${vsMatch[1]}.visualstudio.com/`,
          teamProject: decodeURIComponent(vsMatch[2]),
          repositoryId: decodeURIComponent(vsMatch[3]),
        };
      }
    } else if (remoteUrl.startsWith("git@")) {
      // git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
      const sshMatch = remoteUrl.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/);
      if (sshMatch) {
        return {
          collectionUri: `https://dev.azure.com/${sshMatch[1]}/`,
          teamProject: decodeURIComponent(sshMatch[2]),
          repositoryId: decodeURIComponent(sshMatch[3]),
        };
      }
    }
    return null;
  }

  public async uploadImage(localImagePath: string): Promise<string | null> {
    try {
      // Upload the image to Azure DevOps
      const imageName = path.basename(localImagePath);
      const imageContent = fs.createReadStream(localImagePath);
      const witApi = await this.azureApi.getWorkItemTrackingApi();
      const attachment = await witApi.createAttachment(
        null, // Custom headers (usually null)
        imageContent, // File content
        imageName, // File name
        "simple",
        process.env.SYSTEM_TEAMPROJECT, // Project name
      );
      if (attachment && attachment.url) {
        uxLog("log", this, c.grey(`[Azure Integration] Image uploaded for comment: ${attachment.url}`));
        // Link attachment to work item
        const techWorkItemId = await this.findCreateAttachmentsWorkItemId();
        if (techWorkItemId) {
          await witApi.updateWorkItem(
            [],
            [
              {
                op: "add",
                path: "/relations/-",
                value: {
                  rel: "AttachedFile",
                  url: attachment.url,
                  attributes: {
                    comment: "Uploaded Flow Diff image, generated by sfdx-hardis"
                  }
                }
              }
            ],
            techWorkItemId,
            process.env.SYSTEM_TEAMPROJECT
          );
          uxLog("log", this, c.grey(`[Azure Integration] Attachment linked to work item ${techWorkItemId}`));
        }
        return attachment.url;
      }
      else {
        uxLog("warning", this, c.yellow(`[Azure Integration] Image uploaded but unable to get URL from response\n${JSON.stringify(attachment, null, 2)}`));
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(`[Azure Integration] Error while uploading image ${localImagePath}\n${(e as Error).message}`));
    }
    return null;
  }

  public async findCreateAttachmentsWorkItemId() {
    if (this.attachmentsWorkItemId) {
      return this.attachmentsWorkItemId;
    }
    const workItemId = process.env.AZURE_ATTACHMENTS_WORK_ITEM_ID;
    if (workItemId) {
      this.attachmentsWorkItemId = Number(workItemId);
      return this.attachmentsWorkItemId;
    }
    // Try to find the work item
    const witApi = await this.azureApi.getWorkItemTrackingApi();
    const wiql = {
      query: `
        SELECT [System.Id], [System.Title]
        FROM WorkItems
        WHERE [System.Title] = '${this.attachmentsWorkItemTitle}'
          AND [System.TeamProject] = '${process.env.SYSTEM_TEAMPROJECT}'
      `
    };
    const queryResult = await witApi.queryByWiql(wiql);
    const workItemIds = (queryResult.workItems || []).map(item => item.id);
    if (workItemIds.length > 0) {
      this.attachmentsWorkItemId = Number(workItemIds[0]);
      // Check the number of attached images: if too many, rename the work item with (full) then create a new one by cloning its parameters
      const workItem = await witApi.getWorkItem(this.attachmentsWorkItemId, undefined, undefined, 1); // WorkItemExpand.Relations = 1
      const attachedImages = (workItem.relations || []).filter(rel => rel.rel === "AttachedFile");
      if (attachedImages.length >= 90) {
        // Rename the work item
        const newTitle = this.attachmentsWorkItemTitle + " (full)";
        await witApi.updateWorkItem(
          [],
          [
            {
              op: "replace",
              path: "/fields/System.Title",
              value: newTitle
            }
          ],
          this.attachmentsWorkItemId,
          process.env.SYSTEM_TEAMPROJECT
        );
        uxLog("log", this, c.grey(`[Azure Integration] Renamed work item ${this.attachmentsWorkItemId} to '${newTitle}'`));

        // Create a new work item by cloning the old one's parameters
        const newWorkItem = await witApi.createWorkItem(
          [],
          [
            {
              op: "add",
              path: "/fields/System.Title",
              value: this.attachmentsWorkItemTitle
            },
            {
              op: "add",
              path: "/fields/System.WorkItemType",
              value: workItem.fields?.["System.WorkItemType"] || "Task"
            },
            {
              op: "add",
              path: "/fields/System.Description",
              value: "Technical work item used by sfdx-hardis to attach images for PR comments"
            }
          ],
          process.env.SYSTEM_TEAMPROJECT!,
          workItem.fields?.["System.WorkItemType"] || "Task"
        );

        if (newWorkItem && newWorkItem.id) {
          this.attachmentsWorkItemId = newWorkItem.id;
          uxLog("log", this, c.grey(`[Azure Integration] Created new technical work item ${this.attachmentsWorkItemId} (${this.attachmentsWorkItemTitle}) to store image attachments, previous one was full`));
        }
      } else {
        uxLog("log", this, c.grey(`[Azure Integration] Found existing technical work item ${this.attachmentsWorkItemId} (${this.attachmentsWorkItemTitle}) for storing image attachments`));
      }
      return this.attachmentsWorkItemId;
    }

    // No work item found, create a new one
    uxLog("log", this, c.grey(`[Azure Integration] No technical work item found with title '${this.attachmentsWorkItemTitle}' to store image attachments, attempting to create one automatically...`));
    try {
      const newWorkItem = await witApi.createWorkItem(
        [],
        [
          {
            op: "add",
            path: "/fields/System.Title",
            value: this.attachmentsWorkItemTitle
          },
          {
            op: "add",
            path: "/fields/System.WorkItemType",
            value: "Task"
          },
          {
            op: "add",
            path: "/fields/System.Description",
            value: "Technical work item used by sfdx-hardis to store image attachments for PR comments. This work item serves as a container for uploaded images and should not be deleted."
          }
        ],
        process.env.SYSTEM_TEAMPROJECT!,
        "Task"
      );

      if (newWorkItem && newWorkItem.id) {
        this.attachmentsWorkItemId = newWorkItem.id;
        uxLog("log", this, c.grey(`[Azure Integration] Successfully created technical work item ${this.attachmentsWorkItemId} (${this.attachmentsWorkItemTitle}) to store image attachments for PR comments`));
        return this.attachmentsWorkItemId;
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(`[Azure Integration] Failed to automatically create technical work item for storing image attachments: ${(e as Error).message}`));
      uxLog("warning", this, c.yellow(`[Azure Integration] Please manually create a work item (type: Task) with the exact title '${this.attachmentsWorkItemTitle}' in project '${process.env.SYSTEM_TEAMPROJECT}', or set the AZURE_ATTACHMENTS_WORK_ITEM_ID environment variable with an existing work item ID.`));
      uxLog("warning", this, c.yellow(`[Azure Integration] This work item is required as a container to store image attachments for Pull Request comments.`));
    }

    uxLog("error", this, c.yellow(`[Azure Integration] Unable to find or create technical work item for image attachments. Image uploads to PR comments will not work until this is resolved.`));
    return null;
  }

  public async createPullRequest(request: CreatePullRequestRequest): Promise<CreatePullRequestResult> {
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const teamProject = process.env.SYSTEM_TEAMPROJECT || null;
    if (!repositoryId || !teamProject) {
      uxLog("warning", this, c.yellow('[Azure Integration] ' + t('azureCannotCreatePrMissingRepoInfo')));
      return { created: false, pullRequestUrl: null, providerResult: { error: "Missing BUILD_REPOSITORY_ID or SYSTEM_TEAMPROJECT" } };
    }
    uxLog("log", this, c.grey('[Azure Integration] ' + t('azureCreatingPullRequest', { source: request.sourceBranch, target: request.targetBranch })));
    const azureGitApi = await this.azureApi.getGitApi();
    const prToCreate: GitPullRequest = {
      sourceRefName: `refs/heads/${request.sourceBranch}`,
      targetRefName: `refs/heads/${request.targetBranch}`,
      title: request.title,
      description: request.body,
    };
    const result = await azureGitApi.createPullRequest(prToCreate, repositoryId, teamProject);
    const pullRequestUrl = result?.pullRequestId ? this.pullRequestWebUrlFromApiResult(result, teamProject, repositoryId) : null;
    return {
      created: !!(result?.pullRequestId),
      pullRequestUrl,
      providerResult: result,
    };
  }

  public async findOpenPullRequest(sourceBranch: string, targetBranch: string): Promise<{ pullRequestUrl: string; id: any } | null> {
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const teamProject = process.env.SYSTEM_TEAMPROJECT || null;
    if (!repositoryId || !teamProject) return null;
    const azureGitApi = await this.azureApi.getGitApi();
    const prs = await azureGitApi.getPullRequests(repositoryId, {
      sourceRefName: `refs/heads/${sourceBranch}`,
      targetRefName: `refs/heads/${targetBranch}`,
      status: 1, // active
    }, teamProject);
    const pr = prs?.[0];
    if (!pr?.pullRequestId) return null;
    return { pullRequestUrl: this.pullRequestWebUrlFromApiResult(pr, teamProject, repositoryId), id: pr.pullRequestId };
  }

  // Web URL of a Pull Request returned by the API. The `url` property of the API result must not be
  // used: it is the REST URL of the Pull Request, which displays raw JSON when opened in a browser.
  private pullRequestWebUrlFromApiResult(pullRequest: GitPullRequest, teamProject: string, repositoryId: string): string {
    const repositoryWebUrl = pullRequest?.repository?.webUrl;
    if (repositoryWebUrl) {
      return `${repositoryWebUrl}/pullrequest/${pullRequest.pullRequestId}`;
    }
    // The repository GUID is accepted by the Azure DevOps UI when its name is unknown
    return `${this.serverUrl}${teamProject}/_git/${repositoryId}/pullrequest/${pullRequest.pullRequestId}`;
  }

  public async updatePullRequestDescription(id: any, title: string, body: string): Promise<void> {
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const teamProject = process.env.SYSTEM_TEAMPROJECT || null;
    if (!repositoryId || !teamProject) return;
    const azureGitApi = await this.azureApi.getGitApi();
    await azureGitApi.updatePullRequest({ title, description: body }, repositoryId, id, teamProject);
  }

  public async getPullRequestCommentByMarker(marker: string, prNumber?: number): Promise<string | null> {
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const pullRequestId = prNumber || Number(process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || '');
    if (!repositoryId || !pullRequestId) return null;
    const azureGitApi = await this.azureApi.getGitApi();
    const threads = await azureGitApi.getThreads(repositoryId, pullRequestId, azureTeamProject());
    // The newest version: the comment itself, or an update someone else answered in its thread
    return listMarkerCommentVersions(threads, marker)[0]?.text ?? null;
  }

  // Azure DevOps lets only the author of a comment, or a project administrator, edit it, and the
  // comment is most often written by the pipeline (its job token is the project build service). So a
  // writer first updates the version it owns, the newest first; when it owns none, it answers in
  // the thread with an update that carries the whole body, hidden under one visible line. Readers
  // take the newest version, and the next pipeline job, which reads it too, brings the comment
  // itself up to date.
  public async upsertPullRequestCommentByMarker(marker: string, body: string, prNumber?: number): Promise<boolean> {
    body = this.enforceHardCommentLimit(toAzureDevopsWording(body));
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const pullRequestId = prNumber || Number(process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || '');
    if (!repositoryId || !pullRequestId) return false;
    const azureGitApi = await this.azureApi.getGitApi();
    const threads = await azureGitApi.getThreads(repositoryId, pullRequestId, azureTeamProject());
    const versions = listMarkerCommentVersions(threads, marker);
    if (versions.length === 0) {
      const newThread: GitPullRequestCommentThread = {
        comments: [{ content: body }],
        status: CommentThreadStatus.Unknown,
      };
      await azureGitApi.createThread(newThread, repositoryId, pullRequestId, azureTeamProject());
      uxLog("log", this, c.grey(`[Azure DevOps] Created Deployment Actions thread on PR #${pullRequestId}`));
      return true;
    }
    for (const version of versions) {
      if (!version.threadId || !version.commentId) continue;
      try {
        const content = version.isUpdateReply ? buildCommentUpdateReply(body) : body;
        await azureGitApi.updateComment({ content }, repositoryId, pullRequestId, version.threadId, version.commentId, azureTeamProject());
        uxLog("log", this, c.grey(`[Azure DevOps] Updated Deployment Actions thread comment on PR #${pullRequestId}`));
        return true;
      } catch (e) {
        if (!isNotCommentAuthorError(e)) {
          throw e;
        }
      }
    }
    await azureGitApi.createComment({ content: buildCommentUpdateReply(body) }, repositoryId, pullRequestId, versions[0].threadId, azureTeamProject());
    uxLog("log", this, c.grey(`[Azure DevOps] Answered the Deployment Actions thread of PR #${pullRequestId} with an update: its comment belongs to another identity`));
    return true;
  }

  public async listPullRequestCommentsByMarker(marker: string, prNumber?: number): Promise<PullRequestCommentRef[]> {
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const pullRequestId = prNumber || Number(process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || '');
    if (!repositoryId || !pullRequestId) return [];
    const azureGitApi = await this.azureApi.getGitApi();
    const threads = await azureGitApi.getThreads(repositoryId, pullRequestId, azureTeamProject());
    const results: PullRequestCommentRef[] = [];
    for (const thread of threads) {
      if (thread.isDeleted) continue;
      for (const comment of thread?.comments || []) {
        // getThreads still returns deleted comments inside live threads: a checkbox ticked in a
        // deleted comment must not be honored
        if (comment?.isDeleted) continue;
        // An update someone answered in a thread is a version of a comment already listed
        if (isCommentUpdateReply(comment?.content || '')) continue;
        if ((comment?.content || '').includes(marker)) {
          // The URL fragment scrolls the Azure DevOps UI to the comment itself: the anchor of a
          // comment is the Unix timestamp (in seconds) of its publication date
          const publishedEpochSeconds = comment.publishedDate
            ? Math.floor(new Date(comment.publishedDate).getTime() / 1000)
            : null;
          results.push({
            prNumber: pullRequestId,
            ref: { threadId: thread.id, commentId: comment.id },
            body: comment.content || '',
            url: `${this.buildPullRequestWebUrl(pullRequestId)}?_a=overview&discussionId=${thread.id}` +
              (publishedEpochSeconds ? `#${publishedEpochSeconds}` : ''),
            updatedAt: (comment.lastUpdatedDate || comment.publishedDate)
              ? new Date((comment.lastUpdatedDate || comment.publishedDate) as Date).toISOString()
              : '',
          });
        }
      }
    }
    return results;
  }

  public supportsJobArtifacts(): boolean {
    return true;
  }

  public async listJobArtifacts(jobUrl: string): Promise<JobArtifactsListing> {
    const build = this.parseOwnBuildUrl(jobUrl);
    const jobKey = `azure-build-${build.buildId}`;
    let found: any[] = [];
    try {
      const buildApi = await this.azureApi.getBuildApi();
      found = (await buildApi.getArtifacts(build.teamProject, build.buildId)) || [];
    } catch (e) {
      // A build deleted by the retention policy of the project answers 404
      if ((e as any)?.statusCode === 404) {
        return { status: 'expired', jobKey, artifacts: [] };
      }
      throw e;
    }
    for (const artifact of found) {
      if (artifact.resource?.downloadUrl) {
        this.artifactDownloadUrls.set(`${build.buildId}/${artifact.name}`, artifact.resource.downloadUrl);
      }
    }
    const artifacts: JobArtifact[] = found.map((artifact) => ({
      id: String(artifact.id),
      name: artifact.name || String(artifact.id),
      sizeBytes: parseInt(artifact.resource?.properties?.artifactsize || '0', 10) || 0,
      expired: false,
      // The id of a published artifact changes when it is published again
      updatedAt: String(artifact.id),
    }));
    return { status: artifacts.length === 0 ? 'none' : 'success', jobKey, artifacts };
  }

  public async downloadJobArtifact(jobUrl: string, artifact: JobArtifact, targetZipFile: string): Promise<void> {
    const build = this.parseOwnBuildUrl(jobUrl);
    // The download address the Build API gave for this artifact: a pipeline artifact is served by
    // another Azure DevOps service, which the zip endpoint of the Build API does not reach
    const downloadUrl = this.artifactDownloadUrls.get(`${build.buildId}/${artifact.name}`);
    if (!downloadUrl) {
      throw new SfError(t('jobArtifactsUrlNotRecognized', { jobUrl }));
    }
    const response = await this.azureApi.rest.client.get(downloadUrl);
    if (response.message.statusCode !== 200) {
      throw new SfError(`[Azure DevOps] Artifact ${artifact.name} download failed with status ${response.message.statusCode}`);
    }
    await fs.ensureDir(path.dirname(targetZipFile));
    await pipeline(response.message, fs.createWriteStream(targetZipFile));
  }

  public async updatePullRequestCommentByRef(commentRef: PullRequestCommentRef, body: string): Promise<void> {
    body = this.enforceHardCommentLimit(toAzureDevopsWording(body));
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    if (!repositoryId || !commentRef?.ref?.threadId || !commentRef?.ref?.commentId) return;
    const azureGitApi = await this.azureApi.getGitApi();
    await azureGitApi.updateComment({ content: body }, repositoryId, commentRef.prNumber, commentRef.ref.threadId, commentRef.ref.commentId, azureTeamProject());
    uxLog("log", this, c.grey('[Azure DevOps] ' + t('updatedPullRequestComment', { pr: commentRef.prNumber })));
  }

  // A build is what Azure DevOps lists, and sfdx-hardis installs one pipeline per yml file
  // (Deployment, DeploymentCheck, MegaLinter): the name of the pipeline says what the build does
  public async listCiRuns(filters: CiRunFilters): Promise<CommonCiRun[]> {
    const candidates: CiRunCandidate[] = [];
    if (filters.kinds.includes('deployment')) {
      for (const branch of filters.branches) {
        const builds = await this.listCompletedBuildsSince(filters.minDate, { branchName: `refs/heads/${branch}` });
        // A scheduled build of the branch deploys nothing new, and a Pull Request build is a check
        const pushBuilds = builds.filter((build) => AzureDevopsProvider.PUSH_BUILD_REASONS.includes(build.reason as BuildReason));
        candidates.push(...this.toCiRunCandidates(pushBuilds, 'push'));
      }
    }
    if (filters.kinds.includes('validation')) {
      const builds = await this.listCompletedBuildsSince(filters.minDate, { reasonFilter: BuildReason.PullRequest });
      candidates.push(...this.toCiRunCandidates(builds.filter((build) => build.reason === BuildReason.PullRequest), 'pullRequest'));
    }
    return selectCiRuns(await this.readOwnJobOfBuilds(candidates), filters.kinds);
  }

  // The build a job URL points to, refused when it is not a build of this project
  private parseOwnBuildUrl(jobUrl: string): { teamProject: string; buildId: number } {
    const build = parseAzureBuildUrl(jobUrl);
    const collectionUri = (this.serverUrl || "").replace(/\/$/, "").toLowerCase();
    const ownProject = (process.env.SYSTEM_TEAMPROJECT || "").toLowerCase();
    if (!build || !collectionUri || !ownProject || build.teamProject.toLowerCase() !== ownProject || !build.projectUrl.toLowerCase().startsWith(collectionUri + "/")) {
      throw new SfError(t('jobArtifactsUrlNotRecognized', { jobUrl }));
    }
    return { teamProject: build.teamProject, buildId: build.buildId };
  }

  private static readonly PUSH_BUILD_REASONS = [BuildReason.IndividualCI, BuildReason.BatchedCI, BuildReason.Manual];

  private static readonly BUILDS_PAGE_SIZE = 1000;

  private static readonly PULL_REQUESTS_PAGE_SIZE = 100;
  // Pull Request commits: the REST resource of getPullRequestCommits, read page by page
  private static readonly PULL_REQUEST_COMMITS_LOCATION_ID = "52823034-34a8-4576-922c-8d8b77e9e4c4";
  private static readonly PULL_REQUEST_COMMITS_PAGE_SIZE = 500;
  private static readonly PULL_REQUEST_COMMITS_MAX_PAGES = 20;

  // Build API getBuilds: the completed builds of this repository finished since minDate, oldest
  // first. azure-devops-node-api does not return the continuation token of the REST API (it comes
  // in a response header the client drops), so a full page is followed by the same query starting
  // at the finish time of its last build.
  private async listCompletedBuildsSince(minDate: Date, query: { branchName?: string; reasonFilter?: BuildReason }): Promise<Build[]> {
    const teamProject = this.teamProjectName;
    if (!teamProject) {
      throw new SfError("[Azure DevOps] " + t('gitProviderCiRunsRepositoryUnknown', { variables: "SYSTEM_TEAMPROJECT" }));
    }
    const repositoryGuid = await this.getRepositoryGuid();
    const buildApi = await this.azureApi.getBuildApi();
    const buildsById = new Map<number, Build>();
    let minTime = minDate;
    for (; ;) {
      const page = (await buildApi.getBuilds(
        teamProject,
        undefined, // definitions
        undefined, // queues
        undefined, // buildNumber
        minTime,
        undefined, // maxTime
        undefined, // requestedFor
        query.reasonFilter,
        BuildStatus.Completed,
        undefined, // resultFilter
        undefined, // tagFilters
        undefined, // properties
        AzureDevopsProvider.BUILDS_PAGE_SIZE,
        undefined, // continuationToken
        undefined, // maxBuildsPerDefinition
        undefined, // deletedFilter
        BuildQueryOrder.FinishTimeAscending,
        query.branchName,
        undefined, // buildIds
        repositoryGuid,
        "TfsGit",
      )) || [];
      const sizeBefore = buildsById.size;
      for (const build of page) {
        buildsById.set(build.id || 0, build);
      }
      const lastFinishTime = page.length > 0 ? page[page.length - 1].finishTime : undefined;
      // Nothing new means a whole page finished at the same instant: stop instead of asking it forever
      if (page.length < AzureDevopsProvider.BUILDS_PAGE_SIZE || !lastFinishTime || buildsById.size === sizeBefore) {
        break;
      }
      minTime = new Date(lastFinishTime);
    }
    return [...buildsById.values()];
  }

  // The Build API filters on the GUID of a repository. A pipeline job has it in BUILD_REPOSITORY_ID;
  // anywhere else only the name read from the git remote is known, and the Git API gives the GUID.
  private async getRepositoryGuid(): Promise<string> {
    if (this.resolvedRepositoryGuid === null) {
      const repositoryIdOrName = this.repositoryIdOrName;
      if (!repositoryIdOrName) {
        throw new SfError("[Azure DevOps] " + t('gitProviderCiRunsRepositoryUnknown', { variables: "BUILD_REPOSITORY_ID" }));
      }
      if (AZURE_GUID_REGEX.test(repositoryIdOrName)) {
        this.resolvedRepositoryGuid = repositoryIdOrName;
      } else {
        const azureGitApi = await this.azureApi.getGitApi();
        const repository = await azureGitApi.getRepository(repositoryIdOrName, this.teamProjectName || undefined);
        if (!repository?.id) {
          throw new SfError("[Azure DevOps] " + t('gitProviderRepositoryNotFound', { repository: repositoryIdOrName, project: this.teamProjectName || "" }));
        }
        this.resolvedRepositoryGuid = repository.id;
      }
    }
    return this.resolvedRepositoryGuid;
  }

  // The name of an Azure pipeline is whatever was typed when it was created, and a build can run
  // other jobs (MegaLinter next to the deployment check). What a build did is read from its own
  // job, named in the yml sfdx-hardis installs (Deployment, DeploymentCheck): one timeline call per
  // build. A build without such a job keeps the name and the result of its pipeline.
  private async readOwnJobOfBuilds(candidates: CiRunCandidate[]): Promise<CiRunCandidate[]> {
    if (candidates.length === 0) {
      return [];
    }
    const buildApi = await this.azureApi.getBuildApi();
    const teamProject = this.teamProjectName || "";
    const withJobs = await mapInAdaptiveBatches(candidates, async (candidate) => {
      const timeline = await buildApi.getBuildTimeline(teamProject, Number(candidate.id));
      const ownKind = candidate.trigger === 'pullRequest' ? 'validation' : 'deployment';
      const job = (timeline?.records || []).find((record) => record.type === 'Job' && classifyJobKind(record.name) === ownKind);
      if (!job) {
        return candidate;
      }
      const status = AzureDevopsProvider.toJobCiRunStatus(job.result);
      // The job was skipped: nothing was deployed nor checked
      if (!status) {
        return null;
      }
      return {
        ...candidate,
        name: job.name || candidate.name,
        status,
        startedAt: AzureDevopsProvider.toIsoDate(job.startTime) || candidate.startedAt,
        finishedAt: AzureDevopsProvider.toIsoDate(job.finishTime) || candidate.finishedAt,
      };
    }, { sizes: PROVIDER_BATCH_PROFILES.azure });
    return withJobs.filter((candidate): candidate is CiRunCandidate => candidate != null);
  }

  private toCiRunCandidates(builds: Build[], trigger: 'push' | 'pullRequest'): CiRunCandidate[] {
    const candidates: CiRunCandidate[] = [];
    for (const build of builds) {
      const status = AzureDevopsProvider.toCiRunStatus(build.result);
      if (!status) {
        continue;
      }
      const queuedAt = AzureDevopsProvider.toIsoDate(build.queueTime);
      candidates.push({
        id: String(build.id),
        name: build.definition?.name || '',
        trigger,
        branch: trigger === 'push'
          ? (build.sourceBranch || '').replace("refs/heads/", "")
          : AzureDevopsProvider.getBuildPullRequestBranch(build, 'target'),
        ...(trigger === 'pullRequest'
          ? { pullRequestId: AzureDevopsProvider.getBuildPullRequestId(build), sourceBranch: AzureDevopsProvider.getBuildPullRequestBranch(build, 'source') }
          : {}),
        status,
        queuedAt,
        startedAt: AzureDevopsProvider.toIsoDate(build.startTime) || queuedAt,
        finishedAt: AzureDevopsProvider.toIsoDate(build.finishTime),
        commitSha: build.sourceVersion || '',
        triggeredBy: build.requestedFor?.displayName || build.requestedBy?.displayName || '',
        webUrl: build._links?.web?.href || '',
      });
    }
    return candidates;
  }

  // A build without result, or with a result that is neither of these, deployed nothing and failed nothing
  private static toCiRunStatus(result: BuildResult | undefined): CiRunStatus | null {
    if (result === BuildResult.Succeeded || result === BuildResult.PartiallySucceeded) {
      return 'succeeded';
    }
    if (result === BuildResult.Failed) {
      return 'failed';
    }
    if (result === BuildResult.Canceled) {
      return 'canceled';
    }
    return null;
  }

  private static toJobCiRunStatus(result: TaskResult | undefined): CiRunStatus | null {
    if (result === TaskResult.Succeeded || result === TaskResult.SucceededWithIssues) {
      return 'succeeded';
    }
    if (result === TaskResult.Failed) {
      return 'failed';
    }
    if (result === TaskResult.Canceled) {
      return 'canceled';
    }
    return null;
  }

  // The source or the target branch of the Pull Request a build checks. Azure Repos writes them in
  // the parameters of the build (a JSON string), other triggers in triggerInfo
  private static getBuildPullRequestBranch(build: Build, side: 'source' | 'target'): string {
    let parameters: any = {};
    try {
      parameters = JSON.parse(build.parameters || '{}');
    } catch {
      // Parameters that are not JSON say nothing about the Pull Request
    }
    const branch = parameters?.[`system.pullRequest.${side}Branch`] || build.triggerInfo?.[`pr.${side}Branch`] || '';
    return String(branch).replace("refs/heads/", "");
  }

  // The number of the Pull Request a build checks: told by the trigger, else read from the
  // refs/pull/<id>/merge branch the build ran on
  private static getBuildPullRequestId(build: Build): string {
    return build.triggerInfo?.['pr.number'] || (build.sourceBranch || '').match(/^refs\/pull\/(\d+)\//)?.[1] || '';
  }

  private static toIsoDate(date: Date | string | undefined): string {
    if (!date) {
      return '';
    }
    const parsed = new Date(date);
    return isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }

  // Team project and repository of this provider: the ones of the repository it was built for,
  // else the ones of the CI context, read when asked since they can be set after the constructor
  private get teamProjectName(): string | null {
    return this.otherRepository ? this.otherRepository.teamProject : process.env.SYSTEM_TEAMPROJECT || null;
  }

  // A GUID in a pipeline job, the name of the repository anywhere else
  private get repositoryIdOrName(): string | null {
    return this.otherRepository ? this.otherRepository.repositoryName : process.env.BUILD_REPOSITORY_ID || null;
  }
}

const AZURE_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The team project of the repository. In an Azure Pipelines job BUILD_REPOSITORY_ID is a GUID and
// the API needs nothing else; outside CI (VS Code, a terminal) it is the repository name read from
// the git remote, and the API then refuses the call without the project ("A project name is
// required in order to reference a Git repository by name").
// A GUID needs no project, and must not get one: a pipeline of a team project can build a repository
// of another, and SYSTEM_TEAMPROJECT is then the project of the pipeline, not of the repository.
function azureTeamProject(): string | undefined {
  const repositoryId = process.env.BUILD_REPOSITORY_ID || "";
  if (AZURE_GUID_REGEX.test(repositoryId)) {
    return undefined;
  }
  return process.env.SYSTEM_TEAMPROJECT || undefined;
}

// What an identity that does not own a comment answers in its thread: one line a reader sees, and
// the whole new body of the comment, hidden, for sfdx-hardis to read.
const COMMENT_UPDATE_REPLY_REGEX = /<!-- hardis-comment-update ([A-Za-z0-9_-]+) -->/;

function buildCommentUpdateReply(body: string): string {
  const when = new Date().toISOString().replace('T', ' ').substring(0, 16);
  return [
    `🔄 **Updated outside the pipeline on ${when} UTC**, from VS Code or the command line. sfdx-hardis reads this update, and the next pipeline job brings the comment above up to date.`,
    '',
    `<!-- hardis-comment-update ${Buffer.from(body, 'utf8').toString('base64url')} -->`,
  ].join('\n');
}

function isCommentUpdateReply(content: string): boolean {
  return COMMENT_UPDATE_REPLY_REGEX.test(content);
}

// The versions of the comment holding a marker, newest first: the comment itself and the updates
// answered in its thread, each with the body it stands for.
function listMarkerCommentVersions(
  threads: GitPullRequestCommentThread[],
  marker: string,
): { threadId: number; commentId: number; text: string; isUpdateReply: boolean; time: number }[] {
  const versions: { threadId: number; commentId: number; text: string; isUpdateReply: boolean; time: number }[] = [];
  for (const thread of threads || []) {
    if (thread.isDeleted) continue;
    for (const comment of thread?.comments || []) {
      // Never read or update a deleted comment: getThreads returns them inside live threads
      if (comment?.isDeleted) continue;
      const content = comment.content || '';
      const encoded = content.match(COMMENT_UPDATE_REPLY_REGEX)?.[1];
      const text = encoded ? Buffer.from(encoded, 'base64url').toString('utf8') : content;
      if (!text.includes(marker)) continue;
      const date = comment.lastUpdatedDate || comment.publishedDate;
      versions.push({ threadId: thread.id || 0, commentId: comment.id || 0, text, isUpdateReply: !!encoded, time: date ? new Date(date).getTime() : 0 });
    }
  }
  // Newest first; the order of the API (oldest first) is kept between versions of the same time
  return versions.map((version, index) => ({ version, index })).sort((a, b) => b.version.time - a.version.time || a.index - b.index).map((item) => item.version);
}

// "Cannot update comment. Only the comment author and project admins can edit a comment."
function isNotCommentAuthorError(error: unknown): boolean {
  const failure = error as { statusCode?: number; message?: string; result?: { typeKey?: string } };
  return (
    failure?.statusCode === 403 ||
    failure?.result?.typeKey === 'GitPullRequestCommentCannotBeUpdatedException' ||
    /only the comment author/i.test(failure?.message || '')
  );
}
