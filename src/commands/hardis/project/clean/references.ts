
/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as fs from "fs-extra";
import * as path from 'path';
import { execCommand, isCI, uxLog } from '../../../../common/utils';
import { prompts } from '../../../../common/utils/prompts';
import { getConfig, setConfig } from '../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class CleanReferences extends SfdxCommand {

    public static title = 'Clean references in ds sources';

    public static description = 'Remove unwanted references within sfdx project sources';

    public static examples = [
        '$ sfdx hardis:project:clean:references'
    ];

    // public static args = [{name: 'file'}];

    protected static flagsConfig = {
        type: flags.string({
            char: 't',
            description: 'Cleaning type',
            options: ["all","datadotcom"]                     
        }),
        debug: flags.boolean({ char: 'd', default: false, description: messages.getMessage('debugMode') })
    };

    // Comment this out if your command does not require an org username
    protected static requiresUsername = false;

    // Comment this out if your command does not support a hub org username
    protected static supportsDevhubUsername = false;

    // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
    protected static requiresProject = true;
    /* jscpd:ignore-end */

    protected debugMode = false;
    protected cleaningTypes = [];
    protected allCleaningTypes = [ 
        {
            value: "datadotcom",
            title: "References to Data.com items. https://help.salesforce.com/articleView?id=000320795&type=1&mode=1"
        }
    ]

    public async run(): Promise<AnyJson> {
        this.debugMode = this.flags.debug || false;
        this.cleaningTypes = this.flags.type ? [this.flags.type] : [];

        // Read list of cleanings to perform in references
        const config = await getConfig('branch');
        if (this.cleaningTypes.length > 0 && this.cleaningTypes[0]==='all') {
            this.cleaningTypes = config.autoCleanTypes || []
        }

        // Prompt user cleanings to perform
        if (!isCI && this.cleaningTypes.length === 0) {
            const typesResponse = await prompts({
                type: 'multiselect',
                name: 'value',
                message: c.cyanBright('What references do you want to clean from your SFDX project sources ?'),
                choices: this.allCleaningTypes
            });
            this.cleaningTypes = typesResponse.value;
            // Prompt user to save choice in configuration
            const autoCleanTypes = config.autoCleanTypes || [];
            const toAdd = this.cleaningTypes.filter(type => !autoCleanTypes.includes(type));
            if (toAdd.length > 0) {
                const saveResponse = await prompts({
                    type: 'confirm',
                    name: 'value',
                    default: true,
                    message: c.cyanBright('Do you want to save this configuration in your project configuration ?')
                });
                if (saveResponse.value === true) {
                    autoCleanTypes.push(...this.cleaningTypes);
                    await setConfig("project",{autoCleanTypes: [...new Set(autoCleanTypes)]});
                }
            }
        }

        // Process cleaning
        for (const cleaningType of this.cleaningTypes) {
            uxLog(this,c.cyan(`Apply cleaning of references to ${c.bold(cleaningType)}`));
            const filterConfigFile = path.join(path.join(__dirname, '../../../../../defaults/clean', cleaningType+'.json'));
            if (!fs.existsSync(filterConfigFile)) {
                throw new SfdxError(`[sfdx-hardis] Cleaning config file not found in ${filterConfigFile}`);
            }
            const cleanCommand = 'sfdx essentials:metadata:filter-xml-content' +
                ` -c ${filterConfigFile}` +
                ` --inputfolder ./force-app/main/default`+
                ` --outputfolder ./force-app/main/default`+
                ' --noinsight';
            await execCommand(cleanCommand,this,{fail:true,output:true,debug: this.debugMode});
        }

        // Return an object to be displayed with --json
        return { outputString: 'Cleaned references from sfdx project' };
    }
}
