import c from "chalk";
import { getCurrentGitBranch, isCI, uxLog } from "../utils/index.js";
import { AzureDevopsProvider } from "./azureDevops.js";
import { GithubProvider } from "./github.js";
import { GitlabProvider } from "./gitlab.js";
import { GitProviderRoot, PullRequestCommentRef } from "./gitProviderRoot.js";
import { BitbucketProvider } from "./bitbucket.js";
import { debuglog } from "util";
import { CONSTANTS, getEnvVar, PrCommentBannerKey } from "../../config/index.js";
import { prompts } from "../utils/prompts.js";
import { removeMermaidLinks } from "../utils/mermaidUtils.js";
import { getPullRequestData } from "../utils/gitUtils.js";
import { t } from '../utils/i18n.js';
import {
  buildPrCommentNavBlock,
  DEPLOYMENT_ACTIONS_MARKER,
  getPrCommentKind,
  isPrCommentNavEnabled,
  isPrDescriptionNavEnabled,
  PrCommentNavLinks,
  renderPrCommentNav,
  replacePrCommentNavBlock,
  setPrCommentNavLinks,
  SFDX_HARDIS_COMMENT_MARKER,
  upsertNavInDescription,
} from "./prCommentNav.js";
// Enable with NODE_DEBUG=sfdxhardis
const debug = debuglog("sfdxhardis");

export abstract class GitProvider {
  static async getInstance(prompt = false): Promise<GitProviderRoot | null> {
    try {
      // Azure - detect from SYSTEM_ACCESSTOKEN, CI_SFDX_HARDIS_AZURE_TOKEN or AZURE_DEVOPS_EXT_PAT
      if (process.env.SYSTEM_ACCESSTOKEN || process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.AZURE_DEVOPS_EXT_PAT) {
        // Auto-detect missing CI variables from git remote URL when only a token is available
        if (!process.env.SYSTEM_COLLECTIONURI || !process.env.SYSTEM_ACCESSTOKEN) {
          await AzureDevopsProvider.autoDetectSettings();
        }
        const serverUrl = process.env.SYSTEM_COLLECTIONURI || null;
        // a Personal Access Token must be defined
        const token = process.env.CI_SFDX_HARDIS_AZURE_TOKEN || process.env.SYSTEM_ACCESSTOKEN || process.env.AZURE_DEVOPS_EXT_PAT || null;
        if (serverUrl == null || token == null) {
          uxLog(
            "warning",
            this,
            c.yellow(`To benefit from Azure Pipelines advanced integration, you need to define the following variables as ENV vars:
- SYSTEM_COLLECTIONURI
- SYSTEM_ACCESSTOKEN, CI_SFDX_HARDIS_AZURE_TOKEN or AZURE_DEVOPS_EXT_PAT`),
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
        // Auto-detect missing CI variables from git remote URL
        if (!process.env.CI_SERVER_URL || !process.env.CI_PROJECT_ID) {
          await GitlabProvider.autoDetectSettings();
        }
        return new GitlabProvider();
      }
      // Github - detect from GITHUB_TOKEN or CI_SFDX_HARDIS_GITHUB_TOKEN
      else if (process.env.GITHUB_TOKEN || process.env.CI_SFDX_HARDIS_GITHUB_TOKEN) {
        // Auto-detect missing CI variables from git remote URL
        if (!process.env.GITHUB_REPOSITORY) {
          await GithubProvider.autoDetectSettings();
        }
        return new GithubProvider();
      }
      // Bitbucket - detect from BITBUCKET_WORKSPACE or CI_SFDX_HARDIS_BITBUCKET_TOKEN
      else if (process.env.BITBUCKET_WORKSPACE || process.env.CI_SFDX_HARDIS_BITBUCKET_TOKEN) {
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
        // Auto-detect missing CI variables from git remote URL
        if (!process.env.BITBUCKET_WORKSPACE || !process.env.BITBUCKET_REPO_SLUG) {
          await BitbucketProvider.autoDetectSettings();
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
      uxLog("warning", this, c.yellow('[GitProvider] ' + t('gitProviderErrorGettingInstance', { message: (e as Error).message })));
    }
    return null;
  }

  private static async handleManualGitServerAuth() {
    const promptRes = await prompts({
      message: t('pleaseSelectYourGitServiceProvider'),
      description: t('descChooseGitProvider'),
      type: "select",
      choices: [
        { title: t('choiceAzureDevOps'), value: "azure" },
        { title: t('choiceGitHub'), value: "github" },
        { title: t('choiceGitlab'), value: "gitlab" },
        { title: t('choiceBitbucket'), value: "bitbucket" },
      ]
    });
    if (promptRes.value === "azure") {
      await AzureDevopsProvider.handleLocalIdentification();
    }
    else {
      uxLog("action", this, c.cyan('[GitProvider] ' + t('gitProviderLocalAuthNotImplemented', { provider: promptRes.value })));
    }
  }

  static async managePostPullRequestComment(checkOnly: boolean): Promise<void> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      uxLog("warning", this, c.yellow('[Git Provider] ' + t('gitProviderNotConfigured')));
      uxLog(
        "warning",
        this,
        c.yellow('[GitProvider] ' + t('gitProviderSeeDocumentation', { url: `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integrations-home/#git-providers` })),
      );
      return;
    }
    const prData = getPullRequestData();
    const prCommentSent = globalThis.pullRequestCommentSent || false;
    if (prData && gitProvider && prCommentSent === false) {
      uxLog("warning", this, c.yellow('[Git Provider] ' + t('gitProviderPostingPrComment')));
      let markdownBody = "";
      if (prData.deployErrorsMarkdownBody) {
        markdownBody += prData.deployErrorsMarkdownBody;
      }
      if (prData?.autoFixPullRequestUrl) {
        markdownBody += `\n\n---\n🤖 **A coding agent created a fix pull request:** [View fix PR](${prData.autoFixPullRequestUrl})`;
      }
      if (prData.deploymentComponentsMarkdownBody) {
        markdownBody += "\n\n" + prData.deploymentComponentsMarkdownBody;
      }
      if (prData.codeCoverageMarkdownBody) {
        markdownBody += "\n\n" + prData.codeCoverageMarkdownBody;
      }
      // Explain the Quick Deploy mechanics so "Apex tests: none run" on the merge job does not read
      // as an anomaly. No promise when quick deploy is disabled or the validation ran no tests:
      // such a validation cannot be quick-deployed.
      if (checkOnly === true && globalThis.pullRequestDeploymentId && prData.deployStatus === "valid"
        && prData.checkTestLevel !== "NoTestRun"
        && (process.env.SFDX_HARDIS_QUICK_DEPLOY || '') !== 'false') {
        markdownBody += "\n\n" + "🚀 This successful validation may be reused by Quick Deploy after the Pull Request is merged, so the merge job does not run the Apex tests again.";
      }
      if (checkOnly === false && prData.usedQuickDeploy === true) {
        markdownBody += "\n\n" + "🚀 This deployment used Quick Deploy: it released the validation performed during the Pull Request validation job, where the Apex tests were already run.";
      }
      if (prData.flowDeletionMarkdownBody) {
        markdownBody += "\n\n" + prData.flowDeletionMarkdownBody;
      }
      if (prData.deploymentScopeMarkdownBody) {
        markdownBody += "\n\n" + prData.deploymentScopeMarkdownBody;
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
      markdownBody = removeMermaidLinks(markdownBody).trim(); // Remove "click" elements that are useless and ugly on some providers 😊
      const status = resolvePrCommentStatus(prData);
      const prMessageRequest: PullRequestMessageRequest = {
        title: (checkOnly === true ? "🔍 Validation Results (deployment simulation)" : "🚀 Deployment Results") + (prData.title ? `\n\n${prData.title}` : ""),
        message: markdownBody,
        status: status,
        messageKey: (checkOnly === true) ? `deployment-check` : `deployment`,
        bannerKey: getDeploymentBannerKey(checkOnly, status),
        navBlock: buildPrCommentNavBlock(checkOnly === true ? 'validation' : 'deployment'),
      };
      // Post main message
      const postResult = await gitProvider.tryPostPullRequestMessage(prMessageRequest);
      if (postResult && postResult.posted === true) {
        globalThis.pullRequestCommentSent = true;
      }
      // On providers where the description freezes at merge time (Azure DevOps), the deployment
      // comment link can only reach the description while the Pull Request is still open: the
      // validation job creates the deployment comment as a pending placeholder, that the merge job
      // will later update in place.
      if (checkOnly === true
        && (isPrDescriptionNavEnabled() || isPrCommentNavEnabled())
        && gitProvider.isPrDescriptionEditableAfterMerge() === false) {
        const prInfoForPlaceholder = await GitProvider.getPullRequestInfo({ useCache: true });
        await GitProvider.ensurePendingDeploymentComment(gitProvider, prInfoForPlaceholder?.idNumber);
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
      // Now that this comment exists, refresh the navigation of all the sfdx-hardis comments.
      // The Pull Request number is passed explicitly: on a merge job, GitLab, Azure and Bitbucket
      // have no Pull Request context in their environment variables to fall back on.
      const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
      await GitProvider.refreshPullRequestNavigation(prInfo?.idNumber);
    } else {
      uxLog("error", this, c.grey(`${JSON.stringify(prData || { noPrData: "" })} && ${gitProvider} && ${prCommentSent}`));
      uxLog("warning", this, c.yellow('[Git Provider] ' + t('gitProviderSkipPrComment')));
    }
  }

  /**
   * Create the deployment comment as a pending placeholder when it does not exist yet, so its
   * URL can be linked from the Pull Request description before the merge freezes it.
   */
  private static async ensurePendingDeploymentComment(gitProvider: GitProviderRoot, prNumber?: number): Promise<void> {
    const comments = await GitProvider.tryListPullRequestCommentsByMarker(SFDX_HARDIS_COMMENT_MARKER, prNumber);
    if (comments === null) {
      return; // Listing failed: better no placeholder than a duplicated deployment comment
    }
    if (comments.some((comment) => getPrCommentKind(comment.body) === 'deployment')) {
      return;
    }
    uxLog("log", this, c.grey('[GitProvider] ' + t('gitProviderPostingPendingDeploymentComment')));
    // No banner: a deployment banner only exists as success or failure, and this comment has no
    // result yet, so it displays its plain title until the merge job updates it
    const placeholderMessage: PullRequestMessageRequest = {
      title: "🚀 Deployment Results\n\n⏳ Waiting for the Pull Request to be merged",
      message: "The deployment job will update this comment after the Pull Request is merged.",
      status: "tovalidate",
      messageKey: "deployment",
      navBlock: buildPrCommentNavBlock('deployment'),
      // The placeholder carries no deployment result, so it must not claim the QuickDeploy id of
      // the validation that is running: it would outrank the validation comment on the next run.
      skipDeploymentIdMarker: true,
    };
    await gitProvider.tryPostPullRequestMessage(placeholderMessage);
  }

  static async getDeploymentCheckId(): Promise<string | null> {
    // Allow to force the QuickDeploy job id, bypassing the lookup in Pull Request comments.
    // Useful to replay a QuickDeploy manually, and to test the QuickDeploy path outside of a Pull Request context.
    const forcedDeploymentCheckId = getEnvVar('SFDX_HARDIS_DEPLOY_CHECK_ID');
    if (forcedDeploymentCheckId) {
      uxLog("log", this, c.grey(t('usingForcedDeploymentCheckId', { deploymentCheckId: forcedDeploymentCheckId })));
      return forcedDeploymentCheckId;
    }
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
      uxLog("warning", this, c.yellow(t('errorWhileTryingToRetrieveDeploymentCheck', { as: (e as Error).message })));
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

  // Used to turn a CI actor identifier into a displayable identity in notifications.
  // Returns null when no provider is configured: callers fall back to other sources.
  static async resolveUserIdentity(identifier: string): Promise<{ name: string | null; email: string | null } | null> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    return gitProvider.resolveUserIdentity(identifier);
  }

  static async tryGetDeploymentActionsCommentBody(): Promise<string | null> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    try {
      return await gitProvider.getPullRequestCommentByMarker(DEPLOYMENT_ACTIONS_MARKER);
    } catch (e) {
      uxLog("warning", this, c.yellow(`[GitProvider] Could not read Deployment Actions comment: ${(e as Error).message}`));
      return null;
    }
  }

  static async tryUpsertDeploymentActionsComment(body: string): Promise<void> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return;
    }
    try {
      await gitProvider.upsertPullRequestCommentByMarker(DEPLOYMENT_ACTIONS_MARKER, body);
    } catch (e) {
      uxLog("warning", this, c.yellow(`[GitProvider] Could not update Deployment Actions comment: ${(e as Error).message}`));
    }
  }

  static async tryGetDeploymentActionsCommentBodyForPr(prNumber: number): Promise<string | null> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return null;
    }
    try {
      return await gitProvider.getPullRequestCommentByMarker(DEPLOYMENT_ACTIONS_MARKER, prNumber);
    } catch (e) {
      uxLog("warning", this, c.yellow(`[GitProvider] Could not read Deployment Actions comment for PR #${prNumber}: ${(e as Error).message}`));
      return null;
    }
  }

  static async tryUpsertDeploymentActionsCommentForPr(prNumber: number, body: string): Promise<void> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return;
    }
    try {
      await gitProvider.upsertPullRequestCommentByMarker(DEPLOYMENT_ACTIONS_MARKER, body, prNumber);
    } catch (e) {
      uxLog("warning", this, c.yellow(`[GitProvider] Could not update Deployment Actions comment for PR #${prNumber}: ${(e as Error).message}`));
    }
  }

  // Returns null on a listing error (network, API): callers must treat null as "retry later",
  // where an empty array means the Pull Request genuinely has no matching comment.
  /**
   * Refresh the navigation between the sfdx-hardis comments of a Pull Request (validation,
   * deployment, deployment actions) and at the top of its description, so a reader jumps from one
   * to the other instead of scrolling. The comments are posted by different jobs, so the links can
   * only be completed once they exist: this runs after every comment post, and each run adds the
   * comments that appeared since the previous one.
   */
  static async refreshPullRequestNavigation(prNumber?: number): Promise<void> {
    if (!isPrCommentNavEnabled()) {
      return;
    }
    try {
      const comments = await GitProvider.tryListPullRequestCommentsByMarker(SFDX_HARDIS_COMMENT_MARKER, prNumber);
      if (comments === null || comments.length === 0) {
        return;
      }
      const navComments: { kind: 'validation' | 'deployment' | 'actions'; comment: PullRequestCommentRef }[] = [];
      const links: PrCommentNavLinks = {};
      for (const comment of comments) {
        const kind = getPrCommentKind(comment.body);
        if (kind === null) {
          continue;
        }
        navComments.push({ kind, comment });
        if (comment.url) {
          links[kind] = comment.url;
        }
      }
      // Keep the links for the comments rebuilt later in the same job (deployment actions state)
      setPrCommentNavLinks(links);
      if (navComments.length < 2) {
        return;
      }
      for (const navComment of navComments) {
        const updatedBody = replacePrCommentNavBlock(navComment.comment.body, renderPrCommentNav(links, navComment.kind));
        if (updatedBody !== navComment.comment.body) {
          await GitProvider.tryUpdatePullRequestCommentByRef(navComment.comment, updatedBody);
        }
      }
      await GitProvider.refreshPullRequestDescriptionNavigation(links, prNumber);
    } catch (e) {
      uxLog("warning", this, c.yellow('[GitProvider] ' + t('gitProviderNavRefreshError', { message: (e as Error).message })));
    }
  }

  // Insert the same navigation at the very beginning of the Pull Request description.
  // The description is re-read just before writing: it belongs to the user, and only the block
  // between the sfdx-hardis navigation markers is replaced.
  private static async refreshPullRequestDescriptionNavigation(links: PrCommentNavLinks, prNumber?: number): Promise<void> {
    if (!isPrDescriptionNavEnabled()) {
      return;
    }
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return;
    }
    const prInfo = await GitProvider.getPullRequestInfo();
    if (prInfo == null || (prNumber && prInfo.idNumber !== prNumber)) {
      return;
    }
    const currentDescription = prInfo.description || '';
    const updatedDescription = upsertNavInDescription(currentDescription, renderPrCommentNav(links, null));
    if (updatedDescription === currentDescription) {
      return;
    }
    try {
      await gitProvider.updatePullRequestDescription(prInfo.idNumber, prInfo.title, updatedDescription);
      prInfo.description = updatedDescription;
      uxLog("log", this, c.grey('[GitProvider] ' + t('gitProviderNavAddedToDescription', { pr: prInfo.idStr })));
    } catch (e) {
      uxLog("warning", this, c.yellow('[GitProvider] ' + t('gitProviderNavDescriptionError', { message: (e as Error).message })));
    }
  }

  static async tryListPullRequestCommentsByMarker(marker: string, prNumber?: number): Promise<PullRequestCommentRef[] | null> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return [];
    }
    try {
      return await gitProvider.listPullRequestCommentsByMarker(marker, prNumber);
    } catch (e) {
      uxLog("warning", this, c.yellow('[GitProvider] ' + t('gitProviderCouldNotListComments', { message: (e as Error).message })));
      return null;
    }
  }

  static async tryUpdatePullRequestCommentByRef(commentRef: PullRequestCommentRef, body: string): Promise<void> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      return;
    }
    try {
      await gitProvider.updatePullRequestCommentByRef(commentRef, body);
    } catch (e) {
      uxLog("warning", this, c.yellow('[GitProvider] ' + t('gitProviderCouldNotUpdateComment', { pr: commentRef.prNumber, message: (e as Error).message })));
    }
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
      uxLog("warning", this, c.yellow('[GitProvider] ' + t('gitProviderUnableToGetPrInfo', { message: (e as Error).message })));
      uxLog("warning", this, c.yellow('[GitProvider] ' + t('gitProviderMayBeMisconfigured', { provider: gitProvider.getLabel() })));
      uxLog("warning", this, c.yellow('[GitProvider] ' + t('gitProviderSeeDocumentation', { url: `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integrations-home/#git-providers` })));
      prInfo = null;
    }
    return prInfo;
  }

  static async createPullRequest(request: CreatePullRequestRequest): Promise<string | null> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      uxLog("warning", this, c.yellow('[Git Provider] ' + t('gitProviderNotConfiguredForPrCreation')));
      return null;
    }
    // Check if a PR already exists for this source→target branch (e.g. from a previous auto-fix run)
    const existing = await gitProvider.findOpenPullRequest(request.sourceBranch, request.targetBranch);
    if (existing) {
      uxLog("log", this, c.grey(`[Git Provider] Found existing open PR for ${request.sourceBranch} → ${request.targetBranch}, updating description.`));
      await gitProvider.updatePullRequestDescription(existing.id, request.title, request.body);
      return existing.pullRequestUrl;
    }
    try {
      const result = await gitProvider.createPullRequest(request);
      if (result.created && result.pullRequestUrl) {
        return result.pullRequestUrl;
      }
      uxLog("warning", this, c.yellow('[Git Provider] ' + t('gitProviderPrCreationFailed')));
      return null;
    } catch (e) {
      uxLog("warning", this, c.yellow('[Git Provider] ' + t('gitProviderPrCreationError', { message: (e as Error).message })));
      return null;
    }
  }

  static async logAutoFixRemediation(step: "push" | "pr-create"): Promise<void> {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider) {
      gitProvider.logAutoFixRemediation(step);
      return;
    }
    uxLog("log", this, "[sfdx-hardis] Unable to find a Git provider instance for auto-fix remediation guidance.");
    return;
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

/**
 * Status of the Pull Request comment to post. Most success paths only set deployStatus (code
 * coverage check, project without Apex), while the failure paths set status: without this
 * fallback a successful deployment would stay "tovalidate" and carry no banner at all.
 */
export function resolvePrCommentStatus(prData: Partial<PullRequestData>): "valid" | "invalid" | "tovalidate" {
  if (prData.status) {
    return prData.status;
  }
  if (prData.deployStatus === 'valid' || prData.deployStatus === 'invalid') {
    return prData.deployStatus;
  }
  return 'tovalidate';
}

/**
 * Banner identifying a validation (checkOnly deployment) or deployment results comment, with its
 * outcome: success or failure, the only two possible statuses. A "tovalidate" comment (posted
 * before the result is known, like the pending deployment placeholder or a draft deployment
 * actions file stopping the job early) displays no banner, only its title.
 */
export function getDeploymentBannerKey(checkOnly: boolean, status: "valid" | "invalid" | "tovalidate"): PrCommentBannerKey | undefined {
  if (status === "tovalidate") {
    return undefined;
  }
  const type = checkOnly === true ? "validation" : "deployment";
  const outcome = status === "valid" ? "success" : "failure";
  return `${type}-${outcome}` as PrCommentBannerKey;
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
  createdDate?: string;
  mergedDate?: string;
  mergeCommitSha?: string;
  customBehaviors: {
    noDeltaDeployment?: boolean,
    purgeFlowVersions?: boolean,
    destructiveChangesAfterDeployment?: boolean,
    flowDeleteInterviews?: boolean
  }
  providerInfo: any
}

export declare type PullRequestData = {
  messageKey: string;
  title: string;
  deployErrorsMarkdownBody?: string;
  // What the deployment really altered in the org: created / updated / deleted / unchanged split
  deploymentComponentsMarkdownBody?: string;
  codeCoverageMarkdownBody?: string;
  flowDeletionMarkdownBody?: string;
  // Explains which Pull Requests the deployment actions and Apex test classes were collected from
  deploymentScopeMarkdownBody?: string;
  // True when the metadata deployment was performed with Quick Deploy (reusing the validation job result)
  usedQuickDeploy?: boolean;
  // Test level of the validation job, to know if it is reusable by Quick Deploy
  checkTestLevel?: string;
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
  // Identifies the comment (type + status) with a banner image at the top of the comment
  bannerKey?: PrCommentBannerKey;
  // Navigation block linking to the other sfdx-hardis comments of the Pull Request
  navBlock?: string;
  // Do not tag the comment with the QuickDeploy deployment id of the running job
  skipDeploymentIdMarker?: boolean;
};

export declare type PullRequestMessageResult = {
  posted: boolean;
  providerResult: any;
  additionalProviderResult?: any;
};

export declare type CreatePullRequestRequest = {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
};

export declare type CreatePullRequestResult = {
  created: boolean;
  pullRequestUrl: string | null;
  providerResult: any;
};
