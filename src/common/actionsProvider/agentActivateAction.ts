import { ActionResult, ActionWhen, PrePostCommand } from './actionsProvider.js';
import { AgentActionBase } from './agentActionBase.js';
import { activateAgentVersion, listOrgAgentVersions, resolveAgentVersion } from '../utils/agentUtils.js';
import { t } from '../utils/i18n.js';

// A deployment check deploys nothing, so there is no agent version to activate after it
const AGENT_ACTIVATE_CONTEXT: PrePostCommand['context'] = 'process-deployment-only';

export class AgentActivateAction extends AgentActionBase {
  public getLabel(): string {
    return 'AgentActivateAction';
  }

  // The version to activate exists only once the deployment is done
  public getAllowedWhen(): ActionWhen[] | null {
    return ['post-deploy'];
  }

  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    return { agentName: readAgentName(cmd.parameters).toLowerCase() };
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const agentName = readAgentName(cmd.parameters);
    const conn = await this.getConnection();
    const outputLines: string[] = [];

    // 1. Find the latest version in the org: each org numbers its own versions
    const target = resolveAgentVersion(await listOrgAgentVersions(conn), agentName, 'latest');
    if (!target) {
      return this.fail(t('agentVersionNotFound', { agentName, version: 'latest', org: conn.getUsername() || '' }), outputLines);
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

  protected listDefinitionErrors(action: Partial<PrePostCommand>, checkContext: boolean): string[] {
    const errors = super.listDefinitionErrors(action, checkContext);
    if (checkContext && action.context && action.context !== AGENT_ACTIVATE_CONTEXT) {
      errors.push(t('actionValidationAgentActivateContext', { context: action.context }));
    }
    return errors;
  }
}

function readAgentName(parameters: PrePostCommand['parameters']): string {
  return String(parameters?.agentName ?? '').trim();
}
