import { GitProviderRoot } from "./gitProviderRoot";
import * as azdev from "azure-devops-node-api";
import * as c from 'chalk';
import { uxLog } from "../utils";
import { PullRequestMessageRequest, PullRequestMessageResult } from "./types/gitProvider";

export class AzureDevopsProvider extends GitProviderRoot {
  private azureApi: InstanceType<typeof azdev.WebApi>;

  constructor() {
    super();
    // Azure server url must be provided in AZURE_SERVER_URL. ex: https:/dev.azure.com/mycompany
    this.serverUrl = process.env.AZURE_SERVER_URL;
    // a Personal Access Token must be defined
    this.token = process.env.CI_SFDX_HARDIS_AZURE_TOKEN;
    const authHandler = azdev.getPersonalAccessTokenHandler(this.token); 
    this.azureApi = new azdev.WebApi(this.serverUrl, authHandler);    
  }

  public getLabel(): string {
    return "sfdx-hardis Azure Devops connector";
  }

  // Posts a note on the merge request
  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    // Get CI variables
    const projectId = process.env.CI_PROJECT_ID || null;
    const mergeRequestId = process.env.CI_MERGE_REQUEST_IID || process.env.CI_MERGE_REQUEST_ID || null;
    if (projectId == null || mergeRequestId == null) {
      uxLog(this, c.grey("[Azure integration] No project and pull request, so no note posted..."));
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
      uxLog(this, c.grey("[Azure integration] Updating Pull Request Note on Azure..."));
      const gitlabEditNoteResult = await this.gitlabApi.MergeRequestNotes.edit(projectId, mergeRequestId, existingNoteId, messageBody);
      const prResult: PullRequestMessageResult = {
        posted: gitlabEditNoteResult.id > 0,
        providerResult: gitlabEditNoteResult,
      };
      return prResult;
    } else {
      // Create new note if no existing not was found
      uxLog(this, c.grey("[Azure integration] Adding Pull Request Note on Azure..."));
      const gitlabPostNoteResult = await this.gitlabApi.MergeRequestNotes.create(projectId, mergeRequestId, messageBody);
      const prResult: PullRequestMessageResult = {
        posted: gitlabPostNoteResult.id > 0,
        providerResult: gitlabPostNoteResult,
      };
      return prResult;
    }
  }
}
