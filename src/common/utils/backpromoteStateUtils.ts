/*
 * Backpromote (Beta) history, shared through the git provider: which developer orgs received a Pull
 * Request, and the deployment actions that ran there. Nothing is stored on the developer's machine,
 * so every developer, every machine and the VS Code panel read the same history. Records are keyed
 * by Salesforce Organization Id: a refreshed sandbox is a new org and starts with nothing backpromoted.
 */
import c from 'chalk';
import { GitProvider } from '../gitProvider/index.js';
import { GitProviderRoot } from '../gitProvider/gitProviderRoot.js';
import { CONSTANTS } from '../../config/index.js';
import { uxLog } from './index.js';
import { t } from './i18n.js';
import { BackpromoteGroupStatus } from './backpromoteSelectionUtils.js';

export const BACKPROMOTE_STATE_MARKER = '<!-- sfdx-hardis backpromote-state -->';
const RECORD_MARKER_REGEX = /<!-- sfdx-hardis-backpromote data:(\S+) -->/g;

export type BackpromoteGitProviderName = 'github' | 'gitlab' | 'azure' | 'bitbucket';

export interface BackpromoteActionRecord {
  id: string;
  label: string;
  status: 'success' | 'failed' | 'warning' | 'manual' | 'skipped';
  date: string;
}

export interface BackpromoteOrgRecord {
  orgId: string;
  orgName: string;
  /** When the Pull Request was deployed into the org; null while only its actions ran (failed deployment) */
  date: string | null;
  /** Merge commit of the parent branch that brought the Pull Request in */
  commit: string;
  actions: BackpromoteActionRecord[];
}

export interface BackpromoteGroupHistory {
  status: BackpromoteGroupStatus;
  /** False for a merge without Pull Request number: nothing can be recorded for it */
  trackable: boolean;
  backpromotedToThisOrg: { date: string; commit: string } | null;
  backpromotedTo: Array<{ orgId: string; orgName: string; date: string }>;
}

// ---- Pure helpers ----

/** An org id given with 15 or 18 characters designates the same org */
export function isSameOrgId(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a || '').trim();
  const right = (b || '').trim();
  return left.length >= 15 && right.length >= 15 && left.substring(0, 15) === right.substring(0, 15);
}

/** Short name of an org from its instance URL: mycompany--dev-sam for https://mycompany--dev-sam.sandbox.my.salesforce.com */
export function orgShortName(instanceUrl: string, fallback: string): string {
  const host = (instanceUrl || '').replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  return host.split('.')[0] || fallback;
}

export function gitProviderNameFromLabel(label: string): BackpromoteGitProviderName | null {
  const value = (label || '').toLowerCase();
  if (value.includes('github')) {
    return 'github';
  }
  if (value.includes('gitlab')) {
    return 'gitlab';
  }
  if (value.includes('azure')) {
    return 'azure';
  }
  if (value.includes('bitbucket')) {
    return 'bitbucket';
  }
  return null;
}

/** The org records of a backpromote history comment. A row edited by hand is ignored, not fatal. */
export function parseBackpromoteStateComment(body: string): BackpromoteOrgRecord[] {
  const records: BackpromoteOrgRecord[] = [];
  for (const match of (body || '').matchAll(RECORD_MARKER_REGEX)) {
    try {
      const raw = JSON.parse(decodeURIComponent(match[1]));
      if (!raw || typeof raw.orgId !== 'string' || raw.orgId === '') {
        continue;
      }
      records.push({
        orgId: raw.orgId,
        orgName: String(raw.orgName || raw.orgId),
        date: typeof raw.date === 'string' && raw.date !== '' ? raw.date : null,
        commit: String(raw.commit || ''),
        actions: (Array.isArray(raw.actions) ? raw.actions : [])
          .filter((action: any) => action && typeof action.id === 'string')
          .map((action: any) => ({
            id: action.id,
            label: String(action.label || action.id),
            status: action.status,
            date: String(action.date || ''),
          })),
      });
    } catch {
      // Not a record sfdx-hardis wrote
    }
  }
  return records;
}

/** Existing records with the updates of this run: one record per org, one entry per action */
export function mergeBackpromoteOrgRecords(existing: BackpromoteOrgRecord[], updates: BackpromoteOrgRecord[]): BackpromoteOrgRecord[] {
  const merged = existing.map((record) => ({ ...record, actions: [...record.actions] }));
  for (const update of updates) {
    const target = merged.find((record) => isSameOrgId(record.orgId, update.orgId));
    if (!target) {
      merged.push({ ...update, actions: [...update.actions] });
      continue;
    }
    target.orgName = update.orgName || target.orgName;
    if (update.date) {
      target.date = update.date;
      target.commit = update.commit || target.commit;
    }
    for (const action of update.actions) {
      const index = target.actions.findIndex((item) => item.id === action.id);
      if (index >= 0) {
        target.actions[index] = action;
      } else {
        target.actions.push(action);
      }
    }
  }
  return merged;
}

function formatUtc(isoDate: string): string {
  return isoDate ? `${isoDate.substring(0, 10)} ${isoDate.substring(11, 16)} UTC` : '';
}

function escapeCell(text: string): string {
  return (text || '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function actionStatusIcon(status: BackpromoteActionRecord['status']): string {
  switch (status) {
    case 'success':
      return '✅';
    case 'failed':
      return '❌';
    case 'warning':
      return '⚠️';
    case 'manual':
      return '📝';
    default:
      return '⏭️';
  }
}

/** The history comment of a Pull Request: a readable table, each row carrying its record as data */
export function buildBackpromoteStateComment(records: BackpromoteOrgRecord[]): string {
  const sorted = [...records].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const lines = [
    BACKPROMOTE_STATE_MARKER,
    `### ${t('backpromoteStateCommentTitle')}`,
    '',
    t('backpromoteStateCommentIntro'),
    '',
    `| ${t('backpromoteStateCommentOrg')} | ${t('backpromoteStateCommentDate')} | ${t('backpromoteStateCommentCommit')} | ${t('backpromoteStateCommentActions')} |`,
    '|---|---|---|---|',
  ];
  for (const record of sorted) {
    const data = encodeURIComponent(JSON.stringify(record));
    const date = record.date ? formatUtc(record.date) : t('backpromoteStateCommentNotDeployed');
    const commit = record.commit ? `\`${record.commit.substring(0, 7)}\`` : '';
    const actions = record.actions.length > 0
      ? record.actions.map((action) => `${actionStatusIcon(action.status)} ${escapeCell(action.label)}`).join('<br/>')
      : '-';
    lines.push(`| <!-- sfdx-hardis-backpromote data:${data} --> \`${escapeCell(record.orgName)}\` | ${date} | ${commit} | ${actions} |`);
  }
  lines.push('', `_${t('backpromoteStateCommentFooter')}_`);
  return lines.join('\n');
}

/**
 * What the comments of its Pull Requests say about a group: done for this org when every Pull Request
 * it brought in was deployed there. A merge without Pull Request number is never done.
 */
export function computeBackpromoteGroupHistory(
  group: { associatedPrs: Array<{ id: number }> },
  recordsByPr: Map<number, BackpromoteOrgRecord[]>,
  orgId: string,
): BackpromoteGroupHistory {
  const prIds = [...new Set(group.associatedPrs.map((pr) => pr.id).filter((id) => id > 0))];
  const trackable = prIds.length > 0;
  const thisOrg = prIds.map((id) => (recordsByPr.get(id) || []).find((record) => isSameOrgId(record.orgId, orgId) && record.date));
  const done = trackable && thisOrg.every((record) => !!record);
  let backpromotedToThisOrg: BackpromoteGroupHistory['backpromotedToThisOrg'] = null;
  if (done) {
    const latest = (thisOrg as BackpromoteOrgRecord[]).reduce((a, b) => ((a.date || '') >= (b.date || '') ? a : b));
    backpromotedToThisOrg = { date: latest.date as string, commit: latest.commit };
  }
  const byOrg = new Map<string, { orgId: string; orgName: string; date: string }>();
  for (const id of prIds) {
    for (const record of recordsByPr.get(id) || []) {
      if (!record.date) {
        continue;
      }
      const key = record.orgId.substring(0, 15);
      const known = byOrg.get(key);
      if (!known || known.date < record.date) {
        byOrg.set(key, { orgId: record.orgId, orgName: record.orgName, date: record.date });
      }
    }
  }
  return {
    status: done ? 'done' : 'pending',
    trackable,
    backpromotedToThisOrg,
    backpromotedTo: [...byOrg.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/** Deployment actions that already ran successfully in this org: action id -> date */
export function findActionsDoneInOrg(recordsByPr: Map<number, BackpromoteOrgRecord[]>, orgId: string): Map<string, string> {
  const done = new Map<string, string>();
  for (const records of recordsByPr.values()) {
    for (const record of records) {
      if (!isSameOrgId(record.orgId, orgId)) {
        continue;
      }
      for (const action of record.actions) {
        if (action.status === 'success' && (!done.has(action.id) || (done.get(action.id) as string) < action.date)) {
          done.set(action.id, action.date);
        }
      }
    }
  }
  return done;
}

// ---- Git provider ----

export interface BackpromoteGitProviderCheck {
  provider: GitProviderRoot | null;
  name: BackpromoteGitProviderName | null;
  ok: boolean;
  message: string;
}

/**
 * The history lives in Pull Request comments: without a working git provider connection there is no
 * way to know what an org already received, so the command must not run.
 */
export async function checkBackpromoteGitProvider(parentBranch: string | null): Promise<BackpromoteGitProviderCheck> {
  const docUrl = `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-integrations-home/#git-providers`;
  const provider = await GitProvider.getInstance(false);
  if (!provider) {
    return { provider: null, name: null, ok: false, message: t('backpromoteGitProviderRequired', { url: docUrl }) };
  }
  const name = gitProviderNameFromLabel(provider.getLabel());
  const providerLabel = provider.getLabel().replace(/^sfdx-hardis\s+/i, '').replace(/\s+connector$/i, '');
  try {
    const pullRequests = await provider.listPullRequests({
      status: 'merged',
      ...(parentBranch ? { targetBranch: parentBranch } : {}),
      minDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    // Every provider catches its own API errors and answers null: an expired token would otherwise
    // pass the check, and every Pull Request would then look like it was never backpromoted
    if (pullRequests === null || pullRequests === undefined) {
      return { provider, name, ok: false, message: t('backpromoteGitProviderNoAnswer', { provider: providerLabel }) };
    }
  } catch (e) {
    return { provider, name, ok: false, message: t('backpromoteGitProviderUnreachable', { provider: providerLabel, message: (e as Error).message }) };
  }
  return { provider, name, ok: true, message: t('backpromoteCheckGitProviderOk', { provider: providerLabel }) };
}

/** The history comments of these Pull Requests. A comment that cannot be read is reported, not hidden. */
export async function loadBackpromoteOrgRecords(
  provider: GitProviderRoot,
  prNumbers: number[],
  recordsByPr: Map<number, BackpromoteOrgRecord[]> = new Map(),
  readErrors: string[] = [],
): Promise<{ recordsByPr: Map<number, BackpromoteOrgRecord[]>; readErrors: string[] }> {
  for (const prNumber of [...new Set(prNumbers)].filter((id) => id > 0 && !recordsByPr.has(id))) {
    try {
      const comments = await provider.listPullRequestCommentsByMarker(BACKPROMOTE_STATE_MARKER, prNumber);
      recordsByPr.set(prNumber, (comments || []).flatMap((comment) => parseBackpromoteStateComment(comment.body || '')));
    } catch (e) {
      readErrors.push(`#${prNumber}`);
      uxLog("log", null, c.grey(`[Backpromote] Pull Request #${prNumber}: ${(e as Error).message}`));
      recordsByPr.set(prNumber, []);
    }
  }
  return { recordsByPr, readErrors };
}

/** Write this run's records, merged with what the comments hold now (another developer may have written meanwhile) */
export async function persistBackpromoteOrgRecords(
  provider: GitProviderRoot,
  updatesByPr: Map<number, BackpromoteOrgRecord>,
  commandThis: any,
): Promise<void> {
  for (const [prNumber, update] of updatesByPr) {
    if (prNumber <= 0 || (!update.date && update.actions.length === 0)) {
      continue;
    }
    try {
      const comments = await provider.listPullRequestCommentsByMarker(BACKPROMOTE_STATE_MARKER, prNumber);
      const existing = (comments || []).flatMap((comment) => parseBackpromoteStateComment(comment.body || ''));
      const body = buildBackpromoteStateComment(mergeBackpromoteOrgRecords(existing, [update]));
      await provider.upsertPullRequestCommentByMarker(BACKPROMOTE_STATE_MARKER, body, prNumber);
      uxLog('log', commandThis, c.grey(t('backpromoteStateSavedInPullRequest', { pr: prNumber })));
    } catch (e) {
      uxLog('warning', commandThis, c.yellow(t('backpromoteStateWriteFailed', { pr: prNumber, message: (e as Error).message })));
    }
  }
}
