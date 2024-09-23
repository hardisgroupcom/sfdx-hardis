import c from 'chalk';
import { readPackageUp } from 'read-package-up';
import updateNotifier from 'update-notifier';
import * as semver from 'semver';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { Hook } from '@oclif/core';

const hook: Hook<'init'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.id || '';
  if (!commandId.startsWith('hardis')) {
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Check if an upgrade of sfdx-hardis is required
  // Use promise + then to not block plugin execution during that
  const pkg = await readPackageUp({ cwd: __dirname });
  const notifier = updateNotifier({
    pkg: pkg?.packageJson,
    updateCheckInterval: 900, // check every 15 mn
  });
  if (
    notifier &&
    notifier.update &&
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
        `WARNING: You are using sfdx-hardis v${notifier.update.current}: Please upgrade to v${
          notifier.update.latest
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
