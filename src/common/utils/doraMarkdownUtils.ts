import { CommonPullRequestInfo } from '../gitProvider/index.js';
import { Ticket } from '../ticketProvider/index.js';
import { CONSTANTS } from '../../config/index.js';
import { DoraBranchInput } from './doraMetricsUtils.js';
import { DoraBranchResult, DoraDistribution, DoraLevel, DoraReportData, classificationLabel } from './doraUtils.js';
import { t } from './i18n.js';

export const DORA_LEVEL_EMOJIS: Record<DoraLevel, string> = { elite: '🟢', high: '🔵', medium: '🟡', low: '🔴', none: '⚪' };
const MAX_DETAIL_ROWS = 50;

export interface DoraMetricSummary {
  key: 'DoraDeploymentFrequency' | 'DoraLeadTimeDays' | 'DoraChangeFailureRatePercent' | 'DoraMttrHours' | 'DoraReworkRatePercent';
  name: string;
  // Translated value with its unit, or the "no data" wording
  value: string;
  rawValue: number | null;
  level: DoraLevel;
}

/** The five DORA metrics of a branch, named and formatted: the summary tables and the notification use them */
export function buildMetricSummaries(branch: DoraBranchResult): DoraMetricSummary[] {
  const metrics = branch.metrics;
  const noData = t('doraReportNoData');
  return [
    {
      key: 'DoraDeploymentFrequency',
      name: t('doraReportDeploymentFrequency'),
      value: metrics.deploymentFrequency.level === 'none' ? noData : t('doraReportPerWeek', { value: metrics.deploymentFrequency.perWeek }),
      rawValue: metrics.deploymentFrequency.level === 'none' ? null : metrics.deploymentFrequency.perDay,
      level: metrics.deploymentFrequency.level,
    },
    {
      key: 'DoraLeadTimeDays',
      name: t('doraReportLeadTime'),
      value: metrics.leadTime.medianDays == null ? noData : `${t('doraReportDays', { value: metrics.leadTime.medianDays })} (p50)`,
      rawValue: metrics.leadTime.medianDays,
      level: metrics.leadTime.level,
    },
    {
      key: 'DoraChangeFailureRatePercent',
      name: t('doraReportChangeFailureRate'),
      value: metrics.changeFailureRate.percent == null ? noData : t('doraReportPercent', { value: metrics.changeFailureRate.percent }),
      rawValue: metrics.changeFailureRate.percent,
      level: metrics.changeFailureRate.level,
    },
    {
      key: 'DoraMttrHours',
      name: t('doraReportMttr'),
      value: metrics.mttr.medianHours == null ? noData : t('doraReportHours', { value: metrics.mttr.medianHours }),
      rawValue: metrics.mttr.medianHours,
      level: metrics.mttr.level,
    },
    {
      key: 'DoraReworkRatePercent',
      name: t('doraReportReworkRate'),
      value: metrics.reworkRate.percent == null ? noData : t('doraReportPercent', { value: metrics.reworkRate.percent }),
      rawValue: metrics.reworkRate.percent,
      level: metrics.reworkRate.level,
    },
  ];
}

/**
 * The markdown report: a summary of every branch, one chapter per branch, the contributors, the
 * DORA benchmarks, then the jobs and the Pull Requests behind the numbers.
 */
export function buildDoraMarkdownReport(data: DoraReportData, inputs: DoraBranchInput[], tickets: Ticket[]): string {
  const lines: string[] = [];
  lines.push(`# ${t('doraReportTitle')}`);
  lines.push('');
  lines.push(
    `**${t('doraReportPeriodLabel')}**: ${t('doraReportLastDays', { days: data.period.days })} | **${t('doraReportRepository')}**: ${data.source.repository} | **${t('doraReportGenerated')}**: ${data.period.to.split('T')[0]}`,
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`> ${t('doraReportIntro')} [DORA](https://dora.dev/guides/dora-metrics/)`);
  lines.push('');
  lines.push(`> ${t('doraReportSourceNote')}`);
  lines.push('');

  // Every branch at a glance
  lines.push(`## ${t('doraReportBranchSummary')}`);
  lines.push('');
  const headers = buildMetricSummaries(data.branches[0]).map((metric) => metric.name);
  lines.push(`| ${t('doraReportBranch')} | ${headers.join(' | ')} |`);
  lines.push(`|${'---|'.repeat(headers.length + 1)}`);
  for (const branch of data.branches) {
    const cells = buildMetricSummaries(branch).map((metric) => `${DORA_LEVEL_EMOJIS[metric.level]} ${metric.value}`);
    lines.push(`| **${branch.name}** | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const branch of data.branches) {
    const input = inputs.find((candidate) => candidate.name === branch.name);
    pushBranchChapter(lines, branch, data);
    if (input) {
      pushBranchDetails(lines, branch, input, data, tickets);
    }
  }

  // Contributors
  lines.push(`## ${t('doraReportContributorStats')}`);
  lines.push('');
  if (data.contributors.length > 0) {
    lines.push(`| ${t('doraReportAuthor')} | ${t('doraReportPullRequests')} | ${t('doraReportAvgCycleTime')} | ${t('doraReportDeployments')} | ${t('doraReportFailed')} |`);
    lines.push('|---|---|---|---|---|');
    for (const contributor of data.contributors) {
      const cycle = contributor.avgCycleDays == null ? '-' : `${contributor.avgCycleDays} ${t('doraReportDaysUnit')}`;
      lines.push(`| ${sanitizeTableCell(contributor.name)} | ${contributor.pullRequests} | ${cycle} | ${contributor.deploymentsTriggered} | ${contributor.failedDeployments} |`);
    }
  } else {
    lines.push(t('doraReportNoDataAvailable'));
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // DORA Benchmarks Reference
  lines.push(`## ${t('doraReportBenchmarks')}`);
  lines.push('');
  lines.push(`| ${t('doraReportMetric')} | ${t('doraReportElite')} | ${t('doraReportHigh')} | ${t('doraReportMedium')} | ${t('doraReportLow')} |`);
  lines.push('|--------|-------|------|--------|-----|');
  lines.push(`| ${t('doraReportDeploymentFrequency')} | ${t('doraReportBenchDfElite')} | ${t('doraReportBenchDfHigh')} | ${t('doraReportBenchDfMedium')} | ${t('doraReportBenchDfLow')} |`);
  lines.push(`| ${t('doraReportLeadTime')} | ${t('doraReportBenchLtElite')} | ${t('doraReportBenchLtHigh')} | ${t('doraReportBenchLtMedium')} | ${t('doraReportBenchLtLow')} |`);
  lines.push(`| ${t('doraReportChangeFailureRate')} | ${t('doraReportBenchCfrElite')} | ${t('doraReportBenchCfrHigh')} | ${t('doraReportBenchCfrMedium')} | ${t('doraReportBenchCfrLow')} |`);
  lines.push(`| ${t('doraReportMttr')} | ${t('doraReportBenchMttrElite')} | ${t('doraReportBenchMttrHigh')} | ${t('doraReportBenchMttrMedium')} | ${t('doraReportBenchMttrLow')} |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`_Generated by [sfdx-hardis](${CONSTANTS.DOC_URL_ROOT}) DORA Report_`);
  lines.push('');
  return lines.join('\n');
}

/** A PDF has no collapsible section: each one becomes a heading */
export function expandDetailsSectionsForPdf(markdown: string): string {
  return markdown
    .replace(/<details><summary>([\s\S]*?)<\/summary>/g, (_match, summary) => `\n#### ${String(summary).trim()}\n`)
    .replace(/<\/details>/g, '');
}

// The metrics of one branch, with their charts and what explains them
function pushBranchChapter(lines: string[], branch: DoraBranchResult, data: DoraReportData): void {
  const metrics = branch.metrics;
  const counts = branch.counts;
  const weekLabels = buildCompactWeekAxisLabels(branch.weeks.map((week) => week.week));
  lines.push(`## ${branch.name}`);
  lines.push('');
  if (branch.oldestRunDate && Date.parse(branch.oldestRunDate) > Date.parse(data.period.from) + 7 * 86400000) {
    lines.push(`_${t('doraReportDataStartsOn', { date: branch.oldestRunDate.split('T')[0] })}_`);
    lines.push('');
  }

  lines.push(`| ${t('doraReportMetric')} | ${t('doraReportValue')} | ${t('doraReportClassification')} |`);
  lines.push('|--------|-------|----------------|');
  for (const metric of buildMetricSummaries(branch)) {
    lines.push(`| ${metric.name} | ${metric.value} | ${DORA_LEVEL_EMOJIS[metric.level]} ${classificationLabel({ level: metric.level })} |`);
  }
  lines.push('');

  if (branch.attention.length > 0) {
    lines.push(`**${t('doraReportNeedsAttention')}**`);
    lines.push('');
    for (const item of branch.attention) {
      lines.push(`- ${formatMarkdownLink(item.message, item.url)}`);
    }
    lines.push('');
  }

  // Deployment Frequency
  lines.push(`### ${t('doraReportDeploymentFrequency')}`);
  lines.push('');
  lines.push(`_${t('doraReportExplainDf')}_`);
  lines.push('');
  if (counts.succeeded > 0) {
    const weekValues = branch.weeks.map((week) => week.succeeded);
    lines.push('```mermaid');
    lines.push('xychart-beta');
    lines.push(`  title "${t('doraReportDeploymentsPerWeek')}"`);
    lines.push(`  x-axis [${weekLabels.join(', ')}]`);
    lines.push(`  y-axis "${t('doraReportDeployments')}" 0 --> ${Math.max(...weekValues, 1) + 2}`);
    lines.push(`  bar [${weekValues.join(', ')}]`);
    lines.push('```');
    lines.push('');
  }
  const activeWeeks = branch.weeks.filter((week) => week.succeeded + week.failed + week.canceled + week.validations > 0);
  if (activeWeeks.length > 0) {
    lines.push(`| ${t('doraReportPeriodLabel')} | ${t('doraReportSucceeded')} | ${t('doraReportFailed')} | ${t('doraReportValidations')} |`);
    lines.push('|--------|-------------|-------------|-------------|');
    for (const week of activeWeeks) {
      lines.push(`| ${week.week} | ${week.succeeded} | ${week.failed} | ${week.validations} |`);
    }
  } else {
    lines.push(t('doraReportNoDataAvailable'));
  }
  lines.push('');

  // Lead Time
  lines.push(`### ${t('doraReportLeadTime')}`);
  lines.push('');
  lines.push(`_${t('doraReportExplainLt')}_`);
  lines.push('');
  if (metrics.leadTime.medianDays != null) {
    pushDistribution(lines, { median: metrics.leadTime.medianDays, p90: metrics.leadTime.p90Days, avg: metrics.leadTime.avgDays }, t('doraReportDaysUnit'));
    const leadTimeValues = branch.weeks.map((week) => week.leadTimeMedianDays ?? 0);
    lines.push('```mermaid');
    lines.push('xychart-beta');
    lines.push(`  title "${t('doraReportLeadTimeTrend')}"`);
    lines.push(`  x-axis [${weekLabels.join(', ')}]`);
    lines.push(`  y-axis "${t('doraReportDaysUnit')}" 0 --> ${Math.ceil(Math.max(...leadTimeValues, 1)) + 1}`);
    lines.push(`  line [${leadTimeValues.join(', ')}]`);
    lines.push('```');
    if (branch.slowPullRequests.length > 0) {
      lines.push('');
      lines.push(`<details><summary>${t('doraReportSlowPrDetails', { count: branch.slowPullRequests.length })}</summary>`);
      lines.push('');
      lines.push(`| ${t('doraReportPrId')} | ${t('doraReportAuthor')} | ${t('doraReportPrCycleTime')} |`);
      lines.push('|----|--------|----------------|');
      for (const pullRequest of branch.slowPullRequests.slice(0, 10)) {
        lines.push(`| ${formatMarkdownLink(`#${pullRequest.id}`, pullRequest.url)} | ${sanitizeTableCell(pullRequest.author)} | ${pullRequest.cycleDays} ${t('doraReportDaysUnit')} |`);
      }
      lines.push('');
      if ((metrics.leadTime.p90Days ?? 0) > 7) {
        lines.push(`**${t('doraReportAdvice')}:**`);
        lines.push('');
        lines.push(t('doraReportAdviceLeadTime'));
        lines.push('');
      }
      lines.push('</details>');
    }
  } else {
    lines.push(t('doraReportNoDataAvailable'));
  }
  lines.push('');

  // Change Failure Rate
  lines.push(`### ${t('doraReportChangeFailureRate')}`);
  lines.push('');
  lines.push(`_${t('doraReportExplainCfr')}_`);
  lines.push('');
  if (metrics.changeFailureRate.percent != null) {
    lines.push('```mermaid');
    lines.push(`pie title "${t('doraReportDeploymentOutcomes')}"`);
    if (counts.succeeded > 0) lines.push(`  "${t('doraReportSucceeded')}" : ${counts.succeeded}`);
    if (counts.failed > 0) lines.push(`  "${t('doraReportFailed')}" : ${counts.failed}`);
    if (counts.canceled > 0) lines.push(`  "${t('doraReportCanceled')}" : ${counts.canceled}`);
    lines.push('```');
    lines.push('');
    lines.push(`**${t('doraReportChangeFailureRate')}**: ${metrics.changeFailureRate.percent}%`);
    lines.push('');
    if (branch.failedDeployments.length > 0) {
      lines.push(`<details><summary>${t('doraReportFailedDeployDetails', { count: branch.failedDeployments.length })}</summary>`);
      lines.push('');
      lines.push(`| ${t('doraReportDate')} | ${t('doraReportDeployedBy')} | ${t('doraReportJob')} | ${t('doraReportPrId')} | ${t('doraReportRecoveredIn')} |`);
      lines.push('|------|-------------|----|----|--------------------|');
      for (const failure of branch.failedDeployments) {
        const recovery = failure.recoveryHours != null ? `${failure.recoveryHours} ${t('doraReportHoursUnit')}` : t('doraReportNoRecovery');
        const pullRequest = failure.pullRequest ? formatMarkdownLink(`#${failure.pullRequest.id}`, failure.pullRequest.url) : '-';
        lines.push(
          `| ${failure.date.split('T')[0]} | ${sanitizeTableCell(failure.triggeredBy)} | ${formatMarkdownLink(sanitizeTableCell(failure.runName) || t('doraReportJob'), failure.runUrl)} | ${pullRequest} | ${recovery} |`,
        );
      }
      lines.push('');
      if (metrics.changeFailureRate.percent > 10) {
        lines.push(`**${t('doraReportAdvice')}:**`);
        lines.push('');
        lines.push(t('doraReportAdviceCfr'));
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }
    const successRates = branch.weeks.map((week) => (week.succeeded + week.failed > 0 ? Math.round((week.succeeded / (week.succeeded + week.failed)) * 1000) / 10 : 0));
    if (successRates.some((rate) => rate > 0)) {
      lines.push('```mermaid');
      lines.push('xychart-beta');
      lines.push(`  title "${t('doraReportSuccessRateTrend')}"`);
      lines.push(`  x-axis [${weekLabels.join(', ')}]`);
      lines.push(`  y-axis "%" 0 --> 100`);
      lines.push(`  line [${successRates.join(', ')}]`);
      lines.push('```');
    }
  } else {
    lines.push(t('doraReportNoDataAvailable'));
  }
  lines.push('');

  // MTTR
  lines.push(`### ${t('doraReportMttr')}`);
  lines.push('');
  lines.push(`_${t('doraReportExplainMttr')}_`);
  lines.push('');
  if (metrics.mttr.medianHours != null) {
    lines.push(`| ${t('doraReportMedian')} | ${t('doraReportAverage')} | ${t('doraReportRecoveryEvents')} |`);
    lines.push('|--------|---------|------------------|');
    lines.push(`| ${metrics.mttr.medianHours} ${t('doraReportHoursUnit')} | ${metrics.mttr.avgHours} ${t('doraReportHoursUnit')} | ${metrics.mttr.recoveries} |`);
    if (metrics.mttr.medianHours > 24) {
      lines.push('');
      lines.push(`**${t('doraReportAdvice')}:**`);
      lines.push('');
      lines.push(t('doraReportAdviceMttr'));
    }
  } else {
    lines.push(t('doraReportNoDataAvailable'));
  }
  lines.push('');

  // Rework Rate
  lines.push(`### ${t('doraReportReworkRate')}`);
  lines.push('');
  lines.push(`_${t('doraReportExplainRework')}_`);
  lines.push('');
  if (metrics.reworkRate.percent != null) {
    lines.push(`**${t('doraReportReworkRate')}**: ${metrics.reworkRate.percent}%`);
    lines.push('');
    if (branch.hotfixPullRequests.length > 0) {
      lines.push(`<details><summary>${t('doraReportHotfixPrDetails', { count: branch.hotfixPullRequests.length })}</summary>`);
      lines.push('');
      lines.push(`| ${t('doraReportPrId')} | ${t('doraReportAuthor')} | ${t('doraReportBranch')} | ${t('doraReportMerged')} |`);
      lines.push('|----|--------|--------|---------|');
      for (const pullRequest of branch.hotfixPullRequests.slice(0, 20)) {
        lines.push(
          `| ${formatMarkdownLink(`#${pullRequest.id}`, pullRequest.url)} | ${sanitizeTableCell(pullRequest.author)} | ${pullRequest.sourceBranch} | ${pullRequest.mergedDate.split('T')[0]} |`,
        );
      }
      lines.push('');
      if (metrics.reworkRate.percent > 10) {
        lines.push(`**${t('doraReportAdvice')}:**`);
        lines.push('');
        lines.push(t('doraReportAdviceRework'));
        lines.push('');
      }
      lines.push('</details>');
      lines.push('');
    }
  } else {
    lines.push(t('doraReportNoDataAvailable'));
    lines.push('');
  }

  // Supplementary Metrics
  const supplementary = branch.supplementary;
  lines.push(`### ${t('doraReportSupplementaryMetrics')}`);
  lines.push('');
  lines.push(`**${t('doraReportDeploymentDuration')}**`);
  lines.push('');
  pushDistribution(lines, supplementary.deploymentDuration, t('doraReportMinutesUnit'));
  lines.push(`**${t('doraReportPendingTime')}**`);
  lines.push('');
  pushDistribution(lines, supplementary.queueTime, t('doraReportMinutesUnit'));
  lines.push(`**${t('doraReportPrCycleTime')}**`);
  lines.push('');
  pushDistribution(lines, supplementary.prCycleTime, t('doraReportDaysUnit'));
  lines.push(`**${t('doraReportChangeVolume')}**`);
  lines.push('');
  lines.push(`| ${t('doraReportPullRequests')} | ${t('doraReportDeployments')} |`);
  lines.push('|----------------|-------------|');
  lines.push(`| ${supplementary.changeVolume.prsPerWeek} ${t('doraReportPerWeekUnit')} | ${supplementary.changeVolume.deploymentsPerWeek} ${t('doraReportPerWeekUnit')} |`);
  lines.push('');
  lines.push(`**${t('doraReportValidationMetrics')}**`);
  lines.push('');
  if (supplementary.validationSuccessRate != null) {
    lines.push(`${t('doraReportSuccessRate')}: ${supplementary.validationSuccessRate}% (${t('doraReportValidationsCount', { count: counts.validations })})`);
  } else {
    lines.push(t('doraReportNoDataAvailable'));
  }
  lines.push('');
}

// The jobs and the Pull Requests the numbers of a branch come from
function pushBranchDetails(lines: string[], branch: DoraBranchResult, input: DoraBranchInput, data: DoraReportData, tickets: Ticket[]): void {
  const from = Date.parse(data.period.from);
  const runs = input.deploymentRuns
    .filter((run) => Date.parse(run.finishedAt) >= from)
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
  lines.push(`<details><summary>${t('doraReportDetailedData')}: ${t('doraReportDeployments')} (${runs.length})</summary>`);
  lines.push('');
  if (runs.length > 0) {
    lines.push(`| ${t('doraReportDate')} | ${t('doraReportStatus')} | ${t('doraReportDeployedBy')} | ${t('doraReportJob')} | ${t('doraReportDurationMin')} |`);
    lines.push('|------|--------|-------------|----|----------------|');
    for (const run of runs.slice(0, MAX_DETAIL_ROWS)) {
      const duration = Math.round(((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 60000) * 10) / 10;
      lines.push(
        `| ${run.finishedAt.split('T')[0]} | ${run.status} | ${sanitizeTableCell(run.triggeredBy)} | ${formatMarkdownLink(sanitizeTableCell(run.name) || run.id, run.webUrl)} | ${Number.isFinite(duration) ? duration : '-'} |`,
      );
    }
    if (runs.length > MAX_DETAIL_ROWS) {
      lines.push(`| ... | ${t('doraReportTruncated', { total: runs.length })} | | | |`);
    }
  } else {
    lines.push(t('doraReportNoDataAvailable'));
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');

  const pullRequests = input.mergedPullRequests
    .filter((pullRequest) => Date.parse(pullRequest.mergedDate || '') >= from)
    .sort((a, b) => Date.parse(b.mergedDate || '') - Date.parse(a.mergedDate || ''));
  lines.push(`<details><summary>${t('doraReportDetailedData')}: ${t('doraReportPullRequests')} (${pullRequests.length})</summary>`);
  lines.push('');
  if (pullRequests.length > 0) {
    lines.push(`| ${t('doraReportPrId')} | ${t('doraReportValue')} | Tickets | ${t('doraReportAuthor')} | ${t('doraReportCreated')} | ${t('doraReportMerged')} | ${t('doraReportPrCycleTime')} |`);
    lines.push('|----|-------|---------|--------|---------|--------|-----------|');
    for (const pullRequest of pullRequests.slice(0, MAX_DETAIL_ROWS)) {
      const created = (pullRequest.createdDate || '').split('T')[0];
      const merged = (pullRequest.mergedDate || '').split('T')[0];
      const cycle = Math.round(((Date.parse(pullRequest.mergedDate || '') - Date.parse(pullRequest.createdDate || '')) / 86400000) * 10) / 10;
      const id = pullRequest.idStr || String(pullRequest.idNumber);
      lines.push(
        `| ${formatMarkdownLink(`#${id}`, pullRequest.webUrl)} | ${formatMarkdownLink(sanitizeTableCell(pullRequest.title || ''), pullRequest.webUrl)} | ${buildPullRequestTicketCell(pullRequest, tickets)} | ${sanitizeTableCell(pullRequest.authorName || '')} | ${created} | ${merged} | ${Number.isFinite(cycle) ? cycle : '-'} ${t('doraReportDaysUnit')} |`,
      );
    }
    if (pullRequests.length > MAX_DETAIL_ROWS) {
      lines.push(`| ... | ${t('doraReportTruncated', { total: pullRequests.length })} | | | | | |`);
    }
  } else {
    lines.push(t('doraReportNoDataAvailable'));
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('---');
  lines.push('');
}

function pushDistribution(lines: string[], distribution: DoraDistribution, unit: string): void {
  if (distribution.median == null) {
    lines.push(t('doraReportNoDataAvailable'));
    lines.push('');
    return;
  }
  lines.push(`| ${t('doraReportMedian')} | ${t('doraReportP90')} | ${t('doraReportAverage')} |`);
  lines.push('|--------|------|---------|');
  lines.push(`| ${distribution.median} ${unit} | ${distribution.p90} ${unit} | ${distribution.avg} ${unit} |`);
  lines.push('');
}

// A chart axis cannot hold a label per week over a long period: one out of N is written
function buildCompactWeekAxisLabels(weekLabels: string[], maxVisibleLabels: number = 10): string[] {
  const axisLabelStep = Math.max(1, Math.ceil(weekLabels.length / maxVisibleLabels));
  return weekLabels.map((week, index) => {
    if (index % axisLabelStep === 0 || index === weekLabels.length - 1) {
      return `"${week.replace(/^\d{4}-/, '')}"`;
    }
    return '"_"';
  });
}

function buildPullRequestTicketCell(pullRequest: CommonPullRequestInfo, tickets: Ticket[]): string {
  const text = `${pullRequest.title || ''}\n${pullRequest.description || ''}\n${pullRequest.sourceBranch || ''}`;
  const related = new Map<string, Ticket>();
  for (const ticket of tickets) {
    const pattern = new RegExp(`\\b${ticket.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(text) && !related.has(ticket.id)) {
      related.set(ticket.id, ticket);
    }
  }
  if (related.size === 0) {
    return '-';
  }
  return [...related.values()].map((ticket) => formatMarkdownLink(ticket.id, ticket.url || null)).join('<br/>');
}

function formatMarkdownLink(label: string, url?: string | null): string {
  return url ? `[${label}](${url})` : label;
}

function sanitizeTableCell(value: string): string {
  return (value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}
