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
          uxLog(this, `Defined ${username} as git user.name`);
        }
        // Email
        if (allConfigs['user.email'] == null) {
          const config = await getConfig('user');
          const email = config.userEmail || 'default@cloudity.com';
          await git({ output: true }).addConfig('user.email', email);
          uxLog(this, `Defined ${email} as git user.email` + (email === 'default@cloudity.com') ? ' (temporary)' : '');
        }
        // Manage special characters in git file / folder names
        if (allConfigs['core.quotepath'] == null || allConfigs['core.quotepath'] == 'true') {
          await git({ output: true }).addConfig('core.quotepath', 'false');
          uxLog(this, `Defined "false" as git core.quotepath`);
        }
        // Merge tool
        if (allConfigs['merge.tool'] == null) {
          await git({ output: true }).addConfig('merge.tool', 'vscode');
          await git({ output: true }).addConfig('mergetool.vscode.cmd', 'code --wait $MERGED');
          uxLog(this, 'Defined vscode as git merge tool ');
        }
        // Diff tool
        if (allConfigs['diff.tool'] == null) {
          await git({ output: true }).addConfig('diff.tool', 'vscode');
          await git({ output: true }).addConfig('difftool.vscode.cmd', 'code --wait --diff $LOCAL $REMOTE');
          uxLog(this, 'Defined vscode as git diff tool ');
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
};

export default hook;
