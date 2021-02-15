import { SfdxError } from '@salesforce/core';
import * as child from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sfdx from 'sfdx-node';
import * as util from 'util';
import { getConfig } from '../../config';
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
    const configInfo = await getConfig('branch');
    // Manage authentication if DevHub is required but current user is disconnected
    if (options.Command && options.Command.supportsDevhubUsername === true) {
        const devHubAlias = configInfo.devHubAlias || 'DevHub-' + path.basename(process.cwd());
        await authOrg(devHubAlias, options);
    }
    // Manage authentication if org is required but current user is disconnected
    if (options.Command && (options.Command.requiresUsername === true || options.checkAuth === true)) {
        const scratchOrgAlias = (commandId === 'hardis:auth:login') ? null : process.env.SCRATCH_ORG_ALIAS || configInfo.scratchOrgAlias; // Can be null and it's ok if we're not in scratch org context
        await authOrg(scratchOrgAlias, options);
    }
};

// Authorize an org manually or with JWT
async function authOrg(orgAlias: string, options: any) {
    let doConnect = true;
    if (!options.checkAuth) {
        // Check if we are already authenticated
        const orgDisplayParams: any = {};
        if (orgAlias != null) {
            orgDisplayParams.targetusername = orgAlias;
        }
        const orgInfoResult = await sfdx.org.display(orgDisplayParams);
        if (orgInfoResult &&
            ((orgInfoResult.connectedStatus && orgInfoResult.connectedStatus.includes('Connected')) ||
                (orgAlias != null && orgAlias.includes('DevHub') && orgInfoResult.id != null))) {
            doConnect = false;
            const orgAliasLabel = (orgAlias != null) ? orgAlias : 'server';
            console.log(`[sfdx-hardis] You are connected to org ${orgAliasLabel}: ${orgInfoResult.instanceUrl}`);
        }
    }
    // Perform authentication
    if (doConnect) {
        let logged = false;
        const config = await getConfig();
        // Get auth variables, with priority CLI arguments, environment variables, then .hardis-sfdx.yml config file
        let username = (typeof options.Command.flags?.targetusername === 'string') ?
            options.Command.flags?.targetusername :
            process.env.TARGET_USERNAME || config.targetUsername;
        const instanceUrl =
            (typeof options.Command?.flags?.instanceurl === 'string' && options.Command?.flags?.instanceurl?.startsWith('https')) ?
                options.Command.flags.instanceurl :
                (process.env.INSTANCE_URL?.startsWith('https')) ?
                    process.env.INSTANCE_URL :
                    (config.instanceUrl) ?
                        config.instanceUrl :
                        (options.argv && options.argv.includes('--sandbox') || options.Command.flags.sandbox === true) ?
                            'https://test.salesforce.com' :
                            'https://login.salesforce.com';
        const sfdxClientId = process.env.SFDX_CLIENT_ID || config.sfdxClientId || null;

        const crtKeyFileName = (orgAlias != null) ? orgAlias : 'server';
        const crtKeyfile = `./ssh/${crtKeyFileName}.key`;
        const usernameArg = (orgAlias != null && orgAlias.includes('DevHub')) ? '--setdefaultdevhubusername' :
            (orgAlias == null) ? '--setdefaultusername' :
                '';
        if (fs.existsSync(crtKeyfile) && sfdxClientId && username) {
            const loginCommand = 'sfdx auth:jwt:grant' +
                ` ${usernameArg}` +
                ` --clientid ${sfdxClientId}` +
                ` --jwtkeyfile ${crtKeyfile}` +
                ` --username ${username}` +
                ` --instanceurl ${instanceUrl}`;
            console.log(`[sfdx-hardis] Login command: ${loginCommand}`);
            const jwtAuthRes = await exec(loginCommand);
            logged = jwtAuthRes?.stdout.includes(`Successfully authorized ${username}`);
        } else {
            // Login with web auth
            const orgLabel = (orgAlias == null) ? 'an org' : `org ${orgAlias}`;
            console.warn(`[sfdx-hardis] You must be connected to ${orgLabel} to perform this command. Please login in the open web browser`);
            if (process.env.CI === 'true') {
                throw new SfdxError(
                    `In CI context, you may define:
                - a .sfdx-hardis.yml file with instanceUrl and targetUsername properties (or INSTANCE_URL and TARGET_USERNAME repo variables)
                - a repository secret variable SFDX_CLIENT_ID with consumer key of sfdx connected app
                - store server.key file within ssh folder
                `);
            }
            const loginResult = await sfdx.auth.webLogin({
                setdefaultusername: true,
                setalias: orgAlias || 'MyOrg',
                setdefaultdevhubusername: (orgAlias && orgAlias.includes('DevHub')) ? true : false,
                instanceurl: instanceUrl,
                _quiet: !options.Command.flags.debug === true,
                _rejectOnError: true
            });
            logged = loginResult?.instanceUrl != null;
            username = loginResult?.username;
        }
        if (logged) {
            console.log(`[sfdx-hardis] Successfully logged to ${instanceUrl} with username ${username}`);
            if (!options.checkAuth) {
                console.warn('*********************************************************************');
                console.warn('*** IF YOU SEE AN AUTH ERROR PLEASE RUN AGAIN THE SAME COMMAND :) ***');
                console.warn('*********************************************************************');
            }
        } else {
            console.error('[sfdx-hardis] You must be logged to an org to perform this action');
        }
    }

}
