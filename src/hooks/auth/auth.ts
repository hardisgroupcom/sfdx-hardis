import {
  getCurrentGitBranch,
  isCI,
} from '../../common/utils/index.js';
import c from "chalk"
import { checkConfig, getConfig } from '../../config/index.js';
import { Hook } from '@oclif/core';
import { authOrg } from '../../common/utils/authUtils.js';

const hook: Hook<'auth'> = async (options: any) => {
  const commandId = options?.Command?.id || '';
  console.log(c.grey("Entering login Auth hook..."));
  let configInfo = await getConfig('user');

  // Manage authentication if DevHub is required but current user is disconnected
  if ((options as any)?.devHub === true) {
    console.log(c.grey("We'll try to authenticate to the DevHub"));
    let devHubAlias = configInfo.devHubAlias || process.env.DEVHUB_ALIAS;
    if (devHubAlias == null) {
      await checkConfig(options);
      configInfo = await getConfig('user');
      devHubAlias = configInfo.devHubAlias || 'DevHub';
    }
    await authOrg(devHubAlias, options);
  }
  // Manage authentication if org is required but current user is disconnected
  if (
    (options as any)?.checkAuth === true &&
    !((options as any)?.devHub === true)
  ) {
    const orgAlias = (options as any)?.alias
      ? (options as any).alias
      : process.env.ORG_ALIAS
        ? process.env.ORG_ALIAS
        : isCI && configInfo.scratchOrgAlias
          ? configInfo.scratchOrgAlias
          : isCI && (options as any)?.scratch && configInfo.sfdxAuthUrl
            ? configInfo.sfdxAuthUrl
            : isCI
              ? await getCurrentGitBranch({ formatted: true })
              : commandId === 'hardis:auth:login' && configInfo.orgAlias
                ? configInfo.orgAlias
                : configInfo.scratchOrgAlias || ''; // Can be ''  and it's ok if we're not in scratch org context
    console.log(c.grey(`We'll try to authenticate to the org related to ${orgAlias !== configInfo.sfdxAuthUrl ? (orgAlias || "DEFAULT ORG") : "sfdxAuthUrl"}`));
    await authOrg(orgAlias, options);
  }
};

export default hook;
