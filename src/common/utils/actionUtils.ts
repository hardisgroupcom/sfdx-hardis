import { SfError } from '@salesforce/core';
import c from 'chalk';
import fs from 'fs-extra';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { getCurrentGitBranch, isCI, uxLog } from './index.js';
import { PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { findDataWorkspaceByName } from './dataUtils.js';
import { GitProvider } from '../gitProvider/index.js';
import { t } from './i18n.js';

export type ActionScope = 'project' | 'branch' | 'pr';
export type ActionWhen = 'pre-deploy' | 'post-deploy';

const WHEN_TO_CONFIG_KEY: Record<ActionWhen, string> = {
  'pre-deploy': 'commandsPreDeploy',
  'post-deploy': 'commandsPostDeploy',
};

/**
 * Resolve the YAML config file path based on scope, branch name, and PR ID.
 */
export async function getActionConfigFilePath(scope: ActionScope, branch?: string, prId?: string): Promise<string> {
  if (scope === 'project') {
    return path.join('config', '.sfdx-hardis.yml');
  }
  if (scope === 'branch') {
    const branchName = branch || await getCurrentGitBranch({ formatted: true }) || 'main';
    return path.join('config', 'branches', `.sfdx-hardis.${branchName}.yml`);
  }
  // scope === 'pr'
  const prFileName = prId ? `.sfdx-hardis.${prId}.yml` : '.sfdx-hardis.draft.yml';
  return path.join('scripts', 'actions', prFileName);
}

/**
 * Read the actions array from a config file for the given when phase.
 */
export async function readActions(scope: ActionScope, when: ActionWhen, branch?: string, prId?: string): Promise<PrePostCommand[]> {
  const configFile = await getActionConfigFilePath(scope, branch, prId);
  const configKey = WHEN_TO_CONFIG_KEY[when];
  if (!fs.existsSync(configFile)) {
    return [];
  }
  const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8')) || {};
  return Array.isArray(doc[configKey]) ? doc[configKey] : [];
}

/**
 * Write actions array back to config file, preserving other keys.
 */
export async function writeActions(scope: ActionScope, when: ActionWhen, actions: PrePostCommand[], branch?: string, prId?: string): Promise<string> {
  const configFile = await getActionConfigFilePath(scope, branch, prId);
  const configKey = WHEN_TO_CONFIG_KEY[when];
  let doc: any = {};
  if (fs.existsSync(configFile)) {
    doc = yaml.load(fs.readFileSync(configFile, 'utf-8')) || {};
  }
  doc[configKey] = actions;
  await fs.ensureDir(path.dirname(configFile));
  await fs.writeFile(configFile, yaml.dump(doc));
  return configFile;
}

/**
 * Validate type-specific parameters for an action.
 * Returns an array of error messages (empty if valid).
 */
export async function validateActionParameters(action: Partial<PrePostCommand>): Promise<string[]> {
  const errors: string[] = [];
  const type = action.type || 'command';

  if (type === 'command') {
    if (!action.command) {
      errors.push(t('actionValidationNoCommand'));
    }
  } else if (type === 'apex') {
    const apexScript = action.parameters?.apexScript || '';
    if (!apexScript) {
      errors.push(t('actionValidationNoApexScript'));
    } else if (!fs.existsSync(apexScript)) {
      errors.push(t('apexScriptNotFound', { path: apexScript }));
    }
  } else if (type === 'data') {
    const sfdmuProject = action.parameters?.sfdmuProject || '';
    if (!sfdmuProject) {
      errors.push(t('actionValidationNoSfdmuProject'));
    } else {
      const workspace = await findDataWorkspaceByName(sfdmuProject, false);
      if (!workspace) {
        errors.push(t('sfdmuWorkspaceNotFound', { name: sfdmuProject }));
      }
    }
  } else if (type === 'publish-community') {
    if (!action.parameters?.communityName) {
      errors.push(t('actionValidationNoCommunityName'));
    }
  } else if (type === 'manual') {
    if (!action.parameters?.instructions) {
      errors.push(t('actionValidationNoInstructions'));
    }
  } else if (type === 'schedule-batch') {
    if (!action.parameters?.className) {
      errors.push(t('actionValidationNoClassName'));
    }
    if (!action.parameters?.cronExpression) {
      errors.push(t('actionValidationNoCronExpression'));
    }
  }

  return errors;
}

/**
 * Find an action by ID in a list. Throws SfError if not found.
 */
export function findActionById(actions: PrePostCommand[], actionId: string): { action: PrePostCommand; index: number } {
  const index = actions.findIndex(a => a.id === actionId);
  if (index === -1) {
    throw new SfError(t('actionNotFound', { id: actionId }));
  }
  return { action: actions[index], index };
}

/**
 * Build a PrePostCommand from the collected values.
 */
export function buildAction(values: {
  id: string;
  label: string;
  type: PrePostCommand['type'];
  command?: string;
  context?: PrePostCommand['context'];
  skipIfError?: boolean;
  allowFailure?: boolean;
  runOnlyOnceByOrg?: boolean;
  customUsername?: string;
  parameters?: Record<string, any>;
}): PrePostCommand {
  const action: PrePostCommand = {
    id: values.id,
    label: values.label,
    type: values.type,
    command: values.command || '',
    context: values.context || 'all',
  };
  if (values.parameters && Object.keys(values.parameters).length > 0) {
    action.parameters = values.parameters;
  }
  if (values.skipIfError === true) {
    action.skipIfError = true;
  }
  if (values.allowFailure === true) {
    action.allowFailure = true;
  }
  if (values.runOnlyOnceByOrg === true || values.runOnlyOnceByOrg === false) {
    action.runOnlyOnceByOrg = values.runOnlyOnceByOrg;
  }
  if (values.customUsername) {
    action.customUsername = values.customUsername;
  }
  return action;
}

/**
 * Log action details for confirmation.
 */
export function logActionSummary(commandThis: any, action: PrePostCommand): void {
  uxLog("log", commandThis, c.grey(`  id: ${action.id}`));
  uxLog("log", commandThis, c.grey(`  label: ${action.label}`));
  uxLog("log", commandThis, c.grey(`  type: ${action.type}`));
  uxLog("log", commandThis, c.grey(`  context: ${action.context}`));
  if (action.command) {
    uxLog("log", commandThis, c.grey(`  command: ${action.command}`));
  }
  if (action.parameters) {
    for (const [key, value] of Object.entries(action.parameters)) {
      uxLog("log", commandThis, c.grey(`  ${key}: ${value}`));
    }
  }
}

/**
 * Log a hint to the user that actions are in the draft config and they should run link-pull-request.
 */
function notifyDraftUsage(commandThis: any): void {
  uxLog("log", commandThis, c.cyan(t('draftUsageHint')));
}

/**
 * Resolve the PR ID when the user passes "current".
 * - Tries to find the PR matching the current branch via GitProvider.
 * - In interactive mode: if not found, prompts the user then falls back to "draft".
 * - In agent mode: if not found, logs a warning and falls back to "draft".
 * - If prId is not "current", returns it as-is (or undefined).
 * - When returning undefined (draft fallback), logs a hint to run link-pull-request.
 */
export async function resolvePrId(
  commandThis: any,
  prId: string | undefined,
  agentMode: boolean,
): Promise<string | undefined> {
  if (!prId || prId !== 'current') {
    if (!prId) {
      // No PR ID provided — will use draft config
      notifyDraftUsage(commandThis);
    }
    return prId;
  }

  // Try to find the PR for the current branch
  try {
    const prInfo = await GitProvider.getPullRequestInfo();
    if (prInfo && prInfo.idStr) {
      uxLog("log", commandThis, c.grey(t('prResolvedFromBranch', { prId: prInfo.idStr })));
      return prInfo.idStr;
    }
  } catch (e) {
    uxLog("warning", commandThis, c.yellow(t('prResolutionFailed', { message: (e as Error).message })));
  }

  // PR not found
  if (agentMode || isCI) {
    uxLog("warning", commandThis, c.yellow(t('prNotFoundAgentWarning')));
    notifyDraftUsage(commandThis);
    return undefined; // will use draft
  }

  // Interactive mode: prompt user
  const { prompts } = await import('./prompts.js');
  const response = await prompts({
    type: 'text',
    name: 'value',
    message: c.cyanBright(t('prNotFoundEnterIdOrEmpty')),
    initial: '',
    description: t('prNotFoundEnterIdOrEmpty'),
  });
  const enteredId = (response.value || '').trim();
  if (enteredId) {
    return enteredId;
  }
  uxLog("log", commandThis, c.grey(t('usingDraftConfig')));
  notifyDraftUsage(commandThis);
  return undefined; // will use draft
}

/**
 * Rename the draft config file to match a specific PR ID.
 */
export async function renameDraftToPr(prId: string): Promise<string> {
  const draftFile = path.join('scripts', 'actions', '.sfdx-hardis.draft.yml');
  const targetFile = path.join('scripts', 'actions', `.sfdx-hardis.${prId}.yml`);

  if (!fs.existsSync(draftFile)) {
    throw new SfError(t('draftFileNotFound'));
  }
  if (fs.existsSync(targetFile)) {
    throw new SfError(t('prConfigFileAlreadyExists', { prId }));
  }

  await fs.rename(draftFile, targetFile);
  return targetFile;
}

export const ACTION_TYPES: PrePostCommand['type'][] = ['command', 'data', 'apex', 'publish-community', 'manual', 'schedule-batch'];
export const ACTION_CONTEXTS: PrePostCommand['context'][] = ['all', 'check-deployment-only', 'process-deployment-only'];
export const ACTION_SCOPES: ActionScope[] = ['project', 'branch', 'pr'];
export const ACTION_WHENS: ActionWhen[] = ['pre-deploy', 'post-deploy'];
