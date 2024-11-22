import { SfError } from "@salesforce/core";
import c from "chalk";
import { PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
import { uxLog } from "../utils/index.js";

export abstract class GitProviderRoot {
  public serverUrl: string | null;
  public token: string;


  public getLabel(): string {
    throw new SfError("getLabel should be implemented on this call");
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string | null> {
    uxLog(this, `Method getBranchDeploymentCheckId(${gitBranch}) is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string | null> {
    uxLog(this, `Method getPullRequestDeploymentCheckId() is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  public async getCurrentJobUrl(): Promise<string | null> {
    uxLog(this, `Method getCurrentJobUrl is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  public async getCurrentBranchUrl(): Promise<string | null> {
    uxLog(this, `Method getCurrentBranchUrl is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  public async getPullRequestInfo(): Promise<any> {
    uxLog(this, `Method getPullRequestInfo is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async listPullRequests(filters: {
    status?: string,
    targetBranch?: string,
    minDate?: Date
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } = {}, options: {
    formatted?: boolean
  } = { formatted: false }): Promise<any> {
    uxLog(this, `Method listPullRequests is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    uxLog(this, c.yellow("Method postPullRequestMessage is not yet implemented on " + this.getLabel() + " to post " + JSON.stringify(prMessage)));
    return { posted: false, providerResult: { error: "Not implemented in sfdx-hardis" } };
  }
  /* jscpd:ignore-start */
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
  /* jscpd:ignore-end */
}
