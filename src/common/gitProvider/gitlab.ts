import { Gitlab } from "@gitbeaker/node";
import c from "chalk";
import { CommonPullRequestInfo, PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
import { getCurrentGitBranch, git, uxLog } from "../utils/index.js";
import { GitProviderRoot } from "./gitProviderRoot.js";
import { CONSTANTS } from "../../config/index.js";

export class GitlabProvider extends GitProviderRoot {
  private gitlabApi: InstanceType<typeof Gitlab>;
  public serverUrl: string;
  public token: string;

  constructor() {
    super();
    // Gitlab URL is always provided by default CI variables
    this.serverUrl = process.env.CI_SERVER_URL || "";
    // It's better to have a project token defined in a CI_SFDX_HARDIS_GITLAB_TOKEN variable, to have the rights to act on Pull Requests
    this.token = process.env.CI_SFDX_HARDIS_GITLAB_TOKEN || process.env.ACCESS_TOKEN || "";
    this.gitlabApi = new Gitlab({
      host: this.serverUrl,
      token: this.token,
      rejectUnauthorized: process?.env?.GITLAB_API_REJECT_UNAUTHORIZED === "false" ? false : true,
    });
  }

  public getLabel(): string {
    return "sfdx-hardis Gitlab connector";
  }

  // Returns current job URL
  public async getCurrentJobUrl(): Promise<string | null> {
    if (process.env.PIPELINE_JOB_URL) {
      return process.env.PIPELINE_JOB_URL;
    }
    if (process.env.CI_JOB_URL) {
      return process.env.CI_JOB_URL;
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
        const commitMrs = await this.gitlabApi.Commits.mergeRequests(projectId || "", sha);
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
      uxLog("warning", this, c.yellow(`[Gitlab Integration] Error fetching merged MRs: ${String(err)}`));
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
        uxLog("warning", this, c.yellow(`[Gitlab Integration] Fallback query failed: ${String(innerErr)}`));
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
    uxLog("log", this, c.grey(`[Gitlab Integration] Unable to find related Merge Request Info`));
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
      const latestMergeRequest = latestMergeRequestsOnBranch[0];
      const latestMergeRequestId = latestMergeRequest.iid;
      deploymentCheckId = await this.getDeploymentIdFromPullRequest(projectId || "", latestMergeRequestId, deploymentCheckId, this.completePullRequestInfo(latestMergeRequest));
    }
    return deploymentCheckId;
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
    for (const existingNote of existingNotes) {
      if (existingNote.body.includes("<!-- sfdx-hardis deployment-id ")) {
        const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(existingNote.body);
        if (matches) {
          deploymentCheckId = matches[1];
          uxLog("error", this, c.grey(`Found deployment id ${deploymentCheckId} on MR #${latestMergeRequestId} ${latestMergeRequest.title}`));
          break;
        }
      }
    }
    return deploymentCheckId;
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    // Get CI variables
    const prInfo = await this.getPullRequestInfo();
    const projectId = process.env.CI_PROJECT_ID || null;
    const mergeRequestId = process.env.CI_MERGE_REQUEST_IID || process.env.CI_MERGE_REQUEST_ID || prInfo?.idStr || null;
    if (projectId == null || mergeRequestId == null) {
      uxLog("log", this, c.grey("[Gitlab integration] No project and merge request, so no note posted..."));
      return { posted: false, providerResult: { info: "No related merge request" } };
    }
    const gitlabCiJobName = process.env.CI_JOB_NAME;
    const gitlabCIJobUrl = process.env.CI_JOB_URL;
    // Build note message
    const messageKey = prMessage.messageKey + "-" + gitlabCiJobName + "-" + mergeRequestId;
    let messageBody = `## ${prMessage.title || ""}

    ${prMessage.message}

_Powered by[sfdx - hardis](${CONSTANTS.DOC_URL_ROOT}) from job[${gitlabCiJobName}](${gitlabCIJobUrl}) _
  < !--sfdx - hardis message - key ${messageKey} -->
    `;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n < !--sfdx - hardis deployment - id ${globalThis.pullRequestDeploymentId} --> `;
    }
    // Check for existing note from a previous run
    uxLog("log", this, c.grey("[Gitlab integration] Listing Notes of Merge Request..."));
    const existingNotes = await this.gitlabApi.MergeRequestNotes.all(projectId, mergeRequestId);
    let existingNoteId: number | null = null;
    for (const existingNote of existingNotes) {
      if (existingNote.body.includes(`< !--sfdx - hardis message - key ${messageKey} --> `)) {
        existingNoteId = existingNote.id;
      }
    }

    // Create or update MR note
    if (existingNoteId) {
      // Update existing note
      uxLog("log", this, c.grey("[Gitlab integration] Updating Merge Request Note on Gitlab..."));
      const gitlabEditNoteResult = await this.gitlabApi.MergeRequestNotes.edit(projectId, mergeRequestId, existingNoteId, messageBody);
      const prResult: PullRequestMessageResult = {
        posted: gitlabEditNoteResult.id > 0,
        providerResult: gitlabEditNoteResult,
      };
      return prResult;
    } else {
      // Create new note if no existing not was found
      uxLog("log", this, c.grey("[Gitlab integration] Adding Merge Request Note on Gitlab..."));
      const gitlabPostNoteResult = await this.gitlabApi.MergeRequestNotes.create(projectId, mergeRequestId, messageBody);
      const prResult: PullRequestMessageResult = {
        posted: gitlabPostNoteResult.id > 0,
        providerResult: gitlabPostNoteResult,
      };
      return prResult;
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
        uxLog("warning", this, c.yellow("[Gitlab Integration] CI_PROJECT_ID or CI_PROJECT_PATH environment variable is required"));
        return [];
      }

      // Step 1: Find the last merged MR from currentBranch to targetBranch
      uxLog("log", this, c.grey(`[Gitlab Integration] Finding last merged MR from ${currentBranchName} to ${targetBranchName} `));
      const lastMergeToTarget = await this.findLastMergedMR(currentBranchName, targetBranchName, projectId);

      // Step 2: Get all commits in currentBranch since that merge (or all if no previous merge)
      const commitsSinceLastMerge = await this.getCommitsSinceLastMerge(currentBranchName, lastMergeToTarget, projectId);

      if (commitsSinceLastMerge.length === 0) {
        return [];
      }

      // Create a Set of commit SHAs for fast lookup
      const commitSHAs = new Set(commitsSinceLastMerge.map((c) => c.id));

      // Step 3: Get all merged MRs targeting currentBranch and child branches (parallelized)
      const allBranches = [currentBranchName, ...childBranchesNames];

      const mrPromises = allBranches.map(async (branchName) => {
        try {
          const mergedMRs = await this.gitlabApi!.MergeRequests.all({
            projectId,
            targetBranch: branchName,
            state: "merged",
            perPage: 100,
          });
          uxLog("log", this, c.grey(`[Gitlab Integration] Fetching merged MRs for branch ${branchName}`));
          return mergedMRs;
        } catch (err) {
          uxLog("warning", this, c.yellow(`[Gitlab Integration] Error fetching merged MRs for branch ${branchName}: ${String(err)} `));
          return [];
        }
      });

      const mrResults = await Promise.all(mrPromises);
      const allMergedMRs: any[] = mrResults.flat();

      // Step 4: Filter MRs whose merge commit SHA is in our commit list
      const relevantMRs = allMergedMRs.filter((mr) => {
        // Check if the merge commit SHA is in our commits
        const mergeCommitSha = mr.mergeCommitSha || mr.merge_commit_sha;
        if (mergeCommitSha && commitSHAs.has(mergeCommitSha)) {
          return true;
        }

        // Also check if the MR's SHA (last commit before merge) is in our commits
        if (mr.sha && commitSHAs.has(mr.sha)) {
          return true;
        }

        return false;
      });

      // Step 5: Remove duplicates (same MR might be found through different branches)
      const uniqueMRsMap = new Map<number, any>();
      for (const mr of relevantMRs) {
        if (mr.iid && !uniqueMRsMap.has(mr.iid)) {
          uniqueMRsMap.set(mr.iid, mr);
        }
      }

      const uniqueMRs = Array.from(uniqueMRsMap.values());

      // Step 6: Convert to CommonPullRequestInfo
      return uniqueMRs.map((mr) =>
        this.completePullRequestInfo(mr)
      );
    } catch (err) {
      uxLog("warning", this, c.yellow(`[Gitlab Integration]Error in listPullRequestsInBranchSinceLastMerge: ${String(err)} \n${err instanceof Error ? err.stack : ""} `));
      return [];
    }
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
      uxLog("warning", this, c.yellow(`[Gitlab Integration] Error finding last merged MR from ${sourceBranch} to ${targetBranch}: ${String(err)} `));
      return null;
    }
  }

  private async getCommitsSinceLastMerge(
    branchName: string,
    lastMerge: any | null,
    projectId: string | number,
  ): Promise<any[]> {
    try {
      const options: any = {
        refName: branchName,
        perPage: 100,
      };

      // If there was a previous merge, get commits since that merge commit
      if (lastMerge) {
        const mergeCommitSha = lastMerge.mergeCommitSha || lastMerge.merge_commit_sha;
        if (mergeCommitSha) {
          // Get commits since the merge commit
          options.since = lastMerge.mergedAt || lastMerge.merged_at;
        }
      }

      const commits = await this.gitlabApi!.Commits.all(projectId, options);
      return commits || [];
    } catch (err) {
      uxLog("warning", this, c.yellow(`[Gitlab Integration] Error fetching commits for branch ${branchName}: ${String(err)} `));
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
      providerInfo: prData,
      customBehaviors: {}
    }
    return this.completeWithCustomBehaviors(prInfo);
  }
}
