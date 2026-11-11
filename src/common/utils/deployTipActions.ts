// The deployment action a deployment error tip suggests: the error is solved by an action that runs
// before or after the deployment, not by a change of the metadata. Generic: everything specific to
// an action type comes from its provider class, through the hooks of ActionsProvider.
import c from 'chalk';
import { t } from './i18n.js';

/** The action a tip of deployTipsList.ts suggests. {1}, {2}... are the groups of its regex. */
export interface DeployTipActionDefinition {
  type: string;
  when: 'pre-deploy' | 'post-deploy';
  label: string;
  parameters: Record<string, any>;
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
  const { CONSTANTS } = await import('../../config/index.js');
  return {
    type: definition.type,
    when: definition.when,
    label,
    parameters,
    command: buildCreateCommand(definition, label, parameters, provider.getParameterDescriptions()),
    docUrl: provider.getDocumentationUrl(parameters) || `${CONSTANTS.DOC_URL_ROOT}/salesforce-devops-work-on-user-story-deployment-actions-${definition.type}/`,
    notes: provider.getDeployTipNotes(parameters),
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
  deploymentActionsForAi ??= describeDeploymentActionsForAi();
  // The prompt refuses an empty variable
  return { ERROR: error, DEPLOYMENT_ACTION_HINTS: (await deploymentActionsForAi) || 'None.' };
}

// Computed once per process: every deployment error of a job asks for it
let deploymentActionsForAi: Promise<string> | null = null;

/** What the built-in action types can do that a metadata deployment cannot, for the AI prompt */
export async function describeDeploymentActionsForAi(): Promise<string> {
  const { DEPLOYMENT_ACTION_TYPES } = await import('../actionsProvider/actionTypes.js');
  const { getBuiltInActionProvider } = await import('./actionUtils.js');
  const descriptions: string[] = [];
  for (const type of DEPLOYMENT_ACTION_TYPES) {
    try {
      const description = await (await getBuiltInActionProvider(type))?.describeForDeployErrorAi();
      if (description) {
        descriptions.push(description);
      }
    } catch {
      // A type that cannot describe itself is left out of the prompt: the prompt still works
    }
  }
  return descriptions.join('\n\n');
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

// A placeholder of an action is one metadata name. In the text log of a deployment the group may
// also hold the path of the file before it: the name is its last word.
function placeholderValue(group: string): string {
  const words = group.trim().replace(/'/g, '').split(/\s+/);
  return words[words.length - 1];
}

// The flags come from what the type describes: no code specific to a type here
function buildCreateCommand(definition: DeployTipActionDefinition, label: string, parameters: Record<string, any>, descriptions: { name: string; path: string; flag?: string; type: string }[]): string {
  const args = [
    'sf hardis:project:action:create',
    '--agent',
    '--scope pr',
    '--pr-id current',
    `--when ${definition.when}`,
    `--type ${definition.type}`,
    `--label ${doubleQuote(label)}`,
  ];
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

function formatFlagValue(type: string, value: any): string {
  if (type === 'json') {
    return singleQuote(JSON.stringify(value));
  }
  if (type === 'string[]' && Array.isArray(value)) {
    return doubleQuote(value.join(','));
  }
  if (type === 'integer') {
    return String(value);
  }
  return doubleQuote(String(value));
}

// A value made only of name characters needs no quotes
function doubleQuote(value: string): string {
  return /^[\w.:/@-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

function singleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
