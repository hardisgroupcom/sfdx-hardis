import * as child from 'child_process';
import { cosmiconfig } from 'cosmiconfig';
import * as fs from 'fs-extra';
import * as yaml from 'js-yaml';
import * as os from 'os';
import simpleGit, {SimpleGit} from 'simple-git';
let git: SimpleGit = null ;
const isGit = child.exec('git rev-parse --is-inside-work-tree 2>/dev/null', {encoding: 'utf8'});
if (isGit) {
    git = simpleGit();
}

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
    `config/.${moduleName}.${username}.yaml`,
    `config/.${moduleName}.${username}.yml`
];

async function getBranchConfigFiles() {
    if (!isGit) {
        return [];
    }
    const gitBranch = (await git.branchLocal()).current;
    const gitBranchFormatted = gitBranch.replace('/', '-');
    const branchConfigFiles = [
        `config/.${moduleName}.${gitBranchFormatted}.yaml`,
        `config/.${moduleName}.${gitBranchFormatted}.yml`
    ];
    return branchConfigFiles;
}

export const getConfig = async (layer: string = 'project'): Promise<any> => {
    const defaultConfig = await loadFromConfigFile(projectConfigFiles);
    if (layer === 'project') {
        return defaultConfig;
    }
    let userConfig = await loadFromConfigFile(userConfigFiles);
    userConfig = Object.assign(defaultConfig, userConfig);
    if (layer === 'user') {
        return userConfig;
    }
    let branchConfig = await loadFromConfigFile(await getBranchConfigFiles());
    branchConfig = Object.assign(defaultConfig, branchConfig);
    return branchConfig;
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
    await fs.writeFile(configFile, yaml.dump(doc));
}
