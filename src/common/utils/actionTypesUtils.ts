// What each deployment action type takes, for sf hardis:project:action:types: built from the
// provider classes and the registries of actionTypes.ts, so it cannot drift from the code.
import type { ActionParameterDescription, ActionWhen, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import {
  DEPLOYMENT_ACTION_TYPES,
  DEPLOYMENT_ONLY_ACTION_TYPES,
  resolveRunOnlyOnceByOrg,
} from '../actionsProvider/actionTypes.js';
import { getBuiltInActionProvider } from './actionUtils.js';

const ALL_PHASES: ActionWhen[] = ['pre-deploy', 'post-deploy'];
const GENERIC_DEFAULT_CONTEXT: PrePostCommand['context'] = 'process-deployment-only';

export interface ActionTypeDescription {
  type: string;
  allowedWhen: ActionWhen[];
  defaultContext: PrePostCommand['context'];
  // Runs in the process-deployment-only context whatever its context says
  deploymentOnly: boolean;
  runOnlyOnceByOrgDefault: boolean;
  supportsRunOnlyOnceByOrg: boolean;
  parameters: ActionParameterDescription[];
  // Data only this type has
  details?: Record<string, any>;
}

export interface CustomFunctionTypeDescription {
  type: string;
  label?: string;
  description?: string;
  when?: ActionWhen;
  allowedContexts?: string[];
  defaults?: Record<string, any>;
  inputs: { name: string; type?: string; required: boolean; default?: any; description?: string; flag: string }[];
}

export interface ActionTypesDescription {
  types: ActionTypeDescription[];
  customFunctions: CustomFunctionTypeDescription[];
}

/**
 * Every deployment action type, or the one of options.type, and the custom functions of the project.
 * options.flags reaches the providers, which read the flags of hardis:project:action:types they own.
 */
export async function buildActionTypesDescription(options: { type?: string; when?: ActionWhen; flags?: any } = {}): Promise<ActionTypesDescription> {
  const types: ActionTypeDescription[] = [];
  const builtInTypes = (DEPLOYMENT_ACTION_TYPES as readonly string[]).filter((type) => !options.type || type === options.type);
  for (const type of builtInTypes) {
    const description = await describeBuiltInType(type, options.type === type ? options.flags || {} : undefined);
    if (!options.when || description.allowedWhen.includes(options.when)) {
      types.push(description);
    }
  }
  const customFunctions = builtInTypes.length > 0 && options.type ? [] : await describeCustomFunctions(options);
  return { types, customFunctions };
}

/**
 * One built-in type. Its details are only loaded when the type is asked for alone: some types read
 * them from another tool, which costs a few seconds.
 */
export async function describeBuiltInType(type: string, flags?: any): Promise<ActionTypeDescription> {
  const provider = await getBuiltInActionProvider(type);
  const description: ActionTypeDescription = {
    type,
    allowedWhen: provider?.getAllowedWhen() || ALL_PHASES,
    defaultContext: provider?.getDefaultContext() || GENERIC_DEFAULT_CONTEXT,
    deploymentOnly: DEPLOYMENT_ONLY_ACTION_TYPES.includes(type),
    runOnlyOnceByOrgDefault: resolveRunOnlyOnceByOrg({ type }),
    supportsRunOnlyOnceByOrg: provider?.supportsRunOnlyOnceByOrg() ?? true,
    parameters: provider?.getParameterDescriptions() || [],
  };
  if (description.deploymentOnly) {
    description.defaultContext = 'process-deployment-only';
  }
  if (flags) {
    const details = await provider?.describeTypeDetails(flags);
    if (details) {
      description.details = details;
    }
  }
  return description;
}

async function describeCustomFunctions(options: { type?: string; when?: ActionWhen }): Promise<CustomFunctionTypeDescription[]> {
  const { listCustomFunctions } = await import('./customFunctionUtils.js');
  const functions = (await listCustomFunctions())
    .filter((fn) => !options.type || fn.id === options.type)
    .filter((fn) => !options.when || !fn.when || fn.when === options.when);
  return functions.map((fn) => ({
    type: fn.id,
    label: fn.label,
    description: fn.description,
    when: fn.when,
    allowedContexts: fn.allowedContexts,
    defaults: fn.defaults as Record<string, any> | undefined,
    inputs: (fn.inputs || []).map((input: any) => ({
      name: input.name,
      type: input.type,
      required: input.required === true,
      default: input.default,
      description: input.description,
      flag: `function-input ${input.name}=<value>`,
    })),
  }));
}
