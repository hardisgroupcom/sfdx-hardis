/* jscpd:ignore-start */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import * as axios1 from 'axios';
import * as c from 'chalk';
import * as fs from 'fs-extra';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as prompts from 'prompts';
// import * as packages from '../../../../defaults/packages.json'
import { MetadataUtils } from '../../../common/metadata-utils';
import { isCI, uxLog } from '../../../common/utils';
import { getConfig, setConfig } from '../../../config';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

const axios = axios1.default;

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageVersionInstall extends SfdxCommand {

    public static title = 'Install packages in an org';

    public static description = messages.getMessage('packageInstall');

    public static examples = [
        '$ sfdx hardis:package:install'
    ];

    // public static args = [{name: 'file'}];

    protected static flagsConfig = {
        package: flags.boolean({ char: 'p', description: 'Package Version Id to install (04t...)' }),
        debug: flags.boolean({ char: 'd', default: false, description: messages.getMessage('debugMode') })
    };

    // Comment this out if your command does not require an org username
    protected static requiresUsername = true;

    // Comment this out if your command does not support a hub org username
    protected static supportsDevhubUsername = false;

    // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
    protected static requiresProject = false;

    /* jscpd:ignore-end */

    protected allPackagesFileName = path.join(__dirname, './../../../../defaults/packages.json');
    protected sfdxProjectJsonFileName = path.join(process.cwd(), 'sfdx-project.json');

    public async run(): Promise<AnyJson> {
        const packagesRaw = await fs.readFile(this.allPackagesFileName, 'utf8');
        const packages = JSON.parse(packagesRaw);
        const packageId = this.flags.package || null;
        const packagesToInstall = [];
        // If no package Id is sent, ask user what package he/she wants to install
        if (!isCI && (packageId == null || !packageId.startsWith('04t'))) {
            const allPackages = Object.keys(packages)
                .map(key => Object.assign(packages[key], { key }))
                .map(pack => ({ title: pack.name, value: pack }));
            const packageResponse = await prompts({
                type: 'select',
                name: 'value',
                message: c.cyanBright(`Please select the package you want to install on org  ${c.green(this.org.getUsername())}`),
                choices: allPackages,
                initial: 0
            });
            // Packages combination selected
            if (packageResponse.value.packages) {
                for (const pckgId of packageResponse.value.packages) {
                    packagesToInstall.push(packages[pckgId]);
                }
            } else {
                packagesToInstall.push(packageResponse.value);
            }
        } else {
            packagesToInstall.push({ SubscriberPackageVersionId: packageId });
        }
        // Complete packages with remote information
        const packagesToInstallCompleted = await Promise.all(packagesToInstall.map(async pckg => {
            if (pckg.SubscriberPackageVersionId == null) {
                const packageConfigRaw = await axios.get(pckg.configUrl);
                const packageConfig = yaml.load(packageConfigRaw.data);
                pckg.SubscriberPackageName = pckg.name;
                pckg.SubscriberPackageVersionId = packageConfig.latestPackageVersionId;
            }
            return pckg;
        }));
        // Install packages
        await MetadataUtils.installPackagesOnOrg(packagesToInstallCompleted, null, this);
        const installedPackages = await MetadataUtils.listInstalledPackages(null, this);
        uxLog(this, c.italic(c.grey('New package list on org:\n' + JSON.stringify(installedPackages, null, 2))));

        if (!isCI) {
            // Add package installation to project .sfdx-hardis.yml
            const config = await getConfig('project');
            const projectPackages = config.installedPackages || [];
            let updated = false;
            for (const installedPackage of installedPackages) {
                const matchInstalled = packagesToInstallCompleted.filter(pckg => pckg.key === installedPackage.SubscriberPackageName);
                const matchLocal = projectPackages.filter(projectPackage => installedPackage.SubscriberPackageName === projectPackage.SubscriberPackageName);
                if (matchInstalled.length > 0 && matchLocal.length === 0) {
                    projectPackages.push(installedPackage);
                    updated = true;
                }
            }
            if (updated) {
                uxLog(this, 'Updating project sfdx-hardis config to packages are installed everytime');
                await setConfig('project', { installedPackages: projectPackages });
            }
        }

        /* disabled until sfdx multiple package deployment is working >_<
        // Post install actions
        if (!isCI && fs.existsSync(this.sfdxProjectJsonFileName)) {

            const postInstallResponse = await prompts([
                {
                    type: 'confirm',
                    name: 'retrieve',
                    message: c.cyanBright('Do you want to retrieve installed package sources in your local branch ?'),
                    initial: true
                },
                {
                    type: 'confirm',
                    name: 'sfdxProject',
                    message: c.cyanBright('Do you want to update your sfdx-project.json ? (advice: yes)'),
                    initial: true
                }
            ]);
            // Retrieve package sources if requested
            if (postInstallResponse.retrieve === true) {
                for (const pckg of packagesToInstallCompleted) {
                    const retrieveCommand = 'sfdx force:source:retrieve' +
                    ` -n ${pckg.key}` +
                    // ` -p ./force-app/main/default` + // let's try without it
                    ' -w 60';
                    try {
                        await execCommand(retrieveCommand, this, { output: true, fail: true, debug: debugMode });
                    } catch (e) {
                        // Ugly workaround but it's a sfdx bug...
                        uxLog(this, c.yellow(`Error while retrieving ${c.bold(pckg.key)} but it may have worked anyway`));
                        if (fs.existsSync(path.join('.', pckg.key))) {
                            await fs.remove(path.join('.', pckg.key));
                        }
                    }
                }
            }
            // Update sfdx-project.json with new unlocked packages folder references, so it is taken in account with force:source:push and force:source:pull
            if (postInstallResponse.sfdxProject === true) {
                const sfdxProjectRaw = await fs.readFile(this.sfdxProjectJsonFileName, 'utf8');
                const sfdxProject = JSON.parse(sfdxProjectRaw);
                let updated = false;
                for (const installedPackage of installedPackages) {
                    const matchInstalled = packagesToInstallCompleted.filter(pckg => pckg.key === installedPackage.SubscriberPackageName);
                    const matchLocal = sfdxProject.packageDirectories.filter(packageDirectory => installedPackage.SubscriberPackageName === packageDirectory.path);
                    if (matchInstalled.length > 0 && matchLocal.length === 0) {
                        sfdxProject.packageDirectories.push({path: installedPackage.SubscriberPackageName});
                        updated = true;
                    }
                }
                if (updated) {
                    await fs.writeFile(this.sfdxProjectJsonFileName, JSON.stringify(sfdxProject, null, 2));
                    uxLog(this, c.cyan('[config] Updated sfdx-project.json to add new package folders'));
                }
            }
        }
        */

        // Return an object to be displayed with --json
        return { outputString: 'Installed package(s)' };
    }
}
