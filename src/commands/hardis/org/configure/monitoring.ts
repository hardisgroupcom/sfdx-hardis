
/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as prompts from 'prompts';
import { generateSSLCertificate, getCurrentGitBranch, uxLog } from '../../../../common/utils';
import { getConfig, setInConfigFile } from '../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgConfigureMonitoring extends SfdxCommand {

    public static title = 'Configure org minotoring';

    public static description = 'Configure monitoring of an org';

    public static examples = [
        '$ sfdx hardis:org:configure:monitoring'
    ];

    protected static flagsConfig = {
        debug: flags.boolean({ char: 'd', default: false, description: messages.getMessage('debugMode') })
    };

    // Comment this out if your command does not require an org username
    protected static requiresUsername = false;

    // Comment this out if your command does not support a hub org username
    protected static supportsDevhubUsername = false;

    // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
    protected static requiresProject = false;
    /* jscpd:ignore-end */

    public async run(): Promise<AnyJson> {
        // Copying folder structure
        uxLog(this, 'Copying default files...');
        await fs.copy(path.join(__dirname, '../../../../../defaults/monitoring', '.'), process.cwd(), {overwrite: false});

        const config = await getConfig('project');
        // Get branch name to configure
        const currentBranch = await getCurrentGitBranch({ formatted: true });
        const branchResponse = await prompts({
            type: 'text',
            name: 'value',
            initial: currentBranch,
            message: 'What is the name of the git branch you want to configure ? Exemples: developpement,recette,production'
        });
        const branchName = branchResponse.value;
        let instanceUrl = 'https://login.salesforce.com';
        const orgTypeResponse = await prompts({
            type: 'select',
            name: 'value',
            message: `Is the org that you will monitor in ${branchName} a sandbox or any other type of org ?`,
            choices: [
                { title: 'Sandbox', description: 'The org I want to deploy to is a sandbox', value: 'https://test.salesforce.com' },
                { title: 'Other', description: 'The org I want to deploy to is NOT a sandbox', value: 'https://login.salesforce.com' }
            ],
            initial: (config.instanceUrl === instanceUrl) ? 1 : 0
        });
        instanceUrl = orgTypeResponse.value;

        // Request username
        const usernameResponse = await prompts({
            type: 'text',
            name: 'value',
            message: 'What is the username you will use for sfdx in the org you want to monitor ? Exemple: admin.sfdx@myclient.com',
            initial: config.targetUsername
        });

        // Update config file
        await setInConfigFile([], {
            targetUsername: usernameResponse.value,
            instanceUrl
        }, './.sfdx-hardis.yml');

        // Generate SSL certificate (requires openssl to be installed on computer)
        await generateSSLCertificate(branchName, './.ssh', this);

        uxLog(this, 'You can customize monitoring updating .gitlab-ci-config.yml');

        // Return an object to be displayed with --json
        return { outputString: 'Configured branch for authentication' };
    }
}
