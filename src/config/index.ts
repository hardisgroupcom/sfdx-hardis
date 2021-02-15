/*
sfdx-hardis is managed in 3 layers, wit hthe following priority
- project, stored in /config
- branches, stored in /config/branches
- user, stored in /config/users

getConfig(layer) returns:
- project + branches + user if layer is user
- project + branches if layer is branch
- project if layer is project
*/

import { cosmiconfig } from 'cosmiconfig';
import * as fs from 'fs-extra';
import * as path from "path";
import * as yaml from 'js-yaml';
import * as os from 'os';
import * as prompts from 'prompts';
import { getCurrentGitBranch, isGit } from '../common/utils';

const moduleName = 'sfdx-hardis';
const projectConfigFiles = [
    'package.json',
    `.${moduleName}.yaml`,
    `.${moduleName}.yml`,
    `config/.${moduleName}.yaml`,
    `config/.${moduleName}.yml`
];
const username = os.userInfo().username;
const userConfigFiles = [
    `config/user/.${moduleName}.${username}.yaml`,
    `config/user/.${moduleName}.${username}.yml`
];

async function getBranchConfigFiles() {
    if (!isGit) {
        return [];
    }
    const gitBranchFormatted = getCurrentGitBranch({formatted:true});
    const branchConfigFiles = [
        `config/branches/.${moduleName}.${gitBranchFormatted}.yaml`,
        `config/branches/.${moduleName}.${gitBranchFormatted}.yml`
    ];
    return branchConfigFiles;
}

export const getConfig = async (layer: string = 'user'): Promise<any> => {
    const defaultConfig = await loadFromConfigFile(projectConfigFiles);
    if (layer === 'project') {
        return defaultConfig;
    }
    let branchConfig = await loadFromConfigFile(await getBranchConfigFiles());
    branchConfig = Object.assign(defaultConfig, branchConfig);
    if (layer === "branch") {
        return branchConfig;
    }
    let userConfig = await loadFromConfigFile(userConfigFiles);
    userConfig = Object.assign(defaultConfig, userConfig);
    return userConfig;
};

// Set data in configuration file
export const setConfig = async (layer: string, propValues: any): Promise<void> => {
    const configSearchPlaces = (layer === 'project') ? projectConfigFiles :
    (layer === 'user') ? userConfigFiles :
    (layer === 'branch') ? await getBranchConfigFiles() : [];
    await setInConfigFile(configSearchPlaces, propValues);
};

export const CONSTANTS = {
    API_VERSION: process.env.SFDX_API_VERSION || '51.0'
};

// Load configuration from file
async function loadFromConfigFile(searchPlaces: string[]): Promise<any> {
    const configExplorer = await cosmiconfig(moduleName, { searchPlaces }).search();
    const config = (configExplorer != null) ? configExplorer.config : {};
    return config ;
}

// Update configuration file
async function setInConfigFile(searchPlaces: string[], propValues: any) {
    const explorer = cosmiconfig(moduleName, { searchPlaces });
    const configExplorer = await explorer.search();
    const configFile = (configExplorer != null) ? configExplorer.filepath : searchPlaces.slice(-1)[0];
    let doc = {};
    if (fs.existsSync(configFile)) {
        doc = yaml.load(fs.readFileSync(configFile, 'utf-8'));
    }
    doc = Object.assign(doc, propValues);
    await fs.ensureDir(path.dirname(configFile));
    await fs.writeFile(configFile, yaml.dump(doc));
    explorer.clearCaches()
}

// Check configuration of project so it works with sfdx-hardis
export  const checkConfig = async (options: any) => {
    // Skip hooks from other commands than hardis:scratch commands
    const commandId = options?.id || '';
    if (!commandId.startsWith('hardis')) {
        return;
    }

    let devHubAliasOk = false;
    // Check projectName is set. If not, request user to input it
    if (
        options.Command &&
        (options.Command.requiresProject === true || options.Command.supportsDevhubUsername === true)
    ) {
        const configProject = await getConfig("project");
        let projectName = process.env.PROJECT_NAME || configProject.projectName;
        devHubAliasOk = (process.env.DEVHUB_ALIAS || configProject.devHubAlias) != null;
        // If not found, prompt user project name and store it in user config file
        if (projectName == null) {
            const promptResponse = await prompts({
                type: 'text',
                name: 'value',
                message: '[sfdx-hardis] Please input your project name without spaces or special characters (ex: MonClient)',
                validate: (value: string) => !value.match(/^[0-9a-z]+$/) // check only alphanumeric
            });
            projectName = promptResponse.value;
            await setConfig('project', {
                projectName: projectName,
                devHubAlias: `DevHub-${projectName}`
            });
            devHubAliasOk = true;
        }
    }

    // Set DevHub username if not set
    if (devHubAliasOk === false && options.Command && options.Command.supportsDevhubUsername === true) {
        const configProject = await getConfig("project")
        const devHubAlias = process.env.DEVHUB_ALIAS || configProject.devHubAlias;
        if (devHubAlias == null) {
            await setConfig('project', {
                devHubAlias: `DevHub-${configProject.projectName}`
            });            
        }
    }
}