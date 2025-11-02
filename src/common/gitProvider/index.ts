import c from "chalk";
import { getCurrentGitBranch, isCI, uxLog } from "../utils/index.js";
import { AzureDevopsProvider } from "./azureDevops.js";
import { GithubProvider } from "./github.js";
import { GitlabProvider } from "./gitlab.js";
import { GitProviderRoot } from "./gitProviderRoot.js";
import { BitbucketProvider } from "./bitbucket.js";
import Debug from "debug";
import { CONSTANTS, getEnvVar } from "../../config/index.js";
import { prompts } from "../utils/prompts.js";
import { removeMermaidLinks } from "../utils/mermaidUtils.js";
import { getPullRequestData } from "../utils/gitUtils.js";
const debug = Debug("sfdxhardis");

export abstract class GitProvider {
  static async getInstance(prompt = false): Promise<GitProviderRoot | null> {
    try {
      // Azure
      if (process.env.SYSTEM_ACCESSTOKEN) {
        const serverUrl = process.env.SYSTEM_COLLECTIONURI || null;
        // a Personal Access Token must be defined
        const token = process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.SYSTEM_ACCESSTOKEN || null;
        if (serverUrl == null || token == null) {
          uxLog(
            "warning",
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
      else if (process.env.CI_JOB_TOKEN || process.env.CI_SFDX_HARDIS_GITLAB_TOKEN) {
        const token = process.env.CI_SFDX_HARDIS_GITLAB_TOKEN || process.env.ACCESS_TOKEN || null;
        if (token == null) {
          uxLog(
            "warning",
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
      }
      // Bitbucket
      else if (process.env.BITBUCKET_WORKSPACE) {
        const token = process.env.CI_SFDX_HARDIS_BITBUCKET_TOKEN || null;
        if (token == null) {
          uxLog(
            "warning",
            this,
            c.yellow(`To benefit from Bitbucket advanced integration, you need to :
- Go to Repository Settings -> Access Tokens -> Create a repository access token with the scopes pullrequest, pullrequest:write, repository, repository:write and copy its value
- Go to Repository Settings -> Repository Variables -> Create a variable named CI_SFDX_HARDIS_BITBUCKET_TOKEN and paste the access token value`),
          );
          return null;
        }
        return new BitbucketProvider();
      }
      // If prompt allowed and no vars found, request to user
      else if (prompt && !isCI) {
        await GitProvider.handleManualGitServerAuth();
        return this.getInstance(false);
      }
      else if (isCI) {
        uxLog(
          "log",
          this,
          c.grey(
            "To use sfdx-hardis GitProvider capabilities, SYSTEM_ACCESSTOKEN, CI_JOB_TOKEN, GITHUB_TOKEN or CI_SFDX_HARDIS_BITBUCKET_TOKEN must be accessible for Azure Pipelines, Gitlab, GitHub or Bitbucket",
          ),
        );
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(`[GitProvider] Error while trying to get git provider instance:\n${(e as Error).message}. Maybe an expired Personal Access Token ?`));
    }
    return null;
  }

  private static async handleManualGitServerAuth() {
    const promptRes = await prompts({
      message: "Please select your Git Service Provider",
      description: "Choose your git hosting service to enable CI/CD integration features",
      type: "select",
      choices: [
        { title: "Azure DevOps", value: "azure" },
        { title: "GitHub", value: "github" },
        { title: "Gitlab", value: "gitlab" },
        { title: "Bitbucket", value: "bitbucket" },
      ]
    });
    if (promptRes.value === "azure") {
      await AzureDevopsProvider.handleLocalIdentification();
    }
    else {
      uxLog("warning", this, c.yellow(`[GitProvider] Local authentication is not yet implemented for ${promptRes.value}`));
    }
  }

  static async managePostPullRequestComment(checkOnly: boolean): Promise<void> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      uxLog("warning", this, c.yellow("[Git Provider] WARNING: No git provider found to post pull request comment. Maybe you should configure it ?"));
      uxLog(
        "warning",
        this,
        c.yellow(`[Git Provider] See documentation: ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integrations-home/#git-providers`),
      );
      return;
    }
    const prData = getPullRequestData();
    const prCommentSent = globalThis.pullRequestCommentSent || false;
    if (prData && gitProvider && prCommentSent === false) {
      uxLog("warning", this, c.yellow("[Git Provider] Try to post a pull request comment/note..."));
      let markdownBody = "";
      if (prData.deployErrorsMarkdownBody) {
        markdownBody += prData.deployErrorsMarkdownBody;
      }
      if (prData.codeCoverageMarkdownBody) {
        markdownBody += "\n\n" + prData.codeCoverageMarkdownBody;
      }
      if (prData.preDeployCommandsResultMarkdownBody) {
        markdownBody += "\n\n" + prData.preDeployCommandsResultMarkdownBody;
      }
      if (prData.postDeployCommandsResultMarkdownBody) {
        markdownBody += "\n\n" + prData.postDeployCommandsResultMarkdownBody;
      }
      if (prData.commitsSummary) {
        markdownBody += "\n\n" + prData.commitsSummary;
      }
      if (prData?.flowDiffMarkdown?.markdownSummary) {
        markdownBody += "\n\n" + prData.flowDiffMarkdown.markdownSummary;
      }
      markdownBody = removeMermaidLinks(markdownBody); // Remove "click" elements that are useless and ugly on some providers 😊
      const prMessageRequest: PullRequestMessageRequest = {
        title: (checkOnly === true ? "Deployment Check Results" : "Deployment Results") + (prData.title ? `\n\n${prData.title}` : ""),
        message: markdownBody,
        status: prData.status || 'tovalidate',
        messageKey: (checkOnly === true) ? `deployment-check` : `deployment`,
      };
      // Post main message
      const postResult = await gitProvider.tryPostPullRequestMessage(prMessageRequest);
      if (postResult && postResult.posted === true) {
        globalThis.pullRequestCommentSent = true;
      }
      // Post additional comments
      for (const flowDiff of prData?.flowDiffMarkdown?.flowDiffMarkdownList || []) {
        const flowDiffMessage = removeMermaidLinks(flowDiff.markdown); // Remove "click" elements that are useless and ugly on some providers 😊
        const prMessageRequestAdditional: PullRequestMessageRequest = {
          title: `Differences for Flow ${flowDiff.name}`,
          message: flowDiffMessage,
          status: "valid",
          messageKey: `sfdx-hardis-flow-diff-${flowDiff.name}`,
          sourceFile: flowDiff.markdownFile,
        };
        await gitProvider.tryPostPullRequestMessage(prMessageRequestAdditional);
      }
    } else {
      uxLog("error", this, c.grey(`${JSON.stringify(prData || { noPrData: "" })} && ${gitProvider} && ${prCommentSent}`));
      uxLog("warning", this, c.yellow("[Git Provider] Skip post pull request comment"));
    }
  }

  static async getDeploymentCheckId(): Promise<string | null> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    try {
      // Exotic way: get deployment check Id from current Pull Request: https://github.com/hardisgroupcom/sfdx-hardis/issues/637
      if (this.isDeployBeforeMerge()) {
        return gitProvider.getPullRequestDeploymentCheckId();
      }
      // Classic way: get deployment check Id from latest merged Pull Request
      const currentGitBranch = await getCurrentGitBranch() || "";
      return gitProvider.getBranchDeploymentCheckId(currentGitBranch);
    } catch (e) {
      uxLog("warning", this, c.yellow(`Error while trying to retrieve deployment check id:\n${(e as Error).message}`));
      return null;
    }
  }

  static async getCurrentBranchUrl(): Promise<string | null> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    return gitProvider.getCurrentBranchUrl();
  }

  static async getJobUrl(): Promise<string | null> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    return gitProvider.getCurrentJobUrl();
  }

  static async supportsMermaidInPrMarkdown(): Promise<boolean> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return false;
    }
    return gitProvider.supportsMermaidInPrMarkdown();
  }

  static async supportsSvgAttachments(): Promise<boolean> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return false;
    }
    return gitProvider.supportsSvgAttachments();
  }

  static prInfoCache: any = null;

  static async getPullRequestInfo(options: { useCache: boolean } = { useCache: false }): Promise<CommonPullRequestInfo | null> {
    // Return cached result if available and caching is enabled
    if (options.useCache && GitProvider.prInfoCache !== null) {
      debug("[PR Info] Returning cached pull request info");
      return GitProvider.prInfoCache;
    }

    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      debug("[PR Info] No GitProvider instance found");
      return null;
    }
    let prInfo: CommonPullRequestInfo | null = null;
    try {
      prInfo = await gitProvider.getPullRequestInfo();
      debug("[GitProvider][PR Info] " + JSON.stringify(prInfo, null, 2));
      GitProvider.prInfoCache = prInfo;
    } catch (e) {
      uxLog("warning", this, c.yellow("[GitProvider] Unable to get Pull Request info: " + (e as Error).message));
      uxLog("warning", this, c.yellow(`[GitProvider] Maybe you misconfigured your ${gitProvider.getLabel()} ?`));
      uxLog("warning", this, c.yellow(`[GitProvider] See ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integrations-home/#git-providers`));
      prInfo = null;
    }
    return prInfo;
  }

  static isDeployBeforeMerge(): boolean {
    const deployBeforeMerge = getEnvVar("SFDX_HARDIS_DEPLOY_BEFORE_MERGE") || false;
    return [true, "true"].includes(deployBeforeMerge);
  }

  static getMergeRequestName(gitUrl: string): string {
    if (gitUrl.includes("gitlab")) {
      return "Merge Request";
    }
    // Default fallback
    return "Pull Request";
  }

  static getMergeRequestCreateUrl(gitUrl: string, targetBranch: string, sourceBranch: string): string | null {
    const gitUrlHttp = gitUrl.replace(".git", "").trim();
    // GitLab
    if (gitUrlHttp.includes("gitlab")) {
      // https://gitlab.com/group/project/-/merge_requests/new?merge_request[source_branch]=feature&merge_request[target_branch]=main
      return `${gitUrlHttp}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(sourceBranch)}&merge_request[target_branch]=${encodeURIComponent(targetBranch)}`;
    }
    // GitHub
    if (gitUrlHttp.includes("github") || gitUrlHttp.includes("ghe.com")) {
      // https://github.com/org/repo/compare/main...feature?expand=1
      return `${gitUrlHttp}/compare/${encodeURIComponent(targetBranch)}...${encodeURIComponent(sourceBranch)}?expand=1`;
    }
    // Gitea (common pattern)
    if (gitUrlHttp.includes("gitea")) {
      // https://gitea.example.com/org/repo/compare/main...feature
      return `${gitUrlHttp}/compare/${encodeURIComponent(targetBranch)}...${encodeURIComponent(sourceBranch)}`;
    }
    // Azure DevOps (modern format)
    if (gitUrlHttp.includes("dev.azure.com")) {
      // https://dev.azure.com/org/project/_git/repo/pullrequestcreate?sourceRef=feature&targetRef=main
      // Try to extract the repo path after _git/
      const match = gitUrlHttp.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?]+)/);
      if (match) {
        const org = match[1];
        const project = decodeURIComponent(match[2]);
        const repo = decodeURIComponent(match[3]);
        return `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequestcreate?sourceRef=${encodeURIComponent(sourceBranch)}&targetRef=${encodeURIComponent(targetBranch)}`;
      }
    }
    // Azure DevOps (legacy visualstudio.com format)
    if (gitUrlHttp.includes("visualstudio.com")) {
      // https://organization.visualstudio.com/Project/_git/repo/pullrequestcreate?sourceRef=feature&targetRef=main
      const match = gitUrlHttp.match(/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/?]+)/);
      if (match) {
        const org = match[1];
        const project = decodeURIComponent(match[2]);
        const repo = decodeURIComponent(match[3]);
        return `https://${org}.visualstudio.com/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequestcreate?sourceRef=${encodeURIComponent(sourceBranch)}&targetRef=${encodeURIComponent(targetBranch)}`;
      }
    }
    // Bitbucket (cloud)
    if (gitUrlHttp.includes("bitbucket.org")) {
      // https://bitbucket.org/org/repo/pull-requests/new?source=feature&dest=main
      return `${gitUrlHttp}/pull-requests/new?source=${encodeURIComponent(sourceBranch)}&dest=${encodeURIComponent(targetBranch)}`;
    }
    // Bitbucket (server/DC)
    if (gitUrlHttp.includes("/scm/")) {
      // e.g. http://bitbucket.example.com/scm/project/repo
      // https://bitbucket.example.com/projects/PROJECT/repos/REPO/pull-requests?create&sourceBranch=feature&targetBranch=main
      const match = gitUrlHttp.match(/\/scm\/([^/]+)\/([^/]+)/);
      if (match) {
        const project = match[1];
        const repo = match[2];
        return gitUrlHttp.replace(/\/scm\/[^/]+\/[^/]+$/, `/projects/${project.toUpperCase()}/repos/${repo}/pull-requests?create&sourceBranch=${encodeURIComponent(sourceBranch)}&targetBranch=${encodeURIComponent(targetBranch)}`);
      }
    }
    // Fallback: just return null
    return null;
  }
}

export declare type CommonPullRequestInfo = {
  idNumber: number;
  idStr: string;
  targetBranch: string;
  sourceBranch: string;
  title: string;
  description: string;
  authorName: string;
  webUrl: string;
  customBehaviors: {
    noDeltaDeployment?: boolean,
    purgeFlowVersions?: boolean,
    destructiveChangesAfterDeployment?: boolean
  }
  providerInfo: any
}

export declare type PullRequestData = {
  messageKey: string;
  title: string;
  deployErrorsMarkdownBody?: string;
  codeCoverageMarkdownBody?: string;
  commitsSummary?: string;
  deployStatus?: "valid" | "invalid" | "unknown";
  status?: "valid" | "invalid" | "tovalidate";
  flowDiffMarkdown?: {
    markdownSummary?: string;
    flowDiffMarkdownList?: Array<{
      name: string;
      markdown: string;
      markdownFile?: string;
    }>;
  };
}

// Global type augmentation for globalThis
declare global {
  // eslint-disable-next-line no-var
  var pullRequestData: Partial<PullRequestData> | undefined;
  // eslint-disable-next-line no-var
  var pullRequestCommentSent: boolean | undefined;
  // eslint-disable-next-line no-var
  var pullRequestDeploymentId: string | undefined;
}

export declare type PullRequestMessageRequest = {
  title: string;
  message: string;
  messageKey: string;
  status: "valid" | "invalid" | "tovalidate";
  sourceFile?: string;
};

export declare type PullRequestMessageResult = {
  posted: boolean;
  providerResult: any;
  additionalProviderResult?: any;
};
