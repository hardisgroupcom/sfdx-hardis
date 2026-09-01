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
  // Markdown link (or plain "PR 482") when the action came from a Pull Request, empty otherwise.
  pullRequest: string;
  // Status text, or empty when the icon already says it (success and manual).
  status: string;
}

/**
 * Flatten a value onto a single line so one action always takes exactly one markdown line.
 * The size guard trims attachments line by line, so a multi-line entry would be cut in half.
 */
function escapeLineValue(value: string): string {
  return (value || '').replace(/\r?\n/g, ' ').trim();
}

/**
 * Map an action result to its icon + status label.
 * The status label is only kept for failures: ✅ and 👋 already carry the whole meaning, so
 * repeating "success" / "manual" next to them is noise in a chat message.
 * Returns null for actions that must not appear in the notification: skipped ones, ones marked
 * "not-run" because the metadata deployment failed (the notification already reports that
 * failure, so listing every action it prevented would only add noise), and ones that never ran
 * at all (no result, e.g. actions after a failure aborted the sequence).
 */
function getStatusIconAndLabel(cmd: PrePostCommand, translate: boolean): { icon: string; status: string } | null {
  const statusCode = cmd.result?.statusCode;
  if (statusCode === 'manual') {
    return { icon: '👋', status: '' };
  }
  if (statusCode === 'success') {
    return { icon: '✅', status: '' };
  }
  if (statusCode === 'failed') {
    return cmd.allowFailure === true
      ? { icon: '⚠️', status: tMaybe(translate, 'deploymentActionStatusFailedAllowed') }
      : { icon: '❌', status: tMaybe(translate, 'deploymentActionStatusFailed') };
  }
  return null;
}

/**
 * Render the source Pull Request reference for an action that did not come from the branch config.
 *
 * Now that the section is a plain list instead of a code-fenced table, a markdown link survives
 * conversion on every channel (Slack mrkdwn, Teams, Google Chat and HTML email all render links),
 * so the PR id is clickable. Falls back to a plain id when the provider gave us no URL.
 */
function getPullRequestReference(cmd: PrePostCommand): string {
  if (!cmd.pullRequest) {
    return '';
  }
  const idStr = escapeLineValue(cmd.pullRequest.idStr || '?');
  const webUrl = cmd.pullRequest.webUrl;
  return webUrl ? `[PR ${idStr}](${webUrl})` : `PR ${idStr}`;
}

function buildActionRow(cmd: PrePostCommand, translate: boolean): DeploymentActionRow | null {
  const statusInfo = getStatusIconAndLabel(cmd, translate);
  if (!statusInfo) {
    return null;
  }
  return {
    icon: statusInfo.icon,
    label: escapeLineValue(cmd.label),
    type: escapeLineValue(cmd.type || 'command'),
    pullRequest: getPullRequestReference(cmd),
    status: statusInfo.status,
  };
}

/**
 * Render one action as a single markdown line: icon, label, type, source Pull Request, and the
 * status only when the icon does not already say it.
 * e.g. "👋 Activate PersonAccount (manual) · [PR 456](https://...)"
 *      "⚠️ Warm platform cache (command) - failed (allowed)"
 */
function renderActionLine(row: DeploymentActionRow): string {
  const type = row.type ? ` (${row.type})` : '';
  const status = row.status ? ` - ${row.status}` : '';
  const pullRequest = row.pullRequest ? ` · ${row.pullRequest}` : '';
  return `${row.icon} ${row.label}${type}${status}${pullRequest}`;
}

/**
 * Label of the metadata deployment row.
 *
 * A FULL deployment sends the whole package.xml, so "3027 deployed" says how big the project is,
 * not what the deployment did: the created / updated / deleted / unchanged split is what tells a
 * reader whether the release moved anything. It comes from the per-component detail rows of the
 * deploy result, which are missing on some results (QuickDeploy without details, the synthetic
 * destructive-changes-only result) - the older deployed/deleted wording is kept for those, because
 * "0 changed" would claim a no-op deployment that did not happen.
 */
function buildMetadataDeploymentLabel(translate: boolean, options: {
  componentsDeployed: number;
  componentsDeleted: number;
  componentsChangeDetail?: boolean;
  componentsCreated?: number;
  componentsUpdated?: number;
  componentsUnchanged?: number;
}): string {
  if (options.componentsChangeDetail === true) {
    return tMaybe(translate, 'metadataDeploymentBreakdown', {
      deployed: options.componentsDeployed,
      created: options.componentsCreated ?? 0,
      updated: options.componentsUpdated ?? 0,
      deleted: options.componentsDeleted,
      unchanged: options.componentsUnchanged ?? 0,
    });
  }
  return tMaybe(translate, 'metadataDeploymentDeployedDeleted', {
    // numberComponentsDeployed lumps deletions in with the rest, so they are counted once only
    deployed: Math.max(0, options.componentsDeployed - options.componentsDeleted),
    deleted: options.componentsDeleted,
  });
}

/**
 * Build the "Deployment Actions" notification attachment: every non-skipped pre-deploy action,
 * the metadata deployment itself, then every non-skipped post-deploy action, grouped under a
 * heading per phase.
 *
 * Deliberately NOT a markdown table. Slack, Teams and Google Chat have no table syntax, so their
 * converters wrap a pipe table in a monospace fence - and since no converter pads cells, the
 * columns do not line up and long labels wrap mid-row, which reads worse than a plain list. A
 * phase heading also drops a column that would otherwise repeat on every row, and the icon makes
 * the status column redundant for anything that did not fail.
 *
 * One action is always exactly one line, because the message size guard trims attachments line by
 * line.
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
  // Total number of components sent to the org, deletions included (numberComponentsDeployed)
  componentsDeployed: number;
  componentsDeleted: number;
  // Created / updated / unchanged split, only when the deploy result carried per-component detail
  componentsChangeDetail?: boolean;
  componentsCreated?: number;
  componentsUpdated?: number;
  componentsUnchanged?: number;
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

  const deployRows: DeploymentActionRow[] = [];
  if (options.deployExecuted) {
    deployRows.push({
      icon: '✅',
      label: escapeLineValue(buildMetadataDeploymentLabel(translate, options)),
      // The label already says "Metadata deployment", so repeating the type would be noise.
      type: '',
      pullRequest: '',
      status: '',
    });
  }

  const groups: { phase: string; rows: DeploymentActionRow[] }[] = [
    { phase: tMaybe(translate, 'deploymentActionPhasePreDeploy'), rows: preDeployRows },
    { phase: tMaybe(translate, 'deploymentActionPhaseDeploy'), rows: deployRows },
    { phase: tMaybe(translate, 'deploymentActionPhasePostDeploy'), rows: postDeployRows },
  ].filter((group) => group.rows.length > 0);

  if (groups.length === 0) {
    return null;
  }

  const sections = groups.map(
    (group) => `_${group.phase}_\n${group.rows.map((row) => renderActionLine(row)).join('\n')}`
  );
  return `**${tMaybe(translate, 'notifAttachmentDeploymentActions')}**\n\n${sections.join('\n\n')}`;
}
