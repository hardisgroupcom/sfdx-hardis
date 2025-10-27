import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import c from 'chalk';
import { findDataWorkspaceByName, importData } from '../utils/dataUtils.js';

export class DataAction extends ActionsProvider {
  public getLabel(): string {
    return 'DataAction';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const sfdmuProject = (cmd.parameters?.sfdmuProject as string) || '';
    if (!sfdmuProject) {
      uxLog('error', this, c.red(`[DeploymentActions] No sfdmuProject parameter provided for action ${cmd.label}`));
      return { statusCode: 'failed', skippedReason: 'No sfdmuProject parameter provided' };
    }
    const sfdmuProjectPath = await findDataWorkspaceByName(sfdmuProject, false);
    if (!sfdmuProjectPath) {
      uxLog('error', this, c.red(`[DeploymentActions] Data workspace ${sfdmuProject} does not exist for action ${cmd.label}`));
      return { statusCode: 'failed', skippedReason: `Data workspace ${sfdmuProject} does not exist` };
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    const sfdmuProject = (cmd.parameters?.sfdmuProject as string) || '';
    const sfdmuProjectPath = await findDataWorkspaceByName(sfdmuProject);
    const importOptions: any = {
      fail: false,
      output: true
    }
    if (this.customUsernameToUse) {
      importOptions.targetUsername = this.customUsernameToUse;
    }
    let res: any;
    try {
      res = await importData(sfdmuProjectPath!, null, importOptions);
      if (res.status === 0) {
        return { statusCode: 'success', output: (res.stdout || '') + '\n' + (res.stderr || '') };
      }
    } catch (error) {
      uxLog('error', this, c.red(`[DeploymentActions] Error during data import for action ${cmd.label}: ${error}`));
      return { statusCode: 'failed', output: `Error during data import: ${error}` };
    }
    return { statusCode: 'failed', output: (res.stdout || '') + '\n' + (res.stderr || '') };
  }
}
