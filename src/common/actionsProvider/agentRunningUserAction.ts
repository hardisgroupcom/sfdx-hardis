import { Connection } from '@salesforce/core';
import { ActionResult, ActionWhen, PrePostCommand } from './actionsProvider.js';
import { AgentActionBase } from './agentActionBase.js';
import { getCurrentGitBranch } from '../utils/index.js';
import { soqlQuery } from '../utils/apiUtils.js';
import { AGENT_DOC_URL, getRunningUserRuleUsage } from '../utils/agentUtils.js';
import { t } from '../utils/i18n.js';
import { listAgentsWithRunningUser, resolveAgentRunningUser } from '../replacementRules/agentRunningUserBuiltInRule.js';

/**
 * Creates the running user of a service agent in the target org when it has none, with
 * "sf org create agent-user". The built-in replacement rule builtin-agent-running-user then writes it
 * in the deployed files. Runs before the deployment, in the deployment checks too, so the check
 * validates the agent with its real user. A check never creates a user in production: the Pull
 * Request may never be merged, and each agent user takes a license.
 */
export class AgentRunningUserAction extends AgentActionBase {
  public getLabel(): string {
    return 'AgentRunningUserAction';
  }

  // The replacement rules read the user right after the pre-deployment actions
  public getAllowedWhen(): ActionWhen[] | null {
    return ['pre-deploy'];
  }

  // The deployment check then validates the agent with the user of the target org
  public getDefaultContext(): PrePostCommand['context'] | null {
    return 'all';
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const agentName = String(cmd.parameters?.agentName || '').trim();
    const agent = (await listAgentsWithRunningUser()).find((item) => item.agentName.toLowerCase() === agentName.toLowerCase());
    if (!agent) {
      return this.succeed(t('agentRunningUserNotNeeded', { agentName }));
    }
    // A user nothing writes in the deployed files would only take a license
    const targetBranch = cmd.pipelineContext?.targetBranch || process.env.FORCE_TARGET_BRANCH || (await getCurrentGitBranch()) || null;
    const ruleUsage = await getRunningUserRuleUsage(targetBranch);
    if (ruleUsage !== 'built-in') {
      return this.succeed(t(ruleUsage === 'project' ? 'agentRunningUserProjectRuleNoCreation' : 'agentRunningUserRulesOffNoCreation', { agentName }));
    }
    const conn = await this.getConnection();
    const create = !(cmd.pipelineContext?.checkOnly === 'true' && (await isProductionOrg(conn, cmd)));
    const resolved = await resolveAgentRunningUser(conn, agent, create, this);
    if (resolved.status === 'failed') {
      return this.fail(t('agentRunningUserCreationFailed', { agentName, message: resolved.message || '' }) + `\n${AGENT_DOC_URL}`);
    }
    if (resolved.status === 'missing') {
      return this.succeed(t('agentRunningUserCreatedAtDeployment', { agentName }));
    }
    if (resolved.status === 'created') {
      return this.succeed(t('agentRunningUserCreated', { agentName, username: resolved.username }));
    }
    return this.succeed(t('agentRunningUserAlreadyThere', { agentName, username: resolved.username }));
  }
}

async function isProductionOrg(conn: Connection, cmd: PrePostCommand): Promise<boolean> {
  if (cmd.pipelineContext?.isProduction === 'true') {
    return true;
  }
  try {
    const result = await soqlQuery('SELECT IsSandbox FROM Organization LIMIT 1', conn);
    return result.records?.[0]?.IsSandbox === false;
  } catch {
    // Unknown: a check never risks creating a user in production
    return true;
  }
}
