import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { getConfig } from '../../config/index.js';
import { initOrgMetadatas } from '../utils/orgUtils.js';
import { t } from '../utils/i18n.js';

// Org initialization step: pushes (or deploys, in CI deploy mode) the project sources to a scratch org
export class DeploySourcesAction extends ActionsProvider {
  public getLabel(): string {
    return 'DeploySourcesAction';
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    // A sandbox gets its metadata from a backpromote, never from this step
    if (cmd.orgInitContext && cmd.orgInitContext.orgType !== 'scratch') {
      return { statusCode: 'failed', skippedReason: t('orgInitDeploySourcesScratchOnly', { label: cmd.label }) };
    }
    return null;
  }

  // What it deploys is the whole project: two such steps do the same thing
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getIdentityParameters(_cmd: PrePostCommand): Record<string, any> | null {
    return {};
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const orgInitContext = cmd.orgInitContext;
    if (!orgInitContext) {
      return { statusCode: 'failed', skippedReason: t('orgInitStepOutsideOrgInit', { type: cmd.type }) };
    }
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    const config = await getConfig('user');
    await initOrgMetadatas(
      config,
      orgInitContext.orgUsername,
      orgInitContext.orgAlias,
      orgInitContext.projectScratchDef || {},
      orgInitContext.debugMode,
      { scratch: true }
    );
    return { statusCode: 'success' };
  }
}
