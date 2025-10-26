import { SfError } from '@salesforce/core';
import c from 'chalk';
import { uxLog } from '../utils/index.js';
import { CommonPullRequestInfo } from '../gitProvider/index.js';

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
  // If command comes from a PR, we attach PR info
  pullRequest?: CommonPullRequestInfo;
  result?: ActionResult;
}

export type ActionResult = {
  statusCode: 'success' | 'failed' | 'skipped';
  output?: string;
  skippedReason?: string;
};

export abstract class ActionsProvider {

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkValidityIssues(cmd: PrePostCommand): Promise<ActionResult | null> {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    uxLog('warning', this, c.yellow(`run is not implemented on ${this.getLabel()}`));
    return { statusCode: 'skipped', skippedReason: 'Not implemented' };
  }
}
