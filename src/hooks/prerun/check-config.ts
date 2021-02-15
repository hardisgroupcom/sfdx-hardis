import * as prompts from 'prompts';
import { getConfig, setConfig } from '../../config';

export const hook = async (options: any) => {
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