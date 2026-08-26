import { Gitlab } from "@gitbeaker/rest";
import c from "chalk";
import { Agent as HttpsAgent } from "https";
import { CommonPullRequestInfo, CreatePullRequestRequest, CreatePullRequestResult, PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
import { getCurrentGitBranch, git, uxLog } from "../utils/index.js";
import { GitProviderRoot, PullRequestCommentRef, getOldestCommitDateWithMargin } from "./gitProviderRoot.js";
import { CONSTANTS, getBannerMarkdownAndLink } from "../../config/index.js";
import { t } from '../utils/i18n.js';
import { isJenkins, getJenkinsBranchName, getJenkinsPrNumber, getJenkinsJobUrl, getJenkinsJobName } from "./jenkinsUtils.js";

// Oldest commit date of a window, used to bound the merged MRs listing (see
// getOldestCommitDateWithMargin in gitProviderRoot.ts).
function getOldestCommitDate(commits: any[]): string | null {
  return getOldestCommitDateWithMargin(commits, (commit) => commit?.created_at || commit?.createdAt);
}

export class GitlabProvider extends GitProviderRoot {
  private gitlabApi: InstanceType<typeof Gitlab>;
  private mergeRequestWebUrls: { [key: string]: string } = {};
  public serverUrl: string;
  public token: string;

  constructor() {
    super();
    // Gitlab URL is always provided by default CI variables
    this.serverUrl = process.env.CI_SERVER_URL || "";
    // It's better to have a project token defined in a CI_SFDX_HARDIS_GITLAB_TOKEN variable, to have the rights to act on Pull Requests
    this.token = process.env.CI_SFDX_HARDIS_GITLAB_TOKEN || process.env.ACCESS_TOKEN || "";
    const gitlabConfig: ConstructorParameters<typeof Gitlab>[0] = {
      host: this.serverUrl,
      token: this.token,
    };

    if (process.env.GITLAB_API_REJECT_UNAUTHORIZED === "false") {
      gitlabConfig.agent = new HttpsAgent({ rejectUnauthorized: false });
    }

    this.gitlabApi = new Gitlab(gitlabConfig);
  }

  // Auto-detect GitLab CI variables from token + local git remote URL
  public static async autoDetectSettings(): Promise<void> {
    try {
      const remoteUrl = (await git().getConfig("remote.origin.url"))?.value || "";
      if (!remoteUrl) {
        uxLog("log", GitlabProvider, c.grey("[GitLab] " + t("autoDetectProviderNoGitRemote", { provider: "GitLab" })));
        return;
      }
      const parsed = GitlabProvider.parseGitlabRepoUrl(remoteUrl);
      if (!parsed) {
        uxLog("log", GitlabProvider, c.grey("[GitLab] " + t("autoDetectProviderParseUrlFailed", { provider: "GitLab" })));
        return;
      }
      // Set CI_SERVER_URL if missing
      if (!process.env.CI_SERVER_URL) {
        process.env.CI_SERVER_URL = parsed.serverUrl;
      }
      // Set CI_PROJECT_PATH if missing
      if (!process.env.CI_PROJECT_PATH) {
        process.env.CI_PROJECT_PATH = parsed.projectPath;
      }
      // Try to resolve project ID via API if missing
      if (!process.env.CI_PROJECT_ID) {
        const token = process.env.CI_SFDX_HARDIS_GITLAB_TOKEN || process.env.ACCESS_TOKEN || "";
        if (token) {
          try {
            const gitlabConfig: ConstructorParameters<typeof Gitlab>[0] = {
              host: parsed.serverUrl,
              token,
            };
            if (process.env.GITLAB_API_REJECT_UNAUTHORIZED === "false") {
              gitlabConfig.agent = new HttpsAgent({ rejectUnauthorized: false });
            }
            const tempApi = new Gitlab(gitlabConfig);
            const project = await tempApi.Projects.show(parsed.projectPath);
            if (project?.id) {
              process.env.CI_PROJECT_ID = String(project.id);
            }
          } catch (apiErr) {
            uxLog("log", GitlabProvider, c.grey("[GitLab] " + t("autoDetectProviderApiError", { provider: "GitLab", message: (apiErr as Error).message })));
          }
        }
      }
      // When running on Jenkins, map Jenkins-specific variables to GitLab equivalents
      if (isJenkins()) {
        if (!process.env.CI_COMMIT_REF_NAME) {
          const branch = getJenkinsBranchName();
          if (branch) {
            process.env.CI_COMMIT_REF_NAME = branch;
          }
        }
        if (!process.env.CI_JOB_URL) {
          const jobUrl = getJenkinsJobUrl();
          if (jobUrl) {
            process.env.CI_JOB_URL = jobUrl;
          }
        }
        if (!process.env.CI_JOB_NAME) {
          const jobName = getJenkinsJobName();
          if (jobName) {
            process.env.CI_JOB_NAME = jobName;
          }
        }
        if (!process.env.CI_MERGE_REQUEST_IID) {
          const prNumber = getJenkinsPrNumber();
          if (prNumber) {
            process.env.CI_MERGE_REQUEST_IID = prNumber;
          }
        }
        if (!process.env.CI_PROJECT_URL && process.env.CI_SERVER_URL && process.env.CI_PROJECT_PATH) {
          process.env.CI_PROJECT_URL = `${process.env.CI_SERVER_URL}/${process.env.CI_PROJECT_PATH}`;
        }
        uxLog("log", GitlabProvider, c.grey("[GitLab] " + t("autoDetectProviderJenkinsMapping", { provider: "GitLab" })));
      }
      /* Only log the success summary when Jenkins is involved - on native CI providers this is just noise */
      if (isJenkins()) {
        uxLog("log", GitlabProvider, c.grey("[GitLab] " + t("autoDetectProviderSuccess", {
          provider: "GitLab",
          details: `server=${process.env.CI_SERVER_URL}, project=${process.env.CI_PROJECT_ID || process.env.CI_PROJECT_PATH || "unknown"}`,
        })));
      }
    } catch (e) {
      uxLog("warning", GitlabProvider, c.yellow("[GitLab] " + t("autoDetectProviderFailed", { provider: "GitLab", message: (e as Error).message })));
    }
  }

  public static parseGitlabRepoUrl(remoteUrl: string): { serverUrl: string; projectPath: string } | null {
    // HTTPS: https://gitlab.com/group/project.git or https://self-hosted.com/group/subgroup/project.git
    if (remoteUrl.startsWith("https://") || remoteUrl.startsWith("http://")) {
      const url = remoteUrl.replace(/\.git$/, "").replace(/\/$/,"");
      // Remove credentials (e.g. https://user:pass@gitlab.com/...)
      const cleanUrl = url.replace(/\/\/([^@/]+@)/gm, "//");
      const match = cleanUrl.match(/^(https?:\/\/[^/]+)\/(.+)$/);
      if (match) {
        return { serverUrl: match[1], projectPath: match[2] };
      }
    }
    // SSH: git@gitlab.com:group/project.git
    if (remoteUrl.startsWith("git@")) {
      const match = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
      if (match) {
        return { serverUrl: `https://${match[1]}`, projectPath: match[2] };
      }
    }
    // SSH: ssh://git@gitlab.com/group/project.git
    if (remoteUrl.startsWith("ssh://")) {
      const match = remoteUrl.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
      if (match) {
        return { serverUrl: `https://${match[1]}`, projectPath: match[2] };
      }
    }
    return null;
  }

  public getLabel(): string {
    return "sfdx-hardis Gitlab connector";
  }

  public logAutoFixRemediation(step: "push" | "pr-create"): void {
    const stepLabel = step === "push" ? "git push" : "merge request creation";
    uxLog("log", this, `\n[sfdx-hardis] Auto-fix ${stepLabel} remediation guide (gitlab)`);
    uxLog("log", this, "1) Update workflow: before auto-fix, configure git remote with a write token.");
    uxLog("log", this, "   Example: git remote set-url origin https://oauth2:${CI_SFDX_HARDIS_GITLAB_TOKEN}@<gitlab-host>/<group>/<repo>.git");
    uxLog("log", this, "2) Set variable: CI_SFDX_HARDIS_GITLAB_TOKEN");
    uxLog("log", this, "3) How to get value: GitLab Project -> Settings -> Access Tokens -> create Project Access Token with role Developer (or Maintainer), scopes api + write_repository. Store it as a masked CI/CD variable.");
  }

  // Returns current job URL
  public async getCurrentJobUrl(): Promise<string | null> {
    if (process.env.PIPELINE_JOB_URL) {
      return process.env.PIPELINE_JOB_URL;
    }
    if (process.env.CI_JOB_URL) {
      return process.env.CI_JOB_URL;
    }
    // Jenkins fallback
    const jenkinsUrl = getJenkinsJobUrl();
    if (jenkinsUrl) {
      return jenkinsUrl;
    }
    return null;
  }

  // Returns current job URL
  public async getCurrentBranchUrl(): Promise<string | null> {
    if (process.env.CI_PROJECT_URL && process.env.CI_COMMIT_REF_NAME) return `${process.env.CI_PROJECT_URL}/-/tree/${process.env.CI_COMMIT_REF_NAME}`;
    return null;
  }

  // Gitlab supports mermaid in PR markdown
  public async supportsMermaidInPrMarkdown(): Promise<boolean> {
    return true;
  }

  // Find pull request info
  public async getPullRequestInfo(): Promise<CommonPullRequestInfo | null> {
    // Case when MR is found in the context
    const projectId = process.env.CI_PROJECT_ID || null;
    const mrNumber = process.env.CI_MERGE_REQUEST_IID || null;
    if (mrNumber !== null) {
      const mergeRequests = await this.gitlabApi.MergeRequests.all({
        projectId: projectId || "",
        iids: [parseInt(mrNumber)],
      });
      if (mergeRequests.length > 0) {
        const mergeRequest = mergeRequests[0];
        return this.completePullRequestInfo(mergeRequest);
      }
    }
    // Case when we find MR from a commit
    const sha = await git().revparse(["HEAD"]);
    // Fetch recent merged MRs and pick the one whose merge commit SHA matches the current HEAD
    let allMergedMRs: any[] = [];
    try {
      // Prefer the commit-level endpoint (more efficient) if available:
      // GET /projects/:id/repository/commits/:sha/merge_requests
      // This returns merge requests related to the commit directly.
      try {
        const commitMrs = await this.gitlabApi.Commits.allMergeRequests(projectId || "", sha);
        if (Array.isArray(commitMrs) && commitMrs.length > 0) {
          allMergedMRs = commitMrs;
        }
      } catch (err) {
        // Some GitLab instances or gitbeaker versions may not expose this helper -> fall back below
        uxLog(
          "log",
          this,
          c.grey(`[Gitlab Integration] Commit-level MR lookup not available or failed: ${String(err)}. Falling back to filtered MR list.`),
        );
      }

      // Fallback: fetch merged MRs but narrow the scope to be performant
      if (allMergedMRs.length === 0) {
        // try to limit by the current branch (CI variable or local git)
        const currentBranch = process.env.CI_COMMIT_REF_NAME || (await getCurrentGitBranch());
        allMergedMRs = await this.gitlabApi.MergeRequests.all({
          projectId: projectId || "",
          state: "merged",
          // prefer filtering by targetBranch to reduce results; if unknown, omit the filter
          ...(currentBranch ? { targetBranch: currentBranch } : {}),
          orderBy: "updated_at",
          sort: "desc",
          perPage: 100,
          maxPages: 1,
        });
      }
    } catch (err) {
      uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabErrorFetchingMergedMrs', { message: String(err) })));
      // as a last resort try a small unfiltered query to avoid huge responses
      try {
        allMergedMRs = await this.gitlabApi.MergeRequests.all({
          projectId: projectId || "",
          state: "merged",
          perPage: 10,
          maxPages: 1,
          orderBy: "updated_at",
          sort: "desc",
        });
      } catch (innerErr) {
        uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabFallbackQueryFailed', { message: String(innerErr) })));
        allMergedMRs = [];
      }
    }

    const matchedMr = allMergedMRs.find((mr: any) => {
      const mergeSha = mr.mergeCommitSha || mr.merge_commit_sha;
      return mergeSha === sha;
    });

    const latestMergeRequestsOnBranch = matchedMr ? [matchedMr] : [];
    if (latestMergeRequestsOnBranch.length > 0) {
      const currentGitBranch = await getCurrentGitBranch();
      const candidateMergeRequests = latestMergeRequestsOnBranch.filter((pr) => pr.target_branch === currentGitBranch);
      if (candidateMergeRequests.length > 0) {
        return this.completePullRequestInfo(candidateMergeRequests[0]);
      }
    }
    uxLog("log", this, c.grey('[Gitlab Integration] ' + t('gitlabUnableToFindMrInfo')));
    return null;
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string | null> {
    let deploymentCheckId: string | null = null;
    const projectId = process.env.CI_PROJECT_ID || null;
    const latestMergeRequestsOnBranch = await this.gitlabApi.MergeRequests.all({
      projectId: projectId || "",
      state: "merged",
      sort: "desc",
      targetBranch: gitBranch,
    });
    if (latestMergeRequestsOnBranch.length > 0) {
      // Select the MR whose merge commit matches the commit currently being deployed (HEAD).
      // When several MRs are merged around the same time, the most recently merged MR is not
      // necessarily the one that produced this build's commit. Using its validation id would make
      // QuickDeploy reuse an unrelated MR's deployment and deploy the wrong metadata.
      const sha = await git().revparse(["HEAD"]);
      const matchingMergeRequest = latestMergeRequestsOnBranch.find((mr) => this.isMergeRequestMatchingCommit(mr, sha)) || null;
      if (matchingMergeRequest == null) {
        uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('noPrMatchingDeployedCommit', { sha })));
        return null;
      }
      deploymentCheckId = await this.getDeploymentIdFromPullRequest(projectId || "", matchingMergeRequest.iid, deploymentCheckId, this.completePullRequestInfo(matchingMergeRequest));
    }
    return deploymentCheckId;
  }

  private isMergeRequestMatchingCommit(mr: any, sha: string): boolean {
    // GitLab exposes the resulting target-branch commit in merge_commit_sha (merge) or squash_commit_sha (squash).
    return (mr?.mergeCommitSha || mr?.merge_commit_sha) === sha || (mr?.squashCommitSha || mr?.squash_commit_sha) === sha;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string | null> {
    const pullRequestInfo = await this.getPullRequestInfo();
    if (pullRequestInfo) {
      const projectId = process.env.CI_PROJECT_ID || null;
      return await this.getDeploymentIdFromPullRequest(projectId || "", pullRequestInfo.idNumber, null, pullRequestInfo);
    }
    return null;
  }

  private async getDeploymentIdFromPullRequest(projectId: string, latestMergeRequestId: number, deploymentCheckId: string | null, latestMergeRequest: CommonPullRequestInfo): Promise<string | null> {
    const existingNotes = await this.gitlabApi.MergeRequestNotes.all(projectId, latestMergeRequestId);
    // An MR can hold several deployment-id notes, one per pipeline run. Scan every note and select
    // the most recent one by date, otherwise QuickDeploy would reuse an outdated validation id.
    let latestDeploymentTime = -1;
    for (const existingNote of existingNotes) {
      if (existingNote.body.includes("<!-- sfdx-hardis deployment-id ")) {
        const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(existingNote.body);
        if (matches) {
          const noteTime = this.getCommentTimestamp(existingNote);
          if (noteTime >= latestDeploymentTime) {
            latestDeploymentTime = noteTime;
            deploymentCheckId = matches[1];
          }
        }
      }
    }
    if (deploymentCheckId) {
      uxLog("log", this, c.grey(t('foundDeploymentIdOnMr', { deploymentCheckId, latestMergeRequestId, latestMergeRequest: latestMergeRequest.title })));
    }
    return deploymentCheckId;
  }

  // Returns a comparable timestamp (ms) for an MR note.
  private getCommentTimestamp(note: any): number {
    const dateValue = note?.created_at || note?.updated_at;
    if (!dateValue) {
      return 0;
    }
    const time = new Date(dateValue).getTime();
    return isNaN(time) ? 0 : time;
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    // Get CI variables
    const prInfo = await this.getPullRequestInfo();
    const projectId = process.env.CI_PROJECT_ID || null;
    const mergeRequestIdRaw = process.env.CI_MERGE_REQUEST_IID || process.env.CI_MERGE_REQUEST_ID || prInfo?.idStr || null;
    const mergeRequestId = mergeRequestIdRaw ? parseInt(String(mergeRequestIdRaw), 10) : NaN;
    if (projectId == null || !Number.isFinite(mergeRequestId)) {
      uxLog("log", this, c.grey('[Gitlab Integration] ' + t('gitlabNoProjectNoNote')));
      return { posted: false, providerResult: { info: "No related merge request" } };
    }
    const gitlabCiJobName = process.env.CI_JOB_NAME;
    const gitlabCIJobUrl = process.env.CI_JOB_URL;
    // Build note message
    const messageKey = prMessage.messageKey + "-" + gitlabCiJobName + "-" + mergeRequestId;
    let messageBody = `${this.buildPrCommentBodyHeader(prMessage)}${prMessage.message}

_Powered by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) from job [${gitlabCiJobName}](${gitlabCIJobUrl})_

${getBannerMarkdownAndLink()}

<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }
    // Check for existing note from a previous run
    uxLog("log", this, c.grey('[Gitlab Integration] ' + t('gitlabListingMrNotes')));
    const existingNotes = await this.gitlabApi.MergeRequestNotes.all(projectId, mergeRequestId);
    let existingNoteId: number | null = null;
    for (const existingNote of existingNotes) {
      if (existingNote.body.includes(`<!-- sfdx-hardis message-key ${messageKey} -->`)) {
        existingNoteId = existingNote.id;
      }
    }

    // Create or update MR note
    if (existingNoteId) {
      // Update existing note
      uxLog("log", this, c.grey('[Gitlab Integration] ' + t('gitlabUpdatingMrNote')));
      const gitlabEditNoteResult = await this.gitlabApi.MergeRequestNotes.edit(projectId, mergeRequestId, existingNoteId, { body: messageBody });
      const prResult: PullRequestMessageResult = {
        posted: gitlabEditNoteResult.id > 0,
        providerResult: gitlabEditNoteResult,
      };
      return prResult;
    } else {
      // Create new note if no existing not was found
      uxLog("log", this, c.grey('[Gitlab Integration] ' + t('gitlabAddingMrNote')));
      const gitlabPostNoteResult = await this.gitlabApi.MergeRequestNotes.create(projectId, mergeRequestId, messageBody);
      const prResult: PullRequestMessageResult = {
        posted: gitlabPostNoteResult.id > 0,
        providerResult: gitlabPostNoteResult,
      };
      return prResult;
    }
  }

  public async listPullRequests(
    filters: { status?: string; targetBranch?: string; minDate?: Date } = {},
  ): Promise<CommonPullRequestInfo[] | null> {
    if (!this.gitlabApi) {
      return null;
    }

    const projectId = process.env.CI_PROJECT_ID || process.env.CI_PROJECT_PATH;
    if (!projectId) {
      uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabCiProjectIdRequired')));
      return null;
    }

    try {
      const state = filters.status === "merged" ? "merged" : filters.status === "open" ? "opened" : "all";
      const params: any = {
        projectId,
        state,
        orderBy: "updated_at" as const,
        sort: "desc" as const,
        perPage: 100,
      };
      if (filters.targetBranch) {
        params.targetBranch = filters.targetBranch;
      }
      if (filters.minDate) {
        params.updatedAfter = filters.minDate.toISOString();
      }

      const mergeRequests = await this.gitlabApi.MergeRequests.all(params);

      return (mergeRequests as any[]).map((mr: any) => this.completePullRequestInfo(mr));
    } catch (e: any) {
      uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabErrorListingMergeRequests', { message: e?.message || e })));
      return null;
    }
  }

  public async listPullRequestsInBranchSinceLastMerge(
    currentBranchName: string,
    targetBranchName: string,
    childBranchesNames: string[],
  ): Promise<CommonPullRequestInfo[]> {
    if (!this.gitlabApi) {
      return [];
    }

    try {
      // Get project ID from the API configuration
      const projectId = process.env.CI_PROJECT_ID || process.env.CI_PROJECT_PATH;
      if (!projectId) {
        uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabCiProjectIdRequired')));
        return [];
      }

      // Step 1: Find the last merged MR from currentBranch to targetBranch
      uxLog("log", this, c.grey('[Gitlab Integration] ' + t('gitlabFindingLastMergedMr', { sourceBranch: currentBranchName, targetBranch: targetBranchName })));
      const lastMergeToTarget = await this.findLastMergedMR(currentBranchName, targetBranchName, projectId);

      // Step 2: Get the commits in currentBranch since that merge. When the branches were never
      // merged before (retrofit branch, first promotion), the window is bounded by the target
      // branch instead: such a branch carries the whole repository history, and listing it made
      // the MR scope cover thousands of historical MRs (issue #2115).
      const commitsSinceLastMerge = await this.getCommitsSinceLastMerge(currentBranchName, targetBranchName, lastMergeToTarget, projectId);

      if (commitsSinceLastMerge.length === 0) {
        return [];
      }

      // Create a Set of commit SHAs for fast lookup
      const commitSHAs = new Set(commitsSinceLastMerge.map((c) => c.id));

      // Step 3-6: Match merged MRs targeting currentBranch and child branches against those commits
      /* jscpd:ignore-start */
      const allBranches = [currentBranchName, ...childBranchesNames];
      return await this.collectMergedPrsForCommits(projectId, allBranches, commitSHAs, getOldestCommitDate(commitsSinceLastMerge));
    } catch (err) {
      uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabErrorListingMrsSinceLastMerge', { message: String(err), stack: err instanceof Error ? err.stack : "" })));
      return [];
    }
    /* jscpd:ignore-end */
  }

  // List the Merge Requests included in a specific "go live" merge commit (e.g. the merge
  // of preprod into main). Bounds the range by the merge commit's first parent so hotfixes
  // merged to the target branch at other times are excluded.
  public async listPullRequestsInGoLive(
    branchName: string,
    childBranchesNames: string[],
    mergeCommitId: string,
  ): Promise<CommonPullRequestInfo[]> {
    if (!this.gitlabApi || !mergeCommitId) {
      return [];
    }
    try {
      const projectId = process.env.CI_PROJECT_ID || process.env.CI_PROJECT_PATH;
      if (!projectId) {
        uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabCiProjectIdRequired')));
        return [];
      }

      // Step 1: Resolve the merge commit's first parent (the mainline before the go live)
      const mergeCommit: any = await this.gitlabApi.Commits.show(projectId, mergeCommitId);
      const firstParent = mergeCommit?.parent_ids?.[0] || mergeCommit?.parentIds?.[0];
      if (!firstParent) {
        return [];
      }

      // Step 2: Commits introduced by the go live (firstParent..mergeCommit)
      const comparison: any = await this.gitlabApi.Repositories.compare(projectId, firstParent, mergeCommitId, { straight: true });
      const goLiveCommits: any[] = comparison?.commits || [];
      const commitSHAs = new Set<string>(goLiveCommits.map((c: any) => c.id));
      commitSHAs.add(mergeCommitId);

      // Step 3-6: Match merged MRs targeting branchName and child branches against those commits
      /* jscpd:ignore-start */
      const allBranches = [branchName, ...childBranchesNames];
      // The merge commit's own date bounds the listing when the comparison brings no dated
      // commit, so the merged MR scan can never fall back to the whole repository history.
      const updatedAfter = getOldestCommitDate(goLiveCommits) || getOldestCommitDate([mergeCommit]);
      return await this.collectMergedPrsForCommits(projectId, allBranches, commitSHAs, updatedAfter);
    } catch (err) {
      uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabErrorListingMrsSinceLastMerge', { message: String(err), stack: err instanceof Error ? err.stack : "" })));
      return [];
    }
    /* jscpd:ignore-end */
  }

  // Shared tail: fetch merged MRs targeting each branch, keep those whose merge commit
  // is part of commitSHAs, dedupe by MR iid and convert to the common shape.
  // updatedAfter bounds the pagination: an MR merged before the oldest commit of the window
  // cannot have its merge commit in it, so fetching the whole merged MR history of each branch
  // (thousands of MRs on an old repository) is useless and slow.
  private async collectMergedPrsForCommits(
    projectId: string | number,
    allBranches: string[],
    commitSHAs: Set<string>,
    updatedAfter: string | null = null,
  ): Promise<CommonPullRequestInfo[]> {
    const mrPromises = allBranches.map(async (branchName) => {
      try {
        const mergedMRs = await this.gitlabApi!.MergeRequests.all({
          projectId,
          targetBranch: branchName,
          state: "merged",
          perPage: 100,
          // Safety cap mirroring the Bitbucket provider (fetchAllPages, 50 pages): without it,
          // gitbeaker pages through the whole merged MR history when updatedAfter is null or
          // the window reaches far back.
          maxPages: 50,
          ...(updatedAfter ? { updatedAfter } : {}),
        });
        uxLog("log", this, c.grey('[Gitlab Integration] ' + t('gitlabFetchingMergedMrs', { branchName })));
        return mergedMRs;
      } catch (err) {
        uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabErrorFetchingMergedMrsForBranch', { branchName, message: String(err) })));
        return [];
      }
    });

    const mrResults = await Promise.all(mrPromises);
    const allMergedMRs: any[] = mrResults.flat();

    // Keep MRs whose merge commit SHA (or last commit before merge) is in our commit list
    const relevantMRs = allMergedMRs.filter((mr) => {
      const mergeCommitSha = mr.mergeCommitSha || mr.merge_commit_sha;
      if (mergeCommitSha && commitSHAs.has(mergeCommitSha)) {
        return true;
      }
      if (mr.sha && commitSHAs.has(mr.sha)) {
        return true;
      }
      return false;
    });

    // Remove duplicates by MR iid
    const uniqueMRsMap = new Map<number, any>();
    for (const mr of relevantMRs) {
      if (mr.iid && !uniqueMRsMap.has(mr.iid)) {
        uniqueMRsMap.set(mr.iid, mr);
      }
    }
    return Array.from(uniqueMRsMap.values()).map((mr) => this.completePullRequestInfo(mr));
  }

  private async findLastMergedMR(
    sourceBranch: string,
    targetBranch: string,
    projectId: string | number,
  ): Promise<any | null> {
    try {
      const mergedMRs = await this.gitlabApi!.MergeRequests.all({
        projectId,
        sourceBranch,
        targetBranch,
        state: "merged",
        orderBy: "updated_at",
        sort: "desc",
        perPage: 1,
        maxPages: 1,
      });

      return mergedMRs.length > 0 ? mergedMRs[0] : null;
    } catch (err) {
      uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabErrorFindingLastMergedMr', { sourceBranch, targetBranch, message: String(err) })));
      return null;
    }
  }

  private async getCommitsSinceLastMerge(
    branchName: string,
    targetBranchName: string,
    lastMerge: any | null,
    projectId: string | number,
  ): Promise<any[]> {
    try {
      // Previous merge found with a merge or squash commit: list the branch commits since its
      // date (also works with squash promotions, whose squash commit is not an ancestor of the
      // source branch). Not for fast-forward promotions: they leave no merge commit, and the
      // branch can then receive fast-forwarded feature merges whose commits keep committer
      // dates older than the promotion, which the date window would silently miss.
      const lastMergeDate = lastMerge ? (lastMerge.mergedAt || lastMerge.merged_at) : null;
      const lastMergeSha = lastMerge
        ? (lastMerge.mergeCommitSha || lastMerge.merge_commit_sha || lastMerge.squashCommitSha || lastMerge.squash_commit_sha)
        : null;
      if (lastMergeDate && lastMergeSha) {
        const commits = await this.gitlabApi!.Commits.all(projectId, {
          refName: branchName,
          since: lastMergeDate,
          perPage: 100,
        });
        return commits || [];
      }
      // Never merged into the target before (retrofit branch, first promotion), or fast-forward
      // promotions: the branch history is not usable as a window, so keep only the commits the
      // merge would actually bring into the target branch, like the GitHub / Azure / Bitbucket
      // providers do.
      uxLog("log", this, c.grey('[Gitlab Integration] ' + t('gitlabComparingCommits', { base: targetBranchName, head: branchName })));
      const comparison: any = await this.gitlabApi!.Repositories.compare(projectId, targetBranchName, branchName);
      return comparison?.commits || [];
    } catch (err) {
      uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabErrorFetchingCommits', { branchName, message: String(err) })));
      return [];
    }
  }

  private completePullRequestInfo(prData: any): CommonPullRequestInfo {
    const prInfo: CommonPullRequestInfo = {
      idNumber: prData?.iid || prData?.id || 0,
      idStr: String(prData?.iid || prData?.id || ""),
      sourceBranch: (prData?.source_branch || "").replace("refs/heads/", ""),
      targetBranch: (prData?.target_branch || "").replace("refs/heads/", ""),
      title: prData?.title || "",
      description: prData?.description || "",
      authorName: prData?.author?.name || "",
      webUrl: prData?.web_url || "",
      createdDate: prData?.created_at || undefined,
      mergedDate: prData?.merged_at || undefined,
      mergeCommitSha: prData?.merge_commit_sha || prData?.mergeCommitSha || undefined,
      providerInfo: prData,
      customBehaviors: {}
    }
    return this.completeWithCustomBehaviors(prInfo);
  }

  public async createPullRequest(request: CreatePullRequestRequest): Promise<CreatePullRequestResult> {
    const projectId = process.env.CI_PROJECT_ID || null;
    if (!projectId) {
      uxLog("warning", this, c.yellow('[Gitlab Integration] ' + t('gitlabCannotCreateMrMissingProjectId')));
      return { created: false, pullRequestUrl: null, providerResult: { error: "Missing CI_PROJECT_ID" } };
    }
    uxLog("log", this, c.grey('[Gitlab Integration] ' + t('gitlabCreatingMergeRequest', { source: request.sourceBranch, target: request.targetBranch })));
    const result = await this.gitlabApi.MergeRequests.create(
      projectId,
      request.sourceBranch,
      request.targetBranch,
      request.title,
      { description: request.body },
    );
    return {
      created: !!(result?.iid),
      pullRequestUrl: (result as any)?.web_url || null,
      providerResult: result,
    };
  }

  public async findOpenPullRequest(sourceBranch: string, targetBranch: string): Promise<{ pullRequestUrl: string; id: any } | null> {
    const projectId = process.env.CI_PROJECT_ID || null;
    if (!projectId) return null;
    const results = await this.gitlabApi.MergeRequests.all({
      projectId,
      state: "opened",
      sourceBranch,
      targetBranch,
    } as any);
    const mr = (results as any[])?.[0];
    if (!mr) return null;
    return { pullRequestUrl: mr.web_url, id: mr.iid };
  }

  public async updatePullRequestDescription(id: any, title: string, body: string): Promise<void> {
    const projectId = process.env.CI_PROJECT_ID || null;
    if (!projectId) return;
    await this.gitlabApi.MergeRequests.edit(projectId, id, { title, description: body });
  }

  private resolveMergeRequestContext(prNumber?: number): { projectId: string; mergeRequestId: number } | null {
    const projectId = process.env.CI_PROJECT_ID || null;
    if (!projectId) return null;
    let mergeRequestId: number;
    if (prNumber) {
      mergeRequestId = prNumber;
    } else {
      const mergeRequestIdRaw = process.env.CI_MERGE_REQUEST_IID || process.env.CI_MERGE_REQUEST_ID || null;
      mergeRequestId = mergeRequestIdRaw ? parseInt(String(mergeRequestIdRaw), 10) : NaN;
    }
    if (!Number.isFinite(mergeRequestId)) return null;
    return { projectId, mergeRequestId };
  }

  public async getPullRequestCommentByMarker(marker: string, prNumber?: number): Promise<string | null> {
    const ctx = this.resolveMergeRequestContext(prNumber);
    if (!ctx) return null;
    const notes = await this.gitlabApi.MergeRequestNotes.all(ctx.projectId, ctx.mergeRequestId);
    for (const note of notes) {
      if ((note.body || '').includes(marker)) {
        return note.body;
      }
    }
    return null;
  }

  public async upsertPullRequestCommentByMarker(marker: string, body: string, prNumber?: number): Promise<void> {
    const ctx = this.resolveMergeRequestContext(prNumber);
    if (!ctx) return;
    const { projectId, mergeRequestId } = ctx;
    const notes = await this.gitlabApi.MergeRequestNotes.all(projectId, mergeRequestId);
    let existingNoteId: number | null = null;
    for (const note of notes) {
      if ((note.body || '').includes(marker)) {
        existingNoteId = note.id;
        break;
      }
    }
    if (existingNoteId) {
      await this.gitlabApi.MergeRequestNotes.edit(projectId, mergeRequestId, existingNoteId, { body });
      uxLog("log", this, c.grey(`[GitLab] Updated Deployment Actions note on MR !${mergeRequestId}`));
    } else {
      await this.gitlabApi.MergeRequestNotes.create(projectId, mergeRequestId, body);
      uxLog("log", this, c.grey(`[GitLab] Created Deployment Actions note on MR !${mergeRequestId}`));
    }
  }

  public async listPullRequestCommentsByMarker(marker: string, prNumber?: number): Promise<PullRequestCommentRef[]> {
    const ctx = this.resolveMergeRequestContext(prNumber);
    if (!ctx) return [];
    const notes = await this.gitlabApi.MergeRequestNotes.all(ctx.projectId, ctx.mergeRequestId);
    const mergeRequestUrl = await this.getMergeRequestWebUrl(ctx.projectId, ctx.mergeRequestId);
    const results: PullRequestCommentRef[] = [];
    for (const note of notes) {
      if ((note.body || '').includes(marker)) {
        results.push({
          prNumber: ctx.mergeRequestId,
          ref: { projectId: ctx.projectId, noteId: note.id },
          body: note.body || '',
          url: mergeRequestUrl ? `${mergeRequestUrl}#note_${note.id}` : '',
        });
      }
    }
    return results;
  }

  // Web URL of a merge request, to build the permalink of its notes. Cached: it never changes
  // during a job, and every comment of the same merge request reuses it.
  private async getMergeRequestWebUrl(projectId: string, mergeRequestId: number): Promise<string> {
    const cacheKey = `${projectId}-${mergeRequestId}`;
    if (this.mergeRequestWebUrls[cacheKey] !== undefined) {
      return this.mergeRequestWebUrls[cacheKey];
    }
    let webUrl = '';
    try {
      const mergeRequest: any = await this.gitlabApi.MergeRequests.show(projectId, mergeRequestId);
      webUrl = mergeRequest?.web_url || '';
    } catch (e) {
      uxLog("log", this, c.grey(`[Gitlab Integration] Unable to get merge request URL: ${(e as Error).message}`));
    }
    this.mergeRequestWebUrls[cacheKey] = webUrl;
    return webUrl;
  }

  public async updatePullRequestCommentByRef(commentRef: PullRequestCommentRef, body: string): Promise<void> {
    if (!commentRef?.ref?.noteId) return;
    await this.gitlabApi.MergeRequestNotes.edit(commentRef.ref.projectId, commentRef.prNumber, commentRef.ref.noteId, { body });
    uxLog("log", this, c.grey('[GitLab] ' + t('updatedPullRequestComment', { pr: commentRef.prNumber })));
  }
}
