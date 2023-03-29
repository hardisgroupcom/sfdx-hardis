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
      const token = process.env.CI_SFDX_HARDIS_GITLAB_TOKEN || null;
      if (token == null) {
        uxLog(
          this,
          c.yellow(`To benefit from Gitlab advanced integration, you need to :
- Go to Settings -> Access tokens -> create a project token named "SFDX HARDIS BOT" with developer access and scope "api", then copy its value
- Go to Settings -> CI/CD -> Variables -> Create a masked variable named CI_SFDX_HARDIS_GITLAB_TOKEN, and paste the access token value`)
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
          "To use sfdx-hardis GitProvider capabilities, SYSTEM_ACCESSTOKEN, CI_JOB_TOKEN or GITHUB_TOKEN must be accessible for Azure Pipelines, Gitlab or GitHub"
        )
      );
    }
    return null;
  }

  static async managePostPullRequestComment(): Promise<void> {
    const gitProvider = GitProvider.getInstance();
    const prData = globalThis.pullRequestData;
    const prCommentSent = globalThis.pullRequestCommentSent || false;
    if (prData && gitProvider && prCommentSent === false) {
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
    }
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
