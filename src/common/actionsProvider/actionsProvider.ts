import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import { getCurrentGitBranch, uxLog } from '../utils/index.js';
import { CommonPullRequestInfo } from '../gitProvider/index.js';
import { authOrg } from '../utils/authUtils.js';
import { findUserByUsernameLike } from '../utils/orgUtils.js';

export interface PrePostCommand {
  id: string;
  label: string;
  type: 'command' | 'data' | 'apex' | 'publish-community' | 'manual';
  // Known parameters used by action implementations. Additional keys allowed.
  parameters?: {
    apexScript?: string;     // for 'apex' actions
    sfdmuProject?: string;   // for 'data' actions
    communityName?: string;  // for 'publish-community' actions
    instructions?: string;   // for 'manual' actions
    [key: string]: any;
  };
  command: string;
  context: 'all' | 'check-deployment-only' | 'process-deployment-only';
  skipIfError?: boolean;
  allowFailure?: boolean;
  runOnlyOnceByOrg?: boolean;
  customUsername?: string;
  // If command comes from a PR, we attach PR info
  pullRequest?: CommonPullRequestInfo;
  result?: ActionResult;
}

export type ActionResult = {
  statusCode: 'success' | 'failed' | 'skipped' | "manual";
  output?: string;
  skippedReason?: string;
};

export abstract class ActionsProvider {

  public customUsernameToUse: string | null = null;

  public static async buildActionInstance(cmd: PrePostCommand): Promise<ActionsProvider> {
    let actionInstance: any = null;
    const type = cmd.type || 'command';
    if (type === 'command') {
      const CommandAction = await import('./commandAction.js');
      actionInstance = new CommandAction.CommandAction();
    }
    else if (type === 'apex') {
      const ApexAction = await import('./apexAction.js');
      actionInstance = new ApexAction.ApexAction();
    }
    else if (type === 'data') {
      const DataAction = await import('./dataAction.js');
      actionInstance = new DataAction.DataAction();
    }
    else if (type === 'publish-community') {
      const PublishCommunityAction = await import('./publishCommunityAction.js');
      actionInstance = new PublishCommunityAction.PublishCommunityAction();
    }
    else if (type === 'manual') {
      const ManualAction = await import('./manualAction.js');
      actionInstance = new ManualAction.ManualAction();
    }
    else {
      uxLog("error", this, c.yellow(`[DeploymentActions] Action type [${cmd.type}] is not yet implemented for action [${cmd.id}]: ${cmd.label}`));
      cmd.result = {
        statusCode: "failed",
        skippedReason: `Action type [${cmd.type}] is not implemented`
      };
    }
    return actionInstance;
  }

  public getLabel(): string {
    throw new SfError('getLabel should be implemented on this call');
  }

  /**
   * Perform pre-run validations for the given command.
   * Return null when the command is valid and may proceed.
   * Return an ActionResult when the command must be short-circuited
   * (for example: missing parameters -> failed, or manual -> skipped).
   */
  public async checkValidityIssues(cmd: PrePostCommand): Promise<ActionResult | null> {
    const parametersValidityIssue = await this.checkParameters(cmd);
    if (parametersValidityIssue) {
      return parametersValidityIssue;
    }
    const authValidityIssue = await this.checkAuthCustomUsernameIssues(cmd);
    if (authValidityIssue) {
      return authValidityIssue;
    }
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkParameters(_cmd: PrePostCommand): Promise<ActionResult | null> {
    uxLog('warning', this, c.yellow(`checkParameters is not implemented on ${this.getLabel()}`));
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    uxLog('warning', this, c.yellow(`run is not implemented on ${this.getLabel()}`));
    return { statusCode: 'skipped', skippedReason: 'Not implemented' };
  }

  public async checkAuthCustomUsernameIssues(cmd: PrePostCommand): Promise<ActionResult | null> {
    if (this.customUsernameToUse) {
      return null;
    }
    if (cmd.customUsername) {
      const conn: Connection = globalThis.jsForceConn;
      const user = await findUserByUsernameLike(cmd.customUsername, conn);
      if (!user) {
        uxLog('error', this, c.red(`[DeploymentActions] Custom username [${cmd.customUsername}] not found for action ${cmd.label}`));
        return { statusCode: 'failed', skippedReason: `Custom username [${cmd.customUsername}] not found` };
      }
      let authResult: boolean;
      try {
        const instanceUrl = conn.instanceUrl;
        let targetBranch = cmd.pullRequest?.targetBranch;
        if (!targetBranch) {
          targetBranch = await getCurrentGitBranch({ formatted: true }) || undefined;
        }
        authResult = await authOrg(targetBranch!, {
          forceUsername: user.Username,
          instanceUrl: instanceUrl,
          setDefault: false,
        });
      } catch (error) {
        uxLog('error', this, c.red(`[DeploymentActions] Error during authentication with custom username [${user.Username}] for action ${cmd.label}: ${error}`));
        return { statusCode: 'failed', skippedReason: `Error during authentication with custom username [${user.Username}]: ${error}` };
      }
      if (authResult === true) {
        this.customUsernameToUse = user.Username;
        uxLog('log', this, c.green(`[DeploymentActions] Authenticated with custom username [${this.customUsernameToUse}] for action ${cmd.label}`));
      }
      else {
        uxLog('error', this, c.red(`[DeploymentActions] Failed to authenticate with custom username [${user.Username}] for action ${cmd.label}`));
        return { statusCode: 'failed', skippedReason: `Failed to authenticate with custom username [${user.Username}]` };
      }
    }
    return null;
  }
}
