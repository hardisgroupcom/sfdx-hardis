/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import { execSfdxJson, uxLog } from '../../../../common/utils';
import { prompts } from '../../../../common/utils/prompts';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageVersionPromote extends SfdxCommand {

    public static title = 'Promote new versions of package(s)';

    public static description = "Promote package(s) version(s): convert it from beta to released";

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
        // List project packages
        const sfdxProjectJson = await this.project.retrieveSfdxProjectJson(false);
        const packageAliases = sfdxProjectJson.get('packageAliases') || [];
        const availablePackageAliases = {}
        for (const packageAlias of Object.keys(packageAliases).sort().filter(pckgAlias => pckgAlias.includes("@"))) {
            const packageName = packageAlias.split("@")[0];
            availablePackageAliases[packageName] = packageAlias;
        }
        console.log(JSON.stringify(availablePackageAliases));
        const packagesToPromote = [];
        if (auto) {
            packagesToPromote.push(Object.values(availablePackageAliases));
        }
        else {
            // Prompt user if not auto
            const packageResponse = await prompts([
                {
                    type: 'select', 
                    name: 'packageSelected',
                    message: c.cyanBright(`Please select a package (this is not a drill, it will create an official new version !)`),
                    choices: Object.values(availablePackageAliases).map(packageAlias => {
                            return { title: packageAlias, value: packageAlias}
                        })
                }
            ]);
            // Manage user response
            packagesToPromote.push(packageResponse.packageSelected);
        }

        // Promote packages
        for (const packageToPromote of packagesToPromote) {
            uxLog(this,c.cyan(`Promoting version of package ${c.green(packageToPromote)}`));
            const promoteCommand = 'sfdx force:package:version:promote' +
                ` --package "${packageToPromote}"` +
                ' --noprompt';
            const createResult = await execSfdxJson(promoteCommand, this, { fail: true, output: true, debug: debugMode });
            uxLog(this,c.cyan(`Promoted package version ${c.green(packageToPromote)} with id ${c.green(createResult.result.id)}. It is now installable on production orgs`));
        }
        // Return an object to be displayed with --json
        return { outputString: 'Promoted packages' };
    }
}
