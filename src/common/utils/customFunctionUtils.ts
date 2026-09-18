import c from 'chalk';
import * as path from 'path';
import * as yaml from 'js-yaml';
import fs from './fsUtils.js';
import { getConfig } from '../../config/index.js';
import { uxLog } from './index.js';
import { t } from './i18n.js';

/**
 * Custom functions let a project package a script (node, python or bash) behind a typed
 * parameter contract, then use it as a deployment action type on the same footing as the
 * built-in ones (apex, data, schedule-batch...).
 *
 * Definitions live in the PROJECT config only (config/.sfdx-hardis.yml), never in a branch or a
 * Pull Request config: a function id becomes a valid action `type`, so the catalog must be the
 * same everywhere, and a definition arriving from a Pull Request branch would mean executing
 * arbitrary code shipped by that branch.
 */

export const CUSTOM_FUNCTIONS_CONFIG_KEY = 'customFunctions';

export const CUSTOM_FUNCTION_RUNTIMES = ['node', 'python', 'bash'] as const;
export type CustomFunctionRuntime = (typeof CUSTOM_FUNCTION_RUNTIMES)[number];

export const CUSTOM_FUNCTION_INPUT_TYPES = ['string', 'number', 'boolean', 'select', 'multiline', 'secret'] as const;
export type CustomFunctionInputType = (typeof CUSTOM_FUNCTION_INPUT_TYPES)[number];

/** Default wall-clock budget of a single script run. A hung script must not hang the pipeline. */
export const DEFAULT_CUSTOM_FUNCTION_TIMEOUT_SECONDS = 600;

export interface CustomFunctionInput {
  name: string;
  label?: string;
  description?: string;
  type?: CustomFunctionInputType;
  required?: boolean;
  default?: any;
  /** Allowed values, for inputs of type 'select' */
  options?: string[];
}

export interface CustomFunctionOutput {
  name: string;
  label?: string;
  description?: string;
  type?: string;
}

export interface CustomFunctionDefaults {
  context?: 'all' | 'check-deployment-only' | 'process-deployment-only';
  allowFailure?: boolean;
  runOnlyOnceByOrg?: boolean;
  includeTargetBranches?: string[];
  excludeTargetBranches?: string[];
}

export interface CustomFunctionDefinition {
  id: string;
  label?: string;
  description?: string;
  runtime: CustomFunctionRuntime;
  /** Path to the script file, relative to the repository root */
  script: string;
  /** Wall-clock budget in seconds. Defaults to DEFAULT_CUSTOM_FUNCTION_TIMEOUT_SECONDS. */
  timeout?: number;
  /** Restrict the phase the function is offered in. Unset means both. */
  when?: 'pre-deploy' | 'post-deploy';
  /** Restrict the execution contexts the function may be used with. Unset means all of them. */
  allowedContexts?: ('all' | 'check-deployment-only' | 'process-deployment-only')[];
  defaults?: CustomFunctionDefaults;
  inputs?: CustomFunctionInput[];
  outputs?: CustomFunctionOutput[];
}

/**
 * Built-in action types. A custom function id may not shadow one of them, otherwise the action
 * type would silently resolve to the built-in provider instead of the function.
 * Duplicated from actionUtils.ACTION_TYPES on purpose: importing it here would create a cycle
 * (actionUtils imports this module to validate custom function actions).
 */
const BUILT_IN_ACTION_TYPES = [
  'command',
  'data',
  'apex',
  'publish-community',
  'manual',
  'schedule-batch',
  'remove-packagexml-items',
];

/** A function id ends up as a YAML key and an env var suffix, so keep it boring. */
const FUNCTION_ID_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;
const INPUT_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Read the custom function catalog from the project config.
 * Never throws: a malformed catalog yields an empty list plus a warning, so a typo in the config
 * does not take down every deployment before the actions are even listed.
 */
export async function listCustomFunctions(): Promise<CustomFunctionDefinition[]> {
  const config = await getConfig('project');
  const rawFunctions = config?.[CUSTOM_FUNCTIONS_CONFIG_KEY];
  if (!rawFunctions) {
    return [];
  }
  if (!Array.isArray(rawFunctions)) {
    uxLog('warning', this, c.yellow(`[CustomFunctions] ${t('customFunctionsConfigNotAList')}`));
    return [];
  }
  return rawFunctions.filter((fn: any) => fn && typeof fn === 'object' && fn.id);
}

export async function getCustomFunctionById(functionId: string): Promise<CustomFunctionDefinition | null> {
  const functions = await listCustomFunctions();
  return functions.find((fn) => fn.id === functionId) || null;
}

export function isBuiltInActionType(type: string): boolean {
  return BUILT_IN_ACTION_TYPES.includes(type);
}

/**
 * Read the custom function catalog straight from the project config FILE.
 *
 * getConfig() merges layers and caches, which is what the execution path wants but not what the
 * hardis:project:function:* commands want: they must read, mutate and write back the very same
 * array, without inheriting anything from a branch or user layer.
 */
export async function readCustomFunctionsFromProjectFile(): Promise<CustomFunctionDefinition[]> {
  const configFile = getProjectConfigFilePath();
  if (!fs.existsSync(configFile)) {
    return [];
  }
  const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8')) || {};
  const rawFunctions = doc[CUSTOM_FUNCTIONS_CONFIG_KEY];
  return Array.isArray(rawFunctions) ? rawFunctions : [];
}

/** Write the catalog back to config/.sfdx-hardis.yml, preserving every other key. */
export async function writeCustomFunctionsToProjectFile(functions: CustomFunctionDefinition[]): Promise<string> {
  const configFile = getProjectConfigFilePath();
  let doc: any = {};
  if (fs.existsSync(configFile)) {
    doc = yaml.load(fs.readFileSync(configFile, 'utf-8')) || {};
  }
  if (functions.length === 0) {
    delete doc[CUSTOM_FUNCTIONS_CONFIG_KEY];
  } else {
    doc[CUSTOM_FUNCTIONS_CONFIG_KEY] = functions;
  }
  await fs.ensureDir(path.dirname(configFile));
  await fs.writeFile(configFile, yaml.dump(doc));
  return configFile;
}

export function getProjectConfigFilePath(): string {
  return path.join('config', '.sfdx-hardis.yml');
}

/**
 * Validate a function definition. Returns the list of problems, empty when the definition is fine.
 * `existingFunctions` is used to reject a duplicate id; pass the catalog without the function
 * being updated so renaming a function to its own id is not reported as a duplicate.
 */
export function validateCustomFunctionDefinition(
  definition: Partial<CustomFunctionDefinition>,
  existingFunctions: CustomFunctionDefinition[] = []
): string[] {
  const errors: string[] = [];
  const functionId = String(definition.id || '').trim();

  if (!functionId) {
    errors.push(t('customFunctionValidationNoId'));
  } else if (!FUNCTION_ID_REGEX.test(functionId)) {
    errors.push(t('customFunctionValidationInvalidId', { id: functionId }));
  } else if (isBuiltInActionType(functionId)) {
    errors.push(t('customFunctionValidationIdIsBuiltIn', { id: functionId }));
  } else if (existingFunctions.some((fn) => fn.id === functionId)) {
    errors.push(t('customFunctionValidationDuplicateId', { id: functionId }));
  }

  if (!definition.label) {
    errors.push(t('customFunctionValidationNoLabel'));
  }

  if (!definition.runtime) {
    errors.push(t('customFunctionValidationNoRuntime'));
  } else if (!CUSTOM_FUNCTION_RUNTIMES.includes(definition.runtime)) {
    errors.push(
      t('customFunctionValidationInvalidRuntime', {
        runtime: definition.runtime,
        runtimes: CUSTOM_FUNCTION_RUNTIMES.join(', '),
      })
    );
  }

  const script = String(definition.script || '').trim();
  if (!script) {
    errors.push(t('customFunctionValidationNoScript'));
  } else if (!fs.existsSync(script)) {
    errors.push(t('customFunctionValidationScriptNotFound', { path: script }));
  }

  if (definition.timeout != null) {
    const timeout = Number(definition.timeout);
    if (!Number.isFinite(timeout) || timeout <= 0) {
      errors.push(t('customFunctionValidationInvalidTimeout', { timeout: String(definition.timeout) }));
    }
  }

  errors.push(...validateInputDefinitions(definition.inputs || []));
  errors.push(...validateOutputDefinitions(definition.outputs || []));

  return errors;
}

function validateInputDefinitions(inputs: CustomFunctionInput[]): string[] {
  const errors: string[] = [];
  const seenNames = new Set<string>();
  for (const input of inputs) {
    const name = String(input?.name || '').trim();
    if (!name) {
      errors.push(t('customFunctionValidationInputNoName'));
      continue;
    }
    if (!INPUT_NAME_REGEX.test(name)) {
      errors.push(t('customFunctionValidationInvalidInputName', { name }));
    }
    // Names collide once uppercased into SFDX_HARDIS_IN_<NAME>, so compare case-insensitively
    const nameKey = name.toUpperCase();
    if (seenNames.has(nameKey)) {
      errors.push(t('customFunctionValidationDuplicateInputName', { name }));
    }
    seenNames.add(nameKey);
    const inputType = input?.type || 'string';
    if (!CUSTOM_FUNCTION_INPUT_TYPES.includes(inputType)) {
      errors.push(
        t('customFunctionValidationInvalidInputType', {
          name,
          type: String(inputType),
          types: CUSTOM_FUNCTION_INPUT_TYPES.join(', '),
        })
      );
    }
    if (inputType === 'select' && (input.options || []).length === 0) {
      errors.push(t('customFunctionValidationSelectWithoutOptions', { name }));
    }
  }
  return errors;
}

function validateOutputDefinitions(outputs: CustomFunctionOutput[]): string[] {
  const errors: string[] = [];
  const seenNames = new Set<string>();
  for (const output of outputs) {
    const name = String(output?.name || '').trim();
    if (!name) {
      errors.push(t('customFunctionValidationOutputNoName'));
      continue;
    }
    if (!INPUT_NAME_REGEX.test(name)) {
      errors.push(t('customFunctionValidationInvalidOutputName', { name }));
    }
    if (seenNames.has(name)) {
      errors.push(t('customFunctionValidationDuplicateOutputName', { name }));
    }
    seenNames.add(name);
  }
  return errors;
}

/**
 * Locate the interpreter of a runtime.
 *
 * - node: the very interpreter running sfdx-hardis, so it is always there and always the version
 *   the project already relies on.
 * - python: python3 first, then python. Some images ship only one of the two.
 * - bash: bash from PATH, which on Windows is the Git Bash installed with git.
 *
 * Returns null when nothing was found; the caller reports the candidates it tried.
 */
export function resolveRuntimeInterpreter(runtime: CustomFunctionRuntime): { interpreter: string; tried: string[] } | null {
  if (runtime === 'node') {
    return { interpreter: process.execPath, tried: [process.execPath] };
  }
  const candidates = runtime === 'python' ? ['python3', 'python'] : ['bash'];
  for (const candidate of candidates) {
    const resolved = findExecutableInPath(candidate);
    if (resolved) {
      return { interpreter: resolved, tried: candidates };
    }
  }
  return null;
}

/**
 * Locate an executable in PATH, without pulling in a dependency for it.
 * On Windows an executable is only callable with one of the PATHEXT suffixes, so each directory
 * is probed with every suffix (and with the bare name, for something already carrying one).
 */
export function findExecutableInPath(executableName: string): string | null {
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const pathDirectories = String(process.env.PATH || '').split(pathSeparator).filter(Boolean);
  const suffixes =
    process.platform === 'win32'
      ? ['', ...String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : [''];
  for (const directory of pathDirectories) {
    // A quoted PATH entry is legal on Windows and must not become part of the path
    const cleanDirectory = directory.replace(/^"|"$/g, '');
    for (const suffix of suffixes) {
      const candidatePath = path.join(cleanDirectory, `${executableName}${suffix}`);
      try {
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
          return candidatePath;
        }
      } catch (_e) {
        // An unreadable PATH entry is not worth failing the lookup for
      }
    }
  }
  return null;
}

/**
 * Parse the outputs a script returned.
 *
 * Contract: the LAST non-empty line of stdout is a JSON object holding the declared outputs.
 * Everything printed before it is ordinary logging and is kept as the action output.
 *
 * A function declaring no output never fails here: its stdout is free-form, so the last line is
 * simply not parsed.
 */
export function parseCustomFunctionOutputs(
  stdout: string,
  declaredOutputs: CustomFunctionOutput[]
): { outputs: Record<string, any>; logOutput: string; error?: string } {
  const rawLines = String(stdout || '').split(/\r?\n/);
  if ((declaredOutputs || []).length === 0) {
    return { outputs: {}, logOutput: rawLines.join('\n').trim() };
  }

  let lastContentIndex = -1;
  for (let index = rawLines.length - 1; index >= 0; index--) {
    if (rawLines[index].trim() !== '') {
      lastContentIndex = index;
      break;
    }
  }
  if (lastContentIndex === -1) {
    return { outputs: {}, logOutput: '', error: t('customFunctionOutputNoStdout') };
  }

  const lastLine = rawLines[lastContentIndex].trim();
  let parsed: any;
  try {
    parsed = JSON.parse(lastLine);
  } catch (_e) {
    return {
      outputs: {},
      logOutput: rawLines.join('\n').trim(),
      error: t('customFunctionOutputNotJson', { line: truncateForMessage(lastLine) }),
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      outputs: {},
      logOutput: rawLines.join('\n').trim(),
      error: t('customFunctionOutputNotAnObject', { line: truncateForMessage(lastLine) }),
    };
  }

  const missingOutputs = declaredOutputs
    .map((output) => output.name)
    .filter((name) => parsed[name] === undefined);
  const logOutput = rawLines.slice(0, lastContentIndex).join('\n').trim();
  if (missingOutputs.length > 0) {
    return {
      outputs: parsed,
      logOutput,
      error: t('customFunctionOutputMissingValues', { names: missingOutputs.join(', ') }),
    };
  }
  return { outputs: parsed, logOutput };
}

function truncateForMessage(value: string): string {
  return value.length > 200 ? `${value.slice(0, 200)}...` : value;
}

/** Env var name carrying the value of a declared input. */
export function buildInputEnvVarName(inputName: string): string {
  return `SFDX_HARDIS_IN_${String(inputName).toUpperCase()}`;
}

/**
 * Find every deployment action referencing a custom function, across all the places actions can
 * live: the project config, each branch config, and each Pull Request action file.
 * Used to warn before deleting a function that is still in use.
 */
export async function findActionsUsingCustomFunction(
  functionId: string
): Promise<{ file: string; actionId: string; actionLabel: string }[]> {
  const usages: { file: string; actionId: string; actionLabel: string }[] = [];
  const configFiles = [getProjectConfigFilePath(), ...listGlobbableConfigFiles()];
  for (const configFile of configFiles) {
    let doc: any;
    try {
      doc = yaml.load(fs.readFileSync(configFile, 'utf-8')) || {};
    } catch (_e) {
      // A config file that cannot be parsed is not this command's problem to report
      continue;
    }
    for (const configKey of ['commandsPreDeploy', 'commandsPostDeploy']) {
      const actions = Array.isArray(doc[configKey]) ? doc[configKey] : [];
      for (const action of actions) {
        if (action?.type === functionId) {
          usages.push({ file: configFile, actionId: action.id || '', actionLabel: action.label || '' });
        }
      }
    }
  }
  return usages;
}

/** Branch configs and Pull Request action files, skipping directories that do not exist. */
function listGlobbableConfigFiles(): string[] {
  const files: string[] = [];
  for (const directory of [path.join('config', 'branches'), path.join('scripts', 'actions')]) {
    if (!fs.existsSync(directory)) {
      continue;
    }
    for (const entry of fs.readdirSync(directory)) {
      if (entry.endsWith('.yml') || entry.endsWith('.yaml')) {
        files.push(path.join(directory, entry));
      }
    }
  }
  return files;
}

/** Names of the inputs a function declares as secret, used to mask values in logs and comments. */
export function getSecretInputNames(definition: CustomFunctionDefinition): string[] {
  return (definition.inputs || [])
    .filter((input) => input.type === 'secret')
    .map((input) => input.name);
}
