import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { execCommand, uxLog } from '../utils/index.js';
import c from 'chalk';

export class DataAction extends ActionsProvider {
  public getLabel(): string {
    return 'DataAction';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkValidityIssues(cmd: PrePostCommand): Promise<ActionResult | null> {
    const sfdmuProject = (cmd.parameters?.sfdmuProject as string) || '';
    if (!sfdmuProject) {
      uxLog('error', this, c.red(`[DeploymentActions] No sfdmuProject parameter provided for action [${cmd.id}]: ${cmd.label}`));
      return { statusCode: 'failed', skippedReason: 'No sfdmuProject parameter provided' };
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    const sfdmuProject = (cmd.parameters?.sfdmuProject as string) || '';
    const dataCommand = `sf sfdmu run -p ${sfdmuProject}`;
    const res = await execCommand(dataCommand, null, { fail: false, output: true });
    if (res.status === 0) {
      return { statusCode: 'success', output: (res.stdout || '') + '\n' + (res.stderr || '') };
    }
    return { statusCode: 'failed', output: (res.stdout || '') + '\n' + (res.stderr || '') };
  }
}
