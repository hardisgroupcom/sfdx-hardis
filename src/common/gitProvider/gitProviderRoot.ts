import { SfError } from "@salesforce/core";
import c from "chalk";
import { CommonPullRequestInfo, CreatePullRequestRequest, CreatePullRequestResult, PullRequestMessageRequest, PullRequestMessageResult } from "./index.js";
import { uxLog } from "../utils/index.js";
import { extractImagesFromMarkdown, replaceImagesInMarkdown } from "./utilsMarkdown.js";
import { getEnvVar, getPrCommentBannerMarkdown } from "../../config/index.js";
import { t } from '../utils/i18n.js';

// Oldest commit date of a window, minus one day of margin, used to bound merged PR listings:
// a PR is always updated when it is merged, so its update date cannot be older than the commits
// its merge brought. Each provider passes its own commit date accessor (created_at on GitLab,
// date on Bitbucket). Returns null when no commit carries a parseable date.
export function getOldestCommitDateWithMargin(commits: any[], getCommitDate: (commit: any) => string | undefined): string | null {
  const timestamps = (commits || [])
    .map((commit) => Date.parse(getCommitDate(commit) || ''))
    .filter((time) => !isNaN(time));
  if (timestamps.length === 0) {
    return null;
  }
  return new Date(Math.min(...timestamps) - 24 * 60 * 60 * 1000).toISOString();
}

// Interview deletion is irreversible, so a passing mention in prose must not authorize it: only a
// standalone directive, an affirmative assignment, a bullet or a checked Markdown checkbox count.
// Non-semantic Markdown regions do not count either: a documentation example in a fenced or
// indented code block, or a directive hidden in a PR-template HTML comment, is not an opt-in.
export function hasAffirmativeFlowInterviewDeletionDirective(description: string): boolean {
  const withoutNonSemanticRegions = (description || "")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, "");
  return withoutNonSemanticRegions.split(/\r?\n/).some((rawLine) => {
    if (/^(?:\t| {4})/.test(rawLine)) {
      return false; // indented code block
    }
    const line = rawLine.trim();
    return (
      /^FLOW_DELETE_INTERVIEWS(?:\s*=\s*true)?$/.test(line) ||
      /^[-*]\s+FLOW_DELETE_INTERVIEWS(?:\s*=\s*true)?$/.test(line) ||
      /^[-*]\s+\[[xX]\]\s+FLOW_DELETE_INTERVIEWS(?:\s*=\s*true)?$/.test(line)
    );
  });
}

export abstract class GitProviderRoot {
  public serverUrl: string | null;
  public token: string;


  public getLabel(): string {
    throw new SfError("getLabel should be implemented on this call");
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string | null> {
    uxLog("other", this, `Method getBranchDeploymentCheckId(${gitBranch}) is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string | null> {
    uxLog("other", this, `Method getPullRequestDeploymentCheckId() is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  public async getCurrentJobUrl(): Promise<string | null> {
    uxLog("other", this, `Method getCurrentJobUrl is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  public async getCurrentBranchUrl(): Promise<string | null> {
    uxLog("other", this, `Method getCurrentBranchUrl is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  public async supportsMermaidInPrMarkdown(): Promise<boolean> {
    uxLog("other", this, `Method supportsMermaidInPrMarkdown is not implemented yet on ${this.getLabel()}`);
    return false;
  }

  public async supportsSvgAttachments(): Promise<boolean> {
    // False by default, might be used later
    return false;
  }

  public async getPullRequestInfo(): Promise<CommonPullRequestInfo | null> {
    uxLog("other", this, `Method getPullRequestInfo is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async uploadImage(image: string): Promise<any> {
    uxLog("other", this, `Method uploadImage is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async listPullRequests(filters: {
    status?: string,
    targetBranch?: string,
    minDate?: Date
  } = {}): Promise<CommonPullRequestInfo[] | null> {
    uxLog("other", this, `Method listPullRequests is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  public async listPullRequestsInBranchSinceLastMerge(
    _currentBranchName: string,
    _targetBranchName: string,
    _childBranchesNames: string[],
  ): Promise<CommonPullRequestInfo[]> {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    uxLog("other", this, `Method listPullRequestsInBranchSinceLastMerge is not implemented yet on ${this.getLabel()}`);
    return [];
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  public async listPullRequestsInGoLive(
    _branchName: string,
    _childBranchesNames: string[],
    _mergeCommitId: string,
  ): Promise<CommonPullRequestInfo[]> {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    uxLog("other", this, `Method listPullRequestsInGoLive is not implemented yet on ${this.getLabel()}`);
    return [];
  }

  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    uxLog("warning", this, c.yellow(t('methodPostpullrequestmessageIsNotYetImplementedOn') + this.getLabel() + " to post " + JSON.stringify(prMessage)));
    return { posted: false, providerResult: { error: "Not implemented in sfdx-hardis" } };
  }

  // False when the provider refuses to edit the description of a merged Pull Request (Azure
  // DevOps): the description navigation must then be completed before the merge, so the check
  // job creates the deployment comment as a pending placeholder.
  public isPrDescriptionEditableAfterMerge(): boolean {
    return true;
  }

  /**
   * Common header of a sfdx-hardis Pull Request comment: the navigation between the sfdx-hardis
   * comments first, then the banner image identifying the comment type and status. The banner
   * replaces the title heading, which stays as the image alt text so it only shows when the image
   * is hidden or cannot be loaded; without a banner the title heading is kept. The lines following
   * the first title line (the deployment outcome) are rendered after the banner in both cases.
   */
  protected buildPrCommentBodyHeader(prMessage: PullRequestMessageRequest): string {
    const titleLines = (prMessage.title || '').split('\n');
    const titleLine = (titleLines[0] || '').trim();
    const titleRest = titleLines.slice(1).join('\n').trim();
    const bannerMarkdown = getPrCommentBannerMarkdown(prMessage.bannerKey, titleLine);
    const headingMarkdown = bannerMarkdown === '' ? `## ${titleLine}\n\n` : '';
    return `${prMessage.navBlock || ''}${bannerMarkdown}${headingMarkdown}${titleRest ? `${titleRest}\n\n` : ''}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async createPullRequest(request: CreatePullRequestRequest): Promise<CreatePullRequestResult> {
    uxLog("warning", this, c.yellow(`[GitProvider] createPullRequest is not yet implemented on ${this.getLabel()}`));
    return { created: false, pullRequestUrl: null, providerResult: { error: "Not implemented in sfdx-hardis" } };
  }

  public logAutoFixRemediation(step: "push" | "pr-create"): void {
    const stepLabel = step === "push" ? "git push" : "pull request creation";
    uxLog("log", this, `\n[sfdx-hardis] Auto-fix ${stepLabel} remediation guide`);
    uxLog("log", this, "1) Update workflow: ensure the CI identity can push branches and create PR/MR.");
    uxLog("log", this, "2) Set provider token variable: GitHub=GITHUB_TOKEN, GitLab=CI_SFDX_HARDIS_GITLAB_TOKEN, Azure=SYSTEM_ACCESSTOKEN/CI_SFDX_HARDIS_AZURE_TOKEN, Bitbucket=CI_SFDX_HARDIS_BITBUCKET_TOKEN.");
    uxLog("log", this, "3) How to get value: create a CI service token/PAT with repository write + pull request/merge request permissions, then store it as a masked secret variable.");
  }
  /* jscpd:ignore-start */
  // Do not make crash the whole process in case there is an issue with integration
  public async tryPostPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    let prResult: PullRequestMessageResult | null = null;
    try {
      prResult = await this.postPullRequestMessage(prMessage);
    } catch (e) {
      uxLog("warning", this, c.yellow(`[GitProvider] Error while trying to post pull request message.\n${(e as Error).message}\n${(e as Error).stack}`));
      prResult = { posted: false, providerResult: { error: e } };
    }
    return prResult;
  }
  /* jscpd:ignore-end */

  public async uploadAndReplaceImageReferences(markdownBody: string, sourceFile: string | null = null): Promise<string> {
    const replacements: any = {};
    const markdownImages = extractImagesFromMarkdown(markdownBody, sourceFile);
    for (const image of markdownImages) {
      let imageUrl: string | null = null;
      try {
        imageUrl = await this.uploadImage(image.path);
      } catch (e) {
        uxLog("warning", this, c.yellow(`[GitProvider] Error while trying to upload image ${image.path}.\n${(e as Error).message}\n${(e as Error).stack}`));
      }
      if (imageUrl) {
        replacements[image.name] = imageUrl;
      }
    }
    markdownBody = replaceImagesInMarkdown(markdownBody, replacements);
    return markdownBody;
  }

  protected completeWithCustomBehaviors(pullRequestInfo: CommonPullRequestInfo): CommonPullRequestInfo {
    const desc = pullRequestInfo.description || "";
    if (desc.includes("NO_DELTA")
      || getEnvVar("NO_DELTA") === "true"
      || getEnvVar("NO_DELTA_" + pullRequestInfo.targetBranch) === "true"
    ) {
      pullRequestInfo.customBehaviors.noDeltaDeployment = true;
    }
    if (desc.includes("PURGE_FLOW_VERSIONS")
      || getEnvVar("PURGE_FLOW_VERSIONS") === "true"
      || getEnvVar("PURGE_FLOW_VERSIONS_" + pullRequestInfo.targetBranch) === "true"
    ) {
      pullRequestInfo.customBehaviors.purgeFlowVersions = true;
    }
    if (desc.includes("DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT")
      || getEnvVar("DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT") === "true"
      || getEnvVar("DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT_" + pullRequestInfo.targetBranch) === "true"
    ) {
      pullRequestInfo.customBehaviors.destructiveChangesAfterDeployment = true;
    }
    if (hasAffirmativeFlowInterviewDeletionDirective(desc)
      || getEnvVar("FLOW_DELETE_INTERVIEWS") === "true"
      || getEnvVar("FLOW_DELETE_INTERVIEWS_" + pullRequestInfo.targetBranch) === "true"
    ) {
      pullRequestInfo.customBehaviors.flowDeleteInterviews = true;
    }
    return pullRequestInfo;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async findOpenPullRequest(sourceBranch: string, targetBranch: string): Promise<{ pullRequestUrl: string; id: any } | null> {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async updatePullRequestDescription(id: any, title: string, body: string): Promise<void> {
    // Default no-op - providers may override
  }

  // Resolve a CI actor identifier (a GitHub login, a Bitbucket account UUID) into a real
  // identity, so notifications can name the person who triggered a run. Best-effort by design:
  // callers must tolerate null and fall back to another source.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async resolveUserIdentity(identifier: string): Promise<{ name: string | null; email: string | null } | null> {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async getPullRequestCommentByMarker(marker: string, prNumber?: number): Promise<string | null> {
    uxLog("other", this, `Method getPullRequestCommentByMarker is not implemented yet on ${this.getLabel()}`);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async upsertPullRequestCommentByMarker(marker: string, body: string, prNumber?: number): Promise<void> {
    uxLog("other", this, `Method upsertPullRequestCommentByMarker is not implemented yet on ${this.getLabel()} for marker ${marker} body length ${body.length}`);
  }

  // Returns ALL the comments of a Pull Request containing the marker, with an opaque
  // provider-specific ref so the caller can update a precise comment later.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async listPullRequestCommentsByMarker(marker: string, prNumber?: number): Promise<PullRequestCommentRef[]> {
    uxLog("other", this, `Method listPullRequestCommentsByMarker is not implemented yet on ${this.getLabel()}`);
    return [];
  }

  // Updates the body of one precise comment, identified by the ref returned by
  // listPullRequestCommentsByMarker.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async updatePullRequestCommentByRef(commentRef: PullRequestCommentRef, body: string): Promise<void> {
    uxLog("other", this, `Method updatePullRequestCommentByRef is not implemented yet on ${this.getLabel()}`);
  }
}

// Opaque handle on a precise Pull Request comment: `ref` is provider-specific
// (thread/comment ids on Azure, comment id on GitHub/Bitbucket, note id on GitLab).
export declare type PullRequestCommentRef = {
  prNumber: number;
  ref: any;
  body: string;
  // Permalink of the comment, used to navigate from one sfdx-hardis comment to another.
  // Empty when the provider cannot build it.
  url?: string;
};
