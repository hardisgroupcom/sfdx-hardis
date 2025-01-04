import c from 'chalk';
import fs from 'fs-extra';
import { isCI, isMonitoringJob, uxLog } from '../../common/utils/index.js';
import { prompts } from '../../common/utils/prompts.js';
import { getConfig, setConfig } from '../../config/index.js';
import { Hook } from '@oclif/core';

const hook: Hook<'init'> = async (options) => {
  // Skip hooks from other commands than hardis:scratch commands
  const commandId = options?.id || '';

  if (!options.argv.includes('--json')) {
    await manageGitIgnoreForceIgnore(commandId);
  }
};

async function manageGitIgnoreForceIgnore(commandId: string) {
  if (!commandId.startsWith('hardis')) {
    return;
  }
  // Run this command only during a monitoring job, or a Release Manager local operation
  const isMon = await isMonitoringJob();
  if (
    !((isMon && commandId.includes('backup')) || commandId.startsWith("hardis:project:configure:auth") || commandId.startsWith("hardis:doc:mkdocs-to-salesforce") || commandId.startsWith("hardis:doc:project2markdown"))
  ) {
    return;
  }
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
          message: c.cyanBright(
            'Your .gitignore is deprecated, do you agree to upgrade it ? (If you hesitate, just trust us and accept)'
          ),
          choices: [
            { title: 'Yes', value: 'true' },
            { title: 'No  ', value: 'false' },
            { title: 'Never ask again  ', value: 'never' },
          ],
        });
        if (confirm.value === 'true' || isCI) {
          await fs.writeFile(gitIgnoreFile, gitIgnoreLinesUnique.join('\n') + '\n', 'utf-8');
          uxLog(this, c.cyan('[sfdx-hardis] Updated .gitignore'));
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
          choices: [
            { title: 'Yes', value: 'true' },
            { title: 'No  ', value: 'false' },
            { title: 'Never ask again  ', value: 'never' },
          ],
        });
        /* jscpd:ignore-end */
        if (confirm.value === 'true' || isCI) {
          await fs.writeFile(forceIgnoreFile, forceIgnoreLinesUnique.join('\n') + '\n', 'utf-8');
          uxLog(this, c.cyan('[sfdx-hardis] Updated .forceignore'));
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
