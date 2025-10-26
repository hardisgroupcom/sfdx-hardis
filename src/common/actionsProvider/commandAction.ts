import { ActionsProviderRoot, ActionResult } from './actionsProviderRoot.js';
import { PrePostCommand } from '../utils/prePostCommandUtils.js';
import { execCommand, uxLog } from '../utils/index.js';
import c from 'chalk';

export class CommandAction extends ActionsProviderRoot {
  public getLabel(): string {
    return 'CommandAction';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkValidityIssues(cmd: PrePostCommand): Promise<ActionResult | null> {
    const command = cmd.command;
    if (!command) {
      uxLog('error', this, c.red(`[DeploymentActions] No command provided for action [${cmd.id}]: ${cmd.label}`));
      return { statusCode: 'failed', skippedReason: 'No command provided' } as ActionResult;
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    const res = await execCommand(cmd.command, null, { fail: false, output: true });
    if (res.status === 0) {
      return { statusCode: 'success', output: (res.stdout || '') + '\n' + (res.stderr || '') };
    }
    return { statusCode: 'failed', output: (res.stdout || '') + '\n' + (res.stderr || '') };
  }
}
