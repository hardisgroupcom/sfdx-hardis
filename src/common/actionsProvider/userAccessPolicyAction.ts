import { AuthInfo, Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import { ActionsProvider, ActionResult, ActionWhen, PrePostCommand, ActionParameterDescription } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import { soqlQuery } from '../utils/apiUtils.js';
import { t } from '../utils/i18n.js';
import type { BrowserforceApplyOptions, BrowserforceApplyOutcome } from './browserforce/browserforceRunner.js';

// A deployment check deploys nothing, so there is no policy to activate after it
const USER_ACCESS_POLICY_CONTEXT: PrePostCommand['context'] = 'process-deployment-only';
const USER_ACCESS_POLICY_FLAGS = ['policies', 'activate', 'apply-to-all'];
// Developer names only: they are written in a SOQL query
const POLICY_DEVELOPER_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Parameters of a user-access-policy action, with the defaults applied. */
export interface UserAccessPolicyOptions {
  policies: string[];
  activate: boolean;
  applyToAll: boolean;
}

/** A user access policy as read from the org. */
export interface UserAccessPolicyRecord {
  Id: string;
  DeveloperName: string;
  Status: string;
}

export class UserAccessPolicyAction extends ActionsProvider {
  public getLabel(): string {
    return 'UserAccessPolicyAction';
  }

  public getParameterDescriptions(): ActionParameterDescription[] {
    return [
      { name: 'policies', path: 'parameters.policies', flag: 'policies', type: 'string[]', required: true, description: 'Developer names of the User Access Policies (the flag separates them with ,)' },
      { name: 'activate', path: 'parameters.activate', flag: 'activate', type: 'boolean', required: false, default: true, description: 'Activate the policies: a deployment always leaves them in Design' },
      { name: 'applyToAll', path: 'parameters.applyToAll', flag: 'apply-to-all', type: 'boolean', required: false, default: false, description: 'Also run Apply To All for each policy' },
    ];
  }

  // A deployment sets the policies it contains back to Design: activating them before it is useless
  public getAllowedWhen(): ActionWhen[] | null {
    return ['post-deploy'];
  }

  public getFlagNames(): string[] {
    return USER_ACCESS_POLICY_FLAGS;
  }

  public async collectParameters(flags: any, headless: boolean, current: PrePostCommand['parameters'] = {}): Promise<Record<string, any>> {
    const collected: Record<string, any> = this.applyFlags({ ...(current || {}) }, flags);
    if (headless) {
      if (collected.policies.length === 0) {
        throw new SfError(t('missingRequiredFlag', { flag: 'policies' }));
      }
      return collected;
    }
    // Loaded only when prompting, so running the action never loads the prompt dependencies
    const { promptActionConfirm, promptActionText } = await import('../utils/actionPromptUtils.js');
    if (flags.policies === undefined) {
      collected.policies = await promptActionText(t('enterUserAccessPolicies'), (collected.policies || []).join(', '));
    }
    if (flags.activate === undefined) {
      collected.activate = await promptActionConfirm(t('confirmActivateUserAccessPolicies'), collected.activate !== false);
    }
    if (flags['apply-to-all'] === undefined) {
      collected.applyToAll = await promptActionConfirm(t('confirmApplyUserAccessPoliciesToAll'), collected.applyToAll === true);
    }
    return normalizeParameters(collected);
  }

  public applyFlags(parameters: PrePostCommand['parameters'], flags: any): Record<string, any> {
    const updated: Record<string, any> = { ...(parameters || {}) };
    if (flags.policies !== undefined) updated.policies = flags.policies;
    if (flags.activate !== undefined) updated.activate = flags.activate;
    if (flags['apply-to-all'] !== undefined) updated.applyToAll = flags['apply-to-all'];
    return normalizeParameters(updated);
  }

  // The phase is checked by the generic validation, against getAllowedWhen()
  public async getDefinitionErrors(action: Partial<PrePostCommand>): Promise<string[]> {
    return listDefinitionErrors(action, true);
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    // The execution loop runs it as a deployment-only action whatever its context says, so a context
    // written by hand is not a reason to fail the action in every job
    const errors = listDefinitionErrors(cmd, false);
    const allowedWhen = this.getAllowedWhen() || [];
    if (cmd.when && !allowedWhen.includes(cmd.when)) {
      errors.push(t('actionTypeWrongPhase', { type: cmd.type, when: allowedWhen.join(', ') }));
    }
    if (errors.length > 0) {
      uxLog('error', this, c.red(`[DeploymentActions] ${errors.join('\n')}`));
      return { statusCode: 'failed', skippedReason: errors.join('\n') };
    }
    return null;
  }

  // The same policies in another order, or an unset activate, do the same thing
  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    const options = resolveOptions(cmd.parameters);
    return { ...options, policies: [...options.policies].sort() };
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const options = resolveOptions(cmd.parameters);
    const conn = await this.getConnection();

    // 1. Read the policies from the org: a missing policy or the feature off gets its own message
    let policies: UserAccessPolicyRecord[];
    try {
      policies = await this.readPolicies(options.policies, conn);
    } catch (e: any) {
      if ([e?.errorCode, e?.name, e?.message].some((field) => String(field || '').includes('INVALID_TYPE'))) {
        return this.fail(t('userAccessPoliciesNotEnabled'));
      }
      throw e;
    }
    // SOQL compares developer names without case: so does the lookup
    const findPolicy = (name: string) => policies.find((policy) => policy.DeveloperName.toLowerCase() === name.toLowerCase());
    const missingNames = options.policies.filter((name) => !findPolicy(name));
    if (missingNames.length > 0) {
      return this.fail(t('userAccessPoliciesNotFound', { names: missingNames.join(', ') }));
    }

    // 2. Activate them and apply them to all users with Browserforce: a deployment always leaves
    // them in Design, and Apply To All has no API
    const outcome = await this.applyWithBrowserforce({
      setting: 'userAccessPolicies',
      config: buildUserAccessPoliciesConfig(options.policies.map((name) => findPolicy(name)!.DeveloperName), options),
      username: conn.getUsername() || '',
      dryRun: false,
      targetBranch: cmd.pipelineContext?.targetBranch || null,
    });
    return { statusCode: outcome.success ? 'success' : 'failed', output: outcome.outputLines.join('\n') };
  }

  // Overridden by the tests, which cannot start a browser
  protected async applyWithBrowserforce(options: BrowserforceApplyOptions): Promise<BrowserforceApplyOutcome> {
    const { runBrowserforceApply } = await import('./browserforce/browserforceRunner.js');
    return runBrowserforceApply(options);
  }

  private async getConnection(): Promise<Connection> {
    if (this.customUsernameToUse) {
      const authInfo = await AuthInfo.create({ username: this.customUsernameToUse });
      return Connection.create({ authInfo });
    }
    return globalThis.jsForceConn;
  }

  private async readPolicies(names: string[], conn: Connection): Promise<UserAccessPolicyRecord[]> {
    const namesList = names.map((name) => `'${name}'`).join(',');
    const result = await soqlQuery(
      `SELECT Id, DeveloperName, Status FROM UserAccessPolicy WHERE DeveloperName IN (${namesList})`,
      conn
    );
    return (result.records || []) as UserAccessPolicyRecord[];
  }

  private fail(message: string): ActionResult {
    uxLog('error', this, c.red(`[DeploymentActions] ${message}`));
    return { statusCode: 'failed', output: message };
  }
}

/**
 * The Browserforce userAccessPolicies value of the action: active only when the policies are
 * activated (left out, Browserforce does not touch their status), applyToAll only when asked.
 */
export function buildUserAccessPoliciesConfig(policyNames: string[], options: UserAccessPolicyOptions): Record<string, any> {
  return {
    accessPolicies: policyNames.map((apiName) => ({
      apiName,
      ...(options.activate ? { active: true } : {}),
      ...(options.applyToAll ? { applyToAll: true } : {}),
    })),
  };
}

/**
 * Stored form of the parameters: the policies first, as a list without duplicates, then both
 * choices written as booleans, so the YAML says what the action does.
 */
function normalizeParameters(parameters: Record<string, any>): Record<string, any> {
  const options = resolveOptions(parameters);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { policies, activate, applyToAll, ...otherParameters } = parameters;
  return { policies: options.policies, activate: options.activate, applyToAll: options.applyToAll, ...otherParameters };
}

function listDefinitionErrors(action: Partial<PrePostCommand>, checkContext: boolean): string[] {
  const errors: string[] = [];
  const options = resolveOptions(action.parameters);
  if (options.policies.length === 0) {
    errors.push(t('actionValidationUserAccessPolicyNoPolicies'));
  }
  const invalidNames = options.policies.filter((name) => !POLICY_DEVELOPER_NAME_REGEX.test(name));
  if (invalidNames.length > 0) {
    errors.push(t('actionValidationUserAccessPolicyInvalidNames', { names: invalidNames.join(', ') }));
  }
  if (!options.activate && !options.applyToAll) {
    errors.push(t('actionValidationUserAccessPolicyNothingToDo'));
  }
  if (checkContext && action.context && action.context !== USER_ACCESS_POLICY_CONTEXT) {
    errors.push(t('actionValidationUserAccessPolicyContext', { context: action.context }));
  }
  return errors;
}

function resolveOptions(parameters: PrePostCommand['parameters']): UserAccessPolicyOptions {
  return {
    policies: parsePolicyNames(parameters?.policies),
    activate: parseBoolean(parameters?.activate, true),
    applyToAll: parseBoolean(parameters?.applyToAll, false),
  };
}

// A comma or new line separated string is also accepted
function parsePolicyNames(value: any): string[] {
  const rawNames: any[] = Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/);
  const names = rawNames.map((name) => String(name ?? '').trim()).filter(Boolean);
  return [...new Set(names)];
}

function parseBoolean(value: any, defaultValue: boolean): boolean {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value).trim().toLowerCase() === 'true';
}
