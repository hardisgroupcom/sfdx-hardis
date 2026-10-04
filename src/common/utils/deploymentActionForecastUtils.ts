/*
 * What the next promotion will do with the deployment actions of a branch window: for each action,
 * whether the validation job or the deployment job of the promotion Pull Request runs it, whether
 * it waits for someone, is done already, or does not concern the target branch at all. Read by the
 * "Next promotion" mode of the VS Code Deployment Actions tab, through action:list --forecast.
 */
import { getConfig } from '../../config/index.js';
import { CommonPullRequestInfo, GitProvider } from '../gitProvider/index.js';
import { ActionWhen, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { buildActionTargetBranchCandidates, evaluateActionBranchFilter } from './actionUtils.js';
import { DeploymentActionStateEntry, getActionStateEntry } from './deploymentActionsStateUtils.js';
import { getEffectiveActionContext } from './prePostCommandUtils.js';
import { computeActionIdentityKey, findIdenticalCopies } from './deploymentActionIdentityUtils.js';
import {
  getPromotionBranchConfig,
  isPromotionPullRequestForItsTarget,
  parsePromotionBranchName,
  parsePromotionPullRequestIds,
} from './promotionBranchUtils.js';

export type ActionForecastCode =
  | 'waiting'
  | 'after-merge'
  | 'done'
  | 'runs-at-validation'
  | 'runs-at-deployment'
  | 'failed'
  | 'not-for-branch'
  | 'not-in-promotion'
  | 'moved';

export type ActionForecastReason =
  | 'manual-before-merge'
  | 'manual-after-merge'
  | 'done-in-branch'
  | 'every-deployment'
  | 'deploy-only'
  | 'skipped-by-validation'
  | 'validation-first'
  | 'validation-only'
  | 'branch-filter'
  | 'failed-in-branch'
  | 'stopped-in-branch'
  | 'not-carried'
  | 'moved'
  | 'identical-action';

export interface ActionForecast {
  actionId: string;
  actionLabel: string;
  when: string;
  forecast: ActionForecastCode;
  reason: ActionForecastReason;
  // The status recorded in the target branch, when there is one
  status: DeploymentActionStateEntry['status'] | null;
  date: string;
  jobUrl: string;
  note: string;
  movedTo: number | null;
  // The action of the same job this one runs once with (same type, phase, user and parameters), null
  // when it runs on its own. Its forecast code stays the one of the job, with the identical-action reason.
  identicalTo: { pr: number; actionId: string; actionLabel: string } | null;
}

export interface ActionForecastItem {
  prNumber: number;
  def: PrePostCommand;
  forecast: ActionForecast;
}

export interface PromotionPullRequestInfo {
  number: number;
  title: string;
  webUrl: string;
  sourceBranch: string;
  // The Pull Requests it carries, or null when it carries the whole source branch
  carriedPrIds: number[] | null;
}

/**
 * The open Pull Request promoting sourceBranch to targetBranch: from the source branch itself, or
 * from a promotion branch of it. There is one at a time; when there are several by accident, the
 * latest one. Null when there is none, or when the provider cannot tell.
 */
export async function findOpenPromotionPullRequest(sourceBranch: string, targetBranch: string): Promise<PromotionPullRequestInfo | null> {
  const openPullRequests = await GitProvider.listOpenPullRequests(targetBranch);
  if (!openPullRequests || openPullRequests.length === 0) {
    return null;
  }
  const config = getPromotionBranchConfig(await getConfig('project'));
  const candidates = openPullRequests.filter((pr) => isPromotionOf(pr, sourceBranch));
  if (candidates.length === 0) {
    return null;
  }
  const latest = [...candidates].sort((a, b) =>
    String(b.createdDate || '').localeCompare(String(a.createdDate || '')) || b.idNumber - a.idNumber
  )[0];
  const carriedPrIds = isPromotionPullRequestForItsTarget(latest, config) ? parsePromotionPullRequestIds(latest.description) : null;
  return { number: latest.idNumber, title: latest.title, webUrl: latest.webUrl, sourceBranch: latest.sourceBranch, carriedPrIds };
}

/**
 * The forecast of one action in the target branch of a promotion. The state of its Pull Request
 * must have been loaded. carried is false when the open promotion leaves its Pull Request out.
 */
export function forecastAction(
  def: PrePostCommand,
  prNumber: number,
  targetBranch: string,
  majorBranchNames: string[],
  carried: boolean
): ActionForecast {
  const entry = getActionStateEntry(prNumber, def.id, targetBranch);
  const base = {
    actionId: def.id,
    actionLabel: def.label,
    when: def.when || 'post-deploy',
    status: entry?.status || null,
    date: entry?.date || '',
    jobUrl: entry?.jobUrl || '',
    note: entry?.note || '',
    movedTo: entry?.movedTo || null,
    identicalTo: null,
  };
  const make = (forecast: ActionForecastCode, reason: ActionForecastReason): ActionForecast => ({ ...base, forecast, reason });
  if (!carried) {
    return make('not-in-promotion', 'not-carried');
  }
  if (entry?.status === 'moved') {
    return make('moved', 'moved');
  }
  const verdict = evaluateActionBranchFilter(def, buildActionTargetBranchCandidates(targetBranch, majorBranchNames));
  if (verdict.run === false && !verdict.invalid) {
    return make('not-for-branch', 'branch-filter');
  }
  const runsAtEveryDeployment = def.runOnlyOnceByOrg === false || def.type === 'remove-packagexml-items';
  if (entry?.status === 'success' && !runsAtEveryDeployment) {
    return make('done', 'done-in-branch');
  }
  if (def.type === 'manual') {
    // The forecast is about a promotion not merged yet: a post-deployment step cannot be done before
    // the metadata it completes is deployed, so it waits for the merge, not for someone
    return def.when === 'pre-deploy' ? make('waiting', 'manual-before-merge') : make('after-merge', 'manual-after-merge');
  }
  if (entry?.status === 'failed') {
    return make('failed', 'failed-in-branch');
  }
  if (entry?.status === 'not-run') {
    return make('failed', 'stopped-in-branch');
  }
  const context = getEffectiveActionContext(def);
  if (context === 'check-deployment-only') {
    // Run by the validation job only: once it ran, the deployment has nothing more to do with it
    return entry ? make('not-for-branch', 'validation-only') : make('runs-at-validation', 'validation-first');
  }
  if (runsAtEveryDeployment) {
    return make('runs-at-deployment', 'every-deployment');
  }
  if (context === 'process-deployment-only') {
    return make('runs-at-deployment', entry?.status === 'skipped' ? 'skipped-by-validation' : 'deploy-only');
  }
  // Context "all": the validation job runs it first, the deployment then skips it
  return entry?.status === 'skipped' ? make('runs-at-deployment', 'skipped-by-validation') : make('runs-at-validation', 'validation-first');
}

/**
 * Point the forecasts of identical actions at the one that runs. In each job of the promotion (the
 * validation, the deployment), the first action of an identity key runs and the next ones are done by
 * it. Items come in the order the promotion runs them. An action still holding a ${{ }} reference is
 * never grouped: its values are only known in the job.
 */
export async function markIdenticalForecasts(items: ActionForecastItem[]): Promise<void> {
  const keys = new Map<ActionForecast, string | null>();
  for (const item of items) {
    if (item.forecast.forecast !== 'runs-at-validation' && item.forecast.forecast !== 'runs-at-deployment') {
      continue;
    }
    const identityKey = await computeActionIdentityKey(item.def, (item.def.when || 'post-deploy') as ActionWhen, { refusePlaceholders: true });
    keys.set(item.forecast, identityKey ? `${item.forecast.forecast}|${identityKey}` : null);
  }
  applyIdenticalForecasts(items, keys);
}

/** The grouping of markIdenticalForecasts, once the keys are known. Exported for unit tests. */
export function applyIdenticalForecasts(items: Pick<ActionForecastItem, 'prNumber' | 'forecast'>[], keys: Map<ActionForecast, string | null>): void {
  const copies = findIdenticalCopies(items, (item) => keys.get(item.forecast) || null);
  for (const [copy, first] of copies) {
    copy.forecast.reason = 'identical-action';
    copy.forecast.identicalTo = { pr: first.prNumber, actionId: first.forecast.actionId, actionLabel: first.forecast.actionLabel };
  }
}

function isPromotionOf(pr: CommonPullRequestInfo, sourceBranch: string): boolean {
  if ((pr.sourceBranch || '') === sourceBranch) {
    return true;
  }
  const parts = parsePromotionBranchName(pr.sourceBranch || '');
  return parts !== null && parts.sourceBranch === sourceBranch;
}
