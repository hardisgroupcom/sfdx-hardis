import { ActionsProvider, ActionResult, PrePostCommand, buildActionOutput } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import c from 'chalk';
import fs from '../utils/fsUtils.js';
import { normalizeIdentityPath } from '../utils/deploymentActionIdentityUtils.js';
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
    const sfdmuProjectPath = await resolveDataWorkspacePath(sfdmuProject);
    if (!sfdmuProjectPath) {
      uxLog('error', this, c.red(`[DeploymentActions] Data workspace ${sfdmuProject} does not exist for action ${cmd.label}`));
      return { statusCode: 'failed', skippedReason: `Data workspace ${sfdmuProject} does not exist` };
    }
    return null;
  }

  // The workspace path is relative to scripts/data, written by hand with either slash
  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    return { sfdmuProject: normalizeIdentityPath(cmd.parameters?.sfdmuProject) };
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    const sfdmuProject = (cmd.parameters?.sfdmuProject as string) || '';
    const sfdmuProjectPath = await resolveDataWorkspacePath(sfdmuProject);
    const importOptions: any = {}
    if (this.customUsernameToUse) {
      importOptions.targetUsername = this.customUsernameToUse;
    }
    try {
      const res = await importData(sfdmuProjectPath!, null, importOptions);
      return { statusCode: 'success', output: buildActionOutput(res) };
    } catch (error) {
      uxLog('error', this, c.red(`[DeploymentActions] Error during data import for action ${cmd.label}: ${error}`));
      return { statusCode: 'failed', output: `Error during data import: ${error}` };
    }
  }
}

// A workspace name under scripts/data, or a project-relative path to an SFDMU folder
// (dataPackages entries can point outside scripts/data)
async function resolveDataWorkspacePath(sfdmuProject: string): Promise<string | null> {
  const workspacePath = await findDataWorkspaceByName(sfdmuProject, false);
  if (workspacePath) {
    return workspacePath;
  }
  return fs.existsSync(sfdmuProject) && fs.statSync(sfdmuProject).isDirectory() ? sfdmuProject : null;
}
