import { AuthInfo, Connection, SfError } from '@salesforce/core';
import { ScratchOrgDefSchema } from '@salesforce/core';
import c from 'chalk';
import { createRequire } from 'module';
import * as path from 'path';
import { ActionResult, ActionsProvider, buildActionOutput, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { ORG_INIT_ACTION_TYPES } from '../actionsProvider/actionTypes.js';
import { elapseEnd, elapseStart, execSfdxJson, uxLog } from './index.js';
import { uxLogTableWithReport } from './filesUtils.js';
import fs from './fsUtils.js';
import { t } from './i18n.js';

export type OrgInitOrgType = 'scratch' | 'sandbox';

/**
 * Which steps run:
 * - all: a new scratch org or sandbox, or sf hardis:org:init
 * - pool-fill: sf hardis:scratch:create --pool, the steps flagged runAtPoolFill
 * - after-pool-fetch: a scratch org taken from the pool, the steps not run at pool fill
 */
export type OrgInitPhase = 'all' | 'pool-fill' | 'after-pool-fetch';

export interface OrgInitStepsInfo {
  steps: PrePostCommand[];
  // orgInitSteps: read from the config key. legacy: built from the older keys and folders
  source: 'orgInitSteps' | 'legacy';
  // Older keys still present in the config, ignored when source is orgInitSteps
  legacyKeys: string[];
}

export interface OrgInitDefinitionError {
  stepId: string;
  message: string;
}

export interface OrgInitRunOptions {
  orgUsername: string;
  orgAlias?: string;
  orgType: OrgInitOrgType;
  phase: OrgInitPhase;
  stepIds?: string[];
  projectScratchDef?: any;
  debugMode?: boolean;
  // Config read by the caller (getConfig('user')), so the run sees the same values
  config: any;
}

export interface OrgInitStepResult {
  id: string;
  label: string;
  type: string;
  status: ActionResult['statusCode'] | 'warning';
  output?: string;
  skippedReason?: string;
  durationSeconds?: number;
}

export const ORG_INIT_STEPS_CONFIG_KEY = 'orgInitSteps';
export const ORG_INIT_LEGACY_KEYS = [
  'initPermissionSets',
  'scratchOrgInitApexScripts',
  'sandboxOrgInitApexScripts',
];
export const PROJECT_SCRATCH_DEF_FILE = path.join('config', 'project-scratch-def.json');
export const SCRATCH_DEF_FEATURES_DOC_URL =
  'https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_def_file_config_values.htm';
export const SCRATCH_DEF_SETTINGS_DOC_URL = 'https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_settings.htm';

export interface ScratchOrgDefHints {
  editions: string[];
  features: string[];
  settingsNames: string[];
  // Metadata API page of each settings type, read from the Salesforce CLI schema
  settingsDocUrls: Record<string, string>;
  featuresDocUrl: string;
  settingsDocUrl: string;
}

// Deployment actions only: they mean nothing when an org is initialized
const DEPLOYMENT_ONLY_STEP_FIELDS = [
  'when',
  'context',
  'includeTargetBranches',
  'excludeTargetBranches',
  'runOnlyOnceByOrg',
  'customUsername',
  'movedFrom',
  'skipIfError',
];
const ALL_ORG_TYPES: OrgInitOrgType[] = ['scratch', 'sandbox'];

/**
 * Everything a configuration UI needs to show the org initialization of the project, read-only.
 * scratchDefFile replaces config/project-scratch-def.json, to validate a definition before saving it.
 */
export async function getOrgInitConfigPayload(config: any, scratchDefFile?: string): Promise<any> {
  const stepsInfo = getOrgInitSteps(config);
  const scratchDefPath = scratchDefFile || PROJECT_SCRATCH_DEF_FILE;
  const scratchDef = readProjectScratchDef(scratchDefPath);
  return {
    source: stepsInfo.source,
    legacyKeys: stepsInfo.legacyKeys,
    steps: stepsInfo.steps,
    definitionErrors: await checkOrgInitSteps(stepsInfo.steps),
    stepTypes: listOrgInitStepTypes(),
    scratchDef: {
      path: scratchDefPath.replace(/\\/g, '/'),
      exists: scratchDef !== null,
      content: scratchDef?.content ?? null,
      issues: scratchDef?.issues || [],
      warnings: scratchDef?.warnings || [],
    },
    scratchOrgDuration: config?.scratchOrgDuration ?? null,
    scratchDefHints: getScratchOrgDefHints(),
  };
}

/**
 * Steps of the project: orgInitSteps when the key exists, otherwise the list built from the
 * older keys and folders, in the order they used to run.
 */
export function getOrgInitSteps(config: any): OrgInitStepsInfo {
  const legacyKeys = ORG_INIT_LEGACY_KEYS.filter((key) => config?.[key] !== undefined && config?.[key] !== null);
  if (Array.isArray(config?.[ORG_INIT_STEPS_CONFIG_KEY])) {
    return {
      steps: config[ORG_INIT_STEPS_CONFIG_KEY].filter((step: any) => step && typeof step === 'object').map(normalizeOrgInitStep),
      source: 'orgInitSteps',
      legacyKeys,
    };
  }
  return { steps: buildLegacyOrgInitSteps(config), source: 'legacy', legacyKeys };
}

/**
 * One list reproducing what scratch:create and sandbox creation used to run.
 * Every step runs at pool fill, so a scratch org taken from the pool is ready to use.
 */
export function buildLegacyOrgInitSteps(config: any): PrePostCommand[] {
  const steps: Partial<PrePostCommand>[] = [];
  steps.push({ id: 'legacy-install-packages', label: 'Install packages', type: 'install-packages', orgTypes: ['scratch'] });
  steps.push({ id: 'legacy-deploy-sources', label: 'Deploy project sources', type: 'deploy-sources', orgTypes: ['scratch'] });
  const permissionSets = (config?.initPermissionSets || []).map((permSet: any) => permSet?.name || permSet).filter(Boolean);
  if (permissionSets.length > 0) {
    // A failed assignment used to be logged without stopping the initialization
    steps.push({
      id: 'legacy-permission-sets',
      label: 'Assign permission sets',
      type: 'assign-permission-sets',
      parameters: { permissionSets },
      orgTypes: ALL_ORG_TYPES,
      allowFailure: true,
    });
  }
  (config?.scratchOrgInitApexScripts || []).forEach((apexScript: string, index: number) => {
    steps.push({
      id: `legacy-scratch-apex-${index + 1}`,
      label: `Run ${path.basename(String(apexScript))}`,
      type: 'apex',
      parameters: { apexScript },
      orgTypes: ['scratch'],
    });
  });
  (config?.sandboxOrgInitApexScripts || []).forEach((apexScript: string, index: number) => {
    steps.push({
      id: `legacy-sandbox-apex-${index + 1}`,
      label: `Run ${path.basename(String(apexScript))}`,
      type: 'apex',
      parameters: { apexScript },
      orgTypes: ['sandbox'],
    });
  });
  if (fs.existsSync(path.join('scripts', 'data', 'ScratchInit'))) {
    steps.push({
      id: 'legacy-data-scratchinit',
      label: 'Load ScratchInit data',
      type: 'data',
      parameters: { sfdmuProject: 'ScratchInit' },
      orgTypes: ['scratch'],
    });
  }
  if (fs.existsSync(path.join('scripts', 'data', 'SandboxInit'))) {
    steps.push({
      id: 'legacy-data-sandboxinit',
      label: 'Load SandboxInit data',
      type: 'data',
      parameters: { sfdmuProject: 'SandboxInit' },
      orgTypes: ['sandbox'],
    });
  }
  (config?.dataPackages || [])
    .filter((dataPackage: any) => dataPackage?.importInSandboxOrgs === true && dataPackage?.dataPath)
    .forEach((dataPackage: any, index: number) => {
      const sfdmuProject = toDataWorkspaceName(dataPackage.dataPath);
      steps.push({
        id: `legacy-data-package-${index + 1}`,
        label: `Load ${path.basename(sfdmuProject)} data`,
        type: 'data',
        parameters: { sfdmuProject },
        orgTypes: ALL_ORG_TYPES,
      });
    });
  return steps.map(normalizeOrgInitStep);
}

/** Fill the defaults of a step: enabled, both org types, runs at pool fill, stops on failure. */
export function normalizeOrgInitStep(rawStep: Partial<PrePostCommand>): PrePostCommand {
  const step = { ...rawStep } as PrePostCommand;
  step.type = step.type || 'command';
  step.label = step.label || step.id || String(step.type);
  step.enabled = step.enabled !== false;
  step.allowFailure = step.allowFailure === true;
  step.runAtPoolFill = step.runAtPoolFill !== false;
  const orgTypes = (Array.isArray(step.orgTypes) ? step.orgTypes : []).filter((orgType) =>
    ALL_ORG_TYPES.includes(orgType)
  );
  // A sandbox gets its metadata from a backpromote: deploy-sources defaults to scratch orgs only
  step.orgTypes = orgTypes.length > 0 ? orgTypes : step.type === 'deploy-sources' ? ['scratch'] : [...ALL_ORG_TYPES];
  return step;
}

/** Definition errors of the steps. An empty list means every step can run. */
export async function checkOrgInitSteps(steps: PrePostCommand[]): Promise<OrgInitDefinitionError[]> {
  const errors: OrgInitDefinitionError[] = [];
  const seenIds = new Set<string>();
  for (const step of steps) {
    const stepId = step.id || step.label || '?';
    const addError = (message: string) => errors.push({ stepId, message });
    if (!step.id) {
      addError(t('orgInitStepNoId', { label: step.label }));
    } else if (seenIds.has(step.id)) {
      addError(t('orgInitStepDuplicateId', { id: step.id }));
    }
    seenIds.add(step.id);
    const deploymentOnlyFields = DEPLOYMENT_ONLY_STEP_FIELDS.filter((field) => (step as any)[field] !== undefined);
    if (deploymentOnlyFields.length > 0) {
      addError(t('orgInitStepDeploymentOnlyFields', { label: step.label, fields: deploymentOnlyFields.join(', ') }));
    }
    errors.push(...(await checkOrgInitStepType(step)).map((message) => ({ stepId, message })));
  }
  return errors;
}

/**
 * Throws when a step that applies to this org type cannot run (missing Apex script, unknown type...).
 * Called before an org is created, so a typo never costs a scratch org or a sandbox.
 */
export async function assertOrgInitStepsValid(config: any, orgType: OrgInitOrgType): Promise<void> {
  const steps = selectOrgInitSteps(getOrgInitSteps(config).steps, { orgType, phase: 'all' });
  await throwOnDefinitionErrors(steps);
}

/** Steps that apply to the org type and the phase, in their run order. */
export function selectOrgInitSteps(
  steps: PrePostCommand[],
  options: { orgType: OrgInitOrgType; phase: OrgInitPhase; stepIds?: string[] }
): PrePostCommand[] {
  return steps.filter((step) => {
    if (step.enabled === false || !(step.orgTypes || ALL_ORG_TYPES).includes(options.orgType)) {
      return false;
    }
    if (options.phase === 'pool-fill' && step.runAtPoolFill === false) {
      return false;
    }
    if (options.phase === 'after-pool-fetch' && step.runAtPoolFill !== false) {
      return false;
    }
    return !options.stepIds || options.stepIds.includes(step.id);
  });
}

/**
 * Run the initialization steps on an org. A failed step stops the run unless it allows failure:
 * the remaining steps are then reported as skipped and an error is thrown after the summary.
 */
export async function runOrgInitSteps(options: OrgInitRunOptions): Promise<OrgInitStepResult[]> {
  const stepsInfo = getOrgInitSteps(options.config);
  if (stepsInfo.source === 'legacy' && stepsInfo.legacyKeys.length > 0) {
    uxLog('log', this, c.grey(t('orgInitUsingLegacyConfig', { keys: stepsInfo.legacyKeys.join(', ') })));
  } else if (stepsInfo.source === 'orgInitSteps' && stepsInfo.legacyKeys.length > 0) {
    uxLog('warning', this, c.yellow(t('orgInitLegacyKeysIgnored', { keys: stepsInfo.legacyKeys.join(', ') })));
  }
  if (options.stepIds) {
    const knownIds = stepsInfo.steps.map((step) => step.id);
    const unknownIds = options.stepIds.filter((stepId) => !knownIds.includes(stepId));
    if (unknownIds.length > 0) {
      throw new SfError(t('orgInitUnknownStepIds', { ids: unknownIds.join(', ') }));
    }
  }
  const steps = selectOrgInitSteps(stepsInfo.steps, options);
  if (steps.length === 0) {
    uxLog('action', this, c.cyan(t('orgInitNoApplicableSteps', { orgType: options.orgType })));
    return [];
  }
  await throwOnDefinitionErrors(steps);
  uxLog(
    'action',
    this,
    c.cyan(t('orgInitStarting', { orgType: options.orgType, orgUsername: c.green(options.orgUsername), count: steps.length }))
  );
  elapseStart('Initialize org');
  const results = await runSelectedSteps(steps, options);
  elapseEnd('Initialize org');
  await logOrgInitSummary(results, options.orgUsername);
  const blockingFailure = results.find((result) => result.status === 'failed');
  if (blockingFailure) {
    throw new SfError(t('orgInitStepFailedStop', { label: blockingFailure.label, message: blockingFailure.output || blockingFailure.skippedReason || '' }));
  }
  return results;
}

/**
 * Makes the source tracking of an org start now: a pull then only lists the changes made from now on.
 * Used when a scratch org is taken from the pool, whose sources the pool job pushed from its own
 * runner. The starting point is kept in the local project, so it runs where the org is taken.
 * A failure is a warning: the org stays usable.
 */
export async function resetSourceTracking(orgUsername: string): Promise<boolean> {
  uxLog('action', this, c.cyan(t('orgInitResettingSourceTracking', { orgUsername: c.green(orgUsername) })));
  const resetRes = await execSfdxJson(`sf project reset tracking --target-org ${orgUsername} --no-prompt`, this, {
    fail: false,
    output: false,
  });
  if (resetRes?.status !== 0) {
    uxLog(
      'warning',
      this,
      c.yellow(t('orgInitSourceTrackingResetFailed', { orgUsername, message: resetRes?.message || resetRes?.errorMessage || '' }))
    );
    return false;
  }
  return true;
}

/** Scratch org or sandbox, read from the Organization record. Production is refused by callers. */
export async function detectOrgInitOrgType(conn: Connection): Promise<OrgInitOrgType | 'production'> {
  const orgRes = await conn.query('SELECT IsSandbox, TrialExpirationDate FROM Organization LIMIT 1');
  const org: any = orgRes.records[0] || {};
  if (org.IsSandbox === true && org.TrialExpirationDate != null) {
    return 'scratch';
  }
  if (org.IsSandbox === true) {
    return 'sandbox';
  }
  return 'production';
}

/** Reads config/project-scratch-def.json, or returns null when the file does not exist. */
export function readProjectScratchDef(
  filePath: string = PROJECT_SCRATCH_DEF_FILE
): { content: any; issues: string[]; warnings: string[] } | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  let content: any;
  try {
    content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { content: null, issues: [t('scratchOrgDefNotJson', { message: (e as Error).message })], warnings: [] };
  }
  const validation = validateScratchOrgDef(content);
  return { content, issues: validation.errors, warnings: validation.warnings };
}

/**
 * Validates a scratch org definition.
 * errors: what the Salesforce CLI schema refuses (wrong types, not an object): scratch:create
 * fails before asking for an org, where sfdx-core only warns.
 * warnings: settings names and features the bundled Salesforce CLI schema does not know. Salesforce
 * can be newer than the schema, so they never block.
 */
export function validateScratchOrgDef(content: any): { errors: string[]; warnings: string[] } {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { errors: [t('scratchOrgDefNotObject')], warnings: [] };
  }
  const definition = { ...content };
  delete definition['$schema'];
  const errors: string[] = [];
  const result = ScratchOrgDefSchema.safeParse(definition);
  if (!result.success) {
    errors.push(...result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`));
  }
  return { errors, warnings: listUnknownScratchOrgDefValues(definition) };
}

/** Values the panel offers in its scratch org definition form, read from the sfdx-core schema. */
export function getScratchOrgDefHints(): ScratchOrgDefHints {
  if (scratchOrgDefHintsCache) {
    return scratchOrgDefHintsCache;
  }
  let schema: any = {};
  try {
    const require = createRequire(import.meta.url);
    const schemaFile = require.resolve('@salesforce/core/project-scratch-def.schema.json');
    schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  } catch (e) {
    uxLog('other', this, c.grey(`Unable to read the scratch org definition schema: ${(e as Error).message}`));
  }
  const features = new Set<string>();
  collectFeatureNames(schema?.properties?.features?.items, features);
  const settingsProperties = schema?.properties?.settings?.properties || {};
  const settingsDocUrls: Record<string, string> = {};
  for (const [name, property] of Object.entries<any>(settingsProperties)) {
    const docUrl = /https:\/\/\S+\.htm/.exec(String(property?.description || ''))?.[0];
    if (docUrl) {
      settingsDocUrls[name] = docUrl;
    }
  }
  scratchOrgDefHintsCache = {
    editions: schema?.properties?.edition?.enum || [],
    features: [...features].sort(),
    settingsNames: Object.keys(settingsProperties).sort(),
    settingsDocUrls,
    featuresDocUrl: SCRATCH_DEF_FEATURES_DOC_URL,
    settingsDocUrl: SCRATCH_DEF_SETTINGS_DOC_URL,
  };
  return scratchOrgDefHintsCache;
}

/** Step types the panel offers, with the org types each one can run on. */
export function listOrgInitStepTypes(): { type: string; orgTypes: OrgInitOrgType[] }[] {
  return ORG_INIT_ACTION_TYPES.map((type) => ({
    type,
    orgTypes: type === 'deploy-sources' ? ['scratch'] : [...ALL_ORG_TYPES],
  }));
}

let scratchOrgDefHintsCache: ScratchOrgDefHints | null = null;

// dataPackages paths are written from the project root, data steps name a workspace of scripts/data
function toDataWorkspaceName(dataPath: string): string {
  const normalized = String(dataPath).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  return normalized.startsWith('scripts/data/') ? normalized.substring('scripts/data/'.length) : normalized;
}

async function checkOrgInitStepType(step: PrePostCommand): Promise<string[]> {
  const type = String(step.type);
  if ((ORG_INIT_ACTION_TYPES as readonly string[]).includes(type)) {
    return await checkBuiltInStepParameters(step);
  }
  const { getCustomFunctionById, isBuiltInActionType } = await import('./customFunctionUtils.js');
  // manual and remove-packagexml-items only mean something during a deployment
  if (isBuiltInActionType(type)) {
    return [t('orgInitTypeNotAllowed', { label: step.label, type })];
  }
  const customFunction = await getCustomFunctionById(type);
  if (!customFunction) {
    return [t('actionValidationUnknownType', { type })];
  }
  // A function bound to a deployment phase expects a deployment around it
  if (customFunction.when) {
    return [t('orgInitTypeNotAllowed', { label: step.label, type })];
  }
  const { validateActionParameters } = await import('./actionUtils.js');
  return await validateActionParameters(step);
}

async function checkBuiltInStepParameters(step: PrePostCommand): Promise<string[]> {
  const type = String(step.type);
  if (type === 'install-packages') {
    return [];
  }
  if (type === 'deploy-sources') {
    return (step.orgTypes || []).includes('sandbox') ? [t('orgInitDeploySourcesScratchOnly', { label: step.label })] : [];
  }
  if (type === 'assign-permission-sets') {
    const permissionSets = step.parameters?.permissionSets;
    const hasPermissionSets = Array.isArray(permissionSets) ? permissionSets.length > 0 : !!permissionSets;
    return hasPermissionSets ? [] : [t('orgInitNoPermissionSets', { label: step.label })];
  }
  const { validateActionParameters } = await import('./actionUtils.js');
  return await validateActionParameters(step);
}

async function throwOnDefinitionErrors(steps: PrePostCommand[]): Promise<void> {
  const definitionErrors = await checkOrgInitSteps(steps);
  if (definitionErrors.length > 0) {
    throw new SfError(
      t('orgInitInvalidSteps', {
        errors: definitionErrors.map((error) => `- [${error.stepId}] ${error.message}`).join('\n'),
      })
    );
  }
}

// Settings names and features the bundled schema does not list, compared without case
function listUnknownScratchOrgDefValues(definition: any): string[] {
  const hints = getScratchOrgDefHints();
  const warnings: string[] = [];
  const knownSettings = hints.settingsNames.map((name) => name.toLowerCase());
  if (knownSettings.length > 0 && definition.settings && typeof definition.settings === 'object') {
    for (const settingsName of Object.keys(definition.settings)) {
      if (!knownSettings.includes(settingsName.toLowerCase())) {
        warnings.push(`settings.${settingsName}: ${t('scratchOrgDefUnknownSettings')}`);
      }
    }
  }
  const knownFeatures = hints.features.map((feature) => feature.toLowerCase());
  if (knownFeatures.length > 0 && Array.isArray(definition.features)) {
    for (const feature of definition.features) {
      const name = String(feature).split(':')[0].toLowerCase();
      if (!knownFeatures.includes(String(feature).toLowerCase()) && !knownFeatures.includes(`${name}:<value>`)) {
        warnings.push(`features.${feature}: ${t('scratchOrgDefUnknownFeature')}`);
      }
    }
  }
  return warnings;
}

async function runSelectedSteps(steps: PrePostCommand[], options: OrgInitRunOptions): Promise<OrgInitStepResult[]> {
  const results: OrgInitStepResult[] = [];
  const restoreOrgEnvironment = await targetOrgForSteps(options);
  try {
    let stoppedBy: PrePostCommand | null = null;
    for (const [index, step] of steps.entries()) {
      if (stoppedBy) {
        results.push(buildStepResult(step, { statusCode: 'skipped', skippedReason: t('orgInitStoppedByFailure', { label: stoppedBy.label }) }));
        continue;
      }
      uxLog('action', this, c.cyan(t('orgInitRunningStep', { index: index + 1, count: steps.length, label: c.bold(step.label) })));
      const startTime = Date.now();
      const result = await runOneStep(step, options);
      const stepResult = buildStepResult(step, result, (Date.now() - startTime) / 1000);
      if (result.statusCode === 'failed' && step.allowFailure) {
        stepResult.status = 'warning';
        uxLog('warning', this, c.yellow(t('orgInitStepFailedContinue', { label: step.label, message: result.output || result.skippedReason || '' })));
      } else if (result.statusCode === 'failed') {
        stoppedBy = step;
      }
      results.push(stepResult);
    }
  } finally {
    restoreOrgEnvironment();
  }
  return results;
}

async function runOneStep(step: PrePostCommand, options: OrgInitRunOptions): Promise<ActionResult> {
  const cmd: PrePostCommand = {
    ...step,
    orgInitContext: {
      orgUsername: options.orgUsername,
      orgAlias: options.orgAlias || options.orgUsername,
      orgType: options.orgType,
      projectScratchDef: options.projectScratchDef || {},
      debugMode: options.debugMode === true,
      config: options.config,
    },
  };
  const provider = await ActionsProvider.buildActionInstance(cmd);
  if (!provider) {
    return cmd.result || { statusCode: 'failed', skippedReason: t('actionValidationUnknownType', { type: cmd.type }) };
  }
  // Providers add --target-org themselves when customUsernameToUse is set. A command step runs as
  // written: SF_TARGET_ORG points its sf commands to the org without changing the command line.
  if (cmd.type !== 'command') {
    provider.customUsernameToUse = options.orgUsername;
  }
  try {
    return await provider.run(cmd);
  } catch (e) {
    uxLog('error', this, c.red(`[OrgInit] ${(e as Error).message}`));
    return { statusCode: 'failed', output: buildActionOutput(e) || (e as Error).message };
  }
}

// Points every sf command and jsforce call of the steps to the org, and returns how to undo it
async function targetOrgForSteps(options: OrgInitRunOptions): Promise<() => void> {
  const previousEnv = {
    SF_TARGET_ORG: process.env.SF_TARGET_ORG,
    SFDX_HARDIS_ORG_USERNAME: process.env.SFDX_HARDIS_ORG_USERNAME,
    SFDX_HARDIS_ORG_TYPE: process.env.SFDX_HARDIS_ORG_TYPE,
  };
  const previousConn = globalThis.jsForceConn;
  process.env.SF_TARGET_ORG = options.orgUsername;
  process.env.SFDX_HARDIS_ORG_USERNAME = options.orgUsername;
  process.env.SFDX_HARDIS_ORG_TYPE = options.orgType;
  try {
    const authInfo = await AuthInfo.create({ username: options.orgUsername });
    globalThis.jsForceConn = await Connection.create({ authInfo });
  } catch (e) {
    uxLog('other', this, c.grey(`[OrgInit] No connection to ${options.orgUsername}: ${(e as Error).message}`));
  }
  return () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    globalThis.jsForceConn = previousConn;
  };
}

function buildStepResult(step: PrePostCommand, result: ActionResult, durationSeconds?: number): OrgInitStepResult {
  return {
    id: step.id,
    label: step.label,
    type: String(step.type),
    status: result.statusCode,
    output: result.output,
    skippedReason: result.skippedReason,
    durationSeconds: durationSeconds !== undefined ? Math.round(durationSeconds) : undefined,
  };
}

async function logOrgInitSummary(results: OrgInitStepResult[], orgUsername: string): Promise<void> {
  const rows = results.map((result) => ({
    step: result.label,
    type: result.type,
    status: result.status,
    seconds: result.durationSeconds ?? '',
    details: result.skippedReason || (result.status === 'failed' || result.status === 'warning' ? firstLine(result.output) : ''),
  }));
  uxLog('action', this, c.cyan(t('orgInitSummaryTitle')));
  await uxLogTableWithReport(this, rows, ['step', 'type', 'status', 'seconds', 'details'], {
    fileNamePrefix: 'org-init-steps',
    fileTitle: t('orgInitSummaryTitle'),
  });
  const count = (status: string) => results.filter((result) => result.status === status).length;
  const message = t('orgInitDone', {
    orgUsername,
    success: count('success'),
    failed: count('failed') + count('warning'),
    skipped: count('skipped'),
  });
  if (count('failed') > 0) {
    uxLog('error', this, c.red(message));
  } else if (count('warning') > 0) {
    uxLog('warning', this, c.yellow(message));
  } else {
    uxLog('success', this, c.green(message));
  }
}

function firstLine(text: string | undefined): string {
  const line = (text || '').split('\n').find((part) => part.trim() !== '') || '';
  return line.length > 120 ? line.substring(0, 117) + '...' : line;
}

function collectFeatureNames(node: any, features: Set<string>): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  for (const value of node.enum || []) {
    features.add(String(value));
  }
  if (node.title && node.pattern) {
    features.add(String(node.title));
  }
  for (const child of [...(node.anyOf || []), ...(node.oneOf || [])]) {
    collectFeatureNames(child, features);
  }
}
