import { Hook } from '@oclif/core';

const hook: Hook<'init'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || '';
  if (!commandId.startsWith('hardis')) {
    return;
  }

  // Dynamically import libraries to avoid loading them if not needed
  const c = (await import('chalk')).default;
  const { fileURLToPath } = await import('url');
  const path = await import('path');
  const semver = (await import('semver')).default;
  const updateNotifier = (await import('update-notifier')).default;
  const { readPackageUp } = await import('read-package-up');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Check if an upgrade of sfdx-hardis is required
  // Use promise + then to not block plugin execution during that
  const pkg = await readPackageUp({ cwd: __dirname });
  const notifier = updateNotifier({
    pkg: pkg?.packageJson,
    updateCheckInterval: 1000 * 60 * 60 * 6, // check every 6 hours
  });
  if (
    notifier?.update &&
    notifier.update.current !== notifier.update.latest &&
    semver.compare(notifier.update.latest, notifier.update.current) === 1
  ) {
    console.warn(
      c.yellow(
        '***********************************************************************************************************************'
      )
    );
    console.warn(
      c.yellow(
        `WARNING: You are using sfdx-hardis v${notifier.update.current}: Please upgrade to v${notifier.update.latest
        } by running ${c.green('sf plugins install sfdx-hardis')}`
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
