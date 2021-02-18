import { SfdxError } from '@salesforce/core';
import * as c from 'chalk';
import * as child from 'child_process';
import * as fs from 'fs-extra';
import * as sfdx from 'sfdx-node';
import * as util from 'util';
import { getCurrentGitBranch } from '../../common/utils';
import { checkConfig, getConfig } from '../../config';
const exec = util.promisify(child.exec);

export const hook = async (options: any) => {
    // Skip hooks from other commands than hardis commands
    const commandId = options?.Command?.id || '';
    if (!commandId.startsWith('hardis')) {
        return;
    }
    // skip if during mocha tests
    if (typeof global.it === 'function') {
        return;
    }
    let configInfo = await getConfig('user');
    // Manage authentication if DevHub is required but current user is disconnected
    if (
        (options.Command && options.Command.supportsDevhubUsername === true) || options.devHub === true
    ) {
        let devHubAlias = configInfo.devHubAlias || process.env.DEVHUB_ALIAS;
        if (devHubAlias == null) {
            await checkConfig(options);
            configInfo = await getConfig('user');
            devHubAlias = configInfo.devHubAlias;
        }
        await authOrg(devHubAlias, options);
    }
    // Manage authentication if org is required but current user is disconnected
    if (
        (options.Command && options.Command.requiresUsername === true) || options.checkAuth === true
    ) {
        const orgAlias =
            (process.env.ORG_ALIAS) ? process.env.ORG_ALIAS :
                (process.env.CI)
                    ? await getCurrentGitBranch({ formatted: true })
                    : commandId === 'hardis:auth:login'
                        ? configInfo.orgAlias: 
                        configInfo.scratchOrgAlias || 'MY_ORG'; // Can be null and it's ok if we're not in scratch org context
        await authOrg(orgAlias, options);
    }
};

// Authorize an org manually or with JWT
async function authOrg(orgAlias: string, options: any) {
    const isDevHub = orgAlias.includes('DevHub');
    let doConnect = true;
    if (!options.checkAuth) {
        // Check if we are already authenticated
        const orgDisplayParams: any = {};
        if (orgAlias !== 'MY_ORG') {
            orgDisplayParams.targetusername = orgAlias;
        }
        const orgInfoResult = await sfdx.org.display(orgDisplayParams);
        if (
            orgInfoResult &&
            ((orgInfoResult.connectedStatus &&
                orgInfoResult.connectedStatus.includes('Connected')) ||
                (orgInfoResult.alias === orgAlias && orgInfoResult.id != null) ||
                (isDevHub && orgInfoResult.id != null))
        ) {
            doConnect = false;
            console.log(
                `[sfdx-hardis] You are ${c.green('connected')} to org ${c.green(orgAlias)}: ${c.green(orgInfoResult.instanceUrl)}`
            );
        }
    }
    // Perform authentication
    if (doConnect) {
        let logged = false;
        const config = await getConfig('branch');
        // Get auth variables, with priority CLI arguments, environment variables, then .hardis-sfdx.yml config file
        let username =
            typeof options.Command.flags?.targetusername === 'string'
                ? options.Command.flags?.targetusername
                : process.env.TARGET_USERNAME ||
                    (isDevHub) ? config.devHubUsername : config.targetUsername;
        if (username == null && process.env.CI) {
            const gitBranchFormatted = await getCurrentGitBranch({ formatted: true });
            console.error(c.red(`[sfdx-hardis][ERROR] You may have to define ${c.bold(isDevHub ?
                'devHubUsername in .sfdx-hardis.yml' :
                `targetUsername in config/branches/.sfdx-hardis.${gitBranchFormatted}.yml`)} `));
            process.exit(1);
        }
        const instanceUrl =
            typeof options.Command?.flags?.instanceurl === 'string' &&
                options.Command?.flags?.instanceurl?.startsWith('https')
                ? options.Command.flags.instanceurl
                : process.env.INSTANCE_URL?.startsWith('https')
                    ? process.env.INSTANCE_URL
                    : config.instanceUrl
                        ? config.instanceUrl
                        : (options.argv && options.argv.includes('--sandbox')) ||
                            options.Command.flags.sandbox === true
                            ? 'https://test.salesforce.com'
                            : 'https://login.salesforce.com';
        // Get JWT items clientId and certificate key
        const sfdxClientId = await getSfdxClientId(orgAlias, config);
        const crtKeyfile = await getCertificateKeyFile(orgAlias);
        const usernameArg =
            isDevHub
                ? '--setdefaultdevhubusername'
                : '--setdefaultusername';
        if (crtKeyfile && sfdxClientId && username) {
            // Login with JWT
            const loginCommand =
                'sfdx auth:jwt:grant' +
                ` ${usernameArg}` +
                ` --clientid ${sfdxClientId}` +
                ` --jwtkeyfile ${crtKeyfile}` +
                ` --username ${username}` +
                ` --setalias ${orgAlias}` +
                ` --instanceurl ${instanceUrl}`;
            console.log(`[sfdx-hardis] Login command: ${loginCommand.replace(sfdxClientId, '***********')}`);
            const jwtAuthRes = await exec(loginCommand);
            logged = jwtAuthRes?.stdout.includes(
                `Successfully authorized ${username}`
            );
            if (!logged) {
                console.error(c.red(`[sfdx-hardis][ERROR] JWT login error: \n${JSON.stringify(jwtAuthRes)}`));
                process.exit(1);
            }
        } else if (!process.env.CI) {
            // Login with web auth
            const orgLabel = `org ${orgAlias}`;
            console.warn(
                c.bold(`[sfdx-hardis] You must be connected to ${orgLabel} to perform this command. Please login in the open web browser`)
            );
            if (process.env.CI === 'true') {
                throw new SfdxError(
                    `In CI context, you may define:
                - a .sfdx-hardis.yml file with instanceUrl and targetUsername properties (or INSTANCE_URL and TARGET_USERNAME repo variables)
                - a repository secret variable SFDX_CLIENT_ID with consumer key of sfdx connected app
                - store server.key file within ssh folder
                `
                );
            }
            const loginResult = await sfdx.auth.webLogin({
                setdefaultusername: true,
                setalias: orgAlias,
                setdefaultdevhubusername: isDevHub,
                instanceurl: instanceUrl,
                _quiet: !options.Command.flags.debug === true,
                _rejectOnError: true
            });
            logged = loginResult?.instanceUrl != null;
            username = loginResult?.username;
        } else {
            console.error(c.red(`[sfdx-hardis] Unable to connect to org ${orgAlias} using JWT. Please check your configuration`));
        }
        if (logged) {
            console.log(
                `[sfdx-hardis] Successfully logged to ${c.green(instanceUrl)} with username ${c.green(username)}`
            );
            // Display warning message in case of local usage (not CI), and not login command
            if (!(options?.Command?.id || '').startsWith('hardis:auth:login')) {
                console.warn(
                    c.yellow('*********************************************************************')
                );
                console.warn(
                    c.yellow('*** IF YOU SEE AN AUTH ERROR PLEASE RUN AGAIN THE SAME COMMAND :) ***')
                );
                console.warn(
                    c.yellow('*********************************************************************')
                );
            }
        } else {
            console.error(
                c.red('[sfdx-hardis][ERROR] You must be logged to an org to perform this action')
            );
            process.exit(1); // Exit because we should succeed to connect
        }
    }
}

// Get clientId for SFDX connected app
async function getSfdxClientId(orgAlias: string, config: any) {
    const sfdxClientIdVarName = `SFDX_CLIENT_ID_${orgAlias}`;
    if (process.env[sfdxClientIdVarName]) {
        return process.env[sfdxClientIdVarName];
    }
    const sfdxClientIdVarNameUpper = sfdxClientIdVarName.toUpperCase();
    if (process.env[sfdxClientIdVarNameUpper]) {
        return process.env[sfdxClientIdVarNameUpper];
    }
    if (process.env.SFDX_CLIENT_ID) {
        console.warn(
            c.yellow(`[sfdx-hardis] If you use CI on multiple branches & orgs, you should better define ${sfdxClientIdVarNameUpper} than SFDX_CLIENT_ID`)
        );
        return process.env.SFDX_CLIENT_ID;
    }
    if (process.env.CI) {
        console.error(
            c.red(`[sfdx-hardis] You must set env variable ${sfdxClientIdVarNameUpper} with the Consumer Key value defined on SFDX Connected app`)
        );
    }
    return null;
}

// Try to find certificate key file for sfdx connected app in different locations
async function getCertificateKeyFile(orgAlias: string) {
    const filesToTry = [
        `./config/branches/.jwt/${orgAlias}.key`,
        `./config/.jwt/${orgAlias}.key`,
        `./ssh/${orgAlias}.key`, // Legacy wrongly named but avoid to crash existing repos
        './ssh/server.key' // Legacy wrongly named but avoid to crash existing repos
    ];
    for (const file of filesToTry) {
        if (fs.existsSync(file)) {
            return file;
        }
    }
    if (process.env.CI) {
        console.error(
            c.red(`[sfdx-hardis] You must put a certificate key to connect via JWT.Possible locations:\n  -${filesToTry.join('\n  -')}`)
        );
    }
    return null;
}
