import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { uxLog } from "../utils";
import { PullRequestMessageRequest, PullRequestMessageResult } from "./types/gitProvider";

export abstract class GitProviderRoot {

  protected serverUrl: string;
  protected token: string;

  public getLabel(): string {
    throw new SfdxError("getLabel should be implemented on this call");
  }

  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    uxLog(this, c.yellow("Method postPullRequestMessage is not yet implemented on " + this.getLabel() +
      " to post " + JSON.stringify(prMessage)));
    return null;
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
