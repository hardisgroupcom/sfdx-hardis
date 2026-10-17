/**
 * Summary of an upsert posted on the ticket the test cases are linked to: which cases were
 * created or updated, with a link to each one in the test management tool.
 *
 * One comment per ticket and per tool, kept up to date by its marker: a rerun of the upsert
 * replaces the summary instead of adding a new one.
 */

import { TestManagementProviderRoot } from './testManagementProviderRoot.js';
import type { PushReport, PushRow } from './index.js';
import { NormalizedTestCase } from '../utils/testNotebookUtils.js';
import { TicketProvider } from '../ticketProvider/index.js';
import { PostCommentResult, escapeMarkdownText } from '../ticketProvider/utils/ticketComment.js';

/** Post (or update) the summary of the cases of each carrier ticket. Never throws. */
export async function postTestCasesSummaries(
  providerKey: string,
  provider: TestManagementProviderRoot,
  cases: NormalizedTestCase[],
  report: PushReport
): Promise<PostCommentResult[]> {
  const results: PostCommentResult[] = [];
  for (const [ticket, ticketCases] of _casesByTicket(cases)) {
    const caseIds = new Set(ticketCases.map((testCase) => testCase.id));
    const rows = report.rows.filter((row) => caseIds.has(row.caseId));
    const markdown = buildTestCasesSummaryMarkdown(provider.getLabel(), ticketCases, rows);
    const carrier = provider.carrierTicketRef(ticket);
    results.push(
      await TicketProvider.postComment(carrier.ticketId, markdown, {
        providerKey: carrier.ticketProviderKey,
        marker: testCasesSummaryMarker(providerKey),
      })
    );
  }
  return results;
}

/** One summary per tool: the Azure DevOps and the Xray summaries of a ticket never replace each other. */
export function testCasesSummaryMarker(providerKey: string): string {
  return `test-cases:${providerKey}`;
}

/**
 * Markdown of the summary, in English whatever the locale: the ticket is read by the whole team,
 * and a run in another language must not rewrite it.
 */
export function buildTestCasesSummaryMarkdown(label: string, cases: NormalizedTestCase[], rows: PushRow[]): string {
  const titles = new Map(cases.map((testCase) => [testCase.id, testCase.title]));
  const count = (action: PushRow['action']): number => rows.filter((row) => row.action === action).length;
  const cell = (value: unknown): string => escapeMarkdownText(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  const lines = [
    `### Test cases in ${escapeMarkdownText(label)}`,
    '',
    `${rows.length} test case${rows.length === 1 ? '' : 's'}: ${count('created')} created, ${count('updated')} updated, ${count('failed')} failed.`,
    '',
    '| Case | Title | Result | Test case |',
    '|---|---|---|---|',
    ...rows.map((row) => {
      const link = row.trackerId ? (row.url ? `[${cell(row.trackerId)}](${row.url})` : cell(row.trackerId)) : '';
      const result = row.action === 'failed' && row.error ? `failed: ${cell(row.error)}` : row.action;
      return `| ${cell(row.caseId)} | ${cell(titles.get(row.caseId) ?? '')} | ${result} | ${link} |`;
    }),
    '',
    `_Updated by sfdx-hardis on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC_`,
  ];
  return lines.join('\n');
}

/** Cases grouped by carrier ticket, in the order the notebook lists them. */
function _casesByTicket(cases: NormalizedTestCase[]): Map<string, NormalizedTestCase[]> {
  const groups = new Map<string, NormalizedTestCase[]>();
  for (const testCase of cases) {
    const group = groups.get(testCase.ticket) ?? [];
    group.push(testCase);
    groups.set(testCase.ticket, group);
  }
  return groups;
}
