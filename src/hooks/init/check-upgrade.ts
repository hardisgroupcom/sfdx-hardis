import * as c from 'chalk';
import * as readPkgUp from 'read-pkg-up';
import * as updateNotifier from 'update-notifier';

export const hook = async (options: any) => {
    // Skip hooks from other commands than hardis commands
    const commandId = options?.id || '';
    if (!commandId.startsWith('hardis')) {
        return;
    }

    // Check if an upgrade of sfdx-hardis is required
    // Use promise + then to not block plugin execution during that
    const pkg = await readPkgUp({cwd: __dirname});
    const notifier = updateNotifier({
        pkg: pkg.packageJson,
        updateCheckInterval: 900 // check every 15 mn
    });
    if (notifier && notifier.update) {
        console.warn(c.yellow('***********************************************************************************************************************'));
        console.warn(c.yellow(`WARNING: You are using sfdx-hardis v${notifier.update.current}: Please upgrade to ${notifier.update.latest} by running ${c.green('sfdx plugins:install sfdx-hardis')}`));
        console.warn(c.yellow('***********************************************************************************************************************'));
    }
};
