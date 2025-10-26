import { SfError } from '@salesforce/core';
import c from 'chalk';
import { uxLog } from '../utils/index.js';
import { PrePostCommand } from '../utils/prePostCommandUtils.js';

export type ActionResult = {
  statusCode: 'success' | 'failed' | 'skipped';
  output?: string;
  skippedReason?: string;
};

export abstract class ActionsProviderRoot {
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
