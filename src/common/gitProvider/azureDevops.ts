import { GitProviderRoot, PullRequestCommentRef } from "./gitProviderRoot.js";
import * as azdev from "azure-devops-node-api";
import c from "chalk";
import fs from '../utils/fsUtils.js';
import { getCurrentGitBranch, getGitRepoUrl, git, isGitRepo, uxLog } from "../utils/index.js";
import * as path from "path";
import { CommonPullRequestInfo, CreatePullRequestRequest, CreatePullRequestResult, PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
import { CommentThreadStatus, GitPullRequest, GitPullRequestCommentThread, GitPullRequestSearchCriteria, PullRequestAsyncStatus, PullRequestStatus } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { CONSTANTS, getBannerMarkdownAndLink, getEnvVar } from "../../config/index.js";
import { getPrCommentKind, getPrCommentKindFromMessageKey } from "./prCommentNav.js";
import { SfError } from "@salesforce/core";
import { prompts } from "../utils/prompts.js";
import { t } from '../utils/i18n.js';
import { isJenkins, getJenkinsBranchName, getJenkinsPrNumber, getJenkinsBuildNumber, getJenkinsJobName, getJenkinsJobUrl } from "./jenkinsUtils.js";

export class AzureDevopsProvider extends GitProviderRoot {
  private azureApi: InstanceType<typeof azdev.WebApi>;
  public serverUrl: string;
  public token: string;
  public attachmentsWorkItemId: number;
  public attachmentsWorkItemTitle: string = process.env.AZURE_ATTACHMENTS_WORK_ITEM_TITLE || 'sfdx-hardis tech attachments'

  constructor() {
    super();
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

  public getLabel(): string {
    return "sfdx-hardis Azure Devops connector";
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
        const pullRequestWorkItemRefs = await azureGitApi.getPullRequestWorkItemRefs(repositoryId || "", pullRequestId);
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
    });
    const latestMergedPullRequestOnBranch = latestPullRequestsOnBranch.filter(
      (pr) => pr.mergeStatus === PullRequestAsyncStatus.Succeeded && this.isPullRequestMatchingCommit(pr, sha),
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
    uxLog("log", this, c.grey('[Azure Integration] ' + t('azureIntegrationUnableToFindPrInfo')));
    return null;
  }

  public async listPullRequests(filters: {
    status?: string,
    pullRequestStatus?: "open" | "merged" | "abandoned",
    targetBranch?: string,
    minDate?: Date
  } = {}): Promise<CommonPullRequestInfo[] | null> {
    // Get Azure Git API
    const azureGitApi = await this.azureApi.getGitApi();
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    if (repositoryId == null) {
      uxLog("warning", this, c.yellow('[Azure Integration] ' + t('azureIntegrationNoBuildRepositoryId')));
      return [];
    }
    const teamProject = process.env.SYSTEM_TEAMPROJECT || null;
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
    }
    // Process request
    uxLog("action", this, c.cyan(t('callingAzureApiToListPullRequests')));
    uxLog("log", this, c.grey(t('constraint', { JSON: JSON.stringify(queryConstraint, null, 2) })));

    // List pull requests
    const pullRequests = await azureGitApi.getPullRequests(repositoryId, queryConstraint, teamProject);
    // Complete results with PR comments (stored in providerInfo)
    const results: CommonPullRequestInfo[] = [];
    for (const pullRequest of pullRequests) {
      const pr: GitPullRequest & { threads?: any[] } = Object.assign({}, pullRequest);
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
    });
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
    const existingThreads = await azureGitApi.getThreads(repositoryId, latestPullRequestId);
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
    const prPromises = allBranches.map(async (branchName) => {
      try {
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
      } catch (err) {
        uxLog(
          "warning",
          this,
          c.yellow(`Error fetching completed PRs for branch ${branchName}: ${String(err)}`),
        );
        return [];
      }
    });

    const prResults = await Promise.all(prPromises);
    const allMergedPRs: any[] = prResults.flat();

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
    return Array.from(uniquePRsMap.values()).map((pr) => this.completePullRequestInfo(pr));
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
    const messageKey = prMessage.messageKey + "-" + azureJobName + "-" + pullRequestId;
    let messageBody = `${this.buildPrCommentBodyHeader(prMessage)}${prMessage.message}

<br/>

_Powered by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) from job [${azureJobName}](${azureBuildUri})_

${getBannerMarkdownAndLink()}

<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId && prMessage.skipDeploymentIdMarker !== true) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }
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
    const existingThreads = await azureGitApi.getThreads(repositoryId, pullRequestId);
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
      await azureGitApi.updateComment({ content: messageBody }, repositoryId, pullRequestId, existingThreadId, existingThreadCommentId);
      await azureGitApi.updateThread(
        { status: this.pullRequestStatusToAzureThreadStatus(prMessage) },
        repositoryId,
        pullRequestId,
        existingThreadId,
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
    const azureEditThreadResult = await azureGitApi.createThread(newThreadComment, repositoryId, pullRequestId);
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
    const repositoryName = process.env.BUILD_REPOSITORY_NAME || process.env.BUILD_REPOSITORYNAME || "";
    return `${process.env.SYSTEM_COLLECTIONURI}${encodeURIComponent(
      process.env.SYSTEM_TEAMPROJECT || "",
    )}/_git/${encodeURIComponent(repositoryName)}/pullrequest/${pullRequestId}`;
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
    const threads = await azureGitApi.getThreads(repositoryId, pullRequestId);
    for (const thread of threads) {
      if (thread.isDeleted) continue;
      for (const comment of thread?.comments || []) {
        if ((comment?.content || '').includes(marker)) {
          return comment.content || null;
        }
      }
    }
    return null;
  }

  public async upsertPullRequestCommentByMarker(marker: string, body: string, prNumber?: number): Promise<void> {
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const pullRequestId = prNumber || Number(process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || '');
    if (!repositoryId || !pullRequestId) return;
    const azureGitApi = await this.azureApi.getGitApi();
    const threads = await azureGitApi.getThreads(repositoryId, pullRequestId);
    let existingThreadId: number | null = null;
    let existingCommentId: number | null = null;
    for (const thread of threads) {
      if (thread.isDeleted) continue;
      for (const comment of thread?.comments || []) {
        // Never update a deleted comment: getThreads returns them inside live threads
        if (comment?.isDeleted) continue;
        if ((comment?.content || '').includes(marker)) {
          existingThreadId = thread.id || null;
          existingCommentId = comment.id || null;
          break;
        }
      }
      if (existingThreadId) break;
    }
    if (existingThreadId && existingCommentId) {
      await azureGitApi.updateComment({ content: body }, repositoryId, pullRequestId, existingThreadId, existingCommentId);
      uxLog("log", this, c.grey(`[Azure DevOps] Updated Deployment Actions thread comment on PR #${pullRequestId}`));
    } else {
      const newThread: GitPullRequestCommentThread = {
        comments: [{ content: body }],
        status: CommentThreadStatus.Unknown,
      };
      await azureGitApi.createThread(newThread, repositoryId, pullRequestId);
      uxLog("log", this, c.grey(`[Azure DevOps] Created Deployment Actions thread on PR #${pullRequestId}`));
    }
  }

  public async listPullRequestCommentsByMarker(marker: string, prNumber?: number): Promise<PullRequestCommentRef[]> {
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    const pullRequestId = prNumber || Number(process.env.SYSTEM_PULLREQUEST_PULLREQUESTID || '');
    if (!repositoryId || !pullRequestId) return [];
    const azureGitApi = await this.azureApi.getGitApi();
    const threads = await azureGitApi.getThreads(repositoryId, pullRequestId);
    const results: PullRequestCommentRef[] = [];
    for (const thread of threads) {
      if (thread.isDeleted) continue;
      for (const comment of thread?.comments || []) {
        // getThreads still returns deleted comments inside live threads: a checkbox ticked in a
        // deleted comment must not be honored
        if (comment?.isDeleted) continue;
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
          });
        }
      }
    }
    return results;
  }

  public async updatePullRequestCommentByRef(commentRef: PullRequestCommentRef, body: string): Promise<void> {
    const repositoryId = process.env.BUILD_REPOSITORY_ID || null;
    if (!repositoryId || !commentRef?.ref?.threadId || !commentRef?.ref?.commentId) return;
    const azureGitApi = await this.azureApi.getGitApi();
    await azureGitApi.updateComment({ content: body }, repositoryId, commentRef.prNumber, commentRef.ref.threadId, commentRef.ref.commentId);
    uxLog("log", this, c.grey('[Azure DevOps] ' + t('updatedPullRequestComment', { pr: commentRef.prNumber })));
  }
}
