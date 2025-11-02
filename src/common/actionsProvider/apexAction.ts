import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { execCommand, uxLog } from '../utils/index.js';
import fs from 'fs-extra';
import c from 'chalk';

export class ApexAction extends ActionsProvider {
  public getLabel(): string {
    return 'ApexAction';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const apexScript = (cmd.parameters?.apexScript as string) || '';
    if (!apexScript) {
      uxLog('error', this, c.red(`[DeploymentActions] No apexScript parameter provided for action [${cmd.id}]: ${cmd.label}`));
      return { statusCode: 'failed', skippedReason: 'No apexScript parameter provided' };
    }
    if (!fs.existsSync(apexScript)) {
      uxLog('error', this, c.red(`[DeploymentActions] Apex script file ${apexScript} does not exist for action [${cmd.id}]: ${cmd.label}`));
      return { statusCode: 'failed', skippedReason: `Apex script file ${apexScript} does not exist` };
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    const apexScript = (cmd.parameters?.apexScript as string) || '';
    const apexCommand = `sf apex run --file ${apexScript}` + (this.customUsernameToUse ? ` --target-org ${this.customUsernameToUse}` : '');
    const res = await execCommand(apexCommand, null, { fail: false, output: true });
    if (res.status === 0) {
      return { statusCode: 'success', output: (res.stdout || '') + '\n' + (res.stderr || '') };
    }
    return { statusCode: 'failed', output: (res.stdout || '') + '\n' + (res.stderr || '') };
  }
}
