import { SfdxError } from '@salesforce/core';
import * as child from 'child_process';

import * as fs from 'fs-extra';
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
    // Manage authentication if org is required but current user is disconnected
    if (options.Command && (options.Command.requiresUsername === true || options.checkAuth === true)) {
        let doConnect = true;
        if (!options.checkAuth) {
            // Check if we are already authenticated
            const orgInfoResult = await sfdx.org.display();
            if (orgInfoResult && orgInfoResult.connectedStatus && orgInfoResult.connectedStatus.includes('Connected')) {
                doConnect = false;
            }
        }
        // Perform authentication
        if (doConnect) {
            let logged = false;
            const config = await getConfig();
            // Get auth variables, with priority CLI arguments, environment variables, then .hardis-sfdx.yml config file
            let username = (typeof options.Command.flags?.targetusername === 'string' ) ?
                options.Command.flags?.targetusername :
                process.env.TARGET_USERNAME || config.targetUsername;
            const instanceUrl =
                (typeof options.Command?.flags?.instanceurl === 'string' && options.Command?.flags?.instanceurl?.startsWith('https')) ?
                options.Command.flags.instanceurl :
                (process.env.INSTANCE_URL?.startsWith('https')) ?
                process.env.INSTANCE_URL :
                (config.instanceUrl) ?
                config.instanceUrl :
                ( options.argv && options.argv.includes('--sandbox') || options.Command.flags.sandbox === true) ?
                'https://test.salesforce.com' :
                'https://login.salesforce.com' ;
            const sfdxClientId = process.env.SFDX_CLIENT_ID || config.sfdxClientId || null ;

            const crtKeyfileName = './ssh/server.key';
            if (fs.existsSync(crtKeyfileName) && sfdxClientId && username) {
                const loginCommand = 'sfdx auth:jwt:grant --setdefaultusername' +
                ` --clientid ${sfdxClientId}` +
                ` --jwtkeyfile ${crtKeyfileName}` +
                ` --username ${username}` +
                ` --instanceurl ${instanceUrl}`;
                console.log(`[sfdx-hardis] Login command: ${loginCommand}`);
                const jwtAuthRes = await exec(loginCommand);
                logged = jwtAuthRes?.stdout.includes(`Successfully authorized ${username}`) ;
            } else {
                // Login with web auth
                console.warn('[sfdx-hardis] You must be connected to an org to perform this command. Please login in the open web browser');
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
                    instanceurl: instanceUrl,
                    _quiet: !options.Command.flags.debug === true,
                    _rejectOnError: true
                });
                logged = loginResult?.instanceUrl != null ;
                username = loginResult?.username ;
            }
            if (logged) {
                console.log(`[sfdx-hardis] Successfully logged to ${instanceUrl} with username ${username}`);
                if (!options.checkAuth) {
                    console.warn('***************************************');
                    console.warn('*** PLEASE RUN AGAIN THE COMMAND :) ***');
                    console.warn('***************************************');
                }
            } else {
                console.error('[sfdx-hardis] You must be logged to an org to perform this action');
            }
        }
    }
};
