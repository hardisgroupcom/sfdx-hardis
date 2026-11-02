import { AuthInfo, Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import { ActionsProvider, ActionResult, ActionWhen, PrePostCommand } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import { activateAgentVersion, listOrgAgentVersions, resolveAgentVersion } from '../utils/agentUtils.js';
import { t } from '../utils/i18n.js';

// A deployment check deploys nothing, so there is no agent version to activate after it
const AGENT_ACTIVATE_CONTEXT: PrePostCommand['context'] = 'process-deployment-only';
const AGENT_ACTIVATE_FLAGS = ['agent-name', 'agent-version'];
// API names only: they are written in a command line
const AGENT_API_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Parameters of an agent-activate action, with the defaults applied. */
export interface AgentActivateOptions {
  agentName: string;
  // A version number as a string, or "latest"
  agentVersion: string;
}

export class AgentActivateAction extends ActionsProvider {
  public getLabel(): string {
    return 'AgentActivateAction';
  }

  // The version to activate exists only once the deployment is done
  public getAllowedWhen(): ActionWhen[] | null {
    return ['post-deploy'];
  }

  public getFlagNames(): string[] {
    return AGENT_ACTIVATE_FLAGS;
  }

  public async collectParameters(flags: any, headless: boolean, current: PrePostCommand['parameters'] = {}): Promise<Record<string, any>> {
    const collected: Record<string, any> = this.applyFlags({ ...(current || {}) }, flags);
    if (headless) {
      if (!collected.agentName) {
        throw new SfError(t('missingRequiredFlag', { flag: 'agent-name' }));
      }
      return collected;
    }
    // Loaded only when prompting, so running the action never loads the prompt dependencies
    const { promptActionText } = await import('../utils/actionPromptUtils.js');
    if (flags['agent-name'] === undefined) {
      collected.agentName = await promptActionText(t('enterAgentApiName'), collected.agentName || '');
    }
    if (flags['agent-version'] === undefined) {
      collected.agentVersion = await promptActionText(t('enterAgentVersion'), collected.agentVersion || 'latest');
    }
    return normalizeParameters(collected);
  }

  public applyFlags(parameters: PrePostCommand['parameters'], flags: any): Record<string, any> {
    const updated: Record<string, any> = { ...(parameters || {}) };
    if (flags['agent-name'] !== undefined) updated.agentName = flags['agent-name'];
    if (flags['agent-version'] !== undefined) updated.agentVersion = flags['agent-version'];
    return normalizeParameters(updated);
  }

  // The phase is checked by the generic validation, against getAllowedWhen()
  public async getDefinitionErrors(action: Partial<PrePostCommand>): Promise<string[]> {
    return listDefinitionErrors(action, true);
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    // The execution loop runs it as a deployment-only action whatever its context says
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

  // "latest" and an unset version do the same thing
  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    const options = resolveOptions(cmd.parameters);
    return { agentName: options.agentName.toLowerCase(), agentVersion: options.agentVersion };
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const options = resolveOptions(cmd.parameters);
    const conn = await this.getConnection();
    const outputLines: string[] = [];

    // 1. Find the version in the org
    const target = resolveAgentVersion(await listOrgAgentVersions(conn), options.agentName, options.agentVersion);
    if (!target) {
      return this.fail(
        t('agentVersionNotFound', { agentName: options.agentName, version: options.agentVersion, org: conn.getUsername() || '' }),
        outputLines
      );
    }
    if (target.status.toLowerCase() === 'active') {
      this.logSuccess(t('agentVersionAlreadyActive', { agentName: target.agentName, version: target.version }), outputLines);
      return { statusCode: 'success', output: outputLines.join('\n') };
    }

    // 2. Activate it
    const activation = await activateAgentVersion(conn, target, this);
    if (!activation.success) {
      return this.fail(activation.message, outputLines);
    }
    this.logSuccess(activation.message, outputLines);
    return { statusCode: 'success', output: outputLines.join('\n') };
  }

  private async getConnection(): Promise<Connection> {
    if (this.customUsernameToUse) {
      const authInfo = await AuthInfo.create({ username: this.customUsernameToUse });
      return Connection.create({ authInfo });
    }
    return globalThis.jsForceConn;
  }

  private logSuccess(message: string, outputLines: string[]): void {
    uxLog('log', this, c.green(`[DeploymentActions] ${message}`));
    outputLines.push(message);
  }

  private fail(message: string, outputLines: string[]): ActionResult {
    uxLog('error', this, c.red(`[DeploymentActions] ${message}`));
    return { statusCode: 'failed', output: [...outputLines, message].join('\n') };
  }
}

// Stored form of the parameters: the agent name first, then the version, written as a string
function normalizeParameters(parameters: Record<string, any>): Record<string, any> {
  const options = resolveOptions(parameters);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { agentName, agentVersion, ...otherParameters } = parameters;
  return { agentName: options.agentName, agentVersion: options.agentVersion, ...otherParameters };
}

function listDefinitionErrors(action: Partial<PrePostCommand>, checkContext: boolean): string[] {
  const errors: string[] = [];
  const options = resolveOptions(action.parameters);
  if (!options.agentName) {
    errors.push(t('actionValidationAgentActivateNoAgentName'));
  } else if (!AGENT_API_NAME_REGEX.test(options.agentName)) {
    errors.push(t('actionValidationAgentActivateInvalidAgentName', { name: options.agentName }));
  }
  if (options.agentVersion !== 'latest' && !/^[1-9]\d*$/.test(options.agentVersion)) {
    errors.push(t('actionValidationAgentActivateInvalidVersion', { version: options.agentVersion }));
  }
  if (checkContext && action.context && action.context !== AGENT_ACTIVATE_CONTEXT) {
    errors.push(t('actionValidationAgentActivateContext', { context: action.context }));
  }
  return errors;
}

function resolveOptions(parameters: PrePostCommand['parameters']): AgentActivateOptions {
  const version = String(parameters?.agentVersion ?? '').trim().toLowerCase();
  return {
    agentName: String(parameters?.agentName ?? '').trim(),
    agentVersion: version === '' ? 'latest' : version,
  };
}
