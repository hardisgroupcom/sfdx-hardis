import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import c from 'chalk';

export class ManualAction extends ActionsProvider {
  public getLabel(): string {
    return 'ManualAction';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const instructions = (cmd.parameters?.instructions as string) || '';
    if (!instructions) {
      uxLog('warning', this, c.yellow(`[DeploymentActions] No instructions for manual action [${cmd.id}]: ${cmd.label}`));
      return { statusCode: 'skipped', skippedReason: 'No instructions provided' };
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    const instructions = (cmd.parameters?.instructions as string) || '';
    // Manual actions are not executed automatically. We just record the instructions.
    return { statusCode: 'manual', skippedReason: 'Manual action - see output for instructions', output: instructions };
  }
}
