/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as prompts from 'prompts';
import { execSfdxJson, uxLog } from '../../../common/utils';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageCreate extends SfdxCommand {

    public static title = 'Create a new package';

    public static description = messages.getMessage('packageCreate');

    public static examples = [
        '$ sfdx hardis:package:create'
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

        // Request questions to user
        const packageResponse = await prompts([
            {
                type: 'text',
                name: 'path',
                message: c.cyanBright(`Please input the path of the package (ex: sfdx-source/apex-mocks)`)
            },
            {
                type: 'text',
                name: 'name',
                message: c.cyanBright(`Please input the name of the package (ex: MyPackage)`)
            },
            {
                type: 'select', 
                name: 'type',
                message: c.cyanBright(`Please select the type of the package`),
                choices: [
                    {title: 'Managed',value: 'Managed', description: 'Managed packages code is hidden in orgs where it is installed. Suited for AppExchanges packages'},
                    {title: 'Unlocked', value: 'Unlocked', description: 'Unlocked packages code is readable and modifiable in orgs where it is installed. Use it for client project or shared tooling'}
                ]
            }
        ]);

        // Create package
        const packageCreateCommand = 'sfdx force:package:create'+
        ` --name "${packageResponse.name}"`+
        ` --packagetype ${packageResponse.type}`+
        ` --path "${packageResponse.path}"` ;
        const packageCreateResult = await execSfdxJson(packageCreateCommand,this,{output:true,fail:true,debug:debugMode});
        uxLog(this,c.cyan(`Created package Id: ${c.green(packageCreateResult.result.Id)} associated to DevHub ${c.green(this.hubOrg.getUsername())}`))

        // Return an object to be displayed with --json
        return {
            outputString: `Create new package ${packageCreateResult.result.Id}`, 
            packageId: packageCreateResult.result.Id
        };
    }
}
