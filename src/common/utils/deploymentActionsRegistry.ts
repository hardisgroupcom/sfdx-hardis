import type { PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { tMaybe } from './i18n.js';

/**
 * Registry of deployment actions executed during the current process.
 *
 * `executePrePostCommands` (prePostCommandUtils.ts) records its commands here after running them,
 * so the post-deployment notification can report what happened without threading the list through
 * every deploy call site (the function returns void and has ~8 callers).
 *
 * This module deliberately has no runtime import other than i18n: prePostCommandUtils already
 * imports gitUtils, so putting the accumulator in either of those files would create an import
 * cycle. `PrePostCommand` is imported as a type only, which disappears at compile time.
 *
 * Lifetime is the process. The CLI runs one deployment per process, and `smartDeploy` calls
 * `resetExecutedDeploymentActions()` before starting, so entries never leak between runs.
 */

const METADATA_ACTION_TYPE = 'metadata';

let executedDeploymentActions: PrePostCommand[] = [];

export function recordExecutedDeploymentActions(commands: PrePostCommand[]): void {
  executedDeploymentActions.push(...commands);
}

export function resetExecutedDeploymentActions(): void {
  executedDeploymentActions = [];
}

interface DeploymentActionRow {
  icon: string;
  label: string;
  type: string;
  phase: string;
  status: string;
}

/**
 * Escape a value so it cannot break out of a markdown table cell.
 */
function escapeTableCell(value: string): string {
  return (value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/**
 * Map an action result to its icon + translated status label.
 * Returns null for actions that must not appear in the notification: skipped ones, and
 * ones that never ran (no result, e.g. actions after a failure aborted the sequence).
 */
function getStatusIconAndLabel(cmd: PrePostCommand, translate: boolean): { icon: string; status: string } | null {
  const statusCode = cmd.result?.statusCode;
  if (statusCode === 'manual') {
    return { icon: '👋', status: tMaybe(translate, 'deploymentActionStatusManual') };
  }
  if (statusCode === 'success') {
    return { icon: '✅', status: tMaybe(translate, 'deploymentActionStatusSuccess') };
  }
  if (statusCode === 'failed') {
    return cmd.allowFailure === true
      ? { icon: '⚠️', status: tMaybe(translate, 'deploymentActionStatusFailedAllowed') }
      : { icon: '❌', status: tMaybe(translate, 'deploymentActionStatusFailed') };
  }
  return null;
}

/**
 * Render the action label, naming the source Pull Request when the action did not come from the
 * branch config.
 *
 * The Pull Request comment uses a markdown link here, but this table cannot: Slack, Teams and
 * Google Chat have no table syntax, so their converters wrap the whole table in a monospace code
 * fence. Markdown inside a fence is left verbatim, so a link would render as literal
 * "[482](https://...)" and would not be clickable anyway. The plain id reads correctly everywhere,
 * and the notification already carries a "View Pull Request" button.
 */
function getActionLabel(cmd: PrePostCommand): string {
  const label = escapeTableCell(cmd.label);
  if (cmd.pullRequest) {
    return `${label} (PR ${escapeTableCell(cmd.pullRequest.idStr || '?')})`;
  }
  return label;
}

function buildActionRow(cmd: PrePostCommand, translate: boolean): DeploymentActionRow | null {
  const statusInfo = getStatusIconAndLabel(cmd, translate);
  if (!statusInfo) {
    return null;
  }
  return {
    icon: statusInfo.icon,
    label: getActionLabel(cmd),
    type: escapeTableCell(cmd.type || 'command'),
    phase:
      cmd.when === 'pre-deploy'
        ? tMaybe(translate, 'deploymentActionPhasePreDeploy')
        : tMaybe(translate, 'deploymentActionPhasePostDeploy'),
    status: statusInfo.status,
  };
}

/**
 * Build the "Deployment Actions" notification attachment: every non-skipped pre-deploy action,
 * the metadata deployment itself, then every non-skipped post-deploy action.
 *
 * Returns null when there is nothing worth reporting (no metadata deployed and no reportable
 * action), so the caller can skip the attachment entirely.
 *
 * `translate` is false unless the project opted in via notifTranslateDeploymentMessages /
 * NOTIF_TRANSLATE_DEPLOYMENT_MESSAGES: deployment notifications land in shared team channels, so
 * they stay in English by default rather than following the pipeline machine's locale.
 */
export function buildDeploymentActionsAttachmentText(translate: boolean, options: {
  deployExecuted: boolean;
  componentsDeployed: number;
  componentsDeleted: number;
}): string | null {
  const preDeployRows: DeploymentActionRow[] = [];
  const postDeployRows: DeploymentActionRow[] = [];
  for (const cmd of executedDeploymentActions) {
    const row = buildActionRow(cmd, translate);
    if (!row) {
      continue;
    }
    if (cmd.when === 'pre-deploy') {
      preDeployRows.push(row);
    } else {
      postDeployRows.push(row);
    }
  }

  const rows: DeploymentActionRow[] = [...preDeployRows];
  if (options.deployExecuted) {
    rows.push({
      icon: '✅',
      label: escapeTableCell(
        tMaybe(translate, 'metadataDeploymentDeployedDeleted', {
          deployed: options.componentsDeployed,
          deleted: options.componentsDeleted,
        })
      ),
      type: METADATA_ACTION_TYPE,
      phase: tMaybe(translate, 'deploymentActionPhaseDeploy'),
      status: tMaybe(translate, 'deploymentActionStatusSuccess'),
    });
  }
  rows.push(...postDeployRows);

  if (rows.length === 0) {
    return null;
  }

  let markdown = `**${tMaybe(translate, 'notifAttachmentDeploymentActions')}**\n\n`;
  // Empty first header cell: Slack and Teams render the table inside a monospace code fence, where
  // the `<!-- -->` placeholder used in Pull Request comments would show up as literal text.
  markdown += `|   | ${tMaybe(translate, 'notifTableColLabel')} | ${tMaybe(translate, 'notifTableColType')} | ${tMaybe(translate, 'notifTableColPhase')} | ${tMaybe(translate, 'notifTableColStatus')} |\n`;
  markdown += `|:--------:|-------|------|-------|--------|\n`;
  for (const row of rows) {
    markdown += `| ${row.icon} | ${row.label} | ${row.type} | ${row.phase} | ${row.status} |\n`;
  }
  return markdown.trimEnd();
}
