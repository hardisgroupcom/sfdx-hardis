/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import {  uxLog } from '../../../common/utils';
import { getConfig } from '../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RebuildSelection extends SfdxCommand {

    public static title = 'Select again';

    public static description = messages.getMessage('rebuildSelection');

    public static examples = [ 
        '$ sfdx hardis:work:rebuildselection'
    ];

    // public static args = [{name: 'file'}];

    protected static flagsConfig = {
        debug: flags.boolean({ char: 'd', default: false, description: messages.getMessage('debugMode') })
    };

    // Comment this out if your command does not require an org username
    protected static requiresUsername = true;

    // Comment this out if your command does not support a hub org username
    protected static supportsDevhubUsername = false;

    // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
    protected static requiresProject = true;

    protected debugMode = false;

    /* jscpd:ignore-end */

    public async run(): Promise<AnyJson> {
        this.debugMode = this.flags.debug || false;
        const config = await getConfig('project');
        //const localBranch = await getCurrentGitBranch();
        uxLog(this, c.cyan(`This script will rebuild selection that you will want to publish in ${c.green(config.developmentBranch)}`));

        // Return an object to be displayed with --json
        return { outputString: 'Rebuild selection' };
    }
}
