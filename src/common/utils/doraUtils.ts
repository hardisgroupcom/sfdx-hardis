import { DeployRecord, parseDatetime } from './deployUtils.js';
import { t } from './i18n.js';

// none: nothing to rate (no deployment, no Pull Request in the period)
export type DoraLevel = 'elite' | 'high' | 'medium' | 'low' | 'none';

export type DoraClassification = { level: DoraLevel; emoji: string };

export const DORA_NO_DATA: DoraClassification = { level: 'none', emoji: '⚪' };

// ---------------------------------------------------------------------------
// Result of sf hardis:doc:dora-report (--json). The VS Code DORA panel draws it as is, and the
// markdown report and the notification are built from it: fields are added, never renamed.
// ---------------------------------------------------------------------------

export interface DoraDistribution {
  median: number | null;
  p90: number | null;
  avg: number | null;
}

export interface DoraBranchMetrics {
  deploymentFrequency: { perDay: number; perWeek: number; level: DoraLevel; previousPerWeek: number | null };
  leadTime: { medianDays: number | null; p90Days: number | null; avgDays: number | null; level: DoraLevel; previousMedianDays: number | null };
  changeFailureRate: { percent: number | null; level: DoraLevel; previousPercent: number | null };
  mttr: { medianHours: number | null; avgHours: number | null; recoveries: number; level: DoraLevel; previousMedianHours: number | null };
  reworkRate: { percent: number | null; level: DoraLevel; previousPercent: number | null };
}

export interface DoraBranchSupplementary {
  // Minutes a deployment job ran
  deploymentDuration: DoraDistribution;
  // Minutes a deployment job waited for a runner
  queueTime: DoraDistribution;
  // Days between the creation and the merge of a Pull Request
  prCycleTime: DoraDistribution;
  changeVolume: { prsPerWeek: number; deploymentsPerWeek: number };
  // Deployment checks of the Pull Requests targeting the branch
  validationSuccessRate: number | null;
}

export interface DoraWeek {
  // ISO week, for example 2026-W28
  week: string;
  succeeded: number;
  failed: number;
  canceled: number;
  validations: number;
  validationsFailed: number;
  leadTimeMedianDays: number | null;
}

export interface DoraPullRequestRef {
  id: string;
  title: string;
  url: string;
  author: string;
}

export interface DoraFailedDeployment {
  date: string;
  runName: string;
  runUrl: string;
  triggeredBy: string;
  // The Pull Request whose merge the job deployed, when its merge commit is the one of the run
  pullRequest: DoraPullRequestRef | null;
  // null: no successful deployment since
  recoveryHours: number | null;
}

export interface DoraSlowPullRequest extends DoraPullRequestRef {
  cycleDays: number;
}

export interface DoraHotfixPullRequest extends DoraPullRequestRef {
  sourceBranch: string;
  mergedDate: string;
}

export type DoraAttentionCode = 'deploymentFailing' | 'stalePullRequests' | 'failureRateUp' | 'noRecentDeployment';

export interface DoraAttentionItem {
  code: DoraAttentionCode;
  severity: 'error' | 'warning' | 'info';
  // Translated, ready to display
  message: string;
  url: string | null;
}

export interface DoraBranchCounts {
  // Succeeded and failed: a canceled job says nothing about the change it carried
  deployments: number;
  succeeded: number;
  failed: number;
  canceled: number;
  validations: number;
  pullRequests: number;
  openPullRequests: number;
}

export interface DoraBranchResult {
  name: string;
  level: number;
  isProduction: boolean;
  // Oldest deployment job the git provider returned: later than the start of the period when it keeps less
  oldestRunDate: string | null;
  metrics: DoraBranchMetrics;
  supplementary: DoraBranchSupplementary;
  counts: DoraBranchCounts;
  weeks: DoraWeek[];
  failedDeployments: DoraFailedDeployment[];
  slowPullRequests: DoraSlowPullRequest[];
  hotfixPullRequests: DoraHotfixPullRequest[];
  attention: DoraAttentionItem[];
}

export interface DoraContributor {
  name: string;
  pullRequests: number;
  avgCycleDays: number | null;
  deploymentsTriggered: number;
  failedDeployments: number;
}

export interface DoraReportData {
  schemaVersion: 2;
  period: { days: number; from: string; to: string; previousFrom: string | null };
  source: { provider: string; repository: string };
  branches: DoraBranchResult[];
  // Time a change spends between the major branches: not computed yet
  pipeline: null;
  contributors: DoraContributor[];
}

export interface DoraMetricResult {
  name: string;
  value: string;
  rawValue: number;
  classification: DoraClassification;
}

export interface FailedDeployDetail {
  id: string;
  date: string;
  deployedBy: string;
  recoveryId?: string;
  recoveryDate?: string;
  recoveryHours?: number;
}

export interface HotfixPrDetail {
  id: string;
  title: string;
  author: string;
  sourceBranch: string;
  mergedDate: string;
}

export interface SlowPrDetail {
  id: string;
  title: string;
  author: string;
  cycleDays: number;
}

export interface DoraInsights {
  failedDeploys: FailedDeployDetail[];
  hotfixPrs: HotfixPrDetail[];
  slowPrs: SlowPrDetail[];
}

const DORA_BENCHMARKS = {
  deploymentFrequency: { elite: 1, high: 1 / 7, medium: 1 / 30 },
  leadTimeDays: { elite: 1, high: 7, medium: 30 },
  changeFailureRate: { elite: 5, high: 10, medium: 15 },
  mttrHours: { elite: 1, high: 24, medium: 168 },
  reworkRate: { elite: 5, high: 10, medium: 20 },
};

export function classifyDeploymentFrequency(deploymentsPerDay: number | null): DoraClassification {
  if (deploymentsPerDay == null) return DORA_NO_DATA;
  if (deploymentsPerDay >= DORA_BENCHMARKS.deploymentFrequency.elite) return { level: 'elite', emoji: '🟢' };
  if (deploymentsPerDay >= DORA_BENCHMARKS.deploymentFrequency.high) return { level: 'high', emoji: '🔵' };
  if (deploymentsPerDay >= DORA_BENCHMARKS.deploymentFrequency.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classifyLeadTime(days: number | null): DoraClassification {
  if (days == null) return DORA_NO_DATA;
  if (days <= DORA_BENCHMARKS.leadTimeDays.elite) return { level: 'elite', emoji: '🟢' };
  if (days <= DORA_BENCHMARKS.leadTimeDays.high) return { level: 'high', emoji: '🔵' };
  if (days <= DORA_BENCHMARKS.leadTimeDays.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classifyChangeFailureRate(pct: number | null): DoraClassification {
  if (pct == null) return DORA_NO_DATA;
  if (pct <= DORA_BENCHMARKS.changeFailureRate.elite) return { level: 'elite', emoji: '🟢' };
  if (pct <= DORA_BENCHMARKS.changeFailureRate.high) return { level: 'high', emoji: '🔵' };
  if (pct <= DORA_BENCHMARKS.changeFailureRate.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classifyMttr(hours: number | null): DoraClassification {
  if (hours == null) return DORA_NO_DATA;
  if (hours <= DORA_BENCHMARKS.mttrHours.elite) return { level: 'elite', emoji: '🟢' };
  if (hours <= DORA_BENCHMARKS.mttrHours.high) return { level: 'high', emoji: '🔵' };
  if (hours <= DORA_BENCHMARKS.mttrHours.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classifyReworkRate(pct: number | null): DoraClassification {
  if (pct == null) return DORA_NO_DATA;
  if (pct <= DORA_BENCHMARKS.reworkRate.elite) return { level: 'elite', emoji: '🟢' };
  if (pct <= DORA_BENCHMARKS.reworkRate.high) return { level: 'high', emoji: '🔵' };
  if (pct <= DORA_BENCHMARKS.reworkRate.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classificationLabel(classification: { level: DoraLevel }): string {
  if (classification.level === 'none') return t('doraReportNoData');
  return t(`doraReport${classification.level.charAt(0).toUpperCase() + classification.level.slice(1)}`);
}

// ISO 8601 week (weeks start on Monday, week 1 holds the first Thursday), in local time like the
// dates it groups. Every weekly bucket of the report uses it, so a label and its records always agree
export function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function groupByWeek(records: DeployRecord[]): Map<string, number> {
  const weeks = new Map<string, number>();
  for (const r of records) {
    const d = parseDatetime(r.CompletedDate) || parseDatetime(r.CreatedDate);
    if (!d) continue;
    const key = weekKey(d);
    weeks.set(key, (weeks.get(key) || 0) + 1);
  }
  return weeks;
}

export function buildWeekLabels(periodDays: number, now: Date = new Date()): string[] {
  const labels: string[] = [];
  const current = new Date(now.getTime() - periodDays * 86400000);
  while (current <= now) {
    const key = weekKey(current);
    if (!labels.includes(key)) labels.push(key);
    current.setDate(current.getDate() + 7);
  }
  // Stepping by 7 days from the start of the period can stop short of the current week, whose
  // records would then be counted by no label
  const currentWeek = weekKey(now);
  if (!labels.includes(currentWeek)) labels.push(currentWeek);
  return labels;
}
