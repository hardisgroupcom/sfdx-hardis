import { Gitlab } from "@gitbeaker/node";
import * as c from "chalk";
import { uxLog } from "../utils";
import { PullRequestMessageRequest, PullRequestMessageResult } from "./types/gitProvider";
import { GitProviderRoot } from "./gitProviderRoot";

export class GitlabProvider extends GitProviderRoot {
  private gitlabApi: InstanceType<typeof Gitlab>;

  constructor() {
    super();
    // Gitlab URL is always provided by default CI variables
    this.serverUrl = process.env.CI_SERVER_URL;
    // It's better to have a project token defined in a CI_SFDX_HARDIS_GITLAB_TOKEN variable, to have the rights to act on Pull Requests
    this.token = process.env.CI_SFDX_HARDIS_GITLAB_TOKEN;
    this.gitlabApi = new Gitlab({ host: this.serverUrl, token: this.token });
  }

  public getLabel(): string {
    return "sfdx-hardis Gitlab connector";
  }

  protected async getParentMergeRequestId(): Promise<number> {
    // CI_COMMIT_MESSAGE contains "See merge request !<MR_ID>"
    const commitMsg = process.env.CI_COMMIT_MESSAGE;
    return parseInt(commitMsg.split("!").pop());
  }

  protected async getPipelineId(): Promise<string> {
    const projectId: string = process.env.CI_PROJECT_ID;
    const parentMergeRequestId: number = await this.getParentMergeRequestId();
    const pipelines = await this.gitlabApi.MergeRequests.pipelines(projectId, parentMergeRequestId);
    console.log(pipelines);
    return "";
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    // Get CI variables
    const projectId = process.env.CI_PROJECT_ID || null;
    const mergeRequestId = process.env.CI_MERGE_REQUEST_IID || process.env.CI_MERGE_REQUEST_ID || null;
    if (projectId == null || mergeRequestId == null) {
      uxLog(this, c.grey("[Gitlab integration] No project and merge request, so no note posted..."));
      return;
    }
    const gitlabCiJobName = process.env.CI_JOB_NAME;
    const gitlabCIJobUrl = process.env.CI_JOB_URL;
    // Build note message
    const messageKey = prMessage.messageKey + "-" + gitlabCiJobName + "-" + mergeRequestId;
    let messageBody = `**${prMessage.title || ""}**

${prMessage.message}

_Provided by [sfdx-hardis](https://sfdx-hardis.cloudity.com) from job [${gitlabCiJobName}](${gitlabCIJobUrl})_
<!-- sfdx-hardis message-key ${messageKey} -->
`;
    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }
    // Check for existing note from a previous run
    uxLog(this, c.grey("[Gitlab integration] Listing Notes of Merge Request..."));
    const existingNotes = await this.gitlabApi.MergeRequestNotes.all(projectId, mergeRequestId);
    let existingNoteId = null;
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
}
