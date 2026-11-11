// The deployment action a deployment error tip suggests: the error is solved by an action that runs
// before or after the deployment, not by a change of the metadata. Generic: everything specific to
// an action type comes from its provider class, through the hooks of ActionsProvider.
import c from 'chalk';
import { t } from './i18n.js';
import { quoteShellArgument } from './stringUtils.js';
import { shellEscape } from '../aiProvider/utils/providerConfigUtils.js';
import type { ActionParameterDescription } from '../actionsProvider/actionsProvider.js';

/** The action a tip of deployTipsList.ts suggests. {1}, {2}... are the groups of its regex. */
export interface DeployTipActionDefinition {
  type: string;
  when: 'pre-deploy' | 'post-deploy';
  label: string;
  parameters: Record<string, any>;
  // Values of the parameters the user must replace before creating the action (OBJECT_NAME...)
  toComplete?: string[];
}

/** The suggested action once the placeholders are filled, ready to show */
export interface DeployTipActionHint {
  type: string;
  when: 'pre-deploy' | 'post-deploy';
  label: string;
  parameters: Record<string, any>;
  // hardis:project:action:create command that creates the action on the Pull Request of the current branch
  command: string;
  docUrl: string;
  notes: string[];
  toComplete: string[];
}

export type DeployTipActionFormat = 'console' | 'markdown' | 'text';

/**
 * The action a matched tip suggests, or null when it suggests none. Never throws: a tip without its
 * action is still a tip.
 */
export async function buildTipDeploymentAction(tipDefinition: { deploymentAction?: DeployTipActionDefinition }, groups: string[]): Promise<DeployTipActionHint | null> {
  if (!tipDefinition.deploymentAction) {
    return null;
  }
  try {
    return await buildDeploymentActionHint(tipDefinition.deploymentAction, groups);
  } catch {
    return null;
  }
}

/**
 * Fills the placeholders of the suggested action with the groups of the error regex, and builds the
 * command that creates it. null when the type is not a built-in action type.
 */
export async function buildDeploymentActionHint(definition: DeployTipActionDefinition, groups: string[] = []): Promise<DeployTipActionHint | null> {
  const { getBuiltInActionProvider } = await import('./actionUtils.js');
  const provider = await getBuiltInActionProvider(definition.type);
  if (!provider) {
    return null;
  }
  const label = fillPlaceholders(definition.label, groups);
  const parameters = fillPlaceholders(definition.parameters, groups);
  const toComplete = definition.toComplete || [];
  const { CONSTANTS } = await import('../../config/index.js');
  return {
    type: definition.type,
    when: definition.when,
    label,
    parameters,
    command: buildCreateCommand(definition.type, definition.when, label, parameters, provider.getParameterDescriptions()),
    docUrl: provider.getDocumentationUrl(parameters) || `${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-work-on-user-story-deployment-actions-${definition.type}/`,
    notes: [
      ...(toComplete.length > 0 ? [t('deployTipActionToComplete', { values: toComplete.join(', ') })] : []),
      ...provider.getDeployTipNotes(parameters),
    ],
    toComplete,
  };
}

/** Lines that present the suggested action, for the console, a Pull Request comment, or a prompt */
export function formatDeploymentActionHint(hint: DeployTipActionHint, format: DeployTipActionFormat): string[] {
  const documentation = t('deployTipActionDocumentation', { url: hint.docUrl });
  if (format === 'markdown') {
    return [t('deployTipActionIntro'), '', '```shell', hint.command, '```', '', ...hint.notes.flatMap((note) => [note, '']), documentation];
  }
  if (format === 'console') {
    return [c.yellow(t('deployTipActionIntro')), c.bold(hint.command), ...hint.notes.map((note) => c.yellow(note)), c.yellow(documentation)];
  }
  return [t('deployTipActionIntro'), hint.command, ...hint.notes, documentation];
}

/** Variables of the PROMPT_SOLVE_DEPLOYMENT_ERROR prompt for one deployment error */
export async function getSolveDeploymentErrorPromptVariables(error: string): Promise<{ ERROR: string; DEPLOYMENT_ACTION_HINTS: string }> {
  // Computed once per process: every deployment error of a job asks for it. An empty answer is
  // asked again, as Browserforce may have written its catalog since.
  if (!deploymentActionsForAi) {
    deploymentActionsForAi = await describeDeploymentActionsForAi();
  }
  // The prompt refuses an empty variable
  return { ERROR: error, DEPLOYMENT_ACTION_HINTS: deploymentActionsForAi || 'None.' };
}

let deploymentActionsForAi = '';

/**
 * What the built-in action types can do that a metadata deployment cannot, for the AI prompt: a
 * short line per type that describes itself, and the command that creates such an action.
 */
export async function describeDeploymentActionsForAi(): Promise<string> {
  const { DEPLOYMENT_ACTION_TYPES } = await import('../actionsProvider/actionTypes.js');
  const { getBuiltInActionProvider } = await import('./actionUtils.js');
  const descriptions: string[] = [];
  for (const type of DEPLOYMENT_ACTION_TYPES) {
    try {
      const provider = await getBuiltInActionProvider(type);
      const description = await provider?.describeForDeployErrorAi();
      if (provider && description) {
        descriptions.push(`- ${description}\n  Command: ${buildCreateCommandTemplate(type, provider.getParameterDescriptions())}`);
      }
    } catch {
      // A type that cannot describe itself is left out of the prompt: the prompt still works
    }
  }
  return descriptions.join('\n');
}

// A string, or the strings inside an object or an array
function fillPlaceholders<T>(value: T, groups: string[]): T {
  if (typeof value === 'string') {
    return value.replace(/\{(\d+)\}/g, (match, index) => {
      const group = groups[Number(index)];
      return group != null ? placeholderValue(group) : match;
    }) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => fillPlaceholders(item, groups)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillPlaceholders(item, groups)])) as T;
  }
  return value;
}

// In the text log of a deployment, a group may start with the path of the metadata file before its
// name: the path is dropped. A value with spaces (a picklist value...) is kept whole.
function placeholderValue(group: string): string {
  const words = group.trim().replace(/'/g, '').split(/\s+/);
  const withoutPaths = words.filter((word) => !/[/\\]|-meta\.xml$/.test(word));
  return (withoutPaths.length > 0 ? withoutPaths : words.slice(-1)).join(' ');
}

// The flags come from what the type describes: no code specific to a type here
function buildCreateCommand(type: string, when: string, label: string, parameters: Record<string, any>, descriptions: ActionParameterDescription[]): string {
  const args = createCommandStart(type, when, quoteShellArgument(label));
  for (const description of descriptions) {
    const value = description.path === `parameters.${description.name}` ? parameters[description.name] : undefined;
    if (!description.flag || value === undefined || value === null) {
      continue;
    }
    if (description.type === 'boolean') {
      if (value === true) {
        args.push(`--${description.flag}`);
      }
      continue;
    }
    args.push(`--${description.flag} ${formatFlagValue(description.type, value)}`);
  }
  return args.join(' ');
}

// The command with a placeholder per flag, for the AI to fill
function buildCreateCommandTemplate(type: string, descriptions: ActionParameterDescription[]): string {
  const args = createCommandStart(type, '<pre-deploy|post-deploy>', '"<label>"');
  for (const description of descriptions.filter((item) => item.flag && item.path === `parameters.${item.name}`)) {
    args.push(description.type === 'boolean' ? `[--${description.flag}]` : `--${description.flag} ${description.type === 'json' ? `'<${description.name} as JSON>'` : `<${description.name}>`}`);
  }
  return args.join(' ');
}

function createCommandStart(type: string, when: string, quotedLabel: string): string[] {
  return ['sf hardis:project:action:create', '--agent', '--scope pr', '--pr-id current', `--when ${when}`, `--type ${type}`, `--label ${quotedLabel}`];
}

function formatFlagValue(type: string, value: any): string {
  if (type === 'json') {
    // Single quotes: bash and PowerShell 7.3+ pass the JSON as it is
    return shellEscape(JSON.stringify(value));
  }
  if (type === 'string[]' && Array.isArray(value)) {
    return quoteShellArgument(value.join(','));
  }
  return quoteShellArgument(String(value));
}
