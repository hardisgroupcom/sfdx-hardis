/* jscpd:ignore-start */
import { Hook } from '@oclif/core';

const hook: Hook<'prerun'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || '';
  if (!commandId.startsWith('hardis')) {
    return;
  }
  if (
    commandId.startsWith('hardis:doc') ||
    commandId.startsWith('hardis:org:files') ||
    commandId.startsWith('hardis:org:data')
  ) {
    return;
  }

  // Dynamic imports to improve perfs
  const os = await import('os');
  const { checkSfdxPlugin, git, uxLog, isCI, checkAppDependency, isGitRepo } = await import('../../common/utils/index.js');
  const { getConfig } = await import('../../config/index.js');

  /* jscpd:ignore-end */
  // Check Git config and complete it if necessary (asynchronously so the script is not stopped)
  if (!isCI && isGitRepo()) {
    git()
      .listConfig()
      .then(async (gitConfig) => {
        const allConfigs = gitConfig.all;
        // User
        if (allConfigs['user.name'] == null) {
          const username = os.userInfo().username;
          await git({ output: true }).addConfig('user.name', username);
          uxLog("log", this, `Defined ${username} as git user.name.`);
        }
        // Email
        if (allConfigs['user.email'] == null) {
          const config = await getConfig('user');
          const email = config.userEmail || 'default@cloudity.com';
          await git({ output: true }).addConfig('user.email', email);
          uxLog("log", this, `Defined ${email} as git user.email` + (email === 'default@cloudity.com') ? ' (temporary)' : '');
        }
        // Manage special characters in git file / folder names
        if (allConfigs['core.quotepath'] == null || allConfigs['core.quotepath'] == 'true') {
          await git({ output: true }).addConfig('core.quotepath', 'false');
          uxLog("log", this, `Defined "false" as git core.quotepath.`);
        }
        // Merge tool
        if (allConfigs['merge.tool'] == null) {
          await git({ output: true }).addConfig('merge.tool', 'vscode');
          await git({ output: true }).addConfig('mergetool.vscode.cmd', 'code --wait $MERGED');
          uxLog("log", this, 'Defined VS Code as git merge tool.');
        }
        // Diff tool
        if (allConfigs['diff.tool'] == null) {
          await git({ output: true }).addConfig('diff.tool', 'vscode');
          await git({ output: true }).addConfig('difftool.vscode.cmd', 'code --wait --diff $LOCAL $REMOTE');
          uxLog("log", this, 'Defined VS Code as git diff tool.');
        }
      });
  }

  // Check required sfdx-plugins to be installed
  const requiresSfdxPlugins = (options?.Command as any)?.requiresSfdxPlugins || [];
  for (const sfdxPluginName of requiresSfdxPlugins) {
    await checkSfdxPlugin(sfdxPluginName);
  }

  // Check required dependencies installed
  const requiresDependencies = (options?.Command as any).requiresDependencies || [];
  requiresDependencies.push('git');
  for (const appName of requiresDependencies) {
    await checkAppDependency(appName);
  }

  // Check if gitignore and forceignore are right

  if (!options.argv.includes('--json')) {
    await manageGitIgnoreForceIgnore(commandId);
  }
};

async function manageGitIgnoreForceIgnore(commandId: string) {
  // Dynamic imports to improve performances when other CLI commands are called
  const { isCI, isMonitoringJob, uxLog } = await import('../../common/utils/index.js');
  // Run this command only during a monitoring job, or a Release Manager local operation
  const isMon = await isMonitoringJob();
  if (
    !((isMon && commandId.includes('backup')) || commandId.startsWith("hardis:project:configure:auth") || commandId.startsWith("hardis:doc:mkdocs-to-salesforce") || commandId.startsWith("hardis:doc:project2markdown"))
  ) {
    return;
  }
  // Dynamic imports to improve performances when other CLI commands are called
  const c = (await import('chalk')).default;
  const fs = (await import('fs-extra')).default;
  const { getConfig, setConfig } = await import('../../config/index.js');
  const { prompts } = await import('../../common/utils/prompts.js');

  const config = await getConfig('user');
  // Manage .gitignore
  if (!config.skipUpdateGitIgnore === true) {
    const gitIgnoreFile = './.gitignore';
    if (fs.existsSync(gitIgnoreFile)) {
      const gitIgnore = await fs.readFile(gitIgnoreFile, 'utf-8');
      const gitIgnoreLines = gitIgnore
        .replace('\r\n', '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
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
          type: 'select',
          name: 'value',
          initial: true,
          message: c.cyanBright('Your .gitignore is deprecated, do you agree to upgrade it ?'),
          description: 'Updates your .gitignore file with latest sfdx-hardis best practices and removes duplicate entries',
          choices: [
            { title: 'Yes', value: 'true' },
            { title: 'No  ', value: 'false' },
            { title: 'Never ask again  ', value: 'never' },
          ],
        });
        if (confirm.value === 'true' || isCI) {
          await fs.writeFile(gitIgnoreFile, gitIgnoreLinesUnique.join('\n') + '\n', 'utf-8');
          uxLog("action", this, c.cyan('[sfdx-hardis] Updated .gitignore.'));
        }
        if (confirm.value === 'never') {
          await setConfig('project', { skipUpdateGitIgnore: true });
        }
      }
    }
  }

  // Manage .forceignore
  if (!config.skipUpdateForceIgnore === true) {
    const forceIgnoreFile = './.forceignore';
    if (fs.existsSync(forceIgnoreFile)) {
      const forceIgnore = await fs.readFile(forceIgnoreFile, 'utf-8');
      const forceIgnoreLines = forceIgnore
        .replace('\r\n', '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
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
      /* jscpd:ignore-start */
      if ((updated || forceIgnoreLines.length !== forceIgnoreLinesUnique.length) && !isCI) {
        const confirm = await prompts({
          type: 'select',
          name: 'value',
          initial: true,
          message: c.cyanBright('Your .forceignore is deprecated, do you agree to upgrade it ?'),
          description: 'Updates your .forceignore file with latest sfdx-hardis best practices and removes duplicate entries',
          choices: [
            { title: 'Yes', value: 'true' },
            { title: 'No  ', value: 'false' },
            { title: 'Never ask again  ', value: 'never' },
          ],
        });
        /* jscpd:ignore-end */
        if (confirm.value === 'true' || isCI) {
          await fs.writeFile(forceIgnoreFile, forceIgnoreLinesUnique.join('\n') + '\n', 'utf-8');
          uxLog("action", this, c.cyan('[sfdx-hardis] Updated .forceignore.'));
        }
        if (confirm.value === 'never') {
          await setConfig('project', { skipUpdateForceIgnore: true });
        }
      }
    }
  }
}

async function getHardisGitRepoIgnoreContent() {
  const gitIgnoreContent = [
    '.cache/',
    'config/user/',
    'hardis-report/',
    'site/',
    'tmp/',
    '**/__tests__/**',
    // Metadatas to be ignored
    '**/cleanDataServices/',
    '**/siteDotComSites/*.site',
    // SFDX Items to be ignored
    '**/data/**/source/**',
    '**/data/**/target/**',
    'force-app/main/default/appMenus/AppSwitcher.appMenu-meta.xml',
  ];
  return gitIgnoreContent;
}

async function getHardisForceIgnoreContent() {
  const forceIgnoreContent = [
    '**/appMenu/**',
    '**/appSwitcher/**',
    '**/appMenus/AppSwitcher.appMenu-meta.xml',

    '**/connectedApps/**',
    '**/certs/**',
    '**/profilePasswordPolicies/**',

    //"**/objectTranslations/**",
    // "**/profiles/**",
    // "**/settings/**",

    '**/jsconfig.json',
    '**/.eslintrc.json',

    '**/__tests__/**',
    '**SfdxHardisDeferSharingRecalc**',
  ];
  return forceIgnoreContent;
}

export default hook;
