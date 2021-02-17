import * as c from 'chalk';
import * as fs from 'fs-extra';

export const hook = async (options: any) => {
    // Skip hooks from other commands than hardis:scratch commands
    const commandId = options?.id || '';
    // No await there because it can be processed while other commands
    // tslint:disable no-floating-promises
    managePackageJson(commandId);
    manageGitIgnore(commandId);
    // tslint:enable no-floating-promises

};

// Add utility scripts if they are not present
async function managePackageJson(commandId: string) {
    if (!commandId.startsWith('hardis:scratch')) {
        return;
    }
    const packageJsonFile = './package.json';
    if (fs.existsSync(packageJsonFile)) {
        // Update existing package.json to define sfdx utility scripts
        fs.readFile(packageJsonFile, 'utf8').then(async (text: string) => {
            const packageJson = JSON.parse(text);
            const hardisPackageJsonContent = await getSfdxHardisPackageJsonContent();
            packageJson['scripts'] = Object.assign(hardisPackageJsonContent['scripts'], packageJson['scripts']);
            if (JSON.stringify(packageJson) !== JSON.stringify(JSON.parse(text))) {
                await fs.writeFile(packageJsonFile, JSON.stringify(packageJson, null, 2));
                console.log(c.cyan('[sfdx-hardis] Updated package.json with sfdx-hardis content'));
            }
        });
    } else {
        // Create package.json to define sfdx utility scripts
        const hardisPackageJsonContent = await getSfdxHardisPackageJsonContent();
        fs.writeFile(packageJsonFile, JSON.stringify(hardisPackageJsonContent, null, 2), () => {
            console.log(c.cyan('[sfdx-hardis] Created package.json with sfdx-hardis content'));
        });
    }
}

async function manageGitIgnore(commandId: string) {
    if (!commandId.startsWith('hardis:scratch')) {
        return;
    }
    const gitIgnoreFile = './.gitignore';
    if (fs.existsSync(gitIgnoreFile)) {
        const gitIgnore = await fs.readFile(gitIgnoreFile, 'utf-8');
        const gitIgnoreLines = gitIgnore.split('\n');
        let updated = false;
        for (const gitIgnoreMandatoryLine of await getHardisGitRepoIgnoreContent()) {
            if (!gitIgnoreLines.includes(gitIgnoreMandatoryLine)) {
                gitIgnoreLines.push(gitIgnoreMandatoryLine);
                updated = true;
            }
        }
        if (updated) {
            await fs.writeFile(gitIgnoreFile, gitIgnoreLines.join('\n') + '\n', 'utf-8');
            console.log(c.cyan('[sfdx-hardis] Updated .gitignore'));
        }

    }
}

async function getSfdxHardisPackageJsonContent() {
    const hardisPackageJsonContent = {
        scripts: {
            'scratch:create': 'sfdx hardis:scratch:create',
            'scratch:push': 'sfdx force:source:push -g -w 60 --forceoverwrite',
            'scratch:pull': 'sfdx force:source:pull --forceoverwrite',
            'scratch:open': 'sfdx force:org:open',
            'login:reset': 'sfdx auth:logout --noprompt || true && sfdx config:unset defaultusername defaultdevhubusername -g && sfdx config:unset defaultusername defaultdevhubusername || true'
        }
    };
    return hardisPackageJsonContent;
}

async function getHardisGitRepoIgnoreContent() {
    const gitIgnoreContent = [
        'config/user/',
        'hardis-report/',
        'tmp/'
    ];
    return gitIgnoreContent;
}
