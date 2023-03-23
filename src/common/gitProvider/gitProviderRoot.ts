import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { PullRequestMessageRequest, PullRequestMessageResult } from ".";
import { uxLog } from "../utils";

export abstract class GitProviderRoot {
  protected serverUrl: string;
  protected token: string;

  public getLabel(): string {
    throw new SfdxError("getLabel should be implemented on this call");
  }

  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    uxLog(this, c.yellow("Method postPullRequestMessage is not yet implemented on " + this.getLabel() + " to post " + JSON.stringify(prMessage)));
    return { posted: false, providerResult: { error: "Not implemented in sfdx-hardis" } };
  }

  // Do not make crash the whole process in case there is an issue with integration
  public async tryPostPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    let prResult: PullRequestMessageResult = null;
    try {
      prResult = await this.postPullRequestMessage(prMessage);
    } catch (e) {
      uxLog(this, c.yellow(`[GitProvider] Error while trying to post pull request message.\n${e.message}\n${e.stack}`));
      prResult = { posted: false, providerResult: { error: e } };
    }
    return prResult;
  }

  protected async getParentMergeRequestId(): Promise<number> {
    return null;
  }

  protected async getPipelineId(): Promise<string> {
    uxLog(this, c.yellow("Method getPipelineId is not yet implemented on " + this.getLabel()));
    return null;
  }

  protected async getJobsFromPipeline(): Promise<string> {
    uxLog(this, c.yellow("Method getJobsFromPipeline is not yet implemented on " + this.getLabel()));
    return null;
  }

  protected async getDeployId(): Promise<string> {
    uxLog(this, c.yellow("Method getDeployId is not yet implemented on " + this.getLabel()));
    return null;
  }
}
