import { AuthInfo, Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';

// API names only: they are written in a command line
const AGENT_API_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * What the agent-publish, agent-activate and agent-running-user actions share: the agent-name flag and
 * prompt, the validation of the agent name and of the phase, the connection to the target org and the
 * output lines.
 */
export abstract class AgentActionBase extends ActionsProvider {
  public getFlagNames(): string[] {
    return ['agent-name'];
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
    return this.collectOtherParameters(flags, collected, promptActionText);
  }

  public applyFlags(parameters: PrePostCommand['parameters'], flags: any): Record<string, any> {
    const updated: Record<string, any> = { ...(parameters || {}) };
    if (flags['agent-name'] !== undefined) updated.agentName = String(flags['agent-name']).trim();
    return updated;
  }

  // The phase is checked by the generic validation, against getAllowedWhen()
  public async getDefinitionErrors(action: Partial<PrePostCommand>): Promise<string[]> {
    return this.listDefinitionErrors(action, true);
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    // The context is not checked here: the execution loop already decided the action runs
    const errors = this.listDefinitionErrors(cmd, false);
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

  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    return { agentName: String(cmd.parameters?.agentName || '').trim().toLowerCase() };
  }

  // Parameters of the type besides the agent name, prompted when not given as flags
  protected async collectOtherParameters(
    _flags: any,
    collected: Record<string, any>,
    _promptActionText: (message: string, initial: string) => Promise<string>
  ): Promise<Record<string, any>> {
    return collected;
  }

  /** Errors of the definition. checkContext: also check the context the type requires. */
  protected listDefinitionErrors(action: Partial<PrePostCommand>, checkContext: boolean): string[] {
    void checkContext;
    const agentName = String(action.parameters?.agentName || '').trim();
    if (!agentName) {
      return [t('actionValidationAgentActivateNoAgentName')];
    }
    if (!AGENT_API_NAME_REGEX.test(agentName)) {
      return [t('actionValidationAgentActivateInvalidAgentName', { name: agentName })];
    }
    return [];
  }

  protected async getConnection(): Promise<Connection> {
    if (this.customUsernameToUse) {
      const authInfo = await AuthInfo.create({ username: this.customUsernameToUse });
      return Connection.create({ authInfo });
    }
    return globalThis.jsForceConn;
  }

  protected logSuccess(message: string, outputLines: string[]): void {
    uxLog('log', this, c.green(`[DeploymentActions] ${message}`));
    outputLines.push(message);
  }

  protected succeed(message: string, outputLines: string[] = []): ActionResult {
    this.logSuccess(message, outputLines);
    return { statusCode: 'success', output: outputLines.join('\n') };
  }

  protected fail(message: string, outputLines: string[] = []): ActionResult {
    uxLog('error', this, c.red(`[DeploymentActions] ${message}`));
    return { statusCode: 'failed', output: [...outputLines, message].join('\n') };
  }
}
