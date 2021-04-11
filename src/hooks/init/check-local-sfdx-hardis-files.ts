import * as c from 'chalk';
import * as fs from 'fs-extra';
import { isCI } from '../../common/utils';
import { prompts } from '../../common/utils/prompts';
import { getConfig } from '../../config';

export const hook = async (options: any) => {
    // Skip hooks from other commands than hardis:scratch commands
    const commandId = options?.id || '';

    await managePackageJson(commandId);
    await manageGitIgnore(commandId);
};

// Add utility scripts if they are not present
async function managePackageJson(commandId: string) {
    if (!commandId.startsWith('hardis:scratch') && !commandId.startsWith('hardis:project:configure') &&
        !commandId.startsWith('hardis:work') && !commandId.startsWith('hardis:package') &&
        !commandId.startsWith('hardis:data')) {
        return;
    }
    if (commandId.startsWith('hardis:work:task:new')) {
        return ;
    }
    const packageJsonFile = './package.json';
    if (fs.existsSync(packageJsonFile)) {
        // Update existing package.json to define sfdx utility scripts
        const text = await fs.readFile(packageJsonFile, 'utf8');
        const packageJson = JSON.parse(text);
        const hardisPackageJsonContent = await getSfdxHardisPackageJsonContent();
        packageJson['scripts'] = Object.assign(packageJson['scripts'], hardisPackageJsonContent['scripts']);
        if (JSON.stringify(packageJson) !== JSON.stringify(JSON.parse(text)) && !isCI) {
            const confirm = await prompts({
                type: 'confirm',
                name: 'value',
                initial: true,
                message: c.cyanBright('Your package.json is deprecated, do you agree to upgrade it ? (If you hesitate, just trust us and accept)')
            });
            if (confirm.value === true) {
                await fs.writeFile(packageJsonFile, JSON.stringify(packageJson, null, 2));
                console.log(c.cyan('[sfdx-hardis] Updated package.json with sfdx-hardis content'));
            }
        }

    } else {
        // Create package.json to define sfdx utility scripts
        const hardisPackageJsonContent = await getSfdxHardisPackageJsonContent();
        fs.writeFile(packageJsonFile, JSON.stringify(hardisPackageJsonContent, null, 2), () => {
            console.log(c.cyan('[sfdx-hardis] Created package.json with sfdx-hardis content'));
        });
    }
}

async function manageGitIgnore(commandId: string) {
    if (!commandId.startsWith('hardis')) {
        return;
    }
    if (commandId.startsWith('hardis:work:task:new')) {
        return ;
    }
    // Manage .gitignore
    const gitIgnoreFile = './.gitignore';
    if (fs.existsSync(gitIgnoreFile)) {
        const gitIgnore = await fs.readFile(gitIgnoreFile, 'utf-8');
        const gitIgnoreLines = gitIgnore.replace('\r\n','\n').split('\n').map(line => line.trim()).filter(line => line !== '');
        let updated = false;
        for (const gitIgnoreMandatoryLine of await getHardisGitRepoIgnoreContent()) {
            if (!gitIgnoreLines.includes(gitIgnoreMandatoryLine)) {
                gitIgnoreLines.push(gitIgnoreMandatoryLine);
                updated = true;
            }
        }
        // Remove duplicates
        const gitIgnoreLinesUnique = Array.from(new Set(gitIgnoreLines));
        // Propose user to apply updates
        if ((updated || gitIgnoreLines.length !== gitIgnoreLinesUnique.length) && !isCI) {
            const confirm = await prompts({
                type: 'confirm',
                name: 'value',
                initial: true,
                message: c.cyanBright('Your .gitignore is deprecated, do you agree to upgrade it ? (If you hesitate, just trust us and accept)')
            });
            if (confirm.value === true || isCI) {
                await fs.writeFile(gitIgnoreFile, gitIgnoreLinesUnique.join('\n') + '\n', 'utf-8');
                console.log(c.cyan('[sfdx-hardis] Updated .gitignore'));
            }
        }
    }

    // Manage .forceignore
    const forceIgnoreFile = './.forceignore';
    if (fs.existsSync(forceIgnoreFile)) {
        const forceIgnore = await fs.readFile(forceIgnoreFile, 'utf-8');
        const forceIgnoreLines = forceIgnore.replace("\r\n","\n").split('\n').map(line => line.trim()).filter(line => line !== '');
        let updated = false;
        for (const forceIgnoreMandatoryLine of await getHardisForceIgnoreContent()) {
            if (!forceIgnoreLines.includes(forceIgnoreMandatoryLine)) {
                forceIgnoreLines.push(forceIgnoreMandatoryLine);
                updated = true;
            }
        }
        // Remove duplicates
        const forceIgnoreLinesUnique = Array.from(new Set(forceIgnoreLines));
        // Propose user to apply updates
        if ((updated || forceIgnoreLines.length !== forceIgnoreLinesUnique.length) && !isCI) {
            const confirm = await prompts({
                type: 'confirm',
                name: 'value',
                initial: true,
                message: c.cyanBright('Your .forceignore is deprecated, do you agree to upgrade it ? (If you hesitate, just trust us and accept)')
            });
            if (confirm.value === true || isCI) {
                await fs.writeFile(forceIgnoreFile, forceIgnoreLinesUnique.join('\n') + '\n', 'utf-8');
                console.log(c.cyan('[sfdx-hardis] Updated .forceignore'));
            }
        }
    }
}

async function getSfdxHardisPackageJsonContent() {
    const hardisPackageJsonContent = {
        scripts: {
            'scratch:push-from-git-to-org': 'sfdx force:source:push -g -w 60 --forceoverwrite',
            'scratch:pull-from-org-to-git': 'sfdx force:source:pull -w 60 --forceoverwrite',
            'work:new': 'sfdx hardis:work:new',
            'work:refresh': 'sfdx hardis:work:refresh',
            'work:resetselection': 'sfdx hardis:work:resetselection',
            'work:save': 'sfdx hardis:work:save',
            'org:open': 'sfdx force:org:open',
            'org:test:apex': 'sfdx hardis:org:test:apex',
            'org:select': 'sfdx hardis:org:select',
            'scratch:create': 'sfdx hardis:scratch:create',
            'login:reset': 'sfdx auth:logout --noprompt || true && sfdx config:unset defaultusername defaultdevhubusername -g && sfdx config:unset defaultusername defaultdevhubusername || true',
            'configure:auth:deployment': 'sfdx hardis:project:configure:auth',
            'configure:auth:devhub': 'sfdx hardis:project:configure:auth --devhub',
            'package:install': 'sfdx hardis:package:install',
            'data:tree:export': 'sfdx hardis:data:tree:export'
          }
    };
    // Manage special commands for packaging projects
    const config = await getConfig('project');
    if (config.activatePackaging) {
        const packagingCommands = await getSfdxHardisPackageJsonContentForPackaging();
        hardisPackageJsonContent.scripts = Object.assign(hardisPackageJsonContent.scripts, packagingCommands.scripts);
    }
    return hardisPackageJsonContent;
}

async function getSfdxHardisPackageJsonContentForPackaging() {
    const hardisPackageJsonContent = {
        scripts: {
            'package:version:create': 'sfdx hardis:package:version:create',
            'package:version:list': 'sfdx hardis:package:version:list',
            'package:create': 'sfdx hardis:package:create'
          }
    };
    return hardisPackageJsonContent;
}

async function getHardisGitRepoIgnoreContent() {
    const gitIgnoreContent = [
        '.cache/',
        'config/user/',
        'hardis-report/',
        'tmp/',
        "**/__tests__/**",
        // Metadatas to be ignored
        '**/siteDotComSites/*.site',
        // SFDX Items to be ignored
        "**/data/**/source/**",
        "**/data/**/target/**",
        'force-app/main/default/appMenus/AppSwitcher.appMenu-meta.xml'
    ];
    return gitIgnoreContent;
}


async function getHardisForceIgnoreContent() {
    const forceIgnoreContent = [
        "**/appMenu/**",
        "**/appSwitcher/**",
        //"**/objectTranslations/**",
        // "**/profiles/**", 
        // "**/settings/**",
        
        "**/jsconfig.json",
        "**/.eslintrc.json",
        
        "**/__tests__/**",
        "**/pubsub/**",
        "**SfdxHardisDeferSharingRecalc**"
    ];
    return forceIgnoreContent;
}
