import c from 'chalk';
import * as crossSpawn from 'cross-spawn';
import fs from 'fs-extra';
import * as path from 'path';
import {
  createTempDir,
  execCommand,
  execSfdxJson,
  getCurrentGitBranch,
  isCI,
  promptInstanceUrl,
  uxLog,
} from './index.js';
import { CONSTANTS, getConfig } from '../../config/index.js';
import { SfError } from '@salesforce/core';
import { prompts } from './prompts.js';
import { clearCache } from '../cache/index.js';
import { WebSocketClient } from '../websocketClient.js';
import { decryptFile } from '../cryptoUtils.js';

// Authorize an org with sfdxAuthUrl, manually or with JWT
export async function authOrg(orgAlias: string, options: any) {
  const isDevHub = orgAlias.includes('DevHub');

  let doConnect = true;
  if (!options.checkAuth) {
    // Check if we are already authenticated
    let orgDisplayCommand = 'sf org display';
    let setDefaultOrg = false;
    if (orgAlias && (isCI || isDevHub) && !orgAlias.includes('force://')) {
      orgDisplayCommand += ' --target-org ' + orgAlias;
      setDefaultOrg = true;
    } else {
      if (
        options?.argv.includes('--target-org') ||
        options?.argv.includes('--targetusername') ||
        options?.argv.includes('-o') ||
        options?.argv.includes('-u')
      ) {
        const posUsername =
          options.argv.indexOf('--target-org') > -1
            ? options.argv.indexOf('--target-org') + 1
            : options.argv.indexOf('--targetusername') > -1
              ? options.argv.indexOf('--targetusername') + 1
              : options.argv.indexOf('-o') > -1
                ? options.argv.indexOf('-o') + 1
                : options.argv.indexOf('-u') > -1;
        orgDisplayCommand += ' --target-org ' + options.argv[posUsername];
      }
    }
    const orgInfoResult = await execSfdxJson(orgDisplayCommand, this, {
      fail: false,
      output: false,
      debug: options.debug,
    });
    if (
      orgInfoResult.result &&
      orgInfoResult.result.connectedStatus !== 'RefreshTokenAuthError' &&
      ((orgInfoResult.result.connectedStatus && orgInfoResult.result.connectedStatus.includes('Connected')) ||
        (options.scratch && orgInfoResult.result.connectedStatus.includes('Unknown')) ||
        (orgInfoResult.result.alias === orgAlias && orgInfoResult.result.id != null) ||
        (orgInfoResult.result.username === orgAlias && orgInfoResult.result.id != null) ||
        (isDevHub && orgInfoResult.result.id != null))
    ) {
      // Set as default username or devhubusername
      uxLog(
        this,
        `[sfdx-hardis] You are already ${c.green('connected')} as ${c.green(
          orgInfoResult.result.username
        )} on org ${c.green(orgInfoResult.result.instanceUrl)}`
      );
      if (orgInfoResult.result.expirationDate) {
        uxLog(this, c.cyan(`[sfdx-hardis] Org expiration date: ${c.yellow(orgInfoResult.result.expirationDate)}`));
      }
      if (!isCI) {
        uxLog(
          this,
          c.yellow(
            c.italic(
              `[sfdx-hardis] If this is NOT the org you want to play with, ${c.whiteBright(
                c.bold('hit CTRL+C')
              )}, then input ${c.whiteBright(c.bold('sf hardis:org:select'))}`
            )
          )
        );
      }
      if (setDefaultOrg) {
        const setDefaultOrgCommand = `sf config set ${isDevHub ? 'target-dev-hub' : 'target-org'}=${orgInfoResult.result.username
          }`;
        await execSfdxJson(setDefaultOrgCommand, this, { fail: false });
      }
      doConnect = false;
    }
  }
  // Perform authentication
  if (doConnect) {
    let logged = false;
    const config = await getConfig('user');

    // Manage auth with sfdxAuthUrl (CI & scratch org only)
    const authUrlVarName = `SFDX_AUTH_URL_${orgAlias}`;
    const authUrlVarNameUpper = `SFDX_AUTH_URL_${orgAlias.toUpperCase()}`;
    let authUrl = process.env[authUrlVarName] || process.env[authUrlVarNameUpper] || orgAlias || '';
    if (isDevHub) {
      authUrl =
        process.env[authUrlVarName] ||
        process.env[authUrlVarNameUpper] ||
        process.env.SFDX_AUTH_URL_DEV_HUB ||
        orgAlias ||
        '';
    }
    if (authUrl.includes('force://')) {
      const authFile = path.join(await createTempDir(), 'sfdxScratchAuth.txt');
      await fs.writeFile(authFile, authUrl, 'utf8');
      const authCommand =
        `sf org login sfdx-url -f ${authFile}` +
        (isDevHub ? ` --set-default-dev-hub` : ` --set-default`) +
        (!orgAlias.includes('force://') ? ` --alias ${orgAlias}` : '');
      await execCommand(authCommand, this, { fail: true, output: false });
      uxLog(this, c.cyan('Successfully logged using sfdxAuthUrl'));
      await fs.remove(authFile);
      return;
    }

    // Get auth variables, with priority CLI arguments, environment variables, then .sfdx-hardis.yml config file
    let username =
      typeof options.Command.flags?.targetusername === 'string'
        ? options.Command.flags?.targetusername
        : process.env.TARGET_USERNAME || isDevHub
          ? config.devHubUsername
          : config.targetUsername;
    if (username == null && isCI) {
      const gitBranchFormatted = await getCurrentGitBranch({ formatted: true });
      console.error(
        c.yellow(
          `[sfdx-hardis][WARNING] You may have to define ${c.bold(
            isDevHub
              ? 'devHubUsername in .sfdx-hardis.yml'
              : options.scratch
                ? 'cache between your CI jobs: folder ".cache/sfdx-hardis/.sfdx"'
                : `targetUsername in config/branches/.sfdx-hardis.${gitBranchFormatted}.yml`
          )} `
        )
      );
      process.exit(1);
    }
    let instanceUrl =
      typeof options.Command?.flags?.instanceurl === 'string' &&
        (options.Command?.flags?.instanceurl || '').startsWith('https')
        ? options.Command.flags.instanceurl
        : (process.env.INSTANCE_URL || '').startsWith('https')
          ? process.env.INSTANCE_URL
          : config.instanceUrl
            ? config.instanceUrl
            : 'https://login.salesforce.com';
    // Get JWT items clientId and certificate key
    const sfdxClientId = await getSfdxClientId(orgAlias, config);
    const crtKeyfile = await getCertificateKeyFile(orgAlias, config);
    const usernameArg = options.setDefault === false ? '' : isDevHub ? '--set-default-dev-hub' : '--set-default';
    if (crtKeyfile && sfdxClientId && username) {
      // Login with JWT
      const loginCommand =
        'sf org login jwt' +
        ` ${usernameArg}` +
        ` --client-id ${sfdxClientId}` +
        ` --jwt-key-file ${crtKeyfile}` +
        ` --username ${username}` +
        ` --instance-url ${instanceUrl}` +
        (orgAlias ? ` --alias ${orgAlias}` : '');
      const jwtAuthRes = await execSfdxJson(loginCommand, this, {
        fail: false,
        output: false
      });
      // await fs.remove(crtKeyfile); // Delete private key file from temp folder TODO: move to postrun hook
      logged = jwtAuthRes.status === 0;
      if (!logged) {
        console.error(c.red(`[sfdx-hardis][ERROR] JWT login error: \n${JSON.stringify(jwtAuthRes)}`));
        process.exit(1);
      }
    } else if (!isCI) {
      // Login with web auth
      const orgLabel = `org ${orgAlias}`;
      console.warn(
        c.yellow(
          c.bold(
            `[sfdx-hardis] You must be connected to ${orgLabel} to perform this command. Please login in the open web browser`
          )
        )
      );

      if (isCI) {
        console.error(
          c.red(`See CI authentication doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`)
        );
        throw new SfError(
          `In CI context, you may define:
                - a .sfdx-hardis.yml file with instanceUrl and targetUsername properties (or INSTANCE_URL and TARGET_USERNAME repo variables)
                - a repository secret variable SFDX_CLIENT_ID with consumer key of SF CLI connected app
                - store server.key file within ssh folder
                `
        );
      }
      const orgTypes = isDevHub ? ['login'] : ['login', 'test'];
      instanceUrl = await promptInstanceUrl(orgTypes, orgAlias);

      const configInfoUsr = await getConfig('user');

      // Prompt user for Web or Device login
      const loginTypeRes = await prompts({
        name: 'loginType',
        type: 'select',
        message: "Select a login type (if you don't know, use Web)",
        choices: [
          {
            title: '🌐 Web Login (If VsCode is locally installed on your computer)',
            value: 'web',
          },
          {
            title: '📟 Device Login (Useful for CodeBuilder / CodeSpaces)',
            value: 'device',
            description: 'Look at the instructions in the console terminal if you select this option',
          },
        ],
        default: 'web',
        initial: 'web',
      });

      let loginResult: any = null;
      // Manage device login
      if (loginTypeRes.loginType === 'device') {
        const loginCommandArgs = ['org login device', '--instance-url', instanceUrl];
        if (orgAlias && orgAlias !== configInfoUsr?.scratchOrgAlias) {
          loginCommandArgs.push(...['--alias', orgAlias]);
        }
        if (options.setDefault === true && isDevHub) {
          loginCommandArgs.push('--set-default-dev-hub');
        }
        if (options.setDefault === true && !isDevHub) {
          loginCommandArgs.push('--set-default');
        }
        const commandStr = 'sf ' + loginCommandArgs.join(' ');
        uxLog(this, `[sfdx-hardis][command] ${c.bold(c.bgWhite(c.grey(commandStr)))}`);
        loginResult = crossSpawn.sync('sf', loginCommandArgs, { stdio: 'inherit' });
      }
      // Web Login if device login not used
      if (loginResult == null) {
        const loginCommand =
          'sf org login web' +
          (options.setDefault === false ? '' : isDevHub ? ' --set-default-dev-hub' : ' --set-default') +
          ` --instance-url ${instanceUrl}` +
          (orgAlias && orgAlias !== configInfoUsr?.scratchOrgAlias ? ` --alias ${orgAlias}` : '');
        try {
          loginResult = await execCommand(loginCommand, this, { output: false, fail: true, spinner: false });
        } catch (e) {
          // Give instructions if server is unavailable
          if (((e as Error).message || '').includes('Cannot start the OAuth redirect server on port')) {
            uxLog(
              this,
              c.yellow(
                c.bold(
                  'You might have a ghost SF CLI command. Open Task Manager, search for Node.js processes, kill them, then try again'
                )
              )
            );
          }
          throw e;
        }
      }
      await clearCache('sf org list');
      uxLog(this, c.grey(JSON.stringify(loginResult, null, 2)));
      logged = loginResult.status === 0;
      username = loginResult?.username || 'err';
      instanceUrl = loginResult?.instanceUrl || instanceUrl;
    } else {
      console.error(c.red(`[sfdx-hardis] Unable to connect to org ${orgAlias} with browser. Please try again :)`));
    }
    if (logged) {
      // Retrieve default username or dev hub username if not returned by command
      if (username === 'err') {
        const configGetRes = await execSfdxJson('sf config get ' + (isDevHub ? 'target-dev-hub' : 'target-org'), this, {
          output: false,
          fail: false,
        });
        username = configGetRes?.result[0]?.value || '';
      }
      uxLog(this, `Successfully logged to ${c.green(instanceUrl)} with ${c.green(username)}`);
      WebSocketClient.sendMessage({ event: 'refreshStatus' });
      // Assign org to SfCommands
      if (isDevHub) {
        options.Command.flags.targetdevhubusername = username;
        // options.Command.assignHubOrg(); // seems to be automatically done by SfCommand under the hook
      } else {
        options.Command.flags.targetusername = username;
        // options.Command.assignOrg(); // seems to be automatically done by SfCommand under the hook
      }
      // Display warning message in case of local usage (not CI), and not login command
      // if (!(options?.Command?.id || "").startsWith("hardis:auth:login")) {
      //   console.warn(c.yellow("*** IF YOU SEE AN AUTH ERROR PLEASE RUN AGAIN THE SAME COMMAND :) ***"));
      // }
    } else {
      console.error(c.red('[sfdx-hardis][ERROR] You must be logged to an org to perform this action'));
      process.exit(1); // Exit because we should succeed to connect
    }
  }
}

// Get clientId for SFDX connected app
async function getSfdxClientId(orgAlias: string, config: any) {
  // Try to find in global variables
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
      c.yellow(
        `[sfdx-hardis] If you use CI on multiple branches & orgs, you should better define CI variable ${c.bold(
          sfdxClientIdVarNameUpper
        )} than SFDX_CLIENT_ID`
      )
    );
    console.warn(
      c.yellow(`See CI authentication doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`)
    );
    return process.env.SFDX_CLIENT_ID;
  }
  // Try to find in config files ONLY IN LOCAL MODE (in CI, it's supposed to be a CI variable)
  if (!isCI && config.devHubSfdxClientId) {
    return config.devHubSfdxClientId;
  }
  if (isCI) {
    console.error(
      c.red(
        `[sfdx-hardis] You must set env variable ${c.bold(
          sfdxClientIdVarNameUpper
        )} with the Consumer Key value defined on SFDX Connected app`
      )
    );
    console.error(c.red(`See CI authentication doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`));
  }
  return null;
}

// Get clientId for SFDX connected app
async function getKey(orgAlias: string, config: any) {
  // Try to find in global variables
  const sfdxClientKeyVarName = `SFDX_CLIENT_KEY_${orgAlias}`;
  if (process.env[sfdxClientKeyVarName]) {
    return process.env[sfdxClientKeyVarName];
  }
  const sfdxClientKeyVarNameUpper = sfdxClientKeyVarName.toUpperCase();
  if (process.env[sfdxClientKeyVarNameUpper]) {
    return process.env[sfdxClientKeyVarNameUpper];
  }
  if (process.env.SFDX_CLIENT_KEY) {
    console.warn(
      c.yellow(
        `[sfdx-hardis] If you use CI on multiple branches & orgs, you should better define CI variable ${c.bold(
          sfdxClientKeyVarNameUpper
        )} than SFDX_CLIENT_KEY`
      )
    );
    console.warn(
      c.yellow(`See CI authentication doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`)
    );
    return process.env.SFDX_CLIENT_KEY;
  }
  // Try to find in config files ONLY IN LOCAL MODE (in CI, it's supposed to be a CI variable)
  if (!isCI && config.devHubSfdxClientKey) {
    return config.devHubSfdxClientKey;
  }
  if (isCI) {
    console.error(
      c.red(
        `[sfdx-hardis] You must set env variable ${c.bold(
          sfdxClientKeyVarNameUpper
        )} with the value of SSH private key encryption key`
      )
    );
    console.error(c.red(`See CI authentication doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`));
  }
  return null;
}

// Try to find certificate key file for SF CLI connected app in different locations
async function getCertificateKeyFile(orgAlias: string, config: any) {
  const filesToTry = [
    `./config/branches/.jwt/${orgAlias}.key`,
    `./config/.jwt/${orgAlias}.key`,
    `./ssh/${orgAlias}.key`,
    `./.ssh/${orgAlias}.key`,
    './ssh/server.key',
  ];
  for (const file of filesToTry) {
    if (fs.existsSync(file)) {
      // Decrypt SSH private key and write a temporary file
      const sshKey = await getKey(orgAlias, config);
      if (sshKey == null) {
        continue;
      }
      const tmpSshKeyFile = path.join(await createTempDir(), `${orgAlias}.key`);
      await decryptFile(file, tmpSshKeyFile, sshKey);
      return tmpSshKeyFile;
    }
  }
  if (isCI) {
    console.error(
      c.red(
        `[sfdx-hardis] You must put a certificate key to connect via JWT.Possible locations:\n  -${filesToTry.join(
          '\n  -'
        )}`
      )
    );
    console.error(c.red(`See CI authentication doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`));
  }
  return null;
}
