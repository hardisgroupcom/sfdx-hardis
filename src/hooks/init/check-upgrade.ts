import { Hook } from '@oclif/core';

const hook: Hook<'init'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || '';
  if (!commandId.startsWith('hardis')) {
    return;
  }

  // Never in CI (ephemeral environments) nor when the user opted out.
  // Inlined env checks (kept in sync with isUpgradeCheckDisabled) so nothing
  // at all is imported when the check is disabled.
  const env = process.env;
  if (env.NO_UPDATE_NOTIFIER !== undefined && env.NO_UPDATE_NOTIFIER !== '' && env.NO_UPDATE_NOTIFIER !== 'false') {
    return;
  }
  if (env.CI !== undefined && env.CI !== '' && env.CI !== 'false') {
    return;
  }

  // Fire-and-forget: the upgrade check must never delay command startup
  // (init hooks of a plugin run serially, so awaiting here would postpone the
  // WebSocket connection to the VS Code extension). The banner is printed
  // whenever the check resolves.
  void runUpgradeCheck().catch(() => {
    // Upgrade check is best-effort and must never break the CLI
  });
};

async function runUpgradeCheck(): Promise<void> {
  // Dynamically import libraries in parallel to avoid loading them if not needed
  const [
    { default: c },
    { default: fs },
    { fileURLToPath },
    path,
    { getCache, setCache },
    { shouldCheckForUpgrade, isUpgradeAvailable, fetchLatestPackageVersion, isUpgradeCheckDisabled },
  ] = await Promise.all([
    import('chalk'),
    import('fs-extra'),
    import('url'),
    import('path'),
    import('../../common/cache/index.js'),
    import('../../common/utils/upgradeCheckUtils.js'),
  ]);

  // Authoritative opt-out check (covers cases the inlined env check may miss)
  if (isUpgradeCheckDisabled()) {
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Check if an upgrade of sfdx-hardis is required, at most once every 6 hours
  const lastCheckTs = await getCache('upgradeCheckTimestamp', null);
  if (!shouldCheckForUpgrade(lastCheckTs, Date.now())) {
    return;
  }
  // Store the timestamp before fetching so a failing registry never retries on every run
  await setCache('upgradeCheckTimestamp', Date.now());

  const pkg = await fs.readJson(path.join(__dirname, '..', '..', '..', 'package.json'));
  const latestVersion = await fetchLatestPackageVersion(pkg.name);
  if (isUpgradeAvailable(pkg.version, latestVersion)) {
    console.warn(
      c.yellow(
        '***********************************************************************************************************************'
      )
    );
    console.warn(
      c.yellow(
        `WARNING: You are using sfdx-hardis v${pkg.version}: Please upgrade to v${latestVersion} by running ${c.green('sf plugins install sfdx-hardis')}`
      )
    );
    console.warn(
      c.yellow(
        '***********************************************************************************************************************'
      )
    );
  }
};

export default hook;
