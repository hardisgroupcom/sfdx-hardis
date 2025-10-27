import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { execCommand, uxLog } from '../utils/index.js';
import c from 'chalk';

export class PublishCommunityAction extends ActionsProvider {
  public getLabel(): string {
    return 'PublishCommunityAction';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const communityName = (cmd.parameters?.communityName as string) || '';
    if (!communityName) {
      uxLog('error', this, c.red(`[DeploymentActions] No communityName parameter provided for action [${cmd.id}]: ${cmd.label}`));
      return { statusCode: 'failed', skippedReason: 'No communityName parameter provided' };
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    const communityName = (cmd.parameters?.communityName as string) || '';
    const publishCmd = `sf community publish -n "${communityName}"` + (this.customUsernameToUse ? ` --target-org ${this.customUsernameToUse}` : '');
    const res = await execCommand(publishCmd, null, { fail: false, output: true });
    if (res.status === 0) {
      return { statusCode: 'success', output: (res.stdout || '') + '\n' + (res.stderr || '') };
    }
    return { statusCode: 'failed', output: (res.stdout || '') + '\n' + (res.stderr || '') };
  }
}
