import { checkSfdxPlugin } from '../../common/utils';

export const hook = async (options: any) => {
    // Skip hooks from other commands than hardis commands
    const commandId = options?.Command?.id || '';
    if (!commandId.startsWith('hardis')) {
        return;
    }

    // Check required sfdx-plugins to be installed
    const requiresSfdxPlugins = options?.Command?.requiresSfdxPlugins || [];
    for (const sfdxPluginName of requiresSfdxPlugins) {
        await checkSfdxPlugin(sfdxPluginName);
    }
};
