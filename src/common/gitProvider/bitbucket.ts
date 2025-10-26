import { GitProviderRoot } from './gitProviderRoot.js';
import c from 'chalk';
import fs from "fs-extra";
import FormData from 'form-data'
import * as path from "path";
import { CommonPullRequestInfo, PullRequestMessageRequest, PullRequestMessageResult } from './index.js';
import { git, uxLog } from '../utils/index.js';
import bbPkg, { Schema } from 'bitbucket';
import { CONSTANTS } from '../../config/index.js';
const { Bitbucket } = bbPkg;

export class BitbucketProvider extends GitProviderRoot {
  private bitbucket: InstanceType<typeof Bitbucket>;
  public serverUrl: string = 'https://bitbucket.org';
  public token: string;

  constructor() {
    super();
    this.token = process.env.CI_SFDX_HARDIS_BITBUCKET_TOKEN || '';
    const clientOptions = { auth: { token: this.token } };
    this.bitbucket = new Bitbucket(clientOptions);
  }

  public getLabel(): string {
    return 'sfdx-hardis Bitbucket connector';
  }

  public async getCurrentJobUrl(): Promise<string | null> {
    if (process.env.PIPELINE_JOB_URL) {
      return process.env.PIPELINE_JOB_URL;
    }
    if (process.env.BITBUCKET_WORKSPACE && process.env.BITBUCKET_REPO_SLUG && process.env.BITBUCKET_BUILD_NUMBER) {
      const jobUrl = `${this.serverUrl}/${process.env.BITBUCKET_WORKSPACE}/${process.env.BITBUCKET_REPO_SLUG}/pipelines/results/${process.env.BITBUCKET_BUILD_NUMBER}`;
      return jobUrl;
    }
    uxLog(
      "warning",
      this,
      c.yellow(`[Bitbucket Integration] You need the following variables to be accessible to sfdx-hardis to build current job url:
        - BITBUCKET_WORKSPACE
        - BITBUCKET_REPO_SLUG
        - BITBUCKET_BUILD_NUMBER`)
    );

    return null;
  }

  public async getCurrentBranchUrl(): Promise<string | null> {
    if (process.env.BITBUCKET_WORKSPACE && process.env.BITBUCKET_REPO_SLUG && process.env.BITBUCKET_BRANCH) {
      const currentBranchUrl = `${this.serverUrl}/${process.env.BITBUCKET_WORKSPACE}/${process.env.BITBUCKET_REPO_SLUG}/branch/${process.env.BITBUCKET_BRANCH}`;
      return currentBranchUrl;
    }
    uxLog(
      "warning",
      this,
      c.yellow(`[Bitbucket Integration] You need the following variables to be accessible to sfdx-hardis to build current job url:
        - BITBUCKET_WORKSPACE
        - BITBUCKET_REPO_SLUG
        - BITBUCKET_BRANCH`)
    );

    return null;
  }

  // Bitbucket does not supports mermaid in PR markdown
  public async supportsMermaidInPrMarkdown(): Promise<boolean> {
    return false;
  }

  // Find pull request info
  public async getPullRequestInfo(): Promise<CommonPullRequestInfo | null> {
    const pullRequestIdStr = process.env.BITBUCKET_PR_ID || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;

    // Case when PR is found in the context
    if (pullRequestIdStr !== null) {
      const pullRequestId = Number(pullRequestIdStr);
      const pullRequest = await this.bitbucket.repositories.getPullRequest({
        pull_request_id: pullRequestId,
        repo_slug: repoSlug || '',
        workspace: workspace || '',
      });

      if (pullRequest?.data.destination) {
        // Add cross git provider properties used by sfdx-hardis
        return this.completePullRequestInfo(pullRequest.data);
      } else {
        uxLog("warning", this, c.yellow(`[Bitbucket Integration] Warning: incomplete PR found (id: ${pullRequestIdStr})`));
        uxLog("log", this, c.grey(JSON.stringify(pullRequest || {})));
      }
    }

    // Case when we find PR from a commit
    const sha = await git().revparse(['HEAD']);
    try {
      // Note: listPullrequestsForCommit API can be unreliable - it requires the "Pull Request Commit Links" app to be installed
      // See: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/#api-repositories-workspace-repo-slug-commit-commit-pullrequests-get
      const latestPullRequestsOnBranch = await this.bitbucket.repositories.listPullrequestsForCommit({
        workspace: workspace || '',
        repo_slug: repoSlug || '',
        commit: sha,
      });
      const latestMergedPullRequestOnBranch = latestPullRequestsOnBranch?.data?.values?.filter(
        (pr) => pr.state === 'MERGED' && pr.merge_commit?.hash === sha
      );
      if (latestMergedPullRequestOnBranch?.length && latestMergedPullRequestOnBranch?.length > 0) {
        const pullRequest = latestMergedPullRequestOnBranch[0];
        // Add cross git provider properties used by sfdx-hardis
        return this.completePullRequestInfo(pullRequest);
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(`[Bitbucket Integration] Unable to retrieve pull requests for commit ${sha}: ${(e as Error).message}`));
      uxLog("log", this, c.grey(`[Bitbucket Integration] Note: This API requires the "Pull Request Commit Links" Bitbucket app to be installed on the repository.`));
    }

    uxLog("log", this, c.grey(`[Bitbucket Integration] Unable to find related Pull Request Info`));
    return null;
  }

  public async getBranchDeploymentCheckId(gitBranch: string): Promise<string | null> {
    let deploymentCheckId: string | null = null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;
    const latestMergedPullRequestsOnBranch = await this.bitbucket.repositories.listPullRequests({
      repo_slug: repoSlug || '',
      workspace: workspace || '',
      state: 'MERGED',
      q: `destination.branch.name = "${gitBranch}"`,
      sort: '-updated_on',
    });
    if (
      latestMergedPullRequestsOnBranch?.data?.values?.length &&
      latestMergedPullRequestsOnBranch?.data?.values?.length > 0
    ) {
      const latestPullRequest = latestMergedPullRequestsOnBranch?.data?.values[0];
      const latestPullRequestId = latestPullRequest.id;
      deploymentCheckId = await this.getDeploymentIdFromPullRequest(
        latestPullRequestId || 0,
        repoSlug || '',
        workspace || '',
        deploymentCheckId,
        this.completePullRequestInfo(latestPullRequest)
      );
    }

    return deploymentCheckId;
  }

  public async getPullRequestDeploymentCheckId(): Promise<string | null> {
    const pullRequestInfo = await this.getPullRequestInfo();
    if (pullRequestInfo) {
      const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
      const workspace = process.env.BITBUCKET_WORKSPACE || null;
      return await this.getDeploymentIdFromPullRequest(
        pullRequestInfo.idNumber || 0,
        repoSlug || '',
        workspace || '',
        null,
        pullRequestInfo
      );
    }
    return null;
  }

  private async getDeploymentIdFromPullRequest(
    latestPullRequestId: number,
    repoSlug: string,
    workspace: string,
    deploymentCheckId: string | null,
    latestPullRequest: CommonPullRequestInfo
  ): Promise<string | null> {
    const comments = await this.bitbucket.repositories.listPullRequestComments({
      pull_request_id: latestPullRequestId,
      repo_slug: repoSlug,
      workspace: workspace,
    });

    for (const comment of comments?.data?.values || []) {
      if ((comment?.content?.raw || '').includes(`<!-- sfdx-hardis deployment-id `)) {
        const matches = /<!-- sfdx-hardis deployment-id (.*) -->/gm.exec(comment?.content?.raw || '');
        if (matches) {
          deploymentCheckId = matches[1];
          uxLog(
            "log",
            this,
            c.grey(
              `[Bitbucket Integration] Found deployment id ${deploymentCheckId} on PR #${latestPullRequestId} ${latestPullRequest.title}`
            )
          );
          break;
        }
      }
    }
    return deploymentCheckId;
  }

  public async listPullRequestsInBranchSinceLastMerge(
    currentBranchName: string,
    targetBranchName: string,
    childBranchesNames: string[],
  ): Promise<CommonPullRequestInfo[]> {
    if (!this.bitbucket || !process.env.BITBUCKET_WORKSPACE || !process.env.BITBUCKET_REPO_SLUG) {
      return [];
    }

    try {
      const workspace = process.env.BITBUCKET_WORKSPACE;
      const repoSlug = process.env.BITBUCKET_REPO_SLUG;

      // Step 1: Find the last merged PR from currentBranch to targetBranch
      const lastMergeResponse = await this.bitbucket.pullrequests.list({
        workspace,
        repo_slug: repoSlug,
        q: `source.branch.name = "${currentBranchName}" AND destination.branch.name = "${targetBranchName}" AND state = "MERGED"`,
      } as any);

      const lastMergePRs =
        lastMergeResponse &&
          lastMergeResponse.data &&
          lastMergeResponse.data.values
          ? lastMergeResponse.data.values
          : [];
      const lastMergeToTarget =
        lastMergePRs.length > 0 ? lastMergePRs[0] : null;

      // Step 2: Get commits between branches
      const commitsResponse = await this.bitbucket.commits.list({
        workspace,
        repo_slug: repoSlug,
        include: currentBranchName,
        exclude: lastMergeToTarget
          ? lastMergeToTarget.merge_commit?.hash
          : targetBranchName,
      } as any);

      const commits =
        commitsResponse &&
          commitsResponse.data &&
          commitsResponse.data.values
          ? commitsResponse.data.values
          : [];

      if (commits.length === 0) {
        return [];
      }

      const commitHashes = new Set(commits.map((c: any) => c.hash));

      // Step 3: Get all merged PRs targeting currentBranch and child branches (parallelized)
      const allBranches = [currentBranchName, ...childBranchesNames];

      const prPromises = allBranches.map(async (branchName) => {
        try {
          const response = await this.bitbucket.pullrequests.list({
            workspace,
            repo_slug: repoSlug,
            q: `destination.branch.name = "${branchName}" AND state = "MERGED"`,
          } as any);

          const values =
            response && response.data && response.data.values
              ? response.data.values
              : [];
          return values;
        } catch (err) {
          uxLog(
            "warning",
            this,
            c.yellow(`Error fetching merged PRs for branch ${branchName}: ${String(err)}`),
          );
          return [];
        }
      });

      const prResults = await Promise.all(prPromises);
      const allMergedPRs: any[] = prResults.flat();

      // Step 4: Filter PRs whose merge commit is in our commit list
      const relevantPRs = allMergedPRs.filter((pr) => {
        const mergeCommitHash = pr.merge_commit?.hash;
        return mergeCommitHash && commitHashes.has(mergeCommitHash);
      });

      // Step 5: Remove duplicates
      const uniquePRsMap = new Map();
      for (const pr of relevantPRs) {
        if (!uniquePRsMap.has(pr.id)) {
          uniquePRsMap.set(pr.id, pr);
        }
      }

      // Step 6: Convert to CommonPullRequestInfo
      return Array.from(uniquePRsMap.values()).map((pr) =>
        this.completePullRequestInfo(pr)
      );
    } catch (err) {
      uxLog(
        "warning",
        this,
        c.yellow(`Error in listPullRequestsInBranchSinceLastMerge: ${String(err)}`),
      );
      return [];
    }
  }

  public async postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult> {
    const prInfo = await this.getPullRequestInfo();
    const pullRequestIdStr = process.env.BITBUCKET_PR_ID || prInfo?.idStr || null;
    const repoSlug = process.env.BITBUCKET_REPO_SLUG || null;
    const workspace = process.env.BITBUCKET_WORKSPACE || null;

    if (repoSlug == null || pullRequestIdStr == null) {
      uxLog("log", this, c.grey('[Bitbucket integration] No repo and pull request, so no note posted...'));
      return { posted: false, providerResult: { info: 'No related pull request' } };
    }
    const pullRequestId = Number(pullRequestIdStr);
    const bitbucketBuildNumber = process.env.BITBUCKET_BUILD_NUMBER || null;
    const bitbucketJobUrl = await this.getCurrentJobUrl();

    const messageKey = `${prMessage.messageKey}-${pullRequestId}`;
    let messageBody = `## ${prMessage.title || ''}

        ${prMessage.message}
        
        \n_Powered by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) from job [${bitbucketBuildNumber}](${bitbucketJobUrl})_
        \n<!-- sfdx-hardis message-key ${messageKey} -->
        `;

    // Add deployment id if present
    if (globalThis.pullRequestDeploymentId) {
      messageBody += `\n<!-- sfdx-hardis deployment-id ${globalThis.pullRequestDeploymentId} -->`;
    }

    messageBody = await this.uploadAndReplaceImageReferences(messageBody, prMessage.sourceFile || "");

    const commentBody: any = {
      content: {
        raw: messageBody,
      },
    };

    // Check for existing comment from a previous run
    uxLog("log", this, c.grey('[Bitbucket integration] Listing comments of Pull Request...'));
    const existingComments = await this.bitbucket.repositories.listPullRequestComments({
      pull_request_id: pullRequestId,
      repo_slug: repoSlug,
      workspace: workspace || '',
    });
    let existingCommentId: number | null = null;
    for (const existingComment of existingComments?.data?.values || []) {
      if (
        existingComment?.content?.raw &&
        existingComment?.content.raw?.includes(`<!-- sfdx-hardis message-key ${messageKey} -->`)
      ) {
        existingCommentId = existingComment.id || null;
      }
    }

    // Create or update MR comment
    if (existingCommentId) {
      // Update existing comment
      uxLog("log", this, c.grey('[Bitbucket integration] Updating Pull Request Comment on Bitbucket...'));
      const pullRequestComment = await this.bitbucket.repositories.updatePullRequestComment({
        workspace: workspace || '',
        repo_slug: repoSlug,
        pull_request_id: pullRequestId,
        comment_id: existingCommentId,
        _body: commentBody,
      });

      const prResult: PullRequestMessageResult = {
        posted: (pullRequestComment?.data?.id || -1) > 0,
        providerResult: pullRequestComment,
      };
      uxLog("log", this, c.grey(`[Bitbucket integration] Updated Pull Request comment ${existingCommentId}`));
      return prResult;
    } else {
      // Create new comment if no existing comment was found
      uxLog("log", this, c.grey('[Bitbucket integration] Adding Pull Request Comment on Bitbucket...'));

      const pullRequestComment = await this.bitbucket.repositories.createPullRequestComment({
        workspace: workspace || '',
        repo_slug: repoSlug,
        pull_request_id: pullRequestId,
        _body: commentBody,
      });

      const prResult: PullRequestMessageResult = {
        posted: (pullRequestComment?.data?.id || -1) > 0,
        providerResult: pullRequestComment,
      };
      if (prResult.posted) {
        uxLog("log", this, c.grey(`[Bitbucket integration] Posted Pull Request comment on ${pullRequestId}`));
      } else {
        uxLog("warning", this, c.yellow(`[Bitbucket integration] Unable to post Pull Request comment on ${pullRequestId}:\n${JSON.stringify(pullRequestComment, null, 2)}`));
      }
      return prResult;
    }
  }

  private completePullRequestInfo(prData: Schema.Pullrequest): CommonPullRequestInfo {
    const prInfo: CommonPullRequestInfo = {
      idNumber: prData?.id || 0,
      idStr: prData.id ? prData?.id?.toString() : '',
      sourceBranch: prData?.source?.branch?.name || '',
      targetBranch: prData?.destination?.branch?.name || '',
      title: prData?.rendered?.title?.raw || prData?.rendered?.title?.markup || prData?.rendered?.title?.html || '',
      description: prData?.rendered?.description?.raw || prData?.rendered?.description?.markup || prData?.rendered?.description?.html || '',
      webUrl: prData?.links?.html?.href || '',
      authorName: prData?.author?.display_name || '',
      providerInfo: prData,
      customBehaviors: {}
    };
    return this.completeWithCustomBehaviors(prInfo);
  }

  // Upload the image to Bitbucket
  public async uploadImage(localImagePath: string): Promise<string | null> {
    try {
      const imageName = path.basename(localImagePath);
      const filesForm = new FormData();
      filesForm.append("files", fs.createReadStream(localImagePath));
      const attachmentResponse = await this.bitbucket.repositories.createDownload({
        workspace: process.env.BITBUCKET_WORKSPACE || "",
        repo_slug: process.env.BITBUCKET_REPO_SLUG || "",
        _body: filesForm as any,
      });
      if (attachmentResponse) {
        const imageRef = `${this.serverUrl}/${process.env.BITBUCKET_WORKSPACE}/${process.env.BITBUCKET_REPO_SLUG}/downloads/${imageName}`;
        uxLog("log", this, c.grey(`[Bitbucket Integration] Image uploaded for comment: ${imageRef}`));
        return imageRef;
      }
      else {
        uxLog("warning", this, c.yellow(`[Bitbucket Integration] Image uploaded but unable to get URL from response\n${JSON.stringify(attachmentResponse, null, 2)}`));
      }
    } catch (e) {
      uxLog("warning", this, c.yellow(`[Bitbucket Integration] Error while uploading image in downloads section ${localImagePath}\n${(e as Error).message}`));
    }
    return null;
  }


}
