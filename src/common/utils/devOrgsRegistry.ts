import c from 'chalk';
import { Org } from '@salesforce/core';
import { CONSTANTS, getConfig } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { DashboardRef, GitProviderRoot } from '../gitProvider/gitProviderRoot.js';
import { git, isCI, uxLog } from './index.js';
import { t } from './i18n.js';
import { findOrCreateDashboard, replaceDashboard } from './dashboardDataUtils.js';
import { getBackpromoteTargetOrgInfo } from './backpromoteOrgUtils.js';
import { isVehicleMerge } from './backpromoteUtils.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { parsePromotionPullRequestIds } from './promotionBranchUtils.js';
import { getPullRequestScopeInfo } from './pullRequestUtils.js';
import {
  analyzeDevOrgComments,
  applyDevOrgRegistration,
  branchWindowStart,
  buildBranchMerges,
  buildDevOrgCommentBody,
  buildDevOrgRemoval,
  buildDevOrgsDashboardBody,
  buildDevOrgsSummary,
  DEV_ORGS_DASHBOARD_TITLE,
  DEV_ORGS_DEFAULT_STALE_DAYS,
  DevOrgBranchData,
  DevOrgBranchMerge,
  DevOrgCarriedPullRequest,
  DevOrgComment,
  DevOrgCommentData,
  DevOrgData,
  DevOrgIdentity,
  DevOrgLastBackpromote,
  DevOrgPerson,
  DevOrgRegistration,
  DevOrgRegistrationResult,
  DevOrgsState,
  DevOrgsSummary,
  devOrgDisplayName,
  findDevOrg,
  findRefreshedSandbox,
  parseDevOrgComment,
} from './devOrgsRules.js';

export const DEV_ORGS_DOC_URL = `${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-dev-orgs/`;

export interface LoadedDevOrgs {
  dashboard: DashboardRef;
  comments: DevOrgComment[];
  state: DevOrgsState;
}

export interface DevOrgUsage {
  username: string;
  alias?: string | null;
  // The target branch of the User Story
  targetBranch: string | null;
  featureBranch?: string | null;
  // The owner of a sandbox just created (else the person running the command owns a new entry)
  owner?: DevOrgPerson | null;
  lastBackpromote?: DevOrgLastBackpromote | null;
  // False when the person running the command is not a user of the org (a release manager
  // creating a sandbox for somebody else)
  addCurrentUser?: boolean;
  commandThis: any;
}

/**
 * Registers the org a command works with: work:new, work:save, work:backpromote, org:create.
 * Never fails the command: the registry is a help, not a step of the User Story.
 */
export async function registerDevOrgUsage(usage: DevOrgUsage): Promise<DevOrgRegistrationResult | null> {
  if (!(await isDevOrgsRegistryEnabled())) {
    return null;
  }
  let displayName = usage.alias || usage.username;
  try {
    const identity = await getDevOrgIdentity(usage.username, usage.alias || null);
    if (!identity) {
      uxLog("log", usage.commandThis, c.grey(t('devOrgRegistrationRefused', { name: displayName })));
      return null;
    }
    displayName = devOrgDisplayName(identity);
    const registry = await DevOrgsRegistry.open();
    if (!registry) {
      uxLog("warning", usage.commandThis, c.yellow(t('devOrgRegistrationSkippedNoToken', { name: displayName, docUrl: DEV_ORGS_DOC_URL })));
      return null;
    }
    uxLog("log", usage.commandThis, c.grey(t('devOrgRegistering', { name: displayName })));
    const currentUser = await getCurrentGitUser();
    const result = await registry.register(
      {
        org: identity,
        targetBranch: usage.targetBranch,
        featureBranch: usage.featureBranch || null,
        currentUser,
        addCurrentUser: usage.addCurrentUser !== false,
        owner: usage.owner || undefined,
        lastBackpromote: usage.lastBackpromote || null,
        touchActivity: true,
      },
      { fullCleanup: isCI }
    );
    if (result.otherTargetBranch) {
      uxLog("warning", usage.commandThis, c.yellow(t('devOrgOtherTargetBranch', { name: displayName, registeredBranch: result.otherTargetBranch, branch: usage.targetBranch || '' })));
    }
    if (result.changed) {
      uxLog("log", usage.commandThis, c.grey(t('devOrgRegistered', { name: displayName, branch: result.data.targetBranch })));
    }
    return result;
  } catch (e) {
    uxLog("warning", usage.commandThis, c.yellow(t('devOrgRegistrationFailed', { name: displayName, message: (e as Error).message })));
    return null;
  }
}

/**
 * Deployment job after a merge into a major branch: lists again the Pull Requests merged into it
 * for the orgs that target it. Costs one call when no dev org was ever registered (no dashboard),
 * and never fails the job.
 */
export async function updateDevOrgsAfterMerge(branch: string, commandThis: any): Promise<void> {
  try {
    if (!branch || !(await isDevOrgsRegistryEnabled())) {
      return;
    }
    const registry = await DevOrgsRegistry.open();
    if (!registry) {
      return;
    }
    const loaded = await registry.load(false);
    if (!loaded) {
      return;
    }
    if (!loaded.state.orgs.some((org) => org.data.targetBranch === branch)) {
      return;
    }
    await registry.refreshBranches({ branches: [branch], jobUrl: await getJobUrl(), carried: await currentMergeCarried(branch), fullCleanup: true });
    uxLog("log", commandThis, c.grey(t('devOrgsDashboardUpdated', { url: registry.dashboardUrl() })));
  } catch (e) {
    uxLog("log", commandThis, c.grey(t('devOrgsDashboardNotUpdated', { message: (e as Error).message })));
  }
}

export async function isDevOrgsRegistryEnabled(): Promise<boolean> {
  const config = await getConfig('branch');
  return config.enableDevOrgsRegistry !== false;
}

export async function getDevOrgsStaleDays(): Promise<number> {
  const config = await getConfig('branch');
  const value = Number(config.devOrgsStaleDays);
  return Number.isFinite(value) && value > 0 ? value : DEV_ORGS_DEFAULT_STALE_DAYS;
}

/** The git user of the checkout, or the email sfdx-hardis already asked for */
export async function getCurrentGitUser(): Promise<DevOrgPerson | null> {
  const read = async (key: string) => {
    try {
      return (await git({ output: false, displayCommand: false }).raw(['config', key])).trim();
    } catch {
      return '';
    }
  };
  const email = (await read('user.email')) || String((await getConfig('user')).userEmail || '');
  if (!email) {
    return null;
  }
  return { name: (await read('user.name')) || email, email };
}

/** What the registry knows an org by. Null for a production org or the org of a major branch. */
export async function getDevOrgIdentity(username: string, alias: string | null): Promise<DevOrgIdentity | null> {
  const org = await Org.create({ aliasOrUsername: username });
  const conn = org.getConnection();
  const info = await getBackpromoteTargetOrgInfo({ conn, username: conn.getUsername() || username, alias, tracksSource: false, sandboxNameOverride: null });
  if (info.refusal || info.orgType === 'production') {
    return null;
  }
  return {
    orgId: info.orgId,
    orgType: info.orgType,
    sandboxName: info.sandboxName,
    alias: info.alias,
    instanceUrl: info.instanceUrl,
    expirationDate: info.expirationDate || null,
  };
}

/**
 * The "Development Orgs Dashboard" of the git provider: an issue (GitHub, GitLab), a work item
 * (Azure DevOps) or a dedicated Pull Request (Bitbucket). One comment per org and one per target
 * branch; the body is rebuilt from them at every write.
 */
export class DevOrgsRegistry {
  private dashboard: DashboardRef | null = null;

  // gitProvider: given by tests. The provider of the repository is detected otherwise.
  constructor(private gitProvider: GitProviderRoot) { }

  /** Null when the git provider cannot hold a dashboard, or no token is available */
  static async open(gitProvider: GitProviderRoot | null = null): Promise<DevOrgsRegistry | null> {
    const provider = gitProvider || (await GitProvider.getInstance());
    if (!provider || !provider.supportsDashboard()) {
      return null;
    }
    return new DevOrgsRegistry(provider);
  }

  dashboardUrl(): string | null {
    return this.dashboard?.url || null;
  }

  async load(create: boolean): Promise<LoadedDevOrgs | null> {
    const dashboard = await this.getDashboard(create);
    if (!dashboard) {
      return null;
    }
    const comments = (await this.gitProvider.listDashboardComments(dashboard))
      .map((comment) => parseDevOrgComment(comment))
      .filter((comment): comment is DevOrgComment => comment !== null);
    return { dashboard, comments, state: analyzeDevOrgComments(comments) };
  }

  async summary(options: { currentUser: DevOrgPerson | null; staleDays: number; warnings?: string[] }): Promise<DevOrgsSummary> {
    const loaded = await this.load(false);
    return buildDevOrgsSummary(loaded?.state || analyzeDevOrgComments([]), {
      enabled: true,
      dashboardUrl: loaded?.dashboard.url || null,
      currentUser: options.currentUser,
      staleDays: options.staleDays,
      warnings: options.warnings,
    });
  }

  /**
   * Creates or updates the entry of an org. The new comment is written before the old ones are
   * deleted: a delete that fails (a comment of another account) loses nothing.
   */
  async register(registration: DevOrgRegistration, options: { fullCleanup?: boolean } = {}): Promise<DevOrgRegistrationResult> {
    const loaded = (await this.load(true))!;
    const existing = findDevOrg(loaded.state, registration.org.orgId);
    const refreshed = existing ? null : findRefreshedSandbox(loaded.state, registration.org);
    const result = applyDevOrgRegistration(existing?.data || null, registration);
    if (!result.data.targetBranch) {
      throw new Error(t('devOrgTargetBranchMissing', { name: result.data.name }));
    }
    if (!result.changed) {
      return result;
    }
    const replaced = loaded.comments.filter(
      (comment) => comment.data.kind === 'org' && (comment.data.orgId === registration.org.orgId || comment.data.orgId === refreshed?.data.orgId)
    );
    await this.gitProvider.createDashboardComment(loaded.dashboard, this.commentBody(result.data));
    if (refreshed) {
      uxLog("log", this, c.grey(t('devOrgRefreshedSandboxReplaced', { name: result.data.name })));
    }
    await this.deleteComments(loaded.dashboard, replaced);
    await this.afterWrite(options.fullCleanup === true);
    return result;
  }

  /** Writes a removal comment, then deletes what it can. Null when the org is not registered. */
  async remove(orgId: string, currentUser: DevOrgPerson | null): Promise<DevOrgData | null> {
    const loaded = await this.load(false);
    const existing = loaded ? findDevOrg(loaded.state, orgId) : null;
    if (!loaded || !existing) {
      return null;
    }
    const removalId = await this.gitProvider.createDashboardComment(loaded.dashboard, this.commentBody(buildDevOrgRemoval(existing.data, currentUser)));
    const group = loaded.comments.filter((comment) => comment.data.kind === 'org' && comment.data.orgId === orgId);
    // The removal comment only goes once nothing it hides is left
    if (await this.deleteComments(loaded.dashboard, group)) {
      await this.gitProvider.deleteDashboardComment(loaded.dashboard, removalId).catch(() => false);
    }
    await this.afterWrite(true);
    return existing.data;
  }

  /**
   * Lists again the Pull Requests merged into the target branches of the registered orgs, and
   * writes one comment per branch. `carried` completes a vehicle merge with what it brought.
   */
  async refreshBranches(options: {
    branches?: string[];
    jobUrl: string | null;
    carried?: { number: number; pullRequests: DevOrgCarriedPullRequest[] } | null;
    fullCleanup?: boolean;
    commandThis?: any;
  }): Promise<string[]> {
    const loaded = await this.load(false);
    if (!loaded) {
      return [];
    }
    const majorBranchNames = (await listMajorOrgs()).map((majorOrg: any) => majorOrg.branchName).filter(Boolean);
    const targetBranches = [...new Set(loaded.state.orgs.map((org) => org.data.targetBranch))].filter(
      (branch) => branch && (!options.branches || options.branches.includes(branch))
    );
    const warnings: string[] = [];
    for (const branch of targetBranches) {
      const window = branchWindowStart(loaded.state.orgs.filter((org) => org.data.targetBranch === branch).map((org) => org.data));
      uxLog("log", options.commandThis || this, c.grey(t('devOrgsRefreshing', { branch, date: window.since.slice(0, 10) })));
      const pullRequests = await this.gitProvider.listPullRequests({
        status: 'merged',
        targetBranch: branch,
        minDate: new Date(window.since),
        minDateOn: 'merged',
        withoutComments: true,
      });
      if (pullRequests === null) {
        warnings.push(t('devOrgsMergedPullRequestsUnavailable', { branch }));
        continue;
      }
      const merged: DevOrgBranchMerge[] = pullRequests
        .filter((pr) => pr.mergedDate)
        .map((pr) => {
          const vehicle = isVehicleMerge([pr.sourceBranch], majorBranchNames);
          let carried: DevOrgCarriedPullRequest[] | null = null;
          if (options.carried && options.carried.number === pr.idNumber) {
            carried = options.carried.pullRequests;
          } else if (vehicle) {
            const declared = parsePromotionPullRequestIds(pr.description);
            carried = declared ? declared.map((number) => ({ number, title: '', url: '' })) : null;
          }
          return { number: pr.idNumber, title: pr.title, url: pr.webUrl, mergedAt: pr.mergedDate!, sourceBranch: pr.sourceBranch, vehicle, carried };
        });
      const previous = loaded.state.branches.get(branch);
      const data: DevOrgBranchData = {
        v: 1,
        kind: 'branch',
        branch,
        since: window.since,
        capped: window.capped,
        computedAt: new Date().toISOString(),
        jobUrl: options.jobUrl,
        merges: buildBranchMerges(merged, previous?.data, window.since),
      };
      await this.gitProvider.createDashboardComment(loaded.dashboard, this.commentBody(data));
      if (previous) {
        await this.deleteComments(loaded.dashboard, [previous]);
      }
    }
    await this.afterWrite(options.fullCleanup === true);
    return warnings;
  }

  // Comments superseded, removed orgs, expired scratch orgs: deleted when this account may, and
  // ignored by every reader otherwise. True when every one of them is gone.
  private async deleteComments(dashboard: DashboardRef, comments: DevOrgComment[]): Promise<boolean> {
    let allDeleted = true;
    for (const comment of comments) {
      try {
        await this.gitProvider.deleteDashboardComment(dashboard, comment.id);
      } catch {
        allDeleted = false;
      }
    }
    return allDeleted;
  }

  private async afterWrite(fullCleanup: boolean): Promise<void> {
    if (fullCleanup) {
      await this.cleanup();
    }
    if (this.dashboard && (await this.gitProvider.isDashboardWornOut(this.dashboard))) {
      uxLog("log", this, c.grey(t('devOrgsDashboardRollover')));
      const oldDashboard = this.dashboard;
      this.dashboard = await replaceDashboard<DevOrgComment>({
        provider: this.gitProvider,
        oldDashboard,
        createEmpty: () => this.createEmptyDashboard(),
        // Only what is still true is copied
        listComments: async (dashboard) => {
          const comments = (await this.gitProvider.listDashboardComments(dashboard))
            .map((comment) => parseDevOrgComment(comment))
            .filter((comment): comment is DevOrgComment => comment !== null);
          const obsolete = new Set(analyzeDevOrgComments(comments).obsolete.map((comment) => comment.id));
          return comments.filter((comment) => !obsolete.has(comment.id));
        },
        copyBody: (comment) => this.commentBody(comment.data),
      });
    }
    await this.refreshDashboardBody();
  }

  // A removal comment is deleted last, and only once every comment it hides is gone
  private async cleanup(): Promise<void> {
    const loaded = await this.load(false);
    if (!loaded) {
      return;
    }
    const removals = loaded.state.obsolete.filter((comment) => comment.data.kind === 'org' && comment.data.removed);
    const others = loaded.state.obsolete.filter((comment) => !removals.includes(comment));
    const failedOrgIds = new Set<string>();
    for (const comment of others) {
      if (!(await this.deleteComments(loaded.dashboard, [comment])) && comment.data.kind === 'org') {
        failedOrgIds.add(comment.data.orgId);
      }
    }
    for (const removal of removals) {
      if (!failedOrgIds.has((removal.data as DevOrgData).orgId)) {
        await this.deleteComments(loaded.dashboard, [removal]);
      }
    }
  }

  // Never fails the caller: the body is a display, the comments are the registry
  private async refreshDashboardBody(): Promise<void> {
    try {
      const dashboard = await this.getDashboard(false);
      if (!dashboard) {
        return;
      }
      const summary = await this.summary({ currentUser: null, staleDays: await getDevOrgsStaleDays() });
      await this.gitProvider.updateDashboardBody(dashboard, this.dashboardTitle(), buildDevOrgsDashboardBody(summary, this.gitProvider.getDashboardFormat()));
    } catch (e) {
      uxLog("log", this, c.grey(t('devOrgsDashboardNotUpdated', { message: (e as Error).message })));
    }
  }

  private async getDashboard(create: boolean): Promise<DashboardRef | null> {
    if (!this.dashboard) {
      this.dashboard = await findOrCreateDashboard(this.gitProvider, this.dashboardTitle(), create, () => this.createEmptyDashboard());
    }
    return this.dashboard;
  }

  private async createEmptyDashboard(): Promise<DashboardRef> {
    const emptySummary = buildDevOrgsSummary(analyzeDevOrgComments([]), { enabled: true, dashboardUrl: null, currentUser: null, staleDays: await getDevOrgsStaleDays() });
    return this.gitProvider.createDashboard(this.dashboardTitle(), buildDevOrgsDashboardBody(emptySummary, this.gitProvider.getDashboardFormat()));
  }

  private dashboardTitle(): string {
    return this.gitProvider.getDashboardTitle(DEV_ORGS_DASHBOARD_TITLE);
  }

  private commentBody(data: DevOrgCommentData): string {
    return buildDevOrgCommentBody(data, this.gitProvider.getDashboardFormat());
  }
}

// What the merge of this deployment job brought, when deploy:smart computed its scope: a vehicle
// merge (a major branch, a promotion) carries the User Stories of that scope
async function currentMergeCarried(branch: string): Promise<{ number: number; pullRequests: DevOrgCarriedPullRequest[] } | null> {
  const scope = getPullRequestScopeInfo();
  const merged = await GitProvider.getPullRequestInfo({ useCache: true }).catch(() => null);
  if (!scope || !merged || merged.targetBranch !== branch) {
    return null;
  }
  return {
    number: merged.idNumber,
    pullRequests: scope.pullRequests
      .filter((pr) => pr.idNumber !== merged.idNumber)
      .map((pr) => ({ number: pr.idNumber, title: pr.title, url: pr.webUrl })),
  };
}

async function getJobUrl(): Promise<string | null> {
  try {
    return (await GitProvider.getJobUrl()) || null;
  } catch {
    return null;
  }
}
