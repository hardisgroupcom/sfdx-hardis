import { AuthInfo, Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import { ActionsProvider, ActionResult, ActionWhen, PrePostCommand } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import { AGENT_DOC_URL } from '../utils/agentUtils.js';
import { t } from '../utils/i18n.js';
import { listAgentsWithRunningUser, resolveAgentRunningUser } from '../replacementRules/agentRunningUserBuiltInRule.js';

const AGENT_RUNNING_USER_FLAGS = ['agent-name'];
// API names only: they are written in a command line
const AGENT_API_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Creates the running user of a service agent in the target org when it has none, with
 * "sf org create agent-user". The built-in replacement rule builtin-agent-running-user then writes it
 * in the deployed files. Run before the deployment, in the deployment checks too: the check then
 * validates the agent with its real user.
 */
export class AgentRunningUserAction extends ActionsProvider {
  public getLabel(): string {
    return 'AgentRunningUserAction';
  }

  // The replacement rules read the user right after the pre-deployment actions
  public getAllowedWhen(): ActionWhen[] | null {
    return ['pre-deploy'];
  }

  public getFlagNames(): string[] {
    return AGENT_RUNNING_USER_FLAGS;
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
    return collected;
  }

  public applyFlags(parameters: PrePostCommand['parameters'], flags: any): Record<string, any> {
    const updated: Record<string, any> = { ...(parameters || {}) };
    if (flags['agent-name'] !== undefined) updated.agentName = String(flags['agent-name']).trim();
    return updated;
  }

  // The phase is checked by the generic validation, against getAllowedWhen()
  public async getDefinitionErrors(action: Partial<PrePostCommand>): Promise<string[]> {
    return listDefinitionErrors(action);
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const errors = listDefinitionErrors(cmd);
    if (errors.length > 0) {
      uxLog('error', this, c.red(`[DeploymentActions] ${errors.join('\n')}`));
      return { statusCode: 'failed', skippedReason: errors.join('\n') };
    }
    return null;
  }

  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    return { agentName: String(cmd.parameters?.agentName || '').trim().toLowerCase() };
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const agentName = String(cmd.parameters?.agentName || '').trim();
    const agent = (await listAgentsWithRunningUser()).find((item) => item.agentName.toLowerCase() === agentName.toLowerCase());
    if (!agent) {
      return this.succeed(t('agentRunningUserNotNeeded', { agentName }));
    }
    const conn = await this.getConnection();
    const resolved = await resolveAgentRunningUser(conn, agent, true, this);
    if (resolved.status === 'failed') {
      const message = t('agentRunningUserCreationFailed', { agentName, message: resolved.message || '' }) + `\n${AGENT_DOC_URL}`;
      uxLog('error', this, c.red(`[DeploymentActions] ${message}`));
      return { statusCode: 'failed', output: message };
    }
    if (resolved.status === 'created') {
      return this.succeed(t('agentRunningUserCreated', { agentName, username: resolved.username }));
    }
    return this.succeed(t('agentRunningUserAlreadyThere', { agentName, username: resolved.username }));
  }

  private async getConnection(): Promise<Connection> {
    if (this.customUsernameToUse) {
      const authInfo = await AuthInfo.create({ username: this.customUsernameToUse });
      return Connection.create({ authInfo });
    }
    return globalThis.jsForceConn;
  }

  private succeed(message: string): ActionResult {
    uxLog('log', this, c.green(`[DeploymentActions] ${message}`));
    return { statusCode: 'success', output: message };
  }
}

function listDefinitionErrors(action: Partial<PrePostCommand>): string[] {
  const agentName = String(action.parameters?.agentName || '').trim();
  if (!agentName) {
    return [t('actionValidationAgentActivateNoAgentName')];
  }
  if (!AGENT_API_NAME_REGEX.test(agentName)) {
    return [t('actionValidationAgentActivateInvalidAgentName', { name: agentName })];
  }
  return [];
}
