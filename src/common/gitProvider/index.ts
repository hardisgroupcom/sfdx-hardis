import * as c from "chalk";
import { getCurrentGitBranch, isCI, uxLog } from "../utils";
import { AzureDevopsProvider } from "./azureDevops";
import { GithubProvider } from "./github";
import { GitlabProvider } from "./gitlab";
import { GitProviderRoot } from "./gitProviderRoot";

export abstract class GitProvider {
  static getInstance(): GitProviderRoot {
    // Azure
    if (process.env.SYSTEM_ACCESSTOKEN) {
      const serverUrl = process.env.SYSTEM_COLLECTIONURI || null;
      // a Personal Access Token must be defined
      const token = process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.SYSTEM_ACCESSTOKEN || null;
      if (serverUrl == null || token == null) {
        uxLog(
          this,
          c.yellow(`To benefit from Azure Pipelines advanced integration, you need to define the following variables as ENV vars:
- SYSTEM_COLLECTIONURI
- SYSTEM_ACCESSTOKEN or CI_SFDX_HARDIS_AZURE_TOKEN`),
        );
        return null;
      }
      return new AzureDevopsProvider();
    }
    // Gitlab
    else if (process.env.CI_JOB_TOKEN) {
      const token = process.env.CI_SFDX_HARDIS_GITLAB_TOKEN || process.env.ACCESS_TOKEN || null;
      if (token == null) {
        uxLog(
          this,
          c.yellow(`To benefit from Gitlab advanced integration, you need to :
- Go to Settings -> Access tokens -> create a project token named "SFDX HARDIS BOT" with developer access and scope "api", then copy its value
- Go to Settings -> CI/CD -> Variables -> Create a masked variable named CI_SFDX_HARDIS_GITLAB_TOKEN, and paste the access token value`),
        );
        return null;
      }
      return new GitlabProvider();
    }
    // Github
    else if (process.env.GITHUB_TOKEN) {
      return new GithubProvider();
    } else if (isCI) {
      uxLog(
        this,
        c.grey(
          "To use sfdx-hardis GitProvider capabilities, SYSTEM_ACCESSTOKEN, CI_JOB_TOKEN or GITHUB_TOKEN must be accessible for Azure Pipelines, Gitlab or GitHub",
        ),
      );
    }
    return null;
  }

  static async managePostPullRequestComment(): Promise<void> {
    const gitProvider = GitProvider.getInstance();
    if (gitProvider == null) {
      uxLog(this, c.yellow("[Git Provider] WARNING: No git provider found to post pull request comment. Maybe you should configure it ?"));
      uxLog(
        this,
        c.yellow("[Git Provider] See documentation: https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integrations-home/#git-providers"),
      );
      return;
    }
    const prData = globalThis.pullRequestData;
    const prCommentSent = globalThis.pullRequestCommentSent || false;
    if (prData && gitProvider && prCommentSent === false) {
      uxLog(this, c.yellow("[Git Provider] Try to post a pull request comment/note..."));
      let markdownBody = "";
      if (prData.deployErrorsMarkdownBody) {
        markdownBody += prData.deployErrorsMarkdownBody;
      }
      if (prData.codeCoverageMarkdownBody) {
        markdownBody += "\n\n" + prData.codeCoverageMarkdownBody;
      }
      const prMessageRequest: PullRequestMessageRequest = {
        title: prData.title,
        message: markdownBody,
        status: prData.status,
        messageKey: prData.messageKey,
      };
      const postResult = await gitProvider.tryPostPullRequestMessage(prMessageRequest);
      if (postResult && postResult.posted === true) {
        globalThis.pullRequestCommentSent = true;
      }
    } else {
      uxLog(this, c.gray(`${JSON.stringify(prData || { noPrData: "" })} && ${gitProvider} && ${prCommentSent}`));
      uxLog(this, c.yellow("[Git Provider] Skip post pull request comment"));
    }
  }

  static async getDeploymentCheckId(): Promise<string> {
    const gitProvider = GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    try {
      const currentGitBranch = await getCurrentGitBranch();
      return gitProvider.getBranchDeploymentCheckId(currentGitBranch);
    } catch (e) {
      uxLog(this, c.yellow(`Error while trying to retrieve deployment check id:\n${e.message}`));
      return null;
    }
  }

  static async getCurrentBranchUrl(): Promise<string> {
    const gitProvider = GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    return gitProvider.getCurrentBranchUrl();
  }

  static async getJobUrl(): Promise<string> {
    const gitProvider = GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    return gitProvider.getCurrentJobUrl();
  }

  static async getPullRequestInfo(): Promise<any> {
    const gitProvider = GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    return gitProvider.getPullRequestInfo();
  }
}

export declare type PullRequestMessageRequest = {
  title: string;
  message: string;
  messageKey: string;
  status: "valid" | "invalid" | "tovalidate";
};

export declare type PullRequestMessageResult = {
  posted: boolean;
  providerResult: any;
  additionalProviderResult?: any;
};
