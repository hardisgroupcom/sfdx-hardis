import c from 'chalk';
import {
  elapseStart,
  getCurrentGitBranch,
  isCI,
  restoreLocalSfdxInfo,
  uxLog,
} from '../../common/utils/index.js';
import { checkConfig, getConfig } from '../../config/index.js';
import { Hook } from '@oclif/core';
import { authOrg } from '../../common/utils/authUtils.js';

const hook: Hook<'prerun'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || '';

  if (commandId.startsWith('hardis')) {
    elapseStart(`${options?.Command?.id} execution time`);
  }

  if (
    !commandId.startsWith('hardis') ||
    [
      'hardis:doc:plugin:generate',
      'hardis:source:push',
      'hardis:source:pull',
      'hardis:scratch:pool:view',
      'hardis:source:deploy',
      'hardis:source:push',
      'hardis:mdapi:deploy',
      'hardis:project:deploy:simulate'
    ].includes(commandId)
  ) {
    return;
  }
  // skip if during mocha tests
  if (typeof global.it === 'function') {
    return;
  }
  await restoreLocalSfdxInfo();
  let configInfo = await getConfig('user');
  if (configInfo.skipAuthCheck === true) {
    uxLog(this, c.yellow('No authentication check, you better know what you are doing ;)'));
    return;
  }
  // Manage authentication if DevHub is required but current user is disconnected
  if (
    (options.Command && (options?.Command?.flags as any)['target-dev-hub']?.required === true) ||
    (options as any)?.devHub === true
  ) {
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
    (((options?.Command?.flags as any)['target-org']?.required === true && !options?.argv?.includes('--skipauth')) ||
      (options as any)?.checkAuth === true) &&
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
                : configInfo.scratchOrgAlias || ''; // Can be '' and it's ok if we're not in scratch org context
    await authOrg(orgAlias, options);
  }
};



export default hook;
