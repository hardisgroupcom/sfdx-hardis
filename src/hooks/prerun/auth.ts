import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { decryptFile } from "../../common/cryptoUtils";
import {
  createTempDir,
  execCommand,
  execSfdxJson,
  getCurrentGitBranch,
  isCI,
  promptInstanceUrl,
  restoreLocalSfdxInfo,
  uxLog,
} from "../../common/utils";
import { WebSocketClient } from "../../common/websocketClient";
import { checkConfig, getConfig } from "../../config";

export const hook = async (options: any) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || "";
  if (!commandId.startsWith("hardis") || ["hardis:source:push", "hardis:source:pull"].includes(commandId)) {
    return;
  }
  // skip if during mocha tests
  if (typeof global.it === "function") {
    return;
  }
  await restoreLocalSfdxInfo();
  let configInfo = await getConfig("user");
  if (configInfo.skipAuthCheck === true) {
    uxLog(this, c.yellow("No authentication check, you better know what you are doing ;)"));
    return;
  }
  // Manage authentication if DevHub is required but current user is disconnected
  if ((options.Command && options.Command.supportsDevhubUsername === true) || options.devHub === true) {
    let devHubAlias = configInfo.devHubAlias || process.env.DEVHUB_ALIAS;
    if (devHubAlias == null) {
      await checkConfig(options);
      configInfo = await getConfig("user");
      devHubAlias = configInfo.devHubAlias || "DevHub";
    }
    await authOrg(devHubAlias, options);
  }
  // Manage authentication if org is required but current user is disconnected
  if (((options.Command && options.Command.requiresUsername === true) || options.checkAuth === true) && !(options.devHub === true)) {
    const orgAlias = process.env.ORG_ALIAS
      ? process.env.ORG_ALIAS
      : isCI && configInfo.scratchOrgAlias
      ? configInfo.scratchOrgAlias
      : isCI && options.scratch && configInfo.sfdxAuthUrl
      ? configInfo.sfdxAuthUrl
      : isCI
      ? await getCurrentGitBranch({ formatted: true })
      : commandId === "hardis:auth:login" && configInfo.orgAlias
      ? configInfo.orgAlias
      : configInfo.scratchOrgAlias || "MY_ORG"; // Can be null and it's ok if we're not in scratch org context
    await authOrg(orgAlias, options);
  }
};

// Authorize an org manually or with JWT
async function authOrg(orgAlias: string, options: any) {
  // Manage auth with sfdxAuthUrl (CI & scratch org only)
  if ((orgAlias || "").startsWith("force://")) {
    const authFile = path.join(await createTempDir(), "sfdxScratchAuth.txt");
    await fs.writeFile(authFile, orgAlias, "utf8");
    await execCommand(`sfdx auth:sfdxurl:store -f ${authFile} --setdefaultusername`, this, { fail: true, output: false });
    await fs.remove(authFile);
    return;
  }
  const isDevHub = orgAlias.includes("DevHub");
  let doConnect = true;
  if (!options.checkAuth) {
    // Check if we are already authenticated
    let orgDisplayCommand = "sfdx force:org:display";
    let setDefaultUsername = false;
    if (orgAlias !== "MY_ORG" && (isCI || isDevHub)) {
      orgDisplayCommand += " --targetusername " + orgAlias;
      setDefaultUsername = true;
    } else {
      if (process.argv.includes("-u") || process.argv.includes("--targetusername")) {
        const posUsername = process.argv.indexOf("-u") > -1 ? process.argv.indexOf("-u") + 1 : process.argv.indexOf("--targetusername") + 1;
        orgDisplayCommand += " --targetusername " + process.argv[posUsername];
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
      ((orgInfoResult.result.connectedStatus && orgInfoResult.result.connectedStatus.includes("Connected")) ||
        (options.scratch && orgInfoResult.result.connectedStatus.includes("Unknown")) ||
        (orgInfoResult.result.alias === orgAlias && orgInfoResult.result.id != null) ||
        (orgInfoResult.result.username === orgAlias && orgInfoResult.result.id != null) ||
        (isDevHub && orgInfoResult.result.id != null))
    ) {
      // Set as default username or devhubusername
      console.log(
        `[sfdx-hardis] You are already ${c.green("connected")} to org ${c.green(
          orgInfoResult.result.alias || orgInfoResult.result.username
        )}: ${c.green(orgInfoResult.result.instanceUrl)}`
      );
      if (orgInfoResult.result.expirationDate) {
        console.log(c.cyan(`[sfdx-hardis] Org expiration date: ${c.yellow(orgInfoResult.result.expirationDate)}`));
      }
      if (!isCI) {
        console.log(
          c.yellow(
            c.italic(
              `[sfdx-hardis] If this is NOT the org you want to play with, ${c.whiteBright(c.bold("hit CTRL+C"))}, then input ${c.whiteBright(
                c.bold("sfdx hardis:org:select")
              )}`
            )
          )
        );
      }
      if (setDefaultUsername) {
        const setDefaultUsernameCommand = `sfdx config:set ${isDevHub ? "defaultdevhubusername" : "defaultusername"}=${
          orgInfoResult.result.username
        }`;
        await execSfdxJson(setDefaultUsernameCommand, this, { fail: false });
      }
      doConnect = false;
    }
  }
  // Perform authentication
  if (doConnect) {
    let logged = false;
    const config = await getConfig("user");
    // Get auth variables, with priority CLI arguments, environment variables, then .hardis-sfdx.yml config file
    let username =
      typeof options.Command.flags?.targetusername === "string"
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
              ? "devHubUsername in .sfdx-hardis.yml"
              : options.scratch
              ? 'cache between your CI jobs: folder ".cache/sfdx-hardis/.sfdx"'
              : `targetUsername in config/branches/.sfdx-hardis.${gitBranchFormatted}.yml`
          )} `
        )
      );
      process.exit(1);
    }
    let instanceUrl =
      typeof options.Command?.flags?.instanceurl === "string" && (options.Command?.flags?.instanceurl || "").startsWith("https")
        ? options.Command.flags.instanceurl
        : (process.env.INSTANCE_URL || "").startsWith("https")
        ? process.env.INSTANCE_URL
        : config.instanceUrl
        ? config.instanceUrl
        : "https://login.salesforce.com";
    // Get JWT items clientId and certificate key
    const sfdxClientId = await getSfdxClientId(orgAlias, config);
    const crtKeyfile = await getCertificateKeyFile(orgAlias, config);
    const usernameArg = isDevHub ? "--setdefaultdevhubusername" : "--setdefaultusername";
    if (crtKeyfile && sfdxClientId && username) {
      // Login with JWT
      const loginCommand =
        "sfdx auth:jwt:grant" +
        ` ${usernameArg}` +
        ` --clientid ${sfdxClientId}` +
        ` --jwtkeyfile ${crtKeyfile}` +
        ` --username ${username}` +
        ` --setalias ${orgAlias}` +
        ` --instanceurl ${instanceUrl}`;
      const jwtAuthRes = await execSfdxJson(loginCommand, this, {
        fail: false,
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
        c.yellow(c.bold(`[sfdx-hardis] You must be connected to ${orgLabel} to perform this command. Please login in the open web browser`))
      );

      if (isCI) {
        throw new SfdxError(
          `In CI context, you may define:
                - a .sfdx-hardis.yml file with instanceUrl and targetUsername properties (or INSTANCE_URL and TARGET_USERNAME repo variables)
                - a repository secret variable SFDX_CLIENT_ID with consumer key of sfdx connected app
                - store server.key file within ssh folder
                `
        );
      }
      instanceUrl = await promptInstanceUrl();

      const loginResult = await execCommand(
        "sfdx auth:web:login" +
          " --setdefaultusername" +
          ` --setalias ${orgAlias}` +
          (isDevHub ? " --setdefaultdevhubusername" : "") +
          ` --instanceurl ${instanceUrl}`,
        this,
        { output: true, fail: true, spinner: false }
      );
      console.log(JSON.stringify(loginResult, null, 2));
      logged = loginResult.status === 0;
      username = loginResult?.username || "your username";
      instanceUrl = loginResult?.instanceUrl || instanceUrl;
    } else {
      console.error(c.red(`[sfdx-hardis] Unable to connect to org ${orgAlias} with browser. Please try again :)`));
    }
    if (logged) {
      uxLog(this, `Successfully logged to ${c.green(instanceUrl)} with ${c.green(username)}`);
      WebSocketClient.sendMessage({ event: "refreshStatus" });
      // Display warning message in case of local usage (not CI), and not login command
      if (!(options?.Command?.id || "").startsWith("hardis:auth:login")) {
        console.warn(c.yellow("*********************************************************************"));
        console.warn(c.yellow("*** IF YOU SEE AN AUTH ERROR PLEASE RUN AGAIN THE SAME COMMAND :) ***"));
        console.warn(c.yellow("*********************************************************************"));
      }
    } else {
      console.error(c.red("[sfdx-hardis][ERROR] You must be logged to an org to perform this action"));
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
    return process.env.SFDX_CLIENT_ID;
  }
  // Try to find in config files ONLY IN LOCAL MODE (in CI, it's supposed to be a CI variable)
  if (!isCI && config.devHubSfdxClientId) {
    return config.devHubSfdxClientId;
  }
  if (isCI) {
    console.error(
      c.red(`[sfdx-hardis] You must set env variable ${c.bold(sfdxClientIdVarNameUpper)} with the Consumer Key value defined on SFDX Connected app`)
    );
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
    return process.env.SFDX_CLIENT_KEY;
  }
  // Try to find in config files ONLY IN LOCAL MODE (in CI, it's supposed to be a CI variable)
  if (!isCI && config.devHubSfdxClientKey) {
    return config.devHubSfdxClientKey;
  }
  if (isCI) {
    console.error(
      c.red(`[sfdx-hardis] You must set env variable ${c.bold(sfdxClientKeyVarNameUpper)} with the value of SSH private key encryption key`)
    );
  }
  return null;
}

// Try to find certificate key file for sfdx connected app in different locations
async function getCertificateKeyFile(orgAlias: string, config: any) {
  const filesToTry = [
    `./config/branches/.jwt/${orgAlias}.key`,
    `./config/.jwt/${orgAlias}.key`,
    `./ssh/${orgAlias}.key`,
    `./.ssh/${orgAlias}.key`,
    "./ssh/server.key",
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
    console.error(c.red(`[sfdx-hardis] You must put a certificate key to connect via JWT.Possible locations:\n  -${filesToTry.join("\n  -")}`));
  }
  return null;
}
