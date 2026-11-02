import { ActionResult, ActionWhen, PrePostCommand } from './actionsProvider.js';
import { AgentActionBase } from './agentActionBase.js';
import { activateAgentVersion, listOrgAgentVersions, resolveAgentVersion } from '../utils/agentUtils.js';
import { t } from '../utils/i18n.js';

// A deployment check deploys nothing, so there is no agent version to activate after it
const AGENT_ACTIVATE_CONTEXT: PrePostCommand['context'] = 'process-deployment-only';

/** Parameters of an agent-activate action, with the defaults applied. */
export interface AgentActivateOptions {
  agentName: string;
  // A version number as a string, or "latest"
  agentVersion: string;
}

export class AgentActivateAction extends AgentActionBase {
  public getLabel(): string {
    return 'AgentActivateAction';
  }

  // The version to activate exists only once the deployment is done
  public getAllowedWhen(): ActionWhen[] | null {
    return ['post-deploy'];
  }

  public getFlagNames(): string[] {
    return ['agent-name', 'agent-version'];
  }

  public applyFlags(parameters: PrePostCommand['parameters'], flags: any): Record<string, any> {
    const updated = super.applyFlags(parameters, flags);
    if (flags['agent-version'] !== undefined) updated.agentVersion = flags['agent-version'];
    return normalizeParameters(updated);
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
      return this.fail(t('agentVersionNotFound', { agentName: options.agentName, version: options.agentVersion, org: conn.getUsername() || '' }), outputLines);
    }
    if (target.status.toLowerCase() === 'active') {
      return this.succeed(t('agentVersionAlreadyActive', { agentName: target.agentName, version: target.version }), outputLines);
    }

    // 2. Activate it
    const activation = await activateAgentVersion(conn, target, this);
    if (!activation.success) {
      return this.fail(activation.message, outputLines);
    }
    return this.succeed(activation.message, outputLines);
  }

  protected async collectOtherParameters(
    flags: any,
    collected: Record<string, any>,
    promptActionText: (message: string, initial: string) => Promise<string>
  ): Promise<Record<string, any>> {
    if (flags['agent-version'] === undefined) {
      collected.agentVersion = await promptActionText(t('enterAgentVersion'), collected.agentVersion || 'latest');
    }
    return normalizeParameters(collected);
  }

  protected listDefinitionErrors(action: Partial<PrePostCommand>, checkContext: boolean): string[] {
    const errors = super.listDefinitionErrors(action, checkContext);
    const options = resolveOptions(action.parameters);
    if (options.agentVersion !== 'latest' && !/^[1-9]\d*$/.test(options.agentVersion)) {
      errors.push(t('actionValidationAgentActivateInvalidVersion', { version: options.agentVersion }));
    }
    if (checkContext && action.context && action.context !== AGENT_ACTIVATE_CONTEXT) {
      errors.push(t('actionValidationAgentActivateContext', { context: action.context }));
    }
    return errors;
  }
}

// Stored form of the parameters: the agent name first, then the version, written as a string
function normalizeParameters(parameters: Record<string, any>): Record<string, any> {
  const options = resolveOptions(parameters);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { agentName, agentVersion, ...otherParameters } = parameters;
  return { agentName: options.agentName, agentVersion: options.agentVersion, ...otherParameters };
}

function resolveOptions(parameters: PrePostCommand['parameters']): AgentActivateOptions {
  const version = String(parameters?.agentVersion ?? '').trim().toLowerCase();
  return {
    agentName: String(parameters?.agentName ?? '').trim(),
    agentVersion: version === '' ? 'latest' : version,
  };
}
