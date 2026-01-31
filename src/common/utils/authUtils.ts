import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { exec as childExec } from 'node:child_process';
import { promisify } from 'node:util';
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
import { clearCache } from '../cache/index.js';
import { WebSocketClient } from '../websocketClient.js';
import { decryptFile } from '../cryptoUtils.js';

const execAsync = promisify(childExec);

// Options used by authOrg / authenticateUsingDeviceLogin
export interface AuthOrgOptions {
  checkAuth?: boolean;
  argv?: string[];
  debug?: boolean;
  scratch?: boolean;
  setDefault?: boolean;
  forceUsername?: string;
  Command?: {
    flags?: Record<string, any>;
    id?: string;
  };
  [key: string]: any;
}

// (removed accidental default export)

// Authorize an org with sfdxAuthUrl, manually or with JWT
export async function authOrg(orgAlias: string, options: AuthOrgOptions): Promise<boolean> {
  const isDevHub = orgAlias.includes('DevHub');

  let doConnect = true;
  let alias: string | null = null;
  let setDefaultOrg = false;
  let orgInfo: any = {};
  if (!options.checkAuth) {
    // Check if we are already authenticated
    let orgDisplayCommand = 'sf org display';
    if (options.forceUsername) {
      orgDisplayCommand += ' --target-org ' + options.forceUsername;
      setDefaultOrg = options.setDefault ?? false;
    }
    else if (orgAlias && (isCI || isDevHub) && !orgAlias.includes('force://')) {
      orgDisplayCommand += ' --target-org ' + orgAlias;
      setDefaultOrg = options.setDefault ?? (orgAlias !== 'TECHNICAL_ORG' ? true : false);
    }
    else {
      const argv = options?.argv || [];
      if (
        argv.includes('--target-org') ||
        argv.includes('--targetusername') ||
        argv.includes('-o') ||
        argv.includes('-u')
      ) {
        const posUsername =
          argv.indexOf('--target-org') > -1
            ? argv.indexOf('--target-org') + 1
            : argv.indexOf('--targetusername') > -1
              ? argv.indexOf('--targetusername') + 1
              : argv.indexOf('-o') > -1
                ? argv.indexOf('-o') + 1
                : argv.indexOf('-u') > -1
                  ? argv.indexOf('-u') + 1 : null;
        if (posUsername === null) {
          throw new SfError("Unable to find alias (authUtils.authOrg)")
        }
        alias = argv[posUsername] as string | null;
        orgDisplayCommand += ' --target-org ' + alias;
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
      orgInfo = orgInfoResult.result;
      if (orgInfoResult.result.apiVersion) {
        globalThis.currentOrgApiVersion = orgInfoResult.result.apiVersion;
      }
      // Set as default username or devhubusername
      uxLog(
        "log",
        this,
        `[sfdx-hardis] You are already ${c.green('connected')} as ${c.green(
          orgInfoResult.result.username
        )} on org ${c.green(orgInfoResult.result.instanceUrl)} (apiVersion ${globalThis.currentOrgApiVersion})`
      );

      if (orgInfoResult.result.expirationDate) {
        uxLog("action", this, c.cyan(`[sfdx-hardis] Org expiration date: ${c.yellow(orgInfoResult.result.expirationDate)}`));
      }
      if (!isCI) {
        uxLog(
          "warning",
          this,
          c.yellow(
            c.italic(
              `If this is NOT the org you want to play with, ${c.whiteBright(
                c.bold('hit CTRL+C')
              )}, then input ${c.whiteBright(c.bold('sf hardis:org:select'))}`
            )
          )
        );
      }
      if (setDefaultOrg) {
        const setDefaultOrgCommand = `sf config set ${alias ? alias : isDevHub ? 'target-dev-hub' : 'target-org'}=${orgInfoResult.result.username
          }`;
        await execSfdxJson(setDefaultOrgCommand, this, { fail: false });
      }
      globalThis.justConnectedOrg = sanitizeOrg(orgInfoResult.result);
      doConnect = false;
    }
  }
  // Perform authentication
  let updateSfCliCommandOrg = false;
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
        (isDevHub ? ` --set-default-dev-hub` : (setDefaultOrg ? ` --set-default` : '')) +
        (!orgAlias.includes('force://') ? ` --alias ${orgAlias}` : '');
      await execCommand(authCommand, this, { fail: true, output: false });
      uxLog("action", this, c.cyan('Successfully logged using sfdxAuthUrl'));
      await fs.remove(authFile);
      return true;
    }

    // Get auth variables, with priority CLI arguments, environment variables, then .sfdx-hardis.yml config file
    const cmdFlags = options.Command?.flags || {};
    let username =
      options.forceUsername ?
        options.forceUsername :
        typeof cmdFlags.targetusername === 'string'
          ? cmdFlags.targetusername
          : process.env.TARGET_USERNAME || isDevHub
            ? config.devHubUsername
            : config.targetUsername || null;
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
      options.instanceUrl ?
        options.instanceUrl :
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
        (orgAlias && !options.forceUsername ? ` --alias ${orgAlias}` : '');
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
      let loginResult: any = null;
      uxLog("action", this, c.cyan("Authenticating using web login..."));
      const loginCommand =
        'sf org login web' +
        (alias ? ` --alias ${alias}` : options.setDefault === false ? '' : isDevHub ? ' --set-default-dev-hub' : ' --set-default') +
        ` --instance-url ${instanceUrl}` +
        (orgAlias && orgAlias !== configInfoUsr?.scratchOrgAlias ? ` --alias ${orgAlias}` : '');
      const maxWebLoginAttempts = 2;
      for (let attempt = 1; attempt <= maxWebLoginAttempts; attempt++) {
        try {
          loginResult = await execSfdxJson(loginCommand, this, { output: false, fail: true, spinner: false });
          break;
        } catch (e) {
          const errorMessage = (e as Error).message || '';
          const blockedPort = extractPortFromOauthError(e);
          if (blockedPort && attempt < maxWebLoginAttempts) {
            const freed = await attemptToFreeOauthRedirectPort(blockedPort, this);
            if (freed) {
              uxLog(
                "action",
                this,
                c.cyan(
                  `[sfdx-hardis] Retrying web login (attempt ${attempt + 1}/${maxWebLoginAttempts}) after freeing port ${blockedPort}`
                )
              );
              continue;
            }
          }
          if (errorMessage.includes('Cannot start the OAuth redirect server on port')) {
            uxLog(
              "warning",
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
      if (loginResult == null) {
        throw new SfError('sf org login web did not return any result');
      }

      await clearCache('sf org list');
      logged = loginResult.status === 0;
      username = loginResult?.result?.username || loginResult?.username || 'err';
      instanceUrl = loginResult?.result?.instanceUrl || loginResult?.instanceUrl || instanceUrl;
      updateSfCliCommandOrg = true;
    } else {
      console.error(c.red(`[sfdx-hardis] Unable to connect to org ${orgAlias} with browser. Please try again 😊`));
    }
    if (logged) {
      // Retrieve default username or dev hub username if not returned by command
      if (username === 'err') {
        // Using alias
        if (alias) {
          const configGetRes = await execSfdxJson(`sf org display --target-org ${alias}`, this, {
            output: false,
            fail: false,
          });
          username = configGetRes?.result?.username || '';
        } else {
          // Using default org
          const configGetRes = await execSfdxJson('sf config get ' + (isDevHub ? 'target-dev-hub' : 'target-org'), this, {
            output: false,
            fail: false,
          });
          username = configGetRes?.result[0]?.value || '';
        }
      }
      uxLog("other", this, `Successfully logged to ${c.green(instanceUrl)} with ${c.green(username)}`);
      WebSocketClient.sendRefreshStatusMessage();
      // Assign org to SfCommands
      // if (isDevHub) {
      // options.Command.flags["target-org"] = username;
      // options.Command.assignHubOrg(); // seems to be automatically done by SfCommand under the hook
      // } else {
      // options.Command.flags["target-dev-hub"] = username;
      // options.Command.assignOrg(); // seems to be automatically done by SfCommand under the hook
      // }
      // Display warning message in case of local usage (not CI), and not login command
      if (!(options?.Command?.id || "").startsWith("hardis:auth:login") && updateSfCliCommandOrg === true) {
        uxLog("warning", this, c.yellow("*** IF YOU SEE AN AUTH ERROR PLEASE RUN AGAIN THE SAME COMMAND 😊 ***"));
      }
      globalThis.justConnectedOrg = sanitizeOrg({ username, instanceUrl, ...orgInfo });
    } else {
      console.error(c.red('[sfdx-hardis][ERROR] You must be logged to an org to perform this action'));
      throw new SfError(`You must be logged to an org to perform this action`);
      // process.exit(1); // Exit because we should succeed to connect
    }
    return true;
  }
  // If we skipped connection because we were already connected
  if (!doConnect) {
    return true;
  }
  // Fallback: should not be reached, but satisfy the boolean return contract
  return false;
}

// Get clientId for SFDX connected app
async function getSfdxClientId(orgAlias: string, config: any) {
  // Try to find in global variables
  const sfdxClientIdVarName = `SFDX_CLIENT_ID_${orgAlias}`;
  if (process.env[sfdxClientIdVarName]) {
    console.log(c.grey(`[sfdx-hardis] Using ${sfdxClientIdVarName.toUpperCase()} env variable`));
    return process.env[sfdxClientIdVarName];
  }
  const sfdxClientIdVarNameUpper = sfdxClientIdVarName.toUpperCase();
  if (process.env[sfdxClientIdVarNameUpper]) {
    console.log(c.grey(`[sfdx-hardis] Using ${sfdxClientIdVarNameUpper} env variable`));
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
    console.log(c.grey(`[sfdx-hardis] Using devHubSfdxClientId config variable`));
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
    console.warn(c.yellow(`If you configured ${sfdxClientIdVarNameUpper} but still see this message, you may have forgotten to reference the variable name in your GitHub or Azure YML pipeline.`));
    console.warn(c.yellow(`See CI authentication doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`));
  }
  return null;
}

// Get clientId for SFDX connected app
async function getKey(orgAlias: string, config: any) {
  // Try to find in global variables
  const sfdxClientKeyVarName = `SFDX_CLIENT_KEY_${orgAlias}`;
  if (process.env[sfdxClientKeyVarName]) {
    console.log(c.grey(`[sfdx-hardis] Using ${sfdxClientKeyVarName.toUpperCase()} env variable`));
    return process.env[sfdxClientKeyVarName];
  }
  const sfdxClientKeyVarNameUpper = sfdxClientKeyVarName.toUpperCase();
  if (process.env[sfdxClientKeyVarNameUpper]) {
    console.log(c.grey(`[sfdx-hardis] Using ${sfdxClientKeyVarNameUpper} env variable`));
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
    console.log(c.grey(`[sfdx-hardis] Using devHubSfdxClientKey config variable`));
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
    console.warn(c.yellow(`If you configured ${sfdxClientKeyVarNameUpper} but still see this message, you may have forgotten to reference the variable name in your GitHub or Azure YML pipeline.`));
    console.warn(c.yellow(`See CI authentication doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`));
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
  // Check if we find multiple files 
  const filesFound = filesToTry.filter((file) => fs.existsSync(file));
  if (filesFound.length > 1) {
    console.warn(
      c.yellow(
        `[sfdx-hardis] Multiple certificate key files found: ${filesFound.join(
          ', '
        )}. Please keep only one certificate key file. If you don't know which one, remove all and re-run the configuration command`
      )
    );
  }

  for (const file of filesToTry) {
    if (fs.existsSync(file)) {
      // Decrypt SSH private key and write a temporary file
      const sshKey = await getKey(orgAlias, config);
      if (sshKey == null) {
        continue;
      }

      const tmpSshKeyFile = path.join(await createTempDir(), `${orgAlias}.key`);
      console.log(c.grey(`[sfdx-hardis] Decrypting key...`));
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
    uxLog("error", this, c.red(`See CI authentication doc at ${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-setup-auth/`));
  }
  return null;
}

async function attemptToFreeOauthRedirectPort(port: number, context: any): Promise<boolean> {
  uxLog(
    "warning",
    context,
    c.yellow(`[sfdx-hardis] OAuth redirect port ${port} is busy. Attempting to terminate the blocking process...`)
  );
  const freed = await killProcessesListeningOnPort(port);
  if (freed) {
    uxLog("other", context, c.green(`[sfdx-hardis] Port ${port} freed successfully.`));
  } else {
    uxLog(
      "error",
      context,
      c.red(`[sfdx-hardis] Unable to free port ${port}. Please close the conflicting application manually.`)
    );
  }
  return freed;
}

async function killProcessesListeningOnPort(port: number): Promise<boolean> {
  const normalizedPort = Number(port);
  if (!Number.isFinite(normalizedPort)) {
    return false;
  }
  const numericPidPattern = /^\d+$/;
  if (process.platform === 'win32') {
    const netstatResult = await safeExecCommand(`netstat -ano | findstr :${normalizedPort}`);
    const pids = new Set(
      netstatResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          return parts[parts.length - 1];
        })
        .filter((pid) => pid && numericPidPattern.test(pid))
    );
    if (!pids.size) {
      return false;
    }
    let killed = false;
    for (const pid of pids) {
      const killResult = await safeExecCommand(`taskkill /PID ${pid} /F`);
      killed = killResult.success || killed;
    }
    return killed;
  }
  const lsofResult = await safeExecCommand(`lsof -ti tcp:${normalizedPort}`);
  const pids = new Set(
    lsofResult.stdout
      .split(/\s+/)
      .map((pid) => pid.trim())
      .filter((pid) => pid && numericPidPattern.test(pid))
  );
  let killed = false;
  for (const pid of pids) {
    const killResult = await safeExecCommand(`kill -9 ${pid}`);
    killed = killResult.success || killed;
  }
  if (killed) {
    return true;
  }
  const fuserResult = await safeExecCommand(`fuser -k -n tcp ${normalizedPort}`);
  return fuserResult.success;
}

async function safeExecCommand(command: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, { windowsHide: true });
    return { success: true, stdout, stderr };
  } catch (error) {
    const stdout = (error as any)?.stdout ?? '';
    const stderr = (error as any)?.stderr ?? '';
    return { success: false, stdout, stderr };
  }
}

function extractPortFromOauthError(error: unknown): number | null {
  const message =
    typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  const directMatch = message.match(/port\s+(\d{2,5})/i);
  if (directMatch?.[1]) {
    return Number(directMatch[1]);
  }
  const eaddrMatch = message.match(/EADDRINUSE[^0-9]*(\d{2,5})/i) ?? message.match(/:(\d{2,5})\b/);
  if (eaddrMatch?.[1]) {
    return Number(eaddrMatch[1]);
  }
  return null;
}

function sanitizeOrg(org: any) {
  if (org?.accessToken) {
    org.accessToken = '***REDACTED***';
  }
  if (org?.refreshToken) {
    org.refreshToken = '***REDACTED***';
  }
  return org;
}