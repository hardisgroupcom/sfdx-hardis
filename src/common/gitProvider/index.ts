import * as c from "chalk";
import { isCI, uxLog } from "../utils";
import { AzureDevopsProvider } from "./azureDevops";
import { GithubProvider } from "./github";
import { GitlabProvider } from "./gitlab";
import { GitProviderRoot } from "./gitProviderRoot";

export abstract class GitProvider {

  static getInstance(): GitProviderRoot {
    // Azure
    if (process.env.SYSTEM_ACCESSTOKEN) {
      return new AzureDevopsProvider();
    }
    // Gitlab
    else if (process.env.CI_JOB_TOKEN) {
      const token = process.env.CI_SFDX_HARDIS_GITLAB_TOKEN || null ;
      if (token == null) {
        uxLog(this,c.yellow("To benefit from Gitlab advanced integration, you need to create a project token with developer rights and api scope, then to set its value in CI/CD variable CI_SFDX_HARDIS_GITLAB_TOKEN"));
        return null ;
      }
      return new GitlabProvider();
    }
    // Github
    else if (process.env.GITHUB_TOKEN) {
      return new GithubProvider();
    }
    else if (isCI) {
      uxLog(this, c.grey("To use sfdx-hardis GitProvider capabilities, SYSTEM_ACCESSTOKEN, CI_JOB_TOKEN or GITHUB_TOKEN must be accessible for Azure Pipelines, Gitlab or GitHub"))
    }
    return null;
  }
}
