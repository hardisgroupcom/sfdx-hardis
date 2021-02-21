
/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as crossSpawn from 'cross-spawn';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as prompts from 'prompts';
import { execCommand } from '../../../../common/utils';
import { checkConfig, getConfig, setConfig, setInConfigFile } from '../../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ConfigureAuth extends SfdxCommand {

    public static title = 'Configure authentication';

    public static description = 'Configure authentication from git branch to target org';

    public static examples = [
        '$ sfdx hardis:project:configure:auth'
    ];

    // public static args = [{name: 'file'}];

    protected static flagsConfig = {
        devhub: flags.boolean({ char: 'b', default: false, description: 'Configure project DevHub' }),
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
        const devHub = this.flags.devhub || false;
        await checkConfig(this);
        const config = await getConfig('project');
        // Get branch name to configure if not Dev Hub
        let branchName = '';
        let instanceUrl = 'https://login.salesforce.com';
        if (!devHub) {
            const branchResponse = await prompts({
                type: 'text',
                name: 'value',
                message: 'What is the name of the git branch you want to configure ? Exemples: developpement,recette,production'
            });
            branchName = branchResponse.value;
            const orgTypeResponse = await prompts({
                type: 'select',
                name: 'value',
                message: `Is the org where you'll deploy ${branchName} a sandbox or another type of org ?`,
                choices: [
                    { title: 'Sandbox', description: 'The org I want to deploy to is a sandbox', value: 'https://test.salesforce.com' },
                    { title: 'Other', description: 'The org I want to deploy to is NOT a sandbox', value: 'https://login.salesforce.com' }
                ],
                initial: 1
            });
            instanceUrl = orgTypeResponse.value;
        }
        // Request username
        const usernameResponse = await prompts({
            type: 'text',
            name: 'value',
            message: `What is the username you will use for sfdx in the org you want to ${(devHub) ? 'use as Dev Hub' : 'deploy to'} ? Exemple: admin.sfdx@myclient.com`
        });
        if (devHub) {
            await setConfig('project', {
                devHubUsername: usernameResponse.value
            });
        } else {
            // Update config file
            await setInConfigFile([], {
                targetUsername: usernameResponse.value,
                instanceUrl
            }, `./config/branches/.sfdx-hardis.${branchName}.yml`);
        }

        // Generate SSL certificate (requires openssl to be installed on computer)
        this.ux.log('[sfdx-hardis] Generating SSL certificate');
        const tmpDir = path.join(os.tmpdir(), 'sslTmp-') + Math.random().toString(36).slice(-5);
        await fs.ensureDir(tmpDir);
        const prevDir = process.cwd();
        process.chdir(tmpDir);
        const pwd = Math.random().toString(36).slice(-20);
        await execCommand(`openssl genrsa -des3 -passout "pass:${pwd}" -out server.pass.key 2048`, this, { output: true, fail: true });
        await execCommand(`openssl rsa -passin "pass:${pwd}" -in server.pass.key -out server.key`, this, { output: true, fail: true });
        await fs.remove('server.pass.key');
        this.ux.log('[sfdx-hardis] Now answer the following questions. The answers are not really important :)');
        await new Promise((resolve, reject) => {
            crossSpawn('openssl req -new -key server.key -out server.csr', [], { stdio: 'inherit' }).on('close', () => {
                resolve(null);
            });
        });
        await execCommand('openssl x509 -req -sha256 -days 365 -in server.csr -signkey server.key -out server.crt', this, { output: true, fail: true });
        process.chdir(prevDir);
        // Copy certificate key in local project
        await fs.copy(path.join(tmpDir, 'server.key'),
            (devHub) ?
                `./config/.jwt/${config.devHubAlias}.key` :
                `./config/branches/.jwt/${branchName}.key`);
        // Copy certificate file in user home project
        const crtFile = path.join(require('os').homedir(), (devHub) ? `${config.devHubAlias}.crt` : `${branchName}.crt`);
        await fs.copy(path.join(tmpDir, 'server.crt'), crtFile);
        await fs.remove(tmpDir);
        this.ux.log('[sfdx-hardis] Now you can configure the sfdx connected app');
        this.ux.log(`[sfdx-hardis] Follow instructions here: ${c.bold('https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_connected_app.htm')}`);
        this.ux.log(`[sfdx-hardis] Use ${c.green(crtFile)} as certificate on Connected App configuration page, ${c.bold(`then delete ${crtFile} for security`)}`);
        this.ux.log(`[sfdx-hardis] Then, configure CI variable ${c.green(`SFDX_CLIENT_ID_${((devHub) ? config.devHubAlias : branchName).toUpperCase()}`)} with value of ConsumerKey on Connected App configuration page`);
        // Return an object to be displayed with --json
        return { outputString: 'Configured branch for authentication' };
    }
}
