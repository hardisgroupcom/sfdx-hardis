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
    `config/users/.${moduleName}.${username}.yaml`,
    `config/users/.${moduleName}.${username}.yml`
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
    const configExplorer = await cosmiconfig(moduleName, { searchPlaces }).search();
    const configFile = (configExplorer != null) ? configExplorer.filepath : searchPlaces.slice(-1)[0];
    let doc = {};
    if (fs.existsSync(configFile)) {
        doc = yaml.load(fs.readFileSync(configFile, 'utf8'));
    }
    doc = Object.assign(doc, propValues);
    await fs.ensureDir(path.dirname(configFile));
    await fs.writeFile(configFile, yaml.dump(doc));
}
