// What the Pull Request comments say about the replacement rules of a deployment.
// Values are never written: only rule ids, where they come from, and the number of files.

import { ReplacementRuleOrigin, ReplacementRulesReport } from '../utils/types.js';

const MAX_LISTED_RULES = 30;

/** Markdown section of the validation and deployment comments. Empty when there is nothing to say. */
export function buildReplacementRulesMarkdown(report: ReplacementRulesReport | null | undefined): string {
  if (!report) {
    return '';
  }
  const target = report.target.targetBranch ? `\`${report.target.targetBranch}\`` : report.target.label;
  if (report.skipped === 'env') {
    return `⚠️ Replacement rules were skipped for ${target} (SFDX_HARDIS_SKIP_REPLACEMENT_RULES=true)`;
  }
  if (report.skipped === 'config') {
    return `⚠️ Replacement rules were skipped for ${target} (\`skipReplacementRules: true\` in \`${report.skippedBy}\`)`;
  }
  const applied = report.appliedRules;
  const warnings = report.warnings;
  if (applied.length === 0 && warnings.length === 0) {
    return '';
  }
  const summaryParts = [`${applied.length} applied`];
  if (warnings.length > 0) {
    summaryParts.push(`${warnings.length} warning${warnings.length > 1 ? 's' : ''}`);
  }
  const summary = `${warnings.length > 0 ? '⚠️' : '🔁'} Replacement rules for ${target}: ${summaryParts.join(', ')}`;
  const lines: string[] = [];
  if (warnings.length > 0) {
    lines.push(...warnings.map((warning) => `- ⚠️ ${escapeMarkdown(warning.message)}`), '');
  }
  if (applied.length > 0) {
    lines.push('| Rule | From | Files changed |', '|------|------|:-------------:|');
    for (const rule of applied.slice(0, MAX_LISTED_RULES)) {
      lines.push(`| \`${rule.id}\` | ${originLabel(rule.origins, report)} | ${rule.files} |`);
    }
    if (applied.length > MAX_LISTED_RULES) {
      lines.push(`| _... and ${applied.length - MAX_LISTED_RULES} more_ | | |`);
    }
    lines.push('');
  }
  if (report.target.apiVersion != null && applied.some((rule) => rule.origins.includes('builtin'))) {
    lines.push(`_Built-in rules compared the elements with the deployment API version ${report.target.apiVersion.toFixed(1)}._`, '');
  }
  lines.push('_Values are never shown. The files in git are not modified._');
  const open = warnings.length > 0 ? ' open' : '';
  return `<details${open}>\n<summary>${summary}</summary>\n\n${lines.join('\n')}\n</details>`;
}

function originLabel(origins: ReplacementRuleOrigin[], report: ReplacementRulesReport): string {
  const labels = origins.map((origin) => {
    if (origin === 'issue') {
      return report.issue?.number ? `issue #${report.issue.number}` : 'issue';
    }
    if (origin === 'branch') {
      return 'branch config';
    }
    if (origin === 'builtin') {
      return 'built-in';
    }
    return 'project config';
  });
  return labels.join(' + ');
}

function escapeMarkdown(text: string): string {
  return String(text || '').replace(/\r?\n/g, ' ').replace(/</g, '&lt;').replace(/\|/g, '\\|');
}
