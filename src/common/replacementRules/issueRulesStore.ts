// Replacement rules stored in a git provider issue (GitHub, GitLab), work item (Azure DevOps) or
// dedicated Pull Request (Bitbucket): the scratch org pool dashboard objects. A release manager can
// change a rule for the whole project there without a commit, for example to fix a failing
// Pull Request between major branches. The rules are a YAML block of the body.

import yaml from 'js-yaml';
import { SfError } from '@salesforce/core';
import { GitProvider } from '../gitProvider/index.js';
import { DashboardFormat, GitProviderRoot } from '../gitProvider/gitProviderRoot.js';
import { CONSTANTS } from '../../config/index.js';
import { t } from '../utils/i18n.js';
import { cleanRuleForStorage, normalizeRuleList, REPLACEMENT_RULES_CONFIG_KEY } from './ruleConfig.js';
import { IssueRulesState, ReplacementRule } from './types.js';

export const REPLACEMENT_RULES_ISSUE_TITLE = 'sfdx-hardis Replacement Rules';
export const REPLACEMENT_RULES_DOC_URL = `${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-config-replacement-rules/`;

let cachedState: IssueRulesState | null = null;

/** Rules of the issue. Never throws: a problem is reported in `error`. Read once per process. */
export async function readIssueRules(options: { useCache?: boolean } = {}): Promise<IssueRulesState> {
  if (options.useCache !== false && cachedState) {
    return cachedState;
  }
  let state: IssueRulesState;
  try {
    const provider = await GitProvider.getInstance();
    if (!provider || !provider.supportsDashboard()) {
      state = { available: false, rules: [] };
    } else {
      const title = provider.getDashboardTitle(REPLACEMENT_RULES_ISSUE_TITLE);
      const dashboard = await provider.findDashboard(title);
      if (!dashboard) {
        state = { available: true, rules: [] };
      } else {
        const body = await provider.getDashboardBody(dashboard);
        state = {
          available: true,
          number: dashboard.id,
          url: dashboard.url,
          rules: parseIssueRules(body, provider.getDashboardFormat()),
        };
      }
    }
  } catch (e: any) {
    state = { available: false, rules: [], error: e?.message || String(e) };
  }
  cachedState = state;
  return state;
}

/** Write the rules of the issue, creating it when it does not exist yet */
export async function writeIssueRules(rules: ReplacementRule[]): Promise<{ number: number; url: string }> {
  const provider = await requireDashboardProvider();
  const title = provider.getDashboardTitle(REPLACEMENT_RULES_ISSUE_TITLE);
  const body = buildIssueBody(rules, provider.getDashboardFormat());
  let dashboard = await provider.findDashboard(title);
  if (dashboard) {
    await provider.updateDashboardBody(dashboard, title, body);
  } else {
    dashboard = await provider.createDashboard(title, body);
  }
  cachedState = null;
  return { number: dashboard.id, url: dashboard.url };
}

/** The rules of the first YAML block of the body (Markdown fence, or <pre>/<code> on Azure DevOps) */
export function parseIssueRules(body: string, format: DashboardFormat): ReplacementRule[] {
  const yamlText = format === 'html' ? extractYamlFromHtml(body || '') : extractYamlFromMarkdown(body || '');
  if (yamlText == null || yamlText.trim() === '') {
    return [];
  }
  let doc: any;
  try {
    doc = yaml.load(yamlText);
  } catch (e: any) {
    throw new SfError(t('replacementRulesIssueInvalidYaml', { message: e.message }));
  }
  if (Array.isArray(doc)) {
    return normalizeRuleList(doc);
  }
  return normalizeRuleList(doc?.[REPLACEMENT_RULES_CONFIG_KEY]);
}

export function buildIssueBody(rules: ReplacementRule[], format: DashboardFormat): string {
  const yamlText = yaml.dump(
    { [REPLACEMENT_RULES_CONFIG_KEY]: rules.map((rule) => cleanRuleForStorage(rule)) },
    { lineWidth: -1, noRefs: true }
  );
  const paragraphs = [
    'Rules applied to the metadata before each deployment, on top of the rules of the repository (config/.sfdx-hardis.yml and config/branches/). A rule with the same id as a rule of the repository changes it.',
    'Edit the YAML block below, or use the Replacement Rules panel of VS Code, or sf hardis:project:replacement:update --layer issue. A change applies to the next deployment job: run the check of an open Pull Request again before merging it.',
    'Never write a secret value here: a rule names a CI/CD variable with "secret:".',
  ];
  if (format === 'html') {
    return [
      '<!-- sfdx-hardis replacement-rules -->',
      `<h2>${REPLACEMENT_RULES_ISSUE_TITLE}</h2>`,
      ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
      `<pre><code>${escapeHtml(yamlText)}</code></pre>`,
      `<p><a href="${REPLACEMENT_RULES_DOC_URL}">Documentation</a></p>`,
    ].join('\n');
  }
  return [
    '<!-- sfdx-hardis replacement-rules -->',
    `## ${REPLACEMENT_RULES_ISSUE_TITLE}`,
    '',
    ...paragraphs.flatMap((paragraph) => [paragraph, '']),
    '```yaml',
    yamlText.trimEnd(),
    '```',
    '',
    `[Documentation](${REPLACEMENT_RULES_DOC_URL})`,
  ].join('\n');
}

/** For tests */
export function clearIssueRulesCache(): void {
  cachedState = null;
}

async function requireDashboardProvider(): Promise<GitProviderRoot> {
  const provider = await GitProvider.getInstance();
  if (!provider || !provider.supportsDashboard()) {
    throw new SfError(t('replacementRulesIssueNoProvider'));
  }
  return provider;
}

function extractYamlFromMarkdown(body: string): string | null {
  const match = /```ya?ml[^\S\r\n]*\r?\n([\s\S]*?)```/i.exec(body);
  return match ? match[1] : null;
}

// The rich text editor of Azure DevOps can wrap lines in <div> or <br>: they become newlines
function extractYamlFromHtml(body: string): string | null {
  const match = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(body) || /<code[^>]*>([\s\S]*?)<\/code>/i.exec(body);
  if (!match) {
    return null;
  }
  const text = match[1]
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return text;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
