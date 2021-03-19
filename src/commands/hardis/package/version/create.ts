/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import { execSfdxJson } from '../../../../common/utils';
import { prompts } from '../../../../common/utils/prompts';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageVersionCreate extends SfdxCommand {

    public static title = 'Create a new version of a package';

    public static description = messages.getMessage('packageVersionCreate');

    public static examples = [
        '$ sfdx hardis:package:version:create'
    ];

    // public static args = [{name: 'file'}];

    protected static flagsConfig = {
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

        const packageDirectories = this.project.getUniquePackageDirectories();
        console.error(JSON.stringify(packageDirectories));
        const packageResponse = await prompts([
            {
                type: 'select', 
                name: 'package',
                message: c.cyanBright(`Please select a package`),
                choices: packageDirectories.map(packageDirectory => {
                        return { title: packageDirectory.package, value: packageDirectory}
                    })
            }
        ]);

        const createCommand = 'sfdx force:package:version:create' +
            ` -p ${packageResponse.package.package}` +
            ((packageResponse.package.packageInstallationKey ? ` --installationkey ${packageResponse.package.packageInstallationKey}` : ' --installationkeybypass')) +
            ' -w 60';
        const createResult = await execSfdxJson(createCommand, this, { fail: true, output: true, debug: debugMode });
        const latestVersion = createResult.result.SubscriberPackageVersionId;
        // Return an object to be displayed with --json
        return { outputString: 'Generated new package version', packageVersionId: latestVersion };
    }
}
