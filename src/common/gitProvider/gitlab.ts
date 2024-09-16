import { Gitlab } from "@gitbeaker/node";
import c from "chalk";
import { PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
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

  // Find pull request info
  public async getPullRequestInfo(): Promise<any> {
    // Case when MR is found in the context
    const projectId = process.env.CI_PROJECT_ID || null;
    const mrNumber = process.env.CI_MERGE_REQUEST_IID || null;
    if (mrNumber !== null) {
      const mergeRequests = await this.gitlabApi.MergeRequests.all({
        projectId: projectId || "",
        iids: [parseInt(mrNumber)],
      });
      if (mergeRequests.length > 0) {
        return this.completePullRequestInfo(mergeRequests[0]);
      }
    }
    // Case when we find MR from a commit
    const sha = await git().revparse(["HEAD"]);
    const latestMergeRequestsOnBranch = await this.gitlabApi.MergeRequests.all({
      projectId: projectId || "",
      state: "merged",
      sort: "desc",
      sha: sha,
    });
    if (latestMergeRequestsOnBranch.length > 0) {
      const currentGitBranch = await getCurrentGitBranch();
      const candidateMergeRequests = latestMergeRequestsOnBranch.filter((pr) => pr.target_branch === currentGitBranch);
      if (candidateMergeRequests.length > 0) {
        return this.completePullRequestInfo(candidateMergeRequests[0]);
      }
    }
    uxLog(this, c.grey(`[Gitlab Integration] Unable to find related Merge Request Info`));
    return null;
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string | null> {
    let deploymentCheckId = null;
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
      deploymentCheckId = await this.getDeploymentIdFromPullRequest(projectId || "", latestMergeRequestId, deploymentCheckId, latestMergeRequest);
    }
    return deploymentCheckId;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string | null> {
    const pullRequestInfo = await this.getPullRequestInfo();
    if (pullRequestInfo) {
      const projectId = process.env.CI_PROJECT_ID || null;
      return await this.getDeploymentIdFromPullRequest(projectId || "", pullRequestInfo.iid, null, pullRequestInfo);
    }
    return null;
  }

  private async getDeploymentIdFromPullRequest(projectId: string, latestMergeRequestId: number, deploymentCheckId: any, latestMergeRequest) {
    const existingNotes = await this.gitlabApi.MergeRequestNotes.all(projectId, latestMergeRequestId);
    for (const existingNote of existingNotes) {
      if (existingNote.body.includes("<!-- sfdx-hardis deployment-id ")) {
        const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(existingNote.body);
        if (matches) {
          deploymentCheckId = matches[1];
          uxLog(this, c.gray(`Found deployment id ${deploymentCheckId} on MR #${latestMergeRequestId} ${latestMergeRequest.title}`));
          break;
        }
      }
    }
    return deploymentCheckId;
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    // Get CI variables
    const projectId = process.env.CI_PROJECT_ID || null;
    const mergeRequestId = process.env.CI_MERGE_REQUEST_IID || process.env.CI_MERGE_REQUEST_ID || null;
    if (projectId == null || mergeRequestId == null) {
      uxLog(this, c.grey("[Gitlab integration] No project and merge request, so no note posted..."));
      return { posted: false, providerResult: { info: "No related merge request" } };
    }
    const gitlabCiJobName = process.env.CI_JOB_NAME;
    const gitlabCIJobUrl = process.env.CI_JOB_URL;
    // Build note message
    const messageKey = prMessage.messageKey + "-" + gitlabCiJobName + "-" + mergeRequestId;
    let messageBody = `**${prMessage.title || ""}**

${prMessage.message}

_Powered by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) from job [${gitlabCiJobName}](${gitlabCIJobUrl})_
<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }
    // Check for existing note from a previous run
    uxLog(this, c.grey("[Gitlab integration] Listing Notes of Merge Request..."));
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
      uxLog(this, c.grey("[Gitlab integration] Updating Merge Request Note on Gitlab..."));
      const gitlabEditNoteResult = await this.gitlabApi.MergeRequestNotes.edit(projectId, mergeRequestId, existingNoteId, messageBody);
      const prResult: PullRequestMessageResult = {
        posted: gitlabEditNoteResult.id > 0,
        providerResult: gitlabEditNoteResult,
      };
      return prResult;
    } else {
      // Create new note if no existing not was found
      uxLog(this, c.grey("[Gitlab integration] Adding Merge Request Note on Gitlab..."));
      const gitlabPostNoteResult = await this.gitlabApi.MergeRequestNotes.create(projectId, mergeRequestId, messageBody);
      const prResult: PullRequestMessageResult = {
        posted: gitlabPostNoteResult.id > 0,
        providerResult: gitlabPostNoteResult,
      };
      return prResult;
    }
  }

  private completePullRequestInfo(prData: any) {
    const prInfo: any = Object.assign({}, prData);
    prInfo.sourceBranch = (prData?.source_branch || "").replace("refs/heads/", "");
    prInfo.targetBranch = (prData?.target_branch || "").replace("refs/heads/", "");
    return prInfo;
  }
}
