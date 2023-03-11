import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { isCI, uxLog } from "../utils";
import { AzureDevopsProvider } from "./azureDevops";
import { GithubProvider } from "./github";
import { GitlabProvider } from "./gitlab";
import { PullRequestMessageRequest, PullRequestMessageResult } from "./gitProvider";

export abstract class GitProvider {

  protected serverUrl: string;
  protected token: string;

  static getInstance(): GitProvider {
    // Azure
    if (process.env.SYSTEM_ACCESSTOKEN) {
      return new AzureDevopsProvider();
    }
    // GitHub
    else if (process.env.CI_JOB_TOKEN) {
      return new GithubProvider();
    }
    // Gitlab
    else if (process.env.GITHUB_TOKEN) {
      return new GitlabProvider();
    }
    else if (isCI) {
      uxLog(this, c.grey("To use sfdx-hardis GitProvider capabilities, SYSTEM_ACCESSTOKEN, CI_JOB_TOKEN or GITHUB_TOKEN must be accessible for Azure Pipelines, Gitlab or GitHub"))
    }
    return null;
  }

  getLabel(): string {
    throw new SfdxError("getLabel should be implemented on this call");
  }

  async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    uxLog(this, c.yellow("Method postPullRequestMessage is not yet implemented on " + this.getLabel() +
      " to post " + JSON.stringify(prMessage)));
    return null;
  }

  async getParentMergeRequestId(): Promise<number> {
    return null;
  }

  async getPipelineId(): Promise<string> {
    uxLog(this, c.yellow("Method getPipelineId is not yet implemented on " + this.getLabel()));
    return null;
  }

  async getJobsFromPipeline(): Promise<string> {
    uxLog(this, c.yellow("Method getJobsFromPipeline is not yet implemented on " + this.getLabel()));
    return null;
  }

  async getDeployId(): Promise<string> {
    uxLog(this, c.yellow("Method getDeployId is not yet implemented on " + this.getLabel()));
    return null;
  }
}
