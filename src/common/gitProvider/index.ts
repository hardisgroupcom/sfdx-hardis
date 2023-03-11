import * as c from "chalk";
import { isCI, uxLog } from "../utils";
import { AzureDevopsProvider } from "./azureDevops";
import { GithubProvider } from "./github";
import { GitlabProvider } from "./gitlab";
import { GitProviderInterface } from "./gitProviderInterface";

export abstract class GitProvider {

  static getInstance(): GitProviderInterface {
    // Azure
    if (process.env.SYSTEM_ACCESSTOKEN) {
      return new AzureDevopsProvider();
    }
    // GitHub
    else if (process.env.CI_JOB_TOKEN) {
      return new GitlabProvider();
    }
    // Gitlab
    else if (process.env.GITHUB_TOKEN) {
      return new GithubProvider();
    }
    else if (isCI) {
      uxLog(this, c.grey("To use sfdx-hardis GitProvider capabilities, SYSTEM_ACCESSTOKEN, CI_JOB_TOKEN or GITHUB_TOKEN must be accessible for Azure Pipelines, Gitlab or GitHub"))
    }
    return null;
  }
}
