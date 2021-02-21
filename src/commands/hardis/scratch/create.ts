/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as c from 'chalk';
import * as EmailValidator from 'email-validator';
import * as fs from 'fs-extra';
import * as glob from 'glob-promise';
import * as moment from 'moment';
import * as os from 'os';
import * as path from 'path';
import * as prompts from 'prompts';
import { MetadataUtils } from '../../../common/metadata-utils';
import { execCommand, execSfdxJson, getCurrentGitBranch } from '../../../common/utils';
import { getConfig, setConfig } from '../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class ScratchCreate extends SfdxCommand {
    public static title = 'Create and initialize scratch org';

    public static description = messages.getMessage('scratchCreate');

    public static examples = ['$ sfdx hardis:scratch:create'];

    // public static args = [{name: 'file'}];

    protected static flagsConfig = {
        // flag with a value (-n, --name=VALUE)
        debug: flags.boolean({
            char: 'd',
            default: false,
            description: messages.getMessage('debugMode')
        })
    };

    // Comment this out if your command does not require an org username
    protected static requiresUsername = false;

    // Comment this out if your command does not support a hub org username
    protected static supportsDevhubUsername = true;

    // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
    protected static requiresProject = true;

    /* jscpd:ignore-end */

    protected debugMode = false;
    protected configInfo: any;
    protected devHubAlias: string;
    protected scratchOrgAlias: string;
    protected scratchOrgDuration: number;
    protected userEmail: string;

    protected gitBranch: string;
    protected scratchOrgInfo: any;
    protected scratchOrgUsername: string;
    protected projectName: string;

    public async run(): Promise<AnyJson> {
        this.debugMode = this.flags.debug || false;

        await this.initConfig();
        await this.createScratchOrg();
        await this.installPackages();
        await this.initOrgMetadatas();
        await this.initPermissionSetAssignments();
        await this.initApexScripts();
        await this.initOrgData();

        // Return an object to be displayed with --json
        return {
            outputString: 'Created and initialized scratch org'
        };
    }

    // Initialize configuration from .sfdx-hardis.yml + .gitbranch.sfdx-hardis.yml + .username.sfdx-hardis.yml
    public async initConfig() {
        this.configInfo = await getConfig('user');
        this.gitBranch = await getCurrentGitBranch({ formatted: true });
        this.scratchOrgAlias = process.env.SCRATCH_ORG_ALIAS || this.configInfo.scratchOrgAlias ||
            os.userInfo().username + '-' + this.gitBranch.replace('/', '-') + moment().format('YYYY-MM-DD_hh-mm');
        if (process.env.CI && !this.scratchOrgAlias.startsWith('CI-')) {
            this.scratchOrgAlias = 'CI-' + this.scratchOrgAlias;
        }
        this.projectName = process.env.PROJECT_NAME || this.configInfo.projectName;
        this.devHubAlias = process.env.DEVHUB_ALIAS || this.configInfo.devHubAlias;

        this.scratchOrgDuration = process.env.SCRATCH_ORG_DURATION || (process.env.CI) ? 1 : 30;
        this.userEmail = process.env.USER_EMAIL || process.env.GITLAB_USER_EMAIL || this.configInfo.userEmail;

        // If not found, prompt user email and store it in user config file
        if (this.userEmail == null) {
            const promptResponse = await prompts({
                type: 'text',
                name: 'value',
                message: '[sfdx-hardis] Please input your email address',
                validate: (value: string) => EmailValidator.validate(value)
            });
            this.userEmail = promptResponse.value;
            await setConfig('user', {
                userEmail: this.userEmail
            });
        }
    }

    // Create a new scratch org or reuse existing one
    public async createScratchOrg() {
        const orgListResult = await execSfdxJson('sfdx force:org:list', this);
        const matchingScratchOrgs = (orgListResult?.result?.scratchOrgs.filter((org: any) => org.alias === this.scratchOrgAlias)) || [];
        // Reuse existing scratch org
        if (matchingScratchOrgs?.length > 0) {
            this.scratchOrgInfo = matchingScratchOrgs[0];
            this.scratchOrgUsername = this.scratchOrgInfo.username;
            this.ux.log(`[sfdx-hardis] Reusing org ${c.green(this.scratchOrgAlias)} with user ${c.green(this.scratchOrgUsername)}`);
            return;
        }

        // Build project-scratch-def-branch-user.json
        this.ux.log('[sfdx-hardis] Building custom project-scratch-def.json...');
        const projectScratchDef = JSON.parse(fs.readFileSync('./config/project-scratch-def.json'));
        projectScratchDef.orgName = this.scratchOrgAlias;
        projectScratchDef.adminEmail = this.userEmail;
        projectScratchDef.username = `${this.userEmail.split('@')[0]}@hardis-scratch-${this.scratchOrgAlias}.com`;
        const projectScratchDefLocal = `./config/user/project-scratch-def-${this.scratchOrgAlias}.json`;
        await fs.ensureDir(path.dirname(projectScratchDefLocal));
        await fs.writeFile(projectScratchDefLocal, JSON.stringify(projectScratchDef, null, 2));

        // Create new scratch org
        this.ux.log('[sfdx-hardis] Creating new scratch org...');
        const createCommand = 'sfdx force:org:create --setdefaultusername ' +
            `--definitionfile ${projectScratchDefLocal} ` +
            `--setalias ${this.scratchOrgAlias} ` +
            `--targetdevhubusername ${this.devHubAlias} ` +
            `-d ${this.scratchOrgDuration}`;
        const createResult = await execSfdxJson(createCommand, this, { fail: true, output: true, debug: this.debugMode });
        this.scratchOrgInfo = createResult.result;
        this.scratchOrgUsername = this.scratchOrgInfo.username;
        await setConfig('user', {
            scratchOrgAlias: this.scratchOrgAlias,
            scratchOrgUsername: this.scratchOrgUsername
        });

        if (process.env.CI) {
            // Try to store sfdxAuthUrl for scratch org reuse during CI
            const displayOrgCommand = `sfdx force:org:display -u ${this.scratchOrgAlias} --verbose`;
            const displayResult = await execSfdxJson(displayOrgCommand, this, { fail: true, output: false, debug: this.debugMode });
            if (displayResult.sfdxAuthUrl) {
                await setConfig('user', {
                    scratchOrgAuthUrl: displayResult.sfdxAuthUrl
                });
            }
        } else {
            // Open scratch org for user if not in CI
            await execSfdxJson('sfdx force:org:open', this, {fail: true, output: false, debug: this.debugMode});
        }
        this.ux.log(`[sfdx-hardis] Created scratch org ${c.green(this.scratchOrgAlias)} with user ${c.green(this.scratchOrgUsername)}`);
    }

    // Install packages
    public async installPackages() {
        const packages = this.configInfo.installedPackages || [];
        await MetadataUtils.installPackagesOnOrg(packages, this.scratchOrgAlias, this);
    }

    // Push or deploy metadatas to the scratch org
    public async initOrgMetadatas() {
        if (process.env.CI) {
            // if CI, use force:source:deploy to make sure package.xml is consistent
            this.ux.log(`[sfdx-hardis] Deploying project sources to scratch org ${c.green(this.scratchOrgAlias)}...`);
            const deployCommand = `sfdx force:source:deploy -x ./config/package.xml -u ${this.scratchOrgAlias}`;
            await execCommand(deployCommand, this, { fail: true, output: true, debug: this.debugMode });
        } else {
            // Use push for local scratch orgs
            this.ux.log(`[sfdx-hardis] Pushing project sources to scratch org ${c.green(this.scratchOrgAlias)}... (You can see progress in Setup -> Deployment Status)`);
            const pushCommand = `sfdx force:source:push -g -w 60 --forceoverwrite -u ${this.scratchOrgAlias}`;
            await execCommand(pushCommand, this, { fail: true, output: true, debug: this.debugMode });
        }
    }

    // Assign permission sets to user
    public async initPermissionSetAssignments() {
        this.ux.log('[sfdx-hardis] Assigning Permission Sets...');
        const permSets = this.configInfo.assignPermissionSets || [];
        for (const permSetName of permSets) {
            const assignCommand = `sfdx force:user:permset:assign -n ${permSetName} -u ${this.scratchOrgUsername}`;
            await execCommand(assignCommand, this, { fail: true, output: true, debug: this.debugMode });
        }
    }

    // Run initialization apex scripts
    public async initApexScripts() {
        this.ux.log('[sfdx-hardis] Running apex initialization scripts...');
        const allApexScripts = await glob('**/scripts/**/*.apex');
        const scratchOrgInitApexScripts = this.configInfo.scratchOrgInitApexScripts || [];
        // Build ordered list of apex scripts
        const initApexScripts = scratchOrgInitApexScripts.map((scriptName: string) => {
            const matchingScripts = allApexScripts.filter((apexScript: string) => path.basename(apexScript) === scriptName);
            if (matchingScripts.length === 0) {
                throw new SfdxError(c.red(`[sfdx-hardis][ERROR] Unable to find script ${scriptName}.apex`));
            }
            return matchingScripts[0];
        });
        // Process apex scripts
        for (const apexScript of initApexScripts) {
            const apexScriptCommand = `sfdx force:apex:execute -f "${apexScript}" -u ${this.scratchOrgAlias}`;
            await execCommand(apexScriptCommand, this, { fail: true, output: true, debug: this.debugMode });
        }
    }

    // Loads data in the org
    public async initOrgData() {
        this.ux.log('[sfdx-hardis] Loading org initialization data...');
        const allDataFiles = await glob('**/data/**/*-plan.json');
        const scratchOrgInitData = this.configInfo.scratchOrgInitData || [];
        // Build ordered list of data files
        const initDataFiles = scratchOrgInitData.map((name: string) => {
            const matchingDataFiles = allDataFiles.filter((dataFile: string) =>
                path.basename(dataFile).replace('-plan.json', '') === name);
            if (matchingDataFiles.length === 0) {
                throw new SfdxError(c.red(`[sfdx-hardis][ERROR] Unable to find data file ${name}-plan.json`));
            }
            return matchingDataFiles[0];
        });
        // Import data files
        for (const dataFile of initDataFiles) {
            const dataLoadCommand = `sfdx force:data:tree:import -f "${dataFile}" -u ${this.scratchOrgAlias}`;
            await execSfdxJson(dataLoadCommand, this, { fail: true, output: true, debug: this.debugMode });
        }
    }

}
