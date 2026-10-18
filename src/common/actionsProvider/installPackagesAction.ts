import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { getConfig } from '../../config/index.js';
import { MetadataUtils } from '../metadata-utils/index.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import c from 'chalk';

// Org initialization step: installs the packages listed in installedPackages
export class InstallPackagesAction extends ActionsProvider {
  public getLabel(): string {
    return 'InstallPackagesAction';
  }

  // The package list lives in installedPackages: there is no parameter to check
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkParameters(_cmd: PrePostCommand): Promise<ActionResult | null> {
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const orgInitContext = cmd.orgInitContext;
    if (!orgInitContext) {
      return { statusCode: 'failed', skippedReason: t('orgInitStepOutsideOrgInit', { type: cmd.type }) };
    }
    const config = await getConfig('user');
    const packages: any[] = config.installedPackages || [];
    if (packages.length === 0) {
      uxLog('log', this, c.grey(t('orgInitNoPackagesToInstall')));
      return { statusCode: 'success', output: t('orgInitNoPackagesToInstall') };
    }
    // On a scratch org, installOnScratchOrgs: false keeps a package out
    const context = orgInitContext.orgType === 'scratch' ? 'scratch' : 'none';
    await MetadataUtils.installPackagesOnOrg(packages, orgInitContext.orgUsername, this, context);
    return { statusCode: 'success' };
  }
}
