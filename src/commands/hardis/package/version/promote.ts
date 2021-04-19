/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import { execSfdxJson } from '../../../../common/utils';
import { prompts } from '../../../../common/utils/prompts';
import { getConfig, setConfig } from '../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageVersionPromote extends SfdxCommand {

    public static title = 'Promote new versions of package(s)';

    public static description = messages.getMessage('packageVersionPromote');

    public static examples = [
        '$ sfdx hardis:package:version:promote',
        '$ sfdx hardis:package:version:promote --auto'
    ];

    // public static args = [{name: 'file'}];

    protected static flagsConfig = {
        auto: flags.boolean({ char: 'd', default: false, description: 'Auto-detect which versions of which packages need to be promoted' }),
        debug: flags.boolean({ char: 'd', default: false, description: messages.getMessage('debugMode') })
    };

    // Comment this out if your command does not require an org username
    protected static requiresUsername = false;

    // Comment this out if your command does not support a hub org username
    protected static supportsDevhubUsername = true;

    // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
    protected static requiresProject = true;

    /* jscpd:ignore-end */

    public async run(): Promise<AnyJson> {
        const debugMode = this.flags.debug || false;
        const auto = this.flags.auto || false ;
        const config = await getConfig("project");
        // List project packages
        const packageDirectories = this.project.getUniquePackageDirectories();
        const packageResponse = await prompts([
            {
                type: 'select', 
                name: 'packageSelected',
                message: c.cyanBright(`Please select a package (this is not a drill, it will create an official new version !)`),
                choices: packageDirectories.map(packageDirectory => {
                        return { title: (packageDirectory.package || packageDirectory.path), value: packageDirectory.name}
                    })
            },
            {
                type: 'text', 
                name: 'packageInstallationKey',
                message: c.cyanBright(`Please input an installation password (or let empty)`),
                initial: config.defaultPackageInstallationKey || ''
            }
        ]);
        // Manage user response
        const pckgDirectory = packageDirectories.filter(pckgDirectory => pckgDirectory.name === packageResponse.packageSelected)[0];
        if (config.defaultPackageInstallationKey !== packageResponse.packageInstallationKey) {
            await setConfig("project", {defaultPackageInstallationKey: packageResponse.packageInstallationKey})
        }

        // Create package version
        const createCommand = 'sfdx force:package:version:create' +
            ` -p "${pckgDirectory.package}"` +
            ((packageResponse.packageInstallationKey ? ` --installationkey "${packageResponse.packageInstallationKey}"` : ' --installationkeybypass')) +
            ' -w 60';
        const createResult = await execSfdxJson(createCommand, this, { fail: true, output: true, debug: debugMode });
        const latestVersion = createResult.result.SubscriberPackageVersionId;
        // Return an object to be displayed with --json
        return { outputString: 'Generated new package version', packageVersionId: latestVersion };
    }
}
