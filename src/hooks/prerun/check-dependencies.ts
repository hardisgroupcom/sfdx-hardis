import { checkSfdxPlugin, git, uxLog } from '../../common/utils';

export const hook = async (options: any) => {
    // Skip hooks from other commands than hardis commands
    const commandId = options?.Command?.id || '';
    if (!commandId.startsWith('hardis')) {
        return;
    }

    // Check Git config for diff/merge (asynchronously so the script is not stopped)
    git().listConfig().then(async(gitConfig) => {
        const allConfigs = gitConfig.all ;
        if (allConfigs["merge.tool"] == null) {
            await git({output:true}).addConfig("merge.tool","vscode");
            await git({output:true}).addConfig("mergetool.vscode.cmd","code --wait $MERGED");
            uxLog(this,'Defined vscode as git merge tool ');
        }
        if (allConfigs["diff.tool"] == null) {
            await git({output:true}).addConfig("diff.tool","vscode");
            await git({output:true}).addConfig("difftool.vscode.cmd","code --wait --diff $LOCAL $REMOTE");
            uxLog(this,'Defined vscode as git diff tool ');
        }
    });

    // Check required sfdx-plugins to be installed
    const requiresSfdxPlugins = options?.Command?.requiresSfdxPlugins || [];
    for (const sfdxPluginName of requiresSfdxPlugins) {
        await checkSfdxPlugin(sfdxPluginName);
    }
};
