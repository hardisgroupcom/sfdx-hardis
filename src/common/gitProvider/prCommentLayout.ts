import type { PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { buildManualActionCheckboxMarker } from '../utils/deploymentActionsStateUtils.js';
import { getTicketCollectionIssues } from '../ticketProvider/ticketProviderRoot.js';
import { formatShortDate } from './prCommentDates.js';
import type { PrCommentActionsRun, PullRequestData } from './index.js';
import { PrCommentSection, SHORTENED_CODE_BLOCK_LINES, SHORTENED_LIST_ENTRIES, truncateCodeBlocks, truncateList } from './prCommentSizeGuard.js';

/**
 * Layout of the validation and deployment Pull Request comments.
 *
 * Every comment reads the same way, so a reader learns where to look: a verdict line naming the
 * target org, a short table of checks, then what needs the reader (errors, failed actions, manual
 * actions), then the details folded. The banner, the navigation and the footer are added by the
 * git provider around these sections.
 */

export type PrCommentLayoutOptions = {
  checkOnly: boolean;
  // Branch of the org the comment is about: the target of the Pull Request for a validation, the
  // deployed branch for a deployment
  targetBranch: string;
  // Number of the Pull Request the comment is posted on: its own link is never repeated
  prNumber?: number | null;
  // A successful validation that the merge job can release with Quick Deploy
  quickDeployReusable?: boolean;
};

type ActionPhase = 'pre-deploy' | 'post-deploy';

// Number of deployment errors kept when the comment is too large
const SHORTENED_ERRORS = 10;

type PhasedCommand = { cmd: PrePostCommand; phase: ActionPhase; orgBranch?: string };

/**
 * Sections of a validation or deployment comment, in reading order, ready for the size guard
 */
export function buildDeploymentPrCommentSections(prData: Partial<PullRequestData>, options: PrCommentLayoutOptions): PrCommentSection[] {
  const commands = listPhasedCommands(prData);
  const sections: PrCommentSection[] = [];
  sections.push({ id: 'verdict', keep: true, markdown: buildVerdict(prData, commands, options) });
  sections.push({ id: 'checks', keep: true, markdown: buildCheckTable(prData, commands, options) });
  sections.push(...buildNeedsYouSections(prData, commands, options));
  sections.push(...buildDetailSections(prData, commands, options));
  return sections.filter((section) => section.markdown.trim() !== '');
}

/**
 * Words telling why an action did not run, written for the person reading the Pull Request
 */
export function humanActionReason(cmd: PrePostCommand, orgBranch?: string): string {
  const result = cmd.result;
  if (!result) {
    return '';
  }
  const org = orgBranch ? ` ${orgBranch}` : '';
  switch (result.skippedCode) {
    case 'already-run-in-org': {
      const date = (result.skippedReason || '').match(/on (\d{4}-\d{2}-\d{2})/);
      return `Already done in${org || ' this org'}${date ? ` on ${formatShortDate(date[1])}` : ''}`;
    }
    case 'context-deployment-only':
      return 'Runs after the merge only';
    case 'context-validation-only':
      return 'Runs during the validation only';
    case 'branch-not-targeted':
      return `Not meant for${org || ' this org'}`;
    case 'identical-action-already-run':
      return 'The same action already ran in this job';
    case 'stopped-by-failure':
      return `Waits for ${result.stoppedByLabel ? `"${result.stoppedByLabel}"` : 'an action'}, which failed`;
    case 'deployment-failed':
      return 'Not run: the deployment failed';
    default:
      break;
  }
  if (result.statusCode === 'failed' && cmd.allowFailure === true) {
    // "failed, allowed to fail" is already the status of the action
    return result.skippedReason || '';
  }
  if (result.statusCode === 'manual') {
    return 'To do by hand';
  }
  if (result.statusCode === 'skipped' || result.statusCode === 'not-run' || result.statusCode === 'failed') {
    return result.skippedReason || '';
  }
  return '';
}

function listPhasedCommands(prData: Partial<PullRequestData>): PhasedCommand[] {
  const fromRun = (run: PrCommentActionsRun | undefined, phase: ActionPhase): PhasedCommand[] =>
    (run?.commands || []).map((cmd) => ({ cmd, phase, orgBranch: run?.orgBranch }));
  return [...fromRun(prData.preDeployActions, 'pre-deploy'), ...fromRun(prData.postDeployActions, 'post-deploy')];
}

function buildVerdict(prData: Partial<PullRequestData>, commands: PhasedCommand[], options: PrCommentLayoutOptions): string {
  const target = `\`${options.targetBranch || 'the target org'}\``;
  const status = prData.status || prData.deployStatus;
  const failedActions = commands.filter((c) => isBlockingFailure(c.cmd));
  const nothingToDeploy = isNothingToDeploy(prData);
  let verdict: string;
  let next: string;
  if (status === 'valid') {
    if (options.checkOnly) {
      verdict = nothingToDeploy ? `✅ Ready to merge into ${target}: no metadata to deploy` : `✅ Ready to merge into ${target}`;
      next = nothingToDeploy ? '' : `The deployment was simulated in the ${target} org: nothing was changed there.`;
    } else {
      verdict = nothingToDeploy ? `✅ Nothing to deploy to ${target}` : `✅ Deployed to ${target}`;
      next = '';
    }
  } else if (status === 'invalid') {
    const reason = describeFailure(prData, failedActions);
    if (options.checkOnly) {
      verdict = `❌ Cannot merge into ${target}: ${reason}`;
      next = 'Fix it, commit and push: the validation runs again.';
    } else if (prData.metadataOutcome === 'deployed') {
      // Salesforce accepted the deployment: what failed came after it (an action, the coverage check)
      verdict = `❌ Deployed to ${target}, but ${failedActions.length > 0 ? `${failedActions.length === 1 ? 'an action' : `${failedActions.length} actions`} failed after the deployment` : reason}`;
      next = failedActions.length > 0
        ? `The org has the new metadata. Rerun or fix the failed ${failedActions.length === 1 ? 'action' : 'actions'} below.`
        : 'The org has the new metadata.';
    } else if (nothingToDeploy) {
      verdict = `❌ Nothing to deploy to ${target}, but ${reason}`;
      next = '';
    } else {
      verdict = `❌ Not deployed to ${target}: ${reason}`;
      next = 'The metadata of this Pull Request is not in the org.';
    }
  } else {
    verdict = `⏳ ${stripLeadingIcons(prData.title || '') || 'Waiting for the result'}`;
    next = '';
  }
  // A short note explaining an empty deployment ("No metadata to deploy: the package.xml is empty...")
  const note = prData.deployErrorsMarkdownBody && !prData.deployErrorsMarkdownBody.startsWith('## ') ? prData.deployErrorsMarkdownBody.trim() : '';
  return [`### ${verdict}`, [next, note].filter((text) => text !== '').join(' ')].filter((line) => line !== '').join('\n\n');
}

function isNothingToDeploy(prData: Partial<PullRequestData>): boolean {
  return prData.metadataOutcome === 'nothing-to-deploy' || (prData.title || '').includes('No metadata to deploy');
}

function describeFailure(prData: Partial<PullRequestData>, failedActions: PhasedCommand[]): string {
  if ((prData.errorCount || 0) > 0) {
    return `${prData.errorCount} deployment ${prData.errorCount === 1 ? 'error' : 'errors'}`;
  }
  if ((prData.failedTestsCount || 0) > 0) {
    return `${prData.failedTestsCount} Apex test ${prData.failedTestsCount === 1 ? 'failure' : 'failures'}`;
  }
  if (prData.coverage?.status === 'invalid') {
    return `code coverage ${prData.coverage.value}% is under the ${prData.coverage.target}% target`;
  }
  if (failedActions.length > 0) {
    const phase = failedActions[0].phase === 'pre-deploy' ? 'pre-deployment' : 'post-deployment';
    return failedActions.length === 1 ? `a ${phase} action failed` : `${failedActions.length} deployment actions failed`;
  }
  const fromTitle = stripLeadingIcons(prData.title || '');
  return fromTitle || 'see the details below';
}

function buildCheckTable(prData: Partial<PullRequestData>, commands: PhasedCommand[], options: PrCommentLayoutOptions): string {
  const rows: [string, string][] = [];
  rows.push(['Metadata', describeMetadata(prData, options)]);
  const tests = describeApexTests(prData, options);
  if (tests) {
    rows.push(['Apex tests', tests]);
  }
  const actions = describeActions(commands, options);
  if (actions) {
    rows.push(['Deployment actions', actions]);
  }
  if (options.checkOnly && options.quickDeployReusable === true) {
    rows.push(['Quick Deploy', '✅ The merge job can reuse this validation: Apex tests will not run again']);
  }
  if (!options.checkOnly && prData.usedQuickDeploy === true) {
    rows.push(['Quick Deploy', '✅ Used: the validation of the Pull Request was deployed as it is']);
  }
  const flows = describeFlows(prData);
  if (flows) {
    rows.push(['Flows', flows]);
  }
  return ['| Check | Result |', '|-------|--------|', ...rows.map(([check, result]) => `| ${check} | ${result} |`)].join('\n');
}

function describeMetadata(prData: Partial<PullRequestData>, options: PrCommentLayoutOptions): string {
  const errors = prData.errorCount || 0;
  if (errors > 0) {
    return `❌ ${errors} ${errors === 1 ? 'error' : 'errors'}: nothing was ${options.checkOnly ? 'validated' : 'deployed'}`;
  }
  if (isNothingToDeploy(prData)) {
    return '✅ Nothing to deploy';
  }
  const metrics = prData.deploymentMetrics;
  const status = prData.status || prData.deployStatus;
  if (metrics) {
    const changed = metrics.created + metrics.updated + metrics.deleted;
    const split = [
      metrics.created > 0 ? `${metrics.created} created` : '',
      metrics.updated > 0 ? `${metrics.updated} updated` : '',
      metrics.deleted > 0 ? `${metrics.deleted} deleted` : '',
    ].filter((part) => part !== '').join(', ');
    const failedTests = (prData.failedTestsCount || 0) > 0 || prData.coverage?.status === 'invalid';
    if (options.checkOnly) {
      return `${failedTests ? '⚪' : '✅'} ${changed} ${changed === 1 ? 'component' : 'components'} would change${split ? ` (${split})` : ''}, ${metrics.deployed} validated`;
    }
    // A coverage under the target is checked by sfdx-hardis after Salesforce accepted the deployment
    if (prData.metadataOutcome !== 'deployed' && failedTests) {
      return `⚪ Not deployed: the Apex tests failed`;
    }
    return `✅ Deployed: ${changed} ${changed === 1 ? 'component' : 'components'} changed${split ? ` (${split})` : ''}`;
  }
  if (status === 'valid' || prData.metadataOutcome === 'deployed') {
    return options.checkOnly ? '✅ Validated' : '✅ Deployed';
  }
  return options.checkOnly ? '⚪ Not validated' : '⚪ Not deployed';
}

function describeApexTests(prData: Partial<PullRequestData>, options: PrCommentLayoutOptions): string {
  const failures = prData.failedTestsCount || 0;
  if (failures > 0) {
    return `❌ ${failures} test ${failures === 1 ? 'failure' : 'failures'}`;
  }
  if (!options.checkOnly && prData.usedQuickDeploy === true) {
    return '✅ Already run during the validation';
  }
  const testClassesCount = prData.testClasses?.length || 0;
  const testClasses = testClassesCount > 0 ? ` · ${testClassesCount} test ${testClassesCount === 1 ? 'class' : 'classes'}` : '';
  if (prData.coverage) {
    const { value, target, status } = prData.coverage;
    if (status === 'invalid') {
      return `❌ Coverage ${value}%, under the ${target}% target${testClasses}`;
    }
    if (status === 'invalid_ignored') {
      return `⚠️ Coverage ${value}%, under the ${target}% target (not blocking)${testClasses}`;
    }
    return `✅ Coverage ${value}% (target ${target}%)${testClasses}`;
  }
  switch (prData.testsNotRunReason) {
    case 'smart-tests':
      return '⚪ Not needed: this deployment changes nothing Apex tests cover (smart deployment tests)';
    case 'coverage-skipped':
      return '⚪ Code coverage check skipped for this branch';
    case 'no-apex':
      return '⚪ No Apex in this project';
    default:
      break;
  }
  if ((prData.errorCount || 0) > 0) {
    return '⚪ Not run: the deployment failed first';
  }
  return '';
}

function describeActions(commands: PhasedCommand[], options: PrCommentLayoutOptions): string {
  if (commands.length === 0) {
    return '';
  }
  const count = (predicate: (cmd: PrePostCommand) => boolean) => commands.filter((c) => predicate(c.cmd)).length;
  const failed = count(isBlockingFailure);
  const warnings = count((cmd) => cmd.result?.statusCode === 'failed' && cmd.allowFailure === true);
  const done = count((cmd) => cmd.result?.statusCode === 'success');
  const manual = count((cmd) => cmd.result?.statusCode === 'manual');
  const waiting = count((cmd) => cmd.result?.statusCode === 'not-run');
  const skipped = count((cmd) => cmd.result?.statusCode === 'skipped' || !cmd.result);
  // Manual actions skipped during the validation because they run after the merge
  const manualAfterMerge = options.checkOnly
    ? commands.filter((c) => c.cmd.type === 'manual' && c.cmd.result?.skippedCode === 'context-deployment-only').length
    : 0;
  const parts = [
    failed > 0 ? `❌ ${failed} failed` : '',
    warnings > 0 ? `⚠️ ${warnings} failed, allowed to fail` : '',
    manual > 0 ? `👋 ${manual} to do by hand` : '',
    waiting > 0 ? `⏸️ ${waiting} not run` : '',
    done > 0 ? `✅ ${done} done` : '',
    manualAfterMerge > 0 ? `👋 ${manualAfterMerge} to do by hand after the merge` : '',
    skipped - manualAfterMerge > 0 ? `⚪ ${skipped - manualAfterMerge} skipped` : '',
  ].filter((part) => part !== '');
  return parts.join(' · ');
}

function describeFlows(prData: Partial<PullRequestData>): string {
  const changes = prData.flowChanges || [];
  const truncated = prData.flowDiffMarkdown && (prData.flowDiffMarkdown as any).truncatedNb > 0 ? (prData.flowDiffMarkdown as any).truncatedNb : 0;
  if (changes.length === 0 && truncated === 0) {
    return '';
  }
  const diffs = changes.filter((change) => change.kind === 'diff');
  const statusOnly = changes.filter((change) => change.kind === 'status-only');
  const parts: string[] = [];
  if (diffs.length > 0) {
    parts.push(`🔀 ${diffs.length} changed: ${diffs.map((change) => change.name).join(', ')} (one comment per Flow below)`);
  }
  for (const change of statusOnly) {
    parts.push(`${change.name}: status only, ${change.statusBefore} → ${change.statusAfter}`);
  }
  if (truncated > 0) {
    parts.push(`${truncated} more not shown`);
  }
  return parts.join('<br/>');
}

function buildNeedsYouSections(prData: Partial<PullRequestData>, commands: PhasedCommand[], options: PrCommentLayoutOptions): PrCommentSection[] {
  const sections: PrCommentSection[] = [];
  // Deployment errors and Apex test failures, with their tips
  const errorsMarkdown = prData.deployErrorsMarkdownBody || '';
  if (errorsMarkdown.startsWith('## ')) {
    const headingText = errorsMarkdown.split('\n')[0].replace(/^## /, '').trim();
    const icon = headingText.toLowerCase().includes('test') ? '💥' : '❌';
    const body = errorsMarkdown.split('\n').slice(1).join('\n').trim();
    sections.push({
      id: 'errors',
      keep: true,
      markdown: `#### ${icon} ${headingText}\n\n${body}`,
      // Hundreds of errors with their tips would push the manual actions out of the comment
      shortMarkdown: `#### ${icon} ${headingText}\n\n${keepFirstDetailsBlocks(body, SHORTENED_ERRORS)}`,
    });
  }
  if (prData.blockingIssueMarkdownBody) {
    sections.push({ id: 'blocking-issue', keep: true, markdown: prData.blockingIssueMarkdownBody });
  }
  if (prData.autoFixPullRequestUrl) {
    sections.push({ id: 'auto-fix', keep: true, markdown: `🤖 **A coding agent created a fix Pull Request:** [View fix Pull Request](${prData.autoFixPullRequestUrl})` });
  }
  // Failed actions, with the end of their output
  const failed = commands.filter((c) => isBlockingFailure(c.cmd));
  if (failed.length > 0) {
    const lines = [`#### ❌ Failed ${failed.length === 1 ? 'action' : 'actions'}`, ''];
    for (const { cmd, phase } of failed) {
      lines.push(`**${escapeInline(cmd.label)}** · ${cmd.type || 'command'}, ${phase === 'pre-deploy' ? 'before' : 'after'} the deployment${foreignPullRequest(cmd, options)}`, '');
      const reason = humanActionReason(cmd);
      if (reason) {
        lines.push(`> ${escapeInline(reason)}`, '');
      }
      if ((cmd.result?.output || '').trim() !== '') {
        lines.push(codeBlock(lastLines(cmd.result!.output as string, SHORTENED_CODE_BLOCK_LINES)), '');
      }
    }
    lines.push(`Rerun ${failed.length === 1 ? 'it' : 'them'} with \`sf hardis:project:action:run\`, or with the **Run** button of the Deployment Actions tab of the Pull Request in VS Code.`);
    sections.push({ id: 'failed-actions', keep: true, markdown: lines.join('\n') });
  }
  // Actions stopped by a failed one
  const stopped = commands.filter((c) => c.cmd.result?.skippedCode === 'stopped-by-failure');
  if (stopped.length > 0) {
    sections.push({
      id: 'stopped-actions',
      keep: true,
      markdown: [`#### ⏸️ Not run, waiting for the failed ${failed.length === 1 ? 'action' : 'actions'}`, '', ...stopped.map((c) => `- ${escapeInline(c.cmd.label)}${c.cmd.type === 'manual' ? ' (by hand)' : ''}`)].join('\n'),
    });
  }
  // Manual actions, as checkboxes the next job reads back
  for (const phase of ['pre-deploy', 'post-deploy'] as ActionPhase[]) {
    const checklist = buildManualActionsChecklist(commands.filter((c) => c.phase === phase), phase, options);
    if (checklist) {
      sections.push({ id: `manual-${phase}`, keep: true, markdown: checklist });
    }
  }
  // LEGACY "MANUAL ACTION:" lines of commit messages
  const legacy = prData.legacyManualActions || [];
  if (legacy.length > 0) {
    sections.push({
      id: 'legacy-manual-actions',
      keep: true,
      markdown: ['#### 📝 Manual actions from commit messages', '', ...legacy.map((action) => `- ${action.trim()}`)].join('\n'),
    });
  }
  return sections;
}

/**
 * Manual actions to perform in the org, as checkboxes carrying the hidden marker that lets the next
 * sfdx-hardis job record a ticked box as done. Pre-deployment actions are listed in the validation
 * comment, post-deployment ones in the deployment comment. Actions already performed are listed
 * ticked: unticked, the checkbox sync would tick them again on every job.
 */
function buildManualActionsChecklist(commands: PhasedCommand[], phase: ActionPhase, options: PrCommentLayoutOptions): string {
  if ((phase === 'pre-deploy' && !options.checkOnly) || (phase === 'post-deploy' && options.checkOnly)) {
    return '';
  }
  const isDone = (cmd: PrePostCommand) =>
    cmd.result?.statusCode === 'skipped' &&
    (cmd.result.skippedCode === 'already-run-in-org' || (cmd.result.skippedReason || '').startsWith('runOnlyOnceByOrg: already run'));
  // Failed manual actions (invalid customUsername, auth error...) stay to do
  const manual = commands.filter(
    (c) => c.cmd.type === 'manual' && (c.cmd.result?.statusCode === 'manual' || c.cmd.result?.statusCode === 'failed' || isDone(c.cmd))
  );
  if (manual.length === 0) {
    return '';
  }
  const orgBranch = manual[0].orgBranch;
  const pending = manual.filter((c) => !isDone(c.cmd)).length;
  const title = phase === 'pre-deploy'
    ? `#### 👋 To do by hand in ${orgBranch ? `\`${orgBranch}\`` : 'the org'} before the deployment`
    : `#### 👋 To do by hand in ${orgBranch ? `\`${orgBranch}\`` : 'the org'} after the deployment`;
  const lines = [title, ''];
  for (const { cmd } of manual) {
    // Newlines in a label would break the checklist line and its hidden marker
    const label = (cmd.label || '').replace(/\r?\n/g, ' ');
    const marker = cmd.result && orgBranch ? `${buildManualActionCheckboxMarker(cmd.id, orgBranch, cmd.pullRequest?.idNumber || 0, cmd.when || phase)} ` : '';
    lines.push(`- [${isDone(cmd) ? 'x' : ' '}] ${marker}**${escapeInline(label)}**${foreignPullRequest(cmd, options)}`);
    const instructions = (cmd.parameters?.instructions || '').toString().trim();
    if (instructions && !isDone(cmd)) {
      // Instructions are markdown written by humans: a quote keeps their lists and links, raw
      // HTML is neutralized so it cannot close the blocks around it
      lines.push(...instructions.replace(/</g, '&lt;').split('\n').map((line) => `  > ${line}`));
    }
  }
  if (pending > 0) {
    lines.push('', '_Tick a box once it is done in the org: the next sfdx-hardis job records it._');
  }
  return lines.join('\n');
}

function buildDetailSections(prData: Partial<PullRequestData>, commands: PhasedCommand[], options: PrCommentLayoutOptions): PrCommentSection[] {
  const sections: PrCommentSection[] = [];
  if (commands.length > 0) {
    sections.push({
      id: 'actions',
      markdown: buildActionsDetails(commands, options, Number.MAX_SAFE_INTEGER),
      shortMarkdown: buildActionsDetails(commands, options, SHORTENED_LIST_ENTRIES),
      dropLabel: 'the list of the deployment actions',
    });
  }
  if (prData.deploymentComponentTypesMarkdownBody) {
    sections.push({ id: 'components', markdown: prData.deploymentComponentTypesMarkdownBody, dropLabel: 'the components per type' });
  }
  if (prData.noOverwriteMarkdownBody) {
    sections.push({ id: 'no-overwrite', markdown: prData.noOverwriteMarkdownBody, dropLabel: 'the protected components' });
  }
  if (prData.flowDeletionMarkdownBody) {
    sections.push({ id: 'flow-deletion', markdown: prData.flowDeletionMarkdownBody, dropLabel: 'the Flow deletions' });
  }
  const testClasses = prData.testClasses || [];
  if (testClasses.length > 0) {
    const fold = (entries: string[]) => folded(`🧪 Apex test classes (${testClasses.length})`, entries.join('\n'));
    const entries = testClasses.map((testClass) => `- ${testClass}`);
    sections.push({ id: 'test-classes', markdown: fold(entries), shortMarkdown: fold(truncateList(entries, SHORTENED_LIST_ENTRIES)), dropLabel: 'the Apex test classes' });
  }
  const references = buildReferencesSection(prData, options);
  if (references) {
    sections.push(references);
  }
  if (prData.deploymentScopeMarkdownBody) {
    sections.push({ id: 'scope', markdown: folded('ℹ️ Where the deployment actions and test classes come from', prData.deploymentScopeMarkdownBody), dropLabel: 'the scope explanation' });
  }
  return sections;
}

// Every action of the run in one folded table, the output of each one folded under it
function buildActionsDetails(commands: PhasedCommand[], options: PrCommentLayoutOptions, maxRows: number): string {
  const lines = ['| | Action | When | Result |', '|:-:|--------|------|--------|'];
  const shown = commands.slice(0, maxRows);
  for (const { cmd, phase, orgBranch } of shown) {
    const reason = humanActionReason(cmd, orgBranch);
    const words = statusWords(cmd);
    const result = [words, reason && reason.toLowerCase() !== words.toLowerCase() ? reason : ''].filter((part) => part !== '').join(': ');
    lines.push(`| ${statusIcon(cmd)} | ${escapeCell(cmd.label)}${foreignPullRequest(cmd, options)} | ${phase === 'pre-deploy' ? 'before' : 'after'} | ${escapeCell(result)} |`);
  }
  if (commands.length > shown.length) {
    lines.push(`| | _… and ${commands.length - shown.length} more_ | | |`);
  }
  // Outputs of the actions that did not fail: the failed ones are already shown above
  const outputs = shown.filter((c) => !isBlockingFailure(c.cmd) && (c.cmd.result?.output || '').trim() !== '' && c.cmd.type !== 'manual');
  for (const { cmd } of outputs) {
    lines.push('', folded(`Output of ${escapeInline(cmd.label)}`, codeBlock(lastLines(cmd.result!.output as string, SHORTENED_CODE_BLOCK_LINES))));
  }
  const failedCount = commands.filter((c) => isBlockingFailure(c.cmd)).length;
  const title = `🛠️ Deployment actions of this job (${commands.length})${failedCount > 0 ? `, ${failedCount} failed` : ''}`;
  return folded(title, truncateCodeBlocks(lines.join('\n'), SHORTENED_CODE_BLOCK_LINES));
}

// Tickets and Pull Requests of the deployment, one per line
function buildReferencesSection(prData: Partial<PullRequestData>, options: PrCommentLayoutOptions): PrCommentSection | null {
  const tickets = prData.tickets || [];
  // The Pull Request being read is not listed: only the ones it carries
  const pullRequests = (prData.pullRequestsInScope || []).filter((pr) => !options.prNumber || pr.idNumber !== options.prNumber);
  if (tickets.length === 0 && pullRequests.length === 0) {
    return null;
  }
  const ticketLines = tickets.map((ticket) => {
    const link = ticket.url ? `[${ticket.id}](${ticket.url})` : ticket.id;
    return `- ${link}${ticket.foundOnServer && ticket.subject ? ` ${escapeInline(ticket.subject)}` : ''}${ticket.statusLabel ? ` (${ticket.statusLabel})` : ''}`;
  });
  const prLines = pullRequests.map((pr) => {
    const link = pr.webUrl ? `[#${pr.idStr}](${pr.webUrl})` : `#${pr.idStr}`;
    return `- ${link}${pr.title ? ` ${escapeInline(pr.title)}` : ''}${pr.authorName ? `, by ${escapeInline(pr.authorName)}` : ''}`;
  });
  const issues = getTicketCollectionIssues();
  const render = (ticketEntries: string[], prEntries: string[]) => {
    const parts: string[] = [];
    if (ticketEntries.length > 0) {
      parts.push('**Tickets**', '', ...ticketEntries, '');
      if (issues.length > 0) {
        parts.push(`> ⚠️ ${issues[0]}`, '');
      }
    }
    if (prEntries.length > 0) {
      parts.push('**Pull Requests**', '', ...prEntries);
    }
    const summary = [
      tickets.length > 0 ? `${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}` : '',
      pullRequests.length > 0 ? `${pullRequests.length} Pull ${pullRequests.length === 1 ? 'Request' : 'Requests'}` : '',
    ].filter((part) => part !== '').join(' · ');
    return folded(`🎫 ${summary}`, parts.join('\n').trim());
  };
  return {
    id: 'references',
    markdown: render(ticketLines, prLines),
    shortMarkdown: render(truncateList(ticketLines, SHORTENED_LIST_ENTRIES), truncateList(prLines, SHORTENED_LIST_ENTRIES)),
    dropLabel: 'the tickets and Pull Requests',
  };
}

// An action that failed and was not allowed to fail
function isBlockingFailure(cmd: PrePostCommand): boolean {
  return cmd.result?.statusCode === 'failed' && cmd.allowFailure !== true;
}

function statusIcon(cmd: PrePostCommand): string {
  switch (cmd.result?.statusCode) {
    case 'success':
      return '✅';
    case 'failed':
      return cmd.allowFailure === true ? '⚠️' : '❌';
    case 'manual':
      return '👋';
    case 'not-run':
      return '⏸️';
    case 'skipped':
      return '⚪';
    default:
      return '⚪';
  }
}

function statusWords(cmd: PrePostCommand): string {
  switch (cmd.result?.statusCode) {
    case 'success':
      return 'done';
    case 'failed':
      return cmd.allowFailure === true ? 'failed, allowed to fail' : 'failed';
    case 'manual':
      return 'to do by hand';
    case 'not-run':
      return 'not run';
    case 'skipped':
      return 'skipped';
    default:
      return 'not run';
  }
}

// " (from #42)" when the action comes from another Pull Request than the one being read
function foreignPullRequest(cmd: PrePostCommand, options: PrCommentLayoutOptions): string {
  const pr = cmd.pullRequest;
  if (!pr || (options.prNumber && pr.idNumber === options.prNumber)) {
    return '';
  }
  return pr.webUrl ? ` (from [#${pr.idStr}](${pr.webUrl}))` : ` (from #${pr.idStr})`;
}

// The first `count` top-level <details> blocks of a markdown text (one per deployment error), with a
// line counting the others
function keepFirstDetailsBlocks(markdown: string, count: number): string {
  const tags = [...markdown.matchAll(/<details\b|<\/details>/g)];
  let depth = 0;
  let closed = 0;
  let cutAt = -1;
  for (const tag of tags) {
    if (tag[0] === '</details>') {
      depth--;
      if (depth === 0) {
        closed++;
        if (closed === count) {
          cutAt = (tag.index || 0) + tag[0].length;
        }
      }
    } else {
      depth++;
    }
  }
  if (cutAt < 0 || closed <= count) {
    return markdown;
  }
  return `${markdown.substring(0, cutAt)}\n\n_… and ${closed - count} more in the job log_`;
}

function folded(summary: string, content: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${content.trim()}\n\n</details>`;
}

function codeBlock(text: string): string {
  // A fence inside the output would close the block early
  return '```\n' + text.replace(/```/g, "'''").replace(/\s+$/, '') + '\n```';
}

function lastLines(text: string, maxLines: number): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  if (lines.length <= maxLines) {
    return lines.join('\n');
  }
  return [`… ${lines.length - maxLines} lines left out`, ...lines.slice(-maxLines)].join('\n');
}

function stripLeadingIcons(text: string): string {
  // "❌ Error: Draft deployment actions file found" reads "Draft deployment actions file found"
  return text.split('\n')[0].replace(/^[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/u, '').replace(/^Error:\s*/i, '').trim();
}

function escapeInline(text: string): string {
  return (text || '').replace(/\r?\n/g, ' ').replace(/</g, '&lt;');
}

function escapeCell(text: string): string {
  return escapeInline(text).replace(/\|/g, '\\|');
}
