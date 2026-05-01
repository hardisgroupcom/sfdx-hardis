import { DeployRecord, parseDatetime } from './deployUtils.js';
import { t } from './i18n.js';

export type DoraClassification = { level: 'elite' | 'high' | 'medium' | 'low'; emoji: string };

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

export function classifyDeploymentFrequency(deploymentsPerDay: number): DoraClassification {
  if (deploymentsPerDay >= DORA_BENCHMARKS.deploymentFrequency.elite) return { level: 'elite', emoji: '🟢' };
  if (deploymentsPerDay >= DORA_BENCHMARKS.deploymentFrequency.high) return { level: 'high', emoji: '🔵' };
  if (deploymentsPerDay >= DORA_BENCHMARKS.deploymentFrequency.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classifyLeadTime(days: number): DoraClassification {
  if (days <= DORA_BENCHMARKS.leadTimeDays.elite) return { level: 'elite', emoji: '🟢' };
  if (days <= DORA_BENCHMARKS.leadTimeDays.high) return { level: 'high', emoji: '🔵' };
  if (days <= DORA_BENCHMARKS.leadTimeDays.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classifyChangeFailureRate(pct: number): DoraClassification {
  if (pct <= DORA_BENCHMARKS.changeFailureRate.elite) return { level: 'elite', emoji: '🟢' };
  if (pct <= DORA_BENCHMARKS.changeFailureRate.high) return { level: 'high', emoji: '🔵' };
  if (pct <= DORA_BENCHMARKS.changeFailureRate.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classifyMttr(hours: number): DoraClassification {
  if (hours <= DORA_BENCHMARKS.mttrHours.elite) return { level: 'elite', emoji: '🟢' };
  if (hours <= DORA_BENCHMARKS.mttrHours.high) return { level: 'high', emoji: '🔵' };
  if (hours <= DORA_BENCHMARKS.mttrHours.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classifyReworkRate(pct: number): DoraClassification {
  if (pct <= DORA_BENCHMARKS.reworkRate.elite) return { level: 'elite', emoji: '🟢' };
  if (pct <= DORA_BENCHMARKS.reworkRate.high) return { level: 'high', emoji: '🔵' };
  if (pct <= DORA_BENCHMARKS.reworkRate.medium) return { level: 'medium', emoji: '🟡' };
  return { level: 'low', emoji: '🔴' };
}

export function classificationLabel(classification: DoraClassification): string {
  return t(`doraReport${classification.level.charAt(0).toUpperCase() + classification.level.slice(1)}`);
}

export function groupByWeek(records: DeployRecord[]): Map<string, number> {
  const weeks = new Map<string, number>();
  for (const r of records) {
    const d = parseDatetime(r.CompletedDate) || parseDatetime(r.CreatedDate);
    if (!d) continue;
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
    const weekNum = Math.ceil(dayOfYear / 7);
    const key = `${year}-W${String(weekNum).padStart(2, '0')}`;
    weeks.set(key, (weeks.get(key) || 0) + 1);
  }
  return weeks;
}

export function buildWeekLabels(periodDays: number): string[] {
  const labels: string[] = [];
  const now = new Date();
  const start = new Date(now.getTime() - periodDays * 86400000);
  const current = new Date(start);
  while (current <= now) {
    const year = current.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const dayOfYear = Math.floor((current.getTime() - jan1.getTime()) / 86400000) + 1;
    const weekNum = Math.ceil(dayOfYear / 7);
    const key = `${year}-W${String(weekNum).padStart(2, '0')}`;
    if (!labels.includes(key)) labels.push(key);
    current.setDate(current.getDate() + 7);
  }
  return labels;
}
