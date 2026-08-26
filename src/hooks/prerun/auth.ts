
import { Hook } from '@oclif/core';

const hook: Hook<'prerun'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || '';

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

  const { elapseStart, getCurrentGitBranch, isCI, restoreLocalSfdxInfo } = await import('../../common/utils/index.js');

  if (commandId.startsWith('hardis')) {
    elapseStart(`${options?.Command?.id} execution time`);
  }

  // Fast path: outside CI, the org authentication check is OFF by default (see
  // below) and restoreLocalSfdxInfo is a CI-only no-op, so nothing further is
  // needed - in particular not the getConfig('user') read, which cost about 1
  // second (up to 3 with a linked plugin) on every command just to look up
  // skipAuthCheck. DevHub commands keep the full flow, and
  // SFDX_HARDIS_AUTH_CHECK=true restores the check.
  const needsDevHub =
    (options.Command && (options?.Command?.flags as any)['target-dev-hub']?.required === true) ||
    (options as any)?.devHub === true;
  if (!isCI && !needsDevHub && process.env.SFDX_HARDIS_AUTH_CHECK !== 'true') {
    return;
  }

  // Dynamic imports in parallel to improve performances when other CLI commands are called
  const [
    { authOrg, extractTargetOrgFromArgv },
    { default: c },
    { checkConfig, getConfig },
  ] = await Promise.all([
    import('../../common/utils/authUtils.js'),
    import('chalk'),
    import('../../config/index.js'),
  ]);

  await restoreLocalSfdxInfo();
  let configInfo = await getConfig('user');
  if (configInfo.skipAuthCheck === true) {
    console.log(c.yellow('No authentication check, you better know what you are doing ;)'));
    return;
  }
  // Manage authentication if DevHub is required but current user is disconnected
  if (needsDevHub) {
    let devHubAlias = configInfo.devHubAlias || process.env.DEVHUB_ALIAS;
    if (devHubAlias == null) {
      await checkConfig(options);
      configInfo = await getConfig('user');
      devHubAlias = configInfo.devHubAlias || 'DevHub';
    }
    await authOrg(devHubAlias, options);
  }
  // Manage authentication if org is required but current user is disconnected.
  // OFF by default since v8.3, as if --skipauth was always sent: the check cost
  // about 1 second on every command, official CI/CD and monitoring pipelines
  // authenticate explicitly with hardis:auth:login, and a command run without
  // any default org still fails with a clear Salesforce CLI error. Restore the
  // previous behavior with SFDX_HARDIS_AUTH_CHECK=true (any context), or
  // skipAuthCheck: false in .sfdx-hardis.yml (CI and DevHub commands only:
  // interactive non-DevHub commands return on the fast path above without
  // reading the config). The DevHub check above is kept as it guards scratch
  // org commands, exactly like --skipauth always did.
  const authCheckEnforced =
    configInfo.skipAuthCheck === false ||
    process.env.SFDX_HARDIS_AUTH_CHECK === 'true';
  if (
    authCheckEnforced &&
    (((options?.Command?.flags as any)['target-org']?.required === true && !options?.argv?.includes('--skipauth')) ||
      (options as any)?.checkAuth === true) &&
    !((options as any)?.devHub === true)
  ) {
    const cliTargetOrg = extractTargetOrgFromArgv(options?.argv);
    const orgAlias = cliTargetOrg
      ? cliTargetOrg
      : (options as any)?.alias
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
